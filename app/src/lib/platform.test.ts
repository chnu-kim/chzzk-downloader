import { describe, expect, it } from 'vitest';
import { applyAppearance, applyWindowActive } from './appearance';
import { t } from './copy/ko';
import { modPressed, osFamily, revealLabel, shortcutText } from './platform';

describe('OS 분기(platform.md §20)', () => {
  it('macOS와 그 밖 두 갈래: 단축키 표기·폴더 보기 라벨', () => {
    expect(osFamily('macos')).toBe('mac');
    expect(osFamily('windows')).toBe('other');
    expect(osFamily('linux')).toBe('other');
    expect(shortcutText('macos', 'paste')).toBe(t('platform.mac.paste'));
    expect(shortcutText('windows', 'paste')).toBe(t('platform.other.paste'));
    expect(shortcutText('linux', 'submit')).toBe(t('platform.other.submit'));
    expect(revealLabel('macos')).toBe(t('platform.mac.reveal'));
    expect(revealLabel('windows')).toBe(t('platform.other.reveal'));
  });

  it('Mod 키: macOS는 ⌘만, 그 밖은 Ctrl만', () => {
    const cmd = { metaKey: true, ctrlKey: false };
    const ctrl = { metaKey: false, ctrlKey: true };
    const both = { metaKey: true, ctrlKey: true };
    expect(modPressed(cmd, 'macos')).toBe(true);
    expect(modPressed(ctrl, 'macos')).toBe(false);
    expect(modPressed(ctrl, 'windows')).toBe(true);
    expect(modPressed(cmd, 'linux')).toBe(false);
    expect(modPressed(both, 'macos')).toBe(false);
  });
});

describe('뿌리 속성(foundations §3.2·§10)', () => {
  it('글자 크기: default면 속성을 떼고, large·x-large는 붙인다', () => {
    const root = document.createElement('html');
    applyAppearance(root, { textScale: 'x-large', theme: 'system' }, 'macos');
    expect(root.getAttribute('data-text-scale')).toBe('x-large');
    applyAppearance(root, { textScale: 'default', theme: 'system' }, 'macos');
    expect(root.hasAttribute('data-text-scale')).toBe(false);
  });

  it('모양: Linux에서 고른 밝게·어둡게만 붙인다(D7)', () => {
    const root = document.createElement('html');
    applyAppearance(root, { textScale: 'default', theme: 'dark' }, 'linux');
    expect(root.getAttribute('data-theme')).toBe('dark');
    applyAppearance(root, { textScale: 'default', theme: 'dark' }, 'windows');
    expect(root.hasAttribute('data-theme')).toBe(false);
    applyAppearance(root, { textScale: 'default', theme: 'system' }, 'linux');
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('비활성 창: macOS만 data-window-active를 둔다', () => {
    const root = document.createElement('html');
    applyWindowActive(root, false, 'macos');
    expect(root.getAttribute('data-window-active')).toBe('false');
    applyWindowActive(root, true, 'macos');
    expect(root.getAttribute('data-window-active')).toBe('true');
    applyWindowActive(root, false, 'windows');
    expect(root.hasAttribute('data-window-active')).toBe(false);
  });
});
