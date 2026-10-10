// 읽기 페이지 `/help`·`/privacy`·`/licenses`(docs/design/system/web.md §10, 계약 §5): 읽기 척도·색인·자격 없음,
// 도움말의 모든 id가 응답에 있다, 처리방침의 보관 기간 숫자 = 코드 상수, 라이선스 원문이 비어 있지 않다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escapeHtml } from "../../src/core/html";
import { COPY } from "../../src/http/copy";
import { HELP } from "../../src/http/help.generated";
import { LICENSES } from "../../src/http/licenses.generated";
import { AUDIT_CAP, DENIED_CAP, DENIED_KEEP_MS } from "../../src/store/allowlist";
import { FLOW_TTL_MS } from "../../src/store/flows";
import { REFRESH_TTL_MS, SESSION_MAX_MS, WEB_TTL_MS } from "../../src/store/sessions";
import { REVOKED_KEEP_MS } from "../../src/store/sweep";
import { createFakeChzzk, FAKE_ACCOUNTS, type FakeChzzk } from "../fake-chzzk.mjs";
import { installFakeChzzk, type FakeNet } from "../network";
import { A1, B2 } from "../store/helpers";
import { allowedChannel, Browser, countingSend, h1Of, resetStore, useClock, webLoginHttp } from "./harness";

let fake: FakeChzzk;
let net: FakeNet;

beforeEach(async () => {
  useClock();
  fake = createFakeChzzk();
  net = installFakeChzzk(fake);
  await resetStore();
  await allowedChannel(B2, A1);
});

