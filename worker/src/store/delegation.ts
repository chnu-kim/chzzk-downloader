// 편집자 위임·초대(docs/design/features/delegation.md §8, worker.md 구현 중 변경 105). 모두 동기 함수이고 시각은 now 인자다.
//
// 판정식은 partyOk 하나이고 위임·초대를 읽거나 소비하는 모든 길이 이것만 쓴다(delegation.md §8.1 3차 N3).
// 새 위임의 owner_allowed_at은 판정을 통과한 초대 행의 값을 그대로 옮긴다(allowlist를 다시 읽지 않는다: N3).
// 로그인 ID(owner_login_channel_id·editor_channel_id)가 허가 행의 키이고, 판정용 owner_channel_id는 앱이 보는 채널이다(대안 B, §8.6).
// 상수는 [잠정]이다(ADR-0009 묶음).
import { NAME_MAX, admission, clip } from "./allowlist";
import type { Db } from "./db";
import type { AcceptInviteResult, ClaimInviteResult, CreateInviteResult, DelegatedChannel, EditorView, EditorsView, InviteView, Minted, RemoveResult } from "./types";

const DAY_MS = 86_400_000;
export const INVITE_TTL_MS = 7 * DAY_MS;
export const INVITE_CLAIMED_KEEP_MS = 30 * DAY_MS;
export const EDITORS_MAX = 10;
export const DELEGATIONS_MAX = 20;
export const REVOKED_DELEGATION_KEEP_MS = 30 * DAY_MS;
export const DONE_WINDOW_MS = 120_000;

/**
 * 당사자 하나가 지금도 그 관계를 맺은 허가 세대인가(구현 중 변경 105 (라)). 세대는 허가 행이다:
 * 숫자 = 그 당사자 허가 행의 added_at이 같을 때만(관리자 여부와 상관없다), NULL = 허가 행 없는 관리자로 맺음 → 지금도 관리자이고 허가 행이 없을 때만.
 * 허가 행이 생기면 NULL 관계는 끝나므로 한 당사자 자신에게 살아 있는 세대는 늘 하나다. 반대 당사자의 NULL 세대는 재등록으로 되살아날 수 있어
 * 판정 통과 행 수는 상한(10·20)을 넘을 수 있다. 권한·목록은 그 위에 순위 상한을 더한 granted가 정한다(구현 중 변경 105 (타))
 */
export function partyOk(allowedAt: number | null, addedNow: number | null, loginId: string, admins: readonly string[]): boolean {
  if (admins.length === 0) return false;
  if (allowedAt === null) return addedNow === null && admins.includes(loginId);
  return addedNow !== null && addedNow === allowedAt;
}

/** 지금 허가 상태면 맺을 때 적을 allowed_at(허가 행이 있으면 관리자여도 그 added_at, 허가 행 없는 관리자는 null), 허가가 아니면 undefined. admission과 같은 규칙 */
export function allowedAtNow(db: Db, loginId: string, admins: readonly string[]): number | null | undefined {
  if (admins.length === 0) return undefined;
  const r = db.first<{ added_at: number }>("SELECT added_at FROM allowlist WHERE channel_id = ?", loginId);
  if (r !== null) return r.added_at;
  return admins.includes(loginId) ? null : undefined;
}

export type InviteRow = {
  token_hash: string;
  owner_channel_id: string;
  owner_login_channel_id: string;
  owner_name: string | null;
  owner_allowed_at: number | null;
  created_at: number;
  expires_at: number;
  claimed_channel_id: string | null;
  claimed_name: string | null;
  claimed_at: number | null;
  owner_added: number | null;
  owner_judge: string;
  claim_traced: number;
};
export type DelegationRow = {
  owner_channel_id: string;
  owner_login_channel_id: string;
  editor_channel_id: string;
  owner_name: string | null;
  editor_name: string | null;
  owner_allowed_at: number | null;
  editor_allowed_at: number | null;
  created_at: number;
  owner_added: number | null;
  editor_added: number | null;
  owner_judge: string;
};

