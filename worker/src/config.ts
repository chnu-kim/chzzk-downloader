// 설정 파싱·검증(docs/design/worker.md §10.1, A11). 순수 함수다: env 객체만 받고 바깥을 부르지 않는다.
//
// 실패하면 모든 경로가 500 config_error(/health는 503)이고, 응답에는 이름·값이 없다. 로그에는 어긋난 키 이름만 남는다.
//   - dev 모드 = PUBLIC_ORIGIN의 호스트가 루프백(localhost·127.0.0.1·[::1]). 그때만 치지직 주소를 덮어쓸 수 있고
//     START_RATE_10M을 읽는다.
//   - 운영 모드: PUBLIC_ORIGIN은 https, 치지직 주소는 없거나 운영 값과 정확히 같고, 클라이언트 id·secret·CI 토큰이 있어야 한다.
//   - ADMIN_CHANNEL_IDS가 비어 있으면 부트스트랩 모드(§8.3), 있으면 쉼표로 나눈 32자리 소문자 hex만.

// 코드가 읽는 키 전부. worker/.dev.vars.example의 키 집합과 같아야 한다(scripts/ci/worker-config.mjs가 이 배열을 읽어 비교한다).
export const CONFIG_KEYS = [
  "PUBLIC_ORIGIN",
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
// 운영의 /auth/start IP당 10분 한도(§5). dev 모드에서만 START_RATE_10M으로 바꿀 수 있다
export const DEFAULT_START_RATE_10M = 6;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const CHANNEL_ID = /^[0-9a-f]{32}$/;
const BUILD_ID = /^[0-9A-Za-z._-]{1,40}$/;
const START_RATE = /^[1-9][0-9]{0,6}$/;

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
}

export type ConfigResult = { readonly ok: true; readonly config: Config } | { readonly ok: false; readonly key: ConfigKey };

class ConfigError extends Error {
  constructor(readonly key: ConfigKey) {
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

function parseOrigin(key: ConfigKey, raw: string | undefined): URL {
  if (raw === undefined) throw new ConfigError(key);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ConfigError(key);
  }
  // 직렬화한 출처와 글자가 같아야 한다(끝 슬래시·경로·기본 포트·대문자·자격 정보가 있으면 거부): redirectUri가 바이트 단위로 맞아야 한다
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.origin !== raw) throw new ConfigError(key);
  return u;
}

// dev 모드의 치지직 주소: http(s) 절대 URL이면 호스트는 자유(가짜 치지직)
function parseDevUrl(key: ConfigKey, raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ConfigError(key);
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username !== "" || u.password !== "") throw new ConfigError(key);
  return raw;
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

function parse(env: ConfigEnv): Config {
  const origin = parseOrigin("PUBLIC_ORIGIN", read(env, "PUBLIC_ORIGIN"));
  const devMode = LOOPBACK_HOSTS.has(origin.hostname);
  if (!devMode && origin.protocol !== "https:") throw new ConfigError("PUBLIC_ORIGIN");
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
