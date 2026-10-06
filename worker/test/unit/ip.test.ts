// 스로틀 버킷(worker.md 구현 중 변경 19 (가))
import { describe, expect, it } from "vitest";
import { ipBucket } from "../../src/core/ip";

describe("ipBucket", () => {
  const table: [string | null, string][] = [
    [null, "none"],
    ["", "none"],
    ["  ", "none"],
    ["203.0.113.7", "4:203.0.113.7"],
    ["203.0.113.007", "4:203.0.113.7"],
    [" 203.0.113.7 ", "4:203.0.113.7"],
    ["256.1.1.1", "bad"],
    ["1.2.3", "bad"],
    ["garbage", "bad"],
    ["2001:db8:1:2::1", "6:2001:db8:1:2"],
    ["2001:DB8:1:2:ffff:0:0:9", "6:2001:db8:1:2"],
    ["2001:0db8:0001:0002:0:0:0:1", "6:2001:db8:1:2"],
    ["2001:db8:1:3::1", "6:2001:db8:1:3"],
    ["::1", "6:0:0:0:0"],
    ["::ffff:203.0.113.7", "4:203.0.113.7"],
    ["::ffff:cb00:7107", "4:203.0.113.7"],
    ["2001:db8::1::2", "bad"],
    ["fe80::1%eth0", "bad"],
    ["1:2:3:4:5:6:7:8:9", "bad"],
    ["1:2:3:4:5:6:7", "bad"],
    ["2001:db8::g", "bad"],
    ["12345::1", "bad"],
    ["1.2.3.4.5", "bad"],
    ["a".repeat(65), "bad"],
  ];
  it.each(table)("%j → %s", (input, want) => {
    expect(ipBucket(input)).toBe(want);
  });

  it("같은 /64는 같은 버킷, 다른 /64는 다른 버킷", () => {
    expect(ipBucket("2001:db8:1:2::1")).toBe(ipBucket("2001:db8:1:2:ffff::9"));
    expect(ipBucket("2001:db8:1:2::1")).not.toBe(ipBucket("2001:db8:1:3::1"));
  });
});
