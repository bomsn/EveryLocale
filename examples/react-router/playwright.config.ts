import { defineConfig, devices } from '@playwright/test';

const port = 4316;

/** Runs against the production build that `pnpm test:browser` at the repository root prepares. */
export default defineConfig({
  testDir: 'tests',
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://localhost:${String(port)}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'react-router-serve ./build/server/index.js',
    url: `http://localhost:${String(port)}/`,
    env: { PORT: String(port), PUBLIC_ORIGIN: `http://localhost:${String(port)}` },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
