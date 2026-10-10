// design-worker의 고정 데이터와 서버 역할(docs/design/system/governance.md §2.6b, 계약 §2.1·§5).
// wrangler dev·Durable Object·R2·비밀값 파일을 쓰지 않는다. 각 페이지의 순수 렌더 함수를 합성 데이터로 불러 Response를 만들고,
// 가짜 출처(ORIGIN)의 page.route로 그 본문·헤더(CSP 포함)를 그대로 내보낸다. 스타일시트·아이콘은 실제 에셋 표(asset)에서 준다.
// 이 모듈이 import하는 src/http 모듈은 라우터·저장소 클래스·cloudflare:를 값으로 가져오지 않는다(카나리: 닿으면 spec이 깨진다).
// 실제 채널 ID·이름·연락처를 쓰지 않는다: 채널은 합성 ID(a1·b2·c3·d4를 32자로 0 채움), 버전은 가짜다.
import type { Page } from "@playwright/test";
import { loadConfig, PROD_API_BASE, PROD_AUTHORIZE_URL, type Config } from "../src/config";
import type { EntryContext } from "../src/core/entry";
import { artifactFile, landingRows } from "../src/core/landing";
import { renderAdmin, renderDisallowConfirm, type AdminModel } from "../src/http/admin-view";
import { asset } from "../src/http/assets";
import { COPY } from "../src/http/copy";
import { renderLanding, type MemberModel } from "../src/http/landing-view";
import { donePage, loginConfirmPage, noticePage } from "../src/http/pages";
import { renderHelp, renderLicenses, renderPrivacy } from "../src/http/reading-view";
import type { Ctx } from "../src/routes";
import type { AdminView } from "../src/store/types";

export const ORIGIN = "https://worker.test";
/** 고정 시각(KST). 표의 시각이 실행마다 같다 */
export const FIXED_NOW = new Date("2026-01-01T00:00:00+09:00").getTime();
export const VERSION = "0.1.2";

const ch = (s: string): string => s.padStart(32, "0");
const A1 = ch("a1");
const B2 = ch("b2");
const C3 = ch("c3");
const D4 = ch("d4");
const CSRF = "C".repeat(43);

// 합성 환경: 운영 모양의 값(자리표시)이다. 어떤 파일도 읽지 않는다
const loaded = loadConfig({
  PUBLIC_ORIGIN: ORIGIN,
  CHZZK_AUTHORIZE_URL: PROD_AUTHORIZE_URL,
  CHZZK_API_BASE: PROD_API_BASE,
  CHZZK_CLIENT_ID: "synthetic-client-id",
  CHZZK_CLIENT_SECRET: "synthetic-client-placeholder",
  ADMIN_CHANNEL_IDS: A1,
  CI_VERIFY_TOKEN: "synthetic-ci-token",
  BUILD_ID: "e2e",
});
if (!loaded.ok) throw new Error(`합성 설정이 틀렸다: ${loaded.key}`);
export const config: Config = loaded.config;

const MAC: EntryContext = { kind: "desktop", os: "mac", inApp: null };
const UNKNOWN: EntryContext = { kind: "unknown", os: null, inApp: null };
const PHONE: EntryContext = { kind: "phone", os: null, inApp: null };
const KAKAO_PHONE: EntryContext = { kind: "phone", os: null, inApp: "kakao" };
const DESKTOP_WIN: EntryContext = { kind: "desktop", os: "windows", inApp: null };

const sums = new Map(
  ["darwin-aarch64.dmg", "windows-x86_64-setup.exe", "windows-x86_64.msi", "linux-x86_64.AppImage", "linux-x86_64.deb"].map((n, i) => [artifactFile(VERSION, n), String(i + 1).repeat(64)]),
);

const member: MemberModel = {
  csrf: CSRF,
  currentSessionId: "s".repeat(16),
  downloads: { kind: "ok", version: VERSION, pubDate: "2026-01-01", rows: landingRows(VERSION, sums) },
  devices: [
    { id: "s".repeat(16), kind: "web", client: "Chrome 합성", createdAt: FIXED_NOW - 3_600_000, lastSeenAt: FIXED_NOW - 60_000 },
    { id: "t".repeat(16), kind: "app", client: "app/0.1.2 macos", createdAt: FIXED_NOW - 86_400_000, lastSeenAt: FIXED_NOW - 7_200_000 },
  ],
};

const MEMBER_NAV = { kind: "member", channelName: "합성채널", isAdmin: true } as const;
const ANON_NAV = { kind: "anon" } as const;

