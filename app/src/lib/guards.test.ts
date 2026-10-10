// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installGuards, shouldBlockKey } from './guards';

type Mods = { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean };

// 키를 target에서 눌러 defaultPrevented를 돌려준다(캡처로 window에서 막힌다)
function press(target: Element, key: string, m: Mods = {}, extra: KeyboardEventInit = {}): boolean {
  const ev = new KeyboardEvent('keydown', {
    key,
    ctrlKey: m.ctrl,
    metaKey: m.meta,
    altKey: m.alt,
    shiftKey: m.shift,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  target.dispatchEvent(ev);
  return ev.defaultPrevented;
}

let off: () => void;
let input: HTMLInputElement;
beforeEach(() => {
  document.body.innerHTML = '<main id="m"><p id="p">본문</p><input id="i" /><textarea id="t"></textarea><div id="ce" contenteditable="true"></div><div id="ro" contenteditable="false"></div><span id="n" data-native-menu>경로</span></main>';
  input = document.getElementById('i') as HTMLInputElement;
  off = installGuards(window);
});
afterEach(() => off());

const body = () => document.getElementById('p') as HTMLElement;

describe('contextmenu', () => {
  const fire = (el: Element) => {
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  it('본문은 막고 입력 대상은 남긴다', () => {
    expect(fire(body())).toBe(true);
    expect(fire(document.body)).toBe(true);
    expect(fire(document.getElementById('ro')!)).toBe(true);
    for (const id of ['i', 't', 'ce', 'n']) expect(fire(document.getElementById(id)!), id).toBe(false);
  });
  it('뗀 뒤에는 막지 않는다', () => {
    off();
    expect(fire(body())).toBe(false);
    off = installGuards(window);
  });
});

describe('브라우저 단축키: 본문에서 막는 키', () => {
  const blocked: [string, string, Mods][] = [
    ['F5', 'F5', {}],
    ['F3', 'F3', {}],
    ['F12', 'F12', {}],
    ['Ctrl+R', 'r', { ctrl: true }],
    ['Ctrl+Shift+R', 'R', { ctrl: true, shift: true }],
    ['Ctrl+F', 'f', { ctrl: true }],
    ['Ctrl+P', 'p', { ctrl: true }],
    ['Ctrl+U', 'u', { ctrl: true }],
    ['Ctrl+Shift+I', 'I', { ctrl: true, shift: true }],
    ['Ctrl+Shift+C', 'C', { ctrl: true, shift: true }],
    ['Ctrl+Shift+J', 'J', { ctrl: true, shift: true }],
    ['Alt+←', 'ArrowLeft', { alt: true }],
    ['Alt+→', 'ArrowRight', { alt: true }],
    ['Cmd+R', 'r', { meta: true }],
    ['Cmd+Shift+R', 'R', { meta: true, shift: true }],
    ['Cmd+P', 'p', { meta: true }],
    ['Cmd+F', 'f', { meta: true }],
    ['Cmd+[', '[', { meta: true }],
    ['Cmd+]', ']', { meta: true }],
    ['Cmd+Option+I', 'i', { meta: true, alt: true }],
    ['Cmd+Option+J', 'j', { meta: true, alt: true }],
    ['Cmd+Option+U', 'u', { meta: true, alt: true }],
  ];
  it.each(blocked)('%s', (_n, key, m) => {
    expect(press(body(), key, m)).toBe(true);
  });
  it('한글 자판처럼 key가 글자가 아니어도 물리 키(code)로 막는다', () => {
    expect(press(body(), 'ㄱ', { ctrl: true }, { code: 'KeyR' })).toBe(true);
  });
});

describe('브라우저 단축키: 편집 대상 안', () => {
  it('Alt+←/→·Ctrl+F/P/U는 막지 않는다', () => {
    for (const id of ['i', 't', 'ce']) {
      const el = document.getElementById(id)!;
      expect(press(el, 'ArrowLeft', { alt: true }), `${id} Alt+←`).toBe(false);
      expect(press(el, 'ArrowRight', { alt: true }), `${id} Alt+→`).toBe(false);
      for (const k of ['f', 'p', 'u']) expect(press(el, k, { ctrl: true }), `${id} Ctrl+${k}`).toBe(false);
    }
  });
  it('새로고침·개발자 도구 키는 입력칸에서도 막는다', () => {
    expect(press(input, 'F5')).toBe(true);
    expect(press(input, 'r', { ctrl: true })).toBe(true);
    expect(press(input, 'I', { ctrl: true, shift: true })).toBe(true);
    expect(press(input, 'r', { meta: true })).toBe(true);
  });
  it('contenteditable="false"는 편집 대상이 아니다', () => {
    expect(press(document.getElementById('ro')!, 'f', { ctrl: true })).toBe(true);
  });
});

describe('브라우저 단축키: 늘 통과', () => {
  const pass: [string, Mods][] = [
    ...['c', 'v', 'x', 'a', 'z'].flatMap((k): [string, Mods][] => [[k, { ctrl: true }], [k, { meta: true }]]),
    ['Z', { ctrl: true, shift: true }],
    ['Z', { meta: true, shift: true }],
    ['Tab', {}],
    ['Tab', { shift: true }],
    ['Escape', {}],
    ['Home', {}],
    ['End', {}],
    ['PageUp', {}],
    ['PageDown', {}],
    ['l', { ctrl: true }],
    ['l', { meta: true }],
    [',', { meta: true }],
    [',', { ctrl: true }],
    ['Enter', { ctrl: true }],
    ['Enter', { meta: true }],
    ['ArrowLeft', { meta: true }],
    ['ArrowLeft', { alt: true, shift: true }],
    ['e', { ctrl: true, alt: true }], // AltGr
  ];
  it.each(pass)('%s %j', (key, m) => {
    expect(press(body(), key, m)).toBe(false);
  });
  it('macOS 편집 키 Ctrl+A/E/B/K/N은 입력칸에서 통과한다', () => {
    for (const k of ['a', 'e', 'b', 'k', 'n', 'f', 'p']) expect(press(input, k, { ctrl: true }), k).toBe(false);
  });
});

describe('IME 조합 중 keydown', () => {
  it('isComposing·keyCode 229는 건드리지 않는다', () => {
    expect(press(body(), 'F5', {}, { isComposing: true })).toBe(false);
    expect(press(body(), 'r', { ctrl: true }, { keyCode: 229 })).toBe(false);
  });
});

describe('wheel(ctrlKey)', () => {
  const wheel = (ctrlKey: boolean) => {
    const ev = new WheelEvent('wheel', { ctrlKey, bubbles: true, cancelable: true });
    body().dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  it('ctrl+wheel(핀치)은 막고 그냥 스크롤은 둔다', () => {
    expect(wheel(true)).toBe(true);
    expect(wheel(false)).toBe(false);
  });
});

describe('shouldBlockKey 순수 호출', () => {
  it('editable 인자가 Ctrl+F만 가른다', () => {
    const e = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true });
    expect(shouldBlockKey(e, false)).toBe(true);
    expect(shouldBlockKey(e, true)).toBe(false);
  });
});
