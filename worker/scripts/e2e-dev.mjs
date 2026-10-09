// wrangler dev E2E 실행기(docs/design/worker.md §12.3, 구현 중 변경 40·41, cicd.md 구현 중 변경 100).
// 가짜 치지직(node:http, 127.0.0.1:8788) + wrangler dev(127.0.0.1:8787, --env-file .dev.vars.example, 임시 폴더의 로컬 R2 씨앗)에
// 실제 HTTP로 웹·앱 로그인, 회전, 랜딩, 관리 POST(Origin 규칙), /update·/releases, 스로틀 키, release.mjs worker --check-only를 보내고
// Worker의 로그 줄에 카나리(비밀값)가 없는지 본다. 실제 비밀값 파일도, 실제 R2도, 실제 치지직도 쓰지 않는다. 값은 모두 합성이다.
//
// 종료 코드: 0 통과 · 1 판정 실패(단언) · 2 환경(포트 점유·씨앗 실패·wrangler 기동 실패·준비 시간 초과·전체 10분 초과)
//   전체 10분은 씨앗·check-only 같은 자식 프로세스까지 센다(모두 비동기 spawn, 호출마다 시간 제한 = min(개별 제한, 남은 예산)).
//   10분 초과·SIGINT·SIGTERM도 result.json에 exit 2와 abort(timeout|SIGINT|SIGTERM)를 써 두고 끝난다(프로세스 종료 코드는 신호면 130, 시간 초과면 2).
// 결과: target/ci/worker-e2e/{wrangler.log,result.json}. Linux·macOS 전용(프로세스 그룹째 끈다).
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { parseJsonc } from "../../scripts/ci/worker-config.mjs";
import { FAKE_ACCOUNTS } from "../test/fake-chzzk.mjs";
import {
  browserPostHeaders,
  checkEvents,
  childEnvFor,
  classifyLine,
  CookieJar,
  cookieAttrs,
  E2E_BIND_IP,
  E2E_BUCKET,
  E2E_ORIGIN,
  E2E_PORT,
  E2E_VERSIONS,
  extractCsrf,
  extractDownloadLinks,
  extractRowIds,
  loopbackStateOf,
  makeCanaries,
  parseDevVars,
  parseLoopbackLocation,
  parseReferrerPolicy,
  scanLogs,
  stripAnsi,
  wranglerDevArgs,
  wranglerR2PutArgs,
} from "../test/e2e-lib.mjs";
import { buildSeed, expectedArtifacts, sha256Hex, verifyKeys } from "../test/seed-release.mjs";
import { FAKE_HOST, FAKE_PORT, startFakeChzzkServer } from "./fake-chzzk-server.mjs";

class EnvError extends Error {}
class Fail extends Error {}

const WORKER = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(WORKER, "..");
const OUT = join(REPO, "target/ci/worker-e2e");
const WRANGLER_JS = join(WORKER, "node_modules/wrangler/bin/wrangler.js");
const TABLE = JSON.parse(readFileSync(join(REPO, "release/expected-artifacts.json"), "utf8"));
const DEV = parseDevVars(readFileSync(join(WORKER, ".dev.vars.example"), "utf8"));
const WRANGLER_VERSION = JSON.parse(readFileSync(join(REPO, "scripts/ci/tools.json"), "utf8")).tools.wrangler.version;
const FAKE_ORIGIN = `http://${FAKE_HOST}:${FAKE_PORT}`;

// 시나리오마다 다른 TEST-NET IP(스로틀 키 분리). start 한도는 IP당 E2E_START_RATE
const IP_ADMIN = "198.51.100.10";
const IP_B2 = "198.51.100.20";
const IP_C3 = "198.51.100.30";
const IP_CANCEL = "198.51.100.40";
const IP_T4 = "203.0.113.7";
const IP_T4B = "203.0.113.8";
const IP_T6A = "2001:db8:7:7::1";
const IP_T6B = "2001:db8:7:7::2";
const IP_T6C = "2001:db8:7:8::1";

// E17이 요구하는 카나리 종류와 최소 수(2026-10-09 실측 103개: 루프백 전환 뒤 loginId·userCode 카나리가 없어졌다, worker.md 구현 중 변경 89 (자))
const REQUIRED_CANARY_LABELS = ["ip", "cookie.cdl_s", "cookie.cdl_f", "state", "sessionId", "csrf", "loginSecret", "loginVerifier", "grant", "loopState", "handle", "access", "refresh", "chzzk.code", "chzzk.token"];
const MIN_CANARIES = 100;

const LOOPBACK_PATH = "/chzzk-downloader/login"; // src/core/loopback.ts LOOPBACK_PATH
const LATEST = E2E_VERSIONS[E2E_VERSIONS.length - 1];
const ID = (k) => FAKE_ACCOUNTS[k].channelId;
const enc = new TextEncoder();
const dec = new TextDecoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");

// ---- 단언 ----

