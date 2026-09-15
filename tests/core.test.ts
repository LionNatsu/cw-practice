/**
 * 核心模块测试：码表、课程内容、设置与进度、引擎的整段收发。
 *
 * 判定逻辑本身的行为规格在 engine.test.ts，这里管外围。
 *
 * 零依赖：Node 自带的 node:test + node:assert，用原生类型剥离直接跑：
 *   node --experimental-strip-types tests/core.test.ts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ALL_CHAR_TO_PATTERN, PATTERN_TO_CHAR, textDurationMs, unsupportedChars } from '../src/core/morse.ts';
import { PracticeEngine, readSpeed, settleUnitFor } from '../src/core/practice.ts';
import { LESSONS, expandLesson } from '../src/core/lessons.ts';
import { DEFAULT_SETTINGS, EMPTY_PROGRESS, masteredChars, mergeScore, type ProgressState } from '../src/core/settings.ts';
import { feed, pressText } from './helpers.ts';

/* ============================ 码表 ============================ */

test('码表里每个码形都只由点和划组成，而且可以反查', () => {
  const chars = Object.keys(ALL_CHAR_TO_PATTERN);
  assert.ok(chars.length >= 36, `码表太小：只有 ${chars.length} 个字符`);
  for (const ch of chars) {
    const pattern = ALL_CHAR_TO_PATTERN[ch]!;
    assert.ok(/^[.-]+$/.test(pattern), `${ch} 的码形 ${pattern} 不合法`);
    assert.ok(pattern.length <= 7, `${ch} 的码形太长`);
  }
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') {
    const pattern = ALL_CHAR_TO_PATTERN[ch];
    assert.ok(pattern, `缺少 ${ch} 的码形`);
    assert.equal(PATTERN_TO_CHAR[pattern], ch, `${ch} 的码形反查不回来`);
  }
});

test('未知字符能被指出来', () => {
  assert.deepEqual(unsupportedChars('CQ DE'), []);
  assert.deepEqual(unsupportedChars('CQ 中文'), ['中', '文']);
});

test('文本时长按 PARIS 标准算', () => {
  // PARIS 是 43 个单位（不含词尾空档），12 WPM 时 4.3 秒
  assert.equal(textDurationMs('PARIS', 100), 4300);
  assert.equal(textDurationMs('PARIS', 200), 8600);
});

/* ============================ 课程内容 ============================ */

test('课程内容全部可以用码表发出来，且都带中文含义', () => {
  for (const lesson of LESSONS) {
    const items = expandLesson(lesson, 'BG1ABC');
    assert.ok(items.length > 0, `${lesson.id} 不该为空`);
    assert.ok(lesson.title.length > 0 && lesson.summary.length > 0, `${lesson.id} 缺少标题或说明`);
    for (const it of items) {
      assert.ok(it.gloss && it.gloss.length > 0, `${lesson.id} 的条目 "${it.text}" 缺少中文含义`);
      const bad = unsupportedChars(it.text);
      assert.deepEqual(bad, [], `${lesson.id} 的条目 "${it.text}" 含无法发送的字符 ${bad.join(',')}`);
      assert.ok(textDurationMs(it.text, 100) > 0);
    }
  }
});

test('课程里的呼号占位符会被替换', () => {
  const items = expandLesson(LESSONS[0]!, 'BD7XYZ');
  const text = items.map((i) => i.text).join(' ');
  assert.ok(!text.includes('{CALLSIGN}'), '占位符没有被替换');
});

/* ============================ 设置与进度 ============================ */

test('设置的默认值都能用', () => {
  assert.ok(DEFAULT_SETTINGS.wpm >= 4 && DEFAULT_SETTINGS.wpm <= 40);
  assert.ok(DEFAULT_SETTINGS.toneHz > 0);
  assert.ok(DEFAULT_SETTINGS.volume >= 0 && DEFAULT_SETTINGS.volume <= 1);
});

test('一次练习的结果会并入累计进度', () => {
  let progress: ProgressState = structuredClone(EMPTY_PROGRESS);
  progress = mergeScore(progress, 'l1-rhythm', 0.8, 30_000, 40, [
    { ch: 'E', correct: true },
    { ch: 'T', correct: false },
  ]);
  assert.equal(progress.lessons['l1-rhythm']?.attempts, 1);
  assert.equal(progress.lessons['l1-rhythm']?.bestAccuracy, 0.8);
  assert.equal(progress.chars['E']?.seen, 1);
  assert.equal(progress.chars['T']?.wrong, 1);
  assert.equal(progress.totalMs, 30_000);

  progress = mergeScore(progress, 'l1-rhythm', 0.5, 10_000, 20, []);
  assert.equal(progress.lessons['l1-rhythm']?.bestAccuracy, 0.8, '最差的一次不该拉低最好成绩');
  assert.equal(progress.lessons['l1-rhythm']?.attempts, 2);
});

