import { defineConfig } from '@playwright/test';

const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL,
    headless: true,
  },
  // Docker 的 verify 服务通过 BASE_URL 指向 web 服务；本地运行时自动拉起 dev server
  ...(process.env.BASE_URL
    ? {}
    : {
        webServer: {
          command: 'npm run dev -- --port 3000',
          url: 'http://localhost:3000',
          reuseExistingServer: true,
          timeout: 60_000,
        },
      }),
});