afterEach(() => {
  expect(net.unhandled).toEqual([]);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const PAGES = ["/help", "/privacy", "/licenses"] as const;
const TITLES: Readonly<Record<(typeof PAGES)[number], string>> = { "/help": COPY.helpTitle, "/privacy": COPY.privacyTitle, "/licenses": COPY.licensesTitle };
const count = (t: string, re: RegExp): number => (t.match(re) ?? []).length;

describe.each(PAGES)("%s", (path) => {
  it("자격 없이 200, 읽기 척도, 색인, h1 하나, 제목", async () => {
    const res = await new Browser().get(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    // 색인하는 페이지는 noindex 헤더가 없다
    expect(res.headers.get("X-Robots-Tag")).toBeNull();
    const t = await res.text();
    expect(count(t, /<main [^>]*data-scale="reading"/g)).toBe(1);
    expect(count(t, /<h1[ >]/g)).toBe(1);
    expect(h1Of(t)).toBe(TITLES[path]);
    expect(t).toContain(`<title>${TITLES[path]} · ${COPY.siteName}</title>`);
    // 읽기 페이지는 og를 두지 않는다(랜딩만)
    expect(t).not.toContain('property="og:');
    expect(t).not.toContain("<script");
  });

  it("비로그인 헤더: 도움말·로그인, 바닥글 링크 셋과 고지", async () => {
    const t = await (await new Browser().get(path)).text();
    expect(t).toContain('<a href="/#start">');
    expect(t).not.toContain('href="/admin"');
    for (const p of PAGES) expect(t).toContain(`<li><a href="${p}">${TITLES[p]}</a></li>`);
    expect(t).toContain(COPY.notice.unofficial);
  });

  it("쿠키 없는 요청은 DO를 부르지 않는다", async () => {
    const { send, calls } = countingSend();
    const res = await send(`http://localhost:8787${path}`, { method: "GET" });
    expect(res.status).toBe(200);
    expect(calls).toEqual([]);
  });

  it("로그인한 사람의 헤더: 채널 이름이 보이고 [로그인]이 없다", async () => {
    const { browser } = await webLoginHttp(fake, "b2");
    const t = await (await browser.get(path)).text();
    expect(t).toContain(`<span class="site-user">${FAKE_ACCOUNTS.b2.channelName}</span>`);
    expect(t).not.toContain('<a href="/#start">');
  });

  it("GET 말고 다른 메서드는 405", async () => {
    const res = await new Browser().send(`http://localhost:8787${path}`, { method: "POST" });
    expect(res.status).toBe(405);
  });
});

describe("/help", () => {
  it("첫 문단은 helpIntro이고 차례 링크가 모든 절을 가리킨다", async () => {
    const t = await (await new Browser().get("/help")).text();
    expect(t).toMatch(new RegExp(`</h1><p>${escapeHtml(COPY.helpIntro)}</p><nav aria-label="${COPY.helpToc}">`));
    for (const a of HELP) expect(t).toContain(`<li><a href="#${a.id}">${escapeHtml(a.title)}</a></li>`);
  });

  it("모든 HELP id가 h2에 있고, 접힘(details) 안에는 id가 없다", async () => {
    const t = await (await new Browser().get("/help")).text();
    expect(HELP.length).toBeGreaterThan(0);
    for (const a of HELP) expect(count(t, new RegExp(`<h2 id="${a.id}">`, "g"))).toBe(1);
    expect(t).not.toContain("<details");
    // id를 가진 요소는 h2뿐이다(본문 안내에 id가 새지 않는다)
    const main = /<main [^>]*>([\s\S]*)<\/main>/.exec(t)?.[1] ?? "";
    for (const m of main.matchAll(/<(\w+)[^>]* id="/g)) expect(m[1]).toBe("h2");
  });

  it("블록 모양: 단계는 ol.steps, 코드는 code.selectable", async () => {
    const t = await (await new Browser().get("/help")).text();
    const blocks = (HELP as readonly { readonly blocks: readonly { readonly t: string }[] }[]).flatMap((a) => a.blocks);
    const steps = blocks.filter((b) => b.t === "ol").length;
    expect(count(t, /<ol class="steps">/g)).toBe(steps);
    const pres = blocks.filter((b) => b.t === "pre").length;
    expect(count(t, /<pre tabindex="0"><code class="selectable">/g)).toBe(pres);
    // 번호 문자열이 박히지 않는다
    expect(t).not.toMatch(/<li>\s*\d+\.\s/);
  });
});

describe("/privacy", () => {
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;

  it("보관 기간 숫자 = 코드 상수", async () => {
    const t = await (await new Browser().get("/privacy")).text();
    const p = COPY.privacy.keep;
    for (const line of [
      p.web(WEB_TTL_MS / HOUR),
      p.app(REFRESH_TTL_MS / DAY, SESSION_MAX_MS / DAY),
      p.revoked(REVOKED_KEEP_MS / DAY),
      p.denied(DENIED_KEEP_MS / DAY, DENIED_CAP),
      p.audit(AUDIT_CAP),
      p.flow(FLOW_TTL_MS / MIN),
    ]) {
      expect(t).toContain(`<li>${escapeHtml(line)}</li>`);
    }
  });

  it("상수는 모두 나누어떨어지는 값이다(소수점이 화면에 나오지 않는다)", () => {
    for (const [ms, unit] of [
      [WEB_TTL_MS, HOUR],
      [REFRESH_TTL_MS, DAY],
      [SESSION_MAX_MS, DAY],
      [REVOKED_KEEP_MS, DAY],
      [DENIED_KEEP_MS, DAY],
      [FLOW_TTL_MS, MIN],
    ] as const) {
      expect(Number.isInteger(ms / unit)).toBe(true);
    }
  });

  it("관리자·연락처는 자리표시다(실제 값을 두지 않는다)", async () => {
    const t = await (await new Browser().get("/privacy")).text();
    expect(t).toContain(`<dt>${COPY.adminsTitle}</dt><dd>${COPY.privacy.placeholder.admin}</dd>`);
    expect(t).toContain(`<dt>${COPY.privacy.contact.label}</dt><dd>${COPY.privacy.placeholder.contact}</dd>`);
  });

  it("받는 것·받지 않는 것·해외 서버·끊는 길 절이 있다", async () => {
    const t = await (await new Browser().get("/privacy")).text();
    const p = COPY.privacy;
    for (const h of [p.collect.title, p.use.title, p.exclude.title, p.cookie.title, p.keep.title, p.abroad.title, p.cut.title, p.contact.title]) expect(t).toContain(`<h2>${h}</h2>`);
  });
});

describe("/licenses", () => {
  it("고지 원문이 비어 있지 않고 그대로 실린다", async () => {
    const t = await (await new Browser().get("/licenses")).text();
    expect(LICENSES.length).toBeGreaterThan(0);
    for (const l of LICENSES) {
      expect(l.text.length).toBeGreaterThan(100);
      expect(t).toContain(`<h2>${escapeHtml(l.name)}</h2><pre class="license">${escapeHtml(l.text)}</pre>`);
    }
    expect(t).toContain("ISC License");
  });
});
