// core/landing(docs/design/worker.md 구현 중 변경 38 (가)): latest.json 요약, 랜딩 표 행, 산출물 표와의 일치.
import { describe, expect, it } from "vitest";
import expectedText from "../../../release/expected-artifacts.json?raw";
import { ARTIFACT_PREFIX, LANDING_FILES, MIN_OS, OS_NAME, PRIMARY_ARTIFACT, artifactFile, detectedOs, landingRows, parseLatestView } from "../../src/core/landing";
import { type ExpectedTable, buildSeed } from "../seed-release.mjs";

const enc = (s: string) => new TextEncoder().encode(s);
const TABLE = JSON.parse(expectedText) as ExpectedTable;

describe("parseLatestView", () => {
  it("null이면 none", () => {
    expect(parseLatestView(null)).toEqual({ kind: "none" });
  });

  it("합성 릴리스의 latest.json: 0.2.0 · 2030-01-01", async () => {
    const seed = await buildSeed(TABLE, ["0.1.0", "0.2.0"]);
    expect(parseLatestView(seed.get("releases/latest.json") ?? null)).toEqual({ kind: "ok", version: "0.2.0", pubDate: "2030-01-01" });
  });

  it.each([
    ["BOM + JSON", new Uint8Array([0xef, 0xbb, 0xbf, ...enc('{"version":"1.2.3"}')])],
    ["잘못된 UTF-8", new Uint8Array([0xff])],
    ["JSON이 아님", enc("{")],
    ["배열", enc("[]")],
    ["null", enc("null")],
    ["version이 숫자", enc('{"version":1}')],
    ["version이 없음", enc("{}")],
    ["v 접두", enc('{"version":"v1"}')],
    ["빌드 메타데이터", enc('{"version":"1.0.0+b"}')],
  ])("%s는 invalid", (_name, bytes) => {
    expect(parseLatestView(bytes)).toEqual({ kind: "invalid" });
  });

  it("prerelease는 받고 pub_date가 없으면 null", () => {
    expect(parseLatestView(enc('{"version":"1.2.3-rc.1"}'))).toEqual({ kind: "ok", version: "1.2.3-rc.1", pubDate: null });
  });

  it("pub_date 모양이 틀리면 null, 맞으면 KST 날짜 10자", () => {
    expect(parseLatestView(enc('{"version":"1.2.3","pub_date":"bad"}'))).toEqual({ kind: "ok", version: "1.2.3", pubDate: null });
    expect(parseLatestView(enc('{"version":"1.2.3","pub_date":5}'))).toEqual({ kind: "ok", version: "1.2.3", pubDate: null });
    expect(parseLatestView(enc('{"version":"1.2.3","pub_date":"2030-02-03T04:05:06Z"}'))).toEqual({ kind: "ok", version: "1.2.3", pubDate: "2030-02-03" });
    // UTC 15:00 이후는 KST로 다음 날이다(화면 시각은 KST, 구현 중 변경 38 (바))
    expect(parseLatestView(enc('{"version":"1.2.3","pub_date":"2030-02-03T15:00:00Z"}'))).toEqual({ kind: "ok", version: "1.2.3", pubDate: "2030-02-04" });
    expect(parseLatestView(enc('{"version":"1.2.3","pub_date":"2030-02-03T14:59:59Z"}'))).toEqual({ kind: "ok", version: "1.2.3", pubDate: "2030-02-03" });
    expect(parseLatestView(enc('{"version":"1.2.3","pub_date":"2030-02-03T23:00:00+09:00"}'))).toEqual({ kind: "ok", version: "1.2.3", pubDate: "2030-02-03" });
    expect(parseLatestView(enc('{"version":"1.2.3","pub_date":"2030-13-45T00:00:00Z"}'))).toEqual({ kind: "ok", version: "1.2.3", pubDate: null });
  });
});

