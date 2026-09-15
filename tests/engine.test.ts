/**
 * 逐字练习引擎的行为规格。
 *
 * 判定逻辑只有 practice.ts 一份，改动判定行为必须先改这里。
 *
 * 零依赖：node:test + node:assert，用 Node 原生类型剥离直接跑：
 *   node --experimental-strip-types tests/engine.test.ts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { PracticeEngine, THRESHOLDS, readAttempt, readSpeed, type AttemptSymbol } from '../src/core/practice.ts';
import { ALL_CHAR_TO_PATTERN } from '../src/core/morse.ts';

/**
 * 一次拍发：按真实节奏把按下/抬起喂给引擎。
 *
 * 字与字之间会真的推进时钟并调用 tick，因为字的边界完全由停顿决定。
 */
class Session {
  readonly engine: PracticeEngine;
  /** 当前点长 ms。中途改它是为了模拟“练着练着手速变了”。 */
  dit: number;
  private t: number;

  constructor(text: string, dit = 100, wpm = 12) {
    this.engine = new PracticeEngine({ text, wpm });
    this.engine.start(1000);
    this.dit = dit;
    this.t = 1000;
  }

  /** 静音若干毫秒：推进时钟，然后让引擎看一眼。 */
  private advance(ms: number): void {
    const step = 20;
    for (let left = ms; left > 0; left -= step) {
      this.t += Math.min(step, left);
      this.engine.tick(this.t);
    }
  }

  symbol(kind: 'dit' | 'dah', dahRatio = 3): this {
    const start = this.t;
    const dur = (kind === 'dit' ? 1 : dahRatio) * this.dit;
    this.engine.press(start, start + dur);
    this.t = start + dur;
    return this;
  }

  /** 拍一个字的全部码元。symbolGap 是码元间隔（单位数，标准 1）。 */
  char(ch: string, symbolGap = 1, dahRatio = 3): this {
    const pattern = ALL_CHAR_TO_PATTERN[ch];
    assert.ok(pattern, `没有 ${ch} 的码形`);
    for (let i = 0; i < pattern.length; i++) {
      if (i > 0) this.advance(this.dit * symbolGap);
      this.symbol(pattern[i] === '.' ? 'dit' : 'dah', dahRatio);
    }
    return this;
  }

  /** 停顿若干单位（字间隔 3、词间隔 7）。 */
  gap(units: number): this {
    this.advance(this.dit * units);
    return this;
  }

  /** 拍一整段文本。 */
  text(str: string, symbolGap = 1): this {
    const words = str.trim().toUpperCase().split(/\s+/);
    for (let w = 0; w < words.length; w++) {
      const chars = [...words[w]!];
      for (let i = 0; i < chars.length; i++) {
        this.char(chars[i]!, symbolGap);
        if (i < chars.length - 1) this.gap(3);
      }
      if (w < words.length - 1) this.gap(7);
    }
    return this;
  }

  /** 收尾（停顿够久），看结果。 */
  settle(units = 4): { cursor: number; wrong: number } {
    this.gap(units);
    const st = this.engine.state;
    return { cursor: st.cursor, wrong: this.engine.wrongCount };
  }
}

/** 直接构造一次尝试，用来单独测读码。 */
function attempt(dit: number, spec: Array<[string, number | null]>): AttemptSymbol[] {
  return spec.map(([kind, gap]) => ({ duration: (kind === 'dit' ? 1 : 3) * dit, gapBefore: gap === null ? null : gap * dit }));
}

/* ============================ 读码 ============================ */

test('读一次尝试：点划判定跟着这次尝试自己的时长走', () => {
  // 目标速度未知时，先验是 100ms，但实际点长只有 50ms
  const fast = readAttempt(attempt(50, [['dah', null], ['dit', 1.5], ['dah', 1.5], ['dit', 1.5]]), 100);
  assert.equal(fast.pattern, '-.-.');
  assert.equal(fast.text, 'C');
  assert.ok(Math.abs(fast.unitMs - 50) < 12, `单位估计应接近 50，实际 ${fast.unitMs}`);

  const slow = readAttempt(attempt(250, [['dah', null], ['dit', 1.5], ['dah', 1.5], ['dit', 1.5]]), 100);
  assert.equal(slow.text, 'C');
  assert.ok(Math.abs(slow.unitMs - 250) < 60, `单位估计应接近 250，实际 ${slow.unitMs}`);
});

