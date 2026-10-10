// 화면 렌더러(docs/design/worker.md 구현 중 변경 38). 순수 함수라 문자열로 비교한다.
import { describe, expect, it } from "vitest";
import { renderHtml } from "../../src/core/html";
import { adminBody } from "../../src/http/admin-view";
import { COPY } from "../../src/http/copy";
import type { Downloads } from "../../src/http/landing";
import { type MemberModel, anonymousBody, memberBody, postButton } from "../../src/http/landing-view";
import type { AdminView, MySessionView } from "../../src/store/types";

const CSRF = "C".repeat(43);
const hex = (n: string) => n.repeat(64).slice(0, 64);
const FILE = "chzzk-downloader_0.2.0_darwin-aarch64.dmg";
const OK: Downloads = { kind: "ok", version: "0.2.0", pubDate: "2030-01-01", rows: [{ id: "dmg", file: FILE, sha256: hex("a") }] };
const dev = (id: string, o: Partial<MySessionView> = {}): MySessionView => ({ id, kind: "web", client: null, createdAt: Date.UTC(2030, 0, 1), lastSeenAt: Date.UTC(2030, 0, 1), ...o });
const member = (o: Partial<MemberModel> = {}): MemberModel => ({ channelName: "이름", isAdmin: false, csrf: CSRF, currentSessionId: "s1", downloads: OK, devices: [dev("s1"), dev("s2", { kind: "app", client: "app/0.2.0 macos" })], ...o });
const render = (m: MemberModel) => renderHtml(memberBody(m));
const EMPTY: AdminView = { allowlist: [], denied: [], sessions: [], audit: [] };

const noActive = (t: string) => {
  expect(t).not.toContain("<script");
  expect(t).not.toContain("<style");
  expect(t).not.toContain("style=");
};

describe("memberBody", () => {
  it("채널 이름·기기 정보는 이스케이프된다", () => {
    const t = render(member({ channelName: "<b>x</b>", devices: [dev("s1", { client: "<script>c</script>" })] }));
    expect(t).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(t).not.toContain("<b>");
    expect(t).toContain("&lt;script&gt;c&lt;/script&gt;");
    noActive(t);
  });

  it("현재 세션 행에만 이 브라우저 표시", () => {
    const t = render(member());
    expect(t.split(COPY.thisBrowser)).toHaveLength(2);
    expect(t).toContain(`웹 · ${COPY.thisBrowser}`);
  });

  it("csrf 숨은 입력은 기기 수 + 1(로그아웃)번", () => {
    const t = render(member());
    expect(t.split(`name="csrf" value="${CSRF}"`)).toHaveLength(4);
    expect(t).toContain('action="/me/sessions/s1/revoke"');
    expect(t).toContain('action="/auth/web/logout"');
    noActive(t);
  });

  it("관리자만 관리 링크", () => {
    expect(render(member())).not.toContain('href="/admin"');
    expect(render(member({ isAdmin: true }))).toContain('href="/admin"');
  });

  it("기기가 없으면 안내 문구", () => {
    expect(render(member({ devices: [] }))).toContain(COPY.devicesEmpty);
  });

  it("downloads: none · unavailable · ok", () => {
    expect(render(member({ downloads: { kind: "none" } }))).toContain(COPY.noRelease);
    expect(render(member({ downloads: { kind: "unavailable" } }))).toContain(COPY.releaseUnavailable);
    const t = render(member());
    expect(t).toContain(`href="/releases/0.2.0/${FILE}"`);
    expect(t).toContain(hex("a"));
    expect(t).toContain("최신 버전 0.2.0 · 2030-01-01");
    expect(t).toContain("<details>");
    expect(t).toContain("chmod +x chzzk-downloader_0.2.0_linux-x86_64.AppImage");
  });
});

describe("anonymousBody", () => {
  it("로그인 폼 하나, 설치 파일·csrf 없음", () => {
    const t = renderHtml(anonymousBody());
    expect(t).toContain('action="/auth/web/start"');
    expect(t).not.toContain("/releases/");
    expect(t).not.toContain('name="csrf"');
    noActive(t);
  });
});

describe("postButton", () => {
  it("action·필드 값은 이스케이프된다", () => {
    const t = renderHtml(postButton('/x"y', CSRF, "<끊기>", { danger: true, fields: { channelId: '"><b>' } }));
    expect(t).toContain('action="/x&quot;y"');
    expect(t).toContain('value="&quot;&gt;&lt;b&gt;"');
    expect(t).toContain('class="danger"');
    expect(t).not.toContain("<b>");
  });
});

describe("adminBody", () => {
  const A1 = "0".repeat(30) + "a1";
  const B2 = "0".repeat(30) + "b2";
  const C3 = "0".repeat(30) + "c3";
  const view: AdminView = {
    allowlist: [
      { channelId: A1, channelName: "관리자", ownerChannelId: null, note: null, addedBy: A1, addedAt: Date.UTC(2030, 0, 1), activeSessions: 1 },
      { channelId: B2, channelName: null, ownerChannelId: null, note: "<img src=x onerror=1>", addedBy: A1, addedAt: Date.UTC(2030, 0, 1), activeSessions: 0 },
    ],
    denied: [{ channelId: C3, channelName: "<i>거부</i>", firstAt: Date.UTC(2030, 0, 1), lastAt: Date.UTC(2030, 0, 2), attempts: 2 }],
    sessions: [{ id: "sid", kind: "app", channelId: B2, channelName: "허용", client: "<x>", createdAt: 0, lastSeenAt: 0, recovered: 1 }],
    audit: [{ at: 0, actor: A1, action: "allow", target: B2 }],
  };
  const render = () => renderHtml(adminBody(view, [A1], CSRF));

  it("관리자 채널 행에는 빼기 폼이 없고 관리자 표시가 있다", () => {
    const t = render();
    expect(t).toContain(`name="channelId" value="${B2}"`);
    expect(t).not.toContain(`name="channelId" value="${A1}"`);
    expect(t.split('action="/admin/disallow"')).toHaveLength(2);
    expect(t).toContain(`<span class="muted">${COPY.adminsTitle}</span>`);
  });

  it("메모·이름·기기 정보는 이스케이프된다", () => {
    const t = render();
    expect(t).toContain("&lt;img src=x onerror=1&gt;");
    expect(t).toContain("&lt;i&gt;거부&lt;/i&gt;");
    expect(t).not.toContain("<img");
    expect(t).not.toContain("<i>");
    noActive(t);
  });

  it("거부 행마다 허용·지우기 폼 2개", () => {
    const t = render();
    expect(t).toContain(`action="/admin/denied/${C3}/allow"`);
    expect(t).toContain(`action="/admin/denied/${C3}/dismiss"`);
    expect(t).toContain('action="/admin/sessions/sid/revoke"');
  });

  it("빈 화면은 빈 문구 네 개", () => {
    const t = renderHtml(adminBody(EMPTY, [A1], CSRF));
    for (const m of [COPY.allowEmpty, COPY.deniedEmpty, COPY.sessionsEmpty, COPY.auditEmpty]) expect(t).toContain(m);
    expect(t).toContain('action="/admin/allow"');
  });
});
