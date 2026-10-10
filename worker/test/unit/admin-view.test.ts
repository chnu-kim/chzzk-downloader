// 관리 화면·허가 빼기 확인 페이지 렌더러(docs/design/system/web.md §6.3·§7·§8, 계약 §2.1·§2.5). 순수 함수라 Response 본문 문자열로 비교한다.
import { describe, expect, it } from "vitest";
import type { Config } from "../../src/config";
import { renderAdmin, renderDisallowConfirm } from "../../src/http/admin-view";
import { COPY } from "../../src/http/copy";
import type { AdminView } from "../../src/store/types";

const CONFIG = { authorizeUrl: "https://chzzk.example.invalid/authorize", publicOrigin: "https://worker.test" } as unknown as Config;
const CSRF = "C".repeat(43);
const EMPTY: AdminView = { allowlist: [], denied: [], sessions: [], audit: [] };
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
    denied: [{ channelId: C3, channelName: "<i>거부</i>", firstAt: Date.UTC(2030, 0, 1), lastAt: Date.UTC(2030, 0, 2), attempts: 2 }],
    sessions: [{ id: "sid", kind: "app", channelId: B2, channelName: "허용", client: "<x>", createdAt: 0, lastSeenAt: 0, recovered: 1 }],
    audit: [{ at: 0, actor: A1, action: "allow", target: B2 }],
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
