// 마지막 조작이 키보드(또는 보조 기술의 클릭)였는가. 키보드로 지운 되돌리기 토스트를 닫을 때까지 두는 데 쓴다(ADR-0033).
// - keydown → 키보드, pointerdown → 포인터
// - detail === 0인 click(Enter·Space로 누른 버튼, 화면 낭독기 브라우즈 모드의 활성화)은 키보드로 본다.
//   NVDA·JAWS 브라우즈 모드는 키를 웹뷰에 넘기지 않아 keydown이 오지 않는다. 진짜 포인터 클릭은 pointerdown이 먼저이고 detail ≥ 1이다
// capture 단계에 달아 행의 keydown 처리기(Delete → 지우기)보다 먼저 돈다: 늦으면 옛 상태를 읽는다.
import { isImeKey } from './components/ui/focus';

export type InputModality = 'keyboard' | 'pointer';

let last: InputModality = 'pointer';
let installed = false;

export function trackInputModality(target: Window = window): void {
  if (installed) return;
  installed = true;
  // IME 조합 키는 입력칸 안에서만 나고 지우기와 무관하다
  target.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!isImeKey(e)) last = 'keyboard';
  }, true);
  target.addEventListener('pointerdown', () => (last = 'pointer'), true);
  target.addEventListener('click', (e: MouseEvent) => {
    if (e.detail === 0) last = 'keyboard';
  }, true);
}

export function lastInputWasKeyboard(): boolean {
  return last === 'keyboard';
}

/** 테스트 전용: 상태를 정한다(설치 여부와 무관) */
export function setInputModality(m: InputModality): void {
  last = m;
}
