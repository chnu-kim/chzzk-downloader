import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';
import { signalReady } from './lib/ready';

const target = document.getElementById('app');
if (!target) throw new Error('#app 요소가 없습니다');

const app = mount(App, { target });
// dist가 실리고 CSP를 지나 IPC가 닿는다는 신호(--smoke가 이것을 기다린다)
signalReady();

export default app;
