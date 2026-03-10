import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './', 
  build: {
    // 确保打包输出到 dist 目录（与 package.json 中 files 配置一致）
    outDir: 'dist',
    // 可选：强制清空 dist 目录，避免旧文件干扰
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});