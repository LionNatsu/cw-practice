/**
 * 零依赖构建脚本：把 src/ 的 TypeScript 直接搬到 dist/，并改写导入路径。
 *
 * 为什么需要它：本项目刻意不依赖任何"运行时"打包器。源码里的相对导入都写成
 * 显式扩展名（./x.ts），浏览器虽然不认识 .ts，但只要把扩展名改写成 .js、
 * 内容里的类型标注交给浏览器（Chrome/Edge 支持 type stripping）……
 * 这条路并不通用，所以这里做的是**真正的转译**：
 * 用 Node 自带的类型剥离能力把每个模块转成 JS —— 具体做法见下。
 *
 * 实际实现更简单可靠：调用 Node 自己加载一次不做，而是用 `node:module` 的
 * stripTypeScriptTypes（Node 22.13+ / 23+ 提供）把源码转成 JS。
 * 若运行环境没有这个 API，就退化成"原样拷贝并把 .ts 改成 .js"，
 * 同时给出明确提示（那种情况下需要现代浏览器 + 服务器返回正确 MIME）。
 *
 * 用法：node scripts/build.mjs
 */

import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const outDir = path.join(root, 'dist');

/** 用 Node 内置能力剥离类型；不可用时返回 null。 */
async function makeStripper() {
  try {
    const mod = await import('node:module');
    const fn = mod.stripTypeScriptTypes;
    if (typeof fn === 'function') {
      return (code, file) =>
        fn(code, { mode: 'transform', sourceMap: false, sourceUrl: file });
    }
  } catch {
    /* 继续尝试下面的方式 */
  }
  return null;
}

/** 递归收集要处理的源文件。 */
async function collect(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collect(full, out);
    else out.push(full);
  }
  return out;
}

/** 把 "./x.ts" 改写成 "./x.js"，并把裸导入保留（运行时不依赖任何包）。 */
function rewriteSpecifiers(code) {
  return code.replace(/(from\s*['"])(\.\.?\/[^'"]*?)\.ts(['"])/g, '$1$2.js$3').replace(
    /(import\s*['"])(\.\.?\/[^'"]*?)\.ts(['"])/g,
    '$1$2.js$3',
  );
}

async function main() {
  if (!existsSync(srcDir)) throw new Error(`找不到源码目录: ${srcDir}`);
  const strip = await makeStripper();
  if (!strip) {
    console.warn(
      '[build] 当前 Node 没有 stripTypeScriptTypes（需要 Node 22.13+），' +
        '将原样拷贝 .ts 并把扩展名改成 .js —— 这样产物里仍含类型标注，只适合现代浏览器直连调试。',
    );
  }
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const files = await collect(srcDir);
  let count = 0;
  for (const file of files) {
    const rel = path.relative(srcDir, file);
    const ext = path.extname(file);
    const outRel = ext === '.ts' ? rel.slice(0, -3) + '.js' : rel;
    const outPath = path.join(outDir, outRel);
    await mkdir(path.dirname(outPath), { recursive: true });

    if (ext === '.ts') {
      const code = await readFile(file, 'utf8');
      const js = strip ? strip(code, file) : code;
      await writeFile(outPath, rewriteSpecifiers(js), 'utf8');
    } else {
      await cp(file, outPath);
    }
    count++;
  }

  // index.html：入口与样式路径换成构建产物
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const builtHtml = html
    .replace('/src/styles.css', './styles.css')
    .replace('/src/main.ts', './main.js');
  await writeFile(path.join(outDir, 'index.html'), builtHtml, 'utf8');

  console.log(`[build] 完成：${count} 个源文件 → dist/`);
  console.log('[build] 用 `npx serve dist` 或 `python -m http.server -d dist` 本地预览。');
}

main().catch((err) => {
  console.error('[build] 失败:', err);
  process.exitCode = 1;
});
