// 창 안에서 시작한 끌기(입력칸 글 옮기기, 제목·최근 VOD 끌기)인가.
// 바깥(다른 앱·브라우저)에서 끌어오면 이 창에서 `dragstart`가 나지 않는다. 창 안 끌기는 브라우저 기본 동작
// (입력칸 안 글 옮기기 등)을 그대로 두고 주소 드롭으로 받지 않는다.
// `dragend`가 오지 않는 경우(끌던 요소가 사라짐)를 위해 다음 `pointerdown`에도 푼다: 새 끌기는 늘 그 뒤에 시작한다.

let inPage = false;
let installed = false;

export function trackInPageDrags(target: Window = window): void {
  if (installed) return;
  installed = true;
  target.addEventListener('dragstart', () => (inPage = true), true);
  target.addEventListener('dragend', () => (inPage = false), true);
  target.addEventListener('pointerdown', () => (inPage = false), true);
}

export function isInPageDrag(): boolean {
  return inPage;
}
