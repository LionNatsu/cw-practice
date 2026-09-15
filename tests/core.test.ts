/**
 * 核心识别逻辑的测试：时序模型、分类、流式解码、离线复核、对齐。
 *
 * 零依赖：直接用 Node 自带的 node:test + node:assert。
 * 运行：pnpm test
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { TimingModel, likelihoodConfidence, wpmFromDit, ditFromWpm } from '../src/core/timing-model.ts';
import { MorseDecoder, decodePresses, classifyGap } from '../src/core/decoder.ts';
import { align, summarize, toCharScores } from '../src/core/alignment.ts';
import { ALL_CHAR_TO_PATTERN, textDurationMs, unsupportedChars } from '../src/core/morse.ts';
import { PracticeSession } from '../src/core/session.ts';
import { LESSONS, expandLesson } from '../src/core/lessons.ts';
import type { Press } from '../src/core/types.ts';
import { pressText } from './helpers.ts';

/**
 * 把一串按键解码出来。
 *
 * 两遍处理，模拟真实系统里的做法：
 *  1) 先让自适应时序模型看完整段（在线估计点长 / 划长 / 手抖程度）；
 *  2) 再用校准好的模型做一次流式解码。
 * 因为点长是“边拍边学”的，所以这样做同时也验证了「模型收敛后识别正确」。
 */
function decodeAll(
  presses: readonly Press[],
  opts: { wpm?: number; pauseMs?: number; corpus?: string } = {},
): { text: string; model: TimingModel; decoder: MorseDecoder } {
  const model = new TimingModel(opts.wpm ?? 12);
  for (let i = 0; i < presses.length; i++) {
    const p = presses[i]!;
    const prev = i > 0 ? presses[i - 1]! : null;
    model.update({ duration: p.duration, gapBefore: prev ? p.down - prev.up : null });
  }
  const decoder = new MorseDecoder(opts.corpus ? { corpus: opts.corpus } : {});
  for (const p of presses) decoder.pushPress(p, model, p.up);
  const last = presses[presses.length - 1];
  decoder.pushPause(model, (last?.up ?? 0) + (opts.pauseMs ?? 500));
  return { text: decoder.bestTextWithSpaces(), model, decoder };
}

test('WPM 与点长的换算符合 PARIS 标准', () => {
  assert.equal(Math.round(ditFromWpm(12)), 100);
  assert.equal(Math.round(wpmFromDit(100)), 12);
  assert.equal(Math.round(wpmFromDit(60)), 20);
});

test('时序模型能从实际拍发中收敛到真实的点长', () => {
  const model = new TimingModel(12);
  const presses = pressText('PARIS PARIS PARIS', { dit: 74 });
  for (const p of presses) model.update({ duration: p.duration, gapBefore: null });
  // 期望收敛到 74ms 附近（允许一点误差）
  assert.ok(Math.abs(model.ditMs - 74) < 10, `dit 估计 ${model.ditMs} 应接近 74`);
  assert.ok(Math.abs(model.wpm - 1200 / 74) < 2, `WPM 估计 ${model.wpm} 偏差过大`);
  assert.ok(model.dahMs > model.ditMs * 2, 'dah 估计应明显大于 dit');
});

test('点划分类在点长漂移后依然正确', () => {
  const model = new TimingModel(12);
  // 先教它一个“慢手”：点 150ms、划 420ms
  const slowPresses = pressText('EEEE TTTT EEEE TTTT', { dit: 150 });
  for (const p of slowPresses) model.update({ duration: p.duration, gapBefore: null });
  const slow = model.classifyByDuration(150);
  assert.equal(slow.kind, 'dit');
  assert.equal(model.classifyByDuration(420).kind, 'dah');
  assert.ok(Math.abs(model.ditMs - 150) < 25, `点长估计 ${model.ditMs} 应接近 150`);
  assert.ok(slow.confidence > 0.5, `置信度应该不低，实际 ${slow.confidence}`);
});

test('解码器能识别字母、数字与标点', () => {
  const cases: Array<[string, string]> = [
    ['E', 'E'],
    ['T', 'T'],
    ['PARIS', 'PARIS'],
    ['CQ', 'CQ'],
    ['DE', 'DE'],
    ['599', '599'],
    ['73', '73'],
    ['RST', 'RST'],
    ['OK', 'OK'],
    ['QSL', 'QSL'],
    ['?', '?'],
    ['/', '/'],
  ];
  for (const [input, expected] of cases) {
    const { text } = decodeAll(pressText(input, { dit: 100 }));
    assert.equal(text, expected, `拍 "${input}" 应解出 "${expected}"，实际 "${text}"`);
  }
});

