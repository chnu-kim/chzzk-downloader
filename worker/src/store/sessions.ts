// 세션·refresh 회전(docs/design/worker.md §5.2·§6, 구현 중 변경 20). 모두 동기 함수이고 시각은 now 인자다.
//
// 만료 의미: now >= expires_at이면 만료이고 유효는 now < expires_at이다. 모든 조회가 만료를 스스로 거르므로 정확성은 청소 알람에 기대지 않는다.
// 토큰 원문은 여기 들어오지 않는다: 호출자(AuthStore)가 만든 { token, hash } 쌍에서 hash만 저장한다.
import { admission, audit } from "./allowlist";
import type { Db } from "./db";
import type { CheckResult, MySessionView, Minted, RevokeWhy, RotateResult, TokenBundle, WebCheckResult } from "./types";

export const ACCESS_TTL_MS = 86_400_000;
export const REFRESH_TTL_MS = 30 * 86_400_000;
export const SESSION_MAX_MS = 60 * 86_400_000;
export const WEB_TTL_MS = 12 * 3_600_000;
export const RECOVERY_WINDOW_MS = 60_000;

export type TokenPair = { readonly access: Minted; readonly refresh: Minted };

/** 세션 절대 상한(생성 + 60일)으로 자른 시각 */
export function capAt(createdAt: number, t: number): number {
  return Math.min(t, createdAt + SESSION_MAX_MS);
}

const SESSION_COLUMNS =
  "(id, kind, channel_id, channel_name, status, access_hash, access_exp, csrf, client, created_at, last_seen_at, expires_at, revoked_at, revoked_why, recovered)";

/** 앱 로그인이 허용된 뒤 claim을 기다리는 세션. 만료는 흐름의 만료와 같다 */
export function insertUnclaimed(
  db: Db,
  s: { id: string; channelId: string; channelName: string; client: string | null; expiresAt: number },
  now: number,
): void {
  db.run(
    `INSERT INTO session ${SESSION_COLUMNS} VALUES (?, 'app', ?, ?, 'unclaimed', NULL, NULL, NULL, ?, ?, ?, ?, NULL, NULL, 0)`,
    s.id,
    s.channelId,
    s.channelName,
    s.client,
    now,
    now,
    s.expiresAt,
  );
}

/** 웹 세션(12시간 절대). 만료 시각을 돌려준다 */
export function insertWeb(db: Db, s: { id: string; channelId: string; channelName: string; cookieHash: string; csrf: string }, now: number): number {
  const expiresAt = now + WEB_TTL_MS;
  db.run(
    `INSERT INTO session ${SESSION_COLUMNS} VALUES (?, 'web', ?, ?, 'active', ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, 0)`,
    s.id,
    s.channelId,
    s.channelName,
    s.cookieHash,
    expiresAt,
    s.csrf,
    now,
    now,
    expiresAt,
  );
  return expiresAt;
}

export function revokeSession(db: Db, id: string, why: RevokeWhy, now: number): boolean {
  // access_hash는 지우지 않는다: 폐기된 토큰이 오면 invalid_token이 아니라 session_revoked로 답해야 한다
  return db.run("UPDATE session SET status = 'revoked', revoked_at = ?, revoked_why = ? WHERE id = ? AND status <> 'revoked'", now, why, id) > 0;
}

/** 자기 세션 폐기(본인 채널의 세션만) */
export function revokeMine(db: Db, channelId: string, sessionId: string, now: number): boolean {
  const changed = db.run("UPDATE session SET status = 'revoked', revoked_at = ?, revoked_why = 'user' WHERE id = ? AND channel_id = ? AND status <> 'revoked'", now, sessionId, channelId) > 0;
  if (changed) audit(db, "revoke_session", channelId, sessionId.slice(0, 6), now);
  return changed;
}

// disallowed는 403 not_allowed, 그 밖의 폐기는 401 session_revoked
function denial(why: RevokeWhy | null): { ok: false; code: "not_allowed" | "session_revoked"; why: RevokeWhy | null } {
  return { ok: false, code: why === "disallowed" ? "not_allowed" : "session_revoked", why };
}

function insertRefresh(db: Db, hash: string, sessionId: string, now: number, expiresAt: number): void {
  db.run("INSERT INTO refresh (hash, session_id, status, child_hash, issued_at, used_at, expires_at) VALUES (?, ?, 'active', NULL, ?, NULL, ?)", hash, sessionId, now, expiresAt);
}

export type ActivateResult = { ok: true; bundle: TokenBundle } | { ok: false; code: "gone" } | { ok: false; code: "not_allowed"; channelName: string };

