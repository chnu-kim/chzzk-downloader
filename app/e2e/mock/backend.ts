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
  ChannelRefDto,
  ChatOutputCheck,
  ChatStateDto,
  ContentRef,
  EditorsDto,
  EnqueueRequest,
  ErrorCode,
  FileNameTemplatePreview,
  JobDto,
  JobEvent,
  LiveEndDto,
  OnExisting,
  Os,
  OutputCheck,
  ProgressDto,
  ResolvedDto,
  SettingsDto,
  SettingsPatch,
  TimeRangeDto,
  UpdateCheckDto,
  UpdateInfoDto,
} from '../../src/lib/bindings';
import templateGolden from '../../../design/naming/template.json';

/** 기본 파일 이름 규칙(코어 `naming::DEFAULT_TEMPLATE`) */
const DEFAULT_TEMPLATE = '{prefix} {channel} - {title}';

type TemplatePreviewRow = { template: string; linux?: { kind: string; name: string }[]; error?: Record<string, unknown> };

/**
 * 셸 `preview_file_name_template` 흉내. 템플릿 엔진을 다시 구현하지 않고 골든(design/naming/template.json)의
 * `preview` 표를 읽는다(Rust 코어·셸 테스트가 같은 표를 읽어 맞춘다). 표에 없는 입력은 기본 템플릿 결과를 돌려준다.
 */
export function previewTemplate(template: string): FileNameTemplatePreview {
  const rows = templateGolden.preview as TemplatePreviewRow[];
  const row = rows.find((r) => r.template === template) ?? rows.find((r) => r.template === DEFAULT_TEMPLATE)!;
  if (row.error) return { status: 'invalid', error: row.error } as FileNameTemplatePreview;
  return { status: 'ok', names: row.linux } as FileNameTemplatePreview;
}

