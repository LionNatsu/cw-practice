/**
 * 练习页。
 *
 * 画面只有一个重心：中间那个字，像被凸透镜放大。
 *   码形提示      当前字该发成什么
 *   字符带        目标报文，中心最清楚，两侧递减
 *   发报条        你已经发出的点划，按下去的时候还在长
 * 拍错时这条反馈原地变成“对方听到的是什么”，等重拍，不跳到下一个字。
 */

import type { App } from '../App.ts';
import type { PracticeEngine, PracticeState } from '../core/practice.ts';
import { mergeScore } from '../core/settings.ts';
import type { SessionScore } from '../core/types.ts';
import type { KeyEdge } from './input.ts';
import { KeyInput } from './input.ts';
import { clear, fmtMs, h, toast } from './dom.ts';

/** 透镜范围：中心两侧各显示几个字。 */
const WINDOW = 7;

export class PracticeView {
  private app: App;
  private engine: PracticeEngine;
  private input: KeyInput | null = null;
  private raf = 0;
  private unsub: Array<() => void> = [];

  private stageEl!: HTMLElement;
  private ribbonEl!: HTMLElement;
  private patternEl!: HTMLElement;
  private sentEl!: HTMLElement;
  private glossEl!: HTMLElement;
  private messageEl!: HTMLElement;
  private armBtn!: HTMLButtonElement;
  private liveDot!: HTMLElement;
  private statWpm!: HTMLElement;
  private statProgress!: HTMLElement;

  private live = false;
  private finished = false;
  private wrongSeq = 0;
  private lastFrame = '';

  constructor(app: App) {
    this.app = app;
    this.engine = app.startEngine(app.itemIndex);
    this.engine.start(performance.now());
  }

  render(root: HTMLElement): void {
    const item = this.app.currentItem;

    this.liveDot = h('span', { class: 'live-dot', id: 'live-dot' });
    this.statWpm = h('b', {}, '--');
    this.statProgress = h('b', {}, `0/${this.engine.target.length}`);

    const bar = h(
      'div',
      { class: 'practice-bar' },
      this.liveDot,
      h('span', { class: 'lesson' }, this.app.lesson.title),
      h('span', { class: 'sep' }, '·'),
      h('span', {}, `第 ${this.app.itemIndex + 1}/${this.app.items.length} 条`),
      h('div', { class: 'spacer' }),
      h('span', {}, '手速 '),
      this.statWpm,
      h('span', {}, ' WPM'),
      h('span', { class: 'sep' }, '·'),
      h('span', {}, '进度 '),
      this.statProgress,
    );

    this.patternEl = h('div', { class: 'pattern-hint', id: 'pattern-hint' });
    this.ribbonEl = h('div', { class: 'ribbon', id: 'ribbon' });
    this.sentEl = h('div', { class: 'sent', id: 'sent' });
    this.stageEl = h('div', { class: 'stage', id: 'stage' }, this.patternEl, this.ribbonEl, this.sentEl);

    this.glossEl = h('div', { class: 'gloss' }, item.gloss ?? item.text);
    this.messageEl = h('div', { class: 'message', id: 'message' });
    const under = h('div', { class: 'under-stage' }, this.glossEl, this.messageEl);

    this.armBtn = h(
      'button',
      { class: 'btn primary', id: 'arm-toggle', onclick: () => this.toggleLive() },
      '开始',
    ) as HTMLButtonElement;

    const foot = h(
      'div',
      { class: 'practice-foot' },
      this.armBtn,
      h('button', { class: 'btn', id: 'replay', onclick: () => void this.replayReference() }, '重听'),
      h('button', { class: 'btn', id: 'restart', onclick: () => this.restartItem() }, '重来'),
      h('button', { class: 'btn ghost', id: 'next-item', onclick: () => this.nextItem() }, '下一条'),
      h('button', { class: 'btn ghost', id: 'finish', onclick: () => this.finish() }, '成绩'),
    );

    root.appendChild(h('div', { class: 'practice' }, bar, this.stageEl, under, foot));

    this.attachInput();
    this.renderState(this.engine.state, true);

    // 时钟：判定只在停顿发生时做，所以每帧问一次引擎
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      this.engine.tick(now);
      this.renderState(this.engine.state, false);
    };
    this.raf = requestAnimationFrame(loop);

