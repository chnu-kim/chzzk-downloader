import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_DISABLED, auth } from '../../stores/auth.svelte';
import { platform } from '../../stores/platform.svelte';
import { ui } from '../../stores/ui.svelte';
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
