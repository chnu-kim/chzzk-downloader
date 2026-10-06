// core/html(docs/design/worker.md §8.1, 구현 중 변경 14 (아)): 자동 이스케이프·위조 차단·값 규칙.
import { describe, expect, it } from "vitest";
import { escapeHtml, html, type HtmlValue, isSafeHtml, raw, renderHtml } from "../../src/core/html";

const XSS = `<script>alert(1)</script>"'&`;
const r = (v: Parameters<typeof renderHtml>[0]) => renderHtml(v);

describe("이스케이프", () => {
  it("XSS 벡터를 정확히 이스케이프한다", () => {
    const out = r(html`<p title="${XSS}">${XSS}</p>`);
    const esc = "&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;&amp;";
    expect(out).toBe(`<p title="${esc}">${esc}</p>`);
    expect(out).not.toContain("<script");
    expect(escapeHtml(XSS)).toBe(esc);
  });
  it("이미 이스케이프된 문자열도 다시 이스케이프한다(값은 늘 텍스트)", () => {
    expect(r(html`${"&amp;"}`)).toBe("&amp;amp;");
  });
  it("숫자는 유한하면 넣는다", () => {
    expect(r(html`${0}|${-1.5}|${1e21}`)).toBe("0|-1.5|1e+21");
  });
});

describe("중첩·배열·정적 조각", () => {
  it("중첩 html 결과와 배열은 이중 이스케이프되지 않는다", () => {
    const items = ["a<", "b&"].map((s) => html`<li>${s}</li>`);
    expect(r(html`<ul>${items}</ul>`)).toBe("<ul><li>a&lt;</li><li>b&amp;</li></ul>");
    expect(r(html`${[["x", html`<b>y</b>`], "<"]}`)).toBe("x<b>y</b>&lt;");
  });
  it("정적 조각의 태그는 보존", () => {
    expect(r(html`<b>굵게</b>`)).toBe("<b>굵게</b>");
  });
  it("원문 삽입은 그대로", () => {
    expect(r(html`<style>${raw("a>b{}")}</style>`)).toBe("<style>a>b{}</style>");
    expect(isSafeHtml(raw(""))).toBe(true);
  });
  it("false·null·undefined는 빈 문자열", () => {
    expect(r(html`[${false}${null}${undefined}]`)).toBe("[]");
    const cond = (on: boolean): HtmlValue => on && html`<i>on</i>`;
    expect(r(html`${cond(false)}|${cond(true)}`)).toBe("|<i>on</i>");
  });
});

describe("위조 차단·형식 오류", () => {
  it.each([
    ["toString 객체", { toString: () => "<x>" }],
    ["같은 모양 객체", { html: "<x>" }],
    ["true", true],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["bigint", 1n],
    ["symbol", Symbol("x")],
    ["함수", () => "<x>"],
    ["Date", new Date(0)],
    ["배열 안의 객체", [{}]],
  ])("%s는 TypeError", (_name, v) => {
    expect(() => html`${v as unknown as HtmlValue}`).toThrow(TypeError);
  });

  it("isSafeHtml: 진짜만 true", () => {
    expect(isSafeHtml(html`x`)).toBe(true);
    const proto = Object.getPrototypeOf(html`x`) as object;
    expect(isSafeHtml(Object.create(proto))).toBe(false);
    expect(isSafeHtml({})).toBe(false);
    expect(isSafeHtml(null)).toBe(false);
    expect(isSafeHtml("<x>")).toBe(false);
  });

  it("인스턴스의 constructor로 new를 불러도 만들 수 없다", () => {
    const Ctor = (Object.getPrototypeOf(html`x`) as { constructor: new (...a: unknown[]) => unknown }).constructor;
    expect(() => new Ctor("<script>")).toThrow(TypeError);
    expect(() => new Ctor(undefined, "<script>")).toThrow(TypeError);
    expect(() => new Ctor(Symbol("SafeHtml"), "<script>")).toThrow(TypeError);
  });

  it("원문 삽입은 문자열만", () => {
    expect(() => raw(123 as unknown as string)).toThrow(TypeError);
    expect(() => raw({ toString: () => "<x>" } as unknown as string)).toThrow(TypeError);
  });

  it("renderHtml은 위조 객체를 거부한다", () => {
    const proto = Object.getPrototypeOf(html`x`) as object;
    expect(() => renderHtml(Object.create(proto))).toThrow(TypeError);
    expect(() => renderHtml("<x>" as unknown as Parameters<typeof renderHtml>[0])).toThrow(TypeError);
  });

  it("해석할 수 없는 이스케이프가 있는 정적 조각은 던진다", () => {
    const tag = (s: TemplateStringsArray) => html(s);
    expect(() => tag`\unicode`).toThrow(TypeError);
  });
});
