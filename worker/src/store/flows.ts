// 로그인 흐름(docs/design/worker.md §5·§7, 구현 중 변경 19). 모두 동기 함수이고 시각은 now 인자다.
//
// 앱 흐름: started(startApp) → redirected(확인 페이지 [계속]) → exchanging(콜백 consume) → ok | denied | cancelled | failed.
// 웹 흐름은 start 때 바로 redirected이고 허용되면 그 자리에서 지운다. 흐름 하나가 만료를 앞당기지 못한다(종결해도 expires_at은 그대로 이상).
import { CHANNEL_ID, NAME_MAX, admission, clip, recordDenied, touchAllowedName } from "./allowlist";
import type { Db } from "./db";
import { activate, insertUnclaimed, insertWeb, type TokenPair } from "./sessions";
import type {
  ClaimResult,
  ConsumeResult,
  ContinueResult,
  DoneView,
  FailCode,
  FinishResult,
  FlowKind,
  FlowStatus,
  LoginFailCode,
  LoginOutcome,
  LoginPageView,
  Minted,
} from "./types";

export const FLOW_TTL_MS = 600_000;
export const FLOW_DONE_TTL_MS = 120_000;
export const FLOW_CAP = 32;
export const POLL_INTERVAL_MS = 2_000;
export const POLL_MIN_INTERVAL_MS = 1_500;
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

/** 폴링 게이트 키: loginId + pollVerifier. 틀린 secret의 폴링은 다른 키라 올바른 폴링을 굶기지 못한다(구현 중 변경 28) */
export const pollGateKey = (loginId: string, pollVerifier: string): string => `${loginId}:${pollVerifier}`;

/** 폴링 간격 게이트. false면 너무 이르다(SQL 없이 429). 거절할 때는 기록을 갱신하지 않는다. 마지막 기록보다 이른 now(동시 요청)도 너무 이르다 */
export function pollGate(map: Map<string, number>, key: string, now: number): boolean {
  const last = map.get(key);
  if (last !== undefined && now - last < POLL_MIN_INTERVAL_MS) return false;
  if (map.size >= MEMORY_KEYS_MAX) {
    for (const [k, t] of map) if (now - t >= POLL_MIN_INTERVAL_MS) map.delete(k);
    evictOldest(map, MEMORY_KEYS_MAX);
  }
  map.delete(key);
  map.set(key, now);
  return true;
}

/** 만료되지 않은 흐름 수(상한 FLOW_CAP). 인덱스 범위 조회라 읽기는 상한 이하의 행이다 */
export function liveFlowCount(db: Db, now: number): number {
  return db.first<{ n: number }>("SELECT count(*) AS n FROM flow WHERE expires_at > ?", now)?.n ?? 0;
}