test('解码器能处理常用呼号与词组', () => {
  for (const input of ['BG1ABC', 'W1AW', 'TNX FER CALL', 'GM OM ES 73']) {
    const { text } = decodeAll(pressText(input, { dit: 100 }));
    assert.equal(text, input, `拍 "${input}" 解成 "${text}"`);
  }
});

test('有抖动的手键也能识别（±18%）', () => {
  for (const input of ['BG1ABC', 'CQ CQ DE BG1ABC K']) {
    const { text } = decodeAll(pressText(input, { dit: 100, jitter: 0.18, seed: 7 }));
    assert.equal(text, input, `拍 "${input}" 解成 "${text}"`);
  }
});

test('不同手速都能自动适应（不锁速度）', () => {
  for (const dit of [60, 80, 120, 160]) {
    const { text, model } = decodeAll(pressText('BG1ABC DE W1AW', { dit }));
    assert.equal(text, 'BG1ABC DE W1AW', `点长 ${dit}ms 时解成 "${text}"`);
    assert.equal(text, 'BG1ABC DE W1AW', `点长 ${dit}ms 时解成 "${text}"`);
    assert.ok(Math.abs(model.ditMs - dit) < dit * 0.25, `点长 ${dit}ms 时估计为 ${model.ditMs}`);
  }
});

test('码元越界（点划分布重叠）时给出低置信度而不是死板报错', () => {
  // 点 110ms、划 150ms：几乎分不开，模型应该给出低置信度
  const model = new TimingModel(12);
  for (const p of pressText('EEEE TTTT', { dit: 110, dah: 150 })) model.update({ duration: p.duration, gapBefore: null });
  const c = model.classifyByDuration(130);
  assert.ok(c.confidence < 0.75, `重叠分布下置信度应该不高，实际 ${c.confidence}`);
  assert.ok(model.perSymbolError > 0.05, `误判概率估计应该偏高，实际 ${model.perSymbolError}`);
});

test('短促的“点”不会被误判成抖动丢掉（踩过的坑）', () => {
  // 背景：早期版本把“最近按键时长的中位数 × 0.3”当抖动阈值。那个中位数是把点和划
  // 混在一起算的：划占比一过半，它就落在划那一侧（约等于划长），再乘 0.3 就可能比
  // 用户正常的点还长 —— 点于是被当成抖动丢掉，划发得越多丢得越狠。
  // 这里用“划很多的快报”来盯住这个行为：点长 40ms、划 180ms、以划为主。
  // 手快的人点很短、用力不均的人划偏长，两者一叠加就会踩中这个坑。
  const dit = 40;
  const text = 'TTTT TTTT TT E TTTT E TTT E TTTT TT E TTTT';
  const presses = pressText(text, { dit, dah: 180 });

  // 1) 复现老写法：中位数 × 0.3 确实会吃掉 40ms 的点
  const sorted = [...presses.map((p) => p.duration)].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const mixedMedian = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const oldFloor = mixedMedian * 0.3;
  const eatenByOld = presses.filter((p) => p.duration < oldFloor).length;
  assert.ok(
    eatenByOld > 0,
    `老阈值 ${oldFloor.toFixed(0)}ms（中位数 ${mixedMedian}ms）应当会吃掉一些 ${dit}ms 的点，实际吃掉 ${eatenByOld} 下`,
  );

  // 2) 新做法：绝对下限只有 18ms，自适应判断以“模型估出的点长”为基准，
  //    所以 40ms 的点一个都不该丢，点长估计也不该被划拉高。
  const model = new TimingModel(12);
  for (let i = 0; i < presses.length; i++) {
    const p = presses[i]!;
    const prev = i > 0 ? presses[i - 1]! : null;
    model.update({ duration: p.duration, gapBefore: prev ? p.down - prev.up : null });
  }
  assert.ok(Math.abs(model.ditMs - dit) < dit * 0.25, `点长估计 ${model.ditMs.toFixed(1)}ms 应接近 ${dit}ms`);
  const floorNow = Math.max(18, model.ditMs * 0.3);
  const eatenNow = presses.filter((p) => p.duration < floorNow).length;
  assert.equal(eatenNow, 0, `新阈值 ${floorNow.toFixed(0)}ms 不该吃掉任何一下，实际吃掉 ${eatenNow} 下`);

  // 3) 整段解码必须完整
  const decoded = decodePresses(presses, model);
  assert.equal(decoded.text, text, `解出来应与原文一致，实际 ${JSON.stringify(decoded.text)}`);
});

