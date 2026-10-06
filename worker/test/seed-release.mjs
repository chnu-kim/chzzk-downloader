// 합성 릴리스(docs/design/worker.md §9.1·§12.3, 구현 중 변경 31 (카)). node:* import 없이 WebCrypto·btoa만 써서 workerd(vitest)와
// Node 22(W7 e2e)에서 함께 쓴다. 바이트는 결정적이다. 매니페스트 url 접두는 자리표시다.
// 모양은 xtask(xtask/src/manifest.rs·release.rs)의 것을 따른다: SHA256SUMS는 `<hex>  <파일>\n`을 파일 이름 바이트 순서로,
// manifest.json은 {version, pub_date, platforms}, previous는 승격 직전 버전(첫 버전은 none)이고 줄바꿈이 없다.

export const SEED_BASE = "https://worker.example.test";
export const SEED_PUB_DATE = "2030-01-01T00:00:00Z";
export const SEED_SIZE = 1024;
// xtask manifest::OSES 순서
export const OSES = ["linux", "darwin", "windows"];
export const PREFIX = "chzzk-downloader";

const enc = new TextEncoder();

/** 표(release/expected-artifacts.json 객체) → [{ os, kind, file, updater }] (OSES 순서, artifacts 순서) */
export function expectedArtifacts(table, version) {
  const out = [];
  for (const os of OSES) {
    for (const a of table[os].artifacts) {
      out.push({ os, kind: a.kind, file: `${PREFIX}_${version}_${a.name}`, updater: [...(a.updater ?? [])] });
    }
  }
  return out;
}

/** xtask manifest::expected_files: 산출물 이름 + updater 산출물의 .sig */
export function expectedFiles(table, version) {
  const s = new Set();
  for (const a of expectedArtifacts(table, version)) {
    s.add(a.file);
    if (a.updater.length > 0) s.add(`${a.file}.sig`);
  }
  return s;
}

/** xtask verify가 GET하는 키 순서: SHA256SUMS, manifest.json, 산출물마다 (파일, updater면 파일.sig), latest면 마지막에 releases/latest.json */
export function verifyKeys(table, version, latest) {
  const base = `releases/${version}`;
  const keys = [`${base}/SHA256SUMS`, `${base}/manifest.json`];
  for (const a of expectedArtifacts(table, version)) {
    keys.push(`${base}/${a.file}`);
    if (a.updater.length > 0) keys.push(`${base}/${a.file}.sig`);
  }
  if (latest) keys.push("releases/latest.json");
  return keys;
}

/** 파일 이름에서 결정적 바이트: `${file}\n`의 UTF-8을 size바이트까지 되풀이 */
export function fakeBytes(file, size = SEED_SIZE) {
  const unit = enc.encode(`${file}\n`);
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = unit[i % unit.length];
  return out;
}

/** 합성 서명 텍스트(스키마: base64 패턴, 100자 이상) */
export function fakeSignature(file) {
  return btoa(`seed-signature ${file} ${"0".repeat(64)}`);
}

/** sha256 소문자 hex. Uint8Array.prototype.toHex가 Node 22에 없어 직접 만든다 */
export async function sha256Hex(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let s = "";
  for (const b of d) s += b.toString(16).padStart(2, "0");
  return s;
}

/** 한 버전: Map<key, Uint8Array>. 산출물·.sig·SHA256SUMS·manifest.json·previous(previous 문자열, 줄바꿈 없음) */
export async function buildRelease(table, { version, previous, base = SEED_BASE, pubDate = SEED_PUB_DATE, size = SEED_SIZE }) {
  const out = new Map();
  const put = (name, bytes) => out.set(`releases/${version}/${name}`, bytes);
  const platforms = {};
  const sums = new Map();
  for (const a of expectedArtifacts(table, version)) {
    const bytes = fakeBytes(a.file, size);
    put(a.file, bytes);
    sums.set(a.file, await sha256Hex(bytes));
    if (a.updater.length > 0) {
      const sigBytes = enc.encode(fakeSignature(a.file));
      put(`${a.file}.sig`, sigBytes);
      sums.set(`${a.file}.sig`, await sha256Hex(sigBytes));
      for (const key of a.updater) platforms[key] = { signature: fakeSignature(a.file), url: `${base}/releases/${version}/${a.file}` };
    }
  }
  const names = [...sums.keys()].sort();
  put("SHA256SUMS", enc.encode(names.map((n) => `${sums.get(n)}  ${n}\n`).join("")));
  put("manifest.json", enc.encode(`${JSON.stringify({ version, pub_date: pubDate, platforms }, null, 2)}\n`));
  put("previous", enc.encode(previous));
  return out;
}

/** 차례로 승격한 R2 상태: 각 버전(previous = 앞 버전, 첫 버전은 none) + releases/latest.json(마지막 버전 manifest.json 바이트) */
export async function buildSeed(table, versions, opts = {}) {
  const out = new Map();
  let previous = "none";
  for (const version of versions) {
    for (const [k, v] of await buildRelease(table, { ...opts, version, previous })) out.set(k, v);
    previous = version;
  }
  const last = versions[versions.length - 1];
  if (last !== undefined) out.set("releases/latest.json", out.get(`releases/${last}/manifest.json`));
  return out;
}
