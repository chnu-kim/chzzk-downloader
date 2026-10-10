// 에셋 표(스타일시트 + 바이너리 에셋)와 /favicon.ico 별칭(docs/design/system/web.md §4, 계약 §2.4).
// 스타일시트 문자열·해시 검사(옛 site-css.test.ts)를 이 파일이 이어받는다.
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/core/token";
import { asset, assetPath, type AssetName, faviconAlias } from "../../src/http/assets";
import { ASSETS } from "../../src/http/assets.generated";
import { SITE_CSS, SITE_CSS_HASH } from "../../src/http/site-css.generated";
import type { Ctx } from "../../src/routes";

const ctxFor = (file: string): Ctx => ({ params: { file } }) as unknown as Ctx;
const req = (path: string) => new Request(`https://worker.test${path}`);
const fileOf = (name: AssetName) => assetPath(name).slice("/assets/".length);
const hex16 = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16);
const NAMES: readonly AssetName[] = ["site.css", "icon.svg", "favicon.ico", "apple-touch-icon.png", "og.png"];
type BinaryName = Exclude<AssetName, "site.css">;

describe("SITE_CSS", () => {
  it("해시 상수 = SHA-256(SITE_CSS) 앞 16 hex", async () => {
    const got = (await sha256Hex(SITE_CSS)).slice(0, 16);
    expect(got, `SITE_CSS를 바꿨다면 node scripts/design/tokens.mjs로 다시 만든다(기대 ${got})`).toBe(SITE_CSS_HASH);
  });

  it.each(["<", "`", "${", "@import", "url("])("%j가 없다", (s) => {
    expect(SITE_CSS.includes(s)).toBe(false);
  });

  it("웹 전용 절이 토큰·ui 뒤에 붙는다", () => {
    expect(SITE_CSS.indexOf("/* [ui] ")).toBeGreaterThan(0);
    expect(SITE_CSS.indexOf("/* [site] ")).toBeGreaterThan(SITE_CSS.indexOf("/* [ui] "));
  });

  it("전환 없음: 웹 절의 transition은 none뿐이고 ui.css의 transition이 닿는 웹 요소(버튼·접힘 화살표)를 끈다", () => {
    const site = SITE_CSS.slice(SITE_CSS.indexOf("/* [site] "));
    const decls = [...site.matchAll(/transition[\w-]*:\s*([^;]+);/g)].map((m) => m[1]);
    expect(decls.length).toBeGreaterThan(0);
    for (const d of decls) expect(d).toBe("none");
    expect(site).toContain("body.web .btn");
    expect(site).toContain("body.web .disclosure > summary .icon");
  });

  it("분기점은 599px 하나뿐이다(웹 전용 절)", () => {
    const site = SITE_CSS.slice(SITE_CSS.indexOf("/* [site] "));
    const queries = [...site.matchAll(/@media\s*\(([^)]*width[^)]*)\)/g)].map((m) => m[1]);
    expect(new Set(queries)).toEqual(new Set(["max-width: 599px"]));
  });
});

describe("assetPath", () => {
  it("해시가 들어간 경로: /assets/<줄기>.<해시>.<확장자>", () => {
    expect(assetPath("site.css")).toBe(`/assets/site.${SITE_CSS_HASH}.css`);
    expect(assetPath("icon.svg")).toBe(`/assets/icon.${ASSETS["icon.svg"].hash}.svg`);
    expect(assetPath("favicon.ico")).toBe(`/assets/favicon.${ASSETS["favicon.ico"].hash}.ico`);
    expect(assetPath("apple-touch-icon.png")).toBe(`/assets/apple-touch-icon.${ASSETS["apple-touch-icon.png"].hash}.png`);
    expect(assetPath("og.png")).toBe(`/assets/og.${ASSETS["og.png"].hash}.png`);
  });
});

describe("asset (GET /assets/:file)", () => {
  it.each(NAMES)("%s: 200, 올바른 Content-Type, 불변 캐시", (name) => {
    const res = asset(req(assetPath(name)), ctxFor(fileOf(name)));
    expect(res.status).toBe(200);
    const want = name === "site.css" ? "text/css; charset=utf-8" : name === "icon.svg" ? "image/svg+xml" : name === "favicon.ico" ? "image/x-icon" : "image/png";
    expect(res.headers.get("Content-Type")).toBe(want);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  });

  it("스타일시트 본문 = SITE_CSS", async () => {
    expect(await asset(req(assetPath("site.css")), ctxFor(fileOf("site.css"))).text()).toBe(SITE_CSS);
  });

  it.each(NAMES.filter((n): n is BinaryName => n !== "site.css"))("%s: 본문 해시가 경로의 해시와 같다", async (name) => {
    const bytes = new Uint8Array(await asset(req(assetPath(name)), ctxFor(fileOf(name))).arrayBuffer());
    expect(await hex16(bytes)).toBe(ASSETS[name].hash);
  });

  it("같은 에셋을 두 번 읽어도 본문이 같다(응답마다 새 본문)", async () => {
    const a = new Uint8Array(await asset(req(assetPath("og.png")), ctxFor(fileOf("og.png"))).arrayBuffer());
    const b = new Uint8Array(await asset(req(assetPath("og.png")), ctxFor(fileOf("og.png"))).arrayBuffer());
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it.each(["site.css", "site.0000000000000000.css", "other.css", "icon.svg"])("표 밖 이름 %j는 404 JSON", async (file) => {
    const res = asset(req(`/assets/${file}`), ctxFor(file));
    expect([res.status, await res.json()]).toEqual([404, { code: "not_found" }]);
  });
});

describe("바이너리 에셋 모양", () => {
  const bytesOf = async (name: AssetName) => new Uint8Array(await asset(req(assetPath(name)), ctxFor(fileOf(name))).arrayBuffer());
  const u32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint32(at);

  it("og.png는 1200×630 PNG, apple-touch-icon.png는 180×180 PNG", async () => {
    for (const [name, w, h] of [["og.png", 1200, 630], ["apple-touch-icon.png", 180, 180]] as const) {
      const b = await bytesOf(name);
      expect([...b.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect([u32(b, 16), u32(b, 20)]).toEqual([w, h]);
    }
  });

  it("favicon.ico는 16·32 두 층이 있다", async () => {
    const b = await bytesOf("favicon.ico");
    const dv = new DataView(b.buffer, b.byteOffset);
    expect(dv.getUint16(2, true)).toBe(1); // ICO
    const count = dv.getUint16(4, true);
    const sizes = Array.from({ length: count }, (_, i) => b[6 + i * 16] ?? 0);
    expect(sizes).toContain(16);
    expect(sizes).toContain(32);
  });

  it("icon.svg에는 스타일·스크립트·style 속성이 없다", async () => {
    const t = new TextDecoder().decode(await bytesOf("icon.svg"));
    for (const bad of ["<style", "<script", "style="]) expect(t).not.toContain(bad);
  });
});

describe("faviconAlias (GET /favicon.ico)", () => {
  it("아이콘 에셋과 같은 바이트, 해시 없는 주소라 하루 캐시", async () => {
    const res = faviconAlias(req("/favicon.ico"), ctxFor(""));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/x-icon");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
    const a = new Uint8Array(await res.arrayBuffer());
    const b = new Uint8Array(await asset(req(assetPath("favicon.ico")), ctxFor(fileOf("favicon.ico"))).arrayBuffer());
    expect(a).toEqual(b);
  });
});
