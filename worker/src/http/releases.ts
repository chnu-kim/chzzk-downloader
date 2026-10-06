// GET·HEAD /releases/**(docs/design/worker.md §9.1·§9.2, 구현 중 변경 30·31). 판정 순서: 문법(400 bad_key) → 자격(releaseAuth)
// → 사용자 가시성(403 forbidden) → R2. 3xx 응답은 304뿐이다: R2 바이트를 직접 스트리밍하고 다른 주소로 보내지 않는다.
// Worker 요청 하나의 R2 호출은 2회 이하(구현 중 변경 11 (라)): A·W = SHA256SUMS(캐시 미스일 때) + 파일, CI = 파일 1회.
import { ifNoneMatchHit } from "../core/conditional";
import { LATEST_KEY, parseReleasePath, parseSha256SumsBytes, releaseContentType, releaseDisposition, sumsKey, userVisibility } from "../core/keys";
import { Lru } from "../core/lru";
import { log } from "../core/log";
import { contentRange, normalizeR2Range, parseRange, resolveRange, unsatisfiedRange } from "../core/range";
import type { Ctx } from "../routes";
import { releaseBucket, type ReleaseBucket } from "./r2";
import { releaseAuth } from "./release-auth";
import { errorJson } from "./respond";

/** 버전 → SHA256SUMS 해석 결과(null = 해석 실패, 객체가 불변이라 영구). isolate마다 따로다 */
export const SUMS_CACHE = new Lru<string, ReadonlyMap<string, string> | null>(8);
export const SUMS_MAX = 65_536;
export const BODY_CACHE_CONTROL = "private, no-store, no-transform";

/** 이 요청의 R2 호출 1회: SHA256SUMS. 없으면 null(업로드 중일 수 있어 캐시하지 않는다), 해석 실패·64KiB 초과는 null을 캐시한다 */
async function loadSums(bucket: ReleaseBucket, version: string): Promise<ReadonlyMap<string, string> | null> {
  const cached = SUMS_CACHE.get(version);
  if (cached !== undefined) return cached;
  const obj = await bucket.get(sumsKey(version), null);
  if (obj === null) return null;
  let parsed: ReadonlyMap<string, string> | null = null;
  if (obj.size > SUMS_MAX) await obj.body.cancel();
  else parsed = parseSha256SumsBytes(new Uint8Array(await obj.arrayBuffer()));
  SUMS_CACHE.set(version, parsed);
  return parsed;
}

function base(file: string, etag: string): Headers {
  return new Headers({
    ETag: etag,
    "Content-Type": releaseContentType(file),
    "Content-Disposition": releaseDisposition(file),
    "Accept-Ranges": "bytes",
    "Cache-Control": BODY_CACHE_CONTROL,
  });
}

const notModified = (etag: string): Response => new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": BODY_CACHE_CONTROL } });

const rangeFail = (size: number | null): Response =>
  errorJson(416, "range_not_satisfiable", {
    ...(size === null ? {} : { "Content-Range": unsatisfiedRange(size) }),
    "Accept-Ranges": "bytes",
    "Cache-Control": BODY_CACHE_CONTROL,
  });

// 운영 R2가 만족 불가 범위에서 던지는 오류(10039)의 모양. 실측하지 못했다(구현 중 변경 30 (바))
const NOT_SATISFIABLE = /\b10039\b|not satisfiable/i;

/** HEAD: head 한 번, Range는 무시한다(Range는 GET에만 정의된다) */
async function headObject(req: Request, bucket: ReleaseBucket, key: string, file: string): Promise<Response> {
  const obj = await bucket.head(key);
  if (obj === null) return errorJson(404, "not_found");
  if (ifNoneMatchHit(req.headers.get("If-None-Match"), obj.httpEtag)) return notModified(obj.httpEtag);
  const headers = base(file, obj.httpEtag);
  headers.set("Content-Length", String(obj.size));
  return new Response(null, { status: 200, headers });
}

/** GET: get 한 번. 조건부(304)를 Range보다 먼저 본다(RFC 9110 §13.2.2). 예외: R2가 10039를 던지는 range 경로는 객체를 받지 못해 조건부를 볼 수 없고 416이 된다(테스트 r2-calls 44행) */
async function getObject(req: Request, ctx: Ctx, bucket: ReleaseBucket, key: string, file: string): Promise<Response> {
  const spec = parseRange(req.headers.get("Range"));
  let obj: R2ObjectBody | null;
  try {
    obj = await bucket.get(key, spec);
  } catch (e) {
    if (spec !== null && e instanceof Error && NOT_SATISFIABLE.test(e.message)) {
      // 크기를 모르므로 Content-Range가 없고 세 번째 R2 호출도 하지 않는다
      log("release.range_error", { level: "warn", route: ctx.route });
      return rangeFail(null);
    }
    throw e;
  }
  if (obj === null) return errorJson(404, "not_found");
  if (ifNoneMatchHit(req.headers.get("If-None-Match"), obj.httpEtag)) {
    await obj.body.cancel();
    return notModified(obj.httpEtag);
  }
  const headers = base(file, obj.httpEtag);
  if (spec === null) {
    headers.set("Content-Length", String(obj.size));
    return new Response(obj.body, { status: 200, headers });
  }
  const r = resolveRange(spec, obj.size);
  if (r === "unsatisfiable") {
    await obj.body.cancel();
    return rangeFail(obj.size);
  }
  // R2가 실제로 준 범위가 우리 판정과 같아야 한다(다르면 잘못된 바이트를 206으로 내보내지 않는다)
  const n = normalizeR2Range(obj.range, obj.size);
  if (n.offset !== r.offset || n.length !== r.length) {
    await obj.body.cancel();
    log("release.range_mismatch", { level: "error", route: ctx.route });
    return errorJson(500, "internal");
  }
  headers.set("Content-Length", String(r.length));
  headers.set("Content-Range", contentRange(r, obj.size));
  return new Response(obj.body, { status: 206, headers });
}

async function serve(req: Request, ctx: Ctx): Promise<Response> {
  const path = parseReleasePath(new URL(req.url).pathname);
  if (path === null) return errorJson(400, "bad_key");
  const who = await releaseAuth(req, ctx, true);
  if (!who.ok) return who.response;
  const bucket = releaseBucket(ctx.env);
  const file = path.kind === "latest" ? "latest.json" : path.file;
  if (who.caller !== "ci") {
    const vis = path.kind === "latest" ? "never" : userVisibility(path.file);
    if (vis === "never") {
      log("release.forbidden_key", { route: ctx.route, reason: "ci_only" });
      return errorJson(403, "forbidden");
    }
    if (vis === "sums" && path.kind === "file") {
      const sums = await loadSums(bucket, path.version);
      if (sums?.has(path.file) !== true) {
        log("release.forbidden_key", { route: ctx.route, reason: "not_listed" });
        return errorJson(403, "forbidden");
      }
    }
  }
  const key = path.kind === "latest" ? LATEST_KEY : path.key;
  return req.method === "HEAD" ? headObject(req, bucket, key, file) : getObject(req, ctx, bucket, key, file);
}

export async function releases(req: Request, ctx: Ctx): Promise<Response> {
  const res = await serve(req, ctx);
  // 모든 HEAD 응답은 본문이 없다(오류 JSON 포함). 헤더(Content-Length 포함)는 그대로 둔다
  return req.method === "HEAD" && res.body !== null ? new Response(null, res) : res;
}
