/**
 * 练习引擎：判定与速度估计全在这里，别处不再判。
 *
 * 练习是串行的：目标字从左到右，一次只发一个字。
 *
 *   [已确认][当前字][还没发]
 *
 * 一次尝试 = 上一次判定之后按下的所有码元。判定只在停顿发生时做：
 * 静音达到 symbolGapMax 个单位，就认为这个字发完了，这时才读这次尝试。
 *
 * 按键时不判定。字还没发完，谁也读不出它是什么：目标是 C（-.-.），
 * 拍到第二下时读出来是 A，但那只是“还没发完”。
 *
 * 判定时整段重读，而不是按键时逐下分类。理由：刚开始练时还不知道手速，
 * 第一下只能靠先验猜。等这次尝试拍完，同一次尝试里的时长自己就能说明点有多长
 * （最短的那一下、以及码元之间的间隔都是 1 个单位），回过来重新分类，
 * 前面几下也能跟着改正。
 *
 * 状态只有本文件这一份。界面拿 state 渲染，不参与判定。
 */

import { ALL_CHAR_TO_PATTERN, PATTERN_TO_CHAR } from './morse.ts';
import { clamp } from './util.ts';
import type { CharScore, SessionScore, SymbolKind, TargetChar } from './types.ts';

/* ============================ 阈值（只此一处） ============================ */

export const THRESHOLDS = {
  /**
   * 间隔达到这么多个单位就是字的边界。
   *
   * 标准码元间隔是 1 个单位，字间隔是 3 个，日志尺度的中点是 1.73。
   * 取 2.5：新手常把码元间隔拍到 1.5~2 个单位，这样仍然算“还在拼同一个字”，
   * 而 3 个单位的字间隔照样能切开。
   */
  symbolGapMax: 2.5,
  /** 一次尝试的码元数上限，超过就不可能是字（最长码字 6 个）。 */
  maxSymbols: 8,
  /** 单位时长的允许范围（ms），也是候选值被夹取的范围。 */
  unitMin: 30,
  unitMax: 400,
  /** 点划分界（单位数）：1 与 3 在对数尺度上的中点。 */
  dahRatio: Math.sqrt(3),
  /** 一颗码元时长相对单位时长的可信范围，超出这个范围的假设直接否掉。 */
  durationRatioMin: 0.4,
  durationRatioMax: 5.5,
  /** 速度估计的滑动窗口。 */
  unitWindow: 24,
} as const;

/** 先验速度在重读时的分量。太大会跟不上真人手速，太小会让第一下乱猜。 */
const PRIOR_WEIGHT = 0.6;
/** 段内间隔在重读时的分量。标准是 1 个单位，用户多停一点也别当边界。 */
const GAP_WEIGHT = 0.5;

/* ============================ 读一次尝试 ============================ */

/** 本次尝试里的一个码元。只记时长，是点还是划等判定时再算。 */
export interface AttemptSymbol {
  /** 按下时长 ms。 */
  duration: number;
  /** 上一次抬起到这次按下的静音 ms；这次尝试的第一个码元为 null。 */
  gapBefore: number | null;
}

/** 一次尝试读出来的东西。 */
export interface Reading {
  kinds: SymbolKind[];
  /** 整段码形。 */
  pattern: string;
  /** 整段对应的字；不成字时为 undefined。 */
  text: string | undefined;
  /** 按字间隔切开后，每一段读出来的字。 */
  segments: string[];
  /** 对方实际听到的内容（不成字的段记作 ?）。 */
  heard: string;
  /** 是否每一段都成字。 */
  recognized: boolean;
  /** 整段是否只是一个字。 */
  single: boolean;
  /** 这次尝试自己给出的单位时长估计。 */
  unitMs: number;
}

/** 一次按键是点还是划：不到分界（1.73 个单位）算点。 */
export function classifyDuration(duration: number, unitMs: number): SymbolKind {
  return duration < unitMs * THRESHOLDS.dahRatio ? 'dit' : 'dah';
}

