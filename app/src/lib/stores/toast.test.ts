import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../copy/ko';
import { TOAST_MS } from '../timing';
import { announcer } from './announce.svelte';
import { platform } from './platform.svelte';
import { ToastStore } from './toast.svelte';

describe('토스트 닫힘 알림(지연 삭제, patterns.md §4)', () => {
  afterEach(() => vi.useRealTimers());

  it('까닭마다 onclose를 한 번만 부른다: 동작·닫기·시간·대체·비우기', () => {
    vi.useFakeTimers();
    const s = new ToastStore();
    const seen: string[] = [];
    const undo = { label: '되돌리기', run: () => seen.push('run') };
    const a = s.push('지웠어요', 'info', { action: undo, onclose: (r) => seen.push(`a:${r}`) });
    s.runAction(a);
    expect(seen).toEqual(['run', 'a:action']);
    s.dismiss(a);
    expect(seen).toEqual(['run', 'a:action']);

    const b = s.push('지웠어요', 'info', { action: undo, onclose: (r) => seen.push(`b:${r}`) });
    s.dismiss(b);
    const c = s.push('지웠어요', 'info', { action: undo, onclose: (r) => seen.push(`c:${r}`) });
    vi.advanceTimersByTime(TOAST_MS);
    expect(s.items.some((i) => i.id === c)).toBe(false);

    s.push('정보', 'info', { onclose: (r) => seen.push(`d:${r}`) });
    s.push('새 정보', 'info', { onclose: (r) => seen.push(`e:${r}`) });
    s.clear();
    expect(seen).toEqual(['run', 'a:action', 'b:dismiss', 'c:timeout', 'd:replaced', 'e:clear']);
  });

  it('동작이 있는 토스트는 대체되지 않고 줄을 선다', () => {
    const s = new ToastStore();
    const closed: string[] = [];
    const undo = { label: '되돌리기', run: () => {} };
    const first = s.push('하나', 'info', { action: undo, onclose: (r) => closed.push(`1:${r}`) });
    s.push('둘', 'info', { action: undo, onclose: (r) => closed.push(`2:${r}`) });
    expect(s.current?.id).toBe(first);
    expect(closed).toEqual([]);
    s.clear();
  });
});

