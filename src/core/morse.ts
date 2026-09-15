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

/** 把码元的 dit/dah 序列转成码形字符串。 */
export function symbolsToPattern(symbols: readonly ('dit' | 'dah')[]): Pattern {
  let out = '';
  for (const s of symbols) out += s === 'dit' ? '.' : '-';
  return out;
}

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

/** 前缀树节点。 */
export interface MorseNode {
  /** 若这是一个完整码字，则给出其文本。 */
  text?: string;
  children: Map<'dit' | 'dah', MorseNode>;
}

export function createNode(): MorseNode {
  return { children: new Map() };
}

export interface MorseTree {
  root: MorseNode;
  /** 码形 → 字符（可包含自定义）。 */
  lookup: Map<Pattern, string>;
  /** 最长码形长度（码元数），用于限制搜索深度。 */
  maxDepth: number;
}

/**
 * 建立摩尔斯前缀树。
 * @param entries 可选的额外码字（例如课程里自定义的记号）。
 */
export function buildTree(entries: Readonly<Record<string, Pattern>> = {}): MorseTree {
  const root = createNode();
  const lookup = new Map<Pattern, string>(Object.entries(PATTERN_TO_CHAR));
  let maxDepth = 0;
  const all: Record<string, Pattern> = { ...CHAR_TO_PATTERN, ...PROSIGNS, ...entries };
  for (const [text, pattern] of Object.entries(all)) {
    if (!pattern) continue;
    lookup.set(pattern, text);
    let node = root;
    const sym = patternToSymbols(pattern);
    for (const s of sym) {
      let next = node.children.get(s);
      if (!next) {
        next = createNode();
        node.children.set(s, next);
      }
      node = next;
    }
    node.text = text;
    maxDepth = Math.max(maxDepth, sym.length);
  }
  return { root, lookup, maxDepth };
}

/** 从根节点沿码元走一步。 */
export function step(node: MorseNode, kind: 'dit' | 'dah'): MorseNode | undefined {
  return node.children.get(kind);
}

/** 查一个码形对应的字符（不区分自定义码字）。 */
export function decodePattern(pattern: Pattern, extra: Readonly<Record<string, Pattern>> = {}): string | undefined {
  if (extra) {
    for (const [text, pat] of Object.entries(extra)) if (pat === pattern) return text;
  }
  return PATTERN_TO_CHAR[pattern];
}

/** 把文本转成码形序列，非法字符抛错。 */
export function textToPatterns(text: string): Array<{ ch: string; pattern: Pattern }> {
  const out: Array<{ ch: string; pattern: Pattern }> = [];
  for (const raw of text.toUpperCase()) {
    if (raw === ' ' || raw === '\n' || raw === '\t') continue;
    const pat = ALL_CHAR_TO_PATTERN[raw];
    if (!pat) throw new Error(`没有对应码形的字符: "${raw}"`);
    out.push({ ch: raw, pattern: pat });
  }
  return out;
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
