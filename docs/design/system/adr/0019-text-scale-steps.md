# 0019 글자 크기 단계: 기본·크게·아주 크게(×1·×1.3·×2.0)

상태: 채택(잠정)   날짜: 2026-10-10   관련: D28, D4, foundations §3.2·§12-9, platform §11

## 맥락

앱은 웹뷰 줌을 끈다(`zoomHotkeysEnabled: false`, Ctrl+±는 실수로 화면이 깨진다). macOS에는 Dynamic Type이 없고 HIG·WCAG 1.4.4는 글자를 최소 200%까지 키울 수 있어야 한다고 본다. 그래서 줌 대신 설정 안에서 글자 크기를 정한다. 단계 수와 배율을 정해야 하고 값은 사용자 시험 전이다.

## 결정

설정 › 보기 › 글자 크기에 세 단계를 둔다: 기본(×1), 크게(×1.3), 아주 크게(×2.0). `<html data-text-scale>`이 `large`·`x-large`일 때 글자 토큰만 재정의한다(기본이면 속성을 뗀다). 값은 `settings.json`의 `textScale`에 영속하고 `AppInfo`에도 실어 로그인 화면도 같은 크기로 그린다. 컨트롤은 `min-height`라 글자를 따라 늘어난다. `x-large`는 뷰포트 폭이 같지 않아 `layout.css`가 600 미만 미디어 쿼리와 같은 선언을 두 블록에 쓴다(foundations §12-28). 선택은 RadioGroup이다(세그먼트 금지).

## 근거

| 주장 | 등급 | 출처 | 표본·날짜 |
|---|---|---|---|
| 글자는 200%까지 키울 수 있어야 한다 | E0 | `E-APPLE-08`(HIG, WCAG 1.4.4) | — |
| 웹뷰 줌은 화면을 깨므로 끈다 | E1 | `G-SHELL-H3`, README D28 | 2026-10-10 |
| ×1.3은 중간 단계의 제안값이다 | E0 | foundations §12-9 [잠정] (확인: 사용자 시험 D62) | — |

최고 등급: E1 / 결정 영향: 중간 / 판정: 채택(잠정)

## 결과

- 바뀌는 곳: `core settings.rs`(`TextScale`), 셸 DTO(`AppInfo`·`SettingsDto`·`SettingsPatch`), `appearance.ts`, `ViewSection.svelte`, `layout.css`, 생성 `tokens.css`의 `text-scale` 절.
- gate: `design-tokens` DT11(블록 값이 유도 식과 같다), `design-gallery`와 `e2e-web`(x-large 행렬: axe 0·가로 스크롤 0), `rust`(왕복·모르는 값 → 기본).

### 재검증 조건

- 사용자 시험(D62)에서 ×1.3이 쓸모없거나 ×2.0에서 리플로우가 깨진다는 관찰. 320×231·가장 큰 글자에서 `Dialog` 본문 스크롤 초점과 일부 행의 넘침이 열려 있다(components §7-34). 단계 값은 foundations §3.2 원천에서만 바꾼다.

## 대안과 버린 이유

| 대안 | 버린 이유 |
|---|---|
| 웹뷰 줌을 켠다 | 실수로 눌러 화면이 깨지고 고정 레이아웃(sticky·열)과 어긋난다(`G-SHELL-H3`) |
| 연속 슬라이더 | 검증할 조합이 무한이다. 단계마다 갤러리로 본다 |
| 두 단계(기본·크게)만 | ×2.0(WCAG 200%)을 설정으로 만족하지 못한다 |