/** claim 단계: unclaimed 세션을 active로 만들고 첫 access·refresh를 건다 */
export function activate(db: Db, sessionId: string, pair: TokenPair, admins: readonly string[], now: number): ActivateResult {
  const s = db.first<{ id: string; channel_id: string; channel_name: string | null; status: string; revoked_why: RevokeWhy | null; created_at: number; expires_at: number }>(
    "SELECT id, channel_id, channel_name, status, revoked_why, created_at, expires_at FROM session WHERE id = ? AND kind = 'app'",
    sessionId,
  );
  if (s === null || now >= s.expires_at) return { ok: false, code: "gone" };
  // claim 전에 허용에서 빠졌다: 세션은 이미 폐기됐고 앱에는 거부로 알린다
  if (s.status === "revoked" && s.revoked_why === "disallowed") return { ok: false, code: "not_allowed", channelName: s.channel_name ?? "" };
  if (s.status !== "unclaimed") return { ok: false, code: "gone" };
  const adm = admission(db, s.channel_id, admins);
  if (!adm.allowed) {
    revokeSession(db, s.id, "disallowed", now);
    return { ok: false, code: "not_allowed", channelName: s.channel_name ?? "" };
  }
  const accessExp = capAt(s.created_at, now + ACCESS_TTL_MS);
  const refreshExp = capAt(s.created_at, now + REFRESH_TTL_MS);
  db.run("UPDATE session SET status = 'active', access_hash = ?, access_exp = ?, last_seen_at = ?, expires_at = ? WHERE id = ?", pair.access.hash, accessExp, now, refreshExp, s.id);
  insertRefresh(db, pair.refresh.hash, s.id, now, refreshExp);
  return {
    ok: true,
    bundle: {
      accessToken: pair.access.token,
      accessExpiresAt: accessExp,
      refreshToken: pair.refresh.token,
      refreshExpiresAt: refreshExp,
      channelId: adm.ownerChannelId,
      channelName: s.channel_name ?? "",
      isAdmin: adm.isAdmin,
    },
  };
}

type CheckRow = {
  id: string;
  channel_id: string;
  channel_name: string | null;
  status: string;
  revoked_why: RevokeWhy | null;
  access_exp: number | null;
  expires_at: number;
  created_at: number;
  csrf: string | null;
};

type Verdict =
  | { ok: true; row: CheckRow; ownerChannelId: string; isAdmin: boolean }
  | { ok: false; code: "invalid_token" | "session_revoked" | "not_allowed"; why: RevokeWhy | null };

// check·webCheck가 함께 쓰는 판정. 성공 경로는 아무것도 쓰지 않는다(last_seen_at 갱신 없음)
function judge(db: Db, row: CheckRow | null, admins: readonly string[], now: number): Verdict {
  if (row === null) return { ok: false, code: "invalid_token", why: null };
  if (row.status === "revoked") return denial(row.revoked_why);
  if (row.status !== "active" || row.access_exp === null || now >= row.access_exp || now >= row.expires_at || now >= row.created_at + SESSION_MAX_MS) {
    return { ok: false, code: "invalid_token", why: null };
  }
  const adm = admission(db, row.channel_id, admins);
  if (!adm.allowed) {
    revokeSession(db, row.id, "disallowed", now);
    return { ok: false, code: "not_allowed", why: "disallowed" };
  }
  return { ok: true, row, ownerChannelId: adm.ownerChannelId, isAdmin: adm.isAdmin };
}

export function check(db: Db, accessHash: string, admins: readonly string[], now: number): CheckResult {
  const row = db.first<CheckRow>(
    "SELECT id, channel_id, channel_name, status, revoked_why, access_exp, expires_at, created_at, csrf FROM session WHERE access_hash = ? AND kind = 'app'",
    accessHash,
  );
  const v = judge(db, row, admins, now);
  if (!v.ok) return v;
  return {
    ok: true,
    sessionId: v.row.id,
    channelId: v.row.channel_id,
    ownerChannelId: v.ownerChannelId,
    channelName: v.row.channel_name ?? "",
    isAdmin: v.isAdmin,
    accessExpiresAt: v.row.access_exp ?? 0,
  };
}

export function webCheck(db: Db, cookieHash: string, admins: readonly string[], now: number): WebCheckResult {
  const row = db.first<CheckRow>(
    "SELECT id, channel_id, channel_name, status, revoked_why, access_exp, expires_at, created_at, csrf FROM session WHERE access_hash = ? AND kind = 'web'",
    cookieHash,
  );
  const v = judge(db, row, admins, now);
  if (!v.ok) return v;
  return {
    ok: true,
    sessionId: v.row.id,
    channelId: v.row.channel_id,
    ownerChannelId: v.ownerChannelId,
    channelName: v.row.channel_name ?? "",
    isAdmin: v.isAdmin,
    csrf: v.row.csrf ?? "",
    expiresAt: v.row.expires_at,
  };
}

type RotateRow = {
  hash: string;
  session_id: string;
  r_status: "active" | "used";
  child_hash: string | null;
  used_at: number | null;
  r_exp: number;
  kind: string;
  s_status: string;
  revoked_why: RevokeWhy | null;
  channel_id: string;
  channel_name: string | null;
  created_at: number;
  s_exp: number;
};

const EXPIRED: RotateResult = { ok: false, code: "session_expired", why: null, reuseDetected: false };

