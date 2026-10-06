// updater 판정(docs/design/worker.md §9.3, 구현 중 변경 14 (사)). GET /update/{current}의 순수 부분이다.
// 핸들러(W5)는 current를 먼저 판정하고(400이면 R2를 읽지 않는다), latest.json 바이트를 한 번 읽어 여기에 넘긴다.
//   - latest 없음 → none(204)
//   - UTF-8·JSON·version 문자열·semver 중 하나라도 틀림 → invalid_latest(500 internal + 로그 release.latest_invalid, 204로 숨기지 않는다)
//   - latest > current → update(같은 바이트 객체를 그대로 돌려준다, Worker는 플랫폼 키를 해석하지 않는다)
//   - 그 밖 → none
import { compareVersions, parseVersion, type Version } from "./semver";

/** 경로 조각(플러그인이 +를 퍼센트 인코딩한다)을 디코드해 semver로. 디코드 실패·semver 아님은 null(400) */
export function parseCurrentVersion(segment: string): Version | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return parseVersion(decoded);
}

export type UpdateDecision = { readonly kind: "update"; readonly body: Uint8Array } | { readonly kind: "none" } | { readonly kind: "invalid_latest" };

const INVALID: UpdateDecision = { kind: "invalid_latest" };
const NONE: UpdateDecision = { kind: "none" };

// UTF-8 fatal·BOM 유지(BOM이 있으면 JSON이 아니다: 앱 플러그인의 serde_json과 같이 닫힌 쪽)
function latestVersion(bytes: Uint8Array): Version | null {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    return null;
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  const v = (json as Record<string, unknown>).version;
  return typeof v === "string" ? parseVersion(v) : null;
}

export function decideUpdate(latest: Uint8Array | null, current: Version): UpdateDecision {
  if (latest === null) return NONE;
  const v = latestVersion(latest);
  if (v === null) return INVALID;
  return compareVersions(v, current) > 0 ? { kind: "update", body: latest } : NONE;
}
