// 문서 골격(htmlPage)·부품(ui.ts)·안내/결과/확인 페이지의 상태별 제목·본문(content.md §15.3, web.md §3·§6·§7·§8, 계약 §2.4).
// htmlPage는 authorizeUrl·publicOrigin만 읽어 설정은 두 줄이면 된다. 골격 검사는 helper 하나로 모든 페이지에 같은 단언을 건다.
import { describe, expect, it } from "vitest";
import type { Config } from "../../src/config";
import type { EntryContext } from "../../src/core/entry";
import { html, renderHtml } from "../../src/core/html";
import { assetPath } from "../../src/http/assets";
import { COPY } from "../../src/http/copy";
import type { FlashKind } from "../../src/http/flash";
import { htmlPage, THEME_COLOR } from "../../src/http/layout";
import { donePage, loginConfirmPage, noticePage } from "../../src/http/pages";
import { SITE_CSS } from "../../src/http/site-css.generated";
import { csrfInput, dataTable, disclosure, errorSummary, field, linkButton, notice, postButton, rowHead } from "../../src/http/ui";
import type { DoneView } from "../../src/store/types";

const CONFIG = { authorizeUrl: "https://chzzk.example.invalid/authorize", publicOrigin: "https://worker.test" } as unknown as Config;
const CH = "0".repeat(30) + "c3";
const CSRF = "C".repeat(43);
const view = (o: Partial<DoneView>): DoneView => ({ kind: "web", status: "denied", channelName: "합성채널", channelId: CH, ...o });
const DESKTOP: EntryContext = { kind: "desktop", os: "mac", inApp: null };
const KAKAO: EntryContext = { kind: "phone", os: null, inApp: "kakao" };

// ---- helper ----

/** SITE_CSS의 --bg(라이트·다크) 계산값. --bg는 ref 토큰을 가리킨다(한 단계) */
function bgOf(scheme: "light" | "dark"): string {
  const darkAt = SITE_CSS.indexOf("@media (prefers-color-scheme: dark)");
  const block = scheme === "light" ? SITE_CSS.slice(0, SITE_CSS.indexOf("/* [dark-media]")) : SITE_CSS.slice(darkAt, SITE_CSS.indexOf("/* [dark-theme]"));
  const name = /--bg: var\((--ref-[\w-]+)\);/.exec(block)?.[1];
  if (name === undefined) throw new Error(`--bg(${scheme})를 찾지 못했다`);
  const hex = new RegExp(`${name}: (#[0-9A-Fa-f]{6});`).exec(SITE_CSS)?.[1];
  if (hex === undefined) throw new Error(`${name}의 값을 찾지 못했다`);
  return hex;
}

const text = (r: Response) => r.text();
const mainOf = (t: string): string => /<main [^>]*>([\s\S]*)<\/main>/.exec(t)?.[1] ?? "";
const countOf = (t: string, re: RegExp): number => (t.match(re) ?? []).length;
const h1Text = (t: string) => (/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(t)?.[1] ?? "").replace(/<[^>]*>/g, "");

