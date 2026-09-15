/**
 * 输入捕获：把直键（HID 鼠标 / 键盘 / 触屏）的按下-抬起变成带精确时长的“码元”。
 *
 * 硬件事实：鼠标类 HID 设备最小上报间隔是 8ms（USB 全速轮询）或 1ms（高速），
 * 再经过系统与浏览器处理，一次按键的时长误差大约 ±8~16ms。所以：
 *  - 在事件回调里立刻用 performance.now() 取时间戳；
 *  - 真实拍发的“点”本来就可能只有 40~80ms，绝不能按固定毫秒数一刀切；
 *  - 只丢掉“根本不像按键”的极短脉冲（默认 18ms 以下，比任何人的点都短得多）。
 *
 * 曾经踩过的坑（务必保留这段注释）：
 *   早期版本用“最近按键时长的中位数 × 0.3”当抖动阈值。但那个中位数是把“点”和“划”
 *   混在一起算的 —— 按标准比例（PARIS 计时）大约落在 2.1 倍点长附近，乘 0.3 就是
 *   0.62 倍点长，比用户正常的“点”还长。结果就是点被当成抖动丢掉，而且划发得越多
 *   丢得越狠（中位数被划拉高）。现在改成以**时序模型估出的点长**为基准，
 *   并且只在样本足够多时才启用这个自适应判断。
 */

import { median } from '../core/util.ts';

export interface KeyEdge {
  /** 按下时刻（performance.now()）。 */
  down: number;
  /** 抬起时刻。 */
  up: number;
  /** 持续时间 ms。 */
  duration: number;
  source: 'mouse' | 'keyboard' | 'touch';
  button: number;
  /** 是否被判定为误触（不计入解码）。 */
  ignored: boolean;
  /** 被判为误触的原因。 */
  ignoreReason?: string;
}

export interface KeyInputOptions {
  /** 绝对下限（ms）：短于它的按下直接丢掉。默认 18ms。 */
  debounceMs?: number;
  /**
   * 自适应误触判断：低于「点长 × 0.3」的按下视为抖动。
   * 需要一个能给出当前点长估计的函数；没有它就不做这个判断。
   */
  baselineMs?: () => number;
  allowMouseLeft?: boolean;
  allowRightButton?: boolean;
  allowKeyboard?: boolean;
  /** 键位（event.code）。 */
  keys?: string[];
  onDown?: (down: number, ev: Event) => void;
  onUp?: (edge: KeyEdge) => void;
  onIgnored?: (edge: KeyEdge) => void;
  /** 由外部提供“现在是否在拍发”，用来决定要不要 preventDefault 键盘按键。 */
  isLive?: () => boolean;
}

const DEFAULT_KEYS = ['Space', 'KeyJ', 'KeyK', 'KeyF', 'KeyD', 'NumpadEnter', 'Enter'];

/** 绝对下限：比任何人的“点”都短，只用来挡电路/驱动的瞬时脉冲。 */
const DEFAULT_FLOOR_MS = 18;
/** 自适应抖动判断的倍率（相对点长）。 */
const CHATTER_RATIO = 0.3;
/** 至少要有多少次按键，才敢用自适应判断。 */
const MIN_SAMPLES_FOR_ADAPTIVE = 8;

type ResolvedOptions = Required<
  Omit<KeyInputOptions, 'onDown' | 'onUp' | 'onIgnored' | 'baselineMs' | 'isLive'>
> &
  KeyInputOptions;

export class KeyInput {
  private el: HTMLElement;
  private opts: ResolvedOptions;
  private downAt: number | null = null;
  private source: KeyEdge['source'] = 'mouse';
  private button = 0;
  private live = false;
  private durations: number[] = [];
  private disposers: Array<() => void> = [];

  constructor(el: HTMLElement, opts: KeyInputOptions = {}) {
    this.el = el;
    this.opts = {
      debounceMs: opts.debounceMs ?? DEFAULT_FLOOR_MS,
      allowMouseLeft: opts.allowMouseLeft ?? true,
      allowRightButton: opts.allowRightButton ?? true,
      allowKeyboard: opts.allowKeyboard ?? true,
      keys: opts.keys ?? DEFAULT_KEYS,
      baselineMs: opts.baselineMs,
      isLive: opts.isLive,
      onDown: opts.onDown,
      onUp: opts.onUp,
      onIgnored: opts.onIgnored,
    };
    this.attach();
  }

  /** 是否正在拍发：只有拍发状态下按键才进入练习，避免误点 UI 时乱发码。 */
  setLive(live: boolean): void {
    if (!live && this.downAt !== null) {
      const up = performance.now();
      const edge = this.makeEdge(up);
      this.downAt = null;
      if (edge && this.opts.onIgnored) {
        this.opts.onIgnored({ ...edge, ignored: true, ignoreReason: '已停止拍发' });
      }
    }
    this.live = live;
  }

  get isLive(): boolean {
    return this.live;
  }

  /** 最近这些按键的中位数时长（仅用于界面显示，不参与过滤）。 */
  get typicalDuration(): number {
    return this.durations.length >= 3 ? median(this.durations) : 0;
  }

  get recentDurations(): readonly number[] {
    return this.durations;
  }

