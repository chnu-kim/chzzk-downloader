import { describe, expect, it } from 'vitest';
import conf from '../src-tauri/tauri.conf.json';
import capability from '../src-tauri/capabilities/default.json';

// identifier는 app_config_dir·app_data_dir·app_log_dir의 이름이 되므로 한 번 정하면 바꾸지 않는다(app.md §16).
describe('tauri.conf.json 불변식', () => {
  it('identifier와 제품 이름', () => {
    expect(conf.identifier).toBe('io.github.chnu-kim.chzzk-downloader');
    expect(conf.productName).toBe('치지직 다운로더');
  });

  it('프런트 빌드 연결', () => {
    expect(conf.build.frontendDist).toBe('../dist');
    expect(conf.build.devUrl).toBe('http://localhost:1420');
  });

  it('main 창 크기와 드래그 앤 드롭', () => {
    expect(conf.app.windows).toHaveLength(1);
    const [main] = conf.app.windows;
    expect(main).toMatchObject({
      label: 'main',
      title: '치지직 다운로더',
      width: 960,
      height: 700,
      minWidth: 720,
      minHeight: 520,
      // 네이티브 파일 드롭을 꺼야 웹뷰가 HTML5 drop(text/uri-list)으로 URL을 받는다(§16 드래그 앤 드롭).
      dragDropEnabled: false,
    });
  });

  it('전역 Tauri 객체를 노출하지 않고 CSP를 고정한다', () => {
    expect(conf.app.withGlobalTauri).toBe(false);
    expect(conf.app.security.freezePrototype).toBe(true);
    expect(conf.app.security.csp).toEqual({
      'default-src': "'self'",
      'script-src': "'self'",
      'style-src': "'self'",
      'img-src': "'self' data:",
      'connect-src': 'ipc: http://ipc.localhost',
      'object-src': "'none'",
      'base-uri': "'none'",
      'frame-ancestors': "'none'",
      'form-action': "'none'",
    });
  });
});

describe('capabilities/default.json', () => {
  it('main 창에만, 플러그인 권한 없이', () => {
    expect(capability.windows).toEqual(['main']);
    for (const p of capability.permissions) {
      expect(p === 'core:default' || p.startsWith('allow-')).toBe(true);
    }
  });
});