test('间隔分类：1 / 3 / 7 个单位分别判为字内、字间、词间', () => {
  assert.equal(classifyGap(0.9), 'intra');
  assert.equal(classifyGap(1.0), 'intra');
  assert.equal(classifyGap(3.0), 'char');
  assert.equal(classifyGap(6.0), 'word');
  assert.equal(classifyGap(null), 'intra');
});

test('离线复核能恢复出整段文本', () => {
  for (const input of ['CQ CQ DE BG1ABC K', 'TNX FER QSL 73']) {
    const presses = pressText(input, { dit: 100, jitter: 0.1, seed: 3 });
    const model = new TimingModel(12);
    for (const p of presses) model.update({ duration: p.duration, gapBefore: null });
    const { text } = decodePresses(presses, model);
    assert.equal(text, input, `复核 "${input}" 得到 "${text}"`);
  }
});

test('对齐：多打、漏打、替换都能定位', () => {
  assert.deepEqual(
    align('ABC', 'ABC').ops.map((o) => o.type),
    ['match', 'match', 'match'],
  );
  const replace = align('ABC', 'AXC');
  assert.deepEqual(replace.ops.map((o) => o.type), ['match', 'substitute', 'match']);
  const extra = align('ABC', 'ABXC');
  assert.equal(extra.ops.filter((o) => o.type === 'insert').length, 1);
  const missing = align('ABC', 'AC');
  assert.equal(missing.ops.filter((o) => o.type === 'delete').length, 1);

  const summary = summarize(
    toCharScores(align('CQ DE', 'CQ DA'), [
      { id: 1, text: 'C', pattern: '-.-.', symbolCount: 4, at: 0, confidence: 1, correct: true, revisable: false, revisions: 0, alternatives: [] },
      { id: 2, text: 'Q', pattern: '--.-', symbolCount: 4, at: 0, confidence: 1, correct: true, revisable: false, revisions: 0, alternatives: [] },
      { id: 3, text: 'D', pattern: '-..', symbolCount: 3, at: 0, confidence: 1, correct: true, revisable: false, revisions: 0, alternatives: [] },
      { id: 4, text: 'A', pattern: '.-', symbolCount: 2, at: 0, confidence: 1, correct: false, revisable: true, revisions: 0, alternatives: [] },
    ]),
  );
  assert.equal(summary.correct, 4);
  assert.equal(summary.wrong, 1);
  assert.ok(Math.abs(summary.accuracy - 4 / 5) < 1e-9);
  assert.deepEqual(summary.confusion[0], { target: 'E', actual: 'A', count: 1 });
});

test('PracticeSession：按目标报文拍完应得到 100% 准确率', () => {
  const item = { text: 'CQ DE BG1ABC K', gloss: '测试' };
  const session = new PracticeSession(item, { callsign: 'BG1ABC', wpm: 12 });
  session.start(0);
  const presses = pressText(item.text, { dit: 100 });
  for (const p of presses) session.submitPress(p.down, p.up);
  session.flushPause((presses[presses.length - 1]?.up ?? 0) + 400);
  const snap = session.snapshot();
  assert.equal(snap.decoded, 'CQDEBG1ABCK', `解码结果应为 CQDEBG1ABCK，实际 ${snap.decoded}`);
  assert.equal(snap.summary.missing + snap.summary.wrong + snap.summary.extra, 0, `不该有错：${JSON.stringify(snap.scores)}`);
  assert.equal(snap.summary.accuracy, 1);
  const score = session.finalize(9999);
  assert.equal(score.correct, snap.target.length);
  assert.equal(score.accuracy, 1);
  assert.ok(score.pressCount === presses.length);
  session.dispose();
});

test('PracticeSession：发错字会被判错，并记进易错对', () => {
  const item = { text: 'CQ DE', gloss: '测试' };
  const session = new PracticeSession(item, { callsign: 'BG1ABC', wpm: 12 });
  session.start(0);
  // 故意把 "CQ DE" 发成 "CQ DA"
  const presses = pressText('CQ DA', { dit: 100 });
  for (const p of presses) session.submitPress(p.down, p.up);
  session.flushPause((presses[presses.length - 1]?.up ?? 0) + 400);
  const score = session.finalize(9999);
  assert.equal(score.wrong, 1);
  assert.equal(score.confusion[0]?.target, 'E');
  assert.equal(score.confusion[0]?.actual, 'A');
  session.dispose();
});

