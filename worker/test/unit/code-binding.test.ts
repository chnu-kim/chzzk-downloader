// 치지직 code 묶임 실측 도구의 순수 판정(test/code-binding-lib.mjs, docs/design/worker.md 구현 중 변경 29·42).
import { describe, expect, it } from "vitest";
import {
  judgeExchange,
  needControl,
  needSecond,
  reportLines,
  reuseVerdict,
  stateVerdict,
  thirdTarget,
  unreachable,
  type Exchange,
} from "../code-binding-lib.mjs";

const OK = JSON.stringify({ code: 200, message: null, content: { accessToken: "synthetic-access", refreshToken: "synthetic-refresh" } });
const accepted: Exchange = { kind: "accepted" };
const rejected: Exchange = { kind: "rejected", status: 401, code: "INVALID_REQUEST" };
const down: Exchange = { kind: "unreachable", timedOut: false };
const s503: Exchange = { kind: "transient", status: 503 };
const s429: Exchange = { kind: "transient", status: 429 };

describe("judgeExchange", () => {
  it.each([
    ["래퍼 있음", 200, OK, accepted],
    ["래퍼 없음", 200, JSON.stringify({ accessToken: "synthetic-access" }), accepted],
    ["HTTP 200 + 래퍼 401", 200, JSON.stringify({ code: 401, message: "x", content: null }), { kind: "rejected", status: 200, code: "401" }],
    ["HTTP 200 + 래퍼 문자열 400", 200, JSON.stringify({ code: "400", content: null }), { kind: "rejected", status: 200, code: "400" }],
    ["HTTP 401 + 문자열 code", 401, JSON.stringify({ code: "INVALID_REQUEST", message: "x" }), rejected],
    ["토큰이 있어도 4xx", 400, OK, { kind: "rejected", status: 400, code: "200" }],
    ["긴 code는 싣지 않음", 400, JSON.stringify({ code: "x".repeat(51) }), { kind: "rejected", status: 400 }],
    ["code에 공백이면 싣지 않음", 400, JSON.stringify({ code: "a b" }), { kind: "rejected", status: 400 }],
    // 판정 불가: 서버 오류·요청 수 제한·요청 시간 초과는 거부로 세지 않는다
    ["503", 503, "", { kind: "transient", status: 503 }],
    ["JSON 아닌 500", 500, "<html>", { kind: "transient", status: 500 }],
    ["429", 429, JSON.stringify({ code: "TOO_MANY" }), { kind: "transient", status: 429, code: "TOO_MANY" }],
    ["408", 408, "", { kind: "transient", status: 408 }],
    ["HTTP 200 + 래퍼 500", 200, JSON.stringify({ code: 500, content: null }), { kind: "transient", status: 200, code: "500" }],
    ["HTTP 200 + 래퍼 429", 200, JSON.stringify({ code: 429, content: null }), { kind: "transient", status: 200, code: "429" }],
    ["HTTP 200 + 문자 code", 200, JSON.stringify({ code: "E", content: null }), { kind: "transient", status: 200, code: "E" }],
    ["2xx지만 accessToken 없음", 200, JSON.stringify({ content: {} }), { kind: "transient", status: 200 }],
    ["accessToken에 공백", 200, JSON.stringify({ accessToken: "a b" }), { kind: "transient", status: 200 }],
    ["배열", 200, "[]", { kind: "transient", status: 200 }],
    ["3xx", 302, "", { kind: "transient", status: 302 }],
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
    // 상태를 받은 뒤 본문을 못 읽음: 거부가 아니다(2xx면 토큰이 발급됐을 수 있다)
    expect(unreachable(false, 200)).toEqual({ kind: "unreachable", timedOut: false, status: 200 });
  });
});

describe("단계 계획", () => {
  it("②는 ①이 수락이 아닐 때만", () => {
    expect(needSecond(accepted)).toBe(false);
    expect(needSecond(rejected)).toBe(true);
    expect(needSecond(down)).toBe(true);
    expect(needSecond(s503)).toBe(true);
  });
  it("대조는 ①·② 모두 거부일 때만", () => {
    expect(needControl(rejected, rejected)).toBe(true);
    expect(needControl(rejected, accepted)).toBe(false);
    expect(needControl(rejected, s503)).toBe(false);
    expect(needControl(rejected, down)).toBe(false);
    expect(needControl(s503, rejected)).toBe(false);
    expect(needControl(accepted, null)).toBe(false);
  });
  it("③의 대상은 수락된 교환의 code", () => {
    expect(thirdTarget(accepted, null, null)).toBe("original");
    expect(thirdTarget(rejected, accepted, null)).toBe("original");
    expect(thirdTarget(rejected, rejected, accepted)).toBe("control");
    expect(thirdTarget(rejected, rejected, rejected)).toBe(null);
    expect(thirdTarget(rejected, rejected, "login_failed")).toBe(null);
    expect(thirdTarget(down, down, null)).toBe(null);
    expect(thirdTarget(rejected, null, null)).toBe(null);
  });
});

