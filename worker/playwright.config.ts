// design-worker(docs/design/system/governance.md §2.6b, ADR-0008): Worker 정적 HTML의 갤러리 검사(e2e/gallery.spec.ts)와 스냅샷
// (e2e/shots.spec.ts). Linux CI 러너에서만 돈다(gate platforms ['linux']).
//
// 페이지를 여는 방법(worker.md 구현 중 변경, 단계 (e)): wrangler dev·Durable Object·비밀값 파일을 쓰지 않는다. spec이 Node에서 뷰 함수
// (src/http의 골격·페이지 렌더러, Playwright TS 로더가 확장자 없는 import를 푼다)를 불러 Response를 만들고, 가짜 출처
// (e2e/pages.ts의 ORIGIN)의 page.route로 그 본문·헤더(CSP 포함)를 그대로 내보낸다. 스타일시트·아이콘·파비콘은 생성 모듈에서 준다.
// 그래서 webServer가 없다. 이 파일과 e2e/는 worker/tsconfig.json(Workers 타입)에 넣지 않는다(타입 검사는 vitest 쪽 tsc만).
//
// 기준선 PNG는 e2e/__shots__/<프로젝트>/에 커밋하고 로컬에서 만들지 않는다: 로컬은 updateSnapshots 'none'(쓰지 않고 실패만),
// CI(CI=true)는 'missing'(없으면 그 자리에 쓰고 실패)이다. 둘 다 artifact design-worker-actual로 올라가고
// `node scripts/design/shots.mjs --accept <run id> --target worker`가 저장소로 옮긴다.
// 배율은 deviceScaleFactor 에뮬레이션이 아니라 --force-device-scale-factor로 준다(에뮬레이션은 테두리 스냅을 건너뛴다). 그래서 스냅샷
// 프로젝트는 viewport가 null이고 창 크기(--window-size)로 폭을 정한다: setViewportSize는 배율을 1로 되돌리므로 폭마다 프로젝트를 둔다
// (app/playwright.shots.config.ts와 같은 규칙, governance §12 (b)-2).
import { readFileSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// 로컬에서 기준선을 만들지 않는다(playwright를 직접 -u로 불러도 막는다. scripts/design/shots.mjs run도 같은 검사)
if (process.env.CI !== "true" && process.argv.some((a) => a === "-u" || a.startsWith("--update-snapshots"))) {
  throw new Error("design-worker 기준선은 Linux CI에서만 만든다: 실패한 CI 실행을 node scripts/design/shots.mjs --accept <run id> --target worker로 받는다");
}

const OUT = "../target/design-worker";
// 허용 오차는 ci/ratchet.json shots.max_diff_pixels(design-shots와 같은 키. 늘리면 ci/RATCHET_LOG.md 줄, ratchet-log gate)
const ratchet = JSON.parse(readFileSync(new URL("../ci/ratchet.json", import.meta.url), "utf8")) as { shots?: { max_diff_pixels?: number } };
const maxDiffPixels = ratchet.shots?.max_diff_pixels ?? 0;

/** 찍는 창 크기(web.md §2: 데스크톱 1280×800, 휴대폰 390×844)와 배율 1·2 */
const SIZES = [
  [1280, 800],
  [390, 844],
] as const;
const shotProjects = ([1, 2] as const).flatMap((n) =>
  SIZES.map(([w, h]) => ({
    name: `dpr${n}-${w}`,
    testMatch: "shots.spec.ts",
    use: {
      browserName: "chromium" as const,
      viewport: null,
      launchOptions: { args: [`--force-device-scale-factor=${n}`, `--window-size=${w},${h}`] },
    },
  })),
);

export default defineConfig({
  testDir: "e2e",
  outputDir: `${OUT}/results`,
  snapshotPathTemplate: "{testDir}/__shots__/{projectName}/{arg}{ext}",
  updateSnapshots: process.env.CI === "true" ? "missing" : "none",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixels, animations: "disabled", caret: "hide" } },
  reporter: [["list"], ["json", { outputFile: `${OUT}/report.json` }]],
  use: {
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    colorScheme: "light",
    reducedMotion: "reduce",
    trace: "off",
    screenshot: "off",
  },
  projects: [
    // 환경 행렬(뷰포트·테마·forced·contrast)은 spec이 describe마다 정한다. 배율 1
    { name: "gallery", testMatch: "gallery.spec.ts", use: { browserName: "chromium" as const } },
    ...shotProjects,
  ],
});
