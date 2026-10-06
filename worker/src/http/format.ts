// 화면 표시 형식(docs/design/worker.md 구현 중 변경 35 (바)). 시각은 KST(UTC+9) `YYYY-MM-DD HH:MM`이다.
import type { AuditAction } from "../store/types";
import { COPY } from "./copy";

export const KST_OFFSET_MS = 9 * 3_600_000;

export function kst(ms: number): string {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");
}

export function kindLabel(kind: "app" | "web"): string {
  return kind === "app" ? COPY.kindApp : COPY.kindWeb;
}

export function auditLabel(a: AuditAction): string {
  return COPY.audit[a];
}
