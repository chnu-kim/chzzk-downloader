// 마이그레이션(worker.md 구현 중 변경 17·21): 빈 DB → 최신, 중간 버전 → 최신, 앞선 스키마는 던지지 않는다.
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Db } from "../../src/store/db";
import { MIGRATIONS, SCHEMA_VERSION, migrate } from "../../src/store/schema";
import { SCHEMA_SQL, freshStub } from "./helpers";

const USER_TABLES = ["refresh", "session", "flow", "allowlist", "denied", "audit", "delegation", "invite", "blocked", "meta"];

function dropAll(db: Db) {
  // 외래 키가 강제된다: refresh가 session보다 먼저
  for (const t of USER_TABLES) db.run(`DROP TABLE IF EXISTS ${t}`);
}

describe("migrate", () => {
  it("새 DO: 표·인덱스·schema_version이 최신이다", async () => {
    await runInDurableObject(freshStub(), (inst) => {
      expect(SCHEMA_VERSION).toBe(MIGRATIONS.length);
      expect(SCHEMA_VERSION).toBe(4);
      const tables = inst.db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name");
      expect(tables.map((t) => t.name)).toEqual(["allowlist", "audit", "blocked", "delegation", "denied", "flow", "invite", "meta", "refresh", "session"]);
      const idx = inst.db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name");
      expect(idx.map((t) => t.name)).toEqual(["blocked_at", "delegation_editor", "delegation_owner_login", "delegation_revoked", "denied_last", "flow_expires", "flow_grant", "invite_claimed", "invite_expires", "invite_owner", "invite_owner_login", "refresh_expires", "refresh_session", "session_channel", "session_expires"]);
      expect(inst.db.first("SELECT v FROM meta WHERE k = 'schema_version'")).toEqual({ v: "4" });
    });
  });

  it("빈 DB → 최신: 스키마가 처음과 같다", async () => {
    await runInDurableObject(freshStub(), (inst, state) => {
      const first = inst.db.all(SCHEMA_SQL);
      dropAll(inst.db);
      expect(inst.db.all(SCHEMA_SQL)).toEqual([]);
      expect(migrate(inst.db, (fn) => state.storage.transactionSync(fn))).toEqual({ from: 0, to: 4, ahead: false });
      expect(inst.db.all(SCHEMA_SQL)).toEqual(first);
    });
  });

  it("각 중간 버전 k에서 최신으로", async () => {
    await runInDurableObject(freshStub(), (inst, state) => {
      const first = inst.db.all(SCHEMA_SQL);
      for (let k = 0; k <= MIGRATIONS.length; k++) {
        dropAll(inst.db);
        for (let v = 0; v < k; v++) inst.db.run(MIGRATIONS[v]!);
        if (k > 0) inst.db.run("INSERT INTO meta (k, v) VALUES ('schema_version', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", String(k));
        expect(migrate(inst.db, (fn) => state.storage.transactionSync(fn))).toEqual({ from: k, to: MIGRATIONS.length, ahead: false });
        expect(inst.db.all(SCHEMA_SQL)).toEqual(first);
      }
    });
  });

  it("다시 불러도 아무것도 쓰지 않는다", async () => {
    await runInDurableObject(freshStub(), (inst, state) => {
      const before = inst.db.rowsWritten;
      expect(migrate(inst.db, (fn) => state.storage.transactionSync(fn))).toEqual({ from: 4, to: 4, ahead: false });
      expect(inst.db.rowsWritten).toBe(before);
    });
  });

  it("앞선 스키마(DB 버전 > 코드): 던지지 않고 그대로 둔다", async () => {
    await runInDurableObject(freshStub(), (inst, state) => {
      inst.db.run("UPDATE meta SET v = '5' WHERE k = 'schema_version'");
      const before = inst.db.all(SCHEMA_SQL);
      expect(migrate(inst.db, (fn) => state.storage.transactionSync(fn))).toEqual({ from: 5, to: 5, ahead: true });
      expect(inst.db.all(SCHEMA_SQL)).toEqual(before);
    });
  });

  it("schema_version이 숫자가 아니면 던진다", async () => {
    await runInDurableObject(freshStub(), (inst, state) => {
      inst.db.run("UPDATE meta SET v = 'x' WHERE k = 'schema_version'");
      expect(() => migrate(inst.db, (fn) => state.storage.transactionSync(fn))).toThrow("schema_version");
    });
  });

  it("v1 DB(옛 앱 흐름 행) → 최신: 행 보존, 새 열 NULL", async () => {
    await runInDurableObject(freshStub(), (inst, state) => {
      const first = inst.db.all(SCHEMA_SQL);
      dropAll(inst.db);
      inst.db.run(MIGRATIONS[0]!);
      inst.db.run("INSERT INTO meta (k, v) VALUES ('schema_version', '1')");
      inst.db.run(
        "INSERT INTO flow (id, kind, handle_hash, poll_verifier, user_code, client, status, created_at, expires_at) VALUES ('f1','app','h','v','UPDA-TE22','c','started',1,2)",
      );
      expect(migrate(inst.db, (fn) => state.storage.transactionSync(fn))).toEqual({ from: 1, to: 4, ahead: false });
      expect(inst.db.all("SELECT id, poll_verifier, user_code, port, grant_hash, grant_exp, invite_hash FROM flow")).toEqual([
        { id: "f1", poll_verifier: "v", user_code: "UPDA-TE22", port: null, grant_hash: null, grant_exp: null, invite_hash: null },
      ]);
      expect(inst.db.all(SCHEMA_SQL)).toEqual(first);
    });
  });

  it("v2 DB(웹 흐름 행·허가 행) → v3: 행 보존, flow.invite_hash NULL, 새 표는 빈 표", async () => {
    await runInDurableObject(freshStub(), (inst, state) => {
      const first = inst.db.all(SCHEMA_SQL);
      dropAll(inst.db);
      inst.db.run(MIGRATIONS[0]!);
      inst.db.run(MIGRATIONS[1]!);
      inst.db.run("INSERT INTO meta (k, v) VALUES ('schema_version', '2')");
      inst.db.run("INSERT INTO flow (id, kind, state_hash, status, created_at, expires_at) VALUES ('w1','web','s','redirected',1,2)");
      inst.db.run("INSERT INTO allowlist (channel_id, channel_name, owner_channel_id, note, added_by, added_at) VALUES (?, 'n', NULL, NULL, 'x', 5)", "0".repeat(30) + "b2");
      expect(migrate(inst.db, (fn) => state.storage.transactionSync(fn))).toEqual({ from: 2, to: 4, ahead: false });
      expect(inst.db.all("SELECT id, state_hash, invite_hash FROM flow")).toEqual([{ id: "w1", state_hash: "s", invite_hash: null }]);
      expect(inst.db.all("SELECT channel_id, added_at FROM allowlist")).toEqual([{ channel_id: "0".repeat(30) + "b2", added_at: 5 }]);
      expect(inst.db.all("SELECT * FROM delegation")).toEqual([]);
      expect(inst.db.all("SELECT * FROM invite")).toEqual([]);
      expect(inst.db.all(SCHEMA_SQL)).toEqual(first);
    });
  });

  it("v3 DB(웹 흐름 행·허가 행) → v4: 행 보존, flow.deny_reason NULL, blocked는 빈 표(allowlist-open.md §4.1)", async () => {
    await runInDurableObject(freshStub(), (inst, state) => {
      const first = inst.db.all(SCHEMA_SQL);
      dropAll(inst.db);
      for (let v = 0; v < 3; v++) inst.db.run(MIGRATIONS[v]!);
      inst.db.run("INSERT INTO meta (k, v) VALUES ('schema_version', '3')");
      inst.db.run("INSERT INTO flow (id, kind, state_hash, status, created_at, expires_at) VALUES ('w1','web','s','denied',1,2)");
      inst.db.run("INSERT INTO allowlist (channel_id, channel_name, owner_channel_id, note, added_by, added_at) VALUES (?, 'n', NULL, NULL, 'x', 5)", "0".repeat(30) + "b2");
      expect(migrate(inst.db, (fn) => state.storage.transactionSync(fn))).toEqual({ from: 3, to: 4, ahead: false });
      expect(inst.db.all("SELECT id, status, deny_reason FROM flow")).toEqual([{ id: "w1", status: "denied", deny_reason: null }]);
      expect(inst.db.all("SELECT channel_id, added_at FROM allowlist")).toEqual([{ channel_id: "0".repeat(30) + "b2", added_at: 5 }]);
      expect(inst.db.all("SELECT * FROM blocked")).toEqual([]);
      expect(inst.db.all(SCHEMA_SQL)).toEqual(first);
    });
  });
});