/**
 * 청구 흔적(구현 중 변경 105 (아)): 청구자의 거부 기록이 청구 때부터 이어진다(first_at <= claimed_at).
 * 허가는 V2·V3 모두 같은 트랜잭션에서 거부 기록을 지우고 거부 기록의 first_at은 새 행을 만들 때의 시각이므로,
 * 흔적이 있으면 청구 뒤 그 채널은 한 번도 허가되지 않았다. 흔적이 끊긴 청구(허가·제외를 거침, 거부 기록 닫기·상한 밀림·청소)는 죽은 청구다
 */
export const CLAIM_TRACED = "EXISTS (SELECT 1 FROM denied dn WHERE dn.channel_id = i.claimed_channel_id AND dn.first_at <= i.claimed_at)";
// 초대 + 주인 허가 행의 지금 added_at·지금 판정용 ID + 청구 흔적. owner_judge는 admission의 ownerChannelId와 같은 규칙이다(행이 없으면 로그인 ID)
const INVITE_SELECT = `SELECT i.token_hash, i.owner_channel_id, i.owner_login_channel_id, i.owner_name, i.owner_allowed_at, i.created_at, i.expires_at, i.claimed_channel_id, i.claimed_name, i.claimed_at, a.added_at AS owner_added, COALESCE(a.owner_channel_id, i.owner_login_channel_id) AS owner_judge, ${CLAIM_TRACED} AS claim_traced FROM invite i LEFT JOIN allowlist a ON a.channel_id = i.owner_login_channel_id`;
// 회수되지 않은 위임 + 두 당사자 허가 행의 지금 added_at + 주인의 지금 판정용 ID
const LIVE_SELECT =
  "SELECT d.owner_channel_id, d.owner_login_channel_id, d.editor_channel_id, d.owner_name, d.editor_name, d.owner_allowed_at, d.editor_allowed_at, d.created_at, ao.added_at AS owner_added, ae.added_at AS editor_added, COALESCE(ao.owner_channel_id, d.owner_login_channel_id) AS owner_judge FROM delegation d LEFT JOIN allowlist ao ON ao.channel_id = d.owner_login_channel_id LEFT JOIN allowlist ae ON ae.channel_id = d.editor_channel_id WHERE d.revoked_at IS NULL";

/** 주인 쪽 판정: partyOk ∧ 맺을 때의 판정용 ID가 지금 지정과 같다(손 SQL로 대안 B 지정을 바꾸면 옛 관계는 무효, 구현 중 변경 105 (라)) */
function ownerOk(r: { owner_allowed_at: number | null; owner_added: number | null; owner_login_channel_id: string; owner_channel_id: string; owner_judge: string }, admins: readonly string[]): boolean {
  return r.owner_judge === r.owner_channel_id && partyOk(r.owner_allowed_at, r.owner_added, r.owner_login_channel_id, admins);
}
/** 초대의 판정식 inviteValid(delegation.md §8.1 3차): 미만료 ∧ 주인 쪽 판정 ∧ (미청구 ∨ 청구 흔적) */
export function inviteValid(r: InviteRow, admins: readonly string[], now: number): boolean {
  return r.expires_at > now && ownerOk(r, admins) && (r.claimed_channel_id === null || r.claim_traced === 1);
}
/** 활성 위임: 회수 안 됨(쿼리가 거른다) ∧ 주인 쪽 판정 ∧ 편집자 partyOk(편집자에게는 판정용 ID가 없다) */
export function delegationActive(r: DelegationRow, admins: readonly string[]): boolean {
  return ownerOk(r, admins) && partyOk(r.editor_allowed_at, r.editor_added, r.editor_channel_id, admins);
}

// 규칙: 상한은 SQL에 두지 않는다. 후보를 다 읽고 JS에서 판정한 뒤 자른다(무효 행이 유효 행을 밀어내지 않게).
// 한 채널의 행 수는 상한(10·20)과 30일 청소로 묶인다. 예외는 청소가 지우지 않는 허가 행 없는 옛 관리자의 NULL 행뿐이다(구현 중 변경 105 (마)·(타)).

function inviteByHash(db: Db, hash: string): InviteRow | null {
  return db.first<InviteRow>(`${INVITE_SELECT} WHERE i.token_hash = ?`, hash);
}

