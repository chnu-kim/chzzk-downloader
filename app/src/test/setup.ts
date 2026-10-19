// vitest 공통 준비(app.md §13).
import '@testing-library/jest-dom/vitest';
import { clearMocks } from '@tauri-apps/api/mocks';
import { afterEach } from 'vitest';

// Tauri mocks와 Channel이 쓰는 crypto.getRandomValues. jsdom에 없으면 node 것을 붙인다.
if (typeof window !== 'undefined' && !window.crypto?.getRandomValues) {
  Object.defineProperty(window, 'crypto', { value: globalThis.crypto, configurable: true });
}

// jsdom의 미디어 요소는 canPlayType이 늘 ''이고 load·pause·play는 "not implemented"를 던진다. 미리보기(WatchPanel)가
// 재생 가능 여부를 먼저 묻기 때문에 기본은 재생할 수 있는 웹뷰로 흉내 낸다(막힌 경우는 테스트가 spyOn으로 ''을 준다).
if (typeof HTMLMediaElement !== 'undefined') {
  HTMLMediaElement.prototype.canPlayType = () => 'maybe';
  HTMLMediaElement.prototype.load = () => {};
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.play = () => Promise.resolve();
}

afterEach(() => {
  // node 환경 테스트(tokens.test.ts 등)에는 window가 없다.
  if (typeof window !== 'undefined') clearMocks();
});