test('码元间隔不断字，字间隔才断字', () => {
  const one = readAttempt(attempt(100, [['dah', null], ['dit', 1], ['dit', 1]]), 100);
  assert.equal(one.single, true);
  assert.equal(one.text, 'D');

  const two = readAttempt(attempt(100, [['dah', null], ['dit', 3], ['dit', 1]]), 100);
  assert.equal(two.single, false);
  assert.deepEqual(two.segments, ['T', 'I']);
  assert.equal(two.heard, 'TI');
});

test('读不出的码形不当成字', () => {
  const r = readAttempt(attempt(100, [['dit', null], ['dit', 1], ['dah', 1], ['dah', 1]]), 100);
  assert.equal(r.text, undefined);
  assert.equal(r.recognized, false);
  assert.equal(r.heard, '?');
});

test('校准台的速度读数：至少三下才给结果', () => {
  assert.equal(readSpeed([100, 100]), null);
  const s = readSpeed([100, 110, 90, 300, 310, 290]);
  assert.ok(s);
  assert.ok(Math.abs(s!.dit - 100) < 20, `点长应接近 100，实际 ${s!.dit}`);
  assert.ok(Math.abs(s!.dah - 300) < 20, `划长应接近 300，实际 ${s!.dah}`);
});

/* ============================ 基本收发 ============================ */

test('拍一个点，目标是 E —— 收下', () => {
  const s = new Session('E');
  s.char('E');
  const r = s.settle();
  assert.equal(r.cursor, 1);
  assert.equal(r.wrong, 0);
  assert.ok(s.engine.finished);
});

test('目标是 CQ，逐字拍完 —— 全对', () => {
  const s = new Session('CQ');
  s.text('CQ');
  const r = s.settle();
  assert.equal(r.cursor, 2, `应全部收下，实际 ${r.cursor}`);
  assert.equal(r.wrong, 0);
});

test('目标是 CQ DE，词与词之间的空档也能读下来', () => {
  const s = new Session('CQ DE');
  s.text('CQ DE');
  const r = s.settle();
  assert.equal(r.cursor, 4, `应读下 4 个字，实际 ${r.cursor}`);
  assert.equal(r.wrong, 0);
});

test('目标文本里的空格只用来分词，不算字', () => {
  const engine = new PracticeEngine({ text: 'CQ DE' });
  assert.deepEqual(engine.target.map((t) => t.ch), ['C', 'Q', 'D', 'E']);
  assert.deepEqual(engine.target.map((t) => t.groupIndex), [0, 0, 1, 1]);
});

/* ============ 用户反馈过的 bug：字没发完就判错 ============ */

test('字没发完不能判错：码元之间的小停顿只是继续拼字', () => {
  // Q = --.- ，一拍一顿，每两下之间停 1.2 个单位
  const s = new Session('Q');
  s.char('Q', 1.2);
  const r = s.settle();
  assert.equal(r.wrong, 0, '字还在发，不该判错');
  assert.equal(r.cursor, 1, 'Q 发完应被收下');
});

test('发慢一点（码元间隔 1.5 个单位）也不会被切断', () => {
  const s = new Session('PARIS', 110);
  s.text('PARIS', 1.5);
  const r = s.settle();
  assert.equal(r.wrong, 0, '慢发不该判错');
  assert.equal(r.cursor, 5, `应读下 5 个字，实际 ${r.cursor}`);
});

test('发到的还是目标字的前缀时保持沉默', () => {
  const s = new Session('A'); // A = .-
  s.char('E'); // 只发了一个点
  s.gap(2); // 停 2 个单位，还没到字间隔
  assert.equal(s.engine.wrongCount, 0, '点在 A 里是合法前缀，不该判错');
  assert.equal(s.engine.state.cursor, 0, '也不该收下');
  s.char('T'); // 补上那一划
  const r = s.settle();
  assert.equal(r.cursor, 1, '补齐后应被收下');
  assert.equal(r.wrong, 0);
});

/* ============================ 拍错与重拍 ============================ */

