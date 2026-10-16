// tokenBundleJson(구현 중 변경 105): 키가 없는 묶음(배포 중 새 isolate가 옛 DO를 부른 경우)은 던지지 않고, 있는 묶음은 두 키만 싣는다.
import { describe, expect, it } from "vitest";
import { tokenBundleJson } from "../../src/http/session";
import type { TokenBundle } from "../../src/store/types";

const base = { accessToken: "a", accessExpiresAt: 1, refreshToken: "r", refreshExpiresAt: 2, channelId: "c", channelName: "n", isAdmin: false };

describe("tokenBundleJson delegatedChannels", () => {
  it("키가 없는 묶음은 빈 배열", () => {
    const j = tokenBundleJson(base as unknown as TokenBundle, 3);
    expect(j.delegatedChannels).toEqual([]);
  });

  it("원소마다 channelId·channelName 두 키만(since가 새지 않는다)", () => {
    const j = tokenBundleJson({ ...base, delegatedChannels: [{ channelId: "x", channelName: "y", since: 5 }] }, 3);
    expect(j.delegatedChannels).toEqual([{ channelId: "x", channelName: "y" }]);
    expect(Object.keys((j.delegatedChannels as object[])[0]!).sort()).toEqual(["channelId", "channelName"]);
  });
});
