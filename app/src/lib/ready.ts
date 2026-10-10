// 첫 화면을 그렸다는 신호(docs/design/cicd.md §6 `--smoke`). main.ts가 mount 직후 부른다.
// 몇 번 불려도 command는 한 번만 보낸다. 실패해도 화면에는 영향이 없다(보통 실행에서 Rust는 아무것도 하지 않는다).
// 엔진 프로브 결과(platform.md §5)를 함께 보낸다. 같은 값을 `engine` 스토어에 두어 배너가 읽는다.
import { frontendReady } from './api';
import type { EngineProbe } from './bindings';
import { engineProbe, probeOk } from './probe';
import { engine } from './stores/engine.svelte';

let sent = false;

export function signalReady(
  send: (probe: EngineProbe) => Promise<void> = frontendReady,
  probe: () => EngineProbe = engineProbe,
): void {
  if (sent) return;
  sent = true;
  const p = probe();
  engine.old = !probeOk(p);
  send(p).catch(() => {
    // 스모크라면 Rust 감시자가 시간 초과로 실패시킨다. 보통 실행에서는 무시한다.
  });
}
