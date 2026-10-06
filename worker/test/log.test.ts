// 로그 형식(docs/design/worker.md §14): 한 줄 JSON, 허용 필드만.
import { afterEach, expect, it, vi } from "vitest";
import { formatLog, type LogFields, log } from "../src/core/log";

afterEach(() => {
  vi.restoreAllMocks();
});

it("한 줄 JSON, event·level(기본 info)과 준 허용 필드", () => {
  const line = formatLog("auth.login.failed", { stage: "token", status: 502, timedOut: false });
  expect(line).not.toContain("\n");
  expect(JSON.parse(line)).toEqual({ event: "auth.login.failed", level: "info", stage: "token", status: 502, timedOut: false });
});

it("타입을 우회한 필드(code·state·token·channelId 등)는 버린다", () => {
  const sneaky = { level: "warn", code: "c-canary", state: "s-canary", token: "t-canary", channelId: "id-canary", url: "/x?code=1" } as unknown as LogFields;
  const line = formatLog("x", sneaky);
  expect(JSON.parse(line)).toEqual({ event: "x", level: "warn" });
  expect(line).not.toMatch(/canary|code=/);
});

it("log()는 console.log 한 번", () => {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  log("config.error", { level: "error", key: "PUBLIC_ORIGIN" });
  expect(spy).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toEqual({ event: "config.error", level: "error", key: "PUBLIC_ORIGIN" });
});
