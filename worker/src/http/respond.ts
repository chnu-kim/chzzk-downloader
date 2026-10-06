// 응답 공통(docs/design/worker.md §4 "공통"). 오류 본문은 {"code":"<소문자_밑줄>"} 하나다(입력 되풀이·원인 문자열 없음).

export function json(status: number, body: Record<string, unknown>, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

export function errorJson(status: number, code: string, headers?: HeadersInit): Response {
  return json(status, { code }, headers);
}

/** 모든 응답에 붙는 헤더. Cache-Control은 핸들러가 정했으면 그대로 둔다(R2 본문은 private, no-store, no-transform, §9.2). */
export function withCommonHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  if (!out.headers.has("Cache-Control")) out.headers.set("Cache-Control", "no-store");
  out.headers.set("X-Content-Type-Options", "nosniff");
  return out;
}