test('停顿能把长报文断开定稿', () => {
  const model = new TimingModel(12);
  const decoder = new MorseDecoder();
  const boxes = [
    pressText('CQ', { dit: 100, start: 1000 }),
    pressText('DE', { dit: 100, start: 5000 }),
    pressText('K', { dit: 100, start: 9000 }),
  ];
  for (const box of boxes) {
    for (const p of box) {
      model.update({ duration: p.duration, gapBefore: null });
      decoder.pushPress(p, model, p.up);
    }
    decoder.pushPause(model, box[box.length - 1]!.up + 400);
  }
  const text = decoder.committedChars.map((c) => c.text).join('');
  assert.equal(text, 'CQDEK');
});

test('每个已定稿字符都带置信度与码形', () => {
  const model = new TimingModel(12);
  const decoder = new MorseDecoder();
  for (const p of pressText('PARIS', { dit: 100 })) {
    model.update({ duration: p.duration, gapBefore: null });
    decoder.pushPress(p, model, p.up);
  }
  decoder.pushPause(model, 9999);
  const committed = decoder.committedChars;
  assert.equal(committed.length, 5);
  for (const c of committed) {
    assert.ok(c.confidence >= 0 && c.confidence <= 1, `置信度应在 0..1，实际 ${c.confidence}`);
    assert.equal(c.pattern, ALL_CHAR_TO_PATTERN[c.text], `${c.text} 的码形应为 ${ALL_CHAR_TO_PATTERN[c.text]}`);
    assert.equal(c.symbolCount, c.pattern.length);
  }
});

test('课程内容全部可以用码表发出来，且都带中文含义', () => {
  for (const lesson of LESSONS) {
    const items = expandLesson(lesson, 'BG1ABC');
    assert.ok(items.length > 0, `${lesson.id} 不该为空`);
    for (const it of items) {
      assert.ok(it.gloss && it.gloss.length > 0, `${lesson.id} 的条目 "${it.text}" 缺少中文含义`);
      const bad = unsupportedChars(it.text);
      assert.deepEqual(bad, [], `${lesson.id} 的条目 "${it.text}" 含无法发送的字符 ${bad.join(',')}`);
      assert.ok(textDurationMs(it.text, 100) > 0);
    }
  }
});

test('likelihoodConfidence：分界处为 0.5，差距越大越接近 1，且受模型可分性限制', () => {
  assert.equal(likelihoodConfidence(1, 1), 0.5);
  assert.ok(likelihoodConfidence(1, 9) > 0.9);
  // 点划分不开（separation 很小）时，单次按键不该被报成高置信度
  assert.ok(likelihoodConfidence(1, 9, 0.5) < 0.6);
  assert.ok(likelihoodConfidence(1, 9, 8) > 0.9);
});

test('自适应会随着更多按键修正前面的判断（可回改）', () => {
  const model = new TimingModel(12);
  const decoder = new MorseDecoder();
  const presses = pressText('PARIS', { dit: 100 });
  let sawRewrite = false;
  let prevText = '';
  for (const p of presses) {
    model.update({ duration: p.duration, gapBefore: null });
    decoder.pushPress(p, model, p.up);
    const now = decoder.bestText();
    if (prevText && now !== prevText) sawRewrite = true;
    prevText = now;
  }
  decoder.pushPause(model, 9999);
  assert.equal(decoder.bestText(), 'PARIS');
  assert.ok(sawRewrite, '在拍发过程中解释应该被修正过（这正是“自适应”的体现）');
  for (const c of decoder.committedChars) {
    assert.ok(c.revisions >= 0);
    assert.ok(c.confidence >= 0 && c.confidence <= 1);
  }
});

test('性能：几百个按键的报文也能在每键一次重算下实时跑完', () => {
  const text = 'CQ CQ CQ DE BG1ABC BG1ABC K '.repeat(4).trim();
  const presses = pressText(text, { dit: 100 });
  assert.ok(presses.length > 200, `样本量应该够大，实际 ${presses.length}`);
  const model = new TimingModel(12);
  for (let i = 0; i < presses.length; i++) {
    const p = presses[i]!;
    const prev = i > 0 ? presses[i - 1]! : null;
    model.update({ duration: p.duration, gapBefore: prev ? p.down - prev.up : null });
  }
  const decoder = new MorseDecoder();
  const t0 = Date.now();
  for (const p of presses) decoder.pushPress(p, model, p.up);
  const elapsed = Date.now() - t0;
  // 每次按键都会重跑一遍全局最优，总耗时必须在“一次练习”的量级内
  assert.ok(elapsed < 5000, `重算总耗时 ${elapsed}ms 过慢`);
  const perPress = elapsed / presses.length;
  assert.ok(perPress < 25, `平均每键 ${perPress.toFixed(1)}ms，超出交互预算`);
});
