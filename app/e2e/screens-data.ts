// 화면 갤러리가 여는 화면과 환경의 표(screens.spec.ts가 검사하고 shots.spec.ts가 찍는다). 이 파일은 Playwright가 Node에서 읽는다:
// 화면 글자는 모두 e2e/copy.ts(copy deck)에서 오고, 데이터는 합성이다(실제 채널·영상 값 아님).
import type { Page, Locator } from '@playwright/test';
import type { AuthStatusDto, ChannelRefDto, Os, RecentVodDto, UpdateInfoDto } from '../src/lib/bindings';
import { check as outputCheck, resolved, vodResolved, worstCaseResolved, WORST_TITLE } from '../src/test/fixtures';
import { finishedSet, job, jobStateSet, liveProg, MY_CHANNEL_ID, prog, SAME_PREFIX_TITLES } from '../src/test/jobFixtures';
import { CHECK_DEBOUNCE_MS, revealLabel, t } from './copy';
import { expect, type App } from './fixtures';
import type { Scenario } from './mock/backend';

export type { App };

// ───────────────────────── 환경 행렬 ─────────────────────────

export interface Env {
  name: string;
  vp: { width: number; height: number };
  scheme: 'light' | 'dark';
  forced?: boolean;
  contrast?: 'more';
  /** reduce 해제(전환이 실제로 도는 환경). 기본은 reduce(playwright.config.ts) */
  motion?: boolean;
  xlarge?: boolean;
  os: Os;
  /** 시간을 흘려보낸다(스냅샷의 가짜 시계). 실제 시계로 도는 검사에서는 없다 */
  tick?: (ms: number) => Promise<void>;
}

export const V960 = { width: 960, height: 700 };
export const V720 = { width: 720, height: 520 };
export const V320 = { width: 320, height: 231 };

/** 한 번에 한 축씩 바꾼 환경(최소 선택: 곱집합이 아니다). 축마다 OS가 돌아가며 macOS·Windows·Linux를 모두 지난다 */
export const ENVS: Env[] = [
  { name: '라이트 960', vp: V960, scheme: 'light', os: 'macos' },
  { name: '라이트 720', vp: V720, scheme: 'light', os: 'windows' },
  { name: '라이트 320', vp: V320, scheme: 'light', os: 'macos' },
  { name: '다크 960', vp: V960, scheme: 'dark', os: 'linux' },
  { name: '다크 720', vp: V720, scheme: 'dark', os: 'macos' },
  { name: 'forced-colors 960', vp: V960, scheme: 'light', forced: true, os: 'windows' },
  { name: '다크+contrast 720', vp: V720, scheme: 'dark', contrast: 'more', os: 'linux' },
  { name: 'reduce 해제 960', vp: V960, scheme: 'light', motion: true, os: 'linux' },
  { name: '아주 크게 720', vp: V720, scheme: 'light', xlarge: true, os: 'windows' },
  { name: '아주 크게 320 다크', vp: V320, scheme: 'dark', xlarge: true, os: 'macos' },
];

// ───────────────────────── 고정 데이터 ─────────────────────────

const EMPTY_AUTH = { channelId: null, channelName: null, reason: null, pending: null, offline: null, verifiedAt: null, canReconnect: false, isAdmin: false, delegatedChannels: [] as ChannelRefDto[], delegationsCheckedAt: null } as const;
const auth = (over: Partial<AuthStatusDto> & Pick<AuthStatusDto, 'state'>): AuthStatusDto => ({ ...EMPTY_AUTH, ...over });
const SIGNED_IN = auth({ state: 'signedIn', channelId: MY_CHANNEL_ID, channelName: '테스트 채널', verifiedAt: 1_767_322_800 });
const AVAILABLE: UpdateInfoDto = { version: '9.9.9', current: '0.0.0-e2e', notes: null, pubDate: null };

const RECENT: RecentVodDto[] = [
  { url: 'https://chzzk.naver.com/video/1111111', title: SAME_PREFIX_TITLES[0], kind: 'rewind', date: '2026-10-03 21:00:00' },
  { url: 'https://chzzk.naver.com/video/2222222', title: SAME_PREFIX_TITLES[1], kind: 'vod', date: '2026-10-02 20:00:00' },
  { url: 'https://chzzk.naver.com/clips/3333333', title: '짧은 클립', kind: 'clip', date: null },
  { url: 'https://chzzk.naver.com/video/4444444', title: '옛 항목(종류 없음)', kind: null, date: null },
];

const R = resolved();
// 편집자 위임 화면용 합성 채널 ID(실제 값 아님)
const EDITOR_ID = '000000000000000000000000000000b2';
const EDITOR2_ID = '000000000000000000000000000000d4';
const DELEGATED_ID = '000000000000000000000000000000c3';
const NOT_OWN = resolved({
  url: 'https://chzzk.naver.com/video/7654321',
  content: { kind: 'video', videoNo: 7654321 },
  ownership: 'notOwn',
  meta: { ...R.meta, title: '남의 방송', channelName: '다른 채널', channelId: DELEGATED_ID },
});
const WORST = worstCaseResolved();
// 일반 VOD 카드: 맨 끝의 "오디오만" 행(audio-only.md §6.1)
const VOD = vodResolved();
/** 빠른 다시보기 미리보기 장면의 자리표시 playlist 주소(응답은 오지 않는다) */
const HLS_PLAYLIST = 'http://watch.example.invalid/pl.m3u8';
const SLOW_URL = 'https://chzzk.naver.com/video/7777777';

