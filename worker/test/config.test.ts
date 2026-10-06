// 설정 가드 표(docs/design/worker.md §10.1·§8.3, W1 수락 기준). loadConfig는 순수 함수라 env 객체를 직접 넘긴다.
import { describe, expect, it } from "vitest";
import {
  CALLBACK_PATH,
  CONFIG_KEYS,
  type ConfigEnv,
  type ConfigKey,
  DEFAULT_START_RATE_10M,
  DEV_REDIRECT_URI,
  loadConfig,
  PROD_API_BASE,
  PROD_AUTHORIZE_URL,
} from "../src/config";

// 합성 채널 ID(testdata/README.md의 a1 관리자·b2 허용). 다른 값은 런타임에 만든다
const A1 = "000000000000000000000000000000a1";
const B2 = "000000000000000000000000000000b2";
const PROD_ORIGIN = "https://dist.example.test";

// .dev.vars.example과 같은 모양(dev 모드)
const DEV: ConfigEnv = {
  PUBLIC_ORIGIN: "http://localhost:8787",
  CHZZK_REDIRECT_URI: "http://localhost:8787/auth/callback",
  CHZZK_AUTHORIZE_URL: "http://127.0.0.1:8788/account-interlock",
  CHZZK_API_BASE: "http://127.0.0.1:8788",
  CHZZK_CLIENT_ID: "dev-client-id",
  CHZZK_CLIENT_SECRET: "dev-client-placeholder",
  ADMIN_CHANNEL_IDS: A1,
  CI_VERIFY_TOKEN: "dev-ci-token",
  BUILD_ID: "dev",
  START_RATE_10M: "1000",
};

// 운영 모양: 치지직 주소는 wrangler.jsonc vars의 운영 값, 출처는 배포 --var
const PROD: ConfigEnv = {
  PUBLIC_ORIGIN: PROD_ORIGIN,
  CHZZK_AUTHORIZE_URL: PROD_AUTHORIZE_URL,
  CHZZK_API_BASE: PROD_API_BASE,
  CHZZK_CLIENT_ID: "prod-client-id",
  CHZZK_CLIENT_SECRET: "prod-client-secret",
  ADMIN_CHANNEL_IDS: A1,
  CI_VERIFY_TOKEN: "prod-ci-token",
  BUILD_ID: "abc1234",
};

const without = (env: ConfigEnv, ...keys: ConfigKey[]): ConfigEnv => {
  const out = { ...env };
  for (const k of keys) delete out[k];
  return out;
};

function ok(env: ConfigEnv) {
  const r = loadConfig(env);
  if (!r.ok) throw new Error(`config_error: ${r.key}`);
  return r.config;
}

