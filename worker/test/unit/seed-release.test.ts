// 합성 릴리스 생성기(test/seed-release.mjs, docs/design/worker.md 구현 중 변경 31 (카)): xtask와 같은 모양, 스키마 통과, 결정적.
import { describe, expect, it } from "vitest";
import expectedText from "../../../release/expected-artifacts.json?raw";
import schemaText from "../../../release/latest.schema.json?raw";
import { parseSha256Sums } from "../../src/core/keys";
import { buildSeed, expectedArtifacts, expectedFiles, fakeBytes, fakeSignature, SEED_BASE, sha256Hex, verifyKeys, type ExpectedTable } from "../seed-release.mjs";

const TABLE = JSON.parse(expectedText) as ExpectedTable;
const SCHEMA = JSON.parse(schemaText) as {
  properties: {
    version: { pattern: string };
    pub_date: { pattern: string };
    platforms: { required: string[]; properties: Record<string, { properties: { url: { pattern: string }; signature: { pattern: string; minLength: number } } }> };
  };
};
const dec = new TextDecoder();

describe("표 계산", () => {
  it("expectedFiles: 11개, 모두 접두 + 버전, .sig는 updater 산출물 5개에만", () => {
    const files = expectedFiles(TABLE, "0.2.0");
    expect(files.size).toBe(11);
    for (const f of files) expect(f.startsWith("chzzk-downloader_0.2.0_")).toBe(true);
    expect([...files].filter((f) => f.endsWith(".sig"))).toHaveLength(5);
    expect(files.has("chzzk-downloader_0.2.0_darwin-aarch64.dmg.sig")).toBe(false);
  });

  it("verifyKeys 순서: SUMS·manifest, 산출물은 linux→darwin→windows, .sig는 바로 뒤, latest면 마지막", () => {
    const keys = verifyKeys(TABLE, "0.2.0", true);
    const p = "releases/0.2.0/chzzk-downloader_0.2.0_";
    expect(keys).toEqual([
      "releases/0.2.0/SHA256SUMS",
      "releases/0.2.0/manifest.json",
      `${p}linux-x86_64.AppImage`,
      `${p}linux-x86_64.AppImage.sig`,
      `${p}linux-x86_64.deb`,
      `${p}linux-x86_64.deb.sig`,
      `${p}darwin-aarch64.dmg`,
      `${p}darwin-aarch64.app.tar.gz`,
      `${p}darwin-aarch64.app.tar.gz.sig`,
      `${p}windows-x86_64-setup.exe`,
      `${p}windows-x86_64-setup.exe.sig`,
      `${p}windows-x86_64.msi`,
      `${p}windows-x86_64.msi.sig`,
      "releases/latest.json",
    ]);
    expect(verifyKeys(TABLE, "0.1.0", false)).toHaveLength(13);
  });
});

describe("buildSeed", () => {
  it("latest = 마지막 버전 manifest, previous는 none·앞 버전, SUMS는 해시·정렬·끝 줄바꿈", async () => {
    const seed = await buildSeed(TABLE, ["0.1.0", "0.2.0"]);
    expect(seed.get("releases/latest.json")).toEqual(seed.get("releases/0.2.0/manifest.json"));
    expect(dec.decode(seed.get("releases/0.1.0/previous"))).toBe("none");
    expect(dec.decode(seed.get("releases/0.2.0/previous"))).toBe("0.1.0");
    for (const v of ["0.1.0", "0.2.0"]) {
      const text = dec.decode(seed.get(`releases/${v}/SHA256SUMS`));
      expect(text.endsWith("\n")).toBe(true);
      const sums = parseSha256Sums(text);
      expect(sums).not.toBeNull();
      const names = [...(sums ?? new Map()).keys()];
      expect(names).toEqual([...names].sort());
      expect(new Set(names)).toEqual(expectedFiles(TABLE, v));
      for (const [name, hex] of sums ?? []) expect([name, await sha256Hex(seed.get(`releases/${v}/${name}`) as Uint8Array)]).toEqual([name, hex]);
    }
  });

  it("키 집합 = verifyKeys + previous", async () => {
    const seed = await buildSeed(TABLE, ["0.1.0"]);
    expect([...seed.keys()].sort()).toEqual([...verifyKeys(TABLE, "0.1.0", false), "releases/0.1.0/previous", "releases/latest.json"].sort());
  });

  it("두 번 만들면 같은 바이트", async () => {
    const a = await buildSeed(TABLE, ["0.1.0", "0.2.0"]);
    const b = await buildSeed(TABLE, ["0.1.0", "0.2.0"]);
    expect([...a.keys()]).toEqual([...b.keys()]);
    for (const [k, v] of a) expect([k, [...(b.get(k) as Uint8Array)]]).toEqual([k, [...v]]);
  });

  it("fakeBytes: 파일 이름마다 다르고 크기가 정확하다", () => {
    expect(fakeBytes("a", 1024)).toHaveLength(1024);
    expect(fakeBytes("a", 10)).toHaveLength(10);
    expect([...fakeBytes("a", 30)]).not.toEqual([...fakeBytes("b", 30)]);
  });
});

describe("스키마 대조(release/latest.schema.json)", () => {
  it("manifest.json이 스키마의 패턴·필수 키를 통과한다", async () => {
    const seed = await buildSeed(TABLE, ["0.2.0"]);
    const m = JSON.parse(dec.decode(seed.get("releases/0.2.0/manifest.json"))) as { version: string; pub_date: string; platforms: Record<string, { signature: string; url: string }> };
    expect(Object.keys(m).sort()).toEqual(["platforms", "pub_date", "version"]);
    expect(new RegExp(SCHEMA.properties.version.pattern).test(m.version)).toBe(true);
    expect(new RegExp(SCHEMA.properties.pub_date.pattern).test(m.pub_date)).toBe(true);
    const updaterKeys = expectedArtifacts(TABLE, "0.2.0").flatMap((a) => a.updater);
    expect(updaterKeys).toHaveLength(6);
    expect(Object.keys(m.platforms).sort()).toEqual([...updaterKeys].sort());
    expect(Object.keys(m.platforms).sort()).toEqual([...SCHEMA.properties.platforms.required].sort());
    for (const a of expectedArtifacts(TABLE, "0.2.0")) {
      for (const key of a.updater) {
        const p = m.platforms[key];
        const rule = SCHEMA.properties.platforms.properties[key]?.properties;
        expect(p).toBeDefined();
        expect(rule).toBeDefined();
        expect(new RegExp(rule?.url.pattern ?? "").test(p?.url ?? "")).toBe(true);
        expect(p?.url).toBe(`${SEED_BASE}/releases/0.2.0/${a.file}`);
        expect((p?.signature ?? "").length).toBeGreaterThanOrEqual(rule?.signature.minLength ?? Infinity);
        expect(new RegExp(rule?.signature.pattern ?? "").test(p?.signature ?? "")).toBe(true);
        expect(p?.signature).toBe(fakeSignature(a.file));
        expect(p?.signature).toBe(dec.decode(seed.get(`releases/0.2.0/${a.file}.sig`)));
      }
    }
  });
});
