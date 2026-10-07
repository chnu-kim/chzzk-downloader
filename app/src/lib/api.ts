// `invoke`를 부르는 유일한 파일(app.md §4). 인자 이름은 Tauri v2 기본대로 camelCase다.
// 모든 함수는 실패하면 `AppError`를 던진다: ACL 거부처럼 문자열로 오는 것과 `cancelled`는 `internal`로 바꾼다
// (`toAppError`). 그래서 호출하는 쪽은 `catch (e)`의 `e`를 `AppError`로 다룬다.
import { Channel, invoke, type InvokeArgs } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  AppFolder,
  AppInfo,
  CloseRequestedPayload,
  AuthStatusDto,
  ContentRef,
  EnqueueRequest,
  JobDto,
  JobEvent,
  JobId,
  LegacyImportDto,
  OutputCheck,
  PlaybackKind,
  ResolvedDto,
  SettingsDto,
  SettingsPatch,
} from './bindings';
import { toAppError } from './copy/errors';

export { isAppError, toAppError } from './copy/errors';

async function call<T>(cmd: string, args?: InvokeArgs): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toAppError(e);
  }
}

export interface CheckOutputArgs {
  folder: string | null;
  fileName: string;
  content: ContentRef;
  qualityId: string;
  expectedKind: PlaybackKind;
}

export const appInfo = () => call<AppInfo>('app_info');
export const getSettings = () => call<SettingsDto>('get_settings');
export const updateSettings = (patch: SettingsPatch) => call<SettingsDto>('update_settings', { patch });
export const setNaverCookies = (nidAut: string, nidSes: string) =>
  call<SettingsDto>('set_naver_cookies', { nidAut, nidSes });
export const clearNaverCookies = () => call<SettingsDto>('clear_naver_cookies');
export const importLegacy = (dir: string | null) => call<LegacyImportDto | null>('import_legacy', { dir });
export const pickFolder = (initial?: string) =>
  call<string | null>('pick_folder', { initial: initial ?? null });
export const resolve = (url: string) => call<ResolvedDto>('resolve', { url });
export const checkOutput = (a: CheckOutputArgs) => call<OutputCheck>('check_output', { ...a });
export const enqueue = (req: EnqueueRequest) => call<JobDto>('enqueue', { req });
export const listJobs = () => call<JobDto[]>('list_jobs');
export const subscribeJobs = (onEvent: Channel<JobEvent>) => call<JobDto[]>('subscribe_jobs', { onEvent });
export const pauseJob = (id: JobId) => call<void>('pause_job', { id });
export const resumeJob = (id: JobId, restart = false) => call<void>('resume_job', { id, restart });
export const removeJob = (id: JobId) => call<void>('remove_job', { id });
export const clearFinished = () => call<void>('clear_finished');
export const openOutput = (id: JobId) => call<void>('open_output', { id });
export const revealOutput = (id: JobId) => call<void>('reveal_output', { id });
export const quit = () => call<void>('quit');
export const authStatus = () => call<AuthStatusDto>('auth_status');
/** 로그인 시작: 확인 페이지를 브라우저로 열고 폴링한다(worker.md §11.4). 상태는 auth-changed로도 온다 */
export const authLogin = () => call<AuthStatusDto>('auth_login');
/** 같은 로그인 주소를 브라우저로 다시 연다. 대기 중이 아니면 false */
export const authReopen = () => call<boolean>('auth_reopen');
/** 로그인 주소를 클립보드에 쓴다(Rust). 대기 중이 아니면 false */
export const authCopyLoginUrl = () => call<boolean>('auth_copy_login_url');
export const authCancel = () => call<AuthStatusDto>('auth_cancel');
/** [다시 연결]: 지금 서버로 다시 확인한다 */
export const authRetry = () => call<AuthStatusDto>('auth_retry');
/** 로그아웃. 받던 다운로드는 계속된다 */
export const authLogout = () => call<AuthStatusDto>('auth_logout');
/**
 * 클립보드에 치지직 VOD·클립 주소가 있으면 그 주소 하나, 없으면 `null`(app.md 구현 중 변경 37).
 * 클립보드의 다른 글은 Rust 밖으로 나오지 않는다.
 */
export const clipboardLink = () => call<string | null>('clipboard_link');
/** 설정·로그·저장 폴더를 파일 탐색기로 연다(S2). 저장 폴더가 아직 없으면 Rust가 만든다. */
export const openAppFolder = (kind: AppFolder) => call<void>('open_app_folder', { kind });
/** 첫 화면을 그렸다는 신호(`ready.ts`가 한 번만 부른다). 보통 실행은 아무 일도 없고 `--smoke`면 앱이 끝난다 */
export const frontendReady = () => call<void>('frontend_ready');

/** Rust가 창 닫기·앱 종료를 막았다는 이벤트 이름(§4). 받는 중인 작업 수와 함께 온다(D1) */
export const CLOSE_REQUESTED = 'close-requested';

/** `close-requested`를 듣는다. 돌려준 함수로 그만 듣는다 */
export const onCloseRequested = (cb: (running: number) => void): Promise<UnlistenFn> =>
  listen<CloseRequestedPayload>(CLOSE_REQUESTED, (e) => cb(e.payload.running));

/** 로그인 상태가 바뀔 때마다 오는 이벤트(처음 상태 포함). 먼저 듣고 그다음 authStatus()를 부른다(사이에 온 변화를 놓치지 않게) */
export const AUTH_CHANGED = 'auth-changed';
export const onAuthChanged = (cb: (s: AuthStatusDto) => void): Promise<UnlistenFn> =>
  listen<AuthStatusDto>(AUTH_CHANGED, (e) => cb(e.payload));

export { Channel };