/** refresh 회전(§5.2 표). 호출자가 하나의 트랜잭션 안에서 부른다 */
export function rotate(db: Db, refreshHash: string, pair: TokenPair, admins: readonly string[], now: number): RotateResult {
  const r = db.first<RotateRow>(
    `SELECT r.hash, r.session_id, r.status AS r_status, r.child_hash, r.used_at, r.expires_at AS r_exp,
       s.kind, s.status AS s_status, s.revoked_why, s.channel_id, s.channel_name, s.created_at, s.expires_at AS s_exp
     FROM refresh r JOIN session s ON s.id = r.session_id WHERE r.hash = ?`,
    refreshHash,
  );
  if (r === null) return EXPIRED;
  if (r.s_status === "revoked") return { ...denial(r.revoked_why), reuseDetected: false };
  if (r.kind !== "app" || r.s_status !== "active") return EXPIRED;
  if (now >= r.created_at + SESSION_MAX_MS || now >= r.s_exp || now >= r.r_exp) return EXPIRED;
  const adm = admission(db, r.channel_id, admins);
  if (!adm.allowed) {
    revokeSession(db, r.session_id, "disallowed", now);
    return { ok: false, code: "not_allowed", why: "disallowed", reuseDetected: false };
  }
  const accessExp = capAt(r.created_at, now + ACCESS_TTL_MS);
  const refreshExp = capAt(r.created_at, now + REFRESH_TTL_MS);
  const bundle: TokenBundle = {
    accessToken: pair.access.token,
    accessExpiresAt: accessExp,
    refreshToken: pair.refresh.token,
    refreshExpiresAt: refreshExp,
    channelId: adm.ownerChannelId,
    channelName: r.channel_name ?? "",
    isAdmin: adm.isAdmin,
  };
  const sid = r.session_id;

  if (r.r_status === "active") {
    db.run("UPDATE refresh SET status = 'used', used_at = ?, child_hash = ? WHERE hash = ?", now, pair.refresh.hash, r.hash);
    insertRefresh(db, pair.refresh.hash, sid, now, refreshExp);
    db.run("UPDATE session SET access_hash = ?, access_exp = ?, last_seen_at = ?, expires_at = ? WHERE id = ?", pair.access.hash, accessExp, now, refreshExp, sid);
    return { ok: true, bundle, recovered: false };
  }

  // 이미 쓴 refresh: 60초 안(첫 사용부터)이고 자식이 아직 쓰이지 않았다면 응답 유실로 보고 새 자식을 다시 건다
  const child = r.child_hash === null ? null : db.first<{ status: string }>("SELECT status FROM refresh WHERE hash = ?", r.child_hash);
  if (r.used_at !== null && now - r.used_at <= RECOVERY_WINDOW_MS && child?.status === "active" && r.child_hash !== null) {
    db.run("DELETE FROM refresh WHERE hash = ?", r.child_hash);
    insertRefresh(db, pair.refresh.hash, sid, now, refreshExp);
    db.run("UPDATE refresh SET child_hash = ? WHERE hash = ?", pair.refresh.hash, r.hash);
    db.run(
      "UPDATE session SET access_hash = ?, access_exp = ?, last_seen_at = ?, expires_at = ?, recovered = recovered + 1 WHERE id = ?",
      pair.access.hash,
      accessExp,
      now,
      refreshExp,
      sid,
    );
    audit(db, "refresh_recovered", "system", sid.slice(0, 6), now);
    return { ok: true, bundle, recovered: true };
  }

  // 재사용: 세션을 폐기한다(refresh 행은 지우지 않는다. 피해자의 현재 토큰도 session_revoked로 답해야 한다)
  revokeSession(db, sid, "reuse", now);
  audit(db, "reuse_detected", "system", sid.slice(0, 6), now);
  return { ok: false, code: "session_revoked", why: "reuse", reuseDetected: true };
}

/** 로그아웃: 넘어온 access·refresh가 가리키는 세션을 폐기한다(감사 기록 없음). 모르는 해시는 조용히 넘어간다 */
export function logout(db: Db, accessHash: string | null, refreshHash: string | null, now: number): void {
  const ids = new Set<string>();
  if (accessHash !== null) {
    const a = db.first<{ id: string }>("SELECT id FROM session WHERE access_hash = ? AND kind = 'app'", accessHash);
    if (a) ids.add(a.id);
  }
  if (refreshHash !== null) {
    const f = db.first<{ session_id: string }>("SELECT session_id FROM refresh WHERE hash = ?", refreshHash);
    if (f) ids.add(f.session_id);
  }
  for (const id of ids) revokeSession(db, id, "logout", now);
}

type MineRow = { id: string; kind: "app" | "web"; client: string | null; created_at: number; last_seen_at: number };

export function mySessions(db: Db, channelId: string, now: number): MySessionView[] {
  return db
    .all<MineRow>(
      "SELECT id, kind, client, created_at, last_seen_at FROM session WHERE channel_id = ? AND status = 'active' AND expires_at > ? ORDER BY created_at DESC, id LIMIT 50",
      channelId,
      now,
    )
    .map((r) => ({ id: r.id, kind: r.kind, client: r.client, createdAt: r.created_at, lastSeenAt: r.last_seen_at }));
}
