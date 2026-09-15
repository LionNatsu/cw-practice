/**
 * 侧音与参考发送的调度测试。
 *
 * 用一个“只记账、不发声”的假 AudioContext 把排好的包络记下来，再还原成
 * 一段段响与不响的区间。这样不用开浏览器就能验证：
 *   - 一个点排的是 100ms 而不是 100 秒（曾经把毫秒当秒传给包络，整段变成长音）；
 *   - PARIS 该响 14 段，点 100ms、划 300ms；
 *   - 字间隔 300ms、词间隔 700ms。
 *
 * 跑法：node --experimental-strip-types tests/audio.test.ts
 */

import assert from 'node:assert/strict';
import test from 'node:test';

/* ============================ 假上下文 ============================ */

type Ramp = { value: number; time: number };

class FakeParam {
  readonly events: Ramp[] = [];
  value = 0;
  setValueAtTime(value: number, time: number): void {
    this.events.push({ value, time });
    this.value = value;
  }
  linearRampToValueAtTime(value: number, time: number): void {
    this.events.push({ value, time });
    this.value = value;
  }
  exponentialRampToValueAtTime(value: number, time: number): void {
    this.events.push({ value, time });
    this.value = value;
  }
  cancelScheduledValues(): void {}
}

class FakeGain {
  readonly gain = new FakeParam();
  connect<T>(x: T): T {
    return x;
  }
  disconnect(): void {}
}

class FakeOsc {
  type = 'sine';
  readonly frequency = new FakeParam();
  connect<T>(x: T): T {
    return x;
  }
  start(): void {}
  stop(): void {}
}

class FakeContext {
  /** 建过的上下文都记下来，测试从最近一个里取排好的包络。 */
  static readonly instances: FakeContext[] = [];
  currentTime = 0;
  state = 'running';
  readonly destination = {};
  readonly gains: FakeGain[] = [];
  constructor() {
    FakeContext.instances.push(this);
  }
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createOscillator(): FakeOsc {
    return new FakeOsc();
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
}

globalThis.window = {
  AudioContext: FakeContext,
  // 参考发送结束时会挂一个定时器；不要让它拖住进程退出
  setTimeout: (fn: () => void, ms?: number) => {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return t;
  },
  clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
} as unknown as typeof window;
globalThis.AudioContext = FakeContext as unknown as typeof AudioContext;

const { MorseAudio } = await import('../src/core/audio.ts');

/** 造一个音频对象：只留它自己建的那个上下文。 */
async function makeAudio() {
  FakeContext.instances.length = 0;
  const audio = new MorseAudio({ toneHz: 700, volume: 0.35 });
  await audio.resume();
  return audio;
}

/**
 * 把一条包络还原成“响着的区间”。
 *
 * 一个音的排法是 静音(at) → 升到 1 → 保持 → 落回 0(at+len)，
 * 所以区间就是 [at, at+len]，正好等于想要的音长。
 */
function tones(param: FakeParam): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let start: number | null = null;
  let lastOff: number | null = null;
  for (const e of param.events) {
    const on = e.value > 0.01; // 0.0001 = 静音，1 或 0.5 = 响着
    if (on && start === null) start = lastOff ?? e.time;
    else if (!on && start !== null) {
      out.push({ start, end: e.time });
      start = null;
    }
    if (!on) lastOff = e.time;
  }
  return out;
}

/** 参考发送用的那条包络：事件最多的就是它。 */
function playParam(): FakeParam {
  const last = FakeContext.instances[FakeContext.instances.length - 1];
  assert.ok(last, '没有建出音频上下文');
  assert.ok(last.gains.length > 0, '没有创建任何 gain');
  return last.gains.reduce((a, b) => (b.gain.events.length > a.gain.events.length ? b : a)).gain;
}

const ms = (sec: number) => Math.round(sec * 1000);

/* ============================ 用例 ============================ */

test('一个点排的是 100ms，不是 100 秒', async () => {
  const audio = await makeAudio();
  const reported = await audio.playText('E', 12);
  const seg = tones(playParam());
  assert.equal(seg.length, 1, `E 应当只有一段声音，实际 ${seg.length} 段`);
  assert.ok(Math.abs(ms(seg[0]!.end - seg[0]!.start) - 100) <= 2, `点的时长应是 100ms，实际 ${ms(seg[0]!.end - seg[0]!.start)}ms`);
  assert.ok(Math.abs(reported - 200) <= 5, `E 的报告时长应约 200ms，实际 ${reported.toFixed(0)}ms`);
});

test('PARIS 该响 14 段，点 100ms、划 300ms', async () => {
  const audio = await makeAudio();
  const reported = await audio.playText('PARIS', 12);
  const seg = tones(playParam());
  assert.equal(seg.length, 14, `PARIS 有 14 个码元，实际响了 ${seg.length} 段`);
  const lens = seg.map((s) => ms(s.end - s.start));
  const want = [100, 300, 300, 100, 100, 300, 100, 300, 100, 100, 100, 100, 100, 100];
  assert.equal(lens.length, want.length);
  for (let i = 0; i < want.length; i++) {
    assert.ok(Math.abs(lens[i]! - want[i]!) <= 3, `第 ${i + 1} 段应是 ${want[i]}ms，实际 ${lens[i]}ms`);
  }
  assert.ok(Math.abs(reported - 4400) <= 60, `PARIS 的报告时长应约 4400ms，实际 ${reported.toFixed(0)}ms`);
});

test('字间隔 300ms、词间隔 700ms', async () => {
  const audio = await makeAudio();
  await audio.playText('EE E', 12);
  const seg = tones(playParam());
  assert.equal(seg.length, 3, `应当响 3 段，实际 ${seg.length} 段`);
  const gap1 = ms(seg[1]!.start - seg[0]!.end);
  const gap2 = ms(seg[2]!.start - seg[1]!.end);
  assert.ok(Math.abs(gap1 - 300) <= 3, `同一个词里两字之间应是 300ms，实际 ${gap1}ms`);
  assert.ok(Math.abs(gap2 - 700) <= 3, `词与词之间应是 700ms，实际 ${gap2}ms`);
});

test('速度变了，音长跟着变', async () => {
  const audio = await makeAudio();
  await audio.playText('E', 24); // 24 WPM → 点长 50ms
  const seg = tones(playParam());
  assert.equal(seg.length, 1);
  assert.ok(Math.abs(ms(seg[0]!.end - seg[0]!.start) - 50) <= 2, `24 WPM 的点应是 50ms，实际 ${ms(seg[0]!.end - seg[0]!.start)}ms`);
});

test('拍错时给两声短促的低音，与点划区分得开', async () => {
  const audio = await makeAudio();
  await audio.playBump();
  const last = FakeContext.instances[FakeContext.instances.length - 1]!;
  const all = last.gains.map((g) => tones(g.gain)).flat();
  assert.equal(all.length, 2, `负反馈应是两声，实际 ${all.length} 声`);
  for (const s of all) {
    const len = ms(s.end - s.start);
    assert.ok(len >= 100 && len <= 200, `每声应在 100~200ms，实际 ${len}ms`);
  }
});

test('侧音按下起音、抬起收音', async () => {
  const audio = await makeAudio();
  assert.equal(audio.isKeying, false);
  audio.keyDown();
  assert.equal(audio.isKeying, true);
  audio.keyUp();
  assert.equal(audio.isKeying, false);
  audio.silence();
  assert.equal(audio.isKeying, false);
});
