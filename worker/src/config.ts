// 설정 파싱·검증(docs/design/worker.md §10.1, A11). 순수 함수다: env 객체만 받고 바깥을 부르지 않는다.
//
// 실패하면 모든 경로가 500 config_error(/health는 503)이고, 응답에는 이름·값이 없다. 로그에는 어긋난 키 이름만 남는다.
//   - dev 모드 = PUBLIC_ORIGIN의 호스트가 루프백(localhost·127.0.0.1·[::1]). 그때만 치지직 주소를 덮어쓸 수 있고
//     START_RATE_10M을 읽는다.
//   - 운영 모드: PUBLIC_ORIGIN은 https, 치지직 주소는 없거나 운영 값과 정확히 같고, 클라이언트 id·secret·CI 토큰이 있어야 한다.
//   - ADMIN_CHANNEL_IDS가 비어 있으면 부트스트랩 모드(§8.3), 있으면 쉼표로 나눈 32자리 소문자 hex만.
//   - dev 모드에서는 CHZZK_REDIRECT_URI가 있어야 하고 치지직 앱에 등록된 개발용 값(DEV_REDIRECT_URI)과 바이트까지 같아야 한다.
//     운영 모드에서는 이 키가 있으면 오류다(운영 redirectUri는 PUBLIC_ORIGIN이 원천, 구현 중 변경 12 (라)·27 (다)).
//   - dev 모드에서 CONFIG_KEYS 밖의 문자열 바인딩이 있으면 오류다(공용 1Password Environment에 다른 서비스의 키가 섞인 경우,
//     구현 중 변경 12 (라)·27 (라)). 결과에는 키 이름만 있고 값은 어디에도 없다. 운영 모드는 검사하지 않는다.
//     예외는 @cloudflare/vitest-plugin 1.4.0이 테스트 env에 넣는 내부 문자열 바인딩 한 개뿐이다(TEST_RUNTIME_KEYS, 구현 중 변경 108).

// 코드가 읽는 키 전부. worker/.dev.vars.example의 키 집합과 같아야 한다(scripts/ci/worker-config.mjs가 이 배열을 읽어 비교한다).
export const CONFIG_KEYS = [
  "PUBLIC_ORIGIN",
  "CHZZK_REDIRECT_URI",
  "CHZZK_AUTHORIZE_URL",
  "CHZZK_API_BASE",
  "CHZZK_CLIENT_ID",
  "CHZZK_CLIENT_SECRET",
  "ADMIN_CHANNEL_IDS",
  "CI_VERIFY_TOKEN",
  "BUILD_ID",
  "START_RATE_10M",
] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];
export type ConfigEnv = Partial<Record<ConfigKey, unknown>>;

