// Durable Object AuthStore(docs/design/worker.md §5, 구현 중 변경 17~23). SQLite 하나에 흐름·세션·허용목록·거부 기록·감사 로그를 둔다.
//
// 이 파일이 DO 경계다: 비동기·시각·cloudflare:는 여기에만 있고(worker-config.mjs checkStorePurity), 나머지 src/store/*는
// 동기 함수에 now 인자만 받는다. RPC 하나 = 앞 단계(해시·발급, 트랜잭션 밖) + transactionSync 하나.
// 들어오는 자격 원문은 받지 않는다: Worker가 SHA-256 hex로 해시해 넘긴다. 새 토큰은 여기서 만들어 원문은 돌려주기만 하고 해시만 저장한다.
import { DurableObject } from "cloudflare:workers";
import { DEFAULT_START_RATE_10M } from "../config";
import { ipBucket } from "../core/ip";
import { log } from "../core/log";
import { isHexHash, isId, isSecret, newId, newSecret, newToken, sha256Hex, type TokenKind } from "../core/token";
import { newUserCode } from "../core/usercode";
import { CHANNEL_ID, adminView, allow, allowDenied, audit, clip, disallow, dismissDenied } from "./allowlist";
import { Db } from "./db";
import {
  CLIENT_MAX,
  FLOW_CAP,
  FLOW_TTL_MS,
  POLL_INTERVAL_MS,
  claim,
  consume,
  continueApp,
  doneView,
  finish,
  insertAppFlow,
  insertWebFlow,
  liveFlowCount,
  loginPage,
  pollGate,
  throttle,
  type StartWindow,
} from "./flows";
import { migrate } from "./schema";
import { check, logout, mySessions, revokeMine, revokeSession, rotate, webCheck } from "./sessions";
import { SWEEP_DELAY_MS, SWEEP_INTERVAL_MS, sweep } from "./sweep";
import type {
  AdminView,
  AllowResult,
  CheckResult,
  ClaimResult,
  ConsumeResult,
  ContinueResult,
  DisallowResult,
  DoneView,
  FinishResult,
  LoginOutcome,
  LoginPageView,
  Minted,
  MySessionView,
  RotateResult,
  StartAppResult,
  StartWebResult,
  WebCheckResult,
} from "./types";

/** Worker가 부르는 DO 이름: env.AUTH.get(env.AUTH.idFromName(AUTH_STORE_NAME)) */
export const AUTH_STORE_NAME = "main";

const DAY_MS = 86_400_000;

async function mint(kind: TokenKind): Promise<Minted> {
  const token = newToken(kind);
  return { token, hash: await sha256Hex(token) };
}

