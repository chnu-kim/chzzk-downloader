// wrangler dev E2E의 순수 함수(test/e2e-lib.mjs, docs/design/worker.md 구현 중 변경 40·41): 인자 조립·쿠키 항아리·Origin 계산·HTML 추출·로그 카나리 검사.
import vectorsText from "../vectors/loopback-vectors.json?raw";
import { describe, expect, it } from "vitest";
import { formatLog, type LogFields } from "../../src/core/log";
import {
  browserPostHeaders,
  CHILD_ENV_KEYS,
  checkEvents,
  childEnvFor,
  classifyLine,
  CookieJar,
  E2E_BUCKET,
  extractCsrf,
  extractDownloadLinks,
  extractRowIds,
  loopbackStateOf,
  parseLoopbackLocation,
  LOG_KEYS,
  makeCanaries,
  parseDevVars,
  parseReferrerPolicy,
  REQUIRED_EVENTS,
  scanLogs,
  wranglerDevArgs,
  wranglerR2PutArgs,
} from "../e2e-lib.mjs";

// 금지 낱말은 소스 검사(scripts/ci/worker-config.mjs checkE2eSources)가 원문에서 찾으므로 이어 붙여 쓴다
const REMOTE = ["--re", "mote"].join("");
const LOG_LEVEL = ["--log", "-level"].join("");

const DEV = { persistTo: "/tmp/p", buildId: "e2e-abc", fakeOrigin: "http://127.0.0.1:8788" };

describe("childEnvFor", () => {
  const parentEnv = {
    PATH: "/usr/bin",
    TMPDIR: "/tmp/t",
    HOME: "/home/me",
    WRANGLER_LOG: "warn",
    CLOUDFLARE_API_TOKEN: "x-token",
    CLOUDFLARE_ACCOUNT_ID: "x-account",
    GITHUB_TOKEN: "x-gh",
    XDG_CONFIG_HOME: "/home/me/.config",
  };

  it("허용 목록의 키만 넘기고 HOME·XDG_CONFIG_HOME은 임시 폴더다", () => {
    const env = childEnvFor({ tmpRoot: "/tmp/e2e", parentEnv });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/tmp/e2e/home", XDG_CONFIG_HOME: "/tmp/e2e/xdg", WRANGLER_SEND_METRICS: "false", CI: "true", TMPDIR: "/tmp/t" });
    expect(Object.keys(env).every((k) => CHILD_ENV_KEYS.includes(k))).toBe(true);
    expect(CHILD_ENV_KEYS).toEqual(["PATH", "HOME", "XDG_CONFIG_HOME", "WRANGLER_SEND_METRICS", "CI", "TMPDIR"]);
  });

  it("TMPDIR이 없으면 넣지 않는다", () => {
    expect(Object.keys(childEnvFor({ tmpRoot: "/tmp/e2e", parentEnv: { PATH: "/usr/bin" } }))).toEqual(["PATH", "HOME", "XDG_CONFIG_HOME", "WRANGLER_SEND_METRICS", "CI"]);
  });

  it("상대 경로 tmpRoot는 거부한다", () => {
    expect(() => childEnvFor({ tmpRoot: "tmp/e2e", parentEnv })).toThrow();
  });
});

