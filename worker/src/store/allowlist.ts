// 허용목록·거부 기록·감사 로그(docs/design/worker.md §5·§8, 구현 중 변경 20·22). 모두 동기 함수이고 시각은 now 인자다.
//
// 허용 판정은 요청마다 한다: 관리자는 Worker가 넘긴 admins(secret)로, 그 밖은 allowlist 행으로. 부트스트랩(admins가 빔)에서는
// 행이 있어도 아무도 허용하지 않는다. 공격자가 정하는 문자열(채널 이름·메모)은 clip을 거쳐 저장한다.
import { ADMIN_LIST_MAX, AUTO_ALLOW_CAP_MAX, AUTO_ALLOW_DEFAULT_CAP, CAP_FORMAT } from "../core/auto-allow";
import { sanitizeName } from "../core/chzzk";
import type { Db } from "./db";
import type { AdminView, AllowResult, AuditAction, DenyReason, DisallowResult, SetAutoAllowCapResult } from "./types";

export const CHANNEL_ID = /^[0-9a-f]{32}$/;
export const NAME_MAX = 128;
export const NOTE_MAX = 64;
export const DENIED_CAP = 200;
export const DENIED_REFRESH_MS = 3_600_000;
export const DENIED_KEEP_MS = 30 * 86_400_000;
export const AUDIT_CAP = 500;
export { ADMIN_LIST_MAX, AUTO_ALLOW_CAP_MAX, AUTO_ALLOW_DEFAULT_CAP };
/** 한국 시간(UTC+9, 서머타임 없음)으로 하루를 가른다(§2.2 A1) */
const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;

/** denied 상한: 최근 DENIED_CAP행만 남긴다(INSERT 때와 청소 때 같은 문장) */
export const DENIED_CAP_SQL = `DELETE FROM denied WHERE channel_id IN (SELECT channel_id FROM denied ORDER BY last_at DESC, channel_id DESC LIMIT -1 OFFSET ${DENIED_CAP})`;

/** 공격자 제어 문자열: 제어·bidi 제거(core sanitizeName) 뒤 코드 포인트 max자 */
export function clip(v: unknown, max: number): string {
  return Array.from(sanitizeName(v)).slice(0, max).join("");
}

export type Admission = { readonly allowed: boolean; readonly isAdmin: boolean; readonly ownerChannelId: string };

export function admission(db: Db, channelId: string, admins: readonly string[]): Admission {
  const isAdmin = admins.includes(channelId);
  const row = db.first<{ owner: string | null }>("SELECT owner_channel_id AS owner FROM allowlist WHERE channel_id = ?", channelId);
  return { allowed: admins.length > 0 && (isAdmin || row !== null), isAdmin, ownerChannelId: row?.owner ?? channelId };
}

/** 로그인 때 본 이름으로 갱신한다(같으면 쓰지 않는다) */
export function touchAllowedName(db: Db, channelId: string, name: string): void {
  db.run("UPDATE allowlist SET channel_name = ? WHERE channel_id = ? AND channel_name IS NOT ?", name, channelId, name);
}

/** 거부 기록. 같은 채널은 1시간에 한 번만 센다(쓰기 절약의 대가로 근사값), 표는 DENIED_CAP행 */
export function recordDenied(db: Db, channelId: string, name: string, now: number): void {
  const row = db.first<{ last_at: number }>("SELECT last_at FROM denied WHERE channel_id = ?", channelId);
  if (row === null) {
    db.run("INSERT INTO denied (channel_id, channel_name, first_at, last_at, attempts) VALUES (?, ?, ?, ?, 1)", channelId, name, now, now);
    db.run(DENIED_CAP_SQL);
  } else if (now - row.last_at > DENIED_REFRESH_MS) {
    db.run("UPDATE denied SET channel_name = ?, last_at = ?, attempts = attempts + 1 WHERE channel_id = ?", name, now, channelId);
  }
}

