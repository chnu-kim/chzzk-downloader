// 알림(토스트·배너)을 상주 라이브 영역으로 읽는 문장(content.md §10, ADR-0033). 토스트 store와 AppBanners가 같이 쓴다.
import type { Os } from './bindings';
import { t } from './copy/ko';
import { shortcutText } from './platform';
import type { ToastItem } from './stores/toast.svelte';

/** 알림 글 + 동작 이름. 배너 글 끝 마침표는 떼고 deck 문장이 잇는다 */
export function noticeSpeech(message: string, action?: string): string {
  return action ? t('a11y.noticeAction', { message: message.replace(/\.$/, ''), action }) : message;
}

/**
 * Mod+Z 안내를 읽는 OS. macOS는 기본 메뉴의 "실행 취소"(⌘Z, `menu.rs`)가 웹뷰 keydown보다 먼저 받을 수 있어
 * (platform.md [잠정]) §21 M27로 확인하기 전에는 단축키를 말하지 않고 ‘되돌리기’ 버튼만 말한다
 */
const UNDO_HINT_OS: readonly Os[] = ['windows', 'linux'];

export function toastSpeech(item: Pick<ToastItem, 'message' | 'action' | 'undo'>, os: Os): string {
  if (item.undo && UNDO_HINT_OS.includes(os)) {
    return t('a11y.noticeUndo', { message: item.message.replace(/\.$/, ''), shortcut: shortcutText(os, 'undo') });
  }
  return noticeSpeech(item.message, item.action?.label);
}
