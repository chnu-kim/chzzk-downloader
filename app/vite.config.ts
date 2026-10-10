import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tauri dev 서버 규약: 고정 포트 1420, 포트가 차 있으면 실패, Rust 오류를 지우지 않는다.
// https://v2.tauri.app/start/frontend/vite/
const host = process.env.TAURI_DEV_HOST;
// 디자인 갤러리(docs/design/system/governance.md §2.6): CHZZK_GALLERY=1일 때만 gallery.html 진입점을 넣는다.
// e2e-web·design-shots gate만 켠다. 릴리스 dist에는 없다(release-hygiene가 dist에 gallery가 없는지 본다).
const gallery = process.env.CHZZK_GALLERY === '1';

export default defineConfig({
  // svelteTesting: 테스트에서 Svelte 브라우저 빌드를 쓰고 매 테스트 뒤 DOM을 치운다(VITEST일 때만 동작).
  plugins: [svelte(), svelteTesting()],
  clearScreen: false,
  // TAURI_ 전체가 아니라 TAURI_ENV_만 노출한다(TAURI_SIGNING_PRIVATE_KEY 등이 번들에 들어가지 않게).
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'es2022',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    ...(gallery
      ? { rollupOptions: { input: { index: fileURLToPath(new URL('./index.html', import.meta.url)), gallery: fileURLToPath(new URL('./gallery.html', import.meta.url)) } } }
      : {}),
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    // 커버리지 ratchet(docs/design/cicd.md §4.2, scripts/ci/measure.mjs). 분모가 테스트가 닿은 파일에 따라 바뀌지 않도록
    // 대상 파일을 고정한다. 생성물(bindings)·테스트 도구·선언 파일은 뺀다.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,svelte}'],
      // 갤러리(src/gallery)는 Playwright(design-gallery)가 본다. vitest 분모에 넣지 않는다
      exclude: ['src/**/*.test.ts', 'src/test/**', 'src/lib/bindings/**', 'src/**/*.d.ts', 'src/gallery/**'],
      reporter: ['json-summary'],
    },
  },
});
