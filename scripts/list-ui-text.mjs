/**
 * 列出所有“用户可见的中文文案”，方便统一过一遍文字风格。
 * 用法：node scripts/list-ui-text.mjs
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;

async function collect(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await collect(full, out);
    else if (e.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** 粗略提取字符串字面量（单引号/双引号/模板串），只看含中文的。 */
function extractLiterals(line) {
  const out = [];
  const re = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let m;
  while ((m = re.exec(line))) {
    if (CJK.test(m[2])) out.push(m[2]);
  }
  return out;
}

const files = await collect(path.join(ROOT, 'src'));
for (const file of files) {
  const src = await readFile(file, 'utf8');
  const lines = src.split(/\r?\n/);
  const found = [];
  lines.forEach((line, i) => {
    // 跳过注释行
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    const lits = extractLiterals(line);
    for (const l of lits) found.push(`${i + 1}: ${l}`);
  });
  if (found.length === 0) continue;
  console.log(`\n===== ${path.relative(ROOT, file)} (${found.length}) =====`);
  for (const f of found) console.log('  ' + f);
}
