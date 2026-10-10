// core/notice(계약 §2.8, D41): 만료·올린 시각 + 72시간·80자·꺾쇠·링크·bidi·형식 밖·크기.
import { describe, expect, it } from "vitest";
import { NOTICE_KEY } from "../../src/core/keys";
import { NOTICE_MAX_CHARS, NOTICE_TTL_H, type NoticeVerdict, noticeTooLarge, parseNotice, parseRfc3339 } from "../../src/core/notice";

const HOUR = 3_600_000;
const T0 = Date.UTC(2030, 0, 1);
const enc = (v: unknown) => new TextEncoder().encode(typeof v === "string" ? v : JSON.stringify(v));
const base = { id: "maint-1", level: "warn", kinds: [], text: "점검 중이라 잠시 받기가 느릴 수 있어요", expiresAt: "2030-01-05T00:00:00Z" };
const parse = (patch: Record<string, unknown> | null, o: { uploaded?: number; now?: number } = {}): NoticeVerdict =>
  parseNotice(enc(patch === null ? base : { ...base, ...patch }), o.uploaded ?? T0, o.now ?? T0 + HOUR);
const reason = (v: NoticeVerdict) => (v.kind === "invalid" ? v.reason : v.kind);

describe("상수", () => {
  it("foundations §14 표의 값(72시간·80자)이고 키는 releases/ 밖이다", () => {
    expect(NOTICE_TTL_H).toBe(72);
    expect(NOTICE_MAX_CHARS).toBe(80);
    expect(NOTICE_KEY).toBe("service/notice.json");
    expect(NOTICE_KEY.startsWith("releases/")).toBe(false);
  });
});

describe("정상", () => {
  it("모든 필드를 그대로 돌려주고 실효 만료는 RFC 3339 UTC(ms)다", () => {
    const v = parse(null, { uploaded: T0 + 90 * HOUR });
    expect(v).toEqual({
      kind: "ok",
      untilMs: Date.parse("2030-01-05T00:00:00Z"),
      notice: { id: "maint-1", level: "warn", kinds: [], text: base.text, expiresAt: "2030-01-05T00:00:00.000Z" },
    });
  });

  it("kinds: vod·clip 부분집합(빈 배열 = 전체)", () => {
    for (const kinds of [[], ["vod"], ["clip"], ["vod", "clip"]]) expect(parse({ kinds }).kind).toBe("ok");
  });

  it("level 셋(info·warn·block)", () => {
    for (const level of ["info", "warn", "block"]) expect(parse({ level }).kind).toBe("ok");
  });

  it("글자 수는 코드포인트다: 80자(한글·이모지 포함)는 통과, 81자는 거부", () => {
    expect(parse({ text: "가".repeat(80) }).kind).toBe("ok");
    expect(parse({ text: "😀".repeat(80) }).kind).toBe("ok");
    expect(reason(parse({ text: "가".repeat(81) }))).toBe("text");
    expect(reason(parse({ text: "😀".repeat(81) }))).toBe("text");
  });

  it("시간대 오프셋·소수 초 표기를 받는다", () => {
    expect(parse({ expiresAt: "2030-01-05T09:00:00+09:00" }, { uploaded: T0 + 90 * HOUR })).toMatchObject({ kind: "ok", untilMs: Date.parse("2030-01-05T00:00:00Z") });
    expect(parse({ expiresAt: "2030-01-05T00:00:00.123456Z" }).kind).toBe("ok");
  });
});

describe("만료", () => {
  it("expiresAt 이상이면 만료(경계: 같은 시각은 만료, 1ms 전은 살아 있다)", () => {
    const exp = Date.parse("2030-01-05T00:00:00Z");
    expect(parse(null, { uploaded: exp - HOUR, now: exp }).kind).toBe("expired");
    expect(parse(null, { uploaded: exp - HOUR, now: exp - 1 }).kind).toBe("ok");
    expect(parse(null, { now: exp + HOUR }).kind).toBe("expired");
  });

  it("올린 시각 + 72시간이 expiresAt보다 이르면 그쪽이 실효 만료다", () => {
    const far = { expiresAt: "2031-01-01T00:00:00Z" };
    const cap = T0 + NOTICE_TTL_H * HOUR;
    expect(parse(far, { now: cap - 1 })).toMatchObject({ kind: "ok", untilMs: cap, notice: { expiresAt: new Date(cap).toISOString() } });
    expect(parse(far, { now: cap }).kind).toBe("expired");
    expect(parse(far, { now: cap + 5 * HOUR }).kind).toBe("expired");
  });

  it("만료된 공지도 형식은 먼저 본다(형식 밖이면 invalid)", () => {
    expect(reason(parse({ level: "x" }, { now: T0 + 999 * HOUR }))).toBe("level");
  });
});

