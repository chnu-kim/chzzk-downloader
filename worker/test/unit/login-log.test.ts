// 로그인 결과 이벤트 표(src/store/login-log.ts, 구현 중 변경 43): 콜백 대신 consume·finish RPC가 남기는 이벤트.
import { describe, expect, it } from "vitest";
import { consumeEvent, finishEvent } from "../../src/store/login-log";

describe("consumeEvent", () => {
  it("성공은 이벤트가 없고 실패는 state·binder", () => {
    expect(consumeEvent({ ok: true, flowId: "x", kind: "app" })).toBeNull();
    expect(consumeEvent({ ok: false, code: "not_found" })).toEqual(["auth.login.failed", { reason: "state" }]);
    expect(consumeEvent({ ok: false, code: "binder" })).toEqual(["auth.login.failed", { reason: "binder" }]);
  });
});

describe("finishEvent", () => {
  const user = { type: "user", channelId: "c", channelName: "n" } as const;

  it("취소·실패는 Worker가 정한 결과라 finish의 반환과 상관없다", () => {
    for (const r of [{ type: "cancelled" }, { type: "gone" }] as const) {
      expect(finishEvent({ type: "cancelled" }, r, { flowKind: "web" })).toEqual(["auth.login.cancelled", { flowKind: "web" }]);
    }
    expect(finishEvent({ type: "failed", code: "token" }, { type: "gone" }, { flowKind: "app", reason: "code_format" })).toEqual([
      "auth.login.failed",
      { flowKind: "app", reason: "code_format" },
    ]);
    // 힌트에 사유가 없으면 실패 코드
    expect(finishEvent({ type: "failed", code: "timeout" }, { type: "failed" })).toEqual(["auth.login.failed", { reason: "timeout" }]);
  });

  it("사용자 결과는 finish가 정한다", () => {
    expect(finishEvent(user, { type: "ok" }, { flowKind: "web" })).toEqual(["auth.login.ok", { flowKind: "app" }]);
    expect(finishEvent(user, { type: "web", cookieToken: "t", csrf: "c", expiresAt: 1 }, { flowKind: "app" })).toEqual(["auth.login.ok", { flowKind: "web" }]);
    expect(finishEvent(user, { type: "denied" }, { flowKind: "app" })).toEqual(["auth.login.denied", { flowKind: "app" }]);
    expect(finishEvent(user, { type: "cancelled" })).toEqual(["auth.login.cancelled", {}]);
    expect(finishEvent(user, { type: "failed" }, { flowKind: "app" })).toEqual(["auth.login.failed", { flowKind: "app", reason: "failed" }]);
    expect(finishEvent(user, { type: "gone" }, { flowKind: "web" })).toEqual(["auth.login.failed", { flowKind: "web", reason: "gone" }]);
  });
});