describe("landingRows", () => {
  const v = "0.2.0";
  const hex = (n: number) => String(n).repeat(64).slice(0, 64);

  it("다섯 개 + .sig + .app.tar.gz: LANDING_FILES 순서의 5행", () => {
    const sums = new Map<string, string>([
      [artifactFile(v, "darwin-aarch64.app.tar.gz"), hex(9)],
      [artifactFile(v, "darwin-aarch64.app.tar.gz.sig"), hex(8)],
      ...LANDING_FILES.slice().reverse().map((f, i) => [artifactFile(v, f.name), hex(i)] as [string, string]),
    ]);
    const rows = landingRows(v, sums);
    expect(rows.map((r) => r.id)).toEqual(["dmg", "setup", "msi", "appimage", "deb"]);
    expect(rows.map((r) => r.file)).toEqual(LANDING_FILES.map((f) => `${ARTIFACT_PREFIX}_${v}_${f.name}`));
    expect(rows[0]?.sha256).toBe(hex(4));
  });

  it("둘만 있으면 2행, 비면 []", () => {
    const two = new Map([
      [artifactFile(v, "linux-x86_64.deb"), hex(1)],
      [artifactFile(v, "darwin-aarch64.dmg"), hex(2)],
    ]);
    expect(landingRows(v, two).map((r) => r.id)).toEqual(["dmg", "deb"]);
    expect(landingRows(v, new Map())).toEqual([]);
  });

  it("다른 버전의 파일은 넣지 않는다", () => {
    expect(landingRows(v, new Map([[artifactFile("0.1.0", "darwin-aarch64.dmg"), hex(1)]]))).toEqual([]);
  });
});

describe("표 일치", () => {
  it("LANDING_FILES = release/expected-artifacts.json에서 release가 아닌 산출물(사용자용 설치 파일)", () => {
    const names: string[] = [];
    for (const os of Object.values(TABLE) as unknown[]) {
      const artifacts = (os as { artifacts?: { name: string; release?: boolean }[] } | null)?.artifacts;
      for (const a of artifacts ?? []) if (a.release !== true) names.push(a.name);
    }
    expect(names.sort()).toEqual(LANDING_FILES.map((f) => f.name).sort());
    expect(names).toHaveLength(5);
  });
});

describe("최소 OS·주 산출물·감지(계약 §2.7)", () => {
  it("MIN_OS는 macOS 13.3 · Windows 10 · Ubuntu 22.04 [잠정]", () => {
    expect(MIN_OS).toEqual({ macos: "macOS 13.3", windows: "Windows 10", linux: "Ubuntu 22.04" });
    expect(OS_NAME).toEqual({ macos: "macOS", windows: "Windows", linux: "Linux" });
  });

  it("OS별 주 산출물: dmg · setup(권장) · AppImage. 각 산출물은 그 OS의 것이다", () => {
    expect(PRIMARY_ARTIFACT).toEqual({ macos: "dmg", windows: "setup", linux: "appimage" });
    for (const [os, id] of Object.entries(PRIMARY_ARTIFACT)) expect(LANDING_FILES.find((f) => f.id === id)?.os).toBe(os);
  });

  it("detectedOs: 데스크톱 세 종류만 잡고 그 밖은 null", () => {
    const e = (kind: "bot" | "phone" | "desktop" | "unknown", os: "mac" | "windows" | "linux" | "other" | null) => ({ kind, os, inApp: null });
    expect(detectedOs(e("desktop", "mac"))).toBe("macos");
    expect(detectedOs(e("desktop", "windows"))).toBe("windows");
    expect(detectedOs(e("desktop", "linux"))).toBe("linux");
    expect(detectedOs(e("desktop", "other"))).toBeNull();
    expect(detectedOs(e("desktop", null))).toBeNull();
    for (const kind of ["bot", "phone", "unknown"] as const) expect(detectedOs(e(kind, null))).toBeNull();
  });
});
