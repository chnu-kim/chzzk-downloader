// core/updater(docs/design/worker.md §9.3, 구현 중 변경 14 (사)): 200(update)·204(none)·400(current null)·500(invalid_latest).
import { describe, expect, it } from "vitest";
import { parseVersion, type Version } from "../../src/core/semver";
import { decideUpdate, parseCurrentVersion } from "../../src/core/updater";

const enc = (s: string) => new TextEncoder().encode(s);
const latest = (version: unknown) => enc(JSON.stringify({ version, pub_date: "2026-01-01T00:00:00Z", platforms: {} }));
const ORIGIN = "https://new.example.test";
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
    expect(decideUpdate(latest(l), cur(c), ORIGIN).kind).toBe(want);
  });

  it("deploy-worker 계약: 0.0.0 요청은 늘 update(200)", () => {
    expect(decideUpdate(latest("0.0.1"), cur("0.0.0"), ORIGIN).kind).toBe("update");
  });

  it("latest 없음 → none(204)", () => {
    expect(decideUpdate(null, cur("0.0.0"), ORIGIN)).toEqual({ kind: "none" });
  });

  it("update는 같은 바이트 객체를 돌려준다", () => {
    const bytes = latest("2.0.0");
    const d = decideUpdate(bytes, cur("1.0.0"), ORIGIN);
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
    expect(decideUpdate(bytes, cur("0.0.0"), ORIGIN)).toEqual({ kind: "invalid_latest" });
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
  it("아주 긴 숫자 성분(10만 자리)은 null(400)", () => {
    expect(parseCurrentVersion(`${"9".repeat(100_000)}.0.0`)).toBeNull();
    expect(parseCurrentVersion(`1%2E0%2E${"1".repeat(100_000)}`)).toBeNull();
  });
  it.each(["1.0.0%2Bb", "1.0.0+b", "%ZZ", "%", "v1.0.0", "1.0", "", "1.0.0%00", "1.0.0%20"])("null(400): %j", (seg) => {
    expect(parseCurrentVersion(seg)).toBeNull();
  });
});

// 이름 변경 전환(구현 중 변경 103): 옛 앱은 컴파일된 Worker 출처와 다른 download_url을 Untrusted로 거부한다.
// 두 Worker가 같은 R2를 읽는 동안 매니페스트의 url 출처를 응답하는 Worker의 PUBLIC_ORIGIN으로 맞춘다(서명은 산출물에 걸려 있어 url과 무관).
describe("decideUpdate: url 출처를 응답하는 Worker에 맞춘다", () => {
  const OLD = "https://old.example.test";
  const manifest = (platforms: Record<string, unknown>) => enc(JSON.stringify({ version: "2.0.0", notes: "n", pub_date: "2026-01-01T00:00:00Z", platforms }));
  const body = (d: ReturnType<typeof decideUpdate>) => {
    if (d.kind !== "update") throw new Error(d.kind);
    return JSON.parse(new TextDecoder().decode(d.body)) as { version: string; notes: string; platforms: Record<string, { signature: string; url: string }> };
  };

  it("다른 출처의 platforms[*].url은 PUBLIC_ORIGIN으로 바뀌고 경로·서명·나머지 필드는 그대로", () => {
    const m = manifest({
      "darwin-aarch64": { signature: "sigA", url: `${OLD}/releases/2.0.0/chzzk-downloader_2.0.0_darwin-aarch64.app.tar.gz` },
      "windows-x86_64": { signature: "sigB", url: `${OLD}/releases/2.0.0/chzzk-downloader_2.0.0_windows-x86_64-setup.exe` },
    });
    const out = body(decideUpdate(m, cur("1.0.0"), ORIGIN));
    expect(out.platforms["darwin-aarch64"]).toEqual({ signature: "sigA", url: `${ORIGIN}/releases/2.0.0/chzzk-downloader_2.0.0_darwin-aarch64.app.tar.gz` });
    expect(out.platforms["windows-x86_64"]).toEqual({ signature: "sigB", url: `${ORIGIN}/releases/2.0.0/chzzk-downloader_2.0.0_windows-x86_64-setup.exe` });
    expect(out.version).toBe("2.0.0");
    expect(out.notes).toBe("n");
  });

  it("이미 같은 출처면 바이트 객체를 그대로 돌려준다(다시 쓰지 않는다)", () => {
    const m = manifest({ "darwin-aarch64": { signature: "s", url: `${ORIGIN}/releases/2.0.0/chzzk-downloader_2.0.0_darwin-aarch64.app.tar.gz` } });
    const d = decideUpdate(m, cur("1.0.0"), ORIGIN);
    expect(d.kind === "update" && d.body === m).toBe(true);
  });

  it("해석할 수 없는 url·url 아닌 항목은 건드리지 않는다(앱이 거부한다)", () => {
    const m = manifest({ a: { signature: "s", url: "not a url" }, b: { signature: "s" }, c: "x" });
    const out = body(decideUpdate(m, cur("1.0.0"), ORIGIN));
    expect(out.platforms).toEqual({ a: { signature: "s", url: "not a url" }, b: { signature: "s" }, c: "x" });
  });

  it("https가 아닌 url은 바꾸지 않는다(앱이 거부한다)", () => {
    const m = manifest({ a: { signature: "s", url: "http://old.example.test/releases/2.0.0/x.exe" } });
    expect(body(decideUpdate(m, cur("1.0.0"), ORIGIN)).platforms.a?.url).toBe("http://old.example.test/releases/2.0.0/x.exe");
  });

  it("/releases/ 아래가 아닌 경로는 바꾸지 않는다", () => {
    const m = manifest({ a: { signature: "s", url: `${OLD}/elsewhere/x.exe` } });
    expect(body(decideUpdate(m, cur("1.0.0"), ORIGIN)).platforms.a?.url).toBe(`${OLD}/elsewhere/x.exe`);
  });
});
