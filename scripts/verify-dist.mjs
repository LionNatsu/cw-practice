/**
 * 产物自检：确保 dist/ 真的能部署到 GitHub Pages 的项目子目录下而不会白屏。
 *
 * 起因：曾经因为 index.html 里留下 `src="/./main.js"`（开头的斜杠没去掉），
 * 浏览器把它当成“域名根”的绝对路径 → 404 → 模块不加载 → 页面一片空白。
 * 这种问题在本地用“根路径托管 dist”时看不出来，所以必须单独检查。
 *
 * 用法：node scripts/verify-dist.mjs
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const REQUIRED = [
  'index.html',
  'main.js',
  'styles.css',
  'App.js',
  'ui/practice-view.js',
  'ui/input.js',
  'ui/dom.js',
  'core/decoder.js',
  'core/timing-model.js',
  'core/session.js',
  'core/alignment.js',
  'core/morse.js',
  'core/lessons.js',
];

const problems = [];

for (const rel of REQUIRED) {
  const full = path.join(DIST, rel);
  const info = await stat(full).catch(() => null);
  if (!info || !info.isFile() || info.size === 0) problems.push(`缺少产物或为空: dist/${rel}`);
}

const html = await readFile(path.join(DIST, 'index.html'), 'utf8').catch(() => '');
if (!html) {
  problems.push('读不到 dist/index.html');
} else {
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  for (const ref of refs) {
    if (ref.startsWith('data:')) continue;
    if (ref.startsWith('/')) {
      problems.push(`index.html 里有绝对路径（部署到子目录会 404）: ${ref}`);
      continue;
    }
    if (ref.includes('/src/')) {
      problems.push(`index.html 还引用着源码路径: ${ref}`);
      continue;
    }
    const target = path.join(DIST, ref.replace(/^\.\//, ''));
    const info = await stat(target).catch(() => null);
    if (!info || !info.isFile()) problems.push(`index.html 引用了不存在的文件: ${ref}`);
  }
  if (!/src="\.\/main\.js"/.test(html)) problems.push('index.html 没有以相对路径引用 ./main.js');
  if (!/href="\.\/styles\.css"/.test(html)) problems.push('index.html 没有以相对路径引用 ./styles.css');
}

// 每个 js 模块里的相对导入也要能在 dist 里找到对应文件（大小写/扩展名错都会在这里暴露）
const { readdir } = await import('node:fs/promises');
async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

for (const file of await walk(DIST).catch(() => [])) {
  const code = await readFile(file, 'utf8');
  const rel = path.relative(DIST, file);
  for (const m of code.matchAll(/from\s*['"](\.[^'"]+)['"]/g)) {
    const spec = m[1];
    const target = path.resolve(path.dirname(file), spec);
    const info = await stat(target).catch(() => null);
    if (!info) problems.push(`${rel} 导入了不存在的模块: ${spec}`);
  }
}

if (problems.length) {
  console.error('[verify-dist] 检查未通过：');
  for (const p of problems) console.error('  -', p);
  process.exitCode = 1;
} else {
  console.log('[verify-dist] 通过：dist 可以安全部署到子目录');
}