/* ============================ 过程信号 ============================ */

/** 用过程信号直接操作界面：不用退出拍发，也不用摸鼠标。 */
export type CommandId = 'prev' | 'next' | 'retry' | 'replay' | 'score';

/**
 * 码形 → 命令。
 *
 * 都是业余无线电里真的有人这么用的过程信号：
 *   <AR> .-.-.     报文结束     → 下一条
 *   <BK> -...-.-   打断/回到前面 → 上一条
 *   <HH> ........  发错了       → 本条重来（8 个点，不是任何字符的码形）
 *   ?    ..--..    请重发       → 重听示范
 *   <SK> ...-.-    结束联络     → 结算成绩
 *
 * 目标字优先：课上正好在练 ? 时，它就是目标字，不是命令。
 */
export const COMMANDS: Readonly<Record<string, CommandId>> = {
  '.-.-.': 'next',
  '-...-.-': 'prev',
  '...-.-': 'score',
  '..--..': 'replay',
  '........': 'retry',
};

/** 每个命令的名字与码形，界面拿它写提示。 */
export const COMMAND_INFO: Readonly<Record<CommandId, { name: string; pattern: string; label: string }>> = {
  prev: { name: 'BK', pattern: '-...-.-', label: '上一条' },
  next: { name: 'AR', pattern: '.-.-.', label: '下一条' },
  retry: { name: 'HH', pattern: '........', label: '本条重来' },
  replay: { name: '?', pattern: '..--..', label: '重听示范' },
  score: { name: 'SK', pattern: '...-.-', label: '结算成绩' },
};

/**
 * 这个码形还能继续长成某个过程信号吗。
 *
 * 用来解决一个真实的撞车：目标是 E（一个点），用户却想发 AR（.-.-.）。
 * 第一个点既是目标的全部，也是 AR 的开头 —— 这时候不能急着收下，
 * 等停顿再说：停下来了就是 E，接着往下发就是 AR。
 */
function canGrowIntoCommand(pattern: string): boolean {
  for (const cmd of Object.keys(COMMANDS)) {
    if (cmd.length > pattern.length && cmd.startsWith(pattern)) return true;
  }
  return false;
}

/** 一个候选单位假设的代价，以及它读出来的码形。 */
interface Hypothesis {
  unit: number;
  cost: number;
  pattern: string;
}

/**
 * 把所有说得通的单位假设都算一遍。
 *
 * 候选值来自“这次尝试自己的时长和间隔”再加上先验速度，逐个假设算代价：
 *   - 每个码元要么是 1 个单位（点）、要么是 3 个单位（划），取更像的那个；
 *   - 段内间隔应当接近 1 个单位；
 *   - 离先验速度越远代价越高。
 * 代价最低的假设胜出。凡是让某个码元短于 0.4 个单位、长于 5.5 个单位，
 * 或者让某个间隔大到字间隔的假设，直接不算数。
 */
