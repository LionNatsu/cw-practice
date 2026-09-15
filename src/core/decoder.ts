/**
 * 解码器：从「按键时长 + 间隔」里恢复出用户发出的字符。
 *
 * 算法选择上做了一个明确的取舍：
 *
 *   束搜索（beam search）在“本地逐步分支”这件事上很自然，但它的代价是把结构性的
 *   惩罚（断字代价）和码元似然混在一个局部贪心的比较里，任何一处标定偏差都会被
 *   放大成系统性错误（实测会把整句认成一串 E）。
 *
 *   所以这里改用**全局最优分割**（Viterbi / 动态规划）：
 *   枚举「哪些连续按键属于同一个字符」的所有切分方式，每个字符内部走摩尔斯前缀树，
 *   字与字之间按真实间隔算代价，取整段代价最小的路径。
 *
 * 在线使用方式：每次按键到达后，对「到目前为止的全部按键」重跑一次全局最优。这样：
 *   - 线上结果与离线复核完全一致（不会给出两套答案）；
 *   - 前面判错的字会随着新证据被自动改写（满足“自适应修正前面若干字”的要求）；
 *   - 复杂度 O(n² · 码字长度)，几百个按键的报文完全够用。
 *
 * 「已定稿 / 可回改」的表达：最优路径的前缀连续多轮不变就落账；尾部不稳的部分
 * 留在 pending，UI 画成斜体待定；用户一停顿就把整条最优路径全部落定。
 */

import type { Candidate, ClassifiedSymbol, CommittedChar, Press } from './types.ts';
import { buildTree, type MorseNode, type MorseTree } from './morse.ts';
import { classifyObservation, likelihoodConfidence, type TimingModel } from './timing-model.ts';
import { clamp } from './util.ts';

/** gap 的分类（相对当前单位时长）。 */
export type GapClass = 'intra' | 'char' | 'word';

/** 间隔 → 判定阈值（单位数）。标准是 1 / 3 / 7，取中间值拆分。 */
export const CHAR_GAP_UNITS = 1.75;
export const WORD_GAP_UNITS = 5;

export function classifyGap(gapUnits: number | null): GapClass {
  if (gapUnits === null) return 'intra';
  if (gapUnits >= WORD_GAP_UNITS) return 'word';
  if (gapUnits >= CHAR_GAP_UNITS) return 'char';
  return 'intra';
}

/**
 * 间隔的证据模型。
 *
 * 三种间隔在国际摩尔斯码里的期望长度是 1 / 3 / 7 个单位，但手工拍发
 * （再叠上 USB HID 的 8ms 上报粒度）必然有误差，所以这里用三个对数正态分布
 * 去比较「这个间隔更有可能是哪一种」，而不是拿 1.75 / 5 个单位硬卡阈值。
 *
 * sigma 的量级照着「点长 100ms 的手键 + 8ms 上报粒度」估：
 *  - intra：1 单位附近，误差主要来自手抖
 *  - char ：3 单位附近，人的字间隔通常最随意
 *  - word ：7 单位附近，多半是停顿
 *
 * 注意一个容易翻车的地方：新手常把字内间隔也拍成 1.5~2 个单位，
 * 所以 char 的 sigma 不能太小，否则字内间隔会被判成断字。
 */
const GAP_SIGMA: Record<GapClass, number> = { intra: 0.38, char: 0.6, word: 0.9 };
const GAP_MEAN: Record<GapClass, number> = { intra: 1, char: 3, word: 7 };
/** 三种间隔的先验（对数权重）。断字比“继续拼同一个字”稍微常见一点。 */
const GAP_PRIOR: Record<GapClass, number> = { intra: 0, char: 0.2, word: 0.3 };

/**
 * 落账一个字符的代价。
 *
 * 必须有这个常数（而不是 0），否则会出现病态行为：
 * 把两个字符拼成一个更长的码字时不用付任何“收尾”代价，长串反而显得更便宜。
 */
const CLOSE_COST = 0.6;

/** 未知码形（码表里没有）的惩罚：越长越不可能。 */
function unknownSymbolCost(patternLength: number): number {
  return 8 + 1.2 * patternLength;
}

/** 码元越长越可疑（标准码字最长 5~6 个码元）。 */
function lenPenalty(len: number): number {
  return len > 6 ? 2.5 * (len - 6) : 0;
}

