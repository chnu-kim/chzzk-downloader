// 안내·결과 페이지의 상태별 제목·본문(content.md §15.3, web.md §6.1·§6.2). htmlPage는 authorizeUrl만 읽어 설정은 한 줄이면 된다.
import { describe, expect, it } from "vitest";
import type { Config } from "../../src/config";
import { COPY } from "../../src/http/copy";
import { donePage, noticePage } from "../../src/http/pages";
import type { DoneView } from "../../src/store/types";

const CONFIG = { authorizeUrl: "https://chzzk.example.invalid/authorize" } as unknown as Config;
const CH = "0".repeat(30) + "c3";
const view = (o: Partial<DoneView>): DoneView => ({ kind: "web", status: "denied", channelName: "합성채널", channelId: CH, ...o });

describe("noticePage", () => {
  it("h1은 상태별 제목, 본문은 다음에 할 일, 링크는 처음으로 하나, 4xx 제목에는 오류 접두", async () => {
    const t = await noticePage(CONFIG, 404, COPY.linkGone.title, COPY.linkGone.body).text();
    expect(t).toContain("<h1>로그인 주소가 만료됐어요</h1>");
    expect(t).toContain("<p>앱에서 다시 로그인해 주세요.</p>");
    expect(t).toContain("<title>오류: 로그인 주소가 만료됐어요 · 치지직 다운로더</title>");
    expect(t.match(/<a /g)?.length).toBe(2); // 헤더의 앱 이름 + 처음으로
    expect(t).not.toContain("<h1>안내</h1>");
  });

  it("본문이 없으면 문단을 만들지 않고, 200이면 오류 접두를 붙이지 않는다", async () => {
    const adminOnly = await noticePage(CONFIG, 403, COPY.adminOnly.title, null).text();
    expect(adminOnly).toContain("<h1>관리자만 볼 수 있어요</h1>");
    expect(adminOnly).not.toContain("<p></p>");
    const outdated = await noticePage(CONFIG, 200, COPY.outdatedApp.title, COPY.outdatedApp.body).text();
    expect(outdated).toContain("<title>앱을 업데이트해야 해요 · 치지직 다운로더</title>");
  });
});

describe("donePage", () => {
  it("실패: 웹 흐름은 webBody, 앱 흐름·흐름 모름은 body, 제목에 오류 접두", async () => {
    const web = await donePage(CONFIG, "failed", view({ kind: "web", status: "failed" }), null).text();
    expect(web).toContain("<h1>로그인하지 못했어요</h1>");
    expect(web).toContain("처음 화면에서 다시 로그인해 주세요.");
    expect(web).not.toContain("앱에서 다시 시도해 주세요.");
    expect(web).toContain("<title>오류: 로그인하지 못했어요 · 치지직 다운로더</title>");
    for (const v of [view({ kind: "app", status: "failed" }), null]) {
      const t = await donePage(CONFIG, "failed", v, null).text();
      expect(t).toContain("앱에서 다시 시도해 주세요.");
      expect(t).not.toContain("처음 화면에서 다시 로그인해 주세요.");
    }
  });

  it("거부: 채널 이름·ID(콜론 대칭) → 본문 → 다음 행동. 흐름이 없으면 채널 줄이 없다", async () => {
    const t = await donePage(CONFIG, "denied", view({}), null).text();
    expect(t).toContain("<h1>이 채널은 사용 허가가 없어요</h1>");
    expect(t).toContain(`채널: 합성채널 · 채널 ID: ${CH}`);
    expect(t.indexOf("관리자에게 채널 이름을 알려 주세요.")).toBeGreaterThan(t.indexOf("채널 ID:"));
    expect(t.indexOf("허가를 받은 뒤 다시 로그인해 주세요.")).toBeGreaterThan(t.indexOf("관리자에게 채널 이름을"));
    const bare = await donePage(CONFIG, "denied", null, null).text();
    expect(bare).not.toContain("채널 ID");
    expect(bare).toContain("허가를 받은 뒤 다시 로그인해 주세요.");
  });

  it("취소·성공: 제목이 상태를 말한다(성공은 본문 없음)", async () => {
    const c = await donePage(CONFIG, "cancelled", null, null).text();
    expect(c).toContain("<h1>로그인을 취소했어요</h1>");
    expect(c).toContain("처음 화면에서 다시 로그인할 수 있어요.");
    expect(c).not.toContain("오류:");
    const ok = await donePage(CONFIG, "ok", null, null).text();
    expect(ok).toContain("<h1>로그인했어요</h1>");
    expect(ok).not.toContain("<p>");
  });
});