function dropInvite(db: Db, hash: string): void {
  db.run("DELETE FROM invite WHERE token_hash = ?", hash);
}

type Pending = EditorView & { readonly tokenHash: string };

/** 주인의 판정 통과 위임 행(created_at, editor_channel_id 오름차순) */
function ownerRows(db: Db, ownerChannelId: string, admins: readonly string[]): DelegationRow[] {
  return db.all<DelegationRow>(`${LIVE_SELECT} AND d.owner_channel_id = ? ORDER BY d.created_at, d.editor_channel_id`, ownerChannelId).filter((r) => delegationActive(r, admins));
}
/** 편집자의 판정 통과 위임 행(created_at, owner_channel_id 오름차순) */
function editorRows(db: Db, editorLoginId: string, admins: readonly string[]): DelegationRow[] {
  return db.all<DelegationRow>(`${LIVE_SELECT} AND d.editor_channel_id = ? ORDER BY d.created_at, d.owner_channel_id`, editorLoginId).filter((r) => delegationActive(r, admins));
}

/**
 * 권한이 나가는 위임(구현 중 변경 105 (타)): 판정 통과 ∧ 주인 쪽 순위 < EDITORS_MAX ∧ 편집자 쪽 순위 < DELEGATIONS_MAX.
 * 두 순위는 판정 통과 행에서 센다(순환 없음). 반대 당사자의 NULL 세대가 되살아나 한쪽이 상한을 넘어도
 * 권한을 받는 쪽과 목록에 보이는 쪽이 같은 규칙이라 어긋나지 않고, 넘친 가장 늦은 관계는 양쪽 모두에서 잠든다(닫힌 쪽)
 */
function granted(db: Db, r: DelegationRow, admins: readonly string[]): boolean {
  const o = ownerRows(db, r.owner_channel_id, admins).findIndex((x) => x.editor_channel_id === r.editor_channel_id);
  const e = editorRows(db, r.editor_channel_id, admins).findIndex((x) => x.owner_channel_id === r.owner_channel_id);
  return o >= 0 && o < EDITORS_MAX && e >= 0 && e < DELEGATIONS_MAX;
}

/**
 * 주인의 판정 통과 편집자(active, 상한 셈용) + 권한이 나가는 편집자(shown, 목록용) + 기다리는 편집자(유효한 청구 초대, 판정 통과 편집자와 같은 채널은 뺀다)
 * + 유효한 미청구 초대 만료(최댓값 또는 null). 상한 셈과 editorsOf가 같이 쓴다
 */
function ownerSide(db: Db, ownerChannelId: string, admins: readonly string[], now: number): { active: EditorView[]; shown: EditorView[]; pending: Pending[]; openUntil: number | null } {
  const active: EditorView[] = [];
  const shown: EditorView[] = [];
  for (const r of ownerRows(db, ownerChannelId, admins)) {
    const v: EditorView = { channelId: r.editor_channel_id, channelName: r.editor_name ?? "", since: r.created_at, status: "active" };
    active.push(v);
    if (granted(db, r, admins)) shown.push(v);
  }
  const pending: Pending[] = [];
  let openUntil: number | null = null;
  for (const r of db.all<InviteRow>(`${INVITE_SELECT} WHERE i.owner_channel_id = ? ORDER BY i.claimed_at, i.token_hash`, ownerChannelId)) {
    if (!inviteValid(r, admins, now)) continue;
    if (r.claimed_channel_id === null) {
      openUntil = openUntil === null ? r.expires_at : Math.max(openUntil, r.expires_at);
      continue;
    }
    const who = r.claimed_channel_id;
    if (active.some((a) => a.channelId === who) || pending.some((p) => p.channelId === who)) continue;
    pending.push({ channelId: who, channelName: r.claimed_name ?? "", since: r.claimed_at ?? r.created_at, status: "pending", tokenHash: r.token_hash });
  }
  return { active, shown, pending, openUntil };
}

const toDelegated = (r: DelegationRow): DelegatedChannel => ({ channelId: r.owner_channel_id, channelName: r.owner_name ?? "", since: r.created_at });

