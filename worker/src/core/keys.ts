// /releases 경로 문법·보이는 키·SHA256SUMS 해석(docs/design/worker.md §9.1, 구현 중 변경 14 (라)).
// 문법은 설계 정규식 두 줄 그대로(대소문자 정확 일치, % 불가)에 셋을 더한다: 경로에 .. 없음, file ≠ ".", version은 semver.
// SHA256SUMS 해석은 xtask manifest::parse_sums와 같은 규칙이고, 틀리면 null(사용자에게는 META만 보인다, 닫힌 쪽).
import { parseVersion } from "./semver";

export type ReleasePath =
  | { readonly kind: "latest"; readonly key: "releases/latest.json" }
  | { readonly kind: "file"; readonly version: string; readonly file: string; readonly key: string };

const LATEST = /^\/releases\/latest\.json$/;
const FILE = /^\/releases\/(?<v>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\/(?<f>[A-Za-z0-9._-]{1,128})$/;

/** 사용자(A·W)에게 늘 보이는 메타 파일 */
export const META_FILES = ["SHA256SUMS", "manifest.json"] as const;
/** CI에만 보이는 파일(SHA256SUMS에 있어도 사용자에게 보이지 않는다) */
export const CI_ONLY_FILES = ["previous"] as const;
const LATEST_FILE = "latest.json";

/** null = 400 bad_key */
export function parseReleasePath(pathname: string): ReleasePath | null {
  if (pathname.includes("..")) return null;
  if (LATEST.test(pathname)) return { kind: "latest", key: "releases/latest.json" };
  const m = FILE.exec(pathname);
  const version = m?.groups?.v;
  const file = m?.groups?.f;
  if (version === undefined || file === undefined) return null;
  if (file === "." || parseVersion(version) === null) return null;
  return { kind: "file", version, file, key: `releases/${version}/${file}` };
}

export function sumsKey(version: string): string {
  return `releases/${version}/SHA256SUMS`;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** "<hex 64>  <파일>\n" 줄들 → 파일 → hex. 하나라도 틀리면 null. 빈 텍스트는 빈 Map */
export function parseSha256Sums(text: string): ReadonlyMap<string, string> | null {
  const out = new Map<string, string>();
  if (text === "") return out;
  if (!text.endsWith("\n")) return null;
  // Rust lines()와 같게: \n으로 나누고 줄 끝 \r 하나를 뗀다(마지막 \n 뒤의 빈 조각은 줄이 아니다)
  for (const piece of text.slice(0, -1).split("\n")) {
    const line = piece.endsWith("\r") ? piece.slice(0, -1) : piece;
    const i = line.indexOf("  ");
    if (i < 0) return null;
    const hex = line.slice(0, i);
    const name = line.slice(i + 2);
    if (!HEX64.test(hex) || name === "" || name.includes("/") || out.has(name)) return null;
    out.set(name, hex);
  }
  return out;
}

/** 바이트(UTF-8 fatal, BOM을 떼지 않는다: xtask와 같이 첫 줄이 틀려 null) → parseSha256Sums. 잘못된 UTF-8은 null */
export function parseSha256SumsBytes(bytes: Uint8Array): ReadonlyMap<string, string> | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
  return parseSha256Sums(text);
}

/** 사용자(A·W)에게 보이는 파일인가. previous·latest.json은 SHA256SUMS에 있어도 false, META는 true, 그 밖은 SUMS 항목만 */
export function isUserVisible(file: string, sums: ReadonlyMap<string, string> | null): boolean {
  if ((CI_ONLY_FILES as readonly string[]).includes(file) || file === LATEST_FILE) return false;
  if ((META_FILES as readonly string[]).includes(file)) return true;
  return sums?.has(file) === true;
}