export function audit(db: Db, action: AuditAction, actor: string, target: string | null, now: number): void {
  db.run("INSERT INTO audit (at, actor, action, target) VALUES (?, ?, ?, ?)", now, actor, action, target);
}

/** 허용(upsert). 새 행의 이름은 거부 기록, 없으면 차단 행의 것이다(둘 다 이 함수 끝에서 지우므로 먼저 읽는다). 빈 메모는 있던 메모를 그대로 둔다(관리 화면 [추가]를 메모 없이 다시 눌러도 지워지지 않는다, worker.md 구현 중 변경 38 (카)) */
export function allow(db: Db, channelId: string, note: string, by: string, now: number): AllowResult {
  if (!CHANNEL_ID.test(channelId)) return { ok: false, code: "bad_channel_id" };
  const n = clip(note, NOTE_MAX);
  db.run(
    "INSERT INTO allowlist (channel_id, channel_name, owner_channel_id, note, added_by, added_at) VALUES (?, COALESCE((SELECT channel_name FROM denied WHERE channel_id = ?), (SELECT channel_name FROM blocked WHERE channel_id = ?)), NULL, ?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET note = COALESCE(excluded.note, allowlist.note)",
    channelId,
    channelId,
    channelId,
    n === "" ? null : n,
    by,
    now,
  );
  db.run("DELETE FROM denied WHERE channel_id = ?", channelId);
  // 허가는 차단을 함께 푼다(별도 풀기 동작은 없다, allowlist-open.md §3.3 (다))
  db.run("DELETE FROM blocked WHERE channel_id = ?", channelId);
  audit(db, "allow", by, channelId, now);
  return { ok: true };
}

/**
 * 거부 기록에서 [허용]. 기록이 없으면 false. 이미 허용목록에 있는 채널(부트스트랩 때 거부된 경우)은 행을 그대로 두고
 * 거부 기록만 지운다(행의 이름·추가한 사람·시각을 바꾸지 않는다)
 */
export function allowDenied(db: Db, channelId: string, by: string, now: number): boolean {
  if (db.first("SELECT 1 AS x FROM denied WHERE channel_id = ?", channelId) === null) return false;
  if (db.first("SELECT 1 AS x FROM allowlist WHERE channel_id = ?", channelId) === null) {
    allow(db, channelId, "", by, now);
    return true;
  }
  db.run("DELETE FROM denied WHERE channel_id = ?", channelId);
  db.run("DELETE FROM blocked WHERE channel_id = ?", channelId);
  audit(db, "allow", by, channelId, now);
  return true;
}

/**
 * 차단(예전의 "허가 빼기", allowlist-open.md §3.3): 허가 행이 있으면 지우고 그 채널의 세션 전부 revoked(disallowed) + 위임·초대 삭제,
 * 그리고 blocked 행을 쓴다(자동 허가만 막는다). 허가 행이 없어도 차단 행만 쓴다(B3). 관리자는 행이 있어도 409(is_admin)이고 아무것도 쓰지 않는다.
 * 허가 행도 차단 행도 없는 쪽이 아니라 "이미 차단된 채널(허가 없음)"이 not_found이고 아무것도 쓰지 않는다(일어나지 않은 차단을 감사에 남기지 않는다).
 * 세션은 허용(또는 관리자)일 때만 생기고 매 요청 허용을 다시 보므로, 행이 없는 채널의 세션은 이미 쓸 수 없다
 */
