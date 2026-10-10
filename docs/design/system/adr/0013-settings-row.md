# 0013 SettingsRow: 설정 행의 라벨·값 색 역할 고정

상태: 채택(잠정)   날짜: 2026-10-10   관련: D19, components §2.17, governance §5 단계 3, ADR-0012

## 맥락

설정 화면(T5)의 행은 화면마다 라벨과 값의 색 역할이 반대였다(`A-FEAT-E2`). 라벨 + 도움말 + 값 + 컨트롤이라는 같은 구조를 컴포넌트로 올린다.

## 결정

`SettingsRow`(components §2.17)를 더한다. `Surface group` 안의 한 행이고 `[라벨 + 도움말] [현재 값?] [컨트롤]`이다. 라벨 `--fg`, 값·도움말 `--fg-muted`로 고정한다. 컨트롤 snippet은 `labelId`·`helpId`를 받아 `aria-labelledby`·`aria-describedby`를 건다. 컴포넌트는 폭 미디어 쿼리를 갖지 않고 `flex-wrap`으로 줄바꿈한다.

(b) 구현의 계약 결정: 라벨과 도움말은 `.row-main`으로 묶고, 값은 `.row-value.ellipsis`, 컨트롤은 `.row-control`이다.

## 근거

| 주장 | 등급 | 출처 | 표본·날짜 |
|---|---|---|---|
| 라벨·값 색 역할이 화면마다 반대였다 | E1 | `A-FEAT-E2` (정적 감사) | 2026-10-09 |
| 시스템 설정의 그룹 상자 안 행 구조 | E1 | README D19, foundations §6.3 | 2026-10-09 |

최고 등급: E1 / 결정 영향: 작음 / 판정: 채택(잠정)

## 결과

- 바뀌는 곳: components §2.17, `ui/SettingsRow.svelte`. Worker 관리 페이지는 같은 `.row` 클래스를 쓴다.
- 설정 화면을 SettingsRow로 다시 짜는 것은 (c)다.

### 재검증 조건

- 320 폭·글자 크기 `x-large`에서 라벨·컨트롤 줄바꿈이 어색하다는 갤러리 관찰. 나쁘면 줄바꿈 규칙을 고치고 새 ADR.

## 대안과 버린 이유

| 대안 | 버린 이유 |
|---|---|
| 행마다 색을 호출부가 고르게 둔다 | `A-FEAT-E2`가 되풀이된다 |
| 컴포넌트에 폭 미디어 쿼리를 둔다 | foundations §8이 컴포넌트의 폭 쿼리를 막는다 |
