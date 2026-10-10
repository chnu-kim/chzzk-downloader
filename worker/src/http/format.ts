// 화면 표시 형식(docs/design/worker.md 구현 중 변경 38 (바), docs/design/system/content.md D49).
// 시각은 KST(UTC+9)의 12시간 표기 `2026. 10. 3. 오후 9:00`, 날짜만은 `2026. 10. 3.`(끝 마침표 포함)이다.
// 앱 format(`app/src/lib/format/date.ts`)과 같은 골든(design/format/date.json·datetime.json)을 vitest가 읽는다.
import type { AuditAction } from "../store/types";
import { COPY } from "./copy";

export const KST_OFFSET_MS = 9 * 3_600_000;

/** 벽시계 시각(시간대 없음). mo는 1~12 */
export interface Wall {
  readonly y: number;
  readonly mo: number;
  readonly d: number;
  readonly h: number;
  readonly mi: number;
}

/** epoch ms → KST 벽시계 */
export function kstWall(ms: number): Wall {
  const t = new Date(ms + KST_OFFSET_MS);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes() };
}

/** `2026. 10. 3.`(끝 마침표 포함) */
export function formatDate(w: Wall): string {
  return `${w.y}. ${w.mo}. ${w.d}.`;
}

/** `2026. 10. 3. 오후 9:00`(0시는 오전 12:00, 12시는 오후 12:00) */
export function formatDateTime(w: Wall): string {
  const ampm = w.h < 12 ? "오전" : "오후";
  return `${formatDate(w)} ${ampm} ${w.h % 12 || 12}:${String(w.mi).padStart(2, "0")}`;
}

/** 날짜와 시각을 두 덩어리로(표 칸에서 날짜·시각 사이에서만 줄이 바뀌게 한다). `kst`와 같은 글자다 */
export function kstParts(ms: number): { readonly date: string; readonly time: string } {
  const w = kstWall(ms);
  return { date: formatDate(w), time: formatDateTime(w).slice(formatDate(w).length + 1) };
}

/** 날짜와 시각 */
export function kst(ms: number): string {
  return formatDateTime(kstWall(ms));
}

/** 날짜만 */
export function kstDate(ms: number): string {
  return formatDate(kstWall(ms));
}

export function kindLabel(kind: "app" | "web"): string {
  return kind === "app" ? COPY.kindApp : COPY.kindWeb;
}

export function auditLabel(a: AuditAction): string {
  return COPY.audit[a];
}
