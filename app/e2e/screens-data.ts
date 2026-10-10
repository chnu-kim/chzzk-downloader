// 화면 갤러리가 여는 화면과 환경의 표(screens.spec.ts가 검사하고 shots.spec.ts가 찍는다). 이 파일은 Playwright가 Node에서 읽는다:
// 화면 글자는 모두 e2e/copy.ts(copy deck)에서 오고, 데이터는 합성이다(실제 채널·영상 값 아님).
import type { Page, Locator } from '@playwright/test';
import type { AuthStatusDto, Os, RecentVodDto, UpdateInfoDto } from '../src/lib/bindings';
import { check as outputCheck, resolved, worstCaseResolved, WORST_TITLE } from '../src/test/fixtures';
import { finishedSet, job, jobStateSet, MY_CHANNEL_ID, prog, SAME_PREFIX_TITLES } from '../src/test/jobFixtures';
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

const EMPTY_AUTH = { channelId: null, channelName: null, reason: null, pending: null, offline: null, verifiedAt: null, canReconnect: false } as const;
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
const WORST = worstCaseResolved();
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
  await open(app.page, t('url.submit')).click();
};

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
    // 높이 231에서는 sticky 입력줄·카드 바닥이 화면의 절반을 쓴다: 카드 머리를 입력줄 바로 아래에 두고 잰다
    settle: async (page, env) => {
      if (env.vp.height < 400) await page.locator('.video-card').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    },
    aligned: ['입력줄 왼쪽', '배너 왼쪽', '배너 오른쪽', '카드 왼쪽', '카드 오른쪽'],
    card: true,
  },
  {
    id: '작업 목록(상태 전부)',
    slug: 'jobs-all',
    scenario: (_env, now) => ({ auth: SIGNED_IN, jobs: jobStateSet(true) }),
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
    scenario: (_env, now) => ({ jobs: jobStateSet(false) }),
    ready: (p) => p.getByRole('article', { name: SAME_PREFIX_TITLES[0] }),
    // 첫 행의 [⋯] › 주소 복사 → 토스트 하나(목록을 지우지 않는다)
    toastAction: async (app) => {
      // 클립보드 권한은 러너마다 달라 성공·실패 토스트가 갈린다: 쓰기를 늘 성공으로 고정해 촬영을 결정적으로 만든다
      await app.page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve() } });
      });
      await app.page.getByRole('button', { name: t('job.more', { title: SAME_PREFIX_TITLES[0] }) }).click();
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
    ready: (p) => p.getByRole('heading', { name: t('settings.title'), level: 1 }),
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
      ready: (p) => p.getByRole('heading', { name: t('settings.title'), level: 1 }),
      extra: async (p) => {
        await expect(p.getByText(t('settings.theme'), { exact: true })).toHaveCount(os === 'linux' ? 1 : 0);
        await expect(p.getByRole('button', { name: revealLabel(os), exact: true })).toBeVisible();
      },
      only: ['라이트 720', '다크 960'],
    }),
  ),
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
      await open(app.page, t('action.cancel')).click();
    },
    ready: (p) => p.getByRole('dialog', { name: t('dialog.cancel.title') }),
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