  private attach(): void {
    const down = (e: MouseEvent) => {
      if (e.button !== 0 && e.button !== 2) return;
      if (e.button === 0 && !this.opts.allowMouseLeft) return;
      if (e.button === 2 && !this.opts.allowRightButton) return;
      e.preventDefault();
      this.begin(performance.now(), 'mouse', e.button, e);
    };
    const up = (e: MouseEvent) => {
      if (e.button !== 0 && e.button !== 2) return;
      this.end(performance.now(), e);
    };
    const keydown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') return; // Esc 交给上层处理
      if (!this.opts.allowKeyboard) return;
      if (!this.opts.keys.includes(e.code)) return;
      // 在输入框里不要抢按键，否则没法输入呼号
      if (isTextEntry(e.target)) return;
      // 只要是拍键键位就一律 preventDefault：空格/回车是按钮的默认激活键，
      // 不吞掉的话，抬键时焦点所在的按钮会被“点一下”
      // ——实测会出现“拍到一半手键被自动解除”这种怪事。
      e.preventDefault();
      const liveNow = this.opts.isLive ? this.opts.isLive() : this.live;
      if (!liveNow) return;
      if (e.repeat) return;
      this.begin(performance.now(), 'keyboard', 0, e);
    };
    const keyup = (e: KeyboardEvent) => {
      if (!this.opts.allowKeyboard) return;
      if (!this.opts.keys.includes(e.code)) return;
      if (isTextEntry(e.target)) return;
      e.preventDefault();
      if (this.downAt === null) return;
      this.end(performance.now(), e);
    };
    const contextmenu = (e: Event) => e.preventDefault();
    const blur = () => {
      if (this.downAt !== null) {
        const edge = this.makeEdge(performance.now());
        this.downAt = null;
        if (edge && this.opts.onIgnored) {
          this.opts.onIgnored({ ...edge, ignored: true, ignoreReason: '窗口失去焦点' });
        }
      }
    };

    this.el.addEventListener('mousedown', down);
    window.addEventListener('mouseup', up);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    this.el.addEventListener('contextmenu', contextmenu);
    window.addEventListener('blur', blur);
    this.disposers.push(
      () => this.el.removeEventListener('mousedown', down),
      () => window.removeEventListener('mouseup', up),
      () => window.removeEventListener('keydown', keydown),
      () => window.removeEventListener('keyup', keyup),
      () => this.el.removeEventListener('contextmenu', contextmenu),
      () => window.removeEventListener('blur', blur),
    );
  }

  private begin(down: number, source: KeyEdge['source'], button: number, ev: Event): void {
    if (this.downAt !== null) return; // 已经按着了，忽略重复的按下
    this.source = source;
    this.button = button;
    if (!this.live) {
      // 没在拍发：只当作“想开始”的信号，不记录时长
      this.opts.onDown?.(down, ev);
      return;
    }
    this.downAt = down;
    this.opts.onDown?.(down, ev);
  }

  private end(up: number, ev: Event): void {
    void ev;
    if (this.downAt === null) return;
    const edge = this.makeEdge(up);
    this.downAt = null;
    if (!edge) return;
    if (this.live && !edge.ignored) {
      this.durations.push(edge.duration);
      if (this.durations.length > 60) this.durations.splice(0, this.durations.length - 60);
    }
    if (this.live) this.opts.onUp?.(edge);
    else this.opts.onIgnored?.(edge);
  }

  private makeEdge(up: number): KeyEdge | null {
    if (this.downAt === null) return null;
    const duration = Math.max(0, up - this.downAt);
    const edge: KeyEdge = {
      down: this.downAt,
      up,
      duration,
      source: this.source,
      button: this.button,
      ignored: false,
    };
    const reason = this.filterReason(duration);
    if (reason) {
      edge.ignored = true;
      edge.ignoreReason = reason;
    }
    return edge;
  }

  /** 判断这一次按下是不是“根本不像按键”。返回原因或 null（原因里不带时长，由界面补）。 */
  private filterReason(duration: number): string | null {
    if (duration <= 0) return '时长为零';
    // 1) 绝对下限：挡住电路/驱动的瞬时脉冲（比任何人的点都短得多）
    if (this.opts.debounceMs > 0 && duration < this.opts.debounceMs) {
      return `短于 ${this.opts.debounceMs}ms 的下限`;
    }
    // 2) 自适应：明显短于“点”的按键，通常是按键抖动或误碰。
    //    基准取自时序模型估出的点长，而不是“点划混在一起的中位数”。
    const baseline = this.opts.baselineMs?.() ?? 0;
    if (baseline > 0 && this.durations.length >= MIN_SAMPLES_FOR_ADAPTIVE) {
      const floor = baseline * CHATTER_RATIO;
      if (duration < floor) {
        return `明显短于点长（约 ${Math.round(baseline)}ms）`;
      }
    }
    return null;
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }
}

/** 事件目标是不是正在输入文本的地方（输入框 / textarea / contenteditable）。
 *  这类元素里不能抢按键，否则用户没法输入呼号等设置项。 */
function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof (el as { tagName?: unknown }).tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el.isContentEditable === true;
}