/** 편집자의 판정 통과 위임(상한 셈용). 권한이 나가는 것은 delegationsOf다 */
function editorSide(db: Db, editorLoginId: string, admins: readonly string[]): DelegatedChannel[] {
  return editorRows(db, editorLoginId, admins).map(toDelegated);
}

/** 같은 주인·편집자 쌍의 청구를 모두 지운다(수락·자동 완성·그만두기·빼기 뒤 남은 청구가 위임을 되살리지 않게) */
function dropPairClaims(db: Db, ownerChannelId: string, editorId: string): void {
  db.run("DELETE FROM invite WHERE owner_channel_id = ? AND claimed_channel_id = ?", ownerChannelId, editorId);
}

/** 위임 upsert(되살림 포함): 회수된 행·무효 행 위에 덮어쓰고 created_at = now, revoked_* = NULL */
function upsertDelegation(
  db: Db,
  d: { ownerChannelId: string; ownerLoginId: string; editorId: string; ownerName: string | null; editorName: string; ownerAllowedAt: number | null; editorAllowedAt: number | null },
  now: number,
): void {
  db.run(
    `INSERT INTO delegation (owner_channel_id, owner_login_channel_id, editor_channel_id, owner_name, editor_name, owner_allowed_at, editor_allowed_at, created_at, revoked_at, revoked_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
     ON CONFLICT(owner_channel_id, editor_channel_id) DO UPDATE SET owner_login_channel_id = excluded.owner_login_channel_id, owner_name = excluded.owner_name,
       editor_name = excluded.editor_name, owner_allowed_at = excluded.owner_allowed_at, editor_allowed_at = excluded.editor_allowed_at,
       created_at = excluded.created_at, revoked_at = NULL, revoked_by = NULL`,
    d.ownerChannelId,
    d.ownerLoginId,
    d.editorId,
    d.ownerName,
    d.editorName,
    d.ownerAllowedAt,
    d.editorAllowedAt,
    now,
  );
}

/** 초대 만들기. 판정용 주인 ID는 입력으로 받지 않고 admission(로그인 ID)으로 구한다(구현 중 변경 105 (사)) */
export function createInvite(db: Db, o: { ownerLoginId: string; ownerName: string; invite: Minted }, admins: readonly string[], now: number): CreateInviteResult {
  const adm = admission(db, o.ownerLoginId, admins);
  const allowedAt = allowedAtNow(db, o.ownerLoginId, admins);
  if (!adm.allowed || allowedAt === undefined) return { ok: false, code: "not_allowed" };
  const s = ownerSide(db, adm.ownerChannelId, admins, now);
  if (s.active.length + s.pending.length >= EDITORS_MAX) return { ok: false, code: "limit" };
  // 그 주인의 미청구 초대는 유효·무효와 상관없이 모두 대체한다
  db.run("DELETE FROM invite WHERE owner_channel_id = ? AND claimed_channel_id IS NULL", adm.ownerChannelId);
  db.run(
    "INSERT INTO invite (token_hash, owner_channel_id, owner_login_channel_id, owner_name, owner_allowed_at, created_at, expires_at, claimed_channel_id, claimed_name, claimed_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)",
    o.invite.hash,
    adm.ownerChannelId,
    o.ownerLoginId,
    clip(o.ownerName, NAME_MAX),
    allowedAt,
    now,
    now + INVITE_TTL_MS,
  );
  return { ok: true, token: o.invite.token, expiresAt: now + INVITE_TTL_MS };
}

