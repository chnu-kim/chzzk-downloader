// 로그인 결과 로그 이벤트(docs/design/worker.md §14, 구현 중 변경 43). 콜백 URL에 code·state가 실려 Worker 호출에서는 로그를 남기지
// 않으므로(Workers Logs가 Worker 호출의 로그 줄마다 요청 URL 전체를 붙인다) consume·finish RPC가 결과를 보고 AuthStore.ts에서 남긴다.
// redeem 이벤트는 Worker 핸들러가 ctx.log로 남긴다(/auth/redeem은 quiet가 아니다).
// 순수 함수: 이벤트 이름과 필드만 정한다(출력은 AuthStore.ts).
import type { LogFields } from "../core/log";
import type { ConsumeResult, FinishResult, LoginLogHint, LoginOutcome, RedeemResult } from "./types";

export type LogEvent = readonly [event: string, fields: LogFields];

const kindOf = (hint: LoginLogHint): LogFields => (hint.flowKind === undefined ? {} : { flowKind: hint.flowKind });

/** consume 실패만 이벤트다(성공은 finish가 남긴다) */
export function consumeEvent(r: ConsumeResult): LogEvent | null {
  return r.ok ? null : ["auth.login.failed", { reason: r.code === "binder" ? "binder" : "state" }];
}

/**
 * finish 이벤트. 취소·실패는 Worker가 정한 결과라 finish의 반환과 상관없이 그 이벤트다(사유는 힌트, 없으면 실패 코드).
 * 사용자 결과(user)는 finish가 정한다: ok(app·web) · denied · cancelled · failed·gone(reason = 그 종류)
 */
export function finishEvent(outcome: LoginOutcome, r: FinishResult, hint: LoginLogHint = {}): LogEvent {
  if (outcome.type === "cancelled") return ["auth.login.cancelled", kindOf(hint)];
  if (outcome.type === "failed") return ["auth.login.failed", { ...hint, reason: hint.reason ?? outcome.code }];
  // 앱 종결(loopback)은 result가 이벤트를 정한다
  const t = r.type === "loopback" ? r.result : r.type;
  switch (t) {
    case "ok":
      return ["auth.login.ok", { flowKind: "app" }];
    case "web":
      return ["auth.login.ok", { flowKind: "web" }];
    case "denied":
      return ["auth.login.denied", kindOf(hint)];
    case "cancelled":
      return ["auth.login.cancelled", kindOf(hint)];
    case "failed":
    case "gone":
      return ["auth.login.failed", { ...kindOf(hint), reason: t }];
  }
}

/** redeem 이벤트(Worker 핸들러가 남긴다). 값은 싣지 않는다 */
export function redeemEvent(r: RedeemResult): LogEvent {
  switch (r.status) {
    case "not_found":
      return ["auth.redeem.rejected", { reason: "not_found" }];
    case "ok":
      return ["auth.redeem.ok", {}];
    case "denied":
      return ["auth.redeem.denied", {}];
    case "cancelled":
      return ["auth.redeem.cancelled", {}];
    case "failed":
      return ["auth.redeem.failed", { reason: r.code }];
  }
}
