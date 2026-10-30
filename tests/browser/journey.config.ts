import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'journey.spec.ts', workers: 1, fullyParallel: false,
  timeout: 60_000, expect: { timeout: 12_000 }, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4611', viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', trace: 'retain-on-failure', screenshot: 'only-on-failure' }
});
