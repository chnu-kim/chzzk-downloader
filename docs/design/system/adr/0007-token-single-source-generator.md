# 0007 토큰 단일 원천과 생성기

상태: 채택(잠정)   날짜: 2026-10-09   관련: D3, D4, D7, foundations 머리·§13, governance §1

## 맥락

앱 토큰은 `app/src/styles/tokens.css`(216줄, 손으로 쓴 CSS)이고 Worker 토큰은 `worker/src/http/site-css.ts`(43줄, TS 문자열 안의 CSS)다. 둘은 **이름부터 다르다**(`--fg-muted`/`--muted`, `--border`/`--line`, `--surface`/`--box`, `--danger`/`--warn`)(`A-WORKER` §0, brief D3 쟁점). 다크 블록은 `@media`와 `[data-theme]` 두 selector에 **손으로 두 번** 적혀 있고, `tokens.test.ts`가 둘이 같은지 검사해야 했다. 사용자 결정 3 "앱과 Worker는 한 시스템"은 토큰이 한 원천이어야 성립한다.

이 저장소는 이미 "원천 → 생성기 → 커밋된 생성물 + `--check`" 패턴을 두 번 쓰고 있다: `scripts/fixtures/gen-fixtures.mjs --check`(testdata fixture, `fixtures` gate)와 ts-rs bindings(`UPDATE_BINDINGS=1 cargo test -p chzzk-shell --test bindings`).

## 결정

