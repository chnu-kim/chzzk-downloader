// 웹 E2E(docs/design/cicd.md §6, gate `e2e-web`). 실제 프로덕션 dist를 `vite preview`로 띄우고, 가짜 Rust 백엔드
// (e2e/mock/backend.ts, mockIPC)를 앱보다 먼저 싣는다. 판정은 종료 코드뿐이고 실패하면 trace를 남긴다.
// 결정성: 재시도 없음, 작업자 하나, 고정 locale·시간대·색 모드·모션, test.only 금지. 산출물은 모두 ../target/e2e-web/.
// 프로젝트 둘: chromium(앱 흐름)과 gallery(design-gallery, docs/design/system/governance.md §2.6: gallery.spec.ts는 gallery.html의 ui/ 매트릭스를
// 환경 행렬로 axe·대상 크기·포커스 링·계산값 검사하고, screens.spec.ts는 실제 앱 + 가짜 백엔드로 기능 화면을 같은 방식으로 검사한다).
// gallery는 CHZZK_GALLERY=1로 만든 dist가 있어야 한다(e2e-web gate가 그렇게 빌드한다).
// 스냅샷(shots.spec.ts)은 이 설정에서 돌지 않는다: playwright.shots.config.ts(design-shots, Linux CI 전용).
import { defineConfig, devices } from '@playwright/test';

const OUT = '../target/e2e-web';
const PORT = 4319;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  testIgnore: 'shots.spec.ts',
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
  projects: [
    { name: 'chromium', testIgnore: ['gallery.spec.ts', 'screens.spec.ts', 'shots.spec.ts'], use: { browserName: 'chromium' } },
    { name: 'gallery', testMatch: ['gallery.spec.ts', 'screens.spec.ts'], use: { browserName: 'chromium' } },
  ],
  webServer: {
    // dist는 gate가 먼저 만든다(pnpm build). preview는 빌드하지 않는다.
    command: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
