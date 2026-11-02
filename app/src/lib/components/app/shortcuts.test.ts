import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../copy/ko';
import { announcer } from '../../stores/announce.svelte';
import { AUTH_DISABLED, auth } from '../../stores/auth.svelte';
import { platform } from '../../stores/platform.svelte';
import { toasts } from '../../stores/toast.svelte';
import { ui } from '../../stores/ui.svelte';
import { modalLayer } from '../ui/modalLayer';
import GlobalShortcuts from './GlobalShortcuts.svelte';

describe('GlobalShortcuts', () => {
  // 단축키는 로그인 상태가 열려 있을 때만 듣는다
  beforeEach(() => auth.apply(AUTH_DISABLED));
  afterEach(() => {
    ui.goHome();
    auth.reset();
    platform.set('linux');
  });

  it('어느 뷰에서든 파일·링크를 떨어뜨려도 기본 동작(이동)을 막는다', async () => {
    render(GlobalShortcuts);
    ui.goSettings();
    const dataTransfer = { types: ['Files'], getData: () => '', dropEffect: 'copy' };
    expect(await fireEvent.dragOver(window, { dataTransfer })).toBe(false);
    expect(dataTransfer.dropEffect).toBe('none');
    expect(await fireEvent.drop(window, { dataTransfer })).toBe(false);
  });

  it('창 안에서 시작한 끌기를 입력칸에 놓으면 막지 않고, 입력칸 밖이면 막는다', async () => {
    const { container } = render(GlobalShortcuts);
    const input = document.createElement('input');
    container.appendChild(input);
    const dataTransfer = { types: ['text/plain'], getData: () => 'abc', dropEffect: 'move' };
    await fireEvent.dragStart(input, { dataTransfer });
    expect(await fireEvent.dragOver(input, { dataTransfer })).toBe(true);
    expect(await fireEvent.drop(input, { dataTransfer })).toBe(true);
    expect(await fireEvent.drop(container, { dataTransfer })).toBe(false);
    await fireEvent.dragEnd(input, { dataTransfer });
    // 바깥에서 끌어온 글은 입력칸 위라도 막는다(웹뷰 이동 방지는 그대로)
    expect(await fireEvent.drop(input, { dataTransfer })).toBe(false);
  });

  it('길게 누른(repeat) Esc는 아무것도 닫지 않는다. 처음 누른 Esc는 닫는다(RE16)', async () => {
    render(GlobalShortcuts);
    const spy = vi.spyOn(ui, 'escape').mockReturnValue(true);
    try {
      await fireEvent.keyDown(window, { key: 'Escape', repeat: true });
      expect(spy).not.toHaveBeenCalled();
      await fireEvent.keyDown(window, { key: 'Escape' });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('[data-local-keys] 안의 Esc도 이제 예외가 아니다(편집 화면이 생겨 쓰는 곳이 없다)', async () => {
    const { container } = render(GlobalShortcuts);
    const area = document.createElement('div');
    area.setAttribute('data-local-keys', '');
    container.appendChild(area);
    const spy = vi.spyOn(ui, 'escape').mockReturnValue(true);
    try {
      await fireEvent.keyDown(area, { key: 'Escape' });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('구간 편집 화면이 열린 동안 Mod+L·Mod+,는 무시한다(설정으로 가면 카드가 언마운트된다, RE15)', async () => {
    render(GlobalShortcuts);
    platform.set('windows');
    const focus = vi.fn();
    ui.urlTarget = { focus, paste: vi.fn() };
    ui.rangeEditorOpen = true;
    try {
      const l = await fireEvent.keyDown(window, { key: 'l', ctrlKey: true });
      const comma = await fireEvent.keyDown(window, { key: ',', ctrlKey: true });
      expect(ui.view).toBe('home');
      expect(focus).not.toHaveBeenCalled();
      // 처리하지 않았으니 기본 동작을 막지 않는다
      expect(l).toBe(true);
      expect(comma).toBe(true);
      ui.rangeEditorOpen = false;
      await fireEvent.keyDown(window, { key: ',', ctrlKey: true });
      expect(ui.view).toBe('settings');
    } finally {
      ui.rangeEditorOpen = false;
      ui.urlTarget = null;
    }
  });

  it('구간 편집 화면이 열린 동안 입력칸 밖 붙여넣기는 무시하고, 닫히면 입력줄로 보낸다(RE15)', async () => {
    render(GlobalShortcuts);
    const paste = vi.fn();
    ui.urlTarget = { focus: vi.fn(), paste };
    const event = () => ({ clipboardData: { getData: () => 'https://chzzk.naver.com/video/1' } });
    try {
      ui.rangeEditorOpen = true;
      expect(await fireEvent.paste(document.body, event())).toBe(true);
      expect(paste).not.toHaveBeenCalled();
      ui.rangeEditorOpen = false;
      expect(await fireEvent.paste(document.body, event())).toBe(false);
      expect(paste).toHaveBeenCalledTimes(1);
    } finally {
      ui.rangeEditorOpen = false;
      ui.urlTarget = null;
    }
  });

  it('Esc는 ui.escape로, Mod+,는 설정으로', async () => {
    render(GlobalShortcuts);
    platform.set('macos');
    await fireEvent.keyDown(window, { key: ',', metaKey: true });
    expect(ui.view).toBe('settings');
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(ui.view).toBe('home');
    platform.set('windows');
    await fireEvent.keyDown(window, { key: ',', ctrlKey: true });
    expect(ui.view).toBe('settings');
  });

  it('IME 조합 중의 키는 첫 줄에서 거른다(Esc·Mod+,가 설정을 건드리지 않는다)', async () => {
    render(GlobalShortcuts);
    platform.set('windows');
    ui.goSettings();
    await fireEvent.keyDown(window, { key: 'Escape', isComposing: true });
    expect(ui.view).toBe('settings');
    // 일부 웹뷰는 isComposing 없이 keyCode 229만 보낸다
    await fireEvent.keyDown(window, { key: 'Escape', keyCode: 229 });
    expect(ui.view).toBe('settings');
    ui.goHome();
    await fireEvent.keyDown(window, { key: ',', ctrlKey: true, isComposing: true });
    expect(ui.view).toBe('home');
  });

  it('<video> 위의 Esc는 카드를 닫지 않고, 카드 다른 곳의 Esc는 여전히 닫는다', async () => {
    render(GlobalShortcuts);
    const handler = vi.fn(() => true);
    const off = ui.onEscape(handler);
    const video = document.createElement('video');
    const other = document.createElement('button');
    document.body.append(video, other);
    try {
      await fireEvent.keyDown(video, { key: 'Escape' });
      expect(handler).not.toHaveBeenCalled();
      await fireEvent.keyDown(other, { key: 'Escape' });
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      off();
      video.remove();
      other.remove();
    }
  });
});

describe('Mod+Z: 가장 최근 되돌리기 토스트(ADR-0033)', () => {
  let say: ReturnType<typeof vi.spyOn>;
  let run: ReturnType<typeof vi.fn<() => void>>;
  beforeEach(() => {
    auth.apply(AUTH_DISABLED);
    platform.set('linux');
    toasts.clear();
    say = vi.spyOn(announcer, 'say').mockImplementation(() => {});
    run = vi.fn<() => void>();
    toasts.push('목록에서 지웠어요', 'info', { undo: true, action: { label: t('action.undo'), run } });
    say.mockClear();
  });
  afterEach(() => {
    say.mockRestore();
    toasts.clear();
    ui.rangeEditorOpen = false;
    ui.goHome();
    auth.reset();
    platform.set('linux');
  });

  it('Ctrl+Z가 되돌리기를 실행하고 토스트를 닫고 "되돌렸어요"를 읽는다', async () => {
    render(GlobalShortcuts);
    const notPrevented = await fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(notPrevented).toBe(false);
    expect(run).toHaveBeenCalledOnce();
    expect(toasts.items).toHaveLength(0);
    expect(say).toHaveBeenLastCalledWith(t('a11y.undone'));
  });

  it('다음 토스트가 있으면 "되돌렸어요"가 다음 토스트의 낭독을 덮어쓰지 않고 한 문장으로 읽는다', async () => {
    say.mockRestore();
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      toasts.clear();
      toasts.push('A를 지웠어요', 'info', { undo: true, action: { label: t('action.undo'), run } });
      // 되돌리기 토스트 뒤에 줄을 선 다른 토스트: A가 닫히면 보여 읽힌다
      toasts.push('복사했어요', 'copied');
      vi.advanceTimersToNextFrame();
      render(GlobalShortcuts);
      // A를 되돌리면 대기열의 토스트가 보이게 되어 읽힌다
      await fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
      vi.advanceTimersToNextFrame();
      expect(announcer.message).toContain(t('a11y.undone'));
      expect(announcer.message).toContain('복사했어요');
    } finally {
      vi.useRealTimers();
      say = vi.spyOn(announcer, 'say').mockImplementation(() => {});
    }
  });

  it('macOS는 Meta+Z만 받는다', async () => {
    platform.set('macos');
    render(GlobalShortcuts);
    await fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
    await fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
    expect(run).toHaveBeenCalledOnce();
  });

  it('입력칸·textarea·contenteditable 안에서는 가로채지 않는다(글 되돌리기)', async () => {
    const { container } = render(GlobalShortcuts);
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    const rich = document.createElement('div');
    rich.contentEditable = 'true';
    // jsdom은 isContentEditable을 구현하지 않는다
    Object.defineProperty(rich, 'isContentEditable', { value: true });
    container.append(input, area, rich);
    for (const el of [input, area, rich]) {
      expect(await fireEvent.keyDown(el, { key: 'z', ctrlKey: true })).toBe(true);
    }
    expect(run).not.toHaveBeenCalled();
    expect(toasts.items).toHaveLength(1);
  });

  it('되돌릴 것이 없으면 기본 동작을 막지 않는다(정보 토스트만, 또는 undo 아닌 동작 토스트)', async () => {
    toasts.clear();
    toasts.push('저장했어요', 'info');
    render(GlobalShortcuts);
    expect(await fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })).toBe(true);
    const other = vi.fn();
    toasts.clear();
    toasts.push('찾을 수 없어요', 'danger', { action: { label: '폴더 열기', run: other } });
    expect(await fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })).toBe(true);
    expect(other).not.toHaveBeenCalled();
    expect(toasts.items).toHaveLength(1);
  });

  it('Shift(다시 실행)·Alt·repeat는 무시한다', async () => {
    render(GlobalShortcuts);
    await fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, shiftKey: true });
    await fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, altKey: true });
    await fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, repeat: true });
    expect(run).not.toHaveBeenCalled();
  });

  it('구간 편집 화면이 열린 동안은 받지 않는다(RE15)', async () => {
    render(GlobalShortcuts);
    ui.rangeEditorOpen = true;
    await fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
    ui.rangeEditorOpen = false;
    await fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(run).toHaveBeenCalledOnce();
  });

  it('모달 층이 열린 동안은 받지 않고, 닫히면 다시 받는다', async () => {
    render(GlobalShortcuts);
    const layer = document.createElement('div');
    const release = modalLayer(layer);
    try {
      await fireEvent.keyDown(layer, { key: 'z', ctrlKey: true });
      expect(run).not.toHaveBeenCalled();
    } finally {
      release();
    }
    await fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(run).toHaveBeenCalledOnce();
  });

  it('로그인 화면(잠금)에서는 받지 않는다', async () => {
    auth.reset();
    render(GlobalShortcuts);
    await fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
  });

  it('IME 조합 중에는 받지 않는다', async () => {
    render(GlobalShortcuts);
    await fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, isComposing: true });
    expect(run).not.toHaveBeenCalled();
  });
});
