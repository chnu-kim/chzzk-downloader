// xtask `Source::Worker`(xtask/src/release.rs)가 verify 때 GET하는 키와 Worker가 보이는 키의 계약(cicd.md 80·94, worker.md §9.1).
// 표는 release/expected-artifacts.json에서 계산한다. 서명 검증은 하지 않는다(합성 서명, 구현 중 변경 31 (카)).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isUserVisible, META_FILES, parseReleasePath, parseSha256Sums } from "../src/core/keys";
import { SUMS_CACHE } from "../src/http/releases";
import { ORIGIN, useClock, viaExports } from "./http/harness";
import { CI, type Cred, type Creds, credHeaders, DEB, DMG, makeCreds, seedDist, TABLE, V1, V2 } from "./http/release-fixture";
import { createFakeChzzk } from "./fake-chzzk.mjs";
import { installFakeChzzk, type FakeNet } from "./network";
import { expectedFiles, sha256Hex, verifyKeys } from "./seed-release.mjs";

let seed: Map<string, Uint8Array>;
let creds: Creds;
let net: FakeNet;
const dec = new TextDecoder();

beforeAll(async () => {
  seed = await seedDist();
});

beforeEach(async () => {
  useClock();
  net = installFakeChzzk(createFakeChzzk());
  SUMS_CACHE.clear();
  creds = await makeCreds();
});

afterEach(() => {
  expect(net.unhandled).toEqual([]);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const fetchKey = async (key: string, cred: Cred | { Authorization: string }) => {
  const headers = typeof cred === "string" ? credHeaders(creds, cred) : cred;
  const res = await viaExports(`${ORIGIN}/${key}`, { method: "GET", headers });
  return { status: res.status, body: new Uint8Array(await res.arrayBuffer()) };
};

describe("verify가 GET하는 키 전부", () => {
  it.each([
    [V1, false, 13],
    [V2, true, 14],
  ])("%s(latest %s): %d개 키가 CI로 200이고 바이트가 seed와 같다", async (v, latest, count) => {
    const keys = verifyKeys(TABLE, v, latest);
    expect(keys).toHaveLength(count);
    for (const key of keys) {
      const r = await fetchKey(key, "ci");
      expect([key, r.status]).toEqual([key, 200]);
      expect([key, r.body]).toEqual([key, seed.get(key)]);
    }
  });

  it("SHA256SUMS 항목 = 표(11개), 해시는 바이트의 sha256", async () => {
    for (const v of [V1, V2]) {
      const sums = parseSha256Sums(dec.decode(seed.get(`releases/${v}/SHA256SUMS`)));
      expect(sums).not.toBeNull();
      expect(new Set(sums?.keys())).toEqual(expectedFiles(TABLE, v));
      expect(sums?.size).toBe(11);
      for (const [name, hex] of sums ?? []) expect([name, await sha256Hex(seed.get(`releases/${v}/${name}`) as Uint8Array)]).toEqual([name, hex]);
    }
  });
});

describe("키 문법·가시성", () => {
  it("모든 verify 키가 문법을 통과한다", () => {
    for (const v of [V1, V2]) for (const key of verifyKeys(TABLE, v, true)) expect([key, parseReleasePath(`/${key}`) !== null]).toEqual([key, true]);
  });

  it("사용자 가시 집합 = SHA256SUMS 항목 + META, previous는 없다", () => {
    for (const v of [V1, V2]) {
      const sums = parseSha256Sums(dec.decode(seed.get(`releases/${v}/SHA256SUMS`)));
      const candidates = [...expectedFiles(TABLE, v), ...META_FILES, "previous", "latest.json"];
      const visible = new Set(candidates.filter((f) => isUserVisible(f, sums)));
      expect(visible).toEqual(new Set([...expectedFiles(TABLE, v), ...META_FILES]));
      expect(visible.has("previous")).toBe(false);
    }
  });
});

describe("계약", () => {
  it("404는 R2에 없는 키뿐이다(CI로 없는 버전)", async () => {
    for (const key of verifyKeys(TABLE, "0.3.0", false)) {
      const r = await fetchKey(key, "ci");
      expect([key, r.status]).toEqual([key, 404]);
    }
  });

  it("previous: CI는 200(0.1.0은 none, 0.2.0은 0.1.0), 사용자는 403", async () => {
    for (const [v, want] of [[V1, "none"], [V2, V1]] as const) {
      const ci = await fetchKey(`releases/${v}/previous`, "ci");
      expect([ci.status, dec.decode(ci.body)]).toEqual([200, want]);
      const app = await fetchKey(`releases/${v}/previous`, "app");
      expect(app.status).toBe(403);
    }
  });

  it.each([`Bearer ${CI}-x`, "Bearer Dev-ci-token", "Bearer "])("틀린 CI 토큰 %j: verify 키 전부가 401(404가 아니다)", async (value) => {
    for (const key of verifyKeys(TABLE, V2, true)) {
      const r = await fetchKey(key, { Authorization: value });
      expect([key, r.status]).toEqual([key, 401]);
    }
  });

  it("사용자 다운로드: .dmg·.deb가 app과 web으로 200", async () => {
    for (const name of [DMG, DEB]) {
      for (const cred of ["app", "web"] as const) {
        const r = await fetchKey(`releases/${V2}/${name}`, cred);
        expect([name, cred, r.status]).toEqual([name, cred, 200]);
      }
    }
  });
});
