/**
 * 练习视图：逐字练习的主界面。
 *
 * 布局（自上而下）：
 *  1) 键盘区（把鼠标当手键用；可解除武装以免误触）
 *  2) 当前条目的中文含义 / 提示
 *  3) 目标文本：每个字上面显示它的摩尔斯码，发对了变绿、发错了变红
 *  4) 抄收区：你实际发出来的内容 + 当前未定稿的候选
 *  5) 实时指标：速度、节奏、点长、准确率、置信度
 *  6) 诊断面板（可选）：每一次按下的毫秒数、判成点还是划、间隔是多少单位
 */

import type { App } from '../App.ts';
import { mergeScore, masteredChars } from '../core/settings.ts';
import type { PracticeSession, SessionSnapshot } from '../core/session.ts';
import type { KeyEdge } from './input.ts';
import { KeyInput } from './input.ts';
import { clear, fmtMs, h, morseBlocks, toast } from './dom.ts';

const THROTTLE_MS = 60;

export class PracticeView {
  private app: App;
  private session: PracticeSession;
  private input: KeyInput | null = null;
  private lastRender = 0;
  private pendingSnapshot: SessionSnapshot | null = null;
  private raf = 0;

  private keypadEl!: HTMLElement;
  private glossEl!: HTMLElement;
  private targetEl!: HTMLElement;
  private copyEl!: HTMLElement;
  private candEl!: HTMLElement;
  private pulseEl!: HTMLElement;
  private diagEl!: HTMLElement;
  private armedEl!: HTMLElement;
  private meterEls: Record<string, HTMLElement> = {};
  private armed = false;
  private lastSymbolCount = 0;
  private unsub: Array<() => void> = [];
  private finished = false;

  constructor(app: App) {
    this.app = app;
    this.session = app.startSession(app.itemIndex);
  }

  render(root: HTMLElement): void {
    const s = this.session;
    const item = this.app.currentItem;

    this.keypadEl = h(
      'div',
      { class: 'keypad', id: 'keypad' },
      h(
        'div',
        { class: 'hint' },
        h('div', {}, '把鼠标移到这个区域，点一下「武装手键」，然后像拍直键一样点击。'),
        h(
          'div',
          {},
          '快捷键：',
          h('kbd', {}, '空格'),
          ' / ',
          h('kbd', {}, 'J'),
          ' / ',
          h('kbd', {}, 'K'),
          ' / ',
          h('kbd', {}, '回车'),
          ' 也可以当直键　·　',
          h('kbd', {}, 'Esc'),
          ' 武装 / 解除　·　',
          h('kbd', {}, 'R'),
          ' 听参考发送　·　',
          h('kbd', {}, 'N'),
          ' 下一条',
        ),
      ),
    );

    this.armedEl = h('span', { class: 'armed-indicator off' }, h('i', { class: 'lamp' }), '未武装');

    const toolbar = h(
      'div',
      { class: 'row', style: { marginBottom: '10px' } },
      this.armedEl,
      h('button', { class: 'btn primary', onclick: () => this.toggleArm() }, '武装手键'),
      h('button', { class: 'btn', onclick: () => this.replayReference() }, '听参考发送（R）'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => this.restartItem() }, '重做本条目'),
      h('button', { class: 'btn', onclick: () => this.nextItem() }, '下一条（N）'),
      h('button', { class: 'btn ghost', onclick: () => this.finish() }, '结算'),
    );

    this.glossEl = h('div', { class: 'gloss' });
    this.targetEl = h('div', { class: 'target' });
    this.copyEl = h('div', { class: 'copyline' });
    this.candEl = h('div', { class: 'candidates' });
    this.pulseEl = h('div', { class: 'pulse-dur' });

    const meters = h('div', { class: 'timing-row' });
    for (const [key, label] of [
      ['wpm', '当前速度'],
      ['accuracy', '字符准确率'],
      ['rhythm', '节奏稳定度'],
      ['dit', '点长 (dit)'],
      ['dah', '划长 (dah)'],
      ['conf', '最近码元置信度'],
    ] as const) {
      const v = h('div', { class: 'v' }, '--');
      this.meterEls[key] = v;
      meters.appendChild(h('div', { class: 'meter' }, h('div', { class: 'k' }, label), v));
    }