test('拍错字：负反馈、光标不动、重拍后能继续', () => {
  const s = new Session('E');
  s.char('T'); // 目标 E，却拍了一个划
  s.gap(4);
  const st = s.engine.state;
  assert.equal(s.engine.wrongCount, 1, '应记一次拍错');
  assert.equal(st.cursor, 0, '拍错不前进');
  assert.ok(st.confused);
  assert.equal(st.confused!.heard, 'T', '对方听到的是 T');
  assert.equal(st.confused!.recognized, true);

  s.char('E'); // 重拍
  const r = s.settle();
  assert.equal(r.cursor, 1, '重拍正确后应前进');
  assert.equal(r.wrong, 1, '拍错的历史保留，用于成绩单');
});

test('拍错时丢掉这次尝试，重拍从头来', () => {
  const s = new Session('C');
  s.char('E'); // 只发了一个点，然后停够久
  s.gap(4);
  assert.equal(s.engine.wrongCount, 1);
  assert.equal(s.engine.state.attempt.length, 0, '尝试应当被清空');
  s.char('C');
  const r = s.settle();
  assert.equal(r.cursor, 1);
});

test('字中间停太久，对方就听成了两个字', () => {
  const s = new Session('C'); // -.-.
  s.char('N', 1); // -. 然后长停
  s.gap(3);
  const st = s.engine.state;
  assert.equal(s.engine.wrongCount, 1, '停成两个字母，目标 C 不认');
  assert.equal(st.confused!.heard, 'N');
});

test('第二个字拍错，第一个字不会被牵连', () => {
  const s = new Session('CQ');
  s.char('C');
  s.gap(3);
  s.char('T'); // 第二个字拍成 T
  const r = s.settle();
  assert.equal(r.cursor, 1, 'C 应该被收下');
  assert.equal(r.wrong, 1, 'T 不是 Q，记一次错');
  assert.ok(s.engine.state.confused);
});

/* ============================ 自适应 ============================ */

test('不同手速都能跟上（点长 50~250ms）', () => {
  for (const dit of [50, 80, 130, 180, 250]) {
    const s = new Session('CQ DE', dit);
    s.text('CQ DE', 1.5); // 码元间隔也偏大
    const r = s.settle();
    assert.equal(r.cursor, 4, `点长 ${dit}ms 时应读下 4 个字，实际 ${r.cursor}`);
    assert.equal(r.wrong, 0, `点长 ${dit}ms 时不该判错`);
  }
});

test('手速在练习中途变化也能跟上', () => {
  const s = new Session('PARIS', 60);
  s.char('P');
  s.gap(3);
  s.dit = 100; // 放慢
  s.text('ARIS');
  const r = s.settle();
  assert.equal(r.cursor, 5, `中途改手速应照样读下，实际 ${r.cursor}`);
  assert.equal(r.wrong, 0);
});

test('点划比例不标准（划是点的 4 倍）也能读对', () => {
  const s = new Session('Q');
  s.char('Q', 1.3, 4);
  const r = s.settle();
  assert.equal(r.wrong, 0, '比例不标准也不该判错');
  assert.equal(r.cursor, 1);
});

/* ============================ 边角情况 ============================ */

test('目标为空时立即结束', () => {
  const engine = new PracticeEngine({ text: '   ' });
  assert.equal(engine.finished, true);
  assert.equal(engine.expected, null);
});

test('码元数超过上限时判错，不会无限等下去', () => {
  const s = new Session('Q');
  for (let i = 0; i < 10; i++) s.char('E'); // 点一直连下去，中间没有字间隔
  s.settle();
  assert.ok(s.engine.wrongCount >= 1, '发了十个码元还成不了字，应判错');
});

test('成绩单记下拍错次数与用掉的时间', () => {
  const s = new Session('CQ');
  s.char('C');
  s.gap(3);
  s.char('T'); // 拍错一次
  s.gap(4);
  s.char('Q');
  s.gap(4);
  const score = s.engine.finalize(1 + 60_000);
  assert.equal(score.total, 2);
  assert.equal(score.correct, 2, '重拍对了就算对');
  assert.equal(score.wrong, 1);
  assert.equal(score.missing, 0);
  assert.equal(score.accuracy, 1);
  assert.ok(score.timing.dit >= THRESHOLDS.unitMin);
});

test('阈值只有一套：常量被锁住，改动会被提醒', () => {
  assert.equal(THRESHOLDS.symbolGapMax, 2.5);
  assert.equal(THRESHOLDS.maxSymbols, 8);
  assert.equal(THRESHOLDS.unitMin, 30);
  assert.equal(THRESHOLDS.unitMax, 400);
});
