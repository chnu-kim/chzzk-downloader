// 로그인 흐름(docs/design/worker.md §5·§7, 구현 중 변경 19). 모두 동기 함수이고 시각은 now 인자다.
//
// 앱 흐름: started(startApp) → redirected(확인 페이지 [계속]) → exchanging(콜백 consume) → ok | denied | cancelled | failed.
// 웹 흐름은 start 때 바로 redirected이고 허용되면 그 자리에서 지운다. 흐름 하나가 만료를 앞당기지 못한다(종결해도 expires_at은 그대로 이상).
// 앱 흐름은 종결 때 1회용 grant(해시만 저장, 2분)를 받고 redeem이 grant + 앱 비밀(loginVerifier)로 결과를 한 번 건넨다(구현 중 변경 88).
// 예외 하나: 앱이 수령(redeem ok)한 흐름은 now + 2분으로 앞당긴다(허용 채널의 로그인이 끝난 뒤라 슬롯 순환과 무관, 구현 중 변경 28 (마)).
import { CHANNEL_ID, NAME_MAX, admission, clip, recordDenied, touchAllowedName } from "./allowlist";
import type { Db } from "./db";
import { activate, insertUnclaimed, insertWeb, type TokenPair } from "./sessions";
import type {
  ConsumeResult,
  ContinueResult,
  DoneView,
  FailCode,
  FinishSettled,
  FlowKind,
  FlowStatus,
  LoginFailCode,
  LoginOutcome,
  LoginPageView,
  Minted,
  RedeemResult,
} from "./types";

export const FLOW_TTL_MS = 600_000;
export const FLOW_DONE_TTL_MS = 120_000;
export const FLOW_CAP = 32;
export const START_WINDOW_MS = 600_000;
export const MEMORY_KEYS_MAX = 4_096;
export const CLIENT_MAX = 64;

const LOGIN_FAIL_CODES: readonly string[] = ["token", "user", "timeout", "user_format"];

export type StartWindow = { start: number; count: number };

// 가장 오래 삽입된 항목부터 크기가 max 미만이 될 때까지 지운다(Map은 삽입 순서를 지킨다)
function evictOldest<V>(map: Map<string, V>, max: number): void {
  for (const k of map.keys()) {
    if (map.size < max) break;
    map.delete(k);
  }
}

export type ThrottleResult = { ok: true } | { ok: false; retryAfterSec: number };

/**
 * 고정 창 스로틀(IP별 start, 채널별 rotate). 순수 함수: 한도는 인자, 맵은 호출자(DO 메모리) 소유. 거절이면 남은 초를 돌려준다.
 * now는 Worker 요청마다 정해져 RPC 도착 순서와 어긋날 수 있다(동시 요청). 창보다 이른 now는 새 창이 아니라 지금 창으로 센다:
 * 창은 now - start가 창 길이 이상일 때만 바뀐다(worker.md 구현 중 변경 19 (가))
 */
export function throttle(map: Map<string, StartWindow>, key: string, limit: number, now: number): ThrottleResult {
  let w = map.get(key);
  if (w !== undefined && now - w.start >= START_WINDOW_MS) {
    map.delete(key);
    w = undefined;
  }
  if (w === undefined) {
    if (map.size >= MEMORY_KEYS_MAX) {
      for (const [k, v] of map) if (now - v.start >= START_WINDOW_MS) map.delete(k);
      evictOldest(map, MEMORY_KEYS_MAX);
    }
    w = { start: now, count: 0 };
    map.set(key, w);
  }
  if (w.count >= limit) {
    const left = Math.ceil((w.start + START_WINDOW_MS - now) / 1000);
    return { ok: false, retryAfterSec: Math.min(START_WINDOW_MS / 1000, Math.max(1, left)) };
  }
  w.count++;
  return { ok: true };
}