    this.diagEl = h('div', { class: 'diag' });

    const head = h(
      'div',
      { class: 'status-strip' },
      h('span', { class: 'pill' }, `${this.app.lesson.title}`),
      h('span', { class: 'pill' }, `第 ${this.app.itemIndex + 1} / ${this.app.items.length} 条`),
      h('span', { class: 'pill' }, `起始 ${this.app.settings.wpm} WPM`),
      h('span', { class: 'pill' }, `呼号 ${this.app.settings.callsign}`),
    );

    root.appendChild(head);
    root.appendChild(this.keypadEl);
    root.appendChild(toolbar);
    root.appendChild(this.glossEl);
    root.appendChild(h('div', { class: 'card' }, h('h2', {}, '目标报文 · 逐字提示'), this.targetEl));
    root.appendChild(
      h(
        'div',
        { class: 'card' },
        h('h2', {}, '抄收区 · 你实际发出来的内容'),
        this.copyEl,
        this.candEl,
        h('div', { class: 'row', style: { marginTop: '10px' } }, this.pulseEl),
      ),
    );
    root.appendChild(h('div', { class: 'card' }, h('h2', {}, '实时指标'), meters));
    root.appendChild(
      h(
        'div',
        { class: 'card' },
        h('h2', {}, '按键诊断（每一次按下的毫秒数 / 判定）'),
        this.diagEl,
      ),
    );

    this.syncGloss(item);
    this.attachInput();
    this.unsub.push(s.onUpdate((snap) => this.queueRender(snap)));
    this.renderSnapshot(s.snapshot());

