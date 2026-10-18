// DO AuthStore 마이그레이션(docs/design/worker.md §5, 구현 중 변경 17·21). /health의 schema는 이 배열의 길이다(코드가 아는 최신 버전).
//
// 마이그레이션은 더하기만 한다(새 표·열). DB 버전이 코드보다 앞서면 던지지 않는다: Worker를 되돌린(wrangler rollback)
// 뒤에도 서비스가 돌아야 한다. 각 버전은 DDL과 meta.schema_version 갱신을 한 트랜잭션에 넣는다.
import type { Db } from "./db";

const V1 = `
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE flow (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('app','web')), handle_hash TEXT UNIQUE, state_hash TEXT UNIQUE,
  binder_hash TEXT, poll_verifier TEXT, user_code TEXT, client TEXT,
  status TEXT NOT NULL CHECK (status IN ('started','redirected','exchanging','ok','denied','cancelled','failed')),
  session_id TEXT, channel_name TEXT, channel_id TEXT, fail_code TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX flow_expires ON flow(expires_at);
CREATE TABLE allowlist (channel_id TEXT PRIMARY KEY CHECK (length(channel_id) = 32), channel_name TEXT, owner_channel_id TEXT, note TEXT,
  added_by TEXT NOT NULL, added_at INTEGER NOT NULL);
CREATE TABLE session (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('app','web')), channel_id TEXT NOT NULL, channel_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('unclaimed','active','revoked')), access_hash TEXT UNIQUE, access_exp INTEGER, csrf TEXT, client TEXT,
  created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER,
  revoked_why TEXT CHECK (revoked_why IN ('logout','admin','disallowed','reuse','user')), recovered INTEGER NOT NULL DEFAULT 0);
CREATE INDEX session_channel ON session(channel_id, status);
CREATE INDEX session_expires ON session(expires_at);
CREATE TABLE refresh (hash TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES session(id), status TEXT NOT NULL CHECK (status IN ('active','used')),
  child_hash TEXT, issued_at INTEGER NOT NULL, used_at INTEGER, expires_at INTEGER NOT NULL);
CREATE INDEX refresh_session ON refresh(session_id);
CREATE INDEX refresh_expires ON refresh(expires_at);
CREATE TABLE denied (channel_id TEXT PRIMARY KEY, channel_name TEXT, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, attempts INTEGER NOT NULL);
CREATE INDEX denied_last ON denied(last_at);
CREATE TABLE audit (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('allow','disallow','revoke_session','reuse_detected','refresh_recovered','dismiss')), target TEXT)
`;

// 앱 루프백(구현 중 변경 88 (다)): 더하기만 한다. poll_verifier 열에는 loginVerifier를 담고, user_code는 새 흐름에서 NULL이다
const V2 = `
ALTER TABLE flow ADD COLUMN port INTEGER;
ALTER TABLE flow ADD COLUMN grant_hash TEXT;
ALTER TABLE flow ADD COLUMN grant_exp INTEGER;
CREATE UNIQUE INDEX flow_grant ON flow(grant_hash)
`;

// 편집자 위임(docs/design/features/delegation.md §8.1, worker.md 구현 중 변경 105): 더하기만 한다.
// delegation: 주인(판정용 owner_channel_id, 로그인 owner_login_channel_id) → 편집자(로그인 editor_channel_id). 회수는 revoked_at을 채우고 30일 뒤 청소가 지운다.
// *_allowed_at: 만들 때 그 당사자 allowlist 행의 added_at(관리자로 만든 관계는 NULL). V2로 되돌린 동안의 제외·재허가는 added_at을 바꾸므로
// 판정(delegation.ts partyOk)이 그 행을 무효로 본다.
// invite: 토큰 해시만. 허가 전 편집자가 열면 claimed_*가 채워지고 관리자 [허가] 때 위임으로 바뀐다. flow.invite_hash는 초대에서 시작한 웹 로그인 흐름 표시
const V3 = `
CREATE TABLE delegation (owner_channel_id TEXT NOT NULL CHECK (length(owner_channel_id) = 32), owner_login_channel_id TEXT NOT NULL CHECK (length(owner_login_channel_id) = 32),
  editor_channel_id TEXT NOT NULL CHECK (length(editor_channel_id) = 32), owner_name TEXT, editor_name TEXT, owner_allowed_at INTEGER, editor_allowed_at INTEGER,
  created_at INTEGER NOT NULL, revoked_at INTEGER, revoked_by TEXT CHECK (revoked_by IN ('owner','editor')), PRIMARY KEY (owner_channel_id, editor_channel_id));
CREATE INDEX delegation_editor ON delegation(editor_channel_id, revoked_at);
CREATE INDEX delegation_owner_login ON delegation(owner_login_channel_id);
CREATE INDEX delegation_revoked ON delegation(revoked_at);
CREATE TABLE invite (token_hash TEXT PRIMARY KEY, owner_channel_id TEXT NOT NULL CHECK (length(owner_channel_id) = 32),
  owner_login_channel_id TEXT NOT NULL CHECK (length(owner_login_channel_id) = 32), owner_name TEXT, owner_allowed_at INTEGER, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, claimed_channel_id TEXT, claimed_name TEXT, claimed_at INTEGER);
CREATE INDEX invite_owner ON invite(owner_channel_id);
CREATE INDEX invite_owner_login ON invite(owner_login_channel_id);
CREATE INDEX invite_claimed ON invite(claimed_channel_id);
CREATE INDEX invite_expires ON invite(expires_at);
ALTER TABLE flow ADD COLUMN invite_hash TEXT
`;

