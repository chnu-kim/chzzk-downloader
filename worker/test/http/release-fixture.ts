// 릴리스 읽기 테스트 도우미(테스트 파일이 아니다, docs/design/worker.md 구현 중 변경 31). 합성 릴리스 넣기·자격 만들기·R2 호출 계수 래퍼.
import { env } from "cloudflare:workers";
import expectedText from "../../../release/expected-artifacts.json?raw";
import { sha256Hex } from "../../src/core/token";
import { buildSeed, expectedArtifacts, fakeBytes, sha256Hex as sha256HexBytes, type ExpectedTable } from "../seed-release.mjs";
import { A1, ADMINS, B2, D4, allowedLogin, webLogin } from "../store/helpers";
import { store } from "./harness";

export const TABLE = JSON.parse(expectedText) as ExpectedTable;
/** .dev.vars.example의 CI_VERIFY_TOKEN */
export const CI = "dev-ci-token";
export const V1 = "0.1.0";
export const V2 = "0.2.0";
export const file = (v: string, name: string) => `chzzk-downloader_${v}_${name}`;
export const DMG = file(V2, "darwin-aarch64.dmg");
export const DEB = file(V2, "linux-x86_64.deb");
export const APPIMAGE = file(V2, "linux-x86_64.AppImage");

/** buildSeed(TABLE, [V1, V2]) 결과를 env.DIST에 넣고 Map을 돌려준다 */
export async function seedDist(): Promise<Map<string, Uint8Array>> {
  const seed = await buildSeed(TABLE, [V1, V2]);
  for (const [k, v] of seed) await env.DIST.put(k, v);
  return seed;
}

const enc = new TextEncoder();

/** 해석 실패 SHA256SUMS 버전(이 파일에서만 쓰는 번호를 인자로): SHA256SUMS = "garbage\n", manifest.json = "{}", 산출물은 올린다 */
export async function seedInvalidSums(version: string): Promise<void> {
  for (const a of expectedArtifacts(TABLE, version)) await env.DIST.put(`releases/${version}/${a.file}`, fakeBytes(a.file));
  await env.DIST.put(`releases/${version}/SHA256SUMS`, enc.encode("garbage\n"));
  await env.DIST.put(`releases/${version}/manifest.json`, enc.encode("{}"));
}

/** SHA256SUMS에 listed가 있지만 그 객체는 올리지 않은 버전 */
export async function seedListedMissing(version: string, listed: string): Promise<void> {
  const hex = await sha256HexBytes(fakeBytes(listed));
  await env.DIST.put(`releases/${version}/SHA256SUMS`, enc.encode(`${hex}  ${listed}\n`));
}

export type Cred = "none" | "app" | "appRevoked" | "appDisallowed" | "web" | "webAdmin" | "ci" | "garbage";
type AppCred = "app" | "appRevoked" | "appDisallowed";
export interface Creds {
  readonly access: Record<AppCred, string>;
  readonly refresh: Record<AppCred, string>;
  readonly cookie: Record<"web" | "webAdmin", string>;
  /** 웹 세션의 폼 토큰(POST 본문 csrf) */
  readonly csrf: Record<"web" | "webAdmin", string>;
}

/** store 도우미(test/store/helpers.ts allowedLogin·webLogin)로 now = Date.now()에 만든다 */
export async function makeCreds(): Promise<Creds> {
  const now = Date.now();
  const s = store();
  const app = await allowedLogin(s, { channelId: B2, now });
  const revoked = await allowedLogin(s, { channelId: B2, now });
  const c = await s.check(await sha256Hex(revoked.bundle.accessToken), ADMINS, now);
  if (!c.ok) throw new Error(`check ${c.code}`);
  if (!(await s.revoke(c.sessionId, "admin", A1, now))) throw new Error("revoke 실패");
  const disallowed = await allowedLogin(s, { channelId: D4, now });
  const d = await s.disallow(D4, A1, ADMINS, now);
  if (!d.ok) throw new Error("disallow 실패");
  const web = await webLogin(s, { channelId: B2, now });
  const webAdmin = await webLogin(s, { channelId: A1, now });
  return {
    access: { app: app.bundle.accessToken, appRevoked: revoked.bundle.accessToken, appDisallowed: disallowed.bundle.accessToken },
    refresh: { app: app.bundle.refreshToken, appRevoked: revoked.bundle.refreshToken, appDisallowed: disallowed.bundle.refreshToken },
    cookie: { web: web.cookieToken, webAdmin: webAdmin.cookieToken },
    csrf: { web: web.csrf, webAdmin: webAdmin.csrf },
  };
}