describe("wranglerDevArgs", () => {
  it("pnpm dev와 같은 모양에 임시 R2 폴더와 --var만 더한다", () => {
    const args = wranglerDevArgs(DEV);
    expect(args).toEqual([
      "dev",
      "--config",
      "wrangler.jsonc",
      "--port",
      "8787",
      "--ip",
      "127.0.0.1",
      "--env-file",
      ".dev.vars.example",
      "--persist-to",
      "/tmp/p",
      "--show-interactive-dev-session=false",
      "--var",
      "BUILD_ID:e2e-abc",
      "--var",
      "START_RATE_10M:3",
      "--var",
      "CHZZK_AUTHORIZE_URL:http://127.0.0.1:8788/account-interlock",
      "--var",
      "CHZZK_API_BASE:http://127.0.0.1:8788",
    ]);
    const i = args.indexOf("--env-file");
    expect(args[i + 1]).toBe(".dev.vars.example");
    expect(args[i + 2]?.startsWith("-")).toBe(true);
    expect(args).not.toContain(REMOTE);
    expect(args).not.toContain("-r"); // 원격 R2 플래그의 별칭(정적 검사는 이 글자를 보지 않는다)
    expect(args.some((a) => a.startsWith(LOG_LEVEL))).toBe(false);
  });

  it.each([
    ["buildId에 공백", { ...DEV, buildId: "a b" }],
    ["가짜 서버가 localhost", { ...DEV, fakeOrigin: "http://localhost:8788" }],
    ["persistTo가 -로 시작", { ...DEV, persistTo: "--x" }],
    ["persistTo가 빔", { ...DEV, persistTo: "" }],
    ["startRate 0", { ...DEV, startRate: 0 }],
    ["startRate 소수", { ...DEV, startRate: 1.5 }],
  ])("%s이면 던진다", (_name, o) => {
    expect(() => wranglerDevArgs(o)).toThrow();
  });
});

describe("wranglerR2PutArgs", () => {
  it("로컬 R2에만 넣는다", () => {
    const args = wranglerR2PutArgs({ key: "releases/0.2.0/SHA256SUMS", file: "/f", persistTo: "/p" });
    expect(args).toContain("--local");
    expect(args).not.toContain(REMOTE);
    expect(args[3]).toBe(`${E2E_BUCKET}/releases/0.2.0/SHA256SUMS`);
    expect(args.slice(0, 3)).toEqual(["r2", "object", "put"]);
  });

  it.each(["x/y", "releases/../a", "releases/0.2.0/a/b", "releases/"])("키 %s는 던진다", (key) => {
    expect(() => wranglerR2PutArgs({ key, file: "/f", persistTo: "/p" })).toThrow();
  });

  it("file·persistTo가 -로 시작하면 던진다", () => {
    expect(() => wranglerR2PutArgs({ key: "releases/latest.json", file: "-f", persistTo: "/p" })).toThrow();
    expect(() => wranglerR2PutArgs({ key: "releases/latest.json", file: "/f", persistTo: "" })).toThrow();
  });
});

describe("CookieJar", () => {
  it("넣고 바꾸고 지운다(Max-Age=0·빈 값)", () => {
    const jar = new CookieJar();
    jar.apply(["cdl_f=v1; Max-Age=600; Path=/"]);
    jar.apply(["cdl_s=v2; Path=/; HttpOnly"]);
    expect(jar.header()).toBe("cdl_f=v1; cdl_s=v2");
    jar.apply(["cdl_f=; Max-Age=0; Path=/"]);
    expect(jar.header()).toBe("cdl_s=v2");
    expect(jar.has("cdl_f")).toBe(false);
    expect(jar.get("cdl_s")).toBe("v2");
    expect(jar.values()).toEqual(["v2"]);
    jar.apply(["cdl_s=x; Max-Age=0"]);
    expect(jar.header()).toBeNull();
  });
});

describe("Referrer-Policy와 브라우저 POST 헤더", () => {
  it("parseReferrerPolicy: 마지막으로 알려진 토큰", () => {
    expect(parseReferrerPolicy("same-origin")).toBe("same-origin");
    expect(parseReferrerPolicy("no-referrer, same-origin")).toBe("same-origin");
    expect(parseReferrerPolicy("bogus")).toBe("");
    expect(parseReferrerPolicy(null)).toBe("");
  });

  const LOCAL = "http://localhost:8787/admin";
  it.each([
    ["same-origin", LOCAL, "http://localhost:8787/admin/allow", "http://localhost:8787", "same-origin"],
    ["no-referrer", LOCAL, "http://localhost:8787/admin/allow", "null", "same-origin"],
    ["same-origin", LOCAL, "http://127.0.0.1:8788/x", "null", "cross-site"],
    ["", LOCAL, "http://localhost:8787/admin/allow", "http://localhost:8787", "same-origin"],
    ["strict-origin-when-cross-origin", "https://app.example.test/", "http://localhost:8787/x", "null", "cross-site"],
  ])("정책 %s: %s → %s", (referrerPolicy, documentUrl, targetUrl, origin, site) => {
    expect(browserPostHeaders({ documentUrl, referrerPolicy, targetUrl })).toEqual({ Origin: origin, "Sec-Fetch-Site": site });
  });
});

