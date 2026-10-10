# 0015 DropOverlay: 투명 면 + 점선 테두리 + 가운데 라벨

상태: 채택(잠정)   날짜: 2026-10-10   관련: components §2.27, foundations §7.2, platform §17.3, governance §5 단계 3

## 맥락

영상 주소를 창에 끌어다 놓는 입력(T1)의 오버레이는 88% 불투명으로 본문을 덮었고 z-index가 배너 층을 빌려 썼다(`A-FEAT-S4`).

## 결정

`DropOverlay`(components §2.27)를 시스템 컴포넌트로 올린다. `--z-drop` 층의 창 전체 요소이고 면은 투명이다. 창 안쪽 `--edge` 자리에 `2px dashed var(--accent-ink)` 테두리, 가운데 라벨(`--raised` + `--shadow-toast`, `download` 아이콘 + 안내 문구)을 둔다. forced-colors는 `2px dashed CanvasText`, 전환은 없다.

(b) 구현의 계약 결정: `ui/DropOverlay`는 표시만(`open`) 맡고 끌기 이벤트 처리는 `receive/DropOverlay.svelte`에 남긴다. 라벨 문구 키는 지금 deck의 `url.dropHere`이고 이름 정리는 (d)다.

## 근거

| 주장 | 등급 | 출처 | 표본·날짜 |
|---|---|---|---|
| 드롭 오버레이가 본문을 덮고 z-index를 빌려 쓴다 | E1 | `A-DRIFT-A7`, `A-FEAT-S4` (정적 감사) | 2026-10-09 |
| 드래그 입력은 `text/uri-list`·`text/plain`이 있을 때만 받는다 | E1 | platform §17.3 | 2026-10-09 |

최고 등급: E1 / 결정 영향: 작음 / 판정: 채택(잠정)

## 결과

- 바뀌는 곳: components §2.27, `ui/DropOverlay.svelte`, foundations §7.2의 `--z-drop`.
- gate: `design-lint`(오버레이에 `backdrop-filter`·`color-mix(… transparent)` 금지), `e2e-web`(`DataTransfer` 합성).

### 재검증 조건

- 본문 위 점선이 흐린 배경에서 안 보인다는 관찰. 나쁘면 테두리 색을 조정한다(새 ADR).

## 대안과 버린 이유

| 대안 | 버린 이유 |
|---|---|
| 반투명 덮개 | 본문을 가리고 `color-mix`·`backdrop-filter` 금지에 걸린다 |
| ui 컴포넌트가 끌기 이벤트까지 맡는다 | 받기 흐름의 상태(`text/uri-list` 판정)가 ui 층으로 새 들어간다 |