/** 모든 페이지가 지켜야 하는 골격 단언(web.md §3·§7.1·§8). 표 단언은 표가 있을 때만 건다 */
function expectSkeleton(t: string): void {
  expect(t.startsWith("<!doctype html><html lang=\"ko\">")).toBe(true);
  expect(t).toContain('<meta name="color-scheme" content="light dark">');
  // theme-color는 SITE_CSS --bg(라이트·다크)와 같다
  expect(t).toContain(`<meta name="theme-color" media="(prefers-color-scheme: light)" content="${bgOf("light")}">`);
  expect(t).toContain(`<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${bgOf("dark")}">`);
  // 스타일시트 한 개, 아이콘 링크 셋
  expect(countOf(t, /<link rel="stylesheet"/g)).toBe(1);
  expect(t).toContain(`<link rel="stylesheet" href="${assetPath("site.css")}">`);
  expect(t).toContain(`<link rel="icon" href="${assetPath("icon.svg")}" type="image/svg+xml">`);
  expect(t).toContain(`<link rel="icon" href="${assetPath("favicon.ico")}" sizes="32x32">`);
  expect(t).toContain(`<link rel="apple-touch-icon" href="${assetPath("apple-touch-icon.png")}">`);
  // 첫 a가 #main(skip link)이고 main#main이 있다
  expect(/<a\b[^>]*>/.exec(t)?.[0]).toBe(`<a class="skip" href="#main">`);
  expect(t).toContain(`>${COPY.skipLink}</a>`);
  expect(countOf(t, /<main id="main"/g)).toBe(1);
  // h1 정확히 하나
  expect(countOf(t, /<h1[ >]/g)).toBe(1);
  // main의 첫 자식은 알림 배너(section) 또는 h1
  expect(/^<(section aria-labelledby|h1)/.test(mainOf(t))).toBe(true);
  // 헤더: 이름 링크 + 배지, 바닥글: 링크 셋 + 비공식 고지, 저작권 줄 없음
  expect(t).toContain(`<a class="site-name" href="/">${COPY.siteName}</a><span class="badge">${COPY.pill}</span>`);
  const footer = /<footer[\s\S]*<\/footer>/.exec(t)?.[0] ?? "";
  for (const href of ["/help", "/privacy", "/licenses"]) expect(footer).toContain(`href="${href}"`);
  expect(footer).toContain(COPY.notice.unofficial);
  expect(footer).not.toContain("©");
  // 금지: 스크립트·스타일·비활성·전환
  for (const bad of ["<script", "<style", "style=", " disabled", "transition"]) expect(t).not.toContain(bad);
  // 표가 있으면 모든 th에 scope, 모든 table에 caption, 가로 스크롤 영역에 tabindex·role
  for (const th of t.match(/<th\b[^>]*>/g) ?? []) expect(th).toMatch(/ scope="(?:col|row)"/);
  expect(countOf(t, /<caption/g)).toBe(countOf(t, /<table/g));
  for (const s of t.match(/<div class="scroll"[^>]*>/g) ?? []) {
    expect(s).toContain('tabindex="0"');
    expect(s).toContain('role="region"');
    expect(s).toContain("aria-labelledby=");
  }
  // 채움 버튼은 페이지당 하나 이하
  expect(countOf(t, /class="btn btn-primary/g)).toBeLessThanOrEqual(1);
}

describe("THEME_COLOR", () => {
  it("라이트·다크 값이 SITE_CSS의 --bg와 같다", () => {
    expect(THEME_COLOR.light).toBe(bgOf("light"));
    expect(THEME_COLOR.dark).toBe(bgOf("dark"));
  });

  it("[data-theme] 다크 블록의 --bg도 같다", () => {
    const block = SITE_CSS.slice(SITE_CSS.indexOf("/* [dark-theme]"), SITE_CSS.indexOf("/* [theme-scheme]"));
    const name = /--bg: var\((--ref-[\w-]+)\);/.exec(block)?.[1] ?? "";
    expect(new RegExp(`${name}: ${THEME_COLOR.dark};`).test(SITE_CSS)).toBe(true);
  });
});

describe("htmlPage 골격", () => {
  const page = (o: Parameters<typeof htmlPage>[4], status = 200, body = html`<h1>제목</h1><p>본문</p>`) => htmlPage(CONFIG, status, "제목", body, o);

  it("공통 단언: 앱 척도·읽기 척도·anon·auth·member", async () => {
    for (const scale of ["app", "reading"] as const) {
      for (const nav of [{ kind: "anon" }, { kind: "auth" }, { kind: "member", channelName: "이름", isAdmin: true }] as const) {
        expectSkeleton(await text(page({ scale, nav })));
      }
    }
  });

  it("읽기 척도만 main에 data-scale, 헤더·main·바닥글의 .col에 .col-reading", async () => {
    const reading = await text(page({ scale: "reading", nav: { kind: "auth" } }));
    expect(reading).toContain('<main id="main" class="col col-reading page" data-scale="reading">');
    expect(countOf(reading, /class="col col-reading"/g)).toBe(2); // 헤더·바닥글
    const app = await text(page({ scale: "app", nav: { kind: "auth" } }));
    expect(app).not.toContain("data-scale");
    expect(app).not.toContain("col-reading");
  });

  it("<title>: 꼬리는 앱 이름, 400 이상은 오류 접두, error 옵션이 기본을 바꾼다, 랜딩 제목은 꼬리가 없다", async () => {
    expect(await text(page({ scale: "app", nav: { kind: "auth" } }))).toContain(`<title>제목 · ${COPY.siteName}</title>`);
    expect(await text(page({ scale: "app", nav: { kind: "auth" } }, 404))).toContain(`<title>${COPY.errorTitlePrefix}제목 · ${COPY.siteName}</title>`);
    expect(await text(page({ scale: "app", nav: { kind: "auth" }, error: true }))).toContain(`<title>${COPY.errorTitlePrefix}제목 · `);
    expect(await text(page({ scale: "app", nav: { kind: "auth" }, error: false }, 400))).toContain(`<title>제목 · ${COPY.siteName}</title>`);
    const landing = await text(htmlPage(CONFIG, 200, COPY.siteTitle, html`<h1>x</h1>`, { scale: "reading", nav: { kind: "anon" } }));
    expect(landing).toContain(`<title>${COPY.siteTitle}</title>`);
  });

  it("nav: anon은 [도움말][로그인 /#start], auth는 [도움말]만, member는 관리자에게만 [관리]이고 채널 이름은 링크가 아니다", async () => {
    const nav = async (n: Parameters<typeof page>[0]["nav"]) => /<nav [^>]*>([\s\S]*?)<\/nav>/.exec(await text(page({ scale: "app", nav: n })))?.[1] ?? "";
    expect(await nav({ kind: "anon" })).toBe(`<a href="/help">${COPY.helpTitle}</a><a href="/#start">${COPY.loginLink}</a>`);
    expect(await nav({ kind: "auth" })).toBe(`<a href="/help">${COPY.helpTitle}</a>`);
    const admin = await nav({ kind: "member", channelName: "<이름>", isAdmin: true });
    expect(admin).toBe(`<a href="/help">${COPY.helpTitle}</a><a href="/admin">${COPY.adminLink}</a><span class="site-user">&lt;이름&gt;</span>`);
    const plain = await nav({ kind: "member", channelName: "이름", isAdmin: false });
    expect(plain).not.toContain("/admin");
    expect(plain).not.toContain("/#start");
    expect(plain).toContain('<span class="site-user">이름</span>');
    expect(await text(page({ scale: "app", nav: { kind: "auth" } }))).toContain('aria-label="사이트"');
  });

  it("색인: index 옵션이 있을 때만 robots 헤더가 없다", async () => {
    expect(page({ scale: "app", nav: { kind: "auth" } }).headers.get("X-Robots-Tag")).toBe("noindex");
    expect(page({ scale: "reading", nav: { kind: "auth" }, index: false }).headers.get("X-Robots-Tag")).toBe("noindex");
    expect(page({ scale: "reading", nav: { kind: "auth" }, index: true }).headers.get("X-Robots-Tag")).toBeNull();
  });

  it("OG: og 옵션이 있을 때만 description·og:* (랜딩), 그 밖은 og: 0개", async () => {
    const on = await text(page({ scale: "reading", nav: { kind: "anon" }, index: true, og: true }));
    for (const want of [
      `<meta name="description" content="${COPY.ogDescription}">`,
      `<meta property="og:title" content="${COPY.siteTitle}">`,
      '<meta property="og:type" content="website">',
      '<meta property="og:url" content="https://worker.test/">',
      `<meta property="og:description" content="${COPY.ogDescription}">`,
      `<meta property="og:image" content="https://worker.test${assetPath("og.png")}">`,
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
      `<meta property="og:image:alt" content="${COPY.siteTitle}">`,
    ]) expect(on).toContain(want);
    const off = await text(page({ scale: "reading", nav: { kind: "anon" }, index: true }));
    expect(off).not.toContain("og:");
    expect(off).not.toContain('name="description"');
  });

  it("headers 옵션은 덮지 않고 더한다(Set-Cookie 여럿)", () => {
    const res = page({ scale: "app", nav: { kind: "auth" }, headers: [["Set-Cookie", "a=1"], ["Set-Cookie", "b=2"], ["X-Test", "1"]] });
    expect(res.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    expect(res.headers.get("X-Test")).toBe("1");
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Content-Security-Policy")).toContain("form-action 'self' https://chzzk.example.invalid");
  });

  it("loopbackFormAction은 CSP form-action에 루프백 출처를 더한다", () => {
    expect(page({ scale: "app", nav: { kind: "auth" } }).headers.get("Content-Security-Policy")).not.toContain("127.0.0.1");
    expect(page({ scale: "app", nav: { kind: "auth" }, loopbackFormAction: true }).headers.get("Content-Security-Policy")).toContain("http://127.0.0.1:*");
  });

  it("flash: main의 첫 자식 배너 하나, 종류별 문구, 없으면 배너가 없다", async () => {
    const want: Record<FlashKind, string> = { loggedIn: COPY.doneOk.title, alreadyDone: COPY.alreadyDone, sessionGone: COPY.sessionGone };
    for (const kind of ["loggedIn", "alreadyDone", "sessionGone"] as const) {
      const t = await text(page({ scale: "app", nav: { kind: "auth" }, flash: kind }));
      expectSkeleton(t);
      const main = mainOf(t);
      expect(main.startsWith('<section aria-labelledby="flash-body"><div class="notice notice-banner')).toBe(true);
      expect(main).toContain(`<p>${want[kind]}</p>`);
      expect(countOf(t, /notice-banner/g)).toBe(1);
      // 배너 뒤에 h1
      expect(main.indexOf("<h1")).toBeGreaterThan(main.indexOf("</section>"));
    }
    expect(await text(page({ scale: "app", nav: { kind: "auth" }, flash: null }))).not.toContain("notice");
  });
});

describe("noticePage", () => {
  it("h1은 상태별 제목, 본문은 다음에 할 일, main의 링크는 처음으로 하나, 4xx 제목에는 오류 접두", async () => {
    const res = noticePage(CONFIG, 404, COPY.linkGone.title, COPY.linkGone.body);
    expect(res.status).toBe(404);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    const t = await res.text();
    expectSkeleton(t);
    expect(h1Text(t)).toBe("로그인 주소가 만료됐어요");
    expect(t).toContain("<p>앱에서 다시 로그인해 주세요.</p>");
    expect(t).toContain("<title>오류: 로그인 주소가 만료됐어요 · 치지직 다운로더</title>");
    expect(countOf(mainOf(t), /<a /g)).toBe(1);
    expect(mainOf(t)).toContain(`<a href="/">${COPY.home}</a>`);
    expect(h1Text(t)).not.toBe("안내");
  });

  it("아이콘: 4xx는 triangle-alert(warning), 5xx는 circle-x(danger), 200인 옛 앱 안내도 triangle-alert", async () => {
    const TRIANGLE = "m21.73 18-8-14";
    const CIRCLE_X = "m15 9-6 6";
    const w = await noticePage(CONFIG, 403, "t", null).text();
    expect(w).toContain('class="status status-warning"');
    expect(w).toContain(TRIANGLE);
    expect(w).not.toContain(CIRCLE_X);
    const d = await noticePage(CONFIG, 503, "t", null).text();
    expect(d).toContain('class="status status-danger"');
    expect(d).toContain(CIRCLE_X);
    const old = await noticePage(CONFIG, 200, COPY.outdatedApp.title, COPY.outdatedApp.body).text();
    expect(old).toContain('class="status status-warning"');
    expect(old).toContain(TRIANGLE);
  });

  it("본문이 없으면 문단을 만들지 않고, 200이면 오류 접두를 붙이지 않는다", async () => {
    const adminOnly = await noticePage(CONFIG, 403, COPY.adminOnly.title, null).text();
    expect(h1Text(adminOnly)).toBe("관리자만 볼 수 있어요");
    expect(mainOf(adminOnly).match(/<p>/g)).toHaveLength(1); // 링크 문단뿐
    const outdated = await noticePage(CONFIG, 200, COPY.outdatedApp.title, COPY.outdatedApp.body).text();
    expect(outdated).toContain("<title>앱을 업데이트해야 해요 · 치지직 다운로더</title>");
  });

  it("nav 기본은 auth(로그인 링크 없음), 링크 대상과 nav·headers 옵션을 바꿀 수 있다", async () => {
    const def = await noticePage(CONFIG, 403, "t", null).text();
    expect(def).not.toContain("/#start");
    expect(def).not.toContain('href="/admin"');
    const back = await noticePage(CONFIG, 403, COPY.badRequest.title, COPY.badRequest.body, { back: { href: "/admin", label: COPY.reloadAdmin } }).text();
    expect(mainOf(back)).toContain(`<a href="/admin">${COPY.reloadAdmin}</a>`);
    expect(countOf(mainOf(back), /<a /g)).toBe(1);
    const member = await noticePage(CONFIG, 403, "t", null, { nav: { kind: "member", channelName: "이름", isAdmin: true } }).text();
    expect(member).toContain('href="/admin"');
    const rl = noticePage(CONFIG, 429, "t", null, { headers: { "Retry-After": "30" } });
    expect(rl.headers.get("Retry-After")).toBe("30");
  });
});

describe("donePage", () => {
  it("실패: 웹 흐름은 webBody, 앱 흐름·흐름 모름은 body, 제목에 오류 접두(200이어도)", async () => {
    const web = await donePage(CONFIG, "failed", view({ kind: "web", status: "failed" }), null, DESKTOP).text();
    expectSkeleton(web);
    expect(h1Text(web)).toBe("로그인하지 못했어요");
    expect(web).toContain("처음 화면에서 다시 로그인해 주세요.");
    expect(web).not.toContain("앱에서 다시 시도해 주세요.");
    expect(web).toContain("<title>오류: 로그인하지 못했어요 · 치지직 다운로더</title>");
    for (const v of [view({ kind: "app", status: "failed" }), null]) {
      const t = await donePage(CONFIG, "failed", v, null, DESKTOP).text();
      expect(t).toContain("앱에서 다시 시도해 주세요.");
      expect(t).not.toContain("처음 화면에서 다시 로그인해 주세요.");
    }
  });

  it("인앱 보충 단락은 실패 × 카카오톡에만", async () => {
    const hint = (c: DoneView | null, r: "failed" | "denied" | "cancelled" | "ok", e: EntryContext) => donePage(CONFIG, r, c, null, e).text();
    expect(await hint(view({ status: "failed" }), "failed", KAKAO)).toContain(COPY.inAppHint);
    expect(await hint(null, "failed", KAKAO)).toContain(COPY.inAppHint);
    expect(await hint(view({ status: "failed" }), "failed", DESKTOP)).not.toContain(COPY.inAppHint);
    for (const r of ["denied", "cancelled", "ok"] as const) {
      expect(await hint(view({ status: r }), r, KAKAO)).not.toContain(COPY.inAppHint);
    }
  });

  it("거부: 채널 이름·ID(콜론 대칭) → 본문 → 다음 행동. 흐름이 없으면 채널 줄이 없다", async () => {
    const t = await donePage(CONFIG, "denied", view({}), null, DESKTOP).text();
    expectSkeleton(t);
    expect(h1Text(t)).toBe("이 채널은 사용 허가가 없어요");
    expect(t).toContain(`채널: 합성채널 · 채널 ID: ${CH}`);
    expect(t.indexOf("관리자에게 채널 이름을 알려 주세요.")).toBeGreaterThan(t.indexOf("채널 ID:"));
    expect(t.indexOf("허가를 받은 뒤 다시 로그인해 주세요.")).toBeGreaterThan(t.indexOf("관리자에게 채널 이름을"));
    expect(t).toContain("status-danger");
    const bare = await donePage(CONFIG, "denied", null, null, DESKTOP).text();
    expect(bare).not.toContain("채널 ID");
    expect(bare).toContain("허가를 받은 뒤 다시 로그인해 주세요.");
    // 채널 이름은 이스케이프된다
    const xss = await donePage(CONFIG, "denied", view({ channelName: "<b>x</b>" }), null, DESKTOP).text();
    expect(xss).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(xss).not.toContain("<b>");
  });

  it("취소·성공: 제목이 상태를 말한다(성공은 본문 없음), 링크는 처음으로 하나, 로그인 링크 없음", async () => {
    const c = await donePage(CONFIG, "cancelled", null, null, DESKTOP).text();
    expectSkeleton(c);
    expect(h1Text(c)).toBe("로그인을 취소했어요");
    expect(c).toContain("처음 화면에서 다시 로그인할 수 있어요.");
    expect(c).not.toContain("오류:");
    const ok = await donePage(CONFIG, "ok", null, null, DESKTOP).text();
    expectSkeleton(ok);
    expect(h1Text(ok)).toBe("로그인했어요");
    expect(mainOf(ok).match(/<p>/g)).toHaveLength(1); // 링크 문단뿐
    for (const t of [c, ok]) {
      expect(countOf(mainOf(t), /<a /g)).toBe(1);
      expect(t).not.toContain("/#start");
    }
  });

  it("흐름 쿠키 지우기는 Set-Cookie로 나가고 noindex다", () => {
    const res = donePage(CONFIG, "denied", null, "cdl_f=; Max-Age=0", DESKTOP);
    expect(res.headers.getSetCookie()).toEqual(["cdl_f=; Max-Age=0"]);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
  });
});

describe("loginConfirmPage", () => {
  it("h1 → 경고 알림 → [계속] 하나(채움 버튼), 코드 요소 없음, 루프백 CSP", async () => {
    const res = loginConfirmPage(CONFIG);
    expect(res.headers.get("Content-Security-Policy")).toContain("http://127.0.0.1:*");
    const t = await res.text();
    expectSkeleton(t);
    expect(h1Text(t)).toBe(COPY.loginTitle);
    expect(countOf(t, /class="btn btn-primary"/g)).toBe(1);
    expect(countOf(t, /<form/g)).toBe(1);
    expect(t).toContain('<form method="post">');
    expect(t).toContain("tone-warning");
    expect(t).toContain(COPY.loginWarning);
    expect(t).not.toContain('class="code"');
    expect(t).not.toContain("/#start");
  });
});

// ---- 부품 ----

describe("ui 부품", () => {
  const r = (v: ReturnType<typeof html>) => renderHtml(v);

  it("csrfInput: 글자 그대로의 모양(e2e 정규식 계약)", () => {
    expect(r(csrfInput(CSRF))).toBe(`<input type="hidden" name="csrf" value="${CSRF}">`);
  });

  it("postButton: 폼 하나, 기본은 .btn, primary·danger 표시, action·필드 값은 이스케이프된다", () => {
    expect(r(postButton("/x", CSRF, "끊기"))).toBe(`<form method="post" action="/x"><input type="hidden" name="csrf" value="${CSRF}"><button type="submit" class="btn">끊기</button></form>`);
    expect(r(postButton("/x", CSRF, "추가", { primary: true }))).toContain('class="btn btn-primary"');
    const t = r(postButton('/x"y', CSRF, "<끊기>", { tone: "danger", fields: { channelId: '"><b>' } }));
    expect(t).toContain('action="/x&quot;y"');
    expect(t).toContain('value="&quot;&gt;&lt;b&gt;"');
    expect(t).toContain('class="btn tone-danger"');
    expect(t).not.toContain("<b>");
  });

  it("linkButton: a.btn", () => {
    expect(r(linkButton("/a", "받기"))).toBe('<a class="btn" href="/a">받기</a>');
    expect(r(linkButton("/a", "받기", { primary: true, lg: true }))).toBe('<a class="btn btn-primary btn-lg" href="/a">받기</a>');
  });

  it("notice: 톤 클래스·아이콘·역할(위험은 alert, 그 밖은 status), 제목, 배너는 이름 붙은 영역 안", () => {
    const a = r(notice({ tone: "info", icon: "info", body: "본문" }));
    expect(a).toContain('class="notice notice-inline tone-info"');
    expect(a).toContain('role="status"');
    expect(a).toContain("<p>본문</p>");
    expect(r(notice({ tone: "danger", icon: "circle-x", body: "x" }))).toContain('role="alert"');
    expect(r(notice({ tone: "danger", icon: "circle-x", body: "x", role: "status" }))).toContain('role="status"');
    const b = r(notice({ tone: "warning", icon: "triangle-alert", title: "제목", body: html`<p>a</p>`, banner: true, id: "n1" }));
    expect(b.startsWith('<section aria-labelledby="n1-title">')).toBe(true);
    expect(b).toContain('<p class="notice-title" id="n1-title">제목</p>');
    expect(b).toContain("notice-banner");
  });

  it("field: 라벨은 위(label for)·보조 설명·오류(aria-invalid + aria-describedby)·값 이스케이프", () => {
    const ok = r(field({ id: "f1", name: "n", label: "라벨", help: "도움", value: '"v"', mono: true, required: true, maxlength: 32, pattern: "[0-9a-f]{32}", autocomplete: "off" }));
    expect(ok).toContain('<label for="f1">라벨</label>');
    expect(ok.indexOf("<label")).toBeLessThan(ok.indexOf("<input"));
    expect(ok.indexOf('id="f1-help"')).toBeLessThan(ok.indexOf("<input"));
    expect(ok).toContain('class="field field-mono"');
    expect(ok).toContain('value="&quot;v&quot;"');
    expect(ok).toContain(" required");
    expect(ok).toContain('maxlength="32"');
    expect(ok).toContain('aria-describedby="f1-help"');
    expect(ok).not.toContain("aria-invalid");
    const bad = r(field({ id: "f1", name: "n", label: "라벨", help: "도움", error: "틀렸어요", readonly: true }));
    expect(bad).toContain('aria-invalid="true"');
    expect(bad).toContain('aria-describedby="f1-help f1-error"');
    expect(bad).toContain('id="f1-error"');
    expect(bad).toContain("틀렸어요");
    expect(bad).toContain(" readonly");
    expect(bad).not.toContain(" disabled");
  });

  it("errorSummary: 필드로 가는 링크 목록, 제목 errorSummary, 위험 알림", () => {
    const t = r(errorSummary([{ fieldId: "allow-channel-id", message: COPY.badChannelId }]));
    expect(t).toContain(`<a href="#allow-channel-id">${COPY.badChannelId}</a>`);
    expect(t).toContain(`>${COPY.errorSummary}</p>`);
    expect(t).toContain("tone-danger");
    expect(t).toContain("notice-banner");
  });

  it("dataTable: caption(id)·th scope=col·동작 열 머리는 숨김 글자·스크롤 영역에 tabindex/role/이름", () => {
    const t = r(dataTable({ id: "t1", caption: "표", head: ["가", "나"], actions: true, rows: [html`<tr>${rowHead("행")}<td>값</td><td>x</td></tr>`] }));
    expect(t).toContain('<div class="scroll" tabindex="0" role="region" aria-labelledby="t1">');
    expect(t).toContain('<caption id="t1">표</caption>');
    expect(t).toContain('<th scope="col">가</th><th scope="col">나</th>');
    expect(t).toContain(`<th scope="col"><span class="sr-only">${COPY.colAction}</span></th>`);
    expect(t).toContain('<th scope="row">행</th>');
    expect(t).not.toMatch(/<th><\/th>/);
    const plain = r(dataTable({ id: "t2", caption: "표", head: ["가"], rows: [] }));
    expect(plain).not.toContain("sr-only");
  });

  it("disclosure: details.disclosure, 열림 여부, 요약 안 chevron 아이콘, 본문은 panel", () => {
    const closed = r(disclosure("요약", html`<p>본문</p>`));
    expect(closed).toContain('<details class="disclosure"><summary>');
    expect(closed).toContain("m9 18 6-6-6-6");
    expect(closed).toContain('<div class="disclosure-panel"><p>본문</p></div>');
    expect(r(disclosure("요약", "x", { open: true }))).toContain('<details class="disclosure" open>');
  });
});
