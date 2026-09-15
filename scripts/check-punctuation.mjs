/**
 * 中文标点检查：源码、文档、界面文案里，中文语境必须用中文标点。
 *
 * 检查两类问题：
 *  1. 两个中文字之间存在半角标点（, . : ; ? ! ( ) 等）—— 这是最常见的混用。
 *  2. 中文语境里用了成对的半角双引号 " "（应该用 “ ”）。
 *  3. 中文语境里用了 ( )，应改用（）。
 *
 * 例外：代码、URL、文件路径、版本号、WPM/RST 这类中西混排中的半角标点不做要求，
 * 因此只在“两侧都是中文字”时才判定。
 *
 * 用法：node scripts/check-punctuation.mjs
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;
const CJK_CHAR = /[\u4e00-\u9fff]/;

/** 半角标点 → 对应的中文标点。 */
const HALF_TO_FULL = new Map([
  [',', '，'],
  ['.', '。'],
  [':', '：'],
  [';', '；'],
  ['?', '？'],
  ['!', '！'],
  ['(', '（'],
  [')', '）'],
]);

const TARGETS = ['src', 'tests', 'scripts'];
const EXTRA = ['README.md'];
const EXT = new Set(['.ts', '.mjs', '.md']);

async function collect(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await collect(full, out);
    else if (EXT.has(path.extname(e.name))) out.push(full);
  }
  return out;
}

const problems = [];

function checkLine(file, lineNo, line) {
  const chars = [...line];
  for (let i = 1; i < chars.length - 1; i++) {
    const c = chars[i];
    const prev = chars[i - 1];
    const next = chars[i + 1];
    // 两侧都是中文字时才要求中文标点
    if (!CJK_CHAR.test(prev) || !CJK_CHAR.test(next)) continue;
    const full = HALF_TO_FULL.get(c);
    if (full) {
      problems.push({
        file,
        lineNo,
        message: `中文之间出现半角 “${c}”，应为 “${full}”`,
        text: line.trim(),
      });
    }
    if (c === '"') {
      problems.push({ file, lineNo, message: '中文之间出现半角引号 "', text: line.trim() });
    }
  }
}

for (const dir of TARGETS) {
  for (const file of await collect(path.join(ROOT, dir))) {
    const src = await readFile(file, 'utf8');
    src.split(/\r?\n/).forEach((line, i) => checkLine(path.relative(ROOT, file), i + 1, line));
  }
}
for (const rel of EXTRA) {
  const src = await readFile(path.join(ROOT, rel), 'utf8').catch(() => '');
  src.split(/\r?\n/).forEach((line, i) => checkLine(rel, i + 1, line));
}

if (problems.length === 0) {
  console.log('[check-punctuation] 通过：中文语境的标点均为全角。');
} else {
  console.error(`[check-punctuation] 发现 ${problems.length} 处混用：`);
  for (const p of problems.slice(0, 60)) {
    console.error(`  ${p.file}:${p.lineNo} ${p.message}`);
    console.error(`      ${p.text}`);
  }
  process.exitCode = 1;
}