describe("통과", () => {
  it("dev(.dev.vars.example 모양): 루프백 출처, 가짜 치지직 주소, 등록된 개발용 리디렉션", () => {
    const c = ok(DEV);
    expect(c.devMode).toBe(true);
    expect(c.publicOrigin).toBe("http://localhost:8787");
    // 치지직 앱에 등록된 개발용 리디렉션 URL과 바이트가 같다
    expect(c.redirectUri).toBe("http://localhost:8787/auth/callback");
    expect(CALLBACK_PATH).toBe("/auth/callback");
    expect(DEV_REDIRECT_URI).toBe("http://localhost:8787/auth/callback");
    expect(DEV_REDIRECT_URI.endsWith(CALLBACK_PATH)).toBe(true);
    expect(c.authorizeUrl).toBe("http://127.0.0.1:8788/account-interlock");
    expect(c.apiBase).toBe("http://127.0.0.1:8788");
    expect(c.adminChannelIds).toEqual([A1]);
    expect(c.bootstrap).toBe(false);
    expect(c.startRate10m).toBe(1000);
    expect(c.buildId).toBe("dev");
  });

  it.each(["http://127.0.0.1:8787", "http://[::1]:8787", "https://localhost:8787"])("루프백 출처 %s는 dev 모드", (origin) => {
    const c = ok({ ...DEV, PUBLIC_ORIGIN: origin });
    expect(c.devMode).toBe(true);
    expect(c.redirectUri).toBe(origin + CALLBACK_PATH);
  });

  it("dev 모드는 치지직 주소를 다른 호스트·http로 덮어쓸 수 있다", () => {
    const c = ok({ ...DEV, CHZZK_AUTHORIZE_URL: "http://fake.example.test:9/authorize", CHZZK_API_BASE: "http://fake.example.test:9" });
    expect(c.authorizeUrl).toBe("http://fake.example.test:9/authorize");
    expect(c.apiBase).toBe("http://fake.example.test:9");
  });

  it("pnpm dev:real 모양(클라이언트 id·secret만 + --var PUBLIC_ORIGIN): 운영 치지직 주소, 부트스트랩", () => {
    const c = ok({ PUBLIC_ORIGIN: "http://localhost:8787", CHZZK_REDIRECT_URI: "http://localhost:8787/auth/callback", CHZZK_CLIENT_ID: "dev-client-id", CHZZK_CLIENT_SECRET: "dev-client-placeholder" });
    expect(c.devMode).toBe(true);
    expect(c.authorizeUrl).toBe(PROD_AUTHORIZE_URL);
    expect(c.apiBase).toBe(PROD_API_BASE);
    expect(c.bootstrap).toBe(true);
    expect(c.ciVerifyToken).toBe("");
    expect(c.buildId).toBeNull();
    expect(c.startRate10m).toBe(DEFAULT_START_RATE_10M);
  });

  it("운영: https 출처, 운영 치지직 주소, 한도 6", () => {
    const c = ok(PROD);
    expect(c.devMode).toBe(false);
    expect(c.redirectUri).toBe(PROD_ORIGIN + "/auth/callback");
    expect(c.startRate10m).toBe(6);
    expect(c.buildId).toBe("abc1234");
  });

  it("운영: 치지직 주소가 없으면 운영 값", () => {
    const c = ok(without(PROD, "CHZZK_AUTHORIZE_URL", "CHZZK_API_BASE"));
    expect(c.authorizeUrl).toBe(PROD_AUTHORIZE_URL);
    expect(c.apiBase).toBe(PROD_API_BASE);
  });

  it.each([
    ["dev", DEV],
    ["운영", PROD],
  ] as const)("%s: ADMIN_CHANNEL_IDS가 없거나 비면 부트스트랩", (_name, base) => {
    expect(ok(without(base, "ADMIN_CHANNEL_IDS")).bootstrap).toBe(true);
    const c = ok({ ...base, ADMIN_CHANNEL_IDS: "" });
    expect(c.bootstrap).toBe(true);
    expect(c.adminChannelIds).toEqual([]);
  });

  it("ADMIN_CHANNEL_IDS는 쉼표 구분(앞뒤 공백 허용, 중복 하나로)", () => {
    expect(ok({ ...PROD, ADMIN_CHANNEL_IDS: `${A1}, ${B2},${A1}` }).adminChannelIds).toEqual([A1, B2]);
  });
});

