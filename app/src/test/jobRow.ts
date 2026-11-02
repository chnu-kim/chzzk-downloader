import { t } from '../lib/copy/ko';

/** 작업 행 접근 이름 조회(`‘제목’: …`). 이름 뒤 상태는 보지 않는다. 제목의 정규식 문자((1부) 등)는 이스케이프한다 */
export function jobRowName(title: string): RegExp {
  const [head] = t('a11y.jobStatus', { title, status: '\u0001' }).split('\u0001');
  return new RegExp('^' + head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}
