// HTTP 흐름 테스트 도우미(테스트 파일이 아니다). 시계·쿠키 항아리·앱 클라이언트·로그인 전 과정.
// 흐름 테스트는 모두 redirect: "manual"로 303을 직접 따라간다(exports.default.fetch는 기본으로 따라간다, 구현 중 변경 26 (나)).
import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { expect, vi } from "vitest";
import { newSecret, sha256B64url } from "../../src/core/token";
import worker from "../../src/index";
import { AUTH_STORE_NAME } from "../../src/store/AuthStore";
import type { FakeAccountKey, FakeChzzk } from "../fake-chzzk.mjs";

export const ORIGIN = "http://localhost:8787";
export const HOUR = 3_600_000;
const T0 = Date.UTC(2030, 0, 1);

let slot = 0;
/** 테스트마다 다른 기준 시각(흐름 상한 32·회전 상한·폴링 간격이 같은 파일의 테스트 사이에 새지 않게). 시각은 늘 실제보다 미래다 */
export function useClock(): number {
  vi.useFakeTimers({ toFake: ["Date"] });
  const t = T0 + ++slot * HOUR;
  vi.setSystemTime(t);
  return t;
}

export function advance(ms: number): void {
  vi.setSystemTime(Date.now() + ms);
}

export type Send = (url: string, init: RequestInit) => Promise<Response>;
export const viaExports: Send = (u, i) => exports.default.fetch(u, { ...i, redirect: "manual" });
export const viaEnv =
  (patch: Record<string, unknown>): Send =>
  (u, i) =>
    worker.fetch(new Request(u, i) as Parameters<typeof worker.fetch>[0], { ...env, ...patch } as Env);

export const store = () => env.AUTH.get(env.AUTH.idFromName(AUTH_STORE_NAME));

/** 한 파일의 테스트는 같은 DO 저장소를 쓴다: 세션·허용목록·거부 기록을 세어 보는 테스트는 먼저 비운다(흐름 표는 건드리지 않는다) */
export async function resetStore(): Promise<void> {
  await runInDurableObject(store(), (i) => {
    for (const table of ["refresh", "session", "allowlist", "denied", "audit"]) i.db.run(`DELETE FROM ${table}`);
  });
}

type HeaderPatch = Record<string, string | null>;

