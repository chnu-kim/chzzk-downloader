// 웹 E2E의 가짜 Rust 백엔드(docs/design/cicd.md §6 "웹 E2E"). `@tauri-apps/api/mocks`의 `mockIPC`로 모든 command를
// 받고, `subscribe_jobs` Channel에는 실제 IPC와 같은 `{index, message}` 모양으로 이벤트를 보낸다.
//
// 시간에 기대지 않는다: 작업은 enqueue되면 `queued`로 들어가고, 그 뒤 진행·완료·실패는 테스트가 `window.__e2e`로
// 하나씩 일으킨다. 앱이 부른 command는 `calls`에 순서대로 남아 테스트가 인자까지 본다.
//
// 이 파일은 Playwright가 `vite build`로 IIFE 하나로 묶어 `page.addInitScript`로 앱보다 먼저 싣는다(e2e/global-setup.ts).
// 앱은 실제 프로덕션 dist(`vite preview`)이고, 두 모듈은 `window.__TAURI_INTERNALS__`에서 만난다.
import { emit } from '@tauri-apps/api/event';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import type {
  AppError,
  AppInfo,
  AuthStatusDto,
  EnqueueRequest,
  ErrorCode,
  JobDto,
  JobEvent,
  OutputCheck,
  ProgressDto,
  ResolvedDto,
  SettingsDto,
  SettingsPatch,
} from '../../src/lib/bindings';

/** 로그인 없이 부를 수 있는 command(crates/shell/src/gate.rs OPEN_COMMANDS와 같다, src/lib/gate-sync.test.ts) */
export const OPEN_COMMANDS = [
  'app_info',
  'auth_cancel',
  'auth_copy_login_url',
  'auth_login',
  'auth_logout',
  'auth_reopen',
  'auth_retry',
  'auth_status',
  'frontend_ready',
  'list_jobs',
  'quit',
  'subscribe_jobs',
];

export const AUTH_DISABLED: AuthStatusDto = {
  state: 'disabled',
  channelId: null,
  channelName: null,
  reason: null,
  pending: null,
  offline: null,
  verifiedAt: null,
};

export type Scenario = {
  /** resolve가 돌려줄 결과(주소 → DTO 또는 오류). 없는 주소는 invalidUrl */
  resolve?: Record<string, ResolvedDto | { error: AppError }>;
  /** 시작할 때 이미 있는 작업(스냅샷) */
  jobs?: JobDto[];
  settings?: Partial<SettingsDto>;
  /** 로그인 상태(없으면 disabled). disabled·signedIn이 아니면 허용 목록 밖 command는 notLoggedIn */
  auth?: AuthStatusDto;
};

export type Call = { cmd: string; args: unknown };

export interface E2EController {
  calls: Call[];
  /** 앱이 구독했는가(스냅샷을 보냈는가) */
  subscribed(): boolean;
  /** 작업을 running으로 바꾸고 진행률을 보낸다 */
  progress(id: number, bytes: number, totalBytes: number): void;
  complete(id: number, finalBytes: number): void;
  fail(id: number, error: AppError, partialBytes?: number | null): void;
  /** Rust가 보내는 앱 이벤트(close-requested 등) */
  emit(event: string, payload: unknown): Promise<void>;
  job(id: number): JobDto | undefined;
  /** 그 주소의 다음 resolve 결과를 바꾼다 */
  setResolve(url: string, r: ResolvedDto | { error: AppError }): void;
  /** 로그인 상태를 바꾸고 auth-changed를 보낸다 */
  setAuth(s: AuthStatusDto): Promise<void>;
}

declare global {
  interface Window {
    __e2e: E2EController;
    __E2E_SCENARIO__?: Scenario;
  }
}

const err = (code: ErrorCode, over: Partial<AppError> = {}): AppError => ({
  code,
  message: code,
  stage: null,
  resumable: false,
  payload: null,
  ...over,
});

export const INFO: AppInfo = {
  version: '0.0.0-e2e',
  coreVersion: '0.0.0-e2e',
  configDir: '/e2e/config',
  dataDir: '/e2e/data',
  logDir: '/e2e/logs',
  defaultDownloadFolder: '/e2e/videos',
  features: { auth: false },
  legacyCandidate: null,
};