1. 원천은 **DTCG Format Module 2025.10의 부분집합** JSON, `design/tokens/*.tokens.json`(governance §1.2가 허용 목록을 정한다. 부분집합 밖은 생성기가 거부).
2. 생성기 `scripts/design/tokens.mjs`(Node 표준 모듈만, 의존성 0)가 `app/src/styles/tokens.css`와 `worker/src/http/tokens.css.ts`를 만들고 둘을 **커밋**한다. `--check`는 바이트 비교다.
3. 두 생성물은 `data-text-scale` 블록(앱만)과 `data-scale="reading"` 블록(Worker만)을 뺀 나머지가 **바이트까지 같다**. Worker는 부분집합이 아니라 같은 파일을 쓴다(brief §6.2-1을 이렇게 해석: a-worker가 제안한 "공유 안"의 가장 단순한 형태).
4. 층은 ref → sys 둘, comp 층은 비운다. 다크는 생성기가 두 selector 블록에 같은 내용을 쓴다(손으로 쓰지 않는다).
5. 색은 OKLCH로 설계하고 **hex를 커밋**한다. 원천의 색 객체에 `components`(oklch)와 `hex`를 함께 두고 생성기가 ±1/255 일치를 검사한다.
6. 문서 패리티: `foundations.md` §13 코드 블록 = 생성물의 토큰 사전(`design-tokens T14).

## 근거

| # | 주장 | 등급 | 출처 | 표본·날짜 |
|---|---|---|---|---|
| 1 | 앱·Worker 토큰 이름이 다르고 다크 블록이 중복이다 | E1 | `A-WORKER` §0, brief D3 쟁점, `J-F-A5` | 실측 2026-10-09 |
| 2 | DTCG 2025.10은 2025-10-28 발표된 첫 안정판("프로덕션 준비"). W3C 표준 트랙은 아니다(Community Group 보고서) | E0 | https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/ , https://www.designtokens.org/tr/2025.10/ | tokens §1 |
| 3 | Style Dictionary v4는 2025.10 전체를 지원하지 않는다(v5 진행 중). 도구를 들이면 버전 고정·업그레이드 비용이 생긴다 | E0 | https://styledictionary.com/info/dtcg/ | tokens §1 |
| 4 | 자체 변환기는 50~100줄이면 된다(토큰 약 90개, 타입 8종, 블록 7종) | E1 | brief D3 선택지 A | — |
| 5 | 생성기 + `--check` 패턴의 선례 둘이 저장소에 있다 | E1 | `scripts/fixtures/gen-fixtures.mjs`, `crates/shell/tests/bindings.rs` | — |
| 6 | 2025.10에서 색 `$value`는 hex 문자열이 아니라 색 객체다(옛 초안 예제를 베끼면 도구가 거부) | E0 | tokens §1.2 주의 | — |
| 7 | OKLCH 설계 → hex 커밋: `oklch()`는 하한(Safari 16.4) 안이지만 생성물에 hex를 두면 검사(대비·C1)가 한 색 공간에서 끝난다 | E1 | brief §6.1-3, `G-ENGINE-R4` | — |
| 8 | 세 후보 모두 "DTCG JSON → 변환기 → tokens.css 커밋 + --check"로 수렴했다 | E1 | judgment §2.4 D3`(C 구조 + A 2층) | — |

최고 등급: E1 / 결정 영향: 중간(구조) / 판정: 채택(잠정)

## 결과

- governance §1(파이프라인)·§2.2(`design-tokens T1~T15)가 이 결정의 구현 명세다.
- `app/src/styles/tokens.css`는 생성물이 된다(머리줄 주석 "손으로 고치지 않는다"). `worker/src/http/site-css.ts`는 `tokens.css.ts`(생성물) + `site.css.ts`(컴포넌트 CSS, sys 토큰만)로 나뉜다. `SITE_CSS_HASH` 관례는 생성기가 `TOKENS_CSS_HASH`로 계산한다.
- `tokens.test.ts`(vitest)는 지워지고 검사는 `scripts/design/`으로 옮겨 `lint` 작업에서 pnpm 없이 돈다. `tests.vitest` ratchet 감소 → `RATCHET_LOG.md`.
- 토큰 변경 절차는 governance §1.4(ADR → JSON → 생성 → foundations → gate).
- 부분집합 밖 기능이 필요해지면(예: Resolver로 테마 분리) 이 ADR을 뒤집는 ADR을 쓴다.

### 재검증 조건

- 생성기가 100줄을 크게 넘어 Style Dictionary v5(2025.10 지원 완료 뒤)가 더 단순해지면 도구 도입 ADR. 그때 `tools.json`에 버전 고정.
- 토큰 소비자가 둘(앱·Worker)을 넘어 셋 이상이 되면(예: 문서 사이트) 생성물 모양을 다시 본다.

## 대안과 버린 이유

| 대안 | 버린 이유 |
|---|---|
| B. Style Dictionary v4 | 2025.10 전체 미지원(근거 3). 새 도구 하나 = `tools.json` 고정 + Dependabot + 설정 파일. 토큰 90개에 과하다 |
| C. 손으로 쓴 CSS 하나 + 패리티 테스트(현재 방식 확장) | 다크 두 블록·앱/Worker 두 파일을 손으로 맞추는 일이 남는다. 대비 쌍·C1 검사가 CSS 파싱에 기대야 한다(JSON이면 구조가 있다) |
| Worker는 부분집합만 | 어느 토큰이 부분집합인지 결정·검사가 하나 더 생긴다. 쓰지 않는 토큰은 미사용 검사(T3)가 Worker 소스 기준으로 잡으므로 "같은 파일"이 더 단순하다 |
| CSS 생성물을 커밋하지 않고 빌드 때 생성 | vite·wrangler 빌드 둘에 생성 단계가 들어가고, `lint` 작업(pnpm 없음)이 생성물을 읽을 수 없다. 커밋하면 diff가 리뷰에 보인다(fixture·bindings와 같은 이유) |
| 토큰 JSON 하나(`design/tokens.json`) | README D3·foundations 머리가 이 이름을 쓴다. 과제 지시는 폴더(`design/tokens/*.json`)다. diff 가독성(색 파일만 바뀜)으로 폴더를 택했고 README·foundations의 경로는 편집 단계에서 맞춘다(governance §11-3) |
