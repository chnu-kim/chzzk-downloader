// 가짜 백엔드(e2e/mock)를 IIFE 하나로 묶는다. 앱 dist와 따로 묶으므로 앱 번들에는 mock 코드가 들어가지 않는다.
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

export const MOCK_BUNDLE = fileURLToPath(new URL('../../target/e2e-web/mock/mock.js', import.meta.url));

export default async function globalSetup(): Promise<void> {
  await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      target: 'es2022',
      outDir: fileURLToPath(new URL('../../target/e2e-web/mock', import.meta.url)),
      emptyOutDir: true,
      minify: false,
      lib: {
        entry: fileURLToPath(new URL('./mock/entry.ts', import.meta.url)),
        formats: ['iife'],
        name: 'chzzkE2EMock',
        fileName: () => 'mock.js',
      },
    },
  });
}
