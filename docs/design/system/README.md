# VOD 클립 다운로더 디자인 시스템 「무색(無色)」

**정의**: 앱이 자기 색을 지우고 콘텐츠·상태·OS 관례만 남겨, 비기술자인 스트리머와 지인이 설명 없이 "붙여넣고, 받고, 파일을 찾는" 일을 끝내게 하는 디자인 시스템이다. Tauri 2 + Svelte 5 데스크톱 앱(`app/`)과 Cloudflare Worker의 서버 렌더 페이지(`worker/`: 랜딩·로그인·관리)가 **한 시스템**이고 전면 적용한다(사용자 결정 1~4).

이 폴더의 문서가 시각·문구·컴포넌트·패턴의 **단일 원천**이다. `README.md`(이 문서)가 결정을, `foundations.md`가 토큰을 확정하고 나머지 문서는 둘을 참조만 한다. 모든 규칙에는 (a) 근거(ID 또는 출처)와 (b) 강제 수단(gate 이름 또는 리뷰 체크리스트 번호 `R*`)이 붙는다. 강제할 수 없는 규칙은 적지 않았다. 확인되지 않은 값은 **[잠정]**, 출처 없는 선택은 **[취향]**으로 표시했다(§6에 모았다). 예시 값(제목·크기·날짜)은 전부 가짜다.

작성 2026-10-09, 편집 2026-10-10(검토 3편 반영). 입력: 결정 브리프(D1~D62, 제약, 현재 결함), 검증 보고서 6개(refuted 값은 쓰지 않았다), 방향 후보 A「무색」·B「작업대」·C「또렷한 다정함」과 판정. 근거는 `docs/research/design-system.md`의 ID로 인용한다: `E-*`(검증된 사실) · `X-*`(버린 주장, 인용 금지) · `A-*`(현재 코드 결함) · `G-*`(격차 보고서 규칙) · `J-*`(판정) · `C1`~`C8`(어울림 기준) · `UT1`~`UT7`(과업) · `Q*`(열린 질문). ID가 없는 절은 약칭 인용(brief §…·judgment §…·users §…·a-copy §…)으로 남기고 "검증되지 않은 조사 서술"로 읽는다(그 문서 §0.3). 보고서 규칙(`G-*`)과 이 시스템의 결정이 다른 곳은 그 문서 §8.1 표가 "뒤집음"으로 적었다.

---

## 1. 원칙

다섯 개다. 각 원칙은 페르소나(현우: Windows·OBS·밤 편집·끊김 불안 / 소영: Mac·사무용 사용자·설치 장벽, users §1.3)와 어울림 기준 C1~C8(users §6)에 근거를 둔다.

| # | 원칙 | 사용자 근거 | 서비스 근거 | 강제 |
|---|---|---|---|---|
| P1 | **OS의 일부처럼.** 수치는 OS 실측·HIG에서 가져오고, 가져올 수 없는 것만 WCAG로 정한다. WCAG가 더 엄격하면 WCAG가 이긴다. 네이티브 타이틀바, OS 커서, OS 스크롤바, OS 진법 | 비기술자는 "OS와 같은 크기·간격"을 설명 없이 읽는다(desktop §3.1). 소영의 최대 불안은 "수상한 앱"(users §1.3) — OS와 같은 얼굴이 가장 설득력 있는 신뢰 신호다 | 글자 13/16, 컨트롤 24/28/36, 가장자리 20, 형제 8, 라벨 6이 전부 AppKit 실측 confirmed(`E-APPLE-02`·`E-APPLE-17`·`E-APPLE-19`). 어두운 환경·배율 100%가 가장 취약하므로(brief §2.4·§2.6) 대비는 실측 AA 이상 | `design-tokens`(대비 전수), `design-lint`(하한·커서·스크롤바), `tauri`(타이틀바·창 설정) |
| P2 | **색은 두 뜻만.** 파랑 = 켜짐·선택·주 동작, 빨강 = 위험. 바탕은 순수 무채색, 정보는 중립, 종류 배지는 글자, 성공색 없음[잠정] | 색맹·야간 모드·HDR에서 색 판별이 흔들린다(g-scale). 색이 적을수록 세 겹(색+아이콘+문구)의 나머지 두 겹이 강해진다. 현우는 "지금 받는 중인 행"을 보러 창을 연다(T2) | C1 검사가 토큰 스캔으로 끝난다(녹색 토큰 0개). HIG "한 색에 한 의미"(`E-APPLE-12`). 정보 배너가 브랜드색과 겹치던 결함(`A-VIS-41`)과 배지 3색 소음(`A-VIS-31`)이 사라진다 | `design-tokens`(C1 HSL 스캔, 초록 0개), `design-icons`(오류·경고 모양 분리) |
| P3 | **한 화면에 확정 지점 하나.** 채워진 버튼은 창에 하나([받기]). 대화상자는 오른쪽 끝 = 안전 = 채움 = Enter, 파괴 동작은 왼쪽 빨간 글자. 퍼센트는 늘 보인다 | T1 "붙여넣기 + 확정 1회"(C4). 비기술자는 선택지가 많으면 멈춘다. 실수 비용이 0인 배치(안전한 쪽이 기본)라 Enter를 눌러도 손실이 없다 | HIG 주 버튼 뷰당 1~2 + 현행 명세 "하나"(`A-VIS-06`). NN/g "위험한 쪽을 기본으로 두지 않는다"와 HIG "기본 trailing"을 규칙 하나로 동시에 만족한다(`J-Q3`, 사용자 결정) | `frontend`(Dialog 테스트: 채움 1개·Enter 대상·Esc), `design-gallery`, 리뷰 `R6` |
| P4 | **면으로 위계, 선은 의미 있는 경계에만. 그림자는 떠 있는 것에만.** 창 바탕 위 흰 그룹 상자(시스템 설정 방식). 장식선 α.10, 입력칸·버튼 테두리만 3:1. 다크는 반전이 아니라 네 단계 계단 | 편집자는 어두운 중립 UI에 익숙하다(users §3.3). 실패 행에 빨강이 5겹이던 소음(`A-VIS-20`)과 색 레일이 사라져 목록이 조용해진다 | C3(다크 1급·면 단계·그림자는 떠 있는 것에만)을 치지직 색 없이 따른다. Worker도 같은 면 규칙으로 "같은 제품"이 된다(`A-WORKER` §0) | `design-lint`(`box-shadow` 허용 목록, 선 1·2px), `design-tokens`(경계 3:1), `R1` |
| P5 | **정지가 기본이고 말은 짧고 정직하다.** 자주 쓰는 상호작용엔 전환이 없다. 해요체, 탓하지 않기, 못 하는 것은 먼저 말하기, 비공식임을 첫 화면에서 | 하루 몇 번 열어 10초 안에 끝내는 흐름(T1)에서 모션은 지연이다. 방송 중 화면 노출(brief §1.4)에서 움직이는 UI는 방송에 잡힌다. 현우의 불안("처음부터 받게 될까")에는 "받은 부분은 그대로 있어요"가 답이다(C6) | HIG motion(`E-APPLE-29`), 하한 엔진에서 `linear()`·`@starting-style`을 쓸 수 없다(brief §2.1). C2·C8(비공식·본인 영상만을 사전에), 앱인토스 해요체(`E-KO-A1`) | `design-tokens`(모션 3단·reduce), `design-copy`(어미·금지어·고지 문자열), `worker`(CSP) |

---

## 2. 문서 지도

| 문서 | 내용 | 소유하는 결정 |
|---|---|---|
| `README.md`(이 문서) | 이름·원칙·우선순위·결정 표 D1~D62·열린 항목·변경 규칙 | 전부의 색인 |
| `foundations.md` | 토큰 전부(이름·값). 색·대비·forced-colors, 글자·척도·글꼴 스택, 간격, 크기, 반경·선·면·그림자, 모션·z-index, 레이아웃, 아이콘, 테마, CSS 하한, 생성물 기대 모양 | D1 D3 D4 D5 D6 D8 D9 D11~D20 D22 D23 D24 D27 D31 D32 |
| `components.md` | 컴포넌트 명세: API 어휘(`variant`·`tone`·`size`·`kind`·`state`), 상태(hover·pressed·disabled·focus), 치수 조합, forced-colors 행, 접근 이름 강제. Button·IconButton·TextField·SecretField·Select·Switch·RadioGroup·Disclosure·Menu·Dialog·ConfirmDialog·Notice·Toast·ErrorAlert·EmptyState·Surface·SettingsRow·FieldRow·PageContainer·Badge·ProgressBar·Spinner·Skeleton·Kbd·Icon·AppMark·DropOverlay·Toolbar | D21 D35 D37(해부) |
| `patterns.md` | 화면 패턴: 홈(빈 상태 3단계·최근 영상·붙여넣기 힌트), 영상 카드, 작업 행과 상태 어휘, 설정, 로그인·거부, 대화상자 배치, 알림 위계와 상태 6종, 진행 표시, 완료 후 동작, 연결 대기, 공지. 문구 예시는 두지 않고 `content.md`의 키를 가리킨다 | D36 D37 D38 D39 D40 D41 D56 D57 |
| `content.md` | 문구: copy deck 규칙, 용어집, 어미·구두점·조사, 숫자·단위·날짜·남은 시간 format, 오류 3요소·L0~L3, 고지 문구, 도움말 문체, 외부 문자열 위생 | D34(문구) D42~D51 |
| `platform.md` | 앱 셸: 커서, 타이틀바, 스크롤바, 줌·글자 크기 설정, Dock·작업 표시줄, 창 복원, 테마 선택(Linux), 메뉴 용어, 단축키 표기, 브라우저 키 차단, 클립보드, 잠자기 방지, 저장 위치·경로, OS별 분기 표(진법·라벨·경로) | D2 D7 D25~D30 D47(OS 분기) D55 D56 |
| `web.md` | Worker 페이지: CSP 안에서의 골격(`theme-color`·skip link·heading·`caption`·`th scope`), 읽기 척도 적용 범위, 랜딩 구조·휴대폰 진입·OG, 무스크립트 폼(PRG·flash·오류 요약·멱등), 위험도 2단, 봇·인앱, `/help`·`/privacy`·`/licenses` | D52 D53 D54 |
| `governance.md` | 강제 장치 구현(§4의 gate 일곱 개 명세 `DT*`·`DL*`·`DS*`·`DP*`·`DC*`·`DI*`, 확장 검사 표, 리뷰 체크리스트 R1~R10 본문), 토큰·UI CSS 파이프라인(`design/tokens/*.tokens.json`·`design/ui.css` → 생성기 → `--check`), 근거 등급 E0~E4와 운영(시험 기록 규칙, 텔레메트리 없음), 변경 흐름, 적용 계획 (a)~(f) | D33(과제 등록) D58~D62 |
| `adr/NNNN-slug.md` | 결정 기록(0001~0021). 템플릿과 쓰는 때는 §7 | 개별 결정 |
| `docs/research/design-system.md` | 근거 문서: 약칭 표, 브리프 요약, 검증 결과(confirmed/refuted 목록), 후보 세 개와 판정 요약, 감사 결함 색인(파일:줄). 설계 문서가 인용하는 ID의 원천 | — |