function judgeUnits(
  durations: readonly number[],
  innerGaps: readonly number[],
  priorUnitMs: number,
  targetPattern?: string,
): { best: number; settleUnit: number } {
  const prior = clamp(priorUnitMs, THRESHOLDS.unitMin, THRESHOLDS.unitMax);
  const candidates = new Set<number>([prior]);
  for (const d of durations) candidates.add(clamp(d, THRESHOLDS.unitMin, THRESHOLDS.unitMax));
  for (const g of innerGaps) candidates.add(clamp(g, THRESHOLDS.unitMin, THRESHOLDS.unitMax));
  // 目标字是已知的：如果用户正在发它，那么“已发这几个码元 ÷ 该发几个单位”
  // 就是一个很靠谱的单位候选。手速离起始速度差得远时，靠它把前面几下读对。
  if (targetPattern && durations.length > 0 && targetPattern.length >= durations.length) {
    const units = [...targetPattern.slice(0, durations.length)].reduce((a, c) => a + (c === '.' ? 1 : 3), 0);
    const total = durations.reduce((a, b) => a + b, 0);
    if (units > 0 && total > 0) candidates.add(clamp(total / units, THRESHOLDS.unitMin, THRESHOLDS.unitMax));
  }

  const hyps: Hypothesis[] = [];
  for (const u of candidates) {
    let cost = PRIOR_WEIGHT * Math.abs(Math.log(u / prior));
    let ok = true;
    const pattern: string[] = [];
    for (const d of durations) {
      const r = d / u;
      if (r < THRESHOLDS.durationRatioMin || r > THRESHOLDS.durationRatioMax) {
        ok = false;
        break;
      }
      const asDit = Math.abs(Math.log(r));
      const asDah = Math.abs(Math.log(r / 3));
      pattern.push(asDit <= asDah ? '.' : '-');
      cost += Math.min(asDit, asDah);
    }
    if (ok) {
      for (const g of innerGaps) {
        const r = g / u;
        if (r >= THRESHOLDS.symbolGapMax) {
          ok = false;
          break;
        }
        cost += GAP_WEIGHT * Math.abs(Math.log(r));
      }
    }
    if (ok) hyps.push({ unit: u, cost, pattern: pattern.join('') });
  }

  if (hyps.length === 0) return { best: prior, settleUnit: prior };
  hyps.sort((a, b) => a.cost - b.cost);
  const top = hyps[0]!;
  const plausible = hyps.filter((h) => h.cost <= top.cost + PLAUSIBLE_MARGIN);
  // 断字用最宽松的那个说得通的假设：宁可多等一会儿，也不要把还在拼的字判成拍错
  const settleUnit = plausible.reduce((mx, h) => Math.max(mx, h.unit), top.unit);
  return { best: top.unit, settleUnit };
}

/** 代价与最优假设差在这么小以内，就算“也说得通”。 */
const PLAUSIBLE_MARGIN = 0.5;
export function readAttempt(
  symbols: readonly AttemptSymbol[],
  priorUnitMs: number,
  targetPattern?: string,
): Reading {
  const durations = symbols.map((s) => s.duration);
  const innerGaps: number[] = [];
  for (let i = 1; i < symbols.length; i++) innerGaps.push(Math.max(1, symbols[i]!.gapBefore ?? 0));

  const { best: unitMs } = judgeUnits(durations, innerGaps, priorUnitMs, targetPattern);
  const kinds = durations.map((d) => classifyDuration(d, unitMs));

  const patterns: string[] = [];
  let cur = '';
  for (let i = 0; i < kinds.length; i++) {
    const gap = i === 0 ? null : symbols[i]!.gapBefore;
    if (cur && gap !== null && gap / unitMs >= THRESHOLDS.symbolGapMax) {
      patterns.push(cur);
      cur = '';
    }
    cur += kinds[i] === 'dit' ? '.' : '-';
  }
  if (cur) patterns.push(cur);

  const segments = patterns.map((p) => PATTERN_TO_CHAR[p] ?? '?');
  const pattern = patterns.join('');
  return {
    kinds,
    pattern,
    text: PATTERN_TO_CHAR[pattern],
    segments,
    heard: segments.join(''),
    recognized: segments.every((s) => s !== '?'),
    single: patterns.length <= 1,
    unitMs,
  };
}

/** 从一串裸按键里读点长（设置页的校准台用，没有目标字，只有按键）。 */
export function readSpeed(durations: readonly number[]): { dit: number; dah: number; nDit: number; nDah: number } | null {
  if (durations.length < 3) return null;
  const sorted = [...durations].sort((a, b) => a - b);
  // 报文里点比划多，取偏低分位当点长；划取高点。
  const dit = clamp(sorted[Math.floor((sorted.length - 1) * 0.3)]!, THRESHOLDS.unitMin, THRESHOLDS.unitMax);
  const dahs = sorted.filter((d) => d >= dit * THRESHOLDS.dahRatio);
  const dah = dahs.length ? dahs.reduce((a, b) => a + b, 0) / dahs.length : dit * 3;
  return { dit, dah, nDit: sorted.length - dahs.length, nDah: dahs.length };
}

