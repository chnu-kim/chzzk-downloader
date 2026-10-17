// 시각 표시의 입구(content.md §7 D49). 사용자 시간대를 분 단위 오프셋으로 받아 `format/date.ts`의 순수 함수를 부른다.
// 화면 컴포넌트·스토어·e2e spec이 같은 함수로 기대값을 만든다. `Intl`·지역 시간 서식을 쓰지 않는다.
import { formatMonthDay, formatWhen, wallOf } from './format/date';

/** 지금 실행 환경의 시간대 오프셋(분, UTC 기준 +). 한국은 540 */
export function localOffsetMin(): number {
  return -new Date().getTimezoneOffset();
}

/** unix 초 시각을 최근 표기로: 올해는 `10월 3일 오후 9:00`, 어제, `N분 전` 등. `nowMs`는 Date.now() 값 */
export function whenText(unixSecs: number, nowMs: number, offsetMin: number = localOffsetMin()): string {
  return formatWhen(wallOf(unixSecs, offsetMin), wallOf(Math.floor(nowMs / 1000), offsetMin));
}

/** unix 초 시각을 날짜만: 같은 해는 `10월 23일`, 다른 해는 `2027년 1월 2일`(편집자 행·초대 기한) */
export function dayText(unixSecs: number, nowMs: number, offsetMin: number = localOffsetMin()): string {
  return formatMonthDay(wallOf(unixSecs, offsetMin), wallOf(Math.floor(nowMs / 1000), offsetMin));
}
