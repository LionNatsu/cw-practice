/**
 * 练习会话：把「输入设备 → 时序模型 → 流式解码 → 与目标文本对齐」串起来。
 *
 * 与 UI 完全解耦：Session 只接收按键时刻、吐出结构化的状态快照，
 * 这样核心逻辑可以在 Node 里直接跑单元测试。
 */

import { MorseDecoder, decodePresses } from './decoder.ts';
import { TimingModel } from './timing-model.ts';
import { align, summarize, toCharScores, type AlignmentSummary } from './alignment.ts';
import { ALL_CHAR_TO_PATTERN, textDurationMs } from './morse.ts';
import type {
  CharScore,
  ClassifiedSymbol,
  CommittedChar,
  LessonItem,
  Press,
  RevisionEvent,
  SessionScore,
  TargetChar,
  TimingModelStats,
} from './types.ts';
import { clamp } from './util.ts';

export interface SessionConfig {
  callsign: string;
  /** 初始速度，用于时序模型的先验；实际会自适应。 */
  wpm: number;
  /** 速度锁定：锁定时模型不随观测漂移，只统计节奏。 */
  speedLocked: boolean;
  /** 停顿多久算“当前字符发完了”，单位数。 */
  pauseUnits: number;
  /** 回改窗口：最近多少个字符允许被修正。 */
  revisionWindow: number;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  callsign: 'BG1ABC',
  wpm: 12,
  speedLocked: false,
  pauseUnits: 3.5,
  revisionWindow: 14,
};

export interface SessionSnapshot {
  /** 目标字符序列。 */
  target: TargetChar[];
  /** 已解码字符。 */
  committed: CommittedChar[];
  /** 当前还没落定的尾部（斜体显示）。 */
  pending: ReturnType<MorseDecoder['snapshot']>['pending'];
  /** 解码出的文本。 */
  decoded: string;
  /** 光标位置（对齐到目标的下标）。 */
  cursor: number;
  /** 逐字符判定。 */
  scores: CharScore[];
  /** 汇总。 */
  summary: AlignmentSummary;
  /** 时序模型状态。 */
  timing: TimingModelStats;
  /** 已按键数。 */
  pressCount: number;
  /** 是否在等用户停顿（有未定稿字符）。 */
  awaitingPause: boolean;
  /** 最近一次按键分类。 */
  lastSymbol: ClassifiedSymbol | null;
  /** 最近被回改的记录。 */
  lastRevision: RevisionEvent | null;
  /** 解码器最近一次"改写前面字符"的事件（来自在线重算）。 */
  revision: { id: number; from: string; to: string } | null;
}

export class PracticeSession {
  readonly model: TimingModel;
  private decoder: MorseDecoder;
  private config: SessionConfig;
  private item: LessonItem;
  private _target: TargetChar[] = [];
  private pressList: Press[] = [];
  private revisions: RevisionEvent[] = [];
  private paused = false;
  private startedAt = 0;
  private pendingPressedUp = 0;
  private lastRevision: RevisionEvent | null = null;
  private listeners = new Set<(s: SessionSnapshot) => void>();
  /** 本课之前已经出现过的字符（用于标记“新字符”）。 */
  private knownChars = new Set<string>();

  constructor(item: LessonItem, config: Partial<SessionConfig> = {}, knownChars?: Iterable<string>) {
    this.item = item;
    this.config = { ...DEFAULT_SESSION_CONFIG, ...config };
    this.model = new TimingModel(this.config.wpm, { speedLocked: this.config.speedLocked });
    this.decoder = new MorseDecoder({ charBoundaryBias: 0 });
    this.decoder.revisionWindow = this.config.revisionWindow;
    // 语料 = 本条目标报文里出现过的字符，用来给"像正常报文"的解释一点偏好
    this.decoder.setCorpus(this.item.text.toUpperCase().replace(/\s+/g, ''));
    if (knownChars) this.knownChars = new Set(knownChars);
    this.buildTarget();
  }

