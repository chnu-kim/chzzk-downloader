// 잠자기 방지 표시(platform.md §15). Rust가 보호를 **실제로 얻었을 때만** `keep-awake { active: true }`를 보낸다.
// 설정이 켜져 있어도 보호를 못 얻었으면(OS 거부 등) false다: 목록 그룹 머리 옆 한 줄은 이 값만 본다.
import * as api from '../api';

class PowerStore {
  /** 지금 컴퓨터가 잠들지 않게 붙들고 있는가 */
  keepingAwake = $state(false);

  /** 이벤트를 듣는다. 돌려준 함수로 그만 듣는다 */
  start(): Promise<() => void> {
    return api.onKeepAwake((active) => {
      this.keepingAwake = active;
    });
  }
}

export const power = new PowerStore();