// 운영 치지직 주소(공개 값, wrangler.jsonc vars와 같다)
export const PROD_AUTHORIZE_URL = "https://chzzk.naver.com/account-interlock";
export const PROD_API_BASE = "https://openapi.chzzk.naver.com";
// 치지직 앱에 등록된 리디렉션은 PUBLIC_ORIGIN + 이 경로와 바이트가 같아야 한다(개발용은 http://localhost:8787/auth/callback)
export const CALLBACK_PATH = "/auth/callback";
// dev 모드의 등록된 개발용 리디렉션 URL. 콜백 경로를 바꾸면 등록 값과 어긋나 여기서 드러난다(구현 중 변경 27 (다))
export const DEV_ORIGIN = "http://localhost:8787";
export const DEV_REDIRECT_URI = DEV_ORIGIN + CALLBACK_PATH;
// 운영의 /auth/start IP당 10분 한도(§5). dev 모드에서만 START_RATE_10M으로 바꿀 수 있다
export const DEFAULT_START_RATE_10M = 6;
// 운영에서 앱 편집자 API(/api/editors/*·/api/delegations/leave)를 여는가(worker.md 구현 중 변경 106 (차) ⑤ → 107).
// 릴리스 A(Worker 전용)는 닫혀 나갔고 초대 UI를 여는 앱 릴리스 B(①-5)가 연다. 되돌리려면 false로 바꿔 배포한다
// (닫히면 세 API가 Bearer보다 먼저 404 not_enabled, 앱은 '아직 쓸 수 없음'으로 다룬다).
// dev 모드(루프백 출처: vitest·worker-e2e·pnpm dev)는 늘 연다. 배포 변수가 아니라 코드 상수인 까닭: wrangler deploy가 vars를 새로 쓰므로
// 변수로 두어도 켜고 끄는 길은 배포 하나뿐이고, vars 불변식(worker-config.mjs PROD_VARS)을 넓히지 않는다
export const EDITOR_API_PROD = true;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const CHANNEL_ID = /^[0-9a-f]{32}$/;
const BUILD_ID = /^[0-9A-Za-z._-]{1,40}$/;
const START_RATE = /^[1-9][0-9]{0,6}$/;
// 결과·로그에 실을 수 있는 키 이름 모양. 아니면 이름도 싣지 않는다
const KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export interface Config {
  /** 요청 출처와 정확히 같아야 하는 Worker 출처(경로·끝 슬래시 없음) */
  readonly publicOrigin: string;
  /** 루프백 출처(로컬 개발·테스트) */
  readonly devMode: boolean;
  readonly redirectUri: string;
  readonly authorizeUrl: string;
  readonly apiBase: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly adminChannelIds: readonly string[];
  /** ADMIN_CHANNEL_IDS가 비어 있음: 모든 로그인 거부, /health에 bootstrap:true */
  readonly bootstrap: boolean;
  readonly ciVerifyToken: string;
  readonly buildId: string | null;
  readonly startRate10m: number;
  /** 앱 편집자 API가 열려 있다(dev 모드 또는 EDITOR_API_PROD) */
  readonly editorApi: boolean;
}

export type ConfigResult = { readonly ok: true; readonly config: Config } | { readonly ok: false; readonly key: string };

class ConfigError extends Error {
  constructor(readonly key: string) {
    super("config_error");
  }
}

// 빈 문자열은 없는 것과 같다. 문자열이 아닌 값(JSON vars)은 설정 오류다.
function read(env: ConfigEnv, key: ConfigKey): string | undefined {
  const v = env[key];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") throw new ConfigError(key);
  return v;
}

function parseOrigin(key: ConfigKey, text: string | undefined): URL {
  if (text === undefined) throw new ConfigError(key);
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    throw new ConfigError(key);
  }
  // 직렬화한 출처와 글자가 같아야 한다(끝 슬래시·경로·기본 포트·대문자·자격 정보가 있으면 거부): redirectUri가 바이트 단위로 맞아야 한다
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.origin !== text) throw new ConfigError(key);
  return u;
}

// dev 모드의 치지직 주소: http(s) 절대 URL이면 호스트는 자유(가짜 치지직)
function parseDevUrl(key: ConfigKey, text: string): string {
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    throw new ConfigError(key);
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username !== "" || u.password !== "") throw new ConfigError(key);
  return text;
}

function chzzkUrl(env: ConfigEnv, key: ConfigKey, prod: string, devMode: boolean): string {
  const v = read(env, key);
  if (v === undefined) return prod;
  if (devMode) return parseDevUrl(key, v);
  if (v !== prod) throw new ConfigError(key);
  return v;
}

function required(env: ConfigEnv, key: ConfigKey, devMode: boolean): string {
  const v = read(env, key);
  if (v === undefined && !devMode) throw new ConfigError(key);
  return v ?? "";
}

function adminIds(env: ConfigEnv): string[] {
  const v = read(env, "ADMIN_CHANNEL_IDS");
  if (v === undefined) return [];
  const ids = v.split(",").map((s) => s.trim());
  if (ids.some((id) => !CHANNEL_ID.test(id))) throw new ConfigError("ADMIN_CHANNEL_IDS");
  return [...new Set(ids)];
}

