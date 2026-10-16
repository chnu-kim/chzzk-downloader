// 채널 목록 실측 도구의 순수 판정(test/listing-check-lib.mjs, 기능 ③ 실측 질문 M-③-1~6-2).
import { describe, expect, it } from "vitest";
import {
  adultLabel,
  channelVerdict,
  clipListPath,
  cookieDelta,
  cookieHeader,
  countBucket,
  CLIP_FIELDS,
  distinctCount,
  fieldPresence,
  findItems,
  infoPath,
  itemDate,
  judgeResponse,
  nextCursorQuery,
  pagingKind,
  parseVodUrl,
  pickClipChannel,
  pickVideoChannel,
  rateLines,
  rateVerdict,
  sizeLine,
  sizeVerdict,
  sortVerdict,
  statusLabel,
  unreachable,
  videoListPath,
  VIDEO_FIELDS,
  type Judged,
} from "../listing-check-lib.mjs";

const A1 = "000000000000000000000000000000a1";
const B2 = "000000000000000000000000000000b2";
const env = (code: number, content: unknown) => JSON.stringify({ code, message: null, content });

describe("parseVodUrl", () => {
  it.each([
    ["https://chzzk.naver.com/video/9000002", "9000002"],
    ["chzzk.naver.com/video/9000002", "9000002"],
    ["https://m.chzzk.naver.com/video/9000002", "9000002"],
    ["https://chzzk.naver.com/clips/TestClip01", null],
    ["https://chzzk.naver.com/live/" + A1, null],
    ["https://evil.example/video/1", null],
    ["https://chzzk.naver.com/video/abc", null],
  ])("%s", (raw, want) => {
    expect(parseVodUrl(raw)).toBe(want);
  });
});

describe("judgeResponse·statusLabel", () => {
  const ok = env(200, {});
  it("판정 표", () => {
    expect(judgeResponse(200, ok).kind).toBe("ok");
    expect(judgeResponse(200, env(500, null))).toEqual({ kind: "api", code: 500 });
    expect(judgeResponse(200, env(200, []))).toEqual({ kind: "shape" });
    expect(judgeResponse(200, "not json")).toEqual({ kind: "shape" });
    expect(judgeResponse(200, '{"content":{}}')).toEqual({ kind: "shape" });
    expect(judgeResponse(200, null)).toEqual({ kind: "shape" });
    expect(judgeResponse(404, ok)).toEqual({ kind: "http", status: 404 });
    expect(judgeResponse(429, ok)).toEqual({ kind: "http", status: 429 });
    expect(judgeResponse(503, ok)).toEqual({ kind: "http", status: 503 });
  });
  it("라벨 문구", () => {
    const label = (j: Judged) => statusLabel(j);
    expect(label(judgeResponse(200, ok))).toBe("된다");
    expect(label({ kind: "http", status: 401 })).toBe("안 된다(401·403)");
    expect(label({ kind: "http", status: 403 })).toBe("안 된다(401·403)");
    expect(label({ kind: "http", status: 404 })).toBe("안 된다(404)");
    expect(label({ kind: "http", status: 429 })).toBe("안 된다(429)");
    expect(label({ kind: "http", status: 418 })).toBe("안 된다(그 밖 4xx)");
    expect(label({ kind: "http", status: 503 })).toBe("안 된다(5xx)");
    expect(label({ kind: "http", status: 302 })).toBe("안 된다(그 밖)");
    expect(label({ kind: "api", code: 500 })).toBe("안 된다(API 코드)");
    expect(label({ kind: "shape" })).toBe("안 된다(형식)");
    expect(label(unreachable(false))).toBe("안 된다(연결)");
    expect(label(unreachable(true))).toBe("안 된다(시간 초과)");
  });
});

describe("모양 판별", () => {
  it("findItems", () => {
    expect(findItems({ data: [1] })).toEqual([1]);
    expect(findItems({ videos: [] })).toEqual([]);
    expect(findItems({ data: "x", clips: [2] })).toEqual([2]);
    expect(findItems({})).toBeNull();
  });
  it("pagingKind", () => {
    expect(pagingKind({ page: 0, totalPages: 3 })).toBe("페이지 번호");
    expect(pagingKind({ totalPages: 1 })).toBe("페이지 번호");
    expect(pagingKind({ page: { next: { clipUID: "x" } } })).toBe("커서");
    expect(pagingKind({ page: { next: null } })).toBe("커서");
    expect(pagingKind({ next: null })).toBe("커서");
    expect(pagingKind({})).toBe("판정 불가");
  });
  it("nextCursorQuery", () => {
    expect(nextCursorQuery({ page: { next: { clipUID: "TestClip01", readCount: 3, x: null } } })).toEqual({
      clipUID: "TestClip01",
      readCount: "3",
    });
    expect(nextCursorQuery({ page: { next: null } })).toBeNull();
    expect(nextCursorQuery({ next: "abc" })).toBeNull();
    expect(nextCursorQuery({ page: { next: {} } })).toBeNull();
  });
});