export function disallow(db: Db, channelId: string, by: string, admins: readonly string[], now: number): DisallowResult {
  if (!CHANNEL_ID.test(channelId)) return { ok: false, code: "bad_channel_id" };
  if (admins.includes(channelId)) return { ok: false, code: "is_admin" };
  const row = db.first<{ channel_name: string | null }>("SELECT channel_name FROM allowlist WHERE channel_id = ?", channelId);
  if (row === null && db.first("SELECT 1 AS x FROM blocked WHERE channel_id = ?", channelId) !== null) return { ok: false, code: "not_found" };
  // 이름은 지운 허가 행의 것, 없으면 거부 기록의 것
  const name = row !== null ? row.channel_name : (db.first<{ channel_name: string | null }>("SELECT channel_name FROM denied WHERE channel_id = ?", channelId)?.channel_name ?? null);
  if (row !== null) {
    db.run("DELETE FROM allowlist WHERE channel_id = ?", channelId);
    db.run("UPDATE session SET status = 'revoked', revoked_at = ?, revoked_why = 'disallowed' WHERE channel_id = ? AND status <> 'revoked'", now, channelId);
    // 위임·초대는 로그인 ID(허가 행의 키)로 지운다. 판정용 owner_channel_id로는 지우지 않는다(delegation.md §8.6)
    db.run("DELETE FROM delegation WHERE owner_login_channel_id = ? OR editor_channel_id = ?", channelId, channelId);
    db.run("DELETE FROM invite WHERE owner_login_channel_id = ? OR claimed_channel_id = ?", channelId, channelId);
  }
  db.run(
    "INSERT INTO blocked (channel_id, channel_name, blocked_by, blocked_at) VALUES (?, ?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET channel_name = excluded.channel_name, blocked_by = excluded.blocked_by, blocked_at = excluded.blocked_at",
    channelId,
    name,
    by,
    now,
  );
  audit(db, "disallow", by, channelId, now);
  return { ok: true };
}

// ---- 자동 허가(docs/design/features/allowlist-open.md, worker.md 구현 중 변경 109) ----

/** 한국 시간 날짜 번호(1970-01-01 KST부터 센 날). 서머타임이 없어 +9h 고정 오프셋이다 */
export function kstDay(now: number): number {
  return Math.floor((now + KST_OFFSET_MS) / DAY_MS);
}

function metaGet(db: Db, k: string): string | null {
  return db.first<{ v: string }>("SELECT v FROM meta WHERE k = ?", k)?.v ?? null;
}

function metaSet(db: Db, k: string, v: string): void {
  db.run("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, v);
}

/** 하루 상한. 값이 없으면 기본 20, 형식이나 범위가 틀리면 0(fail closed)이고 invalid를 켠다(AuthStore가 경고 로그를 남긴다) */
export function autoAllowCap(db: Db): { readonly cap: number; readonly invalid: boolean } {
  const v = metaGet(db, "auto_allow_cap");
  if (v === null) return { cap: AUTO_ALLOW_DEFAULT_CAP, invalid: false };
  if (!CAP_FORMAT.test(v) || Number(v) > AUTO_ALLOW_CAP_MAX) return { cap: 0, invalid: true };
  return { cap: Number(v), invalid: false };
}

// 오늘의 날 키와 센 수. 저장된 날 키보다 작은 키는 같은 날로 본다(시계 역행에도 경계에서 상한을 두 번 쓰지 않는다, §3.2).
// 센 수가 형식이 틀리면 cap으로 본다(그날은 더 받지 않는다, fail closed)
function todayCount(db: Db, now: number, cap: number): { readonly day: number; readonly stored: number | null; readonly count: number } {
  const dayRaw = metaGet(db, "auto_allow_day");
  const stored = dayRaw !== null && /^(0|[1-9][0-9]{0,9})$/.test(dayRaw) ? Number(dayRaw) : null;
  const day = Math.max(stored ?? 0, kstDay(now));
  if (stored === null || day !== stored) return { day, stored, count: 0 };
  const c = metaGet(db, "auto_allow_count");
  return { day, stored, count: c !== null && /^(0|[1-9][0-9]{0,9})$/.test(c) ? Number(c) : cap };
}

/** 관리 화면용: 상한과 오늘 센 수 */
export function autoAllowState(db: Db, now: number): { cap: number; today: number; capBy: string | null; capAt: number | null } {
  const { cap } = autoAllowCap(db);
  const by = metaGet(db, "auto_allow_cap_by");
  const at = metaGet(db, "auto_allow_cap_at");
  return {
    cap,
    today: todayCount(db, now, cap).count,
    capBy: by !== null && CHANNEL_ID.test(by) ? by : null,
    capAt: at !== null && /^(0|[1-9][0-9]{0,15})$/.test(at) ? Number(at) : null,
  };
}

export type AutoAdmit =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: DenyReason | null; readonly capInvalid: boolean };

