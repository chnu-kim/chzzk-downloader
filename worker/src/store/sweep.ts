// 멱등 청소(docs/design/worker.md 구현 중 변경 22). 만료된 행만 지운다: 두 번 부르면 둘째는 아무것도 지우지 않는다.
// 정확성은 청소에 기대지 않는다(모든 조회가 만료를 스스로 거른다). 외래 키가 강제되므로 refresh를 session보다 먼저 지운다.
import { AUDIT_CAP, DENIED_CAP_SQL, DENIED_KEEP_MS } from "./allowlist";
import type { Db } from "./db";
import { CLAIM_TRACED, REVOKED_DELEGATION_KEEP_MS } from "./delegation";

export const SWEEP_DELAY_MS = 15 * 60_000;
export const SWEEP_INTERVAL_MS = 3_600_000;
export const REVOKED_KEEP_MS = 30 * 86_400_000;

const DEAD_SESSION = "(status = 'revoked' AND revoked_at <= ?) OR (status <> 'revoked' AND expires_at <= ?)";

/** deleted = 지운 행 수, remaining = 청소할 만한 표(flow·session·denied·invite·회수된 위임)에 행이 남아 있는지(다음 알람 여부) */
export function sweep(db: Db, now: number): { readonly deleted: number; readonly remaining: boolean } {
  const revokedBefore = now - REVOKED_KEEP_MS;
  let deleted = 0;
  deleted += db.run("DELETE FROM flow WHERE expires_at <= ?", now);
  deleted += db.run(`DELETE FROM refresh WHERE session_id IN (SELECT id FROM session WHERE ${DEAD_SESSION})`, revokedBefore, now);
  deleted += db.run(`DELETE FROM session WHERE ${DEAD_SESSION}`, revokedBefore, now);
  deleted += db.run("DELETE FROM refresh WHERE expires_at <= ?", now);
  deleted += db.run("DELETE FROM denied WHERE last_at <= ?", now - DENIED_KEEP_MS);
  deleted += db.run(DENIED_CAP_SQL);
  deleted += db.run(`DELETE FROM audit WHERE id IN (SELECT id FROM audit ORDER BY id DESC LIMIT -1 OFFSET ${AUDIT_CAP})`);
  deleted += db.run("DELETE FROM invite WHERE expires_at <= ?", now);
  deleted += db.run("DELETE FROM delegation WHERE revoked_at IS NOT NULL AND revoked_at <= ?", now - REVOKED_DELEGATION_KEEP_MS);
  // 허가 시각이나 주인의 판정용 ID가 어긋난 행(허가 행 없는 관리자로 맺은 NULL 행은 admins를 모르므로 읽는 쪽 판정에 맡긴다, 구현 중 변경 105 (라)(마)).
  // 안쪽 a는 늘 있는 행이라 판정용 ID를 channel_id로 메워도 된다(admission과 같은 규칙)
  deleted += db.run(
    "DELETE FROM delegation WHERE (owner_allowed_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM allowlist a WHERE a.channel_id = delegation.owner_login_channel_id AND a.added_at = delegation.owner_allowed_at AND COALESCE(a.owner_channel_id, a.channel_id) = delegation.owner_channel_id)) OR (editor_allowed_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM allowlist a WHERE a.channel_id = delegation.editor_channel_id AND a.added_at = delegation.editor_allowed_at))",
  );
  // 허가 행 없는 관리자로 맺은 NULL 당사자에게 허가 행이 생겼으면 그 관계는 admins와 상관없이 끝났다(partyOk)
  deleted += db.run(
    "DELETE FROM delegation WHERE (owner_allowed_at IS NULL AND EXISTS (SELECT 1 FROM allowlist a WHERE a.channel_id = delegation.owner_login_channel_id)) OR (editor_allowed_at IS NULL AND EXISTS (SELECT 1 FROM allowlist a WHERE a.channel_id = delegation.editor_channel_id))",
  );
  deleted += db.run("DELETE FROM invite WHERE owner_allowed_at IS NULL AND EXISTS (SELECT 1 FROM allowlist a WHERE a.channel_id = invite.owner_login_channel_id)");
  // 흔적이 끊긴 청구는 다시 이어지지 않는다(새 거부 기록의 first_at은 청구보다 늦다)
  deleted += db.run(`DELETE FROM invite AS i WHERE i.claimed_channel_id IS NOT NULL AND NOT ${CLAIM_TRACED}`);
  deleted += db.run(
    "DELETE FROM invite WHERE owner_allowed_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM allowlist a WHERE a.channel_id = invite.owner_login_channel_id AND a.added_at = invite.owner_allowed_at AND COALESCE(a.owner_channel_id, a.channel_id) = invite.owner_channel_id)",
  );
  // 활성 위임은 세지 않는다(세면 알람이 영원히 1시간마다 돈다)
  const left = db.first<{ n: number }>(
    "SELECT (SELECT count(*) FROM flow) + (SELECT count(*) FROM session) + (SELECT count(*) FROM denied) + (SELECT count(*) FROM invite) + (SELECT count(*) FROM delegation WHERE revoked_at IS NOT NULL) AS n",
  );
  return { deleted, remaining: (left?.n ?? 0) > 0 };
}