    this.unsub.push(
      this.app.onKey((ev) => {
        if (ev.code === 'Escape') {
          this.toggleLive();
          return true;
        }
        if (ev.code === 'KeyR') {
          void this.replayReference();
          return true;
        }
        if (ev.code === 'KeyN') {
          this.nextItem();
          return true;
        }
        return false;
      }),
    );
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.input?.dispose();
    for (const u of this.unsub) u();
    this.unsub = [];
    this.app.audio.silence();
    this.app.audio.stopPlayback();
  }

  // ---------- 输入 ----------

  private attachInput(): void {
    this.input = new KeyInput(this.stageEl, {
      debounceMs: 18,
      allowMouseLeft: this.app.settings.allowMouseLeft,
      allowRightButton: this.app.settings.allowRightButton,
      allowKeyboard: this.app.settings.allowKeyboard,
      isLive: () => this.live,
      onDown: (down) => {
        if (!this.live) return;
        this.app.audio.keyDown();
        this.stageEl.classList.add('keying');
        this.engine.keyDown(down);
      },
      onUp: (edge) => this.handleEdge(edge),
      onIgnored: (edge) => {
        this.engine.keyUp(edge.up);
        this.stageEl.classList.remove('keying');
        if (edge.ignoreReason) toast(`已忽略 ${Math.round(edge.duration)}ms：${edge.ignoreReason}`, 'warn');
      },
    });
  }

  private handleEdge(edge: KeyEdge): void {
    this.app.audio.keyUp();
    this.stageEl.classList.remove('keying');
    if (!this.live) return;
    if (edge.ignored) {
      toast(`已忽略 ${Math.round(edge.duration)}ms：${edge.ignoreReason ?? ''}`, 'warn');
      return;
    }
    this.engine.press(edge.down, edge.up);
  }

  private toggleLive(): void {
    this.live = !this.live;
    this.input?.setLive(this.live);
    this.liveDot.classList.toggle('on', this.live);
    this.stageEl.classList.toggle('live', this.live);
    this.armBtn.textContent = this.live ? '停止' : '开始';
    this.armBtn.blur();
    if (this.live) {
      void this.app.audio.resume();
    } else {
      this.app.audio.silence();
      this.engine.retry();
    }
    this.renderState(this.engine.state, true);
  }

  private restartItem(): void {
    this.engine = this.app.startEngine(this.app.itemIndex);
    this.engine.start(performance.now());
    this.finished = false;
    this.wrongSeq = 0;
    this.lastFrame = '';
    this.glossEl.textContent = this.app.currentItem.gloss ?? this.app.currentItem.text;
    this.renderState(this.engine.state, true);
  }

  private nextItem(): void {
    const next = (this.app.itemIndex + 1) % this.app.items.length;
    this.app.itemIndex = next;
    this.app.saveSettings({ lastItemIndex: next });
    this.restartItem();
  }

  private async replayReference(): Promise<void> {
    await this.app.audio.playText(this.app.currentItem.text, this.app.settings.wpm);
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.engine.retry();
    const score = this.engine.finalize(performance.now());
    // 统计里拍错过一次就算错过：这个字你最终发对了，但也发错过
    const perChar = score.chars
      .filter((c) => c.target)
      .map((c) => ({ ch: c.target!, correct: c.verdict === 'correct' && c.missed === 0 }));
    this.app.saveProgress(
      mergeScore(this.app.progress, this.app.lesson.id, score.accuracy, score.elapsed, score.pressCount, perChar),
    );
    showResult(this.app, score);
  }

  // ---------- 渲染 ----------

  private renderState(st: PracticeState, force: boolean): void {
    // 一帧里大多数东西没变，用签名挡掉多余的重排
    const sig = [
      st.cursor,
      st.attempt.length,
      st.holding ?? '-',
      st.holding === null ? 0 : Math.round(st.holdingMs / 8),
      st.confused?.seq ?? 0,
      st.finished ? 1 : 0,
      this.live ? 1 : 0,
    ].join('|');
    if (!force && sig === this.lastFrame) return;
    this.lastFrame = sig;

    this.renderPattern(st);
    this.renderRibbon(st);
    this.renderSent(st);
    this.renderMessage(st);
    this.statWpm.textContent = st.wpm.toFixed(0);
    this.statProgress.textContent = `${st.cursor}/${st.target.length}`;

    // 拍错：红灯闪一下 + 低音提示，只响一次
    if (st.confused && st.confused.seq !== this.wrongSeq) {
      this.wrongSeq = st.confused.seq;
      void this.app.audio.playBump();
      this.liveDot.classList.add('bad');
      window.setTimeout(() => this.liveDot.classList.remove('bad'), 400);
    }
  }

  /** 当前字该发成什么，直接画成点划的形状。 */
  private renderPattern(st: PracticeState): void {
    clear(this.patternEl);
    const want = st.expected;
    if (!want?.pattern) return;
    for (const c of want.pattern) {
      this.patternEl.appendChild(h('span', { class: `sym${c === '-' ? ' dah' : ''}` }));
    }
  }

  /** 透镜式字符带：中心最大，两侧递减。 */
  private renderRibbon(st: PracticeState): void {
    const total = st.target.length;
    clear(this.ribbonEl);
    if (total === 0) return;
    // 中心对准“下一个要发的字”；整条发完了就停在最后一个字上
    const focus = Math.min(st.cursor, total - 1);
    const from = Math.max(0, focus - WINDOW);
    const to = Math.min(total - 1, focus + WINDOW);

    for (let i = from; i <= to; i++) {
      const t = st.target[i]!;
      const dist = Math.min(5, Math.abs(i - focus));
      const first = i === 0 || st.target[i - 1]!.groupIndex !== t.groupIndex;
      this.ribbonEl.appendChild(
        h(
          'div',
          {
            class: `cell${i < st.cursor ? ' correct' : ''}`,
            dataset: { dist: String(dist), word: first ? '1' : '0' },
          },
          h('div', { class: 'glyph' }, displayChar(t.ch)),
        ),
      );
    }
  }

  /**
   * 发报条：已经发出的码元。这是每次按键之后最重要的一条反馈，
   * 所以点划直接画成形状，按着的那一下会当场长出来。
   */
  private renderSent(st: PracticeState): void {
    clear(this.sentEl);
    const confused = st.confused;
    if (confused) {
      this.sentEl.className = 'sent confused';
      this.sentEl.appendChild(h('span', { class: 'qmark' }, '?'));
      this.sentEl.appendChild(
        h(
          'span',
          { class: 'said' },
          confused.recognized ? `对方听到的是 ${confused.heard}` : '对方没听出这是个字',
          h('span', { class: 'sub' }, '重拍这个字'),
        ),
      );
      return;
    }

    this.sentEl.className = 'sent';
    if (!this.live && st.pressCount === 0) {
      this.sentEl.appendChild(h('span', { class: 'quiet' }, '点「开始」，然后拍发'));
      return;
    }
    for (const k of st.attempt) {
      this.sentEl.appendChild(h('span', { class: `sym ${k}` }));
    }
    if (st.holding !== null) {
      // 按住的这一下：宽度跟着时长长，越过点划分界就变色
      const unit = st.unitMs;
      const w = Math.max(10, Math.min(3.4, st.holdingMs / unit) * 26);
      this.sentEl.appendChild(
        h('span', {
          class: `sym live${st.holding === 'dah' ? ' dah' : ''}`,
          style: { width: `${w.toFixed(0)}px` },
        }),
      );
    }
    if (st.attempt.length === 0 && st.holding === null && st.finished) {
      this.sentEl.appendChild(h('span', { class: 'quiet' }, '发完了'));
    }
  }

  /** 整条报文：分词显示，颜色跟着进度走。 */
  private renderMessage(st: PracticeState): void {
    clear(this.messageEl);
    for (let i = 0; i < st.target.length; i++) {
      const t = st.target[i]!;
      const first = i === 0 || st.target[i - 1]!.groupIndex !== t.groupIndex;
      if (first && i > 0) this.messageEl.appendChild(h('span', { class: 'gap' }, ' '));
      const cls = `${i < st.cursor ? 'ok' : i === st.cursor ? 'now' : 'todo'}${t.isNew ? ' new' : ''}`;
      this.messageEl.appendChild(h('span', { class: cls }, displayChar(t.ch)));
    }
  }
}