describe("config_error(어긋난 키 이름만)", () => {
  // [설명, env, 어긋난 키]
  const cases: [string, ConfigEnv, ConfigKey][] = [
    ["dev에 CHZZK_REDIRECT_URI 없음", without(DEV, "CHZZK_REDIRECT_URI"), "CHZZK_REDIRECT_URI"],
    ["dev CHZZK_REDIRECT_URI 빈 값", { ...DEV, CHZZK_REDIRECT_URI: "" }, "CHZZK_REDIRECT_URI"],
    ["dev CHZZK_REDIRECT_URI 끝 슬래시", { ...DEV, CHZZK_REDIRECT_URI: "http://localhost:8787/auth/callback/" }, "CHZZK_REDIRECT_URI"],
    ["dev CHZZK_REDIRECT_URI 127.0.0.1", { ...DEV, CHZZK_REDIRECT_URI: "http://127.0.0.1:8787/auth/callback" }, "CHZZK_REDIRECT_URI"],
    ["dev CHZZK_REDIRECT_URI 대문자", { ...DEV, CHZZK_REDIRECT_URI: "http://localhost:8787/auth/Callback" }, "CHZZK_REDIRECT_URI"],
    ["dev CHZZK_REDIRECT_URI 포트", { ...DEV, CHZZK_REDIRECT_URI: "http://localhost:8788/auth/callback" }, "CHZZK_REDIRECT_URI"],
    ["운영에 CHZZK_REDIRECT_URI 있음", { ...PROD, CHZZK_REDIRECT_URI: "https://dist.example.test/auth/callback" }, "CHZZK_REDIRECT_URI"],
    ["dev CHZZK_REDIRECT_URI 문자열 아님", { ...DEV, CHZZK_REDIRECT_URI: 1 }, "CHZZK_REDIRECT_URI"],
    ["PUBLIC_ORIGIN 없음", without(PROD, "PUBLIC_ORIGIN"), "PUBLIC_ORIGIN"],
    ["운영 http 출처", { ...PROD, PUBLIC_ORIGIN: "http://dist.example.test" }, "PUBLIC_ORIGIN"],
    ["출처 끝 슬래시", { ...PROD, PUBLIC_ORIGIN: PROD_ORIGIN + "/" }, "PUBLIC_ORIGIN"],
    ["출처에 경로", { ...PROD, PUBLIC_ORIGIN: PROD_ORIGIN + "/x" }, "PUBLIC_ORIGIN"],
    ["출처에 기본 포트", { ...PROD, PUBLIC_ORIGIN: PROD_ORIGIN + ":443" }, "PUBLIC_ORIGIN"],
    ["출처 대문자", { ...PROD, PUBLIC_ORIGIN: "https://Dist.example.test" }, "PUBLIC_ORIGIN"],
    ["출처가 URL이 아님", { ...PROD, PUBLIC_ORIGIN: "dist.example.test" }, "PUBLIC_ORIGIN"],
    ["출처 scheme이 http(s)가 아님", { ...DEV, PUBLIC_ORIGIN: "ftp://localhost:8787" }, "PUBLIC_ORIGIN"],
    ["운영에서 인가 주소 덮어쓰기(http)", { ...PROD, CHZZK_AUTHORIZE_URL: "http://127.0.0.1:8788/account-interlock" }, "CHZZK_AUTHORIZE_URL"],
    ["운영에서 API 주소 덮어쓰기(http)", { ...PROD, CHZZK_API_BASE: "http://127.0.0.1:8788" }, "CHZZK_API_BASE"],
    ["운영에서 API 주소 덮어쓰기(다른 https 호스트)", { ...PROD, CHZZK_API_BASE: "https://openapi.example.test" }, "CHZZK_API_BASE"],
    ["운영에서 API 주소 끝 슬래시", { ...PROD, CHZZK_API_BASE: PROD_API_BASE + "/" }, "CHZZK_API_BASE"],
    ["dev 치지직 주소가 URL이 아님", { ...DEV, CHZZK_API_BASE: "127.0.0.1:8788" }, "CHZZK_API_BASE"],
    ["dev 치지직 주소에 자격 정보", { ...DEV, CHZZK_AUTHORIZE_URL: "http://u:p@127.0.0.1:8788/a" }, "CHZZK_AUTHORIZE_URL"],
    ["운영 클라이언트 id 없음", without(PROD, "CHZZK_CLIENT_ID"), "CHZZK_CLIENT_ID"],
    ["운영 클라이언트 secret 빈 값", { ...PROD, CHZZK_CLIENT_SECRET: "" }, "CHZZK_CLIENT_SECRET"],
    ["운영 CI 토큰 없음", without(PROD, "CI_VERIFY_TOKEN"), "CI_VERIFY_TOKEN"],
    ["ADMIN 31자리", { ...PROD, ADMIN_CHANNEL_IDS: A1.slice(1) }, "ADMIN_CHANNEL_IDS"],
    ["ADMIN 대문자", { ...PROD, ADMIN_CHANNEL_IDS: A1.toUpperCase() }, "ADMIN_CHANNEL_IDS"],
    ["ADMIN 끝 쉼표", { ...PROD, ADMIN_CHANNEL_IDS: `${A1},` }, "ADMIN_CHANNEL_IDS"],
    ["ADMIN hex 아님", { ...DEV, ADMIN_CHANNEL_IDS: A1.replace("a1", "g1") }, "ADMIN_CHANNEL_IDS"],
    ["운영에서 START_RATE_10M", { ...PROD, START_RATE_10M: "6" }, "START_RATE_10M"],
    ["dev START_RATE_10M 0", { ...DEV, START_RATE_10M: "0" }, "START_RATE_10M"],
    ["dev START_RATE_10M 숫자 아님", { ...DEV, START_RATE_10M: "many" }, "START_RATE_10M"],
    ["BUILD_ID 형식", { ...PROD, BUILD_ID: "a b" }, "BUILD_ID"],
    ["문자열이 아닌 값(JSON vars)", { ...PROD, CHZZK_CLIENT_ID: 1 }, "CHZZK_CLIENT_ID"],
  ];
  it.each(cases)("%s", (_name, env, key) => {
    expect(loadConfig(env)).toEqual({ ok: false, key });
  });

  it("오류 결과에는 키 이름 말고 아무것도 없다(값을 되풀이하지 않는다)", () => {
    const secret = "prod-client-secret-canary";
    const r = loadConfig({ ...PROD, CHZZK_CLIENT_SECRET: secret, ADMIN_CHANNEL_IDS: "bad" });
    expect(JSON.stringify(r)).not.toContain(secret);
    expect(JSON.stringify(r)).not.toContain("bad");
  });
});

