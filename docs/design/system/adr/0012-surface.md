# 0012 Surface: 테두리 있는 면 박스를 하나로

상태: 채택(잠정)   날짜: 2026-10-10   관련: D19, components §2.16, governance §5 단계 3

## 맥락

화면 여덟 곳이 각자 `border` + 배경 + 반경으로 같은 모양의 박스를 그렸다(`A-FEAT-D1`). 영상 카드(T1·T2), 작업 목록(T3), 설정 그룹(T5) 모두 같은 면을 쓴다. governance §5 단계 3에 따라 컴포넌트로 올린다.

## 결정

`Surface`(components §2.16)를 더한다. `--surface` + 1px `--separator` + `--radius-group`, 그림자 없음. `variant`는 `group`(패딩 0, 자식 행이 패딩·구분선을 가진다)과 `card`(패딩 `--space-16`, `header`·`footer` 선택)다. 스켈레톤 카드는 같은 Surface 안에 Skeleton을 놓아 높이가 결과와 같게 한다.

(b) 구현의 계약 결정: 루트는 `<section class="surface surface-<variant>">`이고 card의 header·body·footer는 `.card-header`·`.card-body`·`.card-footer` 구조다.

## 근거

| 주장 | 등급 | 출처 | 표본·날짜 |
|---|---|---|---|
| 테두리+면 박스가 여덟 곳에 따로 있다 | E1 | `A-FEAT-D1` (정적 감사) | 2026-10-09 |
| 그룹 상자는 면 + 1px 구분선 + 큰 반경 | E1 | README D19, foundations §6.3 | 2026-10-09 |
| 스켈레톤과 결과의 높이가 같지 않으면 화면이 점프한다 | E1 | `A-VIS-19` | 2026-10-09 |

최고 등급: E1 / 결정 영향: 작음 / 판정: 채택(잠정)

## 결과

- 바뀌는 곳: components §2.16, `ui/Surface.svelte`. 기능 화면이 Surface로 다시 짜이는 것은 (c)다.
- gate: `design-lint`의 면 토큰 사용 검사가 지역 박스를 막는다.

### 재검증 조건

- 라이트·다크·forced-colors 갤러리에서 `--surface`와 `--bg`의 경계가 `--separator` 1px만으로 안 보인다는 관찰. 나쁘면 면 단계를 조정하고 새 ADR.

## 대안과 버린 이유

| 대안 | 버린 이유 |
|---|---|
| 화면마다 지역 CSS로 박스를 유지 | 여덟 곳이 서로 어긋난 채 늘어난다 |
| 그림자로 떠 있는 카드 | 이 면은 떠 있지 않다. 그림자는 토스트·메뉴 층에만 쓴다 |
