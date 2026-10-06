// core/keys(docs/design/worker.md §9.1, 구현 중 변경 14 (라)): 경로 문법·SHA256SUMS 해석(xtask parse_sums와 같은 규칙)·보이는 키.
import { describe, expect, it } from "vitest";
import expectedArtifacts from "../../../release/expected-artifacts.json?raw";
import { CI_ONLY_FILES, isUserVisible, META_FILES, parseReleasePath, parseSha256Sums, parseSha256SumsBytes, sumsKey } from "../../src/core/keys";

describe("parseReleasePath", () => {
  it("latest.json", () => {
    expect(parseReleasePath("/releases/latest.json")).toEqual({ kind: "latest", key: "releases/latest.json" });
  });

  it.each([
    ["/releases/0.2.0/SHA256SUMS", "0.2.0", "SHA256SUMS"],
    ["/releases/1.0.0-rc.1/x.sig", "1.0.0-rc.1", "x.sig"],
    ["/releases/1.0.0/manifest.json", "1.0.0", "manifest.json"],
    ["/releases/1.0.0/previous", "1.0.0", "previous"],
    ["/releases/1.0.0/latest.json", "1.0.0", "latest.json"],
    ["/releases/1.0.0/a", "1.0.0", "a"],
    ["/releases/1.0.0/.hidden", "1.0.0", ".hidden"],
    [`/releases/1.0.0/${"a".repeat(128)}`, "1.0.0", "a".repeat(128)],
  ])("통과: %s", (p, version, file) => {
    expect(parseReleasePath(p)).toEqual({ kind: "file", version, file, key: `releases/${version}/${file}` });
  });

  it.each([
    "/RELEASES/1.0.0/x",
    "/releases/1.0.0/%2e",
    "/releases/1.0.0/%2E%2E",
    "/releases/1.0.0/..x",
    "/releases/1.0.0/x..",
    "/releases/1.0.0/..",
    "/releases/1.0.0/.",
    `/releases/1.0.0/${"a".repeat(129)}`,
    "/releases/v1.0.0/x",
    "/releases/01.0.0/x",
    "/releases/1.0/x",
    "/releases/1.0.0-a..b/x",
    "/releases/1.0.0-/x",
    "/releases/1.0.0+b/x",
    "/releases/18446744073709551616.0.0/x",
    "/releases/1.0.0/",
    "/releases/1.0.0/a/b",
    "/releases/1.0.0/a b",
    "/releases/1.0.0/a\\b",
    "/releases/latest.JSON",
    "/releases/latest.json/",
    "/releases/latest",
    "/releases/",
    "/releases",
    "releases/1.0.0/x",
    "//releases/1.0.0/x",
    "/releases/1.0.0/x?y",
    "/releases/1.0.0/x\n",
    "",
  ])("null(400 bad_key): %j", (p) => {
    expect(parseReleasePath(p)).toBeNull();
  });

  it("릴리스 산출물 이름(release/expected-artifacts.json)과 updater .sig가 모두 문법을 통과한다", () => {
    const table = JSON.parse(expectedArtifacts) as Record<string, { artifacts?: { name: string; updater?: string[] }[] }>;
    const names: string[] = [];
    for (const [os, v] of Object.entries(table)) {
      if (os.startsWith("$")) continue;
      for (const a of v.artifacts ?? []) {
        const file = `chzzk-downloader_1.0.0-rc.1_${a.name}`;
        names.push(file);
        if (a.updater?.length) names.push(`${file}.sig`);
      }
    }
    expect(names.length).toBeGreaterThanOrEqual(6);
    for (const f of [...names, ...META_FILES, ...CI_ONLY_FILES]) {
      expect(parseReleasePath(`/releases/1.0.0-rc.1/${f}`), f).not.toBeNull();
    }
  });

  it("sumsKey", () => {
    expect(sumsKey("0.2.0")).toBe("releases/0.2.0/SHA256SUMS");
  });
});

describe("parseSha256Sums", () => {
  const h = (c: string) => c.repeat(64);
  const ok = `${h("a")}  app.dmg\n${h("b")}  app.dmg.sig\n`;

  it("정상", () => {
    expect(parseSha256Sums(ok)).toEqual(
      new Map([
        ["app.dmg", h("a")],
        ["app.dmg.sig", h("b")],
      ]),
    );
  });
  it("CRLF(줄 끝 \\r 하나를 뗀다)", () => {
    expect(parseSha256Sums(`${h("a")}  app.dmg\r\n${h("b")}  x\r\n`)).toEqual(
      new Map([
        ["app.dmg", h("a")],
        ["x", h("b")],
      ]),
    );
  });
  it("빈 텍스트는 빈 Map", () => {
    expect(parseSha256Sums("")).toEqual(new Map());
  });
  it("파일 이름의 공백은 첫 두 칸 뒤 그대로", () => {
    expect(parseSha256Sums(`${h("c")}  a  b\n`)).toEqual(new Map([["a  b", h("c")]]));
  });

  it.each([
    ["끝 줄바꿈 없음", `${h("a")}  app.dmg`],
    ["공백 하나", `${h("a")} app.dmg\n`],
    ["대문자 hex", `${h("A")}  app.dmg\n`],
    ["63자", `${"a".repeat(63)}  app.dmg\n`],
    ["65자", `${"a".repeat(65)}  app.dmg\n`],
    ["hex 아님", `${h("g")}  app.dmg\n`],
    ["/ 포함", `${h("a")}  dir/app.dmg\n`],
    ["빈 파일 이름", `${h("a")}  \n`],
    ["중복", `${h("a")}  x\n${h("b")}  x\n`],
    ["빈 줄", `${h("a")}  x\n\n`],
    ["줄바꿈만", "\n"],
    ["별표 이진 표시", `${h("a")} *x\n`],
  ])("null: %s", (_name, text) => {
    expect(parseSha256Sums(text)).toBeNull();
  });

  it("바이트: 잘못된 UTF-8은 null, 정상은 같은 결과", () => {
    expect(parseSha256SumsBytes(new Uint8Array([0x61, 0x20, 0x20, 0xff, 0x0a]))).toBeNull();
    expect(parseSha256SumsBytes(new TextEncoder().encode(ok))).toEqual(parseSha256Sums(ok));
    // BOM은 떼지 않는다(xtask String::from_utf8와 같이 첫 hex가 틀려 null, 닫힌 쪽)
    expect(parseSha256SumsBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(ok)]))).toBeNull();
  });
});

describe("isUserVisible", () => {
  const sums = new Map([
    ["app.dmg", "a".repeat(64)],
    ["app.deb", "b".repeat(64)],
    ["app.tar.gz.sig", "c".repeat(64)],
    ["previous", "d".repeat(64)],
    ["latest.json", "e".repeat(64)],
  ]);

  it.each([
    ["app.dmg", sums, true],
    ["app.deb", sums, true],
    ["app.tar.gz.sig", sums, true],
    ["other.dmg", sums, false],
    ["previous", sums, false],
    ["latest.json", sums, false],
    ["SHA256SUMS", sums, true],
    ["manifest.json", sums, true],
    ["SHA256SUMS", null, true],
    ["manifest.json", null, true],
    ["app.dmg", null, false],
    ["previous", null, false],
    ["app.dmg", new Map(), false],
  ] as const)("%s → %s", (f, s, want) => {
    expect(isUserVisible(f, s)).toBe(want);
  });
});
