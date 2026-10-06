// IIFE 진입점: 앞선 init script가 둔 시나리오로 가짜 백엔드를 설치한다(e2e/fixtures.ts).
import { install } from './backend';

install(window.__E2E_SCENARIO__ ?? {});