describe('토스트 낭독·sticky·undo(ADR-0033)', () => {
  let say: ReturnType<typeof vi.spyOn>;
  let alert: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    say = vi.spyOn(announcer, 'say').mockImplementation(() => {});
    alert = vi.spyOn(announcer, 'alert').mockImplementation(() => {});
    platform.set('linux');
  });
  afterEach(() => {
    say.mockRestore();
    alert.mockRestore();
    platform.set('linux');
    vi.useRealTimers();
  });
  const undoAction = (run = () => {}) => ({ label: t('action.undo'), run });

  it('정보 토스트는 보일 때 한 번만 읽고 pause·resume은 다시 읽지 않는다', () => {
    const s = new ToastStore();
    const id = s.push('저장했어요', 'info');
    expect(say).toHaveBeenCalledExactlyOnceWith('저장했어요');
    s.pause(id);
    s.resume(id);
    expect(say).toHaveBeenCalledTimes(1);
    s.clear();
  });

  it('danger는 assertive로 읽는다', () => {
    const s = new ToastStore();
    s.push('실패했어요', 'danger');
    expect(alert).toHaveBeenCalledExactlyOnceWith('실패했어요');
    expect(say).not.toHaveBeenCalled();
    s.clear();
  });

  it('대기열의 토스트는 앞의 것이 닫혀 보일 때 읽는다', () => {
    const s = new ToastStore();
    const a = s.push('첫째', 'danger');
    s.push('둘째', 'info');
    expect(say).not.toHaveBeenCalled();
    s.dismiss(a);
    expect(say).toHaveBeenCalledExactlyOnceWith('둘째');
    s.clear();
  });

  it('동작이 하나 있으면 그 이름을 함께 읽는다', () => {
    const s = new ToastStore();
    s.push('파일을 찾을 수 없어요.', 'danger', { action: { label: '폴더 열기', run: () => {} } });
    expect(alert).toHaveBeenCalledExactlyOnceWith(t('a11y.noticeAction', { message: '파일을 찾을 수 없어요', action: '폴더 열기' }));
    s.clear();
  });

  it.each(['linux', 'windows'] as const)('undo 토스트는 %s에서 Ctrl+Z 안내를 읽는다', (os) => {
    platform.set(os);
    const s = new ToastStore();
    s.push('목록에서 지웠어요', 'info', { undo: true, action: undoAction() });
    expect(say).toHaveBeenCalledExactlyOnceWith(t('a11y.noticeUndo', { message: '목록에서 지웠어요', shortcut: 'Ctrl+Z' }));
    s.clear();
  });

  it('macOS는 M27 전까지 단축키를 말하지 않고 버튼 이름만 읽는다', () => {
    platform.set('macos');
    const s = new ToastStore();
    s.push('목록에서 지웠어요', 'info', { undo: true, action: undoAction() });
    expect(say).toHaveBeenCalledExactlyOnceWith(t('a11y.noticeAction', { message: '목록에서 지웠어요', action: '되돌리기' }));
    s.clear();
  });

  it('sticky는 타이머가 없고 dismiss로만 닫힌다. sticky가 아닌 동작 토스트는 TOAST_MS 뒤 닫힌다', () => {
    const s = new ToastStore();
    const closed: string[] = [];
    const a = s.push('키보드로 지웠어요', 'info', { sticky: true, undo: true, action: undoAction(), onclose: (r) => closed.push(r) });
    vi.advanceTimersByTime(TOAST_MS * 10);
    expect(s.items.some((i) => i.id === a)).toBe(true);
    expect(closed).toEqual([]);
    s.dismiss(a);
    expect(closed).toEqual(['dismiss']);
    const b = s.push('포인터로 지웠어요', 'info', { undo: true, action: undoAction(), onclose: (r) => closed.push(r) });
    vi.advanceTimersByTime(TOAST_MS);
    expect(s.items.some((i) => i.id === b)).toBe(false);
    expect(closed).toEqual(['dismiss', 'timeout']);
  });

  it('undoLatest: 가장 나중에 올린 되돌리기부터 실행한다(대기열 포함)', () => {
    const s = new ToastStore();
    expect(s.undoLatest()).toBe(false);
    const ran: string[] = [];
    const closed: string[] = [];
    const a = s.push('A', 'info', { sticky: true, undo: true, action: undoAction(() => ran.push('A')), onclose: (r) => closed.push(`A:${r}`) });
    s.push('B', 'info', { sticky: true, undo: true, action: undoAction(() => ran.push('B')), onclose: (r) => closed.push(`B:${r}`) });
    expect(s.undoLatest()).toBe(true);
    expect(ran).toEqual(['B']);
    expect(closed).toEqual(['B:action']);
    expect(s.current?.id).toBe(a);
    expect(s.undoLatest()).toBe(true);
    expect(ran).toEqual(['B', 'A']);
    expect(s.undoLatest()).toBe(false);
  });

  it('undoLatest: undo가 아닌 동작 토스트는 건드리지 않는다', () => {
    const s = new ToastStore();
    const run = vi.fn();
    const a = s.push('찾을 수 없어요', 'danger', { action: { label: '폴더 열기', run } });
    expect(s.undoLatest()).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(s.current?.id).toBe(a);
    s.clear();
  });

  it('sticky 토스트 뒤에 온 copied·info는 대체되기 전에 바로 읽고 보일 때 다시 읽지 않는다', () => {
    const s = new ToastStore();
    s.push('지웠어요', 'info', { sticky: true, undo: true, action: undoAction() });
    say.mockClear();
    s.push('복사했어요', 'copied');
    expect(say).toHaveBeenCalledExactlyOnceWith('복사했어요');
    s.clear();
  });

  it('sticky 토스트 뒤에 온 danger는 줄을 서도 바로 assertive로 읽고 보일 때 다시 읽지 않는다', () => {
    const s = new ToastStore();
    const sticky = s.push('지웠어요', 'info', { sticky: true, undo: true, action: undoAction() });
    s.push('실패했어요', 'danger');
    expect(alert).toHaveBeenCalledExactlyOnceWith('실패했어요');
    s.dismiss(sticky);
    expect(s.current?.message).toBe('실패했어요');
    expect(alert).toHaveBeenCalledTimes(1);
    s.clear();
  });

  it('sticky가 아닌 토스트 뒤의 대기열은 보일 때 읽는다(미리 읽지 않는다)', () => {
    const s = new ToastStore();
    s.push('하나', 'info', { undo: true, action: undoAction() });
    say.mockClear();
    s.push('둘', 'info', { undo: true, action: undoAction() });
    expect(say).not.toHaveBeenCalled();
    s.clear();
  });
});