describe("countBucket·size", () => {
  it("경계", () => {
    for (const v of [-1, 1.5, "3"]) expect(countBucket(v)).toBe("없음");
    const want: [number, string][] = [
      [0, "0"], [1, "1~9"], [9, "1~9"], [10, "10~49"], [49, "10~49"], [50, "50~99"], [99, "50~99"],
      [100, "100~499"], [499, "100~499"], [500, "500~999"], [999, "500~999"], [1000, "1000 이상"],
    ];
    for (const [n, s] of want) expect(countBucket(n)).toBe(s);
  });
  it("sizeVerdict", () => {
    expect(sizeVerdict(50, 50, 500)).toBe("요청 크기 그대로");
    expect(sizeVerdict(100, 50, 500)).toBe("줄어듦(상한 ≤ 50)");
    expect(sizeVerdict(100, 20, 20)).toBe("판정 불가(항목 부족)");
    expect(sizeVerdict(100, 20, undefined)).toBe("판정 불가(항목 부족)");
  });
  it("sizeLine", () => {
    expect(sizeLine(50, 50, 500)).toBe("50개 → 요청 크기 그대로");
    expect(sizeLine(100, 50, 500)).toBe("50개 → 줄어듦(상한 ≤ 50)");
    const s = sizeLine(100, 37, 37);
    expect(s).toBe("10~49 → 판정 불가(항목 부족)");
    expect(s).not.toContain("37");
  });
});

describe("itemDate", () => {
  it("표", () => {
    expect(itemDate({ publishDateAt: 1767322800000 })).toBe(1767322800000);
    expect(itemDate({ publishDate: "2026-01-02 12:00:00" })).toBe(20260102120000);
    expect(itemDate({ createdDate: "2026-01-02T12:00:00" })).toBe(20260102120000);
    expect(itemDate({ publishDate: "어제" })).toBeNull();
    expect(itemDate({})).toBeNull();
  });
});

describe("sortVerdict", () => {
  const v = (no: number, time: string) => ({ videoNo: no, publishDate: `2026-01-02 ${time}` });
  it("내림차순(같은 날짜 포함)", () => {
    const p1 = [v(1, "12:00:00"), v(2, "11:00:00")];
    const p2 = [v(3, "11:00:00"), v(4, "10:00:00")];
    expect(sortVerdict({ repeatA: p1, repeatB: p1, pages: [p1, p2] })).toEqual({
      verdict: "내림차순", calls: 3, items: 4, overlap: false,
    });
  });
  it("오름차순 끼임", () => {
    const p1 = [v(1, "12:00:00"), v(2, "10:00:00")];
    const p2 = [v(3, "11:00:00"), v(4, "09:00:00")];
    expect(sortVerdict({ repeatA: p1, repeatB: p1, pages: [p1, p2] }).verdict).toBe("아님");
  });
  it("두 호출 순서가 다르면 날짜가 없어도 아님", () => {
    const a = [{ videoNo: 1 }, { videoNo: 2 }];
    const b = [{ videoNo: 2 }, { videoNo: 1 }];
    expect(sortVerdict({ repeatA: a, repeatB: b, pages: [a] }).verdict).toBe("아님");
  });
  it("날짜 없음", () => {
    const a = [v(1, "12:00:00"), { videoNo: 2 }];
    expect(sortVerdict({ repeatA: a, repeatB: a, pages: [a] }).verdict).toBe("판정 불가");
  });
  it("표본 부족", () => {
    const a = [v(1, "12:00:00")];
    expect(sortVerdict({ repeatA: a, repeatB: a, pages: [a] })).toMatchObject({ verdict: "판정 불가", items: 1 });
  });
  it("페이지 겹침은 ID로 거른다", () => {
    const p1 = [v(1, "12:00:00"), v(2, "11:00:00")];
    const p2 = [v(2, "11:00:00"), v(3, "10:00:00")];
    expect(sortVerdict({ repeatA: p1, repeatB: p1, pages: [p1, p2] })).toMatchObject({
      verdict: "내림차순", items: 3, overlap: true,
    });
  });
  it("같은 페이지 두 번(1-기준 의심)", () => {
    const p = [v(1, "12:00:00"), v(2, "11:00:00"), v(3, "10:00:00")];
    expect(sortVerdict({ repeatA: p, repeatB: p, pages: [p, p] })).toMatchObject({ overlap: true, items: 3 });
  });
});

describe("channelVerdict", () => {
  const item = (id: string) => ({ channel: { channelId: id } });
  it("표", () => {
    expect(channelVerdict([item(A1), item(A1)], A1, pickVideoChannel)).toBe("같다");
    expect(channelVerdict([item(A1), item(B2)], A1, pickVideoChannel)).toBe("다르다(1개)");
    expect(channelVerdict([item(A1.replace("a1", "A1"))], A1, pickVideoChannel)).toBe("대소문자만 다르다");
    expect(channelVerdict([{}], A1, pickVideoChannel)).toBe("항목에 채널 ID 없음");
    expect(channelVerdict([item(A1)], null, pickVideoChannel)).toBe("비교 불가(info 채널 ID 없음)");
  });
  it("pick 후보", () => {
    expect(pickVideoChannel({ channelId: "x" })).toBe("x");
    expect(pickClipChannel({ ownerChannelId: "o" })).toBe("o");
    expect(pickClipChannel({ ownerChannel: { channelId: "p" } })).toBe("p");
  });
});