    // rAF 驱动“停顿定稿”：没有新按键超过阈值就认为当前字符发完了。
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.session.tick();
      if (this.pendingSnapshot) {
        const now = performance.now();
        if (now - this.lastRender >= THROTTLE_MS) this.renderSnapshot(this.pendingSnapshot);
      }
    };
    this.raf = requestAnimationFrame(loop);

    this.unsub.push(
      this.app.onKey((ev) => {
        if (ev.code === 'Escape') {
          this.toggleArm();
          return true;
        }
        if (ev.code === 'KeyR' && !this.armed) {
          this.replayReference();
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
    this.session.dispose();
    this.app.audio.silence();
    this.app.audio.stopPlayback();
  }

  // ---------- 交互 ----------

  private attachInput(): void {
    this.input = new KeyInput(this.keypadEl, {
      debounceMs: 0,
      adaptiveFilter: true,
      allowMouseLeft: this.app.settings.allowMouseLeft,
      allowRightButton: this.app.settings.allowRightButton,
      allowKeyboard: this.app.settings.allowKeyboard,
      isArmed: () => this.armed,
      onDown: (down) => {
        if (!this.armed) return;
        this.app.audio.keyDown();
        this.keypadEl.classList.add('keying');
        this.pulseEl.textContent = '…';
        this.pulseEl.className = 'pulse-dur';
        void down;
      },
      onUp: (edge) => this.handleEdge(edge),
      onIgnored: (edge) => {
        if (edge.ignoreReason) {
          this.addDiagLine(edge, '误触');
        }
      },
    });
  }

  private handleEdge(edge: KeyEdge): void {
    this.app.audio.keyUp();
    this.keypadEl.classList.remove('keying');
    if (!this.armed) return;
    if (edge.ignored) {
      this.addDiagLine(edge, edge.ignoreReason ?? '已忽略');
      return;
    }
    this.session.submitPress(edge.down, edge.up);
    this.renderPulseFromSession();
  }

  private toggleArm(): void {
    this.armed = !this.armed;
    this.input?.setArmed(this.armed);
    this.armedEl.className = `armed-indicator ${this.armed ? 'on' : 'off'}`;
    clear(this.armedEl);
    this.armedEl.appendChild(h('i', { class: 'lamp' }));
    this.armedEl.appendChild(document.createTextNode(this.armed ? '手键已武装 · 开始拍发' : '未武装'));
    this.keypadEl.classList.toggle('armed', this.armed);
    const btn = this.keypadEl.parentElement?.querySelector<HTMLButtonElement>('button.primary');
    if (btn) btn.textContent = this.armed ? '解除武装' : '武装手键';
    if (this.armed) {
      void this.app.audio.resume();
      this.session.setPaused(false);
      toast('已武装：现在点击就是拍发，Esc 可解除', 'good', 1800);
    } else {
      this.app.audio.silence();
    }
  }

  private restartItem(): void {
    const wasArmed = this.armed;
    this.session.dispose();
    this.session = this.app.startSession(this.app.itemIndex);
    this.session.onUpdate((snap) => this.queueRender(snap));
    this.lastSymbolCount = 0;
    this.finished = false;
    clear(this.diagEl);
    if (wasArmed) {
      this.armed = false;
      this.toggleArm();
    }
    this.renderSnapshot(this.session.snapshot());
  }

  private nextItem(): void {
    const items = this.app.items;
    const next = (this.app.itemIndex + 1) % items.length;
    this.app.saveSettings({ lastItemIndex: next });
    this.app.itemIndex = next;
    this.session.dispose();
    this.session = this.app.startSession(next);
    this.session.onUpdate((snap) => this.queueRender(snap));
    this.lastSymbolCount = 0;
    this.finished = false;
    clear(this.diagEl);
    this.syncGloss(this.app.currentItem);
    if (this.armed) {
      this.armed = false;
      this.toggleArm();
    }
    this.renderSnapshot(this.session.snapshot());
    toast(`第 ${next + 1} 条：${this.app.currentItem.text}`, 'info', 1600);
  }

  private async replayReference(): Promise<void> {
    const text = this.app.currentItem.text;
    toast(`参考发送：${text}`, 'info', 1500);
    await this.app.audio.playText(text, this.app.settings.wpm);
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.session.flushPause();
    const score = this.session.finalize();
    const perChar = score.chars
      .filter((c) => c.target)
      .map((c) => ({ ch: c.target!, correct: c.verdict === 'correct' }));
    this.app.saveProgress(
      mergeScore(this.app.progress, this.app.lesson.id, score.accuracy, score.elapsed, score.pressCount, perChar),
    );
    const post = this.session.postScore();
    showResult(this.app, score, post);
  }

  // ---------- 渲染 ----------

  private queueRender(snap: SessionSnapshot): void {
    this.pendingSnapshot = snap;
    const now = performance.now();
    if (now - this.lastRender >= THROTTLE_MS) this.renderSnapshot(snap);
  }

  private renderSnapshot(snap: SessionSnapshot): void {
    this.pendingSnapshot = null;
    this.lastRender = performance.now();
    this.renderTarget(snap);
    this.renderCopy(snap);
    this.renderMeters(snap);
    this.appendNewDiagnostics(snap);
  }

  private syncGloss(item: { text: string; gloss?: string; note?: string }): void {
    clear(this.glossEl);
    this.glossEl.appendChild(document.createTextNode(item.gloss ?? item.text));
    if (item.note) this.glossEl.appendChild(h('span', { class: 'note' }, `※ ${item.note}`));
  }

  private renderTarget(snap: SessionSnapshot): void {
    clear(this.targetEl);
    const mastered = masteredChars(this.app.progress);
    // 目标下标 → 实际发出的字符。
    // 注意：还没落账（id === null）的字符在这里画成"待定"，不判对错 ——
    // 它随时可能被后面的按键改写，过早判错会让新手以为自己发错了。
    const actualByTarget = new Map<number, { actual: string | null; verdict: string; settled: boolean }>();
    let ti = 0;
    for (const s of snap.scores) {
      if (s.verdict === 'extra') {
        actualByTarget.set(ti, { actual: s.actual, verdict: 'extra', settled: s.id !== null });
        continue;
      }
      actualByTarget.set(ti, {
        actual: s.actual,
        verdict: s.verdict,
        settled: s.id !== null || s.verdict === 'missing',
      });
      ti++;
    }
    for (let i = 0; i < snap.target.length; i++) {
      const t = snap.target[i]!;
      const info = actualByTarget.get(i);
      const cls = ['tchar'];
      if (info && info.settled && info.verdict === 'correct') cls.push('correct', 'done');
      else if (info && info.settled && info.verdict === 'wrong') cls.push('wrong', 'done');
      else if (info && info.settled && info.verdict === 'extra') cls.push('wrong');
      else if (info && info.actual !== null) cls.push('pending');
      if (i === snap.cursor) cls.push('current');
      if (!t.isNew && mastered.has(t.ch)) cls.push('known');
      const cell = h(
        'div',
        { class: cls.join(' '), dataset: { idx: String(i) } },
        h('div', { class: 'ch' }, displayChar(t.ch)),
        h('div', { class: 'blocks' }, morseBlocks(t.pattern)),
      );
      if (info && info.settled && info.verdict === 'wrong') {
        cell.appendChild(h('span', { class: 'badge' }, `发成 ${displayChar(info.actual ?? '?')}`));
      } else if (info && !info.settled && info.actual !== null) {
        cell.appendChild(h('span', { class: 'badge' }, '待定'));
      } else if (i === snap.cursor) {
        cell.appendChild(h('span', { class: 'badge' }, '当前'));
      }
      this.targetEl.appendChild(cell);
    }
  }

  private renderCopy(snap: SessionSnapshot): void {
    clear(this.copyEl);
    // 已落账的字符按下标画（带对错颜色）；id === null 的还没落账，单独用斜体画在后面。
    for (const s of snap.scores) {
      if (s.verdict === 'missing' || s.id === null) continue;
      const cls = s.verdict === 'correct' ? 'correct' : s.verdict === 'wrong' ? 'wrong' : 'extra';
      this.copyEl.appendChild(h('span', { class: `c ${cls}` }, displayChar(s.actual ?? '?')));
    }
    for (const p of snap.pending) {
      this.copyEl.appendChild(h('span', { class: 'c pending' }, displayChar(p.text)));
    }
    this.copyEl.appendChild(h('span', { class: 'caret' }));

    clear(this.candEl);
    if (snap.pending.length > 0) {
      this.candEl.appendChild(document.createTextNode('未落定（还会被后续按键修正）：'));
      this.candEl.appendChild(h('b', {}, snap.pending.map((p) => displayChar(p.text)).join('')));
      if (snap.summary.wrong + snap.summary.missing > 0) {
        this.candEl.appendChild(
          h('span', { class: 'dim' }, `　目前统计：对 ${snap.summary.correct} / 错 ${snap.summary.wrong} / 漏 ${snap.summary.missing}`),
        );
      }
    } else if (snap.pending.length === 0 && snap.committed.length > 0 && snap.summary.accuracy === 1) {
      this.candEl.appendChild(h('span', { class: 'good' }, '这一条全对，可以按「结算」看成绩，或按 N 进入下一条。'));
    } else if (snap.revision) {
      this.candEl.appendChild(
        h(
          'span',
          {},
          `已回改前面第 ${snap.revision.id} 个字符：${displayChar(snap.revision.from)} → ${displayChar(snap.revision.to)}`,
        ),
      );
    }
  }

  private renderMeters(snap: SessionSnapshot): void {
    const t = snap.timing;
    setMeter(this.meterEls['wpm']!, `${t.wpm.toFixed(1)}`, 'WPM');
    setMeter(this.meterEls['accuracy']!, `${(snap.summary.accuracy * 100).toFixed(0)}%`, `${snap.summary.correct}/${snap.target.length}`);
    setMeter(this.meterEls['rhythm']!, `${t.rhythmScore}`, '/100');
    setMeter(this.meterEls['dit']!, fmtMs(t.dit), `n=${t.nDit}`);
    setMeter(this.meterEls['dah']!, fmtMs(t.dah), `n=${t.nDah}`);
    const last = snap.lastSymbol;
    if (last) {
      setMeter(this.meterEls['conf']!, `${(last.confidence * 100).toFixed(0)}%`, last.kind === 'dit' ? '点' : '划');
    } else {
      setMeter(this.meterEls['conf']!, '--', '');
    }
    this.renderPulseFromSession();
  }

  private renderPulseFromSession(): void {
    const symbols = this.session.allSymbols;
    const last = symbols[symbols.length - 1];
    if (!last) {
      this.pulseEl.className = 'pulse-dur';
      this.pulseEl.textContent = '';
      return;
    }
    this.pulseEl.className = `pulse-dur ${last.kind}`;
    clear(this.pulseEl);
    this.pulseEl.appendChild(document.createTextNode(`${Math.round(last.press.duration)}ms`));
    this.pulseEl.appendChild(
      h(
        'small',
        {},
        `${last.kind === 'dit' ? '判为「点」' : '判为「划」'}　置信度 ${(last.confidence * 100).toFixed(0)}%　间隔 ${
          last.gapUnits === null ? '—' : last.gapUnits.toFixed(1) + ' 单位'
        }`,
      ),
    );
  }

  private appendNewDiagnostics(snap: SessionSnapshot): void {
    const symbols = this.session.allSymbols;
    if (this.diagEl.childElementCount === 0) {
      this.diagEl.appendChild(
        h(
          'div',
          { class: 'dline head' },
          h('span', {}, '#'),
          h('span', {}, '时长'),
          h('span', {}, '判定'),
          h('span', {}, '间隔'),
          h('span', {}, '说明'),
        ),
      );
    }
    for (let i = this.lastSymbolCount; i < symbols.length; i++) {
      const s = symbols[i]!;
      this.diagEl.appendChild(
        h(
          'div',
          { class: 'dline' },
          h('span', {}, String(i + 1)),
          h('span', {}, `${Math.round(s.press.duration)}ms`),
          h('span', { class: s.kind }, s.kind === 'dit' ? '点' : '划'),
          h('span', {}, s.gapUnits === null ? '—' : `${s.gapUnits.toFixed(1)}u`),
          h(
            'span',
            { class: 'dim' },
            `p(点)=${pct(s.costDit)} / p(划)=${pct(s.costDah)}　置信 ${(s.confidence * 100).toFixed(0)}%`,
          ),
        ),
      );
    }
    this.lastSymbolCount = symbols.length;
    void snap;
    this.diagEl.scrollTop = this.diagEl.scrollHeight;
  }

  private addDiagLine(edge: KeyEdge, reason: string): void {
    this.diagEl.appendChild(
      h(
        'div',
        { class: 'dline' },
        h('span', {}, '×'),
        h('span', {}, `${Math.round(edge.duration)}ms`),
        h('span', { class: 'warn' }, '忽略'),
        h('span', {}, '—'),
        h('span', { class: 'warn' }, reason),
      ),
    );
  }
}

/** 显示用的字符（把 prosign 之类的特殊键变得可读）。 */
export function displayChar(ch: string): string {
  if (ch === ' ') return '␠';
  return ch;
}

function setMeter(el: HTMLElement, value: string, sub = ''): void {
  clear(el);
  el.appendChild(document.createTextNode(value));
  if (sub) el.appendChild(h('small', {}, sub));
}

function pct(cost: number): string {
  if (!Number.isFinite(cost)) return '∞';
  return cost.toFixed(2);
}

/**
 * 结算弹窗：字符准确率、逐字差异、节奏评分、易错对，
 * 以及一次“全局复核”的结果（把前面判断错的字修回来）。
 */
function showResult(
  app: App,
  score: ReturnType<PracticeSession['finalize']>,
  post: { text: string; confidence: number; candidates: Array<{ text: string; probability: number }> },
): void {
  const root = document.getElementById('modal-root');
  if (!root) return;
  const accuracy = score.accuracy;
  const grade = accuracy >= 0.98 ? '完美' : accuracy >= 0.9 ? '很好' : accuracy >= 0.75 ? '还行' : '再练练';
  const gradeClass = accuracy >= 0.9 ? 'good' : accuracy >= 0.75 ? 'warn' : 'bad';

  const diff = h('div', { class: 'diff-line' });
  for (const c of score.chars) {
    if (c.verdict === 'correct') diff.appendChild(h('span', { class: 'ok' }, displayChar(c.actual ?? '')));
    else if (c.verdict === 'wrong') diff.appendChild(h('span', { class: 'err' }, displayChar(c.actual ?? '?')));
    else if (c.verdict === 'missing') diff.appendChild(h('span', { class: 'miss' }, displayChar(c.target ?? '')));
    else diff.appendChild(h('span', { class: 'ex' }, displayChar(c.actual ?? '?')));
  }

  const modal = h(
    'div',
    { class: 'modal-backdrop', onclick: (e: MouseEvent) => { if (e.target === e.currentTarget) close(); } },
    h(
      'div',
      { class: 'modal' },
      h('h2', {}, `${app.lesson.title} · 第 ${app.itemIndex + 1} 条结算`),
      h('div', { class: 'row' }, h('div', { class: `big-score ${gradeClass}` }, `${(accuracy * 100).toFixed(1)}%`), h('div', { class: 'dim' }, grade)),
      h('div', { class: 'row dim', style: { fontSize: '12px', gap: '16px' } },
        h('span', {}, `对 ${score.correct}`),
        h('span', {}, `错 ${score.wrong}`),
        h('span', {}, `漏 ${score.missing}`),
        h('span', {}, `多 ${score.extra}`),
        h('span', {}, `按键 ${score.pressCount}`),
        h('span', {}, `用时 ${(score.elapsed / 1000).toFixed(1)}s`),
      ),
      h('h3', { style: { color: 'var(--fg-dim)', fontSize: '12px' } }, '逐字差异（绿=对，红=错，下划线=漏，黄=多）'),
      diff,
      h('h3', { style: { color: 'var(--fg-dim)', fontSize: '12px' } }, '节奏与速度'),
      h('div', { class: 'row', style: { gap: '18px', fontSize: '13px' } },
        h('span', {}, `点长 ${fmtMs(score.timing.dit)}（±${(score.timing.cvDit * 100).toFixed(0)}%）`),
        h('span', {}, `划长 ${fmtMs(score.timing.dah)}（±${(score.timing.cvDah * 100).toFixed(0)}%）`),
        h('span', {}, `速度 ${score.timing.wpm.toFixed(1)} WPM`),
        h('span', { class: score.timing.rhythmScore >= 70 ? 'good' : 'warn' }, `节奏 ${score.timing.rhythmScore}/100`),
      ),
      h('h3', { style: { color: 'var(--fg-dim)', fontSize: '12px' } }, '全局复核（把整段重新解一遍，可能修正前面判错的字）'),
      h('div', { class: 'row', style: { fontSize: '14px' } },
        h('span', {}, '复核结果：'),
        h('b', { class: 'warn' }, post.text || '（无）'),
        h('span', { class: 'dim' }, `置信度 ${(post.confidence * 100).toFixed(0)}%`),
        post.candidates.length > 1 ? h('span', { class: 'dim' }, `　次优：${post.candidates[1]!.text} ${(post.candidates[1]!.probability * 100).toFixed(0)}%`) : null,
      ),
      score.confusion.length
        ? h(
            'div',
            {},
            h('h3', { style: { color: 'var(--fg-dim)', fontSize: '12px' } }, '易错对'),
            h(
              'div',
              { class: 'row', style: { fontSize: '13px', gap: '14px' } },
              ...score.confusion.slice(0, 8).map((c) =>
                h('span', {}, `${c.target} → ${c.actual ?? '（漏）'} ×${c.count}`),
              ),
            ),
          )
        : null,
      h(
        'div',
        { class: 'row', style: { marginTop: '18px' } },
        h('button', { class: 'btn primary', onclick: () => { close(); retry(); } }, '重做这一条'),
        h('button', { class: 'btn', onclick: () => { close(); next(); } }, '下一条'),
        h('button', { class: 'btn ghost', onclick: () => close() }, '关闭'),
      ),
    ),
  );

  const close = () => modal.remove();
  const retry = () => {
    app.go('practice');
  };
  const next = () => {
    const idx = (app.itemIndex + 1) % app.items.length;
    app.itemIndex = idx;
    app.saveSettings({ lastItemIndex: idx });
    app.go('practice');
  };

  root.appendChild(modal);
}
