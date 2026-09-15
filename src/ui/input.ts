/**
 * 输入捕获：把直键（USB HID 直键练习器，在系统里就是一个鼠标左键）的
 * 按下-抬起变成带精确时长的“码元”。
 *
 * 只认鼠标左键。右键、键盘都当不了直键 —— 直键练习器上报的就是左键，
 * 多支持几种只会让“我刚才那下算不算”变得含糊。
 *
 * 硬件事实：鼠标类 HID 设备最小上报间隔是 8ms（USB 全速轮询）或 1ms（高速），
 * 再经过系统与浏览器处理，一次按键的时长误差大约 ±8~16ms。所以：
 *  - 在事件回调里立刻用 performance.now() 取时间戳；
 *  - 真实拍发的“点”本来就可能只有 30~80ms，绝不能按固定毫秒数一刀切；
 *  - 只丢掉“根本不像按键”的极短脉冲（默认 18ms 以下，比任何人的点都短得多）。
 *
 * 曾经踩过的坑（务必保留这段注释）：
 *   早期版本还用“最近按键时长的中位数 × 0.3”当抖动阈值。但那个中位数是把“点”和“划”
 *   混在一起算的 —— 按标准比例（PARIS 计时）大约落在 2.1 倍点长附近，乘 0.3 就是
 *   0.62 倍点长，比用户正常的“点”还长。结果就是点被当成抖动丢掉，而且划发得越多
 *   丢得越狠（中位数被划拉高）。后来改成以估出的点长为基准，一样会丢点：
 *   丢一个点就是丢一个码元，判读必然出错。现在只保留绝对下限，
 *   剩下的事交给判定引擎 —— 它本来就是按你自己的长短去读的。
 */

export interface KeyEdge {
  /** 按下时刻（performance.now()）。 */
  down: number;
  /** 抬起时刻。 */
  up: number;
  /** 持续时间 ms。 */
  duration: number;
  /** 是否被判定为误触（不计入判定）。 */
  ignored: boolean;
  /** 被判为误触的原因。 */
  ignoreReason?: string;
}

export interface KeyInputOptions {
  /** 绝对下限（ms）：短于它的按下直接丢掉。默认 18ms。 */
  debounceMs?: number;
  onDown?: (down: number) => void;
  onUp?: (edge: KeyEdge) => void;
  onIgnored?: (edge: KeyEdge) => void;
}

/** 绝对下限：比任何人的“点”都短，只用来挡电路/驱动的瞬时脉冲。 */
const DEFAULT_FLOOR_MS = 18;

export class KeyInput {
  private el: HTMLElement;
  private opts: Required<Omit<KeyInputOptions, 'onDown' | 'onUp' | 'onIgnored'>> & KeyInputOptions;
  private downAt: number | null = null;
  /** 拍发状态：不在拍发时按下只当“想开始”的信号，不算码元。 */
  private live = false;
  private disposers: Array<() => void> = [];

  constructor(el: HTMLElement, opts: KeyInputOptions = {}) {
    this.el = el;
    this.opts = { debounceMs: opts.debounceMs ?? DEFAULT_FLOOR_MS, ...opts };
    this.attach();
  }

  setLive(live: boolean): void {
    if (!live && this.downAt !== null) {
      const edge = this.makeEdge(performance.now());
      this.downAt = null;
      if (edge) this.opts.onIgnored?.({ ...edge, ignored: true, ignoreReason: '已暂停' });
    }
    this.live = live;
  }

  get isLive(): boolean {
    return this.live;
  }

  private attach(): void {
    const down = (e: MouseEvent) => {
      if (e.button !== 0) return; // 只认左键
      e.preventDefault();
      this.begin(performance.now());
    };
    // 抬起挂在 window 上：拖出元素之后再松手也要收得到
    const up = (e: MouseEvent) => {
      if (e.button !== 0) return;
      this.end(performance.now());
    };
    const cancel = (reason: string) => () => {
      if (this.downAt === null) return;
      const edge = this.makeEdge(performance.now());
      this.downAt = null;
      if (edge) this.opts.onIgnored?.({ ...edge, ignored: true, ignoreReason: reason });
    };
    const onBlur = cancel('窗口失去焦点');
    const onHide = cancel('页面切走了');

    this.el.addEventListener('mousedown', down);
    window.addEventListener('mouseup', up);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onHide);
    this.disposers.push(
      () => this.el.removeEventListener('mousedown', down),
      () => window.removeEventListener('mouseup', up),
      () => window.removeEventListener('blur', onBlur),
      () => document.removeEventListener('visibilitychange', onHide),
    );
  }

  private begin(down: number): void {
    if (this.downAt !== null) return; // 已经按着了，忽略重复的按下
    if (!this.live) {
      this.opts.onDown?.(down);
      return;
    }
    this.downAt = down;
    this.opts.onDown?.(down);
  }

  private end(up: number): void {
    if (this.downAt === null) return;
    const edge = this.makeEdge(up);
    this.downAt = null;
    if (!edge) return;
    if (this.live) this.opts.onUp?.(edge);
    else this.opts.onIgnored?.(edge);
  }

  private makeEdge(up: number): KeyEdge | null {
    if (this.downAt === null) return null;
    const edge: KeyEdge = { down: this.downAt, up, duration: Math.max(0, up - this.downAt), ignored: false };
    const reason = this.filterReason(edge.duration);
    if (reason) {
      edge.ignored = true;
      edge.ignoreReason = reason;
    }
    return edge;
  }

  /** 判断这一次按下是不是“根本不像按键”。返回原因或 null（原因里不带时长，由界面补）。 */
  private filterReason(duration: number): string | null {
    if (duration <= 0) return '时长为零';
    // 绝对下限：挡住电路/驱动的瞬时脉冲（比任何人的点都短得多）。
    // 只此一条：丢一个点就是丢一个码元，判定必然出错，宁可把可疑的一下交给引擎。
    if (this.opts.debounceMs > 0 && duration < this.opts.debounceMs) {
      return `短于 ${this.opts.debounceMs}ms 的下限`;
    }
    return null;
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }
}
