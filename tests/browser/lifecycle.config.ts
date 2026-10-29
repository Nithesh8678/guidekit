import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'lifecycle.spec.ts', workers: 1, fullyParallel: false,
  timeout: 45_000, expect: { timeout: 10_000 }, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4711', viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', trace: 'retain-on-failure', screenshot: 'only-on-failure' }
});