describe("dev 모드의 모르는 문자열 바인딩", () => {
  const canary = "other-service-canary-value";
  it("모르는 문자열 키가 있으면 config_error{키 이름}이고 값은 어디에도 없다", () => {
    const e: Record<string, unknown> = { ...DEV, OTHER_SERVICE_SECRET: canary };
    const r = loadConfig(e);
    expect(r).toEqual({ ok: false, key: "OTHER_SERVICE_SECRET" });
    expect(JSON.stringify(r)).not.toContain(canary);
  });

  it("모르는 키가 둘이면 이름 정렬의 첫 키", () => {
    const e: Record<string, unknown> = { ...DEV, ZZZ_X: canary, AAA_Y: canary };
    expect(loadConfig(e)).toEqual({ ok: false, key: "AAA_Y" });
  });

  it("이름 모양 밖이면 이름도 싣지 않는다", () => {
    const e: Record<string, unknown> = { ...DEV, "bad-key": canary };
    const r = loadConfig(e);
    expect(r).toEqual({ ok: false, key: "(invalid_key_name)" });
    expect(JSON.stringify(r)).not.toContain("bad-key");
  });

  it("문자열이 아닌 모르는 키(DO·R2·테스트 내부 바인딩)는 보지 않는다", () => {
    const e: Record<string, unknown> = { ...DEV, AUTH_LIKE: {}, N: 1 };
    expect(loadConfig(e).ok).toBe(true);
  });

  it("운영 모드는 검사하지 않는다", () => {
    const e: Record<string, unknown> = { ...PROD, OTHER_SERVICE_SECRET: canary };
    expect(loadConfig(e).ok).toBe(true);
  });

  it("출처가 먼저다: 모르는 키가 있어도 PUBLIC_ORIGIN이 없으면 PUBLIC_ORIGIN", () => {
    const e: Record<string, unknown> = { ...without(DEV, "PUBLIC_ORIGIN"), OTHER_SERVICE_SECRET: canary };
    expect(loadConfig(e)).toEqual({ ok: false, key: "PUBLIC_ORIGIN" });
  });
});

it("loadConfig는 CONFIG_KEYS 밖의 키를 읽지 않는다", () => {
  const read = new Set<string>();
  const env = new Proxy({ ...DEV } as Record<string, unknown>, {
    get(t, k) {
      if (typeof k === "string") read.add(k);
      return t[k as string];
    },
  });
  expect(loadConfig(env).ok).toBe(true);
  for (const k of read) expect(CONFIG_KEYS as readonly string[]).toContain(k);
});
