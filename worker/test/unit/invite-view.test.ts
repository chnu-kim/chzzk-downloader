// 초대·완료 페이지 렌더러(delegation.md §5, worker.md 구현 중 변경 106). 순수 함수라 Response 본문 문자열로 비교한다.
import { describe, expect, it } from "vitest";
import type { Config } from "../../src/config";
import type { EntryContext } from "../../src/core/entry";
import { COPY } from "../../src/http/copy";
import { renderDelegationDone, renderInvite, renderInviteConfirm, renderInviteOwn } from "../../src/http/invite-view";

const CONFIG = { authorizeUrl: "https://chzzk.example.invalid/authorize", publicOrigin: "https://worker.test" } as unknown as Config;
const CSRF = "C".repeat(43);
const TOKEN = "cdi_" + "A".repeat(43);
const B2 = "0".repeat(30) + "b2";
const NAV = { kind: "member", channelName: "합성 편집자", isAdmin: false } as const;
const MAC: EntryContext = { kind: "desktop", os: "mac", inApp: null };
const PHONE: EntryContext = { kind: "phone", os: null, inApp: null };
const KAKAO: EntryContext = { kind: "phone", os: null, inApp: "kakao" };
const EVIL = "<script>alert(1)</script>\"'&합성";

const count = (t: string, re: RegExp): number => (t.match(re) ?? []).length;
const mainOf = (t: string): string => /<main [^>]*>([\s\S]*)<\/main>/.exec(t)?.[1] ?? "";
const titleOf = (t: string): string => /<title>([^<]*)<\/title>/.exec(t)?.[1] ?? "";
const h1Of = (t: string): string => (/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(t)?.[1] ?? "").replace(/<[^>]*>/g, "");
const primary = (t: string): number => count(mainOf(t), /btn btn-primary/g);

const noActive = (t: string) => {
  expect(t).not.toContain("<script");
  expect(t).not.toContain("<style");
  expect(t).not.toContain("style=");
  expect(t).not.toContain("og:");
};

