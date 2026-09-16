import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', timeout: 30000, fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:5180', channel: 'chrome', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5180', reuseExistingServer: true, timeout: 20000 },
});