describe("결론", () => {
  it.each([
    ["① 수락", accepted, null, null, /^묶이지 않는다/],
    ["① 거부 + ② 성공", rejected, accepted, null, /^묶인다: /],
    ["① 거부 + ② 닿지 않음", rejected, down, null, /^판정 불가: ②가 치지직에 닿았는지 모른다/],
    ["① 닿지 않음은 거부로 세지 않는다", down, accepted, null, /^판정 불가: ①이 치지직에 닿았는지 모른다/],
    ["① 503 + ② 성공 = 판정 불가", s503, accepted, null, /^판정 불가: ①이 일시 오류/],
    ["① 429 + ② 성공 = 판정 불가", s429, accepted, null, /^판정 불가/],
    ["① 거부 + ② 503 = 판정 불가", rejected, s503, null, /^판정 불가: ②가 일시 오류/],
    ["① 거부 + ② 거부 + 대조 성공", rejected, rejected, accepted, /^묶인다\(다른 state 거부\) \+ 실패한 교환이 code를 소모할 수 있다/],
    ["① 거부 + ② 거부 + 대조 거부 = 멈춤", rejected, rejected, rejected, /^판정 불가: 대조도 거부돼 자격·만료 문제.*다시 돌리지 말고/],
    ["① 거부 + ② 거부 + 대조 503", rejected, rejected, s503, /^판정 불가: ①·② 모두 거부됐고 대조가 일시 오류.*다시 로그인해/],
    ["① 거부 + ② 거부 + 대조 닿지 않음", rejected, rejected, down, /^판정 불가: .*대조가 치지직에 닿았는지 모른다/],
    ["① 거부 + ② 거부 + 두 번째 로그인 실패", rejected, rejected, "login_failed", /^판정 불가: .*두 번째 로그인을 받지 못했다/],
    ["① 거부 + ② 거부 + 대조 없음", rejected, rejected, null, /^판정 불가: .*대조를 돌리지 않았다/],
  ] as const)("state: %s", (_name, first, second, control, want) => {
    expect(stateVerdict(first, second, control)).toMatch(want);
  });

  it("대조가 거부면 다시 돌리라고 하지 않는다", () => {
    expect(stateVerdict(rejected, rejected, rejected)).not.toMatch(/다시 로그인해/);
  });

  it.each([
    ["건너뜀", null, /^판정 불가/],
    ["거부", rejected, /^막힌다/],
    ["수락", accepted, /^막히지 않는다/],
    ["닿지 않음", down, /^판정 불가: ③이 치지직에 닿았는지 모른다/],
    ["429는 거부가 아니다", judgeExchange(429, ""), /^판정 불가: ③이 일시 오류/],
    ["본문 끊김", unreachable(false, 401), /^판정 불가: ③이 치지직에 닿았는지 모른다\(HTTP 401 뒤 본문 읽기 실패\)/],
  ] as const)("재사용: %s", (_name, third, want) => {
    expect(reuseVerdict(third)).toMatch(want);
  });

  it("출력 줄: ① 거부 ② 성공 ③ 거부", () => {
    expect(reportLines({ first: rejected, second: accepted, third: { kind: "rejected", status: 401 } })).toEqual([
      "① 다른 state로 교환: 거부(HTTP 401, code INVALID_REQUEST)",
      "② 원래 state로 교환: 성공",
      "대조(두 번째 로그인의 code를 원래 state로 먼저 교환): 건너뜀(①·② 모두 거부일 때만 돈다)",
      "③ 같은 code 재교환: 거부(HTTP 401)",
      "결론 — state 묶임: 묶인다: 다른 state는 거부되고 원래 state로는 교환됐다",
      "결론 — code 재사용: 막힌다: 같은 code의 두 번째 교환이 거부됐다",
    ]);
  });

  it("출력 줄: ① 거부 ② 실패 대조 성공 ③(대조의 code) 거부", () => {
    const lines = reportLines({ first: rejected, second: rejected, control: accepted, third: { kind: "rejected", status: 400 } });
    expect(lines[2]).toBe("대조(두 번째 로그인의 code를 원래 state로 먼저 교환): 성공");
    expect(lines[3]).toBe("③ 같은 code 재교환(대조의 code): 거부(HTTP 400)");
    expect(lines[4]).toMatch(/^결론 — state 묶임: 묶인다\(다른 state 거부\)/);
  });

  it("출력 줄: 두 번째 로그인 실패여도 ①·② 줄이 남는다", () => {
    const lines = reportLines({ first: rejected, second: rejected, control: "login_failed", third: null });
    expect(lines[0]).toBe("① 다른 state로 교환: 거부(HTTP 401, code INVALID_REQUEST)");
    expect(lines[1]).toBe("② 원래 state로 교환: 실패(HTTP 401, code INVALID_REQUEST)");
    expect(lines[2]).toBe("대조(두 번째 로그인의 code를 원래 state로 먼저 교환): 판정 불가(두 번째 로그인을 받지 못했다)");
  });

  it("출력 줄: ① 수락이면 ②는 건너뜀, ①·② 모두 판정 불가면 ③ 건너뜀", () => {
    expect(reportLines({ first: accepted, second: null, third: accepted })[1]).toBe("② 원래 state로 교환: 건너뜀(①이 수락돼 code가 이미 쓰였다)");
    const lines = reportLines({ first: rejected, second: { kind: "unreachable", timedOut: true }, third: null });
    expect(lines[1]).toBe("② 원래 state로 교환: 판정 불가(시간 초과)");
    expect(lines[3]).toBe("③ 같은 code 재교환: 건너뜀(앞 교환이 하나도 성공하지 않았다)");
    expect(reportLines({ first: s503, second: s429, third: null })[0]).toBe("① 다른 state로 교환: 판정 불가(HTTP 503)");
  });
});
