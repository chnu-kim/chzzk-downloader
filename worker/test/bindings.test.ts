// 테스트 바인딩 = 자리표시(docs/design/worker.md §10.2, W1 수락 기준). vitest.config.ts가 모든 설정 키를 .dev.vars.example 값으로
// 덮는다. 이 파일은 결과(값 = 자리표시, 문자열 바인딩 집합 = CONFIG_KEYS)를 고정할 뿐 "실제 비밀값 파일을 열지 않는다"의 지킴이는
// 아니다: 로컬의 그 파일은 CONFIG_KEYS 안의 두 키뿐이라 열려도 덮기에 가려진다. 지킴이는 둘이다(worker.md 구현 중 변경 5·9):
// scripts/ci/worker-config.mjs가 vitest.config.ts의 environment "example"을 보고, CI에서는 worker gate가 그 자리에
// LEAK_SENTINEL 키 하나만 담은 가짜 파일을 심어(--sentinel plant) 설정이 그 파일을 읽으면 아래 집합 비교가 실패한다.
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { CONFIG_KEYS } from "../src/config";
import example from "../.dev.vars.example?raw";

function parse(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    out[t.slice(0, i)] = t.slice(i + 1);
  }
  return out;
}

const EXPECTED = parse(example);
const e = env as unknown as Record<string, unknown>;

it(".dev.vars.example의 키 집합 = CONFIG_KEYS", () => {
  expect(Object.keys(EXPECTED).sort()).toEqual([...CONFIG_KEYS].sort());
});

it("각 설정 바인딩 = .dev.vars.example의 자리표시 값", () => {
  for (const k of CONFIG_KEYS) expect([k, e[k]]).toEqual([k, EXPECTED[k]]);
});

it("문자열 바인딩은 설정 키뿐이다(CI 씨앗 LEAK_SENTINEL 같은 다른 env 파일의 키가 섞이지 않았다)", () => {
  const strings = Object.keys(e).filter((k) => typeof e[k] === "string");
  expect(strings.sort()).toEqual([...CONFIG_KEYS].sort());
});

it("자리표시 모양: 출처·치지직 주소는 루프백, 자격 값은 dev- 접두", () => {
  for (const k of ["PUBLIC_ORIGIN", "CHZZK_AUTHORIZE_URL", "CHZZK_API_BASE"]) {
    expect(["localhost", "127.0.0.1"]).toContain(new URL(String(e[k])).hostname);
  }
  for (const k of ["CHZZK_CLIENT_ID", "CHZZK_CLIENT_SECRET", "CI_VERIFY_TOKEN"]) expect(String(e[k])).toMatch(/^dev-/);
});

it("DO·R2 바인딩 이름(AUTH·DIST)", () => {
  expect(typeof e.AUTH).toBe("object");
  expect(typeof e.DIST).toBe("object");
});
