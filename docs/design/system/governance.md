# 강제와 운영 (governance.md)

디자인 시스템 「무색」의 규칙을 **코드가 어떻게 막고, 사람이 어떻게 바꾸는가**를 적는다. `README.md` §4가 강제 수단의 이름(gate 일곱 개와 리뷰 항목 `R1`~`R10`)을 정했고, 이 문서는 그 본문이다: 토큰 파이프라인, gate 하나하나의 명세, 리뷰 체크리스트의 통과 기준, ADR 운영, 컴포넌트 추가 절차, 사용자 시험(D62) 절차, 적용 계획. 소유하는 결정은 D33(과제 등록)·D58~D62다(README §2).

읽는 법:
- 수치와 토큰 이름은 전부 `foundations.md`의 것이다. 이 문서는 새 값을 만들지 않는다. 필요한데 없는 값은 §12 "foundations에 추가 요청"에 적었다.
- 모든 규칙에 (a) 근거와 (b) 강제 수단이 붙는다. 강제 수단이 자동이면 gate 이름, 사람이면 리뷰 항목 번호다. 둘 다 없는 규칙은 적지 않았다. 사람이 보는 항목은 "강제할 수 없다"고 쓰지 않고, **무엇을 PR에 붙여야 통과인지**를 적어 리뷰가 판정할 수 있게 했다.
- 근거는 `docs/research/design-system.md`의 ID로 인용한다(README 머리). `gov`(조사 보고서 governance 약칭)는 ID가 없어 약칭 `gov §…`으로 남겼다. refuted 값은 쓰지 않았다.
- 검사 번호는 gate별 접두로 겹치지 않게 한다: `DT*`(design-tokens) · `DL*`·`DS*`·`DP*`·`DX*`(design-lint의 선언·소스·prop·확장) · `DC*`(design-copy) · `DI*`(design-icons) · `DA*`(adr.test). 어울림 기준 `C1`~`C8`·과업 `UT1`~`UT7`·README 원칙 `P1`~`P5`와 섞이지 않는다(검토 U-18).
- **[잠정]**은 확인되지 않은 값이고 확인 방법을 같은 줄에 적었다. **[취향]**은 출처 없는 선택이다.
- 예시 값(제목·크기·날짜·채널)은 전부 가짜다(`scan` gate).

이 저장소의 CI 원칙(`docs/design/cicd.md` §1)을 그대로 따른다: 훅과 CI는 `node scripts/ci/run.mjs <gate>` 하나로 들어가고, gate는 `scripts/ci/gates.mjs`에 선언하며(`parity`가 워크플로의 `run:`과 대조한다), 새 도구는 `scripts/ci/tools.json`에 버전을 고정하고, 날짜로 실패하는 검사는 두지 않는다. **새 gate 일곱 개는 모두 Node 스크립트만으로 돈다.**(`design-worker`가 Playwright를 쓰지만 그것은 `design-gallery`·`design-shots`가 이미 쓰는 도구이고 worker 쪽에 한 벌 더 설치할 뿐이다, §2.0) stylelint·Style Dictionary 같은 새 도구는 쓰지 않는다(§2.0).

---

## 1. 토큰 파이프라인

### 1.1 흐름

```
design/tokens/*.tokens.json  ─┐                        ┌─► app/src/styles/tokens.css              (커밋)
   (DTCG 2025.10 부분집합)    ├─► scripts/design/tokens.mjs ─┼─► app/src/styles/ui.css                  (커밋)
design/ui.css                 ┘   (생성기, 의존성 0)        └─► worker/src/http/site-css.generated.ts (커밋)
   (ui 컴포넌트 CSS)                   │                          = 토큰 + ui + worker/src/http/site.css(웹 전용 CSS)
                                       └── --check: 저장소의 생성물 셋과 바이트 비교(다르면 1)
```

원천은 `design/tokens/` 폴더의 JSON과 `design/ui.css`(components.md §0.2)이고, 생성기가 생성물 셋을 만들어 **커밋**한다. 훅과 CI는 `--check`로 "저장소의 생성물 = 원천에서 다시 만든 것"을 바이트 단위로 확인한다. 이 모양은 저장소의 기존 생성기 둘과 같다: `scripts/fixtures/gen-fixtures.mjs --check`(fixture, `fixtures` gate)와 `UPDATE_BINDINGS=1 cargo test -p chzzk-shell --test bindings`(ts-rs bindings). 근거: brief D3 권고(선택지 A "DTCG JSON → 자체 변환기 50~100줄"), tokens §1(2025.10이 첫 안정판, Style Dictionary v4는 2025.10 전체를 지원하지 않음), `A-WORKER-0`(앱 `tokens.css` 216줄과 Worker `site-css.ts`가 이름부터 다르다), ADR-0007. 강제: `design-tokens`.
### 1.2 원천 형식: DTCG 2025.10 부분집합

