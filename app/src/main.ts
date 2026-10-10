import { mount } from 'svelte';
import App from './App.svelte';
import { installGuards } from './lib/guards';
// 토큰(index.html의 first.css가 먼저 싣는다) → 컴포넌트(ui.css) → 좁은 레이아웃(layout.css) → 전역 규칙 순서. 생성물 둘은 scripts/design/tokens.mjs가 만든다
import './styles/ui.css';
import './styles/layout.css';
import './app.css';
import { signalReady } from './lib/ready';

const target = document.getElementById('app');
if (!target) throw new Error('#app 요소가 없습니다');

// 웹 흔적 지우기(컨텍스트 메뉴·브라우저 단축키·핀치). dev 서버(브라우저 개발)에서는 켜지 않는다.
// Tauri --debug 빌드도 PROD 번들이라 가드가 켜진다
if (!import.meta.env.DEV) installGuards();

const app = mount(App, { target });
// dist가 실리고 CSP를 지나 IPC가 닿는다는 신호(--smoke가 이것을 기다린다)
signalReady();

export default app;