describe("거부(형식 밖·위험한 글)", () => {
  it.each([
    ["꺾쇠 <", { text: "a<b" }, "text"],
    ["꺾쇠 >", { text: "a>b" }, "text"],
    ["링크 ://", { text: "https://example.test 로 가요" }, "text"],
    ["링크 www.", { text: "www.example.test 를 봐요" }, "text"],
    ["링크 대문자", { text: "WWW.example.test" }, "text"],
    ["줄바꿈", { text: "첫 줄\n둘째 줄" }, "text"],
    ["탭", { text: "a\tb" }, "text"],
    ["bidi 덮어쓰기 U+202E", { text: "ab\u202Ecd" }, "text"],
    ["bidi 격리 U+2067", { text: "ab\u2067cd" }, "text"],
    ["방향 표지 U+200F", { text: "ab\u200Fcd" }, "text"],
    ["영폭 공백 U+200B", { text: "ab\u200Bcd" }, "text"],
    ["줄 구분자 U+2028", { text: "ab\u2028cd" }, "text"],
    ["짝 없는 서로게이트", { text: "ab\uD800cd" }, "text"],
    ["빈 글", { text: "" }, "text"],
    ["공백뿐", { text: "   " }, "text"],
    ["글이 문자열이 아님", { text: 1 }, "text"],
    ["id 모양(대문자)", { id: "Maint" }, "id"],
    ["id 65자", { id: "a".repeat(65) }, "id"],
    ["id 빈 값", { id: "" }, "id"],
    ["level 모름", { level: "error" }, "level"],
    ["kinds 모름", { kinds: ["live"] }, "kinds"],
    ["kinds 중복", { kinds: ["vod", "vod"] }, "kinds"],
    ["kinds 배열 아님", { kinds: "vod" }, "kinds"],
    ["expiresAt 형식(날짜만)", { expiresAt: "2030-01-05" }, "expires_at"],
    ["expiresAt 오프셋 없음", { expiresAt: "2030-01-05T00:00:00" }, "expires_at"],
    ["expiresAt 없는 날(2월 30일)", { expiresAt: "2030-02-30T00:00:00Z" }, "expires_at"],
    ["expiresAt 25시", { expiresAt: "2030-01-05T25:00:00Z" }, "expires_at"],
    ["expiresAt 숫자", { expiresAt: 1893456000 }, "expires_at"],
  ] as const)("%s", (_n, patch, want) => {
    expect(reason(parse(patch))).toBe(want);
  });

  it("키가 모자라거나 남아도 거부(schema 키 같은 여분도 안 된다)", () => {
    const { text: _drop, ...noText } = base;
    expect(reason(parseNotice(enc(noText), T0, T0))).toBe("shape");
    expect(reason(parse({ extra: 1 }))).toBe("shape");
    expect(reason(parse({ schema: 1 }))).toBe("shape");
  });

  it("객체가 아닌 JSON·깨진 JSON·잘못된 UTF-8·크기 초과", () => {
    for (const body of ["[]", "null", "1", '"x"']) expect(reason(parseNotice(enc(body), T0, T0))).toBe("shape");
    expect(reason(parseNotice(enc("{"), T0, T0))).toBe("json");
    expect(reason(parseNotice(enc(""), T0, T0))).toBe("json");
    expect(reason(parseNotice(new Uint8Array([0x7b, 0xff, 0x7d]), T0, T0))).toBe("encoding");
    expect(reason(parseNotice(new Uint8Array(4096), T0, T0))).toBe("too_large");
    expect(noticeTooLarge(2048)).toBe(false);
    expect(noticeTooLarge(2049)).toBe(true);
  });

  it("올린 시각이 유한한 수가 아니면 거부", () => {
    expect(reason(parseNotice(enc(base), Number.NaN, T0))).toBe("uploaded");
  });
});

describe("parseRfc3339", () => {
  it.each([
    ["2030-01-05T00:00:00Z", Date.UTC(2030, 0, 5)],
    ["2030-01-05T00:00:00.5Z", Date.UTC(2030, 0, 5) + 500],
    ["2028-02-29T00:00:00Z", Date.UTC(2028, 1, 29)],
    ["2030-01-05T09:00:00+09:00", Date.UTC(2030, 0, 5)],
    ["2030-01-04T15:00:00-09:00", Date.UTC(2030, 0, 5)],
  ])("%s", (t, ms) => {
    expect(parseRfc3339(t)).toBe(ms);
  });

  it.each(["2030-02-29T00:00:00Z", "2030-13-01T00:00:00Z", "2030-00-10T00:00:00Z", "2030-04-31T00:00:00Z", "2030-01-05T24:00:00Z", "2030-01-05T00:60:00Z", "2030-01-05T00:00:60Z", "2030-01-05T00:00:00+24:00", "2030-01-05 00:00:00Z", "2030-01-05T00:00:00z", ""])("달력·시각이 틀리면 null: %j", (t) => {
    expect(parseRfc3339(t)).toBeNull();
  });
});