/** 만료되지 않은 흐름 수(상한 FLOW_CAP). 인덱스 범위 조회라 읽기는 상한 이하의 행이다 */
export function liveFlowCount(db: Db, now: number): number {
  return db.first<{ n: number }>("SELECT count(*) AS n FROM flow WHERE expires_at > ?", now)?.n ?? 0;
}

export function insertAppFlow(db: Db, f: { id: string; handleHash: string; verifier: string; port: number; client: string }, now: number): void {
  db.run(
    "INSERT INTO flow (id, kind, handle_hash, state_hash, binder_hash, poll_verifier, user_code, client, status, session_id, channel_name, channel_id, fail_code, created_at, expires_at, port, grant_hash, grant_exp) VALUES (?, 'app', ?, NULL, NULL, ?, NULL, ?, 'started', NULL, NULL, NULL, NULL, ?, ?, ?, NULL, NULL)",
    f.id,
    f.handleHash,
    f.verifier,
    f.client,
    now,
    now + FLOW_TTL_MS,
    f.port,
  );
}

export function insertWebFlow(db: Db, f: { id: string; stateHash: string; binderHash: string }, now: number): void {
  db.run(
    "INSERT INTO flow (id, kind, handle_hash, state_hash, binder_hash, poll_verifier, user_code, client, status, session_id, channel_name, channel_id, fail_code, created_at, expires_at) VALUES (?, 'web', NULL, ?, ?, NULL, NULL, NULL, 'redirected', NULL, NULL, NULL, NULL, ?, ?)",
    f.id,
    f.stateHash,
    f.binderHash,
    now,
    now + FLOW_TTL_MS,
  );
}

/** 확인 페이지의 흐름 상태. port가 없는 옛 흐름은 없는 것으로 본다 */
export function loginPage(db: Db, handleHash: string, now: number): LoginPageView | null {
  const r = db.first<{ status: FlowStatus; expires_at: number }>(
    "SELECT status, expires_at FROM flow WHERE handle_hash = ? AND kind = 'app' AND port IS NOT NULL AND expires_at > ?",
    handleHash,
    now,
  );
  return r === null ? null : { status: r.status, expiresAt: r.expires_at };
}

/** [계속]: started → redirected. state·binder는 호출자가 만들어 넘기고 해시만 저장한다. 만료 시각은 바꾸지 않는다 */
export function continueApp(db: Db, handleHash: string, s: { state: string; stateHash: string; binder: string; binderHash: string }, now: number): ContinueResult {
  const row = db.first<{ id: string; status: FlowStatus }>("SELECT id, status FROM flow WHERE handle_hash = ? AND kind = 'app' AND port IS NOT NULL AND expires_at > ?", handleHash, now);
  if (row === null) return { ok: false, code: "not_found" };
  if (row.status !== "started") return { ok: false, code: "already_used" };
  db.run("UPDATE flow SET status = 'redirected', state_hash = ?, binder_hash = ? WHERE id = ?", s.stateHash, s.binderHash, row.id);
  return { ok: true, state: s.state, binder: s.binder };
}

/** 콜백의 state를 한 번만 쓴다. binder(브라우저 쿠키)가 맞아야 exchanging으로 넘어간다 */
export function consume(db: Db, stateHash: string, binderHash: string | null, now: number): ConsumeResult {
  const row = db.first<{ id: string; kind: FlowKind; binder_hash: string | null }>(
    "SELECT id, kind, binder_hash FROM flow WHERE state_hash = ? AND status = 'redirected' AND expires_at > ?",
    stateHash,
    now,
  );
  if (row === null) return { ok: false, code: "not_found" };
  if (binderHash === null || row.binder_hash !== binderHash) {
    db.run("UPDATE flow SET status = 'failed', fail_code = 'binder', state_hash = NULL, expires_at = max(expires_at, ?) WHERE id = ?", now + FLOW_DONE_TTL_MS, row.id);
    return { ok: false, code: "binder" };
  }
  db.run("UPDATE flow SET status = 'exchanging', state_hash = NULL WHERE id = ?", row.id);
  return { ok: true, flowId: row.id, kind: row.kind };
}

