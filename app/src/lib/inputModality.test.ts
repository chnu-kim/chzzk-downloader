import { afterEach, describe, expect, it } from 'vitest';
import { lastInputWasKeyboard, setInputModality, trackInputModality } from './inputModality';

describe('입력 방식 추적(ADR-0033)', () => {
  afterEach(() => setInputModality('pointer'));

  it('설치하기 전 기본은 포인터다', () => {
    expect(lastInputWasKeyboard()).toBe(false);
  });

  it('keydown은 키보드, pointerdown은 포인터', () => {
    trackInputModality(window);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(lastInputWasKeyboard()).toBe(true);
    window.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(lastInputWasKeyboard()).toBe(false);
  });

  it('detail이 0인 click(Enter·Space, 보조 기술의 활성화)은 키보드, 진짜 클릭은 포인터를 유지한다', () => {
    trackInputModality(window);
    window.dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true }));
    expect(lastInputWasKeyboard()).toBe(true);
    window.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    window.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
    expect(lastInputWasKeyboard()).toBe(false);
  });

  it('IME 조합 키는 키보드로 세지 않는다', () => {
    trackInputModality(window);
    window.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', isComposing: true, bubbles: true }));
    expect(lastInputWasKeyboard()).toBe(false);
  });

  it('두 번 설치해도 키 한 번에 한 번만 바뀐다(리스너가 겹치지 않는다)', () => {
    trackInputModality(window);
    trackInputModality(window);
    let seen = 0;
    const spy = () => seen++;
    window.addEventListener('keydown', spy);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    window.removeEventListener('keydown', spy);
    expect(seen).toBe(1);
    expect(lastInputWasKeyboard()).toBe(true);
  });

  it('setInputModality는 설치와 무관하게 상태를 정한다', () => {
    setInputModality('keyboard');
    expect(lastInputWasKeyboard()).toBe(true);
    setInputModality('pointer');
    expect(lastInputWasKeyboard()).toBe(false);
  });
});
