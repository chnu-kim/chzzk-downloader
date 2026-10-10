// spec이 화면 글자를 copy deck에서 가져오는 단 하나의 입구(design system 단계 (c)): 문구 단계 (d)에서 값이 바뀌어도
// spec을 고치지 않는다. 화면 문자열을 spec에 직접 쓰지 않고 `t('키')`·`errorCopy(…)`·`shortcutText(os, …)`로 만든다.
// 예외는 사용자가 친 값(주소·파일 이름)과 고정 데이터의 제목·채널 이름뿐이다.
// 이 파일과 거기서 import하는 모듈은 Svelte 룬이 없는 순수 TS여야 한다(Playwright가 Node에서 읽는다).
export { ko, t, type CopyKey } from '../src/lib/copy/ko';
export { actionLabel, errorCopy } from '../src/lib/copy/errors';
export { engineFixText, revealLabel, shortcutText } from '../src/lib/platform';
// 화면에 보이는 값을 만드는 순수 함수(날짜·크기·종류 글자·시간 상수): spec이 같은 함수로 기대값을 만든다
export { formatFileSize, sizeBaseOf } from '../src/lib/format/bytes';
export { formatDate, formatDateTime, parseKstWall } from '../src/lib/format/date';
export { whenText } from '../src/lib/when';
export { channelRow } from '../src/lib/auth';
export { CHECK_DEBOUNCE_MS, kindLabel, recentSecondLine } from '../src/lib/receive';
export { COMPLETED_FOLD_AT, LOADER_DELAY_MS, LOADER_MIN_MS, RECOVERY_NOTICE_MS, RECOVERY_SILENT_MS, STALE_DAYS, TOAST_MS } from '../src/lib/timing';

import { t, type CopyKey, type CopyVars } from '../src/lib/copy/ko';

/** `t`의 정규식 판: 변수 자리(`{name}`)를 `.+?`로 바꿔 부분 일치로 찾는다(값을 모르는 진행률·시각 등) */
export function tRegex(key: CopyKey, vars: CopyVars = {}): RegExp {
  const text = t(key, vars);
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\w+\\\}/g, '.+?');
  return new RegExp(escaped);
}