type Grant = { hash: string; exp: number };

// 종결 문장 하나. 만료는 앞당기지 않는다(doneExp = max(기존, now + 2분)). grant는 앱 흐름만 받는다
function settle(db: Db, id: string, status: "cancelled" | "failed", failCode: LoginFailCode | null, doneExp: number, grant: Grant | null): void {
  db.run("UPDATE flow SET status = ?, fail_code = ?, expires_at = ?, grant_hash = ?, grant_exp = ? WHERE id = ?", status, failCode, doneExp, grant?.hash ?? null, grant?.exp ?? null, id);
}

/**
 * 콜백 처리 결과를 반영한다(exchanging인 흐름만). issued는 허용될 때 쓸 새 세션 id·쿠키·csrf와 앱 종결 때 쓸 grant.
 * 앱 종결은 loopback 결과이고 verifier(저장된 loginVerifier)를 싣는다: state 계산은 비동기라 AuthStore가 트랜잭션 뒤에 한다
 */
export function finish(
  db: Db,
  flowId: string,
  outcome: LoginOutcome,
  issued: { sessionId: string; cookie: Minted; csrf: string; grant: Minted },
  admins: readonly string[],
  now: number,
): FinishSettled {
  const row = db.first<{ id: string; kind: FlowKind; client: string | null; port: number | null; poll_verifier: string | null; expires_at: number }>(
    "SELECT id, kind, client, port, poll_verifier, expires_at FROM flow WHERE id = ? AND status = 'exchanging' AND expires_at > ?",
    flowId,
    now,
  );
  if (row === null) return { type: "gone" };
  const doneExp = Math.max(row.expires_at, now + FLOW_DONE_TTL_MS);
  const isApp = row.kind === "app";

  // 배포 전에 시작한 옛 앱 흐름(port 없음)은 루프백으로 보낼 곳이 없다: outcome과 상관없이 닫는다
  if (isApp && (row.port === null || row.poll_verifier === null)) {
    settle(db, row.id, "failed", "user", doneExp, null);
    return { type: "failed" };
  }
  const g: Grant | null = isApp ? { hash: issued.grant.hash, exp: now + FLOW_DONE_TTL_MS } : null;
  const app = (result: "ok" | "denied" | "cancelled" | "failed"): FinishSettled => ({
    type: "loopback",
    result,
    port: row.port as number,
    grant: issued.grant.token,
    verifier: row.poll_verifier as string,
  });

  if (outcome.type === "cancelled") {
    settle(db, row.id, "cancelled", null, doneExp, g);
    return isApp ? app("cancelled") : { type: "cancelled" };
  }
  if (outcome.type === "failed") {
    settle(db, row.id, "failed", LOGIN_FAIL_CODES.includes(outcome.code) ? outcome.code : "user", doneExp, g);
    return isApp ? app("failed") : { type: "failed" };
  }
  if (!CHANNEL_ID.test(outcome.channelId)) {
    settle(db, row.id, "failed", "user_format", doneExp, g);
    return isApp ? app("failed") : { type: "failed" };
  }

  const name = clip(outcome.channelName, NAME_MAX);
  const adm = admission(db, outcome.channelId, admins);
  if (!adm.allowed) {
    recordDenied(db, outcome.channelId, name, now);
    db.run(
      "UPDATE flow SET status = 'denied', channel_name = ?, channel_id = ?, expires_at = ?, grant_hash = ?, grant_exp = ? WHERE id = ?",
      name,
      outcome.channelId,
      doneExp,
      g?.hash ?? null,
      g?.exp ?? null,
      row.id,
    );
    return isApp ? app("denied") : { type: "denied" };
  }
  touchAllowedName(db, outcome.channelId, name);
  if (isApp) {
    insertUnclaimed(db, { id: issued.sessionId, channelId: outcome.channelId, channelName: name, client: row.client, expiresAt: doneExp }, now);
    db.run("UPDATE flow SET status = 'ok', session_id = ?, expires_at = ?, grant_hash = ?, grant_exp = ? WHERE id = ?", issued.sessionId, doneExp, g?.hash ?? null, g?.exp ?? null, row.id);
    return app("ok");
  }
  const expiresAt = insertWeb(db, { id: issued.sessionId, channelId: outcome.channelId, channelName: name, cookieHash: issued.cookie.hash, csrf: issued.csrf }, now);
  db.run("DELETE FROM flow WHERE id = ?", row.id);
  return { type: "web", cookieToken: issued.cookie.token, csrf: issued.csrf, expiresAt };
}

