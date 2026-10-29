import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'apps/dashboard',
  plugins: [react()],
  resolve: { alias: { '@guidekit/contracts': resolve('packages/contracts/src/index.ts'), '@guidekit/sdk': resolve('packages/sdk/src/index.ts') } },
  server: { port: 4413, strictPort: true, proxy: { '/api': 'http://127.0.0.1:4410', '/sdk': 'http://127.0.0.1:4410' } },
  build: { outDir: '../../dist/dashboard', emptyOutDir: true }
});
