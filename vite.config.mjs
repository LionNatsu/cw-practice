// Vite 配置用纯 JS（.mjs）而不是 .ts：
// 这样 Vite 不需要先启动 esbuild 去 bundle 配置文件，启动更快，
// 在受限环境（禁止 spawn 管道）里也能直接跑。
import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // 用相对路径，方便直接部署到 GitHub Pages 的子目录
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
});
