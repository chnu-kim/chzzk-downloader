// 버전 해석·비교(docs/design/worker.md §9.3, 구현 중 변경 14 (다)). xtask/src/semver.rs를 글자 그대로 옮긴다:
// 두 구현이 같은 벡터 파일 xtask/testdata/semver-vectors.json을 테스트로 읽는다(한쪽만 고치지 않는다).
//   - core는 . 으로 정확히 셋, 각 조각은 비지 않은 ASCII 숫자이고 앞자리 0은 "0"만, 값은 u64(2^64−1) 이하(BigInt).
//   - prerelease는 . 으로 나눈 비지 않은 [0-9A-Za-z-]+ 조각. 숫자 조각의 앞자리 0은 허용한다(xtask와 같다).
//   - + (빌드 메타데이터)는 거부한다.
//   - 비교: 세 숫자 → prerelease 없는 쪽이 크다 → 조각별(둘 다 u64 숫자면 값, 숫자 < 영숫자, 아니면 바이트 순서) → 개수.

export interface Version {
  readonly nums: readonly [bigint, bigint, bigint];
  readonly pre: readonly string[];
}

const U64_MAX = (1n << 64n) - 1n;
const DIGITS = /^[0-9]+$/;
const PRE_ID = /^[0-9A-Za-z-]+$/;

// BigInt("")·BigInt(" 1")·BigInt("0x10")이 통과하므로 모양을 먼저 본다
function u64(s: string): bigint | null {
  if (!DIGITS.test(s)) return null;
  const n = BigInt(s);
  return n <= U64_MAX ? n : null;
}

function coreNum(s: string): bigint | null {
  if (s.length > 1 && s.startsWith("0")) return null;
  return u64(s);
}

export function parseVersion(s: string): Version | null {
  const dash = s.indexOf("-");
  const core = dash < 0 ? s : s.slice(0, dash);
  const parts = core.split(".");
  if (parts.length !== 3) return null;
  const nums: bigint[] = [];
  for (const p of parts) {
    const n = coreNum(p);
    if (n === null) return null;
    nums.push(n);
  }
  let pre: string[] = [];
  if (dash >= 0) {
    pre = s.slice(dash + 1).split(".");
    if (pre.some((id) => !PRE_ID.test(id))) return null;
  }
  return { nums: [nums[0] ?? 0n, nums[1] ?? 0n, nums[2] ?? 0n], pre };
}

const sign = (x: bigint | number): -1 | 0 | 1 => (x < 0 ? -1 : x > 0 ? 1 : 0);

// 바이트 순서(Rust String Ord). 조각은 ASCII만이라 UTF-16 코드 단위 비교와 같다
function bytewise(a: string, b: string): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareVersions(a: Version, b: Version): -1 | 0 | 1 {
  for (let i = 0; i < 3; i++) {
    const o = sign((a.nums[i] ?? 0n) - (b.nums[i] ?? 0n));
    if (o !== 0) return o;
  }
  if (a.pre.length === 0 && b.pre.length === 0) return 0;
  if (a.pre.length === 0) return 1;
  if (b.pre.length === 0) return -1;
  const n = Math.min(a.pre.length, b.pre.length);
  for (let i = 0; i < n; i++) {
    const x = a.pre[i] ?? "";
    const y = b.pre[i] ?? "";
    const m = u64(x);
    const k = u64(y);
    let o: -1 | 0 | 1;
    if (m !== null && k !== null) o = sign(m - k);
    else if (m !== null) o = -1;
    else if (k !== null) o = 1;
    else o = bytewise(x, y);
    if (o !== 0) return o;
  }
  return sign(a.pre.length - b.pre.length);
}