/** 초대 페이지가 보는 상태. 쓰기 0(무효 초대도 지우지 않는다: 보기만 하는 요청은 상태를 바꾸지 않는다) */
export function inviteView(db: Db, hash: string, viewerLoginId: string | null, admins: readonly string[], now: number): InviteView | null {
  const r = inviteByHash(db, hash);
  if (r === null || !inviteValid(r, admins, now) || r.claimed_channel_id !== null) return null;
  const s = ownerSide(db, r.owner_channel_id, admins, now);
  const ownerFull = s.active.length + s.pending.length >= EDITORS_MAX;
  let relation: InviteView["relation"] = ownerFull ? "full" : "open";
  if (viewerLoginId !== null) {
    const adm = admission(db, viewerLoginId, admins);
    if (r.owner_channel_id === adm.ownerChannelId || r.owner_login_channel_id === viewerLoginId) relation = "own";
    else if (s.active.some((a) => a.channelId === viewerLoginId)) relation = "already";
    else if (ownerFull || editorSide(db, viewerLoginId, admins).length >= DELEGATIONS_MAX) relation = "full";
    else relation = "open";
  }
  return { ownerChannelId: r.owner_channel_id, ownerName: r.owner_name ?? "", expiresAt: r.expires_at, relation };
}

/** startWebInvite가 쓴다: 지금 열 수 있는(미청구·유효) 초대인가 */
export function inviteOpen(db: Db, hash: string, admins: readonly string[], now: number): boolean {
  return inviteView(db, hash, null, admins, now) !== null;
}

/** 수락. 판정 순서가 테스트로 고정돼 있다 */
export function acceptInvite(db: Db, hash: string, editorLoginId: string, editorName: string, admins: readonly string[], now: number): AcceptInviteResult {
  const r = inviteByHash(db, hash);
  if (r === null) return { ok: false, code: "gone" };
  if (!inviteValid(r, admins, now)) {
    dropInvite(db, hash);
    return { ok: false, code: "gone" };
  }
  if (r.claimed_channel_id !== null && r.claimed_channel_id !== editorLoginId) return { ok: false, code: "gone" };
  const adm = admission(db, editorLoginId, admins);
  const editorAllowedAt = allowedAtNow(db, editorLoginId, admins);
  if (!adm.allowed || editorAllowedAt === undefined) return { ok: false, code: "not_allowed" };
  if (r.owner_channel_id === adm.ownerChannelId || r.owner_login_channel_id === editorLoginId) return { ok: false, code: "own" };
  const live = db.first<DelegationRow>(`${LIVE_SELECT} AND d.owner_channel_id = ? AND d.editor_channel_id = ?`, r.owner_channel_id, editorLoginId);
  // 이미 편집자면 초대를 남긴다: 링크는 다른 사람에게 보낸 것일 수 있고, 지우면 기존 편집자가 남의 초대를 없앨 수 있다(106 (차) ④, 105 (아)를 뒤집음)
  if (live !== null && delegationActive(live, admins)) return { ok: false, code: "already" };
  const s = ownerSide(db, r.owner_channel_id, admins, now);
  const pendingOthers = s.pending.filter((p) => p.tokenHash !== r.token_hash && p.channelId !== editorLoginId).length;
  if (s.active.length + pendingOthers >= EDITORS_MAX || editorSide(db, editorLoginId, admins).length >= DELEGATIONS_MAX) return { ok: false, code: "full" };
  // 주인의 허가 시각은 판정을 통과한 초대 행의 값을 그대로 옮긴다: 다시 읽으면 되돌린 동안의 제외·재허가를 새 허가로 오인한다(N3)
  upsertDelegation(
    db,
    {
      ownerChannelId: r.owner_channel_id,
      ownerLoginId: r.owner_login_channel_id,
      editorId: editorLoginId,
      ownerName: r.owner_name,
      editorName: clip(editorName, NAME_MAX),
      ownerAllowedAt: r.owner_allowed_at,
      editorAllowedAt,
    },
    now,
  );
  dropInvite(db, hash);
  dropPairClaims(db, r.owner_channel_id, editorLoginId);
  return { ok: true, ownerChannelId: r.owner_channel_id, ownerName: r.owner_name ?? "" };
}