/**
 * 这次尝试之后，静音多久才算这个字发完了。
 *
 * 取最宽松的那个说得通的假设：手速未知时同一次按键既可能是点也可能是划，
 * 按最宽松的算，宁可多等一会儿，也不要把还在拼的字判成拍错。
 */
export function settleUnitFor(
  symbols: readonly AttemptSymbol[],
  priorUnitMs: number,
  targetPattern?: string,
): number {
  if (symbols.length === 0) return priorUnitMs;
  const durations = symbols.map((s) => s.duration);
  const innerGaps: number[] = [];
  for (let i = 1; i < symbols.length; i++) innerGaps.push(Math.max(1, symbols[i]!.gapBefore ?? 0));
  return judgeUnits(durations, innerGaps, priorUnitMs, targetPattern).settleUnit;
}

/* ============================ 引擎 ============================ */

export interface EngineOptions {
  /** 目标文本（空格只用来分词，不参与拍发）。 */
  text: string;
  /** 起始速度，只作为先验；实际速度跟着你的手走。 */
  wpm?: number;
  /** 已经练熟的字符，用来标记本课的生字。 */
  knownChars?: Iterable<string>;
}

/** 拍错时的负反馈内容。 */
export interface Confusion {
  /** 对方听到的东西（可能不止一个字）。 */
  heard: string;
  /** 对方是否听出了一个字。 */
  recognized: boolean;
  /** 到目前拍错的总次数。 */
  count: number;
  /** 递增序号，界面据此判断“这是一次新的拍错”。 */
  seq: number;
}

export interface PracticeState {
  target: readonly TargetChar[];
  /** 已拍对的字数。 */
  cursor: number;
  /** 当前该发的字。 */
  expected: TargetChar | null;
  /** 本次尝试已发出的码元（按最新估计重新读过）。 */
  attempt: readonly SymbolKind[];
  /** 正按着的这一下（按当前估计预测）；没按就是 null。 */
  holding: SymbolKind | null;
  /** 已经按住的时长 ms。 */
  holdingMs: number;
  /** 拍错的负反馈；没拍错时为 null。 */
  confused: Confusion | null;
  /** 刚收到一个过程信号（发 AR 就是下一条，等等）；没收到时为 null。 */
  command: { id: CommandId; seq: number } | null;
  /** 每个位置拍错过几次。 */
  wrongAt: ReadonlyMap<number, number>;
  /** 单位时长（ms）。 */
  unitMs: number;
  /** 折合速度 WPM。 */
  wpm: number;
  /** 节奏稳定度 0..100。 */
  rhythm: number;
  pressCount: number;
  finished: boolean;
}

export class PracticeEngine {
  readonly target: readonly TargetChar[];
  private cursor = 0;
  private unit: number;
  private attempt: AttemptSymbol[] = [];
  private holdingSince: number | null = null;
  private lastUpAt: number | null = null;
  private now = 0;
  private pressCount = 0;
  private wrongCountValue = 0;
  private wrongSeq = 0;
  private command: { id: CommandId; seq: number } | null = null;
  private commandSeq = 0;
  private confused: Confusion | null = null;
  private readonly wrongAt = new Map<number, number>();
  private ditSamples: number[] = [];
  private startedAt = 0;

  constructor(opts: EngineOptions) {
    const known = new Set(opts.knownChars ?? []);
    const out: TargetChar[] = [];
    let group = 0;
    for (const raw of opts.text.toUpperCase()) {
      if (raw === ' ' || raw === '\t' || raw === '\n') {
        group++;
        continue;
      }
      out.push({
        ch: raw,
        pattern: ALL_CHAR_TO_PATTERN[raw] ?? '',
        isNew: known.size > 0 && !known.has(raw),
        groupIndex: group,
      });
    }
    this.target = out;
    this.unit = clamp(1200 / Math.max(1, opts.wpm ?? 12), THRESHOLDS.unitMin, THRESHOLDS.unitMax);
  }