function startRate(env: ConfigEnv, devMode: boolean): number {
  const v = read(env, "START_RATE_10M");
  if (v === undefined) return DEFAULT_START_RATE_10M;
  // 운영 한도는 늘 6이다. 운영 설정에 이 키가 있으면 배포 실수이므로 거부한다
  if (!devMode || !START_RATE.test(v)) throw new ConfigError("START_RATE_10M");
  return Number(v);
}

function buildId(env: ConfigEnv): string | null {
  const v = read(env, "BUILD_ID");
  if (v === undefined) return null;
  if (!BUILD_ID.test(v)) throw new ConfigError("BUILD_ID");
  return v;
}

// vitest 플러그인(@cloudflare/vitest-plugin 1.4.0 이상)이 테스트 env에 문자열로 넣는 내부 바인딩. 글자가 정확히 같은 것만 허용한다
// (접두 허용은 하지 않는다: 플러그인을 올려 새 키가 생기면 여기서 멈추고 사람이 본다)
const TEST_RUNTIME_KEYS: ReadonlySet<string> = new Set(["__VITEST_POOL_WORKERS_VITEST_MAJOR_VERSION"]);

// dev 모드: CONFIG_KEYS 밖의 문자열 바인딩이 있으면 이름 정렬의 첫 키로 오류. object 바인딩(DO·R2·테스트 내부)은 보지 않는다
function rejectUnknownStrings(env: ConfigEnv): void {
  const all = env as Readonly<Record<string, unknown>>;
  const known = new Set<string>(CONFIG_KEYS);
  const bad = Object.keys(all)
    .filter((k) => !known.has(k) && !TEST_RUNTIME_KEYS.has(k) && typeof all[k] === "string")
    .sort();
  const first = bad[0];
  if (first !== undefined) throw new ConfigError(KEY_NAME.test(first) ? first : "(invalid_key_name)");
}

// dev는 등록 값과 같아야 하고, 운영은 없어야 한다. 문자열이 아닌 값은 read가 같은 키로 거부한다
function checkRedirectUri(env: ConfigEnv, devMode: boolean): void {
  const reg = read(env, "CHZZK_REDIRECT_URI");
  if (devMode ? reg !== DEV_REDIRECT_URI : reg !== undefined) throw new ConfigError("CHZZK_REDIRECT_URI");
}

function parse(env: ConfigEnv): Config {
  const origin = parseOrigin("PUBLIC_ORIGIN", read(env, "PUBLIC_ORIGIN"));
  const devMode = LOOPBACK_HOSTS.has(origin.hostname);
  if (!devMode && origin.protocol !== "https:") throw new ConfigError("PUBLIC_ORIGIN");
  if (devMode) rejectUnknownStrings(env);
  checkRedirectUri(env, devMode);
  const admins = adminIds(env);
  return {
    publicOrigin: origin.origin,
    devMode,
    redirectUri: origin.origin + CALLBACK_PATH,
    authorizeUrl: chzzkUrl(env, "CHZZK_AUTHORIZE_URL", PROD_AUTHORIZE_URL, devMode),
    apiBase: chzzkUrl(env, "CHZZK_API_BASE", PROD_API_BASE, devMode),
    clientId: required(env, "CHZZK_CLIENT_ID", devMode),
    clientSecret: required(env, "CHZZK_CLIENT_SECRET", devMode),
    adminChannelIds: admins,
    bootstrap: admins.length === 0,
    ciVerifyToken: required(env, "CI_VERIFY_TOKEN", devMode),
    buildId: buildId(env),
    startRate10m: startRate(env, devMode),
    editorApi: devMode || EDITOR_API_PROD,
  };
}

/** env → 설정 또는 어긋난 키 이름. 던지지 않는다. */
export function loadConfig(env: ConfigEnv): ConfigResult {
  try {
    return { ok: true, config: parse(env) };
  } catch (e) {
    if (e instanceof ConfigError) return { ok: false, key: e.key };
    throw e;
  }
}
