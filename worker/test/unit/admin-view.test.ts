// 관리 화면·허가 빼기 확인 페이지 렌더러(docs/design/system/web.md §6.3·§7·§8, 계약 §2.1·§2.5). 순수 함수라 Response 본문 문자열로 비교한다.
import { describe, expect, it } from "vitest";
import type { Config } from "../../src/config";
import { renderAdmin, renderDisallowConfirm } from "../../src/http/admin-view";
import { COPY } from "../../src/http/copy";
import type { AdminView } from "../../src/store/types";

const CONFIG = { authorizeUrl: "https://chzzk.example.invalid/authorize", publicOrigin: "https://worker.test" } as unknown as Config;
const CSRF = "C".repeat(43);
const EMPTY: AdminView = { allowlist: [], denied: [], sessions: [], audit: [], autoAllow: { cap: 20, today: 0, capBy: null, capAt: null }, blocked: [], allowlistTotal: 0, blockedTotal: 0 };
const A1 = "0".repeat(30) + "a1";
const B2 = "0".repeat(30) + "b2";
const C3 = "0".repeat(30) + "c3";
const NAV = { kind: "member", channelName: "관리자", isAdmin: true } as const;

const count = (t: string, re: RegExp): number => (t.match(re) ?? []).length;
const mainOf = (t: string): string => /<main [^>]*>([\s\S]*)<\/main>/.exec(t)?.[1] ?? "";
const titleOf = (t: string): string => /<title>([^<]*)<\/title>/.exec(t)?.[1] ?? "";

const noActive = (t: string) => {
  expect(t).not.toContain("<script");
  expect(t).not.toContain("<style");
  expect(t).not.toContain("style=");
};

