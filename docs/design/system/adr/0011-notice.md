# 0011 Notice: 알림 아홉 갈래를 프리미티브 하나로

상태: 채택(잠정)   날짜: 2026-10-10   관련: D35, D37, components §2.12·§2.13·§2.14, governance §5 단계 3, ADR-0005

## 맥락

앱의 알림은 InlineAlert·Banner·Toast와 화면마다 따로 그린 오류 줄까지 아홉 갈래였다. 톤 색이 글자까지 번지고(`A-FEAT-C8`), 같은 경고가 어떤 곳에서는 `alert`이고 어떤 곳에서는 `note`였으며(`A-FEAT-C2`), 동작 버튼은 네 종류였다(`A-FEAT-C6`). 과업 T1(영상 주소를 넣고 불러오기)의 불러오기 실패·충돌 안내, T3(받는 중 문제 확인)의 작업 행 오류 줄, 설정 절 경고가 모두 같은 구조를 필요로 한다. governance §5 단계 3의 "새 컴포넌트" 절차를 따라 프리미티브를 하나 더하고 기존 셋을 대체한다.

## 결정

`Notice` 하나로 통합한다(components §2.12). `variant`(`inline`·`banner`·`row`·`toast`) × `tone`(`neutral`·`info`·`warning`·`danger`) 두 축이고, 톤 색은 아이콘과 면에만 두며 제목·본문 글자는 늘 `--fg`다. 동작 버튼은 `Button secondary sm` 하나로 통일한다(≤ 3). `row`에는 `actions`·`onclose`가 없다. role은 `inline`·`banner`·`toast`에서 `danger`면 `alert`, 그 밖은 `status`, `row`는 없다.

(b) 구현의 계약 결정: role은 모든 variant에서 안쪽 `.notice-text`에 둔다(banner 규칙을 넓혀 동작 버튼이 라이브 영역에 들어가지 않게 한다). `ErrorAlert`는 (b)에서 만들지 않고 `errorCopy` 모양이 정해지는 (d)로 미룬다.

## 근거

| 주장 | 등급 | 출처 | 표본·날짜 |
|---|---|---|---|
| 알림 갈래가 아홉이고 톤 색이 글자까지 번진다 | E1 | `A-FEAT-C8`, `A-FEAT-C6` (정적 감사) | 2026-10-09 |
| 같은 경고가 `alert`와 `note`로 갈린다 | E1 | `A-FEAT-C2` | 2026-10-09 |
| `role="status"`는 결과, `role="alert"`는 경고·오류. 중요하지 않은 내용에 `alert`를 쓰면 실패 | E0 | `E-KO-22` (WCAG 4.1.3) | — |
| 위험도 위계: 되돌릴 수 없으면 `danger`, 되돌릴 수 있는 주의는 `warning` | E1 | `A-FEAT-C3`, README D37 | 2026-10-09 |
| 경고와 오류 아이콘 모양이 달라야 한다 | E1 | `A-PRIM-A2` | 2026-10-09 |

최고 등급: E1 / 결정 영향: 중간 / 판정: 채택(잠정)

## 결과

- 바뀌는 곳: components §2.12·§2.13, `ui/Notice.svelte`가 `InlineAlert`·`Banner`와 옛 Toast 모양을 대체한다. Worker는 같은 클래스 `.notice`를 쓴다(components §4).
- gate: `design-lint` DS1(`role="alert"` 리터럴은 `Notice.svelte`에만), `frontend`(tone × variant → role 테스트).
- 사용처 이행(`variant="link"`·옛 prop)은 (b), 화면 재구성은 (c), 문구는 (d)다.

### 재검증 조건

- 스크린리더 실기(VoiceOver·NVDA)에서 `.notice-text`의 `role="status"`가 중복 낭독되거나 읽히지 않는다는 관찰. 나쁘면 role 위치를 다시 정하고 새 ADR.

## 대안과 버린 이유

| 대안 | 버린 이유 |
|---|---|
| InlineAlert·Banner·Toast를 따로 두고 톤만 공유 | 동작 버튼 네 종류와 role 불일치가 그대로 남는다 |
| role을 바깥 요소에 둔다 | 동작 버튼과 닫기 버튼이 라이브 영역에 들어가 낭독이 길어진다 |
| 톤마다 글자색을 바꾼다 | 면 위 대비 쌍이 늘고 `A-FEAT-C8`이 되살아난다 |