test('练熟的字符要看过足够多次、错得足够少', () => {
  const progress: ProgressState = structuredClone(EMPTY_PROGRESS);
  progress.chars['E'] = { seen: 10, wrong: 0 };
  progress.chars['Q'] = { seen: 10, wrong: 8 };
  progress.chars['Z'] = { seen: 2, wrong: 0 };
  const mastered = masteredChars(progress);
  assert.ok(mastered.has('E'));
  assert.ok(!mastered.has('Q'));
  assert.ok(!mastered.has('Z'));
});

/* ============================ 整段收发 ============================ */

test('整段报文（带手抖）能一字不错地读下来', () => {
  const engine = new PracticeEngine({ text: 'CQ DE BG1ABC', wpm: 12 });
  engine.start(0);
  feed(engine, pressText('CQ DE BG1ABC', { dit: 92, jitter: 0.12, seed: 7 }));
  const st = engine.state;
  assert.equal(engine.wrongCount, 0, `不该判错，实际错了 ${engine.wrongCount} 次`);
  assert.equal(st.cursor, engine.target.length, `应全部读下，实际 ${st.cursor}`);
  assert.ok(engine.finished);
});

test('整段报文的收报速度跟着实际手速走', () => {
  for (const dit of [60, 100, 160]) {
    const engine = new PracticeEngine({ text: 'PARIS', wpm: 12 });
    engine.start(0);
    feed(engine, pressText('PARIS', { dit }));
    assert.equal(engine.state.cursor, 5, `点长 ${dit}ms 时应读下 5 个字`);
    assert.ok(Math.abs(engine.state.unitMs - dit) < dit * 0.35, `点长估计应接近 ${dit}`);
  }
});

test('拍错会被记下来，而且不前进', () => {
  const engine = new PracticeEngine({ text: 'CQ', wpm: 12 });
  engine.start(0);
  feed(engine, pressText('CZ', { dit: 100 }));
  assert.equal(engine.state.cursor, 1, 'C 收下，Z 不算数');
  assert.equal(engine.wrongCount, 1);
  assert.equal(engine.state.confused?.heard, 'Z', '负反馈要说清对方听到的是 Z');
});

test('引擎不会因为按键太多而变慢', () => {
  const text = 'CQ CQ CQ DE BG1ABC BG1ABC K '.repeat(3).trim();
  const presses = pressText(text, { dit: 100 });
  assert.ok(presses.length > 200, `样本量应该够大，实际 ${presses.length}`);
  const started = Date.now();
  const engine = new PracticeEngine({ text, wpm: 12 });
  feed(engine, presses);
  const spent = Date.now() - started;
  assert.equal(engine.wrongCount, 0);
  assert.ok(spent < 2000, `处理 ${presses.length} 次按键用了 ${spent}ms，太慢`);
});

/* ============================ 读码助手 ============================ */

test('字还没发完时，静音门槛放得比字间隔更宽', () => {
  // 一下 250ms、先验是 100ms：既可能是 3 个单位的划，也可能是 2.5 个单位的慢点，
  // 这时不能急着断字，门槛要放宽
  const one = settleUnitFor([{ duration: 250, gapBefore: null }], 100, '-.-.');
  assert.ok(one > 100, `门槛应被放宽到 100ms 以上，实际 ${one}`);
  // 一下 300ms 就是干干净净的划，没什么可犹豫的
  const clear = settleUnitFor([{ duration: 300, gapBefore: null }], 100, '-.-.');
  assert.ok(clear <= 110, `读法明确时不该放宽，实际 ${clear}`);
  // 已经拍出完整的 C：读法明确，门槛就是当时的点长
  const full = settleUnitFor(
    [
      { duration: 300, gapBefore: null },
      { duration: 100, gapBefore: 100 },
      { duration: 300, gapBefore: 100 },
      { duration: 100, gapBefore: 100 },
    ],
    100,
    '-.-.',
  );
  assert.ok(Math.abs(full - 100) < 30, `门槛应接近 100ms，实际 ${full}`);
});

test('校准台读数：点长、划长与样本数', () => {
  assert.equal(readSpeed([100, 120]), null, '不足三下不给结果');
  const s = readSpeed([100, 100, 110, 300, 300, 310, 95]);
  assert.ok(s);
  assert.ok(Math.abs(s!.dit - 100) < 15, `点长应接近 100，实际 ${s!.dit}`);
  assert.ok(Math.abs(s!.dah - 300) < 20, `划长应接近 300，实际 ${s!.dah}`);
  assert.equal(s!.nDit + s!.nDah, 7);
});
