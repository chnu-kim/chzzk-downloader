// 허용목록·거부 기록·감사 로그(docs/design/worker.md §5·§8, 구현 중 변경 20·22). 모두 동기 함수이고 시각은 now 인자다.
//
// 허용 판정은 요청마다 한다: 관리자는 Worker가 넘긴 admins(secret)로, 그 밖은 allowlist 행으로. 부트스트랩(admins가 빔)에서는
// 행이 있어도 아무도 허용하지 않는다. 공격자가 정하는 문자열(채널 이름·메모)은 clip을 거쳐 저장한다.
import { sanitizeName } from "../core/chzzk";
import type { Db } from "./db";
import type { AdminView, AllowResult, AuditAction, DisallowResult } from "./types";

export const CHANNEL_ID = /^[0-9a-f]{32}$/;
export const NAME_MAX = 128;
export const NOTE_MAX = 64;
export const DENIED_CAP = 200;
export const DENIED_REFRESH_MS = 3_600_000;
export const DENIED_KEEP_MS = 30 * 86_400_000;
export const AUDIT_CAP = 500;

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

export function allow(db: Db, channelId: string, note: string, by: string, now: number): AllowResult {
  if (!CHANNEL_ID.test(channelId)) return { ok: false, code: "bad_channel_id" };
  const n = clip(note, NOTE_MAX);
  db.run(
    "INSERT INTO allowlist (channel_id, channel_name, owner_channel_id, note, added_by, added_at) VALUES (?, (SELECT channel_name FROM denied WHERE channel_id = ?), NULL, ?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET note = excluded.note",
    channelId,
    channelId,
    n === "" ? null : n,
    by,
    now,
  );
  db.run("DELETE FROM denied WHERE channel_id = ?", channelId);
  audit(db, "allow", by, channelId, now);
  return { ok: true };
}

/**
 * 거부 기록에서 [허용]. 기록이 없으면 false. 이미 허용목록에 있는 채널(부트스트랩 때 거부된 경우)은 행을 그대로 두고
 * 거부 기록만 지운다: allow의 upsert는 메모를 덮어써 관리자가 적은 메모가 사라진다
 */
export function allowDenied(db: Db, channelId: string, by: string, now: number): boolean {
  if (db.first("SELECT 1 AS x FROM denied WHERE channel_id = ?", channelId) === null) return false;
  if (db.first("SELECT 1 AS x FROM allowlist WHERE channel_id = ?", channelId) === null) {
    allow(db, channelId, "", by, now);
    return true;
  }
  db.run("DELETE FROM denied WHERE channel_id = ?", channelId);
  audit(db, "allow", by, channelId, now);
  return true;
}

/** 허용에서 뺀다: 행 삭제 + 그 채널의 세션 전부 revoked(disallowed). 관리자는 행이 있어도 409(is_admin)이고 아무것도 쓰지 않는다 */
export function disallow(db: Db, channelId: string, by: string, admins: readonly string[], now: number): DisallowResult {
  if (!CHANNEL_ID.test(channelId)) return { ok: false, code: "bad_channel_id" };
  if (admins.includes(channelId)) return { ok: false, code: "is_admin" };
  db.run("DELETE FROM allowlist WHERE channel_id = ?", channelId);
  db.run("UPDATE session SET status = 'revoked', revoked_at = ?, revoked_why = 'disallowed' WHERE channel_id = ? AND status <> 'revoked'", now, channelId);
  audit(db, "disallow", by, channelId, now);
  return { ok: true };
}

export function dismissDenied(db: Db, channelId: string, by: string, now: number): boolean {
  const changed = db.run("DELETE FROM denied WHERE channel_id = ?", channelId) > 0;
  if (changed) audit(db, "dismiss", by, channelId, now);
  return changed;
}

type AllowRow = { channel_id: string; channel_name: string | null; owner_channel_id: string | null; note: string | null; added_by: string; added_at: number; active_sessions: number };
type DeniedRow = { channel_id: string; channel_name: string | null; first_at: number; last_at: number; attempts: number };
type SessionRow = { id: string; kind: "app" | "web"; channel_id: string; channel_name: string | null; client: string | null; created_at: number; last_seen_at: number; recovered: number };
type AuditRow = { at: number; actor: string; action: AuditAction; target: string | null };

export function adminView(db: Db, now: number): AdminView {
  const allowlist = db.all<AllowRow>(
    "SELECT a.channel_id, a.channel_name, a.owner_channel_id, a.note, a.added_by, a.added_at, (SELECT count(*) FROM session s WHERE s.channel_id = a.channel_id AND s.status = 'active' AND s.expires_at > ?) AS active_sessions FROM allowlist a ORDER BY a.added_at DESC, a.channel_id",
    now,
  );
  const denied = db.all<DeniedRow>("SELECT channel_id, channel_name, first_at, last_at, attempts FROM denied ORDER BY last_at DESC, channel_id LIMIT 200");
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
    denied: denied.map((r) => ({ channelId: r.channel_id, channelName: r.channel_name, firstAt: r.first_at, lastAt: r.last_at, attempts: r.attempts })),
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