// ───────────────────────── 화면 목록 ─────────────────────────

export interface Screen {
  id: string;
  /** 스냅샷 파일 이름에 쓰는 ASCII 이름 */
  slug: string;
  /** `now`는 시나리오가 쓰는 현재 시각(초). 스냅샷은 고정 시각을 넘겨 글자가 실행마다 같게 한다 */
  scenario(env: Env, now: number): Scenario;
  /** 이 화면의 OS(없으면 환경의 OS). 설정의 OS별 행 확인에 쓴다 */
  os?: Os;
  /** 화면마다 더 확인할 것 */
  extra?(page: Page, os: Os): Promise<void>;
  /** 열고 난 뒤 화면을 그 모습으로 만든다 */
  drive?(app: App, env: Env): Promise<void>;
  /** 이 화면이 다 그려졌다는 표지 */
  ready(page: Page): Locator;
  /** 그려진 뒤 잴 자리로 스크롤한다(토스트·sticky 줄이 가리는 위치를 피해 잰다) */
  settle?(page: Page, env: Env): Promise<void>;
  /** 토스트가 떠 있을 때 정렬선을 잰 상자 */
  alignedToast?: string[];
  /** 정렬선을 실제로 잰 상자(없는 요소를 건너뛰어 검사가 빈 채 통과하지 않게). 툴바 첫 요소는 늘 잰다 */
  aligned?: string[];
  /** 대화상자가 열려 있다 */
  dialog?: boolean;
  /** 토스트를 띄우는 동작(마지막 행 가림 검사). 토스트 전의 화면은 위 검사를 모두 받고, 토스트는 따로 잰다 */
  toastAction?: (app: App) => Promise<void>;
  /** 로그인 화면: 네 요소(와 버튼)가 720×520 기본 글자에서 뷰포트 안 */
  login?: boolean;
  /** 카드 [받기]가 720×520 기본 글자에서 뷰포트 안 */
  card?: boolean;
  /** 이 환경들에서만(이름 목록). 없으면 전부 */
  only?: string[];
}

export const open = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

const loadCard = async (app: App, url: string) => {
  await app.page.getByLabel(t('url.label')).fill(url);
  await open(app.page, t('common.load')).click();
};

// 높이 231에서는 sticky 입력줄·카드 바닥이 화면의 절반을 쓴다. 스크롤 위치는 포커스·레이아웃 순서에 따라 달라지고,
// 입력줄이 카드 머리의 [닫기]를 덮으면 axe가 대상 크기(가려짐)로 잡는다: 카드 머리를 입력줄 바로 아래에 두고 잰다
const settleCardTop = async (page: Page, env: Env) => {
  if (env.vp.height < 400) await page.locator('.video-card').evaluate((el) => el.scrollIntoView({ block: 'start' }));
};

/** 구간 편집 화면(range-editor.md, D67): 카드를 불러와 [구간 편집…]을 눌러 연다. 편집 화면은 body 직속 모달 층이다 */
const editorDialog = (page: Page) => page.getByRole('dialog', { name: t('rangeEditor.title') });
const openEditorScene = async (app: App, env: Env, url: string) => {
  await loadCard(app, url);
  await env.tick?.(CHECK_DEBOUNCE_MS + 50);
  await open(app.page, t('range.edit.label')).click();
  await editorDialog(app.page).waitFor();
};
/** 편집 화면에서 [영상 보기]를 눌러 hls.js 경로로 붙인다(playlist 응답은 끝내 쥐고 있는다) */
const startEditorWatch = async (app: App) => {
  await app.page.route(HLS_PLAYLIST, () => new Promise<void>(() => {}));
  await editorDialog(app.page).locator('.stage').getByRole('button', { name: t('watch.start.label') }).click();
  await expect(editorDialog(app.page).locator('video')).toBeVisible();
};
/** 메타데이터가 읽혔고 길이·재생 위치가 있는 것처럼 만든다(실제 재생은 하지 않는다) */
const loadEditorMeta = (page: Page, time: number) =>
  editorDialog(page)
    .locator('video')
    .evaluate((v: HTMLVideoElement, tm: number) => {
      Object.defineProperty(v, 'duration', { value: 11565, configurable: true });
      Object.defineProperty(v, 'currentTime', { value: tm, configurable: true, writable: true });
      v.dispatchEvent(new Event('loadedmetadata'));
    }, time);

