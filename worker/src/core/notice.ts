// 서비스 공지 판정(docs/design/system/web.md D41, 계약 §2.8). 순수 함수: R2 객체의 바이트·올린 시각·현재 시각만 받는다.
// 원천은 R2 객체 service/notice.json 하나다(사람이 올린다. Worker에는 쓰기 경로가 없다). 모양:
//   { id: ^[a-z0-9-]{1,64}$, level: "info"|"warn"|"block", kinds: ("vod"|"clip")[](빈 배열 = 전체), text: 1~80 코드포인트 평문, expiresAt: RFC 3339 }
// 실효 만료 = min(expiresAt, 올린 시각 + NOTICE_TTL_H). 그 시각 이상이면 보이지 않는다. 안전하지 않은 글은 통째로 거부한다(fail-open: 공지 없음).
// 아래 두 상수는 foundations §14 표의 값이다(design-tokens DT15가 표와 대조한다). 이 파일에는 그 둘 말고 export 숫자 상수를 두지 않는다.

/** 올린 뒤 공지가 살아 있는 최대 시간(시) */
export const NOTICE_TTL_H = 72;
/** 공지 글 길이 상한(코드포인트) */
export const NOTICE_MAX_CHARS = 80;

const HOUR_MS = 3_600_000;
// 객체 크기 상한(바이트). 글 80자와 키 다섯 개면 훨씬 작다
const MAX_BYTES = 2048;
const ID = /^[a-z0-9-]{1,64}$/;
const KEYS = ["expiresAt", "id", "kinds", "level", "text"];
const LEVELS = ["info", "warn", "block"] as const;
const KINDS = ["vod", "clip"] as const;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/;
// 평문만: 꺾쇠, 제어 문자(줄바꿈·탭 포함), 서식·bidi 제어(Cf), 줄·문단 구분자, 짝 없는 서로게이트
const UNSAFE = /[<>\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u;
// 링크 금지(공지는 안내 문장이고 주소를 싣지 않는다)
const LINKISH = /:\/\/|www\./i;

export type NoticeLevel = (typeof LEVELS)[number];
export type NoticeKind = (typeof KINDS)[number];

export interface Notice {
  readonly id: string;
  readonly level: NoticeLevel;
  readonly kinds: readonly NoticeKind[];
  readonly text: string;
  /** 실효 만료(RFC 3339 UTC, 밀리초). 올린 시각 + 72시간이 더 이르면 그쪽이다 */
  readonly expiresAt: string;
}

export type NoticeReason = "too_large" | "encoding" | "json" | "shape" | "id" | "level" | "kinds" | "text" | "expires_at" | "uploaded";

export type NoticeVerdict =
  | { readonly kind: "ok"; readonly notice: Notice; /** 실효 만료(epoch ms). 캐시한 판정을 다시 쓸 때 이 시각 전인지 본다 */ readonly untilMs: number }
  | { readonly kind: "expired" }
  | { readonly kind: "invalid"; readonly reason: NoticeReason };

/** 읽기 전에 크기만으로 거부한다(본문을 메모리에 올리지 않는다) */
export function noticeTooLarge(size: number): boolean {
  return size > MAX_BYTES;
}

const invalid = (reason: NoticeReason): NoticeVerdict => ({ kind: "invalid", reason });

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number): number => (m === 2 ? (isLeap(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31);

/** RFC 3339 시각 → epoch ms. 달력·시각 범위가 틀리면 null(Date.parse는 2월 30일을 3월 2일로 넘긴다) */
export function parseRfc3339(text: string): number | null {
  const m = RFC3339.exec(text);
  if (m === null) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo) || h > 23 || mi > 59 || s > 59) return null;
  if (m[7] !== undefined && (Number(m[7]) > 23 || Number(m[8]) > 59)) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

/** 바이트 → 판정. uploadedMs는 R2Object.uploaded(올린 시각), nowMs는 ctx.now */
export function parseNotice(bytes: Uint8Array, uploadedMs: number, nowMs: number): NoticeVerdict {
  if (noticeTooLarge(bytes.byteLength)) return invalid("too_large");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return invalid("encoding");
  }
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return invalid("json");
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return invalid("shape");
  const o = v as Record<string, unknown>;
  if (Object.keys(o).sort().join() !== KEYS.join()) return invalid("shape");
  const { id, level, kinds, text: body, expiresAt } = o;
  if (typeof id !== "string" || !ID.test(id)) return invalid("id");
  if (typeof level !== "string" || !(LEVELS as readonly string[]).includes(level)) return invalid("level");
  if (!Array.isArray(kinds) || kinds.length > KINDS.length || new Set(kinds).size !== kinds.length || !kinds.every((k) => (KINDS as readonly unknown[]).includes(k))) return invalid("kinds");
  if (typeof body !== "string" || body.trim() === "" || [...body].length > NOTICE_MAX_CHARS || UNSAFE.test(body) || LINKISH.test(body)) return invalid("text");
  const expMs = typeof expiresAt === "string" ? parseRfc3339(expiresAt) : null;
  if (expMs === null) return invalid("expires_at");
  if (!Number.isFinite(uploadedMs)) return invalid("uploaded");
  const untilMs = Math.min(expMs, uploadedMs + NOTICE_TTL_H * HOUR_MS);
  if (nowMs >= untilMs) return { kind: "expired" };
  return {
    kind: "ok",
    untilMs,
    notice: { id, level: level as NoticeLevel, kinds: kinds as NoticeKind[], text: body, expiresAt: new Date(untilMs).toISOString() },
  };
}