소유권 규칙: 한 결정은 한 문서에만 적는다. 다른 문서는 "`foundations.md` §5.1"처럼 가리키기만 한다. 수치는 `foundations.md`에만 있고(§13 생성물 블록과 §14 상수 표), 다른 문서는 토큰·상수 **이름**을 쓴다. 이름 옆에 값을 함께 적을 때는 `` `--dialog-w` 440``처럼 쓰고, `design-tokens`(DT14)가 §13과 생성물의 패리티를, `scripts-test`의 `spec-check.mjs`(governance §2.9)가 다른 문서의 "이름 + 값" 쌍이 §13·§14와 같은지를 본다. 문구는 `content.md`에만 있고 다른 문서는 copy deck 키를 가리킨다(`design-copy` DC10 문서 패리티).

---

## 3. 읽는 법과 우선순위

1. **이 시스템이 옛 `docs/design/ui-visual.md` 전체와 `docs/design/app.md` §8(화면)·§9(문구)·§10(컴포넌트)의 시각·문구 규칙을 대체한다.** 그 절들의 흐름 규칙(§8.10)·상태 머신·DTO·command는 유지되고, 색·글자·간격·컴포넌트 모양·문구 형식은 이 폴더가 원천이다. 충돌하면 이 폴더가 이긴다. `ui-visual.md`는 대체 표만 담은 호환 스텁으로 남기고(옛 내용은 git 이력의 커밋 `3b9ea8d` 이전, app.md 구현 중 변경 67), 코드 주석의 `ui-visual §n` 인용을 이 폴더의 절로 바꾸는 적용 단계 (b)·(c)에서 지운다. **강제는 적용 PR (a)부터 켜진다. 그 전까지는 R 체크리스트로 지킨다.**
2. `docs/design/app.md`·`worker.md`·`core.md`의 "구현 중 변경"은 그 문서 본문보다 우선한다. 그중 시각·문구에 관한 항목은 이 폴더로 옮기고 원문에는 번호와 "→ system/…"만 남긴다.
3. 이 폴더 안의 우선순위: `README.md` 결정 표 > `foundations.md` > 나머지. 결정 표와 다른 문서가 어긋나면 결정 표가 맞고, 어긋남 자체가 수정 대상이다.
4. 근거의 등급(brief §0.3, g-evid §7.1): E0 외부 지침·플랫폼 규칙, E1 전문가·정적 감사, E2 사용자 자발 신호, E3 우리 사용자 관찰 3명 미만 한 회, E4 두 회 이상 또는 5명 이상. **지금 E3·E4 근거는 하나도 없다.** 그래서 영향이 큰 결정(D5·D11·D16·D36·D42·D44·D62 등)은 "채택(잠정)"이고 첫 사용자 시험(D62)으로 다시 확인한다. 시험 결과는 "N명 중 M명"으로만 쓴다(brief §6.15-2).
5. 사용자가 직접 고른 다섯 가지는 근거만으로 갈리지 않는 결정이었고 뒤집어도 체계가 깨지지 않는다(judgment §3): **강조색 파랑(D5), 헤더에 마크 + 이름(마크가 나오기 전까지 이름만, D33·D34), 대화상자 오른쪽 끝 = 안전 = 채움 = Enter·파괴 동작은 왼쪽 빨간 글자(D36), 앱 본문 13px(Windows 실기 뒤 `--text-body` 하나로 14 전환 가능, D11), 본문 열 가운데 최대 800(D24).**

---

## 4. 강제 수단

규칙마다 아래 이름 중 하나를 단다. gate는 `node scripts/ci/run.mjs <gate>`로 돌고 `scripts/ci/gates.mjs`에 등록된다(cicd.md `parity`). **강제는 적용 PR (a)부터 켜진다. 그 전까지는 R 체크리스트로 지킨다.** 일곱 `design-*` gate는 새로 만들며 명세는 `governance.md`가 적는다. `R*`는 PR 템플릿의 리뷰 체크리스트 번호다.

### 4.1 자동 gate

| gate | 검사하는 것 | 자리 |
|---|---|---|
| `design-tokens` | `design/tokens/*.tokens.json`·`design/ui.css` → 생성물 셋(`app/src/styles/tokens.css`·`app/src/styles/ui.css`·`worker/src/http/site-css.generated.ts`) `--check`, 미정의·미사용 토큰 0, 모든 길이 px·rem 0, 정수 행간·최소 12px, 간격·반경·높이 값 집합, 이름 규칙(foundations §1), 대비 쌍 전수(foundations §2.4, 라이트·다크 판정 92쌍), C1 HSL 스캔, 다크 두 블록 동일, reduce·coarse·contrast 블록 값과 **계산값**(다크 + 대비 증가에서 `--fg-muted` = `--fg`), 시스템 글꼴만(`url(`·`@font-face` 0), z 토큰 사용처 1개, 문서 패리티(§13 사전·§14 상수) | 기존 `frontend`의 `tokens.test.ts`를 대체·확장. `ci-ok` 필수. 검사 번호 `DT1`~`DT17`(governance §2.2) |
| `design-lint` | 선언 단위 파서(`scripts/design/css.mjs`) + 소스 스캔 + prop 어휘: 컴포넌트의 색·px·ms·z-index·font-size·font-weight·border-radius 리터럴 금지, `calc()`는 피연산자가 토큰·`0px`·`100%`·정수 계수뿐인 것만, `--ref-` 직접 사용 금지, 컴포넌트 안 `--` 선언 금지, `!important`, `transition: all`, `outline: none`·`outline: 0`, `:focus-visible`의 `box-shadow`, `forced-color-adjust`, `letter-spacing`, `-webkit-font-smoothing`, `line-height: normal`·리터럴, `break-word`·`justify`, `backdrop-filter`, `cursor: pointer`(앱만), `::-webkit-scrollbar`, 0.5px·1.5px 선(예외: `--icon-stroke` 정의), `calc(… - 1px)`, `translate(-50%`, 정지 글자 요소 `transform`, `:hover`가 `display`·`visibility`·`opacity`·크기를 바꾸는 규칙(`G-INPUT-IN1`), `title=` 허용 목록(`G-INPUT-IN2`), 컴포넌트 안 `@media (pointer …)`·`(hover …)`·`(width …)`, 폭 미디어 쿼리 허용 파일, 좁은 레이아웃 두 블록 동일, 하한 밖 기능(foundations §11 표), `{@html}`, `<svg` 직접 사용, `AccentColor`, `.svelte` 안 한글 리터럴, 셸 규칙(`data-tauri-drag-region`·`not-allowed`·`readText(`·`isImeKey` import·`compositionend`+`setTimeout`·`navigator.platform` 등, governance §2.9) | 신설. `ci-ok` 필수. 검사 번호 `DL1`~`DL14`·`DS1`~`DS9`·`DP1`~`DP5` + 확장 `DX*` |
| `design-copy` | copy deck(`ko.ts`·`errors.ts`·`copy.ts`·`help/*.md`) 검사: 금지어(`(?<!비)공식`·인증·파트너·제공·클릭·"우리"·감탄사·`~시겠어요`·`되어요`·`~기 바랍니다`), 합니다체 어미, 요청 어미 "해 주세요" 단일, "다시 시도해 주세요" 단독 금지, 변수 뒤 조사 패턴(`{…}이`·`‘{…}’은` 꼴 포함) 금지, 숫자+단위 직접 문자열 금지(format 함수만), `...` 세 점(U+2026만), 역할 접미별 마침표, `?`·`!` 범위, 따옴표 ‘ ’만, 구분 기호, 복합어 표기, 중복 값 키 금지, `a11y.*` 어순, 두 deck의 비공식 고지·저작권 줄 동일, 용어집 비표준 어휘(다운로드 동사·링크·조회·폴더 열기·멈춤·중단·허용) 금지, `ol` 대신 번호 박힌 문자열 금지, 오류 코드·HTTP 번호가 제목·본문에 없음, OS 문자열은 `platform` 분기 객체에만, 문서 패리티(`content.md` §15 표 ↔ deck) | 신설. `ci-ok` 필수. 검사 번호 `DC1`~`DC12`(governance §2.4) |
| `design-icons` | `icons.ts` 항목 메타 `{set,name,version}` 필수, 고지 파일과 세트·버전 일치, Feather 유래면 MIT 단락, 은유 유일성(같은 아이콘 ≠ 다른 동작, 예외 `copy`), IconButton 허용 목록(foundations §9 표), stroke가 화면 px 고정(CSS `var(--icon-stroke)`, SVG 속성 리터럴 금지), `currentColor`만, 16·20 두 크기, 앱·Worker 아이콘 원천 동일 | 신설. `ci-ok` 필수. 검사 번호 `DI1`~`DI7`(governance §2.5). DPR1 번짐 측정은 래스터라 `design-gallery`에 있다 |
| `design-gallery` | `/__gallery`(모든 컴포넌트·상태) + 네 화면 + 로그인 화면을 Playwright로 라이트·다크·720×520·960×700·320×231(Windows 텍스트 225% 흉내)·`prefers-reduced-motion`·`prefers-contrast: more`·`forced-colors: active`·`any-pointer: coarse` 흉내·`data-text-scale="x-large"`·`platform=windows` 고정 데이터에서 axe(대비·이름·대상 크기 24/40·리플로우 320), 계산값 검사(다크 + 대비 증가), 정렬선 x, 채움 1개, 아이콘 DPR1 번짐 측정(`icons-blur.mjs`) | 신설. `e2e-web` 작업 안(app 영역). **D14 관찰 중에는 비차단**이고 편입 예정일은 ROADMAP에 적는다. Worker 정적 HTML은 `design-worker` |
| `design-shots` | Playwright 스냅샷(Linux 한 곳, 720·960, DPR 1·2, 라이트·다크·forced) 회귀 | 신설. 관찰 작업(`OBSERVED_JOBS`, app 영역) |
| `design-worker` | Worker 정적 HTML(랜딩·허가·관리·`/auth/done` 결과·확인 페이지·옛 앱 안내)의 갤러리 검사(axe·대상 크기·리플로우 320·forced·contrast more·계산값)와 스냅샷(Linux 한 곳, 1280·390, DPR 1·2, 라이트·다크·forced). `design-gallery`·`design-shots`의 Worker 몫 | 신설. **worker 영역** 관찰 작업(`OBSERVED_JOBS 'design-worker': 'worker'`, `worker/`에 Playwright 설치·`tools.json` 버전 고정). `worker/src/http/`만 바뀐 PR에서도 돈다. 명세는 governance §2.6b |
| `frontend` | vitest·svelte-check: 컴포넌트 단위 테스트(Dialog 버튼 순서·Enter·Esc·포커스, ProgressBar scaleX·reduce, Switch disabled+켜짐, 접근 이름 필수 타입, format 골든, 플랫폼별 설정 행, 로그인 화면 네 요소 렌더, 지연 삭제·토스트 대기열, 취소 라벨·확인 조건), vite `cssTarget` | 기존 |
| `worker` | `worker-config.mjs`: CSP 인라인 `style`·`<style>`·`url(`·`@import` 금지, 골격 meta(`theme-color`·`color-scheme`), 무스크립트 폼 테스트(PRG·flash·오류 요약·멱등), 경로 표 행렬 | 기존 + 골격 검사 추가 |
| `tauri` | `tauri.conf.json` 테스트(decorations·min 720×520·`zoomHotkeysEnabled: false`·`scrollBarStyle`·`visible: false`·window-state), 알림 문자열, Dock 진행 집계, 메뉴 한국어 | 기존 |
| `rust` | 코어·셸: format 함수 골든(JSON을 TS와 공유), `cleanDisplayText`·파일명 자르기, 오류 DTO 원문 분리 | 기존 |
| `scan` | 공개 저장소 규칙(실제 채널·영상·토큰 금지). 문서·fixture의 예시 값 | 기존 |

