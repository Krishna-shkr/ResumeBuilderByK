// Playwright config for end-to-end tests against the running Resume Editor.
// Assumes the app is already running at http://localhost:3000 (npm start).
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 90000, // Gemini calls can take a while
  expect: { timeout: 15000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
