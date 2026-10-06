// 표시 형식(docs/design/worker.md 구현 중 변경 35 (바)).
import { describe, expect, it } from "vitest";
import { COPY } from "../../src/http/copy";
import { auditLabel, kindLabel, kst } from "../../src/http/format";
import type { AuditAction } from "../../src/store/types";

describe("kst", () => {
  it("UTC 00:00은 KST 09:00", () => {
    expect(kst(Date.UTC(2030, 0, 1, 0, 0))).toBe("2030-01-01 09:00");
  });

  it("날짜가 넘어간다", () => {
    expect(kst(Date.UTC(2030, 0, 1, 15, 30))).toBe("2030-01-02 00:30");
  });

  it("초는 버린다", () => {
    expect(kst(Date.UTC(2030, 11, 31, 14, 59, 59))).toBe("2030-12-31 23:59");
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