### 4.2 리뷰 체크리스트(PR 템플릿, `governance.md`가 본문을 소유)

| 번호 | 항목 |
|---|---|
| R1 | 화면을 바꾼 PR은 **네 장**의 스크린샷을 붙인다: 라이트 960, 다크 960, 720×520, forced-colors. 열 정렬선·12px 단독 정보·`fg-disabled` 오용·장식선 단독 의미를 본다 |
| R2 | 토큰을 더하거나 바꾸면 ADR 번호와 근거 등급(E0~E4)을 적는다. [취향] 값은 [취향]이라고 쓴다 |
| R3 | 문구를 바꾸면 copy deck diff와 `content.md` 용어집 대조 결과를 적는다. OS별 문자열은 `platform.md` 분기 표에만 있다 |
| R4 | 글자 토큰(크기·굵기·스택)을 바꾸면 Windows 실기 스크린샷(맑은 고딕 100%·125%)을 붙인다 |
| R5 | 아이콘을 더하면 `foundations.md` §9.1 은유 표에 행을 더하고 광학 보정 시트(격자 위 16·20)를 붙인다 |
| R6 | 대화상자·확인 흐름을 바꾸면 D36 규칙(오른쪽 끝 = 안전 = 채움 = Enter = 기본 포커스, 파괴 = 왼쪽 끝 빨간 글자, 채움은 층마다 1개, Esc = 닫기)과 대조한 표를 적는다 |
| R7 | 새 알림·상태 표시는 위계(행 상태 > 인라인 > 토스트 > 배너 > 대화상자) 중 어디인지, 한 사건에 수단 하나인지 적는다 |
| R8 | Worker 페이지는 JS 없이, 키보드만으로 완주한 기록(`<details>`·폼·skip link)을 적는다 |
| R9 | 새 컴포넌트는 `foundations.md` §2.7 forced-colors 매핑 표에 행을 더한다 |
| R10 | 영향 큰 결정(흐름·화면 구성·핵심 문구·토큰 어휘)을 바꾸면 D62 시험 항목 목록(`governance.md`)에 확인 과업을 더한다 |

---

## 5. 결정 표 D1~D62

열은 최종 값 · 근거 · 강제 수단이다. 근거 끝의 `[잠정]`·`[취향]`은 §6에 확인 방법이 있다. 값의 상세는 "→ 문서 §절"이 가리키는 곳에 있다.

### A. 기반

