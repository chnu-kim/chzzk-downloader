// 랜딩의 설치 파일 표(docs/design/worker.md §9.5, 구현 중 변경 35 (가)). 순수 함수: R2·시각을 만지지 않는다.
// 표의 행 = 소스 상수 LANDING_FILES ∩ SHA256SUMS 항목. 업데이트 전용 산출물(.app.tar.gz)과 서명(.sig)은 넣지 않는다.
import { parseVersion } from "./semver";

export type LandingId = "dmg" | "setup" | "msi" | "appimage" | "deb";
export interface LandingFile {
  readonly id: LandingId;
  readonly os: "macos" | "windows" | "linux";
  /** 산출물 이름에서 `chzzk-downloader_<버전>_` 뒤의 부분(release/expected-artifacts.json의 name) */
  readonly name: string;
}

export const LANDING_FILES: readonly LandingFile[] = [
  { id: "dmg", os: "macos", name: "darwin-aarch64.dmg" },
  { id: "setup", os: "windows", name: "windows-x86_64-setup.exe" },
  { id: "msi", os: "windows", name: "windows-x86_64.msi" },
  { id: "appimage", os: "linux", name: "linux-x86_64.AppImage" },
  { id: "deb", os: "linux", name: "linux-x86_64.deb" },
];

export const ARTIFACT_PREFIX = "chzzk-downloader";

export function artifactFile(version: string, name: string): string {
  return `${ARTIFACT_PREFIX}_${version}_${name}`;
}

export type LatestView =
  | { readonly kind: "none" }
  | { readonly kind: "invalid" }
  | { readonly kind: "ok"; readonly version: string; readonly pubDate: string | null };

const PUB_DATE = /^\d{4}-\d{2}-\d{2}T/;

/** latest.json 바이트 → 표시용 요약. null = 파일 없음, 해석할 수 없으면 invalid. version은 받은 문자열 그대로 둔다 */
export function parseLatestView(bytes: Uint8Array | null): LatestView {
  if (bytes === null) return { kind: "none" };
  let v: unknown;
  try {
    v = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    return { kind: "invalid" };
  }
  if (v === null || typeof v !== "object" || Array.isArray(v)) return { kind: "invalid" };
  const o = v as Record<string, unknown>;
  const version = o.version;
  if (typeof version !== "string" || parseVersion(version) === null) return { kind: "invalid" };
  const d = o.pub_date;
  return { kind: "ok", version, pubDate: typeof d === "string" && PUB_DATE.test(d) ? d.slice(0, 10) : null };
}

export interface LandingRow {
  readonly id: LandingId;
  readonly file: string;
  readonly sha256: string;
}

/** LANDING_FILES 순서로, SHA256SUMS에 있는 것만 */
export function landingRows(version: string, sums: ReadonlyMap<string, string>): LandingRow[] {
  const rows: LandingRow[] = [];
  for (const f of LANDING_FILES) {
    const file = artifactFile(version, f.name);
    const sha256 = sums.get(file);
    if (sha256 !== undefined) rows.push({ id: f.id, file, sha256 });
  }
  return rows;
}
