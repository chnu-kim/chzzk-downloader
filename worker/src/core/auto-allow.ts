// 허용목록 자동 허가의 상수(docs/design/features/allowlist-open.md §2.2 A2·A3, §4.7). 순수 모듈: 저장소(src/store/allowlist.ts)와
// 관리 화면(src/http/admin*.ts)이 같은 값을 쓴다.

/** meta에 상한 값이 없을 때의 하루 새 채널 상한 */
export const AUTO_ALLOW_DEFAULT_CAP = 20;
/** 관리자가 저장할 수 있는 상한의 최대값 */
export const AUTO_ALLOW_CAP_MAX = 100;
/** 관리 화면의 허가·차단 표에 싣는 행 수(전체는 count로 따로 읽는다) */
export const ADMIN_LIST_MAX = 200;
/** 상한 입력의 형식: 0 또는 앞자리 0 없는 세 자리까지의 정수 */
export const CAP_FORMAT = /^(0|[1-9][0-9]{0,2})$/;
