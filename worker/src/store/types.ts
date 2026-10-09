// AuthStore RPC 결과·공용 타입(docs/design/worker.md 구현 중 변경 18). 타입만 둔다. 시각은 모두 epoch ms다(RFC3339 변환은 Worker).
import type { LogFields } from "../core/log";

export type FlowKind = "app" | "web";
export type FlowStatus = "started" | "redirected" | "exchanging" | "ok" | "denied" | "cancelled" | "failed";
export type FailCode = "token" | "user" | "timeout" | "user_format" | "binder" | "session";
/** Worker가 finish에 넘기는 실패 코드 */
export type LoginFailCode = "token" | "user" | "timeout" | "user_format";
/**
 * 콜백(quiet 경로라 Worker는 로그를 남기지 않는다)이 finish에 넘기는 로그 힌트: DO만 아는 결과에 Worker만 아는 흐름 종류·실패 사유
 * (code 형식·치지직 실패 단계·예외 이름)를 더한다(구현 중 변경 43). 값은 §14 허용 필드뿐이고 log.ts가 키를 다시 거른다
 */
export type LoginLogHint = Pick<LogFields, "level" | "flowKind" | "reason" | "stage" | "status" | "timedOut" | "chzzkCode" | "errorName">;
export type RevokeWhy = "logout" | "admin" | "disallowed" | "reuse" | "user";
export type AuditAction = "allow" | "disallow" | "revoke_session" | "reuse_detected" | "refresh_recovered" | "dismiss";
/** 새로 만든 토큰: token은 호출자에게 돌려주고 hash만 저장한다 */
export type Minted = { readonly token: string; readonly hash: string };

export type TokenBundle = {
  readonly accessToken: string;
  readonly accessExpiresAt: number;
  readonly refreshToken: string;
  readonly refreshExpiresAt: number;
  /** ownerChannelId */
  readonly channelId: string;
  readonly channelName: string;
  readonly isAdmin: boolean;
};

/** startApp RPC 입력(객체 하나: 배포 중 옛 isolate의 위치 인자 호출은 객체 검사에서 bad_request, 구현 중 변경 88 (다)·89) */
export type StartAppInput = { readonly port: number; readonly verifier: string; readonly client: string; readonly ip: string | null; readonly limit: number };
export type StartAppResult =
  | { readonly ok: true; readonly flowId: string; readonly handle: string; readonly expiresAt: number }
  | { readonly ok: false; readonly code: "rate_limited"; readonly retryAfterSec: number }
  | { readonly ok: false; readonly code: "busy" | "bad_request" };
export type StartWebResult =
  | { readonly ok: true; readonly state: string; readonly binder: string; readonly expiresAt: number }
  | { readonly ok: false; readonly code: "rate_limited"; readonly retryAfterSec: number }
  | { readonly ok: false; readonly code: "busy" };
export type LoginPageView = { readonly status: FlowStatus; readonly expiresAt: number };
export type ContinueResult =
  | { readonly ok: true; readonly state: string; readonly binder: string }
  | { readonly ok: false; readonly code: "not_found" | "already_used" };
export type ConsumeResult =
  | { readonly ok: true; readonly flowId: string; readonly kind: FlowKind }
  | { readonly ok: false; readonly code: "not_found" | "binder" };
export type LoginOutcome =
  | { readonly type: "cancelled" }
  | { readonly type: "failed"; readonly code: LoginFailCode }
  | { readonly type: "user"; readonly channelId: string; readonly channelName: string };
/** 앱 흐름의 종결 결과(루프백 303으로 앱 수신기에 가고, 내용은 redeem이 싣는다) */
export type LoopbackResult = "ok" | "denied" | "cancelled" | "failed";
/** denied·cancelled·failed는 웹 흐름, 그리고 port가 NULL인 앱 흐름의 failed다 */
export type FinishResult =
  | { readonly type: "loopback"; readonly result: LoopbackResult; readonly port: number; readonly grant: string; readonly state: string }
  | { readonly type: "web"; readonly cookieToken: string; readonly csrf: string; readonly expiresAt: number }
  | { readonly type: "denied" }
  | { readonly type: "cancelled" }
  | { readonly type: "failed" }
  /** 흐름이 없거나 exchanging이 아니거나 만료: Worker는 r=failed */
  | { readonly type: "gone" };