// 허용목록 자동 허가(docs/design/features/allowlist-open.md §4.1, worker.md 구현 중 변경 109): 더하기만 한다.
// blocked: 관리자가 막은 채널. 자동 허가만 막고 허가 판정(admission)은 보지 않는다(허가 행이 있으면 허가가 이긴다, V3로 되돌려도 안전).
// flow.deny_reason: 거부된 흐름의 이유(daily_limit·blocked·NULL). 쓰는 곳이 finish 하나라 CHECK는 두지 않는다
// 옛 빼기 이력(allowlist-open.md §4.6, worker.md 구현 중 변경 109 (타)): V1~V3의 "허가 빼기"는 감사 disallow 행만 남기므로, blocked만 보는 자동 허가가 배포 순간 그 채널을 다시 받아들인다.
// 그래서 감사의 채널별 마지막 allow/disallow가 disallow이고 지금 허가 행이 없는 채널을 차단으로 옮긴다(감사 AUDIT_CAP 500행 안에서만 되는 최선의 노력).
// 이름은 거부 기록에 있을 때만 채운다(허가 행을 지울 때 이름도 사라졌다). target이 채널 ID 형식(32자)이 아닌 행은 옮기지 않는다
const V4 = `
CREATE TABLE blocked (channel_id TEXT PRIMARY KEY CHECK (length(channel_id) = 32), channel_name TEXT, blocked_by TEXT NOT NULL, blocked_at INTEGER NOT NULL);
CREATE INDEX blocked_at ON blocked(blocked_at);
ALTER TABLE flow ADD COLUMN deny_reason TEXT;
INSERT OR IGNORE INTO blocked (channel_id, channel_name, blocked_by, blocked_at)
  SELECT a.target, (SELECT d.channel_name FROM denied d WHERE d.channel_id = a.target), a.actor, a.at FROM audit a
  WHERE a.id IN (SELECT max(id) FROM audit WHERE action IN ('allow','disallow') AND target IS NOT NULL AND length(target) = 32 GROUP BY target)
    AND a.action = 'disallow' AND a.target NOT IN (SELECT channel_id FROM allowlist)
`;

export const MIGRATIONS: readonly string[] = [V1, V2, V3, V4];
export const SCHEMA_VERSION = MIGRATIONS.length;

export type MigrateResult = { readonly from: number; readonly to: number; readonly ahead: boolean };

const VERSION = /^(0|[1-9][0-9]{0,5})$/;

/** DB의 스키마 버전. meta 표가 없으면 0 */
export function currentVersion(db: Db): number {
  const t = db.first<{ n: number }>("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'meta'");
  if (!t || t.n === 0) return 0;
  const row = db.first<{ v: string }>("SELECT v FROM meta WHERE k = 'schema_version'");
  if (!row) return 0;
  if (!VERSION.test(row.v)) throw new Error("schema_version");
  return Number(row.v);
}

/** 빈 DB → 최신. tx는 AuthStore가 넘기는 동기 트랜잭션 함수다 */
export function migrate(db: Db, tx: (fn: () => void) => void): MigrateResult {
  const from = currentVersion(db);
  if (from > MIGRATIONS.length) return { from, to: from, ahead: true };
  for (let v = from; v < MIGRATIONS.length; v++) {
    tx(() => {
      db.run(MIGRATIONS[v]!);
      db.run("INSERT INTO meta (k, v) VALUES ('schema_version', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", String(v + 1));
    });
  }
  return { from, to: MIGRATIONS.length, ahead: false };
}
