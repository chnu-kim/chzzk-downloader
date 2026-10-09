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

export const MIGRATIONS: readonly string[] = [V1, V2];
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