function must(cond, what) {
  if (!cond) throw new Fail(what);
}
function isStatus(res, want, what) {
  if (res.status !== want) throw new Fail(`${what}: 기대 ${want}, 실제 ${res.status}`);
}
const json = (res) => JSON.parse(res.text());
function sameBytes(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// ---- 상태 ----

const canaries = makeCanaries();
const releaseLog = []; // { path, status, hasLocation }
let fakeServer = null;
let wrangler = null;
let TMP = null;
let seed = null;
let sums = null; // 0.2.0의 SHA256SUMS: file → sha256

const registerCookies = (setCookies) => {
  for (const line of setCookies) {
    const { name, value } = cookieAttrs(line);
    if (value.length >= 6) canaries.add("secret", `cookie.${name}`, value);
  }
};
const registerBundle = (b) => {
  canaries.add("secret", "access", b.accessToken);
  canaries.add("secret", "refresh", b.refreshToken);
};
// 관리·랜딩 페이지의 세션 id(로그의 sessionIdPrefix 6자는 전체 id와 맞지 않는다)
const harvestSessionIds = (html) => {
  for (const m of html.matchAll(/action="\/(?:admin|me)\/sessions\/([A-Za-z0-9_-]+)\/revoke"/g)) if (m[1].length >= 6) canaries.add("path", "sessionId", m[1]);
};

// ---- HTTP ----

/** 한 요청(리디렉트를 따르지 않는다). jar가 있으면 우리 출처에만 Cookie를 싣고 Set-Cookie를 받는다 */
async function req(method, url, { headers = {}, body, jar, ip } = {}) {
  const u = new URL(url, E2E_ORIGIN);
  const h = new Headers(headers);
  if (ip) h.set("CF-Connecting-IP", ip);
  const ours = u.origin === E2E_ORIGIN;
  if (jar && ours) {
    const c = jar.header();
    if (c) h.set("Cookie", c);
  }
  let res;
  try {
    res = await fetch(u, { method, headers: h, body, redirect: "manual", signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    // 준비 뒤 wrangler가 죽었으면 판정이 아니라 환경(종료 코드 2)
    if (ours && wrangler?.isDone()) throw new EnvError(`wrangler dev가 도중에 끝났다(${e?.name ?? "Error"})\n${tail(wrangler.lines, 30)}`);
    throw e;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (ours) {
    const sc = res.headers.getSetCookie();
    if (sc.length > 0) {
      registerCookies(sc);
      jar?.apply(sc);
    }
    if (u.pathname.startsWith("/releases/")) releaseLog.push({ path: u.pathname, status: res.status, hasLocation: res.headers.has("location") });
  }
  return { status: res.status, headers: res.headers, bytes, text: () => dec.decode(bytes) };
}

const jsonPost = (path, obj, o = {}) => req("POST", path, { ...o, headers: { "Content-Type": "application/json", ...(o.headers ?? {}) }, body: JSON.stringify(obj) });
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

/** 브라우저처럼 페이지를 받는다: { res, status, url, policy, html } */
async function browserGet(jar, path) {
  const res = await req("GET", path, { jar });
  const html = res.text();
  harvestSessionIds(html);
  return { res, status: res.status, url: new URL(path, E2E_ORIGIN).toString(), policy: parseReferrerPolicy(res.headers.get("referrer-policy")), html };
}

/**
 * 페이지의 폼을 보낸다. Origin·Sec-Fetch-Site는 그 페이지의 Referrer-Policy로 Fetch 표준 규칙을 따라 계산한다(undici는 Origin을
 * 싣지 않는다, 구현 중 변경 40 (아)). o.policy: 정책 덮어쓰기, o.headers: 헤더 패치(null이면 뺀다), o.contentType, o.ip
 */
function browserPost(jar, page, action, fields = {}, o = {}) {
  const target = new URL(action, page.url).toString();
  const headers = { ...browserPostHeaders({ documentUrl: page.url, referrerPolicy: o.policy ?? page.policy, targetUrl: target }), "Content-Type": o.contentType ?? "application/x-www-form-urlencoded" };
  for (const [k, v] of Object.entries(o.headers ?? {})) {
    if (v === null) delete headers[k];
    else headers[k] = v;
  }
  return req("POST", target, { headers, body: new URLSearchParams(fields).toString(), jar, ip: o.ip });
}

const pageCsrf = (page, what) => {
  const c = extractCsrf(page.html);
  must(c !== null, `${what}: csrf 입력이 하나가 아니다`);
  canaries.add("secret", "csrf", c);
  return c;
};

/** 인가 주소(가짜 치지직)를 받아 콜백 URL을 낸다. 웹 start·로그인 [계속]의 303에서 이어진다 */
async function authorizeToCallback(res) {
  isStatus(res, 303, "인가로 보내는 응답");
  const loc = res.headers.get("location") ?? "";
  must(loc.startsWith(`${FAKE_ORIGIN}/account-interlock?`), "인가 주소가 가짜 치지직이 아니다");
  const q = new URL(loc).searchParams;
  must(q.get("clientId") === DEV.CHZZK_CLIENT_ID, "인가 주소의 clientId가 .dev.vars.example 값과 다르다");
  must(q.get("redirectUri") === DEV.CHZZK_REDIRECT_URI, "인가 주소의 redirectUri가 등록된 콜백과 다르다");
  const state = q.get("state") ?? "";
  canaries.add("secret", "state", state);
  const r = await req("GET", loc);
  isStatus(r, 302, "가짜 치지직 인가");
  const cb = r.headers.get("location") ?? "";
  must(cb.startsWith(`${E2E_ORIGIN}/auth/callback?`), "콜백 주소가 등록된 콜백이 아니다");
  return cb;
}

// ---- 앱 로그인 ----

/** 앱 수신기 흉내: 127.0.0.1 임의 포트의 1회용 HTTP 서버. 받은 요청을 기록하고 200 text/plain으로 답한다(값은 출력하지 않는다) */
async function startReceiver() {
  const hits = [];
  const server = http.createServer((rq, rs) => {
    hits.push({ method: rq.method, url: rq.url, host: rq.headers.host });
    rs.writeHead(200, { "Content-Type": "text/plain" });
    rs.end("ok");
  });
  await new Promise((res, rej) => {
    server.once("error", rej);
    server.listen(0, "127.0.0.1", res);
  });
  const port = server.address().port;
  let closed = false;
  const close = () =>
    closed
      ? Promise.resolve()
      : new Promise((res) => {
          closed = true;
          server.close(() => res());
          server.closeAllConnections?.();
        });
  return { port, hits, close };
}

async function appStart(ip, port = 49152) {
  const loginSecret = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const loginVerifier = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(loginSecret))));
  canaries.add("secret", "loginSecret", loginSecret);
  canaries.add("secret", "loginVerifier", loginVerifier);
  const res = await jsonPost("/auth/start", { port, loginVerifier, client: "app/0.1.0 e2e" }, { ip });
  const flow = { res, status: res.status, loginSecret, verifier: loginVerifier, port, body: null };
  if (res.status === 201) {
    flow.body = json(res);
    canaries.add("path", "handle", flow.body.loginUrl.split("/").pop());
  }
  return flow;
}

/** 콜백 303이 앱 수신기로 가는지 확인하고, 그 주소를 수신기에 실제로 연다(앱이 받는 것과 같다). grant·state를 카나리에 넣는다 */
async function followLoopback(flow, callback, receiver) {
  isStatus(callback, 303, "콜백");
  must(parseReferrerPolicy(callback.headers.get("referrer-policy")) === "no-referrer", "루프백 303의 Referrer-Policy가 no-referrer가 아니다");
  const cleared = callback.headers.getSetCookie().some((c) => /^cdl_f=; Max-Age=0/.test(c));
  must(cleared, "루프백 303이 흐름 쿠키를 지우지 않았다");
  const location = callback.headers.get("location") ?? "";
  const loop = parseLoopbackLocation(location);
  must(loop !== null, "콜백의 Location이 루프백 주소 모양이 아니다");
  must(loop.port === receiver.port, "루프백 포트가 start 때 보낸 포트와 다르다");
  must(loop.state === (await loopbackStateOf(flow.verifier)), "루프백 state가 loginVerifier에서 나온 값과 다르다");
  canaries.add("secret", "grant", loop.grant);
  canaries.add("secret", "loopState", loop.state);
  const r = await req("GET", location);
  isStatus(r, 200, "앱 수신기");
  must(receiver.hits.length === 1, `수신기 요청 ${receiver.hits.length}개(필요 1)`);
  const hit = receiver.hits[0];
  must(hit.url === `${LOOPBACK_PATH}?grant=${loop.grant}&state=${loop.state}`, "수신기가 받은 경로·쿼리가 기대와 다르다");
  must(hit.host === `127.0.0.1:${loop.port}`, "수신기가 받은 Host가 127.0.0.1:<포트>가 아니다");
  return loop;
}

/** 앱 로그인 전 과정: 수신기 → start → 확인 페이지 → [계속] → 인가 → 콜백 → 루프백 → redeem */
async function appLogin(account, ip) {
  fakeServer.fake.state.account = account;
  const receiver = await startReceiver();
  let flow;
  let jar;
  let callback;
  let loop;
  try {
    flow = await appStart(ip, receiver.port);
    isStatus(flow.res, 201, `앱 start(${account})`);
    jar = new CookieJar();
    const loginPath = new URL(flow.body.loginUrl).pathname;
    const page = await browserGet(jar, loginPath);
    isStatus(page, 200, "확인 페이지");
    must(!page.html.includes("확인 코드"), "확인 페이지에 확인 코드 문구가 남았다");
    const cont = await browserPost(jar, page, loginPath);
    const cb = await authorizeToCallback(cont);
    callback = await req("GET", cb, { jar });
    loop = await followLoopback(flow, callback, receiver);
  } finally {
    await receiver.close();
  }
  const redeemRes = await jsonPost("/auth/redeem", { grant: loop.grant, loginSecret: flow.loginSecret });
  isStatus(redeemRes, 200, "redeem");
  const redeem = json(redeemRes);
  if (redeem.status === "ok") registerBundle(redeem);
  return { flow, jar, callback, loop, redeem };
}

// ---- 환경 ----

async function assertPortFree(port, host) {
  return new Promise((resolveFn, rejectFn) => {
    const s = net.createServer();
    s.once("error", (e) => {
      if (e.code === "EADDRINUSE") rejectFn(new EnvError(`포트 ${port}(${host})를 다른 프로세스가 쓰고 있다. 다른 worktree의 wrangler dev·pnpm dev·channel-id-check를 끄고 다시 돌린다`));
      else if (e.code === "EADDRNOTAVAIL" || e.code === "EAFNOSUPPORT") resolveFn("absent");
      else rejectFn(e);
    });
    s.listen({ port, host, exclusive: true }, () => s.close(() => resolveFn("free")));
  });
}

const tail = (lines, n) => lines.slice(-n).join("\n");

function childEnv() {
  // 허용 목록: CLOUDFLARE_*·GITHUB_* 등은 넘기지 않는다
  return childEnvFor({ tmpRoot: TMP, parentEnv: process.env });
}

const TOTAL_BUDGET_MS = 600_000;
let DEADLINE = Date.now() + TOTAL_BUDGET_MS;
const activeChildren = new Set();

/** 호출마다 시간 제한 = min(개별 제한, 남은 전체 예산). 예산이 없으면 환경 오류 */
function budgetMs(limit) {
  const left = DEADLINE - Date.now();
  if (left <= 0) throw new EnvError("전체 10분을 넘었다");
  return Math.min(limit, left);
}

/** 자식을 비동기로 돌린다(spawnSync는 이벤트 루프를 막아 watchdog이 못 돈다). 시간 제한이 지나면 프로세스 그룹째 끈다 */
function runChild(cmd, args, { cwd, env, timeout }) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    activeChildren.add(child);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const killGroup = () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // 이미 끝났다
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeout);
    const done = (status) => {
      clearTimeout(timer);
      activeChildren.delete(child);
      resolveRun({ status, stdout, stderr, timedOut });
    };
    child.on("error", () => done(null));
    child.on("close", (code) => done(code));
  });
}