/** 타임라인을 Ctrl+휠로 확대한다(트랙 칸의 `at` 비율 x가 중심). 실제 휠 대신 이벤트를 쏜다: 스냅샷이 마우스 위치에 기대지 않게 */
const zoomEditor = (page: Page, at: number, deltaY = -900) =>
  editorDialog(page)
    .locator('.track')
    .evaluate(
      (el, [ratio, dy]: readonly [number, number]) => {
        const r = el.getBoundingClientRect();
        el.closest('[data-timeline]')!.dispatchEvent(
          new WheelEvent('wheel', { deltaY: dy, ctrlKey: true, clientX: r.left + r.width * ratio, clientY: r.top + 10, bubbles: true, cancelable: true }),
        );
      },
      [at, deltaY] as const,
    );

export const SCREENS: Screen[] = [
  {
    id: '홈 빈 상태(첫 실행)',
    slug: 'home-first',
    scenario: (_env, now) => ({}),
    ready: (p) => p.getByText(t('list.empty.title')),
    aligned: ['입력줄 왼쪽', '입력줄 오른쪽'],
  },
  {
    id: '홈 빈 상태(비운 뒤)',
    slug: 'home-cleared',
    scenario: (_env, now) => ({ settings: { lastUrl: R.url } }),
    ready: (p) => p.getByText(t('list.cleared')),
  },
  {
    id: '홈 최근 영상',
    slug: 'home-recent',
    scenario: (_env, now) => ({ settings: { recentVods: RECENT, lastUrl: RECENT[0].url }, jobs: [job(1, { title: '받는 중인 영상', status: 'running', progress: prog() })] }),
    ready: (p) => p.getByRole('heading', { name: t('recent.title') }),
  },
  {
    id: '홈 불러오는 중',
    slug: 'home-loading',
    scenario: (_env, now) => ({ resolveHold: [SLOW_URL] }),
    drive: async (app) => {
      await loadCard(app, SLOW_URL);
    },
    // 스피너와 한 줄은 LOADER_DELAY_MS 뒤에 나타난다
    ready: (p) => p.getByText(t('resolve.loading')),
  },
  {
    id: '카드 최악 조합',
    slug: 'card-worst',
    scenario: (_env, now) => ({
      resolve: { [WORST.url]: WORST },
      outputs: { [WORST.suggestedFileName]: outputCheck({ exists: true, freeFileName: `${WORST.suggestedFileName} (1)` }) },
      jobs: [job(1, { title: '지난번에 받다 멈춘 영상', status: 'interrupted', partialBytes: 1024, progress: prog() })],
    }),
    drive: async (app, env) => {
      await loadCard(app, WORST.url);
      // 같은 이름 경고까지 그려진 뒤의 모습(check_output은 CHECK_DEBOUNCE_MS 뒤에 불린다)
      await env.tick?.(CHECK_DEBOUNCE_MS + 50);
      await expect(app.page.getByText(t('conflict.exists'))).toBeVisible();
    },
    ready: (p) => p.getByRole('region', { name: WORST_TITLE }),
    settle: settleCardTop,
    aligned: ['입력줄 왼쪽', '배너 왼쪽', '배너 오른쪽', '카드 왼쪽', '카드 오른쪽'],
    card: true,
  },
  {
    id: '카드 일반 VOD 오디오만',
    slug: 'card-vod-audio',
    scenario: () => ({ resolve: { [VOD.url]: VOD } }),
    drive: async (app, env) => {
      await loadCard(app, VOD.url);
      // 오디오만 행을 고른 모습: 이름 칸 확장자가 .m4a, 꼬리표는 비디오 행에만
      await app.page.locator('label').filter({ hasText: t('quality.audioOnly') }).click();
      await env.tick?.(CHECK_DEBOUNCE_MS + 50);
    },
    // 이름 칸 확장자가 바뀌고 검사가 끝나 [받기]가 켜진 뒤(비활성 면의 대비는 잴 대상이 아니다)
    ready: (p) => p.locator('.card-footer button:not([aria-disabled="true"])', { hasText: t('card.download') }),
    settle: settleCardTop,
    card: true,
  },
  {
    id: '카드 미리보기 표지 자리',
    slug: 'card-watch-idle',
    scenario: () => ({ resolve: { [VOD.url]: VOD } }),
    drive: async (app, env) => {
      await loadCard(app, VOD.url);
      await env.tick?.(CHECK_DEBOUNCE_MS + 50);
      // 검사가 끝나 [받기]가 켜진 뒤(비활성 면의 대비는 잴 대상이 아니다)
      await expect(app.page.locator('.card-footer button:not([aria-disabled="true"])', { hasText: t('card.download') })).toBeVisible();
      // 기본 펼침 그대로다: [영상 보기]를 누르기 전에는 watch_open이 없다(PS6·PS8)
    },
    ready: (p) => p.getByRole('button', { name: t('watch.start.label') }),
    settle: settleCardTop,
    card: true,
  },
  {
    id: '카드 구간 줄 전체(빠른 다시보기)',
    slug: 'card-rewind-default',
    scenario: () => ({ resolve: { [R.url]: R } }),
    drive: async (app, env) => {
      await loadCard(app, R.url);
      await env.tick?.(CHECK_DEBOUNCE_MS + 50);
      // 검사가 끝나 [받기]가 켜진 뒤(비활성 면의 대비는 잴 대상이 아니다)
      await expect(open(app.page, t('card.download'))).not.toHaveAttribute('aria-disabled', 'true');
    },
    // 미리보기 섹션 없이 구간 줄 하나("구간 · 전체 [구간 편집…]")만 있다
    ready: (p) => p.getByRole('button', { name: t('range.edit.label') }),
    settle: settleCardTop,
    card: true,
  },
  {
    id: '카드 미리보기 접힘(기억한 상태, 일반 VOD)',
    slug: 'card-section-collapsed',
    scenario: () => ({ resolve: { [VOD.url]: VOD } }),
    drive: async (app, env) => {
      await loadCard(app, VOD.url);
      await env.tick?.(CHECK_DEBOUNCE_MS + 50);
      await app.page.locator('.watch summary').click();
      await expect(open(app.page, t('card.download'))).not.toHaveAttribute('aria-disabled', 'true');
    },
    ready: (p) => p.locator('.watch summary'),
    settle: settleCardTop,
    card: true,
  },
  {
    id: '카드 미리보기 펼침',
    slug: 'card-watch',
    scenario: () => ({ resolve: { [VOD.url]: VOD }, watchSrc: 'data:video/mp4;base64,AAAA' }),
    drive: async (app, env) => {
      await loadCard(app, VOD.url);
      // 실제 재생은 하지 않는다: 웹뷰가 mp4를 읽는다고 하고, 자리표시 주소의 media 오류를 앱이 보기 전에 삼킨다
      await app.page.evaluate(() => {
        HTMLMediaElement.prototype.canPlayType = () => 'maybe';
        window.addEventListener('error', (e) => e.target instanceof HTMLMediaElement && e.stopImmediatePropagation(), true);
      });
      await env.tick?.(CHECK_DEBOUNCE_MS + 50);
      // 검사가 끝나 [받기]가 켜진 뒤(비활성 면의 대비는 잴 대상이 아니다)
      await expect(app.page.locator('.card-footer button:not([aria-disabled="true"])', { hasText: t('card.download') })).toBeVisible();
      await app.page.getByRole('button', { name: t('watch.start.label') }).click();
    },
    ready: (p) => p.locator('video'),
    settle: settleCardTop,
    card: true,
  },
  {
    id: '카드 미리보기 실패',
    slug: 'card-watch-failed',
    scenario: () => ({ resolve: { [VOD.url]: VOD }, watch: 'error' }),
    drive: async (app, env) => {
      await loadCard(app, VOD.url);
      await env.tick?.(CHECK_DEBOUNCE_MS + 50);
      // 검사가 끝나 [받기]가 켜진 뒤(비활성 면의 대비는 잴 대상이 아니다)
      await expect(app.page.locator('.card-footer button:not([aria-disabled="true"])', { hasText: t('card.download') })).toBeVisible();
      await app.page.getByRole('button', { name: t('watch.start.label') }).click();
    },
    ready: (p) => p.getByText(t('watch.error.body')),
    settle: settleCardTop,
    card: true,
  },
  {
    id: '카드 구간 줄(확정 구간)',
    slug: 'card-range',
    scenario: () => ({ resolve: { [R.url]: R } }),
    drive: async (app, env) => {
      await openEditorScene(app, env, R.url);
      // 두 손잡이가 떨어져 있게 넓은 구간을 고른다(붙은 손잡이는 axe 대상 크기 간격에 걸린다)
      await app.page.getByRole('textbox', { name: t('range.start') }).fill('0:10:00');
      await app.page.getByRole('textbox', { name: t('range.end') }).fill('2:30:00');
      await app.page.getByRole('button', { name: new RegExp(t('rangeEditor.apply.label')) }).click();
      await editorDialog(app.page).waitFor({ state: 'hidden' });
      await env.tick?.(CHECK_DEBOUNCE_MS + 50);
    },
    ready: (p) => p.getByText(t('filename.willSaveAs', { name: `${R.suggestedFileName} (0.10.00~2.30.00)` })),
    settle: settleCardTop,
    card: true,
  },
  {
    id: '구간 편집 화면(재생 전)',
    slug: 'editor-idle',
    scenario: () => ({ resolve: { [R.url]: R }, watchSrc: HLS_PLAYLIST }),
    drive: (app, env) => openEditorScene(app, env, R.url),
    // 표지 자리와 [영상 보기], meta 길이로 그린 타임라인, 빈 두 칸과 "전체 길이" 줄
    ready: (p) => editorDialog(p).locator('.range-length').filter({ hasText: /^전체 길이: / }),
  },
  {
    id: '구간 편집 화면(영상과 결합)',
    slug: 'editor-coupled',
    scenario: () => ({ resolve: { [R.url]: R }, watchSrc: HLS_PLAYLIST }),
    drive: async (app, env) => {
      await openEditorScene(app, env, R.url);
      await startEditorWatch(app);
      await loadEditorMeta(app.page, 3000);
      await editorDialog(app.page).getByRole('button', { name: t('watch.mark.start') }).click();
      await editorDialog(app.page).locator('video').evaluate((v: HTMLVideoElement) => {
        (v as unknown as { currentTime: number }).currentTime = 8400;
      });
      await editorDialog(app.page).getByRole('button', { name: t('watch.mark.end') }).click();
      await editorDialog(app.page).locator('video').evaluate((v: HTMLVideoElement) => {
        (v as unknown as { currentTime: number }).currentTime = 5400;
        v.dispatchEvent(new Event('timeupdate'));
      });
    },
    ready: (p) => editorDialog(p).getByRole('slider', { name: t('range.end') }),
  },
  {
    id: '구간 편집 화면(조작 줄·반복 켜짐)',
    slug: 'editor-loop-on',
    scenario: () => ({ resolve: { [R.url]: R }, watchSrc: HLS_PLAYLIST }),
    drive: async (app, env) => {
      await openEditorScene(app, env, R.url);
      await startEditorWatch(app);
      await loadEditorMeta(app.page, 3000);
      await app.page.getByRole('textbox', { name: t('range.start') }).fill('0:50:00');
      await app.page.getByRole('textbox', { name: t('range.end') }).fill('1:20:00');
      await editorDialog(app.page).getByRole('button', { name: t('watch.range.loop.label') }).click();
    },
    // 아이콘 조작 줄 일곱과 반복 토글 켜짐(중립 눌림 면 + 1px 테두리, forced는 Highlight 면). 960·720·320(좁은 레이아웃: 시각 둘이 첫 줄)
    ready: (p) => editorDialog(p).getByRole('button', { name: t('watch.range.loop.label') }).and(p.locator('[aria-pressed="true"]')),
    only: ['라이트 960', '다크 720', 'forced-colors 960', '라이트 320', '아주 크게 320 다크'],
  },
  {
    id: '구간 편집 화면(조작 줄 coarse, 720×520 확대)',
    slug: 'editor-controls-coarse',
    scenario: () => ({ resolve: { [R.url]: R }, watchSrc: HLS_PLAYLIST }),
    drive: async (app, env) => {
      await openEditorScene(app, env, R.url);
      await startEditorWatch(app);
      await loadEditorMeta(app.page, 3000);
      // 이 Chromium 컨텍스트는 any-pointer: coarse를 켜지 않는다: tokens.css [coarse] 블록과 같은 값을 직접 건다
      await app.page.evaluate(() => {
        const r = document.documentElement.style;
        r.setProperty('--control-h', '40px');
        r.setProperty('--control-h-sm', '40px');
        r.setProperty('--hit-min', '40px');
      });
      await app.page.getByRole('textbox', { name: t('range.start') }).fill('1:00:00');
      await app.page.getByRole('textbox', { name: t('range.end') }).fill('2:00:00');
      await zoomEditor(app.page, 0.47, -700);
    },
    // 조작 줄 최소 폭 464가 넘치지 않는지(가로 스크롤 0은 screens.spec의 공통 검사가 본다)
    ready: (p) => editorDialog(p).getByRole('scrollbar'),
    only: ['라이트 720'],
  },
  {
    id: '구간 편집 화면(타임라인 확대)',
    slug: 'editor-zoomed',
    scenario: () => ({ resolve: { [R.url]: R } }),
    drive: async (app, env) => {
      await openEditorScene(app, env, R.url);
      await app.page.getByRole('textbox', { name: t('range.start') }).fill('1:00:00');
      await app.page.getByRole('textbox', { name: t('range.end') }).fill('2:00:00');
      // 구간 가운데(전체의 약 47%)를 중심으로 확대: 범위 막대와 [전체 보기]가 나오고 두 손잡이가 보이는 범위 안에 있다
      await zoomEditor(app.page, 0.47, -700);
    },
    ready: (p) => editorDialog(p).getByRole('scrollbar'),
  },
  {
    id: '구간 편집 화면(손잡이 하나가 화면 밖)',
    slug: 'editor-offscreen-end',
    scenario: () => ({ resolve: { [R.url]: R } }),
    drive: async (app, env) => {
      await openEditorScene(app, env, R.url);
      await app.page.getByRole('textbox', { name: t('range.start') }).fill('0:05:00');
      await app.page.getByRole('textbox', { name: t('range.end') }).fill('2:30:00');
      // 왼쪽 끝을 중심으로 확대하면 끝 손잡이(2:30:00)는 보이는 범위 오른쪽 밖에서 가장자리에 붙는다
      await zoomEditor(app.page, 0.02, -1200);
    },
    ready: (p) => editorDialog(p).getByRole('slider', { name: t('range.end') }).and(p.locator('[data-placement="after"]')),
  },
  {
    id: '구간 편집 화면(손잡이 둘이 같은 쪽 밖)',
    slug: 'editor-offscreen-both',
    scenario: () => ({ resolve: { [R.url]: R } }),
    drive: async (app, env) => {
      await openEditorScene(app, env, R.url);
      await app.page.getByRole('textbox', { name: t('range.start') }).fill('0:10:00');
      await app.page.getByRole('textbox', { name: t('range.end') }).fill('0:40:00');
      // 오른쪽 끝을 중심으로 확대하면 두 손잡이가 모두 왼쪽 밖이라 세로로 반씩 쌓인다
      await zoomEditor(app.page, 0.98, -1200);
    },
    ready: (p) => editorDialog(p).getByRole('slider', { name: t('range.start') }).and(p.locator('[data-stack="top"]')),
  },
  {
    id: '구간 편집 화면(적용 오류)',
    slug: 'editor-error',
    scenario: () => ({ resolve: { [R.url]: R } }),
    drive: async (app, env) => {
      await openEditorScene(app, env, R.url);
      await app.page.getByRole('textbox', { name: t('range.start') }).fill('2:00:00');
      await app.page.getByRole('textbox', { name: t('range.end') }).fill('0:20:00');
      await app.page.getByRole('button', { name: new RegExp(t('rangeEditor.apply.label')) }).click();
    },
    ready: (p) => editorDialog(p).getByRole('alert').filter({ hasText: t('range.error.order') }),
  },
  {
    id: '구간 편집 화면(네이티브 m3u8 대체)',
    slug: 'editor-native',
    scenario: () => ({ resolve: { [R.url]: R }, watchSrc: HLS_PLAYLIST }),
    drive: async (app, env) => {
      await openEditorScene(app, env, R.url);
      // 네이티브 경로는 playlist 주소를 video src로 쓴다: 응답을 끝내 쥐고 있어 이름 풀이 실패가 console.error로 남지 않게 한다
      await app.page.route(HLS_PLAYLIST, () => new Promise<void>(() => {}));
      // hls.js를 못 쓰고 네이티브 m3u8을 읽는 웹뷰를 흉내 낸다(media 오류는 앱이 보기 전에 삼킨다)
      await app.page.evaluate(() => {
        (window as unknown as { MediaSource?: unknown }).MediaSource = undefined;
        HTMLMediaElement.prototype.canPlayType = (type: string) => (type === 'application/vnd.apple.mpegurl' ? 'maybe' : '');
        window.addEventListener('error', (e) => e.target instanceof HTMLMediaElement && e.stopImmediatePropagation(), true);
      });
      await editorDialog(app.page).locator('.stage').getByRole('button', { name: t('watch.start.label') }).click();
    },
    ready: (p) => editorDialog(p).getByText(t('rangeEditor.uncoupled.body')),
  },
  {
    id: '구간 편집 화면(미리보기 실패)',
    slug: 'editor-failed',
    scenario: () => ({ resolve: { [R.url]: R }, watch: 'error' }),
    drive: async (app, env) => {
      await openEditorScene(app, env, R.url);
      await editorDialog(app.page).locator('.stage').getByRole('button', { name: t('watch.start.label') }).click();
    },
    ready: (p) => editorDialog(p).getByText(t('watch.error.body')),
  },
  {
    id: '구간 편집 화면(길이 모름)',
    slug: 'editor-no-length',
    scenario: () => {
      const r = resolved({ meta: { ...R.meta, durationSecs: null } });
      return { resolve: { [r.url]: r } };
    },
    drive: (app, env) => openEditorScene(app, env, R.url),
    ready: (p) => editorDialog(p).getByText(t('rangeEditor.noLength.body')),
  },
  {
    id: '카드 구간 줄(길이 모름)',
    slug: 'card-range-unknown',
    scenario: () => {
      const r = resolved({ meta: { ...R.meta, durationSecs: null } });
      return { resolve: { [r.url]: r } };
    },
    drive: async (app, env) => {
      await loadCard(app, R.url);
      // 검사가 끝나 [받기]가 활성이 된 뒤의 모습(전환 중 색 대비를 피한다)
      await env.tick?.(CHECK_DEBOUNCE_MS + 50);
      await expect(open(app.page, t('card.download'))).not.toHaveAttribute('aria-disabled', 'true');
    },
    ready: (p) => p.getByRole('button', { name: t('range.edit.label') }),
    settle: settleCardTop,
    card: true,
  },
  {
    id: '작업 목록 구간',
    slug: 'jobs-range',
    scenario: () => ({
      jobs: [
        job(1, { title: '구간 받는 영상', status: 'running', progress: prog(), range: { startMs: 600000, endMs: 1200000 } }),
        job(2, { title: '끝까지 받은 구간', status: 'completed', range: { startMs: 600000, endMs: null } }),
      ],
    }),
    ready: (p) => p.getByRole('article', { name: '구간 받는 영상' }),
  },
  {
    id: '작업 목록(상태 전부)',
    slug: 'jobs-all',
    scenario: (_env, now) => ({ auth: SIGNED_IN, jobs: jobStateSet(true, now) }),
    ready: (p) => p.getByRole('article', { name: SAME_PREFIX_TITLES[0] }),
    aligned: ['배너 왼쪽', '배너 오른쪽', '툴바 끝 요소'],
  },
  {
    id: '작업 목록(완료 12개 접힘)',
    slug: 'jobs-folded',
    scenario: (_env, now) => ({ jobs: finishedSet(12) }),
    ready: (p) => p.getByRole('button', { name: t('list.group.finished', { n: 12 }) }),
  },
  {
    id: '작업 목록(완료 12개 펼침)',
    slug: 'jobs-open',
    scenario: (_env, now) => ({ jobs: finishedSet(12) }),
    drive: async (app) => {
      await app.page.getByRole('button', { name: t('list.group.finished', { n: 12 }) }).click();
    },
    ready: (p) => p.getByRole('article', { name: '완료한 영상 1', exact: true }),
  },
  {
    id: '작업 목록(토스트)',
    slug: 'jobs-toast',
    scenario: (_env, now) => ({ jobs: jobStateSet(false, now) }),
    ready: (p) => p.getByRole('article', { name: SAME_PREFIX_TITLES[0] }),
    // 첫 행의 [⋯] › 주소 복사 → 토스트 하나(목록을 지우지 않는다)
    toastAction: async (app) => {
      // 클립보드 권한은 러너마다 달라 성공·실패 토스트가 갈린다: 쓰기를 늘 성공으로 고정해 촬영을 결정적으로 만든다
      await app.page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve() } });
      });
      await app.page.getByRole('button', { name: t('a11y.more', { title: SAME_PREFIX_TITLES[0] }) }).click();
      await app.page.getByRole('menuitem', { name: t('action.copyUrl') }).click();
    },
    alignedToast: ['토스트 왼쪽', '토스트 오른쪽'],
  },
  {
    id: '설정',
    slug: 'settings',
    scenario: (_env, now) => ({ auth: SIGNED_IN, update: { available: AVAILABLE } }),
    drive: async (app) => {
      await open(app.page, t('header.settings')).click();
    },
    ready: (p) => p.getByRole('heading', { name: t('header.settings'), level: 1 }),
    // 모양 행은 Linux에만 있다
    extra: async (p, os) => {
      await expect(p.getByText(t('settings.theme'), { exact: true })).toHaveCount(os === 'linux' ? 1 : 0);
    },
  },
  ...(['macos', 'linux', 'windows'] as const).map(
    (os): Screen => ({
      id: `설정(${os})`,
      slug: `settings-${os}`,
      os,
      scenario: () => ({ auth: SIGNED_IN, update: { available: AVAILABLE } }),
      drive: async (app) => {
        await open(app.page, t('header.settings')).click();
      },
      ready: (p) => p.getByRole('heading', { name: t('header.settings'), level: 1 }),
      extra: async (p) => {
        await expect(p.getByText(t('settings.theme'), { exact: true })).toHaveCount(os === 'linux' ? 1 : 0);
        await expect(p.getByRole('button', { name: revealLabel(os), exact: true })).toBeVisible();
      },
      only: ['라이트 720', '다크 960'],
    }),
  ),
  {
    id: '설정(편집자)',
    slug: 'settings-editors',
    scenario: (_env, now) => ({
      auth: { ...SIGNED_IN, delegatedChannels: [{ channelId: DELEGATED_ID, channelName: '맡긴 채널' }] },
      editors: {
        editors: [
          { channelId: EDITOR_ID, channelName: '편집자 하나', since: now - 13 * 86400, status: 'active' },
          { channelId: EDITOR2_ID, channelName: '편집자 둘', since: now - 86400, status: 'pending' },
        ],
        delegatedChannels: [{ channelId: DELEGATED_ID, channelName: '맡긴 채널', since: now - 13 * 86400 }],
        pendingInviteUntil: null,
        editorsMax: 10,
        delegationsMax: 20,
      },
    }),
    drive: async (app) => {
      await open(app.page, t('header.settings')).click();
      await open(app.page, t('editors.invite.make')).click();
    },
    ready: (p) => p.getByLabel(t('editors.invite.label')),
    only: ['라이트 720', '다크 960', '아주 크게 320 다크'],
  },
  {
    id: '카드(남의 영상)',
    slug: 'card-not-own',
    scenario: (_env, now) => ({
      auth: { ...SIGNED_IN, delegationsCheckedAt: now - 3600 },
      resolve: { [NOT_OWN.url]: NOT_OWN },
    }),
    drive: async (app) => {
      await loadCard(app, NOT_OWN.url);
    },
    ready: (p) => p.getByRole('region', { name: NOT_OWN.meta.title }),
    settle: settleCardTop,
    card: true,
  },
  {
    id: '설정(고급 펼침)',
    slug: 'settings-advanced',
    scenario: (_env, now) => ({}),
    drive: async (app) => {
      await open(app.page, t('header.settings')).click();
      await app.page.locator('summary', { hasText: t('settings.advanced') }).click();
    },
    ready: (p) => p.getByLabel('NID_AUT', { exact: true }),
    only: ['라이트 720', '다크 960', '아주 크게 320 다크'],
  },
  {
    id: '로그인 처음',
    slug: 'login-idle',
    scenario: (_env, now) => ({ auth: auth({ state: 'signedOut' }) }),
    ready: (p) => p.getByRole('heading', { name: t('auth.signedOut.title') }),
    login: true,
  },
  {
    id: '로그인 대기',
    slug: 'login-pending',
    scenario: (_env, now) => ({
      auth: auth({ state: 'pending', pending: { expiresAt: now + 590 } }),
      jobs: [job(1, { title: '받는 중인 영상', status: 'running', progress: prog() })],
    }),
    ready: (p) => p.getByRole('heading', { name: t('auth.pending.title') }),
  },
  {
    id: '로그인 대기(지연)',
    slug: 'login-stuck',
    scenario: (_env, now) => ({ auth: auth({ state: 'pending', pending: { expiresAt: now + 500 } }) }),
    ready: (p) => p.getByText(t('auth.pending.stuck')),
  },
  {
    id: '로그인 거부',
    slug: 'login-denied',
    scenario: (_env, now) => ({ auth: auth({ state: 'denied', channelName: '테스트 채널' }) }),
    ready: (p) => p.getByRole('heading', { name: t('auth.denied.title') }),
  },
  {
    id: '로그인 거부(하루 상한)',
    slug: 'login-daily-limit',
    scenario: (_env, now) => ({ auth: auth({ state: 'denied', reason: 'dailyLimit', channelName: '테스트 채널' }) }),
    ready: (p) => p.getByRole('heading', { name: t('auth.dailyLimit.title') }),
  },
  {
    id: '로그인 거부(차단)',
    slug: 'login-blocked',
    scenario: (_env, now) => ({ auth: auth({ state: 'denied', reason: 'blocked', channelName: '테스트 채널' }) }),
    ready: (p) => p.getByRole('heading', { name: t('auth.blocked.title') }),
  },
  {
    id: 'D1 닫기 확인',
    slug: 'dialog-d1',
    scenario: (_env, now) => ({}),
    drive: async (app) => {
      await app.ctl((c, p) => c.emit('close-requested', p), { running: 2 });
    },
    ready: (p) => p.getByRole('dialog', { name: t('dialog.close.title') }),
    dialog: true,
  },
  {
    id: 'D2 취소 확인',
    slug: 'dialog-d2',
    scenario: (_env, now) => ({ jobs: [job(1, { title: '받는 중인 영상', status: 'running', progress: prog(), partialBytes: 2_469_606_195 })] }),
    drive: async (app) => {
      await open(app.page, t('a11y.cancelJob', { title: '받는 중인 영상' })).click();
    },
    ready: (p) => p.getByRole('dialog', { name: t('dialog.cancel.title', { title: '받는 중인 영상' }) }),
    dialog: true,
  },
  {
    id: 'D8 녹화 마치기 확인',
    slug: 'dialog-d8',
    scenario: (_env, now) => ({
      jobs: [job(1, { title: '녹화 중인 방송', kind: 'live', playbackKind: 'live', status: 'running', progress: liveProg() })],
    }),
    drive: async (app) => {
      await open(app.page, t('action.stopRecording')).click();
    },
    ready: (p) => p.getByRole('dialog', { name: t('dialog.stopLive.title', { title: '녹화 중인 방송' }) }),
    dialog: true,
  },
  {
    id: 'D3 이전 설정 찾음',
    slug: 'dialog-d3',
    scenario: (_env, now) => ({ info: { legacyCandidate: { dir: '/e2e/legacy', recentCount: 3, hasCookies: true } } }),
    ready: (p) => p.getByRole('dialog', { name: t('dialog.legacy.title') }),
    dialog: true,
  },
  {
    id: 'D4 로그아웃 확인',
    slug: 'dialog-d4',
    scenario: (_env, now) => ({ auth: SIGNED_IN }),
    drive: async (app) => {
      await open(app.page, '테스트 채널').click();
      await app.page.getByRole('menuitem', { name: t('account.logout') }).click();
    },
    ready: (p) => p.getByRole('dialog', { name: t('dialog.logout.title') }),
    dialog: true,
  },
  {
    id: 'D5 업데이트 확인',
    slug: 'dialog-d5',
    scenario: (_env, now) => ({ auth: SIGNED_IN, update: { available: AVAILABLE, running: 1 } }),
    drive: async (app) => {
      await open(app.page, t('update.install')).click();
    },
    ready: (p) => p.getByRole('dialog', { name: t('dialog.update.title') }),
    dialog: true,
  },
  {
    id: 'D7 덮어쓰기 확인',
    slug: 'dialog-d7',
    scenario: (_env, now) => ({ jobs: [job(1, { title: '같은 이름이 있어 받지 않은 영상', status: 'skipped', output: '/e2e/videos/같은 이름.mp4', finishedAt: 1_767_322_800 })] }),
    drive: async (app) => {
      await open(app.page, t('action.overwriteAndDownload')).click();
    },
    ready: (p) => p.getByRole('dialog', { name: t('dialog.overwrite.title', { name: '같은 이름.mp4' }) }),
    dialog: true,
  },
];


export function scenarioFor(screen: Screen, env: Env, now = Math.floor(Date.now() / 1000)): Scenario {
  const s = screen.scenario(env, now);
  return { ...s, platform: screen.os ?? env.os, settings: { ...s.settings, textScale: env.xlarge ? 'x-large' : 'default' } };
}