/**
 * 语料偏置：练习内容是有意义的报文，所以“在课程里出现过”的字符应该比冷门
 * 组合信号更容易被选中。给一点小优惠就够扭转平局，压不过真实的时序证据。
 */
const CORPUS_BONUS = 0.45;

/** 需要连续这么多轮都一致，才把前缀落账（越大越保守）。 */
const STABLE_ROUNDS = 2;

/** 历史解释里每轮之间的分隔符（用来切分字符，兼容多字符码字）。 */
const SEPARATOR = '\u0001';

/** 保留最近多少轮解释用于求公共前缀。 */
const HISTORY_ROUNDS = 6;

/** 某个间隔在某个假设下的代价（负对数似然 + 先验）。 */
function gapCost(gapUnits: number | null, cls: GapClass): number {
  const g = gapUnits === null ? GAP_MEAN.intra : Math.max(0.05, gapUnits);
  const sigma = GAP_SIGMA[cls];
  const z = Math.log(g / GAP_MEAN[cls]) / sigma;
  return 0.5 * z * z + Math.log(sigma) - GAP_PRIOR[cls];
}

function gapCostOf(gapUnits: number | null): number {
  return Math.min(gapCost(gapUnits, 'intra'), gapCost(gapUnits, 'char'), gapCost(gapUnits, 'word'));
}

/**
 * 在间隔处断开当前字符的代价（区分字内 / 字间 / 词间）。
 * 返回「按 cls 解释」相对最优解释的负对数似然差，量级与码元似然可比。
 * bias > 0 表示对「在边界处断开」更宽容（新手模式）。
 */
export function boundaryCost(cls: GapClass, gapUnits: number | null = null, bias = 0): number {
  let cost = gapCost(gapUnits, cls) - gapCostOf(gapUnits);
  if (cls !== 'intra') cost -= bias;
  return Math.max(0.05, cost);
}

/** 把间隔当成「码元间隔」继续拼字的代价（同样取相对最优的差值）。 */
export function intraCost(gapUnits: number | null): number {
  return Math.max(0.01, gapCost(gapUnits, 'intra') - gapCostOf(gapUnits));
}

export interface DecoderOptions {
  /** 课程自定义码字。 */
  extra?: Readonly<Record<string, string>>;
  /** 断字宽容度：>0 时更容易把间隔判成字符边界（新手模式）。 */
  charBoundaryBias?: number;
  /**
   * 语料字符集：练习目标文本里出现过的字符。
   * 用于给“像正常报文”的解释一点偏好，避免把 "PARIS" 认成 "P+5" 这类冷门组合。
   */
  corpus?: Iterable<string>;
}

/** 一条完整解释。 */
interface Path {
  text: string;
  /** 每个字符的码形。 */
  patterns: string[];
  /** 每个字符的起始按键下标。 */
  starts: number[];
  /** 每个字符的结束按键下标（含）。 */
  ends: number[];
  /** 每个字符内部的最低码元置信度。 */
  minConfidences: number[];
  cost: number;
}

/** 动态规划的一格。 */
interface DpEntry {
  cost: number;
  /** 上一个字符的结束下标（即本字符的起点）。-1 表示这是第一个字符。 */
  prev: number;
  text: string;
  pattern: string;
  start: number;
  end: number;
  minConfidence: number;
}

export interface DecoderSnapshot {
  /** 已定稿字符（前缀稳定后才进来）。 */
  committed: CommittedChar[];
  /** 还没定稿的尾部（当前最优解释，UI 用斜体画）。 */
  pending: Candidate[];
  /** 当前最优路径的总代价。 */
  cost: number;
  /** 按键数。 */
  pressCount: number;
  /** 最近一次“回改”事件。 */
  revision: { id: number; from: string; to: string } | null;
}

export interface PostScoreResult {
  text: string;
  confidence: number;
  candidates: Candidate[];
}

export class MorseDecoder {
  private tree: MorseTree;
  private presses: Press[] = [];
  private classes: ClassifiedSymbol[] = [];
  private committed: CommittedChar[] = [];
  private nextId = 1;
  private charBoundaryBias: number;
  private corpus: Set<string> | null = null;
  private lastPath: Path | null = null;
  private lastModel: TimingModel | null = null;
  /** 最近几轮的最优解释（用于求公共前缀，决定哪些内容可以落账）。 */
  private history: string[] = [];
  private lastRevision: { id: number; from: string; to: string } | null = null;
  /** 停顿标记：这些按键下标之前发生过一次“词间隔”。 */
  private wordBreaks = new Set<number>();
  /** 回改窗口：最近这么多个字符允许被改写。 */
  revisionWindow = 14;