/** 거부 채널의 콜백이 초대를 청구한다(finish만 부른다) */
export function claimInvite(db: Db, hash: string, channelId: string, name: string, admins: readonly string[], now: number): ClaimInviteResult {
  const r = inviteByHash(db, hash);
  if (r === null) return { ok: false, code: "gone" };
  if (!inviteValid(r, admins, now)) {
    dropInvite(db, hash);
    return { ok: false, code: "gone" };
  }
  const cleaned = clip(name, NAME_MAX);
  if (r.claimed_channel_id === channelId) {
    db.run("UPDATE invite SET claimed_name = ? WHERE token_hash = ? AND claimed_name IS NOT ?", cleaned, hash, cleaned);
    return { ok: true, ownerName: r.owner_name ?? "" };
  }
  if (r.claimed_channel_id !== null) return { ok: false, code: "gone" };
  const s = ownerSide(db, r.owner_channel_id, admins, now);
  if (s.active.length + s.pending.length >= EDITORS_MAX) return { ok: false, code: "full" };
  db.run("DELETE FROM invite WHERE owner_channel_id = ? AND claimed_channel_id = ? AND token_hash <> ?", r.owner_channel_id, channelId, hash);
  db.run("UPDATE invite SET claimed_channel_id = ?, claimed_name = ?, claimed_at = ?, expires_at = ? WHERE token_hash = ?", channelId, cleaned, now, now + INVITE_CLAIMED_KEEP_MS, hash);
  return { ok: true, ownerName: r.owner_name ?? "" };
}

/** 그 채널의 청구 중 흔적이 있는 것의 해시. 허가가 거부 기록을 지우기 전에 같은 트랜잭션에서 읽어 completeClaimed에 넘긴다 */
export function tracedClaims(db: Db, channelId: string): string[] {
  return db.all<{ token_hash: string }>(`SELECT i.token_hash FROM invite i WHERE i.claimed_channel_id = ? AND ${CLAIM_TRACED}`, channelId).map((r) => r.token_hash);
}

/**
 * 관리자 [허가] 뒤 그 채널이 청구한 초대를 위임으로 바꾼다(AuthStore allow·allowDenied가 같은 트랜잭션에서 부른다). 만든 위임 수를 돌려준다.
 * traced = 허가 쓰기 전에 읽은 tracedClaims: 허가가 거부 기록을 지웠으므로 여기서 다시 보면 모든 청구가 흔적 없음이다. 흔적 없는 청구는 지운다.
 * 편집자의 허가 시각은 지금 허가 행의 added_at이다(now를 쓰지 않는다)
 */
export function completeClaimed(db: Db, channelId: string, traced: readonly string[], admins: readonly string[], now: number): number {
  const editorAllowedAt = allowedAtNow(db, channelId, admins);
  if (editorAllowedAt === undefined) return 0;
  const adm = admission(db, channelId, admins);
  let made = 0;
  for (const row of db.all<InviteRow>(`${INVITE_SELECT} WHERE i.claimed_channel_id = ? ORDER BY i.claimed_at, i.token_hash`, channelId)) {
    if (!traced.includes(row.token_hash) || !inviteValid({ ...row, claim_traced: 1 }, admins, now)) {
      dropInvite(db, row.token_hash);
      continue;
    }
    if (row.owner_login_channel_id === channelId || row.owner_channel_id === adm.ownerChannelId) {
      dropInvite(db, row.token_hash);
      continue;
    }
    const s = ownerSide(db, row.owner_channel_id, admins, now);
    // 이 초대 자신은 기다리는 편집자로 이미 세어져 있다(§0 K)
    const others = s.pending.filter((p) => p.tokenHash !== row.token_hash).length;
    if (s.active.length + others >= EDITORS_MAX || editorSide(db, channelId, admins).length >= DELEGATIONS_MAX) {
      dropInvite(db, row.token_hash);
      continue;
    }
    upsertDelegation(
      db,
      {
        ownerChannelId: row.owner_channel_id,
        ownerLoginId: row.owner_login_channel_id,
        editorId: channelId,
        ownerName: row.owner_name,
        editorName: row.claimed_name ?? "",
        ownerAllowedAt: row.owner_allowed_at,
        editorAllowedAt,
      },
      now,
    );
    dropPairClaims(db, row.owner_channel_id, channelId);
    made++;
  }
  return made;
}