/** store finish(동기)의 결과: 앱 종결은 verifier를 담고 AuthStore가 트랜잭션 뒤 state로 바꾼다(verifier는 RPC 밖으로 나가지 않는다) */
export type FinishSettled =
  | Exclude<FinishResult, { type: "loopback" }>
  | { readonly type: "loopback"; readonly result: LoopbackResult; readonly port: number; readonly grant: string; readonly verifier: string };
export type DoneView = {
  readonly kind: FlowKind;
  readonly status: "ok" | "denied" | "cancelled" | "failed";
  readonly channelName: string | null;
  readonly channelId: string | null;
};
export type RedeemResult =
  | { readonly status: "not_found" }
  | { readonly status: "ok"; readonly bundle: TokenBundle }
  | { readonly status: "denied"; readonly channelName: string }
  | { readonly status: "cancelled" }
  | { readonly status: "failed"; readonly code: FailCode };

export type SessionDenial = {
  readonly ok: false;
  readonly code: "invalid_token" | "session_revoked" | "not_allowed";
  readonly why: RevokeWhy | null;
};
export type CheckResult =
  | {
      readonly ok: true;
      readonly sessionId: string;
      readonly channelId: string;
      readonly ownerChannelId: string;
      readonly channelName: string;
      readonly isAdmin: boolean;
      readonly accessExpiresAt: number;
    }
  | SessionDenial;
export type WebCheckResult =
  | {
      readonly ok: true;
      readonly sessionId: string;
      readonly channelId: string;
      readonly ownerChannelId: string;
      readonly channelName: string;
      readonly isAdmin: boolean;
      readonly csrf: string;
      readonly expiresAt: number;
    }
  | SessionDenial;
export type RotateResult =
  | { readonly ok: true; readonly bundle: TokenBundle; readonly recovered: boolean }
  | {
      readonly ok: false;
      readonly code: "session_expired" | "session_revoked" | "not_allowed";
      readonly why: RevokeWhy | null;
      readonly reuseDetected: boolean;
    }
  /** 채널별 회전 상한(구현 중 변경 24). Worker는 429 + Retry-After. 아무것도 쓰지 않았다 */
  | { readonly ok: false; readonly code: "rate_limited"; readonly retryAfterSec: number };

export type AllowResult = { readonly ok: true } | { readonly ok: false; readonly code: "bad_channel_id" };
export type DisallowResult = { readonly ok: true } | { readonly ok: false; readonly code: "bad_channel_id" | "is_admin" | "not_found" };
export type MySessionView = {
  readonly id: string;
  readonly kind: FlowKind;
  readonly client: string | null;
  readonly createdAt: number;
  readonly lastSeenAt: number;
};
export type AdminView = {
  readonly allowlist: readonly {
    readonly channelId: string;
    readonly channelName: string | null;
    readonly ownerChannelId: string | null;
    readonly note: string | null;
    readonly addedBy: string;
    readonly addedAt: number;
    readonly activeSessions: number;
  }[];
  readonly denied: readonly {
    readonly channelId: string;
    readonly channelName: string | null;
    readonly firstAt: number;
    readonly lastAt: number;
    readonly attempts: number;
  }[];
  readonly sessions: readonly {
    readonly id: string;
    readonly kind: FlowKind;
    readonly channelId: string;
    readonly channelName: string | null;
    readonly client: string | null;
    readonly createdAt: number;
    readonly lastSeenAt: number;
    readonly recovered: number;
  }[];
  readonly audit: readonly { readonly at: number; readonly actor: string; readonly action: AuditAction; readonly target: string | null }[];
};