| D | 최종 값 | 근거 | 강제 |
|---|---|---|---|
| D1 엔진 하한 | **Safari 16.4 / Chrome 111 / WebKitGTK 2.40**, macOS `minimumSystemVersion` 13.3. `cssTarget ['chrome111','safari16.4']` + lightningcss. 하한 밖 기능은 선택지가 아니라 금지(→ foundations §11). 미달 엔진은 시작 때 알린다. Ubuntu 22.04 미갱신(2.36)은 지원 밖 | g-engine, v-desk §2.1(E-04~E-25 행, `E-DESK-E25`)(13.3이 Safari 16.4를 보장하는 첫 macOS). 세 후보 공통 | `design-lint`(금지 목록), `frontend`(vite 설정), `tauri`(minimumSystemVersion) |
| D2 기준 플랫폼 | **macOS 실측 수치가 원천**(A 뼈대). OS가 **규정하는** 값만 분기: 바이트 진법(D47), "Finder에서 보기"/"폴더에서 보기", 경로 표기(`~`·`\`), 메뉴 용어(Apple 한국어), 단축키 표기(⌘/Ctrl). 버튼 순서는 분기하지 않는다(Windows 관례 미확인) | judgment §2.4. 주 사용자가 Windows라는 반론: Windows 수치 관례(14·32)는 Fluent 웹 관례이고 Win32 다운로더는 13px급(A 설명). 분기는 `naming::Platform`처럼 인자로 받아 한 호스트에서 테스트한다 | `design-copy`(OS 문자열은 `platform.md` 표에만), `rust`·`frontend` 골든 |
| D3 토큰 원천 | **DTCG JSON `design/tokens/*.tokens.json` + UI CSS `design/ui.css` → 생성기 `scripts/design/tokens.mjs` → `app/src/styles/tokens.css`·`app/src/styles/ui.css`·`worker/src/http/site-css.generated.ts` 커밋 + `--check`**. 층 ref → sys, comp 비움. 접두 없음. OKLCH 설계 → hex 커밋. 다크 두 블록은 생성기가 복제 | brief D3 권고(bindings·fixture와 같은 패턴), `G-ENGINE-R4`, `A-WORKER-0`(한 원천). C 후보 구조 + A 후보 2층. ADR-0007 | `design-tokens` |
| D4 루트 단위 | **루트 16px, 모든 토큰 px.** 글자 확대는 D28 설정이 글자 토큰만 재정의 | `A-VIS-01`(루트 14로 모든 rem 토큰이 12.5% 작게 렌더되던 P0), g-input(크기 토큰은 글자와 분리) | `design-tokens`(rem 0개) |

### B. 색

| D | 최종 값 | 근거 | 강제 |
|---|---|---|---|
| D5 강조색 | **파랑 OKLCH h 258**(사용자 결정). 채움 `#0067DF`/다크 `#1E72E4`, 글자·포커스 `#085DC7`/`#70ADFB`, 선택면 `#E2F0FF`/`#233651`(→ foundations §2.2·§2.3). 글자용·채움용 분리 | macOS·Windows 기본 강조색이 파랑, C1 범위에서 멀고 상태색과 ΔH 150° 이상, 비기술자에게 "안전한 시스템 버튼"으로 학습됨(`J-Q1`). "정보 = 강조" 혼동(`A-VIS-41`)은 정보 톤을 중립으로 빼서 푼다(D10). 다크 채움은 macOS 값(#0A84FF 3.4:1)보다 어둡게 잡아 흰 글자 4.58:1 | `design-tokens`(C1 스캔, 대비 쌍) |
| D6 중립색 온도 | **순수 무채색(OKLCH C=0)** | Finder·시스템 설정 창 회색이 무채색(apple §3.4). "바탕이 강조색을 모른다"가 어느 강조색에도 맞는다(judgment §2.4). 편집자 색 판단 방해 주장은 출처 없음이라 보조 근거만 | `design-tokens`(gray HSL S=0) |
| D7 테마 | **OS 따름 + Linux에서만 앱 안 선택**(시스템/밝게/어둡게). Worker는 OS만 | HIG "앱별 외관 설정 금지"(`E-APPLE-12`) + Linux GTK3 다크 감지 불신(`G-A11Y-OS10`). B의 3 OS 토글은 버린다 | `frontend`(플랫폼별 행), `design-tokens`(`data-theme` 블록) |
| D8 시스템 강조색 | **고정.** 비활성 창 회색 선택(`data-window-active`)은 채택 | WebKit `AccentColor`는 늘 파랑(`E-DESK-R33`). 업계 고정 우세(desktop). Rust 주입은 v2 후보 | `design-lint`(`AccentColor` 금지), `frontend` |
| D9 다크 바탕·면 | **L .24 / .29 / .32 / .35 계단**(`#1F1F1F` → `#2B2B2B` → `#333333` → `#3A3A3A`), 순흑 없음, 떠 있는 것은 안쪽 1px 흰 α.08~.10 선 | g-scale HDR(brief §6.3-5), K10. 다크 선택면 `#233651`은 fg-muted 4.90:1(`A-VIS-30` 탁함 해소) | `design-tokens`(bg L ≥ .2, 대비) |
| D10 상태·종류 색 | **정보 = 중립**(`--surface-2` + ⓘ), **종류 배지 = 중립 면 + 12px 600 글자**, 성인 = "19" 글자, **성공색 없음[잠정]**, block 공지 = `--warning-soft`(danger 아님) | `A-VIS-31`·`A-VIS-41`, g-icon(종류 배지 아이콘 불필요), g-outage(공지는 사용자 잘못도 손실도 아님), HIG 한 색 한 의미. 성공색 재검토 조건은 §6-5 | `design-tokens`(초록 0, info 색 토큰 없음), `design-icons` |

### C. 글자

| D | 최종 값 | 근거 | 강제 |
|---|---|---|---|
| D11 본문 크기 | **앱 13/16[잠정]**(사용자 결정 4). **Worker 읽기 페이지 15/22**(`html[data-scale="reading"]`, 랜딩·help·privacy·licenses만). 로그인·관리 페이지는 앱 척도. `--text-body`·`--leading-body` 두 줄만 바꾸면 14/18로 전환되고 컨트롤 28은 그대로 | macOS 기본 13(`E-APPLE-01`), C3 12~14, 치지직 웹 12~14. 데스크톱 수렴 14가 반례. 15는 TDS 작은 본문(confirmed)이고 모바일·문서 맥락이라 앱에는 안 쓴다(judgment §2.5). 맑은 고딕 13px **[미확인]** → §6-1 | `design-tokens`(값), `R4` |
| D12 척도·행간 | **12/16 · 13/16 · 13/16 600 · 15/20 600 · 17/22 600**, 읽기 행간 20. 읽기 척도 13/18 · 15/22 · 17/24 · 22/28 · 28/36[잠정]. 행간은 **정수 px 토큰** `--leading-*`. 글자 크기 설정 ×1/×1.3/×2.0[잠정] | macOS 텍스트 스타일(`E-APPLE-02`), bigtech 정수 행간, WCAG 1.4.12·1.4.4. 섹션 13 < 카드 15 < 화면 17 역전 해소(`A-VIS-17`) | `design-tokens`(정수·최소 12), `design-gallery`(x-large 리플로우) |
| D13 굵기 | **400 / 600 두 단계.** 500·700·Light 없음 | SEED "500은 플랫폼마다 다르게 보인다", KRDS 기본 400+700. 맑은 고딕의 굵기는 Semilight·Regular·Bold 셋(`E-A11Y-D25`)이고, CSS 600이 Bold로 폴백돼 400과 구별되는지(렌더)만 **[미확인]** → 두 단계가 어느 결과에서도 안전. Light 금지(`E-APPLE-03`) | `design-lint`(font-weight 리터럴), `R4` |
| D14 자간 | **전면 0.** `letter-spacing` 선언 없음 | SF 트래킹 곡선에 가산(`E-APPLE-04`·`E-APPLE-05`), klreq·KRDS 0 | `design-lint` |
| D15 글자 다듬기 | **설정하지 않음** | macOS 전용(`E-DESK-E31`), 한글 굵기 단계를 흐림(`G-ENGINE-R6`, g-scale) | `design-lint` |

### D. 밀도·형태

| D | 최종 값 | 근거 | 강제 |
|---|---|---|---|
| D16 컨트롤 높이 | **24(sm) / 28(기본) / 36(랜딩 CTA만)**, 설정 행 36, 툴바 44[취향], 터치(`any-pointer: coarse`) 40/40/44·행 44·히트 40 | AppKit regular 24·large 28·XL 36 **confirmed**(`E-APPLE-19`, `E-DESK-R37`). "32 수렴" 부분 refuted. 36 기본은 웹 냄새(desktop). Windows 터치 40epx(`G-INPUT-IN4`) | `design-tokens`(coarse 블록), `design-gallery`(대상 크기) |
| D17 간격 | **2·4·6·8·12·16·20·24·32·40**, 가장자리 20, 형제 8, 라벨 6. 이름 = 값. 광학 보정 토큰 없음 | AppKit 상수(`E-APPLE-17`), bigtech 2px 반단계 confirmed | `design-tokens`(값 집합), `design-lint`(px 리터럴) |
| D18 반경 | **배지 4 · 컨트롤 6 · 그룹 10 · 오버레이 12 · 알약(스위치·막대만)**. 동심 10 − 4 = 6 | WWDC25 356 동심(유도식임 명시), Win11 오버레이 > 표면, HIG 캡슐은 눈에 띄는 동작에만(`E-APPLE-20`) | `design-tokens`, `design-lint` |
| D19 면·경계 | **혼합**: 바탕 > 흰 그룹 상자(α.10 장식선) > 떠 있는 것(그림자 3단, 다크 안쪽 선). 의미 경계 `#808080`/`#868686` 모든 바탕에 ≥ 3:1(3.12~4.53). 선은 1·2px만 | brief §6.3(g-scale 실측: 1px은 모든 배율에서 선명, 흐린 원인은 색 부족), `A-DRIFT-S1`(UrlBar 2.89 위반 해소), K10. HIG 베젤(α.15)보다 진하다 — WCAG가 이긴다(P1) | `design-tokens`(경계 8쌍), `design-lint`(선 굵기·box-shadow 허용 목록) |
| D20 포커스 | **`outline: 2px solid var(--focus)` + `outline-offset: 2px`**, 색 `--accent-ink` 불투명(bg 5.57 / 7.11). 버튼류는 `:focus-visible`(키보드만), 입력칸은 브라우저 휴리스틱. `[tabindex="-1"]` 컨테이너만 링 숨김 | g-scale(outline은 정수 스냅, box-shadow 링은 반 픽셀 번짐), `E-KO-B6`(forced-colors에서 box-shadow none → 현재 링이 사라지는 P0 F1 해소), WCAG 2.4.13(2px·3:1). macOS α0.5 링은 3:1 미달이라 불투명 | `design-lint`(`outline: none` 금지, 포커스 box-shadow 금지), `design-gallery`(forced) |
| D21 상태 레이어 | **개별 토큰.** hover는 유령 버튼·아이콘 버튼·메뉴 항목·최근 목록 행만(`--surface-2` 채움), 테두리 버튼·작업 행·스위치는 hover 없음. 눌림은 모든 컨트롤이고 hover와 다른 면(`--surface-pressed`, 위험 톤은 `--danger-soft`). 비활성은 전용 색 `--fg-disabled`(opacity 금지), 사유가 있으면 보인다. hover는 상태(오류 테두리)를 덮지 않는다. 유령 버튼 글자는 `--fg`(파랑 아님: 행마다 파랑·빨강이 겹치지 않게, P2) | `E-DESK-R30`(Raycast·Evil Martians), HIG 눌림 필수(`E-APPLE-21`), `A-DRIFT-K4`, `A-PRIM-T1`(hover가 invalid를 덮던 특이도 버그), `A-VIS-29`(비활성 주 버튼 회색 상자 → 홈에 채움 버튼 없음) | `design-lint`(`G-INPUT-IN1`·`G-INPUT-IN7`, opacity 비활성), `frontend`, `design-gallery`(hover ≠ pressed 계산값) |
| D22 모션 | **100 / 200 / 300ms**, `cubic-bezier(.2,0,0,1)` 등장·`(.4,0,1,1)` 퇴장, 스프링 없음. reduce: base·slow·진행 1ms, fast(눌림)·opacity 유지, 정보는 숨기지 않음 | NN/g 100~500·등장 > 퇴장(`E-KO-B2`), HIG bounce 0(`E-APPLE-28`·`E-APPLE-29`), web.dev 1ms. 현재 0ms 전면(transitionend 깨짐, 막대 숨김 버그) 탈락 | `design-tokens`(reduce 블록), `design-lint`(ms 리터럴) |
| D23 진행 막대 전환 | **`transform: scaleX` 250ms linear, 값이 줄면 전환 없이 즉시.** forced-colors: 트랙 1px CanvasText, 채움 Highlight, 일시정지 Canvas + 2px CanvasText | g-launch(합성 단계), `G-INTER-DL6`(뒤로 가지 않음), K9 재정의. 틱 250ms = 전환 길이라 계속 움직여 보인다 | `frontend`(ProgressBar), `design-gallery`(forced·reduce) |
| D24 레이아웃 | **열 하나 `--content-max: 800`**(사용자 결정 5), 가운데, 가장자리 20, 툴바 안쪽·배너·토스트·대화상자 같은 열 기준. **분기 600 하나**[잠정] | `A-VIS-02`~`A-VIS-04`(폭 3종·기준선 3종·840 분기 6곳 P0). 720 창에서 꽉 차고 960에서 좌우 80. 800은 A 720·B 960 사이 절충으로 **출처 없음 → ADR-0001** | `design-tokens`, `design-gallery`(720·960), `design-lint`(폭 쿼리 파일 둘) |

### E. 셸·플랫폼

| D | 최종 값 | 근거 | 강제 |
|---|---|---|---|
| D25 커서 | **앱은 `default`**(선택 가능한 글자·입력칸만 `text`, 진짜 URL만 `pointer`, 비활성도 `default`). **웹은 링크·버튼 `pointer`** | HIG pointing-devices(손가락 = URL 링크, `E-DESK-N07`), MS(클릭 가능 요소에도 화살표), Raycast | `design-lint`(앱 CSS `cursor: pointer` 금지) |
| D26 타이틀바 | **네이티브 유지.** 본문 툴바 44에 왼쪽 [마크 + "VOD 클립 다운로더"(마크 전까지 이름만, 13px 600)], 오른쪽 [계정 ▾]·[설정] | HIG "커스텀 창 UI 금지"(`E-APPLE-15`), Windows Snap Layout 보존(`G-SHELL-H10`). 이름을 그리는 이유: Linux 일부 창 관리자·전체 화면에서 타이틀바가 숨으면 앱 이름이 어디에도 없다(`J-Q2`, 사용자 결정) | `tauri`(decorations), `frontend`(툴바 이름) |
| D27 스크롤바 | **OS 기본** + Windows `scrollBarStyle: fluentOverlay`. `scrollbar-gutter` 못 쓰므로 여백 예약 없음(열 좌우 여백이 흡수) | `E-DESK-R24`(WebView2 125+), N-12·N-13 | `tauri`, `design-lint`(`::-webkit-scrollbar` 금지) |
| D28 줌·글자 크기 | **웹뷰 줌 끔**(`zoomHotkeysEnabled: false`) + 설정 › 보기 › 글자 크기(기본/크게/아주 크게 = ×1/×1.3/×2.0, `data-text-scale`)[잠정]. 컨트롤은 `min-height`라 따라 늘어난다 | WCAG 1.4.4·HIG 200%(`E-APPLE-08`), macOS에 Dynamic Type 없음, `G-SHELL-H3`(Ctrl+±는 실수로 화면이 깨진다), g-input | `tauri`, `design-tokens`(블록), `design-gallery`(x-large) |
| D29 Dock·작업 표시줄 진행 | **켬.** 집계 규칙 g-shell §5.2, 초당 1회 이하, 고대비에서 숨김, 배지는 v1에서 끔. Windows 상태 PAUSED(노랑) ≠ ERROR | Transmission 선례(users §4), `E-DESK-N31`(상태 우선순위 confirmed). "OS의 일부"라면 OS의 진행 자리를 쓴다(P1). ADR-0022 | `tauri`(집계 테스트) |
| D30 창 상태 복원 | **window-state 플러그인 + `visible: false`** → 첫 그림 뒤 show(안전장치) | HIG launching(이전 상태 복원), `E-DESK-R40`(복원 뒤 보이기), g-launch 흰 번쩍임 3겹 | `tauri` |

### F. 아이콘·정체성

| D | 최종 값 | 근거 | 강제 |
|---|---|---|---|
| D31 아이콘 세트 | **Lucide**(ISC + Feather MIT). path 벤더링 `icons.ts` + `{set,name,version}` 메타. 고지는 앱 정보·`licenses/`·`/licenses`에 **즉시**(현재 고지 0개는 위반 상태) | g-icon(SF Symbols·Segoe Fluent Icons 글꼴 사용 불가, brief §2.7; Tabler·Phosphor 등 탈락 사유), 현재 Feather path와 연속 | `design-icons` |
| D32 아이콘 크기·굵기·은유 | **16 / 20 두 크기**(32 없음, 12 금지), **`non-scaling-stroke` 1.5px 고정[잠정]**, `currentColor`, 광학 보정은 에셋 안. 은유 표(→ foundations §9.1): 이어받기 `play` ≠ 다시 시도 `rotate-cw`, 취소는 글자 필수, 오류 `circle-x` ≠ 경고 `triangle-alert`, 완료 `check`, 파일 `file-video`, 폴더 `folder`(라벨만 OS별). 글자 없는 아이콘 버튼은 foundations §9 허용 목록만 | `G-ICON-3`·`G-ICON-4`(뒤집음: 32 없음, 1.5 고정)·`G-ICON-7`(은유 충돌 `A-VIS-23`·`A-VIS-09`·`A-FEAT-G6` 해소), HIG 옆 글자 굵기(`E-APPLE-31`), NN/g 라벨, 상자−아이콘 차 짝수. 1.5의 DPR1 번짐은 §6-4 | `design-icons` |
| D33 앱 아이콘 | **별도 과제**(ADR로 등록). 조건: 전경·배경 분리 원본, 플레이트 = D5 파랑 하나, 치지직 로고·색과 다름, 16px에서 선 2px 이상, 흑백 식별, 글자 없음. 결과물이 **헤더 마크**가 된다(그 전까지 헤더는 이름만) | g-id(Icon Composer 레이어·마스크 이중, Windows 다크 작업 표시줄 대비 2.98 경계), C1, `J-Q2` | `governance.md` 과제 등록, `R2`, 5초 시험(D62) |
| D34 앱 이름·고지 | **"VOD 클립 다운로더" 유지** + 비공식 고지 **4곳**: 랜딩 히어로 바로 아래(스크롤 없이), 랜딩 바닥글, 로그인 첫 화면, 설정 › 정보. Worker 헤더에만 배지 "비공식 도구"(반경 4, 알약 아님 — D18). 창 제목에는 붙이지 않음. 문구는 상수(긴 판 `NOTICE_UNOFFICIAL`·한 줄 `NOTICE_SHORT`, `content.md` §11). 랜딩 title "VOD 클립 다운로더 — 치지직 영상을 받는 비공식 도구" | `G-ID-R1`·`G-ID-R2`, C2(미충족 → 충족), YouTube API 브랜딩 관례. 개명 트리거(약관 금지·네이버 이의·공개 스토어·KIPRIS)는 `governance.md` §9. 치지직 약관 상표 조항 **[미확인]** → §6-9 | `design-copy`(금지어·두 deck 동일), `worker`(랜딩 고지 위치 테스트) |

### G. 컴포넌트·패턴

| D | 최종 값 | 근거 | 강제 |
|---|---|---|---|
| D35 API 어휘 | **`variant`(외형만, 컴포넌트별 리터럴) · `tone`(neutral/info/warning/danger, 컴포넌트는 부분집합) · `size`(sm/md/lg) · `kind`(vod/clip/rewind/adult, Badge만) · `state`(active/paused/failed/waiting, ProgressBar만)**. 위험은 `tone=danger`(의미). 알림은 **Notice 하나**(`tone × variant`, variant = inline/banner/row/toast). 불리언 prop은 `disabled`·`open`·`loading`·`required`·`readonly`·`invalid`만(`checked`는 없다: 값은 `value`), `onX` 이벤트 하나씩, 접근 이름 필수 타입, id 생성기 하나. Button `loading` 추가. 유일한 원천은 `ui/vocab.ts`(components §1, governance `DP1`~`DP5`) | gov, `A-PRIM-N1`(variant에 의도·외형 혼재)·`N6`(닫기 이벤트 2종)·`N9`(이름 prop 4종)·`N10`(접근 이름 미강제 P0), `A-FEAT-N1`~`N9`(알림 9갈래) | `frontend`(svelte-check 타입), `design-lint` |
| D36 대화상자 버튼 | **오른쪽 끝 = Enter = 채움 = 기본 포커스 = 안전한 쪽**(사용자 결정 3). **안전한 쪽 = 그 대화상자를 연 뒤 아무것도 하지 않은 것과 같은 결과**(현 상태 유지: 계속 받기·그대로 두기·나중에·로그인 유지). 실행 쪽은 **왼쪽**이고 되돌릴 수 없으면 빨간 글자 테두리 버튼(`variant=secondary tone=danger`, 버튼 줄 왼쪽 끝), 되돌릴 수 있으면 회색 테두리 버튼(채움 버튼 옆). 채움은 포커스할 수 있는 층마다 하나. **Esc = 닫기**(`onclose`, 어떤 버튼도 실행하지 않는다 = 안전한 쪽과 같은 결과). 포인터로 열어도 포커스는 오른쪽 버튼이고 링은 `:focus-visible` 휴리스틱. OS 분기 없음. 대화상자 7종의 제목·라벨 표는 `content.md` §5.3이 소유한다 | HIG 기본 trailing(`E-APPLE-22`) + NN/g "위험한 쪽을 기본으로 두지 않는다"(`G-INTER-CF4` 뒤집음: 면이 아니라 글자) → 안전한 쪽이 trailing·채움. HIG "취소 leading"과 충돌하는 유일한 경우(취소 확인)는 안전한 쪽이 곧 취소이므로 예외로 명시. 규칙 하나가 대화상자 7종(`A-VIS-05`·`A-VIS-06`)을 모두 덮는다. Windows 관례 **[미확인]**이라 분기 안 함. ADR-0005 | `frontend`(Dialog 테스트), `R6`, D62 과업 V2·V3 |
| D37 알림 해부 | **토스트는 본문 열 기준 하단, 폭 = 열 안쪽 폭, 한 번에 하나 보이고 나머지는 대기열.** 정보·완료 토스트는 **6초[취향]** + hover·포커스 정지, 새 토스트가 오면 즉시 대체된다. 오류·동작 있는 토스트는 대체되지 않고 닫을 때까지 남으며 뒤에 온 것은 줄을 선다(오류가 몰려도 유실 없음). 예외: [되돌리기] 토스트는 6초 + 정지이고 지연 삭제는 그 토스트가 닫힐 때(타이머·[×]·대기열 교체 모두) 확정된다. 같은 동작은 다른 곳에서도. 토스트가 떠 있는 동안 스크롤 영역 바닥에 토스트 높이만큼 여백. 배너는 h1 앞 한 장, 오류 우선, 정보 = `--surface-2`, 경고·block = `--warning-soft`, 오류 = `--danger-soft`. 복사 확인은 버튼 라벨 전환("복사했어요") | Carbon·GOV.UK(`E-KO-31`·`E-KO-32`), `G-INTER-NT5`·`G-INTER-NT6`·`G-INTER-NT7`(`NT7` 10초·`NT8` 3개는 뒤집음: 대기열), `G-OUTAGE` 위계, WCAG 2.2.2(포커스 중만 정지는 수단이 아님), `A-VIS-32`(창 기준 토스트가 목록을 가림). 6초는 출처 없음(ADR-0009) | `frontend`(Toast 대기열·지연 삭제·Banner), `design-gallery`, `R7` |
| D38 OS 알림 | 제목 **"다운로드를 마쳤어요"** / 본문 = 정리된 영상 제목(**40자소 절단[취향]**, 묶음 "{첫 제목} 외 {n}개"). 실패는 따로 묶음. 채널명·경로·URL·쿠키·오류 원문 금지. 앱이 앞에 있으면 OS 알림 대신 행 상태. Linux는 `<>&` 이스케이프. 문자열은 `content.md` §14 한 곳 | HIG 알림(앱 이름 금지·제목 끝 구두점 없음·본문 완전한 문장, `E-DESK-N34`), `G-SHELL-NS21`·`G-SHELL-NS22`(20자·3초는 뒤집음, `X-DESK-N45`), `G-UGT-R*`. 서명 없는 macOS에서 알림이 뜨는지 **[미확인]** | `tauri`(문자열 테스트 = deck 상수), `design-copy` **(d)에서 반영**(구현 상태 표시, 결정 본문은 그대로) |
| D39 완료 후 동작 | **[열기] 다음 [Finder에서 보기]/[폴더에서 보기]**(아이콘 `file-video`·`folder`). 파일이 없으면 [열기] 숨김. 완료 11개 넘으면 그룹 접힘 + 최근 5개. 멈춘 지 30일 "{n}일 전에 멈췄어요 · 디스크 {size} 차지". "편집기로 보내기" 없음. 보관 기한은 추정하지 않고 "올린 지 {n}일"만 | g-handoff, g-repeat(Chrome Remove는 목록만), `X-ID-U31`(보관 기한 값은 확정 불가 → 쓰지 않음) | `frontend`, `design-copy` |
| D40 잠자기·대기 | **잠자기 방지 기본 켬**(유휴 잠자기만) + 설정 토글(`settings.keepAwake`). **"연결 대기" 단계**: 막대 줄무늬(forced는 dashed), 퍼센트 유지, 속도·남은 시간 숨김, 빨강·실패 문구 없음. 상태 조각 `job.status.waitingNetwork`("연결 대기 중 · 2분째 · 1.6GB 받음") + 본문 줄 `job.waitingNetwork.body` | `G-POWER-R8`·`G-POWER-R11`·`G-POWER-R13`~`G-POWER-R15`(macOS·Windows·systemd inhibitor, Transmission), brief §6.9-7(대기는 오류가 아님). ADR-0024 | `rust`·`tauri`(상태 머신), `frontend`, `design-copy`(상태 조각에 해요체 없음) |
| D41 서비스 공지 | **Worker `GET /notice`**(인증 없음, 활성 1개, 만료 ≤ 72h, fail-open) + 배너 `--warning-soft` + 실패 지점 인라인. 종류별 새 받기만 막고 앱 전체는 막지 않음. 진단 3분류(local/service/unknown)로 "인터넷이 불안정해요"가 치지직 장애에 사용자를 탓하지 않게 | g-outage(어느 사례에도 없어 설계로 정당화, yt-dlp 분류, GOV.UK) | `worker`, `frontend`, `design-copy` |

### H. 문구

| D | 최종 값 | 근거 | 강제 |
|---|---|---|---|
| D42 받기/다운로드 | **동사 "받다", 명사 "다운로드"**(목록 제목·그룹). 버튼 [받기]·[이어받기]. 랜딩 설치 파일 "macOS용 받기". 카드의 [불러오기]는 테두리 버튼(채움은 [받기]만) | a-copy 혼용 해소, `A-FEAT-D11`(주 버튼 둘), 세 후보 일치. 실제 사용자 어휘 **[미확인]**(g-evid §1.5 → D62 과업문에 화면 단어 금지) | `design-copy`(용어집) |
| D43 용어집 | 닫기(창·카드)/취소(작업) · "네이버 로그인 정보"(쿠키만)/"로그인"(앱 계정) · 일시정지·이어받기("멈춤"·"중단" 금지) · 그룹 머리 "받는 중 · 대기 중 · 받다 만 · 완료"("받다 만"은 [잠정], `content.md` §16-1) · 허가("허용" 금지, Worker 포함) · 서버는 "로그인 서버"·"치지직"·"영상 서버" · .part = "받다 만 파일"/"받은 부분" · 주소("링크" 금지) · 불러오기(영상)/가져오기(설정) · 목록/파일("목록에서 지우기"는 파일을 지우지 않음) · "폴더에서 보기"(reveal) · 빠른 다시보기/일반 VOD/클립("다시보기" 단독·상위어 "VOD" 금지 → "영상") · "인터넷"(네트워크 대신) · 메뉴는 Apple 한국어. 전체 표는 `content.md` §4 | `A-COPY-P0-2`·`P0-4`·P1, `G-REPEAT-*`, `G-HANDOFF-H1`, `E-KO-A1`, C 후보 "인터넷". 용어집은 HIG 권고가 아니라 우리 선택(`X-KO-A8a` 반영) | `design-copy` |
| D44 요청 어미 | **"~해 주세요" 전면**(단계 안내 포함). 상태 조각은 명사형("받는 중 · 2.3GB / 4.0GB", "일시정지됨"; 유일한 예외 D50 "곧 끝나요"), 사건 설명 문장은 행의 본문 줄(해요체). "되어요" → "돼요", 금지는 "~하지 마세요", `~시겠어요?` 금지. 도움말은 누르다·고르다·열다("클릭" 금지) | 앱인토스 해요체 전면(`E-KO-A1`), 규칙이 하나면 검사가 하나(A). 현재 3갈래(`A-COPY-P1-8`) | `design-copy` |
| D45 구두점 | 마침표는 **역할**로 정한다: 제목·라벨·버튼·메뉴·배지·placeholder·그룹 머리·상태 줄·토스트 **없음**, 본문·도움말·대화상자 본문·오류 본문·배너·Worker 문단 **있음**(한 문장이어도). 말줄임 U+2026 한 글자, 다른 창을 여는 버튼에 붙임([변경…] [로그아웃…]), 진행 문구에는 붙이지 않음. 구분자 " · "(공백), 열거 "·"(붙임), 메뉴 경로 "›", 따옴표 ‘’(U+2018/2019) | 국립국어원(표제어·표어 마침표 없음, `E-KO-A7`), HIG(창 여는 버튼 말줄임·알림 제목 끝 구두점 없음). C의 [변경]·[로그아웃] 말줄임 누락 교정(`J-F-C8`) | `design-copy` **(d)에서 반영**(구현 상태 표시, 결정 본문은 그대로) |
| D46 조사 | **변수 뒤에 조사가 오지 않게 재구성** + 따옴표. "‘{제목}’ 받기를 취소할까요?", "새 버전이 있어요: {version}". `을(를)` 이중 표기 안 함 | korea, `A-COPY-P0-1`(버전 조사 하드코딩). MS 이중 표기는 근거가 있지만 해요체와 어울리지 않음 | `design-copy`(패턴 금지) |
| D47 바이트 | **OS 진법**(Windows 1024 / macOS·Linux 1000), 라벨 KB·MB·GB(KiB 금지), 속도 MB/s(Mbps 금지). 완료 유효숫자 3자리(7.82GB), 진행 소수 1자리(2.3GB / 4.0GB), 예상 "약". 바이트 수 툴팁. 저장 공간 오류도 같은 함수 | g-units(Finder 8.4GB vs 탐색기 7.82GB를 각 OS 사용자가 보는 값과 맞춤 — P1의 직접 귀결). Windows 탐색기 진법 **[미확인]** → §6-10 | `rust`·`frontend` 골든(JSON 공유) **(d)에서 반영**(구현 상태 표시, 결정 본문은 그대로) |
| D48 숫자·단위 띄어쓰기 | **붙임** "7.8GB", "12.4MB/s", "58%". `UNIT_GAP` 상수 하나 | ko-localized `ByteCountFormatter` 실측 "8.4GB"와 CLDR ko(`E-A11Y-U14`. "Finder 문자열" 인용은 `X-A11Y-U16` refuted이나 결론 동일). 국립국어원은 라틴 단위를 다루지 않음(`E-A11Y-U25`) | 골든, `design-copy`(직접 문자열 금지) **(d)에서 반영**(구현 상태 표시, 결정 본문은 그대로) |
| D49 날짜·시각 | **"2026. 10. 3. 오후 9:00"**, 올해는 "10월 3일 오후 9:00", 상대는 방금/N분 전/N시간 전/어제까지, 요일 없음, 12시간. API 날짜는 KST 그대로. Worker 관리 화면도 같은 함수 | g-units(Apple·ICU·문장 부호 규정 공통형, v-a11y U17·`E-A11Y-U19`·v-a11y U27 confirmed). B의 24시간은 취향이라 버림 | 골든 |
| D50 남은 시간 | **"곧 끝나요 / 1분 미만 남음 / 약 14분 남음 / 약 1시간 20분 남음 / 남은 시간 계산 중"**. 영상 길이는 H:MM:SS. ETA는 EMA, 1초 1회 갱신[취향] | Finder 한국어 문자열 "약 N분"(`E-A11Y-U15` confirmed). 초 단위는 흔들린다 | 골든 |
| D51 도움말 | **앱 번들 짧은 판 + 랜딩 `/help` 전체 판**, 원천 `help/<id>.md` 하나, 앵커 id는 추가만. 오류 → L0 제목+본문+동작 / L1 "자세히"(코드·원문·[문제 보고용 정보 복사]) / L2 도움말 링크 / L3 웹. 글·도식 기본(스크린샷은 OS마다 달라짐) | g-help(앱 CSP connect-src ipc만), C6 | `frontend`, `worker`, `design-copy` |

### I. Worker·웹

| D | 최종 값 | 근거 | 강제 |
|---|---|---|---|
| D52 Worker JS | **계속 없음.** 복사 버튼·테마 토글·QR 없음. xattr 명령은 선택 가능한 코드 블록 + "이 명령 말고 다른 명령을 붙여넣으라고 하지 않아요 … 사기예요" + "이 명령은 '인터넷에서 받은 파일' 표시만 지워요" | a-worker CSP, g-privacy G1(터미널 명령 안내와 사기 패턴 구별), `<details>`는 JS 없이 동작 | `worker`(CSP·인라인 금지) |
| D53 랜딩 구조 | **내 OS 큰 버튼 하나**(36, 유일한 채움) + "다른 운영체제" 접힘 + 설치 안내 펼침 + "파일 확인(선택)" SHA-256 접힘 + 휴대폰 블록 먼저(UA `Mobi`·`Sec-CH-UA-Mobile`만, 숨기지 않음). "Apple Silicon(M1 이후) Mac만 지원해요"·최소 OS 한 줄 상시, "자동 업데이트" 약속 없음. macOS "그래도 열기" 경로 먼저 + xattr 폴백, Windows SAC·Linux libfuse2 안내, "처음 열면 로그인해요"·"막히면"(정보 복사 → 관리자) 절. OG 1200×630 PNG, 카카오 2:1 크롭 안전 영역, 로고·캡처·채널명 없음. `<table caption>` + `th scope`, skip link, `theme-color` 2종 | g-install·`G-WEB-R1`~`G-WEB-R16`, B 후보 골격(brief §6.13-2를 유일하게 다 지킴, judgment §2.2-6), C2(히어로 아래 고지) | `worker`(골격 테스트), `R8` |
| D54 웹 폼 위험도 | **2단**: 허가 빼기만 확인 페이지(`confirmDisallow.*`: "이 채널의 허가를 뺄까요?" / 왼쪽 [허가 빼기](빨간 글자) / 오른쪽 링크 "허가한 채널 목록으로"), 나머지 즉시 + 일회 알림. `tone=danger`는 되돌릴 수 없는 것에만(비파괴 "지우기"·대기 취소는 아님) | `G-WEB-R17`~`G-WEB-R24`(GOV.UK·MoJ confirm-an-action, WCAG 3.3.4), `A-WORKER-3.1`(danger 과용) | `worker`(폼 테스트) |

### J. 설치·법

| D | 최종 값 | 근거 | 강제 |
|---|---|---|---|
| D55 서명·SAC | macOS **현재 유지**(손상 경고 + "그래도 열기" 우선·xattr 폴백 안내), ad-hoc 서명은 실기 확인 뒤 결정[잠정]. Windows SAC는 **안내 문단**("켜져 있으면 설치할 수 없어요, 끄는 방법은…"). 비용 0 원칙(서명 구독 없음) | g-install(소영의 최대 마찰), judgment §2.2-6. ad-hoc·SAC 실기 **[미확인]** → §6-11 | `R8`(랜딩 문단), `governance.md` 과제 |
| D56 클립보드 제안 | **macOS `NSPasteboard.accessBehavior == alwaysAllow`일 때만 포커스 시 읽기**, 아니면 제안 끔. 붙여넣기·최근 목록이 대안 경로 | g-ime(15.4+ 기본 ask, 확인 창은 신뢰를 깎음), Wayland 제약. ADR-0023 | `tauri` |
| D57 업데이트 확인 노출 | **늘 보이되** 로그인 필요 상태는 문구로. 버전 "0.1.2"(v 없음), 코어 버전은 [정보 복사]에만. 실패해도 "지금 버전은 계속 쓸 수 있어요" | g-legal D5, g-install(Sparkle 관례) | `frontend`, `design-copy` |
| D58 앱 라이선스 | **사람 결정, 보류.** 정보 화면 "이용 조건" 행과 `/terms`가 이에 달림. 결정 전까지 저작권 줄 "모든 권리 보유" | `G-LEGAL-D1`, `docs/public-release.md:67` | ADR 필수(`R2`) |
| D59 AppImage·LGPL | **사람 결정, 보류.** 먼저 실제 `.so` 목록 확인. 계속 배포하면 LGPL 고지·소스 제안 파일 + `.so` 목록 gate | g-legal D2, libfuse2 문제(brief §2.8) | ADR 필수 |
| D60 이용 조건 페이지 | **`/terms` 없음으로 시작.** 처리방침 `/privacy` + 비공식 고지로 충분. 허가 목록이 커지면 다시 본다 | g-legal D3 권고 | ADR 필수 |

### K. 운영

| D | 최종 값 | 근거 | 강제 |
|---|---|---|---|
| D61 강제 장치 | §4.1 일곱 gate: `design-tokens`·`design-lint`·`design-copy`·`design-icons`는 `ci-ok` 필수, `design-gallery`는 `e2e-web` 안(D14 관찰 뒤 필수), `design-shots`는 관찰(app 영역), `design-worker`는 관찰(worker 영역: Worker 페이지만 바뀐 PR에서 app 전체를 켜지 않으려고 Worker 촬영을 따로 둔다, 2026-10-10 사용자 결정). 스냅샷은 Linux 한 곳(시스템 글꼴이 OS마다 다름), `--force-device-scale-factor`로 DPR | gov, a-drift §강제 장치 지도(없는 것 9개), g-scale(`deviceScaleFactor`는 스냅 재현 안 함) | `parity`(gates.mjs 등록) |
| D62 첫 사용자 시험 | **둘 다**(적용 전 현재 앱 기준선 + 적용 뒤). 회당 3명(스트리머·지인 각 1명 이상), 두 회 이상, 과업 UT1~UT7(`governance.md` §6.2), 판정은 관찰 횟수+심각도, "N명 중 M명"으로만. 시험 기록에 채널명·제목 금지. 확인 과업 V1~V8(`governance.md` §6.4): 완료를 색 없이 알아보는가 / 오른쪽 파랑을 안전으로 읽는가 / 왼쪽 빨간 글자를 파괴로 읽는가 / 13px이 작게 느껴지는가 / 헤더 이름만으로 무엇인지 아는가 / 툴바 톱니를 찾는가 / 연결 대기를 오류로 읽는가 / 토스트 6초를 다 읽는가 | `G-EVID-R1`~`G-EVID-R10`, `J-Q1`~`J-Q5` | `R10`, `governance.md` 시험 항목 목록 |

---

## 6. 열린 항목

[잠정]·[미확인]·[취향]을 모았다. 각 항목은 "어떻게 확인하는가"와 "결과가 나쁘면 무엇을 바꾸는가"를 적는다. 닫힌 항목은 ADR로 옮기고 여기서 지운다.

| # | 항목 | 상태 | 확인 방법 | 나쁘면 |
|---|---|---|---|---|
| 1 | **Windows 맑은 고딕 13px 판독, 600 굵기 렌더(Bold로 폴백돼 400과 구별되는지), `tabular-nums` 동작, `system-ui` 해석** (D11·D13, foundations §3.1·§3.2) | [잠정]/[미확인] | Windows 10 22H2·11 실기, 배율 100%·125%·150%, 홈·목록·설정 스크린샷 + `getComputedStyle(fontFamily)` + 숫자 열 정렬 캡처(줄기 측정은 `scripts/design/stem.mjs`, 단계 (a)에서 scratchpad 도구를 옮긴다). `R4`로 PR에 첨부 | `--text-body`·`--leading-body` → 14/18(두 줄. 글자 크기 설정 블록은 생성기가 배율로 유도하므로 함께 바뀐다). 600이 Bold로 보이면 그대로 둔다(두 단계라 위계 유지). tnum이 안 되면 숫자 요소에 `--font-mono` 폴백 검토(ADR) |
| 2 | **Linux 글꼴·테마 감지**: fontconfig `system-ui`, Noto Sans CJK KR 유무, GNOME `prefers-color-scheme` 정확도, 분수 배율 | [미확인] | Ubuntu 22.04·24.04 실기(WebKitGTK 2.50·2.52), 같은 캡처 | 랜딩 설치 안내에 Noto CJK 설치 한 줄. 테마는 이미 Linux만 앱 안 선택(D7) |
| 3 | **첫 사용자 시험(D62)**: 기준선(현재 앱) + 적용 뒤 | 계획 | §5 D62 과업 6개. 회당 3명 × 2회 이상 | 완료 색(→ 5), 버튼 배치(D36 뒤집기 → ADR), 본문 14(→ 1), 톱니에 글자, 헤더 마크 우선순위 |
| 4 | **아이콘 16px·stroke 1.5의 DPR1 번짐** (D32) | [잠정] | `design-gallery`의 `scripts/design/icons-blur.mjs` 측정("수평선 최대 농도 ≥ .5, 두께합 ≥ 1.0") Chromium DPR1·2 + Windows 100% 실기 아이콘 시트 | 16px만 1.25px로 내린다(`--icon-stroke-sm` 분리, ADR) |
| 5 | **성공색 없음** (D10) | [잠정] | D62 5초 과업 V1 "다 받은 영상을 찾아 보세요", 3명 중 2명 기준(우리 결정, ADR-0004) | C1 밖의 초록(H 140~170° 경계도 피한 H 120~135° 안팎, S는 HSL 50% 이하 [잠정]; B 후보가 든 `#2F7D4B`는 H 142°라 경계 안이므로 쓰지 않는다)을 ✓ 아이콘 색 토큰 하나(`--success-ink`)로 더한다. 채움·면은 안 만든다(ADR) |
| 6 | **본문 열 800** (D24) | [취향]/절충 | ADR-0001에 "720(A)·960(B) 사이, 출처 없음" 기록. D62에서 960 창 좌우 80 여백에 대한 불만 관찰 | 720 또는 960으로 토큰 하나 변경 |
| 7 | **출처 없는 수치 묶음**: 토스트 6초(D37), OS 알림 40자소(D38), 진행 막대 6px, 툴바 44, 대화상자 440, 읽기 열 680, 라벨 열 80, 퍼센트 칸 40, 스피너 800ms, 그림자 수치, 분기 600, 글자 크기 설정 ×1.3/×2.0, 읽기 척도 13/17/22/28, 눌림 면 색, 셸 상수(foundations §14: 1.5초·300/400ms·1초·30분/30초·60초/10초·1.05·1GB·1000ms·`NOTIFY_BATCH_MS`), 공지 72h/24h/80자/3건(D41), 완료 접힘 11개·30일·100행(D39) | [취향]/[잠정]/[제안] | ADR-0009 한 장에 묶어 "제안값"으로 등록. 6초·40자소는 D62 관찰(V8), 600은 Windows 텍스트 크기 225% 리플로우 검사(`design-gallery`), 읽기 척도는 1280·휴대폰 캡처, 셸 상수는 `platform.md` §21 | 각각 토큰·상수 하나 변경. 체계는 깨지지 않는다 |
| 8 | **앱 마크(D33)** | 과제 | `governance.md` 과제 등록 → 별도 ADR. 조건은 §5 D33. 5초 흑백 식별 시험 | 마크 전까지 헤더는 이름만(이미 그렇게 설계) |
| 9 | **치지직 약관 상표 조항**, KIPRIS 조회, 국내 접근성 법령(KWCAG) 적용 여부 | [미확인], 사람 | 사용자가 직접 확인(brief §2.7 1순위). 결과를 `governance.md` 개명 트리거 표에 | 개명 트리거 ①이면 D34를 B("고유 이름 + 치지직용")로 → ADR |
| 10 | **Windows 탐색기 바이트 진법 실측** (D47) | [미확인] | Windows 실기에서 같은 파일의 탐색기 표기와 앱 표기 비교(MS 문서끼리 모순) | 진법 표 수정, 골든 갱신 |
| 11 | **macOS ad-hoc 서명 실기, Smart App Control 두 대 실험, 서명 없는 빌드의 알림 표시** (D55·D38) | [미확인] | 실기 세 가지. 결과를 랜딩 문단과 `platform.md`에 | SAC는 "지원 제외 명시"(C)로 전환, 알림이 안 뜨면 행 상태만 |
| 12 | **로그인 첫 화면**: 세 후보 모두 목업하지 않아 C2·C7의 "로그인 전 고지" 조건이 미증명 | 적용 과제 | `patterns.md` §13에 명세했고 참조 목업 app-11로 확인했다. 네 요소(비공식 고지 `NOTICE_SHORT`·받는 것·받지 않는 것·끊는 길·처리방침)의 렌더는 `frontend`(필수), 720×520 뷰포트 안은 `design-gallery`(관찰). 상태별 버튼 표(§13)는 `loginScreen`(`app/src/lib/auth.ts`)과 같게 맞췄고 차이는 남기지 않았다(2026-10-10 사용자 결정). 로그인·Worker 문구 제안 여덟 가지(`content.md` §15)는 같은 날 수용되어 적용 단계 (d)에서 반영한다 | — |
| 13 | **Worker 읽기 척도의 title·display·hero 값**(15 외) | [잠정] | 7과 함께 | 값 조정 |
| 14 | **참조 목업 재촬영**(`scratchpad/ds/ref/` 14장은 편집 전 명세로 찍혔다): 문구를 `content.md` §15로, 대화상자 배치·툴바 ⚙ 유지·토스트 폭·배지 위치·유령 버튼 끝자리 보정·forced 막대·Windows 판 한 벌 | 적용 과제 | 단계 (c)에서 갤러리 고정 데이터로 다시 찍는다(`design-shots` 기준선) | — |
| 15 | **보고서가 남긴 빈칸 Q15~Q27**(IME 이벤트 순서 3엔진, 셸 실측 11항목, 치지직 파일 VFR, 탐색기 "폴더에서 보기" 문구, 배율·터치 비율, 사람 결정 D58~D60, 개인정보 운영 빈칸, `Assets.car` 시험, Linux 알림 이름, 사용자 어휘, 엔진 하한 실기, ETA 체감, 선 스냅 실기) | [미확인] | `docs/research/design-system.md` §7.2 표의 확인 방법(실기는 `platform.md` §21 M1~M25) | 같은 표의 "결과가 바꾸는 것" |

---

## 7. 변경 규칙(ADR)

### 7.1 언제 쓰나

다음 중 하나면 ADR 없이 머지하지 않는다(`R2`가 번호를 요구한다):

1. 토큰을 더하거나 지우거나 값을 바꾼다(`design/tokens.json` diff가 있다).
2. §5 결정 표의 값을 뒤집는다(D 번호를 적는다).
3. §1 원칙의 예외를 만든다.
4. 새 컴포넌트·새 패턴·새 알림 수단을 만든다.
5. [잠정]·[취향] 항목을 확정하거나 바꾼다(§6의 번호를 적는다).
6. 사용자 시험(D62) 결과로 무엇을 바꾸거나 바꾸지 않기로 한다("발견하지 못함"도 기록한다).

문구 하나·컴포넌트 안 간격 조정처럼 토큰·결정·원칙을 건드리지 않는 변경은 ADR이 아니라 PR 설명과 체크리스트로 끝낸다.

### 7.2 어떻게 쓰나

파일은 `docs/design/system/adr/NNNN-slug.md`(4자리 연번, 영어 slug). 한국어, 짧은 평서문. 틀(`G-EVID-R1`·`G-EVID-R3`, brief §6.2-5). `scripts/design/adr.test.mjs`(DA1~DA10, governance §4.3)가 이 모양을 검사한다:

```
# NNNN 제목
상태: 제안 | 채택(잠정) | 채택 | 폐기(→ NNNN)   날짜: YYYY-MM-DD   관련: D번호, §6-번호, 이전 ADR
## 맥락
무엇이 문제였나. 현재 코드·문서의 위치(파일:줄).
## 결정
한 문장. 바뀌는 토큰·규칙을 이름과 값으로.
## 근거
| 주장 | 등급 | 출처 | 표본·날짜 |

최고 등급: E0~E4 · 결정 영향: 작음|중간|큼 · 판정. refuted 값은 쓰지 않는다. 취향이면 "취향"이라고 쓴다.
## 결과
바뀌는 문서 절, gate, 컴포넌트, 마이그레이션.
### 재검증 조건
어떤 관찰·실측이 나오면 다시 본다. 확인 방법(D62 과업, 실기 OS, gate). 영향 "큼"이면 필수.
## 대안과 버린 이유
```

규칙:
- 등급 E3 미만만으로 영향 큰 결정을 "채택"이라 쓰지 않는다. "채택(잠정)"으로 두고 재검증 조건을 적는다(brief §6.15-1).
- 결정을 뒤집을 때 옛 ADR을 고치지 않는다. 새 ADR을 쓰고 옛것의 상태를 "폐기(→ 새 번호)"로 바꾼다.
- ADR이 토큰을 바꾸면 같은 PR에서 `foundations.md` 표·`design/tokens/`·생성물이 함께 바뀐다. `design-tokens`의 문서 패리티가 셋의 일치를 확인한다.
- 소표본 결과는 "N명 중 M명"으로만 쓴다. 성공률·SUS·평균을 판정 근거로 쓰지 않는다(brief §6.15-2).
- 예시 값은 가짜만 쓴다(`scan`).
### 7.3 처음에 쓴 ADR

판정과 이 문서가 내린 결정의 기록으로 열 장을 썼다(`adr/`). 모두 E0~E1 근거라 `채택(잠정)`이다. 0011~0016은 적용 단계 (b)의 새 컴포넌트 여섯 장, 0017~0019는 (c)의 기능 화면 결정 셋, 0020·0021은 (e)의 Worker 결정 둘(서비스 공지 D41, 웹 폼 위험도 D54), 0022~0024는 (f)의 셸 결정 셋(Dock 집계 D29, 클립보드 제안 D56, 연결 대기 D40)이다.

| 번호 | 제목 | 관련 |
|---|---|---|
| 0001 | 방향 선택: A 「무색」 뼈대 + B 내용물 + C 문구, 사용자 결정 다섯(열 800 포함) | judgment, D5·D11·D24·D26·D36, §6-6 |
| 0002 | 루트 16px과 px 토큰 | D4, `A-VIS-01` |
| 0003 | 상태 레일 폐기 | `A-DRIFT-K3` 번복, `A-VIS-20` |
| 0004 | 성공색 없음(잠정) | D10, §6-5 |
| 0005 | 대화상자 버튼 배치 | D36 |
| 0006 | 바이트 진법을 OS별로 | D47, §6-10 |
| 0007 | 토큰 단일 원천과 생성기 | D3 |
| 0008 | 시각 회귀 기준 OS는 Linux 하나 | D61 |
| 0009 | 출처 없는 수치 묶음(제안값) | §6-7 |
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
| 0022 | Dock·작업 표시줄 진행 집계: 배치 구성원 기준, 단조, 포커스 없을 때만 Error, 1Hz | D29, platform §8.2·§22 32 |
| 0023 | 클립보드 제안: macOS는 alwaysAllow일 때만 읽고, 셀렉터가 없는 OS에서는 읽는다 | D56, platform §17.2·§22 37 |
| 0024 | 연결 대기: 상태가 아니라 phase, 30분 인내, 잠든 시간은 세지 않는다 | D40, D39, platform §15.2·§22 33~35, core.md 56 |

그 뒤 D33(앱 마크)·D58·D59·D60(사람 결정)·D55(실기 결과)·§6-1(Windows 실기)이 각각 ADR을 받는다(§6-1은 실기 결과가 나온 뒤).