  constructor(opts: DecoderOptions = {}) {
    this.tree = buildTree(opts.extra ?? {});
    this.charBoundaryBias = opts.charBoundaryBias ?? 0;
    if (opts.corpus) this.corpus = new Set([...opts.corpus].map((c) => c.toUpperCase()));
  }

  get treeRef(): MorseTree {
    return this.tree;
  }

  get symbols(): readonly ClassifiedSymbol[] {
    return this.classes;
  }

  get committedChars(): readonly CommittedChar[] {
    return this.committed;
  }

  get allPresses(): readonly Press[] {
    return this.presses;
  }

  get revisionEvent(): { id: number; from: string; to: string } | null {
    return this.lastRevision;
  }

  /** 设置语料字符集（练习目标文本里出现过的字符）。 */
  setCorpus(chars: Iterable<string>): void {
    this.corpus = new Set([...chars].map((c) => c.toUpperCase()));
  }

  /** 重置（新的一次练习）。 */
  reset(extra?: Readonly<Record<string, string>>): void {
    if (extra) this.tree = buildTree(extra);
    this.presses = [];
    this.classes = [];
    this.committed = [];
    this.history = [];
    this.wordBreaks.clear();
    this.lastPath = null;
    this.lastRevision = null;
    this.nextId = 1;
  }

  /**
   * 接收一次按键，并重跑一次全局最优。
   * @param press 按键（down/up/duration）
   * @param model 当前时序模型
   * @param now 事件时刻
   */
  pushPress(press: Press, model: TimingModel, now = press.up): DecoderSnapshot {
    const prev = this.presses[this.presses.length - 1];
    const gapBefore = prev ? press.down - prev.up : null;
    const gapUnits = gapBefore === null ? null : gapBefore / model.unitMs;
    const { costDit, costDah } = classifyObservation(model, press.duration);

    this.presses.push(press);
    this.classes.push({
      index: this.classes.length,
      press,
      kind: costDit <= costDah ? 'dit' : 'dah',
      gapBefore,
      gapUnits,
      costDit,
      costDah,
      confidence: likelihoodConfidence(costDit, costDah, model.separation),
    });
    this.lastModel = model;

    const path = this.solve(model);
    this.lastPath = path;
    if (path) this.updateCommitted(path, now);
    return this.snapshot();
  }

  /**
   * 用户停顿：把最优路径的尾部也落定，并在停顿处记一个**词边界**。
   *
   * 停顿在 CW 里就是“空格”（标准词间隔 7 个单位）。用户练习时不需要真的把空格
   * 发出来，所以这里把停顿记成词边界，解码结果里自动还原成空格。
   */
  pushPause(model: TimingModel, now: number): DecoderSnapshot {
    if (model) this.lastModel = model;
    const path = this.lastPath;
    if (path) {
      this.commitAll(path, now);
      this.history = [path.text + SEPARATOR];
    }
    if (this.presses.length > 0) this.wordBreaks.add(this.presses.length);
    return this.snapshot();
  }

  /** 还没有落定的字符数。 */
  get pendingCount(): number {
    return Math.max(0, (this.lastPath?.text.length ?? 0) - this.committed.length);
  }

  snapshot(): DecoderSnapshot {
    const path = this.lastPath;
    const pending: Candidate[] = [];
    if (path) {
      for (let i = this.committed.length; i < path.text.length; i++) {
        pending.push({ text: path.text[i]!, pattern: path.patterns[i] ?? '', cost: 0, probability: 0 });
      }
    }
    return {
      committed: this.committed.map((c) => ({ ...c, alternatives: [...c.alternatives] })),
      pending,
      cost: path?.cost ?? 0,
      pressCount: this.presses.length,
      revision: this.lastRevision,
    };
  }

  /** 当前最优解释的完整文本（含未落定的尾部）。 */
  bestText(): string {
    return this.lastPath?.text ?? '';
  }