function killActiveChildren() {
  for (const c of activeChildren) {
    try {
      process.kill(-c.pid, "SIGKILL");
    } catch {
      // 이미 끝났다
    }
  }
}

/** 로컬 R2에 씨앗을 넣는다. 같은 폴더를 동시에 쓰면 SQLITE_READONLY로 실패해 하나씩 순서대로 넣는다 */
async function seedR2(persist, seedDir) {
  let i = 0;
  for (const [key, bytes] of seed) {
    const file = join(seedDir, String(i++));
    writeFileSync(file, bytes);
    const r = await runChild(process.execPath, [WRANGLER_JS, ...wranglerR2PutArgs({ key, file, persistTo: persist })], { cwd: WORKER, env: childEnv(), timeout: budgetMs(60_000) });
    if (r.status !== 0) throw new EnvError(`R2 씨앗 실패: ${key}(${r.timedOut ? "시간 초과" : `상태 ${r.status}`})\n${tail(stripAnsi(`${r.stdout}\n${r.stderr}`).split(/\r?\n/), 20)}`);
  }
}

function startWrangler(args) {
  mkdirSync(OUT, { recursive: true });
  const log = createWriteStream(join(OUT, "wrangler.log"));
  const lines = [];
  const child = spawn(process.execPath, [WRANGLER_JS, ...args], { cwd: WORKER, env: childEnv(), detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const feed = (stream) => {
    let buf = "";
    stream.setEncoding("utf8");
    stream.on("data", (d) => {
      buf += d;
      const parts = buf.split(/\r?\n/);
      buf = parts.pop() ?? "";
      for (const p of parts) {
        const s = stripAnsi(p);
        lines.push(s);
        log.write(`${s}\n`);
      }
    });
    stream.on("end", () => {
      if (buf !== "") {
        const s = stripAnsi(buf);
        lines.push(s);
        log.write(`${s}\n`);
      }
    });
  };
  feed(child.stdout);
  feed(child.stderr);
  let done = false;
  const exited = new Promise((r) =>
    child.once("close", (code, signal) => {
      done = true;
      log.end();
      // 파일에 마지막 줄까지 쓰인 뒤에 끝난 것으로 본다(곧 process.exit한다)
      finished(log).then(
        () => r({ code, signal }),
        () => r({ code, signal }),
      );
    }),
  );
  const kill = (sig) => {
    try {
      process.kill(-child.pid, sig);
    } catch {
      // 이미 끝났다
    }
  };
  return {
    lines,
    exited,
    isDone: () => done,
    async stop() {
      if (done) return;
      kill("SIGTERM");
      const t = setTimeout(() => kill("SIGKILL"), 10_000);
      await exited;
      clearTimeout(t);
    },
  };
}

/** /health가 이번 실행의 논스를 말할 때만 준비(8787을 다른 프로세스가 쓰면 그 응답은 논스가 다르다, 구현 중 변경 40 (라)) */
async function waitReady(nonce, w) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (w.isDone()) throw new EnvError(`wrangler dev가 준비 전에 끝났다\n${tail(w.lines, 30)}`);
    try {
      const r = await fetch(`${E2E_ORIGIN}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.status === 200) {
        const j = await r.json();
        if (j?.ok === true && j.build === nonce && !("bootstrap" in j)) return j;
      }
    } catch {
      // 아직 뜨지 않았다
    }
    await sleep(250);
  }
  throw new EnvError(`wrangler dev 준비 시간 초과(60초)\n${tail(w.lines, 30)}`);
}

async function runCheckOnly(version, build) {
  const r = await runChild(process.execPath, [join(REPO, "scripts/ci/release.mjs"), "worker", "--check-only", "--base", E2E_ORIGIN, "--version", version, "--build", build], {
    env: { PATH: process.env.PATH ?? "", CI_VERIFY_TOKEN: DEV.CI_VERIFY_TOKEN },
    timeout: budgetMs(120_000),
  });
  if (r.timedOut) throw new EnvError(`release.mjs worker --check-only(${version}) 시간 초과`);
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

/** xtask verify처럼 CI 토큰으로 R2 키를 받는다: ok(바이트) · missing(404) · infra(그 밖) */
async function xtaskGet(path, token) {
  const r = await req("GET", path, { headers: bearer(token) });
  if (r.status === 200) return { kind: "ok", bytes: r.bytes };
  if (r.status === 404) return { kind: "missing" };
  return { kind: "infra", status: r.status };
}

// ---- 시나리오 ----

const S = { nonce: "", flowA: null, csrfA: null, b2: null, c3: null, jarA: new CookieJar() };

const scenarios = [
  [
    "E00-ports",
    async () => {
      for (const [port, host] of [[E2E_PORT, E2E_BIND_IP], [E2E_PORT, "::1"], [FAKE_PORT, FAKE_HOST]]) await assertPortFree(port, host);
      // 검출기가 실제로 걸리는지(카나리가 든 줄을 놓치면 이후의 "위반 0"이 의미가 없다)
      const probe = makeCanaries();
      probe.add("secret", "probe", `probe-${crypto.randomUUID()}`);
      const bad = scanLogs([`{"event":"x","level":"info","route":"${probe.list()[0].value}"}`], probe);
      must(bad.violations.length === 1, "로그 카나리 검출기가 심은 값을 잡지 못한다");
    },
  ],
  [
    "E01-seed",
    async () => {
      const cfg = parseJsonc(readFileSync(join(WORKER, "wrangler.jsonc"), "utf8"));
      must(cfg.r2_buckets?.[0]?.bucket_name === E2E_BUCKET, "wrangler.jsonc의 R2 버킷 이름이 E2E_BUCKET과 다르다");
      seed = await buildSeed(TABLE, E2E_VERSIONS);
      sums = new Map();
      for (const line of dec.decode(seed.get(`releases/${LATEST}/SHA256SUMS`)).split("\n")) {
        const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
        if (m) sums.set(m[2], m[1]);
      }
      // 기대값은 release/expected-artifacts.json 표에서 계산한다(산출물 + updater .sig = SHA256SUMS 항목, 키 목록에서 SHA256SUMS·manifest.json 둘을 뺀 수)
      const wantSums = verifyKeys(TABLE, LATEST, false).length - 2;
      must(sums.size === wantSums, `SHA256SUMS 항목 ${sums.size}개, 기대 ${wantSums}개(출처: release/expected-artifacts.json의 ${LATEST} 산출물과 .sig)`);
      mkdirSync(join(TMP, "seed"), { recursive: true });
      await seedR2(join(TMP, "persist"), join(TMP, "seed"));
      // 버전마다 verifyKeys(latest 아님) + previous 하나, 그리고 releases/latest.json 하나
      const wantSeed = E2E_VERSIONS.reduce((n, v) => n + verifyKeys(TABLE, v, false).length + 1, 0) + 1;
      must(seed.size === wantSeed, `씨앗 객체 ${seed.size}개, 기대 ${wantSeed}개(출처: release/expected-artifacts.json × E2E_VERSIONS ${E2E_VERSIONS.join("·")}의 verifyKeys + previous + latest.json)`);
    },
  ],
  [
    "E02-boot",
    async () => {
      try {
        fakeServer = await startFakeChzzkServer();
      } catch (e) {
        throw new EnvError(String(e?.message ?? e)); // 8788 경합(E00 확인 뒤 다른 프로세스가 잡음)은 환경
      }
      S.nonce = `e2e-${Date.now().toString(36)}${Math.floor(Math.random() * 1679616).toString(36).padStart(4, "0")}`;
      wrangler = startWrangler(wranglerDevArgs({ persistTo: join(TMP, "persist"), buildId: S.nonce, fakeOrigin: fakeServer.origin }));
      const health = await waitReady(S.nonce, wrangler);
      must(Number.isInteger(health.schema) && health.schema >= 1, "/health의 schema가 1 이상의 정수가 아니다");
      // 로그 줄은 준비 직후 조금 늦게 들어올 수 있다
      for (let i = 0; i < 20 && !wrangler.lines.some((l) => l.includes("Using secrets defined in .dev.vars.example")); i++) await sleep(150);
      must(wrangler.lines.some((l) => l.includes("Using secrets defined in .dev.vars.example")), "wrangler가 .dev.vars.example을 쓴다는 줄이 없다");
      const banner = wrangler.lines.map((l) => /wrangler (\d+\.\d+\.\d+)/.exec(l)?.[1]).find((v) => v !== undefined);
      must(banner === WRANGLER_VERSION, `wrangler 버전 ${banner ?? "(배너 없음)"} ≠ tools.json ${WRANGLER_VERSION}`);
      if (process.env.CI === "true") must(!wrangler.lines.some((l) => l.includes("LEAK_SENTINEL")), "wrangler 로그에 LEAK_SENTINEL이 있다(실제 비밀값 파일을 읽었다)");
      // 고정 카나리(.dev.vars.example의 비밀값, 합성 채널 이름·ID)
      canaries.add("secret", "clientSecret", DEV.CHZZK_CLIENT_SECRET);
      canaries.add("secret", "ciToken", DEV.CI_VERIFY_TOKEN);
      for (const a of Object.values(FAKE_ACCOUNTS)) {
        canaries.add("secret", "channelName", a.channelName);
        canaries.add("path", "channelId", a.channelId);
      }
      // 스로틀용 합성 IP(§14 "IP 원문" 금지). 요청 줄·배너에는 클라이언트 IP가 찍히지 않아 비밀 종류다. 127.0.0.1은 배너에 찍혀 넣지 않는다
      for (const ip of [IP_ADMIN, IP_B2, IP_C3, IP_CANCEL, IP_T4, IP_T4B, IP_T6A, IP_T6B, IP_T6C]) canaries.add("secret", "ip", ip);
    },
  ],
  [
    "E03-origin-guard",
    async () => {
      const r = await req("GET", `http://${E2E_BIND_IP}:${E2E_PORT}/health`);
      isStatus(r, 503, "127.0.0.1로 들어온 /health");
      const j = json(r);
      must(j.ok === false && j.code === "config_error", "127.0.0.1로 들어온 /health가 config_error가 아니다");
    },
  ],
  [
    "E04-web-admin",
    async () => {
      fakeServer.fake.state.account = "a1";
      const jar = S.jarA;
      const anon = await browserGet(jar, "/");
      isStatus(anon, 200, "비로그인 랜딩");
      const start = await browserPost(jar, anon, "/auth/web/start", {}, { ip: IP_ADMIN });
      must(jar.has("cdl_f"), "웹 start가 흐름 쿠키를 주지 않았다");
      const cb = await authorizeToCallback(start);
      const callback = await req("GET", cb, { jar });
      isStatus(callback, 303, "웹 콜백");
      must(new URL(callback.headers.get("location") ?? "", E2E_ORIGIN).pathname === "/", "웹 콜백이 /로 보내지 않았다");
      const sessionLine = callback.headers.getSetCookie().map(cookieAttrs).find((c) => c.name === "cdl_s");
      must(sessionLine !== undefined, "웹 콜백이 세션 쿠키를 주지 않았다");
      for (const a of ["httponly", "samesite=lax", "path=/", "max-age=43200"]) must(sessionLine.attrs.includes(a), `세션 쿠키 속성 ${a}가 없다`);
      must(!sessionLine.attrs.includes("secure"), "dev 세션 쿠키에 secure가 있다(http라 브라우저가 버린다)");
      must(!jar.has("cdl_f"), "웹 콜백 뒤에도 흐름 쿠키가 남았다");
      const home = await browserGet(jar, "/");
      isStatus(home, 200, "로그인 랜딩");
      must(home.policy === "same-origin", "랜딩의 Referrer-Policy가 same-origin이 아니다");
      const csp = home.res.headers.get("content-security-policy") ?? "";
      must(csp.includes(`form-action 'self' ${FAKE_ORIGIN}`), "CSP form-action에 가짜 치지직 출처가 없다");
      must(home.html.includes('href="/admin"'), "관리자 랜딩에 /admin 링크가 없다");
      const links = extractDownloadLinks(home.html);
      // 랜딩은 사람이 받는 설치 파일만 보인다: updater 전용 산출물(app-tar)은 표에 없다
      const wantLinks = expectedArtifacts(TABLE, LATEST).filter((a) => a.kind !== "app-tar").length;
      must(links.length === wantLinks, `다운로드 링크 ${links.length}개, 기대 ${wantLinks}개(출처: release/expected-artifacts.json의 ${LATEST} 산출물 중 app-tar 제외)`);
      for (const l of links) {
        must(l.href.startsWith(`/releases/${LATEST}/`), "다운로드 링크가 최신 버전이 아니다");
        must(sums.get(l.file) === l.sha256, "다운로드 표의 sha256이 씨앗의 SHA256SUMS와 다르다");
      }
      S.csrfA = pageCsrf(home, "랜딩");
      const dl = await req("GET", links[0].href, { jar });
      isStatus(dl, 200, "웹 쿠키로 받기");
      must(dl.bytes.length === 1024 && (await sha256Hex(dl.bytes)) === sums.get(links[0].file), "웹 쿠키로 받은 파일이 씨앗과 다르다");
      isStatus(await req("GET", "/releases/latest.json", { jar }), 403, "웹 쿠키로 latest.json");
    },
  ],
  [
    "E05-admin-origin",
    async () => {
      const jar = S.jarA;
      const page = await browserGet(jar, "/admin");
      isStatus(page, 200, "/admin");
      must(page.policy === "same-origin", "/admin의 Referrer-Policy가 same-origin이 아니다");
      const csrf = pageCsrf(page, "/admin");
      const d4 = { csrf, channelId: ID("d4") };
      isStatus(await browserPost(jar, page, "/admin/allow", d4, { policy: "no-referrer" }), 403, "Origin: null");
      isStatus(await browserPost(jar, page, "/admin/allow", d4, { headers: { Origin: null } }), 403, "Origin 없음");
      isStatus(await browserPost(jar, page, "/admin/allow", d4, { headers: { "Sec-Fetch-Site": "cross-site" } }), 403, "Sec-Fetch-Site: cross-site");
      isStatus(await browserPost(jar, page, "/admin/allow", { ...d4, csrf: "A".repeat(43) }), 403, "틀린 csrf");
      isStatus(await browserPost(jar, page, "/admin/allow", d4, { contentType: "text/plain" }), 415, "form이 아닌 Content-Type");
      const ok = await browserPost(jar, page, "/admin/allow", { csrf, channelId: ID("b2"), note: "e2e" });
      isStatus(ok, 303, "Origin 정상 허용 POST");
      must(new URL(ok.headers.get("location") ?? "", E2E_ORIGIN).pathname === "/admin", "허용 POST가 /admin으로 보내지 않았다");
      const after = await browserGet(jar, "/admin");
      must(after.html.includes(ID("b2")), "허용 뒤 /admin에 b2가 없다");
      must(!after.html.includes(ID("d4")), "거부된 POST인데 d4가 허용목록에 있다");
    },
  ],
  [
    "E06-app-b2",
    async () => {
      fakeServer.fake.state.account = "b2";
      const receiver = await startReceiver();
      let flow;
      let callback;
      let loop;
      const jar = new CookieJar();
      try {
        flow = await appStart(IP_B2, receiver.port);
        isStatus(flow.res, 201, "앱 start");
        must(JSON.stringify(Object.keys(flow.body).sort()) === JSON.stringify(["expiresAt", "loginUrl"]), "start 응답의 키가 expiresAt·loginUrl뿐이 아니다");
        must(flow.body.loginUrl.startsWith(`${E2E_ORIGIN}/auth/login/`), "loginUrl이 PUBLIC_ORIGIN 아래가 아니다");
        const loginPath = new URL(flow.body.loginUrl).pathname;
        const page = await browserGet(jar, loginPath);
        isStatus(page, 200, "확인 페이지");
        must(page.policy === "same-origin", "확인 페이지의 Referrer-Policy가 same-origin이 아니다");
        const csp = page.res.headers.get("content-security-policy") ?? "";
        must(csp.includes(`form-action 'self' ${FAKE_ORIGIN} http://127.0.0.1:*`), "확인 페이지 CSP의 form-action에 가짜 치지직과 루프백 출처가 없다");
        must(!page.html.includes("확인 코드"), "확인 페이지에 확인 코드 문구가 남았다");
        isStatus(await browserPost(jar, page, loginPath, {}, { policy: "no-referrer" }), 403, "Origin: null [계속]");
        const cont = await browserPost(jar, page, loginPath);
        const cb = await authorizeToCallback(cont);
        must(jar.has("cdl_f"), "[계속]이 흐름 쿠키를 주지 않았다");
        isStatus(await browserPost(jar, page, loginPath), 409, "같은 흐름의 두 번째 [계속]");
        callback = await req("GET", cb, { jar });
        loop = await followLoopback(flow, callback, receiver);
        must(!jar.has("cdl_f"), "완료 뒤에도 흐름 쿠키가 남았다");
      } finally {
        await receiver.close();
      }
      const r1 = await jsonPost("/auth/redeem", { grant: loop.grant, loginSecret: flow.loginSecret });
      isStatus(r1, 200, "redeem#1");
      const b = json(r1);
      must(b.status === "ok" && b.channelId === ID("b2") && b.isAdmin === false, "redeem#1이 b2(비관리자)의 ok가 아니다");
      must(b.accessToken.startsWith("cda_") && b.refreshToken.startsWith("cdr_"), "토큰 접두가 cda_/cdr_가 아니다");
      registerBundle(b);
      S.b2 = { A0: b.accessToken, R0: b.refreshToken };
      const r2 = await jsonPost("/auth/redeem", { grant: loop.grant, loginSecret: flow.loginSecret });
      isStatus(r2, 404, "redeem#2");
      must(json(r2).code === "not_found", "redeem#2의 code가 not_found가 아니다");
      const me = await req("GET", "/api/me", { headers: bearer(S.b2.A0) });
      isStatus(me, 200, "/api/me");
      must(json(me).channelId === ID("b2"), "/api/me의 channelId가 b2가 아니다");
    },
  ],
  [
    "E06b-app-outdated",
    async () => {
      // 옛 앱(v0.1.1) 대응: 포트 없는 start는 201 미끼, 안내 페이지, poll 비석
      const decoy = await jsonPost("/auth/start", { pollVerifier: b64url(crypto.getRandomValues(new Uint8Array(32))), client: "app/0.1.1 e2e" });
      isStatus(decoy, 201, "옛 앱 start");
      const d = json(decoy);
      must(/^[A-Za-z0-9_-]{22}$/.test(d.loginId), "미끼 loginId가 22자 b64url이 아니다");
      must(d.userCode === "UPDA-TE22", "미끼 userCode가 UPDA-TE22가 아니다");
      must(d.pollIntervalMs === 30000, "미끼 pollIntervalMs가 30000이 아니다");
      const handle = d.loginUrl.split("/").pop();
      must(/^[A-Za-z0-9_-]{22}$/.test(handle), "미끼 loginUrl의 handle이 22자 b64url이 아니다");
      const page = await browserGet(new CookieJar(), new URL(d.loginUrl).pathname);
      isStatus(page, 200, "미끼 안내 페이지");
      must(page.html.includes("앱이 오래됐어요"), "안내 페이지에 업데이트 문구가 없다");
      const poll = await jsonPost("/auth/poll", {});
      isStatus(poll, 404, "poll 비석");
      must(json(poll).code === "app_outdated", "poll 비석의 code가 app_outdated가 아니다");
    },
  ],
  [
    "E07-release-app",
    async () => {
      const { A0 } = S.b2;
      const latest = seed.get("releases/latest.json");
      const up = await req("GET", "/update/0.1.0", { headers: bearer(A0) });
      isStatus(up, 200, "/update/0.1.0");
      must(sameBytes(up.bytes, latest), "/update/0.1.0의 본문이 씨앗 latest.json과 다르다");
      isStatus(await req("GET", `/update/${LATEST}`, { headers: bearer(A0) }), 204, `/update/${LATEST}`);
      isStatus(await req("GET", "/update/0.3.0", { headers: bearer(A0) }), 204, "/update/0.3.0");
      const dmg = expectedArtifacts(TABLE, LATEST).find((a) => a.kind === "dmg").file;
      const path = `/releases/${LATEST}/${dmg}`;
      const seedBytes = seed.get(`releases/${LATEST}/${dmg}`);
      const full = await req("GET", path, { headers: bearer(A0) });
      isStatus(full, 200, "dmg 전체");
      must(full.headers.get("content-length") === "1024", "dmg Content-Length가 1024가 아니다");
      must(!full.headers.has("content-encoding"), "dmg에 Content-Encoding이 있다");
      must((await sha256Hex(full.bytes)) === sums.get(dmg), "dmg의 sha256이 SHA256SUMS와 다르다");
      const part = await req("GET", path, { headers: { ...bearer(A0), Range: "bytes=0-9" } });
      isStatus(part, 206, "Range 0-9");
      must(part.headers.get("content-range") === "bytes 0-9/1024", "Content-Range가 bytes 0-9/1024가 아니다");
      must(sameBytes(part.bytes, seedBytes.slice(0, 10)), "Range 본문이 씨앗의 앞 10바이트와 다르다");
      const bad = await req("GET", path, { headers: { ...bearer(A0), Range: "bytes=2000-2100" } });
      isStatus(bad, 416, "범위 밖 Range");
      must(bad.headers.get("content-range") === "bytes */1024", "416의 Content-Range가 bytes */1024가 아니다");
      const head = await req("HEAD", path, { headers: bearer(A0) });
      isStatus(head, 200, "HEAD");
      must(head.bytes.length === 0 && head.headers.get("content-length") === "1024", "HEAD가 본문 없이 Content-Length 1024를 주지 않았다");
      const etag = full.headers.get("etag");
      must(etag !== null, "dmg 응답에 ETag가 없다");
      isStatus(await req("GET", path, { headers: { ...bearer(A0), "If-None-Match": etag } }), 304, "If-None-Match");
      isStatus(await req("GET", "/releases/latest.json", { headers: bearer(A0) }), 403, "앱 토큰으로 latest.json");
      isStatus(await req("GET", `/releases/${LATEST}/previous`, { headers: bearer(A0) }), 403, "앱 토큰으로 previous");
    },
  ],
  [
    "E08-rotation",
    async () => {
      const rotate = (token) => jsonPost("/auth/refresh", { refreshToken: token });
      const ok = async (token, what) => {
        const r = await rotate(token);
        isStatus(r, 200, what);
        const b = json(r);
        registerBundle(b);
        return b;
      };
      const code = async (token, want, what) => {
        const r = await rotate(token);
        isStatus(r, 401, what);
        must(json(r).code === want, `${what}: code가 ${want}가 아니다`);
      };
      const { R0 } = S.b2;
      const g1 = await ok(R0, "R0 회전");
      const g1b = await ok(R0, "R0 다시(60초 안 복구)");
      must(g1b.refreshToken !== g1.refreshToken, "복구가 같은 토큰을 다시 냈다");
      const g2 = await ok(g1b.refreshToken, "복구된 자식 회전");
      await code(R0, "session_revoked", "R0 재사용");
      await code(g1.refreshToken, "session_expired", "지워진 옛 자식");
      const me = await req("GET", "/api/me", { headers: bearer(g2.accessToken) });
      isStatus(me, 401, "재사용 뒤 마지막 access");
      must(json(me).code === "session_revoked", "마지막 access의 code가 session_revoked가 아니다");
    },
  ],
  [
    "E09-denied-c3",
    async () => {
      const r = await appLogin("c3", IP_C3);
      must(r.redeem.status === "denied" && r.redeem.channelName === FAKE_ACCOUNTS.c3.channelName, "redeem이 c3 denied가 아니다");
    },
  ],
  [
    "E10-allow-c3",
    async () => {
      const jar = S.jarA;
      const page = await browserGet(jar, "/admin");
      isStatus(page, 200, "/admin");
      must(page.html.includes(ID("c3")), "거부 목록에 c3가 없다");
      must(!page.html.includes("<script"), "/admin에 <script가 있다(이스케이프 실패)");
      const csrf = pageCsrf(page, "/admin");
      const allow = await browserPost(jar, page, `/admin/denied/${ID("c3")}/allow`, { csrf });
      isStatus(allow, 303, "거부 목록에서 허용");
      const r = await appLogin("c3", IP_C3);
      must(r.redeem.status === "ok" && r.redeem.channelId === ID("c3"), "허용 뒤 c3 로그인이 ok가 아니다");
      S.c3 = { A: r.redeem.accessToken, R: r.redeem.refreshToken };
    },
  ],
  [
    "E11-admin-revoke",
    async () => {
      const jar = S.jarA;
      const page = await browserGet(jar, "/admin");
      isStatus(page, 200, "/admin");
      const ids = extractRowIds(page.html, { channelId: ID("c3"), actionPrefix: "/admin/sessions/" });
      must(ids.length === 1, `c3의 세션 행 ${ids.length}개(필요 1)`);
      const csrf = pageCsrf(page, "/admin");
      const rev = await browserPost(jar, page, `/admin/sessions/${ids[0]}/revoke`, { csrf });
      isStatus(rev, 303, "관리자 [끊기]");
      const me = await req("GET", "/api/me", { headers: bearer(S.c3.A) });
      isStatus(me, 401, "끊긴 access");
      must(json(me).code === "session_revoked", "끊긴 access의 code가 session_revoked가 아니다");
      const rf = await jsonPost("/auth/refresh", { refreshToken: S.c3.R });
      isStatus(rf, 401, "끊긴 refresh");
      must(json(rf).code === "session_revoked", "끊긴 refresh의 code가 session_revoked가 아니다");
    },
  ],
  [
    "E12-cancel",
    async () => {
      fakeServer.fake.state.authorize = "cancel";
      try {
        const r = await appLogin("b2", IP_CANCEL);
        must(r.redeem.status === "cancelled", "취소한 흐름의 redeem이 cancelled가 아니다");
      } finally {
        fakeServer.fake.state.authorize = "approve";
      }
    },
  ],
  [
    "E13-web-logout",
    async () => {
      const jar = S.jarA;
      const page = await browserGet(jar, "/");
      isStatus(page, 200, "랜딩");
      const out = await browserPost(jar, page, "/auth/web/logout", { csrf: pageCsrf(page, "랜딩") });
      isStatus(out, 303, "웹 로그아웃");
      must(new URL(out.headers.get("location") ?? "", E2E_ORIGIN).pathname === "/", "웹 로그아웃이 /로 보내지 않았다");
      must(!jar.has("cdl_s"), "웹 로그아웃 뒤에도 세션 쿠키가 남았다");
      const admin = await req("GET", "/admin", { jar });
      isStatus(admin, 303, "로그아웃 뒤 /admin");
      must(new URL(admin.headers.get("location") ?? "", E2E_ORIGIN).pathname === "/", "로그아웃 뒤 /admin이 /로 보내지 않았다");
    },
  ],
  [
    "E14-throttle",
    async () => {
      // 스로틀 키에 일 번호가 든다: UTC 자정이 60초 안이면 자정을 넘긴 뒤에 잰다
      const toMidnight = 86_400_000 - (Date.now() % 86_400_000);
      if (toMidnight < 60_000) await sleep(toMidnight + 1000);
      const start = async (ip) => (await appStart(ip)).res;
      for (let i = 0; i < 3; i++) isStatus(await start(IP_T4), 201, `IPv4 ${i + 1}번째 start`);
      const limited = await start(IP_T4);
      isStatus(limited, 429, "IPv4 4번째 start");
      const retry = limited.headers.get("retry-after") ?? "";
      must(/^\d+$/.test(retry) && Number(retry) >= 1 && Number(retry) <= 600, "429의 Retry-After가 1~600의 정수가 아니다");
      isStatus(await start(IP_T4B), 201, "다른 IPv4");
      isStatus(await start(IP_T6A), 201, "IPv6 /64 첫 start");
      isStatus(await start(IP_T6A), 201, "IPv6 /64 둘째 start");
      isStatus(await start(IP_T6B), 201, "같은 /64의 셋째 start");
      isStatus(await start(IP_T6B), 429, "같은 /64의 넷째 start");
      isStatus(await start(IP_T6C), 201, "다른 /64");
    },
  ],
  [
    "E15-ci-keys",
    async () => {
      const token = DEV.CI_VERIFY_TOKEN;
      for (const v of E2E_VERSIONS) {
        for (const key of verifyKeys(TABLE, v, v === LATEST)) {
          const r = await xtaskGet(`/${key}`, token);
          must(r.kind === "ok", `CI 토큰으로 ${key}: ${r.kind}${r.status ? ` ${r.status}` : ""}`);
          must(sameBytes(r.bytes, seed.get(key)), `${key}의 본문이 씨앗과 다르다`);
        }
      }
      must((await xtaskGet("/releases/0.3.0/SHA256SUMS", token)).kind === "missing", "씨앗에 없는 키가 404가 아니다");
      const bad = await req("GET", `/releases/${LATEST}/a%2Fb`, { headers: bearer(token) });
      isStatus(bad, 400, "인코딩된 슬래시 키");
      must(json(bad).code === "bad_key", "인코딩된 슬래시 키의 code가 bad_key가 아니다");
      isStatus(await req("GET", "/releases/latest.json", { headers: bearer("wrong-ci-token-0000") }), 401, "틀린 CI 토큰");
      const admin = await req("GET", "/admin", { headers: bearer(token) });
      isStatus(admin, 303, "CI 토큰으로 /admin");
      must(new URL(admin.headers.get("location") ?? "", E2E_ORIGIN).pathname === "/", "CI 토큰의 /admin이 /로 보내지 않았다");
      isStatus(await req("GET", "/api/me", { headers: bearer(token) }), 401, "CI 토큰으로 /api/me");
      // 릴리스 경로 전체: 404는 씨앗에 없는 키에서만, 3xx는 304뿐, Location 헤더는 0건
      for (const e of releaseLog) {
        must(!e.hasLocation, "릴리스 응답에 Location 헤더가 있다");
        must(e.status < 300 || e.status >= 400 || e.status === 304, `릴리스 경로에 3xx(${e.status})가 있다`);
        if (e.status === 404) must(!seed.has(e.path.slice(1)), "씨앗에 있는 키가 404다");
      }
    },
  ],
  [
    "E16-check-only",
    async () => {
      const good = await runCheckOnly(LATEST, S.nonce);
      must(good.status === 0, `release.mjs worker --check-only(${LATEST}) 종료 ${good.status}, 기대 0\n${good.out.split("\n").filter((l) => /fail|error/i.test(l)).slice(0, 12).join("\n")}`);
      const wrong = await runCheckOnly(E2E_VERSIONS[0], S.nonce);
      must(wrong.status === 1, `release.mjs worker --check-only(${E2E_VERSIONS[0]}) 종료 ${wrong.status}, 기대 1`);
    },
  ],
  [
    "E17-log-canary",
    async () => {
      const { state } = fakeServer.fake;
      await wrangler.stop();
      await fakeServer.close();
      fakeServer = null;
      // 가짜 치지직이 낸 모든 code·토큰
      for (const c of state.issuedCodes) canaries.add("secret", "chzzk.code", c);
      for (const t of state.issuedTokens) canaries.add("secret", "chzzk.token", t);
      // 동적 카나리가 실제로 등록됐는지(고정 카나리만으로 녹색이 되지 않게). 값은 메시지에 싣지 않는다
      const labels = new Set(canaries.list().map((c) => c.label));
      const missing = REQUIRED_CANARY_LABELS.filter((l) => !labels.has(l));
      must(missing.length === 0, `등록되지 않은 카나리 종류: ${missing.join(", ")}`);
      must(canaries.list().length >= MIN_CANARIES, `카나리 ${canaries.list().length}개(필요 ≥${MIN_CANARIES})`);
      const r = scanLogs(wrangler.lines, canaries);
      S.scan = r;
      const problems = [...r.violations, ...checkEvents(r.events)];
      must(r.counts.event >= 15, `Worker JSON 줄 ${r.counts.event}개(필요 ≥15)`);
      must(problems.length === 0, `로그 위반 ${problems.length}건\n${problems.slice(0, 30).join("\n")}`);
    },
  ],
];

// ---- 실행 ----

/** 카나리 label별 수(값은 싣지 않는다) */
function canaryLabelCounts() {
  const out = {};
  for (const c of canaries.list()) out[c.label] = (out[c.label] ?? 0) + 1;
  return out;
}

async function cleanup() {
  try {
    await wrangler?.stop();
  } catch {
    // 이미 끝났다
  }
  try {
    await fakeServer?.close();
  } catch {
    // 이미 닫혔다
  }
  if (TMP) rmSync(TMP, { recursive: true, force: true });
}

const RUN = { results: [], exit: 0, written: false };

/** result.json을 쓴다. 정상 종료·시간 초과·신호가 모두 이 함수 하나를 거친다(한 번만) */
function writeResult(exit, { abort } = {}) {
  if (RUN.written) return;
  RUN.written = true;
  const lines = wrangler?.lines ?? [];
  const scan = S.scan ?? scanLogs(lines, canaries);
  const body = { ok: exit === 0, exit, ...(abort ? { abort } : {}), scenarios: RUN.results, violations: scan.violations.length, events: scan.events, lineCounts: { ...scan.counts, total: lines.filter((l) => classifyLine(l) !== "blank").length }, canaryLabels: canaryLabelCounts(), wranglerVersion: WRANGLER_VERSION };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "result.json"), `${JSON.stringify(body, null, 2)}\n`);
}

