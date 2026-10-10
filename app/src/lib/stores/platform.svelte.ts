// 앱이 도는 OS. `app_info`(로그인 전에도 부를 수 있다)가 오면 `settings.loadInfo()`가 채운다.
// 오기 전에는 linux(그 밖 갈래)로 그린다. 갤러리·테스트는 `set`으로 고정한다.
import type { Os } from '../bindings';

export class PlatformStore {
  os: Os = $state('linux');

  get isMac(): boolean {
    return this.os === 'macos';
  }

  set(os: Os) {
    this.os = os;
  }
}

export const platform = new PlatformStore();
