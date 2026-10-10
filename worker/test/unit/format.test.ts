// 표시 형식(docs/design/worker.md 구현 중 변경 38 (바), content.md D49).
// 날짜·시각 골든은 앱과 같은 파일(design/format/date.json·datetime.json)을 읽는다: 앱 TS(format.test.ts)와 Rust도 같은 표를 본다.
import { describe, expect, it } from "vitest";
import { COPY } from "../../src/http/copy";
import { auditLabel, formatDate, formatDateTime, KST_OFFSET_MS, kindLabel, kst, kstDate, kstWall, type Wall } from "../../src/http/format";
import type { AuditAction } from "../../src/store/types";

interface Golden {
  readonly fn: string;
  readonly cases: readonly { readonly name: string; readonly args: readonly [Wall]; readonly out: string }[];
}

// vite의 glob으로 저장소 루트 design/format/ 의 JSON을 읽는다(워커 tsconfig에 resolveJsonModule을 더하지 않으려고 타입을 직접 적는다)
const files = (import.meta as unknown as { glob: (p: string, o: { eager: true; import: "default" }) => Record<string, Golden> }).glob("../../../design/format/*.json", {
  eager: true,
  import: "default",
});
const golden = (fn: string): Golden => {
  const g = Object.values(files).find((x) => x.fn === fn);
  if (g === undefined) throw new Error(`골든 ${fn}이 없다`);
  return g;
};
const dateCases = golden("formatDate").cases.map((c) => [c.name, c] as const);
const dateTimeCases = golden("formatDateTime").cases.map((c) => [c.name, c] as const);
// UTC에서 9시간을 뺀 epoch ms가 KST 벽시계 w다
const msOf = (w: Wall) => Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - KST_OFFSET_MS;

describe("D49 골든(앱과 공유)", () => {
  it("골든 파일을 읽었다", () => {
    expect(dateCases.length).toBeGreaterThan(5);
    expect(dateTimeCases.length).toBeGreaterThan(5);
  });

  it.each(dateCases)("formatDate: %s", (_n, c) => {
    expect(formatDate(c.args[0])).toBe(c.out);
  });

  it.each(dateTimeCases)("formatDateTime: %s", (_n, c) => {
    expect(formatDateTime(c.args[0])).toBe(c.out);
  });

  // 같은 골든을 KST epoch ms 경로(kst·kstDate)로도 통과시킨다
  it.each(dateTimeCases)("kst: %s", (_n, c) => {
    expect(kst(msOf(c.args[0]))).toBe(c.out);
  });

  it.each(dateCases)("kstDate: %s", (_n, c) => {
    expect(kstDate(msOf(c.args[0]))).toBe(c.out);
  });
});

describe("kst", () => {
  it("UTC 00:00은 KST 오전 9:00", () => {
    expect(kst(Date.UTC(2030, 0, 1, 0, 0))).toBe("2030. 1. 1. 오전 9:00");
  });

  it("날짜가 넘어간다: UTC 15:30은 다음 날 오전 12:30", () => {
    expect(kst(Date.UTC(2030, 0, 1, 15, 30))).toBe("2030. 1. 2. 오전 12:30");
  });

  it("초는 버린다", () => {
    expect(kst(Date.UTC(2030, 11, 31, 14, 59, 59))).toBe("2030. 12. 31. 오후 11:59");
  });

  it("kstDate는 날짜만(끝 마침표 포함)", () => {
    expect(kstDate(Date.UTC(2030, 11, 31, 15, 0))).toBe("2031. 1. 1.");
  });

  it("kstWall은 KST 벽시계다", () => {
    expect(kstWall(Date.UTC(2030, 0, 1, 15, 5))).toEqual({ y: 2030, mo: 1, d: 2, h: 0, mi: 5 });
  });
});

describe("라벨", () => {
  it("감사 동작 6개가 모두 문구를 갖는다", () => {
    const all: AuditAction[] = ["allow", "disallow", "revoke_session", "reuse_detected", "refresh_recovered", "dismiss"];
    expect(Object.keys(COPY.audit).sort()).toEqual([...all].sort());
    for (const a of all) expect(auditLabel(a)).toBe(COPY.audit[a]);
  });

  it("세션 종류", () => {
    expect(kindLabel("app")).toBe("앱");
    expect(kindLabel("web")).toBe("웹");
  });
});
