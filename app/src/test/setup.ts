// vitest 공통 준비(app.md §13).
import '@testing-library/jest-dom/vitest';
import { clearMocks } from '@tauri-apps/api/mocks';
import { afterEach } from 'vitest';

// Tauri mocks와 Channel이 쓰는 crypto.getRandomValues. jsdom에 없으면 node 것을 붙인다.
if (typeof window !== 'undefined' && !window.crypto?.getRandomValues) {
  Object.defineProperty(window, 'crypto', { value: globalThis.crypto, configurable: true });
}

afterEach(() => {
  // node 환경 테스트(tokens.test.ts 등)에는 window가 없다.
  if (typeof window !== 'undefined') clearMocks();
});
