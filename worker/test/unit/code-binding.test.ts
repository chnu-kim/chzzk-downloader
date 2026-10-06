// 치지직 code 묶임 실측 도구의 순수 판정(test/code-binding-lib.mjs, docs/design/worker.md 구현 중 변경 29·42).
import { describe, expect, it } from "vitest";
import { judgeExchange, needSecond, needThird, reportLines, reuseVerdict, stateVerdict, unreachable, type Exchange } from "../code-binding-lib.mjs";

const OK = JSON.stringify({ code: 200, message: null, content: { accessToken: "synthetic-access", refreshToken: "synthetic-refresh" } });
const accepted: Exchange = { kind: "accepted" };
const rejected: Exchange = { kind: "rejected", status: 401, code: "INVALID_REQUEST" };
const down: Exchange = { kind: "unreachable", timedOut: false };

describe("judgeExchange", () => {
  it.each([
    ["래퍼 있음", 200, OK, accepted],
    ["래퍼 없음", 200, JSON.stringify({ accessToken: "synthetic-access" }), accepted],
    ["HTTP 200 + 래퍼 401", 200, JSON.stringify({ code: 401, message: "x", content: null }), { kind: "rejected", status: 200, code: "401" }],
    ["HTTP 401 + 문자열 code", 401, JSON.stringify({ code: "INVALID_REQUEST", message: "x" }), rejected],
    ["2xx지만 accessToken 없음", 200, JSON.stringify({ content: {} }), { kind: "rejected", status: 200 }],
    ["accessToken에 공백", 200, JSON.stringify({ accessToken: "a b" }), { kind: "rejected", status: 200 }],
    ["토큰이 있어도 4xx", 400, OK, { kind: "rejected", status: 400, code: "200" }],
    ["JSON 아님", 500, "<html>", { kind: "rejected", status: 500 }],
    ["배열", 200, "[]", { kind: "rejected", status: 200 }],
    ["긴 code는 싣지 않음", 400, JSON.stringify({ code: "x".repeat(51) }), { kind: "rejected", status: 400 }],
    ["code에 공백이면 싣지 않음", 400, JSON.stringify({ code: "a b" }), { kind: "rejected", status: 400 }],
  ] as const)("%s", (_name, status, body, want) => {
    expect(judgeExchange(status, body)).toEqual(want);
  });

  it("결과에 토큰·본문이 없다", () => {
    const out = JSON.stringify([judgeExchange(200, OK), judgeExchange(401, JSON.stringify({ code: "E", message: "secret-message" }))]);
    expect(out).not.toContain("synthetic");
    expect(out).not.toContain("secret-message");
  });

  it("unreachable", () => {
    expect(unreachable(true)).toEqual({ kind: "unreachable", timedOut: true });
    expect(unreachable(false)).toEqual(down);
  });
});

describe("단계 계획", () => {
  it("②는 ①이 수락이 아닐 때만", () => {
    expect(needSecond(accepted)).toBe(false);
    expect(needSecond(rejected)).toBe(true);
    expect(needSecond(down)).toBe(true);
  });
  it("③은 앞 교환 중 하나가 수락일 때만", () => {
    expect(needThird(accepted, null)).toBe(true);
    expect(needThird(rejected, accepted)).toBe(true);
    expect(needThird(rejected, rejected)).toBe(false);
    expect(needThird(down, down)).toBe(false);
    expect(needThird(rejected, null)).toBe(false);
  });
});

describe("결론", () => {
  it.each([
    ["① 수락", accepted, null, /^묶이지 않는다/],
    ["① 거부 + ② 성공", rejected, accepted, /^묶인다/],
    ["① 거부 + ② 실패 = 구분 불가", rejected, rejected, /^판정 불가: ②도 실패/],
    ["① 거부 + ② 닿지 않음", rejected, down, /^판정 불가/],
    ["① 닿지 않음은 거부로 세지 않는다", down, accepted, /^판정 불가/],
  ] as const)("state: %s", (_name, first, second, want) => {
    expect(stateVerdict(first, second)).toMatch(want);
  });

  it.each([
    ["건너뜀", null, /^판정 불가/],
    ["거부", rejected, /^막힌다/],
    ["수락", accepted, /^막히지 않는다/],
    ["닿지 않음", down, /^판정 불가/],
  ] as const)("재사용: %s", (_name, third, want) => {
    expect(reuseVerdict(third)).toMatch(want);
  });

  it("출력 줄: ① 거부 ② 성공 ③ 거부", () => {
    expect(reportLines({ first: rejected, second: accepted, third: { kind: "rejected", status: 401 } })).toEqual([
      "① 다른 state로 교환: 거부(HTTP 401, code INVALID_REQUEST)",
      "② 원래 state로 교환: 성공",
      "③ 같은 code 재교환: 거부(HTTP 401)",
      "결론 — state 묶임: 묶인다: 다른 state는 거부되고 원래 state로는 교환됐다",
      "결론 — code 재사용: 막힌다: 같은 code의 두 번째 교환이 거부됐다",
    ]);
  });

  it("출력 줄: ① 수락이면 ②는 건너뜀, ①·② 모두 실패면 ③ 건너뜀", () => {
    expect(reportLines({ first: accepted, second: null, third: accepted })[1]).toBe("② 원래 state로 교환: 건너뜀(①이 수락돼 code가 이미 쓰였다)");
    const lines = reportLines({ first: rejected, second: { kind: "unreachable", timedOut: true }, third: null });
    expect(lines[1]).toBe("② 원래 state로 교환: 판정 불가(시간 초과)");
    expect(lines[2]).toBe("③ 같은 code 재교환: 건너뜀(앞 교환이 하나도 성공하지 않았다)");
  });
});