  /** 设置“之前学过”的字符集合，用于高亮本课新字符。 */
  setKnownChars(chars: Iterable<string>): void {
    this.knownChars = new Set(chars);
    this.buildTarget();
  }

  get targetText(): string {
    return this._target.map((t) => t.ch).join('');
  }

  get targetChars(): readonly TargetChar[] {
    return this._target;
  }

  get itemRef(): LessonItem {
    return this.item;
  }

  private buildTarget(): void {
    const resolved = this.item.text.toUpperCase();
    const out: TargetChar[] = [];
    let groupIndex = 0;
    for (let i = 0; i < resolved.length; i++) {
      const ch = resolved[i]!;
      if (ch === ' ') {
        groupIndex++;
        continue;
      }
      const pattern = ALL_CHAR_TO_PATTERN[ch] ?? '';
      out.push({ ch, pattern, isNew: !this.knownChars.has(ch), groupIndex });
    }
    this._target = out;
  }

  /** 预计发送时长（按当前点长）。 */
  estimatedDurationMs(): number {
    return textDurationMs(this.item.text.replaceAll('{CALLSIGN}', this.config.callsign), this.model.unitMs);
  }

  /** 开始计时。 */
  start(now = nowMs()): void {
    this.startedAt = now;
    this.paused = false;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  onUpdate(fn: (s: SessionSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }

  /**
   * 按键抬起（= 完成了一次点或划）。
   * @param down 按下时刻（performance.now()）
   * @param up 抬起时刻
   */
  submitPress(down: number, up: number): SessionSnapshot {
    if (this.paused) return this.snapshot();
    const press: Press = { down, up, duration: Math.max(1, up - down) };
    this.pressList.push(press);
    this.pendingPressedUp = up;

    // 1) 更新自适应时序模型（用旧模型分类，再计入观测）
    this.model.update({ duration: press.duration, gapBefore: this.gapFor(press) });

    // 2) 束搜索解码
    const before = this.decoder.snapshot();
    this.decoder.pushPress(press, this.model, up);
    const after = this.decoder.snapshot();
    this.trackRevisions(before.committed, after.committed, up);

    // 3) 停顿判定由 tick() 驱动（见下方注释）
    this.emit();
    return this.snapshot();
  }

  /**
   * 由外部时钟驱动的“停顿”判定。
   *
   * 逻辑放在这里而不是内部定时器，是为了让核心逻辑可测试、UI 也能自己选时钟：
   * - 浏览器里由 rAF / setInterval 调用；
   * - 单元测试里手动推进时间。
   */
  tick(now = nowMs()): void {
    if (this.paused) return;
    if (this.pressList.length === 0) return;
    if (!this.snapshot().awaitingPause) return;
    const silence = now - this.pendingPressedUp;
    const threshold = Math.max(160, this.config.pauseUnits * this.model.unitMs);
    if (silence >= threshold) this.flushPause(now);
  }

  /** 立即触发一次“停顿定稿”。 */
  flushPause(now = nowMs()): void {
    if (this.paused) return;
    const before = this.decoder.snapshot();
    this.decoder.pushPause(this.model, now);
    const after = this.decoder.snapshot();
    this.trackRevisions(before.committed, after.committed, now);
    this.emit();
  }

  /** 当前停顿阈值（ms）。 */
  get pauseThresholdMs(): number {
    return Math.max(160, this.config.pauseUnits * this.model.unitMs);
  }

  private gapFor(press: Press): number | null {
    const prev = this.pressList[this.pressList.length - 2];
    return prev ? press.down - prev.up : null;
  }

  /** 找出本次提交中相对于上次“被改写”的字符，记录下来。 */
  private trackRevisions(before: readonly CommittedChar[], after: readonly CommittedChar[], at: number): void {
    const beforeMap = new Map(before.map((c) => [c.id, c.text]));
    for (const c of after) {
      const old = beforeMap.get(c.id);
      if (old !== undefined && old !== c.text) {
        const ev: RevisionEvent = { id: c.id, from: old, to: c.text, reason: '时序模型更新后重估', at };
        this.revisions.push(ev);
        this.lastRevision = ev;
      }
    }
  }

  /** 当前对齐结果（不会改变任何状态）。 */
  alignNow(): { scores: CharScore[]; summary: AlignmentSummary; decoded: string } {
    const dec = this.decoder.snapshot();
    const actualChars = [...dec.committed.map((c) => c.text), ...dec.pending.map((p) => p.text)];
    const decoded = actualChars.join('');
    const res = align(this.targetText, decoded);
    const scores = toCharScores(res, dec.committed, actualChars);
    return { scores, summary: summarize(scores), decoded };
  }

  /** 光标：对齐后“下一个待发字符”的下标。 */
  private cursorFrom(scores: readonly CharScore[]): number {
    let i = 0;
    while (i < scores.length && scores[i]!.verdict !== 'missing') {
      i++;
    }
    return clamp(i, 0, this._target.length);
  }

  snapshot(): SessionSnapshot {
    const dec = this.decoder.snapshot();
    const actualChars = [...dec.committed.map((c) => c.text), ...dec.pending.map((p) => p.text)];
    // 抄收区显示"当前最优解释"：已落账的字 + 还没落账的尾部。
    const decoded = actualChars.join('');
    const res = align(this.targetText, decoded);
    const scores = toCharScores(res, dec.committed, actualChars);
    const summary = summarize(scores);
    const symbols = this.decoder.symbols;
    return {
      target: this._target,
      committed: dec.committed,
      pending: dec.pending,
      decoded,
      cursor: this.cursorFrom(scores),
      scores,
      summary,
      timing: this.model.stats,
      pressCount: this.pressList.length,
      awaitingPause: dec.pending.length > 0,
      lastSymbol: symbols.length ? symbols[symbols.length - 1]! : null,
      lastRevision: this.lastRevision,
      revision: this.decoder.revisionEvent,
    };
  }

  get allSymbols(): readonly ClassifiedSymbol[] {
    return this.decoder.symbols;
  }

  get allPresses(): readonly Press[] {
    return this.pressList;
  }

  /** 复核：全局重新解码一遍（练习结束后用，看是不是前面判断错了）。 */
  postScore(): { text: string; confidence: number; candidates: Array<{ text: string; probability: number }> } {
    const resolved = this.item.text.toUpperCase().replace(/\s+/g, '');
    const res = decodePresses(this.pressList, this.model, { corpus: resolved });
    return {
      text: res.text,
      confidence: res.confidence,
      candidates: res.candidates.map((c) => ({ text: c.text, probability: c.probability })),
    };
  }

  /** 生成成绩单。 */
  finalize(now = nowMs()): SessionScore {
    const dec = this.decoder.snapshot();
    const actualChars = [...dec.committed.map((c) => c.text), ...dec.pending.map((p) => p.text)];
    const decoded = actualChars.join('');
    const res = align(this.targetText, decoded);
    const scores = toCharScores(res, dec.committed, actualChars);
    const summary = summarize(scores);
    const symbols = this.decoder.symbols;
    const confidentSymbols = symbols.filter((s) => s.confidence > 0.5).length;
    const symbolAccuracy = symbols.length > 0 ? confidentSymbols / symbols.length : 1;
    return {
      total: this._target.length,
      correct: summary.correct,
      wrong: summary.wrong,
      extra: summary.extra,
      missing: summary.missing,
      accuracy: summary.accuracy,
      symbolAccuracy,
      timing: this.model.stats,
      chars: summary.scores,
      confusion: summary.confusion,
      elapsed: Math.max(0, now - (this.startedAt || now)),
      pressCount: this.pressList.length,
    };
  }

  /** 清理（取消订阅等）。 */
  dispose(): void {
    this.listeners.clear();
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}