/** 거부 페이지 한 줄: 그 해시의 초대를 claimedBy가 청구했고 inviteValid면 주인 이름(없으면 ""), 아니면 null. 쓰기 0 */
export function claimedInviteOwner(db: Db, hash: string, claimedBy: string, admins: readonly string[], now: number): string | null {
  const r = inviteByHash(db, hash);
  if (r === null || r.claimed_channel_id !== claimedBy || !inviteValid(r, admins, now)) return null;
  return r.owner_name ?? "";
}

/** 관리 꼬리표: 그 채널이 청구한 초대 중 inviteValid인 첫 초대(claimed_at, token_hash 순)의 주인 이름, 없으면 null. 쓰기 0 */
export function invitedBy(db: Db, channelId: string, admins: readonly string[], now: number): string | null {
  for (const r of db.all<InviteRow>(`${INVITE_SELECT} WHERE i.claimed_channel_id = ? ORDER BY i.claimed_at, i.token_hash`, channelId)) {
    if (inviteValid(r, admins, now)) return r.owner_name ?? "";
  }
  return null;
}

/**
 * 완료 페이지: 이 편집자와 그 주인(판정용 ID)의 위임이 권한이 나가고 방금(DONE_WINDOW_MS 안에) 맺어졌으면 그 위임, 아니면 null. 쓰기 0.
 * 주인을 인자로 받는다: 전체 중 최신 하나를 고르면 두 탭에서 다른 초대를 수락했을 때 다른 수락의 결과를 보인다(106 (차) ③)
 */
export function recentDelegationFor(db: Db, editorLoginId: string, ownerChannelId: string, admins: readonly string[], now: number): DelegatedChannel | null {
  return delegationsOf(db, editorLoginId, admins).find((d) => d.channelId === ownerChannelId && d.since > now - DONE_WINDOW_MS) ?? null;
}

/** 권한이 나가는 맡은 채널(granted). 토큰 묶음·me·완료 페이지가 쓴다 */
export function delegationsOf(db: Db, editorLoginId: string, admins: readonly string[]): DelegatedChannel[] {
  return editorRows(db, editorLoginId, admins)
    .slice(0, DELEGATIONS_MAX)
    .filter((r) => granted(db, r, admins))
    .map(toDelegated);
}

export function editorsOf(db: Db, ownerChannelId: string, admins: readonly string[], now: number): EditorsView {
  const s = ownerSide(db, ownerChannelId, admins, now);
  const waiting: EditorView[] = s.pending.map(({ tokenHash: _t, ...e }) => e);
  return { editors: [...s.shown, ...waiting].slice(0, EDITORS_MAX), pendingInviteUntil: s.openUntil };
}

/** 주인이 편집자를 뺀다(활성 위임 회수 + 기다리는 초대 지움). 판정식은 보지 않는다: 무효 행이어도 회수로 닫는 것이 맞다 */
export function removeEditor(db: Db, ownerChannelId: string, editorChannelId: string, now: number): RemoveResult {
  const a = db.run("UPDATE delegation SET revoked_at = ?, revoked_by = 'owner' WHERE owner_channel_id = ? AND editor_channel_id = ? AND revoked_at IS NULL", now, ownerChannelId, editorChannelId);
  const b = db.run("DELETE FROM invite WHERE owner_channel_id = ? AND claimed_channel_id = ?", ownerChannelId, editorChannelId);
  return a + b === 0 ? { ok: false, code: "not_found" } : { ok: true };
}

/** 편집자가 그만둔다. 위임 행이 없어도 같은 쌍의 청구는 지운다(빼기와 같은 규칙, 106 (차) ②): 둘 다 없을 때만 not_found */
export function leaveDelegation(db: Db, editorLoginId: string, ownerChannelId: string, now: number): RemoveResult {
  const n = db.run("UPDATE delegation SET revoked_at = ?, revoked_by = 'editor' WHERE editor_channel_id = ? AND owner_channel_id = ? AND revoked_at IS NULL", now, editorLoginId, ownerChannelId);
  const c = db.run("DELETE FROM invite WHERE owner_channel_id = ? AND claimed_channel_id = ?", ownerChannelId, editorLoginId);
  return n + c === 0 ? { ok: false, code: "not_found" } : { ok: true };
}