describe("renderAdmin", () => {
  const view: AdminView = {
    allowlist: [
      { channelId: A1, channelName: "관리자", ownerChannelId: null, note: null, addedBy: A1, addedAt: Date.UTC(2030, 0, 1), activeSessions: 1 },
      { channelId: B2, channelName: null, ownerChannelId: null, note: "<img src=x onerror=1>", addedBy: A1, addedAt: Date.UTC(2030, 0, 1), activeSessions: 0 },
    ],
    denied: [{ channelId: C3, channelName: "<i>거부</i>", firstAt: Date.UTC(2030, 0, 1), lastAt: Date.UTC(2030, 0, 2), attempts: 2, invitedBy: null, blocked: false }],
    sessions: [{ id: "sid", kind: "app", channelId: B2, channelName: "허용", client: "<x>", createdAt: 0, lastSeenAt: 0, recovered: 1 }],
    audit: [{ at: 0, actor: A1, action: "allow", target: B2 }],
    autoAllow: { cap: 20, today: 0, capBy: null, capAt: null },
    blocked: [],
    allowlistTotal: 2,
    blockedTotal: 0,
  };
  const model = { view, admins: [A1], csrf: CSRF, nav: NAV };
  const render = async (o?: Parameters<typeof renderAdmin>[2]) => renderAdmin(CONFIG, model, o).text();

  it("[허가 빼기…]는 확인 페이지로 가는 링크 버튼이고 관리자 채널 행에는 없다", async () => {
    const t = await render();
    expect(t).toContain(`<a class="btn" href="/admin/${B2}/disallow">${COPY.disallow}</a>`);
    expect(t).not.toContain(`/admin/${A1}/disallow`);
    // 최종 POST 폼은 확인 페이지에만 있다
    expect(t).not.toContain('action="/admin/disallow"');
    expect(t).toContain(`<span class="muted">${COPY.adminsTitle}</span>`);
    expect(t).not.toContain("tone-danger");
  });

  it("표 다섯: caption·th scope·가로 스크롤 영역·동작 열 머리(.sr-only)", async () => {
    const t = await render();
    expect(count(t, /<table>/g)).toBe(5);
    expect(count(t, /<caption id="tbl-[a-z]+">/g)).toBe(5);
    expect(count(t, /<th>/g)).toBe(0);
    expect(count(t, /<div class="scroll" tabindex="0" role="region" aria-labelledby="tbl-[a-z]+">/g)).toBe(5);
    // 동작 열이 있는 표 셋(허가·거부·세션)
    expect(count(t, new RegExp(`<th scope="col"><span class="sr-only">${COPY.colAction}</span></th>`, "g"))).toBe(3);
    // 시각이 있는 표 넷은 caption이 tableTimeNote
    expect(count(t, new RegExp(`>${COPY.tableTimeNote}</caption>`, "g"))).toBe(4);
    // 보조 정보(채널 ID)는 첫 열 둘째 줄이고 e2e 계약대로 >id<로 감싼다
    expect(t).toContain(`<br><span class="meta"><span class="mono num">${B2}</span></span>`);
  });

  it("허가 채널 표는 5열이다(이름·메모·시각·활성·동작)", async () => {
    const t = await render();
    const allow = /<table><caption id="tbl-allow">[\s\S]*?<\/thead>/.exec(t)?.[0] ?? "";
    expect(count(allow, /<th scope="col">/g)).toBe(5);
  });

  it("버튼 의미: 채움 버튼은 [추가] 하나, 위험 표시 없음, 끊기·지우기·허가는 보조 버튼", async () => {
    const t = await render();
    expect(count(t, /btn-primary/g)).toBe(1);
    // 상한 [저장]은 채움 버튼이 아니다(페이지의 유일한 채움 버튼은 [추가])
    expect(t).toContain(`<button type="submit" class="btn">${COPY.save}</button>`);
    expect(t).toContain(`<button type="submit" class="btn btn-primary">${COPY.add}</button>`);
    expect(t).toContain(`<button type="submit" class="btn">${COPY.revoke}</button>`);
    expect(t).toContain(`<button type="submit" class="btn">${COPY.dismiss}</button>`);
    expect(t).toContain(`<button type="submit" class="btn">${COPY.allow}</button>`);
    expect(t).toContain(`action="/admin/denied/${C3}/allow"`);
    expect(t).toContain(`action="/admin/denied/${C3}/dismiss"`);
    expect(t).toContain('action="/admin/sessions/sid/revoke"');
  });

  it("추가 폼: 라벨이 입력 위, id allow-channel-id·allow-note, 채널 ID는 mono", async () => {
    const t = await render();
    expect(t).toContain('<label for="allow-channel-id">');
    expect(t).toContain('id="allow-channel-id" name="channelId"');
    expect(t).toContain('id="allow-note" name="note"');
    expect(t).toContain("field field-mono");
    expect(t).not.toContain("aria-invalid");
    expect(count(t, /<input type="hidden" name="csrf" value="/g)).toBeGreaterThan(1);
  });

  it("메모·이름·기기 정보는 이스케이프된다", async () => {
    const t = await render();
    expect(t).toContain("&lt;img src=x onerror=1&gt;");
    expect(t).toContain("&lt;i&gt;거부&lt;/i&gt;");
    expect(t).not.toContain("<img");
    expect(t).not.toContain("<i>");
    noActive(t);
  });

  it("빈 화면은 빈 문구 넷, 표는 관리자 표 하나", async () => {
    const t = await renderAdmin(CONFIG, { ...model, view: EMPTY }).text();
    for (const m of [COPY.allowEmpty, COPY.deniedEmpty, COPY.sessionsEmpty, COPY.auditEmpty]) expect(t).toContain(m);
    expect(count(t, /<table>/g)).toBe(1);
    expect(t).toContain('action="/admin/allow"');
  });

  it("flash는 main의 첫 자식이고, 오류 요약과는 함께 오지 않는다", async () => {
    const t = await renderAdmin(CONFIG, model, { flash: "alreadyDone" }).text();
    expect(mainOf(t).startsWith('<section aria-labelledby="flash-body">')).toBe(true);
    expect(t).toContain(COPY.alreadyDone);
    const e = await render({ status: 400, flash: "alreadyDone", errors: [{ fieldId: "allow-channel-id", message: COPY.badChannelId }] });
    expect(e).not.toContain(COPY.alreadyDone);
  });

  describe("400 검증 오류", () => {
    const o = {
      status: 400,
      errors: [{ fieldId: "allow-channel-id", message: COPY.badChannelId }],
      values: { channelId: '"><b>x</b>', note: "<i>메모</i>" },
    } as const;

    it("main 첫 자식이 오류 요약이고 링크가 입력 id와 같다, 제목에 '오류: '", async () => {
      const r = renderAdmin(CONFIG, model, o);
      expect(r.status).toBe(400);
      const t = await r.text();
      const m = mainOf(t);
      expect(m.startsWith('<section aria-labelledby="error-summary-title">')).toBe(true);
      expect(m).toContain(`<a href="#allow-channel-id">${COPY.badChannelId}</a>`);
      expect(t).toContain('<input class="field field-mono" type="text" id="allow-channel-id"');
      expect(titleOf(t).startsWith(COPY.errorTitlePrefix)).toBe(true);
    });

    it("필드: aria-invalid·aria-describedby·옆 문구, 입력값은 이스케이프해 채운다", async () => {
      const t = await renderAdmin(CONFIG, model, o).text();
      expect(t).toContain('aria-invalid="true"');
      expect(t).toContain('aria-describedby="allow-channel-id-error"');
      expect(t).toContain(`<div class="notice-text">${COPY.badChannelId}</div>`);
      expect(t).toContain('value="&quot;&gt;&lt;b&gt;x&lt;/b&gt;"');
      expect(t).toContain('value="&lt;i&gt;메모&lt;/i&gt;"');
      expect(t).not.toContain("<b>x");
      noActive(t);
    });
  });
});

describe("renderDisallowConfirm", () => {
  const m = { channelId: B2, channelName: "<b>허용</b>", activeSessions: 3, csrf: CSRF, nav: NAV };
  const render = () => renderDisallowConfirm(CONFIG, m);

  it("200, 폼 1개, .tone-danger 1개, 채움 버튼 0개, 돌아가기는 a", async () => {
    const r = render();
    expect(r.status).toBe(200);
    expect(r.headers.get("X-Robots-Tag")).toBe("noindex");
    const t = await r.text();
    const main = mainOf(t);
    expect(count(main, /<form /g)).toBe(1);
    expect(count(main, /tone-danger/g)).toBe(1);
    expect(count(t, /btn-primary/g)).toBe(0);
    expect(main).toContain(
      `<form method="post" action="/admin/disallow"><input type="hidden" name="csrf" value="${CSRF}"><input type="hidden" name="channelId" value="${B2}"><button type="submit" class="btn tone-danger">${COPY.audit.disallow}</button></form>`,
    );
    expect(main).toContain(`<a href="/admin">${COPY.confirmDisallow.back}</a>`);
  });

  it("h1·dl·본문: 이름은 이스케이프, 채널 ID와 활성 세션 수, 본문은 confirmDisallow.body", async () => {
    const t = await render().text();
    expect(/<h1>([^<]*)<\/h1>/.exec(t)?.[1]).toBe(COPY.confirmDisallow.title);
    expect(t).toContain('<dl class="summary">');
    expect(t).toContain(`<dd><span class="mono num">${B2}</span></dd>`);
    expect(t).toContain(`<dd><span class="num">3</span></dd>`);
    expect(t).toContain("&lt;b&gt;허용&lt;/b&gt;");
    expect(t).not.toContain("<b>허용");
    noActive(t);
  });

  it("본문 문구는 confirmDisallow.body(이름, 수)다, 이름이 없으면 ‘—’", async () => {
    const t = await renderDisallowConfirm(CONFIG, { ...m, channelName: null }).text();
    expect(t).toContain(COPY.confirmDisallow.body("—", 3));
  });

  it("title에 오류 접두가 없다", async () => {
    expect(titleOf(await render().text()).startsWith(COPY.errorTitlePrefix)).toBe(false);
  });
});

describe("관리 꼬리표 invitedBy", () => {
  const row = (invitedBy: string | null) => ({
    ...EMPTY,
    denied: [{ channelId: C3, channelName: "거부", firstAt: 0, lastAt: 0, attempts: 1, invitedBy, blocked: false }],
  });
  const render = (view: AdminView) => renderAdmin(CONFIG, { view, admins: [A1], csrf: CSRF, nav: NAV }).text();

  it("이름 아래 .meta 글자이고 버튼·열은 그대로다", async () => {
    const t = await render(row("합성주인"));
    expect(t).toContain(`<br><span class="meta">${COPY.invitedBy("합성주인")}</span>`);
    expect(t).toContain(`action="/admin/denied/${C3}/allow"`);
    expect(count(t, /class="badge/g)).toBe(1);
  });

  it("null이거나 필드가 없으면(옛 DO) 꼬리표가 없다", async () => {
    expect(await render(row(null))).not.toContain("초대 받음");
    const old = { ...EMPTY, denied: [{ channelId: C3, channelName: "거부", firstAt: 0, lastAt: 0, attempts: 1 }] } as unknown as AdminView;
    expect(await render(old)).not.toContain("초대 받음");
  });

  it("주인 이름은 이스케이프되고 빈 이름도 꼬리표를 낸다", async () => {
    const t = await render(row("<b>x</b>"));
    expect(t).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(t).not.toContain("<b>x");
    expect(await render(row(""))).toContain("초대 받음 · ‘’");
  });
});

describe("자동 허가 절·차단 표(allowlist-open.md §3.7)", () => {
  const render = (view: AdminView, o?: Parameters<typeof renderAdmin>[2]) => renderAdmin(CONFIG, { view, admins: [A1], csrf: CSRF, nav: NAV }, o).text();

  it("절 순서: 관리자 · 자동 허가 · 허가한 채널 · 거부된 시도 · 차단한 채널 · 활성 로그인 · 감사 기록", async () => {
    const t = await render(EMPTY);
    const heads = [...t.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1]);
    expect(heads).toEqual(["관리자", COPY.autoTitle, COPY.allowTitle, COPY.deniedTitle, COPY.blockedTitle, COPY.colActive, COPY.auditTitle]);
  });

  it("자동 허가 절: 오늘 센 수, 날짜 안내, 숫자 입력(0~100), 끄는 법 도움말, 바꾼 관리자와 시각", async () => {
    const auto = { cap: 20, today: 3, capBy: A1, capAt: Date.UTC(2030, 0, 1, 15, 0, 0) };
    const t = await render({ ...EMPTY, autoAllow: auto });
    expect(t).toContain(`<p>${COPY.autoToday(3, 20)}</p>`);
    expect(t).toContain(COPY.autoDayNote);
    expect(t).toContain('action="/admin/auto-allow"');
    expect(t).toContain('type="number" id="auto-allow-cap" name="cap"');
    expect(t).toContain('min="0" max="100"');
    expect(t).toContain('value="20"');
    expect(t).toContain(COPY.autoOff);
    expect(t).toContain(COPY.autoCapBy(A1, "2030. 1. 2. 오전 12:00"));
    // 바꾼 적이 없으면 그 줄이 없다
    expect(await render(EMPTY)).not.toContain("마지막으로 바꾼 관리자");
  });

  it("400: 오류 요약이 상한 칸으로 가고 입력값이 채워진다", async () => {
    const t = await render(EMPTY, { status: 400, errors: [{ fieldId: "auto-allow-cap", message: COPY.badCap(100) }], capValue: "abc" });
    expect(t).toContain('href="#auto-allow-cap"');
    expect(t).toContain('value="abc"');
    expect(t).toContain('aria-invalid="true"');
  });

  it("허가 행: 'auto'는 자동 허가로 보이고 버튼은 [차단…], 200행을 넘으면 전체 수를 적는다", async () => {
    const row = { channelId: B2, channelName: "새", ownerChannelId: null, note: null, addedBy: "auto", addedAt: 0, activeSessions: 0 };
    const t = await render({ ...EMPTY, allowlist: [row], allowlistTotal: 250 });
    expect(t).toContain(`${COPY.colAddedBy} ${COPY.autoTitle}`);
    expect(t).toContain(`>${COPY.disallow}</a>`);
    expect(t).toContain(COPY.listTotal(250, 200));
    expect(await render({ ...EMPTY, allowlist: [row], allowlistTotal: 1 })).not.toContain("중 최근");
  });

  it("거부된 시도: 차단된 채널은 꼬리표가 있고 [차단…]이 없다, 아니면 [허가]·[차단…]·[지우기]", async () => {
    const d = (blocked: boolean) => ({ channelId: C3, channelName: "거부", firstAt: 0, lastAt: 0, attempts: 1, invitedBy: null, blocked });
    const on = await render({ ...EMPTY, denied: [d(true)] });
    expect(on).toContain(`<span class="meta">${COPY.blockedTag}</span>`);
    expect(on).not.toContain(`href="/admin/${C3}/disallow"`);
    const off = await render({ ...EMPTY, denied: [d(false)] });
    expect(off).not.toContain(COPY.blockedTag);
    expect(off).toContain(`href="/admin/${C3}/disallow"`);
  });

  it("차단한 채널 표: 이름·ID·차단한 관리자·시각과 [허가], 비어 있으면 안내", async () => {
    expect(await render(EMPTY)).toContain(`<p>${COPY.blockedEmpty}</p>`);
    const t = await render({ ...EMPTY, blocked: [{ channelId: C3, channelName: "막힘", blockedBy: A1, blockedAt: 0 }], blockedTotal: 1 });
    expect(t).toContain('id="tbl-blocked"');
    expect(t).toContain(COPY.colBlockedBy);
    expect(t).toContain(COPY.colBlockedAt);
    expect(t).toContain(`name="channelId" value="${C3}"`);
    expect(t).toContain('action="/admin/allow"');
  });

  it("옛 DO의 응답(새 필드 없음)이어도 던지지 않고 새 절만 그리지 않는다", async () => {
    const old = { allowlist: [], denied: [], sessions: [], audit: [] } as unknown as AdminView;
    const t = await render(old);
    expect(t).not.toContain(`<h2>${COPY.autoTitle}</h2>`);
    expect(t).not.toContain(`<h2>${COPY.blockedTitle}</h2>`);
    expect(t).toContain(`<h2>${COPY.allowTitle}</h2>`);
  });
});