/**
 * 자동 허가 판정과 쓰기(finish 한 트랜잭션 안, §3.1). 순서: 부트스트랩 → 차단 → 상한 0 → 오늘 센 수 ≥ 상한 → 허가.
 * 허가면 allowlist 행(added_by='auto')을 넣고 오늘 센 수를 올린다. 감사 행은 쓰지 않는다(§3.8).
 * 청구 초대 완성과 거부 기록 삭제는 호출자(flows.ts)가 한다: 순서(tracedClaims → 허가 → completeClaimed → denied 삭제)를 delegation이 정하고,
 * 이 파일은 delegation을 가져오지 않는다(순환 방지). 호출자는 이미 허가된 채널·관리자에게는 부르지 않는다
 */
export function autoAdmit(db: Db, channelId: string, name: string, admins: readonly string[], now: number): AutoAdmit {
  if (admins.length === 0) return { ok: false, reason: null, capInvalid: false };
  if (db.first("SELECT 1 AS x FROM blocked WHERE channel_id = ?", channelId) !== null) return { ok: false, reason: "blocked", capInvalid: false };
  const { cap, invalid } = autoAllowCap(db);
  if (cap === 0) return { ok: false, reason: null, capInvalid: invalid };
  const t = todayCount(db, now, cap);
  if (t.count >= cap) return { ok: false, reason: "daily_limit", capInvalid: false };
  db.run("INSERT INTO allowlist (channel_id, channel_name, owner_channel_id, note, added_by, added_at) VALUES (?, ?, NULL, NULL, 'auto', ?)", channelId, name, now);
  metaSet(db, "auto_allow_day", String(t.day));
  metaSet(db, "auto_allow_count", String(t.count + 1));
  return { ok: true };
}

/** 하루 상한 저장(관리자). 범위 0~AUTO_ALLOW_CAP_MAX 정수, by는 채널 ID 형식이어야 한다. 감사 표 대신 meta에 바꾼 사람·시각을 남긴다(§3.4) */
export function setAutoAllowCap(db: Db, cap: unknown, by: unknown, now: number): SetAutoAllowCapResult {
  if (typeof cap !== "number" || !Number.isInteger(cap) || cap < 0 || cap > AUTO_ALLOW_CAP_MAX) return { ok: false, code: "bad_request" };
  if (typeof by !== "string" || !CHANNEL_ID.test(by)) return { ok: false, code: "bad_request" };
  metaSet(db, "auto_allow_cap", String(cap));
  metaSet(db, "auto_allow_cap_by", by);
  metaSet(db, "auto_allow_cap_at", String(now));
  return { ok: true };
}

/** 확인 페이지가 보는 한 채널의 상태(허가 행·차단 행·거부 기록 이름, 쓰기 0). adminView의 200행 제한과 상관없이 찾는다 */
export function disallowTarget(
  db: Db,
  channelId: string,
  now: number,
): { readonly allowed: boolean; readonly blocked: boolean; readonly channelName: string | null; readonly activeSessions: number } {
  const row = db.first<{ channel_name: string | null; n: number }>(
    "SELECT a.channel_name, (SELECT count(*) FROM session s WHERE s.channel_id = a.channel_id AND s.status = 'active' AND s.expires_at > ?) AS n FROM allowlist a WHERE a.channel_id = ?",
    now,
    channelId,
  );
  const blocked = db.first<{ channel_name: string | null }>("SELECT channel_name FROM blocked WHERE channel_id = ?", channelId);
  if (row !== null) return { allowed: true, blocked: blocked !== null, channelName: row.channel_name, activeSessions: row.n };
  const denied = db.first<{ channel_name: string | null }>("SELECT channel_name FROM denied WHERE channel_id = ?", channelId);
  return { allowed: false, blocked: blocked !== null, channelName: blocked?.channel_name ?? denied?.channel_name ?? null, activeSessions: 0 };
}

