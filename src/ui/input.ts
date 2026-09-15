/**
 * 输入捕获：把“USB HID 直键（表现为鼠标按键）”变成带精确时长的按下/抬起事件。
 *
 * 硬件事实：鼠标类 HID 设备最小上报间隔是 8ms（USB 全速轮询）或 1ms（高速），
 * 通常还会被系统/浏览器再平滑一次，所以时长精度大约在 ±8~16ms。
 * 因此：
 *  - 用 performance.now() 在事件回调里立刻取时间戳；
 *  - 默认不做去抖动过滤（debounceMs = 0），因为真实的点本来就可能只有 40~80ms；
 *  - 只过滤掉“误触”（默认阈值取用户点长的 35%，见中位数自适应）。
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
  /** 过滤阈值（ms）。小于该时长的按下被当成抖动丢弃。0 = 不过滤。 */
  debounceMs?: number;
  /** 自适应误触阈值倍率（相对于最近的典型点长）。 */
  adaptiveFilter?: boolean;
  allowMouseLeft?: boolean;
  allowRightButton?: boolean;
  allowKeyboard?: boolean;
  /** 键位（event.code）。 */
  keys?: string[];
  onDown?: (down: number, ev: Event) => void;
  onUp?: (edge: KeyEdge) => void;
  onIgnored?: (edge: KeyEdge) => void;
  onKeyEvent?: (ev: KeyboardEvent) => void;
  /** 由外部提供"现在是否武装"，用于决定要不要 preventDefault 键盘按键。 */
  isArmed?: () => boolean;
}

const DEFAULT_KEYS = ['Space', 'KeyJ', 'KeyK', 'KeyF', 'KeyD', 'NumpadEnter', 'Enter'];

type ResolvedOptions = Required<Omit<KeyInputOptions, 'onDown' | 'onUp' | 'onIgnored' | 'onKeyEvent' | 'isArmed'>> &
  KeyInputOptions;

export class KeyInput {
  private el: HTMLElement;
  private opts: ResolvedOptions;
  private downAt: number | null = null;
  private source: KeyEdge['source'] = 'mouse';
  private button = 0;
  private armed = false;
  private durations: number[] = [];
  private disposers: Array<() => void> = [];

  constructor(el: HTMLElement, opts: KeyInputOptions = {}) {
    this.el = el;
    this.opts = {
      debounceMs: opts.debounceMs ?? 0,
      adaptiveFilter: opts.adaptiveFilter ?? true,
      allowMouseLeft: opts.allowMouseLeft ?? true,
      allowRightButton: opts.allowRightButton ?? true,
      allowKeyboard: opts.allowKeyboard ?? true,
      keys: opts.keys ?? DEFAULT_KEYS,
      onDown: opts.onDown,
      onUp: opts.onUp,
      onIgnored: opts.onIgnored,
      onKeyEvent: opts.onKeyEvent,
    };
    this.attach();
  }

  /** 是否“武装”：只有武装状态下按键才进入练习，避免误点 UI 时打字。 */
  setArmed(armed: boolean): void {
    if (!armed && this.downAt !== null) {
      // 解除武装时正在按下：直接收尾并丢弃
      const up = performance.now();
      const edge = this.makeEdge(up);
      this.downAt = null;
      if (edge && this.opts.onIgnored) this.opts.onIgnored({ ...edge, ignored: true, ignoreReason: '解除武装' });
    }
    this.armed = armed;
  }

  get isArmed(): boolean {
    return this.armed;
  }

  /** 最近的典型点长（中位数）。 */
  get typicalDuration(): number {
    return this.durations.length >= 3 ? median(this.durations) / 2.2 : 0;
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
      this.opts.onKeyEvent?.(e);
      if (e.code === 'Escape') return; // Esc 交给上层处理
      if (!this.opts.allowKeyboard) return;
      if (!this.opts.keys.includes(e.code)) return;
      // 键盘在输入框里时不要抢按键（否则没法输入呼号）
      if (isTextEntry(e.target)) return;
      // 只要按的是"拍键键位"就一律 preventDefault：
      // 空间/回车是按钮的默认激活键，如果不吞掉，抬手时焦点所在的按钮就会被"点一下"
      // ——实测会出现"拍到一半手键被自动解除武装"这种诡异现象。
      e.preventDefault();
      const armedNow = this.opts.isArmed ? this.opts.isArmed() : this.armed;
      if (!armedNow) return;
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
        const up2 = performance.now();
        const edge = this.makeEdge(up2);
        this.downAt = null;
        if (edge && this.opts.onIgnored) this.opts.onIgnored({ ...edge, ignored: true, ignoreReason: '窗口失去焦点' });
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
    // 非武装状态下的按键只作为“武装提示”，不参与练习
    if (this.downAt !== null) return; // 已经有按下的键，忽略重复
    this.downAt = down;
    this.source = source;
    this.button = button;
    if (!this.armed) {
      this.downAt = null;
      this.opts.onDown?.(down, ev);
      return;
    }
    this.opts.onDown?.(down, ev);
  }

  private end(up: number, ev: Event): void {
    void ev;
    if (this.downAt === null) return;
    const edge = this.makeEdge(up);
    this.downAt = null;
    if (!edge) return;
    if (this.armed && !edge.ignored) this.durations.push(edge.duration);
    if (this.durations.length > 60) this.durations.splice(0, this.durations.length - 60);
    if (this.armed) this.opts.onUp?.(edge);
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
      return edge;
    }
    return edge;
  }

  /** 判定是否为误触/抖动。返回原因或 null。 */
  private filterReason(duration: number): string | null {
    if (duration <= 0) return '零时长';
    if (this.opts.debounceMs > 0 && duration < this.opts.debounceMs) {
      return `短于设定阈值 ${this.opts.debounceMs}ms`;
    }
    if (this.opts.adaptiveFilter && this.durations.length >= 6) {
      const typical = median(this.durations);
      if (duration < typical * 0.3) return `疑似抖动（典型点长 ${typical.toFixed(0)}ms）`;
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
