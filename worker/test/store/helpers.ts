// AuthStore 테스트 도우미(테스트 파일이 아니다). 시각은 실제 시각보다 미래인 T0에 둔다: 알람 스케줄러는 실제 시각을 써서
// 과거 시각의 알람은 테스트 중에 저절로 실행된다(worker.md 구현 중 변경 17 (나)).
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { Db } from "../../src/store/db";
import { newSecret, sha256B64url, sha256Hex } from "../../src/core/token";
import type { TokenBundle } from "../../src/store/types";

export const T0 = Date.UTC(2030, 0, 1);
export const DAY = 86_400_000;
export const A1 = "0".repeat(30) + "a1";
export const B2 = "0".repeat(30) + "b2";
export const C3 = "0".repeat(30) + "c3";
export const D4 = "0".repeat(30) + "d4";
export const ADMINS: readonly string[] = [A1];

export const freshStub = () => env.AUTH.get(env.AUTH.idFromName(crypto.randomUUID()));
export type Stub = ReturnType<typeof freshStub>;

export const sha = sha256Hex;

/** 앱 루프백 수신기 포트(테스트 기본값) */
export const PORT = 49152;

export type LoginOpts = { channelId?: string; name?: string; admins?: readonly string[]; now?: number; ip?: string; port?: number };

/** 앱 흐름을 exchanging까지 진행한다 */
export async function begin(stub: Stub, o: LoginOpts = {}) {
  const now = o.now ?? T0;
  const loginSecret = newSecret();
  const verifier = await sha256B64url(loginSecret);
  const s = await stub.startApp({ port: o.port ?? PORT, verifier, client: "app/0.2.0 macos", ip: o.ip ?? "203.0.113.10", limit: 1000 }, now);
  if (!s.ok) throw new Error(`startApp ${s.code}`);
  const c = await stub.continueApp(await sha(s.handle), now);
  if (!c.ok) throw new Error(`continueApp ${c.code}`);
  const k = await stub.consume(await sha(c.state), await sha(c.binder), now);
  if (!k.ok) throw new Error(`consume ${k.code}`);
  return { flowId: k.flowId, handle: s.handle, state: c.state, binder: c.binder, loginSecret, verifier };
}

/** 앱 로그인 끝까지(허용된 채널이어야 한다): start → continue → consume → finish → redeem. 단계마다 ok를 단언한다 */
export async function appLogin(stub: Stub, o: LoginOpts = {}) {
  const now = o.now ?? T0;
  const admins = o.admins ?? ADMINS;
  const b = await begin(stub, o);
  const f = await stub.finish(b.flowId, { type: "user", channelId: o.channelId ?? B2, channelName: o.name ?? "허용 채널" }, admins, now);
  if (f.type !== "loopback" || f.result !== "ok") throw new Error(`finish ${JSON.stringify(f)}`);
  const c = await stub.redeem(await sha(f.grant), b.verifier, admins, now);
  if (c.status !== "ok") throw new Error(`redeem ${c.status}`);
  return { ...b, grant: f.grant, bundle: c.bundle as TokenBundle };
}

/** 허용목록에 넣은 뒤 앱 로그인 */
export async function allowedLogin(stub: Stub, o: LoginOpts = {}) {
  await stub.allow(o.channelId ?? B2, "", A1, o.now ?? T0);
  return appLogin(stub, o);
}

/** 웹 로그인(허용된 채널이어야 한다) */
export async function webLogin(stub: Stub, o: LoginOpts = {}) {
  const now = o.now ?? T0;
  const s = await stub.startWeb(o.ip ?? "203.0.113.20", 1000, now);
  if (!s.ok) throw new Error(`startWeb ${s.code}`);
  const k = await stub.consume(await sha(s.state), await sha(s.binder), now);
  if (!k.ok) throw new Error(`consume ${k.code}`);
  const f = await stub.finish(k.flowId, { type: "user", channelId: o.channelId ?? A1, channelName: o.name ?? "관리자 채널" }, o.admins ?? ADMINS, now);
  if (f.type !== "web") throw new Error(`finish ${f.type}`);
  return { cookieToken: f.cookieToken, csrf: f.csrf, expiresAt: f.expiresAt, state: s.state, binder: s.binder };
}

/** 사용자 표 전부를 JSON으로(내부 표 sqlite_·_cf_ 제외, 이름순) */
export function dumpAll(db: Db): string {
  const tables = db.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name",
  );
  return JSON.stringify(tables.map((t) => [t.name, db.all(`SELECT * FROM ${t.name} ORDER BY rowid`)]));
}

export const SCHEMA_SQL =
  "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY type, name";

/** DO 안의 행 수 계량(Db 래퍼가 누적한 값) */
export const meter = (stub: Stub) => runInDurableObject(stub, (i) => ({ read: i.db.rowsRead, written: i.db.rowsWritten }));

/** 읽기 전용 질의(DO 안에서) */
export const query = <T extends Record<string, SqlStorageValue>>(stub: Stub, sql: string, ...binds: SqlStorageValue[]) =>
  runInDurableObject(stub, (i) => i.db.all<T>(sql, ...binds));
