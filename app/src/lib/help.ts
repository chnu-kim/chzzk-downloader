// 오류 L2 도움말 링크(patterns.md §10.1, app.md 구현 중 변경 84): 웹 도움말의 그 주제(`/help#<id>`)를 기본 브라우저로 연다.
import * as api from './api';
import type { NoticeHelp } from './components/ui/vocab';
import { errorCopy, helpLinkLabel, toAppError, type LinkedHelpId } from './copy/errors';
import { toasts } from './stores/toast.svelte';

/** 그 주제의 웹 도움말을 연다. 실패는 토스트 한 줄(개인정보 처리방침 링크와 같은 처리) */
export function openHelp(id: LinkedHelpId): Promise<void> {
  return api
    .openWebPage('help', id)
    .catch((e: unknown) => {
      toasts.push(errorCopy(toAppError(e), { place: 'other' }).title, 'danger');
    });
}

/** Notice `help` 값. 주제가 없으면 `undefined`(링크를 그리지 않는다) */
export function noticeHelp(id: LinkedHelpId | null): NoticeHelp | undefined {
  return id == null ? undefined : { label: helpLinkLabel(id), onclick: () => void openHelp(id) };
}
