// 스로틀 버킷(docs/design/worker.md 구현 중 변경 19). 순수 함수: 헤더 값 하나를 받아 버킷 문자열 하나를 돌려준다.
//
// "none"(헤더 없음) | "bad"(형식 오류) | "4:a.b.c.d" | "6:h1:h2:h3:h4"(IPv6는 앞 64비트).
// IPv4-mapped IPv6(::ffff:a.b.c.d)는 IPv4 버킷이다. zone(%)이 붙은 값은 형식 오류다.

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_CHARS = /^[0-9A-Fa-f:.]+$/;
const GROUP = /^[0-9a-fA-F]{1,4}$/;
const MAX_LEN = 64;

function ipv4Parts(s: string): number[] | null {
  const m = IPV4.exec(s);
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

// "a:b::c" 같은 쪽 하나 → 16비트 그룹 목록(IPv4 꼬리가 있으면 그룹 둘). 틀리면 null
function groups(side: string, allowV4Tail: boolean): number[] | null {
  if (side === "") return [];
  const out: number[] = [];
  const pieces = side.split(":");
  for (const [i, p] of pieces.entries()) {
    if (p.includes(".")) {
      if (!allowV4Tail || i !== pieces.length - 1) return null;
      const v4 = ipv4Parts(p);
      if (!v4) return null;
      out.push(((v4[0] ?? 0) << 8) | (v4[1] ?? 0), ((v4[2] ?? 0) << 8) | (v4[3] ?? 0));
    } else {
      if (!GROUP.test(p)) return null;
      out.push(parseInt(p, 16));
    }
  }
  return out;
}

function ipv6Groups(s: string): number[] | null {
  if (!IPV6_CHARS.test(s)) return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  if (halves.length === 1) {
    const g = groups(s, true);
    return g && g.length === 8 ? g : null;
  }
  const head = groups(halves[0] ?? "", false);
  const tail = groups(halves[1] ?? "", true);
  if (!head || !tail) return null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...tail];
}

/** CF-Connecting-IP 값 → 스로틀 버킷 */
export function ipBucket(value: string | null): string {
  if (value === null) return "none";
  const s = value.trim();
  if (s === "") return "none";
  if (s.length > MAX_LEN) return "bad";
  if (!s.includes(":")) {
    const v4 = ipv4Parts(s);
    return v4 ? "4:" + v4.join(".") : "bad";
  }
  const g = ipv6Groups(s);
  if (!g) return "bad";
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return `4:${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`;
  }
  return "6:" + [g0, g1, g2, g3].map((x) => x.toString(16)).join(":");
}
