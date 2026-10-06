// R2 읽기 창구(docs/design/worker.md §9, 구현 중 변경 11 (다)(라)·31 (차)). 소스에서 R2 바인딩을 만지는 곳은 이 파일 한 줄이고,
// 창구는 get·head 둘뿐이다(목록·쓰기 없음. scripts/ci/worker-config.mjs가 낱말을 센다).
// Range는 range.ts가 인정한 spec을 정규화한 헤더 하나로만 넘긴다(요청 헤더를 그대로 넘기지 않는다, 구현 중 변경 30 (가)).
import { type RangeSpec, rangeHeader } from "../core/range";

export interface ReleaseBucket {
  get(key: string, range: RangeSpec | null): Promise<R2ObjectBody | null>;
  head(key: string): Promise<R2Object | null>;
}

export function releaseBucket(env: Env): ReleaseBucket {
  const bucket: Pick<R2Bucket, "get" | "head"> = env.DIST;
  return {
    get: (key, range) => (range === null ? bucket.get(key) : bucket.get(key, { range: new Headers({ Range: rangeHeader(range) }) })),
    head: (key) => bucket.head(key),
  };
}