  get expected(): TargetChar | null {
    return this.target[this.cursor] ?? null;
  }

  get finished(): boolean {
    return this.cursor >= this.target.length;
  }

  /** 到目前拍错的总次数（同一个字拍错几次算几次）。 */
  get wrongCount(): number {
    return this.wrongCountValue;
  }

  /** 当前单位时长 ms。判定、显示、静音门槛都用它。 */
  get unitMs(): number {
    return this.unit;
  }

  /** 按当前尝试读一次（带上当前字的码形做提示）。 */
  private read(): Reading {
    return readAttempt(this.attempt, this.unit, this.expected?.pattern);
  }

  /**
   * 静音多久算这个字发完了。
   *
   * 用最宽松的那个说得通的假设来算：只按了一两下时点划还分不清，
   * 一个 540ms 的按键既可能是慢的点、也可能是快的划，这时急着断字，
   * 就会把还在拼的字判成拍错。
   *
   * 例外：已经读成目标字、只是在等“你会不会接着发成过程信号”时，
   * 就没有可犹豫的了，按最紧凑的门槛算，别拖。
   */
  get settleMs(): number {
    const reading = this.attempt.length ? this.read() : null;
    if (reading && reading.single && reading.text !== undefined && reading.text === this.expected?.ch) {
      return reading.unitMs * THRESHOLDS.symbolGapMax;
    }
    return settleUnitFor(this.attempt, this.unit, this.expected?.pattern) * THRESHOLDS.symbolGapMax;
  }

  start(now: number): void {
    this.startedAt = now;
  }

  /** 按下（只为界面显示，不判定）。 */
  keyDown(now: number): void {
    this.holdingSince = now;
    this.now = now;
  }

  /** 抬起没形成一次有效按键（抖动、被过滤）。 */
  keyUp(now: number): void {
    this.holdingSince = null;
    this.now = now;
  }

  /** 一次完整的按键：一个码元。 */
  press(down: number, up: number): void {
    const duration = Math.max(1, up - down);
    const gapBefore = this.lastUpAt === null ? null : Math.max(0, down - this.lastUpAt);
    this.holdingSince = null;
    this.now = up;
    this.pressCount++;
    this.attempt.push({ duration, gapBefore });
    this.lastUpAt = up;
    // 又开始拍了，上一次的负反馈收起来
    this.confused = null;

    // 这一下正好把这个字发全了（或者发出一个过程信号），立刻办，不用再等停顿
    this.resolveIfComplete(false);
  }

  /**
   * 时钟。界面每帧调一次：判定只在这里发生。
   */
  tick(now: number): void {
    this.now = now;
    if (this.holdingSince !== null) return;
    if (this.attempt.length === 0 || this.lastUpAt === null) return;
    if (now - this.lastUpAt < this.settleMs) return;
    this.judge();
  }

  /** 丢掉这次尝试，从同一个字重来。 */
  retry(): void {
    this.clearAttempt();
    this.confused = null;
  }

  get state(): PracticeState {
    const reading = this.attempt.length ? this.read() : null;
    return {
      target: this.target,
      cursor: this.cursor,
      expected: this.expected,
      attempt: reading ? reading.kinds : [],
      holding: this.holdingSince === null ? null : classifyDuration(Math.max(1, this.now - this.holdingSince), this.unit),
      holdingMs: this.holdingSince === null ? 0 : Math.max(0, this.now - this.holdingSince),
      confused: this.confused,
      command: this.command,
      wrongAt: this.wrongAt,
      unitMs: this.unit,
      wpm: 1200 / this.unit,
      rhythm: this.rhythmScore(),
      pressCount: this.pressCount,
      finished: this.finished,
    };
  }

  /* ---------------- 判定 ---------------- */