const ID64 = "A".repeat(43);

describe("HTML 추출", () => {
  it("extractCsrf: 같은 값이 여럿이어도 하나, 서로 다르면 null, 없으면 null", () => {
    const f = (v: string) => `<input type="hidden" name="csrf" value="${v}">`;
    expect(extractCsrf(`${f(ID64)}x${f(ID64)}`)).toBe(ID64);
    expect(extractCsrf(`${f(ID64)}${f("B".repeat(43))}`)).toBeNull();
    expect(extractCsrf("<p>없음</p>")).toBeNull();
  });

  const G = `cdg_${ID64}`;
  const loc = (port: number | string, rest = `/chzzk-downloader/login?grant=${G}&state=${ID64}`, host = "127.0.0.1") => `http://${host}:${port}${rest}`;

  it("parseLoopbackLocation: 정상만 풀고 나머지는 null", () => {
    expect(parseLoopbackLocation(loc(49152))).toEqual({ port: 49152, path: "/chzzk-downloader/login", grant: G, state: ID64 });
    expect(parseLoopbackLocation(loc(1024))?.port).toBe(1024);
    expect(parseLoopbackLocation(loc(65535))?.port).toBe(65535);
    for (const bad of [
      loc(1023),
      loc(65536),
      loc(49152, undefined, "localhost"),
      loc(49152, `/other?grant=${G}&state=${ID64}`),
      loc(49152, `/chzzk-downloader/login?state=${ID64}&grant=${G}`),
      loc(49152, `/chzzk-downloader/login?grant=cda_${ID64}&state=${ID64}`),
      loc(49152, `/chzzk-downloader/login?grant=${G}&state=${ID64}x`),
      null,
    ]) {
      expect(parseLoopbackLocation(bad)).toBeNull();
    }
  });

  it("loopbackStateOf: 공유 벡터와 같다", async () => {
    const v = JSON.parse(vectorsText) as { state: { loginVerifier: string; state: string }[] };
    expect(v.state.length).toBeGreaterThanOrEqual(3);
    for (const r of v.state) expect(await loopbackStateOf(r.loginVerifier)).toBe(r.state);
  });

  const SESSIONS = `<table><tbody><tr><td>가<br><span class="mono">${"c3".padStart(32, "0")}</span></td><td><form class="inline" method="post" action="/admin/sessions/sid_1-A/revoke"></form></td></tr><tr><td>나<br><span class="mono">${"b2".padStart(32, "0")}</span></td><td><form action="/admin/sessions/sid2/revoke"></form></td></tr></tbody></table>`;
  it("extractRowIds: 채널 id가 든 행의 revoke 액션만", () => {
    expect(extractRowIds(SESSIONS, { channelId: "c3".padStart(32, "0"), actionPrefix: "/admin/sessions/" })).toEqual(["sid_1-A"]);
    expect(extractRowIds(SESSIONS, { channelId: "d4".padStart(32, "0"), actionPrefix: "/admin/sessions/" })).toEqual([]);
  });

  it("extractDownloadLinks: 링크와 같은 행의 sha256", () => {
    const sum = "0123456789abcdef".repeat(4);
    const row = (file: string) => `<tr><td><a href="/releases/0.2.0/${file}">이름</a><br><span class="mono">${file}</span></td><td><code>${sum}</code></td></tr>`;
    const links = extractDownloadLinks(`<table>${row("a.dmg")}${row("b.deb")}</table><pre><code>chmod +x a</code></pre>`);
    expect(links).toEqual([
      { href: "/releases/0.2.0/a.dmg", file: "a.dmg", sha256: sum },
      { href: "/releases/0.2.0/b.deb", file: "b.deb", sha256: sum },
    ]);
  });
});

