// 경로 표와 :param 매칭(docs/design/worker.md §4, 구현 중 변경 27 (마)).
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { CALLBACK_PATH } from "../../src/config";
import { matchPattern, ROUTES } from "../../src/routes";
import { ORIGIN } from "./harness";

describe("matchPattern", () => {
  it(":name 조각은 비지 않은 조각 하나와 맞는다", () => {
    expect(matchPattern("/auth/login/:handle", "/auth/login/x")).toEqual({ handle: "x" });
    expect(matchPattern("/auth/login/:handle", "/auth/login/")).toBeNull();
    expect(matchPattern("/auth/login/:handle", "/auth/login/a/b")).toBeNull();
    expect(matchPattern("/auth/login/:handle", "/auth/login")).toBeNull();
  });

  it("디코드하지 않는다", () => {
    expect(matchPattern("/auth/login/:handle", "/auth/login/a%2Fb")).toEqual({ handle: "a%2Fb" });
  });

  it("고정 조각은 글자 그대로(대소문자 구분)", () => {
    expect(matchPattern("/auth/done", "/auth/done")).toEqual({});
    expect(matchPattern("/auth/done", "/auth/Done")).toBeNull();
    expect(matchPattern("/auth/done", "/auth/done/")).toBeNull();
  });
});

describe("matchPattern: /** 패턴(나머지 전부, 디코드하지 않는다)", () => {
  it.each([
    ["/releases/x", { "**": "x" }],
    ["/releases/a/b/c", { "**": "a/b/c" }],
    ["/releases/a%2Fb", { "**": "a%2Fb" }],
    ["/releases/", null],
    ["/releases", null],
    ["/releasesx/y", null],
    ["/Releases/x", null],
  ])("%s", (path, want) => {
    expect(matchPattern("/releases/**", path)).toEqual(want);
  });
});

describe("경로 표", () => {
  it("W6까지의 24쌍이 정확히 이 순서다", () => {
    expect(ROUTES.map((r) => `${r.method} ${r.pattern}`)).toEqual([
      "GET /health",
      "POST /auth/start",
      "GET /auth/login/:handle",
      "POST /auth/login/:handle",
      "POST /auth/web/start",
      `GET ${CALLBACK_PATH}`,
      "GET /auth/done",
      "POST /auth/poll",
      "POST /auth/refresh",
      "POST /auth/logout",
      "GET /api/me",
      "GET /update/:current",
      "GET /releases/**",
      "HEAD /releases/**",
      "GET /",
      "GET /assets/:file",
      "POST /auth/web/logout",
      "POST /me/sessions/:id/revoke",
      "GET /admin",
      "POST /admin/allow",
      "POST /admin/disallow",
      "POST /admin/sessions/:id/revoke",
      "POST /admin/denied/:channelId/allow",
      "POST /admin/denied/:channelId/dismiss",
    ]);
  });

  it("자격 종류: 콜백은 F(flow), refresh는 R, logout은 A 또는 R, me는 A", () => {
    const auth = (m: string, p: string) => ROUTES.find((r) => r.method === m && r.pattern === p)?.auth;
    expect(auth("GET", CALLBACK_PATH)).toBe("flow");
    expect(auth("POST", "/auth/refresh")).toBe("refresh");
    expect(auth("POST", "/auth/logout")).toBe("app_or_refresh");
    expect(auth("GET", "/api/me")).toBe("app");
    expect(auth("POST", "/auth/start")).toBe("none");
    expect(auth("GET", "/update/:current")).toBe("update");
    expect(auth("GET", "/releases/**")).toBe("release");
    expect(auth("HEAD", "/releases/**")).toBe("release");
    expect(auth("GET", "/")).toBe("web_optional");
    expect(auth("GET", "/assets/:file")).toBe("none");
    expect(auth("POST", "/auth/web/logout")).toBe("web");
    expect(auth("POST", "/me/sessions/:id/revoke")).toBe("web");
    for (const r of ROUTES.filter((x) => x.pattern.startsWith("/admin"))) expect([r.method, r.pattern, r.auth]).toEqual([r.method, r.pattern, "admin"]);
  });
});

describe("404·405", () => {
  it("같은 경로의 두 행: 405의 Allow는 맞는 모든 메서드(표 순서, 중복 없음)", async () => {
    const res = await exports.default.fetch(ORIGIN + "/auth/login/x", { method: "PUT", redirect: "manual" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, POST");
    expect(await res.json()).toEqual({ code: "method_not_allowed" });
  });

  it("끝 조각이 비면 404 JSON", async () => {
    const res = await exports.default.fetch(ORIGIN + "/auth/login/", { redirect: "manual" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "not_found" });
  });

  it("PUT /는 405이고 Allow는 GET", async () => {
    const res = await exports.default.fetch(ORIGIN + "/", { method: "PUT", redirect: "manual" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET");
    expect(await res.json()).toEqual({ code: "method_not_allowed" });
  });

  it("/admin/ 는 404(끝 빗금은 다른 경로)", async () => {
    const res = await exports.default.fetch(ORIGIN + "/admin/", { redirect: "manual" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "not_found" });
  });

  it("조각이 더 있으면 404", async () => {
    const res = await exports.default.fetch(ORIGIN + "/auth/login/a/b", { redirect: "manual" });
    expect(res.status).toBe(404);
  });
});