/** 자격 → 헤더(웹 쿠키 이름은 dev 모드의 cdl_s) */
export function credHeaders(c: Creds, cred: Cred): Record<string, string> {
  switch (cred) {
    case "none":
      return {};
    case "app":
    case "appRevoked":
    case "appDisallowed":
      return { Authorization: `Bearer ${c.access[cred]}` };
    case "web":
    case "webAdmin":
      return { Cookie: `cdl_s=${c.cookie[cred]}` };
    case "ci":
      return { Authorization: `Bearer ${CI}` };
    case "garbage":
      return { Authorization: "Bearer not-a-token" };
  }
}

export interface R2Calls {
  get: number;
  head: number;
  list: number;
  put: number;
  delete: number;
  multipart: number;
}

export interface CountingOpts {
  /** 이 키는 없는 것처럼 null */
  readonly hide?: readonly string[];
  /** Range가 있는 get이 운영 R2의 10039를 던지는 경우를 흉내 낸다 */
  readonly throwOnRange?: boolean;
  /** 실제 obj.range를 이 값으로 바꿔 보고한다(R2가 range 모양을 다르게 돌려주는 경우) */
  readonly rangeReport?: (real: R2Range | undefined) => R2Range | undefined;
  /** 이 키는 실제 객체 대신 이 바이트를 돌려준다(latest.json 이상 사례) */
  readonly override?: Readonly<Record<string, Uint8Array>>;
}

const zero = (): R2Calls => ({ get: 0, head: 0, list: 0, put: 0, delete: 0, multipart: 0 });

/** env.DIST를 감싸 호출 수를 센다. 목록·쓰기는 세고 던진다(Worker는 R2를 읽기만 한다, 구현 중 변경 11 (라)) */
export function countingDist(o: CountingOpts = {}): { dist: R2Bucket; calls: R2Calls; reset(): void } {
  const calls = zero();
  const hidden = new Set(o.hide ?? []);
  const forbidden = (field: keyof R2Calls) => async (): Promise<never> => {
    calls[field]++;
    throw new Error("R2 목록·쓰기 금지");
  };
  const wrapper = {
    async get(k: string, opts?: R2GetOptions) {
      calls.get++;
      if (hidden.has(k)) return null;
      const over = o.override?.[k];
      if (over !== undefined) {
        return { size: over.byteLength, httpEtag: '"override"', range: undefined, body: new Response(over).body, arrayBuffer: async () => over.slice().buffer } as unknown as R2ObjectBody;
      }
      if (o.throwOnRange === true && opts?.range !== undefined) throw new Error("get: The requested range is not satisfiable (10039)");
      const real = await env.DIST.get(k, opts as R2GetOptions);
      if (o.rangeReport !== undefined && real !== null) {
        return { size: real.size, httpEtag: real.httpEtag, range: o.rangeReport(real.range), body: real.body, arrayBuffer: () => real.arrayBuffer() } as unknown as R2ObjectBody;
      }
      return real;
    },
    async head(k: string) {
      calls.head++;
      return hidden.has(k) ? null : env.DIST.head(k);
    },
    list: forbidden("list"),
    put: forbidden("put"),
    delete: forbidden("delete"),
    createMultipartUpload: forbidden("multipart"),
    resumeMultipartUpload: forbidden("multipart"),
  };
  return {
    dist: wrapper as unknown as R2Bucket,
    calls,
    reset() {
      Object.assign(calls, zero());
    },
  };
}