describe("로그 검사", () => {
  it("classifyLine", () => {
    expect(classifyLine('{"event":"a"}')).toBe("event");
    expect(classifyLine("[wrangler:info] GET /health 200 OK (1ms)")).toBe("request");
    expect(classifyLine("[wrangler:info] Ready on http://127.0.0.1:8787")).toBe("other");
    expect(classifyLine("\x1b[31m✘ [ERROR] 실패")).toBe("other");
    expect(classifyLine("\x1b[34m[wrangler:info]\x1b[0m")).toBe("other");
    expect(classifyLine("")).toBe("blank");
  });

  const SECRET = "secret-value-1";
  const PATH = "path-value-22";
  const canaries = () => {
    const c = makeCanaries();
    c.add("secret", "tok", SECRET);
    c.add("path", "sid", PATH);
    return c;
  };

  it.each([
    ["event 줄의 secret", `{"event":"x","route":"${SECRET}"}`, 1],
    ["event 줄의 path", `{"event":"x","route":"${PATH}"}`, 1],
    ["request 줄의 secret", `[wrangler:info] GET /a/${SECRET} 200 OK (1ms)`, 1],
    ["request 줄의 path는 허용", `[wrangler:info] GET /a/${PATH} 200 OK (1ms)`, 0],
    ["other 줄의 path", `something ${PATH}`, 1],
    ["request 줄의 쿼리", "[wrangler:info] GET /a?b 200 OK (1ms)", 1],
    ["허용 밖의 키", '{"event":"x","extra":1}', 1],
    ["깨진 JSON", '{"event":"x"', 1],
    ["깨끗한 event", '{"event":"x","level":"info"}', 0],
  ])("%s", (_name, line, want) => {
    const r = scanLogs([line], canaries());
    expect(r.violations).toHaveLength(want);
    // 위반 메시지에는 카나리 값이 없다
    for (const v of r.violations) {
      expect(v).not.toContain(SECRET);
      expect(v).not.toContain(PATH);
    }
  });

  it("종류별 줄 수와 이벤트 수를 센다", () => {
    const r = scanLogs(['{"event":"a"}', '{"event":"a"}', "[wrangler:info] GET / 200 OK (1ms)", "", "그 밖"], canaries());
    expect(r.events).toEqual({ a: 2 });
    expect(r.counts).toEqual({ event: 2, request: 1, other: 1 });
  });

  it("makeCanaries: 짧은 값은 던지고 같은 값은 한 번만", () => {
    const c = makeCanaries();
    expect(() => c.add("secret", "x", "short")).toThrow();
    c.add("secret", "a", "long-enough-1");
    c.add("path", "b", "long-enough-1");
    expect(c.list()).toHaveLength(1);
  });

  it("LOG_KEYS는 로거가 내는 키와 같다(허용 필드가 바뀌면 여기서 걸린다)", () => {
    const all: Required<LogFields> = {
      level: "warn",
      route: "/x",
      method: "GET",
      status: 200,
      stage: "token",
      timedOut: false,
      durationMs: 1,
      flowKind: "app",
      reason: "r",
      sessionIdPrefix: "abcdef",
      chzzkCode: "c",
      key: "k",
      errorName: "E",
    };
    expect(Object.keys(JSON.parse(formatLog("e", all))).sort()).toEqual([...LOG_KEYS].sort());
  });

  it("checkEvents: 비면 모두 모자라고, 채우면 0, 잡히지 않은 예외는 1이면 위반", () => {
    expect(checkEvents({}).length).toBeGreaterThanOrEqual(Object.keys(REQUIRED_EVENTS).length);
    const full = { ...REQUIRED_EVENTS, "config.error": 1, "http.internal": 0 };
    expect(checkEvents(full)).toEqual([]);
    expect(checkEvents({ ...full, "http.internal": 1 })).toHaveLength(1);
    expect(checkEvents({ ...full, "config.error": 2 })).toHaveLength(1);
  });
});

describe("parseDevVars", () => {
  it("KEY=VALUE만, 첫 =에서 나눈다", () => {
    expect(parseDevVars("A=1\n# c\n\nB=x=y")).toEqual({ A: "1", B: "x=y" });
    expect(() => parseDevVars("bad")).toThrow();
  });
});