  /**
   * 这次尝试已经读成了一个完整的字，就当场办掉：收下目标字，或者执行过程信号。
   *
   * 码形与字是一一对应的，读出来等于目标，就说明这个字已经完整，
   * 不必再等停顿 —— 手感是跟手的。唯一的例外见 canGrowIntoCommand：
   * 目标字同时还是某个过程信号的开头时，等停顿再定，免得把 AR 拆成 E + C。
   */
  private resolveIfComplete(settled: boolean): boolean {
    const reading = this.read();
    if (!reading.single || reading.kinds.length > THRESHOLDS.maxSymbols) return false;

    const want = this.expected?.ch;
    if (want !== undefined && reading.text === want) {
      if (!settled && canGrowIntoCommand(reading.pattern)) return false;
      this.learn(reading);
      this.clearAttempt();
      this.accept();
      return true;
    }
    const cmd = COMMANDS[reading.pattern];
    if (cmd) {
      this.learn(reading);
      this.clearAttempt();
      this.fireCommand(cmd);
      return true;
    }
    return false;
  }

  /** 判一个停顿：先看是不是完整的字，不是就按拍错处理。 */
  private judge(): void {
    if (this.resolveIfComplete(true)) return;

    const reading = this.read();
    const want = this.expected?.ch;
    this.learn(reading);
    this.clearAttempt();
    if (want === undefined) return;
    this.reject(reading);
  }

  /** 收到一个过程信号。引擎只负责报出来，怎么动由界面决定。 */
  private fireCommand(id: CommandId): void {
    this.commandSeq++;
    this.command = { id, seq: this.commandSeq };
    this.confused = null;
  }

  /** 收下这个字。 */
  private accept(): void {
    this.cursor++;
    this.confused = null;
  }

  /** 拍错：不认这个字，给一次负反馈，原地重拍。 */
  private reject(reading: Reading): void {
    this.wrongCountValue++;
    this.wrongSeq++;
    this.wrongAt.set(this.cursor, (this.wrongAt.get(this.cursor) ?? 0) + 1);
    this.confused = { heard: reading.heard, recognized: reading.recognized, count: this.wrongCountValue, seq: this.wrongSeq };
  }

  /** 用这次尝试修正速度估计。拍错也要学：手速是手的事，与拍没拍对无关。 */
  private learn(reading: Reading): void {
    this.unit = clamp(this.unit * 0.5 + reading.unitMs * 0.5, THRESHOLDS.unitMin, THRESHOLDS.unitMax);
    for (let i = 0; i < reading.kinds.length; i++) {
      if (reading.kinds[i] === 'dit') this.ditSamples.push(this.attempt[i]!.duration);
    }
    if (this.ditSamples.length > THRESHOLDS.unitWindow) {
      this.ditSamples.splice(0, this.ditSamples.length - THRESHOLDS.unitWindow);
    }
  }

  private clearAttempt(): void {
    this.attempt = [];
    this.lastUpAt = null;
  }

  /** 节奏稳定度：由已拍对字符的码元浮动换算。 */
  private rhythmScore(): number {
    const n = this.ditSamples.length;
    if (n < 4) return 100;
    const mean = this.ditSamples.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(this.ditSamples.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    const cv = mean > 0 ? sd / mean : 0;
    return clamp(Math.round(100 * (1 - (cv - 0.08) / 0.4)), 0, 100);
  }

  /** 成绩单。 */
  finalize(now: number): SessionScore {
    const chars: CharScore[] = this.target.map((t, i) => {
      const missed = this.wrongAt.get(i) ?? 0;
      return i < this.cursor
        ? { target: t.ch, actual: t.ch, verdict: 'correct', missed }
        : { target: t.ch, actual: null, verdict: 'missing', missed };
    });
    const correct = this.cursor;
    const total = this.target.length;
    return {
      total,
      correct,
      wrong: this.wrongCountValue,
      missing: total - correct,
      accuracy: total > 0 ? correct / total : 1,
      chars,
      elapsed: Math.max(0, now - (this.startedAt || now)),
      pressCount: this.pressCount,
      timing: {
        dit: this.unit,
        dah: this.unit * 3,
        wpm: 1200 / this.unit,
        rhythm: this.rhythmScore(),
      },
    };
  }
}