export function insertAppFlow(db: Db, f: { id: string; handleHash: string; pollVerifier: string; userCode: string; client: string }, now: number): void {
  db.run(
    "INSERT INTO flow (id, kind, handle_hash, state_hash, binder_hash, poll_verifier, user_code, client, status, session_id, channel_name, channel_id, fail_code, created_at, expires_at) VALUES (?, 'app', ?, NULL, NULL, ?, ?, ?, 'started', NULL, NULL, NULL, NULL, ?, ?)",
    f.id,
    f.handleHash,
    f.pollVerifier,
    f.userCode,
    f.client,
    now,
    now + FLOW_TTL_MS,
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

/** 확인 페이지에 보일 코드와 상태 */
export function loginPage(db: Db, handleHash: string, now: number): LoginPageView | null {
  const r = db.first<{ user_code: string | null; status: FlowStatus; expires_at: number }>(
    "SELECT user_code, status, expires_at FROM flow WHERE handle_hash = ? AND kind = 'app' AND expires_at > ?",
    handleHash,
    now,
  );
  return r === null ? null : { userCode: r.user_code ?? "", status: r.status, expiresAt: r.expires_at };
}

/** [계속]: started → redirected. state·binder는 호출자가 만들어 넘기고 해시만 저장한다. 만료 시각은 바꾸지 않는다 */
export function continueApp(db: Db, handleHash: string, s: { state: string; stateHash: string; binder: string; binderHash: string }, now: number): ContinueResult {
  const row = db.first<{ id: string; status: FlowStatus }>("SELECT id, status FROM flow WHERE handle_hash = ? AND kind = 'app' AND expires_at > ?", handleHash, now);
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

// 종결 문장 하나. 만료는 앞당기지 않는다(doneExp = max(기존, now + 2분))
function settle(db: Db, id: string, status: "cancelled" | "failed", failCode: LoginFailCode | null, doneExp: number): void {
  db.run("UPDATE flow SET status = ?, fail_code = ?, expires_at = ? WHERE id = ?", status, failCode, doneExp, id);
}

/** 콜백 처리 결과를 반영한다(exchanging인 흐름만). issued는 허용될 때 쓸 새 세션 id·쿠키·csrf */
export function finish(
  db: Db,
  flowId: string,
  outcome: LoginOutcome,
  issued: { sessionId: string; cookie: Minted; csrf: string },
  admins: readonly string[],
  now: number,
): FinishResult {
  const row = db.first<{ id: string; kind: FlowKind; client: string | null; expires_at: number }>(
    "SELECT id, kind, client, expires_at FROM flow WHERE id = ? AND status = 'exchanging' AND expires_at > ?",
    flowId,
    now,
  );
  if (row === null) return { type: "gone" };
  const doneExp = Math.max(row.expires_at, now + FLOW_DONE_TTL_MS);

  if (outcome.type === "cancelled") {
    settle(db, row.id, "cancelled", null, doneExp);
    return { type: "cancelled" };
  }
  if (outcome.type === "failed") {
    settle(db, row.id, "failed", LOGIN_FAIL_CODES.includes(outcome.code) ? outcome.code : "user", doneExp);
    return { type: "failed" };
  }
  if (!CHANNEL_ID.test(outcome.channelId)) {
    settle(db, row.id, "failed", "user_format", doneExp);
    return { type: "failed" };
  }

  const name = clip(outcome.channelName, NAME_MAX);
  const adm = admission(db, outcome.channelId, admins);
  if (!adm.allowed) {
    recordDenied(db, outcome.channelId, name, now);
    db.run("UPDATE flow SET status = 'denied', channel_name = ?, channel_id = ?, expires_at = ? WHERE id = ?", name, outcome.channelId, doneExp, row.id);
    return { type: "denied" };
  }
  touchAllowedName(db, outcome.channelId, name);
  if (row.kind === "app") {
    insertUnclaimed(db, { id: issued.sessionId, channelId: outcome.channelId, channelName: name, client: row.client, expiresAt: doneExp }, now);
    db.run("UPDATE flow SET status = 'ok', session_id = ?, expires_at = ? WHERE id = ?", issued.sessionId, doneExp, row.id);
    return { type: "ok" };
  }
  const expiresAt = insertWeb(db, { id: issued.sessionId, channelId: outcome.channelId, channelName: name, cookieHash: issued.cookie.hash, csrf: issued.csrf }, now);
  db.run("DELETE FROM flow WHERE id = ?", row.id);
  return { type: "web", cookieToken: issued.cookie.token, csrf: issued.csrf, expiresAt };
}

/** 완료 페이지: binder 쿠키로 자기 흐름의 결과를 본다 */
export function doneView(db: Db, binderHash: string, now: number): DoneView | null {
  const r = db.first<{ kind: FlowKind; status: DoneView["status"]; user_code: string | null; channel_name: string | null; channel_id: string | null }>(
    "SELECT kind, status, user_code, channel_name, channel_id FROM flow WHERE binder_hash = ? AND expires_at > ? AND status IN ('ok','denied','cancelled','failed') LIMIT 1",
    binderHash,
    now,
  );
  return r === null ? null : { kind: r.kind, status: r.status, userCode: r.user_code, channelName: r.channel_name, channelId: r.channel_id };
}

/**
 * 앱 폴링. pollVerifier가 맞는 흐름만 본다. ok면 세션을 활성화하고, 흐름은 지우지 않고 verifier·세션 연결만 비운다:
 * 다시 수령은 not_found이고, 행은 만료까지 남아 완료 페이지가 binder로 확인 코드를 다시 보인다(구현 중 변경 23·27 (가)).
 */
export function claim(
  db: Db,
  loginId: string,
  pollVerifier: string,
  pair: TokenPair,
  admins: readonly string[],
  now: number,
): Exclude<ClaimResult, { status: "too_soon" }> {
  const row = db.first<{ status: FlowStatus; poll_verifier: string | null; session_id: string | null; channel_name: string | null; fail_code: string | null }>(
    "SELECT status, poll_verifier, session_id, channel_name, fail_code FROM flow WHERE id = ? AND kind = 'app' AND expires_at > ?",
    loginId,
    now,
  );
  if (row === null || row.poll_verifier !== pollVerifier) return { status: "not_found" };
  switch (row.status) {
    case "started":
    case "redirected":
    case "exchanging":
      return { status: "pending" };
    case "cancelled":
      return { status: "cancelled" };
    case "failed":
      return { status: "failed", code: (row.fail_code ?? "user") as FailCode };
    case "denied":
      return { status: "denied", channelName: row.channel_name ?? "" };
    case "ok": {
      const a = row.session_id === null ? ({ ok: false, code: "gone" } as const) : activate(db, row.session_id, pair, admins, now);
      if (a.ok) {
        // 수령한 흐름은 완료 페이지 재표시(2분)만 남기고 상한 32 슬롯을 일찍 비운다(구현 중 변경 28). 앞당기기만 한다
        db.run("UPDATE flow SET poll_verifier = NULL, session_id = NULL, expires_at = min(expires_at, ?) WHERE id = ?", now + FLOW_DONE_TTL_MS, loginId);
        return { status: "ok", bundle: a.bundle };
      }
      db.run("DELETE FROM flow WHERE id = ?", loginId);
      if (a.code === "not_allowed") return { status: "denied", channelName: a.channelName };
      return { status: "failed", code: "session" };
    }
  }
}
