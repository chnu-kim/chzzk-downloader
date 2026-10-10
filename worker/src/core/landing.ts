// 랜딩의 설치 파일 표(docs/design/worker.md §9.5, 구현 중 변경 38 (가)). 순수 함수: R2·시각을 만지지 않는다.
// 표의 행 = 소스 상수 LANDING_FILES ∩ SHA256SUMS 항목. 업데이트 전용 산출물(.app.tar.gz)과 서명(.sig)은 넣지 않는다.
import type { EntryContext } from "./entry";
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

/** 운영체제 이름(고유 명사라 문구 사본이 아니라 상수다) */
export const OS_NAME: Readonly<Record<LandingFile["os"], string>> = { macos: "macOS", windows: "Windows", linux: "Linux" };

/** 최소 운영체제 표시값(platform.md D1·baseline, [잠정]). 랜딩 meta 줄과 "다른 운영체제" 표가 쓴다 */
export const MIN_OS: Readonly<Record<LandingFile["os"], string>> = { macos: "macOS 13.3", windows: "Windows 10", linux: "Ubuntu 22.04" };

/** 운영체제별 큰 버튼의 주 산출물: macOS는 dmg, Windows는 setup.exe(권장), Linux는 AppImage(deb는 표에만) */
export const PRIMARY_ARTIFACT: Readonly<Record<LandingFile["os"], LandingId>> = { macos: "dmg", windows: "setup", linux: "appimage" };

/** 진입 맥락의 OS 값 → 산출물 OS. 데스크톱 세 종류만 잡히고 그 밖(other·null)은 감지 실패다 */
export function detectedOs(entry: EntryContext): LandingFile["os"] | null {
  if (entry.kind !== "desktop") return null;
  if (entry.os === "mac") return "macos";
  if (entry.os === "windows") return "windows";
  if (entry.os === "linux") return "linux";
  return null;
}

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
  return { kind: "ok", version, pubDate: kstDate(o.pub_date) };
}

const KST_OFFSET_MS = 9 * 3_600_000;

/** pub_date(RFC 3339) → KST 날짜 YYYY-MM-DD(화면 시각은 KST, 구현 중 변경 38 (바)). 모양이 틀리거나 해석할 수 없으면 null */
function kstDate(d: unknown): string | null {
  if (typeof d !== "string" || !PUB_DATE.test(d)) return null;
  const ms = Date.parse(d);
  return Number.isFinite(ms) ? new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10) : null;
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
