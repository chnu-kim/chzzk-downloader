// core/updater(docs/design/worker.md §9.3, 구현 중 변경 14 (사)): 200(update)·204(none)·400(current null)·500(invalid_latest).
import { describe, expect, it } from "vitest";
import { parseVersion, type Version } from "../../src/core/semver";
import { decideUpdate, parseCurrentVersion } from "../../src/core/updater";

const enc = (s: string) => new TextEncoder().encode(s);
const latest = (version: unknown) => enc(JSON.stringify({ version, pub_date: "2026-01-01T00:00:00Z", platforms: {} }));
const cur = (s: string): Version => {
  const v = parseVersion(s);
  if (v === null) throw new Error(s);
  return v;
};

describe("decideUpdate", () => {
  it.each([
    ["1.0.0", "0.9.0", "update"],
    ["0.10.0", "0.9.9", "update"],
    ["1.0.0", "0.0.0", "update"],
    ["1.0.0", "1.0.0-rc.1", "update"],
    ["1.0.0-rc.2", "1.0.0-rc.1", "update"],
    ["1.0.0", "1.0.0", "none"],
    ["1.0.0", "1.0.1", "none"],
    ["1.0.0-rc.1", "1.0.0", "none"],
  ])("latest %s, current %s → %s", (l, c, want) => {
    expect(decideUpdate(latest(l), cur(c)).kind).toBe(want);
  });

  it("deploy-worker 계약: 0.0.0 요청은 늘 update(200)", () => {
    expect(decideUpdate(latest("0.0.1"), cur("0.0.0")).kind).toBe("update");
  });

  it("latest 없음 → none(204)", () => {
    expect(decideUpdate(null, cur("0.0.0"))).toEqual({ kind: "none" });
  });

  it("update는 같은 바이트 객체를 돌려준다", () => {
    const bytes = latest("2.0.0");
    const d = decideUpdate(bytes, cur("1.0.0"));
    expect(d.kind).toBe("update");
    if (d.kind === "update") expect(d.body).toBe(bytes);
  });

  it.each([
    ["깨진 JSON", enc("{")],
    ["빈 바이트", new Uint8Array()],
    ["배열", enc("[]")],
    ["null", enc("null")],
    ["문자열", enc('"1.0.0"')],
    ["version 없음", enc("{}")],
    ["숫자 version", latest(1)],
    ["version 1.0", latest("1.0")],
    ["version v1.0.0", latest("v1.0.0")],
    ["version 1.0.0+b", latest("1.0.0+b")],
    ["잘못된 UTF-8", new Uint8Array([0x7b, 0xff, 0x7d])],
    ["BOM(떼지 않는다)", new Uint8Array([0xef, 0xbb, 0xbf, ...latest("9.0.0")])],
  ])("invalid_latest(500): %s", (_name, bytes) => {
    expect(decideUpdate(bytes, cur("0.0.0"))).toEqual({ kind: "invalid_latest" });
  });
});

describe("parseCurrentVersion", () => {
  it.each([
    ["1.0.0", "1.0.0"],
    ["1.0.0-rc.1", "1.0.0-rc.1"],
    ["0.0.0", "0.0.0"],
    ["1%2E0%2E0", "1.0.0"],
  ])("%s → %s", (seg, want) => {
    expect(parseCurrentVersion(seg)).toEqual(parseVersion(want));
  });
  it.each(["1.0.0%2Bb", "1.0.0+b", "%ZZ", "%", "v1.0.0", "1.0", "", "1.0.0%00", "1.0.0%20"])("null(400): %j", (seg) => {
    expect(parseCurrentVersion(seg)).toBeNull();
  });
});
