import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'voice-settings.spec.ts', workers: 1, timeout: 45_000, expect: { timeout: 8000 }, reporter: 'list', use: { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', trace: 'retain-on-failure', screenshot: 'only-on-failure' } });