W3C Design Tokens Community Group Format Module **2025.10**(https://www.designtokens.org/tr/2025.10/format/, tokens §1.1)의 부분집합만 쓴다. 전체를 구현하지 않는 이유는 소비자가 생성기 하나뿐이고(Figma·Style Dictionary 연동 계획 없음), 모르는 기능을 받아들이면 생성기가 조용히 틀린 값을 낼 수 있기 때문이다. 생성기는 **부분집합 밖의 키·타입을 만나면 실패한다**(허용 목록 방식).

| 항목 | 쓰는 것 | 쓰지 않는 것 |
|---|---|---|
| 파일 | `design/tokens/{ref,sys,type,space,size,radius,motion,layer,layout,contrast}.tokens.json`. 확장자 `.tokens.json`은 2025.10 규정 | 파일 하나로 합치기(diff가 커진다) |
| 토큰 | `$type`·`$value`·`$description`(필수 셋). `$description`은 foundations 표의 "쓰는 곳" 한 줄 | `$deprecated`, `$extensions` 중 아래 외의 키 |
| 타입 | `color`·`dimension`·`duration`·`cubicBezier`·`fontFamily`·`fontWeight`·`number`·`shadow`. 속성 ↔ `$type` 대응은 foundations §1 표 | `typography`·`border`·`transition`·`gradient`·`strokeStyle` 복합 타입(토큰이 CSS 한 선언과 1:1이어야 `design-lint`가 단순하다. `--progress-tween`은 duration만이고 이징 `linear`는 `ui.css` 글자 상수, foundations §7.1) |
| 색 | 2025.10 색 객체 `{ "colorSpace": "oklch", "components": [L, C, H], "alpha"?, "hex": "#RRGGBB" }`. **커밋되는 값은 `hex`**이고 `components`는 설계 기록이다. 생성기가 oklch → sRGB 변환값과 `hex`가 ±1/255 안인지 확인한다(foundations §2.2 "±1/255 안에서 같다") | `$value`에 hex 문자열만(2022~2024 초안 형식, 2025.10에서 바뀜. tokens §1.2 주의) |
| 별칭 | `"$value": "{sys.color.bg}"` 경로 참조. sys → ref 한 단계만 | 두 단계 이상 사슬, ref → ref |
| 테마 | 다크 값은 같은 토큰의 `$extensions["io.github.chnu-kim.chzzk"].dark`에 `{…}` 참조로. 생성기가 다크 두 selector 블록을 **같은 내용으로** 쓴다(foundations §10) | Resolver 모듈(2025.10의 세 모듈 중 하나. 생성기 하나에 과하다) |
| 미디어 블록 | `prefers-contrast: more`·`any-pointer: coarse`·`prefers-reduced-motion: reduce`·`data-text-scale`(배율 1.3·2.0에서 foundations §3.2 유도 규칙으로 생성)·`data-scale="reading"`·`data-window-active` 재정의는 같은 확장 키 아래 `overrides.<블록 이름>`에. selector는 전부 `:root:where(…)`(foundations §10)이고 블록 이름과 selector 표·순서는 생성기 상수 | 토큰 파일에 selector 문자열 직접 쓰기 |
| 상수 | `BREAKPOINT_NARROW`(600, foundations §14)는 `layout.tokens.json`의 `$type: "number"` 토큰이되 CSS 변수로 **내보내지 않고** 생성기가 `@media (max-width: 599px)` 글자를 만드는 데만 쓴다. 그 밖의 §14 상수는 `design/tokens/`가 아니라 `app/src/lib/timing.ts`·Rust `consts.rs`에 있고 DT15가 표와 대조한다 | — |
| 대비 쌍 | `contrast.tokens.json`: `[전경, 바탕, 최소]` 목록(foundations §2.4의 라이트 46쌍·다크 46쌍). 토큰은 아니지만 같은 폴더에 두어 `design-tokens`가 한 곳에서 읽는다 | 테스트 코드에 쌍 목록 하드코딩(기존 `tokens.test.ts` 방식) |

이름은 foundations §1의 정규식을 따른다. JSON 경로 `sys.color.fg-muted` → CSS `--fg-muted`, `ref.gray.965` → `--ref-gray-965`. 생성기가 경로 → CSS 이름 변환 규칙 하나를 갖고, 바꾸면 ADR이다(§4.1 조건 1).

### 1.3 생성기 `scripts/design/tokens.mjs`

| 항목 | 규칙 | 근거·강제 |
|---|---|---|
| 의존성 | Node 표준 모듈만(`node:fs`·`node:path`). oklch → sRGB 변환은 CSS Color 4 행렬을 직접 구현(약 40줄) | `scripts/ci/*`와 같은 원칙(의존성 0). 강제 `scripts-test`(`tokens.test.mjs`가 변환 골든 33색을 본다. 골든은 foundations §2.2 표의 알파 아닌 ref) |
| 결정성 | 출력 순서는 foundations §13의 절 순서로 고정(ref → sys 색 → 글꼴 → 간격 → 반경 → 크기 → 레이아웃 → 모션 → 층 → 다크 두 블록 → 비활성 창 → reading → text-scale → contrast → coarse → reduce → (앱만) legacy 별칭). LF, 끝 줄바꿈 하나, 들여쓰기 두 칸, 소수는 입력 그대로 | `--check`가 바이트 비교라 포맷이 흔들리면 안 된다. 강제 `design-tokens`(두 번 생성해 같은지) |
| 생성물 셋 | `app/src/styles/tokens.css`(+ `data-text-scale` 블록, 단계 (a)~(c)의 `/* legacy */` 별칭 블록), `app/src/styles/ui.css`(= `design/ui.css`), `worker/src/http/site-css.generated.ts`(토큰 구간은 `data-scale="reading"` 블록 포함, 그 뒤 ui 구간, 그 뒤 `worker/src/http/site.css`). 토큰 구간의 공통 부분은 앱·Worker에서 **바이트까지 같다**(foundations §13 끝) | brief §6.2-1(한 원천), `A-WORKER-0`. 강제 `design-tokens` DT1(공통 구간을 잘라 비교) |
| Worker 생성물 모양 | `export const SITE_CSS = \`…\`; export const SITE_CSS_HASH = "<sha256 앞 16자리>";` 기존 `site-css.ts`의 `SITE_CSS_HASH`·불변 캐시 경로 관례(worker.md 구현 중 변경 38 (마))를 따른다. 해시는 생성기가 계산한다 | 손으로 해시를 고치는 일이 사라진다. 강제 `worker`(기존 `site-css.test.ts`가 해시 기대값을 확인하는 방식 그대로) |
| 쓰기 | 인자 없이 돌리면 생성물 셋을 쓴다. `--check`는 쓰지 않고 비교만. 생성물 머리줄에 `/* 생성물. 원천 design/tokens/·design/ui.css, 생성기 scripts/design/tokens.mjs. 손으로 고치지 않는다 */` | `gen-fixtures.mjs`와 같은 두 모드. 강제 `design-tokens` |
| 문서 패리티 | `--check`가 `foundations.md` §13 코드 블록을 읽어 **토큰 이름 → 값 사전**을 만들고 생성물의 사전과 비교한다(바이트 비교가 아니다: §13은 다크를 한 번만 적었다). §14 상수 표는 `timing.ts`·`consts.rs`의 `pub const`/`export const`와 비교한다. 다르면 어긋난 이름을 찍는다 | README §2 소유권 규칙. 강제 `design-tokens` DT14·DT15 |

### 1.4 바꾸는 절차

1. ADR을 쓴다(§4.1 조건 1: `design/tokens/` diff가 있으면 ADR 필수. `R2`).
2. `design/tokens/*.tokens.json`을 고친다.
3. `node scripts/design/tokens.mjs`로 생성물 둘을 다시 만든다.
4. `foundations.md`의 해당 표와 §13 블록(상수면 §14 표)을 같은 값으로 고친다(패리티가 셋의 일치를 본다). 다른 문서가 그 토큰 옆에 값을 적었으면 `spec-check.mjs`(§2.9 DX23)가 잡는다.
5. `node scripts/ci/run.mjs design-tokens`가 0이면 커밋한다. 훅(`pre-commit`)이 `design/`·`scripts/design/`·생성물 경로가 바뀌면 같은 gate를 돈다.

생성물을 손으로 고친 커밋은 `--check`에서 바로 걸린다(원천과 달라진다).

---

## 2. gate 명세

### 2.0 공통

- 일곱 gate의 이름·검사 항목·자리는 README §4.1 표가 정했다. 여기서는 **구현 단위(스크립트·단계)와 판정, CI 작업, 훅, selftest 씨앗, ratchet 영향**을 적는다.
- **도구를 더하지 않는다.** stylelint를 쓰지 않는다. 이유: (1) `.svelte` `<style>`을 stylelint가 읽는 구성(`postcss-html`)이 **[미확인]**이다(gov §8.1·§11), (2) 검사 대상이 `design/ui.css`·`app/src/**/*.svelte`·`worker/src/http/site.css`로 작다, (3) 정규식 금지 목록은 stylelint의 `declaration-property-value-disallowed-list`도 결국 정규식이다. 선언 단위 파서(약 80줄: `<style>` 블록 추출 → 주석 제거 → 규칙 → 선언 분해)를 `scripts/design/css.mjs`에 한 번 쓰고 `design-lint`·`design-tokens`가 같이 쓴다(README §4.1도 그렇게 적는다).
- 스크립트는 `scripts/design/`에 둔다(`scripts/ci/`는 CI 기반 시설, `scripts/fixtures/`는 fixture 생성기라는 기존 구분을 따른다). 각 스크립트의 테스트 `scripts/design/*.test.mjs`는 기존 `scripts-test` gate(`testFiles()`가 `scripts/` 아래를 전부 훑는다)에 자동으로 들어간다.
- 판정은 종료 코드다. 위반은 `file:line: 규칙 이름: 내용` 한 줄 형식으로 찍고 GitHub Actions에서는 `::error file=…,line=…::`로 주석을 단다(기존 `public-scan.mjs` 출력 형식).
- 모든 금지 규칙에는 **허용 목록 파일**이 있다(`scripts/design/allow.json`). 항목마다 `{ "rule", "file", "pattern", "reason", "adr"? }`를 적는다. 이유 없는 항목은 `scripts-test`의 `allow.test.mjs`가 거부한다. 허용 목록을 늘리는 PR은 `R1`(스크린샷)과 함께 이유를 적는다.
- 새 gate마다 `scripts/ci/selftest.mjs`에 씨앗 두 줄(깨끗 → 0, 위반 → 0 아님)을 더한다(cicd.md §2 `selftest`). selftest는 임시 저장소에 `scripts/ci`·설정·ci.yml을 복사하므로, 디자인 gate가 읽는 `design/`·`app/src/lib/components/ui`·`app/src/lib/copy`·`worker/src/http`의 **최소 사본**도 복사 목록에 더한다.
- `parity`가 요구하는 등록: `gates.mjs GATES`에 gate, ci.yml의 `run:` 줄, 새 CI 작업이면 `CODE_GATED_JOBS`(작업 id → 영역) 또는 `OBSERVED_JOBS`(작업 id → 영역 또는 `'master'`)와 그에 맞는 작업 `if:`(`areaIf('<영역>')` = `needs.changes.outputs.<영역> == 'true'`, parity `job-if`), `HOOKS`의 `when`, 그리고 `ci-ok`의 `needs`·guard(`parity ciOkGuard()`가 영역마다 절 하나로 만든 순서). 옛 `CODE_IF`(`changes` 작업의 `code` 출력)는 없어졌다(`cicd.md` 구현 중 변경 110, `worker.md` 91).
- **PR 영역(app·worker)**: `ci.yml` `changes` 작업은 `gates.mjs AREAS` 순서로 `app`·`worker` 두 출력을 낸다(`run.mjs classify`, parity `changes-outputs`). 영역마다 `AREA_SKIP`이 "그 영역의 작업이 읽지 않는 경로"를 적고, 바뀐 파일이 하나라도 그 목록 밖이면 그 영역이 켜진다. 문서(`NON_CODE`: `docs/**`·루트 `*.md` 등)와 `scripts/**/*.test.mjs`는 두 영역 모두 끈다(`LINT_ONLY`). 이 시스템은 **새 영역을 만들지 않는다**(만들면 `changes` 출력·`ciOkGuard`·`scope.test.mjs`가 함께 바뀐다). 새 gate의 영역:
  - `design-tokens`·`design-lint`·`design-copy`·`design-icons`: 기존 `lint` 작업 안이다. `lint`는 **영역과 무관하게 늘 돈다**(`CODE_GATED_JOBS`에 없다). 그래서 `docs/design/system/content.md`·`foundations.md`만 바뀐 PR(두 영역 모두 꺼짐)에서도 문서 패리티(DT14·DT15·DC10)가 돈다.
  - `design-gallery`: `e2e-web` 작업 안이므로 **app** 영역(`OBSERVED_JOBS['e2e-web'] = 'app'`). 앱 화면만 찍는다.
  - `design-shots`: 새 작업이고 **app** 영역(`if: areaIf('app')`, `OBSERVED_JOBS['design-shots'] = 'app'`, 편입하면 `CODE_GATED_JOBS['design-shots'] = 'app'`). 앱 화면만 찍는다.
  - `design-worker`: 새 작업이고 **worker** 영역(`if: areaIf('worker')`, `OBSERVED_JOBS['design-worker'] = 'worker'`, 편입하면 `CODE_GATED_JOBS['design-worker'] = 'worker'`). Worker 정적 HTML의 갤러리 검사와 스냅샷을 맡는다(아래 영역 공백).
  - 기존 gate에 더하는 검사(§2.8): `frontend`·`rust`·`tauri`·`release-hygiene`은 app, `worker`(골격 검사·`help-check`)는 worker 영역이다.
  - 새 경로 `design/`·`scripts/design/`(테스트 파일 제외)은 어느 `AREA_SKIP`에도 없으므로 바뀌면 **두 영역을 모두 켠다**. 생성물이 `app/`과 `worker/` 양쪽에 있고 format 골든(`design/format/*.json`)을 `frontend`·`rust`·`worker`가 함께 읽으므로 이것이 맞는 기본값이다. 좁히려면 `scope.test.mjs`의 읽기 그래프 근거가 필요하다.
  - **영역 공백 — 결정(2026-10-10 사용자): (나) Worker 정적 HTML 촬영을 worker 영역 작업으로 옮긴다.** `design-gallery`·`design-shots`가 Worker 정적 HTML도 찍으면(§2.6) `AREA_SKIP.app`이 `worker/**`(`wrangler.jsonc`·`test/vectors/` 밖)를 건너뛰므로 `worker/src/http/`만 바뀐 PR에서는 app 영역이 꺼져 Worker 페이지의 갤러리·기준선 비교가 돌지 않는다. 그래서 Worker 몫을 새 gate `design-worker`로 떼어 worker 영역 작업 `design-worker`에서 돌린다(`worker-e2e`처럼 따로). 구성: worker 쪽에 Playwright 설치(`worker/`는 독립 pnpm 루트라 자기 lockfile에 devDependency), `scripts/ci/tools.json`에 `playwright` 버전 고정(app과 같은 버전을 쓰고 Dependabot이 둘을 함께 올린다), `OBSERVED_JOBS`에 `'design-worker': 'worker'`로 등록(D14 관찰, 편입은 `design-shots`와 같은 14일 뒤 판단). 자세한 명세는 §2.6b. 기각한 (가) `AREA_SKIP.app`에 `worker/src/http/` 예외를 두는 안은 Worker 페이지만 바뀐 PR에서도 app 전체(`frontend`·`rust`·`tauri`·`e2e-web` 등)가 돌아 영역 스코프의 이득을 잃기 때문에 쓰지 않는다.

### 2.1 요약표

| gate | 스크립트 | CI 작업 | 훅 | `ci-ok` | 처음 상태 |
|---|---|---|---|---|---|
| `design-tokens` | `scripts/design/tokens.mjs --check` + `scripts/design/check-tokens.mjs` | `lint`(ubuntu, 늘 돈다) | pre-commit, 경로 `design/`·`scripts/design/`·`app/src/styles/tokens.css`·`app/src/styles/ui.css`·`worker/src/http/site-css.generated.ts`·`docs/design/system/foundations.md`·`app/src/lib/timing.ts`·`crates/shell/src/consts.rs` | 필수 | 필수(단계 (a)부터) |
| `design-lint` | `scripts/design/lint.mjs` | `lint` | pre-commit, 경로 `app/src/`(src-tauri 제외)·`worker/src/http/` | 필수 | 필수. 단, 단계 (a)에서는 **허용 목록에 현재 위반 전부**를 적고 시작한다(§10 (a)) |
| `design-copy` | `scripts/design/copy.mjs` | `lint` | pre-commit, 경로 `app/src/lib/copy/`·`worker/src/http/copy.ts`·`design/copy/`·`docs/design/system/content.md` | 필수 | 필수(같은 방식) |
| `design-icons` | `scripts/design/icons.mjs`(정적) | `lint` | pre-commit, 경로 `app/src/lib/components/ui/icons.ts`·`worker/src/http/icons.generated.ts`·`licenses/`·`worker/src/http/pages.ts` | 필수 | 필수. 번짐 측정(래스터)은 `design-gallery` 안(§2.5) |
| `design-gallery` | `app/e2e/gallery.spec.ts`(Playwright 프로젝트 `gallery`) + `scripts/design/icons-blur.mjs` | `e2e-web`(기존 작업 안, `playwright test` 뒤) | 없음(무겁다) | `e2e-web` 작업이 편입될 때 함께 | 관찰(D14, `OBSERVED_JOBS 'e2e-web'`과 같은 운명) |
| `design-shots` | `app/e2e/shots.spec.ts`(Playwright 설정 `playwright.shots.config.ts`) | **새 작업 `design-shots`**(ubuntu-24.04, `platforms: ['linux']`) | 없음 | 없음 | 관찰(`OBSERVED_JOBS 'design-shots': 'app'`), 편입은 D14 14일 뒤 판단 |
| `design-worker` | `worker/e2e/gallery.spec.ts`·`worker/e2e/shots.spec.ts`(Playwright 설정 `worker/playwright.config.ts`, §2.6b) | **새 작업 `design-worker`**(ubuntu-24.04, worker 영역, `platforms: ['linux']`) | 없음 | 없음 | 관찰(`OBSERVED_JOBS 'design-worker': 'worker'`), 편입은 D14 14일 뒤 판단 |

`lint` 작업은 pnpm을 설치하지 않는다. 그래서 네 gate는 `node_modules` 없이 **파일만 읽어** 판정한다(`needs: []`). 생성물 `tokens.css`가 커밋되어 있어 `design-lint`의 "정의되지 않은 var" 검사도 설치 없이 된다.

### 2.2 `design-tokens`

단계 둘: `tokens.mjs --check`(§1.3) → `check-tokens.mjs`(아래 표). 둘 다 `design/tokens/`·`design/ui.css`와 생성물을 읽는다.

| # | 검사 | 판정 | 근거 |
|---|---|---|---|
| DT1 | 생성물 셋 바이트 동일, 앱·Worker 토큰 구간의 공통 부분 동일, ui 구간 동일 | `--check` 1 | §1.3 |
| DT2 | 미정의 토큰 0: `app/src/**/*.{svelte,css}`·`design/ui.css`·`worker/src/http/*.{ts,css}`의 모든 `var(--x)`의 `x`가 생성물에 정의됨(예외: 컴포넌트 상태 변수 `--p` 하나, components.md) | 목록 출력, 1 | brief §6.2-3, foundations 머리 "여기 없는 값을 쓰면 막는다" |
| DT3 | 미사용 토큰 0: 생성물의 모든 `--x`가 소스 어디선가 `var(--x)`로 쓰임(ref 토큰은 sys 별칭으로 쓰이면 사용으로 센다. `--text-hero`는 Worker 생성물에만 있으므로 Worker 소스에서 찾는다. 앱 생성물 끝의 `/* legacy */` 별칭 블록은 단계 (c)까지 검사에서 뺀다, foundations §12-18) | 1 | brief §6.2-3, foundations §4 "미사용 토큰 0개 원칙" |
| DT4 | 단위: 모든 `dimension`이 `px`, `rem`·`em` 0개, `html { font-size: 16px }`가 `app/src/app.css`·Worker `site.css`에 있음(DL5의 예외로 등록) | 1 | D4, `A-VIS-01`, ADR-0002 |
| DT5 | 글자: 모든 `--text-*` ≥ 12, 모든 `--leading-*` 정수 px, `--weight-*`는 400·600 둘뿐 | 1 | foundations §3.2·§3.4 |
| DT6 | 값 집합: `--space-*`는 {2,4,6,8,12,16,20,24,32,40}, `--radius-*`는 {4,6,10,12,999}, `--control-h*`·`--row-h`·`--toolbar-h`·`--hit-min`은 foundations §5.1 표(마우스·coarse 둘 다) | 1 | foundations §4·§5.1·§6.1 |
| DT7 | 이름: 속성 자리가 foundations §1 표의 허용 값이고 `$type`과 대응하며, 값 이름 토큰은 이름 = 값(`--space-8` = 8px), ref는 `gray` ×1000 / 유채색 ×100 규칙, 전체 이름 집합이 §13과 같다(legacy 블록 제외) | 1 | foundations §1 규칙 1~3 |
| DT8 | 대비: `contrast.tokens.json`의 쌍 전부를 WCAG 2.x 상대 휘도로 다시 계산(라이트·다크), 알파 색은 바탕과 합성한 뒤 계산. 쌍 수가 줄면 ADR 번호가 PR 본문에 있어야 한다(→ 사람, `R2`) | 하나라도 미달 1 | foundations §2.4(92쌍 PASS). 계산 함수는 기존 `tokens.test.ts`의 `luminance`·`contrast`를 옮긴다 |
| DT9 | C1: 모든 색 토큰을 HSL로 바꿔 H 140~170°이면서 S ≥ 70%인 색 0개(경계 포함), `gray-*`는 S = 0 | 1 | foundations §2.1·§2.6(C1) |
| DT10 | 다크: `@media (prefers-color-scheme: dark) :root:where(:not([data-theme="light"]))` 블록과 `:root:where([data-theme="dark"])` 블록의 선언이 같음, 라이트 색 토큰 중 다크에 없는 것은 `--on-accent`·`--focus`(값이 같다)뿐, 다크 `--bg`·`--surface`·`--raised`·`--surface-2`·`--surface-pressed`의 OKLCH L ≥ 0.24(순흑 없음) | 1 | foundations §10, D9. 기존 `tokens.test.ts` "다크 두 블록은 같은 값이다" 승계 |
| DT11 | 블록 값: reduce 블록이 `--motion-base`·`--motion-slow`·`--progress-tween`을 1ms로, `--motion-fast`·`--motion-spin`은 건드리지 않음. coarse 블록 값 = §5.1 터치 열. contrast 블록이 `--fg-muted`·`--separator`·`--border-strong`을 `var(--fg)`로. text-scale 블록이 foundations §3.2 유도 규칙과 같음 | 1 | foundations §7.1·§5.1·§2.5·§3.2 |
| DT12 | 글꼴: `--font-sans`가 `system-ui`로 시작, 생성물·`app.css`·Worker CSS에 `@font-face`·`url(`·`@import` 0개 | 1 | 사용자 결정 2, foundations §3.1. 기존 "번들 글꼴 없음" 승계 |
| DT13 | 층: `--z-*` 각각이 소스에서 **정확히 한 컴포넌트 파일**에서만 쓰임(`--z-sticky`는 입력줄) | 1 | foundations §7.2 "층마다 주인 하나" |
| DT14 | 문서 패리티: foundations §13 사전 = 생성물 사전 | 어긋난 이름 출력, 1 | §1.3 |
| DT15 | 상수 패리티: foundations §14 표의 이름·값 = `app/src/lib/timing.ts`·`crates/shell/src/consts.rs`의 상수. 표에 없는 상수가 두 파일에 있으면 실패 | 1 | foundations §14 |
| DT16 | 계산값: 생성물을 jsdom 없이 캐스케이드 시뮬레이션(selector 특이도 전부 (0,1,0)이라 소스 순서만 본다)해 다크 + `prefers-contrast: more`에서 `--fg-muted` = `--fg`, 비활성 창에서 `--accent-soft` = `--surface-2`, hover 면 ≠ pressed 면(`--surface-2` ≠ `--surface-pressed`, 두 테마) | 1 | foundations §2.5·§10·§12-11, 검토 P1-2·P1-15 |
| DT17 | 성공색 없음: 이름에 `success`가 든 토큰 0개(ADR-0004가 뒤집히면 이 검사를 ADR 번호와 함께 지운다), 이름에 `info`가 든 색 토큰 0개 | 1 | D10, ADR-0004 |

기존 `app/src/styles/tokens.test.ts`(vitest)는 단계 (a)에서 지운다. 같은 검사가 DT8·DT10·DT11·DT12로 옮겨 가고 Worker까지 덮는다. **ratchet 영향**: `tests.vitest`가 그 파일의 테스트 수만큼 내려간다 → 같은 PR에서 `ci/RATCHET_LOG.md`에 `tests.vitest` 줄을 더한다(cicd.md §4.2 규칙. "node --test로 옮겼고 `scripts-test`가 센다"가 이유).

### 2.3 `design-lint`

하나의 스크립트가 네 종류를 본다: (가) CSS 선언 검사 `DL*`, (나) 소스 스캔 `DS*`, (다) prop 어휘 `DP*`, (라) 확장 검사 `DX*`(§2.9). 대상은 `design/ui.css`, `app/src/**/*.svelte`(`<style>`과 마크업), `app/src/**/*.css`·`*.ts`, `worker/src/http/*.ts`(백틱 문자열 안의 HTML)·`worker/src/http/site.css`. 테스트 파일(`*.test.ts`)·`bindings/`·`e2e/mock/`·생성물은 제외한다.

**(가) CSS 선언 검사** — 선언 `속성: 값`마다:

| # | 규칙 | 허용 | 근거 |
|---|---|---|---|
| DL1 | 색 리터럴 금지: `#…`, `rgb(`, `rgba(`, `hsl(`, `oklch(`, 색 이름(`white`·`black`·`red` 등 CSS 명명 색 148개), `transparent`는 허용 | 생성물 `tokens.css`만 | brief §6.2-2, `A-LIT-*` |
| DL2 | 길이 리터럴 금지: `\d+px`. `calc()`는 피연산자가 토큰·`0px`·`100%`·정수 계수뿐일 때만(foundations §4 정책. `calc(100% - 20px)` 금지, `calc(0px - var(--space-6))` 허용) | `0`·`0px`, `1px`·`2px`(선 굵기, `border*`·`outline*`과 라디오 고리 `inset 0 0 0 4px var(--surface)`에서만), `50%`·`100%` | foundations §4 "예외"·`calc()` 정책, §6.2(선은 1·2px만) |
| DL3 | 시간 리터럴 금지: `\d+m?s` | — (`var(--motion-*)`·`var(--progress-tween)`만. `linear`·`infinite` 글자는 허용) | foundations §7.1 |
| DL4 | `z-index` 값은 `var(--z-*)`만 | — | foundations §7.2 |
| DL5 | `font-size`·`font-weight`·`line-height`·`border-radius`·`letter-spacing`·`font-family` 값은 `var(--…)`만. `letter-spacing`·`-webkit-font-smoothing` 선언 자체 금지. `line-height: normal` 금지(네이티브 `<select>`도 `var(--leading-body)`) | `font-family`는 `var(--font-sans)`·`var(--font-mono)`, `html { font-size: 16px }`(`app.css`·`site.css`, DT4) | foundations §3.4·§3.5(`E-KO-B7`, `E-DESK-E33`) |
| DL6 | `--ref-*` 직접 사용 금지(컴포넌트는 sys만) | 생성물 | foundations §1 규칙 3 |
| DL7 | 컴포넌트 안 `--` 선언 금지 | `--p` 하나(components.md §2.20) | foundations 머리(comp 층 비움) |
| DL8 | `!important`, `transition: all`, `outline: none`·`outline: 0`(예외 `[data-focus-container]:focus-visible` 한 규칙), `forced-color-adjust`, `backdrop-filter`, `text-wrap`, `break-word`, `text-align: justify`, `cursor: pointer`(앱 소스만. Worker `site.css`는 허용) | — | foundations §11 표, D25, components §0.3 |
| DL9 | `:focus-visible`·`:focus` 규칙 안의 `box-shadow` 금지, `box-shadow` 값은 `var(--shadow-*)` 또는 `inset 0 0 0 4px var(--surface)`(라디오 고리)만 | — | foundations §6.2·§6.4, D20 |
| DL10 | 하한 밖 기능: `light-dark(`, `linear(`, `@starting-style`, `view-transition`, `scrollbar-gutter`, `scrollbar-width`, `accent-color`, `field-sizing`, `popover`(속성), `from ` 상대 색 문법, `@scope`, `anchor-name`, `interpolate-size`, `corner-shape`, `::-webkit-scrollbar`, `AccentColor` 키워드 | — | foundations §11, D1·D8 |
| DL11 | `calc(… - 1px)`·`calc(… + 1px)`, `translate(-50%`, 정지 상태 글자 요소의 `transform`(selector에 `:active`·`:hover`·`[open]`·`[aria-expanded="true"]` 같은 의사 클래스·속성 상태가 없고 선언에 `transform`이 있으면). `ui.css` selector에 상태 클래스(`.is-`·`.active`·`.open`) 금지 | 진행 막대 `scaleX`, Disclosure `[open]` 화살표 회전, Spinner | foundations §6.2 금지 행(`G-SCALE-*`), components §0.2 |
| DL12 | `:hover` 규칙이 `display`·`visibility`·`opacity`·`width`·`height`·`min-*`·`max-*`를 바꾸지 않음(`G-INPUT-IN1`) | — | D21 |
| DL13 | 컴포넌트 CSS 안 `@media (pointer`·`(hover`·`(any-pointer`·`(width`·`(min-width`·`(max-width` 금지. 폭 쿼리는 허용 파일(앱 `app/src/styles/tokens.css`·`app/src/styles/layout.css`, Worker `worker/src/http/site.css`·생성물)만. `layout.css`의 `@media (max-width: 599px)` 블록과 `:root[data-text-scale="x-large"]` 접두 블록은 선언이 같아야 한다(foundations §8) | 허용 파일 | foundations §5.1(`G-INPUT-IN5`·`G-INPUT-IN6`)·§8 |
| DL14 | 선 굵기: `border*`·`outline*`의 길이는 `1px`·`2px`·`0`만(`0.5px`·`1.5px`·`3px` 금지). 예외: `--icon-stroke: 1.5px` 정의(생성물) | — | foundations §6.2·§9 |

**(나) 소스 스캔** — 마크업·스크립트:

| # | 규칙 | 허용 | 근거 |
|---|---|---|---|
| DS1 | 원시 요소 금지: `app/src/lib/components/ui/` 밖에서 `<button`·`<input`·`<select`·`<textarea`·`<dialog`·`<progress`·`role="dialog"`·`role="switch"`·`role="menu"`·`role="alert"`. Spinner에 `role`·`aria-label` 금지 | `ui/` 안, 허용 목록(이유 필수) | gov §8.5, README §4.1, components §2.12·§2.21 |
| DS2 | 인라인 `style=` 속성 금지(`.svelte`·Worker HTML 템플릿 둘 다). 진행 막대는 Svelte `style:--p={…}` **디렉티브**만 허용(속성 문자열 `style="--p: …"`는 앱 CSP `style-src 'self'`에 막힌다) | `style:--p` 디렉티브 하나(components.md §2.20) | Worker CSP(brief §2.2), `J-F-A3`·`J-F-C4` |
| DS3 | `:global(` 금지 | `app/src/app.css`(전역 리셋 한 파일) | 컴포넌트 스타일이 밖으로 새지 않게(gov §8.5의 "컴포넌트 우회"). `app.css`만 전역이다 |
| DS4 | `{@html` 금지 | — | foundations §3.5(`G-UGT-R7`) |
| DS5 | `<svg` 직접 사용 금지(아이콘은 `<Icon name>`) | `ui/Icon.svelte` | foundations §9, `design-icons`와 짝 |
| DS6 | `.svelte` 안 한글 리터럴 금지(마크업 텍스트·속성 값·스크립트 문자열). 문구는 `app/src/lib/copy/ko.ts`에서만. 템플릿 안 `aria-label={`…`}` 리터럴 조합·`·` 조각 결합·`join(', ')` 금지(조각 결합도 deck 함수) | `copy/`, 테스트 | brief §3.5, D44, content.md §6.5·§10 |
| DS7 | `title=` 속성은 허용 목록(`G-INPUT-IN2`: 말줄임된 제목의 전체 글자, 아이콘 버튼의 툴팁, 바이트 원값)만 | 허용 목록 | foundations §3.5 |
| DS8 | `cursor: pointer`가 앱 소스에 없음(DL8과 같은 규칙, 마크업 `style`까지) | Worker | D25 |
| DS9 | Worker: `worker/src/http/*.ts`의 HTML 템플릿에 `<style`·`style=`·`<script`·`onclick=` 0개(기존 `worker-config.mjs` 검사와 중복이지만 같은 출력 형식으로 한 번 더 본다. 중복 이유: `worker-config`는 `worker` gate라 `lint` 작업에서는 돌지 않는다) | — | brief §2.2, worker.md 구현 중 변경 39 |

**(다) prop 어휘** — `app/src/lib/components/ui/vocab.ts`가 유일한 원천이다:

```ts
export const BUTTON_VARIANT = ['primary', 'secondary', 'ghost'] as const;
export const NOTICE_VARIANT = ['inline', 'banner', 'row', 'toast'] as const;
export const TONE = ['neutral', 'info', 'warning', 'danger'] as const;   // 컴포넌트는 부분집합을 타입으로
export const SIZE = ['sm', 'md', 'lg'] as const;
export const KIND = ['vod', 'clip', 'rewind', 'adult'] as const;          // Badge만
export const PROGRESS_STATE = ['active', 'paused', 'failed', 'waiting'] as const;   // ProgressBar만
export const BOOLEAN_PROPS = ['disabled', 'open', 'loading', 'required', 'readonly', 'invalid'] as const;
export const ICON_BUTTON_ICONS = ['x', 'ellipsis', 'chevron-down', 'chevron-up', 'chevron-left', 'chevron-right', 'eye', 'eye-off', 'arrow-left', 'settings'] as const;   // foundations §9 표와 같다
```

| # | 규칙 | 근거 |
|---|---|---|
| DP1 | `.svelte` 사용처의 `variant="…"`·`tone="…"`·`size="…"`·`kind="…"`·`state="…"` 글자 값이 `vocab.ts` 배열 안에 있다(동적 값 `{…}`은 타입이 막는다: 컴포넌트 prop 타입은 `(typeof TONE)[number]`의 부분집합) | D35, gov §3.3 |
| DP2 | `ui/` 컴포넌트의 `$props()` 선언에서 불리언 prop은 `BOOLEAN_PROPS`만(`disabled`·`open`·`loading`·`required`·`readonly`·`invalid`). 그 밖의 `: boolean`(`checked`·`inert`·`primary`·`small` 등)은 실패 | D35, gov §3.3 규칙 1 |
| DP3 | 이벤트 prop은 `on` + 소문자 동사 하나(`onclose`·`onchange`·`onclick`). 같은 뜻의 이벤트 둘(`onclose`+`ondismiss`) 금지 | gov §3.3 규칙 2, `A-PRIM-N6`(닫기 이벤트 2종) |
| DP4 | `IconButton`의 `label` prop은 필수 타입(`label: string`, `?` 없음), 입력류·ProgressBar·Menu는 `NameProps`(label 또는 labelledby 정확히 하나). 스캔은 `?`의 유무를 본다. 사용처는 svelte-check가 막는다 | D35(접근 이름 필수), `frontend` gate와 이중 |
| DP5 | `IconButton`의 `icon` 값은 `ICON_BUTTON_ICONS`(foundations §9 표의 10개)만. `vocab.ts`와 foundations §9 표의 패리티는 `spec-check.mjs`(DX23) | foundations §9 |

**단계 (a)에서의 시작 상태**: 현재 코드는 이 규칙을 거의 모두 어긴다(`A-LIT-*`: px 리터럴 107건 등). `design-lint`를 처음 켤 때 **현재 위반을 `allow.json`에 전부 적어** 0으로 시작하고(파일·규칙·패턴·"단계 (b)/(c)에서 제거"라는 이유), 이후 단계에서 지워 나간다. 허용 목록 항목 수는 `ci/ratchet.json`에 `design.allow_entries`로 두어 **늘면 실패**한다(ratchet의 "나빠지면 실패" 의미 그대로. 처음 값은 CI 측정값, `ratchet.mjs write`). 이렇게 하면 gate가 처음부터 `ci-ok` 필수여도 적용 PR이 막히지 않고, 새 위반은 들어오지 못한다.

### 2.4 `design-copy`

대상: `app/src/lib/copy/ko.ts`·`errors.ts`, `worker/src/http/copy.ts`, 도움말 원천 `help/*.md`. 스크립트가 TS 소스에서 문자열 리터럴(`'…'`·`"…"`·백틱)을 뽑아 각 규칙을 적용한다. 금지어·용어집 비표준 어휘는 `design/copy/terms.json`(기계 원천)에 있고, `content.md` 용어집 표(사람 원천)와 **양방향 패리티**를 본다(표에서 금지 열의 단어가 json에 있고, json의 단어가 표에 있다). "쓰지 않는 말"이 다른 뜻으로 정당한 자리("연결"은 인터넷 연결에 허용, 로그인 뜻으로 금지)는 `terms.json`의 `allow` 항목에 키·이유를 적는다.

| # | 규칙 | 근거 |
|---|---|---|
| DC1 | 금지어: `(?<!비)공식`·인증·파트너·제공·클릭·우리·감탄사(와·아·헉 등 `terms.json` 목록)·`~시겠어요`·`되어요`·`~기 바랍니다`·`네트워크`(→ 인터넷)·`다운로드하다`(동사)·`링크`(→ 주소)·`조회`·`폴더 열기`·`멈춤`·`중단`·`허용`(→ 허가)·`허가된`(→ 허가받은)·`잠시 뒤에`·`후`. 앱 이름·배지 안의 "비공식"은 걸리지 않는다(검토 U-06) | D42·D43·D44, `A-COPY` P0·P1, judgment §2.3-5 |
| DC2 | 어미: 합니다체 종결(`습니다`·`니다`·`시오`) 0개. 요청은 "해 주세요" 하나(`하세요`·`해주세요`(붙임)·`하십시오` 금지, `마세요`만 허용). "다시 시도해 주세요"가 문장 단독으로 끝나는 문자열 금지(어떻게·왜가 붙어야 한다). 상태 키(`*.status.*`·`list.group.*`)의 값에 `어요` 0개(예외 D50 `곧 끝나요`) | D44, `E-KO-A1`(앱인토스 해요체), content.md §3.1 |
| DC3 | 변수 뒤 조사 금지: `\{\w+\}[’”]?(이\|가\|을\|를\|은\|는\|과\|와\|으?로\|의\|이?에요\|예요)` 패턴(닫는 따옴표가 끼어도 잡는다), `을(를)`·`이(가)`·`은(는)` 이중 표기 | D46, `A-COPY-P0-1`, 검토 U-06 |
| DC4 | 숫자+단위 직접 문자열 금지: 문자열 안에 `\d+(\.\d+)?\s?(KB\|MB\|GB\|MB/s\|%\|초\|분)` 또는 `\d+분 남음`이 글자로 박혀 있으면 실패(format 함수 자리표시 `{size}`·`{remaining}`·`{secs}`만). `toLocaleString` 직접 호출 금지 | D47·D48·D50(골든은 `rust`·`frontend`) |
| DC5 | 구두점(역할 접미 기준, content.md §6): `...`(세 점) 금지(U+2026만); `…`는 `action.*`·`*.label` 끝(`terms.json`의 `opensWindow` 목록: 취소·덮어쓰고 받기·변경·로그아웃·폴더 고르기·허가 빼기·네이버 로그인 정보 넣기)과 `url.*` 안에만; 접미 `title`·`label`·`toast.*`·`*.status.*` 값은 끝 `.` 없음·안에 `. ` 없음; 접미 `body`·`help`·`errors.ts` `body`는 끝 `.` 필수; `?`는 `dialog.*.title`에만; `!` 0개; 따옴표는 ‘’(U+2018/2019)만(`'`·`"`·`“”` 금지, 쉘 명령 상수 제외); ` > `·` → `·`join(', ')`·괄호 앞 공백 0개 | D45, content.md §6.1~§6.5 |
| DC6 | 고지 문자열: `NOTICE_UNOFFICIAL`·`NOTICE_SHORT`·저작권 줄·`skipLink`·로그인 결과 문구는 상수 하나이고 `ko.ts`와 Worker `copy.ts`의 값이 바이트 동일 | D34 |
| DC7 | 번호 박힌 문자열 금지(`^[①②③1-9][.)]?\s`로 시작하는 문자열. 단계는 `<ol>`로) | D44(도움말 문체), content.md §2 |
| DC8 | 오류 코드·HTTP 상태 번호(`\b[45]\d\d\b`, `코드`, `0x`, `E\d{3,}`, `ErrorCode` 이름)가 `title`·`body`에 없음(L1 "자세히"에만). `errors.ts`의 `apiMessage`가 title·body 인자로 들어가지 않음 | D51(L0~L3) |
| DC9 | OS별 문자열(`Finder`·`탐색기`·`⌘`·`⌥`·`Ctrl`·`F12`·`~`·`\`)은 `ko.ts`의 `platform` 분기 객체 안에만. `{paste}`·`{devtools}` 자리표시는 그 객체에서 채운다 | D2, `platform.md` §20 |
| DC10 | 문서 패리티: `content.md` §15 표의 "새 키·문구" 열(키 + 굵은 값)이 deck의 키·값과 같고, `patterns.md`·`web.md`가 백틱 안에 적은 `영역.대상.역할` 꼴 키가 deck에 있다. 와이어프레임 안의 글자는 보지 않는다 | README §2 소유권(문구는 content.md에만) |
| DC11 | 키 규칙: 역할 접미는 `title`·`body`·`help`·`label`·`a11y`만, 값이 같은 키 둘 이상 금지, 값이 식별자·확장자만인 키 금지, 쉼표·구분자로 시작하는 값 금지, 미참조 키 0, 복합어 띄어쓰기 변형(`이어 받기`·`붙여 넣기`) 금지, 도움말 원천 `help/*.md`도 DC1·DC2·DC5 대상 | content.md §2·§6.6·§12 |
| DC12 | 접근성·로그인 키: `a11y.*` 값은 ‘{…}’로 시작(대상 먼저), `auth.*`에 "로그인 정보" 0개, `auth.revoked.*`·`auth.reuse.*`에 "관리자" 0개 | content.md §10·§9.2-8 |

### 2.5 `design-icons`

정적 부분(`lint` 작업):

| # | 규칙 | 근거 |
|---|---|---|
| DI1 | `icons.ts`의 모든 항목에 `{ set: 'lucide', name, version }` 메타가 있고 `set`은 `lucide` 하나, `version`은 모든 항목이 같다. Worker `icons.generated.ts`는 같은 원천에서 생성되어 path가 같다(`--check`) | D31, foundations §9 |
| DI2 | 고지 파일(`licenses/lucide.txt`·Worker `/licenses` 페이지 소스)의 세트 이름·버전이 DI1의 값과 같고 ISC 본문과 Feather MIT 단락이 있다 | D31(고지는 "즉시"), `G-ICON-1` |
| DI3 | path에 `fill="`·`stroke-width="`가 없고 색 지정이 없다(`currentColor`·굵기는 CSS `.icon path { stroke-width: var(--icon-stroke) }`가 넣는다). 모든 path에 `vector-effect="non-scaling-stroke"`가 있다(화면 px 고정, `size/24` 비례 금지). 앱 `Icon.svelte`와 Worker `icon.ts` 둘 다 | D32, foundations §9, 검토 P1-9 |
| DI4 | 은유 유일성: `app/src/**/*.svelte`·Worker 템플릿에서 `<Icon name="x">`·`icon="x"`·`icon('x')`가 쓰인 **동작**(가장 가까운 Button의 copy 키 또는 `aria-label` 키)을 모아, 같은 아이콘이 서로 다른 동작 둘 이상에 쓰이면 실패. 예외는 `copy`(주소 복사·정보 복사) 하나. 거부 상태는 앱·웹 모두 `circle-x` | foundations §9.1 |
| DI5 | 크기 prop 값은 `sm`·`md` 둘(16·20). `lg`·숫자 금지 | D32 |
| DI6 | `SF Symbols`·`MDL2`·`Segoe Fluent`·`Material Icons` 문자열이 소스에 없다 | foundations §9(brief §2.7: 글꼴 아이콘 사용 불가) |
| DI7 | `IconButton icon=` 허용 목록(`ICON_BUTTON_ICONS` 10개, foundations §9 표. DP5와 같은 검사, 여기서도 센다) | foundations §9 |

래스터 부분(`design-gallery` 안, Playwright chromium): `scripts/design/icons-blur.mjs`가 갤러리의 아이콘 시트(16·20, DPR 1·2)를 찍어 각 아이콘의 **수평선 최대 농도 ≥ .5, 두께합 ≥ 1.0**을 본다(foundations §9 "확인", README §6-4의 `blur2.mjs` 측정 기준). 실패하면 README §6-4의 조치(16px만 1.25로, ADR)다. 이 측정은 **[잠정]**이다: Windows 100% 실기 아이콘 시트와 비교해 기준을 맞춘 뒤 확정한다.

### 2.6 `design-gallery`

- 갤러리 페이지는 `app/gallery.html` + `app/src/gallery/main.ts`로 **별도 Vite 진입점**이다. `vite build`는 환경 변수 `CHZZK_GALLERY=1`일 때만 이 진입점을 포함한다. 릴리스 dist에는 없다. 강제: `release-hygiene` gate(`artifact-check.mjs hygiene`)에 "dist에 `gallery`가 없다" 검사 한 줄 추가(기존 E2E 표식 검사와 같은 자리). `e2e-web` gate의 `pnpm build` 단계는 `CHZZK_GALLERY=1`로 돈다(e2e 전용 dist. `size.dist_gz` ratchet은 `size` gate가 `bundle` 뒤 릴리스 dist를 재므로 영향 없다).
- 내용: `ui/` 모든 컴포넌트 × 상태 매트릭스(gov §4: rest·hover·pressed·focus-visible·disabled·loading·error·empty, 짧은/긴 한글/무공백 영문/큰 숫자) + 네 화면(홈 빈 상태 2종, 카드, 작업 목록 상태 전부·대화상자 7종, 설정) + 로그인 첫 화면 + 아이콘 시트다. **Worker 정적 HTML은 이 갤러리에 없다**(`worker/src/http/`만 바뀐 PR에서 app 영역이 꺼지므로 worker 영역 작업 `design-worker`가 맡는다, §2.0 영역 공백·§2.6b). 고정 데이터는 두 벌(`platform=macos`·`platform=windows`: 단축키 표기·[폴더에서 보기]·백슬래시 경로·1024 진법, 검토 U-38)이고 카드는 **최악 조합**(배너 B1 + 두 줄 제목 + 화질 5 + 경고 1), 작업 목록에는 앞 40자가 같고 끝만 다른 제목 둘이 있다. 매트릭스에 없는 variant×tone 조합이 `vocab.ts`에 있으면 `gallery.spec.ts`가 실패한다(갤러리가 어휘를 전부 보여야 한다). 갤러리는 sys 토큰만 쓴다(foundations 머리).
- Playwright 프로젝트 `gallery`(`app/playwright.config.ts`에 추가, 같은 webServer): 환경 행렬을 `test.describe`로 돈다. `colorScheme` light·dark × viewport 720×520·960×700·320×231(Windows 텍스트 225% 흉내) × `emulateMedia({ reducedMotion, forcedColors, contrast })` × `data-text-scale="x-large"` × `any-pointer: coarse` 흉내(`context.addInitScript`로 `matchMedia` 대체. Playwright는 `any-pointer`를 직접 에뮬레이션하지 못한다 **[잠정]**: 확인은 Playwright 1.63 `emulateMedia` 문서. 안 되면 coarse는 토큰 블록 값 검사(DT11)와 `--force-device-scale-factor` 스냅으로 대신한다).
- 각 조합에서: axe(WCAG 2.x A·AA, 기존 `fixtures.ts`의 `app.axe()`) 위반 0, 모든 대화형 요소의 바운딩 박스 ≥ `--hit-min`(마우스 24, coarse 40), `x-large`·320 폭에서 가로 스크롤 없음(WCAG 1.4.10 리플로우), forced-colors에서 포커스 링이 그려짐(`outline-style` ≠ none)과 실패·일시정지 막대 채움이 보임, `inert` 아닌 층에 `.btn-primary` 정확히 1개이고 대화상자가 열리면 `document.activeElement`가 오른쪽 끝 버튼(D36), 정렬선(툴바 첫·끝 요소·배너·카드·토스트의 상자 x = 열 안쪽 x ± 2px), 계산값(`getComputedStyle`: 다크 + contrast more에서 `--fg-muted` = `--fg`, hover 면 ≠ pressed 면), 720×520 기본 글자·마우스 조합에서 로그인 화면 네 요소와 카드 [받기]가 뷰포트 안(다른 조합은 스크롤로 닿음만), 토스트가 떠 있을 때 마지막 행 버튼이 가려지지 않음.
- **ratchet 영향**: `tests.playwright`가 늘어난다(조이기만이라 로그 불필요). `measure.mjs tests-playwright`가 `report.json`에서 프로젝트 구분 없이 세므로 그대로 쓴다.
- 상태: `e2e-web` 작업 안에서 돌므로 그 작업과 함께 관찰 → 편입된다. 따로 `OBSERVED_JOBS` 항목을 두지 않는다. **관찰 중에는 비차단**이므로 C2·C7의 필수 보장은 `frontend`(로그인 뷰 네 키 렌더)가 든다(검토 U-19).

### 2.6b `design-worker`

§2.0 "영역 공백"의 결정 (나)를 구현하는 gate다. `design-gallery`(§2.6)와 `design-shots`(§2.7)의 **Worker 정적 HTML 몫**을 worker 영역 작업 하나로 옮긴 것이고, 검사 내용은 두 gate와 같은 규칙을 Worker 뷰포트에 적용한다.

- 대상: 랜딩 비로그인·허가·관리·`/auth/done` 결과(웹 denied·cancelled, failed)·로그인 확인 페이지·옛 앱 안내. 앱 수신기 결과 페이지는 셸이 그리므로 넣지 않는다(`web.md` §6.5). Worker 서버가 렌더한 문자열을 Playwright `setContent`로 넣는다(스타일시트는 같은 생성물 `site-css.generated.ts`). 렌더 문자열을 Playwright(Node)로 넘기는 방법(vitest 단계가 만든 HTML 사본을 읽는다 등)은 적용 PR (e)가 `worker.md` 구현 중 변경에 적는다.
- 위치: `worker/e2e/gallery.spec.ts`(axe·계산값·리플로우·포커스 링), `worker/e2e/shots.spec.ts`(스냅샷), 설정 `worker/playwright.config.ts`. worker 쪽은 독립 pnpm 루트(자기 lockfile)이므로 Playwright는 `worker/package.json` devDependency로 설치하고 버전은 `scripts/ci/tools.json`의 `playwright`와 같게 고정한다(`worker` gate의 런타임 의존성 0은 그대로다: 배포 번들에 들어가지 않는다). chromium 설치는 `e2e-web`과 같은 방식(처음 한 번)이다.
- 환경 행렬: 뷰포트 1280×800·390×844, 라이트·다크, `forcedColors`·`contrast: more`·`reducedMotion`, 읽기 척도(`data-scale="reading"`) 페이지는 320 폭 리플로우. 각 조합에서 axe(WCAG 2.x A·AA) 위반 0, 대화형 요소 바운딩 박스 ≥ `--hit-min`, 가로 스크롤 없음, forced-colors에서 포커스 링이 그려짐, 계산값(다크 + contrast more에서 `--fg-muted` = `--fg`). `worker` gate의 골격 검사(`caption`·`th scope`·skip link)는 그대로 `worker`가 맡는다.
- 스냅샷: 섹션별 `toHaveScreenshot()`, 라이트·다크·forced-colors × 1280·390 × DPR 1·2. 기준선은 `worker/e2e/__shots__/*.png`를 커밋하고(`.gitattributes` `-text`) Linux 러너에서만 만든다(ADR-0008을 그대로 따른다: `--force-device-scale-factor`, `platforms: ['linux']`, 로컬 `--update-snapshots` 거부). 갱신은 `node scripts/design/shots.mjs --accept <run id>`가 artifact `design-worker-actual`에서 받는다. 허용 오차는 `ci/ratchet.json`의 `shots.max_diff_pixels`를 `design-shots`와 같이 읽는다.
- CI: 새 작업 `design-worker`(ubuntu-24.04, `if: needs.changes.outputs.worker == 'true'` = parity `areaIf('worker')`, pnpm·node 설정은 `worker` 작업 복제, `fonts-noto-cjk` apt, artifact 둘: `design-worker-actual`(실패 시 actual·diff), `ratchet-measurements-worker`). `OBSERVED_JOBS`에 `'design-worker': 'worker'`, `report`의 `needs`에 추가(parity 규칙 `observed`·`job-if`).
- 훅: 없음(무겁다). 경로가 `worker/src/http/`면 pre-push에서 안내만 한다.
- 편입 판단(D14 14일 뒤): `design-shots`와 같다. 실패가 모두 의도된 변경이었으면 `CODE_GATED_JOBS`에 `'design-worker': 'worker'`로 옮기고 `ci-ok` needs·guard를 고친다.
- ratchet: Worker 쪽 Playwright 테스트 수는 `tests.playwright`(app 몫)에 합치지 않는다. 늘려야 할 키가 있으면 (e)가 `ratchet.json`에 새 키와 `RATCHET_LOG.md` 줄을 더한다.
- selftest 씨앗: 깨끗(Worker 페이지 렌더 한 장 → 0)과 위반(미정의 토큰을 쓴 페이지 → 0 아님) 두 줄.

### 2.7 `design-shots`

- 설정 `app/playwright.shots.config.ts`(기존 설정과 분리: 프로젝트 `dpr1`·`dpr2`가 `launchOptions.args: ['--force-device-scale-factor=1'|'=2']`를 준다. `use.deviceScaleFactor`는 쓰지 않는다 — 에뮬레이션은 테두리 스냅을 건너뛴다. g-scale §1.2·규칙 11, ADR-0008). 테스트 시작에서 `devicePixelRatio`를 단언한다.
- 대상: 갤러리의 섹션별 `toHaveScreenshot()`(섹션 단위로 찍어 diff 위치가 좁다) × 라이트·다크·forced-colors × 720·960 × DPR 1·2. `animations: 'disabled'`, `caret: 'hide'`, 고정 시계(`page.clock`), `reducedMotion: 'reduce'`.
- 기준선: `app/e2e/__shots__/*.png`를 커밋한다(`.gitattributes` `-text`). **Linux 러너에서만 만든다.** `snapshotPathTemplate`에서 플랫폼 접미를 빼고 `platforms: ['linux']`로 다른 OS에서는 돌지 않는다(macOS·Windows 로컬에서 `run.mjs design-shots`는 "건너뜀"). 갱신 절차: 실패한 실행의 artifact `design-shots-actual`을 받아 `node scripts/design/shots.mjs --accept <run id>`가 PNG를 교체한다(`ratchet.mjs write --from-run`과 같은 모양: 성공·실패한 CI 실행의 산출물만 받는다). 로컬 생성 금지는 `shots.mjs`가 `CI`가 아닐 때 `--update-snapshots`를 거부하는 것으로 강제한다.
- 글꼴: 러너에 `fonts-noto-cjk`를 apt로 설치한다(ci.yml setup 단계, `parity SETUP_ALLOW`의 apt 허용). 러너 이미지가 바뀌면 기준선이 흔들릴 수 있다 **[잠정]**: 관찰 기간의 실패 원인을 `master-failure` 이슈에서 본다.
- 허용 오차: `maxDiffPixels`는 `ci/ratchet.json`의 `shots.max_diff_pixels`(처음 0)에서 읽는다. **늘리는 변경은 `RATCHET_LOG.md` 줄 필수**(`ratchet-log` gate가 본다. `ratchet.mjs`에 이 키의 방향("작을수록 좋다")을 더한다).
- CI: 새 작업 `design-shots`(ubuntu-24.04, `if: needs.changes.outputs.app == 'true'` = parity `areaIf('app')`, pnpm·node 설정은 `e2e-web` 작업 복제, artifact 둘: `design-shots-actual`(실패 시 actual·diff), `ratchet-measurements-shots`). `OBSERVED_JOBS`에 `'design-shots': 'app'`, `report`의 `needs`에 추가(parity 규칙 `observed`·`job-if`). Worker 페이지는 이 작업이 찍지 않는다. Worker 몫은 worker 영역 작업 `design-worker`(§2.6b, §2.0 "영역 공백"의 결정 (나)).
- 편입 판단(D14 14일 뒤): 실패가 모두 의도된 변경이었으면 `OBSERVED_JOBS`에서 빼고 `CODE_GATED_JOBS`에 `'design-shots': 'app'`으로 옮긴 뒤 `ci-ok` needs·guard를 고친다(`gates.mjs` `OBSERVED_JOBS` 주석의 편입 절차). 러너 drift 실패가 한 번이라도 있었으면 관찰을 연장하고 그 사유를 ROADMAP에 적는다.

### 2.8 기존 gate에 더하는 검사

| gate | 더하는 것 | 근거 |
|---|---|---|
| `frontend` | 컴포넌트 단위 테스트(vitest): Dialog(`inert` 아닌 층에 채움 1개·오른쪽 끝에 포커스·Enter가 오른쪽·Esc는 `onclose`만·`tone=danger`면 왼쪽 끝·`content.md` §5.3 표의 오른쪽 키 = 호출부 `primary`), ProgressBar(`scaleX`·줄어들면 전환 없음·reduce 1ms), Switch(disabled+켜짐 둘 다 노출), 접근 이름 필수 타입(컴파일 테스트), format 골든(`design/format/*.json`을 Rust와 공유), 플랫폼별 설정 행(Linux만 모양 행), 로그인 뷰 네 키 렌더 + Notice = `NOTICE_SHORT`, Toaster(하나·대기열·되돌리기 지연 삭제는 닫힘 시점), `errorCopy` 버튼 열 1:1, 취소 라벨·`.part` 확인 조건, 헤더 구성 표(⚙ 자리 유지), 지연 훅 가짜 타이머, vite `build.cssTarget = ['chrome111','safari16.4']`·`css.transformer = 'lightningcss'`·`app/baseline.json` 일치 | README §4.1 `frontend` 행, D1·D7·D23·D36·D37 |
| `rust` | format 골든(같은 JSON): `format_bytes(platform)`·날짜·남은 시간, `cleanDisplayText`·`clipGraphemes`, 오류 DTO 원문 분리, 경로 함수 골든(3 OS, `platform.md` §20), Dock 집계·알림 묶음·전원 사유 길이 | D47~D50, `platform.md` |
| `worker` | `worker-config.mjs`에 골격 검사: `theme-color` meta 2종(`#F3F3F3`·`#1F1F1F`)·`color-scheme` meta, skip link, `<table>`마다 `caption`과 `th scope`, 랜딩 비공식 고지가 h1 다음 첫 절 안, 읽기 페이지(랜딩·`/help`·`/privacy`·`/licenses`)만 `main[data-scale="reading"]`, `/auth/*` 헤더에 로그인 링크 없음, 무스크립트 폼 테스트(PRG·flash·오류 요약·멱등), 단계 `help-check`(DX22) | D53·D34·foundations §3.3·§10, `web.md` |
| `tauri` | `tauri.conf.json` 테스트: `decorations: true`, `minWidth 720`·`minHeight 520`, `zoomHotkeysEnabled: false`, Windows `scrollBarStyle: fluentOverlay`, `visible: false`, window-state 플러그인 등록, `minimumSystemVersion 13.3`, `backgroundColor` = foundations `--bg` 라이트 hex, `allowLinkPreview: false`, `theme`·`titleBarStyle`·`transparent` 키 없음, devtools feature 없음, 메뉴 전수 한국어, Windows `with_webview` 호출, `set_badge_*` 0개, 권한 `allow-set-webview-zoom` 없음, 안전장치 타임아웃, 알림 문자열 = `content.md` §14 상수 | D26~D30·D1·D38, `platform.md` §22-14 |
| `release-hygiene` | dist에 `gallery` 없음 | §2.6 |
| `scripts-test` | `scripts/design/*.test.mjs`(자동 포함) + `adr.test.mjs`(§4.3) + `allow.test.mjs`(허용 목록 이유 필수) + `pr-template.test.mjs`(§3.0) | §2.0 |
| `selftest` | 일곱 gate의 씨앗 | §2.0 |

### 2.9 확장 검사 표(`DX*`)

다른 문서가 강제 수단으로 적은 검사 중 §2.2~§2.8에 없던 것이다. 전부 기존 gate 안의 단계로 들어가고 새 gate는 없다. 요청 문서의 절을 "원천" 열에 적었다.

| # | gate | 검사 | 원천 |
|---|---|---|---|
| DX1 | `design-lint` | `data-tauri-drag-region` 0개, `titleBarStyle`·`hiddenTitle` 없음 | platform §3 |
| DX2 | `design-lint` | `cursor: not-allowed` 0개, `cursor`·`user-select` 선언은 `app.css`의 규칙에만(컴포넌트 0개) | platform §4.1·§4.2 |
| DX3 | `design-lint` | `<img`·`<a ` 요소에 `draggable="false"` 필수(앱 소스) | platform §4.6 |
| DX4 | `design-lint` | `wheel`·`gesturestart`·`gesturechange`·`webkitmouseforce*`·`contextmenu` 리스너는 `guards.ts`에만 | platform §4.3·§4.5·§5 |
| DX5 | `design-lint` | `matchMedia('(pointer`·`maxTouchPoints`·`navigator.platform`·`navigator.userAgent` 금지(플랫폼은 Rust가 준다) | platform §20 |
| DX6 | `design-lint` | `keydown` 리스너가 있는 파일은 `isImeKey`를 import; `<input` 요소의 `onkeydown`에 `Enter` 분기 금지; `compositionend` + `setTimeout` 패턴 금지 | platform §17.1, patterns §8 |
| DX7 | `design-lint` | `navigator.clipboard.readText(` 0개 | platform §17.2 |
| DX8 | `design-lint` | `prefers-contrast: less`·`custom` 0개 | platform §10.3 |
| DX9 | `design-lint` | 컨트롤(`.btn`·`.field`·`.select`·`.row`)에 `height:` 선언 금지(`min-height`만). 아이콘·막대·스위치 손잡이는 예외 | platform §11, components §2.19 |
| DX10 | `design-lint` | 로딩 표시(Spinner·Skeleton)는 `useDelayedLoading` 훅 경유(`setTimeout(…, 숫자)` 금지, 상수 import만) | patterns §2.2, platform §14 |
| DX11 | `design-lint` | `josa`·`particle` 같은 조사 선택 함수 금지 | content §8 |
| DX12 | `design-lint` | `role="alert"` 리터럴은 `Notice.svelte`에만(DS1에 포함) | components §2.12 |
| DX13 | `design-lint` | 오버레이(`DropOverlay`)에 `backdrop-filter`·`color-mix(… transparent)` 금지 | patterns §7 |
| DX14 | `release-hygiene` | 전원 금지 심볼 0개: `PreventSystemSleep`·`ES_AWAYMODE_REQUIRED`·`ES_DISPLAY_REQUIRED`·`PreventUserIdleDisplaySleep`·`handle-lid-switch`·`disablesleep` | platform §15.2 |
| DX15 | `release-hygiene` | OS 전원 심볼은 `crates/shell/src/power*`·`app/src-tauri/src/power*`에만 | platform §15.2 |
| DX16 | `release-hygiene` | `WEBKIT_DISABLE_*`·`__NV_DISABLE_*` 무조건 설정 0개 | platform §13 |
| DX17 | `release-hygiene` | "서명 신원 없음 ↔ TCC 안내 켜짐" 일치, dist에 `gallery` 없음 | platform §16.5, §2.6 |
| DX18 | `tauri` | §2.8 `tauri` 행의 설정 키 전수 | platform §22-14 |
| DX19 | `smoke-bin` | 마커 키 `probe`(엔진 프로브 전부 true)·`t_show_ms`·`t_ready_ms` 추가(`MARKER_KEYS` 고정 집합 변경, cicd.md 구현 중 변경 114) | platform §13·§14 |
| DX20 | `smoke-install` | `ubuntu:22.04` 컨테이너 `xvfb-run --smoke` [제안] | platform §13 |
| DX21 | `bundle` | 아이콘 산출물: ico 층 집합(11), icns 항목 수(10), `.deb` hicolor 경로·`Name[ko]`, macOS `CFBundleIconName`·`Assets.car`, `Info.plist` `NS*UsageDescription` | platform §18.2·§16.5 |
| DX22 | `worker` | 단계 `help-check`: `help/<id>.md` → `/help` 생성 뒤 `git diff --exit-code`, `<details>` 안 `id` 0개, `help/ids.json` 추가만, manifest 필수 필드 | web §10 |
| DX23 | `scripts-test` | `scripts/design/spec-check.mjs`: 시스템 문서 전수 대조 — 토큰 이름 옆 숫자가 foundations §13과 같은지, 상수 이름이 §14에 있는지, `ADR-NNNN`·`D1`~`D62`·`R1`~`R10`·검사 번호(`DT*`…)·연구 ID(`E-*`·`X-*`·`A-*`·`G-*`·`J-*`·`Q*`)가 존재하는지, `X-*`를 근거로 쓴 곳이 없는지, `vocab.ts`의 `ICON_BUTTON_ICONS` = foundations §9 표, `content.md` §15 키 ↔ 다른 문서의 키 인용(DC10과 짝). 편집 때 쓴 scratchpad 도구(`spec-tools/`)를 단계 (a)에서 옮긴다 | README §2, 검토 P0-8 |

---

## 3. 리뷰 체크리스트 R1~R10

### 3.0 운영

- 파일 `.github/PULL_REQUEST_TEMPLATE.md`를 단계 (a)에서 만든다(지금은 없다). 템플릿은 "화면·문구·토큰을 건드린 PR만 아래를 채운다. 해당 없는 항목은 `해당 없음`으로 둔다"로 시작하고 `R1`~`R10` 줄이 있다. `scripts-test`의 `pr-template.test.mjs`가 README §4.2 표의 번호·요지와 템플릿 줄이 같은지 본다(문서 패리티).
- 리뷰어는 사람(사용자) 또는 글로벌 지침의 Codex 리뷰다. 리뷰어는 각 항목을 **PR 본문의 첨부물**로 판정한다. 첨부물이 없으면 "아니오"다. 아래 표의 "통과 기준"이 판정 기준이다.
- 자동 gate가 같은 것을 보는 항목은 gate 이름을 적었다. 사람 항목은 gate가 못 보는 것(의미·정렬·맥락)만 남겼다.

| 번호 | 언제 | 무엇을 붙이나 | 통과 기준 | 자동으로 보는 부분 |
|---|---|---|---|---|
| **R1** | 화면(`.svelte` 마크업·CSS, Worker 템플릿)이 바뀜 | 스크린샷 **네 장**: 라이트 960×700, 다크 960×700, 라이트 720×520, forced-colors(Windows 실기 또는 `emulateMedia`). 갤러리 섹션이면 `design-shots`(Worker 페이지는 `design-worker`)의 diff 이미지로 대신한다 | (1) 열 정렬: 툴바 안쪽·배너·카드·토스트의 왼쪽 선이 한 x좌표(foundations §8 "기준선 하나"), (2) 12px 글자가 단독으로 의미를 전하는 곳 없음(§3.2), (3) `--fg-disabled`가 비활성 외에 쓰인 곳 없음(§1 규칙 5), (4) `--separator` 선 하나로만 구분되는 의미 경계 없음(§6.2), (5) 720에서 가로 스크롤·잘림 없음, (6) 숫자 열(퍼센트·크기)이 `.num` 유틸로 정렬 | `design-gallery`(axe·리플로우), `design-shots`·`design-worker`(회귀) |
| **R2** | `design/tokens/` diff가 있음 | ADR 번호, 바뀐 토큰의 이름·전후 값, 근거 등급(E0~E4) | ADR 파일이 PR에 있고 상태가 `제안` 또는 `채택(잠정)`/`채택`, 근거 표의 최고 등급이 적혀 있다(E3 미만이면 `채택`이 아니다), [취향] 값은 [취향]으로 표시. foundations 표·§13·생성물이 같은 PR에서 바뀜 | `design-tokens`(T14 패리티), `scripts-test`(`adr.test.mjs`) |
| **R3** | `copy/` 또는 Worker `copy.ts` diff | copy deck diff 요약(추가·변경 키)과 `content.md` 용어집 대조 결과("비표준 어휘 없음" 또는 예외 이유) | 새 문자열이 content.md 어미·구두점·조사 규칙에 맞고, OS별 문자열은 `platform` 분기 객체에만, 오류 문구는 3요소(무슨 일·왜·다음 행동, C6) | `design-copy`(C1~C9) |
| **R4** | 글자 토큰(`--text-*`·`--leading-*`·`--weight-*`·`--font-*`) diff | Windows 실기 스크린샷 2장(맑은 고딕, 배율 100%·125%) + `getComputedStyle(document.body).fontFamily` 값 | 13px 400 한글이 판독되고 600이 400과 구별되며 숫자 열이 정렬된다(README §6-1). 안 되면 README §6-1의 조치(`--text-body`·`--leading-body` → 14/18)를 같은 PR에서 한다 | — (실기만) |
| **R5** | `icons.ts`에 항목 추가·변경 | foundations §9.1 은유 표에 더한 행 + 광학 보정 시트(16·20 격자 위 렌더, DPR 1·2) | 다른 동작에 이미 쓰인 모양이 아니고, stroke가 화면 px 고정이며, 수평선이 격자에 걸치지 않는다(`icons-blur.mjs` 결과 첨부) | `design-icons`(I1~I7, 번짐 측정) |
| **R6** | 대화상자·확인 흐름(Dialog 사용처, 창 닫기·업데이트·로그아웃·취소·덮어쓰기, Worker 확인 페이지) 변경 | 표 한 장: 대화상자마다 [왼쪽 버튼 / 오른쪽 버튼 / 채움 / Enter 대상 / Esc 결과 / 파괴 동작 위치] | 오른쪽 끝 = 안전(아무것도 하지 않은 것과 같은 결과) = 채움 = Enter = 기본 포커스, 실행 쪽 = 왼쪽(되돌릴 수 없으면 `tone=danger` 왼쪽 끝), `inert` 아닌 층에 채움 정확히 1개, Esc = 닫기, 라벨이 `content.md` §5.3 표와 같다(D36, ADR-0005) | `frontend`(Dialog 테스트), `design-gallery`(채움 1개·포커스) |
| **R7** | 새 알림·상태 표시(Notice 사용처, 토스트, 배너, 행 상태) | 위계 중 어디인지(행 상태 > 인라인 > 토스트 > 배너 > 대화상자)와 "한 사건에 수단 하나"인지 한 줄, 같은 사건이 다른 곳에도 표시되면 그 이유 | 같은 사건이 두 수단으로 나오지 않음(`J-F-*` "같은 사건을 두 번 말한다" 결함 금지), 정보 토스트는 `TOAST_MS`[취향]+정지, 오류·동작 토스트는 대기열·닫을 때까지(D37), 정보 톤은 중립 면 | `frontend`(Toast·Banner) |
| **R8** | Worker 페이지(`worker/src/http/*-view.ts`·`pages.ts`) 변경 | JS를 끈 브라우저에서 **키보드만으로** 완주한 기록(순서 있는 포커스 경로 목록, `<details>` 열림, 폼 제출·오류 요약 도달, skip link 동작) + 휴대폰 폭 캡처 1장(랜딩만) | 모든 동작이 Tab·Enter·Space·Esc로 되고, 오류 요약이 h1 다음에 있으며, 설치 안내에 SAC·"그래도 열기"·xattr 폴백 문단이 있다(D53·D55) | `worker`(골격·폼 테스트), `design-lint` S9 |
| **R9** | 새 `ui/` 컴포넌트 | foundations §2.7 forced-colors 매핑 표에 더한 행 + forced-colors 스크린샷 | 면으로 구분하던 것이 선(`1px solid CanvasText`)으로 보이고, 상태 표시가 모양으로 남는다(색만이 아니라) | `design-gallery`(forced-colors axe) |
| **R10** | 흐름·화면 구성·핵심 문구·토큰 어휘 변경(영향 큰 결정) | §6.4 D62 확인 과업 목록에 더한 과업 한 줄(무엇을 관찰하면 이 결정이 틀린 것인가) + 해당 ADR의 "재검증 조건"에 그 과업 번호 | 과업이 화면 단어를 쓰지 않고(사용자 어휘 유도, `G-EVID-R4`), 끝 조건이 관찰 가능하다 | `scripts-test`(`adr.test.mjs` DA7: 영향 큼 ADR에 `### 재검증 조건` 소절 존재) |

리뷰 항목을 더하거나 바꾸는 것은 README §4.2 표와 이 표와 PR 템플릿 셋을 한 PR에서 고치는 일이다(`pr-template.test.mjs`가 어긋남을 잡는다).

---

## 4. ADR 운영

README §7이 "언제 쓰나"(§7.1)와 틀(§7.2)을 정했다. 여기서는 운영 규칙과 기계 검사를 적는다.

### 4.1 번호와 상태

- 파일 `docs/design/system/adr/NNNN-slug.md`. 번호는 4자리 연번이고 **지금 폴더의 최댓값 + 1**이다. 지워진 번호는 다시 쓰지 않는다(폐기된 ADR도 파일을 남긴다).
- 상태 값은 넷뿐이다: `제안` → `채택(잠정)` 또는 `채택` → `폐기(→ NNNN)`. `채택`은 근거 표의 최고 등급이 **E3 이상이고 결정 영향이 "작음"**이거나 **E4**일 때만 쓴다(README §3-4·§7.2, `G-EVID-R1`). 그 밖은 `채택(잠정)`이다. 처음 열 장(§4.4)은 전부 E0~E1 근거라 `채택(잠정)`이다.
- 결정을 뒤집을 때 옛 파일은 머리의 상태 줄만 `폐기(→ 새 번호)`로 고치고 본문은 손대지 않는다.
- 사람 결정(D58~D60·D55·§6-9)은 사용자가 결정한 날 에이전트가 ADR을 쓰고 근거 표에 `결정자: 사용자, 날짜`를 적는다. 등급은 쓰지 않는다(근거가 아니라 결정이다).
- 시험 결과(D62)로 쓰는 ADR은 "발견하지 못함"도 쓴다(README §7.1 조건 6). 표본 칸은 `N명 중 M명`뿐이다.

### 4.2 틀(README §7.2를 그대로 쓴다)

머리 한 줄: `상태: … 날짜: YYYY-MM-DD 관련: D번호, §6-번호, 이전 ADR`. 절은 `## 맥락` `## 결정` `## 근거`(표: 주장 · 등급 · 출처 · 표본·날짜 + `최고 등급:`·`결정 영향:` 줄) `## 결과`(영향: 바뀌는 문서 절·gate·컴포넌트·마이그레이션, 소절 `### 재검증 조건`) `## 대안과 버린 이유`. README §7.2와 같은 모양이고 `adr.test.mjs` DA4가 이 절 이름을 본다.

### 4.3 기계 검사 `scripts/design/adr.test.mjs`(`scripts-test` gate)

| # | 검사 |
|---|---|
| DA1 | 파일명 `^\d{4}-[a-z0-9-]+\.md$`, 번호가 중복되지 않고 빈 번호가 없다(0001부터 연속) |
| DA2 | 첫 줄 `# NNNN 제목`의 NNNN = 파일명 번호 |
| DA3 | 머리에 `상태:` 값이 넷 중 하나, `날짜:` YYYY-MM-DD, `관련:` 존재 |
| DA4 | 절 `## 맥락` `## 결정` `## 근거` `## 결과`(안에 `### 재검증 조건` 소절) `## 대안과 버린 이유` 다섯이 이 순서로 있다(README §7.2 틀과 같다) |
| DA5 | `## 근거` 안에 표(헤더 `주장 | 등급 | 출처 | 표본·날짜`)와 `최고 등급: E[0-4]` 줄, `결정 영향: (작음|중간|큼)` 줄이 있다. 사람 결정 ADR은 `결정자:` 줄로 대신한다 |
| DA6 | 상태가 `채택`이면 (최고 등급 E4) 또는 (E3 이상이고 영향 작음)이다. 아니면 실패 |
| DA7 | 영향이 `큼`이면 `## 결과` 안에 `### 재검증 조건` 소절이 있다(`R10`) |
| DA8 | `## 근거` 표의 **표본·날짜 열**에 `\d+%`가 없고(배율·대비 같은 수치는 다른 열에 올 수 있다), `명 중`을 포함하는 셀은 `\d+명 중 \d+명` 형식이다(brief §6.15-2) |
| DA9 | 본문에 `이탈률`·`사용 빈도`·`전환율`이 없다(텔레메트리 없음, §7) |
| DA10 | `[잠정]`·`[취향]` 표시가 있는 값은 같은 줄 또는 다음 줄에 "확인:" 글자가 있다 |
| DA11 | 시스템 문서 안의 `ADR-NNNN` 인용은 실제 파일이 있고 그 파일의 `관련:` 또는 제목이 인용 맥락(D 번호)을 담는다(DX23과 짝) |

### 4.4 처음 쓴 ADR 열 장

| 번호 | 제목 | 관련 |
|---|---|---|
| 0001 | 방향 선택: A 「무색」 뼈대 + B 내용물 + C 문구, 사용자 결정 다섯(열 800 포함) | judgment, D5·D11·D24·D26·D36 |
| 0002 | 루트 16px과 px 토큰 | D4, `A-VIS-01` |
| 0003 | 상태 레일 폐기 | `A-DRIFT-K3`, `A-VIS-20` |
| 0004 | 성공색 없음(잠정) | D10, README §6-5 |
| 0005 | 대화상자 버튼 배치 | D36 |
| 0006 | 바이트 진법을 OS별로 | D47, README §6-10 |
| 0007 | 토큰 단일 원천과 생성기 | D3, §1 |
| 0008 | 시각 회귀 기준 OS는 Linux 하나 | D61, §2.7 |
| 0009 | 출처 없는 수치 묶음(제안값) | README §6-7, foundations §14 |
| 0010 | 다크 `--danger-ink` 보정 | foundations §2.1·§12-2 |
| 0011 | Notice: 알림 아홉 갈래를 프리미티브 하나로 | D35·D37, components §2.12 |
| 0012 | Surface: 테두리 있는 면 박스를 하나로 | D19, components §2.16 |
| 0013 | SettingsRow: 설정 행의 라벨·값 색 역할 고정 | D19, components §2.17 |
| 0014 | FieldRow: 카드 폼 행은 SettingsRow와 색 규칙을 같이 한다 | D19, components §2.26 |
| 0015 | DropOverlay: 투명 면 + 점선 테두리 + 가운데 라벨 | components §2.27 |
| 0016 | Toolbar: 열 안쪽 정렬의 start·end 두 칸 | D24·D33, components §2.28 |
| 0017 | 최근 영상 목록: 같은 이름의 회차를 구별하는 둘째 줄과 영속 | D39, patterns §14.1 |
| 0018 | 완료 그룹 접힘: 11개부터 기본 접고 최신 5개만 보인다 | D39, patterns §3·§14.3 |
| 0019 | 글자 크기 단계: 기본·크게·아주 크게(×1·×1.3·×2.0) | D28, foundations §3.2·§12-9 |
| 0020 | 서비스 공지: 사람이 올리는 R2 객체 하나, 읽기만 하는 `GET /notice`, 고장 나면 공지 없음 | D41, web §1, worker.md 100 |
| 0021 | 웹 폼 위험도 두 단계: 허가 빼기만 확인 페이지, 나머지는 즉시 실행과 멱등 303 | D54, D37, web §7.3, worker.md 99 |

README §7.3 표와 같다(편집에서 맞췄다). 0011~0016은 적용 단계 (b)가 새 컴포넌트마다 한 장씩 더했고, 0017~0019는 (c)가, 0020(D41 서비스 공지)·0021(D54 웹 폼 위험도)은 (e)가 더했다(§10 (e) ADR 행).

---

## 5. 컴포넌트 추가 절차

gov §6의 Frost 거버넌스 흐름을 1인 + 에이전트 규모로 줄였다. "대화" 단계는 PR 설명의 결정 문장과 ADR로, "제품 팀 승인"은 리뷰 체크리스트 통과로 바꿨다.

| 단계 | 할 일 | 강제 |
|---|---|---|
| 1 기존 것 먼저 | `ui/`에 같은 일을 하는 컴포넌트가 있는지 본다. prop 조합(variant×tone×size)으로 되면 새로 만들지 않는다 | 리뷰 `R9`(새 컴포넌트 PR은 "기존 컴포넌트로 안 되는 이유" 한 줄) |
| 2 진입 심사 2문항 | GOV.UK 기준: (1) 고유한가(기존 것의 복제가 아닌가) (2) 다재다능한가(두 곳 이상에서 쓰이는가). 한 화면에서만 쓰이면 `views/` 안의 로컬 스타일로 둔다(snowflake 규칙) | `design-lint` S1(원시 요소 금지)이 "로컬에서 원시 요소를 쓰는 길"을 막으므로, 두 곳 이상이면 `ui/`로 올리는 압력이 생긴다 |
| 3 ADR | README §7.1 조건 4("새 컴포넌트") → ADR 한 장. 맥락에 어느 화면·어느 과업(T1~T7)을 위한 것인지 | `adr.test.mjs`, `R2` |
| 4 명세 | `components.md`에 절 추가: API(vocab.ts 어휘만), 상태 매트릭스 행, 치수 조합(토큰 이름으로, `calc()` 없이), forced-colors 행(foundations §2.7, `R9`), 접근 이름 규칙 | 리뷰 `R9` |
| 5 구현 | `ui/<Name>.svelte`. sys 토큰만, `--` 선언 없음, 리터럴 없음, `label` 필수 타입 | `design-lint` 전부, `frontend`(svelte-check) |
| 6 갤러리 | 갤러리 매트릭스에 섹션 추가(모든 variant×tone×size×상태) | `design-gallery`(어휘 전부 노출 검사), `design-shots`(새 기준선은 CI 실행에서 받는다) |
| 7 단위 테스트 | 상태 노출(aria), 키보드 동작, disabled와 상태 병존 | `frontend`, `tests.vitest` ratchet(늘기만) |
| 8 문구 | 컴포넌트 안에 글자가 있으면 `copy/ko.ts` 키로 | `design-lint` S6, `design-copy` |
| 9 리뷰 | `R1`(네 장) + `R9` + 해당 항목 | PR 템플릿 |
| 10 기록 | `components.md` 끝 changelog 표(날짜·변경·ADR) | 리뷰 `R2` |

컴포넌트 상태(라이프사이클)는 두 단계만 둔다: 명세에 있으면 `stable`, `@deprecated` 주석이 있으면 `deprecated`. `experimental`은 두지 않는다(갤러리에 있는 것은 모두 앱에 쓸 수 있어야 한다). 폐기는 새 이름 추가 → 한 PR에서 일괄 치환 → 옛 이름 제거(소비자가 앱 하나라 단계를 늘리지 않는다, research-governance §3.3 규칙 7). `@deprecated`가 붙은 컴포넌트가 한 릴리스를 넘겨 남아 있으면 `design-lint`가 경고가 아니라 실패를 낸다(날짜가 아니라 `app/package.json` 버전으로 본다: 주석에 `@deprecated since 0.1.2`를 적고 현재 버전이 그보다 크면 실패).

---

## 6. 사용자 시험(D62) 절차

g-evid §5의 계획을 이 시스템의 결정에 맞춰 적는다. 영향 큰 결정(D5·D11·D16·D36·D42·D44·D62)은 모두 E0~E1 근거라 `채택(잠정)`이고, 이 시험이 E3·E4 근거를 만드는 유일한 길이다(README §3-4).

### 6.1 틀

| 항목 | 값 | 근거 |
|---|---|---|
| 시점 | **둘 다**(D62): 1회차 = 적용 전 현재 앱(기준선), 2회차 이후 = 적용 뒤. 두 회차의 대본은 같은 판으로 두어 비교할 수 있게 한다 | D62 |
| 참가자 | 회당 3명, 스트리머·지인 각 1명 이상. 두 회 이상. 모집은 사용자의 지인. 사례금 없음이면 30분 상한을 안내문에 적는다 | g-evid §5.1 |
| 방식 | 원격 중재(디스코드·카카오톡 화면 공유, **앱 창만**) + 소리 내어 생각하기. 참가자 본인 컴퓨터, **본인 영상** | g-evid §1.3·§5.1, C8 |
| 역할 | 진행자 1. 기록자가 없으면 진행자가 시험 직후 10분 안에 양식을 채운다 | g-evid §5.1 |
| 파일럿 | 1회. 대본이 바뀌면 이전 회차와 합산하지 않는다 | g-evid §8 R4 |
| 동의 | 녹화·인용·관찰자 각각 예/아니오. 녹화는 분석 뒤 14일 안에 지운다 | g-evid §2 |
| 기록 위치 | 요약만 저장소 `docs/design/system/tests/VT-YYYYMMDD-회차.md`(양식 §6.5). 원본 메모·녹화는 저장소 밖 | g-evid §2.2, 공개 저장소 규칙 |

### 6.2 과업(참가자 낭독문)

| # | 낭독 | 끝 조건 | 보는 것 |
|---|---|---|---|
| UT1 설치 | "이 앱을 쓰려고 합니다. 설치해서 쓸 수 있게 해 주세요."(시작 화면은 랜딩) | 앱이 열린다 | OS 버튼 선택, 미서명 경고 앞 행동, "그래도 열기" 경로(D55), 설치 파일 자리를 찾는가(`loginForFiles`) |
| UT2 첫 실행 | "앱을 처음 열었습니다. 이 앱으로 뭘 할 수 있을지 말해 주세요." | 핵심 기능을 자기 말로 설명 | 빈 상태 3단계·고지 읽기(C2·C8), 헤더 이름만으로 무엇인지 아는가(D26) |
| UT3 로그인 | "본인 계정으로 쓸 수 있게 해 주세요." | 로그인 상태 | 로그인 첫 화면의 받는 것/받지 않는 것/끊는 길 이해(C7), 웹에서 로그인한 뒤 앱 로그인에서 머뭇거리는가(`loginTwice`), 거부 화면의 [다시 시도] |
| UT4 첫 받기 | "방금 끝난 방송을 컴퓨터에 남겨 주세요." | 재생되는 파일이 폴더에 있다 | 주소 붙여넣기 힌트, 가장 높은 화질을 고르는가(꼬리표·기본 선택, content §16-11), 퍼센트 읽기(C5), [폴더에서 보기] |
| UT5 실패 복구 | "받는 도중에 인터넷이 끊겼다고 가정합니다."(진행자가 Wi-Fi를 끈다) → "이어서 끝내 주세요." | 같은 파일이 끝까지 | "연결 대기" 단계를 오류로 읽는가(D40), 실패 본문 "받은 부분은 그대로 있어요" 이해, [이어받기]와 [다시 시도] 구별, 그룹 "받다 만"을 찾는가(content §16-1) |
| UT6 민감 설정 | "나이 제한이 있는 방송도 받을 수 있게 설정해 주세요." | 쿠키를 넣거나 넣지 않기로 판단 | 설정 › 고급의 다섯 가지(이유·저장 위치·값의 힘·사칭 경고·끝내는 길)를 읽고 판단하는가(C7), "네이버 로그인 정보"와 앱 "로그인"을 혼동하는가 |
| UT7 재방문 | (UT4 뒤 다른 날) "지난번처럼 하나 더 남겨 주세요." | 안내 없이 UT4를 다시 한다 | 기억된 폴더·화질, 최근 영상 목록, 비운 뒤 빈 상태 문구 |

과업문에 화면 단어(받기·불러오기·이어받기·다시보기·저장 등)를 쓰지 않는다(`G-EVID-R4`: 사용자 어휘를 유도한다. D42 "실제 사용자 어휘 [미확인]"의 확인 경로). 과업 번호 `UT`는 연구 문서의 과업 `T1`~`T7`과 같은 번호다. 각 과업 뒤 SEQ 한 문항(1~7), 5 미만이면 "어디가 어려웠나요?" 한 번. 끝에 "가장 헷갈린 순간은?" 하나.

### 6.3 판정

결과 코드 **S**(혼자 성공) · **A**(지연·망설임 뒤 성공) · **F**(실패·포기) · **H**(힌트 받음, 성공으로 세지 않음). 문제마다 심각도 0~4(NN/g)와 빈도(관찰자 수/참가자 수).

| 판정 | 조건 | 조치 |
|---|---|---|
| 차단 | 심각도 4, 또는 한 과업에서 3명 중 2명 이상 F/H | 다음 릴리스 전 수정 → 같은 대본으로 재시험 |
| 수정 권고 | 심각도 3, 또는 3명 중 2명 이상이 같은 지점에서 A | 다음 릴리스에 수정, 관련 ADR 갱신 |
| 기록 | 심각도 1~2, 1명 | 문제 목록에 남기고 다음 회에 재관찰 |
| 발견하지 못함 | 전원 S, SEQ 5 미만 없음 | ADR에 "이번 표본에서 발견하지 못함"으로 적는다. **통과 선언이 아니다** |

"3명 중 2명" 기준은 **[잠정]**(g-evid §5.3 "근거가 아니라 선택": 5명 규칙이 가정하는 평균 발견율 31%와 같은 수준의 문제를 놓치지 않으려는 값). 확인: 첫 두 회 뒤 기준을 다시 보고 바꾸면 ADR.

### 6.4 이 시스템의 확인 과업 목록(`R10`이 더하는 곳)

README D62의 여섯 항목을 관찰 가능한 문장으로 적었다. 각 항목은 어느 결정의 재검증인지와, 나쁘면 무엇을 바꾸는지(README §6)를 가리킨다.

| # | 관찰 | 어디서 | 결정 | 나쁘면 |
|---|---|---|---|---|
| V1 | 완료된 항목을 색 없이 알아보는가: 5초 과업 "다 받은 영상을 찾아 보세요"(UT4 뒤 목록에 완료 1·받는 중 1·실패 1을 둔다) | UT4 | D10, ADR-0004 | 3명 중 2명 이상 못 찾으면 `--success-ink` 토큰 하나 추가(README §6-5) |
| V2 | 취소 대화상자에서 오른쪽 파랑 버튼을 "안전"으로 읽는가: UT5 중 [취소…]를 누르게 유도한 뒤 어느 버튼으로 손이 가는지와 입으로 말한 기대 | UT5 | D36, ADR-0005 | 2명 이상이 오른쪽을 "지우기"로 기대하면 D36 뒤집기 → ADR |
| V3 | 왼쪽 빨간 글자를 파괴로 읽는가(V2와 같은 장면, 반대 방향) | UT5 | D36 | 같다 |
| V4 | 13px 본문이 작게 느껴지는가: 과업 뒤 "글자 크기가 어땠나요?" 한 문항 + 관찰(얼굴을 화면에 가까이, 줌 시도) | 전체 | D11 | Windows 참가자 2명 이상이면 README §6-1 조치(14/18) |
| V5 | 헤더 이름만으로 무엇인지 아는가: UT2의 자기 말 설명에 "치지직"·"다시보기/영상"·"받기/저장" 중 둘 이상 | UT2 | D26·D33 | 2명 이상 못 말하면 마크 과제(§8)의 우선순위를 올린다 |
| V6 | 툴바 톱니(글자 없는 설정 아이콘)를 찾는가: "저장 폴더를 바꿔 보세요" | UT4 뒤 | foundations §9 설정 행 | 2명 이상 못 찾으면 [설정] 글자를 붙인다(허용 목록에서 `settings` 제거) |
| V7 | "연결 대기" 줄무늬를 오류로 읽는가 | UT5 | D40 | 2명 이상이 "실패했다"고 말하면 문구·막대 형태 재검토 |
| V8 | 토스트 `TOAST_MS`(6초)를 다 읽는가 | UT4 완료 | D37[취향], ADR-0009 | 읽지 못하면 8초 또는 닫을 때까지 → ADR |

### 6.5 기록 양식

```
시험 ID: VT-YYYYMMDD-회차-P번호   진행자:   기록자:
앱 버전:   OS(종류·배율만):   집단(스트리머/지인):
동의: 녹화[예/아니오] 인용[예/아니오] 관찰자[없음/N]   대본 판: v1   파일럿: [예/아니오]

과업 | 결과(S/A/F/H) | 시간(분) | SEQ | 막힌 지점(화면/문구/행동) | 참가자 말(이름·값 제외) | 심각도
T1 | … | | | | |
…
확인 과업 V1~V8 | 관찰 결과(해당 회에 본 것만) |
개입 기록(힌트와 시점):
의외였던 행동:
화면에 보인 개인정보(종류만):
녹화 삭제 예정일:
```

기록에 채널 이름·영상 제목·영상 번호·계정 이름·인증 값을 적지 않는다(공개 저장소 규칙. 강제 `scan` gate가 `docs/`도 본다). 회차 요약 파일은 PR로 올리고, 그 PR이 ADR을 갱신한다(README §7.1 조건 6).

---

## 7. 근거 운영 규칙 O1~O10

근거 등급 E0~E4의 정의는 README §3-4에 있다. 아래는 그 운영이다(g-evid §8의 규칙 문장을 이 저장소의 강제 수단에 맞췄다. 리뷰 항목 `R*`와 구별하려고 `O*`로 번호를 붙였다).

| # | 규칙 | 강제 |
|---|---|---|
| O1 | 흐름·화면 구성·핵심 문구·토큰 어휘를 바꾸는 결정은 ADR에 근거 등급을 적는다. E3 미만만으로 영향 큰 결정을 `채택`이라 쓰지 않는다 | `adr.test.mjs` DA5·DA6 |
| O2 | 시험은 회당 3명, 두 회 이상. 대본이 바뀌면 합산하지 않는다 | 기록 양식의 `대본 판` 칸, 리뷰(요약 PR) |
| O3 | 소표본 결과는 `N명 중 M명`으로만. 성공률(%)·평균 SEQ·SUS를 판정에 쓰지 않는다. "발견하지 못함"은 "문제 없음"이 아니다 | `adr.test.mjs` DA8 |
| O4 | 힌트를 준 과업은 성공으로 세지 않는다(H) | 양식 |
| O5 | 시험 기록에 이름·채널·제목·영상 번호·계정·인증 값을 적지 않는다. 화면 공유는 앱 창만, 녹화는 동의 때만, 14일 안 삭제 | `scan`, 양식의 삭제 예정일 칸 |
| O6 | **텔레메트리를 만들지 않는다.** 사용 빈도·이탈률 같은 계측 주장은 어느 문서에도 쓰지 않는다. 증거원은 자발 보고(`문제 보고용 정보 복사`의 code 분포)·문의 분류·시험·평가뿐 | `adr.test.mjs` DA9, `typos`와 같은 방식의 문서 grep(`_typos.toml`에 `이탈률`·`사용 빈도`·`전환율`을 금지어로. **[잠정]**: typos가 한글 금지어를 받는지 확인한 뒤, 안 되면 `adr.test.mjs`가 `docs/design/system/` 전체를 본다) |
| O7 | 새·바뀐 화면은 PR에서 NN/g 10원칙 자체 점검을 하고 심각도 3 이상은 §6.4 목록에 올린다. 에이전트 평가는 E1을 넘지 못한다 | 리뷰 `R10` |
| O8 | 선호 테스트는 시각 취향([취향] 값)을 좁힐 때만. 흐름·문구·구조의 근거로 쓰지 않는다(E2 이하) | 리뷰 `R2`(근거 표의 "선호" 출처 행이 E2 이하인지) |
| O9 | ADR 재검증 조건에 닿는 변경(그 화면·문구 변경, 새 OS, 같은 지점 문의 2건, 12개월 경과)이 생기면 그 과업을 다음 회에 넣는다 | 릴리스 체크(ROADMAP 릴리스 항목에 "ADR 재검증 조건 대조" 한 줄) |
| O10 | 릴리스 뒤 7일 안에 지인 2~3명에게 막힌 곳을 한 줄로 묻고, 문의는 분류표(설치/로그인/주소/화질/저장 위치/실패/기타)로 기록한다 | ROADMAP 릴리스 항목 |

---

## 8. 과제 등록

README가 이 문서에 등록을 맡긴 과제다. 각 과제는 끝나면 ADR 한 장을 받는다(번호는 §4.1 규칙).

| 과제 | 조건·범위 | 누가 | 선행 | 결과가 바꾸는 것 |
|---|---|---|---|---|
| **앱 마크(D33)** | 전경·배경 분리 원본(`icon-fg.svg` + 풀블리드 배경), 플레이트 = `--accent`(라이트 값) 하나, 치지직 로고·초록과 다름(C1), 16px에서 선 2px 이상, 흑백 식별, 글자 없음. 결과물이 툴바 왼쪽 20px 마크가 된다(D26). 시험: 5초 흑백 식별(V5와 함께) | 사용자 + 에이전트 | 없음 | 헤더(이름만 → 마크+이름), 앱 아이콘 세트(macOS Icon Composer 레이어, Windows 16~256, Linux 48+), g-id 조건 |
| **Windows 실기(README §6-1)** | 맑은 고딕 13px 판독, 600 렌더, `tabular-nums`, `system-ui` 해석, 배율 100·125·150, 탐색기 바이트 진법(§6-10) | 사용자(실기) | `compose.yml`의 Windows 환경 또는 실기 | D11(13 → 14 여부), D13, D47 골든, `R4` |
| **Linux 실기(README §6-2)** | fontconfig `system-ui`, Noto Sans CJK KR 유무, GNOME 다크 감지, 분수 배율 | 사용자 | — | 랜딩 설치 안내 한 줄, `design-shots` 러너 글꼴 |
| **앱 라이선스(D58)** | 사람 결정. 결정 전 저작권 줄 "모든 권리 보유" | 사용자 | `docs/public-release.md:67` | 정보 화면 "이용 조건" 행, `/terms`(D60) |
| **AppImage·LGPL(D59)** | 실제 `.so` 목록 확인 → 계속 배포하면 LGPL 고지·소스 제안 파일 + `.so` 목록 gate | 사용자 결정, 에이전트 조사 | — | `/licenses`, 번들 gate |
| **이용 조건 페이지(D60)** | `/terms` 없음으로 시작. 허가 목록이 커지면 다시 본다 | 사용자 | D58 | Worker 경로 표 |
| **서명·SAC 실기(D55, README §6-11)** | macOS ad-hoc 서명, Smart App Control 두 대, 서명 없는 빌드의 알림 표시 | 사용자 | — | 랜딩 설치 문단, `platform.md`, D38 |
| **상표·법령 확인(README §6-9)** | 치지직 약관 상표 조항, KIPRIS 조회, KWCAG 적용 여부 | 사용자 | — | §9 개명 트리거 표, D34 |
| **첫 사용자 시험(D62)** | §6(UT1~UT7, V1~V8) | 사용자(진행) + 에이전트(양식·ADR) | 1회차는 적용 전 | README §6-3의 조치 전부 |

---

## 9. 개명 트리거(D34)

앱 이름 "VOD 클립 다운로더"를 바꾸는 조건이다. 하나라도 사실이 되면 D34를 B안("고유 이름 + 치지직용")으로 바꾸는 ADR을 쓴다(README §6-9). 확인은 사용자가 한다(brief §2.7).

| # | 트리거 | 확인 방법 | 상태 |
|---|---|---|---|
| ① | 치지직 이용약관·개발자 정책에 서비스명 사용 금지 조항이 있다 | 약관 원문 확인 | [미확인] |
| ② | NAVER가 이의를 제기한다 | 연락 수신 | — |
| ③ | 공개 스토어(App Store·Microsoft Store·Flathub)에 올린다 | 배포 결정 | 계획 없음 |
| ④ | KIPRIS에 "치지직" 상표가 소프트웨어류(9류·42류)로 등록되어 있다 | KIPRIS 조회 | [미확인] |

트리거와 무관하게 유지하는 것: 비공식 고지 4곳(D34), Worker 헤더 배지, 치지직 로고·색 미사용(C1). 강제 `design-copy` DC6(고지 상수), `design-tokens` DT9(C1).

---

## 10. 적용 계획(stacked PR)

여섯 단계다. 각 단계는 PR 하나(크면 둘)이고 앞 단계 위에 쌓는다(CLAUDE.md "단계별 stacked PR"). 단계마다 **범위 / 완료 조건 / e2e mock·spec / ratchet / ADR**을 적었다. 모든 단계에서 `ci-ok`가 녹색이어야 하고, 관찰 작업(`e2e-web`·`design-shots`·`design-worker`)의 빨간색은 원인을 PR에 적는다.

### (a) 토큰 원천·생성기·gate

| 항목 | 내용 |
|---|---|
| 범위 | `design/tokens/*.tokens.json`(foundations 전부)·`design/ui.css`(components.md), `design/copy/terms.json`, `scripts/design/{tokens,check-tokens,css,lint,copy,icons,contrast,stem,spec-check,adr.test,allow.test,pr-template.test}.mjs` + 테스트(편집 때 쓴 scratchpad `spec-tools/`를 옮긴다), 생성물 셋(`app/src/styles/tokens.css` 교체, `app/src/styles/ui.css`·`worker/src/http/site-css.generated.ts` 신설. **이 단계에서는 Worker가 아직 쓰지 않는다**), `app/src/lib/timing.ts`·`crates/shell/src/consts.rs`(foundations §14 상수, 아직 참조 없음), `gates.mjs`·ci.yml `lint` 작업에 네 gate, 훅 `when`, selftest 씨앗, `allow.json`(현재 위반 전부), `.github/PULL_REQUEST_TEMPLATE.md`, ADR 0001~0010(이미 있음), `app/src/styles/tokens.test.ts` 삭제 |
| 완료 조건 | `run.mjs design-tokens`·`design-lint`·`design-copy`·`design-icons` 모두 0(허용 목록으로), `parity` 0, `selftest`에 여덟 씨앗 기대대로, `--check`가 생성물 손 수정을 잡는 씨앗 통과, foundations §13·§14 패리티 통과, `spec-check.mjs` 0 |
| e2e | 변화 없음(토큰 이름이 바뀌지만 옛 `tokens.css`를 쓰는 컴포넌트는 허용 목록 아래 그대로다. **주의**: 옛 토큰 이름(`--fg-faint`·`--dur-*`·`--success`)이 사라지면 화면이 깨지므로 이 단계의 `tokens.css`는 **새 토큰 + 옛 이름의 `/* legacy */` 별칭 블록**을 끝에 둔다(`--fg-faint: var(--fg-disabled)` 등, 주석 "단계 (c)에서 제거"). 별칭 블록은 DT3·DT7에서 뺀다(foundations §12-18)) |
| ratchet | `tests.vitest` 감소 → `RATCHET_LOG.md` 줄. 새 키 `design.allow_entries`(CI 측정값으로 시작, 늘면 실패) |
| ADR | 없음(0001~0010은 명세 PR에 있다) |

### (b) `ui/` 기본 컴포넌트

| 항목 | 내용 |
|---|---|
| 범위 | `vocab.ts`, Button(`loading` 추가, `variant`/`tone` 분리, 끝자리 보정)·IconButton·TextField·SecretField·Select·Switch·RadioGroup·Badge(`kind`)·ProgressBar(`scaleX`, forced 형태 단서)·**Notice**(InlineAlert·Banner·Toast 통합, tone × variant)·Toast(대기열)·Dialog(D36 배치, `primary`/`secondary`)·Menu(`trigger`)·Disclosure·Surface·SettingsRow·FieldRow·EmptyState·DropOverlay·Toolbar·Icon(`non-scaling-stroke`, 메타). `components.md`가 명세. `app.css` 전역 리셋(`html { font-size: 16px }`, `keep-all`, `.num`·`.ellipsis` 유틸, `[data-focus-container]`). 코드 주석의 `ui-visual §n` 인용을 `docs/design/system/` 절로. 갤러리 진입점과 `gallery.spec.ts`, `design-gallery`를 `e2e-web`에, `release-hygiene`에 gallery 없음 검사 |
| 완료 조건 | `ui/`의 `allow.json` 항목 0(허용 목록은 `views/`·`components/{app,jobs,receive,settings}` 항목만 남는다), 컴포넌트 단위 테스트(Dialog·ProgressBar·Switch·접근 이름 타입), 갤러리에서 axe 0·대상 크기·forced 포커스 링 통과, `design-icons` I1~I7 통과(Lucide 메타·고지 파일 `licenses/lucide.txt`·정보 화면 고지 행), 이 단계가 고친 파일의 코드 주석 `ui-visual §n` 인용을 `system/` 절로 바꿈 |
| e2e | `app/e2e/mock/backend.ts`는 그대로(DTO 불변). spec은 role·name 기반 selector라 대부분 그대로이나 InlineAlert·Banner·Toast → Notice로 `role`이 바뀐 곳(`alert`/`status`)은 spec을 고친다. Dialog 버튼 순서가 바뀌므로 `flow.spec.ts`·`settings.spec.ts`의 "취소 대화상자" 단계를 D36 순서로 |
| ratchet | `tests.vitest` 증가, `tests.playwright` 증가(gallery), `design.allow_entries` 감소(조이기, `ratchet.mjs write`) |
| ADR | 새 컴포넌트(Notice·Surface·SettingsRow·FieldRow·DropOverlay·Toolbar) 각 1장 |

### (c) 기능 화면

| 항목 | 내용 |
|---|---|
| 범위 | `patterns.md`대로: 홈(빈 상태 2종·최근 영상 목록 + [다시 열기]·붙여넣기 힌트 `{paste}`), 영상 카드([불러오기] 테두리·[받기] 채움 하나·sticky 바닥·"가장 좋은 화질" 꼬리표·"받다 만 파일" 안내), 작업 행(상태 어휘 두 층, 레일 제거, 퍼센트 열 `--pct-w`, 제목 2줄·배지 뒤, 동작 자기 줄, 완료 그룹 접힘), 설정(그룹 상자, 계정 행, 모양 RadioGroup은 Linux만, 글자 크기 RadioGroup, [⚙] 자리 유지), 로그인·거부 화면(네 요소), 툴바(이름 13px 600, 계정 Menu·[⚙]), 레이아웃 열 800·`layout.css` 두 블록, 토스트 열 기준·대기열, `data-text-scale` 설정 연결(셸 설정 DTO 변경 → `UPDATE_BINDINGS=1`), 비활성 창 `data-window-active`(Tauri 창 이벤트), 대화상자 7종(D7 덮어쓰기 포함), `.part` 취소 확인, 옛 토큰 별칭 블록 제거 |
| 완료 조건 | `allow.json` 항목 0(**gate가 허용 목록 없이 통과**), `design-tokens` DT3 미사용 0, 갤러리 네 화면 + 로그인 화면 + Windows 고정 데이터, 720×520 최악 조합에서 카드 [받기]가 뷰포트 안(sticky), `R1` 네 장·`R6` 표·`R7` 한 줄 첨부, 저장소에 `ui-visual` 인용 0(`git grep ui-visual`이 `docs/design/ui-visual.md` 자신과 이 명세·ADR·ROADMAP의 이력 문장만 남김)이고 **`docs/design/ui-visual.md` 스텁을 같은 PR에서 삭제** |
| e2e | **가장 큰 영향.** `backend.ts`에 최근 VOD 목록(`recentVods`는 이미 DTO에 있다)·완료 그룹·"연결 대기" 상태(DTO에 단계 추가 시) 시나리오 추가. 모든 spec의 화면 문구 selector를 새 copy로(문구는 (d)에서 다시 바뀌므로, 이 단계에서 spec이 `copy/ko.ts`를 import해 문자열을 참조하도록 바꾼다 → (d)에서 spec 수정 0). `e2e-native` 흐름(받기 하나)은 [받기] 버튼의 role·name이 같으면 그대로 |
| ratchet | `design.allow_entries` → 0(키를 지우지 않고 0으로 둔다), `tests.playwright`·`tests.vitest` 증가, `tests.app`(Rust 창 이벤트·설정 DTO 테스트) 증가 |
| ADR | 패턴 변경(최근 목록·완료 그룹·연결 대기) 각 1장, D28 글자 크기 단계[잠정] 1장 |

### (d) 문구

| 항목 | 내용 |
|---|---|
| 범위 | `content.md`대로 `ko.ts`·`errors.ts` 전면(해요체·"해 주세요"·조사 재구성·마침표 규칙·U+2026·따옴표·용어집), format 함수(`bytes.ts` OS 진법 인자·붙임·유효숫자, `date.ts` "2026. 10. 3. 오후 9:00", `duration.ts` "약 N분 남음") + Rust 쪽 같은 골든(`design/format/*.json`), OS 알림 문자열(D38), 비공식 고지 상수, 도움말 원천 `help/<id>.md` 골격 |
| 완료 조건 | `design-copy` C1~C9 통과(허용 목록 없이), format 골든 Rust·TS 양쪽 통과, 오류 28코드 모두 3요소(L0) + L1 "자세히" |
| e2e | spec이 `ko.ts`를 참조하므로 수정 0이 목표. `errors.spec.ts`의 코드별 문구 검사는 `errors.ts` 참조로. `e2e-native`는 문구를 보지 않는다(결과 파일 sha256) |
| ratchet | `tests.vitest`(format 골든)·`tests.rust` 증가 |
| ADR | D47 OS 진법(0006 이미 있음) 외 없음. 문구 변경은 ADR 대상이 아니다(README §7.1 마지막 문단) |

### (e) Worker 페이지

| 항목 | 내용 |
|---|---|
| 범위 | `web.md`대로: `site-css.ts` → `site-css.generated.ts`(토큰 + ui + `site.css`), 골격(`theme-color` 2종·`color-scheme`·skip link·`caption`·`th scope`·헤더 `.col`), 읽기 척도 `main[data-scale="reading"]`(랜딩·help·privacy·licenses만), 랜딩 구조(D53: 내 OS 버튼 36 하나, 다른 OS 접힘, 설치 안내(SAC 경고 Notice·그래도 열기 조건문), SHA-256 접힘, 휴대폰 블록, 고지 히어로 아래·바닥글, 로그인 전 고지 네 줄·`loginForFiles`·`loginTwice`, "막히면" + 연락 자리표시), 헤더 배지 "비공식 도구", 폼 위험도 2단(D54, 허가 어휘), 결과 페이지(웹 흐름 denied `circle-x`·`doneDenied.next`·cancelled, grant 없는 failed, 옛 앱 안내 `outdatedApp`. 앱 흐름 결과는 셸 수신기라 (e) 밖, `web.md` §6.5), 오류 페이지 nav, `/notice`(D41), `/licenses`(Lucide 고지), OG 이미지 |
| 완료 조건 | `worker` gate의 골격 검사·`help-check` 통과, **`design-worker` gate(§2.6b) 신설과 첫 기준선 커밋**(worker 쪽 Playwright·`tools.json` 버전 고정·`OBSERVED_JOBS` 등록), `design-tokens` DT1(공통 구간 동일)·DT3(Worker 소스에서 `--text-hero` 사용), `design-lint`가 `worker/src/http`를 허용 목록 없이 통과, `R8` 기록 첨부, Worker vitest(1148+)에 골격·폼 테스트 추가, `worker.md` 구현 중 변경 번호(`web.md` §14의 열린 다섯 항목. 6번 확인 코드 제거는 루프백이 닫았다) |
| e2e | `worker-e2e`(관찰 작업)의 로그인·관리 흐름은 경로·폼 이름이 같으면 그대로. 폼 위험도 2단으로 "허용 빼기"에 확인 페이지가 끼므로 그 흐름 한 단계 추가. `site-css.test.ts`의 해시 기대값 → 생성기 해시로 |
| ratchet | `tests.worker` 증가 |
| ADR | D41 서비스 공지(fail-open 72h) 1장, D54 위험도 2단 1장 |

### (f) 셸·OS 통합

| 항목 | 내용 |
|---|---|
| 범위 | `platform.md`대로: `tauri.conf.json`(`zoomHotkeysEnabled: false`, Windows `scrollBarStyle: fluentOverlay`, `visible: false` + 첫 그림 뒤 show, window-state 플러그인, `minimumSystemVersion 13.3`, 창·웹뷰 `backgroundColor` 테마별 `--bg`, `allowLinkPreview: false`), `app/baseline.json`, 커서 `default`, 브라우저 키 차단, Dock·작업 표시줄 진행(집계, 1Hz, PAUSED ≠ ERROR), 잠자기 방지 토글·재시도 인내, 클립보드 제안(macOS `alwaysAllow`만), 메뉴 한국어(Apple 용어), "Finder에서 보기"/"폴더에서 보기"·`{paste}`·`{devtools}` 분기, 비활성 창 속성, 미달 엔진 알림(D1), OS 알림 묶음·문자열(D38), 기본 저장 폴더 폴백·`VolumeProbe`·볼륨 기준 `naming::Platform`(core.md 구현 중 변경), 설정 › 보기 › 모양(Linux만)·글자 크기, `smoke-bin` 마커 키(DX19) |
| 완료 조건 | `tauri` gate의 conf 테스트·알림 문자열·집계 테스트 통과, `smoke-bin` 통과(`visible:false` → show 경로가 스모크 마커를 깨지 않음), 3 OS `tauri` 작업 녹색, `R4` Windows 실기 2장(이 단계의 PR에 첨부. 결과가 나쁘면 README §6-1 조치를 **같은 PR**에서) |
| e2e | `e2e-native`(Linux·Windows)가 `visible:false` 뒤 show를 기다려야 한다 → `e2e-native.mjs`의 창 대기 조건 수정. `--features e2e` 코드는 `e2e.rs`에만(`release-hygiene`) |
| ratchet | `tests.app.<os>`·`tests.app_e2e.<os>` 증가, `size.binary.*`는 window-state 플러그인으로 커질 수 있다 → 커지면 `RATCHET_LOG.md`(cicd.md §4.2, 선례 2026-10-06 updater 줄) |
| ADR | D29 Dock 진행 집계 1장, D56 클립보드 1장, Windows 실기 결과(README §6-1) 1장 |

### 단계 공통

- 각 PR 뒤 글로벌 지침의 Codex 리뷰(없으면 서브에이전트 2종)를 돈다.
- `docs/ROADMAP.md`의 "현재 위치"와 체크리스트를 단계마다 갱신한다(CLAUDE.md 작업 규칙).
- `docs/design/ui-visual.md`는 대체 표만 담은 호환 스텁으로 남겼다가 (c)에서 지웠다(README §3-1, app.md 구현 중 변경 67). `app.md` §8·§9·§10 본문은 고치지 않고(app.md 50 "본문은 설계 당시 기록") 67이 가리킨다. 코드 주석의 `ui-visual §n`은 (b)·(c)에서 바꾼다.
- 관찰 작업 편입: `e2e-web`(+`design-gallery`)와 `design-shots`의 D14 시작일은 각각 (b) 머지 뒤 첫 master 녹색 실행, ~~(a) 머지 뒤 첫 master 녹색 실행~~ (b) 머지 뒤 첫 master 녹색 실행(§12-12: `design-shots`는 (b)에서 `design-gallery`와 함께 만든다)이고, `design-worker`는 ~~Worker 단계 PR(첫 기준선 커밋) 머지 뒤 첫 master 녹색 실행~~ **(e) PR 머지 뒤 첫 master 녹색 실행**이다(§12 (e) 3: 기준선은 CI가 첫 실행에서 실패하며 남기는 artifact를 `shots.mjs --accept --target worker`로 받아 넣는다. 기준선이 들어가기 전의 master 실행은 빨갛지만 관찰 작업이라 `ci-ok`를 막지 않고, 14일은 첫 녹색 날부터 센다). 편입 예정일은 ROADMAP에 적는다(cicd.md 구현 중 변경 47 (다)).

---

## 11. 편집에서 닫은 것(2026-10-10)

| 초안 항목 | 처리 |
|---|---|
| README §4.1 `design-lint` "stylelint" | README를 "선언 단위 파서 + 소스 스캔 + prop 어휘"로 |
| ADR 번호 불일치 | README §7.3 = §4.4 열 장. 0009·0010을 썼고 foundations·platform·patterns·content의 "ADR-0002(묶음)" → ADR-0009, "ADR-0006(danger-ink)" → ADR-0010 |
| 원천 경로 `design/tokens.json` | 폴더 `design/tokens/*.tokens.json` + `design/ui.css`로 통일(README D3·foundations 머리·web §2) |
| `design-icons` 번짐 측정 자리 | README 표: 정적은 `design-icons`, 측정은 `design-gallery` |
| ADR 틀 | README §7.2를 §4.2 모양(재검증 조건은 `## 결과` 소절)으로 |
| 리뷰 항목 수 | R2·R10에 녹였고 새 번호 없음(변함없음) |
| `tests.vitest` ratchet 감소 | (a) PR의 `RATCHET_LOG.md` 줄(변함없음) |
| 초안 §12 foundations 요청 F1~F6 | F1 갤러리 comp 층 없음(foundations 머리), F2 `$type` 열(foundations §1), F3 `--progress-tween` duration만(foundations §7.1), F4 유틸 파일 이름(foundations §3.4·§3.5), F5 legacy 블록 예외(foundations §12-18), F6 Worker 폭 쿼리 파일(foundations §8, DL13) |
| 검사 번호 충돌(검토 U-18) | `DT*`·`DL*`·`DS*`·`DP*`·`DX*`·`DC*`·`DI*`·`DA*`·`UT*`로 접두를 나눴다 |

---

## 12. 구현 중 변경(적용 단계에서 고른 것)

번호는 적은 순서이고 고치지 않는다. 같은 주제를 뒤 항목이 다시 다루면 뒤 항목이 이긴다. 본문(§0~§11)보다 이 절이 우선한다(README §3). 값·이름의 변경은 foundations §12 20~27, 컴포넌트 CSS는 components §7, 문구 검사는 content §19에 있다. 아래는 gate·검사·운영에 관한 것이다.

### (a) 토큰 원천·생성기·gate 넷

1. **`design.allow_entries`의 첫 기준은 로컬에서 센 실제 항목 수(497)다.** §2.3은 "CI 측정값, `ratchet.mjs write`"라 했지만 이 수는 파일만으로 정해져 러너와 무관하다. 0 자리표시는 ratchet의 "0도 실제 기준" 규칙(`ratchet.mjs`)에 걸려 실패하므로 같은 PR에서 실제 수를 적는다. ratchet 종류 `design`은 작을수록 좋고 0도 실제 기준이다((c)의 0 유지).
2. **허용 목록 `scripts/design/allow.json` 하나를 네 gate가 규칙 접두(DT / DL·DS·DP·DX / DC / DI)로 나눠 쓴다.** §2는 lint·copy에만 허용 목록을 명시했지만 DT2·DT3·DT4·DT12·DT13·DI1·DI2·DC10 같은 소스 쪽 위반도 (a)에서 0일 수 없다(옛 컴포넌트·Worker가 그대로다). 원천·생성물 자체 검사(DT1·DT5~DT11·DT14~DT17, terms.json ↔ content.md 패리티)는 허용 목록을 받지 않는다. 항목은 위반 하나(규칙·파일·글자를 `^…$`로 이스케이프한 pattern)에만 맞고, 맞는 위반이 없어진 항목은 gate를 실패시킨다(ratchet이 실제로 조여지고 와일드카드가 새 위반을 덮지 못한다). 이유가 없는 항목은 `allow.test`가 거부한다. 항목 정렬은 문자열 사전순이다(`DL10`이 `DL2`보다 앞).
3. **`tokens.mjs --check`는 DT1(생성물 셋 바이트 동일·결정성·앱/Worker 공통 절과 ui 절 동일)만, 문서 패리티 DT14·DT15는 `check-tokens.mjs`가 본다.** §1.3과 §2.2 표가 자리를 다르게 적었고, 어느 쪽이든 같은 `design-tokens` gate 안이다. `lint.mjs`는 `ratchet check design`까지 `design-lint` gate 안에서 돈다.
4. **Worker 생성 CSS 모듈(`site-css.generated.ts`)을 `worker-config.mjs`의 소스 낱말 검사에서 뺐다.** CSS의 `html {`·`align-self`·`list-style`이 낱말 `html`·`self`·`list` 금지에 걸린다. 대신 `checkGeneratedCss`가 모양을 글자로 본다(머리 주석 한 줄 + `SITE_CSS` 백틱 문자열에 백틱·백슬래시·`$`·`<`·`@import`·`url(` 없음 + 16 hex 해시). 생성기는 이 글자가 있으면 이스케이프하지 않고 실패한다(`worker.md` 구현 중 변경 95).
5. **`app/src/styles/ui.css` 생성물은 (a)에서 앱이 import하지 않는다.** 전역 클래스가 옛 마크업에 닿지 않게 하려는 것이다. `design/ui.css`는 (b)가 쓸 완성된 원천이다. 생성물 셋(`tokens.css`·`ui.css`·`site-css.generated.ts`)과 `design/`·`site.css`는 `.gitattributes`에서 `text eol=lf`로 고정해 Windows autocrlf에서도 `--check`가 같은 바이트를 본다.
6. **DP1·DP5는 `vocab.ts`가 생기는 (b)부터 판정한다.** (a)에는 "vocab.ts 없음" 위반 하나를 허용 목록에 둔다. 없는 `licenses/lucide.txt`(DI2)도 같고, Worker `icons.generated.ts`가 없으면 그 비교를 건너뛴다. 이 항목들은 (b)에서 unused가 되니 지운다. `spec-check`의 DX23(`ICON_BUTTON_ICONS`)도 `vocab.ts`가 있을 때만 비교한다.
7. **훅 경로를 §2.1에 더했다.** design-tokens에 `worker/src/http/site.css`(생성 입력), design-lint에 `design/ui.css`·`scripts/design/`, design-copy에 `patterns.md`·`web.md`(DC10)·`help/`·`scripts/design/`, design-icons에 `scripts/design/`. pre-push `scripts-test`에 `design/`·`docs/design/system/`·`docs/research/design-system.md`·`.github/PULL_REQUEST_TEMPLATE.md`를 넣었다(새 테스트가 읽는다). `scripts/ci/**`·`ci/`·`release/`는 넣지 않는다: selftest의 깨끗한 pre-commit 사본이 그 경로를 스테이징하는데 디자인 입력이 없다. `ci/ratchet.json`(`design.allow_entries`)의 변경은 CI `lint`의 design-lint가 본다.
8. **selftest 씨앗은 아홉 줄이다**(완료 조건의 "여덟 씨앗 + `--check` 손 수정 씨앗"보다 하나 많다): 네 gate × (깨끗한 사본 0, 위반 1: DL1 색 리터럴 / DC1·DC2 `ko.ts` 끝 최상위 리터럴 / DI6 `SF Symbols`) + design-tokens "생성물 손 수정"(`--space-8: 8px;` → `9px`) + design-tokens "미정의 토큰"(DT2). 디자인 입력은 `mkRoot(…, { design: true })`일 때만 복사한다.
9. **`tools.json`은 바꾸지 않았다.** 네 gate는 노드 스크립트뿐이라 새 도구 버전이 없다. `design-worker`의 Playwright는 (e)에서 등록한다. `allow.mjs`·`legacy.mjs`·`stem.mjs`는 명세 목록 밖에 더한 보조 파일이다(`stem.mjs`는 README §6-1이 옮기라 한 편집용 도구가 인계 폴더에 없어 새로 쓴 최소 구현: PNG 한 행의 줄기 폭을 재는 수동 도구).
10. **`design-lint` 판정 세부는 `lint.mjs`·`lint.test.mjs`가 기준이다.** 명세 숫자를 바꾸는 선택만 적는다: DL5의 `var()`는 폴백 없는 `var(--x)`만 통과한다(`var(--leading-title, 1.3)`도 위반). `box-shadow: none`도 DL9 위반이다. border·outline의 0/1/2px 밖 길이는 DL14로만 내고 DL2를 겹쳐 내지 않는다. DS1·DS5·DX3·DS7·DS2·DS6은 `app/` 소스에만 적용하고 Worker `.ts`에는 DS2·DS9만 본다(Worker 페이지의 `<button class="btn">`은 정당하다). 색 이름 비교는 색을 받는 속성에서만 한다. DL11의 정지 상태 `transform`은 `scaleX(`·`@keyframes`·`spinner`·상태 selector에서만 면제한다. 반복 위반은 (규칙, 파일, 글자) 하나로 합친다.
11. **ADR 검사(`adr.test.mjs`, DA*)의 해석.** DA3 날짜는 `YYYY-MM-DD`로 시작하면 통과한다(ADR-0005의 `2026-10-09(편집 2026-10-10)`). DA5·DA8은 근거 표 머리에서 `주장 | 등급 | 출처 | 표본·날짜`를 부분 일치로 찾고 맨 앞 `#` 열은 있어도 된다. DA10은 표 머리의 `확인…` 열이 비지 않은 행을 `확인:`을 쓴 것으로 본다. DA11의 "인용 맥락"은 `ADR-NNNN` 바로 앞 절(`|`·`;`·괄호·마침표로 끊음)의 D 번호다. 결정자 줄이 있는 사람 결정 ADR은 DA5에서 최고 등급과 결정 영향 줄을 요구하지 않는다. ADR-0002·0009의 `[잠정]` 표시 네 곳에 `확인:` 글귀를 붙이거나 말로 바꿨다(뜻은 그대로).
12. **`design-shots` gate·CI 작업은 (a)가 아니라 (b)에서 `design-gallery`와 함께 만든다.** 「단계 공통」(§10)은 `design-shots`의 D14 시작을 (a) 머지 뒤로 적었지만 (a) 범위 표에 `design-shots`가 없고, 이 작업은 (b)에서 생기는 갤러리 섹션을 찍는다. D14 시작일은 (b) 머지 뒤 첫 master 녹색 실행이다(`e2e-web`+`design-gallery`와 같은 날). 편입 예정일은 ROADMAP에 적는다.

### (b) `ui/` 기본 컴포넌트

1. **`design-gallery`는 독립 gate가 아니라 `e2e-web` gate 안의 Playwright 프로젝트 `gallery`다.** 빌드를 `CHZZK_GALLERY=1`로 하고 한 번의 `playwright test`가 두 프로젝트를 돌아 report.json 하나를 `tests.playwright`가 센다. ci.yml `e2e-web` 시간 한도를 20분에서 30분으로 올렸다.
2. **`design-shots`는 배율 강제(`--force-device-scale-factor`)가 `page.setViewportSize`에서 1로 돌아가는 것을 실험으로 확인해 폭마다 프로젝트를 둔다**(`dpr1-720`·`dpr1-960`·`dpr2-720`·`dpr2-960`, viewport null + `--window-size`). 기준선 경로는 `app/e2e/__shots__/<프로젝트>/<이름>`이다.
3. **CI에서는 `updateSnapshots: 'missing'`이다.** 기준선이 없으면 그 자리에 쓰고 실패하며 `*-actual.png`와 expected 첨부 경로를 report.json에 남긴다(실험으로 확인). `shots.mjs --accept`는 report.json의 actual ↔ expected 짝으로 기준선 경로를 정한다. 로컬은 `'none'`이고 `-u`는 설정과 `shots.mjs` 둘 다 거부한다. artifact는 `design-shots-actual`(= `target/design-shots/`) 하나이고 측정값이 없어 `ratchet-measurements-shots`는 두지 않는다.
4. **`design-shots`에는 selftest 씨앗이 없다**(Playwright·chromium이 lint 작업에 없다). `ci/ratchet.json shots.max_diff_pixels`는 측정하지 않는 설정값이라 ratchet 영역 `shots`를 lint·log-check(늘리면 느슨하게 하기)에만 넣었다.
5. **design-lint를 조정했다.** DP1 `variant`는 컴포넌트별 `<이름>_VARIANT` 배열(없으면 모든 `*_VARIANT`의 합집합), DS5 예외 `ui/Spinner.svelte`, DS7 예외 `ui/IconButton.svelte`(components §2.2의 `title={label}`). 허용 목록으로 두지 않은 이유는 (b) 완료 조건이 `ui/` 항목 0이기 때문이다.
6. **`release-hygiene`는 바이너리가 아니라 `app/dist`를 본다**(자산이 압축돼 바이너리 grep이 늘 통과한다). 이름에 `gallery`가 든 파일 또는 갤러리 표식 상수가 든 파일이 있으면 실패하고, dist가 없으면 2로 끝난다.
7. **`scripts/design/allow.mjs --prune`을 더했다.** 맞는 위반이 없어진 허용 항목만 지우고 더하지는 않는다.
8. **아이콘 번짐 측정 `icons-blur.mjs`는 칸마다 세로 단면에서 가장 선명한 획 구간의 peak·sum을 잰다**(`stem.mjs` 해독 재사용). 기준 peak ≥ .5·sum ≥ 1.0은 [잠정]이다. 확인: Windows 100% 실기 아이콘 시트(§6 과제 4).

### (c) 기능 화면

1. **§10 (c)의 "`allow.json` 0"은 이 절이 고친다.** 문구 항목(DC1~DC12)은 (d)가, Worker 항목(DT2·DT3·DC*의 Worker 파일)은 (e)가 지운다는 "다음 단계로 넘기는 문제"와 충돌하기 때문이다. (c)가 0으로 만드는 것은 이유가 "(c)"인 DL·DS·DT(앱)·DX·DI 항목과 legacy 절이다. 남은 185개는 전부 DC*(d, 문구) 또는 Worker(e)이고 `design.allow_entries`를 그 실제 수로 조였다(311 → 185, 키는 유지). (c)가 더한 DC11 중복 하나(action.cancelQueued = `resolve.cancel` '취소')만 이유 "단계 (d)에서 제거(문구)"로 더했다. DL·DS·DT·DX·DI의 새 항목은 0이다.
2. **연결 대기·회복·멈춘 지 30일 행(J2)은 (c)에서 만들지 않는다.** 코어에는 `NETWORK_PATIENCE_MS`도 대기 상태도 없고(재시도 5회·8초 상한), `job.recovered.body`는 같은 데이터를 쓰며, `job.stale.body`는 멈춘 시각 필드가 없다. 셋과 ADR "연결 대기"는 (f)(platform §15)로 넘겼고 DC10 허용 항목(`job.status.waitingNetwork`·`job.waitingNetwork.body`·`job.recovered.body`·`job.stale.body`)의 이유를 "단계 (f)에서 제거(연결 대기·멈춘 작업 데이터)"로 바꿨다. 갤러리·e2e에도 이 세 행은 없다.
3. **글자 크기·모양은 코어 `settings.json`의 `textScale`·`theme`에 영속한다**(모르는 값은 기본으로 읽는다, 스키마 버전 2 그대로). `get_settings`는 AuthGate 뒤라 같은 값을 `AppInfo`에도 실어 로그인 화면도 x-large로 그린다(`settings.loadInfo()`). `theme`는 OS와 무관하게 저장하고 화면이 Linux에서만 바꾼다.
4. **새 command `open_web_page`(`'privacy' | 'licenses'`)를 AuthGate 허용 목록(`gate.rs`의 열린 command 목록)에 넣었다**(gate 변경). 로그인 화면의 [개인정보 처리방침]이 로그인 전에 열려야 하기 때문이다. Worker 고정 경로 `{origin}/privacy`·`/licenses`를 기본 브라우저로 열 뿐이라 정보가 새지 않는다. Worker 페이지는 (e)가 만들므로 (e) 전까지 링크는 404를 연다(`worker.md` 구현 중 변경에 한 줄).
5. **갤러리 "네 화면 + 로그인 + Windows 고정 데이터"(J6)는 `gallery.html`에 가짜 화면을 만들지 않고 실제 앱(dist) + 가짜 백엔드 시나리오로 한다.** Playwright `gallery` 프로젝트의 `e2e/screens.spec.ts`(화면 × 크기 × 테마 × 접근성 설정 행렬)가 열고, 스냅은 `shots.spec.ts`에 같은 방식으로 더했다. 기준선은 CI artifact를 `shots.mjs --accept`로 받는다. 화면 문자열은 `e2e/copy.ts`가 `copy/ko.ts`·`errors.ts`를 import해 참조한다((d)에서 spec 수정 0).
6. **입력 디바운스 150ms는 `receive.ts`가 내보내는 상수다**(J22). foundations §14 표는 JS 타이머 상수만이 아니라 공용 상수 표라 이 값으로 늘리지 않았다. DX10(`setTimeout(…, 숫자)` 금지)을 지킨다.
7. **DS7을 HTML 요소(소문자 태그)의 `title=` 속성으로 좁혔다**(`lint.mjs`, `lint.test.mjs`에 한 줄). `Dialog`·`Notice`의 `title` prop은 툴팁이 아니라 제목이라 대문자 컴포넌트는 보지 않는다. 이 조정으로 허용 항목이 311 → 255로 줄었다(DS7·DX5·DC10·DC11 일부가 배선으로 사라졌다). 이후 `allow.json`은 (c)의 C7이 정리했다.
8. **legacy 절을 지웠다.** 옛 토큰 이름이 `app/src`에서 0개가 되어(마지막은 갤러리의 `--gutter`·`--weight-semibold`) `scripts/design/legacy.mjs`·`tokens.mjs`의 legacy 절·`SECTIONS`·`APP_SECTIONS`의 `legacy`를 지웠고 `tokens.css`를 다시 만들었다. `--pct-w`·`--z-sticky`는 사용처가 생겨 DT3·DT13 허용 항목이 사라졌다. `spec-check.mjs`의 `legacyOk`는 문서가 이력으로 언급하는 이름 목록이라 남기되 생성물에서 사라진 이름(`--fg-faint`·`--dur-*`)을 뺐다(이름은 historical 언급용 변수일 뿐이다).
9. **`ui-visual` 인용의 예외.** 완료 조건은 "`git grep ui-visual`이 이력 문장만 남김"이다. 코드 주석의 인용은 0이 됐고 `docs/design/ui-visual.md`는 삭제했다. 남는 곳은 (가) 이 명세와 ADR·ROADMAP의 이력 문장, (나) `docs/design/app.md` 구현 중 변경(39·45·67 등)과 그 표 — "본문은 설계 당시 기록"이라 고쳐 쓰지 않는 절(app.md 50), (다) `docs/research/design-system.md` — 근거 원문이라 고치지 않는다. `CLAUDE.md` 5행은 사용자 승인으로 "시각 규칙은 `docs/design/system/`(디자인 시스템 「무색」)"로 바꿨고, 남은 `ui-visual.md` 언급은 "옛 … 대체한다"는 이력 문장이다.
10. **로그인 화면 버튼은 `auth.ts`의 `loginScreen` 동작 그대로다**(확정된 사용자 결정). 저작권 줄 `© {year} {owner}`는 owner가 정해지지 않아 그리지 않는다(J20). 서비스 공지 B5·종류 차단·서킷은 앱에 공지 데이터가 없어((e) Worker `/notice` 뒤) 배너 우선순위 표에 자리만 두었다. D6 데이터 요금 대화상자는 v1.1이라 키·화면·갤러리가 없다(대화상자 "7종" 검사는 D6을 뺀 6종).
11. **ko.ts 키는 조립하지 않는다.** `` t(`settings.textScale.${v}`) ``처럼 키를 조립하면 DC11 "미참조"에 걸리고 `CopyKey` 타입을 잃는다. 값 → 키는 `Record<TextScale, CopyKey>` 같은 리터럴 표(`satisfies`)로 고른다. DC11은 소스 글자에서 `\b키\b`를 찾으므로 `auth.logout()` 같은 메서드 호출도 참조로 세는 오탐이 있어, 참조 검사 뒤 남은 죽은 키(`auth.logout`·`update.later`)는 손으로 지웠다.

### (d) 문구

1. **`allow.json`이 185 → 11이 됐다.** 이유 "(d)" 144개와 Worker `copy.ts`의 "(e)" 30개(사용자 결정으로 문구는 (d)가 반영했다)가 사라졌다. 남은 11개는 `site-css.ts`·`site-css.generated.ts`의 DT2·DT3 6개(이유 (e), Worker 생성 CSS)와 DC10 5개(이유 (f), `job.status.waitingNetwork` 등 연결 대기 문구)다. `design.allow_entries` 기준을 11로 조였다(로컬에서 센 값, §12 (a)-1 선례). 새 허용 항목은 0이다. `terms.json` allow(키 지정, 명세 문구가 자기 규칙에 걸리는 곳)에는 항목 셋을 더했다: L1 라벨 둘과 `confirmDisallow.title`의 "?"(content §19-17·18).
2. **허용 목록 0은 (e)·(f) 뒤에도 남는 둘이 있다.** DT2·DT3는 (e)가 `site.css`를 새로 만들 때 지운다. DC10 5개는 (f)가 연결 대기 상태를 만들 때 지운다.
3. **DC11을 허용 항목 없이 0으로 둔 방법은 키를 deck에 두지 않는 것이다.** 화면이 없는 키(앱 `settings.keepAwake*`, Worker 21개)는 (e)·(f)가 화면과 함께 되돌린다(content §19-15). 같은 값의 키는 하나로 합쳤다(§19-14). `copy.mjs`의 DC11은 `app/src-tauri/src/**/*.rs`의 인용도 참조로 센다(알림 키, §19-19).
4. **옛 DC10 문서 불일치를 닫았다.** `adminOnly.title`·`badFormat.title`·`retryLater.body`·`landing.contact`는 §15.3에 있다. patterns.md의 action.cancelQueued는 `common.cancel`, clipboard.suggest는 `url.clipboard.title`, drop.hint는 `url.dropHere`로 고쳤다. 종류 차단·서킷 문구는 키 없는 문장으로 두었다.
5. **gate 결과.** `design-copy`·`design-lint`·`design-tokens`·`design-icons`·`scripts-test`·`scan`·`fmt`가 통과한다. `terms.json` allow의 `step3`·`step4`는 이미 실제 키(`settings.cookie.howto.step3|step4`)와 같아 바꿀 것이 없었다.

### (e) Worker 페이지

1. **`design-worker`는 `setContent`가 아니라 순수 렌더 함수 + `page.route`로 페이지를 연다**(§2.6b의 "렌더 문자열을 `setContent`로 넣는다"를 바꾼다). spec(Node, Playwright TS 로더)이 각 페이지의 `render*(config, model) → Response`를 직접 부르고, 그 본문과 헤더(CSP 포함)를 가짜 출처 `https://worker.test`의 `page.route`로 그대로 내보낸다. `/assets/*`는 생성 모듈(`SITE_CSS`·`ASSETS`)에서 준다. 실제 CSP가 브라우저에 걸리므로 인라인 `style` 회귀가 잡히고(콘솔의 CSP 위반 메시지를 실패로 센다), `bypassCSP`는 쓰지 않는다. axe는 `page.evaluate(axe 소스)`로 CSP 아래에서 돈다(`addScriptTag`는 CSP에 막힌다). wrangler dev·DO·R2·`.dev.vars`는 쓰지 않는다. 렌더 함수가 있는 모듈은 `routes`·`store/AuthStore`·`http/r2`·`http/releases`·핸들러 파일·`cloudflare:`를 값으로 import하지 않는다(import 사슬이 Node에서 돌므로 이것이 카나리다). 자세한 것은 `worker.md` 구현 중 변경 98.
2. **구성.** gate 단계는 `worker-config` → `pnpm install --frozen-lockfile`(worker) → `playwright install chromium`(worker) → `shots.mjs run --target worker`이고 `platforms: ['linux']`, 다른 OS에서는 건너뛴다. CI 작업은 ubuntu-24.04 + `fonts-noto-cjk`, `needs.changes.outputs.worker == 'true'`, `OBSERVED_JOBS['design-worker'] = 'worker'`(`ci-ok` 밖), `report`의 needs에 들어 있다. Playwright 프로젝트는 `gallery`(`gallery.spec.ts`)와 `dpr{1,2}-{1280,390}`(`shots.spec.ts`, viewport null + `--window-size` + `--force-device-scale-factor`, §12 (b)-2와 같은 이유)다. 갤러리 환경 행렬은 다섯으로 줄였다(forced-colors는 라이트만, contrast more + reduced motion은 라이트·다크 둘, 1280×800·390×844) — 계약의 환경을 한 번씩 덮으면서 시간을 줄이는 선택이다. 읽기 척도 페이지는 320 폭 리플로우를 따로 본다. 페이지 열여섯 중 스냅샷은 여덟이고(`landing-anon`·`landing-member-mac`·`admin`·`admin-confirm`·`done-denied`·`login-confirm`·`error-404`·`help`) 섹션별(`main`, `landing-anon`만 `header.site-header`·`footer.site-footer`도) × 라이트·다크·forced로 찍는다.
3. **artifact는 `design-worker-actual`(= `target/design-worker/`) 하나다.** §2.6b가 적은 `ratchet-measurements-worker`는 만들지 않았다(`design-shots`와 같이 측정값이 없다: §12 (b)-3). `ci/ratchet.json`의 새 키도 두지 않았고 Worker Playwright 통과 수를 `tests.playwright`에 합치지 않는다(§2.6b 그대로). **§10 (e)의 완료 조건 "`design-worker` gate 신설과 첫 기준선 커밋"을 이 항목이 고친다**: 기준선 커밋은 구현 커밋에 없고 CI 첫 실행 뒤 `--accept`로 넣는다. 기준선은 `worker/e2e/__shots__/<프로젝트>/<이름>.png`(`.gitattributes` `-text`)이고 로컬에서 만들지 않는다. CI에서는 `updateSnapshots: 'missing'`이라 첫 실행이 실패하면서 actual을 남긴다 → `node scripts/design/shots.mjs --accept <run id> --target worker`(`--target`은 `run`·`--accept` 모두 받고 기본은 app). 허용 오차는 `ci/ratchet.json shots.max_diff_pixels`(`design-shots`와 같은 키)다.
4. **selftest에 `design-worker` 씨앗은 없다.** Playwright·chromium이 lint 작업에 없다(§12 (b)-4와 같은 이유). §2.6b의 "깨끗/위반 두 줄"은 두지 않았다. 대신 `design-icons` 씨앗 한 줄(Worker 생성 모듈 `assets.generated.ts`를 손으로 고치면 `worker-gen --check`가 잡는다)을 더했고 `mkRoot({design:true})`의 복사 목록에 `worker/assets`를 넣었다. 깨끗한 사본이 0이다.
5. **`help-check`는 `worker` gate 맨 앞(`worker-config` 다음)에 있다**(DX22). `node scripts/design/worker-gen.mjs --check help`가 (가) 생성물 `help.generated.ts`가 `help/<id>.md`와 같은지, (나) 모든 `help/*.md`가 `help/ids.json`의 `ids`에 있고 `ids`의 id는 `help/<id>.md`가 있거나 `retired`에 있는지, (다) id가 `^[a-z0-9-]+$`인지를 본다. (라) `<details>` 안에 id를 두지 않는 규칙은 생성 데이터에 접힘 개념이 없어 구조로 보장된다. "id는 추가만"은 이력이 없어 기계 검사하지 않고 `retired` 배열과 리뷰로 지킨다(`worker.md` 구현 중 변경 101). help md 부분집합은 `# 제목` 한 줄·빈 줄로 나뉜 문단·`1. ` 목록·펜스 코드이고 그 밖(인라인 코드·강조·링크·이미지·`<`·번호 건너뜀·닫히지 않는 펜스)은 생성기가 실패한다.
6. **생성 모듈 넷과 검사 위치.** `icons.generated.ts`(app `icons.ts`에서 Worker가 쓰는 여섯 이름)·`assets.generated.ts`(`worker/assets/` 바이너리)·`licenses.generated.ts`(`licenses/lucide.txt`)·`help.generated.ts`를 `scripts/design/worker-gen.mjs`(의존성 0, `--write`·`--check`, 대상 `icons`·`assets`·`licenses`·`help`)가 만든다. 앞 셋의 `--check`는 `design-icons` gate(lint 작업, 늘 돈다)가, `help`는 `worker` gate가 돈다. `--check`는 다시 래스터하지 않고 PNG·ICO 바이트를 base64로 옮긴 결과와 저장물이 바이트로 같은지, 에셋 크기(og 1200×630·apple-touch 180×180·ico 16·32 두 층)만 본다. 래스터는 `worker/scripts/render-assets.mjs`로 한 번 찍어 체크인한 것이다(글꼴로 바이트가 흔들려 CI에서 다시 만들지 않는다). svg는 줄끝만 CRLF → LF로 맞춰 해시한다(autocrlf에서도 `--check`가 같다).
7. **generated 모양 검사.** `worker-config.mjs`가 `assets`·`licenses`·`help` 생성 모듈을 소스 낱말 검사(`list`·`put`·`html` …)에서 빼고(base64·라이선스·도움말 본문이 우연히 걸린다) 파일별 모양을 줄 단위 문법으로 본다(`checkGeneratedAssets|Licenses|Help`, `checkGeneratedCss` 선례 §12 (a)-4): 머리 주석 한 줄 + `export const` 하나 + JSON 문자열·base64 문자 집합, 백틱·`${`·`<script`·`<style`·`data:`가 없고 `help`·`licenses` 문자열에 `<`가 없다. `assets`는 hash를 base64에서 다시 계산한다. `icons.generated.ts`는 소스 검사 안에 둔다. `check-tokens.mjs`(DT2·DT3)와 `icons.mjs`(DI4~DI6 소스 훑기)는 `worker/src/http/*.generated.ts`(site-css 말고 전부)를 뺀다. DI2는 `licenses.generated.ts`가 `licenses/lucide.txt`와 같은지를 생성기 `--check`로 본다.
8. **`allow.json` 11 → 5.** 지운 여섯은 `site-css.ts`의 DT2 넷(`--box`·`--line`·`--muted`·`--warn`: 옛 파일이 지워졌다)과 `site-css.generated.ts`의 DT3 둘(`--text-hero`·`--leading-hero`: `site.css`가 쓴다)이고, 남은 다섯은 (f)의 DC10(연결 대기 문구)이다. `ci/ratchet.json design.allow_entries`를 5로 조였다. 새 허용 항목은 0이다. `site.css`의 링크 색 규칙은 `a:not(.btn)`으로 한정했다(`web.md` §15-13).
9. **도구·훅.** `scripts/ci/tools.json`의 `playwright`가 `npm: "app,worker"`가 됐고 `worker-config`가 `worker/package.json`·tools.json·`app/package.json`의 `@playwright/test` 버전이 같은지 대조한다(§12 (a)-9가 (e)로 넘긴 등록). `axe-core`도 worker devDependency(app과 같은 버전)다. 배포 번들에는 들어가지 않으므로 Worker 런타임 의존성 0은 그대로다. `worker/e2e/**`·`playwright.config.ts`는 `worker-config`의 소스 낱말 검사(`.dev.vars` 이름·bidi)에 들어가고 `tsconfig.json`에는 넣지 않는다. Dependabot worker 항목에 그룹 `playwright`를 더했다. 훅은 pre-commit `design-icons`에 `worker/assets/`·생성 모듈 셋(icons·assets·licenses)을, pre-push `worker`에 `help/`·`worker-gen.mjs`를 더했다(`design-icons`는 help를 보지 않으므로 pre-commit에 `help/`를 넣지 않았다).
10. **Worker vitest는 크게 늘었고 `tests.worker` 기준은 CI 측정으로 올린다.** 계약 시점의 1222에서 이 단계 끝에 1500대가 됐다(올리는 값은 `ratchet.mjs write --from-run`이 정한다). `design-worker` D14 시작일은 §10 「단계 공통」이 적는다.
11. **(e)가 남긴 사람 몫.** §10 (e) 완료 조건의 `R8` 기록(키보드 완주: skip link → 헤더 → 본문 → 바닥글, 1280·390)은 이 PR에 첨부되지 않았다. 실기 확인(macOS "그래도 열기" README §6-11, 카카오 공유 디버거, `/privacy` 본문의 법적 검토와 실제 연락처)도 사람이 한다.

### (f) 셸·OS 통합

1. **고른 것의 본문은 `platform.md` §22 26~45다.** 이 절은 gate·검사·운영만 적는다. 코어는 `core.md` 구현 중 변경 56·57, CI 스크립트는 `cicd.md` 114, 앱은 `app.md` 73, 패턴은 `patterns.md` §17-33, 문구는 `content.md` §19-25가 소유한다.
2. **DX14~DX16(소스 훑기)은 `release-hygiene`가 바이너리 검사 앞에서 돈다.** DX17(TCC 안내 ↔ 서명 신원)·DX20(22.04 컨테이너 `--smoke`)·DX21(아이콘 산출물)은 TCC 안내와 D33(앱 마크)이 없어 만들지 않았다(이월, platform §22 44). DX19는 `smoke.mjs checkMarker`가 여섯 키와 probe 전부 true를 요구한다.
3. **`allow.json` 5 → 0, `design.allow_entries` 0.** 남았던 DC10 다섯(연결 대기 문구)이 deck에 키가 생기며 사라졌고 새 허용 항목은 0이다. DT2·DT3·DC10·DC11 모두 허용 목록 없이 통과한다.
4. **ADR 0022~0024.** D29 Dock 집계, D56 클립보드 제안, D40 연결 대기를 채택(잠정)으로 썼다. §10 (f)가 적은 세 번째 ADR "Windows 실기 결과(README §6-1)"는 **만들지 않았다**: 실기 결과가 없고, 결과 없는 ADR은 근거가 비어 있다. 결과가 나오면 그때 쓴다(ROADMAP 남은 사람 몫).
5. **완료 조건 중 이 PR이 닫지 못한 것.** `R4` Windows 실기 2장은 사람 몫이라 첨부되지 않았다. `smoke-bin` 통과는 mock·로컬 macOS 기준이고, `visible:false` → show가 실제 화면에서 흰 번쩍임 없이 도는지는 M1/M2/M3 실기 항목이다. 3 OS `tauri` 작업의 녹색은 CI가 처음 본다(특히 Windows `webview_win.rs`와 `GateProxy`의 std 소켓·스레드는 이 Mac에서 돌려 본 적이 없다).
6. **ratchet.** `tests.*`는 `ratchet.mjs write --from-run`으로 CI 측정 뒤 올린다. `size.binary.*`는 window-state·keepawake로 커졌을 수 있어 CI 측정 뒤 `RATCHET_LOG.md` 줄과 함께 올린다(로컬은 darwin만 안다). `design-shots` 기준선은 `jobStateSet`에 행 둘(연결 대기, 45일 전에 멈춤)이 늘어 `jobs-all`·`jobs-all-windows`·`jobs-toast`의 3테마 × 3화면이 모두 바뀐다. 머지 뒤 `shots.mjs --accept`가 필요하다.
7. **관찰 작업 편입.** `e2e-native`의 창 보임 대기(`visibilityState`)는 [잠정]이다. 첫 CI 실행에서 확정한다. `design-worker`의 D14 시작은 (e) PR #70 머지 뒤 첫 master 녹색 실행이다(편입 예정일은 ROADMAP).

### 다음 단계로 넘기는 문제

- **(b)**: ① 메뉴·토스트·대화상자의 등장·퇴장 전환(`@starting-style`이 금지라 `ui.css`에 없다): 컴포넌트가 처리하거나 ADR을 쓴다(components §7-2). **처리됨**: ADR 없이 `data-motion` 훅으로 해소했다(components §7-10). ② `app.css`가 전역 규칙·`cursor`·`user-select`를 가져간다(components §7-8). **처리됨**: `app.css`가 가져갔다(components §7-18). ③ `vocab.ts`·`licenses/lucide.txt`·`icons.generated.ts`가 생기면 DP1·DI2 허용 항목(항목 6)을 지운다. **처리됨**: `vocab.ts`·`licenses/lucide.txt`가 생겨 DP1·DI2 항목을 지웠다. ④ `design-shots` gate·작업을 `design-gallery`와 함께 만들고 `OBSERVED_JOBS`에 등록한다(항목 12). **처리됨**: 만들었고 `OBSERVED_JOBS`에 등록했다((b) 2~4). 기준선은 첫 CI 실행의 artifact를 `shots.mjs --accept`로 받는다. ⑤ DT3 미사용 허용 항목 후보 `--motion-base`·`--motion-slow`·`--ease-in`·`--pct-w`와 DT13 `--z-sticky`(입력줄이 쓰기 전까지)는 쓰임이 생기면 지운다. **일부 처리됨**: `--motion-base`·`--motion-slow`·`--ease-in`은 `ui.css`의 등장·퇴장 훅이 써서 지웠다. `--pct-w`·`--z-sticky`는 (c)에서 쓰인다. ⑥ `e2e-web` 통과 수 기준(7)을 현재 20으로 올릴 수 있다(CI 측정으로 `ratchet.mjs write --from-run`). **통합 단계로 넘김**: 갤러리가 통과 수를 바꾸므로 CI 측정 뒤 `ratchet.mjs write --from-run`으로 조인다.
- **(c)**: legacy 절과 `legacy.mjs`를 지운다. `DropOverlay.svelte`의 DX13 위반은 오탐이 아니라 진짜 위반이다. 허용 항목을 0으로 줄이는 단계다. **처리됨**: legacy를 지웠고 (c) 이유의 항목은 0이다. 전체 0은 §12 (c) 1이 (d)·(e)로 넘겼다.
- **(d)**: content §19-9의 문서 불일치(웹 키 넷, DC11 중복)를 닫고 DC10·DC11 허용 항목 약 145개를 지운다. `terms.json` allow의 추정 키 `step3`·`step4`를 실제 키에 맞춘다. **처리됨**: 허용 항목이 185 → 11이 됐고(§12 (d) 1), `step3`·`step4`는 이미 실제 키였다. (e)로 넘기는 것: Worker 페이지 구조(`<caption>`·`<ol>`·skipLink·확인 페이지·고지 배치, content §19-15가 적은 키 21개를 되돌린다)와 `site-css` DT2·DT3 6개. (f)로 넘기는 것: DC10 5개(연결 대기 문구)와 `settings.keepAwake*`.
- **(e)**: `site.css` 링크 색 규칙을 `a:not(.btn)`으로 한정한다(web §15-13). `worker.md` 구현 중 변경 95를 따른다. Worker가 생성물을 처음 쓰는 단계이므로 옛 `site-css.ts`와 DT2 허용 항목 4건이 사라진다. **처리됨**: `site.css`가 `a:not(.btn)`로 한정했고 옛 `site-css.ts`와 DT2·DT3 여섯 항목이 사라졌다(§12 (e) 8). Worker 페이지 구조(`<caption>`·`<ol>`·skip link·확인 페이지·고지 배치)와 되돌릴 키 21개는 모두 (e)가 반영했다(`content.md` §19-21). (f)로 넘기는 것: ① 앱 아이콘(`app/src-tauri/icons/icon-source.svg`)은 청록 `#0f766e`이고 Worker 파비콘·`apple-touch-icon`·OG의 글리프는 D5 파랑 `#0067DF`라 어긋난다(임시 글리프 `web.md` §9.3 [잠정], D33 앱 마크가 정해지면 둘을 다시 맞춘다. 확인: D33 결정). ② 앱이 `GET /notice`를 읽어 배너·종류 차단·서킷을 그리는 일(`app.md` 구현 중 변경 72, ADR-0020). ③ 앱 수신기 결과 페이지(`ReceiverPage`, Worker 밖)의 색을 토큰 파랑으로 맞추는 일(`web.md` §6.5). ④ DC10 허용 항목 5개(연결 대기 문구)와 `settings.keepAwake*`는 (f)가 상태와 토글을 만들 때 지운다. ⑤ `design-worker`의 스냅샷 기준선 커밋은 머지 뒤 사람 몫이다(§12 (e) 3). **처리 표시((f) 단계)**: ① 이월(D33 선행). ② 이월: 새 command·배너 B5 순위·차단 규칙이 한 단계 분량이라 (f) 다음 후속 PR. ③ 이월(수신기 색 정렬, 이번 (f)에서 건드리지 않았다). ④ **처리됨**: 연결 대기 상태와 `settings.keepAwake*` 토글을 만들며 DC10 다섯과 `settings.keepAwake*`가 모두 사라졌다(§12 (f) 3). ⑤ 사람 몫으로 남음(ROADMAP).
- **(f)**: 다음으로 넘기는 것은 `platform.md` §22 44의 이월 여덟이다. 특히 `GET /notice` 소비(후속 PR), 앱 아이콘 ↔ 파비콘 정렬(D33 선행), `VolumeProbe` block/warn(문구 8종 선행)이 있다. 사람 몫(R4 Windows 실기 2장, §21 M1~M25 실기, forced-colors M15, Windows 크기 반올림, `/privacy` 문안, "받다 만" 잠정 문구)은 ROADMAP에 있다.