describe("필드", () => {
  it("fieldPresence", () => {
    const items = [
      { videoNo: 1, publishDate: "x", duration: null },
      { videoNo: 2, duration: null },
    ];
    const m = new Map(fieldPresence(items, VIDEO_FIELDS));
    expect(m.get("영상 번호")).toBe("있음");
    expect(m.get("게시일")).toBe("일부");
    expect(m.get("길이")).toBe("없음");
    for (const [, s] of fieldPresence([], VIDEO_FIELDS)) expect(s).toBe("판정 불가(항목 없음)");
  });
  it("중첩 경로", () => {
    const m = new Map(fieldPresence([{ channel: { channelName: "테스트채널" } }], VIDEO_FIELDS));
    expect(m.get("채널 이름(파일 이름)")).toBe("있음");
    expect(CLIP_FIELDS.length).toBe(8);
  });
  it("distinctCount·adultLabel", () => {
    expect(distinctCount([{ videoType: "A" }, { videoType: "B" }, { videoType: "A" }, { videoType: null }], "videoType")).toBe(2);
    expect(adultLabel([{ adult: false }, { adult: true }])).toBe("있다");
    expect(adultLabel([{ adult: false }])).toBe("없다");
    expect(adultLabel([{}])).toBe("판정 불가(필드 없음)");
  });
});

describe("쿠키·속도", () => {
  it("cookieDelta", () => {
    expect(cookieDelta(10, 10)).toBe("같다");
    expect(cookieDelta(10, 12)).toBe("쿠키 켬이 많다");
    expect(cookieDelta(12, 10)).toBe("쿠키 켬이 적다");
    expect(cookieDelta(10, undefined)).toBe("비교 불가");
  });
  const ok = judgeResponse(200, env(200, {}));
  const h = (status: number): Judged => ({ kind: "http", status });
  it("rateVerdict", () => {
    expect(rateVerdict([ok, ok, ok, h(429), ok])).toEqual({ requests: 5, first429: 4, first403: null });
    expect(rateVerdict([ok, h(403)])).toEqual({ requests: 2, first429: null, first403: 2 });
    expect(rateVerdict(Array(20).fill(ok))).toEqual({ requests: 20, first429: null, first403: null });
  });
  it("rateLines", () => {
    expect(rateLines("짧은 간격", rateVerdict([ok, ok, ok, h(429), ok]))).toEqual([
      "짧은 간격: 요청 5회",
      "짧은 간격 429: 첫 429까지 4회",
      "짧은 간격 401·403: 없음",
    ]);
  });
  it("cookieHeader", () => {
    expect(cookieHeader(" a ", " b ")).toBe("NID_AUT=a; NID_SES=b");
    expect(cookieHeader("", "b")).toBeNull();
    expect(cookieHeader("a b", "c")).toBeNull();
    expect(cookieHeader("a;", "b")).toBe("NID_AUT=a;; NID_SES=b");
  });
});

describe("경로 모양", () => {
  it("고정", () => {
    expect(videoListPath(A1, 2, 50)).toBe(`/service/v1/channels/${A1}/videos?sortType=LATEST&pagingType=PAGE&page=2&size=50`);
    expect(clipListPath(A1, { clipUID: "TestClip01" })).toBe(
      `/service/v1/channels/${A1}/clips?orderType=RECENT&filterType=ALL&size=30&clipUID=TestClip01`,
    );
    expect(clipListPath(A1)).toBe(`/service/v1/channels/${A1}/clips?orderType=RECENT&filterType=ALL&size=30`);
    expect(infoPath("9000002")).toBe("/service/v2/videos/9000002");
  });
});

describe("출력 누출 없음", () => {
  it("작은 채널(37개)의 출력에 ID·이름·개수가 없다", () => {
    const items = Array.from({ length: 37 }, (_, i) => ({
      videoNo: 9000000 + i,
      clipUID: "TestClip01",
      publishDate: `2026-01-02 12:${String(59 - i).padStart(2, "0")}:00`,
      channel: { channelId: A1, channelName: "테스트채널" },
    }));
    const out: string[] = [];
    out.push(statusLabel(judgeResponse(200, env(200, { totalCount: 37, data: items }))));
    out.push(statusLabel({ kind: "http", status: 404 }));
    for (const [l, s] of fieldPresence(items, VIDEO_FIELDS)) out.push(l, s);
    out.push(channelVerdict(items, A1, pickVideoChannel), channelVerdict([items[0]!, { channel: { channelId: B2 } }], A1, pickVideoChannel));
    const sv = sortVerdict({ repeatA: items, repeatB: items, pages: [items] });
    out.push(sv.verdict, countBucket(sv.items), String(sv.overlap));
    out.push(sizeLine(50, 37, 37), countBucket(37));
    out.push(...rateLines("t", rateVerdict([unreachable(false)])));
    const all = out.join("\n");
    for (const bad of [A1, "테스트채널", "TestClip01", "37"]) expect(all).not.toContain(bad);
  });
});