const adminView: AdminView = {
  allowlist: [
    { channelId: A1, channelName: "합성 관리자", ownerChannelId: null, note: null, addedBy: A1, addedAt: FIXED_NOW - 86_400_000 * 30, activeSessions: 1 },
    { channelId: B2, channelName: "합성채널", ownerChannelId: null, note: "합성 메모", addedBy: A1, addedAt: FIXED_NOW - 86_400_000 * 3, activeSessions: 2 },
  ],
  denied: [
    { channelId: C3, channelName: "합성 거부 채널", firstAt: FIXED_NOW - 86_400_000, lastAt: FIXED_NOW - 3_600_000, attempts: 3 },
    { channelId: D4, channelName: null, firstAt: FIXED_NOW - 7_200_000, lastAt: FIXED_NOW - 7_200_000, attempts: 1 },
  ],
  sessions: [
    { id: "a".repeat(16), kind: "web", channelId: B2, channelName: "합성채널", client: "Chrome 합성", createdAt: FIXED_NOW - 7_200_000, lastSeenAt: FIXED_NOW - 60_000, recovered: 0 },
    { id: "b".repeat(16), kind: "app", channelId: B2, channelName: "합성채널", client: "app/0.1.2 windows", createdAt: FIXED_NOW - 86_400_000, lastSeenAt: FIXED_NOW - 600_000, recovered: 2 },
  ],
  audit: [
    { at: FIXED_NOW - 86_400_000 * 3, actor: A1, action: "allow", target: B2 },
    { at: FIXED_NOW - 86_400_000, actor: A1, action: "revoke_session", target: B2 },
    { at: FIXED_NOW - 3_600_000, actor: A1, action: "dismiss", target: C3 },
  ],
};
const adminModel: AdminModel = { view: adminView, admins: [A1], csrf: CSRF, nav: MEMBER_NAV };

export interface PageDef {
  readonly name: string;
  readonly build: () => Response | Promise<Response>;
}

/** 갤러리가 도는 열여섯 페이지(계약 §5) */
export const PAGES: readonly PageDef[] = [
  { name: "landing-anon", build: () => renderLanding(config, { entry: MAC, nav: ANON_NAV, flash: null, member: null }) },
  { name: "landing-member-mac", build: () => renderLanding(config, { entry: MAC, nav: MEMBER_NAV, flash: null, member }) },
  { name: "landing-member-unknown", build: () => renderLanding(config, { entry: UNKNOWN, nav: MEMBER_NAV, flash: null, member }) },
  { name: "landing-phone", build: () => renderLanding(config, { entry: PHONE, nav: ANON_NAV, flash: null, member: null }) },
  { name: "admin", build: () => renderAdmin(config, adminModel) },
  {
    name: "admin-error",
    build: () =>
      renderAdmin(config, adminModel, {
        status: 400,
        errors: [{ fieldId: "allow-channel-id", message: COPY.badChannelId }],
        values: { channelId: "abc", note: "" },
      }),
  },
  { name: "admin-confirm", build: () => renderDisallowConfirm(config, { channelId: B2, channelName: "합성채널", activeSessions: 2, csrf: CSRF, nav: MEMBER_NAV }) },
  { name: "done-denied", build: () => donePage(config, "denied", { kind: "web", status: "denied", channelName: "합성 거부 채널", channelId: C3 }, null, DESKTOP_WIN) },
  { name: "done-cancelled", build: () => donePage(config, "cancelled", { kind: "web", status: "cancelled", channelName: null, channelId: null }, null, DESKTOP_WIN) },
  { name: "done-failed-kakao", build: () => donePage(config, "failed", { kind: "web", status: "failed", channelName: null, channelId: null }, null, KAKAO_PHONE) },
  { name: "login-confirm", build: () => loginConfirmPage(config) },
  { name: "outdated-app", build: () => noticePage(config, 200, COPY.outdatedApp.title, COPY.outdatedApp.body) },
  { name: "error-404", build: () => noticePage(config, 404, COPY.linkGone.title, COPY.linkGone.body) },
  { name: "help", build: () => renderHelp(config, ANON_NAV) },
  { name: "privacy", build: () => renderPrivacy(config, ANON_NAV) },
  { name: "licenses", build: () => renderLicenses(config, ANON_NAV) },
];

/** 읽기 척도(main[data-scale=reading])를 쓰는 페이지: 랜딩 넷과 읽기 페이지 셋(계약 §2.6) */
export const READING_PAGES: ReadonlySet<string> = new Set(["landing-anon", "landing-member-mac", "landing-member-unknown", "landing-phone", "help", "privacy", "licenses"]);

/**
 * 가짜 출처를 연다. /assets/*는 실제 에셋 표(스타일시트·아이콘)에서 주고, 문서 요청은 res의 본문·헤더를 그대로 준다.
 * 페이지는 ORIGIN + "/"로 연다(goto). 그 밖의 요청은 404다.
 */
export async function serve(page: Page, res: Response): Promise<void> {
  const status = res.status;
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });
  const body = await res.text();
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/assets/")) {
      const a = asset(new Request(url), { params: { file: url.pathname.slice("/assets/".length) } } as unknown as Ctx);
      await route.fulfill({
        status: a.status,
        headers: Object.fromEntries(a.headers.entries()),
        body: Buffer.from(await a.arrayBuffer()),
      });
      return;
    }
    if (route.request().resourceType() === "document" && url.pathname === "/") {
      await route.fulfill({ status, headers, body });
      return;
    }
    await route.fulfill({ status: 404, body: "" });
  });
}
