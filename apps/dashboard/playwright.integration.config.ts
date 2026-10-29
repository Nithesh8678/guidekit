import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: './tests', testMatch: '*.integration.spec.ts', workers: 1, timeout: 45_000,
  expect: { timeout: 7000 }, outputDir: '../../test-results/dashboard-integration',
  use: { baseURL: 'http://127.0.0.1:4510', viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node --import tsx scripts/test-fixture.ts', cwd: fileURLToPath(new URL('../../', import.meta.url)), url: 'http://127.0.0.1:4510/health', reuseExistingServer: false, timeout: 20_000 }
});