/** 파일 이름에 쓰는 `H.MM.SS`(셸 `naming::range_suffix`와 같은 모양, 끝을 모르면 `~` 뒤가 빈다) */
function rangeSuffix(r: TimeRangeDto): string {
  const dots = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 3600)}.${String(Math.floor(s / 60) % 60).padStart(2, '0')}.${String(s % 60).padStart(2, '0')}`;
  };
  return ` (${dots(r.startMs)}~${r.endMs == null ? '' : dots(r.endMs)})`;
}

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
  'open_web_page',
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
  canReconnect: false,
  isAdmin: false,
  delegatedChannels: [],
  delegationsCheckedAt: null,
};

export type UpdateScenario = {
  /** update_available가 돌려줄 캐시(자동 확인 결과) */
  available?: UpdateInfoDto | null;
  /** update_check 결과(없으면 upToDate) */
  check?: UpdateCheckDto;
  /** confirmPause 없이 install을 부르면 needsConfirm으로 답할 받는 중 작업 수(0이면 바로 설치) */
  running?: number;
  /** 설치 결과(없으면 restarting). restarting이면 진행 이벤트 started(100)→chunk(50)→chunk(100)→downloaded→installing을 먼저 보낸다 */
  install?: 'restarting' | 'failed' | 'untrusted';
};

export type Scenario = {
  /** resolve가 돌려줄 결과(주소 → DTO 또는 오류). 없는 주소는 invalidUrl */
  resolve?: Record<string, ResolvedDto | { error: AppError }>;
  /** 이 주소들의 resolve는 끝내 답하지 않는다("불러오는 중" 화면을 붙잡아 두는 용도) */
  resolveHold?: string[];
  /** 시작할 때 이미 있는 작업(스냅샷) */
  jobs?: JobDto[];
  settings?: Partial<SettingsDto>;
  /** 로그인 상태(없으면 disabled). disabled·signedIn이 아니면 허용 목록 밖 command는 notLoggedIn */
  auth?: AuthStatusDto;
  /**
   * 저장 세션이 있는 시나리오(held). 로그인 취소가 돌아갈 상태(오프라인 `signedIn`이나 유예 만료 `expired`)다.
   * 없으면 저장 세션이 없는 것으로 보고 취소는 `signedOut`이다(셸 `cancel_login`)
   */
  authHeld?: AuthStatusDto;
  /** 업데이트(update_* command). 없으면 새 버전 없음 */
  update?: UpdateScenario;
  /** editors_list 결과. 없으면 편집자 없음·맡은 채널은 auth.delegatedChannels(since 없음)·한도 10/20 */
  editors?: EditorsDto;
  /** 다음 한 번의 호출을 이 오류로 실패시킨다(command 이름 → 오류). editors_*·delegations_leave·ownership_recheck */
  fail?: Partial<Record<'editors_list' | 'editors_invite' | 'editors_remove' | 'delegations_leave' | 'ownership_recheck', AppError>>;
  /** app_info의 OS(Windows 고정 데이터·단축키 표기·[Finder에서 보기] 분기). 없으면 linux */
  platform?: Os;
  /** app_info의 나머지 필드 덮어쓰기(D3 이전 설정 찾음 `legacyCandidate` 등). `platform`·`textScale`·`theme`은 위 필드와 설정이 이긴다 */
  info?: Partial<AppInfo>;
  /**
   * check_output 결과 덮어쓰기(파일 이름 → 바꿀 필드). 같은 이름 파일(`exists`+`freeFileName`)·받다 만 파일(`partial`)
   * 카드 안내와 D7 덮어쓰기를 그린다. 없는 이름은 충돌 없음이다
   */
  outputs?: Record<string, Partial<OutputCheck>>;
};

export type Call = { cmd: string; args: unknown };

export interface E2EController {
  calls: Call[];
  /** command 처리기가 auth-changed로 낸 상태(state)의 차례 */
  authEvents: string[];
  /** 앱이 구독했는가(스냅샷을 보냈는가) */
  subscribed(): boolean;
  /** 생방송 녹화 진행: 작업을 running으로 바꾸고 녹화한 길이(초)·놓친 조각을 보낸다(전체 길이를 모른다) */
  liveProgress(id: number, bytes: number, recordedSecs: number, gaps?: number): void;
  /** 작업을 running으로 바꾸고 진행률을 보낸다. `phase`를 `waitingNetwork`로 주면 연결 대기(속도·남은 시간 없음)다 */
  progress(id: number, bytes: number, totalBytes: number, phase?: ProgressDto['phase']): void;
  /** 작업을 완료로 바꾼다. 생방송은 끝난 이유·놓친 조각(`liveEnd`)을 줄 수 있다(없으면 null) */
  complete(id: number, finalBytes: number, liveEnd?: LiveEndDto | null): void;
  fail(id: number, error: AppError, partialBytes?: number | null): void;
  /** Rust가 보내는 앱 이벤트(close-requested 등) */
  emit(event: string, payload: unknown): Promise<void>;
  job(id: number): JobDto | undefined;
  /** 그 주소의 다음 resolve 결과를 바꾼다 */
  setResolve(url: string, r: ResolvedDto | { error: AppError }): void;
  /** 로그인 상태를 바꾸고 auth-changed를 보낸다 */
  setAuth(s: AuthStatusDto): Promise<void>;
  /** 맡은 채널을 바꾸고 auth-changed를 보낸다(셸의 /api/me 성공을 흉내) */
  setDelegated(channels: ChannelRefDto[]): Promise<void>;
  /** 다음 한 번의 그 command를 실패시킨다 */
  failNext(cmd: string, error: AppError): void;
  /** main 창 포커스를 바꾼다(Rust `window-focus` 이벤트 흉내, `WindowFocusPayload`) */
  windowFocus(focused: boolean): Promise<void>;
  /** 그 파일 이름의 다음 check_output 결과를 바꾼다(scenario.outputs와 같은 모양) */
  setOutput(fileName: string, over: Partial<OutputCheck>): void;
}

declare global {
  interface Window {
    __e2e: E2EController;
    __E2E_SCENARIO__?: Scenario;
  }
}

/** 받기로 막 생긴 채팅 상태(셸 `ChatState::waiting`) */
const waitingChat = (subtitle: SettingsDto['chatSubtitle'], onExisting: OnExisting): ChatStateDto => ({
  phase: 'waiting',
  subtitle,
  onExisting,
  messages: 0,
  percent: null,
  error: null,
  subtitleFailed: false,
  partialBytes: null,
});

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
  platform: 'linux',
  textScale: 'default',
  theme: 'system',
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
  textScale: 'default',
  theme: 'system',
  keepAwake: true,
  saveChat: false,
  chatSubtitle: 'ass',
  fileNameTemplate: null,
};

// 코어 Progress와 같은 모양: progressive는 바이트 총량, 빠른 다시보기(HLS)는 조각·미디어 초로 진행을 센다(app jobs.ts progressFraction)
function progressDto(job: JobDto, bytes: number, totalBytes: number, phase: ProgressDto['phase'] = 'downloading'): ProgressDto {
  const hls = job.playbackKind === 'liveRewindHls';
  const frac = totalBytes > 0 ? bytes / totalBytes : 0;
  return {
    phase,
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
    liveRecordedSecs: null,
    liveGaps: null,
  };
}

export function install(scenario: Scenario = {}): E2EController {
  mockWindows('main');
  const calls: Call[] = [];
  const resolveTable: NonNullable<Scenario['resolve']> = { ...scenario.resolve };
  const outputs: NonNullable<Scenario['outputs']> = { ...scenario.outputs };
  /** 그 컨텐츠를 푼 resolve 결과(오류 항목은 컨텐츠가 없어 건너뛴다) */
  const resolvedByContent = (c: ContentRef): ResolvedDto | undefined =>
    Object.values(resolveTable).find(
      (r): r is ResolvedDto =>
        !('error' in r) &&
        (r.content.kind === 'video' && c.kind === 'video'
          ? r.content.videoNo === c.videoNo
          : r.content.kind === 'live' && c.kind === 'live'
            ? r.content.channelId === c.channelId
            : r.content.kind === 'clip' && c.kind === 'clip' && r.content.clipId === c.clipId),
    );
  let settings: SettingsDto = { ...SETTINGS, ...scenario.settings };
  const jobs = new Map<number, JobDto>((scenario.jobs ?? []).map((j) => [j.id, j]));
  let nextId = Math.max(0, ...jobs.keys()) + 1;
  // 가짜 시계: 작업 생성·완료 시각은 실제 시각이 아니라 고정 값이다(화면의 "완료 · … · 시각"이 실행마다 같게)
  let clock = 1_767_322_800; // 2026-01-02 12:00:00 KST
  let auth: AuthStatusDto = scenario.auth ?? AUTH_DISABLED;
  let channel: { id: number } | null = null;
  let index = 0;
  /** 다음 한 번씩만 실패시킬 command(failNext·scenario.fail) */
  const failures: Record<string, AppError | undefined> = { ...scenario.fail };
  const takeFail = (cmd: string) => {
    const e = failures[cmd];
    if (!e) return;
    delete failures[cmd];
    throw e;
  };
  /** editors_list가 돌려주는 가변 상태(편집자 빼기·그만두기가 바꾼다). 처음 부를 때 만든다 */
  let editorsState: EditorsDto | null = scenario.editors ? structuredClone(scenario.editors) : null;
  const editorsNow = (): EditorsDto =>
    (editorsState ??= {
      editors: [],
      delegatedChannels: auth.delegatedChannels.map((d) => ({ ...d, since: null })),
      pendingInviteUntil: null,
      editorsMax: 10,
      delegationsMax: 20,
    });

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
  /** 채팅 하위 상태만 바꾸고 `chat` 이벤트를 보낸다(셸 `JobEvent::Chat`) */
  const setChat = (j: JobDto, chat: ChatStateDto) => {
    jobs.set(j.id, { ...j, chat });
    send({ type: 'chat', id: j.id, chat });
  };
  const must = (id: number): JobDto => {
    const j = jobs.get(id);
    if (!j) throw err('jobNotFound');
    return j;
  };

  const authEvents: string[] = [];
  const setAuth = (s: AuthStatusDto) => {
    auth = s;
    authEvents.push(s.state);
    void emit('auth-changed', s);
    return s;
  };

  const resolveUrl = (a: Record<string, unknown>) => {
    if (scenario.resolveHold?.includes(a.url as string)) return new Promise<never>(() => {});
    const r = resolveTable[a.url as string];
    if (!r) throw err('invalidUrl');
    if ('error' in r) throw r.error;
    // 파일 이름 규칙이 있으면 카드의 제안 이름은 그 규칙의 영상 예시 이름이다(셸 `ResolvedDto::new` 흉내)
    if (settings.fileNameTemplate) {
      const p = previewTemplate(settings.fileNameTemplate);
      if (p.status === 'ok') return { ...r, suggestedFileName: p.names[0].name.replace(/\.mp4$/, '') };
    }
    return r;
  };

  const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
    app_info: (): AppInfo => ({
      ...INFO,
      ...scenario.info,
      features: { auth: auth.state !== 'disabled' },
      platform: scenario.platform ?? INFO.platform,
      textScale: settings.textScale,
      theme: settings.theme,
    }),
    // 셸 흉내(App::web_page_url): 앵커는 도움말에만 붙는다. 다른 페이지에 붙이면 invalidInput
    open_web_page: (a) => {
      if (a.anchor != null && a.page !== 'help') throw err('invalidInput');
      return null;
    },
    get_settings: () => settings,
    update_settings: (a) => {
      // 앱이 보낸 인자(calls에 기록됨)를 고치지 않도록 복사한다
      const patch = { ...(a.patch as SettingsPatch) };
      // 셸 흉내: 읽을 수 없는 규칙은 invalidInput, 기본 규칙 문자열은 null(기본)로 저장한다
      if (typeof patch.fileNameTemplate === 'string') {
        if (previewTemplate(patch.fileNameTemplate).status === 'invalid') throw err('invalidInput');
        if (patch.fileNameTemplate.trim() === DEFAULT_TEMPLATE) patch.fileNameTemplate = null;
      }
      settings = { ...settings, ...patch } as SettingsDto;
      if ('downloadFolder' in (a.patch as SettingsPatch)) {
        settings.effectiveDownloadFolder = settings.downloadFolder ?? INFO.defaultDownloadFolder;
      }
      return settings;
    },
    set_naver_cookies: () => (settings = { ...settings, naverCookiesSaved: true, useNaverCookies: true }),
    clear_naver_cookies: () => (settings = { ...settings, naverCookiesSaved: false, useNaverCookies: false }),
    import_legacy: () => null,
    pick_folder: () => null,
    preview_file_name_template: (a) => previewTemplate(a.template as string),
    auth_status: () => auth,
    auth_login: () =>
      auth.state === 'disabled' || auth.state === 'signedIn' || auth.state === 'pending'
        ? auth
        : setAuth({ ...AUTH_DISABLED, state: 'pending', pending: { expiresAt: Math.floor(Date.now() / 1000) + 600 } }),
    auth_reopen: () => auth.state === 'pending',
    auth_copy_login_url: () => auth.state === 'pending',
    auth_cancel: () => (auth.state === 'pending' ? setAuth(scenario.authHeld ?? { ...AUTH_DISABLED, state: 'signedOut' }) : auth),
    // 실물(AuthService::retry)처럼: 저장 세션이 없거나 온라인 signedIn이면 네트워크 없이 지금 상태, 그 밖에는 Checking을 먼저
    // 내고(signedIn·pending은 그대로) 최종 상태를 내며 돌려준다. 최종 상태는 지금 상태다(같은 상태면 [다시 연결]이
    // 아무것도 못 바꾼 것). 다른 결과는 테스트가 setAuth로 정한다
    auth_retry: () => {
      const held = scenario.authHeld != null || auth.state === 'signedIn' || (auth.state === 'expired' && auth.reason === 'graceExpired');
      if (!held || (auth.state === 'signedIn' && !auth.offline)) return auth;
      const last = auth;
      if (last.state !== 'signedIn' && last.state !== 'pending') setAuth({ ...last, state: 'checking', reason: null });
      return setAuth(last);
    },
    auth_logout: () => (auth.state === 'disabled' ? auth : setAuth({ ...AUTH_DISABLED, state: 'signedOut' })),
    update_available: () => scenario.update?.available ?? null,
    update_check: () => scenario.update?.check ?? { result: 'upToDate' },
    update_install: async (a) => {
      const u = scenario.update ?? {};
      if ((u.running ?? 0) > 0 && !a.confirmPause) return { result: 'needsConfirm', running: u.running };
      const r = u.install ?? 'restarting';
      if (r !== 'restarting') return { result: r };
      for (const e of [
        { type: 'started', total: 100 },
        { type: 'chunk', received: 50, total: 100 },
        { type: 'chunk', received: 100, total: 100 },
        { type: 'downloaded' },
        { type: 'installing' },
      ]) {
        await emit('update-progress', e);
      }
      return { result: 'restarting' };
    },
    clipboard_link: () => null,
    open_app_folder: () => null,
    frontend_ready: () => null,
    open_output: () => null,
    reveal_output: () => null,
    quit: () => null,
    resolve: (a) => resolveUrl(a),
    // 편집자 위임(①-4 command, ①-5 화면): 셸 command 이름·모양만 흉내 낸다
    editors_list: (): EditorsDto => {
      takeFail('editors_list');
      return editorsNow();
    },
    // 가짜 주소(.invalid)
    editors_invite: () => {
      takeFail('editors_invite');
      const expiresAt = clock + 7 * 86400;
      editorsNow().pendingInviteUntil = expiresAt;
      return { url: `https://worker.example.invalid/invite/cdi_${'A'.repeat(43)}`, expiresAt };
    },
    editors_remove: (a) => {
      takeFail('editors_remove');
      const e = editorsNow();
      e.editors = e.editors.filter((x) => x.channelId.toLowerCase() !== String(a.channelId).toLowerCase());
      return null;
    },
    delegations_leave: (a) => {
      takeFail('delegations_leave');
      const id = String(a.channelId).toLowerCase();
      const e = editorsNow();
      e.delegatedChannels = e.delegatedChannels.filter((x) => x.channelId.toLowerCase() !== id);
      setAuth({ ...auth, delegatedChannels: auth.delegatedChannels.filter((x) => x.channelId.toLowerCase() !== id) });
      return null;
    },
    // 셸은 서버에 맡은 채널을 다시 묻고(확인 시각이 갱신된다) 같은 주소를 다시 불러온다
    ownership_recheck: (a) => {
      takeFail('ownership_recheck');
      setAuth({ ...auth, delegationsCheckedAt: clock });
      return resolveUrl(a);
    },
    check_output: (a): OutputCheck => {
      const folder = (a.folder as string | null) ?? settings.effectiveDownloadFolder;
      const fileName = a.fileName as string;
      // 셸 흉내(range.md §4.2): 구간이 있으면 이름 끝에 ` (H.MM.SS~H.MM.SS)`를 붙이고 `truncated`가 true다(번호 이름은 흉내 내지 않는다)
      const range = a.range as TimeRangeDto | null | undefined;
      const finalName = range ? `${fileName}${rangeSuffix(range)}` : fileName;
      const path = `${folder}/${finalName}.mp4`;
      const dup = [...jobs.values()].find((j) => j.output === path && ['queued', 'running', 'pausing', 'paused'].includes(j.status));
      const over = outputs[fileName];
      const r: OutputCheck = {
        fileName: finalName,
        path,
        truncated: finalName !== fileName,
        exists: false,
        freeFileName: null,
        partial: null,
        duplicateJobId: dup?.id ?? null,
        conflictNames: [],
        ...over,
      };
      // 셸 흉내(chat.md §4.4): 시나리오가 이름을 주지 않았으면 같은 이름의 영상 하나가 겹친다(채팅 파일은 흉내 내지 않는다)
      if (r.exists && over?.conflictNames === undefined) r.conflictNames = [`${finalName}.mp4`];
      return r;
    },
    // 셸 흉내(chat.md §4.5): 채팅 파일 충돌은 흉내 내지 않는다(늘 없음). 완료가 아니면 invalidInput
    check_chat_output: (a): ChatOutputCheck => {
      const j = must(a.id as number);
      if (j.status !== 'completed' || j.kind !== 'video') throw err('invalidInput');
      return { conflictNames: [] };
    },
    // 셸 흉내: 완료된 영상의 채팅을 줄 세운다(waiting). 실제 수집은 흉내 내지 않는다
    fetch_chat: (a) => {
      const j = must(a.id as number);
      if (j.status !== 'completed' || j.kind !== 'video' || j.range) throw err('invalidInput');
      if (j.chat?.phase === 'waiting' || j.chat?.phase === 'running') return null;
      setChat(j, waitingChat(settings.chatSubtitle, a.onExisting as OnExisting));
      return null;
    },
    pause_chat: (a) => {
      const j = must(a.id as number);
      if (!j.chat) throw err('invalidInput');
      if (j.chat.phase === 'waiting' || j.chat.phase === 'running') setChat(j, { ...j.chat, phase: 'paused' });
      return null;
    },
    enqueue: (a): JobDto => {
      const req = a.req as EnqueueRequest;
      // 셸 흉내(A5): 로그인한 채널이 있으면 resolve 결과로 판정하고, 웹뷰가 보낸 channelId 대신 검증한 채널을 기록한다
      let channelId = req.channelId;
      if (auth.state === 'signedIn' && auth.channelId) {
        // 진짜 셸처럼 주소가 아니라 컨텐츠로 판정한다(캐시 미스면 다시 resolve). 표에 그 컨텐츠가 없으면 resolve와 같이
        // 실패시켜 판정을 건너뛰지 않는다
        const r = resolvedByContent(req.content);
        if (!r) throw err('invalidUrl');
        if (r.ownership === 'notOwn') throw err('notOwnContent');
        if (r.ownership === 'unknown') throw err('ownershipUnknown');
        channelId = r.meta.channelId;
      }
      const job: JobDto = {
        id: nextId++,
        url: req.url,
        title: req.title,
        channelName: req.channelName,
        channelId,
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
        stoppedAt: null,
        range: req.range ?? null,
        liveEnd: null,
        // 셸 흉내: 채팅을 고르면 영상이 끝나기를 기다린다(클립·생방송·구간은 셸이 invalidInput으로 거부한다)
        chat: req.saveChat ? waitingChat(settings.chatSubtitle, req.onExisting) : null,
      };
      if (req.saveChat && (req.content.kind !== 'video' || req.range)) throw err('invalidInput');
      put(job, 'added');
      return job;
    },
    list_jobs: () => [...jobs.values()],
    subscribe_jobs: (a) => {
      channel = a.onEvent as { id: number };
      index = 0;
      return [...jobs.values()];
    },
    // 셸 흉내: 생방송 녹화를 멈추고 받은 만큼 마무리한다(running → pausing → completed). 생방송이 아니면 invalidInput
    stop_job: (a) => {
      const j = must(a.id as number);
      if (j.playbackKind !== 'live') throw err('invalidInput');
      put({ ...j, status: 'pausing' });
      put({
        ...j,
        status: 'completed',
        progress: null,
        finalBytes: j.progress?.bytes ?? 0,
        finishedAt: clock++,
        // 진짜 셸: 코어가 `stopped`와 구멍 수를 준다
        liveEnd: { reason: 'stopped', gaps: j.progress?.liveGaps ?? 0 },
      });
      return null;
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
      // 셸 흉내(A5): 다시 줄 세울 상태에서는 작업의 영상을 다시 판정한다. JobDto에는 컨텐츠가 없어 기록 채널로 흉내 낸다:
      // 다른 채널이면 거부하고, 채널이 없는 옛 작업은 셸이 본인 영상으로 판정한 것으로 본다
      if (auth.state === 'signedIn' && auth.channelId && !auth.isAdmin && ['paused', 'failed', 'interrupted', 'skipped'].includes(j.status)) {
        // 맡은 채널의 영상·클립은 통과한다(생방송은 v1에서 맡은 채널로 받지 않는다)
        const delegated = j.kind !== 'live' && auth.delegatedChannels.some((d) => d.channelId.toLowerCase() === j.channelId?.toLowerCase());
        if (j.channelId != null && !delegated && j.channelId.toLowerCase() !== auth.channelId.toLowerCase()) throw err('notOwnContent');
      }
      // 셸 흉내(core.md 61): 받다 만 녹화는 "처음부터"로 지우지 않는다
      const requeueable = ['paused', 'failed', 'interrupted', 'skipped'].includes(j.status);
      if (a.restart && requeueable && j.playbackKind === 'live' && (j.partialBytes ?? 0) > 0) throw err('invalidInput');
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
    authEvents,
    subscribed: () => channel !== null,
    progress(id, bytes, totalBytes, phase = 'downloading') {
      const j = must(id);
      const p = progressDto(j, bytes, totalBytes, phase);
      if (j.status !== 'running') put({ ...j, status: 'running', progress: p });
      else jobs.set(id, { ...j, progress: p });
      send({ type: 'progress', id, progress: p });
    },
    liveProgress(id, bytes, recordedSecs, gaps = 0) {
      const j = must(id);
      const p: ProgressDto = {
        phase: 'downloading',
        bytes,
        totalBytes: null,
        totalBytesEstimate: null,
        segmentsDone: null,
        segmentsTotal: null,
        mediaSecsDone: null,
        mediaSecsTotal: null,
        speedBps: 1_000_000,
        etaSecs: null,
        resumedFrom: 0,
        refreshes: 0,
        liveRecordedSecs: recordedSecs,
        liveGaps: gaps,
      };
      if (j.status !== 'running') put({ ...j, status: 'running', progress: p });
      else jobs.set(id, { ...j, progress: p });
      send({ type: 'progress', id, progress: p });
    },
    complete(id, finalBytes, liveEnd = null) {
      put({ ...must(id), status: 'completed', progress: null, finalBytes, finishedAt: clock++, liveEnd });
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
    setDelegated(channels) {
      auth = { ...auth, delegatedChannels: channels, delegationsCheckedAt: clock };
      const e = editorsNow();
      e.delegatedChannels = channels.map((c) => e.delegatedChannels.find((d) => d.channelId === c.channelId) ?? { ...c, since: null });
      return emit('auth-changed', auth);
    },
    failNext(cmd, error) {
      failures[cmd] = error;
    },
    windowFocus: (focused) => emit('window-focus', { focused }),
    setOutput(fileName, over) {
      outputs[fileName] = over;
    },
  };
  window.__e2e = ctl;
  return ctl;
}
