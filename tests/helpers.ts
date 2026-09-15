/**
 * 测试辅助：按国际摩尔斯码的标准节奏，把一个码形串"拍"成按键序列。
 *
 * 这是验证解码器的关键工具：我们可以精确控制每一个点/划的长度（以及人为的偏差），
 * 然后检查解码器能不能把你"拍"的内容认出来。
 */

import { ALL_CHAR_TO_PATTERN } from '../src/core/morse.ts';
import type { Press } from '../src/core/types.ts';

export interface KeyingOptions {
  /** 点长 ms。 */
  dit?: number;
  /** 划长 ms（默认 3 倍点长）。 */
  dah?: number;
  /** 码元间隔 ms（默认 1 倍点长）。 */
  symGap?: number;
  /** 字符间隔 ms（默认 3 倍点长）。 */
  charGap?: number;
  /** 词间隔 ms（默认 7 倍点长）。 */
  wordGap?: number;
  /** 每个点/划时长的随机抖动比例（0.1 = ±10%）。 */
  jitter?: number;
  /** 随机种子，保证测试可复现。 */
  seed?: number;
  /** 起始时间。 */
  start?: number;
  /** 是否对"点/划"时长再加固定偏移（模拟习惯性偏长/偏短）。 */
  biasMs?: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 一个字符一个字符地拍，返回按键序列。 */
export function pressText(text: string, opts: KeyingOptions = {}): Press[] {
  const dit = opts.dit ?? 100;
  const dah = opts.dah ?? dit * 3;
  const symGap = opts.symGap ?? dit;
  const charGap = opts.charGap ?? dit * 3;
  const wordGap = opts.wordGap ?? dit * 7;
  const jitter = opts.jitter ?? 0;
  const rnd = mulberry32(opts.seed ?? 42);
  const bias = opts.biasMs ?? 0;
  let t = opts.start ?? 1000;
  const out: Press[] = [];
  const words = text.trim().toUpperCase().split(/\s+/).filter(Boolean);
  for (let w = 0; w < words.length; w++) {
    const chars = [...words[w]!];
    for (let c = 0; c < chars.length; c++) {
      const pattern = ALL_CHAR_TO_PATTERN[chars[c]!];
      if (!pattern) throw new Error(`测试文本里有未知字符: ${chars[c]}`);
      for (let s = 0; s < pattern.length; s++) {
        const base = pattern[s] === '.' ? dit : dah;
        const noise = jitter > 0 ? base * jitter * (rnd() * 2 - 1) : 0;
        const duration = Math.max(8, base + bias + noise);
        out.push({ down: t, up: t + duration, duration });
        t += duration;
        if (s < pattern.length - 1) t += symGap;
      }
      if (c < chars.length - 1) t += charGap;
    }
    if (w < words.length - 1) t += wordGap;
  }
  return out;
}

/** 只按一个码元串拍（不管字符分隔），返回按键序列。 */
export function pressPattern(pattern: string, opts: KeyingOptions = {}): Press[] {
  const dit = opts.dit ?? 100;
  const symGap = opts.symGap ?? dit;
  let t = opts.start ?? 1000;
  const out: Press[] = [];
  for (let s = 0; s < pattern.length; s++) {
    const base = pattern[s] === '.' ? dit : dit * 3;
    const duration = Math.max(8, base + (opts.biasMs ?? 0));
    out.push({ down: t, up: t + duration, duration });
    t += duration;
    if (s < pattern.length - 1) t += symGap;
  }
  return out;
}

/** 按键序列总时长（含最后一下之后的时间）。 */
export function spanMs(presses: readonly Press[]): number {
  if (presses.length === 0) return 0;
  const first = presses[0]!;
  const last = presses[presses.length - 1]!;
  return last.up - first.down;
}