describe("renderInvite(비로그인)", () => {
  it("제목·고지 네 줄·처리방침 링크·[치지직으로 로그인] 하나", async () => {
    const res = renderInvite(CONFIG, { ownerName: "합성주인", token: TOKEN });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    const t = await res.text();
    noActive(t);
    expect(h1Of(t)).toBe(COPY.invite.title("합성주인"));
    expect(titleOf(t)).toBe(`${COPY.invite.title("합성주인")} · ${COPY.siteName}`);
    const m = mainOf(t);
    const order = [COPY.invite.body, COPY.landing.consent.collect, COPY.invite.consent.use("합성주인"), COPY.landing.consent.exclude, COPY.invite.consent.revoke];
    let at = -1;
    for (const line of order) {
      const i = m.indexOf(line);
      expect(i).toBeGreaterThan(at);
      at = i;
    }
    expect(m).toContain(`href="/privacy"`);
    expect(count(m, /<form /g)).toBe(1);
    expect(m).toContain(`<form method="post" action="/invite/${TOKEN}/start">`);
    expect(primary(t)).toBe(1);
    expect(m).toContain(COPY.loginWithChzzk);
    // 헤더에 [로그인] 링크가 없다(이 버튼이 로그인이다)
    expect(t).not.toContain("/#start");
    expect(m).not.toContain('name="csrf"');
  });

  it("주인 이름은 이스케이프된다", async () => {
    const t = await renderInvite(CONFIG, { ownerName: EVIL, token: TOKEN }).text();
    expect(t).not.toContain("<script>alert");
    expect(t).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("renderInviteConfirm(로그인한 확인)", () => {
  const render = (o: Partial<Parameters<typeof renderInviteConfirm>[1]> = {}) => renderInviteConfirm(CONFIG, { ownerName: "합성주인", me: "합성 편집자", csrf: CSRF, token: TOKEN, nav: NAV, ...o });

  it("제목·요약·본문 둘·[편집자 되기] 하나·csrf·처음으로 링크", async () => {
    const res = render();
    expect(res.status).toBe(200);
    const t = await res.text();
    noActive(t);
    expect(h1Of(t)).toBe(COPY.invite.confirm.title("합성주인"));
    const m = mainOf(t);
    expect(m).toContain(`<dt>${COPY.invite.confirm.owner}</dt><dd>합성주인</dd><dt>${COPY.myChannel}</dt><dd>합성 편집자</dd>`);
    expect(m).toContain(COPY.invite.confirm.body("합성주인"));
    expect(m).toContain(COPY.invite.confirm.body2("합성주인"));
    expect(count(m, /<form /g)).toBe(1);
    expect(m).toContain(`action="/invite/${TOKEN}/accept"`);
    expect(m).toContain(`name="csrf" value="${CSRF}"`);
    expect(primary(t)).toBe(1);
    expect(m).toContain(COPY.invite.accept);
    expect(m).toContain(`<a href="/">${COPY.home}</a>`);
    expect(m).not.toContain('href="/privacy"');
    // 확인 제목은 ?로 끝난다(terms.json allow)
    expect(h1Of(t).endsWith("?")).toBe(true);
  });

  it("두 이름은 이스케이프된다", async () => {
    const t = await render({ ownerName: EVIL, me: EVIL }).text();
    expect(t).not.toContain("<script>alert");
    expect(count(t, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/g)).toBeGreaterThanOrEqual(3);
  });
});

describe("renderInviteOwn", () => {
  it("info 제목 + 한 줄 + 처음으로, 폼과 채움 버튼 없음", async () => {
    const t = await renderInviteOwn(CONFIG, NAV).text();
    noActive(t);
    expect(h1Of(t)).toBe(COPY.invite.own.title);
    expect(mainOf(t)).toContain(`<p>${COPY.invite.own.body}</p>`);
    expect(count(mainOf(t), /<form /g)).toBe(0);
    expect(primary(t)).toBe(0);
    expect(t).toContain("status-muted");
    expect(titleOf(t)).not.toContain(COPY.errorTitlePrefix);
  });
});

describe("renderDelegationDone", () => {
  const render = (entry: EntryContext, o: Partial<Parameters<typeof renderDelegationDone>[1]> = {}) =>
    renderDelegationDone(CONFIG, { ownerName: "합성주인", ownerChannelId: B2, me: "합성 편집자", csrf: CSRF, entry, nav: NAV, ...o });

  it("제목·요약·안내 셋·[편집자 그만두기] 테두리 버튼 하나, 채움 버튼 없음", async () => {
    const t = await render(MAC).text();
    noActive(t);
    expect(h1Of(t)).toBe(COPY.inviteDone.title("합성주인"));
    const m = mainOf(t);
    expect(m).toContain(`<dt>${COPY.myChannel}</dt><dd>합성 편집자</dd>`);
    expect(m).toContain(COPY.inviteDone.body("합성주인"));
    expect(m).toContain(COPY.inviteDone.refresh);
    expect(m).toContain(COPY.inviteDone.otherAccount);
    // 다른 계정 안내는 실제로 되는 절차여야 한다: 수락한 초대는 소비되므로 같은 주소를 다시 열라고 하지 않고,
    // 이 사이트의 웹 세션과 네이버 로그인을 둘 다 끝낸 뒤 새 초대 주소를 받으라고 한다
    expect(COPY.inviteDone.otherAccount).not.toContain("주소를 다시 열어");
    expect(COPY.inviteDone.otherAccount).toContain("처음 화면과 네이버에서 로그아웃");
    expect(COPY.inviteDone.otherAccount).toContain("새 초대 주소");
    expect(primary(t)).toBe(0);
    expect(count(m, /<form /g)).toBe(1);
    expect(m).toContain(`action="/me/delegations/leave"`);
    expect(m).toContain(`name="owner" value="${B2}"`);
    expect(m).toContain(`name="csrf" value="${CSRF}"`);
    expect(m).not.toContain("tone-danger");
    expect(m).toContain(`<button type="submit" class="btn">${COPY.leaveDelegation}</button>`);
  });

  it("휴대폰·카카오톡 진입에서만 컴퓨터 설치 안내가 있다", async () => {
    expect(await render(MAC).text()).not.toContain(COPY.inviteDone.desktop);
    expect(await render(PHONE).text()).toContain(COPY.inviteDone.desktop);
    expect(await render(KAKAO).text()).toContain(COPY.inviteDone.desktop);
    expect(await render({ kind: "desktop", os: "windows", inApp: "kakao" }).text()).toContain(COPY.inviteDone.desktop);
  });

  it("이름은 이스케이프된다", async () => {
    const t = await render(MAC, { ownerName: EVIL, me: EVIL }).text();
    expect(t).not.toContain("<script>alert");
  });
});
