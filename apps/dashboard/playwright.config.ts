import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: './tests', testMatch: '*.contract.spec.ts', workers: 1, timeout: 30_000,
  outputDir: '../../test-results/dashboard',
  use: { baseURL: 'http://127.0.0.1:4630', viewport: { width: 1280, height: 900 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node apps/dashboard/tests/serve.mjs', cwd: fileURLToPath(new URL('../../', import.meta.url)), url: 'http://127.0.0.1:4630', reuseExistingServer: false, timeout: 10_000 }
});
