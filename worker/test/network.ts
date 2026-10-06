// 가짜 치지직 연결(docs/design/worker.md 구현 중 변경 27 (나)): 전역 fetch 스파이. msw는 쓰지 않는다.
// 가짜 출처 밖의 요청은 기록하고 TypeError로 끝낸다. 각 테스트 파일은 afterEach에서 unhandled가 비었음을 단언한다.
import { vi } from "vitest";
import { FAKE_ORIGIN, type FakeChzzk } from "./fake-chzzk.mjs";

export interface FakeNet {
  readonly unhandled: string[];
}

export function installFakeChzzk(fake: FakeChzzk): FakeNet {
  const net: FakeNet = { unhandled: [] };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = new Request(input as RequestInfo | URL, init as RequestInit);
    const origin = new URL(req.url).origin;
    if (origin !== FAKE_ORIGIN) {
      net.unhandled.push(`${req.method} ${origin}`);
      throw new TypeError("fake-chzzk: 처리하지 않는 바깥 요청");
    }
    return fake.handle(req);
  });
  return net;
}