export function dismissDenied(db: Db, channelId: string, by: string, now: number): boolean {
  const changed = db.run("DELETE FROM denied WHERE channel_id = ?", channelId) > 0;
  if (changed) audit(db, "dismiss", by, channelId, now);
  return changed;
}

type AllowRow = { channel_id: string; channel_name: string | null; owner_channel_id: string | null; note: string | null; added_by: string; added_at: number; active_sessions: number };
type DeniedRow = { channel_id: string; channel_name: string | null; first_at: number; last_at: number; attempts: number; blocked: number };
type BlockedRow = { channel_id: string; channel_name: string | null; blocked_by: string; blocked_at: number };
type SessionRow = { id: string; kind: "app" | "web"; channel_id: string; channel_name: string | null; client: string | null; created_at: number; last_seen_at: number; recovered: number };
type AuditRow = { at: number; actor: string; action: AuditAction; target: string | null };

export function adminView(db: Db, now: number): AdminView {
  const allowlist = db.all<AllowRow>(
    `SELECT a.channel_id, a.channel_name, a.owner_channel_id, a.note, a.added_by, a.added_at, (SELECT count(*) FROM session s WHERE s.channel_id = a.channel_id AND s.status = 'active' AND s.expires_at > ?) AS active_sessions FROM allowlist a ORDER BY a.added_at DESC, a.channel_id LIMIT ${ADMIN_LIST_MAX}`,
    now,
  );
  const allowlistTotal = db.first<{ n: number }>("SELECT count(*) AS n FROM allowlist")?.n ?? 0;
  const blocked = db.all<BlockedRow>(`SELECT channel_id, channel_name, blocked_by, blocked_at FROM blocked ORDER BY blocked_at DESC, channel_id LIMIT ${ADMIN_LIST_MAX}`);
  const blockedTotal = db.first<{ n: number }>("SELECT count(*) AS n FROM blocked")?.n ?? 0;
  const denied = db.all<DeniedRow>(
    "SELECT d.channel_id, d.channel_name, d.first_at, d.last_at, d.attempts, EXISTS (SELECT 1 FROM blocked b WHERE b.channel_id = d.channel_id) AS blocked FROM denied d ORDER BY d.last_at DESC, d.channel_id LIMIT 200",
  );
  const sessions = db.all<SessionRow>(
    "SELECT id, kind, channel_id, channel_name, client, created_at, last_seen_at, recovered FROM session WHERE status = 'active' AND expires_at > ? ORDER BY created_at DESC, id LIMIT 200",
    now,
  );
  const log = db.all<AuditRow>("SELECT at, actor, action, target FROM audit ORDER BY id DESC LIMIT 50");
  return {
    allowlist: allowlist.map((r) => ({
      channelId: r.channel_id,
      channelName: r.channel_name,
      ownerChannelId: r.owner_channel_id,
      note: r.note,
      addedBy: r.added_by,
      addedAt: r.added_at,
      activeSessions: r.active_sessions,
    })),
    denied: denied.map((r) => ({ channelId: r.channel_id, channelName: r.channel_name, firstAt: r.first_at, lastAt: r.last_at, attempts: r.attempts, invitedBy: null, blocked: r.blocked === 1 })),
    blocked: blocked.map((r) => ({ channelId: r.channel_id, channelName: r.channel_name, blockedBy: r.blocked_by, blockedAt: r.blocked_at })),
    allowlistTotal,
    blockedTotal,
    autoAllow: autoAllowState(db, now),
    sessions: sessions.map((r) => ({
      id: r.id,
      kind: r.kind,
      channelId: r.channel_id,
      channelName: r.channel_name,
      client: r.client,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      recovered: r.recovered,
    })),
    audit: log,
  };
}