export class AuthStore extends DurableObject<Env> {
  readonly db: Db;
  /** 앱·웹 start가 같이 쓰는 IP 스로틀(DO 메모리: 쫓겨나면 비워진다, 상한 32가 쓰기를 계속 묶는다) */
  readonly starts = new Map<string, StartWindow>();
  readonly polls = new Map<string, number>();
  // IP 키 소금: 키가 DO 밖으로 나가지 않으므로 DO 메모리에 둔다
  private readonly salt = newSecret();
  private alarmAt: number | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = new Db(ctx.storage.sql);
    void ctx.blockConcurrencyWhile(async () => {
      const m = migrate(this.db, (fn) => ctx.storage.transactionSync(fn));
      if (m.ahead) log("store.schema_ahead", { level: "warn" });
      this.alarmAt = await ctx.storage.getAlarm();
    });
  }

  // IP → 스로틀 키: SHA-256(소금 | UTC 일 번호 | 버킷) 앞 32자
  private async ipKey(ip: string | null, now: number): Promise<string> {
    return (await sha256Hex(`${this.salt}|${Math.floor(now / DAY_MS)}|${ipBucket(ip)}`)).slice(0, 32);
  }

  // 트랜잭션 하나. 행을 썼으면 청소 알람이 있는지 확인한다
  private async write<T>(now: number, fn: () => T): Promise<T> {
    const before = this.db.rowsWritten;
    const out = this.ctx.storage.transactionSync(fn);
    if (this.db.rowsWritten > before) await this.ensureAlarm(now);
    return out;
  }

  // setAlarm은 기존 알람을 덮어쓴다(실측, 구현 중 변경 17): 예약이 없을 때만 하나 둔다
  private async ensureAlarm(now: number): Promise<void> {
    if (this.alarmAt !== null) return;
    const at = Math.max(now, Date.now()) + SWEEP_DELAY_MS;
    await this.ctx.storage.setAlarm(at);
    this.alarmAt = at;
  }

  override async alarm(): Promise<void> {
    // 알람은 실행 전에 지워진다(getAlarm이 null)
    this.alarmAt = null;
    const now = Date.now();
    const r = this.ctx.storage.transactionSync(() => sweep(this.db, now));
    if (r.remaining) {
      const at = now + SWEEP_INTERVAL_MS;
      await this.ctx.storage.setAlarm(at);
      this.alarmAt = at;
    }
  }

  // ---- 로그인 흐름 ----

  async startApp(pollVerifier: string, client: string, ip: string | null, limit: number, now: number): Promise<StartAppResult> {
    if (!isSecret(pollVerifier)) return { ok: false, code: "bad_request" };
    const lim = Number.isInteger(limit) && limit >= 1 ? limit : DEFAULT_START_RATE_10M;
    const key = await this.ipKey(ip, now);
    const loginId = newId();
    const handle = newId();
    const userCode = newUserCode();
    const handleHash = await sha256Hex(handle);
    const t = throttle(this.starts, key, lim, now);
    if (!t.ok) return { ok: false, code: "rate_limited", retryAfterSec: t.retryAfterSec };
    const cleanClient = clip(client, CLIENT_MAX);
    return this.write<StartAppResult>(now, () => {
      if (liveFlowCount(this.db, now) >= FLOW_CAP) return { ok: false, code: "busy" };
      insertAppFlow(this.db, { id: loginId, handleHash, pollVerifier, userCode, client: cleanClient }, now);
      return { ok: true, loginId, handle, userCode, expiresAt: now + FLOW_TTL_MS, pollIntervalMs: POLL_INTERVAL_MS };
    });
  }

  async startWeb(ip: string | null, limit: number, now: number): Promise<StartWebResult> {
    const lim = Number.isInteger(limit) && limit >= 1 ? limit : DEFAULT_START_RATE_10M;
    const key = await this.ipKey(ip, now);
    const id = newId();
    const state = newSecret();
    const binder = newToken("flow");
    const [stateHash, binderHash] = await Promise.all([sha256Hex(state), sha256Hex(binder)]);
    const t = throttle(this.starts, key, lim, now);
    if (!t.ok) return { ok: false, code: "rate_limited", retryAfterSec: t.retryAfterSec };
    return this.write<StartWebResult>(now, () => {
      if (liveFlowCount(this.db, now) >= FLOW_CAP) return { ok: false, code: "busy" };
      insertWebFlow(this.db, { id, stateHash, binderHash }, now);
      return { ok: true, state, binder, expiresAt: now + FLOW_TTL_MS };
    });
  }

  async loginPage(handleHash: string, now: number): Promise<LoginPageView | null> {
    if (!isHexHash(handleHash)) return null;
    return this.write(now, () => loginPage(this.db, handleHash, now));
  }

  async continueApp(handleHash: string, now: number): Promise<ContinueResult> {
    if (!isHexHash(handleHash)) return { ok: false, code: "not_found" };
    const state = newSecret();
    const binder = newToken("flow");
    const [stateHash, binderHash] = await Promise.all([sha256Hex(state), sha256Hex(binder)]);
    return this.write(now, () => continueApp(this.db, handleHash, { state, stateHash, binder, binderHash }, now));
  }

  async consume(stateHash: string, binderHash: string | null, now: number): Promise<ConsumeResult> {
    if (!isHexHash(stateHash)) return { ok: false, code: "not_found" };
    const b = isHexHash(binderHash) ? binderHash : null;
    return this.write(now, () => consume(this.db, stateHash, b, now));
  }

  async finish(flowId: string, outcome: LoginOutcome, admins: readonly string[], now: number): Promise<FinishResult> {
    if (!isId(flowId)) return { type: "gone" };
    const sessionId = newId();
    const cookie = await mint("web");
    const csrf = newSecret();
    return this.write(now, () => finish(this.db, flowId, outcome, { sessionId, cookie, csrf }, admins, now));
  }

  async doneView(binderHash: string, now: number): Promise<DoneView | null> {
    if (!isHexHash(binderHash)) return null;
    return this.write(now, () => doneView(this.db, binderHash, now));
  }

  async claim(loginId: string, pollVerifier: string, admins: readonly string[], now: number): Promise<ClaimResult> {
    if (!isId(loginId) || !isSecret(pollVerifier)) return { status: "not_found" };
    // 너무 이른 폴링은 SQL 없이 답한다(쓰기·읽기 0)
    if (!pollGate(this.polls, loginId, now)) return { status: "too_soon" };
    const [access, refresh] = await Promise.all([mint("access"), mint("refresh")]);
    return this.write(now, () => claim(this.db, loginId, pollVerifier, { access, refresh }, admins, now));
  }

  // ---- 세션 ----

  async check(accessHash: string, admins: readonly string[], now: number): Promise<CheckResult> {
    if (!isHexHash(accessHash)) return { ok: false, code: "invalid_token", why: null };
    return this.write(now, () => check(this.db, accessHash, admins, now));
  }

  async webCheck(cookieHash: string, admins: readonly string[], now: number): Promise<WebCheckResult> {
    if (!isHexHash(cookieHash)) return { ok: false, code: "invalid_token", why: null };
    return this.write(now, () => webCheck(this.db, cookieHash, admins, now));
  }

  async rotate(refreshHash: string, admins: readonly string[], now: number): Promise<RotateResult> {
    if (!isHexHash(refreshHash)) return { ok: false, code: "session_expired", why: null, reuseDetected: false };
    const [access, refresh] = await Promise.all([mint("access"), mint("refresh")]);
    return this.write(now, () => rotate(this.db, refreshHash, { access, refresh }, admins, now));
  }

  async logout(accessHash: string | null, refreshHash: string | null, now: number): Promise<void> {
    const a = isHexHash(accessHash) ? accessHash : null;
    const r = isHexHash(refreshHash) ? refreshHash : null;
    if (a === null && r === null) return;
    await this.write(now, () => logout(this.db, a, r, now));
  }

  async revoke(sessionId: string, why: "admin" | "logout", actor: string, now: number): Promise<boolean> {
    if (!isId(sessionId)) return false;
    return this.write(now, () => {
      const changed = revokeSession(this.db, sessionId, why, now);
      if (changed && why === "admin") audit(this.db, "revoke_session", actor, sessionId.slice(0, 6), now);
      return changed;
    });
  }

  async revokeMine(channelId: string, sessionId: string, now: number): Promise<boolean> {
    if (!isId(sessionId) || !CHANNEL_ID.test(channelId)) return false;
    return this.write(now, () => revokeMine(this.db, channelId, sessionId, now));
  }

  async mySessions(channelId: string, now: number): Promise<MySessionView[]> {
    if (!CHANNEL_ID.test(channelId)) return [];
    return this.write(now, () => mySessions(this.db, channelId, now));
  }

  // ---- 관리 ----

  async adminView(now: number): Promise<AdminView> {
    return this.write(now, () => adminView(this.db, now));
  }

  async allow(channelId: string, note: string, by: string, now: number): Promise<AllowResult> {
    return this.write(now, () => allow(this.db, channelId, note, by, now));
  }

  async allowDenied(channelId: string, by: string, now: number): Promise<boolean> {
    return this.write(now, () => allowDenied(this.db, channelId, by, now));
  }

  async disallow(channelId: string, by: string, admins: readonly string[], now: number): Promise<DisallowResult> {
    return this.write(now, () => disallow(this.db, channelId, by, admins, now));
  }

  async dismissDenied(channelId: string, by: string, now: number): Promise<boolean> {
    return this.write(now, () => dismissDenied(this.db, channelId, by, now));
  }
}
