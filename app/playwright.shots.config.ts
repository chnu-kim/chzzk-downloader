// 시각 회귀 스냅샷(design-shots, docs/design/system/governance.md §2.7, ADR-0008). Linux CI 러너에서만 돈다
// (gate platforms ['linux']). 기준선 PNG는 e2e/__shots__/<프로젝트>/에 커밋하고 로컬에서 만들지 않는다:
// updateSnapshots 'none'이라 기준선이 없거나 다르면 실패하고 실제 그림(*-actual.png)만 outputDir에 남긴다.
// CI(CI=true)에서는 updateSnapshots 'missing'이다: 기준선이 없으면 그 자리(e2e/__shots__)에 실제 그림을 쓰고 실패한다.
// 기준선과 다르면 *-actual.png를 outputDir에 남긴다. 둘 다 artifact design-shots-actual로 올라가고
// `node scripts/design/shots.mjs --accept <run id>`가 저장소로 옮긴다. 로컬은 'none'(쓰지 않고 실패만)이다.
// 배율은 deviceScaleFactor 에뮬레이션이 아니라 --force-device-scale-factor로 준다(에뮬레이션은 테두리 스냅을 건너뛴다).
// 그래서 viewport는 null이고 창 크기(--window-size)로 폭을 정한다: setViewportSize는 배율을 1로 되돌리므로 폭마다 프로젝트를 둔다.
import { readFileSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// 로컬에서 기준선을 만들지 않는다(playwright를 직접 -u로 불러도 막는다. scripts/design/shots.mjs run도 같은 검사)
if (process.env.CI !== 'true' && process.argv.some((a) => a === '-u' || a.startsWith('--update-snapshots'))) {
  throw new Error('design-shots 기준선은 Linux CI에서만 만든다: 실패한 CI 실행을 node scripts/design/shots.mjs --accept <run id>로 받는다');
}

const OUT = '../target/design-shots';
const PORT = 4320;
// 허용 오차는 ci/ratchet.json shots.max_diff_pixels(늘리면 ci/RATCHET_LOG.md 줄, ratchet-log gate)
const ratchet = JSON.parse(readFileSync(new URL('../ci/ratchet.json', import.meta.url), 'utf8')) as { shots?: { max_diff_pixels?: number } };
const maxDiffPixels = ratchet.shots?.max_diff_pixels ?? 0;

/** 찍는 창 크기(앱 최소 720×520·기본 960×700)와 배율 1·2 */
const SIZES = [
  [720, 520],
  [960, 700],
] as const;
const projects = ([1, 2] as const).flatMap((n) =>
  SIZES.map(([w, h]) => ({
    name: `dpr${n}-${w}`,
    use: {
      browserName: 'chromium' as const,
      viewport: null,
      launchOptions: { args: [`--force-device-scale-factor=${n}`, `--window-size=${w},${h}`] },
    },
  })),
);

export default defineConfig({
  testDir: 'e2e',
  testMatch: 'shots.spec.ts',
  outputDir: `${OUT}/results`,
  snapshotPathTemplate: '{testDir}/__shots__/{projectName}/{arg}{ext}',
  updateSnapshots: process.env.CI === 'true' ? 'missing' : 'none',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixels, animations: 'disabled', caret: 'hide' } },
  reporter: [['list'], ['json', { outputFile: `${OUT}/report.json` }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    trace: 'off',
    screenshot: 'off',
  },
  projects,
  webServer: {
    // dist(CHZZK_GALLERY=1)는 design-shots gate가 먼저 만든다
    command: `node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/gallery.html`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
