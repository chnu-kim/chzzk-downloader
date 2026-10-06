// 웹 E2E(docs/design/cicd.md §6, gate `e2e-web`). 실제 프로덕션 dist를 `vite preview`로 띄우고, 가짜 Rust 백엔드
// (e2e/mock/backend.ts, mockIPC)를 앱보다 먼저 싣는다. 판정은 종료 코드뿐이고 실패하면 trace를 남긴다.
// 결정성: 재시도 없음, 작업자 하나, 고정 locale·시간대·색 모드·모션, test.only 금지. 산출물은 모두 ../target/e2e-web/.
import { defineConfig, devices } from '@playwright/test';

const OUT = '../target/e2e-web';
const PORT = 4319;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  outputDir: `${OUT}/results`,
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['json', { outputFile: `${OUT}/report.json` }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    // 앱 창 크기(tauri.conf.json)
    viewport: { width: 960, height: 700 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    // dist는 gate가 먼저 만든다(pnpm build). preview는 빌드하지 않는다.
    command: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
