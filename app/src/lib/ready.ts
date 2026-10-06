// 첫 화면을 그렸다는 신호(docs/design/cicd.md §6 `--smoke`). main.ts가 mount 직후 부른다.
// 몇 번 불려도 command는 한 번만 보낸다. 실패해도 화면에는 영향이 없다(보통 실행에서 Rust는 아무것도 하지 않는다).
import { frontendReady } from './api';

let sent = false;

export function signalReady(send: () => Promise<void> = frontendReady): void {
  if (sent) return;
  sent = true;
  send().catch(() => {
    // 스모크라면 Rust 감시자가 시간 초과로 실패시킨다. 보통 실행에서는 무시한다.
  });
}
