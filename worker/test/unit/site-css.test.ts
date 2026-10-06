// 스타일시트 문자열과 해시 경로(docs/design/worker.md 구현 중 변경 35 (마)).
import { describe, expect, it } from "vitest";
import { SITE_CSS, SITE_CSS_HASH, SITE_CSS_PATH } from "../../src/http/site-css";
import { sha256Hex } from "../../src/core/token";

describe("SITE_CSS", () => {
  it("해시 상수 = SHA-256(SITE_CSS) 앞 16 hex", async () => {
    const got = (await sha256Hex(SITE_CSS)).slice(0, 16);
    expect(got, `SITE_CSS를 바꿨다면 SITE_CSS_HASH를 "${got}"로 고친다`).toBe(SITE_CSS_HASH);
  });

  it("경로에 해시가 들어간다", () => {
    expect(SITE_CSS_PATH).toBe(`/assets/site.${SITE_CSS_HASH}.css`);
  });

  it.each(["<", "`", "${", "@import", "url("])("%j가 없다", (s) => {
    expect(SITE_CSS.includes(s)).toBe(false);
  });
});