  /**
   * 当前最优解释，并按“词间隔”插入空格。
   *
   * 空格在 CW 里不是字符，而是“比字符间隔更长的一段静音”（标准 7 个单位）。
   * 词边界有两个来源：真实的长间隔，以及用户停顿（pushPause 记下来的边界）。
   */
  bestTextWithSpaces(): string {
    const path = this.lastPath;
    if (!path) return '';
    let out = '';
    for (let i = 0; i < path.text.length; i++) {
      if (i > 0) {
        const start = path.starts[i]!;
        const gap = this.classes[start]!.gapUnits;
        if (classifyGap(gap) === 'word' || this.wordBreaks.has(start)) out += ' ';
      }
      out += path.text[i]!;
    }
    return out;
  }

  /** 当前最优解释的置信度（用次优路径比较）。 */
  bestConfidence(): number {
    const path = this.lastPath;
    if (!path || !this.lastModel) return 0;
    const alt = this.bestAlternativeCost(path, this.lastModel);
    if (!Number.isFinite(alt)) return 0.9;
    return clamp(1 - Math.exp(-Math.max(0, alt - path.cost) / 1.1), 0, 0.99);
  }

  // ---------- 核心：全局最优分割 ----------

  /**
   * 动态规划求解整段最优分割。
   *
   * dp[i] 表示「前 i 个按键已经解析完、且恰好以一个字符结尾」的最优解。
   * 转移：dp[end+1] ← dp[start] + 码元似然(start..end) + 字内间隔 + 断字代价 + 收尾代价。
   */
  private solve(model: TimingModel): Path | null {
    const n = this.presses.length;
    if (n === 0) return null;

    const dp: Array<DpEntry | undefined> = new Array(n + 1).fill(undefined);
    dp[0] = { cost: 0, prev: -1, text: '', pattern: '', start: 0, end: -1, minConfidence: 1 };

    for (let start = 0; start < n; start++) {
      const prevEntry = dp[start];
      if (!prevEntry) continue;
      const gapBefore = this.classes[start]!.gapUnits;
      const splitCost =
        start === 0 ? 0 : boundaryCost(classifyGap(gapBefore), gapBefore, this.charBoundaryBias);

      let node: MorseNode | undefined = this.tree.root;
      let symCost = 0;
      let minConfidence = 1;
      for (let end = start; end < n; end++) {
        if (end > start) symCost += intraCost(this.classes[end]!.gapUnits);
        const settled = classifyObservation(model, this.presses[end]!.duration);
        const takeDit = settled.costDit <= settled.costDah;
        node = node.children.get(takeDit ? 'dit' : 'dah');
        if (!node) break; // 前缀树里没有这条路径，再长也不可能
        const len = end - start + 1;
        if (len > this.tree.maxDepth) break;
        symCost += takeDit ? settled.costDit : settled.costDah;
        minConfidence = Math.min(minConfidence, this.classes[end]!.confidence);

        const closeCost =
          CLOSE_COST +
          (node.text ? this.corpusBonus(node.text) : unknownSymbolCost(len)) +
          lenPenalty(len);
        const total = prevEntry.cost + symCost + splitCost + closeCost;
        const slot = end + 1;
        const cur = dp[slot];
        if (!cur || total < cur.cost - 1e-9) {
          dp[slot] = {
            cost: total,
            prev: start,
            text: node.text ?? '¿',
            pattern: 'x'.repeat(len),
            start,
            end,
            minConfidence,
          };
        }
      }
    }

    const tail = dp[n];
    if (!tail) return null;
    const text: string[] = [];
    const patterns: string[] = [];
    const starts: number[] = [];
    const ends: number[] = [];
    const minConfidences: number[] = [];
    let cursor = n;
    while (cursor > 0) {
      const entry = dp[cursor]!;
      text.unshift(entry.text);
      patterns.unshift(this.patternOf(entry.start, entry.end));
      starts.unshift(entry.start);
      ends.unshift(entry.end);
      minConfidences.unshift(entry.minConfidence);
      cursor = entry.prev;
    }
    return { text: text.join(''), patterns, starts, ends, minConfidences, cost: tail.cost };
  }

  /** 从按键分类还原某段按键的码形。 */
  private patternOf(start: number, end: number): string {
    let out = '';
    for (let i = start; i <= end; i++) out += this.classes[i]!.kind === 'dit' ? '.' : '-';
    return out;
  }

  private corpusBonus(text: string): number {
    if (!this.corpus) return 0;
    return this.corpus.has(text.toUpperCase()) ? -CORPUS_BONUS : 0;
  }

