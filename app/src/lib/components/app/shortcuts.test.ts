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

  it('Esc는 ui.escape로, Mod+,는 설정으로', async () => {
    render(GlobalShortcuts);
    const mac = /Mac/.test(navigator.platform);
    await fireEvent.keyDown(window, { key: ',', metaKey: mac, ctrlKey: !mac });
    expect(ui.view).toBe('settings');
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(ui.view).toBe('home');
  });
});