/** 완료 페이지: binder 쿠키로 자기 흐름의 결과를 본다 */
export function doneView(db: Db, binderHash: string, now: number): DoneView | null {
  const r = db.first<{ kind: FlowKind; status: DoneView["status"]; channel_name: string | null; channel_id: string | null }>(
    "SELECT kind, status, channel_name, channel_id FROM flow WHERE binder_hash = ? AND expires_at > ? AND status IN ('ok','denied','cancelled','failed') LIMIT 1",
    binderHash,
    now,
  );
  return r === null ? null : { kind: r.kind, status: r.status, channelName: r.channel_name, channelId: r.channel_id };
}

/**
 * 앱 수령. grant 해시가 맞고 만료 전이며 loginVerifier가 맞는 흐름만 본다. 모르는 grant·만료·이미 수령·verifier 불일치는 모두 not_found이고
 * 불일치는 아무것도 쓰지 않는다(grant를 태우지 않는다). ok면 세션을 활성화하고 grant·verifier·세션 연결을 비운다(다시 수령은 not_found).
 * denied·cancelled·failed는 grant만 비운다.
 */
export function redeem(db: Db, grantHash: string, verifier: string, pair: TokenPair, admins: readonly string[], now: number): RedeemResult {
  const row = db.first<{ id: string; status: FlowStatus; poll_verifier: string | null; session_id: string | null; channel_name: string | null; fail_code: string | null }>(
    "SELECT id, status, poll_verifier, session_id, channel_name, fail_code FROM flow WHERE grant_hash = ? AND kind = 'app' AND grant_exp > ?",
    grantHash,
    now,
  );
  if (row === null || row.poll_verifier !== verifier) return { status: "not_found" };
  switch (row.status) {
    case "cancelled":
      db.run("UPDATE flow SET grant_hash = NULL WHERE id = ?", row.id);
      return { status: "cancelled" };
    case "failed":
      db.run("UPDATE flow SET grant_hash = NULL WHERE id = ?", row.id);
      return { status: "failed", code: (row.fail_code ?? "user") as FailCode };
    case "denied":
      db.run("UPDATE flow SET grant_hash = NULL WHERE id = ?", row.id);
      return { status: "denied", channelName: row.channel_name ?? "" };
    case "ok": {
      const a = row.session_id === null ? ({ ok: false, code: "gone" } as const) : activate(db, row.session_id, pair, admins, now);
      if (a.ok) {
        // 수령한 흐름은 완료 페이지 재표시(2분)만 남기고 상한 32 슬롯을 일찍 비운다(구현 중 변경 28). 앞당기기만 한다
        db.run("UPDATE flow SET grant_hash = NULL, poll_verifier = NULL, session_id = NULL, expires_at = min(expires_at, ?) WHERE id = ?", now + FLOW_DONE_TTL_MS, row.id);
        return { status: "ok", bundle: a.bundle };
      }
      db.run("DELETE FROM flow WHERE id = ?", row.id);
      if (a.code === "not_allowed") return { status: "denied", channelName: a.channelName };
      return { status: "failed", code: "session" };
    }
    default:
      // started·redirected·exchanging: grant는 종결 때만 생기므로 여기 올 수 없다
      return { status: "not_found" };
  }
}