  // ---------- 落账 / 回改 ----------

  /**
   * 把「最近几轮重算都一致的前缀」落账。
   *
   * 这是「可回改」的核心：单次最优解释随时可能被后面的按键改写
   * （典型例子：先认成 "ETT"，多发一个划之后整段变成 "E9"）。
   * 所以这里维护最近 HISTORY_ROUNDS 轮的解释，取它们的**最长公共前缀**作为可落账的内容，
   * 公共前缀变短时会自动把已经落账的字撤回 —— 这正是“修正前面若干字”的机制。
   */
  private updateCommitted(path: Path, now: number): void {
    this.history.push(path.text + SEPARATOR);
    if (this.history.length > HISTORY_ROUNDS) this.history.shift();

    // 已落账的部分必须仍然被当前最优解释支持
    let keep = 0;
    while (
      keep < this.committed.length &&
      keep < path.text.length &&
      this.committed[keep]!.text === path.text[keep]
    ) {
      keep++;
    }
    if (keep < this.committed.length) this.committed = this.committed.slice(0, keep);

    // 之后再从「最近几轮都一致」的前缀里，把还没落账的部分补上
    const agreed = this.commonPrefixLength();
    const before = this.committed.map((c) => c.text);
    const sliced = this.committed.slice();
    for (let i = sliced.length; i < agreed; i++) {
      const ch = path.text[i]!;
      const pattern = path.patterns[i] ?? '';
      sliced.push({
        id: this.nextId++,
        text: ch,
        pattern,
        symbolCount: pattern.length,
        at: now,
        confidence: this.confidenceAt(path, i),
        correct: null,
        revisable: true,
        revisions: 0,
        alternatives: this.alternativesAt(path, i),
      });
    }
    if (sliced.length !== this.committed.length || before.length !== sliced.length) {
      this.committed = sliced;
      this.noteRevisions(before);
    } else {
      this.committed = sliced;
    }
  }

  /**
   * 最近几轮解释的最长公共前缀长度。
   * 只有当历史足够长（说明这个前缀已经扛住了若干次新证据）时才认为可以落账。
   */
  private commonPrefixLength(): number {
    if (this.history.length < STABLE_ROUNDS + 1) return 0;
    const [first, ...rest] = this.history;
    const texts = first!.split(SEPARATOR);
    let n = texts.length;
    for (const h of rest) {
      const other = h.split(SEPARATOR);
      let i = 0;
      const max = Math.min(n, other.length);
      while (i < max && other[i] === texts[i]) i++;
      n = i;
    }
    return n;
  }

  /** 停顿：整条最优路径全部落定，不再标记为可改。 */
  private commitAll(path: Path, now: number): void {
    const before = this.committed.map((c) => c.text);
    const sliced = this.committed.slice();
    for (let i = 0; i < Math.min(sliced.length, path.text.length); i++) {
      const cur = sliced[i]!;
      if (cur.text !== path.text[i]) {
        sliced[i] = { ...cur, text: path.text[i]!, revisions: cur.revisions + 1, revisable: false };
      } else {
        sliced[i] = { ...cur, revisable: false };
      }
    }
    for (let i = sliced.length; i < path.text.length; i++) {
      const ch = path.text[i]!;
      const pattern = path.patterns[i] ?? '';
      sliced.push({
        id: this.nextId++,
        text: ch,
        pattern,
        symbolCount: pattern.length,
        at: now,
        confidence: this.confidenceAt(path, i),
        correct: null,
        revisable: false,
        revisions: 0,
        alternatives: this.alternativesAt(path, i),
      });
    }
    this.committed = sliced;
    this.noteRevisions(before);
  }

  /** 记录「前面若干字被改写」的事件。 */
  private noteRevisions(before: readonly string[]): void {
    for (let i = 0; i < Math.min(before.length, this.committed.length); i++) {
      if (this.committed[i]!.text !== before[i]) {
        this.lastRevision = { id: this.committed[i]!.id, from: before[i]!, to: this.committed[i]!.text };
        return;
      }
    }
  }

  // ---------- 置信度 / 备选 ----------