function merge(base: Record<string, string>, patch?: HeaderPatch): Record<string, string> {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

/** 쿠키 항아리 + 수동 리디렉트. 우리 출처의 쿠키만 다룬다(Max-Age=0은 지운다) */
export class Browser {
  readonly jar = new Map<string, string>();
  constructor(
    readonly send: Send = viaExports,
    readonly origin = ORIGIN,
  ) {}

  private cookieHeader(): Record<string, string> {
    if (this.jar.size === 0) return {};
    return { Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") };
  }

  private absorb(res: Response): Response {
    for (const line of res.headers.getSetCookie()) {
      const [pair = "", ...attrs] = line.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      const gone = value === "" || attrs.some((a) => a.trim().toLowerCase() === "max-age=0");
      if (gone) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return res;
  }

  async get(pathOrUrl: string, headers?: HeaderPatch): Promise<Response> {
    const url = new URL(pathOrUrl, this.origin).toString();
    return this.absorb(await this.send(url, { method: "GET", headers: merge(this.cookieHeader(), headers) }));
  }

  /** form POST(본문 기본은 빈 문자열). 기본 헤더: 맞는 Origin·Sec-Fetch-Site·form Content-Type(null을 주면 그 헤더를 뺀다) */
  async post(path: string, headers?: HeaderPatch, body: string | Uint8Array = ""): Promise<Response> {
    const base = { ...this.cookieHeader(), Origin: this.origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/x-www-form-urlencoded" };
    return this.absorb(await this.send(new URL(path, this.origin).toString(), { method: "POST", headers: merge(base, headers), body }));
  }

  /** [계속]·web start의 303 Location을 가짜 치지직에 직접 보내고(Worker는 인가 주소를 부르지 않는다) 콜백 URL을 돌려준다 */
  async authorize(res: Response, fake: FakeChzzk): Promise<string> {
    expect(res.status).toBe(303);
    const location = res.headers.get("Location") ?? "";
    const r = await fake.handle(new Request(location));
    expect(r.status).toBe(302);
    return r.headers.get("Location") ?? "";
  }
}

export class AppClient {
  constructor(
    readonly send: Send = viaExports,
    readonly origin = ORIGIN,
  ) {}

  private json(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return this.send(this.origin + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  async start(ip?: string): Promise<{ res: Response; body: any; pollSecret: string }> {
    const pollSecret = newSecret();
    const res = await this.json("/auth/start", { pollVerifier: await sha256B64url(pollSecret), client: "app/0.2.0 macos" }, ip ? { "CF-Connecting-IP": ip } : {});
    return { res, body: await res.clone().json(), pollSecret };
  }

  /** 폴링 간격(1.5초)을 넘기려 먼저 2초 흐른다 */
  async poll(loginId: string, pollSecret: string): Promise<Response> {
    advance(2000);
    return this.pollNow(loginId, pollSecret);
  }

  pollNow(loginId: string, pollSecret: string): Promise<Response> {
    return this.json("/auth/poll", { loginId, pollSecret });
  }

  refresh(token: unknown): Promise<Response> {
    return this.json("/auth/refresh", { refreshToken: token });
  }

  me(access?: string): Promise<Response> {
    return this.send(this.origin + "/api/me", { method: "GET", headers: access === undefined ? {} : { Authorization: `Bearer ${access}` } });
  }

  logout(o: { access?: string; refresh?: string; raw?: string }): Promise<Response> {
    const headers: Record<string, string> = {};
    if (o.access !== undefined) headers.Authorization = `Bearer ${o.access}`;
    return this.json("/auth/logout", o.raw ?? (o.refresh === undefined ? "" : { refreshToken: o.refresh }), headers);
  }
}

export const codeIn = (htmlText: string): string | null => /<p class="code">([2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4})<\/p>/.exec(htmlText)?.[1] ?? null;

/** 앱 로그인 전 과정. 단계마다 상태를 단언하고 결과를 돌려준다(승인이든 거부든 취소든 같은 길을 간다) */
export async function appFlow(o: { fake: FakeChzzk; browser?: Browser; app?: AppClient; pollFirst?: boolean }) {
  const browser = o.browser ?? new Browser();
  const app = o.app ?? new AppClient();
  const { res: startRes, body: start, pollSecret } = await app.start();
  expect(startRes.status).toBe(201);
  const loginPath = new URL(start.loginUrl).pathname;
  const loginPage = await browser.get(loginPath);
  expect(loginPage.status).toBe(200);
  const loginHtml = await loginPage.text();
  const cont = await browser.post(loginPath);
  expect(cont.status).toBe(303);
  const callbackUrl = await browser.authorize(cont, o.fake);
  const callback = await browser.get(callbackUrl);
  expect(callback.status).toBe(303);
  const openDone = async () => {
    const r = await browser.get(callback.headers.get("Location") ?? "");
    expect(r.status).toBe(200);
    return r;
  };
  // pollFirst: 앱이 먼저 수령한 뒤에도 완료 페이지가 확인 코드를 보이는지(구현 중 변경 23·27 (가))
  const poll = o.pollFirst ? await app.poll(start.loginId, pollSecret) : null;
  const done = await openDone();
  const doneHtml = await done.text();
  const pollRes = poll ?? (await app.poll(start.loginId, pollSecret));
  const pollBody: any = await pollRes.clone().json();
  return { start, pollSecret, loginPage, loginHtml, cont, callbackUrl, callback, done, doneHtml, poll: pollRes, pollBody, browser };
}

/** 이 파일 공통 규약의 afterEach에서 쓴다 */
export const allowedChannel = (channelId: string, by: string) => store().allow(channelId, "", by, Date.now());

/** application/x-www-form-urlencoded 본문 */
export const formBody = (f: Record<string, string>): string => new URLSearchParams(f).toString();

/** 페이지의 첫 csrf 숨은 입력 값 */
export const csrfIn = (t: string): string | null => /name="csrf" value="([A-Za-z0-9_-]{43})"/.exec(t)?.[1] ?? null;

/** 웹 로그인 전 과정(승인): start → 가짜 치지직 → 콜백. 허용되지 않은 계정이면 세션 쿠키가 없다 */
export async function webLoginHttp(fake: FakeChzzk, account: FakeAccountKey, browser = new Browser()): Promise<{ browser: Browser; callback: Response }> {
  fake.state.account = account;
  fake.state.authorize = "approve";
  const start = await browser.post("/auth/web/start");
  const callbackUrl = await browser.authorize(start, fake);
  const callback = await browser.get(callbackUrl);
  return { browser, callback };
}