/** 显示用的字符。 */
export function displayChar(ch: string): string {
  if (ch === ' ') return '␠';
  return ch;
}

/** 成绩单。 */
function showResult(app: App, score: SessionScore): void {
  const root = document.getElementById('modal-root');
  if (!root) return;
  const accuracy = score.accuracy;
  const grade = accuracy >= 0.98 ? '全对' : accuracy >= 0.9 ? '不错' : accuracy >= 0.75 ? '继续' : '再练';
  const gradeClass = accuracy >= 0.9 ? 'good' : accuracy >= 0.75 ? 'warn' : 'bad';

  const diff = h('div', { class: 'diff-line' });
  for (const c of score.chars) {
    if (c.verdict === 'correct') diff.appendChild(h('span', { class: 'ok' }, displayChar(c.actual ?? '')));
    else diff.appendChild(h('span', { class: 'miss' }, displayChar(c.target ?? '')));
  }

  const close = () => modal.remove();
  const retry = () => app.go('practice');
  const next = () => {
    app.itemIndex = (app.itemIndex + 1) % app.items.length;
    app.saveSettings({ lastItemIndex: app.itemIndex });
    app.go('practice');
  };

  const modal = h(
    'div',
    { class: 'modal-backdrop', onclick: (e: MouseEvent) => { if (e.target === e.currentTarget) close(); } },
    h(
      'div',
      { class: 'modal' },
      h('h2', {}, `${app.lesson.title} · 第 ${app.itemIndex + 1} 条`),
      h(
        'div',
        { class: 'row', style: { alignItems: 'baseline', gap: '16px' } },
        h('div', { class: `big-score ${gradeClass}` }, `${(accuracy * 100).toFixed(0)}%`),
        h('div', { class: `dim ${gradeClass}` }, grade),
      ),
      diff,
      h(
        'div',
        { class: 'row dim', style: { fontSize: '12px', gap: '16px', fontFamily: 'var(--mono)' } },
        h('span', {}, `对 ${score.correct}`),
        h('span', {}, `拍错 ${score.wrong} 次`),
        h('span', {}, `漏 ${score.missing}`),
        h('span', {}, `点 ${fmtMs(score.timing.dit)}`),
        h('span', {}, `划 ${fmtMs(score.timing.dah)}`),
        h('span', {}, `节奏 ${score.timing.rhythm}`),
      ),
      h(
        'div',
        { class: 'row', style: { marginTop: '20px' } },
        h('button', { class: 'btn primary', onclick: () => { close(); retry(); } }, '再拍一次'),
        h('button', { class: 'btn', onclick: () => { close(); next(); } }, '下一条'),
        h('button', { class: 'btn ghost', onclick: () => close() }, '关闭'),
      ),
    ),
  );
  root.appendChild(modal);
}
