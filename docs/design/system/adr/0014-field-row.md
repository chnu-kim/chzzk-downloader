# 0014 FieldRow: 카드 폼 행은 SettingsRow와 색 규칙을 같이 한다

상태: 채택(잠정)   날짜: 2026-10-10   관련: D19, components §2.26, patterns §6.2, governance §5 단계 3, ADR-0013

## 맥락

영상 카드(T2 저장 이름·위치 정하기)는 "라벨 · 값/컨트롤 · 동작" 행을 쓴다. 설정 행과 구조가 비슷하지만 라벨이 고정 폭 왼쪽 열이라는 점이 다르다. 초안에는 이 행이 없어 카드마다 지역 grid가 있었고 라벨 색이 화면마다 반대였다(`A-FEAT-E2`).

## 결정

`FieldRow`(components §2.26)를 더한다. `[라벨 열 --label-w] [값 또는 컨트롤 1fr] [동작]?`의 grid이고, 색 규칙은 SettingsRow와 같다(라벨 `--fg`, 값·도움말 `--fg-muted`). 좁은 레이아웃에서는 1열로 라벨이 컨트롤 위에 온다. Worker에는 없다(폼 라벨은 위).

(b) 구현의 계약 결정: `.fieldrow` > `.fieldrow-label`(id)·`.fieldrow-value`·`.fieldrow-actions`?·`.fieldrow-help`?.

## 근거

| 주장 | 등급 | 출처 | 표본·날짜 |
|---|---|---|---|
| 라벨·값 색 역할이 화면마다 반대였다 | E1 | `A-FEAT-E2` (정적 감사) | 2026-10-09 |
| macOS는 label을 1차 잉크, 값을 secondary로 위계한다 | E1 | `E-APPLE-11` (실측 구조) | 2026-10-09 |

최고 등급: E1 / 결정 영향: 작음 / 판정: 채택(잠정)

## 결과

- 바뀌는 곳: components §2.26, `ui/FieldRow.svelte`. 카드 폼을 FieldRow로 다시 짜는 것은 (c)다.
- gate: `frontend`(FieldRow 하나만 사용), `design-gallery`(x-large·320 폭 1열).

### 재검증 조건

- 라벨 열 80이 영문 긴 라벨에서 잘린다는 관찰. 나쁘면 `--label-w`를 조정한다(토큰 하나, 새 ADR).

## 대안과 버린 이유

| 대안 | 버린 이유 |
|---|---|
| SettingsRow를 라벨 열 변형으로 확장 | 설정 행은 라벨 위치가 자유롭고 FieldRow는 고정 열이라 한 컴포넌트에 두 레이아웃이 섞인다 |
| 카드마다 지역 grid | 색 역할 불일치가 되살아난다 |