export const SETTINGS: SettingsDto = {
  downloadFolder: null,
  effectiveDownloadFolder: '/e2e/videos',
  useNaverCookies: false,
  naverCookiesSaved: false,
  lastQualityLabel: null,
  lastUrl: null,
  recentVods: [],
  segmentConcurrency: 4,
  maxParallelDownloads: 2,
  autoResumeInterrupted: false,
  importedFrom: null,
};

// 코어 Progress와 같은 모양: progressive는 바이트 총량, 빠른 다시보기(HLS)는 조각·미디어 초로 진행을 센다(app jobs.ts progressFraction)
function progressDto(job: JobDto, bytes: number, totalBytes: number): ProgressDto {
  const hls = job.playbackKind === 'liveRewindHls';
  const frac = totalBytes > 0 ? bytes / totalBytes : 0;
  return {
    phase: 'downloading',
    bytes,
    totalBytes: hls ? null : totalBytes,
    totalBytesEstimate: hls ? totalBytes : null,
    segmentsDone: hls ? Math.round(500 * frac) : null,
    segmentsTotal: hls ? 500 : null,
    mediaSecsDone: hls ? Math.round(1000 * frac) : null,
    mediaSecsTotal: hls ? 1000 : null,
    speedBps: 1_000_000,
    etaSecs: 10,
    resumedFrom: 0,
    refreshes: 0,
  };
}