/** 시간 초과·신호: 자식을 끄고 result.json(exit 2 + abort)을 쓴 뒤 끝낸다 */
async function abortRun(abort, processExit, message) {
  console.error(message);
  killActiveChildren();
  await cleanup();
  RUN.exit = 2;
  writeResult(2, { abort });
  process.exit(processExit);
}

async function main() {
  DEADLINE = Date.now() + TOTAL_BUDGET_MS;
  // 앞 실행의 wrangler.log가 새 result.json 옆에 남지 않게 비운다
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  TMP = mkdtempSync(join(tmpdir(), "chzzk-worker-e2e-"));
  for (const d of ["persist", "seed", "home", "xdg"]) mkdirSync(join(TMP, d), { recursive: true });
  const watchdog = setTimeout(() => abortRun("timeout", 2, "worker-e2e: 전체 10분을 넘었다"), TOTAL_BUDGET_MS);
  watchdog.unref();
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => abortRun(sig, 130, `worker-e2e: ${sig}로 중단`));
  }
  const results = RUN.results;
  let exit = 0;
  try {
    for (const [id, fn] of scenarios) {
      const t0 = Date.now();
      try {
        await fn();
        results.push({ id, ok: true, ms: Date.now() - t0 });
        console.log(`ok   ${id} (${Date.now() - t0}ms)`);
      } catch (e) {
        const msg = `${e instanceof Fail || e instanceof EnvError ? "" : `${e?.name ?? "Error"}: `}${String(e?.message ?? e).slice(0, 2000)}`;
        results.push({ id, ok: false, ms: Date.now() - t0, error: msg });
        console.error(`FAIL ${id}: ${msg}`);
        if (process.env.E2E_DEBUG && e?.stack) console.error(e.stack);
        exit = e instanceof EnvError ? 2 : 1;
        break;
      }
    }
  } finally {
    await cleanup();
    const lines = wrangler?.lines ?? [];
    const scan = S.scan ?? scanLogs(lines, canaries);
    if (exit !== 0 && lines.length > 0) {
      // 로그 끝에 카나리가 있을 수 있어 위반이 있으면 원문 tail 대신 위치와 종류만 찍는다
      if (scan.violations.length > 0) console.error(`--- wrangler.log 위반 ${scan.violations.length}건(원문은 찍지 않는다) ---\n${scan.violations.slice(0, 30).join("\n")}`);
      else console.error(`--- wrangler.log 끝 80줄 ---\n${tail(lines, 80)}`);
    }
    writeResult(exit);
  }
  return exit;
}

process.exit(await main());
