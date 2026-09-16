/**
 * 摩尔斯码表 + 前缀树。
 *
 * 前缀树是流式解码的关键：每读到一个码元就往下走一层，
 * 所以“还没发完”的字符也能拿来当候选（比如发了 "-" 就只知道可能是 T 或 N…）。
 */

/** 码形字符。'-' = dah，'.' = dit。 */
export type Pattern = string;

/** 常用字符 → 码形。含 ITU 字母数字标点，以及业余无线电常用的几个自定义记号。 */
export const CHAR_TO_PATTERN: Readonly<Record<string, Pattern>> = {
  A: '.-',
  B: '-...',
  C: '-.-.',
  D: '-..',
  E: '.',
  F: '..-.',
  G: '--.',
  H: '....',
  I: '..',
  J: '.---',
  K: '-.-',
  L: '.-..',
  M: '--',
  N: '-.',
  O: '---',
  P: '.--.',
  Q: '--.-',
  R: '.-.',
  S: '...',
  T: '-',
  U: '..-',
  V: '...-',
  W: '.--',
  X: '-..-',
  Y: '-.--',
  Z: '--..',
  '0': '-----',
  '1': '.----',
  '2': '..---',
  '3': '...--',
  '4': '....-',
  '5': '.....',
  '6': '-....',
  '7': '--...',
  '8': '---..',
  '9': '----.',
  '.': '.-.-.-',
  ',': '--..--',
  '?': '..--..',
  "'": '.----.',
  '!': '-.-.--',
  '/': '-..-.',
  '(': '-.--.',
  ')': '-.--.-',
  '&': '.-...',
  ':': '---...',
  ';': '-.-.-.',
  '=': '-...-',
  '+': '.-.-.',
  '-': '-....-',
  _: '..--.-',
  '"': '.-..-.',
  $: '...-..-',
  '@': '.--.-.',
};

/**
 * 业余无线电常见“过程信号”（prosign）。
 *
 * 为了让它们能像普通字符一样参与练习与对齐，这里用 Unicode 里的
 * 可见替代符号来代表它们（QWERTY 键盘上没有真正的 prosign 键）：
 *   +   → <AR> 报文结束        =   → <BT> 分段
 *   !   → <SK> 结束联络        (   → <KN> 只请对方回答
 * 另外再给几个不常用的留出位置。
 */
export const PROSIGNS: Readonly<Record<string, Pattern>> = {
  '†': '...-.-', // <VA> 结束（也可写作 SK 的变体）
};

/** 所有可用码字（ITU 字符 + prosign）。 */
export const ALL_CHAR_TO_PATTERN: Readonly<Record<string, Pattern>> = {
  ...CHAR_TO_PATTERN,
  ...PROSIGNS,
};

/** 码形 → 字符。 */
export const PATTERN_TO_CHAR: Readonly<Record<Pattern, string>> = Object.fromEntries(
  Object.entries(CHAR_TO_PATTERN).map(([ch, pat]) => [pat, ch]),
);

/** 把码形字符串转成码元序列。 */
export function patternToSymbols(pattern: Pattern): ('dit' | 'dah')[] {
  const out: ('dit' | 'dah')[] = [];
  for (const c of pattern) {
    if (c === '.') out.push('dit');
    else if (c === '-') out.push('dah');
    else throw new Error(`非法码形字符: ${c}`);
  }
  return out;
}

/** 一个字符要发多少毫秒（含字符内部的码元间隔）。 */
export function patternDurationMs(pattern: Pattern, ditMs: number): number {
  const sym = patternToSymbols(pattern);
  if (sym.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < sym.length; i++) {
    total += (sym[i] === 'dit' ? 1 : 3) * ditMs;
    if (i < sym.length - 1) total += ditMs; // 码元间隔 1 单位
  }
  return total;
}

/**
 * 文本的整体发送时长（按标准 PARIS 计时）。用于“参考发送”和进度预估。
 * 词内字符间隔 3 单位，词间 7 单位。
 */
export function textDurationMs(text: string, ditMs: number): number {
  let total = 0;
  const words = text.trim().toUpperCase().split(/\s+/).filter(Boolean);
  for (let w = 0; w < words.length; w++) {
    const chars = [...words[w]!];
    for (let i = 0; i < chars.length; i++) {
      const pat = ALL_CHAR_TO_PATTERN[chars[i]!];
      if (!pat) continue;
      total += patternDurationMs(pat, ditMs);
      if (i < chars.length - 1) total += 3 * ditMs;
    }
    if (w < words.length - 1) total += 7 * ditMs;
  }
  return total;
}

/** 校验一段文本能否用当前码表发出来，返回非法字符列表。 */
export function unsupportedChars(text: string): string[] {
  const bad: string[] = [];
  for (const raw of text.toUpperCase()) {
    if (raw === ' ' || raw === '\n' || raw === '\t') continue;
    if (!ALL_CHAR_TO_PATTERN[raw]) bad.push(raw);
  }
  return bad;
}