export function install(scenario: Scenario = {}): E2EController {
  mockWindows('main');
  const calls: Call[] = [];
  const resolveTable: NonNullable<Scenario['resolve']> = { ...scenario.resolve };
  let settings: SettingsDto = { ...SETTINGS, ...scenario.settings };
  const jobs = new Map<number, JobDto>((scenario.jobs ?? []).map((j) => [j.id, j]));
  let nextId = Math.max(0, ...jobs.keys()) + 1;
  // 가짜 시계: 작업 생성·완료 시각은 실제 시각이 아니라 고정 값이다(화면의 "완료 · … · 시각"이 실행마다 같게)
  let clock = 1_767_322_800; // 2026-01-02 12:00:00 KST
  let auth: AuthStatusDto = scenario.auth ?? AUTH_DISABLED;
  let channel: { id: number } | null = null;
  let index = 0;

  const send = (message: JobEvent) => {
    if (!channel) return;
    (window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, d: unknown) => void } }).__TAURI_INTERNALS__.runCallback(
      channel.id,
      { index: index++, message },
    );
  };
  const put = (j: JobDto, type: 'added' | 'status' = 'status') => {
    jobs.set(j.id, j);
    send({ type, job: j });
  };
  const must = (id: number): JobDto => {
    const j = jobs.get(id);
    if (!j) throw err('jobNotFound');
    return j;
  };

  const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
    app_info: () => ({ ...INFO, features: { auth: auth.state !== 'disabled' } }),
    get_settings: () => settings,
    update_settings: (a) => {
      settings = { ...settings, ...(a.patch as SettingsPatch) } as SettingsDto;
      if ('downloadFolder' in (a.patch as SettingsPatch)) {
        settings.effectiveDownloadFolder = settings.downloadFolder ?? INFO.defaultDownloadFolder;
      }
      return settings;
    },
    set_naver_cookies: () => (settings = { ...settings, naverCookiesSaved: true, useNaverCookies: true }),
    clear_naver_cookies: () => (settings = { ...settings, naverCookiesSaved: false, useNaverCookies: false }),
    import_legacy: () => null,
    pick_folder: () => null,
    auth_status: () => auth,
    auth_login: () => auth,
    auth_reopen: () => false,
    auth_copy_login_url: () => false,
    auth_cancel: () => auth,
    auth_retry: () => auth,
    auth_logout: () => (auth = auth.state === 'disabled' ? auth : { ...AUTH_DISABLED, state: 'signedOut' }),
    clipboard_link: () => null,
    open_app_folder: () => null,
    frontend_ready: () => null,
    open_output: () => null,
    reveal_output: () => null,
    quit: () => null,
    resolve: (a) => {
      const r = resolveTable[a.url as string];
      if (!r) throw err('invalidUrl');
      if ('error' in r) throw r.error;
      return r;
    },
    check_output: (a): OutputCheck => {
      const folder = (a.folder as string | null) ?? settings.effectiveDownloadFolder;
      const fileName = a.fileName as string;
      const path = `${folder}/${fileName}.mp4`;
      const dup = [...jobs.values()].find((j) => j.output === path && ['queued', 'running', 'pausing', 'paused'].includes(j.status));
      return { fileName, path, truncated: false, exists: false, freeFileName: null, partial: null, duplicateJobId: dup?.id ?? null };
    },
    enqueue: (a): JobDto => {
      const req = a.req as EnqueueRequest;
      const job: JobDto = {
        id: nextId++,
        url: req.url,
        title: req.title,
        channelName: req.channelName,
        kind: req.content.kind,
        playbackKind: req.expectedKind,
        qualityLabel: req.qualityLabel,
        output: `${req.folder ?? settings.effectiveDownloadFolder}/${req.fileName}.mp4`,
        status: 'queued',
        progress: null,
        error: null,
        partialBytes: null,
        finalBytes: null,
        missing: false,
        createdAt: clock++,
        finishedAt: null,
      };
      put(job, 'added');
      return job;
    },
    list_jobs: () => [...jobs.values()],
    subscribe_jobs: (a) => {
      channel = a.onEvent as { id: number };
      index = 0;
      return [...jobs.values()];
    },
    pause_job: (a) => {
      const j = must(a.id as number);
      // 실제 매니저는 pausing을 거쳐 paused가 된다(코어가 `.part`를 정리할 때까지)
      put({ ...j, status: 'pausing' });
      put({ ...j, status: 'paused', partialBytes: j.progress?.bytes ?? 0 });
      return null;
    },
    resume_job: (a) => {
      const j = must(a.id as number);
      put({ ...j, status: 'queued', error: null, partialBytes: a.restart ? null : j.partialBytes });
      return null;
    },
    remove_job: (a) => {
      must(a.id as number);
      jobs.delete(a.id as number);
      send({ type: 'removed', id: a.id as number });
      return null;
    },
    clear_finished: () => {
      for (const j of [...jobs.values()]) {
        if (j.status === 'completed' || (j.status === 'skipped' && j.partialBytes == null)) {
          jobs.delete(j.id);
          send({ type: 'removed', id: j.id });
        }
      }
      return null;
    },
  };

  mockIPC(
    (cmd, payload) => {
      const args = (payload ?? {}) as Record<string, unknown>;
      // Channel 객체는 그대로 기록하면 순환할 수 있어 id만 남긴다
      calls.push({ cmd, args: cmd === 'subscribe_jobs' ? { onEvent: (args.onEvent as { id: number }).id } : JSON.parse(JSON.stringify(args)) });
      if (auth.state !== 'disabled' && auth.state !== 'signedIn' && !OPEN_COMMANDS.includes(cmd)) throw err('notLoggedIn');
      const h = handlers[cmd];
      if (!h) throw err('internal', { message: `e2e mock: 모르는 command ${cmd}` });
      return h(args);
    },
    { shouldMockEvents: true },
  );

  const ctl: E2EController = {
    calls,
    subscribed: () => channel !== null,
    progress(id, bytes, totalBytes) {
      const j = must(id);
      const p = progressDto(j, bytes, totalBytes);
      if (j.status !== 'running') put({ ...j, status: 'running', progress: p });
      else jobs.set(id, { ...j, progress: p });
      send({ type: 'progress', id, progress: p });
    },
    complete(id, finalBytes) {
      put({ ...must(id), status: 'completed', progress: null, finalBytes, finishedAt: clock++ });
    },
    fail(id, error, partialBytes = null) {
      put({ ...must(id), status: 'failed', progress: null, error, partialBytes, finishedAt: clock++ });
    },
    emit: (event, payload) => emit(event, payload),
    job: (id) => jobs.get(id),
    setResolve(url, r) {
      resolveTable[url] = r;
    },
    setAuth(s) {
      auth = s;
      return emit('auth-changed', s);
    },
  };
  window.__e2e = ctl;
  return ctl;
}
