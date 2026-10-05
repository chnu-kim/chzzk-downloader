import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { ui } from '../../stores/ui.svelte';
import GlobalShortcuts from './GlobalShortcuts.svelte';

describe('GlobalShortcuts', () => {
  afterEach(() => ui.goHome());

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

  it('Esc는 ui.escape로, Mod+,는 설정으로', async () => {
    render(GlobalShortcuts);
    const mac = /Mac/.test(navigator.platform);
    await fireEvent.keyDown(window, { key: ',', metaKey: mac, ctrlKey: !mac });
    expect(ui.view).toBe('settings');
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(ui.view).toBe('home');
  });
});