  /**
   * 某个字符的置信度：把它的切分点往两边挪一格，看最好的替代解释贵多少。
   * 差距越大越确定。这是“这个字会不会被改”的直接度量。
   */
  private confidenceAt(path: Path, index: number): number {
    const model = this.lastModel;
    if (!model) return 0.5;
    const alt = this.alternativeCosts(path, index, model);
    if (alt.length === 0) return 0.95;
    const margin = Math.max(0, alt[0]!.cost - path.cost);
    return clamp(1 - Math.exp(-margin / 1.1), 0, 0.98);
  }

  private alternativesAt(path: Path, index: number): Candidate[] {
    const model = this.lastModel;
    if (!model) return [];
    return this.alternativeCosts(path, index, model)
      .filter((c) => c.text !== path.text[index])
      .slice(0, 3)
      .map((c) => ({ text: c.text, pattern: '', cost: c.cost, probability: 0 }));
  }

  /** 该字符位置的备选解释（挪动切分点）。 */
  private alternativeCosts(path: Path, index: number, model: TimingModel): Array<{ text: string; cost: number }> {
    const start = path.starts[index]!;
    const end = path.ends[index]!;
    const out: Array<{ text: string; cost: number }> = [];
    for (const [s, e] of [
      [start - 1, end],
      [start, end + 1],
      [start - 1, end - 1],
    ] as Array<[number, number]>) {
      if (s < 0 || e >= this.presses.length || s > e) continue;
      const scored = this.scoreRange(model, s, e);
      if (!scored) continue;
      // 用整段代价的近似：其余部分按最优路径不变，只替换这一个字符
      const delta = scored.cost - this.rangeCost(path, index);
      out.push({ text: scored.text, cost: path.cost + delta });
    }
    out.sort((a, b) => a.cost - b.cost);
    return out;
  }

  /** 最优路径里第 index 个字符那一段的代价。 */
  private rangeCost(path: Path, index: number): number {
    const model = this.lastModel;
    if (!model) return 0;
    const scored = this.scoreRange(model, path.starts[index]!, path.ends[index]!);
    return scored?.cost ?? 0;
  }

  /** 整段最优 vs 次优（只扰动最后一个字符的切分点）。 */
  private bestAlternativeCost(path: Path, model: TimingModel): number {
    const last = path.text.length - 1;
    if (last < 0) return Number.POSITIVE_INFINITY;
    const alt = this.alternativeCosts(path, last, model).filter((c) => c.text !== path.text[last]);
    return alt.length > 0 ? alt[0]!.cost : Number.POSITIVE_INFINITY;
  }

  /** 给一段连续按键打分（当作一个码字）。 */
  private scoreRange(model: TimingModel, start: number, end: number): { cost: number; text: string } | null {
    let node: MorseNode | undefined = this.tree.root;
    let cost = 0;
    let len = 0;
    for (let i = start; i <= end; i++) {
      if (i > start) cost += intraCost(this.classes[i]!.gapUnits);
      const settled = classifyObservation(model, this.presses[i]!.duration);
      const takeDit = settled.costDit <= settled.costDah;
      node = node.children.get(takeDit ? 'dit' : 'dah');
      if (!node) return null;
      len++;
      cost += takeDit ? settled.costDit : settled.costDah;
    }
    // 第一个字符之前/之后的断字代价：这里用真实间隔做近似
    const splitGap = start === 0 ? null : this.classes[start]!.gapUnits;
    if (start > 0) cost += boundaryCost(classifyGap(splitGap), splitGap, this.charBoundaryBias);
    cost += CLOSE_COST + (node.text ? this.corpusBonus(node.text) : unknownSymbolCost(len)) + lenPenalty(len);
    return { cost, text: node.text ?? '¿' };
  }
}

/**
 * 离线复核：对一整段按键做一次全局最优解码（与在线逻辑同源）。
 *
 * 练习结束时调用，用来把在线解码时因为信息不足而判错的字修回来。
 */
export function decodePresses(
  presses: readonly Press[],
  model: TimingModel,
  opts: DecoderOptions = {},
): PostScoreResult {
  if (presses.length === 0) return { text: '', confidence: 0, candidates: [] };
  const decoder = new MorseDecoder(opts);
  for (const p of presses) decoder.pushPress(p, model, p.up);
  decoder.pushPause(model, (presses[presses.length - 1]?.up ?? 0) + 1);
  return {
    text: decoder.bestTextWithSpaces(),
    confidence: decoder.bestConfidence(),
    candidates: [],
  };
}
