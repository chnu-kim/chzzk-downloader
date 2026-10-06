// 멱등 청소(docs/design/worker.md 구현 중 변경 22). 만료된 행만 지운다: 두 번 부르면 둘째는 아무것도 지우지 않는다.
// 정확성은 청소에 기대지 않는다(모든 조회가 만료를 스스로 거른다). 외래 키가 강제되므로 refresh를 session보다 먼저 지운다.
import { AUDIT_CAP, DENIED_CAP_SQL, DENIED_KEEP_MS } from "./allowlist";
import type { Db } from "./db";

export const SWEEP_DELAY_MS = 15 * 60_000;
export const SWEEP_INTERVAL_MS = 3_600_000;
export const REVOKED_KEEP_MS = 30 * 86_400_000;

const DEAD_SESSION = "(status = 'revoked' AND revoked_at <= ?) OR (status <> 'revoked' AND expires_at <= ?)";

/** deleted = 지운 행 수, remaining = 청소할 만한 표(flow·session·denied)에 행이 남아 있는지(다음 알람 여부) */
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
  const left = db.first<{ n: number }>("SELECT (SELECT count(*) FROM flow) + (SELECT count(*) FROM session) + (SELECT count(*) FROM denied) AS n");
  return { deleted, remaining: (left?.n ?? 0) > 0 };
}
