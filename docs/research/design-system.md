# 디자인 시스템 근거 (design-system.md)

디자인 시스템 「무색」(`docs/design/system/`)이 인용하는 근거를 저장소에 남기는 문서다. 조사·검증·감사·판정은 2026-10-09에 세션 scratchpad에서 이루어졌고, scratchpad는 세션이 끝나면 사라진다. 그래서 시스템 문서가 가리키는 사실(페르소나·과업·어울림 기준·검증된 외부 수치·버린 주장·현재 코드 결함·세 후보와 판정·열린 질문)을 여기에 안정적인 ID로 옮겼다. 원 보고서의 판정(confirmed / refuted / unverifiable)을 그대로 따르고, 여기서 새로 판정하지 않았다.

규칙:
- **refuted·unverifiable 사실은 시스템 근거로 쓰지 않는다.** §3에 모아 두었고, 시스템 문서가 그 값을 쓰면 리뷰(`R2`)에서 되돌린다.
- 실측값은 **이 Mac(macOS 26.6.2, Apple Silicon, DPR 2)** 한 대의 값이다. Windows(WebView2)·Linux(WebKitGTK) 실기 실측은 하나도 없다(§7 Q1·Q2).
- 우리 사용자를 관찰한 근거(E3·E4)는 하나도 없다. 모든 근거는 E0(외부 지침·플랫폼 규칙) 또는 E1(전문가·정적 감사·실측)이다.
- 예시 값(제목·크기·날짜·채널 이름)은 전부 가짜다. 실제 채널·영상·토큰은 적지 않는다(`scan`).

---

## 0. ID 체계

다른 문서는 아래 ID로만 이 문서를 인용한다. ID는 한 번 붙이면 바꾸지 않는다. 항목을 버릴 때는 지우지 않고 "폐기"라고 적는다.

### 0.1 ID 종류

| 접두 | 형식 | 뜻 | 예 |
|---|---|---|---|
| `PS` | `PS1`·`PS2` | 페르소나(§1.1). README 원칙 `P1`~`P5`와 겹치지 않게 `PS`다(검토 U-18) | `PS1` 현우 |
| `T` | `T1`~`T7` | 핵심 과업(§1.2). 시스템 문서(governance §6.2)는 같은 번호를 `UT1`~`UT7`로 쓴다(gate 검사 번호 `DT*`와 겹치지 않게) | `T3` 끊김·오류 복구 |
| `C` | `C1`~`C8` | "우리 서비스에 어울린다" 판정 기준(§1.3) | `C1` 브랜드 자산 없음 |
| `E` | `E-<출처>-<번호>` | **검증된(confirmed) 외부 사실·실측**(§2). `<출처>`는 검증 보고서 약칭 여섯 중 하나, `<번호>`는 그 보고서가 붙인 번호를 그대로 쓴다(아래 0.2) | `E-APPLE-19` AppKit 컨트롤 높이 |
| `X` | `X-<출처>-<번호>` | **refuted 또는 unverifiable로 버린 주장**(§3). 번호 체계는 `E`와 같다 | `X-SCALE-05` "컨트롤 32 수렴" |
| `A` | `A-<감사>-<코드>` | 현재 코드의 결함(§4). 감사 보고서의 항목 코드를 그대로 쓴다 | `A-VIS-41` 정보 배너 = 브랜드색 |
| `G` | `G-<격차>-<코드>` | 격차 보고서의 규칙 문장(§5). 설계 판단이지 사실이 아니다. `<코드>`는 보고서 번호에서 하이픈만 뗀 것(§5 머리 표) | `G-INPUT-IN4` 터치 40 |
| `D` | `D1`~`D62` | 결정 번호. 값과 근거는 `docs/design/system/README.md` §5가 소유한다. 이 문서는 번호만 가리킨다 | `D36` |
| `J` | `J-A`·`J-B`·`J-C`, `J-S<n>`, `J-F-<후보><n>`, `J-R<n>`, `J-Q<n>` | 방향 후보 셋(§6.1), 판정 점수(§6.2), 목업 결함(§6.4), 근거로 결론 난 것(§6.6), 사용자가 고른 다섯 가지(§6.7) | `J-S2` 어울림 점수, `J-F-B6` B의 accent-soft 배너 |
| `Q` | `Q<n>` | 열린 질문(§7). **Q1~Q14는 `README.md` §6 열린 항목 1~14와 번호가 같다.** Q15부터는 보고서가 남긴 빈칸 | `Q1` 맑은 고딕 13px |

### 0.2 `E`·`X`의 출처 약칭과 번호 규칙

| 약칭 | 원 보고서 | 번호 규칙 |
|---|---|---|
| `APPLE` | verify-apple.md | 끝의 "시스템에 써도 되는 확정 사실" **1~31**. 다른 문서의 `v-apple 확정 n` = `E-APPLE-n`(두 자리로 채운다: `E-APPLE-07`) |
| `DESK` | verify-desktop-engine.md | 검증 표의 행 코드 `R-01`~`R-47`(research-desktop), `E-01`~`E-41`(engine), `N-01`~`N-45`(shell), `L-01`~`L-34`(launch)를 하이픈 없이 쓴다. `v-desk R-37` = `E-DESK-R37`, `v-desk N-07` = `E-DESK-N07` |
| `KO` | verify-korea-interaction.md | 끝의 확정 사실 **1~34**. `v-ko 확정 n` = `E-KO-n`. 검증 표의 절(`A1`~`A8`, `B1`~`B7`)은 `E-KO-A1`처럼 절 단위로도 가리킨다 |
| `A11Y` | verify-a11y-units.md | 검증 표의 행 코드 `A01`~`A72`(OS 접근성), `U01`~`U45`(단위), `D01`~`D55`(배율·선), `T01`~`T46`(IME·클립보드). `verify-a11y U16` = `E-A11Y-U16`. 끝의 확정 사실 1~43은 `E-A11Y-F<n>` |
| `ID` | verify-identity-users.md | 검증 표의 행 코드 `U01`~`U52`(users), `I01`~`I51`(정체성), `K01`~`K45`(아이콘), `A01`~`A45`(라이선스), `L01`~`L48`(설치), 새 실측 `M01`~`M07`. `verify-identity U43` = `E-ID-U43`, `K28b` = `E-ID-K28b`(U31·K28은 refuted라 `X-ID-U31`·`X-ID-K28`). 끝의 확정 사실 1~60은 `E-ID-F<n>` |
| `SCALE` | verify-scales.md | 끝의 확정 사실 **F1~F37** → `E-SCALE-01`~`E-SCALE-37`. 검증 표의 절(`A1`~`A8`, `B1`~`B5`, `C`, `D`, `E`)은 `E-SCALE-A5`처럼 절 단위로 |

같은 번호가 confirmed면 `E-`, refuted·unverifiable이면 `X-`다. 한 행에 둘이 섞인 경우(부분 refuted)는 §3에 `X-`로 올리고 맞는 부분을 적었다.

### 0.3 조사·감사·격차 보고서 약칭(브리프 §0.1과 같다)

시스템 문서 초안은 아래 약칭 `§절`로 인용했다. 편집 단계에서 이 문서의 ID로 바꾸되, ID가 없는 절(예: `users §3.3`, `g-scale §5.2`)은 약칭 인용을 남긴다. 원 보고서는 scratchpad에만 있었으므로 그런 인용은 "검증되지 않은 조사 서술"로 읽는다.

| 약칭 | 원 보고서 | 이 문서의 ID | 약칭 | 원 보고서 | 이 문서의 ID |
|---|---|---|---|---|---|
| users | research-users.md | `P`·`T`·`C`, `E-ID-U*` | g-engine | gap-webview-engine-baseline.md | `E-DESK-E*`, `G-ENGINE-R*` |
| apple | research-apple.md | `E-APPLE-*` | g-shell | gap-webview-native-feel-shell.md | `E-DESK-N*`, `G-SHELL-H*`·`NS*` |
| bigtech | research-bigtech.md | `E-SCALE-*` | g-scale | gap-display-scaling-hairline-rendering.md | `E-A11Y-D*`, `G-SCALE-*` |
| desktop | research-desktop.md | `E-DESK-R*` | g-a11y | gap-os-accessibility-settings.md | `E-A11Y-A*`, `G-A11Y-OS*`·`HC*` |
| gov | research-governance.md | (검증 안 됨) | g-id | gap-identity-trademark-icon.md | `E-ID-I*`, `G-ID-R*` |
| inter | research-interaction.md | `E-KO-B*`, `G-INTER-DL*`·`NT*`·`CF*`·`FC*`·`MO*` | g-icon | gap-icon-set-license-metaphor.md | `E-ID-K*`, `G-ICON-*` |
| korea | research-korea.md | `E-KO-A*` | g-units | gap-units-number-date-format.md | `E-A11Y-U*`, `G-UNITS-*` |
| tokens | research-tokens.md | `E-SCALE-B*` | g-ugt | gap-user-generated-text-rendering.md | `G-UGT-R*`(검증 안 됨) |
| a-visual | audit-visual.md | `A-VIS-*` | g-ime | gap-text-input-ime-clipboard-drop.md | `E-A11Y-T*`, `G-IME-R*` |
| a-copy | audit-copy.md | `A-COPY-*` | g-input | gap-input-modality-touch-pen-trackpad.md | `G-INPUT-IN*` |
| a-feat | audit-features.md | `A-FEAT-*` | g-launch | gap-launch-perceived-performance.md | `E-DESK-L*`, `G-LAUNCH-R*` |
| a-prim | audit-primitives.md | `A-PRIM-*` | g-repeat | gap-repeat-use-archive-habit.md | `G-REPEAT-R*`·`D*`(검증 안 됨) |
| a-drift | audit-spec-drift.md | `A-DRIFT-*` | g-handoff | gap-post-download-handoff-playback-editing.md | `G-HANDOFF-H*`(검증 안 됨) |
| a-lit | audit-style-literals.md | `A-LIT-*` | g-save | gap-save-location-filesystem-realities.md | `G-SAVE-R*`(검증 안 됨) |
| a-worker | audit-worker-pages.md | `A-WORKER-*` | g-power | gap-power-network-background-behavior.md | `G-POWER-R*`(검증 안 됨) |
| v-apple | verify-apple.md | `E-APPLE-*` | g-install | gap-install-update-lifecycle.md | `E-ID-L*`, `G-INSTALL-R*` |
| v-desk | verify-desktop-engine.md | `E-DESK-*` | g-outage | gap-service-dependency-outage-communication.md | `G-OUTAGE-R*`·`B*`(검증 안 됨) |
| v-ko | verify-korea-interaction.md | `E-KO-*` | g-help | gap-help-content-troubleshooting-system.md | `G-HELP-*`(검증 안 됨) |
| v-id | verify-identity-users.md | `E-ID-*` | g-privacy | gap-privacy-consent-support.md | `G-PRIVACY-R*`·`G*` |
| v-a11y | verify-a11y-units.md | `E-A11Y-*` | g-web | gap-web-entry-context-mobile-inapp-nojs.md | `G-WEB-R*` |
| v-scales | verify-scales.md | `E-SCALE-*` | g-legal | gap-about-legal-oss-attribution.md | `E-ID-A*`, `G-LEGAL-R*`·`D*` |
| brief | brief.md(결정 브리프) | `D*` | g-evid | gap-design-validation-evidence-ops.md | `G-EVID-R*` |
| judgment | judgment.md(후보 판정) | `J-*` | | | |

"(검증 안 됨)"인 격차 보고서(g-ugt·g-repeat·g-handoff·g-save·g-power·g-outage·g-help)와 gov는 검증 보고서가 다루지 않았다. 그 보고서의 `G-*`는 E1(전문가 판단)로만 취급하고, 수치를 인용할 때는 **[잠정]**을 붙인다. gov(research-governance.md)의 체크리스트·강제 장치는 README §4와 governance.md가 흡수했고 ID를 두지 않았다.

### 0.4 근거 등급(brief §0.3, `G-EVID-R1`)

| 등급 | 뜻 | 이 문서에서 |
|---|---|---|
| E0 | 외부 지침·타사 사례·플랫폼 규칙(HIG, WCAG, NN/g, MS Learn, 공식 패키지) | `E-*` 중 출처가 외부 문서인 것 |
| E1 | 전문가 평가·정적 감사·에이전트 판단·이 기계 실측 | `E-*` 중 "실측"·"로컬", `A-*`, `G-*`, `J-*` |
| E2 | 사용자 자발 신호(문의·문제 보고) | 없음 |
| E3 | 우리 사용자 관찰, 3명 미만 한 회 | 없음 |
| E4 | 두 회 이상 또는 한 회 5명 이상 | 없음 |

---

## 1. 사용자·과업·어울림 기준

출처: research-users.md(§1~§6). 저장소 문서에서 확인한 사실은 [저장소], 웹 확인은 [웹], 해석은 [추정]이다. 검증 결과는 `E-ID-U01`~`U52`.

### 1.1 누가 쓰나, 페르소나

[저장소] 대상은 "스트리머 한 사람과 지인 몇 명, 비기술자"(옛 `docs/design/ui-visual.md` 머리말, 지금은 system/README.md 정의). 빈도는 "하루에 몇 번 주소를 붙여넣고 받는 작은 도구". 받을 수 있는 것은 **본인 채널의 VOD·클립만**(로그인 채널 ID = 영상 채널 ID, 클립은 `ownerChannel`). 환경은 macOS·Windows·Linux, 창 기본 960×700·최소 720×520(`E-A11Y-A15`), 라이트·다크는 OS를 따른다. 쿠키 같은 개념을 모르는 사람을 상정한다. 랜딩은 드물게 쓴다(세션 12시간).

함의 [추정]: 일반 대중이 아니라 **허가받은 소수의 본인 채널 운영자**다. 신뢰와 설명이 마케팅보다 중요하고, 온보딩 캐러셀·가입 유도는 필요 없고, 며칠에 한 번 열어도 헤매지 않아야 한다.

| ID | 페르소나 | 상황 [추정] | 목표 | 기술 수준 | 불안 | 근거 |
|---|---|---|---|---|---|---|
| **PS1** | 현우, 중견 스트리머(주 사용자) | 주 3~5회 방송. Windows 데스크톱, OBS, 밤에 어두운 방에서 편집 | 방송이 끝나면 가장 높은 화질의 다시보기를 받아 편집 프로그램으로. 보관 기한을 놓치면 곤란 | OBS·편집기는 다루지만 쿠키·API·ffmpeg는 모른다. 수상한 확장 프로그램을 경계 | 3~4시간짜리가 중간에 끊기면 처음부터 받게 될까 봐. 로그인 정보를 넣으라는 앱을 믿어도 되나 | 대상 정의(ui-visual.md), 보관 기간 제약은 값이 바뀌어 확정 불가(`X-ID-U31`), 큰 파일 + 토큰 만료(ROADMAP) |
| **PS2** | 소영, 지인·매니저 겸 편집자(보조 사용자) | 허용목록에 오른 지인. 랜딩에서 설치 파일을 받아 Apple Silicon Mac에 처음 설치. 주 1~2회 클립을 모아 받는다 | 설치 → 로그인 → 첫 클립 받기까지 막히지 않는 것 | 일반 사무용 사용자. 공증되지 않은 앱의 "손상" 경고와 터미널 `xattr`은 큰 장벽 | 설치 경고가 뜨면 멈춘다. 거부되면 이유와 다음 행동을 알고 싶다 | worker.md 구현 중 변경 45·§9.5, `E-ID-L01`~`L08`(손상 경고·Open Anyway) |

**PS2의 경로(설치·로그인)가 이 서비스의 최대 마찰 지점이다** [추정]. 두 페르소나 모두 가상이며 사용 데이터는 없다. 검증은 지인 2~3명의 5분 과업 관찰(D62).

### 1.2 핵심 과업과 성공 기준

성공 기준 수치는 제안값이다. NN/g 한계 시간(`E-ID-U01`~`U03`)만 출처가 있다.

| ID | 과업 | 성공 기준(검증 방법) | 관련 결정 |
|---|---|---|---|
| **T1** | 주소 붙여넣기 → 받기 시작 | 붙여넣기 1회 + 확정 1회(클릭 또는 Ctrl/Cmd+Enter). 설정을 열지 않는다. 신규 5명 중 4명이 안내 없이 첫 파일 시작(관찰) | D36·D42, C4 |
| **T2** | 진행 확인 | 0.1초 안에 상태 변화, 1초 넘으면 진행 표시, 10초 넘으면 퍼센트·남은 시간·취소(`E-ID-U01`~`U03`) | D23·D47~D50, C5 |
| **T3** | 끊김·오류 복구 | 네트워크 단절·재시작 뒤 한 번의 클릭으로 이어받는다. 모든 오류에 무슨 일·어떻게·버튼이 있고 입력 주소는 남는다 | D40·D41·D51, C6 |
| **T4** | 완성 파일 찾기·넘기기 | 완료 항목에서 한 번에 열기 또는 폴더에서 보기. 파일이 없으면 토스트로 설명 | D39 |
| **T5** | 설치·로그인(P2) | 랜딩 → 설치 → 로그인 → 첫 받기를 안내만 보고 10분 안에(관찰). 거부되면 이유와 다음 행동이 화면에 | D53·D55, C2·C7·C8 |
| **T6** | 민감 설정(드묾) | 쿠키를 넣어야 하는 사람이 왜·무엇을·어디까지를 읽고 판단한다. 기본은 꺼짐·접힘 | C7 |
| **T7** | 몇 주 만에 다시 열기 | 마지막 폴더·화질을 기억한다. 안내 없이 T1을 다시 한다 | 최근 VOD 목록(J-B에서 가져옴) |

받는 이유 네 가지 [추정, 인터뷰 필요]: 보관 기한 전 백업(수 GB·이어받기·완료 알림), 편집용 원본(최고 화질 기본·날짜순 파일명·폴더에서 보기), 본인 클립 모음(연속 붙여넣기·중복 이름), 편집자에게 전달(위치 분명·손상 없음).

### 1.3 "우리 서비스에 어울린다" 판정 기준 C1~C8

예/아니오로 검증할 수 있게 썼다. C1·C2·C4·C6·C7·C8은 필수, C3·C5는 권장. "현재 상태"는 조사 시점(적용 전) 코드 기준이다.

| ID | 기준 | 검증 방법 | 근거 | 현재 상태 |
|---|---|---|---|---|
| **C1** | 치지직·네이버 브랜드 자산을 쓰지 않는다: 토큰 어디에도 네이버 그린 계열(HSL **H 140~165°이면서 S ≥ 70%**)·네온 민트가 없고, 로고·사선 키 비주얼·LIVE 빨강 링을 쓰지 않으며, 앱 아이콘이 치지직 로고와 다르다 | 토큰 색상 스캔(`design-tokens`), 화면·아이콘 육안 비교 | `E-ID-U19`·`I01`~`I02`(NAVER 브랜드 리소스), `E-ID-U43`(H·S 계산: #03C75A H146.6 S97, #00FFA3 H158.4 S100, #1BB373 H154.7 S73.8이 걸림), `E-ID-U18` | 적용 전: **Worker 라이트 `#007A45`(H≈154°, S100%)가 위반**, 다크 `#3DDC8A`(H≈149°, HSL S≈69%)는 경계. 채도 기준을 HSL S로 고정한 것은 우리 결정(foundations §2.1) |
| **C2** | 비공식임이 보인다: 랜딩과 로그인 첫 화면에 "비공식 도구, 네이버·치지직과 무관" 고지가 스크롤 없이 보이고, "공식·제공" 표현이 어디에도 없다 | 화면 캡처, copy deck 금지어 grep(`design-copy`) | `E-ID-U19`(신용 차용 금지), `E-ID-U10`~`U11`(NN/g 선제 공개), `E-ID-I04`(YouTube 브랜딩: "~용" 설명은 허용) | 적용 전 **미충족**: `ko.ts`·Worker `copy.ts`에 "비공식" 0건(`E-ID-U49`) |
| **C3** | 이 생태계에서 낯설지 않다: 라이트·다크가 동등하고 OS 설정을 따르며, 본문 12~14px 밀도이고, 면의 단계로 위계를 만들며 그림자는 떠 있는 요소에만 | 두 테마 스크린샷, 대비 계산, `box-shadow` 사용처 grep | `E-ID-U29`(OBS 테마), `E-ID-U20`~`U24`(치지직 웹 관찰, 비공식 제3자 정리), `E-ID-U25b`(그림자: 팝오버·툴팁·칩·플로팅) | 충족 |
| **C4** | 붙여넣기에서 받기 시작까지 사용자 동작이 2회 이하(붙여넣기 + 확정). 설정 변경이 필요 없다 | 신규 사용자 관찰, e2e의 키·클릭 수 | `E-ID-U34`(Downie Cmd+V 즉시 시작), `E-ID-U46`(4K Plus 4단계), `E-ID-U51`(현행 Mod+Enter) | 충족 |
| **C5** | 진행이 보인다: 1초 넘는 작업은 진행 표시, 10초 넘는 다운로드는 퍼센트·남은 시간·취소가 모두 있고, 시작 직후 0.1초 안에 항목이 목록에 | e2e 타이밍, 화면 검토 | `E-ID-U01`~`U03` | 충족 |
| **C6** | 모든 사용자 오류는 (a) 무슨 일 (b) 어떻게 (c) 버튼을 가지며, 입력 주소를 지우지 않고, 코드·HTTP 번호는 기본 화면에서 접혀 있다 | copy deck 전수(`design-copy`), 입력 보존 e2e | `E-ID-U09`(NN/g 오류 지침), `E-KO-15`(HIG writing) | 적용 전: `copy/errors.ts:139·152`에 `(코드 …)`·`(HTTP …)` 노출(`E-ID-U50`) |
| **C7** | 민감한 입력(쿠키·로그인) 앞에 "왜·무엇을·어디까지·어떻게 끊나"가 같은 화면에 있고, 기본은 꺼짐·접힘이며, 값은 화면에 다시 보내지 않는다 | 화면 검토, 비밀 누출 테스트 | `E-ID-U10`~`U14`(NN/g 신뢰, 권한 요청 세 요소는 2차) | 쿠키는 충족. 로그인 화면은 보강(`G-PRIVACY-G5`) |
| **C8** | 허용 범위가 처음부터 정직하다: 랜딩·로그인·카드 어디서든 "본인 채널 영상만"·"허가된 채널만"이 사전에 보이고, 거부될 때 원인·본인 채널 정보·다음 행동이 같은 화면에 | 거부 경로 화면 점검 | `E-ID-U10`, worker.md §9.5, app.md §8.9 | 충족. 로그인 **전에** 알리는지는 확인 필요 |

### 1.4 치지직·주변 도구의 시각 언어(참고)

- 치지직 브랜드는 그린이고 네이버 서비스임을 드러내는 선택이다(`E-ID-U18`, 매체 기사). 웹 UI 관찰(`E-ID-U20`~`U28`, **비공식 제3자 정리**): 다크 기본, 네온 `#00FFA3`은 켜짐 신호에만, 라이트 `#1BB373`, 본문 14·채팅 13·캡션 12·라벨 11px, 반경 8/12/16(태그 4), 서체 Pretendard + 산돌 네모니2. hex 값은 설계 근거가 아니라 "피해야 할 근처 값"으로만 쓴다.
- OBS 기본 테마 Yami는 남색 기운의 어두운 면이고 사용자가 테마를 바꾸는 문화가 있다(`E-ID-U29`).
- 다운로더류 관례: Downie는 Cmd+V 즉시 시작(`E-ID-U34`), Stacher·Open Video Downloader는 시스템 테마 따름(`E-ID-U37`·`U38`). Transmission Dock 진행·Safari 비행 애니메이션·Chrome 24시간 숨김은 확인하지 못했다(`X-ID-U39`·`U40b`·`U41`).
- 가져올 것: 다크 1급, 면 단계 위계, 컴팩트 밀도, 강조색은 켜짐 신호에만, 그림자는 떠 있는 것에만. 피할 것: 네이버 그린·네온 민트, 로고·사선·LIVE 링, "공식·제공" 문구, 대각선·글리치 장식. 법적 판단은 하지 않았다(`Q13`).

---

## 2. 검증된 외부 사실(confirmed)

여섯 검증 보고서의 "시스템에 써도 되는 확정 사실"을 전부 옮겼다. 출처 열의 URL은 검증자가 2026-10-09에 다시 연 주소다. "실측"은 이 Mac(macOS 26.6.2) 한 대의 값이다. 각 행은 E0(외부 문서) 또는 E1(실측)이다. 한 행이 검증 표의 여러 행 코드를 묶은 경우 괄호 안에 적었고, 그 코드도 같은 접두로 인용할 수 있다(예: `E-A11Y-U16`은 `E-A11Y-U14` 행 안에 있다). ID는 행 코드이고 행 번호 순서가 아니다.

### 2.1 `E-APPLE` — Apple HIG·AppKit·WebKit(verify-apple.md 확정 1~31)

HIG 본문은 `developer.apple.com/tutorials/data/design/human-interface-guidelines/<page>.json`에서 받아 문장 단위로 대조했다. `HIG:<page>` = `https://developer.apple.com/design/human-interface-guidelines/<page>`.

| ID | 사실 | 출처 | 쓰는 곳 |
|---|---|---|---|
| E-APPLE-01 | macOS 기본 글자 13pt, 최소 10pt | HIG:typography | D11 |
| E-APPLE-02 | macOS 텍스트 스타일 크기/행 높이: 26/32, 22/26, 17/22, 15/20, 13/16(Headline Bold), 13/16, 12/15, 11/14, 10/13 ×3. 강조 굵기 Bold·Bold·Bold·Semibold·Heavy·Semibold·Semibold·Semibold·Semibold·Medium·Semibold | HIG:typography + `NSFont.preferredFont` 실측 | D12 |
| E-APPLE-03 | 권장 굵기 Regular/Medium/Semibold/Bold, Ultralight·Thin·Light는 피한다(권고, "In general"). 서체 종류 최소화. 시스템 글꼴을 임베드하지 않는다 | HIG:typography | D13 |
| E-APPLE-04 | macOS 트래킹 곡선(1/1000 em): 10pt +12, 11 +6, 12 0, 13 −6, 14 −11, 15 −16, 16 −20, 17 −26, 18 −25, 20 −23, 22 −12, 24 +3, 26 +8, 28 +14, 80pt 이상 0. 단조가 아니다 | HIG:typography | D14 |
| E-APPLE-05 | WKWebView(WebKit 26.5)에서 `system-ui`·`-apple-system`의 글자 폭이 AppKit `systemFont`와 0.02px 이내로 같다. `letter-spacing`을 더하면 Apple 곡선 위에 가산된다. `'SF Pro Text'` 같은 이름 지정은 폴백이 된다 | 실측 + https://webkit.org/blog/3709/using-the-system-font-in-web-content/ | D14, foundations §3.1 |
| E-APPLE-06 | Chromium은 `-apple-system`을 시스템 글꼴로 쓰지 않는다. 스택은 `system-ui`가 앞 | 실측(Chromium 149 mac) | foundations §3.1 |
| E-APPLE-07 | macOS에서 한글은 `.AppleSDGothicNeoI-*`로 폴백하고 크기는 그대로. 웹뷰의 `line-height: normal`은 한글만 있어도 13px에서 16(주 글꼴 SF 메트릭). AppKit의 한글 자연 행간 13은 웹에 이식되지 않는다 | 실측 | D12 |
| E-APPLE-08 | macOS에는 Dynamic Type이 없다. 글자는 최소 200%까지 키울 수 있어야 한다(HIG). WCAG 1.4.4도 200% | HIG:accessibility, WCAG 2.2 | D28 |
| E-APPLE-09 | 대비: HIG는 WCAG AA 값을 쓴다(17pt 이하 4.5:1, 18pt 이상 3:1, Bold 3:1). Dark Mode 최소 4.5:1, 사용자 정의 색은 7:1 지향. WCAG 큰 글자는 18pt(=24px) 또는 굵은 14pt(≈18.7px)이므로 pt=px로 읽은 HIG 표는 웹보다 느슨하다. 웹 기준은 WCAG | HIG:accessibility, HIG:dark-mode, https://www.w3.org/TR/WCAG22/#dfn-large-scale | foundations §2.1·§2.5 |
| E-APPLE-10 | WCAG 2.2: 비텍스트 대비 3:1(1.4.11), 줄 간격 1.5·문단 2·자간 0.12·단어 0.16(1.4.12), 포커스 외곽 2 CSS px·3:1은 AAA(2.4.13) | WCAG 2.2 | D19·D20 |
| E-APPLE-11 | macOS 시맨틱 글자색은 한 잉크의 알파로 위계: label 0.85, secondary 0.50(다크 0.55), tertiary 0.26(0.25), quaternary 0.10. separator 잉크 α0.10. 포커스 링 색은 악센트 α0.5. 값은 하드코딩 금지 대상이라 구조만 채택 | 실측(`NSColor`) | D19(separator α.10) |
| E-APPLE-12 | 한 색에 한 의미, 색만으로 상태 전달 금지, 라이트·다크·고대비 변형을 모두 둔다, 주 동작 색은 배경에, 앱 고유 라이트/다크 설정 금지 | HIG:color, HIG:dark-mode | D5·D7·D10 |
| E-APPLE-13 | 비활성 창의 선택 색은 회색(unemphasizedSelectedContentBackground, 비포커스 목록 행은 회색 하이라이트). 근거는 HIG:color·HIG:focus-and-selection(HIG:windows가 아니다) | HIG:color, HIG:focus-and-selection | D8, foundations §10 |
| E-APPLE-14 | `prefers-reduced-transparency`는 WebKit(macOS WKWebView)에서 지원되지 않는다. `prefers-contrast`·`prefers-reduced-motion`은 지원된다 | 실측 + BCD 8.1.5 | foundations §6.3·§11 |
| E-APPLE-15 | 콘텐츠 층에는 Liquid Glass를 쓰지 않는다(예외: 활성화 순간의 슬라이더·토글). 툴바 배경·착색 최소화. 커스텀 창 UI 금지 | HIG:materials, HIG:toolbars, HIG:windows | D26 |
| E-APPLE-16 | HIG에 8pt 격자·창 여백 수치는 없다. 접근성 문서의 여백은 베젤 있는 요소 약 12pt, 없는 요소 약 24pt(터치 맥락) | HIG:layout, HIG:accessibility | D17 |
| E-APPLE-17 | AppKit 표준 간격: 가장자리 20, 형제 8, `NSStackView` 8, `NSGridView` 6 | 실측(VFL) | D17 |
| E-APPLE-18 | 최소/기본 클릭 영역: macOS 20/28pt, iOS·watchOS 28/44, visionOS 28/60, tvOS 56/66. Buttons 페이지는 일반 규칙으로 44×44 | HIG:accessibility, HIG:buttons | D16 |
| E-APPLE-19 | AppKit 컨트롤 높이(Tahoe): push·팝업·세그먼트 16/20/24/28/36(mini~XL). 텍스트 입력 최대 24. 체크박스·라디오 12/14/16/18/18, 슬라이더 12/14/16/20/20, 진행 막대 12/12/20/20/20, 스피너 10/16/32/32/32. 스위치 36×16/44×20/54×24/64×28/80×36(앱 객체 초기화 뒤 측정). 글꼴 mini 9, small 11, 나머지 13 | 실측(`intrinsicContentSize`) | D16, foundations §5 |
| E-APPLE-20 | 모양: mini·small·medium은 둥근 사각형, large·XL은 캡슐(반지름 = 높이/2). 동심 반지름은 부모 반지름에서 패딩을 뺀 값. 안팎 겸용 컴포넌트는 동심 + fallback. iPad·Mac의 가장자리 컨트롤은 동심. 캡슐은 밀집 데스크톱에서는 눈에 띄는 동작에만 | https://developer.apple.com/videos/play/wwdc2025/356 전사본 | D18 |
| E-APPLE-21 | 주 버튼 뷰당 1~2개. 선호 동작은 크기가 아니라 스타일로. 파괴적 동작에 Primary 역할 금지. 커스텀 버튼엔 눌림 상태. 창을 여는 push button은 말줄임표. 이미지 버튼은 가장자리에서 약 10px 패딩 | HIG:buttons | D21·D36·D45 |
| E-APPLE-22 | 알림: 제목 + 선택적 설명 + 버튼 최대 3개, 제목 2줄 이하, 버튼 1~2단어 동사(OK는 정보 알림만, Yes/No 금지), 취소는 늘 "Cancel", 기본 버튼은 trailing/스택 맨 위, 취소는 leading/맨 아래("typically"), 파괴적 동작이 있으면 취소 필수·취소를 기본으로 하지 않음·기본이 하나뿐이면 Done, 취소 대체 Esc/Cmd+. , 알림 버튼은 title-style·끝 문장부호 없음 | HIG:alerts | D36 |
| E-APPLE-23 | 시트는 한 번에 하나, Done은 Cancel 또는 Back과 짝(셋 동시 금지), 반복 입력은 패널. 모달은 이점이 있을 때만·짧게·해제 방법 분명히·동시에 둘 이상 금지 | HIG:sheets, HIG:modality | D36 |
| E-APPLE-24 | 진행 표시: determinate 우선, 고르게, 계속 움직임, 스피너↔막대 전환 금지, "loading" 같은 모호어 금지, 일관된 위치, 취소 가능하면 취소 버튼, 부분 손실 있으면 일시정지도 함께 | HIG:progress-indicators | D23·D40 |
| E-APPLE-25 | 라디오 2~5개(약 5개 넘으면 팝업), 세그먼트 약 5~7개·균등 폭·라벨은 명사, 사이드바 2단계까지, 툴바 제목 15자 미만·앱 이름 금지·prominent 하나는 trailing, 설정 Cmd+, | HIG:toggles, HIG:segmented-controls, HIG:sidebars, HIG:toolbars, HIG:settings | components.md |
| E-APPLE-26 | 포커스: 텍스트/검색 필드는 링, 목록은 행 하이라이트, 사용자 조작 없이 포커스 이동 금지. 포커스 링 두께는 Apple이 문서화하지 않았다 | HIG:focus-and-selection | D20 |
| E-APPLE-27 | 글쓰기: 버튼·링크는 동사, "여기를 클릭" 금지, "we" 금지, 소유 대명사 최소, 빈 화면엔 다음 행동, 오류는 가까이·비난 없이·해결 방법, placeholder가 사라져도 남는 별도 라벨, 요소 종류별 대소문자 일관 | HIG:writing, HIG:text-fields | D44·D51, content.md |
| E-APPLE-28 | SwiftUI 기본 애니메이션 = spring(response 0.55, damping 1.0). smooth/snappy/bouncy = duration 0.5, bounce 0/0.15/0.3(감쇠 1.0/0.85/0.70), 실제 정착 0.80/0.88/1.04s. bounce 0이 범용, 0.4 초과는 UI에 과함 | https://developer.apple.com/documentation/swiftui/animation/default , WWDC23 10158, 실측 | D22 |
| E-APPLE-29 | Reduce Motion: 스프링을 조이고 이동 전환을 페이드로 바꾸고 블러 진입·퇴장을 피한다. 모두 0ms로 끄라는 말은 아니다. 자주 쓰는 상호작용엔 움직임을 더하지 않고, 애니메이션 끝을 기다리게 하지 않는다 | HIG:motion, HIG:accessibility | D22 |
| E-APPLE-30 | CSS `linear()`, `:focus-visible`, `:has()`, `light-dark()`, `color-mix()`, nesting, `@layer`, container query, `text-wrap: balance`, `scrollbar-gutter`는 WebKit 26.5·Chromium 149에서 모두 지원. `corner-shape`·`interpolate-size`·`prefers-reduced-transparency`는 WebKit 미지원. (최신 엔진 기준. 하한 엔진 지원은 `E-DESK-E25`) | 실측 + BCD 8.1.5 | foundations §11 |
| E-APPLE-31 | 아이콘 굵기는 인접 글자와 맞추고 앱 전체가 같은 크기·세부 수준·선 굵기·시점을 갖는다. 광학 정렬 보정은 에셋 패딩에 넣는다. SF Symbols는 앱 아이콘·로고·상표 용도로 쓸 수 없다. 비 Apple 플랫폼 번들 가능 여부는 약관 원문 미확인이므로 쓰지 않는다(`E-ID-K01`이 라이선스 원문을 확인했다) | HIG:icons, HIG:sf-symbols | D31·D32 |

### 2.2 `E-KO` — 한국어 타이포·문구·상호작용·WCAG(verify-korea-interaction.md 확정 1~34)

| ID | 사실 | 출처 | 쓰는 곳 |
|---|---|---|---|
| E-KO-01 | TDS: 크기/행간 30/40, 26/35, 22/31, 20/29, 17/25.5, 15/22.5, 13/19.5, 11/16.5. 11~18px 구간 행간은 정확히 1.5배. 굵기 5단. 시스템 글자 크기 100~310%를 흡수하고 토큰마다 상한. 라벨: 17 일반 본문, 15 작은 본문, 13 안 읽어도 됨, 11 아예 안 읽어도 됨. 값은 하드코딩하지 말라고 명시 | https://tossmini-docs.toss.im/tds-react-native/foundation/typography/ | D11(Worker 15), foundations §3.3 |
| E-KO-02 | SEED: t1~t14 = 11/15, 12/16, 13/18, 14/19, 16/22, 18/24, 20/27, 22/30, 24/32, 26/35, 28/38, 32/42, 40/52, 48/60. 굵기 400/500/700. rem(1rem=16px), `-static` px 토큰. articleBody 16/24. 자간 토큰 없음. macOS·iOS·Android는 시스템 글꼴, Windows만 Pretendard. medium(500)은 플랫폼마다 두께가 다르게 보인다 | https://seed-design.io/foundations/typography | D13 |
| E-KO-03 | KRDS: 본문 최소 16px, 표준형 17px. 줄 간격 최소 150%, 상대 단위. 자간 0px(Display·Heading xlarge/large만 1px). 굵기 기본 400+700, 이상적 400/500/700, 최대 약 4종. Body 19/17/15/13, Heading 40/32/24(PC) 28/24/22(모바일) 19/17/15, Display 60/44/36(PC) 44/32/28(모바일) | https://www.krds.go.kr/html/site/style/style_03.html | D13·D14 |
| E-KO-04 | W3C klreq: 한글 기본 자간 0. 줄 간격 지정 방식 4가지, 권장 수치 없음. 한글 줄 끝은 글자 단위/어절 단위 둘 다 허용 | https://w3c.github.io/klreq/ | D14, foundations §3.5 |
| E-KO-05 | 2018년 국내 사이트 실측(참고): 네이버 17px/27px/−0.3px, 다음 17/27.625/−0.02em, 리디북스 13px/−0.03em(keep-all), 퍼블리 18px/1.8/자간 0(keep-all), 핀치 −1px, 브런치 +0.8px. "한글은 −0.02em"은 표준이 아니라 일부 포털 관행 | https://lqez.github.io/blog/hangul-typo-on-web.html | D14 |
| E-KO-06 | Pretendard: 9굵기+가변, OFL, 한글 Source Han Sans/라틴 Inter 기반. 가변 woff2 2,057,688 B, wght 45~930, GSUB에 `tnum` 있고 기본 숫자는 가변폭, 세로 메트릭 1950/−494(upm 2048) | https://github.com/orioncactus/pretendard , npm pretendard@1.3.9 실측 | 번들 금지 결정의 비용 근거 |
| E-KO-07 | 토스 서체: 숫자·영문은 한글보다 약간 크고 굵게 설계, 한글 시각 중앙을 위해 세로 메트릭 조정, 고정폭·가변폭 숫자 둘 다 제공 | https://toss.im/tossfeed/article/beginning-of-tps | 참고 |
| E-KO-08 | 이 기계 실측: macOS에서 한글을 `system-ui`로 그리면 Chromium·WebKit 모두 CSS 100~900이 9단으로 구분된다. `'Apple SD Gothic Neo'` 이름을 직접 쓰면 Chromium은 6단(100=200=300, 800=900), WebKit은 9단. WebKit 버그 140553은 NEW. `tnum`은 SF(`system-ui`)에서 동작하고 Apple SD Gothic Neo 숫자에서는 동작하지 않는다 | 실측 t2/t3.mjs, https://bugs.webkit.org/show_bug.cgi?id=140553 | foundations §3.1·§3.4 |
| E-KO-09 | 엔진 지원(Chromium 153, WebKit 26.5): `text-wrap: balance/pretty/stable`, `overflow-wrap: anywhere`, `word-break: keep-all`, `break-word`, `line-break: strict`, `scroll-padding` 모두 지원. 같은 200px 한글 문단의 줄 수가 엔진마다 다를 수 있다(Chromium 80px/WebKit 72px). webkit2gtk 4.1은 미확인 | 실측 | foundations §3.5 |
| E-KO-10 | MDN: `keep-all`은 CJK 단어 단위 줄바꿈 억제, 비CJK는 normal과 같다. `word-break: break-word`는 deprecated이며 `overflow-wrap: anywhere` + `word-break: normal`과 같다 | https://developer.mozilla.org/en-US/docs/Web/CSS/word-break | foundations §3.5 |
| E-KO-11 | 국립국어원: 아라비아 숫자 뒤의 단위 의존명사는 붙여 쓸 수 있다(`32회`, `2003년`). 영문 단위(`MB`·`%`) 판단은 없음 | https://www.korean.go.kr/nkview/nknews/200305/58_4.html | D48 |
| E-KO-12 | 국립국어원: 표제어·표어에는 마침표를 쓰지 않는다(원문 한정은 이것뿐) | https://www.korean.go.kr/nkview/nknews/200006/23_2.htm | D45 |
| E-KO-13 | 앱인토스 UX 라이팅: 모든 문구 해요체, 능동(`됐어요`→`했어요`), 긍정, 다이얼로그 왼쪽 버튼 `닫기` 통일(`취소`는 진행 중 작업 취소로 오해), `~시겠어요?`·`~시나요?`·`~께` 금지, `되어요`→`돼요`. 토스 UX writer: 바텀시트 제목 한 줄, 버튼 두 개일 때 `취소` 대신 `닫기`나 `다음에` | https://developers-apps-in-toss.toss.im/llms-full.txt , https://toss.im/tossfeed/article/uxwriter-interview | D43·D44 |
| E-KO-14 | 토스 코어밸류 5개와 원칙 8개. #5 점검 질문은 "이해하기 어려운 용어나 표현을 사용하지 않았는가?" | https://toss.tech/article/8-writing-principles-of-toss | content.md |
| E-KO-15 | Apple HIG Writing: 버튼·링크는 거의 항상 동사, `Send` > `Let's do it!`, `Click here` 대신 설명적 문구, 오류는 문제 가까이·비난 금지·할 일 명시, `oops!`·`uh-oh` 불필요, `we` 금지, 소유 대명사 불필요, 다단계 흐름의 `Get Started`/`Continue`·`Next`/`Done` 일관. **용어집 작성 권고는 이 페이지에 없다** | https://developer.apple.com/tutorials/data/design/human-interface-guidelines/writing.json | D43(용어집은 우리 선택)·D44 |
| E-KO-16 | MS 한국어 스타일 가이드(© 2022, 55쪽): 오류 문구는 `~니다` 완전한 문장+마침표, 영문 생략체는 풀어서, `제공하십시오`→`입력하세요`, `수행합니다`→동사로, 변수 뒤 조사는 `은(는)`·`이(가)`·`을(를)`·`과(와)`·`(으)로` 이중 표기, 규범 참조는 표준국어대사전. 해요체 기준은 없다 | https://learn.microsoft.com/ko-kr/globalization/reference/microsoft-style-guides (Korean 스타일 가이드 PDF `kor-kor-StyleGuide.pdf`. 내려받기 주소에 UUID가 있어 `scan` 규칙으로 적지 않는다) | D46(이중 표기 안 함) |
| E-KO-17 | 카카오 로그인 버튼 문구: 완성형 `카카오 로그인`, 축약형 `로그인`. `카카오 글씨`는 OFL | https://developers.kakao.com/docs/ko/kakaologin/design-guide | 참고 |
| E-KO-18 | Google Chat 오류 메시지 구조는 (1) 무엇이 문제였나(이유 포함) (2) 해결 방법 (3) 추가 도움 안내. "무엇/왜/어떻게" 3분해의 출처로 쓰지 말 것 | https://developers.google.com/workspace/chat/write-error-messages?hl=ko | D51(3요소는 우리 선택) |
| E-KO-19 | WCAG 2.4.11 Focus Not Obscured (Minimum) = AA: 포커스 컴포넌트가 작성자 콘텐츠에 완전히 가려지면 안 됨(부분 겹침 허용). `scroll-padding`(C43)이 충분 기법. 토스트가 빈 영역으로 들어오면 통과 | https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html | D37 |
| E-KO-20 | WCAG 2.4.13 Focus Appearance = **AAA**: 지표 면적 ≥ 비포커스 컴포넌트의 2 CSS px 둘레 면적, 같은 픽셀의 포커스 전후 대비 ≥ 3:1 | https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html | D20 |
| E-KO-21 | WCAG 2.5.8 Target Size (Minimum) = AA: 24×24 CSS px 이상. 미만이면 바운딩 박스 중심의 지름 24px 원이 다른 대상의 원과 겹치지 않아야. 예외: 동등 컨트롤, 인라인, UA 컨트롤, 필수 | https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html | D16 |
| E-KO-22 | WCAG 4.1.3 Status Messages = AA: `role="status"`는 결과·"busy", `role="alert"`는 경고·오류, `role="log"`는 순차 진행. 포커스를 옮기는 대화상자는 대상 아님. 중요하지 않은 내용에 `alert`/`assertive`를 쓰면 실패 | https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html | D35·D37, `A-FEAT-N3` |
| E-KO-23 | WCAG 1.4.11 Non-text Contrast = AA: UI 컴포넌트와 상태 표시(선택·포커스) 인접 색 대비 3:1, 비활성은 예외 | https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html | D19 |
| E-KO-24 | WCAG 2.2.2 Pause, Stop, Hide = **A**: 자동 시작+5초 초과+다른 콘텐츠와 병렬이면 정지 수단. 자동 갱신은 5초 예외 없음. 포커스 중에만 멈추는 방식은 수단이 아님 | https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html | D37 |
| E-KO-25 | forced-colors: `box-shadow`가 `none`으로 강제된다(출처 2 + Chromium 153 실측). 같은 조건에서 `outline: 2px solid transparent`는 시스템 색(`rgb(0,0,0)`)으로 보인다. WebKit(macOS) 에뮬레이션은 스타일을 강제하지 않는다 | https://www.tempertemper.net/blog/windows-high-contrast-mode-and-focus-outlines , https://tetralogical.com/blog/2023/01/13/foundations-visible-focus-styles/ , 실측 | D20, `A-PRIM-X1` |
| E-KO-26 | NN/g 응답 시간: 0.1초 즉각, 1.0초 흐름 유지, 10초 주의 한계. 10초 넘는 작업은 퍼센트 진행 표시. 2~10초는 가벼운 표시(작은 숫자 카운터). 전체량을 모르면 절대 값, 스피너는 최후 | https://www.nngroup.com/articles/response-times-3-important-limits/ | T2, C5 |
| E-KO-27 | NN/g 스켈레톤: 1초 미만은 표시 없음(깜박임). 1~10초: 전체 화면 로드는 스켈레톤, 단일 모듈은 스피너. 10초 초과·다운로드·변환은 진행 막대+예상 시간. 틀만 있는 프레임 스켈레톤 금지 | https://www.nngroup.com/articles/skeleton-screens/ | patterns.md 로딩 |
| E-KO-28 | NN/g 모션: 대부분 100~500ms. 단순 피드백 약 100ms, 큰 화면 변화 200~300ms, 약 400ms는 넓은 화면의 큰 이동에만, 500ms 넘으면 끌린다. 등장이 퇴장보다 길다(팝업 300/200~250ms). 등장 ease-out, 퇴장 ease-in, 선형 이동은 부자연(ease-in-out은 원문에 없음). 모바일/데스크톱 지침은 없다 | https://www.nngroup.com/articles/animation-duration/ | D22 |
| E-KO-29 | web.dev: 줄이기 설정은 비필수 모션을 제거하고 피드백 모션은 남긴다. 전정 반응은 의학적 필요. `animation: none` 대신 지속 시간을 약 1ms로 줄이면 `animationend` 의존 코드가 안 깨진다. JS 애니메이션은 `matchMedia('(prefers-reduced-motion: reduce)')` `change`를 직접 들어야 | https://web.dev/articles/prefers-reduced-motion | D22 |
| E-KO-30 | NN/g 빈 상태 3지침(시스템 상태·학습 단서·직접 경로), 로딩 중 "기록 없음" 금지, 오류 지침 7개(근접·색/애니메이션만 금지·모달은 심각한 오류만·쉬운 말·비난 금지·입력 보존·탐색은 오류 아님), 확인 대화상자(심각한 결과에만, 남용하면 습관적으로 넘긴다, Undo가 더 강한 보호, 요청을 다시 말하고 대상을 이름으로, 결과 라벨 버튼, 위험한 쪽을 기본으로 두지 않는다) | https://www.nngroup.com/articles/empty-state-interface-design/ , https://www.nngroup.com/articles/error-message-guidelines/ , https://www.nngroup.com/articles/confirmation-dialog/ | D36·D51, patterns.md |
| E-KO-31 | Carbon: 토스트 3줄 이하, 인라인 "under two lines", 액션형 라벨 2단어 이하. 위급 메시지에 타이머 닫힘 금지. 액션이 있는 토스트는 닫을 때까지 유지. 액션형 알림은 포커스를 가져간다 | https://carbondesignsystem.com/patterns/notification-pattern/ | D37 |
| E-KO-32 | GOV.UK: 배너 페이지당 하나, 검증 오류에 쓰지 않음, h1 앞. 오류 요약은 하나여도 항상 표시하고 포커스 이동, 제목 "There is a problem", 페이지 title "Error:" 접두. Atlassian: 배너는 시스템 수준, 플래그는 최소 상호작용, 심각도는 색+아이콘 짝(파랑 i / 초록 체크 / 노랑 삼각형 / 빨강 다이아몬드 / 보라 물음표) | https://design-system.service.gov.uk/components/notification-banner/ , https://design-system.service.gov.uk/components/error-summary/ , https://atlassian.design/foundations/content/designing-messages/ | D37·D54, `G-WEB-R19` |
| E-KO-33 | 진행 막대 지각(arXiv 2211.13909): 5초 막대에서 일정 속도·점점 빨라지는 막대가 가장 빠르게 인식, 끝 구간 앵커링. 파동·잔물결이 약 10.9% 짧게 느끼게 한다는 수치는 언론 요약으로만 일치 | https://arxiv.org/pdf/2211.13909 | D23 |
| E-KO-34 | APCA(Myndex, Bronze): Lc90 본문 선호, Lc75 본문 최소(18px 초과), Lc60(24px 초과), Lc45(36px 초과 또는 비유창 최소), Lc30 비유창·단발 최소. WCAG 3 후보이나 W3C 공식 권고 아님, WCAG 2 비율로 환산 불가 | https://github.com/Myndex/apca-introduction | 참고(쓰지 않음) |

### 2.3 `E-SCALE` — 빅테크 토큰·WCAG 번호·시스템 글꼴 실측(verify-scales.md F1~F37)

패키지 원문은 unpkg 고정 버전(`@fluentui/tokens@1.0.0-alpha.24`, `@carbon/layout@11.61.0`, `@carbon/styles@1.117.0`, `@carbon/type@11.69.0`, `@carbon/motion@11.54.0`, `@atlaskit/tokens@20.4.0`, `@atlaskit/button@25.4.7`, `@primer/primitives@11.10.0`, `@shopify/polaris-tokens@9.4.2`, `@shopify/polaris@13.9.5`, `@adobe/spectrum-tokens@15.5.0`, `@material/web@2.5.0`)에서 읽었다.

| ID | 사실 | 출처 | 쓰는 곳 |
|---|---|---|---|
| E-SCALE-01 | 간격 스케일은 거의 모든 시스템이 4px 기반이며 2px 반단계를 가진다. Fluent `0,2,4,6,8,10,12,16,20,24,32`, Carbon `2,4,8,12,16,24,32,40,48,64,80,96,160`, Atlassian `0,2,4,6,8,12,16,20,24,32,40,48,64,80`, Polaris `0,1,2,4,6,8,12,16,20,24,32,40,48,64,80,96,112,128`. 6px는 Carbon에만 없다 | unpkg 각 패키지 | D17 |
| E-SCALE-02 | Windows 11 간격은 관계로 못박는다: 버튼 사이·버튼-플라이아웃·컨트롤-헤더 8, 컨트롤-라벨·콘텐츠 영역 사이 12, 표면-가장자리 텍스트 16(epx) | https://learn.microsoft.com/en-us/windows/apps/design/basics/content-basics | D17 |
| E-SCALE-03 | 컨트롤 높이 24/32/40이 겹치는 구간: Fluent Button 24/32/40(패딩 3·5·8 + 행간 16·20·22 + 테두리 1×2), Primer 24/28/32/40/48, Carbon 24/32/40/48/64/80, Spectrum 데스크톱 20/24/32/40/48/56/64 | unpkg, https://github.com/microsoft/fluentui/blob/master/packages/react-components/react-button/library/src/components/Button/useButtonStyles.styles.ts | D16 |
| E-SCALE-04 | 기본 높이는 시스템마다 다르다: Fluent 32, Primer 32, Spectrum 32, M3 40(Small), Carbon 버튼 48/입력 40, Polaris는 폭 의존(<768px 32, ≥768px 28). **단일 "정답 32"는 없다** | unpkg, Polaris styles.css | D16(`X-SCALE-05` 참조) |
| E-SCALE-05 | 터치 영역은 시각 크기와 분리한다: Primer `control-minTarget-fine` 16, `coarse` 44. M3 최소 48dp. WCAG 2.5.8(AA) 24×24 CSS px, 2.5.5(AAA) 44×44 | unpkg Primer size.css, W3C | D16, foundations §5.1 |
| E-SCALE-06 | 반경은 관계로 정한다: Windows 상시 컨트롤 4, 일시적·겹치는 요소 8, ToolTip 4, 막대형 4, 맞닿는 요소 0. Geist 표면 6·떠 있는 요소 12·전체 화면 16, 툴팁 6. Atlassian 2/4/6/8/12/16, Primer 3/6/12, M3 0/4/8/12/16/28(+Expressive 20·32·48) | https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/geometry , https://vercel.com/geist/materials.md | D18 |
| E-SCALE-07 | 아이콘: Fluent 버튼 아이콘 20(large 24), Carbon 16/20, M3 버튼 아이콘 20/20/24/32/40, Spectrum workflow 14/16/20/22/26 | unpkg | D32 |
| E-SCALE-08 | 데스크톱 본문은 14/20이 대세: Fluent, Windows, Atlassian, M3 Body M, Carbon body-long-01, Polaris body-lg, Spectrum size-100(14/18). 보조/캡션은 12/16이 공통이고 11~10은 극히 제한적(Primer caption은 "접근성 기준을 못 넘길 수 있다" 주석) | unpkg, https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/typography | D11(반례로 기록), D12(최소 12) |
| E-SCALE-09 | Windows 타입 문서의 최소값 "14px Semibold, 12px Regular", 문장형 대소문자, 줄당 50~60자(20 미만·60 초과는 읽기 어려움), 강조는 Semibold. 이 표는 라틴·그리스·키릴 기준이고 한국어 UI 글꼴은 Malgun Gothic(Regular만 명시) | 같은 URL | D11·D13, Q1 |
| E-SCALE-10 | 행간: 정수 px로 쓰는 시스템(Fluent·Windows·Atlassian·M3·Carbon 일부)과 비율로 쓰는 시스템(Primer 1.25/1.375/1.5/1.625/1.75, Spectrum 1.3/1.5). 비율 방식은 14×1.5=21, 12×1.625=19.5처럼 비정수를 낳는다 | unpkg | D12(정수 행간) |
| E-SCALE-11 | Spectrum은 CJK 전용 행간 비율을 공식 토큰으로 가진다: 1.5(`cjk-line-height-100`), 1.7(`cjk-line-height-200`) | https://unpkg.com/@adobe/spectrum-tokens@15.5.0/src/typography.json | D12(읽기 행간) |
| E-SCALE-12 | WCAG 1.4.12(AA): 행간 1.5×·문단 2×·자간 0.12×·단어 0.16×로 덮어써도 내용이 깨지지 않아야 | W3C | foundations §3.2 |
| E-SCALE-13 | M3 타입 15역할 크기/행간/자간(Display 57/64·45/52·36/44, Headline 32/40·28/36·24/32, Title 22/28·16/24·14/20, Body 16/24·14/20·12/16, Label 14/20·12/16·11/16)과 Carbon 산식 Y1=12, Yn=Yn−1+(⌊(n−2)/4⌋+1)×2는 1차 소스로 확정 | material-web `_md-sys-typescale.scss`, `@carbon/type` `_scale.scss` | 참고 |
| E-SCALE-14 | 굵기: Windows Regular/Semibold만, M3 400/500, Fluent 400/500/600/700(Button 기본 600), Primer 300/400/500/600, Atlassian 400/500/600/653, Polaris 450/550/650/700(가변 Inter), Vercel 400/450/500/600 | unpkg | D13 |
| E-SCALE-15 | 마이크로 상호작용은 100~150ms가 수렴점(Fluent 100/150, Carbon 110/150, Atlassian 100/150, Primer 100, M3 100/150, Polaris 100/150, Vercel 150). 중간 200~300, 400 이상은 배경 어둡힘·히어로 등 예외 | unpkg | D22 |
| E-SCALE-16 | Primer 역할 토큰: micro 100 "hover, focus ring, and color shifts", short 200 "expand/collapse, toggles", medium 300 "modals and dropdowns", long 500 "Use sparingly". enter = easeOut `(0.3,0.8,0.6,1)`, exit = easeIn `(0.7,0.1,0.75,0.9)`. 합성: enter 300+easeOut, exit 200+easeIn, hover 100+ease, stateChange 200+easeInOut | https://unpkg.com/@primer/primitives@11.10.0/dist/css/functional/motion/motion.css | D22 |
| E-SCALE-17 | Fluent `decelerateMid` = M3 `standard-decelerate` = `cubic-bezier(0,0,0,1)` | unpkg curves.js, material-web `_md-sys-motion.scss` | D22 |
| E-SCALE-18 | Vercel 원칙: "Add motion only when it explains a state change, preserves continuity, or confirms an action." 기본값은 정지 | https://vercel.com/design.md | D22, P5 |
| E-SCALE-19 | `linear()` 이징은 WKWebView·Chromium(최신) 모두 지원. (하한 Safari 16.4에는 없다: `E-DESK-E25`) | 실측 | foundations §11(금지) |
| E-SCALE-20 | 포커스 링 두께는 2px 수렴(Carbon·Atlassian·Primer·Polaris·Spectrum·Fluent), M3만 3px. WCAG 2.4.13(AAA)의 "2 CSS px 둘레 + 3:1"과 일치. 위치는 Primer·Carbon 안쪽 −2px, Spectrum 바깥 gap 2, M3 바깥 2/안쪽 −3, Polaris 버튼 바깥 1px | unpkg | D20 |
| E-SCALE-21 | 고대비 대응: Carbon은 `prefers-contrast`에서 점선, Fluent·Polaris는 `forced-colors`에서 `Highlight`. 두 쿼리 모두 WKWebView·Chromium에서 파싱된다 | unpkg, 실측 | foundations §2.5·§2.7 |
| E-SCALE-22 | WCAG AA 번호: 1.4.3 텍스트 4.5:1(큰 글자 3:1 = 18pt 또는 14pt bold), 1.4.11 비텍스트 3:1, 2.4.7 포커스 가시, 2.4.11 포커스 가려짐 금지, 2.5.8 타깃 24px, 1.4.4 200% 확대, 1.4.12 텍스트 간격. 2.4.13·2.5.5(44px)·2.3.3은 AAA | https://www.w3.org/TR/WCAG22/ | foundations §2 |
| E-SCALE-23 | 상태 처리 두 갈래. 오버레이 불투명도: M3 hover .08/focus .12/pressed .12/dragged .16, Spectrum 0.1, Atlassian ≈6%/14%/29%. 개별 토큰: Fluent, Carbon, Primer, Geist | unpkg | D21 |
| E-SCALE-24 | Disabled: M3 콘텐츠 0.38, Atlassian 0.4(loading 0.2), Spectrum 0.3. 전용 색 토큰: Fluent, Carbon, Primer(`#eff2f5`/`#818b98`), Polaris | unpkg | D21(전용 색) |
| E-SCALE-25 | 상태색만으로 정보를 전달하지 않는다(Atlassian: "Don't use a token just because the colors appear to match.") | https://atlassian.design/foundations/tokens/design-tokens | D10 |
| E-SCALE-26 | Fluent 6단계 두 겹 그림자: shadow4 `0 0 2px ambient, 0 2px 4px key`, shadow16 `0 0 2px, 0 8px 16px`, shadow28 `0 0 8px, 0 14px 28px`, shadow64 `0 0 8px, 0 32px 64px`. Spectrum은 모두 3겹. Geist: 그림자는 반투명으로. Vercel 브랜드는 장식 그림자·가짜 깊이 "Hard reject" | https://unpkg.com/@fluentui/tokens@1.0.0-alpha.24/lib/utils/shadows.js , https://vercel.com/design.md | foundations §6.4(구조) |
| E-SCALE-27 | Windows 재질: Mica(불투명·기반 레이어), Acrylic(일시적·light-dismiss 표면만), Smoke(모달 아래, 반투명 검정) | https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/materials | 참고 |
| E-SCALE-28 | DTCG 2025.10은 안정판이지만 W3C 표준 트랙이 아니다. 2026-09-08 드래프트는 구현 금지. `$value`, 이름에 `$ { } .` 금지, dimension `{value, unit: px\|rem}`(0도 단위 필수), 색 `{colorSpace, components, alpha?, hex?}`(14개 색공간, `oklch`·`display-p3` 포함, `hex`는 6자리 폴백), cubicBezier x는 [0,1], fontWeight 1~1000. Resolver `version: "2025.10"`·`resolutionOrder` 필수 | https://www.designtokens.org/tr/2025.10/format/ , https://www.designtokens.org/tr/2025.10/color/ , https://www.designtokens.org/tr/2025.10/resolver/ | D3 |
| E-SCALE-29 | Style Dictionary v4는 DTCG를 쓰되 2025.10 전체는 미지원(v5 진행 중), 타입 이름 자동 변환 없음 | https://styledictionary.com/info/dtcg/ | D3(자체 생성기) |
| E-SCALE-30 | Radix 12단계 역할(1 앱 바탕 … 12 고대비 글자)과 "11·12는 같은 스케일의 2단계 배경 위에서 APCA Lc 60·90 보장" | https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale | 참고 |
| E-SCALE-31 | `light-dark()`는 Baseline 2024(2024-05), `color-scheme: light dark` 필요. OKLCH 소스 파생은 Linear(98변수→3입력), Tailwind v4(oklch 팔레트 26색상군×11단계)가 실제로 쓴다 | https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/light-dark , https://linear.app/now/how-we-redesigned-the-linear-ui , https://tailwindcss.com/docs/colors | D3(OKLCH 설계→hex 커밋) |
| E-SCALE-32 | Primer 테마 속성은 `data-color-mode`·`data-light-theme`·`data-dark-theme`, 테마 9개. Carbon 면 번호는 `layer-0N`↔`border-subtle-0N`↔`field-0N`이 맞물린다 | https://primer.style/product/primitives/ , https://carbondesignsystem.com/elements/color/tokens/ | foundations §10 |
| E-SCALE-33 | 이 기계 WKWebView·Chromium 153 모두 `oklch()`, `light-dark()`, `color-mix()`, 상대 색, `@layer`, `@property`, nesting, `@scope`, `:has()`, `linear()`, `text-wrap: balance/pretty`, `scrollbar-gutter`, `word-break: keep-all`, `font-variant-numeric: tabular-nums` 지원. 구형 macOS WebKit은 미측정 | 실측 | foundations §11은 하한(`E-DESK-E25`)을 따른다 |
| E-SCALE-34 | 엔진 차이: `interpolate-size`·`calc-size()`·`text-spacing-trim`·`corner-shape`는 WKWebView에 없다, `hanging-punctuation`은 Chromium에 없다 | 실측 | foundations §11 |
| E-SCALE-35 | macOS `system-ui`는 12/13/14/16px에서 줄 높이 `normal`이 15/16/17/18이고 한글이 섞여도 같다. AppKit 기본 줄 높이 11→13, 12→15, 13→16, 14→17, 15→18, 16→18, 17→20, 20→23. SF 14px cap-height 9.864(0.705em), x-height 7.369(0.526em) | 실측 | D12 |
| E-SCALE-36 | macOS `system-ui` 한글은 Apple SD Gothic Neo이고 400/500/600/700이 모두 다른 굵기로 그려진다(800은 900과 같음). Windows는 Malgun Gothic이며 MS 문서 표에 Regular만 적혀 있어 굵기가 제한될 수 있다(미측정). 굵기 단계 수는 이 근거만으로 정할 수 없다 | 실측 + MS Learn typography | D13, Q1 |
| E-SCALE-37 | `tabular-nums`가 시스템 글꼴에서 동작한다(`1111`과 `0000`의 폭이 같아진다) | 실측 | foundations §3.4 |

### 2.4 `E-DESK` — 웹뷰 엔진 하한·셸·체감 성능(verify-desktop-engine.md)

행 코드는 검증 표의 것이다(`R` research-desktop, `E` engine, `N` shell, `L` launch). 실측은 BCD 8.1.5 로컬 설치, WebKit 태그 원문, Vite 8.3.2·Lightning CSS 1.33.0 소스·실행, Swift AppKit, 로컬 crate 소스로 했다.

**엔진·하한**

| ID | 사실 | 출처 | 쓰는 곳 |
|---|---|---|---|
| E-DESK-E01 | Vite 8 기본 `build.target`/`cssTarget` = chrome111, edge111, firefox114, safari16.4, ios16.4(기준일 2026-01-01). `cssTarget` 기본은 `build.target`과 같다. 개발 서버 CSS transformer 기본은 `postcss` | https://vite.dev/config/build-options + Vite 8.3.2 소스 | D1 |
| E-DESK-E03 | `es2022`는 chrome94, edge94, safari16.4, ios16.4, firefox93, opera80으로 풀린다 | Vite 8.3.2 `esMap` | D1(현재 `build.target 'es2022'`) |
| E-DESK-E05 | Tauri 기본 `bundle.macOS.minimumSystemVersion`은 `10.13`, `webviewInstallMode` 기본 downloadBootstrapper | https://v2.tauri.app/reference/config/ | D1 |
| E-DESK-E06 | Tauri 전제 조건: macOS 10.15 이상, Windows 7 이상(WebView2는 Windows 10 1803부터 설치됨). Rust 하한 aarch64-apple-darwin 11.0+, x86_64-apple-darwin 10.12+, Windows 10+(`E-DESK-E07`) | https://v2.tauri.app/start/prerequisites/ , https://doc.rust-lang.org/rustc/platform-support.html | D1 |
| E-DESK-E09 | Safari 16.4 = WebKit 615.1.26 = macOS 13.3. Safari 16.1/16.2/16.3 = macOS 13.0/13.1/13.2(`E-DESK-E10`). 지원 끝난 macOS는 WebKit 갱신 없음(`E-DESK-E08`). BCD: 16.2=614.3.7, 16.4=615.1.26, 17.4=618.1.15, 17.5=618.2.12, 18=619.1.26, 18.2=620.1.16, 26=622.1.22, 26.2=623.1.14, 26.4=624.1.16, 27=625.1.29(2026-09-14) | https://v2.tauri.app/reference/webview-versions/ , BCD | D1 |
| E-DESK-E13 | WebView2 Evergreen은 자동 갱신되나 관리자가 끄거나 오프라인이면 늦을 수 있다. Windows 7/8/8.1은 Edge·WebView2 109가 끝(`E14`). Windows 10 22H2는 최소 2028년 10월까지 갱신(`E15`) | https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution , https://learn.microsoft.com/en-us/deployedge/microsoft-edge-supported-operating-systems | D1 |
| E-DESK-E16 | Ubuntu `libwebkit2gtk-4.1-0`: 22.04 갱신본 2.50.4(미갱신·ports 2.36.0), 24.04 2.52.6, 25.10 2.52.3, 26.04 2.52.6. Debian 12 2.50.6, 13 2.54.0, sid 2.54.1(`E17`). Tauri 공식 표는 22.04를 2.36(WebKit 614, Safari 16.0) "very incomplete"로 적는다(`E19`) | https://packages.ubuntu.com/search?keywords=libwebkit2gtk-4.1-0&searchon=names&suite=all&section=all , https://packages.debian.org/search?keywords=libwebkit2gtk-4.1-0&searchon=names&suite=all&section=all | D1 |
| E-DESK-E20 | WebKitGTK 줄기의 WebKit 번호: 2.36=614, 2.38=615, 2.40=616, 2.42=617, 2.44=619, 2.46=620, 2.48=622, 2.50=623, 2.52=625, 2.54=626 | WebKit 태그 `Version.xcconfig` 실측 | D1(2.40 = Safari 16.4 상당) |
| E-DESK-E24 | 우리 CI: 렌더 작업은 ubuntu-24.04, `bundle (linux)`만 ubuntu:22.04 컨테이너 | `.github/workflows/ci.yml` | D1 |
| E-DESK-E25 | CSS 기능 최초 완전 지원(BCD 8.1.5, Safari/Chrome): oklch 15.4/111, color-mix 16.2/111, light-dark 17.5/123, 상대 색 18/122(16.4~18 partial), @property 16.4/85, :has 15.4/105, 컨테이너 쿼리 16.0/105, nesting 17.2/120, @layer 15.4/99, text-wrap balance 17.5/114, pretty 26/117, @starting-style 17.5/117, View Transitions 18/111, popover 17/114, dialog 15.4/37, inert 15.5/102, accent-color 26.2/93, field-sizing 26.2/123, scrollbar-gutter 18.2/94, scrollbar-width 18.2/121, backdrop-filter 18 무접두(9부터 `-webkit-`)/76, font-variant-numeric 9.1/52, prefers-contrast 14.1/96, forced-colors 16.0/89, 범위 미디어 쿼리 16.4/104, @scope 26.4/118, anchor-name 26/125, interpolate-size Safari 미지원/129, focus-visible 15.4/86, `linear()` 17.2/113. `prefers-reduced-transparency` Safari 미지원·Chrome 118. `ui-monospace` Safari 13.1만. `text-size-adjust` Safari 미지원 | https://github.com/mdn/browser-compat-data 8.1.5 | foundations §11 금지 목록 |
| E-DESK-E27 | `overscroll-behavior`는 Safari 16부터지만 **partial**(스크롤할 내용이 없는 컨테이너에는 효과 없음), Chrome 144부터 완전. 하한 엔진에서 `overflow:hidden`인 루트에 거는 `none`을 믿지 않는다 | BCD, https://bugs.webkit.org/show_bug.cgi?id=243452 | foundations §11 |
| E-DESK-E28 | WebKitGTK `backdrop-filter`는 GTK 고유 결함이 보고돼 있다(형제 요소 포함 2.44.2, NVIDIA DMABUF 끄면 blur 불가 2.50.3) | https://bugs.webkit.org/show_bug.cgi?id=275819 , https://bugs.webkit.org/show_bug.cgi?id=303811 | foundations §6.3(블러 금지) |
| E-DESK-E31 | `-webkit-font-smoothing`은 macOS에서만 동작한다 | https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/font-smooth | D15 |
| E-DESK-E32 | `system-ui`는 UI 요소용이고 긴 문단용이 아니다. Windows CJK 기본 글꼴이 라틴을 어색하게 그릴 수 있고 `lang`이 글꼴을 못 바꿀 수 있다 | https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/font-family | foundations §3.1, Q1 |
| E-DESK-E33 | `line-height: normal`은 UA 의존(데스크톱 약 1.2)이고 단위 없는 숫자가 권장이다. MDN의 "단락 최소 1.5"는 WCAG 1.4.8(AAA) 링크 | https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/line-height | foundations §3.5(`normal` 금지) |
| E-DESK-E35 | Lightning CSS 1.33.0: 대상에 Chrome 94·Firefox 93이 섞이면 `oklch()`가 hex+`lab()` 이중 선언. chrome111+safari16.4면 그대로. `color-mix(…var()…)`·상대 색은 var가 있으면 변환하지 않는다. nesting 평탄화, `-webkit-backdrop-filter` 자동, `light-dark()`는 `--lightningcss-light/dark` 변수로 낮춘다 | https://lightningcss.dev/transpilation.html + 실측 | D1·D3 |
| E-DESK-E39 | 현재 코드의 하한 안 사용: `color-mix(in srgb, var()…)` 3곳(Banner.svelte 34·38, DropOverlay.svelte 73), `:has()` 2곳(AppHeader.svelte 59, SettingsView.svelte 270) | 워크트리 grep | `A-DRIFT-C5` |

**Windows 규칙**

| ID | 사실 | 출처 | 쓰는 곳 |
|---|---|---|---|
| E-DESK-R14 | 표준 타이틀바 높이 32px, 검색창·프로필 포함 시 48px. 앱 아이콘 16×16, 왼쪽 16px, 32px 바에서 위아래 8px. 제목은 아이콘 뒤 16px(`R15`). 캡션 버튼 글리프 E921/E922/E923/E8BB, 상태 rest·hover·pressed·active·inactive(`R16`). 빈 곳 드래그, 우클릭 시스템 메뉴, 더블클릭 최대화/복원, 비활성 반투명, 텍스트 배율에 높이 증가(`R17`). 기본 배경 Mica(`R18`) | https://learn.microsoft.com/en-us/windows/apps/design/basics/titlebar-design | D26(네이티브 유지), foundations §5.1 툴바 [취향] |
| E-DESK-N08 | Microsoft 커서 지침: 클릭 가능한 요소에 항상 화살표, 손가락 금지(호버 효과 사용), 커서를 호버 피드백 수단으로 쓰지 말 것, 선택 가능한 텍스트에는 텍스트 커서, 마우스에는 포커스 사각형을 쓰지 않고 키보드에만 | https://learn.microsoft.com/en-us/windows/apps/develop/input/mouse-interactions | D25 |
| E-DESK-N02 | WebView2 `AreBrowserAcceleratorKeysEnabled` 기본 TRUE(Ctrl-F/F3, Ctrl-P, Ctrl-R/F5, Ctrl-±, Ctrl-Shift-C/F12, 뒤로/앞으로/검색). Ctrl-X/C/V/A/Z와 Home/End/PageUp/PageDown은 이 설정과 무관. `IsGeneralAutofillEnabled` 기본 TRUE, `IsPasswordAutosaveEnabled` 기본 FALSE(`N03`). Tauri 2.12.1은 이 설정을 노출하지 않는다(wry에는 있음, `N01`) | https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2settings3 , icorewebview2settings4, 로컬 wry 0.57.0 | platform.md(브라우저 키 차단) |
| E-DESK-L03 | WebView2 `DefaultBackgroundColor` 기본 흰색, 컨트롤러 옵션으로 일찍 지정해야 흰 번쩍임 방지, alpha는 255와 0만 | https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2controlleroptions3 | D30 |
| E-DESK-N31 | 작업 표시줄 진행: NORMAL(확정, 왼쪽→오른쪽), PAUSED(노랑, 재개 가능·오류 아님), ERROR(빨강), INDETERMINATE. 우선순위 ERROR > PAUSED > NORMAL > INDETERMINATE. 고대비에서는 표시되지 않는다. 오류·일시정지에서 빠져나올 때 NORMAL/INDETERMINATE 재호출. 웹 로딩·인쇄 같은 주변 작업용 아님 | https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-itaskbarlist3-setprogressstate | D29 |
| E-DESK-N32 | tao 0.37.1: macOS Dock에 `NSProgressIndicator`, Linux는 libunity.so.4/.6/.9 dlopen(없으면 효과 없음), Linux에서 Indeterminate·Paused·Error는 Normal, Windows는 호출마다 `CoCreateInstance(...).unwrap()` | 로컬 tao 소스 | D29(초당 1회 이하) |
| E-DESK-N35 | Microsoft 알림: 흐름 유지, 시끄럽지 않게, 클릭하면 알림의 문맥으로 앱이 열린다, 알림 센터 정리 | https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/app-notifications-ux-guidance | D38 |

**macOS 규칙(HIG·실측)**

| ID | 사실 | 출처 | 쓰는 곳 |
|---|---|---|---|
| E-DESK-N07 | 포인터: 화살표 = 콘텐츠·인터페이스 요소를 선택·상호작용하는 표준, 손가락 = URL 링크, I빔 = 텍스트. 표준 버튼·텍스트 입력에는 시스템 포인터 | https://developer.apple.com/design/human-interface-guidelines/pointing-devices | D25 |
| E-DESK-R29 | 데스크톱 웹앱 관례: 기본 `default`, `pointer`는 브라우저에서 페이지를 여는 링크에만("reserved for links") | https://evilmartians.com/chronicles/how-to-make-absolutely-any-app-look-like-a-macos-app , https://www.todesktop.com/blog/posts/designing-desktop-apps-cross-platform-ux | D25 |
| E-DESK-R30 | hover 최소화: 스타일 버튼·체크박스·표 행은 hover 변화 없음, 유령 버튼·드롭다운 메뉴 항목은 반응 | Evil Martians(위 URL) | D21 |
| E-DESK-R06 | Raycast 관례: 컨트롤에 `cursor: pointer` 없음, 대부분 hover 하이라이트 없음, 설정은 별도 네이티브 창, 판단 기준 "평범한 Mac 앱으로 보이는가". 팝오버·툴팁은 네이티브 창(`R07`) | https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast | D21·D25 |
| E-DESK-R01 | Linear: HSL→LCH, 테마 변수 98→3(base·accent·contrast)(`R02`), 제목 Inter Display·나머지 Inter(`R03`), 소음 감소·밀도 증가, "I often relied on Apple standards"(`R04`) | https://linear.app/now/how-we-redesigned-the-linear-ui | 참고 |
| E-DESK-N23 | HIG 메뉴 막대 순서: 앱 이름, 파일, 편집, 포맷, 보기, 앱 전용, 윈도우, 도움말. 앱 메뉴: About(첫 항목·구분선, 16자 이하, 버전 금지), Settings…, 앱 전용, Services, Hide, Hide Others, Show All, Quit(`N24`). 창이 하나여도 윈도우 메뉴, 도움말은 맨 오른쪽, 항목은 숨기지 말고 비활성(`N25`). 표준 단축키 ⌘Q, ⌘W, ⌘M, ⌘H, ⌥⌘H, ⌘,, ⌘Z, ⇧⌘Z, ⌘?, ⌃⌘F(`N26`) | https://developer.apple.com/design/human-interface-guidelines/the-menu-bar , HIG:keyboards | platform.md(메뉴) |
| E-DESK-N27 | Apple 한국어 메뉴 문자열(AppKit·TextEdit loctable 실측): 파일, 편집, 보기, 윈도우, 도움말, 복사하기, 오려두기, 붙여넣기, 전체 선택, 삭제, 최소화, 윈도우 닫기, 전체 화면 시작/종료, 모두 앞으로 가져오기, 설정…(구버전 환경설정…), 실행 취소/실행 복귀, 확대/축소, 기타 가리기, 모두 보기, 종료, 가리기, 관하여. muda 기본 문구는 영어("Undo", "Hide Others", "Toggle Full Screen")(`N28`) | 로컬 loctable, muda 0.20.0 소스 | D43(메뉴는 Apple 한국어) |
| E-DESK-N34 | HIG 알림: 앱 이름·아이콘을 넣지 않는다, 제목은 제목 스타일·끝 구두점 없음, 본문은 완전한 문장·문장 스타일, 잘라내지 말 것, 같은 일로 여러 알림 금지, 오류는 알럿으로, 앱이 앞에 있으면 조용한 갱신, 민감 정보 금지. 툴팁은 60~75자(`N41`) | https://developer.apple.com/design/human-interface-guidelines/notifications , HIG:offering-help | D38 |
| E-DESK-N33 | HIG 진행 표시: 가능하면 확정, 불확정→확정 전환, "5초에 90%, 나머지 5분"이면 속이는 느낌 | HIG:progress-indicators | D23 |
| E-DESK-L15 | HIG launching: 런치 화면은 첫 화면과 거의 같게, 스플래시·로고 금지, 이전 상태(스크롤·창 배치·위치) 복원, macOS는 런치 화면 불필요 | https://developer.apple.com/design/human-interface-guidelines/launching | D30 |
| E-DESK-R37 | 실측(macOS 26.6.2): 푸시 버튼 mini 16 / small 20 / regular 24 / large 28pt, 텍스트 필드 24pt, 스위치 54×24pt, 세그먼트 24, 체크박스 12/14/16/18. 시스템 글꼴 13pt(small 11, label 10). 13pt 줄 높이 16. 기본 accent #007AFF(sRGB 0, 0.478, 1). "약 22~28pt"는 틀렸다 | Swift `NSButton`/`NSTextField`/`NSSwitch` 실측 | D16·D11 |
| E-DESK-R33 | `AccentColor` 키워드는 WebKit에서 항상 파랑(지문 방지 의도, 버그 254578 RESOLVED INVALID) | https://bugs.webkit.org/show_bug.cgi?id=254578 | D8 |
| E-DESK-N30 | `applicationShouldTerminate:`는 Quit 메뉴 또는 `terminate:` 뒤 불리며 종료를 취소·지연할 수 있다. tao 0.37.1은 `applicationWillTerminate:`만 등록(`N29`). `NSUserNotification`은 11.0부터 deprecated(`N38`) | Apple 문서 JSON, 로컬 tao 소스 | platform.md |

**Tauri 설정 사실**

| ID | 사실 | 출처 | 쓰는 곳 |
|---|---|---|---|
| E-DESK-R19 | `titleBarStyle`(macOS) Visible/Transparent/Overlay, `trafficLightPosition`은 Overlay+decorations일 때만, `hiddenTitle`, `theme`은 Windows·macOS 10.14+, `acceptFirstMouse`, `shadow` 기본 true(장식 없는 Windows 창에서 1px 흰 테두리), `useHttpsScheme` 변경 시 저장소 접근 불가, `minWidth`는 논리 픽셀. `transparent`는 macOS에서 private API 필요(`R20`). `backgroundColor`는 Windows에서 창 레이어 alpha 무시(`R21`). `allowLinkPreview` 기본 true(`N05`). `zoomHotkeysEnabled` 기본 false(`N04`) | https://v2.tauri.app/reference/config/ , 로컬 `tauri-utils-2.10.1/src/config.rs` | D26·D28·D30 |
| E-DESK-R24 | `scrollBarStyle`: `default`/`fluentOverlay`, WebView2 런타임 125.0.2535.41 이상, 낮으면 무시, macOS·Linux 미지원, 같은 데이터 디렉터리의 웹뷰는 같은 값(`N12`) | https://github.com/tauri-apps/tauri/commit/f5851ee , Tauri config | D27 |
| E-DESK-N13 | `scrollbar-width: none`은 MDN이 피하라고 한다("negatively impacts accessibility"). `scrollbar-gutter`는 Safari 18.2부터라 하한 밖(`N14`) | https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/scrollbar-width , BCD | D27, foundations §11 |
| E-DESK-R22 | `data-tauri-drag-region`은 직접 붙인 요소에만, 터치·펜은 `app-region: drag`, 커스텀 타이틀바는 macOS 일부 네이티브 창 동작을 잃는다 | https://v2.tauri.app/learn/window-customization/ | D26 |
| E-DESK-R23 | window-vibrancy: vibrancy macOS 10.10+, liquid glass macOS 26+(interactive 27+), mica Win11, acrylic Win10/11(느림 경고), blur(22H1, 22621+ 느림), Linux 미지원 | https://github.com/tauri-apps/window-vibrancy | foundations §6.3(반투명 금지) |
| E-DESK-R40 | window-state: 창 생성 뒤 복원하므로 깜빡임이 있고 `visible:false`로 만들면 플러그인이 복원 뒤 보여 준다. 권한 `window-state:default`, Rust 1.90 이상 | https://v2.tauri.app/plugin/window-state/ | D30 |
| E-DESK-L25 | Tauri 이벤트는 저지연·고처리량용이 아니고 JSON 문자열, Channel은 빠르고 순서가 있다. `PROGRESS_INTERVAL` 250ms(`L26`, `crates/shell/src/services.rs:39`) | https://v2.tauri.app/develop/calling-frontend/ | D23 |
| E-DESK-L31 | Linux 그래픽 우회 환경변수 4종은 정상 사용자의 빠른 경로를 끄므로 영향받는 앱이라고 확인한 뒤에만 무조건 덮어쓴다 | https://v2.tauri.app/develop/debug/linux-graphics/ | platform.md |
| E-DESK-N37 | 알림 플러그인 데스크톱은 권한을 묻지 않고 항상 Granted, `show()` 결과 폐기, 그룹·예약 옵션 무시, notify-rust appname 기본은 실행 파일 이름. Windows는 설치된 앱만(`N36`) | 로컬 `tauri-plugin-notification-2.5.1`, `notify-rust-4.18.1`, https://v2.tauri.app/plugin/notification/ | D38, Q11 |
| E-DESK-N16 | 비접두 `user-select`는 WebKit에서 `CSS.supports` false, `-webkit-user-select`가 필요. `spellcheck`는 힌트, 민감 요소는 false 권장(`N17`). `autocapitalize`는 물리 키보드에 영향 없음(`N18`). `contextmenu`는 `preventDefault`로 막힌다(`N19`) | MDN + 실측 | platform.md·components.md |
| E-DESK-N20 | `:focus-visible`은 키보드·스크립트 포커스에서만, 포인터 클릭엔 보통 안 보임, 제거 금지. MDN은 1.4.11 3:1을 포커스 표시기에 적용(`N21`: 1.4.3 4.5:1, 1.4.11 3:1, 1.4.12, 2.4.13 AAA, 2.4.11 AA) | https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible , https://www.w3.org/TR/WCAG22/ | D20 |
| E-DESK-R39 | WCAG 2.5.8 Target Size (Minimum) AA 24×24 CSS px. 예외: 간격·동등 컨트롤·인라인·UA 컨트롤·필수 | https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html | D16 |

**성능·체감 시간**

| ID | 사실 | 출처 | 쓰는 곳 |
|---|---|---|---|
| E-DESK-L09 | Nielsen: 0.1초 즉각, 1초 흐름 유지, 10초 주의 한계. 10초 넘는 작업은 퍼센트 표시기+중단 수단. 2~10초는 바쁨 표시+빠르게 바뀌는 숫자. 양을 모르면 항목 이름 같은 절대 진행, 스피너는 최후 | https://www.nngroup.com/articles/response-times-3-important-limits/ | T2 |
| E-DESK-L10 | RAIL: 입력 후 100ms 안에 전환(입력 처리 50ms), 프레임 10ms(16ms 예산), idle 50ms 이하, 1000ms 넘으면 집중 상실, 10000ms 넘으면 이탈. INP 좋음 ≤200ms, 나쁨 >500ms(`L11`) | https://web.dev/articles/rail , https://web.dev/articles/inp | 참고 |
| E-DESK-L13 | Doherty 400ms는 1982년 IBM 논문(역사적 휴리스틱). Apple 400ms 첫 프레임은 iOS 런치 애니메이션 한정(`L14`). Microsoft는 절대 ms 목표를 주지 않는다(`L16`). 데스크톱 첫 창 목표 ms는 모든 출처에 없다(`L33`) | https://lawsofux.com/doherty-threshold/ , https://developer.apple.com/videos/play/wwdc2019/423/ , https://learn.microsoft.com/en-us/windows/apps/develop/performance/app-startup-performance | 수치 없음을 기록 |
| E-DESK-L18 | 로딩 표시 관행(표준 아님): Learning Equality 지연 300·최소 400ms, Stripe 200~300(알려진 느린 작업 0, 뷰 전환 100)(`L19`), Significa 300·1000(`L21`). Epic React spin-delay 기본은 delay 500·minDuration 200(`X-DESK-L20`) | https://design-system.learningequality.org/loaders , https://docs.stripe.com/stripe-apps/patterns/loading.md , https://foundations.significa.co/hooks/use-delayed-loading | patterns.md 로딩 [잠정] |
| E-DESK-L23 | Viget 단일 실험(n=136, 모바일 GIF): 체감 대기 스켈레톤 2.82s > 스피너 2.41s > 빈 화면 2.29s. "스켈레톤이 만능이 아니다"의 근거로만 | https://www.viget.com/articles/a-bone-to-pick-with-skeleton-screens | 참고 |
| E-DESK-L28 | web.dev 예시에서 top/left 애니메이션은 프레임 50% 드롭, transform은 1%(조건 미기재, 일반 수치 아님). Lighthouse DOM: body 약 800노드 초과 경고, 약 1,400 초과 오류(`L29`) | https://web.dev/articles/animations-guide , https://developer.chrome.com/docs/lighthouse/performance/dom-size | D23(`transform: scaleX`) |
| E-DESK-L01 | 흰 번쩍임: WKWebView 기본 배경 흰색(WebKit 215479 NEW), Tauri 이슈 1564(닫힘, PR #11486), WebView2 `DefaultBackgroundColor`·Tauri `backgroundColor`·`visible:false`+show 패턴은 근거 있음. phcode는 숨김 시작이 체감 로딩을 최대 200ms 늘려 옵션(`L07`). Tauri 2 beta Windows에서 숨김 메인 창의 자식 창 소실 사례(`L08`, 닫힘). wry 0.54.2가 WKWebView 배경색을 `transparent` feature 뒤에 구현(`L06`) | https://bugs.webkit.org/show_bug.cgi?id=215479 , https://github.com/tauri-apps/tauri/issues/1564 , https://github.com/phcode-dev/phoenix-desktop/pull/593 , https://github.com/tauri-apps/tauri/issues/9286 , https://v2.tauri.app/release/wry/v0.54.2/ | D30 |

### 2.5 `E-A11Y` — OS 접근성 설정·단위·배율·선·IME·클립보드(verify-a11y-units.md)

행 코드는 검증 표의 것이다(`A` 접근성, `U` 단위, `D` 배율·선, `T` 입력). 끝의 확정 사실 1~43은 `E-A11Y-F<n>`으로 같은 내용을 가리킨다(아래 표의 F 열).

| ID | F | 사실 | 출처 | 쓰는 곳 |
|---|---|---|---|---|
| E-A11Y-D01 | F1 | CSS는 선 굵기(border-width, outline, column-rule-width)를 기기 픽셀 정수로 맞춘다. 정수면 그대로, 0 초과 1 미만이면 1로 올림, 1 초과면 정수로 내림 | https://drafts.csswg.org/css-values-4/ | D19 |
| E-A11Y-D04 | F2 | 실제 배율(`--force-device-scale-factor`)에서 `border:1px`의 계산 폭은 125% 0.8px, 150% 0.666667px, 175% 0.571429px로 항상 정확히 1기기 픽셀. `deviceScaleFactor` 에뮬레이션은 스냅하지 않는다(`D06`). 시각 QA·자동 검사는 `--force-device-scale-factor`로 | 실측 Chromium 153 | D19·D61 |
| E-A11Y-D05 | F3 | 굵기×배율 기기 픽셀(100·125·150·175·200·250%): 0.5px = 1,1,1,1,1,1; 1px = 1,1,1,1,2,2; 1.5px = 1,1,2,2,3,3; 2px = 2,2,3,3,4,5. 실제 WKWebView 2x: 0.5→1, 0.75→1, 1→2, 1.5→3, 2→4(`D07`). 1.5px는 125%와 150%에서 위계가 뒤집히고 0.5px는 Windows 100~175%에서 1px과 같다 | 실측 | D19(1·2px만) |
| E-A11Y-D08 | F4 | `box-shadow` 링은 스냅되지 않는다. `0 0 0 1px`는 125% `[0.25,1]`, 150% `[0.5,1]`, 175% `[0.75,1]`로 번지고, `border 1px`는 모두 `[1]`. 포커스 링 기기 픽셀: box-shadow 2px 2/2.5/3/3.5/4, outline 2px 2/2/3/3/4(`D09`) | 실측 | D20(outline) |
| E-A11Y-D10 | F5 | `outline`은 Safari 16.4부터 항상 `border-radius`를 따른다. `outline-offset`은 Chromium·WKWebView에서 지원 | https://webkit.org/blog/13966/webkit-features-in-safari-16-4/ | D20 |
| E-A11Y-D03 | F6 | `height`는 스냅되지 않고 `border`는 스냅되므로 `calc(Npx - 1px)` 보정은 깨질 수 있다. `box-sizing: border-box`가 해법 | https://patrickbrosset.com/articles/2024-06-21-invasion-of-the-border-snappers/ | foundations §6.2 금지 |
| E-A11Y-D20 | F7 | WCAG 비텍스트 대비: UI 구성요소와 상태 단서는 인접 색 3:1 이상. 얇은 선은 더 옅게 그려질 수 있어 피하거나 기준을 넘는 색을 쓴다. 평가는 선언된 색으로. 포커스 지시자도 대비가 필요 | https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html | D19 |
| E-A11Y-D48 | F8 | 적용 전 토큰 대비: 라이트 `--border-strong #84939c`는 bg 2.89, surface-2 2.71, surface 3.17. 다크 `#6c7d87`는 bg 4.11, surface-2 3.24, surface 3.69. 후보 `#7d8b94` 3.20/3.00/3.50, `#718088` 3.73/3.50/4.08, 다크 `#72838c` 4.46/3.52/4.00 | 실측 cr.mjs | `A-DRIFT-A8`, D19 |
| E-A11Y-D41 | F9 | 적용 전 `--fg-muted #5b6b75`는 라이트 bg 5.05, `--fg #1c262e` 14.06. HDR 휘도 비(다크 `--bg` 1.60 등)는 참고값 | 실측 | 참고 |
| E-A11Y-D25 | F10 | Windows 한국어 UI 글꼴은 Malgun Gothic이고 굵기는 Semilight·Regular·Bold 세 가지(Semilight는 Windows 10 1507). CSS 폴백: 요청 굵기가 없으면 400~500은 500 이하 쪽부터, 500 초과는 더 무거운 쪽부터(`D27`) | https://learn.microsoft.com/en-us/typography/font-list/malgun-gothic , https://developer.mozilla.org/en-US/docs/Web/CSS/font-weight | D13, Q1 |
| E-A11Y-D26 | F11 | Windows 11 타입 램프(epx): Caption 12/16, Body 14/20, Body Strong 14/20, Body Large 18/24, Subtitle 20/28, Title 28/36, Title Large 40/52, Display 68/92. 굵기 Regular·Semibold. 최소값 12px Regular·14px Semibold는 Segoe UI Variable 기준 | https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/typography | D11·D12 |
| E-A11Y-D36 | F12 | macOS NSFont 실측: 시스템 13pt, small 11, label 10. 텍스트 스타일 largeTitle 26, title1 22, title2 17, title3 15, headline 13, subheadline 11, body 13, callout 12, footnote 10, caption1 10, caption2 10. Apple SD Gothic Neo는 Thin~Heavy 9굵기 | 실측 | D11 |
| E-A11Y-A18 | F13 | 실제 WKWebView에서 `font: 14px/normal system-ui`의 행간은 17px(한글 포함), `font:-apple-system-body`는 13px로 풀린다 | 실측 | D12 |
| E-A11Y-D34 | F14 | `-webkit-font-smoothing`은 macOS 전용 비표준. 적용 전 `app.css:10`에서 전역 `antialiased`(`D35`) | https://developer.mozilla.org/en-US/docs/Web/CSS/-webkit-font-smoothing | D15 |
| E-A11Y-D29 | F15 | GNOME 기본값: `font-antialiasing 'grayscale'`, `font-hinting 'slight'`, `font-rgba-order 'rgb'`, `text-scaling-factor 1.0`, `scaling-factor 0`(자동, 정수). WebKitGTK는 `gtk-xft-*`를 읽고 구독(`D30`). Cairo 포트는 hint metrics 켬, Skia 포트는 서브픽셀 위치를 "기기 배율 ≥ 2"(`D31`) | GNOME gschema, WebKit 소스 | Q2 |
| E-A11Y-D21 | F16 | Chromium Windows는 `SPI_GETFONTSMOOTHING`이면 AA·서브픽셀 위치, ClearType일 때만 서브픽셀 배열, 힌팅 MEDIUM. LCD 글자 비허용 사유: 불투명하지 않은 배경·내용, 정수 아닌 이동, `will-change: transform`, 필터, 변환 애니메이션(`D23`) | Chromium 소스 | foundations §6.2(`translate(-50%` 금지) |
| E-A11Y-D39 | — | Windows HDR: SDR 기준 흰색은 사용자 조절, 공칭 80니트(데스크톱 HDR 모니터 약 200니트), DWM이 scRGB FP16으로 합성한다. 조각 sRGB 곡선과 감마 2.2의 차이로 SDR 조각의 검정이 뜬다(`D40`, Microsoft 문서가 아닌 커뮤니티 설명이라 2차) | https://learn.microsoft.com/en-us/windows/win32/direct3darticles/high-dynamic-range , https://github.com/dylanraga/win11hdr-srgb-to-gamma2.2-icm | D9(순흑 없음), `X-SCALE-B3b` |
| E-A11Y-A01 | F17 | `forced-colors`는 WebKit(WKWebView·WebKitGTK)에서 늘 `none`이고 Windows WebView2(Chromium)에서만 `SPI_GETHIGHCONTRAST`로 켜진다(`A02`). BCD Chrome 89, Edge 79, Safari 16(값 none 고정)(`A03`) | WebKit `MediaQueryFeatures.cpp`, Chromium `os_settings_provider_win.cc`, 실측 | foundations §2.7 |
| E-A11Y-A44 | F18 | `prefers-contrast: more`: macOS는 "대비 증가"일 때만(less·custom 없음), WebKitGTK(GTK3)는 테마 이름 `HighContrast`·`HighContrastInverse`일 때, GTK 4.20+는 `gtk-interface-contrast`(`A45`). BCD Chrome 96, Safari 14.1, Firefox 101(`A43`) | WebKit `ThemeMac.mm`, `SystemSettingsManagerProxyGtk.cpp` | foundations §2.5 |
| E-A11Y-A06 | F19 | `prefers-reduced-transparency`: WebKit 미구현(175497 NEW, standards-position "Concerns"(`A07`), BCD Safari false, WKWebView 실측 둘 다 불일치). Chrome·Edge 118(`A08`). Windows는 레지스트리 `EnableTransparency`가 0이면 reduce(`A09`) | https://bugs.webkit.org/show_bug.cgi?id=175497 , BCD, Chromium 소스 | foundations §6.3 |
| E-A11Y-A47 | F20 | `prefers-reduced-motion`: macOS `accessibilityDisplayShouldReduceMotion`, Windows `!SPI_GETCLIENTAREAANIMATION`, GTK3 `!gtk-enable-animations`(GTK 4.22+ `gtk-interface-reduced-motion`). WebKit 215664(변경에 안 반응) FIXED(`A48`) | WebKit·Chromium 소스 | D22 |
| E-A11Y-A50 | F21 | `inverted-colors`는 macOS에서만 켜지고 GTK는 false 고정, Chrome 미지원 | WebKit `PlatformScreen{Mac,Gtk}`, BCD | 참고 |
| E-A11Y-A53 | F22 | `prefers-color-scheme`: WebView2는 기본 AUTO로 OS 따름. WebKitGTK(GTK3)는 `gtk-application-prefer-dark-theme`, `GTK_THEME` 환경변수, 테마 이름이 `-dark`로 끝나는지로 판정하는 휴리스틱(`A55`). Tauri 창 `theme`은 Windows·macOS 10.14+만(`A54`). Tauri 앱 Linux 다크 미추종 사례(Yaak, `A56`) | https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2profile?view=webview2-1.0.2903.40 , WebKit 소스, https://yaak.app/feedback/posts/automatic-theme-not-following-system-light-dark-mode | D7 |
| E-A11Y-A37 | F23 | 강제 색 모드에서 브라우저가 강제하는 속성: color, background-color, border-color, outline-color, text-decoration-color, column-rule-color, text-emphasis-color, -webkit-tap-highlight-color, SVG fill·stroke. box-shadow·text-shadow none, 비URL background-image none, color-scheme `light dark`, scrollbar-color auto. 작성자 시스템 색 키워드는 강제값을 덮는다(`A38`). `div role="button"`은 ButtonText가 안 된다(`A39`). `forced-color-adjust: none`은 backplate도 끄며 "사용자 선택을 막는 용도 금지"(`A41`). Edge 138부터 `-ms-high-contrast` 완전 제거(`A42`) | https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors , https://developer.mozilla.org/en-US/docs/Web/CSS/forced-color-adjust , https://blogs.windows.com/msedgedev/2025/06/30/removing-ms-high-contrast-and-embracing-standards-based-forced-colors-in-microsoft-edge/ | foundations §2.7, `G-A11Y-OS3` |
| E-A11Y-A31 | F24 | Windows 대비 테마는 Aquatic, Desert, Dusk, Night sky, 전환은 왼쪽 Alt+왼쪽 Shift+PrtScn, 처음 켜면 Aquatic, 대비비 대체로 7:1 이상. 색 역할: 배경 Window, 본문·테두리 WindowText, 하이퍼링크 Hotlight, 비활성 GrayText, 선택·hover·눌림·**진행 중** Highlight/HighlightText, 버튼 ButtonText/ButtonFace(`A32`·`A33`). GrayText를 보조 본문·힌트에 쓰지 말 것, Hotlight는 하이퍼링크에만(`A34`), 플라이아웃·대화상자에는 2px 테두리 권장(`A35`) | https://learn.microsoft.com/en-us/windows/apps/design/accessibility/high-contrast-themes | foundations §2.7 |
| E-A11Y-A11 | F25 | Windows "텍스트 크기"는 100%~225%. 래스터 배율 문서는 "monitor DPI scale and text scaling의 조합"이라고 적는다. WebView2 콘텐츠가 실제로 이 배율을 따르는지는 사용자 보고뿐(`X-A11Y-A12`) | https://learn.microsoft.com/windows/uwp/design/input/text-scaling | D24(분기 600 [잠정]) |
| E-A11Y-A21 | F26 | Tauri `zoomHotkeysEnabled` 기본 `false`. macOS·Linux 폴리필은 ctrl/command `-`/`=`, 20%씩, 20~1000%, `webview:allow-set-webview-zoom` 필요(`A22`). 2.4.0부터 `true`이면 휠 확대 동작(`A24`). `dragDropEnabled`는 기본 true이고 Windows에서 HTML5 드래그를 쓰려면 꺼야 한다(`T26`). 앱은 `dragDropEnabled: false`, `minWidth 720`, `minHeight 520`(`A15`), `zoomHotkeysEnabled` 미설정(`A23`) | Tauri `config.rs`, https://v2.tauri.app/reference/config/ , https://v2.tauri.app/release/tauri/v2.4.0 | D28 |
| E-A11Y-A25 | F27 | `role="progressbar"`는 live region이 아니라서 값 변화를 스크린리더가 자동으로 읽지 않는다(ARIA25). `aria-valuetext`가 있으면 그것이 읽힌다(`A26`). Orca 진행 막대 갱신 읽기는 기본 켜짐·10초(`A29`) | https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA25 , https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-valuetext , https://ubuntu.com/desktop/docs/en/latest/reference/accessibility/orca-preferences/orca-preferences-profile | components.md ProgressBar, `G-A11Y-OS13`·`OS14` |
| E-A11Y-A70 | F28 | WCAG 리플로우(1.4.10): CSS 폭 320px(세로 스크롤 콘텐츠), 높이 256px(가로 스크롤 콘텐츠). 400% 확대에서 1280×1024 기준 | https://www.w3.org/WAI/WCAG22/Understanding/reflow.html | D24·D28 |
| E-A11Y-A66 | F29 | 엔진 기능 실측(실제 WKWebView macOS 26.6.2): `inert`, `<dialog>.showModal`, `autocorrect` 속성, `color-mix`, `oklch`, `text-wrap: balance`, `:has`, `:focus-visible`, `Intl.DurationFormat`, `(min-resolution: 2dppx)` 지원. `forced-color-adjust`는 미지원. Chromium 153도 `inert`, dialog, `forced-color-adjust`, `Intl.DurationFormat` 지원 | 실측 | components.md Dialog(`inert`) |
| E-A11Y-U01 | F30 | 같은 8,400,000,000바이트가 `ByteCountFormatter(.file)`로 `8.4 GB`, 1024 진법으로 `7.82 GB`(`ls -lh` 7.8G). 차이 약 7.4%(1.024³). Apple은 "iOS 10 이전과 OS X Leopard 이전"이 이진법(`U02`). Windows `StrFormatByteSize` 문서 표는 1024 기준이고 **내림**으로 3자리(22.955→22.9, 2.2889→2.28)(`U05`·`U06`). 같은 문서가 "Windows 10에서는 10진"이라고도 적어 모순 | 실측, https://support.apple.com/en-us/102119 , https://learn.microsoft.com/en-us/windows/win32/api/shlwapi/nf-shlwapi-strformatbytesizew | D47, Q10 |
| E-A11Y-U04 | F31 | Windows 탐색기는 IEC를 무시하고 KB로 1024를 쓴다(MS 개발자 블로그). GLib은 네트워크·저장 크기를 SI(kB, 1000)로(`U07`). Transmission은 storage·speed가 Kilo(kB, kB/s), memory만 Kibi(`U08`). Chromium은 1024로 나누고 100 미만이면 소수 1자리(`U09`) | https://devblogs.microsoft.com/oldnewthing/20090611-00/?p=17933 , https://docs.gtk.org/glib/func.format_size.html , Transmission `utils.cc`, Chromium `bytes_formatting.cc` | D47 |
| E-A11Y-U14 | F32 | Microsoft 스타일 가이드는 약어와 숫자 사이를 띄우고(`200 MB`) 네 자리 이상에 쉼표. Apple 한국어 지원 문서(`U03`)와 ko-localized Foundation(`ByteCountFormatter`·`MeasurementFormatter`)은 `GB`를 숫자에 붙인다(`1GB`, `8.4GB`, `7.8GB`)(`U16`·`U17`). CLDR(Intl) ko도 `7.8GB`, `7.8kB`, `7.8MB/s`, `7.8%`(`U21`) | https://learn.microsoft.com/en-us/style-guide/a-z-word-list-term-collections/term-collections/bits-bytes-terms , https://support.apple.com/ko-kr/102119 , 실측 | D48 |
| E-A11Y-U19 | F33 | Intl ko-KR 실측(Node 22/ICU 78.3/CLDR 48, WKWebView·JSC 일치): 기본 `2026. 10. 9.`; long `2026년 10월 9일`; short `26. 10. 9.`; medium+short `2026. 10. 9. 오후 3:20`; `10월 9일`; 요일 포함 `10월 9일 (금)`; hour12 `오후 3:20`; hour12:false `15:20`, 자정 `00:05`; RelativeTimeFormat `0 minute`는 **`현재 분`**, `0 second`는 `지금`(`U20`); compact `1.2만`(`U22`); Node 22는 `Intl.DurationFormat` 없음, WKWebView·JSC는 있음(`1시간 2분 5초`, digital `1:02:05`)(`U23`). 크기·속도·남은 시간은 자체 함수, 날짜·시각만 `Intl.DateTimeFormat` | 실측 | D49·D50 |
| E-A11Y-U15 | F34 | Finder 한국어 문자열(실측): `남은 시간 계산 중…`, `약 ^0초`, `약 1분`, `약 ^0분`, `약 1시간`, `약 ^0시간`, `약 1일`, `약 ^0일`. `DateComponentsFormatter`는 ko-localized에서 `2분 18초 남음`(`U18`) | `Finder.app/Contents/Resources/ko.lproj/LocalizableMerged.strings` 실측 | D50 |
| E-A11Y-U25 | F35 | 국립국어원: 아라비아 숫자 뒤 단위 의존 명사는 붙여 쓰는 것이 보편적(`10개`, `35명`, `9미터`), 한글 수 뒤는 띄움(`열 개`). 연월일을 아라비아 숫자만으로 쓸 때는 마침표를 찍고 끝 마침표를 포함(`1919. 3. 1.`)(`U27`). 라틴 단위 기호(GB, %)는 규범이 다루지 않는다 | https://www.korean.go.kr/nkview/nknews/200006/23_5.htm , https://www.korean.go.kr/nkview/nknews/200006/23_2.htm | D48·D49 |
| E-A11Y-U39 | F36 | 결정형 막대는 줄어들지 않는다(usersnap). Chromium은 속도를 최근 10초 링 버퍼로 추정(`U35`), 최소 표본이 모일 때까지 추정 안 함(`U36`). 코어 `Meter`는 5초 창, 100ms 표본, 이벤트 200ms(`U29`). 디스크 여유 공간 사전 확인 코드는 없다(`U34`) | https://usersnap.com/blog/progress-indicators/ , https://codereview.chromium.org/14697023/ , `crates/core/src/progress.rs` | D23·D50 |
| E-A11Y-T01 | F37 | UI Events: 조합 중 모든 키 이벤트는 `isComposing=true`여야 하고(MUST) 조합을 끝내는 keydown은 `compositionend` 앞에 온다. IME 처리 중 keydown의 `keyCode`는 229(`T02`). MDN 예시는 `event.isComposing \|\| event.keyCode === 229`(`T03`) | https://w3c.github.io/uievents/ , https://developer.mozilla.org/en-US/docs/Web/API/Element/keydown_event | platform.md IME, `A-DRIFT`(IME 결함) |
| E-A11Y-T04 | F38 | WebKit은 올바른 조합 이벤트 순서를 2026-04에 켰다가(311717) 2026-06-15에 "회귀 신고가 너무 많아" 모든 곳에서 끄고(317127), Safari 기능 플래그로만 켠다(324380). `isComposing`만 보는 코드는 WKWebView에서 불충분 | WebKit Bugzilla REST | platform.md |
| E-A11Y-T07 | F39 | 한국어 IME에서 Enter는 확정과 줄바꿈 삽입을 함께 일으킬 수 있다. macOS 한국어 IME는 compositionend가 지운 글자를 담아 오는 현상이 보고되었다(`T06`) | https://lists.w3.org/Archives/Public/public-webapps-github/2018Aug/0036.html , https://lists.w3.org/Archives/Public/public-webapps-github/2025Jun/0052.html | platform.md |
| E-A11Y-T29 | F40 | `DataTransfer.types`의 파일 항목은 `"Files"`(대문자). Chromium은 맨 뒤, WKWebView는 맨 앞. 드래그 중(`dragstart`·`drop` 밖) 보호 모드라 `getData`는 늘 빈 문자열(`T28`). 링크 드래그는 `text/uri-list`와 `text/plain` 둘, Chrome은 `text/plain`을 먼저(`T30`). 웨일은 Blink(`T32`) | 실측, MDN Drag data store·Recommended drag types | platform.md 드롭 |
| E-A11Y-T13 | F41 | 클립보드: Tauri 플러그인은 기본 권한이 없다. WKWebView `navigator.clipboard` 읽기는 제스처 밖에서 즉시 거부, ⌘V면 허용, 아니면 맥락 메뉴 항목(`T15`). macOS 15.4+ `NSPasteboard.accessBehavior`(`.default 0`, `.ask 1`, `.alwaysAllow 2`, `.alwaysDeny 3`)는 일반 pasteboard 기본이 "프로그램 접근 시 묻기", ask·deny에서도 사용자 시작·붙여넣기 접근은 경고 없이 허용(`T19`). `detectPatterns`는 내용 없이 알림 없이 패턴만(`T20` 일부). Windows는 `ExcludeClipboardContentFromMonitorProcessing`, `CanIncludeInClipboardHistory`(0), `CanUploadToCloudClipboard`(0)로 기록·동기화에서 뺀다(`T23`) | https://v2.tauri.app/plugin/clipboard/ , https://webkit.org/blog/10855/async-clipboard-api/ , SDK `NSPasteboard.h`, https://learn.microsoft.com/en-us/windows/win32/dataxchg/clipboard-formats | D56 |
| E-A11Y-T33 | F42 | `autocapitalize`는 물리 키보드에 영향이 없고 url·email·password에서는 효과 없음(Baseline 아님). `autocorrect`는 password·email·url에서 늘 off이고 Baseline 2026(2026-09) newly available(`T34`). `spellcheck`는 힌트이며 민감한 칸은 false 권장(`T35`). `autocorrect`는 Chromium 153·WKWebView에 존재 | MDN | components.md TextField |
| E-A11Y-T43 | F43 | 현재 `pickChzzkLink`/`chzzk_link`는 공백 분리 토큰만 받고 붙은 글·조사·괄호·따옴표·끝 구두점·마크다운·ZWSP는 못 받는다. BOM(U+FEFF)은 TS 쪽만 통과. 한글 IME 순서 테스트는 저장소에 없다(`T42`). `GlobalShortcuts`·`JobList`는 `isComposing`만, `ResolveCard` Mod+Enter는 검사 없음(`T40`) | 실측 `tsrun/t.mts`, 워크트리 grep | `A-*`(IME·주소 추출), platform.md |

### 2.6 `E-ID` — 사용자 조사·정체성·아이콘·라이선스·설치(verify-identity-users.md)

행 코드는 검증 표의 것(`U` users, `I` 정체성, `K` 아이콘, `A` 라이선스, `L` 설치, `M` 새 실측). 끝의 확정 사실 1~60은 `E-ID-F<n>`. 집계: 253개 중 confirmed 211 / refuted 21 / unverifiable 21.

**접근성·대비·응답 시간**

| ID | F | 사실 | 출처 | 쓰는 곳 |
|---|---|---|---|---|
| E-ID-K20 | F1 | WCAG 2.2 1.4.11 Non-text Contrast는 AA이고 UI 구성요소 식별·이해에 필요한 그래픽은 인접 색과 3:1 이상. 비활성 예외. 독립 아이콘이 예 | https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html | D19·D32 |
| E-ID-K19 | F2 | 아이콘 대비의 규범 기준은 3:1. Lucide 문서의 4.5:1은 1.4.3(글자) 인용이며 규범 아님. KRDS 아이콘은 기본 3:1, 선명한 화면 모드 7:1(`K21`) | https://lucide.dev/guide/advanced/accessibility , https://www.krds.go.kr/html/site/style/style_06.html | D32 |
| E-ID-U01 | F3 | 응답 시간 0.1초/1.0초/10초(`U01`). 1초 넘는 지연은 작동 중임을 표시하고 10초 이상은 퍼센트와 눈에 띄는 중단 수단(`U02`). 2~10초는 루프 애니메이션이 맞고 1초 미만에는 방해(`U03`) | https://www.nngroup.com/articles/response-times-3-important-limits/ , https://www.nngroup.com/articles/progress-indicators/ | T2, C5 |
| E-ID-U04 | F4 | 진행 막대: 빠르게 가다 마지막 퍼센트에서 멈추면 불쾌. 느리게 시작해 끝에서 빨라지는 쪽이 낫다 | https://www.nngroup.com/articles/progress-indicators/ | D23 |
| E-ID-U05 | F5 | 점진적 노출은 2단을 넘으면 사용성이 떨어진다. 초기 화면에 있는 것은 중요하다는 신호(`U06`) | https://www.nngroup.com/articles/progressive-disclosure/ | patterns.md 설정 |
| E-ID-U09 | F6 | 오류 메시지: 근처 표시, 색·애니메이션에만 의존 금지, 모달은 심각한 오류에만, 전문용어 금지, 코드는 진단 목적에만, 해결책 제시, 입력 보존, "invalid/illegal/incorrect" 비난 어조 금지, 너무 이른 오류 표시는 적대적 | https://www.nngroup.com/articles/error-message-guidelines/ | C6, D51 |
| E-ID-U10 | F7 | 신뢰: 디자인 품질·선제 공개·포괄적이고 최신인 내용·외부 연결(`U10`). 가치 제공 전 정보 요구는 신뢰 위반(`U11`). 오탈자·깨진 링크는 신뢰를 깎는다(`U12`). 긴 양식은 신뢰와 이용을 해친다(`U13`). 권한 요청 세 요소(이점·범위·통제)는 2차 출처(`U14`) | https://www.nngroup.com/articles/trustworthy-design/ , https://appmaster.io/blog/device-permission-prompts-users-trust | C2·C7 |
| E-ID-U07 | F8 | 기본값은 사용자가 바꾸지 않는다고 가정한다(NN/g 영상). "No Default Values"는 흔한 실수 #4: 흔한 선택을 미리 골라 둔다(`U08b`) | https://www.nngroup.com/videos/the-danger-of-defaults/ , https://www.nngroup.com/articles/top-10-application-design-mistakes/ | patterns.md("가장 좋은 화질") |
| E-ID-K17 | F9 | NN/g 아이콘: "Obscure icon = wasted feature", 글자 라벨이 아이콘 곁에 항상 보여야. 보편 아이콘은 home·print·search, 시계(기록)는 아무도 누르지 않았다. 작은 크기에서는 디테일을 줄인다(`K18`). Lucide: 독립 기능 아이콘은 피하고 버튼에 접근 이름(`K19`) | https://www.nngroup.com/articles/icon-usability/ , https://lucide.dev/guide/advanced/accessibility | D32(허용 목록 7종) |
| E-ID-U16 | — | NN/g Forms vs. Applications: 응용의 가장 심각한 문제는 과업 구조에 대한 사전 이해 부족. 처방은 시작 때 짧은 개요. 휴리스틱 7(단축키는 초심자에게 숨김)·8(무관한 정보 제외)(`U17`) | https://www.nngroup.com/articles/forms-vs-applications/ , https://www.nngroup.com/articles/ten-usability-heuristics/ | patterns.md 빈 상태 |

**아이콘: 세트·수치·렌더**

| ID | F | 사실 | 출처 | 쓰는 곳 |
|---|---|---|---|---|
| E-ID-K06 | F10 | Lucide 1.53.0: 아이콘 2,133개, ISC, 24×24 격자, 기본 stroke 2, 둥근 끝·이음, 1px 안전 영역, 요소 간 2px, 모서리 반지름 2px(8px 이상)/1px, 직각 대각선 2.41px(`K10`). 저장소가 쓰려는 이름 28개가 모두 있다(`K07`). GitHub 24.9k★, push 2026-10-08(`K09`) | https://www.npmjs.com/package/lucide-static , https://lucide.dev/contribute/icon-design-guide , https://github.com/lucide-icons/lucide | D31 |
| E-ID-K08b | F11 | Lucide LICENSE는 ISC 단락 + Feather 유래 목록(115개, 옛 이름) + MIT(2013-present Cole Bemis). 목록에 download, external-link, info, x, chevron-*, clock, clipboard, trash-2, monitor, link, log-in, check는 있고 pause·play·folder·copy·settings·eye·ellipsis·rotate-cw·circle-x·circle-check·triangle-alert는 없다. 고지 문안 본문은 lucide.dev/license와 일치(`K38`) | lucide-static@1.53.0 LICENSE, https://lucide.dev/license | D31, `design-icons` |
| E-ID-K29 | F12 | 적용 전 `icons.ts`는 Feather 바탕, viewBox 24, stroke 1.75이고 저장소에 LICENSE·NOTICE·THIRD-PARTY 파일이 하나도 없다 | 워크트리 | `A-*` 고지 0개 |
| E-ID-K21 | F13 | KRDS 아이콘: 24px 기준 두께 1.5~2px 권장, 표준형 1.6px, 주요 크기 16·20·24·32·40, 4 또는 8의 배수, 글자와 중앙 정렬·매칭된 크기만 | https://www.krds.go.kr/html/site/style/style_06.html | D32 |
| E-ID-K11 | F14 | Phosphor regular = 24px 환산 1.5px, thin 0.75, light 1.125, bold 2.25. Heroicons outline 1.5(`K13`), Tabler 2(`K12`). Radix 318개·격자 15(`K14`). Fluent System Icons는 16·20·24를 따로 그린다(`K16`) | 로컬 npm 패키지 실측 | D31 탈락 사유 |
| E-ID-K23 | F15 | Fluent 2: 12px 아이콘은 정보용이고 상호작용에는 너무 작다 | https://fluent2.microsoft.design/iconography | D32(12 금지) |
| E-ID-K24 | F16 | HIG: 인접 글자와 아이콘 굵기를 맞춘다. 크기·디테일·선 굵기·시점 일관. 비대칭 아이콘(download)은 패딩으로 광학 정렬. 액션 아이콘표: Cancel·Close = xmark, Delete = trash, Copy = document.on.document, Paste = document.on.clipboard, Account = person.crop.circle, More = ellipsis, Share = square.and.arrow.up(`K25`) | https://developer.apple.com/design/human-interface-guidelines/icons | D32, foundations §9.1 |
| E-ID-K27 | F17 | 글자 줄기 굵기(em, 200px system-ui, macOS). 라틴 `l`: 400 0.085 / 500 0.105 / 600 0.130 / 700 0.145(Chromium·WKWebView 동일). 한글 `ㅣ` Chromium 0.075/0.085/0.085/0.095, WKWebView 0.075/0.085/0.095/0.100(`K28b`). `ㅡ` 0.065/0.075/0.080/0.090. 400~500에서만 두 엔진이 같다 | 실측 stem.mjs + Swift 하네스 | D32(stroke 1.5 [잠정]) |
| E-ID-K30 | F18 | stroke 1.75(viewBox 24)의 렌더 굵기는 16px 1.17 / 20px 1.46 / 32px 2.33 화면 px로 크기마다 달라진다. 권장 환산 16px 1.2(viewBox 1.8), 20px 1.25~1.5, 32px 1.6(1.2)(`K31`) | 실측 blur2.mjs | D32, `A-*`(현재 비례 축소) |
| E-ID-K32 | F19 | 선 번짐(Chromium DPR1): 16px stroke 1.5 → 두 줄 50%, 1.75 → 58%, 2 → 66%; 20px 1.75 → 73%. DPR2 16px 1.5 → 2줄 100%(또렷). DPR 1.25·1.5는 값에 따라 제각각이라 일반화 불가(`K33`). `shape-rendering: crispEdges`는 16px 1.75를 2.00px로 만들어 전체 적용 부적합(`K34`) | 실측 | D32, Q4 |
| E-ID-K35 | F20 | `vector-effect: non-scaling-stroke`는 Chromium 153과 macOS 26.6 WKWebView에서 stroke-width를 CSS px 그대로 그린다(16px sw1.2 → 1.2px). `CSS.supports` 둘 다 true. WebView2·WebKitGTK 실기는 미측정 | 실측 | D32 |
| E-ID-K36 | F21 | forced-colors: WKWebView는 `(forced-colors: none)`만 참. Chromium은 켤 수 있다. 강제 모드에서 SVG fill·stroke 등 작성자 값이 시스템 색으로 덮이고 box-shadow·text-shadow는 none. 시스템 색 키워드를 쓰면 그 값이 쓰인다 | https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors , 실측 | foundations §2.7 |
| E-ID-M03 | F22 | macOS WKWebView(system-ui) 줄 상자 `line-height: normal`: 12px 15 / 13px 16 / 14px 17 / 16px 18 / 19px 22 / 20px 23. 한글을 섞어도 같다. 14px 한글 advance 글자당 12.11px(≈0.865em)(`M04`), 대문자 높이 라틴 0.70em·한글 0.80em(`M05`) | 실측 | D12 |
| E-ID-M01 | F23 | WKWebView가 지원하는 CSS: tabular-nums, text-wrap: balance, :focus-visible, :has(), color-mix(), oklch(), light-dark(), container-type, non-scaling-stroke. Chromium 153도 non-scaling-stroke·forcedColors 에뮬레이션(`M02`) | 실측 | foundations §11 |

**앱 아이콘 규격**

| ID | F | 사실 | 출처 | 쓰는 곳 |
|---|---|---|---|---|
| E-ID-I28 | F24 | Windows 최소 아이콘 크기 16·24·32·48·256, 256이 있으면 줄이기만. 같은 크기를 먼저 찾고 없으면 다음 큰 것을 줄인다(`I29`) | https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction | D33 |
| E-ID-I30 | F25 | Windows 11 배율별 크기: 컨텍스트 메뉴·제목 표시줄·트레이 16/20/24/32/40/48/64(100~400%), 작업 표시줄·검색·시작 앱 목록 24/30/36/48/60/72/96, 시작 고정 32/40/48/64/80/96/256 | 같은 URL | D33 |
| E-ID-I31 | F26 | targetsize 전체 목록 16,20,24,30,32,36,40,48,60,64,72,80,96,256. 다크 `_altform-unplated`·라이트 `_altform-lightunplated`가 없으면 backplate가 붙는다(MSIX). 투명 배경이 최선(`I33`) | 같은 URL | D33 |
| E-ID-I34 | F27 | Windows 아이콘 디자인: 은유는 하나(최대 둘), 글자 금지, 48×48 격자, 바깥 모서리 2px@48(안쪽 1px), 그라데이션 120°에 한두 단계, 라이트·다크 모두 절반 이상 3.0:1, 색만으로 의미 금지, 정면 시점, 레이어 최소. Windows 11은 고대비 자산 불요 | https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-design | D33 |
| E-ID-I35 | F28 | Tauri `.ico`는 16·24·32·48·64·256 레이어, 개발 중 표시를 위해 32를 첫 레이어로 권한다. 우리 icon.ico는 6층 PNG 32비트, 첫 층 16. `.icns`는 10항목이고 우리 파일도 10개(`I27`). 생성물 32x32.png, 128x128.png, 128x128@2x.png, icon.png 등(`I36`) | https://v2.tauri.app/develop/icons/ , `iconutil` 실측 | D33 |
| E-ID-I17 | F29 | macOS 26 Icon Composer: 1024px 캔버스(Watch 1088), 마스크는 내보내기에 넣지 않는다, 최소 구성 배경 1 + 전경 1(그룹 최대 4)(`I18`), 평평한 벡터는 SVG·그라데이션/래스터는 투명 PNG·글자는 윤곽선(`I19`), 외형 6종(`I20`), Mono는 한 요소 흰색·나머지 회색 톤(`I21`), 정적 드롭 섀도·베벨 줄이고 얇은 선·뾰족한 모서리 피하고 순백·순흑 대신 System Light/Dark 그라데이션(`I22`) | https://developer.apple.com/videos/play/wwdc2025/361/ , https://developer.apple.com/videos/play/wwdc2025/220/ | D33 |
| E-ID-I23 | F30 | 가장자리 알파가 낮은(≤252) 아이콘이 회색 판 위로 축소된다는 보고는 단일 개발자 실험이며 Apple 공식 확인이 없다(FB22801803). Rogue Amoeba·heise(`I24`), Eclectic Light "sin bin"(`I49`)도 2차 | https://developer.apple.com/forums/thread/797971 , https://weblog.rogueamoeba.com/2026/06/26/free-the-icons/ , https://eclecticlight.co/2025/06/22/last-week-on-my-mac-tahoe-the-iconoclast/ | D33 [잠정] |
| E-ID-I26 | F31 | Tauri 번들러는 `.icon`을 actool로 Assets.car로 컴파일하는 지원이 있고, Node CLI에서 stdin 상속으로 ibtoold가 죽는 크래시(#15315)가 열려 있다. 수정 PR #15991 미병합. Peitho PR #95·tauri-liquid-icon이 우회(`I50`). `tauri icon`은 `.icon`을 입력으로 받지 않는다(`I25`) | https://github.com/tauri-apps/tauri/issues/15315 , https://github.com/tauri-apps/tauri/pull/15991 , https://github.com/piconic-ai/peitho-studio/pull/95 , https://github.com/MaciejkaG/tauri-liquid-icon | D33 |
| E-ID-I39 | F32 | freedesktop: **권장** 48×48 최소 설치(should), 벡터는 `hicolor/scalable/apps`, Threshold 기본 2, hicolor 테마는 항상 있어야(should), 중립적 모양 권장. Flathub 아이콘은 SVG 또는 256px 이상 정사각 PNG이고 캔버스 가장자리를 채우지 않는다(`I09`·`I09b`) | https://specifications.freedesktop.org/icon-theme/latest/ , https://docs.flathub.org/docs/for-app-authors/metainfo-guidelines/quality-guidelines | D33 |
| E-ID-I41 | F33 | og:image 1200×630 이상 권장(최소 600×315, 1.91:1, 8MB 이하), og:image:alt는 ogp.me, 필수 og:title·og:type·og:image·og:url. maskable 안전 영역은 중심 원 반경 40%, 512px에서 409px(`I42`). favicon.ico 32×32, 아이콘 SVG는 prefers-color-scheme 대응 가능, apple-touch-icon 180×180, manifest 192/512(`I43`, 2021 글) | https://developers.facebook.com/docs/sharing/webmasters/images , https://ogp.me/ , https://web.dev/articles/maskable-icon , https://evilmartians.com/chronicles/how-to-favicon-in-2021-six-files-that-fit-most-needs | D53, web.md §9 |
| E-ID-I37 | F34 | 아이콘 대비 계산: 적용 전 플레이트 #0f766e 대 흰색 5.47, #f3f3f3 4.93, #202020 2.98(3.0 미달), #1c1c1c 3.11 | 실측 | D33(다크 작업 표시줄 경계) |

**사용자 조사: 생태계·참고 제품**

| ID | F | 사실 | 출처 | 쓰는 곳 |
|---|---|---|---|---|
| E-ID-U19 | — | NAVER 브랜드 리소스: `#03C75A`, 로고 형태·색·비율 변경 금지, 그라데이션·효과 금지, 네이버의 명성·신용을 이용한 경제적 이익 추구 금지, 법적 조치 가능. 규칙은 모두 **로고**에 대한 것이고 단어 상표는 다루지 않는다 | https://navercorp.com/company/brandGuide | C1·C2(`E-ID-I01`과 같은 페이지) |
| E-ID-U29 | — | OBS 기본 테마 Yami(남색 기운, OBS 28 도입), 변형 Light·Grey·Acri·Rachni(청록+빨강 강조), System(Windows는 항상 라이트) | https://obsproject.com/kb/themes-guide | C3, §1.4 |
| E-ID-U34 | — | Downie: 유료 $19.99(Setapp 월 $9.99), Cmd+V로 즉시 시작. 후기 "붙여넣기를 더 직관적으로" | https://thesweetbits.com/tools/downie-video-downloader/ | C4, §1.4 |
| E-ID-U37 | — | Stacher: 월 $7 구독 + 제한 무료, 시스템 테마 따르는 다크, 썸네일 목록, 쿠키 가져오기 | https://alternativeto.net/software/stacher/about | §1.4 |
| E-ID-U38 | — | Open Video Downloader: Tauri 기반(Vue 3 + Rust), 시스템 테마 따름, 큐·알림, 쿠키 파일·기본 인증. README에 Gatekeeper/SmartScreen 설명 없음 | https://raw.githubusercontent.com/jely2002/youtube-dl-gui/master/README.md | §1.4 |
| E-ID-U46 | — | 4K Video Downloader Plus: Paste Link → 분석 → 화질·형식 → 폴더 → 시작(약 4단계), Smart Mode가 선택을 기억, 무료는 일일 수 제한. 출처는 광고(Sponsored Post) 명시 | https://www.igeeksblog.com/4k-video-downloader-plus-review/ | C4(반례), T7(선택 기억) |

**상표·정체성**

| ID | F | 사실 | 출처 | 쓰는 곳 |
|---|---|---|---|---|
| E-ID-I01 | F35 | NAVER 브랜드 리소스는 **로고**에 대해 형태·색·비율 변경, 그라데이션·효과, 자기 회사명·상품명·서비스명·도메인·로고·심볼·아이콘에 사용, 경영·조직·재정·계약 연관 오인, 재배포·AI 학습 제공, 네이버의 명성·신용을 이용한 경제적 이익 추구를 금지하고 법적 조치를 예고한다. NAVER Green #03C75A(RGB 3 199 90, PANTONE 2270C)(`I02`). 제3자가 서비스명(단어)을 쓸 때의 별도 절은 없다(`I03`) | https://navercorp.com/company/brandGuide | C1·C2, D34 |
| E-ID-U20 | F36 | 오빠두 정리(비공식)의 치지직 웹 UI 관찰: 다크 기본, 네온 #00FFA3은 켜짐 신호에만(`U21`), 라이트 #1BB373(텍스트 #168F5C)(`U22`), 본문 14·채팅 13·캡션 12·라벨 11px(`U23`), 반경 8/12/16(태그 4)(`U24`), 그림자는 팝오버·툴팁·칩·플로팅 버튼(`U25b`), 서체 Pretendard + 산돌 네모니2(`U26b`), 무드 "짜릿함·몰입·에너지"(`U27`). 비공식 제3자 정리이므로 "관찰된 경향"으로만(`U28`) | https://www.oppadu.com/tools/design-systems-site/brand/chzzk.html | C1·C3 |
| E-ID-U43 | F37 | 색 검사 기준 계산: #03C75A(H146.6, S97), #00FFA3(H158.4, S100), #1BB373(H154.7, S73.8)은 "H 140~165°·채도 70% 이상"에 걸리고, 적용 전 accent #0E7479(H182.8)·#5ECBCF(H182.1, S54)·플레이트 #0f766e(H175.3)는 통과 | 로컬 계산 | C1 |
| E-ID-I04 | F38 | YouTube API: 앱 전체 이름에 서비스명·약어·변형 금지, 앱이 그 서비스용이라고 설명하는 것은 허용. Apple 5.2.1·5.2.2·5.2.3(제3자 미디어 다운로드는 명시적 승인 필요)·4.1(c)·2.3.7(이름 30자)(`I05`). Microsoft Store 10.1.1(`I06`) | https://developers.google.com/youtube/branding , https://developer.apple.com/app-store/review/guidelines/ , https://learn.microsoft.com/en-us/windows/apps/publish/store-policies | D34 |
| E-ID-I08b | F39 | Flathub는 제3자 클라이언트가 이름에 공급자 이름을 쓰거나 공식 아이콘·로고를 쓰는 것을 금지한다("A WhatsApp client or wrapper cannot have WhatsApp in its name …"). 이름 20자 미만(권장 15 이하), 설명 금지(`I09`). 해석: "치지직 다운로더"는 Flathub 기준에서 위험(개명 트리거 ③) | https://docs.flathub.org/docs/for-app-authors/requirements | D34, governance.md 개명 트리거 |
| E-ID-I15 | F40 | 치지직 콘텐츠 가이드라인 1.7은 타인의 저작권·상표권·디자인권 침해 콘텐츠를 제한(방송 콘텐츠용). 상표법 제90조 제1항 제2호: 보통명칭·용도 등을 보통으로 사용하는 방법으로 표시한 상표에는 효력이 미치지 않는다(요지, 2차)(`I12`·`I13`) | 치지직 콘텐츠 가이드라인 PDF(ssl.pstatic.net), https://www.nepla.ai/wiki/지식재산/상표/상표권효력의-제한-2w0ndrj3g9j7 | Q13(사람 확인) |
| E-ID-I11 | — | PyPI chzzkpy 등이 스스로 "unofficial"이라 소개한다. NAVER Cloud API 브랜드 가이드는 타인 상표를 상품명·로고로 쓰지 말고 변형·약어·결합 금지(치지직에 직접 적용되는 규정 아님)(`I51`) | https://pypi.org/p/chzzkpy , https://guide.ncloud-docs.com/docs/apihub-brandguide | D34 |
| E-ID-U18 | — | 치지직 브랜드 메인 컬러는 그린(네이버 서비스임을 드러냄), 주파수 모티브 사선 키 비주얼, 네이버 게임 하위이면서 개별 브랜드(매체 기사). 2026-11-01부터 등급 4단계 개편, 다시보기 보관 1년은 적용 등급 불명확(`U30`) | https://design.co.kr/article/tag/%EC%8A%A4%ED%8A%B8%EB%A6%AC%EB%B0%8D , https://www.mt.co.kr/tech/2026/10/02/2026100111233698466 | C1, D39(보관 기한 추정 금지) |

**라이선스·고지**

| ID | F | 사실 | 출처 | 쓰는 곳 |
|---|---|---|---|---|
| E-ID-K01 | F41 | SF Symbols 라이선스(2019-09-06판)는 Apple 5개 OS 앱 용도에 한정하고, 비 Apple OS용 UI 제작·추출·재포장·앱 아이콘/로고/상표·웹사이트 콘텐츠 사용을 금지. HIG·Xcode 약관 §2.10도 같다(`K02`·`K03`). Windows·Linux·웹에서는 쓸 수 없다. Segoe Fluent Icons 글꼴은 다른 플랫폼에 싣을 수 없다(`K04`). 토스 리소스는 서비스 UI 용도로만(`K05`) | SF Symbols DMG License.rtf 사본, https://www.apple.com/legal/sla/docs/xcode.pdf , https://learn.microsoft.com/en-us/windows/apps/design/style/segoe-fluent-icons-font | D31 |
| E-ID-A10 | F42 | 바이너리 고지 의무: MIT(모든 사본에, 바이너리 예외 없음), BSD-3(바이너리는 문서 등에 재현, 보증·홍보 금지)(`A12`), ISC(`A13`), Apache-2.0(§4(a) 사본, §4(d) NOTICE)(`A11`), MPL-2.0(§3.2 소스 제공·입수 방법)(`A14`), Unicode-3.0(사본 또는 문서)(`A15`), LGPL-2.1+(§6 소스 동봉 또는 3년 서면 제안)(`A20`). Zlib은 바이너리 고지 의무 없음(`A16`), BSL-1.0은 객체 코드만이면 면제(`A17`). Unlicense·0BSD·CC0·MIT-0는 고지 의무 없음(`A19`) | https://opensource.org/license/mit , https://www.apache.org/licenses/LICENSE-2.0.txt 외 | D31·D59, governance.md |
| E-ID-A01 | F43 | 이 저장소의 링크 집합: 3 타깃 합집합 354 crate(237/227/296), `-e normal` 317/304/389(`A02`), 선택지 없는 비 MIT/Apache는 BSD-3 4·ISC 2·Unicode-3.0 15·BSL-1.0 2·Zlib 1·MPL-2.0 1(option-ext)·ring·dpi(`A04`), NOTICE 파일 0개(`A06`), 라이선스 파일 없는 crate 19개(`A05`) | `cargo tree --locked --offline` 실측 | D59 |
| E-ID-A07 | F44 | 고유 라이선스 본문은 macOS 188개 641,687 B(darwin 바이너리의 2.70%, 허용 3%), deflate 약 55 KB(`dist_gz` 63,384 B의 87%). Windows 179개 632,861 B, Linux 205개 698,338 B(`A43`). 번들 크기 AppImage 86,813,176 / deb 10,046,698 / dmg 7,748,531 / setup 4,945,876 / msi 7,319,552 B(`A09`) | 로컬 재계산, `ci/ratchet.json` | D31 고지 위치 |
| E-ID-A28 | F45 | muda 0.20: macOS About는 Credits를 평문으로만, authors·comments·license·website는 macOS 미지원, credits는 Windows·Linux 미지원(`A29`). Windows About는 영어 MessageBox. `tauri.conf.json`에 copyright·publisher·license·resources·signingIdentity·webviewInstallMode가 없다(`A30`, `L46`) | 로컬 muda 소스, https://docs.rs/tauri/latest/tauri/menu/struct.AboutMetadata.html | D58, platform.md |
| E-ID-A23 | F46 | WebView2 기본 모드는 downloadBootstrapper이고 embed +1.8 MB / offline +127 MB / fixed +180 MB. 재배포 모드로 바꾸면 EULA §2(b) 조건이 걸린다(`A24`). Win10 "vast majority"에 설치됨(`A25`) | https://v2.tauri.app/distribute/windows-installer/ , https://developer.microsoft.com/microsoft-edge/api/eula/webview2 | D53 |
| E-ID-A22 | F47 | Tauri 로고는 Creative Commons 저작자표시-비영리-변경금지(BY-NC-NoDerivatives). 루트에 LICENSE-APACHE-2.0·LICENSE-MIT, NOTICE 없음 | https://github.com/tauri-apps/tauri | governance.md |

**설치·첫 실행·업데이트·제거**

| ID | F | 사실 | 출처 | 쓰는 곳 |
|---|---|---|---|---|
| E-ID-L01 | F48 | Apple 문서는 경고를 5종으로 나누며 "손상되었다" 경고에 Open Anyway가 적용되는지는 명시하지 않는다(`L06`). Open Anyway는 시도 후 약 1시간 보이고 로그인 암호가 필요(`L03`). 한국어 이름은 시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기 → 열기(`L04`). Sequoia(2024-08-06)부터 Control-클릭 열기로 우회 불가(`L05`). 최신 가이드 순서는 Security에서 Open → Open Anyway(`L47`) | https://support.apple.com/en-us/102445 , https://support.apple.com/ko-kr/102445 , https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unidentified-developer-mh40616/mac , https://developer.apple.com/news/?id=saqachfa | D53·D55, web.md §5 충돌 1 |
| E-ID-L08 | F49 | Tauri: ad-hoc 서명(`signingIdentity: "-"`)은 Apple Silicon의 인터넷 앱에 필요하지만 사용자 허용 요구를 없애지 못하며, 공증은 유료 계정 필요. ad-hoc이 "손상됨"을 "확인되지 않은 개발자"로 바꾼다는 것은 격리 다운로드 시험이 없는 2차 주장(`L07`). clai PR: 우클릭 열기는 손상 변형을 넘지 못해 xattr 한 줄 안내(`L10`) | https://v2.tauri.app/distribute/sign/macos/ , https://github.com/nitrimandylis/WhimprFlow/pull/2 , https://github.com/clairun/clai/pull/228 | D55, Q11 |
| E-ID-L12 | F50 | App Translocation은 격리 속성 + Launch Services 실행 + Finder로 옮기지 않음 조건에서 읽기 전용 임의 경로 실행이고 Finder로 옮기면 해소 | https://eclecticlight.co/2022/09/06/dont-run-that-app-where-it-landed-how-translocation-can-cause-crashes/ | web.md 설치 안내 |
| E-ID-L14 | F51 | SmartScreen은 게시자(인증서)와 파일 해시 두 평판. 서명하지 않으면 새 버전마다 평판 0이고 몇 주·수백 건의 깨끗한 설치가 걸릴 수 있다. EV 인증서는 우회하지 못한다(`L15`). Store만 경고 없음. 초기 사용자에게 미리 알리라고 Microsoft가 권한다(`L16`). Smart App Control은 클라우드 판단 → 서명 확인 순이며 서명 없고 평판 없으면 차단, 최근 Windows는 클린 설치 없이 재활성(`L18`·`L19`). 두 MS 문서가 "수동 심사 경로"에서 어긋남(`L48`) | https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation , https://support.microsoft.com/en-us/windows/smart-app-control-frequently-asked-questions (주소 끝 UUID는 `scan` 규칙으로 생략) | D53·D55, Q11 |
| E-ID-L21 | F52 | Tauri NSIS는 기본 현재 사용자 설치(관리자 불필요), perMachine은 관리자 필요, MSI는 Windows에서만 생성·언어별 별도(`L21`·`L22`). updater는 Windows 기본 `passive`, 설치 단계에서 앱 자동 종료, version은 `v` 유무 모두 허용, 즉시 재시작 필수 아님(`L23`·`L24`). updater 2.10.0(2026-02-03)부터 Deb·Rpm·AppImage 지원(`L25`) | https://v2.tauri.app/distribute/windows-installer/ , https://v2.tauri.app/plugin/updater/ , https://v2.tauri.app/release/updater/all-versions/ | D57, platform.md |
| E-ID-L26 | F53 | Linux AppImage: 실행 권한(chmod +x) 필요, Ubuntu 22.04는 libfuse2, 24.04+는 libfuse2t64가 없으면 `error loading libfuse.so.2`, 우회 `--appimage-extract`(`L27`). `.deb`는 `sudo apt install ./파일.deb`처럼 `./` 필요(`L29b`) | https://docs.appimage.org/introduction/quickstart.html , https://itsfoss.com/appimage-fuse-issue/ , https://linuxiac.com/how-to-install-deb-file-in-ubuntu-24-04-lts/ | D53·D59 |
| E-ID-L32 | F54 | Sparkle은 24시간 기본 간격(최소 1시간), 자동 확인 미설정이면 두 번째 실행에 묻고 자동 설치 기본 꺼짐, 일반 앱은 사용자가 앱으로 돌아올 때까지 기다렸다가 앱 안에서 알린다(`L33`). VS Code는 macOS·Windows 자동, Linux는 패키지 관리자(`L34`). SOUPS 2016: 업데이트는 방해하고 정보 부족, 알림·동의 선호가 갈린다(`L37`) | https://sparkle-project.org/documentation/customization/ , https://sparkle-project.org/documentation/gentle-reminders/ , https://code.visualstudio.com/docs/enterprise/updates , https://www.usenix.org/conference/soups2016/technical-sessions/presentation/mathur | D57 |
| E-ID-L39 | F55 | semver.org: "v1.2.3"은 시맨틱 버전이 아니며 `v`는 흔한 접두 표기 | https://semver.org/ | D57(버전 "0.1.2") |
| E-ID-L41 | F56 | 데이터 경로(Tauri): 설정 macOS `~/Library/Application Support/<id>`, Windows `%APPDATA%\<id>`, Linux `~/.config/<id>`. 로그 macOS `~/Library/Logs/<id>`, Windows `%LOCALAPPDATA%\<id>\logs`, Linux `~/.local/share/<id>/logs`. NSIS 제거기는 "앱 데이터 삭제" 체크 시 `$APPDATA\<id>`·`$LOCALAPPDATA\<id>`를 지우고 업데이트용 제거에서는 유지(`L42`). Apple: 제거기가 있으면 그것이 최선, 앱이 만든 문서는 지워지지 않는다(`L40`) | https://docs.rs/tauri/latest/tauri/path/struct.PathResolver.html , Tauri `installer.nsi`, https://support.apple.com/en-us/102610 | platform.md |

**이 저장소의 현재 구현(독립 재측정)**

| ID | F | 사실 | 출처 | 쓰는 곳 |
|---|---|---|---|---|
| E-ID-U52 | F57 | `app.css:6`이 `:root { font-size: 14px }`라서 rem 토큰은 문서·주석의 px 표(1rem=16px 가정)보다 12.5% 작게 그려진다: --text-md 12.25px(문서 14), --control-h 31.5px(36), --control-h-sm 24.5px(28), --header-h 42px(48), --icon 17.5px / --icon-sm 14px(20/16), --progress-h 5.25px(6), --rail-w 2.625px(3), --space-4 14px(16), --content-max 784px(896). `Icon`은 px 속성이라 16/20 그대로여서 IconButton 박스−아이콘 차이는 8.5/11.5(홀수) | 헤드리스 Chromium 153 `getComputedStyle` | `A-VIS-01`, D4 |
| E-ID-K42 | F58 | `ACTION_ICON`(jobs.ts:445-456)은 resume·retry가 모두 `play`, copyUrl·copyReport가 모두 `copy`, cancel이 `x`다. `badge.adult`는 '19', `CANCEL_CONFIRM_BYTES`는 512 MiB, JobItem 취소는 글자 없는 `IconButton icon="x"`(`K43`). 아이콘 버튼 박스−아이콘 차이는 주석 기준 짝수(28−16, 36−20)이나 실제 렌더는 `U52`(`K44`) | 워크트리 | `A-*` 은유 과적, foundations §9.1 |
| E-ID-U49 | F59 | C2 미충족(ko.ts·worker copy.ts에 "비공식" 0건), C6 오류 본문에 `(코드 …)`·`(HTTP …)` 노출(copy/errors.ts:139, 152)(`U50`), C4 Ctrl/Cmd+Enter 시작 있음(ResolveCard.svelte:175, 235)(`U51`) | 워크트리 | C2·C4·C6 |
| E-ID-L46 | F60 | 랜딩 macOS 안내는 xattr 한 줄(copy.ts:51), Windows는 SmartScreen [추가 정보] → [실행] 한 줄(copy.ts:53), Linux는 `chmod +x`와 `sudo apt install ./…deb`(landing-view.ts:45)이며 FUSE 안내가 없다(`L45`·`A44`). 릴리스 구성은 darwin arm64 dmg + .app.tar.gz, windows nsis·msi, linux AppImage·deb. `signingIdentity` 없음, `requireSignedVersion` 켬 | 워크트리, `release/expected-artifacts.json` | D53·D55 |

---

## 3. 버린 주장(refuted·unverifiable)

시스템 문서에 쓰지 않는다. 조사 보고서가 주장했으나 검증에서 출처가 다르거나(refuted) 확인할 수 없었던(unverifiable) 것이다. "대신"은 쓸 수 있는 사실이다.

### 3.1 `X-APPLE`

| ID | 버린 주장 | 판정 | 대신 |
|---|---|---|---|
| X-APPLE-01 | "이전 macOS regular 버튼은 22pt" | 출처 없음 | `E-DESK-R37`(Tahoe 실측 24/28) |
| X-APPLE-02 | "Tahoe 창 반지름 26pt" | 출처 없음 | 쓰지 않는다 |
| X-APPLE-03 | "한글 자연 행간 13을 웹에서 쓴다" | refuted(웹 줄 상자는 16) | `E-APPLE-07` |
| X-APPLE-04 | "알림 버튼은 sentence-style", "Buttons 페이지가 title-style을 말한다" | refuted(실제 title-style, 출처는 alerts 페이지) | `E-APPLE-22`(한국어에는 영향 없음) |
| X-APPLE-05 | "HIG:windows가 비활성 창의 선택 회색을 말한다" | refuted(제목 표시줄 버튼 이야기) | `E-APPLE-13` |
| X-APPLE-06 | "`prefers-reduced-transparency`로 대응" | refuted(WebKit 미지원) | `E-APPLE-14`, 반투명을 쓰지 않는다 |
| X-APPLE-07 | `r_in = max(0, r_out − padding)`을 Apple 규정으로 인용 | unverifiable(유도식) | `E-APPLE-20`("패딩을 뺀다"까지만), foundations §6.1은 유도식임을 명시 |
| X-APPLE-08 | Apple Style Guide의 click/choose 구분 | 원문 미확인 | content.md 용어는 우리 선택 |
| X-APPLE-09 | Windows/Linux `system-ui`가 Segoe UI라는 주장 | 검증 불가 | Q1·Q2 |
| X-APPLE-10 | 스위치·검색 입력 높이를 측정 전제 없이 규격처럼 인용 | 조건부 | `E-APPLE-19`(스위치는 앱 객체 초기화 뒤 54×24, 검색 입력은 쓰지 않음) |
| X-APPLE-11 | "h ≤ 24 둥근 사각형, h ≥ 28 캡슐"을 우리 높이에 적용 | unverifiable(WWDC 매핑은 크기 이름 기준) | `E-APPLE-20`(캡슐은 눈에 띄는 동작에만) → D18 |
| X-APPLE-12 | SF Symbols 라이선스가 Apple 플랫폼 한정인지(HIG 보고서 기준) | 2차 인용 | `E-ID-K01`이 원문을 확인했다 |

### 3.2 `X-DESK`

| ID | 버린 주장 | 판정 | 대신 |
|---|---|---|---|
| X-DESK-R37 | "macOS 표준 컨트롤 약 22~28pt" | refuted | `E-DESK-R37` 24/28 |
| X-DESK-R38 | "Windows 표준 컨트롤 약 32px" | unverifiable(32는 타이틀바만 확인) | `E-DESK-R14` |
| X-DESK-E27 / N11 | `html,body{overflow:hidden;overscroll-behavior:none}`로 macOS 고무줄을 막는다 | refuted(Safari 16 partial) | 실기 확인 전 규칙으로 쓰지 않는다 |
| X-DESK-N15 | Handy CSS를 "macOS만 scrollbar-color, 나머지만 `::-webkit-scrollbar` 14px"로 인용 | refuted(14px 규칙은 전 플랫폼) | 인용하지 않는다 |
| X-DESK-R12 / R13 | Superhuman 수치(50ms·100ms·11/12/14/16/18px·행 1.4·3px 막대), 팔레트 배치 | unverifiable(페이지 스스로 미검증) | 쓰지 않는다 |
| X-DESK-L20 | Epic React "300ms+350ms" | refuted(강의 설정값, 패키지 기본은 500/200) | `E-DESK-L18` |
| X-DESK-L22 / L24 | Queensland "약 200ms", Harrison CHI 2010 "약 10%" | unverifiable(403, 수치 없음) | `E-KO-33`(arXiv 2211.13909) |
| X-DESK-N45 | 알림 형식 숫자(제목 20자, 영상 제목 24자 절단, 3초 묶음, 초당 1회) | 보고서 선택 | D38의 40자소는 [취향]으로 등록(ADR-0002) |
| X-DESK-L34 | 제안 값(콜드 1000ms·웜 400ms, 로딩 300ms 지연·400ms 최소, 1500ms 안전장치, 100행 가상화) | 보고서 제안 | `E-DESK-L18`·`L09`·`L10`만 인용 가능 |
| X-DESK-R27 / R43 / R44 / R45 | "macOS 스크롤바는 건드리지 않는다"의 근거 문서, WebKit 경고음 재현, 1Password 8·Figma 불만, Zed·Notion·Craft·Things·Arc 서술 | unverifiable(열지 않음) | 쓰지 않는다 |
| X-DESK-E34 | Linux `system-ui` → DejaVu Sans, 한글 폴백 순서 | unverifiable | Q2 |
| X-DESK-E40 | "`forced-colors`가 켜지는 곳은 Windows 고대비뿐"(engine 보고서 추론) | 추론 | `E-A11Y-A01`(소스로 확인됨, 그쪽을 인용) |
| X-DESK-E12 | Safari 갱신이 다른 앱 WKWebView에도 가는가 | unverifiable | 하한 근거로 쓰지 않는다 |
| X-DESK-N39 | 서명 없는 macOS 번들에서 알림이 뜨는가 | unverifiable | Q11 |

### 3.3 `X-KO`

| ID | 버린 주장 | 판정 | 대신 |
|---|---|---|---|
| X-KO-A1a | 토스 #5 점검 질문 "소리 내어 말해도 자연스러운가" | refuted | `E-KO-14` |
| X-KO-A8a | "Apple HIG가 용어집을 권한다" | refuted | `E-KO-15`, 용어집은 우리 선택(D43) |
| X-KO-A8b | Google Chat의 "무엇/왜/어떻게" 3요소 | refuted | `E-KO-18`, 3요소 틀은 우리 선택(D51) |
| X-KO-A1b | Toss Product Sans가 Sandoll 고딕네오1 기반 | unverifiable | 쓰지 않는다 |
| X-KO-A1c / A4 / A3 | 앱인토스 `~하기` 기능 이름 규칙, 카카오 `카카오로 시작하기` 구성, KRDS "light·thin 지양" | unverifiable | 쓰지 않는다 |
| X-KO-B4 | "5초 + 120자당 1초" 토스트 공식, 토스트 3개 이하·최소 10초·32px 권장 | 출처 없음 | D37의 6초는 [취향](ADR-0002) |
| X-KO-B5 | "10~15초 창 평균" ETA(출처는 EMA만), "끝에서 멈추는 것이 더 나쁘다", 1초 1회 갱신·5초 반올림·첫 N초 숨김 | 출처 없음 | D50의 EMA·1초 갱신은 [취향] |
| X-KO-A5 | 맑은 고딕 2굵기 | 출처 없음 | `E-A11Y-D25`(3굵기 Semilight·Regular·Bold) |
| X-KO-A7 | 영문 단위(`MB`·`%`) 띄어쓰기의 국립국어원 판단 | 없음 | `E-A11Y-U14`·`U16`(Apple ko 붙임, CLDR) |
| X-KO-B2 | 모션 100~120 / 160~200 / 240~300 구간, 본문 15px 권고 | 보고서 제안 | `E-KO-28`에서 우리가 고른 값(D22) |
| X-KO-B1 | "Undo로 되돌릴 수 있으면 경고가 필요 없다" | 부분(출처는 "더 강한 보호"까지) | `E-KO-30` |
| X-KO-B3 | 진행 막대가 2.2.2의 본질적 예외라는 해석 | unverifiable | `E-KO-24`만 |
| X-KO-A4b | 배민 2.0, LINE Seed 한글 단독 담당 | 미열람·부분 수정 | 쓰지 않는다 |

### 3.4 `X-SCALE`

| ID | 버린 주장 | 판정 | 대신 |
|---|---|---|---|
| X-SCALE-05 | "컨트롤 32 중간 수렴" | 부분 refuted(Polaris 768px 이상 28, Carbon 버튼 48) | `E-SCALE-04`("단일 정답 32는 없다") → D16은 AppKit 24/28/36 |
| X-SCALE-A4 | Spectrum 그림자 수치(y1/blur6 등), "라이트 0.12/다크 0.36" | refuted(세 계열 모두 3겹) | 쓰지 않는다 |
| X-SCALE-B2 | Spectrum `blue-800` = #147AF3 | refuted(15.5.0은 #4B75FF) | 쓰지 않는다 |
| X-SCALE-A5a | Polaris 버튼 높이를 데스크톱 값처럼 서술 | refuted(모바일 우선, ≥768px에서 28/32) | `E-SCALE-04` |
| X-SCALE-A5b | Carbon 기본 높이 40 | refuted(버튼 48, 입력 40) | `E-SCALE-04` |
| X-SCALE-A2 | Segoe UI Variable wght 300~700 | refuted(Thin 100~Bold 700) | 참고 |
| X-SCALE-B3a | Tailwind 22색상군 | refuted(26) | `E-SCALE-31` |
| X-SCALE-A3 | M3 XXL 미확인 | refuted(48dp 존재) | `E-SCALE-06` |
| X-SCALE-A1 | Linear 사이드바 간격이 Apple 기준 | refuted(내비게이션 전반, 수치 없음) | `E-DESK-R04` |
| X-SCALE-B1 | DTCG 발표문이 모듈 셋을 내세운다 | refuted(TR에서 확인) | `E-SCALE-28` |
| X-SCALE-B3b | Apple HIG "순수 #000 회피" | unverifiable(문장 없음) | D9의 순흑 없음은 HDR 근거(`E-A11Y-D39`·`D40`) |
| X-SCALE-E | Linux webkit2gtk 4.1·Windows WebView2의 CSS 지원 | 미측정 | Q2, `oklch()`·`light-dark()`·`color-mix()`를 하한 엔진에서 쓸 수 있다고 적지 않는다(D3는 hex 커밋) |
| X-SCALE-A2b | Windows 타입 램프의 스타일 **이름**(Caption·Body…) | 문서 본문에 없음 | 크기/행간 쌍만(`E-A11Y-D26`) |

### 3.5 `X-A11Y`

| ID | 버린 주장 | 판정 | 대신 |
|---|---|---|---|
| X-A11Y-A16 | WebKit 161452가 "macOS에 Larger Text 없음" 논의 | refuted(페이지 확대 API 요청) | `E-A11Y-A18`(187013 WONTFIX) |
| X-A11Y-A12 / A14 | Windows 텍스트 크기가 WebView2를 통째로 확대, 최소 창 → CSS 320px | unverifiable(사용자 보고뿐) | D24 분기 600 [잠정], 실기 `innerWidth` 확인 |
| X-A11Y-U06 | Windows 열의 3자리 값 1,000,000→`977 KB` | refuted(내림이라 `976 KB`) | `E-A11Y-U01`(내림) |
| X-A11Y-U16 | Finder 한국어 `64.0MB/1.33GB - 남은 시간 계산 중…`이 붙임의 증거 | refuted(nib 자리표시 문구) | `E-A11Y-U14`(ko-localized `ByteCountFormatter` 출력 `8.4GB`) |
| X-A11Y-U18 | `includesTimeRemainingPhrase`가 한국어에서 영어 `remaining` | refuted | `E-A11Y-U15` |
| X-A11Y-U33 | `formatMmss` 사용처 없음 | refuted(`LoginView.svelte`) | — |
| X-A11Y-U37 | codereview 2750713003이 "0 seconds remaining" 수정 | refuted | 쓰지 않는다 |
| X-A11Y-U41 | "5초 이상은 남은 시간 텍스트, 10초 이상은 취소"(prototypr) | unverifiable(403) | `E-ID-U02` |
| X-A11Y-D47 | `--weight-medium` 사용 24곳 | refuted(11곳) | — |
| X-A11Y-D49 / D51 | 다크 `--border-strong` 대비 표의 surface-2·surface 값 | refuted(뒤바뀜) | `E-A11Y-D48` |
| X-A11Y-D19 | 부분 덮임 대비 표 | 혼합 모델 의존 | 결론(얇은 선 위험)만 |
| X-A11Y-D28 | 맑은 고딕에서 500→400, 600→700 합쳐짐 | 추론 | Q1 |
| X-A11Y-D54 | Windows 배율 분포(125·150% 다수) | 미확인 | 쓰지 않는다 |
| X-A11Y-A49 | GNOME 애니메이션 줄이기 메뉴 경로 | unverifiable | 쓰지 않는다 |
| X-A11Y-T05 / T20 | macOS 한국어 IME + WKWebView Enter 순서 실측, `detectValues` 알림 여부 | unverifiable | Q15 |
| X-A11Y-T36 | "blur에서도 검증하지 않는다"의 NN/g 근거 | refuted(NN/g 이상형은 필드를 벗어난 직후) | content.md 오류 시점은 우리 선택 |
| X-A11Y-A72 / U45 / D55 / T46 | 격차 보고서의 규칙 문장(R-OS-1~16, 단위 규칙 1~11, 배율 규칙 1~11, 입력 R1~R11) | 설계 판단(사실 아님) | §5 `G-*`로 등록, E1 |

### 3.6 `X-ID`

| ID | 버린 주장 | 판정 | 대신 |
|---|---|---|---|
| X-ID-K28 | "한글 줄기 0.085em" 하나로 모든 굵기·엔진 | refuted | `E-ID-K27`(400~500만 두 엔진 일치) |
| X-ID-U31 / U32 | 루키 14일 보관, "공식 다운로드 없음·m3u8·ffmpeg·확장 프로그램" | refuted(값이 바뀌었고 출처에 서술 없음) | D39(보관 기한 추정 금지) |
| X-ID-U25 | 그림자는 팝오버에만(치지직) | refuted | `E-ID-U20`(팝오버·툴팁·칩·플로팅) |
| X-ID-U26 | 서체 "Nemonic" | refuted | 산돌 네모니2(`E-ID-U20`) |
| X-ID-I07 / I08 | Flathub가 "X for Y" 이름을 대체로 허용, 텔레그램 예 | refuted | `E-ID-I08b`(더 엄격) |
| X-ID-I10 | Twitch 포럼이 비제휴 고지를 권했다 | refuted | 쓰지 않는다 |
| X-ID-U44 / K44 | 컨트롤 36·28·48, 본문 14px 등 토큰 주석·문서의 px 값 | refuted(실제 31.5·24.5·42·12.25) | `E-ID-U52` |
| X-ID-K40 | HIG "Don't design replicas of Apple products"를 Finder·탐색기 로고 금지 근거로 | refuted(하드웨어 복제 문장) | foundations §9.1의 로고 금지는 상표 일반 규칙으로만 |
| X-ID-I48 | Windows 토스트/macOS 알림 발신자 = 번들명 | refuted(Apple 포럼은 .app 파일 이름) | Q11 |
| X-ID-U45 / U47 | Downie 2026-03 YouTube 불가 후기, 4K Plus "Can't parse this link" | refuted(날짜·문구 없음) | 쓰지 않는다 |
| X-ID-U13 | NN/g 신뢰 글의 "요청 이유 설명" | 분리(짧은 양식만 확인) | `E-ID-U10` |
| X-ID-K08 | 일반 `Pause`가 Feather 유래 | refuted | `E-ID-K08b` |
| X-ID-L20 / L19b | SAC가 [실행] 없이 막고 끄기만 우회(KDE 이슈) | refuted·unverifiable | `E-ID-L14` |
| X-ID-L29 / L30 / L31 | .deb 더블클릭 서드파티 경고, "unsandboxed" 알림 무해, App Center 업데이트·제거 불가 | refuted | `E-ID-L26`(`./` 필요만) |
| X-ID-L35 / L36 | Figma "지금/다음 실행 때 설치", Discord 강제 설치 | refuted·unverifiable | 쓰지 않는다 |
| X-ID-L40b / L13 | "Library 데이터는 휴지통 삭제 뒤에도 남는다", Translocation이 자체 업데이트를 깨뜨린다 | unverifiable | 쓰지 않는다 |
| X-ID-I44 / I21 | apple-touch-icon 불투명 필수, Mono "한 요소 흰색" 원문(보고서판) | unverifiable | `E-ID-I17`(검증자가 확인한 Mono 서술은 confirmed) |
| X-ID-M07 | Windows 맑은 고딕·Noto CJK 줄기, WebView2·WebKitGTK 렌더 | 측정 불가 | Q1·Q2·Q4 |
| X-ID-U15 / U33 / U39 / U41 / U48 | Google 보안 블로그, extensionauditor, Transmission(TechRadar·Softpedia), Safari/Orion/Neowin, linux.org·VideoHelp | 본문 미추출 또는 402/403/404/503 | 쓰지 않는다 |
| X-ID-I14 / I16 | 부정경쟁방지법 조문, 치지직 개발자 센터 약관, KIPRIS | 차단·미반환 | Q9(사람이 확인) |
| X-ID-U16b | "간단한 과업은 전체 애플리케이션보다 한 화면이 낫다" | 해석 | `E-ID-U16` |
| X-ID-U40b | Chrome 다운로드 아이콘 24시간 숨김 | unverifiable | 쓰지 않는다 |
| X-ID-A39 / A40 | 개인정보 보호법 제30조·시행령 제31조 원문, Windows 설정 > 정보 [복사] 버튼 | unverifiable | Q9·Q21, D51 |
| X-ID-I40 / I45 | Linux 크기 관례 16~512, X 카드 규격 | unverifiable | 쓰지 않는다 |

### 3.7 브리프가 미리 걸러 둔 것(brief §4.3, 위와 중복 아닌 것)

- 국립국어원이 MB·% 띄어쓰기를 정했다 → 숫자 뒤 단위 의존명사만 다룬다(`E-A11Y-U25`).
- "의미 경계 3.5:1", "의미 다른 색 쌍 ΔE2000 15 이상", "네트워크 단절 대기 30분·상한 30초", "사용자 시험 판정 3명 중 2명" → 보고서 제안값. 쓰려면 ADR에 우리 결정으로 적는다(README §6-7).

---

## 4. 현재 코드 결함 색인(`A-*`)

감사 일곱 편(a-visual·a-feat·a-prim·a-drift·a-lit·a-copy·a-worker)이 2026-10-09 커밋 `c1d1b3c` 기준으로 찾은 결함이다. 심각도는 브리프 §3의 것(P0 잘못 보이거나 접근성·법 위반·기반을 흔듦 / P1 일관성 깨짐 / P2 다듬기). 코드는 각 감사 보고서의 항목 번호를 그대로 썼다. 한 행이 여러 항목을 묶은 경우(`A-FEAT-N1~N9`, `A-VIS-05·06`)와 괄호 안 코드(`A-DRIFT-S2`)도 그 행으로 인용한다. 적용 PR이 고치면 이 표의 "해소" 열에 PR 번호를 적는다. 경로는 `app/src/lib/components/` 아래가 `C/`, `app/src/lib/views/`가 `V/`, `app/src/styles/tokens.css`가 `TK`다.

### 4.1 P0

| ID | 결함 | 위치 | 닫는 결정 | 해소 |
|---|---|---|---|---|
| A-VIS-01 (= A-DRIFT-S0, A-LIT-0.1, E-ID-U52) | `:root { font-size: 14px }` 때문에 rem 토큰이 전부 12.5% 작게 렌더. text-md 12.25, control-h 31.5, header 42, radius 10.5/7/5.25/3.5, content-max 784. 소수 픽셀이라 1x에서 흐림(rail 2.625). 상속 글자 14px가 본문 12.25보다 큰 역전. `tokens.test`는 단위를 검사하지 않는다 | `app/src/app.css:6`, `TK` 전체, `docs/design/ui-visual.md:99` | D4(루트 16, 모든 토큰 px) | |
| A-FEAT-N1~N9 | 알림 9갈래: Banner(info·danger, 경고 없음), InlineAlert(danger·warning·info), ConflictNotice(warn/info 직접), JobItem 오류 블록, blocked(톤 없음), ClipboardSuggestion, Toast(success·copied·danger·info), LoginView 자체, 색만 쓰는 인라인 상태 글. 톤 집합 2/3/4개, 반경 6/12/0, 패딩 5종, 아이콘 20/16, role 매핑 제각각. **ConflictNotice warn에 `role=alert`**(`A-FEAT-S6`). warning과 danger가 같은 아이콘. 오류 title/body/detail 렌더 6곳 복사 | `C/ui/Banner.svelte:17-24`, `C/ui/InlineAlert.svelte:16-23`, `C/receive/ConflictNotice.svelte:20-60`, `C/jobs/JobItem.svelte:126-138,170-174`, `C/ui/Toast.svelte:27-48`, `V/LoginView.svelte:52-89` | D35(Notice 하나), D37 | |
| A-VIS-02~04, A-FEAT-A2~A6 | 정렬선과 폭: 본문 열 폭이 화면마다(홈 742, 설정 598, 로그인 420, 대화상자 400, 토스트 360 리터럴). 720 창에서 설정 가장자리 54, 홈 14. 기준선 셋(창 기준 헤더·배너·토스트 vs 본문 열). 840 분기 6곳(`A-DRIFT-S2`). 설정 뒤로 가기 `:has` 특이도 버그(`A2`). 항목 글자가 rail 3px만큼 어긋남(`A5`). 오른쪽 끝 822/829/835. 헤더 좌우 24 vs 16 | `C/ui/Banner.svelte:62`, `C/app/AppHeader.svelte:65`, `V/HomeView.svelte:20`, `V/SettingsView.svelte:178`, `C/jobs/JobItem.svelte:183` | D24(열 하나 800, 분기 600 하나) | |
| A-VIS-05·06, A-FEAT-J1~J3, A-DRIFT-B12 | 대화상자 버튼 순서: 안전한 쪽 primary가 왼쪽 4곳·오른쪽 2곳. 취소 확인에 채워진 버튼 둘(청록+빨강). 업데이트의 "나중에"가 primary. 안전 라벨 4종(계속 받기/돌아가기/취소/나중에). 로그아웃 secondary vs "취소하고 지우기" danger | `C/app/CloseGuard.svelte:62-63`, `C/jobs/JobList.svelte:176`, `C/receive/ResolveCard.svelte:235`, `C/app/LegacyFound.svelte:41-44` | D36 | |
| A-PRIM-N1~N15 | prop 어휘: Button `variant`가 primary/secondary/danger/link로 의도·외형 혼재(`N1`), Badge `tone`에 도메인·상태 혼재, Disclosure `variant`는 레이아웃, size 기본값 Button md/IconButton sm(`N4`), 닫기 `onclose`/`ondismiss`(`N6`), 값 prop value/checked/selected/open(`N7`), 이름 prop label/labelledby/aria-label/title(`N9`), **Select·Switch·ProgressBar·TextField가 접근 이름을 강제하지 않음**(`N10` = `A-PRIM-X3`), id 생성기 셋(`N14`) | `C/ui/Button.svelte:10`, `C/ui/IconButton.svelte:11`, `C/ui/Toast.svelte:12`, `C/ui/RadioGroup.svelte:7`, `C/ui/Select.svelte:4-11`, `C/ui/ProgressBar.svelte:11`, `C/ui/Disclosure.svelte:14`, `C/ui/Menu.svelte:28`, `C/ui/Dialog.svelte:15` | D35 | |
| A-COPY-P0-1~5 | 문구 P0: `update.banner` '새 버전 {version}이 있어요.' 조사 하드코딩(`ko:247`), `card.close`와 `card.cancel`이 같은 `onclose`(`ko:28,30`, `ResolveCard.svelte:187,234`), 코어·셸 합니다체 원문이 detail·시작 실패 창에 노출(`err:317,339,343,347`, `lib.rs:408`, `error.rs`), '로그인 정보'가 쿠키(`ko:114`)와 앱 로그인(`ko:204`) 두 뜻, `diskFull` 어미 불일치(`err:274`) | `app/src/lib/copy/ko.ts`, `app/src/lib/copy/errors.ts`, `crates/shell/src/error.rs` | D43·D44·D46 | |
| A-DRIFT-A8 (= S1), A-VIS-28 | 대비 미달: `border-strong`/bg 2.89(UrlBar가 bg 위에 있어 **1.4.11 위반**). `fg-faint`가 정보 글자에 쓰임(라이트 #78878F는 surface 3.71, bg 3.39, surface-2 3.18). 미검사 조합 border-strong/surface-2 2.71, fg-faint/danger-soft 3.12, fg-faint/accent-soft 3.17. 문서의 "3:1 보조" 등급은 WCAG에 없다(`A-DRIFT-B2`) | `C/receive/UrlBar.svelte`, `C/receive/FilenameField.svelte:56`, `C/jobs/JobItem.svelte:300` | D19(경계 ≥3:1 8쌍), foundations §1 규칙 5(`--fg-disabled`) | |
| A-WORKER-2.6 | Worker 컨트롤 테두리 `--line`/bg 대비 1.35·1.50으로 미달. 대비 검사 없음 | `worker/src/http/site-css.ts:6-7` | D3(같은 토큰), D19 | |
| A-PRIM-X1 (= F1) | forced-colors에서 포커스 링(box-shadow)이 사라진다. 전역 forced-colors 규칙 0건 | `app/src/app.css:37-41` | D20(outline) | |
| A-PRIM-T1 | TextField invalid 상태가 hover에 덮인다(특이도) | `C/ui/TextField.svelte` | D21, `G-INPUT-IN7` | |
| A-PRIM-B1 | Button link+sm 조합이 `.btn.sm`에 져서 다른 모양 | `C/ui/Button.svelte` | components.md | |
| A-PRIM-SW1 | Switch disabled+checked가 활성처럼 보인다 | `C/ui/Switch.svelte:56,73` | components.md, `frontend` 테스트 | |
| A-PRIM-SF1 (= X2) | SecretField 라벨이 바뀌면서 `aria-pressed`까지 이중 | `C/ui/SecretField.svelte:30-32` | components.md | |
| A-PRIM-X4 | Menu 비활성 항목에 `disabled`를 써서 키보드로 닿지 않는다(`aria-disabled`가 정석) | `C/ui/Menu.svelte:34,125` | components.md | |
| A-ID-C2 (= E-ID-U49) | 비공식 고지가 없다(C2 미충족) | `app/src/lib/copy/ko.ts`, `worker/src/http/copy.ts` | D34 | |
| A-ID-K29 (= E-ID-K29) | 오픈소스 고지 파일 0개. Feather MIT 고지도 없다 | 저장소 루트 | D31 | |
| G-PRIVACY-G4 | 개인정보 처리방침 `/privacy`가 없다(격차 보고서가 찾은 결함) | worker.md §9.5 | D53, web.md §10 | |
| A-WORKER-C1 | Worker 라이트 강조색 `#007A45`가 C1 금지 범위 안. 다크 `#3DDC8A`는 채도 기준에 따라 경계 | `worker/src/http/site-css.ts:6-7` | D5·D6(무채색 + 파랑) | |

### 4.2 P1

| ID | 결함 | 위치 | 닫는 결정 |
|---|---|---|---|
| A-VIS-16·17, A-FEAT-E1·E2·E7, A-VIS-36 | 글자 크기 7개(10.5/11/11.375/12.25/14/16.625/21). 섹션 제목 12.25 < 화면 제목 16.6, 카드 제목 = 앱 이름 14(V-17). 라벨 5종(E1). 라벨·값 색 역할이 화면마다 반대(E2). 400/500/600이 같은 14px에서 섞임(E7). 설정 값이 라벨보다 크다(V-36) | `C/receive/ResolveCard.svelte:185-188`, `C/jobs/RecentList.svelte:44-49`, `V/SettingsView.svelte` | D12·D13 |
| A-VIS-07·08, A-FEAT-D11 (= A-DRIFT-A14·B11, A-FEAT-S7) | 버튼 변형 6종. 한 화면에 primary 둘([불러오기]+[다운로드]). 카드 [다운로드]가 열자마자 잠시 비활성인데 이유 없음. SecretField 눈 버튼 22.9×24.5 | `C/receive/UrlBar.svelte:60`, `C/receive/ResolveCard.svelte:235` | D42(채움은 [받기]만), P3 |
| A-VIS-29 | 비활성 primary([다운로드])가 "활성 영역 같은 회색 상자"로 보여 입력 전 홈이 죽어 보인다. 비활성이 opacity가 아니라 회색 면이라 채움 버튼 모양이 남는다 | `C/receive/UrlBar.svelte`, `C/ui/Button.svelte` | D21(홈에 채움 버튼 없음, 비활성은 `--fg-disabled`), `J-F-A1` |
| A-VIS-23·09·22, A-ICON-G1·G6 (= E-ID-K42) | 아이콘 은유 과적: 아래 화살표가 앱 마크·빈 상태·로그인 히어로·다운로드 버튼·드롭 오버레이·앱 아이콘을 겸함(V-23). ×가 닫기이면서 취소(V-09). play가 이어받기·다시 시도 겸함. 경고 삼각형이 오류·경고 겸함. 행 오른쪽 아이콘 집합이 상태마다 달라 × 위치가 흔들림. 상태 선두 아이콘이 일부에만 있어 글자 시작 22px 어긋남(V-22) | `app/src/lib/jobs.ts:445-456`, `C/jobs/JobItem.svelte:163-164` | D32, foundations §9.1 |
| A-VIS-10, A-LIT-1 | 간격 격자 둘(3.5/7/10.5/14 vs 4/6/10/12). 리터럴 105개(선언의 11%, 41개 파일 중 33개). 가로 패딩 7종, 카드 패딩 6종, 행 높이 28/32/32/48, 세로 리듬 8~48. 광학 보정 꼼수(-4 margin, -6px, vertical-align -3px). 미정의 토큰 2개(`--leading-title`, `--leading-body`), 미사용 토큰 8개 | `C/ui/Switch`(10)·`RadioGroup`(9)·`Menu`(8)·`Spinner`(7)·`Button`(6) | D17, `design-lint`·`design-tokens` |
| A-FEAT-F1~F5, A-VIS-19 | 상태 화면: 로딩 표현 5종(F1). 설정 로딩 중 가짜 기본값 `?? 2`, `?? 4`(F2). 스켈레톤과 빈 상태 동시 표시, 125px→380px 점프(V-19). 빈 상태 규칙 없음(F3). 오류 위치 제각각(F5). EmptyState 컴포넌트 없음(`A-DRIFT-A10`) | `C/jobs/JobList.svelte:135-139,224` | patterns.md 로딩·빈 상태 |
| A-VIS-20 | 실패 항목에 빨강 5겹(레일·테두리·막대·아이콘·글자). InlineAlert border-left 3px에 radius가 걸려 선이 휨 | `C/jobs/JobItem.svelte:190-215` | D19, ADR-0003(레일 폐기) |
| A-VIS-30·31·41 | 다크 색이 탁함(accent-soft #173C3F, danger-soft #3E2320). 종류 배지 3색(호박·파랑·보라)이 가장 시끄러움(V-31). 배너 info가 청록 = 브랜드 = primary라 정보와 행동 유도가 구별 안 됨(V-41) | `TK`, `C/ui/Badge.svelte`, `C/ui/Banner.svelte:33` | D9·D10 |
| A-VIS-26·38, A-PRIM-F2~F7 | 다크 포커스 링: 면 버튼에 2+2 링이 부풀어 보임. 마우스로 연 대화상자에도 autofocus 링. 포커스 링 구현이 전역 1 + 재정의 5 + 끄기 5로 흩어짐. surface 색 후광이 다른 면 위에서 띠 | `app/src/app.css:37-41`, `TK:51` | D20 |
| A-VIS-39 | 컨트롤 높이 22/24.5/31.5/32 혼재. Switch 40×22, Select 72px 고정 | `C/ui/Switch.svelte`, `C/ui/Select.svelte` | D16, foundations §5 |
| A-DRIFT-M4·M5, A-FEAT-S14 | Disclosure chevron이 오른쪽(macOS는 왼쪽 삼각형). 열림 애니메이션은 명세에만 있고 구현은 hidden 토글. "고급" Disclosure 제목 요소 없음, 글자 8px 오른쪽 | `C/ui/Disclosure.svelte:28,41`, `C/settings/CookieSection.svelte:72-74` | components.md Disclosure |
| A-COPY-P1-6~18 | 문구 P1: 요청형 3갈래(해 주세요/-세요/-해요), 상태 줄 명사형+해요체 혼합('대기 중 · 곧 시작해요'), 용어 혼용(받기/다운로드/저장, 일시정지/멈춤/중단, 허가/허용, 서버 3종, .part 4종, 주소/링크, 불러오기/가져오기/조회), Worker '다운로드'는 설치 파일, 시각 형식 4종, 바이트 1024 기반인데 MB, Worker 오류 제목 전부 '안내', 버튼 라벨 5계열, 번호 목록이 문자열에 박힘, 동일 문구 중복 키 8쌍 | `app/src/lib/copy/ko.ts:75,88`, `app/src/lib/format/bytes.ts:28`, `worker/src/http/copy.ts:26` | D42~D50 |
| A-IME-1 (= E-A11Y-T40·T43) | 입력 주소 추출이 경로마다 다름(붙여넣기는 전체, 제안·드롭은 토큰). 괄호·따옴표·끝 구두점·조사가 있으면 셋 다 실패. macOS WKWebView는 한글 조합 확정 뒤 `keydown isComposing=false keyCode=229`를 보내는데 `ResolveCard` Mod+Enter와 Dialog Esc는 검사하지 않는다 → 조합 중 받기 시작 위험 | `C/receive/ResolveCard.svelte:174-178`, `app/src/lib/chzzkUrl.ts`, `crates/shell/src/app.rs:463-470` | platform.md IME·클립보드 |
| A-SAVE-1 | FAT32에서 4GiB를 넘으면 끝 무렵 실패하고 "권한 확인" 문구. io 오류 원인 미구분. 경로가 끝 말줄임 | `crates/core/src/download/`, copy/errors.ts | content.md 오류, foundations §3.5(가운데 말줄임) |
| A-WORKER-3.1~3.7 | 버튼·입력에 hover·active·disabled·focus-visible 규칙 없음. h3 스타일 없어 h2보다 큼. keep-all·tnum 없음. meta color-scheme·theme-color·파비콘 없음. 결과·안내 화면이 모두 같은 h1+p. 다운로드가 표 안의 링크. danger 범위가 넓음(비파괴 "지우기"도 danger) | `worker/src/http/site-css.ts`, `pages.ts:31`, `landing-view.ts` | D52~D54, web.md §12 |
| A-DRIFT-A5, A-FEAT-S8 | 로그인 패널이 떠 있지 않은데 `radius-lg`(12), 시각 어휘 밖 | `V/LoginView.svelte:105` | D18, patterns.md 로그인 |
| A-DRIFT-A6 (= E-DESK-E39) | 토큰에 없는 파생 색 `color-mix` 3곳 | `C/ui/Banner.svelte:34,38`, `C/receive/DropOverlay.svelte:73` | D3(파생 색도 토큰) |
| A-DRIFT-A7, A-FEAT-S4 | 드롭 오버레이가 88% 불투명해 본문을 덮고 z-index가 `--z-banner`를 빌려 씀 | `C/receive/DropOverlay.svelte:71,73` | foundations §7.2(`--z-drop`) |
| A-DRIFT-A13 | 설정 화면이 `:global`로 자식 컴포넌트 모양을 정한다 | `V/SettingsView.svelte` | `design-lint` |
| A-PRIM-X5~X8 | InlineAlert 비-danger가 `role=note`, Spinner `role=status`에 텍스트 없음, 폼 오류 연결(`aria-describedby`) 없음, RadioGroup 행 안에 interactive 자손 가능 | `C/ui/InlineAlert.svelte:16`, `C/ui/Spinner.svelte:14-15`, `C/ui/TextField.svelte:29`, `C/ui/RadioGroup.svelte:44-56` | components.md |

### 4.3 P2

| ID | 결함 | 위치 | 닫는 결정 |
|---|---|---|---|
| A-VIS-32 | 토스트가 창 기준이라 목록을 가리고, 폭 360 고정, 후속 동작 없음 | `C/ui/Toast.svelte`, `C/app/Toaster.svelte` | D37 |
| A-VIS-33 | 메뉴 항목이 1개뿐인 경우 | `C/jobs/JobItem.svelte` | patterns.md 작업 행 |
| A-VIS-34 | 그룹 제목 10.5가 약함 | `C/jobs/JobList.svelte` | D12 |
| A-VIS-35 | 링크형 버튼이 링크인지 버튼인지 애매 | `C/ui/Button.svelte:112-122` | D35(ghost) |
| A-VIS-37, A-COPY-5 | 숫자·단위 규칙 없음: "100 B / 4.0 GB", "1000 B", "오후 12:00", "2026.10.03 21:00", "약 10.8 GB", "14분 남음" 혼재 | `app/src/lib/format/*.ts`, `app/src/lib/jobs.ts:253` | D47~D50 |
| A-FEAT-H4, A-DRIFT-M7·M9 | `@keyframes rise`가 3번 정의되고 방향 반대. 모션 리터럴 0.8s/1.2s/1.4s. reduce 처리가 개별 4곳 + 전역 중복 | `C/ui/Skeleton.svelte:29`, `C/ui/ProgressBar.svelte:65,70`, `C/ui/Spinner.svelte:28`, `C/receive/ClipboardSuggestion.svelte` | D22, `design-lint` |
| A-VIS-40 | 모서리 계층은 분명한데 가장자리에서 어긋나는 곳(`calc(radius-md - 1px)`) | `C/jobs/JobItem.svelte:194` | foundations §6.2 금지 |
| A-PRIM-N12·N13·X9 | `{#each … (b.label)}` 키 충돌 가능, `autofocus` prop 이름 충돌, IconButton `title` 중복 | `C/ui/ConfirmDialog.svelte:7,32`, `C/ui/Menu.svelte:115`, `C/ui/IconButton.svelte:19` | components.md |
| A-COPY-P2-19~26 | 말줄임표 기준 부재, 인용 4방식(직선 홑따옴표), 문구 안 하드코딩 숫자(40초·10분·1분), `잠시 뒤`/`잠시 뒤에`, 피동/능동, `이어받기`/`이어서 받기`, 보안 경고만 `-세요` | `ko.ts`, `errors.ts`, `worker/src/http/copy.ts:7,48` | D45·D46 |

### 4.4 지킬 것(a-drift K1~K20 중 시스템이 이어받은 것)

| ID | 결정 | 시스템에서 |
|---|---|---|
| A-DRIFT-K2 | 토큰이 `tokens.css` 한 곳, 컴포넌트는 `var()`만(색 리터럴 0건) | D3, `design-lint` |
| A-DRIFT-K3 | 상태는 색+아이콘+문구 세 겹 | 유지. **왼쪽 3px 레일은 폐기**(ADR-0003, `A-VIS-20`) |
| A-DRIFT-K4 | 비활성은 opacity가 아니라 색 교체 | D21(`--fg-disabled`) |
| A-DRIFT-K5 | 숫자는 고정폭, 설명은 muted | foundations §3.4 |
| A-DRIFT-K7 | 번들 글꼴 없음, 시스템 글꼴 스택 | 사용자 결정 2, foundations §3.1 |
| A-DRIFT-K8 | reduced-motion을 토큰 한 곳 + 반복 애니는 컴포넌트 `@media` | D22(0ms → 1ms로) |
| A-DRIFT-K9 | 막대 `width` transition 금지 | D23(`transform: scaleX` 250ms linear로 재정의) |
| A-DRIFT-K10 | 그림자는 떠 있는 것에만, 세 단계, 다크는 안쪽 선 | foundations §6.4 |
| A-DRIFT-K12·K13 | copy deck 단일 출처 + `t(key)` + 오류 문구 표 테스트, 오류 구조 제목/설명/동작 분리 | D51, `design-copy` |
| A-DRIFT-K15·K16 | 대화상자 포커스 가둠·Esc는 안전한 쪽·scrim 클릭으로 닫지 않음, 리스트 roving tabindex | D36, components.md |
| A-DRIFT-K17·K18 | 비밀값 취급, CSP가 인라인 스타일을 막는 구조 | D52, `worker` |
| A-WORKER-0 | Worker 골격 하나, 제목 "{화면} · 치지직 다운로더", 해요체, 비밀값 위생 | web.md §3 |

### 4.5 강제 장치의 빈칸(a-drift §7, 적용 전)

있는 것: `tokens.test`(색 1:1, 대비 31쌍×2, reduce, 번들 글꼴 없음), `csp.test`, `errors.test`(28코드), `tauri-conf.test`, svelte-check, e2e-web(관찰 중). 없는 것: CSS 리터럴 검사, var 정의 검사, 계산값 검사, 다크·720·모션 상태의 axe, 스크린샷 회귀, 문구 검사, 명세↔토큰 동기, 미사용 토큰, `.svelte` 안 한글 리터럴. → README §4.1의 `design-*` gate 여섯 개(D61).

---

## 5. 격차 보고서의 규칙 문장(`G-*`)

격차 보고서 22편과 조사 보고서 inter가 "제품에 그대로 넣을 수 있는 문장"으로 제안한 규칙이다. **사실이 아니라 설계 판단(E1)**이고, 값은 보고서가 고른 것이다. 시스템이 채택한 값은 `README.md` §5의 D 번호가 소유하므로, 이 표의 "시스템에서" 열은 어느 결정이 받았는지와 **뒤집은 곳**만 적는다. 규칙 안의 수치가 검증 보고서에서 refuted·보고서 제안으로 분류된 경우는 `X-*`를 함께 적었다. 강제 수단은 원 보고서가 제안한 것이고, 시스템이 실제로 쓰는 gate 이름은 README §4.1이다.

ID 규칙: `G-<약칭>-<번호>`. `<번호>`는 보고서 번호에서 하이픈만 뗀 것이다.

| 약칭 | 보고서 번호 | ID | 약칭 | 보고서 번호 | ID |
|---|---|---|---|---|---|
| ENGINE | R1~R10 | `G-ENGINE-R1` | ICON | 1~8 | `G-ICON-4` |
| SHELL | H1~H13(하드닝 표) / NS-1~NS-25(규칙 문장) | `G-SHELL-H10` / `G-SHELL-NS7` | ID | R1~R12 | `G-ID-R3` |
| LAUNCH | R1~R11 | `G-LAUNCH-R4` | INSTALL | R1~R14 | `G-INSTALL-R9` |
| A11Y | R-OS-1~16 / R-HC-1~6(CSS 후보) | `G-A11Y-OS3` / `G-A11Y-HC1` | PRIVACY | R1~R23(규칙) / G1~G14(빈 부분) | `G-PRIVACY-R4` / `G-PRIVACY-G4` |
| SCALE | 1~11 | `G-SCALE-3` | WEB | R1~R28 | `G-WEB-R19` |
| UNITS | 1~11 | `G-UNITS-5` | LEGAL | R1~R16(규칙) / D1~D6(결정 표) | `G-LEGAL-R8` / `G-LEGAL-D1` |
| IME | R1~R11 | `G-IME-R4` | EVID | R1~R10 | `G-EVID-R1` |
| INPUT | IN-1~IN-11 | `G-INPUT-IN4` | UGT | R1~R10 | `G-UGT-R2` |
| REPEAT | R1~R9(규칙) / 결정 1~8 | `G-REPEAT-R7` / `G-REPEAT-D1` | HANDOFF | H1~H8 | `G-HANDOFF-H1` |
| SAVE | R1~R19 | `G-SAVE-R13` | POWER | R1~R15 | `G-POWER-R8` |
| OUTAGE | R1~R14(규칙) / B1~B5(배너) | `G-OUTAGE-R4` / `G-OUTAGE-B5` | HELP | H1~H5·E1~E6·A1~A4·D1~D8·S1~S6 | `G-HELP-E3` |
| INTER | R-DL·R-NT·R-CF·R-FC·R-MO | `G-INTER-DL6`, `G-INTER-NT7` | | | |

### 5.1 `G-ENGINE` — 웹뷰 엔진 하한(gap-webview-engine-baseline.md §7.1)

| ID | 규칙 | 시스템에서 |
|---|---|---|
| G-ENGINE-R1 | CSS·DOM은 Safari 16.4 / Chromium 111 / WebKitGTK 2.40에서 같은 모습으로 동작한다(Vite 8 기본 대상과 같다) | D1 |
| G-ENGINE-R2 | 하한 밖 기능은 쓰지 않는다. 쓰려면 먼저 이 규칙 문서를 바꾼다 | D1, foundations §11 금지 목록(`design-lint`) |
| G-ENGINE-R3 | 하한 밖 기능을 보강으로 쓸 때는 그것이 없을 때의 화면이 이미 완성돼 있어야 한다 | foundations §11은 보강조차 두지 않는다(`text-wrap: balance` 장식도 금지, foundations §12-8) |
| G-ENGINE-R4 | 색 토큰은 sRGB hex로 커밋, OKLCH는 설계·검증용, 파생 색은 `color-mix()`, 상대 색 문법·`light-dark()` 금지 | D3 |
| G-ENGINE-R5 | 라이트·다크는 토큰 두 벌, 컴포넌트는 값을 직접 쓰지 않는다 | D3·D7, foundations §10 |
| G-ENGINE-R6 | 시스템 글꼴 스택에 OS별 한글 글꼴 명시, 줄 높이 `normal` 금지, 늘어나는 숫자는 `tabular-nums`, `-webkit-font-smoothing` 설정 안 함 | D13~D15, foundations §3.1·§3.4. 줄 높이는 "단위 없는 숫자" 대신 px 토큰(foundations §12-1) |
| G-ENGINE-R7 | `backdrop-filter`·반투명은 불투명 바탕 위의 장식으로만 | foundations §6.3(블러 금지로 더 좁힘) |
| G-ENGINE-R8 | 컨트롤은 직접 그린다. `accent-color`·`appearance: base-select`·`popover`·기본 폼 컨트롤 모양에 의존하지 않고 대화상자는 `<dialog>` | foundations §11, components.md Dialog |
| G-ENGINE-R9 | macOS `minimumSystemVersion`은 Safari 16.4를 보장하는 13.3 | D1 |
| G-ENGINE-R10 | 시작 때 하한 기능이 없으면 한국어로 알리고 시스템 업데이트를 안내한다 | D1 "미달 엔진은 시작 때 알린다", platform.md |

보고서의 강제 제안(E1~E7): `baseline.json` 일치 검사, 빌드 CSS 금지 목록 vitest, 색 리터럴 검사, 런타임 `CSS.supports` 프로브를 `--smoke` 마커에, CI에 ubuntu 22.04 컨테이너 smoke, 3 OS 스크린샷 비교. 닫히지 않은 것은 Q25.

### 5.2 `G-SHELL` — 네이티브 느낌·셸(gap-webview-native-feel-shell.md §3.1·§7)

하드닝 표 H1~H13:

| ID | 항목 | 결정 | 시스템에서 |
|---|---|---|---|
| G-SHELL-H1 | 컨텍스트 메뉴 | 끈다. 입력칸·편집 영역·`[data-native-menu]`는 남긴다. 어떤 기능의 유일한 경로가 될 수 없다 | platform.md |
| G-SHELL-H2 | 브라우저 단축키(새로고침·찾기·인쇄·F12·뒤로/앞으로) | 끈다. OS별 키 목록이 다르다. 편집·커서 키는 절대 막지 않는다 | platform.md(`E-DESK-N02`) |
| G-SHELL-H3 | 줌(단축키·휠·핀치) | 끈다. 글자 크기는 앱 설정으로만 | D28 |
| G-SHELL-H4 | `user-select` | 기본 끔. 값(오류 문구·경로·파일명·주소·해시·코드)만 `.selectable` | platform.md |
| G-SHELL-H5 | 커서 | 컨트롤 `default`, 진짜 URL만 `pointer`, 텍스트 입력 `text` | D25 |
| G-SHELL-H6 | 이미지·링크 끌기 | `draggable="false"` | platform.md |
| G-SHELL-H7 | 오버스크롤 | `html`·`body` none, 스크롤 영역 contain | **쓰지 않는다**(`X-DESK-E27`: Safari 16 partial, 실기 확인 전 규칙으로 두지 않음) |
| G-SHELL-H8 | 스크롤바 | OS 기본, Windows `fluentOverlay` | D27 |
| G-SHELL-H9 | 맞춤법·자동완성·자동 대문자 | URL·경로·파일명·쿠키 입력은 끈다 | components.md TextField(`G-IME-R10`) |
| G-SHELL-H10 | 창 드래그 영역 | 해당 없음(네이티브 타이틀바 유지) | D26 |
| G-SHELL-H11 | 포커스 링 | `:focus-visible`, 3:1 | D20 |
| G-SHELL-H12 | 링크 미리보기(macOS) | `allowLinkPreview: false` | platform.md |
| G-SHELL-H13 | 개발자 도구 | 릴리스에서 끈다(feature 없음) | `release-hygiene` |

규칙 문장 NS-1~NS-25:

| ID | 규칙 | 시스템에서 |
|---|---|---|
| G-SHELL-NS1 | 기본 컨텍스트 메뉴는 끄고 입력칸·`data-native-menu`만 남긴다 | = H1 |
| G-SHELL-NS2 | 새로고침·찾기·인쇄·개발자 도구·소스 보기·뒤로/앞으로는 릴리스에서 동작하지 않는다. 편집 키는 막지 않는다. 메뉴에 "새로고침"을 넣지 않는다 | = H2 |
| G-SHELL-NS3 | 웹 줌을 지원하지 않는다. 글자 크기는 앱 설정으로만 | D28 |
| G-SHELL-NS4 | 글자는 기본으로 선택되지 않고 복사해 쓸 값에만 `.selectable`. 선택 가능 여부는 CSS 한 곳 | = H4 |
| G-SHELL-NS5 | 컨트롤 `cursor: default`, 손가락은 외부 URL 링크만, 텍스트 입력·`.selectable`은 `text`. 웹 랜딩·관리 페이지는 대상 아님 | D25 |
| G-SHELL-NS6 | 앱의 `<img>`·`<a>`는 `draggable="false"`. 드롭으로 웹뷰가 이동하지 않는다 | platform.md |
| G-SHELL-NS7 | `html`·`body`는 스크롤하지 않고 `overscroll-behavior: none`, 안쪽 영역만 contain | **보류**(`X-DESK-E27`) |
| G-SHELL-NS8 | 스크롤바는 OS 기본. `::-webkit-scrollbar`·`scrollbar-width: none` 금지. Windows `fluentOverlay` | D27 |
| G-SHELL-NS9 | 주소·경로·파일명·쿠키 입력칸은 `spellcheck="false"` `autocomplete="off"`. 쿠키는 자동완성·자동저장 대상 아님 | components.md TextField |
| G-SHELL-NS10 | 창은 OS 기본 제목 표시줄. 직접 그리지 않는다 | D26 |
| G-SHELL-NS11 | 포커스 링은 키보드·스크립트 포커스에서만(`:focus-visible`), 대비 3:1 이상 | D20 |
| G-SHELL-NS12 | 릴리스 빌드에 `devtools` feature 없음 | `release-hygiene` |
| G-SHELL-NS13 | macOS 메뉴 막대는 `{앱 이름} · 파일 · 편집 · 보기 · 윈도우 · 도움말`, Apple 한국어 이름, 앱 메뉴에 `설정…(⌘,)` | platform.md(`E-DESK-N23`·`N27`) |
| G-SHELL-NS14 | `⌘Q`는 `request_quit`로 받는 중이면 확인. Dock 종료·로그아웃은 이 확인을 지나칠 수 있고 데이터는 저장된다 | platform.md |
| G-SHELL-NS15 | Windows·Linux에는 메뉴 막대를 두지 않는다. 메뉴에만 있는 기능은 없다 | platform.md |
| G-SHELL-NS16 | 메뉴 항목은 화면 안에도 같은 길이 있다 | platform.md |
| G-SHELL-NS17 | 받는 작업이 있으면 작업 표시줄·Dock에 전체 진행률(바이트 합 기준 정수 퍼센트, 배치 안 단조), 퍼센트가 바뀔 때 초당 최대 1회 | D29 |
| G-SHELL-NS18 | 받는 중 일반, 일시정지·중단만 남으면 노랑, 실패로 끝났고 포커스 없으면 빨강, 포커스 오면 지움. Linux는 색 구분 없음 | D29(`E-DESK-N31`·`N32`) |
| G-SHELL-NS19 | v1은 Dock·작업 표시줄 배지를 쓰지 않는다 | D29 |
| G-SHELL-NS20 | 알림은 창에 포커스가 없을 때만. 있으면 토스트·목록 | D38 |
| G-SHELL-NS21 | 알림 제목에 앱 이름 없음, 20자 이내 해요체 한 문장, 끝 구두점 없음, 본문은 영상 제목 24자 절단 + 원인 한 줄 | D38은 **40자소**[취향](`X-DESK-N45`, ADR-0002) |
| G-SHELL-NS22 | 3초 안에 끝난 작업은 알림 한 건으로 묶고 `{N}개`, 주의 요청도 묶음당 한 번 | D38 묶음 "{첫 제목} 외 {N−1}개". 3초는 보고서 선택(`X-DESK-N45`) |
| G-SHELL-NS23 | 알림에 채널 이름·경로·주소·쿠키·토큰·원문 오류를 넣지 않는다 | D38 |
| G-SHELL-NS24 | 알림을 누르면 앱 창이 앞으로. 특정 작업 이동은 약속하지 않는다 | platform.md(`E-DESK-N37`) |
| G-SHELL-NS25 | 알림은 보조 신호다. Dock 진행·주의 요청·목록 상태가 늘 함께 있다. 권한 요청은 처음 받기 시작 때. 서명 없는 macOS 설치본에서 알림이 뜨는지 릴리스 전 확인 | D38, Q11 |

보고서가 새로 드러낸 빈 부분 G1~G15와 실측 필요 11항목은 Q16.

### 5.3 `G-LAUNCH` — 첫 창·체감 성능(gap-launch-perceived-performance.md §7)

| ID | 규칙 | 시스템에서 |
|---|---|---|
| G-LAUNCH-R1 | 사용자는 흰 창을 보지 않는다. 첫 화면이 그려진 뒤 창이 나타나고 첫 프레임부터 앱 배경색 | D30, foundations §10 첫 페인트 |
| G-LAUNCH-R2 | 창이 나타나기까지 안전장치 1.5초. 신호가 늦어도 창은 뜬다 | D30 "안전장치". 1.5초는 보고서 제안(`X-DESK-L34`) |
| G-LAUNCH-R3 | 첫 화면은 저장된 마지막 상태로 즉시 그린다. 네트워크·로그인 확인이 첫 그림을 막지 않는다 | patterns.md 로딩 |
| G-LAUNCH-R4 | 300ms 안에 끝나는 일에는 로딩 표시를 보이지 않고, 한 번 보인 표시는 400ms 이상 유지 | patterns.md 로딩 [잠정]. 300/400은 관행 수치(`E-DESK-L18`), 표준 아님 |
| G-LAUNCH-R5 | 1초 넘는 일에는 무엇을 하는지 보이고, 10초 넘으면 진행률과 취소 | T2, C5(`E-DESK-L09`) |
| G-LAUNCH-R6 | 클릭·키 입력에 100ms 안 시각 반응. 서버 응답을 기다리는 동작은 낙관적으로 먼저 바꾸고 실패하면 1초 안에 되돌리고 이유를 말한다 | patterns.md |
| G-LAUNCH-R7 | 진행률 이벤트는 코어에서 250ms 이상 간격, 화면은 프레임당 한 번 | D23(`E-DESK-L25`) |
| G-LAUNCH-R8 | 움직이는 막대는 `transform`·`opacity`만. 레이아웃·페인트 속성과 그림자 블러 애니메이션 금지 | D23(`transform: scaleX`), `design-lint` |
| G-LAUNCH-R9 | 메인 스레드 작업 50ms 이하, 100행 넘는 목록은 가상화 또는 DOM 제한 | D39(완료 11개 넘으면 접힘). 100행은 보고서 제안(`X-DESK-L34`) |
| G-LAUNCH-R10 | Linux 그래픽 환경변수는 증상이 확인된 경우에만 안내, 기본으로 켜지 않는다 | platform.md(`E-DESK-L31`) |
| G-LAUNCH-R11 | 콜드·웜 시작 시간과 첫 그림 시간을 릴리스마다 3 OS에서 기록하고 나빠지면 멈춘다 | governance.md(smoke 마커 + ratchet, 관찰 후 승격) |

### 5.4 `G-A11Y` — OS 접근성 설정(gap-os-accessibility-settings.md §3.4·§8)

| ID | 규칙 | 시스템에서 |
|---|---|---|
| G-A11Y-OS1 | 강제 색 모드에서 모든 상호작용 UI는 테두리·윤곽·시스템 색 키워드 중 하나로 경계를 가진다. 색·그림자만으로 경계·상태를 나타내지 않는다 | foundations §2.7 |
| G-A11Y-OS2 | 포커스는 `outline` 기본. `outline: none`·`outline: 0` 금지, `box-shadow`는 장식 | D20 |
| G-A11Y-OS3 | `forced-color-adjust: none` 금지. 시스템 색 키워드로 보정 | foundations §2.7(`design-lint` grep) |
| G-A11Y-OS4 | `GrayText`는 비활성에만. 보조 텍스트는 `CanvasText` | foundations §2.7 |
| G-A11Y-OS5 | 아이콘은 `currentColor`. 고정 `fill`·`stroke` 색 금지 | D32, `design-icons` |
| G-A11Y-OS6 | 진행 막대는 강제 모드에서 `1px CanvasText` 트랙 + `Highlight` 채움. 멈춤·실패는 형태(속 빈 채움)와 글자로 | D23, foundations §2.7 |
| G-A11Y-OS7 | `prefers-contrast: more`에서 보조 텍스트·경계가 본문 수준으로 진해진다. `forced-colors`와 독립 | foundations §2.5 |
| G-A11Y-OS8 | 투명·블러는 불투명 위의 장식. `prefers-reduced-transparency`가 WebKit에 없다 | foundations §6.3 |
| G-A11Y-OS9 | 모든 움직임은 `prefers-reduced-motion: reduce`에서 멈춘다. 상태는 모션 없이도 전달 | D22(1ms, 피드백·opacity는 남김으로 세분) |
| G-A11Y-OS10 | 앱 안에 "밝게/어둡게/시스템" 선택을 둔다. 리눅스는 감지 실패 전제 | D7은 **Linux에서만** 선택(HIG 앱별 외관 설정 금지가 이긴다) |
| G-A11Y-OS11 | 글자·간격은 `rem`, 320px 폭에서 가로 스크롤 없음, 고정 px 높이로 글자를 가두지 않는다 | **뒤집음**: D4 모든 토큰 px(`A-VIS-01` 재발 방지), 글자 확대는 D28 설정이 글자 토큰만 재정의. 리플로우 320은 유지(`E-A11Y-A70`) |
| G-A11Y-OS12 | `zoomHotkeysEnabled: true` + macOS·Linux `allow-set-webview-zoom` | **뒤집음**: D28 웹뷰 줌 끔 + 앱 안 글자 크기 설정(g-shell H3: Ctrl+±는 실수로 화면이 깨진다) |
| G-A11Y-OS13 | 진행 막대는 `aria-label`·`aria-valuetext`를 항상 가진다. 불확정이면 `aria-valuenow` 생략. 단위는 한글로 풀어 쓴다 | components.md ProgressBar(`E-A11Y-A25`) |
| G-A11Y-OS14 | 매 진행 틱을 `aria-live`로 말하지 않는다. 상태 전이만 `polite` 한 영역에서 한 번 | components.md, brief §6.9-4 |
| G-A11Y-OS15 | 모달이 열리면 배경은 `inert` 또는 `<dialog>` `showModal()`로 막힌다. 닫으면 여는 요소로 포커스 | components.md Dialog |
| G-A11Y-OS16 | 세 엔진에서 따로 확인한다. 한 엔진의 합격이 다른 엔진의 합격이 아니다 | governance.md 릴리스 수동 검수표 |
| G-A11Y-HC1~HC6 | CSS 후보: 포커스 `outline: 2px solid transparent` + 강제 모드 `CanvasText`(HC1), 진행 트랙·채움·속 빈 채움(HC3), 배지·칩·입력 1px(HC4), 대화상자·메뉴 2px(HC6). 네 테마에서 눈으로 확인한 뒤 확정 | foundations §2.7 매핑 표가 이어받았다. HC1의 투명 outline 대신 D20은 불투명 `--accent-ink` outline(forced에서 UA가 시스템 색으로 그림) |

### 5.5 `G-SCALE` — 배율·선·글꼴 렌더(gap-display-scaling-hairline-rendering.md §7)

| ID | 규칙 | 시스템에서 |
|---|---|---|
| G-SCALE-1 | 테두리·구분선 굵기는 1px·2px뿐. 0.5·1.5·소수 금지 | D19, foundations §6.2(`E-A11Y-D01`·`D05`) |
| G-SCALE-2 | 경계는 `border`·`outline`으로만. box-shadow 링·gradient·SVG 선·`transform: scale` 선 금지 | D20, foundations §6.2(`E-A11Y-D08`) |
| G-SCALE-3 | 의미 경계는 인접 모든 바탕에 3:1 이상, 목표 3.5:1. 굵기로 보충하지 않는다 | D19 ≥ 3:1(8쌍). **3.5:1 목표는 [수치 제안]**(brief §4.3)이라 쓰지 않았다 |
| G-SCALE-4 | 구분선은 의미를 단독 전달하지 않는다 | foundations §6.2 장식선 |
| G-SCALE-5 | 포커스는 `outline`(2px, offset 2) | D20 |
| G-SCALE-6 | 레이아웃은 테두리 두께를 가정하지 않는다. `box-sizing: border-box`, `calc(N - 1px)` 금지 | foundations §6.2(`E-A11Y-D03`) |
| G-SCALE-7 | 글자 있는 요소에 정지 `transform`·`will-change: transform`·소수 `translate` 금지. 가운데 정렬은 flex/grid | foundations §6.2(`E-A11Y-D21`) |
| G-SCALE-8 | 글자 하한 12px, 11px 이하 금지, 12px 단독 의미 금지. 본문 14, 보조 13 | 하한 12는 D12. **본문은 D11 13**(보고서 14와 다름, 사용자 결정 4) |
| G-SCALE-9 | 한글 굵기는 400·600 두 단계. 500은 맑은 고딕에서 400과 같아지므로 위계에 쓰지 않는다 | D13. "500→400 합쳐짐"은 추론(`X-A11Y-D28`), 두 단계 결정의 근거는 안전성 |
| G-SCALE-10 | 상태는 색만으로 구분하지 않는다. 색 쌍 ΔE2000 15 이상 목표 | 세 겹 규칙은 유지. **ΔE 15는 [수치 제안]**, 토큰 검사에 넣지 않았다(README §6-7 묶음 밖, 필요하면 ADR) |
| G-SCALE-11 | 시각 QA는 Windows 125·150·100%, macOS 2x, Ubuntu 100% 필수. 배율은 `--force-device-scale-factor`로 | D61(`E-A11Y-D04`), governance.md |

보고서 §5.1 토큰 제안(`--bw-1`·`--bw-2`)은 이름을 받지 않았다. foundations §6.2가 "1px·2px 리터럴만 허용"으로 같은 효과를 낸다.

### 5.6 `G-UNITS` — 숫자·단위·날짜(gap-units-number-date-format.md §8)

| ID | 규칙 | 시스템에서 |
|---|---|---|
| G-UNITS-1 | 크기는 사용자 OS의 파일 관리자와 같게 센다(Windows 1024, macOS·Linux 1000). 라벨은 KB·MB·GB, KiB·GiB 금지 | D47, ADR-0006. Windows 탐색기 진법은 **[미확인]**(Q10) |
| G-UNITS-2 | 한 화면의 모든 크기·속도는 같은 진법, 한 함수. 비교는 바이트 정수로 | D47 |
| G-UNITS-3 | 완료 크기 유효숫자 3자리(`7.82GB`), 진행 중 소수 1자리(`2.3GB / 4.0GB`), 예상값에 `약` | D47 |
| G-UNITS-4 | 속도는 `MB/s`만. `Mbps` 금지 | D47 |
| G-UNITS-5 | 숫자와 라틴 단위는 붙인다(`7.8GB`, `58%`). 한글 단위도 붙이고(`3개`) 두 단위가 이어지면 띄운다(`2분 18초`). 큰 수는 쉼표, `만`·`억` 금지 | D48(`E-A11Y-U14`·`U25`). 국립국어원은 라틴 단위를 다루지 않는다(`X-KO-A7`) |
| G-UNITS-6 | 퍼센트는 정수로 내리고, 완료 전 100% 금지, 줄어들지 않는다 | D23, D50 |
| G-UNITS-7 | 남은 시간은 거칠게: `남은 시간 계산 중` → `약 14분 남음`, 초 단위 없음, 1초 1회 갱신 | D50(`E-A11Y-U15`). 1초 갱신은 [취향] |
| G-UNITS-8 | 영상 길이는 `3:12:45`, 남은·걸린 시간은 한글 단위. 서로 바꿔 쓰지 않는다 | D50 |
| G-UNITS-9 | 날짜 `2026. 10. 9.`, 시각 `오후 3:20`(12시간), 올해는 연도 생략, 어제, 상대 시각은 방금·N분 전·N시간 전, 요일 없음 | D49(`E-A11Y-U19`·`U27`) |
| G-UNITS-10 | API 날짜(KST)는 시간대를 옮기지 않고 그대로 | D49 |
| G-UNITS-11 | 크기·속도·남은 시간·퍼센트는 우리 함수가 만든다. `Intl` 단위 서식·`RelativeTimeFormat`·`DurationFormat`에 기대지 않는다 | D47~D50(`E-A11Y-U19`: `현재 분`, Node에 `DurationFormat` 없음) |

### 5.7 `G-IME` — 텍스트 입력·IME·클립보드·드롭(gap-text-input-ime-clipboard-drop.md §8)

| ID | 규칙 | 시스템에서 |
|---|---|---|
| G-IME-R1 | 붙여넣기·입력칸 밖 Mod+V·클립보드 제안·드롭·직접 입력은 하나의 주소 추출기(Rust)를 거친다. TS는 같은 골든으로 검증되는 미러 | platform.md, `A-IME-1` |
| G-IME-R2 | 글에서 주소를 찾을 때 앞뒤 글·줄바꿈·전각 공백·제로폭·괄호·따옴표·끝 구두점·조사를 견딘다. 코어가 거부하는 것은 추출기도 받지 않는다 | platform.md(`E-A11Y-T43`) |
| G-IME-R3 | 타이핑 중 오류 없음. 제출·붙여넣기·드롭에서 한 번만 검증, 오류는 입력칸 가까이 `role="alert"`. IME 조합 중 값 읽기·덮어쓰기·`select()` 금지. Enter는 `<form>` 제출 | content.md 오류 시점, components.md TextField. NN/g "필드를 벗어난 직후"와는 우리 선택(`X-A11Y-T36`) |
| G-IME-R4 | 창·문서·입력칸 keydown은 첫 줄에서 `isComposing || keyCode === 229`면 반환. `isComposing`만 쓰지 않는다 | platform.md IME(`E-A11Y-T01`·`T04`) |
| G-IME-R5 | 한글을 받는 칸(파일 이름)은 Enter에 동작을 달지 않고 Mod+Enter도 R4를 따른다. 값은 `el.value` | components.md |
| G-IME-R6 | 클립보드 자동 읽기는 macOS 15.4+에서 `accessBehavior == alwaysAllow`일 때만, Rust command 안에서만, 주소가 아니면 아무것도 보이지 않는다 | D56(`E-A11Y-T13`) |
| G-IME-R7 | JS에 클립보드 플러그인 권한 없음. 쓰기는 사용자 제스처 안. 붙여넣기는 `paste` 이벤트의 `clipboardData`만 | platform.md |
| G-IME-R8 | 드래그 중에는 종류(`text/uri-list`·`text/plain`, `Files` 없음)로만 면을 띄우고 `drop`에서 합쳐 추출. 창 안 끌기는 받지 않음 | platform.md 드롭(`E-A11Y-T29`) |
| G-IME-R9 | `dragDropEnabled: false` 유지. Tauri·wry 올릴 때 3 OS 드롭 스모크 반복 | platform.md(`E-A11Y-A21`) |
| G-IME-R10 | 주소·파일 이름·쿠키 입력은 `autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off"`, `type="text"` | components.md TextField(`E-A11Y-T33`) |
| G-IME-R11 | macOS 기본 편집 메뉴(잘라내기·복사·붙여넣기·전체 선택)를 지우지 않는다 | platform.md 메뉴 |

### 5.8 `G-INPUT` — 터치·펜·트랙패드(gap-input-modality-touch-pen-trackpad.md §10)

| ID | 규칙 | 시스템에서 |
|---|---|---|
| G-INPUT-IN1 | hover는 장식 피드백. 정보·동작을 hover로만 드러내지 않는다. 숨겨진 행 동작 패턴 금지 | D21, `design-lint`(`:hover`가 `display`·`visibility`·`opacity`·크기를 바꾸면 실패) |
| G-INPUT-IN2 | 잘리거나 아이콘만 있는 정보는 `title`에만 두지 않는다 | `design-lint` `title=` 허용 목록, foundations §3.5 |
| G-INPUT-IN3 | 모든 대화형 컨트롤은 어떤 입력에서도 24×24 CSS px 이상 | `--hit-min` 24(foundations §5.1), `design-gallery` |
| G-INPUT-IN4 | `(any-pointer: coarse)`면 행 안 동작 40×40 이상, 주 컨트롤 44 이상, 간격 8 이상. 크기는 한 번 정하고 쓰는 중 바꾸지 않는다 | D16 터치 40/40/44(foundations §12-5), `design-gallery` `touch-laptop` |
| G-INPUT-IN5 | 크기·간격 토큰은 px 고정, root 글자 크기 비연동. 터치 값은 `tokens.css`의 `@media (any-pointer: coarse)` 블록 한 곳 | D4, foundations §5.1 |
| G-INPUT-IN6 | 터치 분기는 `any-pointer: coarse`만. `hover: none`·`pointer: coarse` 분기 금지. hover 대안은 항상 켠다 | foundations §5.1 |
| G-INPUT-IN7 | 모든 대화형 컨트롤에 `:active`. hover가 상태(오류 테두리)를 덮지 않는다 | D21(`A-PRIM-T1` 해소) |
| G-INPUT-IN8 | 길게 누르기·보조 클릭은 `contextmenu`로 다루고 입력칸은 기본 메뉴를 남긴다 | = `G-SHELL-H1` |
| G-INPUT-IN9 | 드래그 앤 드롭은 가속기. 같은 일을 하는 터치·키보드 경로가 항상 있다. 직접 만든 끌기는 손잡이에서만 | patterns.md |
| G-INPUT-IN10 | 한 손가락·관성 스크롤은 브라우저에 맡기고 줌·스와이프 내비는 끈다. 시스템 제스처는 재정의하지 않는다 | platform.md, `design-lint`(`wheel`·`gesturestart`·`webkitmouseforce*` 리스너 금지) |
| G-INPUT-IN11 | 입력 방식 판단은 CSS 미디어 쿼리로. 시작 시 JS 값을 레이아웃에 쓰지 않는다 | `design-lint`(`matchMedia('(pointer`·`maxTouchPoints` 금지) |

보고서 §9.1의 토큰 제안(마우스 `--control-h` 36/28, `--row-h` 32)은 **값을 받지 않았다**. D16은 AppKit 실측 24/28/36(`E-APPLE-19`)을 쓴다. 터치 값(40/44·간격 8)만 받았다. 터치 노트북 보유율 자료는 없다(Q19).

### 5.9 `G-ICON` — 아이콘 세트·굵기·은유(gap-icon-set-license-metaphor.md §8.1)

| ID | 규칙 | 시스템에서 |
|---|---|---|
| G-ICON-1 | 아이콘은 오픈 라이선스 세트 하나(Lucide)에서만. SF Symbols·Segoe Fluent Icons·토스·네이버 폐쇄형은 파일도 따라 그린 path도 금지 | D31(`E-ID-K01`) |
| G-ICON-2 | 고정 버전에서 필요한 path만 `icons.ts`에 벤더링, 항목마다 `{set, name, version}`, 라이선스 전문은 앱 정보·`/licenses` | D31, `design-icons` |
| G-ICON-3 | 크기는 16·20·32 세 단계 | **D32는 16·20 두 단계**(32 없음, 빈 상태에 아이콘을 두지 않는다) |
| G-ICON-4 | 선 굵기는 화면 px 고정(`non-scaling-stroke`), 16px=1.2, 20px=1.25~1.5, 32px=1.6, 1.0 미만·2.0 초과 금지 | **D32는 16·20 공통 1.5px [잠정]**(범위의 위쪽). Q4에서 16px 1.25로 내릴 수 있다(`E-ID-K27`·`K30`·`K32`) |
| G-ICON-5 | 서로 다른 동작은 서로 다른 모양: 이어받기 `play`, 다시 시도 `rotate-cw`, 닫기 `x`, 취소는 글자 필수, 오류 `circle-x`, 경고 `triangle-alert`, 정보 `info`, 성공 `circle-check`. 처음부터·링크 갱신·종류·성인에는 아이콘 없음 | foundations §9.1 은유 표(완료 행 아이콘은 `check`, 토스트는 `circle-check`) |
| G-ICON-6 | 글자 없는 아이콘 버튼은 허용 목록(`x`·`ellipsis`·`chevron-*`·`eye`·`eye-off`·`arrow-left`·`settings`)만, 모두 `aria-label`+툴팁. 데이터를 지우는 동작은 글자 필수 | D32 허용 목록 7종 |
| G-ICON-7 | "폴더에서 보기"는 모든 OS에서 `folder`, 라벨만 OS별. Finder·탐색기 로고 금지 | D39·D43(`X-ID-K40`: HIG 복제 문장은 근거가 아님, 상표 일반 규칙으로만) |
| G-ICON-8 | 아이콘 색은 `currentColor`. 이해에 필요한 아이콘은 3:1, 상태는 모양·글자 병용 | D32(`E-ID-K20`) |

### 5.10 `G-ID` — 상표·비공식 표기·앱 아이콘(gap-identity-trademark-icon.md §7)

| ID | 규칙 | 시스템에서 |
|---|---|---|
| G-ID-R1 | 비공식 도구임을 랜딩 첫 화면·앱 첫 실행·About에 같은 문장으로 밝힌다(`unofficialNotice` 상수 하나) | D34 고지 4곳, C2 |
| G-ID-R2 | 앱 이름은 `치지직 다운로더`. "공식·인증·파트너"를 이름·설명·알림에 쓰지 않는다 | D34, `design-copy` 금지어 |
| G-ID-R3 | 치지직·NAVER 로고·브랜드 색(`#03C75A` 포함)·글꼴·화면 캡처를 앱·랜딩·og·아이콘에 쓰지 않는다 | C1, `design-tokens` HSL 스캔 |
| G-ID-R4 | "치지직"은 평문 설명으로만. 로고체·워드마크·아이콘 안 글자로 쓰지 않는다 | D33(글자 없음), D34 |
| G-ID-R5 | 표시 이름 `치지직 다운로더`(한글), 파일·URL·패키지 이름 `chzzk-downloader`(ASCII). 한 곳에서 파생 | platform.md, `tauri-conf.test` |
| G-ID-R6 | 아이콘은 전경 레이어와 전면 배경 레이어로 만들고 마스크는 도구·시스템이 씌운다 | D33 조건 |
| G-ID-R7 | `.ico` 16·20·24·30·32·36·40·48·64·96·256, `.icns` 10개, Linux PNG 8종 + scalable SVG | D33(`E-ID-I28`~`I35`·`I39`) |
| G-ID-R8 | 아이콘은 16·24·32px, 라이트·다크, 흑백에서 읽히고 플레이트 대비 3:1 이상 | D33(`E-ID-I37`: 다크 작업 표시줄 2.98 경계) |
| G-ID-R9 | macOS 26용 `.icon` → `Assets.car` + `CFBundleIconName`, 구형 `icon.icns` 유지. 컴파일 결과를 저장소에 커밋하는 쪽이 안전 | D33 과제(`E-ID-I26`), Q22 |
| G-ID-R10 | 랜딩은 `favicon.ico`(32)·`icon.svg`·`apple-touch-icon`(180)·`og:image`(1200×630, alt). og에 로고·캡처·채널명 없음 | D53, web.md(`E-ID-I41`) |
| G-ID-R11 | 스토어에 올리면 이름 30자 이하·비제휴 명시·서비스 아이콘 불사용. App Store는 5.2.3상 대상 아님 | governance.md 개명 트리거(`E-ID-I04`) |
| G-ID-R12 | 개명 트리거가 일어나면 이름을 B안으로 바꾸고 한 곳에서 파생 | governance.md, Q9 |

보고서 §3의 비공식 고지 문구 후보는 content.md가 골라 D34 상수로 썼다. §2.1 개명 결정표는 governance.md "개명 트리거"다.

### 5.11 `G-INSTALL` — 설치·업데이트·제거(gap-install-update-lifecycle.md §8)

| ID | 규칙 | 시스템에서 |
|---|---|---|
| G-INSTALL-R1 | 다운로드 버튼 바로 아래 "처음 열 때 경고가 나올 수 있어요. 앱이 문제라는 뜻이 아니에요." | D53, web.md |
| G-INSTALL-R2 | 설치 안내 한 단계는 한 동작. macOS 안내는 3단계 이하 | web.md, `design-copy` |
| G-INSTALL-R3 | 감지한 OS의 안내를 펼치고 다른 OS는 접는다 | D53(`G-WEB-R5` 제약: 감지 실패면 모두 보인다) |
| G-INSTALL-R4 | 버튼·메뉴 이름은 Apple·Microsoft 공식 한국어. 경고 원문은 옮기지 않고 뜻으로 | content.md(`E-ID-L04`) |
| G-INSTALL-R5 | 경고 이유는 "서명·공증을 아직 받지 않았다"로 사실대로. 확인 안 된 것을 단정하지 않는다 | D55, content.md |
| G-INSTALL-R6 | "응용 프로그램으로 옮기기"에 "업데이트가 되려면 필요해요" 이유를 붙인다 | web.md(`E-ID-L12`) |
| G-INSTALL-R7 | 관리자 권한이 필요할 수 있는 형식(.msi·.deb)에 "관리자 권한이 필요할 수 있어요" | web.md(`E-ID-L21`) |
| G-INSTALL-R8 | AppImage 안내에 실행 권한과 libfuse2 한 줄 | D53(`E-ID-L26`), `E-ID-L46`(현재 없음) |
| G-INSTALL-R9 | 새 버전 알림은 앱 안 배너. 창을 띄우거나 포커스를 가져가지 않는다. 설치는 [업데이트하고 다시 시작]을 눌러야 | D37·D57, patterns.md |
| G-INSTALL-R10 | 업데이트 문구는 "새 버전"과 "다시 시작"만. 받는 중이면 일시정지·이어받기 가능을 말하되 단정하지 않는다 | content.md |
| G-INSTALL-R11 | 업데이트 실패는 원인 한 줄 + "지금 버전은 계속 쓸 수 있어요" | D57 |
| G-INSTALL-R12 | 버전은 `0.1.2`(v 없음). 코어 버전은 비기술 사용자 화면에 두지 않는다 | D57(`E-ID-L39`) |
| G-INSTALL-R13 | 제거 전 로그아웃 안내, 남는 폴더 경로를 OS별로, 받은 영상 폴더는 지우라고 하지 않는다 | platform.md(`E-ID-L41`) |
| G-INSTALL-R14 | 설치 안내를 바꾸면 실기기로 끝까지 통과한 날짜·OS 버전을 설계 문서에 적는다 | governance.md 릴리스 체크리스트 |

보고서 §8의 검증 10항목 중 사람이 하는 것(ad-hoc 실기, SAC 두 대, 제거 잔여, 랜딩 실사용 시험)은 Q11·Q3.

### 5.12 `G-PRIVACY` — 민감 입력·로그인·개인정보·지원(gap-privacy-consent-support.md §7·§8)

규칙 R1~R23:

| ID | 규칙 | 시스템에서 |
|---|---|---|
| G-PRIVACY-R1 | 비밀값 입력 칸은 사용자가 스스로 연 설정·오류 카드 단추에서만. 토스트·배너·팝업·창 시작 때 나타나지 않는다 | C7, patterns.md 설정 |
| G-PRIVACY-R2 | 터미널 명령·보안 경고 넘기기 단계는 무엇을 하는지 한 줄 설명을 앞에 두고 우리 랜딩 출처로만. 개발자 도구 콘솔에 붙여넣으라고 하지 않는다 | D52(xattr 블록 문구) |
| G-PRIVACY-R3 | 쿠키 값 안내는 "복사만", 입력하는 곳은 이 앱의 칸 하나뿐 | content.md |
| G-PRIVACY-R4 | 비밀값을 받는 화면은 같은 자리에 (1) 왜 (2) 어디에 저장·어디로 가나 (3) 값의 힘 (4) 요청자는 사기 (5) 지우는 방법 | C7, brief §6.14-6, patterns.md 설정(`SecretNotice`) |
| G-PRIVACY-R5 | 네이버 쿠키는 치지직·네이버 요청에만. Worker 요청·로그·진단·`jobs.json`·오류에 실리지 않는다 | CLAUDE.md 비밀값 규칙, `rust` 카나리 테스트 |
| G-PRIVACY-R6 | 로그인은 외부 브라우저에서만. 앱 안에 로그인 창을 만들지 않는다 | patterns.md 로그인 |
| G-PRIVACY-R7 | 루프백 수신기는 `127.0.0.1`·`[::1]`만, `localhost` 금지. Worker는 루프백 IP 외로 리디렉션하지 않는다 | worker.md(루프백 결정). 구현(v0.3.0)은 `127.0.0.1`(IPv4)만 연다(`worker.md` 구현 중 변경 88 (나)·(마), Worker `LOOPBACK_HOST`) |
| G-PRIVACY-R8 | 일회용 grant는 짧게, 앱 비밀을 가진 쪽만 교환, 폴링 경로는 남기지 않는다 | worker.md. 구현(v0.3.0): grant 2분·`/auth/redeem` 수령, `/auth/poll`은 아무것도 수령하지 않는 404 비석으로만 남았다(옛 앱 안내용, `worker.md` 구현 중 변경 88 (가)) |
| G-PRIVACY-R9 | 로그인 화면은 브라우저가 열린다는 것·비밀번호는 브라우저에서만·앱이 받는 것은 채널 이름·ID를 말하고, 끝나면 어느 채널인지 보인다 | C7, README §6-12(로그인 첫 화면) |
| G-PRIVACY-R10 | 끊긴 사유를 모를 때는 누가 끊었는지 말하지 않는다. "관리자가 끊었어요"는 `RemovedFromAllowlist`에만 | content.md, `design-copy` |
| G-PRIVACY-R11 | 거부·취소·끊김 화면은 탓하지 않고, 다음 행동 하나, 받던 다운로드가 계속된다는 것을 말한다 | C8, patterns.md 거부 |
| G-PRIVACY-R12 | 진단 복사는 허용 목록으로. 자유 텍스트는 `message` 하나만 마스킹 | D51, `report.test` |
| G-PRIVACY-R13 | 진단 복사는 복사 전에 미리보기 | D51 |
| G-PRIVACY-R14 | 로그 위치는 문구가 아니라 버튼으로 연다 | content.md(`Library/Logs`·`AppData`·`.config` 문자열 금지) |
| G-PRIVACY-R15 | 유출 통지문 틀을 미리 문서로 두고 처리방침 연락처와 같은 곳 | governance.md 운영 |
| G-PRIVACY-R16 | 관리자는 쿠키·토큰·비밀번호를 요청하지 않고, 받은 로그는 문제를 푼 뒤 지운다 | web.md "막히면" 절, content.md |
| G-PRIVACY-R17 | 로그인 버튼이 있는 모든 화면은 그 위에 수집 항목·목적·보유 기간·필수·처리방침 링크 | C2·C7, web.md, README §6-12 |
| G-PRIVACY-R18 | 보관 기간을 적은 데이터는 시간 기준으로 지워진다. 행 수 상한만으로 기간을 약속하지 않는다 | worker.md(`G-PRIVACY-G2`) |
| G-PRIVACY-R19 | 허가를 거두거나 삭제 요청이 오면 채널 이름·ID가 모든 표에서 사라지거나 비워진다 | worker.md |
| G-PRIVACY-R20 | 처리방침은 코드의 보관 상수와 같은 표를 쓰고 어긋나면 CI가 알린다 | web.md `/privacy`, `worker` |
| G-PRIVACY-R21 | 앱이 로그인 서버로 보내는 정보는 앱 버전·OS·채널 판정 필요분만 | worker.md |
| G-PRIVACY-R22 | "로그인 정보"는 네이버 쿠키만. 앱 로그인 상태는 "로그인"·"계정" | D43(`A-COPY-P0-4`) |
| G-PRIVACY-R23 | "쿠키"는 설정 › 네이버 로그인 정보 도움말과 처리방침 두 곳에만 | D43, `design-copy` 허용 목록 |

빈 부분 G1~G14(보고서 §7)는 격차이지 규칙이 아니다. 시스템이 받은 것: G1 랜딩 터미널 명령 안내(→ D52 문구), G4 `/privacy` 없음(→ D53·web.md, §4 P0), G5 로그인 전 수집 고지 없음(→ R17, README §6-12), G6 평문 저장과 HIG 충돌(→ 고지 문구를 사실대로, core.md 결정 15), G9 관리자 사칭(→ R16), G13 허가 취소 지연(→ web.md [빼기] 확인 문구). G2·G3·G7·G8·G10·G11·G12·G14는 worker.md·운영 과제(Q21).

### 5.13 `G-WEB` — 웹 진입 맥락·무스크립트 폼(gap-web-entry-context-mobile-inapp-nojs.md §6)

| ID | 규칙 | 시스템에서 |
|---|---|---|
| G-WEB-R1 | 휴대폰 판별은 `Sec-CH-UA-Mobile: ?1` 또는 UA `Mobi`만. OS 토큰으로 가르지 않는다. `entryContext` 순수 함수 하나 | D53, `worker` |
| G-WEB-R2 | 맥락 감지는 순서·강조만 바꾸고 선택지를 숨기거나 막지 않는다 | D53 "숨기지 않는다" |
| G-WEB-R3 | 휴대폰 랜딩 맨 위에 "컴퓨터용 앱이에요" 블록(설명·읽기 전용 주소 칸·보내는 방법 한 줄). JS 없이 서버가 그린다 | D53 |
| G-WEB-R4 | 휴대폰 안내에 QR·공유 버튼 없음 | D52 |
| G-WEB-R5 | OS별 표시는 g-install R3이 정하되, UA가 없거나 봇이면 단일 큰 버튼을 만들지 않고 모든 OS 행을 보인다. `<details>` 접기는 숨김이 아니다 | D53 |
| G-WEB-R6 | macOS 행에 "Apple Silicon(M1 이후) Mac만 지원해요" 상시. `Accept-CH` 아키텍처 요청 안 함 | D53 |
| G-WEB-R7 | UA별 HTML은 공유 캐시에 두지 않는다(`no-store`). 캐시하면 `Vary` | web.md |
| G-WEB-R8 | 인앱 판별 전 봇 판별(`kakaotalk-scrap`·`Discordbot`·`facebookexternalhit`). 인앱 토큰은 `KAKAOTALK`만 공개 근거 | web.md |
| G-WEB-R9 | 인앱에서도 로그인을 막지 않는다. `/auth/done` `failed`에만 기본 브라우저 안내 단락 | web.md |
| G-WEB-R10 | "외부 브라우저로 열기" 자동 전환은 공개 문서가 있는 방식만(LINE). 카카오 `openExternal` 금지 | web.md |
| G-WEB-R11 | `/`는 알 수 없는 쿼리를 무시하고 같은 응답 | web.md |
| G-WEB-R12 | 로그인 확인 페이지는 휴대폰·인앱에서도 [계속] 동작, 새 차단 추가 금지 | web.md |
| G-WEB-R13 | `/`에 Open Graph(title·type·url·description·image·image:alt), PNG/JPG, 인증 없이 200, 리디렉션 없음. 카카오 2:1 크롭 안전 영역 | D53(`E-ID-I41`) |
| G-WEB-R14 | OG 값은 로그인·채널·버전과 무관한 고정 문구, `og:description`은 비공식 고지 포함 부제 | D34·D53 |
| G-WEB-R15 | `/auth/*`·`/admin`·`/me/*`는 OG 없음, `X-Robots-Tag: noindex`, GET 부작용 없음 | web.md |
| G-WEB-R16 | OG 이미지를 바꾸면 해시 경로가 바뀌고 카카오 공유 디버거로 초기화 | web.md |
| G-WEB-R17 | 상태를 바꾸는 POST 성공은 303(PRG) | D54, web.md |
| G-WEB-R18 | 성공은 다음 GET에서 한 번 보이는 일회 알림(`__Host-cdl_flash` 60초, h1 앞, 하나, 자동으로 사라지지 않음) | D37·D54 |
| G-WEB-R19 | 검증 오류는 같은 페이지 400으로 다시 그리고 입력 보존, h1 앞 오류 요약 "확인해 주세요", `<title>` "오류: " 접두, `<main>` 첫 요소 | D54(`E-KO-32`) |
| G-WEB-R20 | 삭제·끊기는 멱등. 이미 처리됐으면 303 + "이미 처리됐어요" | D54 |
| G-WEB-R21 | 위험도 2단: (가) 즉시 실행 + 알림 (나) 되돌릴 수 없는 것(허용 빼기)만 확인 페이지 한 번. 대상은 경로로, 최종 버튼 하나만 `danger`, [취소]는 링크 | D54 |
| G-WEB-R22 | 중복 제출 방어는 서버가 한다 | web.md |
| G-WEB-R23 | 세션이 끝난 뒤 POST는 `303 /` + "로그인이 끝났어요…" 알림. 폼 값 보존 안 함 | web.md |
| G-WEB-R24 | 오류 화면은 `<title>` "오류: ", h1에 무슨 일, 본문에 할 일, 링크는 갈 곳 하나. 상태 코드 등 전문 용어 금지 | web.md(`A-WORKER-3.x` 해소) |
| G-WEB-R25 | 알림·오류 요약 위치 고정(`<main>` 첫 요소). 둘이 함께 나오지 않는다 | web.md |
| G-WEB-R26 | 버전·게시 날짜는 다운로드 버튼 곁(g-install R12), "필요한 환경" 한 줄은 빌드 설정에서 | D53·D57 |
| G-WEB-R27 | SHA-256은 "파일 확인(선택)" 접힘. 현재 주 표 열은 다르다 | D53 |
| G-WEB-R28 | 비공식 고지는 g-id 문구·위치를 쓰고 휴대폰 블록·OG 설명에서 빠지지 않는다 | D34 |

§6.6 문구 초안(해요체, 검증 전)은 content.md가 골랐다. 검증 V1~V6은 `worker` gate.

### 5.14 `G-LEGAL` — 오픈소스 고지·법적 페이지(gap-about-legal-oss-attribution.md §5·§6)

| ID | 규칙 | 시스템에서 |
|---|---|---|
| G-LEGAL-R1 | 모든 설치 파일에 제3자 저작권 고지·라이선스 전문. 앱 정보·설치 폴더 `licenses/`·웹 `/licenses` 세 곳이 같은 생성물 | D31, governance.md(`E-ID-A10`) |
| G-LEGAL-R2 | 고지 목록은 빌드 때 `Cargo.lock`·번들 패키지에서 만든다. 손으로 쓰는 것은 `legal/manual/`만 | governance.md |
| G-LEGAL-R3 | `A OR B`면 MIT를 고르고 고른 것을 적는다 | governance.md |
| G-LEGAL-R4 | 새 번들 에셋(아이콘·글꼴·이미지)은 같은 PR에서 출처·버전·라이선스 전문 | `R2`, `design-icons` |
| G-LEGAL-R5 | MPL-2.0 부품은 전문 + 소스 주소, 우리는 수정하지 않는다 | governance.md |
| G-LEGAL-R6 | 라이선스 파일 없는 crate는 빼지 않고 저작권자 줄을 수동 항목으로 | governance.md(`E-ID-A01`: 19개) |
| G-LEGAL-R7 | Apache-2.0은 사본 + NOTICE 합침 | governance.md |
| G-LEGAL-R8 | 정보 화면 필수 7요소: 앱 이름·버전·[정보 복사]·비공식 고지·개인정보 처리방침·오픈소스 라이선스·저작권 줄 | brief §6.14-4, patterns.md 설정 › 정보 |
| G-LEGAL-R9 | NOTICE 파일이 0개가 아니게 되면 빌드가 멈추고 사람이 위치를 정한다 | governance.md |
| G-LEGAL-R10 | Worker 배포 번들에 제3자 코드 없음 | `worker` gate |
| G-LEGAL-R11 | WebView2 설치 방식을 바꾸면 MS 라이선스 §2(b)를 먼저 확인 | `tauri-conf.test`(`E-ID-A23`) |
| G-LEGAL-R12 | AppImage는 묶는 라이브러리(LGPL 포함) 라이선스와 소스 제공 방법을 싣는다. 확인 못 하면 배포하지 않는다 | **D59 사람 결정 보류**, [계획] |
| G-LEGAL-R13 | 앱 안 외부 링크는 Rust 고정 주소 표 + 전용 command로만 | brief §6.14-8, platform.md |
| G-LEGAL-R14 | 정보 화면과 웹 바닥글의 법적 링크 세트·순서 동일. 고지·저작권 줄은 한 상수 | D34, `design-copy`(두 deck 동일) |
| G-LEGAL-R15 | 앱 라이선스는 `Cargo.toml`·`tauri.conf.json`·정보 화면·`/terms`가 같은 값. 지금은 "라이선스를 부여하지 않음" | **D58 사람 결정 보류** |
| G-LEGAL-R16 | 고지·처리방침 문구는 해요체, "공식·인증·파트너" 금지, 오류 문구에 법적 고지를 섞지 않는다 | `design-copy` |
| G-LEGAL-D1~D6 | 결정 표: D1 앱 라이선스(→ README D58) · D2 AppImage(→ D59) · D3 약관 페이지(→ D60, `/terms` 없음으로 시작) · D4 앱 안 목록은 시트 + 파일 둘 다 · D5 업데이트 확인 노출 항상(→ D57) · D6 `bundle.copyright`·`publisher` 값은 사람이 입력 | README D57~D60. D4·D6은 governance.md |

### 5.15 `G-EVID` — 근거 운영·사용자 시험(gap-design-validation-evidence-ops.md §8)

| ID | 규칙 | 시스템에서 |
|---|---|---|
| G-EVID-R1 | 흐름·화면 구성·핵심 문구를 바꾸는 결정은 ADR에 근거 등급(E0~E4). E3 미만만으로 영향 큰 결정을 "확정"이라 쓰지 않는다 | README §3-4·§7.2, §0.4 등급표 |
| G-EVID-R2 | 사용자 시험은 회당 3명(집단별 최소 3명), 두 회 이상, 한 번 돌린 뒤 고치고 다시 본다 | D62 |
| G-EVID-R3 | 소표본 결과는 "5명 중 N명"으로만. 성공률·SEQ·SUS는 판정 근거가 아니다. "발견하지 못함"은 "문제 없음"이 아니다 | README §7.2, D62 |
| G-EVID-R4 | 대본이 바뀌면 이전 회차와 합산하지 않는다. 힌트를 준 과업은 성공으로 세지 않는다 | governance.md 시험 기록 |
| G-EVID-R5 | 시험 기록에 이름·채널·제목·영상 번호·계정·인증 값을 적지 않는다. 화면 공유는 앱 창만, 녹화는 동의 때만, 14일 안에 삭제 | D62, `scan` |
| G-EVID-R6 | 텔레메트리는 만들지 않는다. 사용 빈도·이탈률 같은 계측 주장은 쓰지 않는다 | brief §6.15-3, governance.md |
| G-EVID-R7 | 새·바뀐 화면은 닐슨 10원칙 자체 점검, 심각도 3 이상은 다음 시험 과업 후보. 에이전트 평가는 E1을 넘지 못한다 | `R10`, 이 문서 §0.4 |
| G-EVID-R8 | 선호 테스트는 시각 취향을 좁힐 때만 | governance.md |
| G-EVID-R9 | 재검증 조건(화면·문구 변경, 새 OS, 같은 지점 문의 2건, 마지막 시험 후 12개월)이 생기면 다음 시험에 넣는다 | README §7.2 ADR 재검증 조건 |
| G-EVID-R10 | 릴리스 뒤 7일 안에 지인 2~3명에게 막힌 곳을 한 줄로 확인, 문의는 분류표에 | governance.md 운영 |

"3명 중 2명" 판정 기준(§5.3)은 보고서 제안이다(brief §4.3). README §6-5가 성공색 재검토 조건으로 그 값을 쓴다(ADR-0004에 우리 결정으로).

### 5.16 `G-UGT` — 외부 문자열 표시(gap-user-generated-text-rendering.md §7)

| ID | 규칙 | 시스템에서 |
|---|---|---|
| G-UGT-R1 | 외부 텍스트(영상 제목·채널 이름·클립 제목)는 `cleanDisplayText()`를 거친다. 직접 보간 금지 | brief §6.11-1, foundations §3.5, `rust`·`frontend` |
| G-UGT-R2 | `cleanDisplayText()`는 BIDI 서식(U+202A~202E, U+2066~2069)·LRM/RLM/ALM·제로폭·WJ·소프트하이픈·BOM·C0/C1·U+2028/2029를 지우거나 공백으로, ZWJ·ZWNJ·VS는 남긴다 | content.md 외부 문자열 위생 |
| G-UGT-R3 | 제목·채널 이름은 `<bdi>`로 격리 | foundations §3.5 |
| G-UGT-R4 | 말줄임은 CSS. JS로 자를 때는 `clipGraphemes()`만, `slice`·`substring`·`truncate_utf8` 금지 | content.md, D38 40자소 |
| G-UGT-R5 | 한 줄 말줄임은 `nowrap` + `overflow-wrap: normal`, 여러 줄은 `anywhere` + `keep-all`. `break-all`·`break-word` 금지 | foundations §3.5(해시·코드만 `break-all` 예외) |
| G-UGT-R6 | 글꼴 스택 끝에 이모지 글꼴 3종. OS마다 다르게 그려져도 줄 높이·레이아웃은 깨지지 않는다 | foundations §3.1 |
| G-UGT-R7 | 잘린 제목의 전체는 `title`에만 두지 않고 키보드·터치로도 닿는 곳에 | `G-INPUT-IN2` |
| G-UGT-R8 | 파일 이름도 같은 제거 + 자소 경계 자르기. 보이는 이름과 저장 이름이 다르면 알린다 | core 과제(`G-SAVE-R9`~`R11`) |
| G-UGT-R9 | OS 알림 본문은 정리한 제목 40자소까지, `<>&` 이스케이프. 창 제목에 외부 문자열 금지 | D38 |
| G-UGT-R10 | 위 규칙을 lint·테스트가 CI에서 막는다 | `design-lint`(`{@html}` 0개), `frontend` |

### 5.17 `G-REPEAT` — 반복 사용·기록(gap-repeat-use-archive-habit.md §9·§10)

| ID | 규칙 | 시스템에서 |
|---|---|---|
| G-REPEAT-R1 | 목록에서 지우기는 파일을 지우지 않는다. "목록에서만 지워요. 파일은 그대로예요" | D43(목록/파일 구분) |
| G-REPEAT-R2 | 완료·건너뜀 기록은 최근 100개, 넘으면 오래된 것부터 조용히 | D39 |
| G-REPEAT-R3 | 중단·일시정지·실패 항목은 앱이 지우지 않는다. 멈춘 지 30일 넘으면 차지하는 용량을 보인다 | D39 "{n}일 전에 멈췄어요 · 디스크 {size} 차지" |
| G-REPEAT-R4 | 같은 이름 파일 → "같은 이름의 파일이 이미 있어요", 같은 영상 기록 → "이미 받은 영상이에요". 기록만 있으면 막지 않고 안내 | patterns.md 영상 카드(B 후보 상태 어휘) |
| G-REPEAT-R5 | 완료 항목의 파일이 없으면 "완료 · 파일을 찾을 수 없어요" + [폴더 열기] [다시 받기]. 시작·포커스 때 확인 | D39, T4 |
| G-REPEAT-R6 | 기억된 화질·폴더로 카드를 미리 채운다. 반복 과업은 3번의 조작 안에 | T7, C4 |
| G-REPEAT-R7 | 보관 기한을 계산·단정하지 않는다. "올린 지 {n}일" 사실만 | D39(`X-ID-U31`), `design-copy`(만료·기한 임박 금지) |
| G-REPEAT-R8 | 바뀌는 정책 값(보관 기간)은 코드에 쓰지 않고 날짜와 함께 문서에만 | D39 |
| G-REPEAT-R9 | 100행 넘는 목록은 완료 그룹을 접어 DOM 제한. 11번째 완료부터 | D39 |
| G-REPEAT-D1~D8 | 결정 표: D1 보관 기한은 사실만(B) · D2 중복 판정은 파일 + 기록 보조 · D3 완료 상한 100 유지 · D4 오래 멈춘 항목은 가시화만 · D5 `missing`에 [다시 받기] 추가 · D6 포커스 때도 재확인 · D7 완료 그룹 11개부터 접힘 · D8 일괄 지우기는 되돌리기 토스트 5초 | D39·D37. D8의 5초는 보고서 제안 |

### 5.18 `G-HANDOFF` — 완료 후 재생·편집(gap-post-download-handoff-playback-editing.md §9)

| ID | 규칙 | 시스템에서 |
|---|---|---|
| G-HANDOFF-H1 | 완료 카드 기본 행동은 [폴더에서 보기], [열기]는 다음. 파일 없으면 [열기] 숨김 | **D39는 [열기] 다음 [Finder에서 보기]/[폴더에서 보기]**로 순서를 뒤집었다(세 후보 공통). 보고서 스스로 "근거 약함, 사용자 관찰로 검증". [열기] 숨김은 받았다 |
| G-HANDOFF-H2 | 완료 알림은 `'{제목}' 받기를 마쳤어요 · {크기}`, 제목 40자, 날짜·경로·채널 없음 | D38 제목 "다운로드를 마쳤어요" + 본문 제목 40자소[취향] |
| G-HANDOFF-H3 | "재생이 안 돼요" 도움말은 손상을 단정하지 않고 다른 플레이어를 먼저 | content.md 도움말(`design-copy` 금지어 "깨졌"·"손상") |
| G-HANDOFF-H4 | "소리가 밀려요" 도움말은 치지직 파일 VFR 확인 뒤에만 게시 | Q17 |
| G-HANDOFF-H5 | 코어는 재인코딩하지 않는다 | core.md |
| G-HANDOFF-H6 | 파일 구조 사실은 실서버 스모크에서 매번 기록(값은 내지 않는다) | nightly `drift` |
| G-HANDOFF-H7 | 파일 이름 날짜 머리 `YYMMDD`로 이름순 = 날짜순 | core naming |
| G-HANDOFF-H8 | 도움말은 외부 도구 이름을 그대로, 공식 문서 없는 프로그램은 "권해요" 이상 단정 금지 | content.md 도움말 문체 |

### 5.19 `G-SAVE` — 저장 위치·파일 시스템(gap-save-location-filesystem-realities.md §4)

코어·셸 과제가 많다. 시스템이 받은 것은 경로 표시와 오류 문구다.

| ID | 규칙 | 시스템에서 |
|---|---|---|
| G-SAVE-R1·R2 | 기본 폴더 `영상/치지직`(macOS `~/Movies/치지직`, Windows `%USERPROFILE%\Videos\치지직`, Linux `XDG_VIDEOS_DIR/치지직`). 앱 데이터 폴더로 폴백하지 않는다 | brief §6.12-1, platform.md |
| G-SAVE-R3 | OneDrive 폴더 안이면 첫 다운로드 전 동기화 안내 | platform.md |
| G-SAVE-R4~R8 | 폴더 선택 직후·시작 직전 같은 검사(쓰기·읽기 전용·FS 이름·여유 공간·동기화·경로 길이) → `ok/warn/block`. `block`은 쓸 수 없는 폴더와 FAT32 4GiB만. 여유 공간은 ×1.05 "약" | core·셸 과제, content.md 오류 문구 |
| G-SAVE-R9~R11 | NFC는 앱이 만드는 조각에만, 파일 이름 규칙은 저장 볼륨 기준, 이름 ≤ 200바이트·Windows 259 UTF-16 | core naming(`A-SAVE-1`) |
| G-SAVE-R12 | 표시 경로와 복사 경로 분리. 복사·열기·로그는 원문 | content.md |
| G-SAVE-R13 | 긴 경로는 가운데 말줄임(맨 앞 + 마지막 두 요소). CSS로 못 하므로 컴포넌트가 만든다 | foundations §3.5, brief §6.12-2 |
| G-SAVE-R14 | `~`는 macOS·Linux 홈 안에서만. Windows는 원문을 줄인다 | platform.md 분기 표 |
| G-SAVE-R15 | 줄인 경로의 전체는 키보드로도, 스크린 리더에는 원문 | components.md FolderField |
| G-SAVE-R16 | 완료 표시에 파일 이름과 폴더를 따로 + [폴더 열기]. "`치지직` 폴더에 저장했어요" | D39, content.md |
| G-SAVE-R17 | 클라우드 동기화 폴더 경고 + [그래도 사용]은 그 폴더에 한해 다시 묻지 않음 | content.md 오류 표 `cloudFolder` |
| G-SAVE-R18 | macOS에서 다운로드·문서·데스크탑·외장·네트워크를 고르면 TCC 안내(서명 없는 릴리스 동안만) | platform.md |
| G-SAVE-R19 | 외장 디스크 사라짐·읽기 전용은 별도 오류 "저장 장치를 찾을 수 없어요". `.part`는 남긴다 | content.md 오류 표 |

§4-6 오류 문구 표(`fileTooLargeForVolume`·`lowSpace`·`diskFull`·`pathTooLong`·`volumeGone`·`readOnlyVolume`·`cloudFolder`)는 content.md가 copy deck 후보로 가져갔다.

### 5.20 `G-POWER` — 잠자기·네트워크·백그라운드(gap-power-network-background-behavior.md §7)

| ID | 규칙 | 시스템에서 |
|---|---|---|
| G-POWER-R1 | 받는 동안 컴퓨터가 유휴 상태로 잠들지 않게 한다 | D40 |
| G-POWER-R2 | 화면 꺼짐은 막지 않는다 | D40 |
| G-POWER-R3 | 덮개 닫기·전원 버튼 같은 명시적 잠자기는 막지 않는다 | D40 |
| G-POWER-R4 | 잠자기 방지는 `running`(또는 `pausing`) 작업이 있고 연결 대기 상한 안일 때만. 그 밖에는 해제 | 셸 상태 머신(`rust`·`tauri`) |
| G-POWER-R5 | 설정 한 곳에서 끌 수 있고, 켜져 있는 동안 목록에 한 줄. 기본 켬 | D40 토글 "받는 동안 컴퓨터가 잠들지 않게 하기" |
| G-POWER-R6 | OS가 사유를 보이는 곳에 한국어 사유 `치지직 영상 받는 중 ({n}개)` | platform.md |
| G-POWER-R7 | 토글이 꺼져도 macOS는 `running` 동안 App Nap을 끈다. 설정으로 노출하지 않는다 | platform.md |
| G-POWER-R8 | 서버가 거절하지 않은 네트워크 실패는 **진전 없는 시간 30분**까지 기다리며 재시도, 대기 간격 30초 이하, 잠자기 중에는 흐르지 않는다 | D40 "연결 대기" 단계. **30분·30초는 보고서 제안**(brief §4.3) |
| G-POWER-R9 | 기다리는 동안은 오류가 아니다. `연결을 기다리는 중이에요`, 속도·남은 시간 숨김, 받은 크기 유지, 빨강·실패 문구 없음 | D40(brief §6.9-7) |
| G-POWER-R10 | OS의 연결 복구·깨어남 신호는 즉시 한 번 재시도하는 힌트로만 | 셸 |
| G-POWER-R11 | 1분 안에 회복한 단절은 알리지 않는다. 1분 넘으면 화면 안 `연결이 돌아와서 이어서 받고 있어요` 10초. OS 알림은 완료와 "멈췄어요"에만 | D38·D40 |
| G-POWER-R12 | 데이터 요금 연결에서 큰 작업(1GB 이상 예)을 추가할 때 한 번 확인, 막지 않는다 | patterns.md [잠정] |
| G-POWER-R13 | 전원·네트워크 OS 호출은 `shell::power`와 `src-tauri` 전원 모듈에서만 | 코어·셸 |
| G-POWER-R14 | 종료·패닉 경로에서 잠자기 방지가 남지 않는다 | 셸 |
| G-POWER-R15 | "받는 동안 잠들지 않아요"는 실제로 얻었을 때만 보인다. 실패해도 다운로드를 멈추지 않는다 | D40, content.md |

### 5.21 `G-OUTAGE` — 서비스 장애·공지(gap-service-dependency-outage-communication.md §8·§12)

| ID | 규칙 | 시스템에서 |
|---|---|---|
| G-OUTAGE-R1 | 배너는 한 번에 하나. 순서 설치 중 B4 → B2 → B5(block·warn) → B1 → B4 → B5(info) | D37, patterns.md 알림 위계 |
| G-OUTAGE-R2 | 외부 서비스 문제는 배너와 실패 지점(카드·목록·로그인) 두 층에 같은 사실 | D41 "실패 지점 인라인" |
| G-OUTAGE-R3 | fail-open: 공지를 못 받거나 해석 못 하면 아무것도 막지 않는다 | D41 |
| G-OUTAGE-R4 | 모든 공지는 만료 시각, 발행 후 72시간 상한, 캐시는 24시간 뒤 폐기 | D41. **72h·24h는 보고서 판단** |
| G-OUTAGE-R5 | 공지는 종류별 신규 받기만 막는다. 진행 중·이어받기·열기·설정·로그인은 막지 않는다 | D41 |
| G-OUTAGE-R6 | 공지는 정해진 코드와 80자 이하 평문. HTML·링크·내부 API 설명 없음 | D41(공개 저장소 규칙). 80자는 보고서 판단 |
| G-OUTAGE-R7 | 활성 공지 한 개. 같은 `id`는 닫으면 이번 실행 동안 다시 보이지 않음 | D41 |
| G-OUTAGE-R8 | 공지는 사람이 게시. drift는 초안까지 | worker.md |
| G-OUTAGE-R9 | 오류 문구는 `diagnosis`(local/service/unknown)로 원인을 가르고 증거 없이 "치지직 서버 고장"이라 쓰지 않는다 | D41, content.md |
| G-OUTAGE-R10 | "업데이트해 주세요"는 설치 가능한 새 버전이 있을 때만 | brief §6.10-4, `design-copy` |
| G-OUTAGE-R11 | 같은 종류에서 서로 다른 영상 3건 연속 읽기 오류면 자동 재시도·이어받기를 멈추고 사용자가 누를 때 한 건만 | 셸 서킷. 3건은 보고서 판단 |
| G-OUTAGE-R12 | 고쳐질 시각을 모르면 모른다고 쓴다 | content.md |
| G-OUTAGE-R13 | 막았던 종류가 풀리면 토스트로 한 번 | D37·D41 |
| G-OUTAGE-R14 | 공지는 Worker 장애를 알릴 수 없다. 로그인 서버 불통은 앱이 진단해 문구로 | D41 |
| G-OUTAGE-B1~B5 | 배너 종류: B1 중단된 다운로드 · B2 설정 저장 실패 · B4 새 버전/진행 · B5 서비스 안내(block·warn·info). 보고서는 `info`를 `accent-soft` 면으로 제안 | **D10·foundations §2.3은 정보 톤을 `--surface-2`로**, `--accent-soft`는 배너에 쓰지 않는다(V-41). `warn`·`block`은 `--warning-soft`(일치) |

### 5.22 `G-HELP` — 도움말 체계(gap-help-content-troubleshooting-system.md §10)

| ID | 규칙 | 시스템에서 |
|---|---|---|
| G-HELP-H1 | 도움말 원천은 `help/*.md` 하나, 앱 번들과 `/help`는 같은 원천 | D51 |
| G-HELP-H2 | 앱 안 도움말은 오프라인에서 열린다. 네트워크로 불러오지 않는다 | D51(CSP `connect-src` ipc만) |
| G-HELP-H3 | 앱은 `helpId`로만 웹 도움말을 연다 | D51, `G-LEGAL-R13` |
| G-HELP-H4 | `/help`는 로그인 없이, 스크립트 없이 | D52, web.md |
| G-HELP-H5 | 앵커 대상은 접힘 안에 두지 않는다 | web.md |
| G-HELP-E1 | 모든 오류는 제목·본문 한 줄·다음 동작만으로 할 일을 말한다. 도움말은 그 위에 얹는 것 | D51 L0, C6 |
| G-HELP-E2 | `자세히`(코드·경로)와 `도움말 보기`(링크)를 따로 | D51 L1·L2 |
| G-HELP-E3 | 오류 코드는 제목·본문에 쓰지 않는다. `자세히` 안 `오류 코드: …`로만 | C6(`E-ID-U50`), `design-copy` |
| G-HELP-E4 | 모든 `ErrorCode`는 `helpId`를 갖거나 `null` 이유를 명시 | content.md 오류 표 |
| G-HELP-E5 | 도움말 링크 글자는 `도움말 보기: {주제 이름}` | content.md |
| G-HELP-E6 | 오류 화면 단추는 최대 3개, 도움말은 링크 | components.md Notice(`E-APPLE-22` 버튼 최대 3) |
| G-HELP-A1~A4 | 앵커 계약: id는 추가만, 옛 id는 자리표시 절, 모든 id는 웹·앱 양쪽에, 문서 안 링크는 존재하는 id만 | D51 "앵커 id는 추가만" |
| G-HELP-D1~D8 | 문서 틀·문체: 제목은 증상·마침표 없음(40자 이하) · 절차는 번호 목록, 한 단계 한 문장, 번호를 문자열에 박지 않음 · 단계 7개 이하, 시스템 설정 바꾸면 `되돌리기` 절 · 메뉴 경로 `›` 굵게(`>`·`→` 금지) · 단추 표기 한 문서에 한 방식 · "클릭" 금지 · OS 폴더 경로 대신 열기 단추 · "그래도 안 되면" 절로 끝 | D44·D45, content.md 도움말 문체, `design-copy` |
| G-HELP-S1~S6 | 스크린샷: 글로 되면 글만 · `alt` 필수 · 시스템 창 이미지는 OS 버전·`capturedOn` · 실제 채널·영상·사용자 이름 없음 · 앱 화면 이미지는 자동 생성 · 다크·라이트 `<picture>` | D51 "글·도식 기본", `scan` |

### 5.23 `G-INTER` — 상태·진행·알림·확인·포커스·모션(research-interaction.md §3.2·§4.3·§5.3·§6.4·§7.3)

조사 보고서지만 규칙 문장 후보를 냈고 시스템 문서가 `inter R-DL-6`처럼 인용했다. 수치 중 `X-KO-B2`·`X-KO-B5`로 분류된 것은 표에 적었다.

| ID | 규칙 | 시스템에서 |
|---|---|---|
| G-INTER-DL1 | 총 크기를 알면 퍼센트, 모르면 절대 값, 둘 다 없을 때만 스피너. 가짜 퍼센트 금지 | D23, patterns.md 진행(`E-KO-26`) |
| G-INTER-DL2 | 진행 막대는 1초 넘게 걸릴 때부터, 10초 예상이면 속도·남은 시간 | T2 |
| G-INTER-DL3 | 속도는 약 10초 창(또는 EMA) 평활, 1초 1회 갱신, 남은 시간은 단위 반올림 | D50 EMA·1초[취향]. **"10~15초 창"은 출처 없음**(`X-KO-B5`). 코어 `Meter`는 5초 창(`E-A11Y-U39`) |
| G-INTER-DL4 | 남은 시간을 신뢰할 수 없으면 "계산 중" | D50 |
| G-INTER-DL5 | 막대는 뒤로 가지 않고, 이어받기 때 처음부터 그리지 않으며, 마무리 단계는 별도 문구 | D23 |
| G-INTER-DL6 | 막대 `width`는 transition하지 않는다. 틱 간격이 평활 수단 | D23이 `transform: scaleX` 250ms linear로 재정의(K9) |
| G-INTER-DL7 | 모든 진행 중 항목에 일시정지·취소 | patterns.md 작업 행(`E-APPLE-24`) |
| G-INTER-DL8 | 실패는 이유와 다음 행동 한 줄, 자동 재시도는 "N초 뒤 자동 재시도" | C6, patterns.md |
| G-INTER-DL9 | 완료 1차 알림은 행 상태, OS 알림은 비활성일 때만, 토스트는 보조 | D38 |
| G-INTER-DL10 | 비슷한 시각에 끝나면 알림 하나로 묶는다 | D38 |
| G-INTER-DL11 | 진행률 틱은 스크린 리더에 읽히지 않는다. 상태 전이와 25% 단위만 `status` | `G-A11Y-OS14` |
| G-INTER-NT1 | 같은 사건은 한 수단으로만 | D37, `R7` |
| G-INTER-NT2 | 가장 가까운 수단: 행 > 인라인 > 토스트 > 배너 > 대화상자 | README R7 위계 |
| G-INTER-NT3 | 배너는 한 번에 하나, 오류가 정보보다 앞 | D37 |
| G-INTER-NT4 | 입력 오류는 배너·토스트가 아니라 필드 옆 | D37, `G-IME-R3` |
| G-INTER-NT5 | 오류 토스트는 사라지지 않고 닫기 버튼. 성공·정보만 자동 소멸 | D37(`E-KO-31`) |
| G-INTER-NT6 | 자동 소멸 토스트는 hover·포커스 동안 멈추고 떠나면 처음부터 | D37(`E-KO-24`: 포커스 중만 정지는 수단이 아님 → 닫기 버튼 병행) |
| G-INTER-NT7 | 토스트는 포커스를 가져가지 않는다. 액션은 다른 경로로도. 액션 있는 토스트는 닫을 때까지 또는 최소 10초 | D37 "닫을 때까지". **10초는 근거 약함**(보고서 자인) |
| G-INTER-NT8 | 토스트 3개 이하, 넘치면 합침, 3줄 이하, 면은 raised, 의미는 아이콘+글 | D37 "한 번에 하나"로 더 좁힘. 3줄은 `E-KO-31` |
| G-INTER-NT9 | 색은 의미의 유일한 수단이 아니다. 심각도마다 아이콘과 접두 글 | D10, foundations §9.1 |
| G-INTER-NT10 | "무슨 일 + 다음에 할 일". 탓하는 말·"오류가 발생했습니다"만 있는 문구 금지 | D51, C6 |
| G-INTER-CF1 | 되돌릴 수 있으면 즉시 실행 + 실행 취소. 확인은 비가역에만 | brief §6.9-8(`E-KO-30`) |
| G-INTER-CF2 | 제목은 질문 한 문장, 대상을 이름으로 | D36·D46 |
| G-INTER-CF3 | 버튼은 결과 동사. "예/아니오/확인" 금지 | D36(`E-APPLE-22`) |
| G-INTER-CF4 | 안전한 선택이 기본 포커스이자 기본(accent) 버튼. 파괴 버튼은 danger 면이고 기본이 아니다 | D36: 안전 = 오른쪽 채움 = Enter(일치). **파괴 버튼은 danger 면이 아니라 빨간 글자 테두리**(채움은 창에 하나, P3) |
| G-INTER-CF5 | 같은 확인 반복 시 "다시 묻지 않기" 허용, 비가역에는 불허 | patterns.md |
| G-INTER-CF6 | 실행 취소 창은 토스트에, 창이 끝나면 실제 삭제(지연 삭제) | D37·D39 |
| G-INTER-CF7 | 단어 입력 확인은 쓰지 않는다 | brief §6.9-8 |
| G-INTER-FC1 | 포커스 순서 = 시각 순서. `tabindex` 양수 금지 | components.md |
| G-INTER-FC2 | 대화상자는 포커스를 안으로(안전한 버튼), 가두고, 닫히면 돌려주고, Esc로 닫힌다 | D36, K15 |
| G-INTER-FC3 | 토스트·배너는 포커스를 가져가지 않는다. 오류 요약만 포커스 이동 | D37, `G-WEB-R19` |
| G-INTER-FC4 | 항목이 사라지면 다음 → 이전 → 빈 상태 버튼으로. `body`로 떨어지지 않는다 | brief §6.7-3 |
| G-INTER-FC5 | 화면 전환 후 포커스는 `h1`(`tabindex=-1`) | brief §6.7-3 |
| G-INTER-FC6 | 고정 요소가 포커스를 가리지 않게 `scroll-padding` | D37(`E-KO-19`) |
| G-INTER-FC7 | `:focus-visible`, 텍스트 입력은 늘 보인다 | D20 |
| G-INTER-FC8 | 모든 포인터 동작에 키보드 대안. 단축키는 `Kbd`로 | brief §6.7-7 |
| G-INTER-MO1 | 모션은 행동에 답하거나 변화를 설명할 때만. 장식 모션 금지 | D22, P5(`E-SCALE-18`) |
| G-INTER-MO2 | 세 단계 100~120 / 160~200 / 240~300ms, 400 이하 | **D22는 100/200/300**. 구간은 보고서 제안(`X-KO-B2`) |
| G-INTER-MO3 | 퇴장은 등장보다 짧다 | D22(`E-KO-28`) |
| G-INTER-MO4 | 등장 ease-out, 퇴장 ease-in, 선형은 진행 막대·스피너에만 | D22·D23 |
| G-INTER-MO5 | 한 번에 한 속성군. `width`·`height`는 Disclosure처럼 정보가 접히는 경우만 | components.md Disclosure |
| G-INTER-MO6 | 같은 종류는 같은 토큰. 컴포넌트에 `ms` 금지 | `design-lint` |
| G-INTER-MO7 | reduce면 이동·크기·반짝임·회전을 끄고 opacity만. 정보 패턴(줄무늬)은 남긴다. JS도 같은 쿼리 | D22(`E-KO-29`) |
| G-INTER-MO8 | 5초 넘게 움직이는 장식 없음. 진행 표시는 본질적 움직임 | D22(`E-KO-24`) |
| G-INTER-MO9 | 깜박임 없음. 초당 3회 넘는 번쩍임 금지(2.3.1) | `design-lint` |

연구 보고서 gov(research-governance.md)의 리뷰 체크리스트 11항목과 강제 장치 요약은 README §4.1·§4.2와 governance.md가 흡수했다. 검증을 거치지 않았으므로 ID를 두지 않는다.

---

## 6. 방향 후보 셋과 판정(`J-*`)

판정자는 judgment.md(2026-10-09)에서 세 후보의 direction.md·tokens.css·목업 HTML 18장·스크린샷 82장을 직접 보고 점수를 매겼다. 보조 검사(`judge/scan.mjs`)는 세 tokens.css의 색을 HSL로 바꿔 C1 범위를 훑고, 목업의 인라인 `style=`·`<style>`·금지어를 세고, 컴포넌트 CSS의 색·px 리터럴을 세고, 후보가 주석에 적은 대비값 20쌍을 다시 계산했다(세 후보 모두 주석과 일치). 점수는 E1(에이전트 판단)이고 사용자 관찰이 아니다. 결론은 ADR-0001이다.

### 6.1 후보 요약

| ID | 이름 | 한 문장 | 성격을 가르는 선택 | 산출물 |
|---|---|---|---|---|
| **J-A** | 「무색(無色)」 | 앱이 자기 색을 지우고 콘텐츠·상태·OS 관례만 남긴다 | 앱 이름·로고 없음(창 제목이 이름), 성공색 없음, 시스템 파랑 강조, 시스템 설정식 그룹 상자, 왼쪽 상태 레일 폐기, 모션 최소. 글자 13/16, 컨트롤 24/28/36, 가장자리 20·형제 8·라벨 6(AppKit 실측), 반경 6/10/12, 열 720 가운데, 토스트 6초[취향], 막대 6px[취향] | `tokens.css`·`ui.css`(색·px 리터럴 0)·목업 6장·스크린샷 28장·`color.mjs`/`final.mjs`(OKLCH→hex·대비) |
| **J-B** | 「작업대」 | 방송이 끝난 뒤 어두운 방에서 여는 "받기 작업대". OBS·편집기 옆에 놓여도 낯설지 않은 밀도 | 다크가 원본(L .205→.335 계단), 남보라 강조(OKLCH h 282)[취향], 켜짐 신호에만 색, 숫자가 먼저 읽히는 상태 줄 문법, 창을 채우는 한 열(가장자리 16), 정직한 도구(비공식 고지 굵게). 글자 13/18, 컨트롤 32(빅테크 "수렴"), 24시간 시각[취향], 3px 레일, 4px 막대, 3 OS 테마 토글, 최근 VOD 목록, 붙여넣기 힌트, Worker 골격(theme-color·skip link·caption·th scope) | `tokens.css`·목업 6장·스크린샷·`tools/color.mjs`(`palette.txt`) |
| **J-C** | 「또렷한 다정함」 | 처음 쓰는 사람도 설명 없이 끝까지 가게, 글자는 크게·말은 쉽게·한 화면에 한 가지 일 | 설명이 화면 안에(빈 상태 3단계·"가장 좋은 화질" 꼬리표), 본문 15/22(웹 17/26), 컨트롤 36/44, 헤더 52, 파랑 h 262 + 약한 청회색 중립, 민트 성공색(다크 `#55D7BE` H168·S62%), 읽기 척도 `data-scale="reading"`, 헤더 pill "비공식 도구", 모션 120/200/280, "네트워크"→"인터넷" | `tokens.css`·`ui.css`·목업 6장·스크린샷 26장·`tools/palette.mjs` |

세 후보 모두 하한 밖 CSS(`light-dark()`·`linear()`·`@starting-style`·`popover`)를 쓰지 않았고, 라이트·다크 두 벌·`outline` 포커스·`forced-colors` 블록을 두었다. 로그인 첫 화면은 셋 모두 목업하지 않았다(→ Q12).

### 6.2 기준별 점수(10점 만점)

| ID | 기준 | J-A | J-B | J-C | 갈린 이유 |
|---|---|---|---|---|---|
| **J-S1** | 사용자 중심(T1~T7) | 7.5 | **8.5** | 7 | B가 T1(힌트·⌘↩)·T3(상태 어휘)·T5(설치 안내)·T7(최근 목록)을 가장 잘 받친다. A는 최근 목록·힌트가 없다. C는 확정 지점이 둘이고 퍼센트가 없다 |
| **J-S2** | 서비스 어울림(C1~C8) | **9** | **9** | 6 | C는 C3(15/22, 36/44, 헤더 52로 720×520에서 카드 바닥이 첫 화면 밖)·C5(퍼센트 없음) 미충족, C1 경계(민트). A는 초록 토큰이 아예 없어 C1 검사가 스캔으로 끝난다 |
| **J-S3** | 근거의 질 | **9** | 7.5 | 6.5 | A는 수치 원천을 AppKit 실측·WCAG로 못 박고 출처 없는 값을 [취향]으로 표시했다. B의 "32 수렴"은 부분 refuted(`X-SCALE-05`). C는 refuted 수치는 없지만 원칙과 목업이 어긋난다(주 버튼 하나라 하고 2~3개) |
| **J-S4** | 일관성·정밀 | **8.5** | 7.5 | 6 | 아래 §6.4 결함 수 6 / 8 / 8과 성질 |
| **J-S5** | 실현 가능성 | 8 | **8.5** | 8 | A가 forced-colors 형태 단서까지 가장 꼼꼼. B는 reduce에서 `* { … !important }`로 전부 끔(브리프 소스 스캔 금지 항목). C는 225% 텍스트 크기 접힘 규칙 없음 |
| **J-S6** | 앱·Worker 통일 | 8 | **8.5** | 8.5 | B가 brief §6.13-2 골격을 유일하게 다 지켰다. A 랜딩 13px은 웹에서 작다. C는 읽기 척도 구조가 좋고 `theme-color` 없음 |
| | **평균** | **8.3** | 8.3 | 7.0 | A·B 동점. A는 "빠진 것"(더하면 된다), B는 "들어간 것"(빼면 흔적이 남는다)이 문제라서 A가 뼈대 |

### 6.3 과업·어울림 낱개 판정(judgment §1.1·§1.2 요약)

| 항목 | J-A | J-B | J-C |
|---|---|---|---|
| T1 붙여넣기→받기 | [불러오기] 테두리·[받기] 채움. 붙여넣으면 바로 불러온다는 말 없음 | 힌트 "어디서든 ⌘V로 붙여넣으면 바로 불러와요", [받기 ⌘↩]. 가장 잘 받친다 | 힌트·빈 상태 3단계·"가장 좋은 화질". 그러나 [불러오기]·[받기] 둘 다 채움 |
| T2 진행 확인 | 퍼센트 열 고정폭, 막대 6px | 퍼센트·일시정지 같은 줄, 막대 4px(다크 720에서 가늘다) | **퍼센트 없음** |
| T3 복구 | 실패 행 한 줄 + [이어받기][자세히] | 실패 상태 셋(공간 부족·원본 바뀜·같은 이름 건너뜀), "받다 만 파일" 안내. 어휘 가장 풍부 | "공간을 비운 뒤 이어받으면 받던 곳부터 이어가요. 받은 부분은 그대로 있어요." 최고의 문구 |
| T4 완성 파일 | [열기] [Finder에서 보기] | [열기] [폴더에서 보기] + 아이콘 | [파일 열기] [폴더에서 보기] |
| T5 설치·로그인 | xattr 한 길, SAC 경로, "다른 명령은 사기" | "그래도 열기" 먼저 + xattr 폴백, 로그인 절, "막히면" 절. 가장 완성도 높음 | 읽기 17px로 가장 읽기 쉬움. "Windows 10 이상"(브리프는 22H2), SAC는 "열 수 없어요"로 끝 |
| T6 쿠키 | 행에 이유·저장 위치 한 줄 | `<details>` 안에 이유만 | 행에 이유만 |
| T7 몇 주 만에 | 없음 | **최근 VOD 3개 + [다시 열기]** | 없음 |
| C1 | 충족+(초록 토큰 0) | 충족(성공 초록 H124·S39%, 범위 밖) | 경계(`#55D7BE` H168·S62%, `#007563` H171·S100%) |
| C2 | 충족(랜딩 히어로 아래·바닥글·정보) | 충족(랜딩 굵게·정보) | 충족(헤더 pill까지) |
| C3 | 충족(13/16, 면 단계) | 충족(13/18, 가장 조밀) | 미충족(스스로 인정) |
| C4 | 충족 | 충족 | 부분(확정 지점 둘) |
| C5 | 충족 | 충족 | 미충족 |
| C6 | 충족 | 충족 | 충족+ |
| C7 | 랜딩 "앱을 연 다음" 1단계 | 랜딩 "처음 열면 로그인해요" 절 | 랜딩 "처음 쓰기" 1단계 |
| C8 | 랜딩 lead + 설정 계정 행 | 랜딩 굵게 + "허가된 채널이에요" | 랜딩 + 홈 빈 상태 "내 채널의 다시보기와 클립을" |

### 6.4 목업에서 실제로 보인 결함(judgment §1.4)

`J-F-A1`처럼 인용한다. README §6-14가 A의 여섯 개를 적용 과제로 둔다.

| ID | 후보 | 결함 | 해소 |
|---|---|---|---|
| J-F-A1 | A | 비활성 ghost 버튼에 테두리 상자가 생긴다(`.btn[disabled]`(0,2,0)가 `.btn-ghost`(0,1,0)를 이김). 상태에 따라 버튼 모양이 바뀜(`A-VIS-29` 재현) | components.md Button이 `[disabled]`를 variant별로 명세 |
| J-F-A2 | A | 툴바 왼쪽이 비어 정체성이 0 | D26(마크 + 이름, 사용자 결정 2) |
| J-F-A3 | A | 인라인 `style` 2종(`margin-top:0` 1곳, SVG 스프라이트 `position:absolute`). Worker CSP라면 실패 | `worker` gate 인라인 금지, 스프라이트는 CSS 클래스 |
| J-F-A4 | A | 행간 토큰이 `1.2308` 같은 무리수 | foundations §12-1 px 행간 토큰(B 방식) |
| J-F-A5 | A | 다크 매핑이 `@media`와 `[data-theme=dark]`에 두 번 | D3 생성기가 복제 |
| J-F-A6 | A | 랜딩 본문 13px이 1280 화면에서 작다 | D11 Worker 읽기 척도 15/22(C 구조) |
| J-F-B1 | B | 상태 줄 오른쪽 열이 행마다 흔들려 퍼센트 x좌표가 다르다(P3 "숫자가 먼저"와 어긋남) | A의 퍼센트 열 고정폭 채택 |
| J-F-B2 | B | 실패 행 빨강 4겹(레일·테두리·막대·아이콘·글자) | ADR-0003 레일 폐기 |
| J-F-B3 | B | 다크 주 버튼이 밝은 면 + 어두운 글자로 라이트와 반대 인상 | D5 파랑 다크 채움 유지(흰 글자 4.58:1) |
| J-F-B4 | B | 마우스로 연 대화상자에 `autofocus` 링(`A-VIS-26` 재현) | D20 `:focus-visible` |
| J-F-B5 | B | 진행 막대 채움을 `data-w`로 두고 촬영 스크립트가 JS로 넣는다. HTML만 열면 모두 100% | 목업 한정 |
| J-F-B6 | B | `.banner`가 `accent-soft` 면(정보 톤 중립 결정과 어긋남, V-41 재발 위험) | D10 정보 = `--surface-2` |
| J-F-B7 | B | 스위치 36×20이 WCAG 2.5.8 24 미만 | foundations §5.2 스위치 54×24 |
| J-F-B8 | B | 막대 4px은 다크 720에서 트랙·채움 구분이 어렵다 | `--progress-h` 6[취향] |
| J-F-C1 | C | 채워진 주 버튼이 한 화면에 둘~셋(V-06·P3 위반) | D42 채움은 [받기]만 |
| J-F-C2 | C | 퍼센트 없음(C5) | D23 |
| J-F-C3 | C | `.icon` stroke 1.75를 16px에서 비례 축소해 1.17px(현재 코드 문제 그대로) | D32 `non-scaling-stroke` |
| J-F-C4 | C | `.kbd` 색 리터럴 1개, 진행 막대 `style="width:N%"` 인라인 4곳 | `design-lint`, `worker` |
| J-F-C5 | C | `.btn:active { transform: translateY(1px) }`가 글자 요소 transform 금지와 긴장 | foundations §6.2 |
| J-F-C6 | C | `.status undefined` 클래스(생성기 버그) | 목업 한정 |
| J-F-C7 | C | 헤더 52 + 입력 44 + 카드 패딩 20 + 화질 행 44×3로 720×520에서 카드 바닥이 첫 화면 밖 | D16 24/28/36, foundations §8 520 높이 규칙 |
| J-F-C8 | C | [변경]·[로그아웃]에 말줄임 없음, [폴더 고르기…]에만 | D45 |

### 6.5 접목 출처(judgment §2.4)

값은 README §5가 소유한다. 여기는 각 결정이 어느 후보에서 왔는지만 적는다.

| D | 출처 | D | 출처 |
|---|---|---|---|
| D1 | 셋 공통 | D22 | A(100/200/300, reduce 1ms) |
| D2 | A(macOS 실측) + OS가 규정하는 값만 분기(C 방식) | D23 | 셋 공통 |
| D3 | C 구조(DTCG 생성기) + A 2층 | D24 | 사용자 결정 5(A 구조에 800) |
| D4 | 셋 공통 | D25~D30 | 셋 공통 |
| D5 | 사용자 결정 1(파랑, A·C) | D31·D32 | A 굵기 + B 은유 표 |
| D6 | A(순수 무채색) | D33 | A(별도 과제) |
| D7 | A·C(OS 따름 + Linux만) | D34 | 셋 공통 |
| D8 | 셋 공통 | D35 | gov |
| D9 | A 다크 계단 | D36 | 사용자 결정 3(A) |
| D10 | 셋 공통(성공색은 A) | D37 | A |
| D11 | 사용자 결정 4(A 13) + C 읽기 척도 구조 | D38~D41 | 셋 공통 |
| D12 | A 값, B 이름(px 행간) | D42~D50 | A(문구·단위·시각) |
| D13~D15 | 셋 공통 | D51~D62 | 셋 공통 |
| D16~D21 | A(D21은 A·B) | | |

B에서 옮긴 내용물(judgment §2.2): 최근 VOD 목록 + [다시 열기](T7), 힌트 "어디서든 ⌘V로 붙여넣으면 바로 불러와요"와 [받기] 안 `⌘↩`(OS별 Ctrl), "받다 만 파일" 안내 + [처음부터 받기], 상태 어휘(건너뜀·원본 바뀜), 앱 마크 + 이름 헤더, Worker 골격, 설정 계정 행 "허가된 채널이에요". B에서 버린 것: 남보라, 밝은 면 다크 주 버튼, 4px 막대, 3px 레일, 3 OS 테마 토글, 24시간, `.banner` accent-soft, `* {… !important}` reduce.

C에서 옮긴 문구(judgment §2.3): 실패 본문 "공간을 비운 뒤 이어받으면 받던 곳부터 이어가요. 받은 부분은 그대로 있어요.", 취소 대화상자 본문 "'{제목}'은 {size}까지 받았어요. 취소하면 받은 부분이 지워지고 되돌릴 수 없어요.", 빈 상태 3단계 + "내 채널의 다시보기와 클립을 받을 수 있어요", "가장 좋은 화질" 꼬리표, "네트워크"→"인터넷", Worker 읽기 척도 15/22(h1 28), Worker 헤더 pill "비공식 도구". C에서 버린 것: 본문 15 앱 적용, 36/44 컨트롤, 헤더 52, 민트 성공색, 채움 버튼 복수, 16px 비례 축소, 막대 8px.

### 6.6 근거로 결론 난 것(judgment §2.5, 묻지 않았다)

| ID | 결론 | 근거 |
|---|---|---|
| J-R1 | 본문 15는 앱에 쓰지 않는다 | C3 권장 12~14 밖, TDS 15는 모바일·문서 맥락(`E-KO-01`), 720×520에서 카드 바닥이 밀린다 |
| J-R2 | 컨트롤 36/44 기본은 쓰지 않는다. 44는 랜딩 CTA에도 쓰지 않는다(36) | AppKit confirmed 24/28/36(`E-APPLE-19`), 32는 부분 refuted(`X-SCALE-05`), 36/44는 "웹 냄새"(desktop) |
| J-R3 | 채워진 버튼은 한 화면에 하나. [불러오기] 테두리, [이어받기] 글자 버튼 | 현행 명세, `A-VIS-06`, `E-APPLE-21` |
| J-R4 | 퍼센트는 늘 보인다 | C5 |
| J-R5 | 정보 톤 중립, 테마 선택은 Linux만, 시각은 12시간 | D10·D7·D49 |
| J-R6 | 성공색은 두지 않는다[잠정]. 완료는 ✓ + "완료" + 그룹 위치 | C1 스캔 단순화, HIG 한 색 한 의미(`E-APPLE-12`). 재검토 조건은 Q5(ADR-0004) |
| J-R7 | 레일 폐기 | 실패 행 4~5겹(`A-VIS-20`, `J-F-B2`). brief §6.16 K3 번복 → ADR-0003 |
| J-R8 | Worker 골격은 B의 것 | brief §6.13-2를 유일하게 다 지켰다 |

### 6.7 사용자가 직접 고른 다섯 가지(judgment §3)

근거만으로 갈리지 않는 결정이었고 뒤집어도 체계가 깨지지 않는다. 사용자의 답을 함께 적었다.

| ID | 질문 | 선택지 | 판정자 추천 | **사용자 결정** | 결정 |
|---|---|---|---|---|---|
| J-Q1 | 강조색 | 파랑(A·C, OKLCH h 258 / 262) vs 남보라(B, h 282) | 파랑(비기술자에게 "안전한 시스템 버튼", C1에서 멀다) | **파랑** | D5 |
| J-Q2 | 헤더에 앱 마크·이름 | 그리지 않음(A) vs 마크 + 이름(B·C) | 마크 + 이름(Linux 전체 화면에서 앱 이름이 어디에도 없다). 마크는 D33 결과물로 | **마크 + 이름, 마크가 나오기 전까지는 이름만** | D26·D33·D34 |
| J-Q3 | 취소 확인 대화상자 배치 | 오른쪽 = 안전 = 채움 = Enter(A) vs 왼쪽 = 안전 + 포커스, 오른쪽 = 파괴 테두리(B·C) | A(규칙 하나로 대화상자 7종을 덮는다. 둘 다 실수 비용 0) | **오른쪽 끝 = 안전 = 채움 = Enter, 파괴 동작은 왼쪽 빨간 글자** | D36, ADR-0005 |
| J-Q4 | 앱 본문 13인가 14인가 | 13/16(A·B) vs 14/18(데스크톱 수렴) | 13 잠정. `--text-body` 하나로 뒤집을 수 있게 | **13px, Windows 실기 뒤 `--text-body` 하나로 14 전환 가능한 구조** | D11, Q1 |
| J-Q5 | 본문 열 | 720 가운데(A) vs 960 + 가장자리 16(B) | A 구조에 `--content-max` 800(두 후보 어디에도 없는 절충, 출처 없음) | **가운데 최대 800** | D24, ADR-0001, Q6 |

### 6.8 적용 전 확인 목록(judgment §4)

1. Windows 실기: 맑은 고딕 13px 판독, 600 렌더, `tabular-nums` → Q1.
2. 로그인 첫 화면 목업(C2·C7 "로그인 전" 조건 미증명) → Q12.
3. D33 앱 마크(J-Q2 전제) → Q8.
4. 첫 사용자 시험(D62): 완료를 색 없이 알아보는가, 오른쪽 파랑을 안전으로 읽는가, 13px이 작게 느껴지는가 → Q3.
5. A 결함 6개(`J-F-A1`~`A6`) 수정 뒤 재촬영 → Q14.

---

## 7. 열린 질문(`Q*`)

**Q1~Q14는 `README.md` §6 열린 항목 1~14와 번호가 같다.** 그 표가 "확인 방법"과 "나쁘면"을 소유하고, 여기는 어느 보고서가 왜 열어 두었는지와 관련 ID만 적는다. Q15부터는 조사·격차 보고서가 남긴 빈칸 중 README §6에 없는 것이다. 닫히면 지우지 않고 "닫힘(ADR 번호)"을 적는다.

### 7.1 README §6과 같은 번호

| ID | 질문 | 열어 둔 보고서 | 관련 |
|---|---|---|---|
| **Q1** | Windows 맑은 고딕 13px 판독, 600 굵기 렌더, `tabular-nums` 동작, `system-ui` 해석 | v-scales(`E-SCALE-09`·`36`), v-a11y(`E-A11Y-D25`, `X-A11Y-D28`), g-icon(`X-ID-M07`), v-apple(`X-APPLE-09`) | D11·D13, J-Q4, `R4` |
| **Q2** | Linux 글꼴·테마 감지: fontconfig `system-ui`, Noto Sans CJK KR 유무, GNOME `prefers-color-scheme` 정확도, 분수 배율 | v-desk(`X-DESK-E34`), v-a11y(`E-A11Y-D29`·`A53`), v-scales(`X-SCALE-E`) | D7, foundations §3.1 |
| **Q3** | 첫 사용자 시험(D62): 기준선 + 적용 뒤 | g-evid(`G-EVID-R2`·`R3`), judgment §4 | D62, J-R6, J-Q3·J-Q4 |
| **Q4** | 아이콘 16px·stroke 1.5의 DPR1 번짐 | g-icon(`E-ID-K30`·`K32`·`K35`) | D32, `G-ICON-4` |
| **Q5** | 성공색 없음 | judgment §2.5(J-R6), ADR-0004 | D10, 3명 중 2명 기준(`G-EVID-R3`는 형식만) |
| **Q6** | 본문 열 800 | judgment §3 질문 5(J-Q5), ADR-0001 | D24 |
| **Q7** | 출처 없는 수치 묶음: 토스트 6초, 알림 40자소, 막대 6px, 툴바 44, 대화상자 440, 읽기 열 680, 그림자, 분기 600, 글자 크기 ×1.3/×2.0, 읽기 척도 13/17/22/28 | `X-KO-B4`, `X-DESK-N45`·`L34`, A 후보 [취향], ADR-0002 | D37·D38·D24·D28, foundations §3.3·§5.2·§6.4 |
| **Q8** | 앱 마크(D33) | g-id §8, judgment §3 질문 2(J-Q2) | D33, Q22 |
| **Q9** | 치지직 약관 상표 조항, KIPRIS 조회, KWCAG 적용 여부 | g-id §8(`X-ID-I14`·`I16`), `E-ID-I15`(2차), users §3.2 법적 주의 | D34, governance.md 개명 트리거 |
| **Q10** | Windows 탐색기 바이트 진법 실측 | g-units(`E-A11Y-U01`: MS 문서끼리 모순) | D47, ADR-0006 |
| **Q11** | macOS ad-hoc 서명 실기, Smart App Control 두 대, 서명 없는 빌드의 알림 표시 | g-install(`E-ID-L08`·`L14`), g-shell(`X-DESK-N39`·`G-SHELL-NS25`), `X-ID-I48` | D55·D38 |
| **Q12** | 로그인 첫 화면(세 후보 모두 목업 없음, C2·C7 "로그인 전" 조건 미증명) | judgment §1.2·§4, g-privacy(`G-PRIVACY-R9`·`R17`·`G5`) | patterns.md 로그인 |
| **Q13** | Worker 읽기 척도의 title·display·hero 값(15 외) | judgment §2.3-6, `E-KO-01`(TDS 13/17은 confirmed, 정수화는 [잠정]) | foundations §3.3 |
| **Q14** | A 후보 결함 6개 수정 뒤 재촬영 | judgment §1.4(`J-F-A1`~`A6`) | components.md, `worker` |

### 7.2 README §6에 없는 빈칸

| ID | 질문 | 열어 둔 보고서 | 확인 방법 | 결과가 바꾸는 것 |
|---|---|---|---|---|
| **Q15** | 한국어 IME 확정 Enter의 이벤트 순서(`compositionend`·`keydown`·`isComposing`·`keyCode`)가 세 엔진(WKWebView·WebView2·WebKitGTK + IBus/fcitx5)에서 어떤가 | g-ime §10(`X-A11Y-T05`), `E-A11Y-T04`(WebKit이 새 순서를 끄고 플래그 뒤에 둠) | g-ime §9.3 프로브를 각 OS에서 돌려 표를 채운다. 자동화 불가(Playwright·네이티브 E2E 모두 IME를 못 쏜다) | `G-IME-R4`의 `isComposing || keyCode === 229` 판정이 충분한지. 부족하면 platform.md IME 절 보강 |
| **Q16** | 셸 실측 11항목: WKWebView 본문 `contextmenu` `preventDefault` 실효, 기본 컨텍스트 메뉴 항목, Windows에서 JS만으로 Ctrl+R·F5·Ctrl+P·Ctrl+F 차단 가능 여부, `⌘,` 가속키와 웹뷰 `keydown` 선후, 전체 화면 항목 자동 전환, Linux 핀치, `fluentOverlay` 모양과 125 미만 폴백, NSIS 바로가기, 알림 클릭 3 OS, Dock 진행 중 아이콘 변형, macOS 알림 전달 | g-shell §9.2 | g-shell §8.2 수동 체크리스트 M1~M13을 릴리스 전 3 OS에서 | platform.md 각 절. 알림 전달(11번)은 Q11과 같다 |
| **Q17** | 치지직 파일이 VFR인지 | g-handoff(`G-HANDOFF-H4`) | `inspect` 결과를 실서버 스모크에서 기록(kind만 출력, 값은 내지 않는다) | "소리가 밀려요" 도움말 게시 여부, 코어 변경 여부 |
| **Q18** | Windows 11 한국어 탐색기의 "폴더에서 보기" 정확한 OS 문구, `reveal_item_in_dir`의 OS별 실제 동작 | g-icon §10 | Windows 11 한국어 탐색기·Chrome 화면 확인, 3 OS 실기 | D39·D43 라벨(`G-ICON-7`), platform.md 분기 표 |
| **Q19** | Windows 배율 분포(125·150% 다수 가정)와 터치 노트북 보유율 | g-scale §9-7(`X-A11Y-D54`), g-input §8 | 공개 통계 없음. 문제 보고에 `devicePixelRatio`·`any-pointer: coarse`를 넣는 안은 개인정보 규칙(`G-PRIVACY-R12`)과 함께 결정. 자동 전송은 없다(`G-EVID-R6`) | D61 시각 QA 행렬의 우선순위, `G-INPUT-IN4` 비용 판단 |
| **Q20** | 사람 결정 셋: 앱 라이선스(D58), AppImage 계속 배포와 LGPL 고지(D59), 이용 조건 페이지(D60), `bundle.copyright`·`publisher` 값 | g-legal §6(`G-LEGAL-D1`~`D6`) | 사용자가 정한다. D59는 먼저 `bundle (linux)` 산출물의 `.so` 목록을 덤프한다 | 정보 화면 "이용 조건" 행, `/terms`, `G-LEGAL-R12`·`R15` gate 활성화 |
| **Q21** | 개인정보 운영 빈칸: 감사 기록 시간 상한, 열람·삭제 창구, 평문 저장 고지(Windows 설정 폴더가 로밍 프로필인지), 치지직 Open API 약관의 개인정보 조항, PIPC 작성지침 2026.4판, DO 데이터 위치 서술, 법령 원문 | g-privacy §7(`G-PRIVACY-G2`·`G3`·`G6`·`G11`·`G12`·`G14`), `X-ID-A39` | 사람이 원문을 읽고 `/privacy` 초안(g-privacy §3.4)과 대조. Tauri `appConfigDir` 문서 확인 | web.md `/privacy`, worker.md 보관 규칙(`G-PRIVACY-R18`~`R20`) |
| **Q22** | Tauri 번들러가 `.icon` → `Assets.car` + `CFBundleIconName`을 실제로 받는지, `.deb` hicolor 설치 크기, `apple-touch-icon` 불투명 요건 원문 | g-id §8(`E-ID-I26`, `X-ID-I44`) | 한 번 시험(Peitho 방식), 번들 산출물 `Info.plist` 검사 | D33 과제의 산출물 목록(`G-ID-R9`) |
| **Q23** | Linux 알림 appname(`chzzk-app`)과 `.desktop` `Name[ko]` 한국어화, Windows 토스트 발신자 표시(미서명·MSI) | g-shell §9.1 G9·G15, g-id §8-8(`X-ID-I48`) | Ubuntu·Windows 설치본에서 알림 머리를 캡처 | platform.md 알림 절, `G-ID-R5` |
| **Q24** | 실제 사용자 어휘(받기/다운로드, 주소/링크)가 D42·D43과 같은가 | g-evid §1.5, README D42 [미확인] | D62 과업문에 화면 단어를 넣지 않고 참가자가 쓰는 말을 기록 | D42·D43 용어집 |
| **Q25** | 엔진 하한 실기: Ubuntu 22.04 컨테이너(2.50.4)와 미갱신 2.36.0에서 `CSS.supports` 프로브, macOS Monterey·Ventura에서 Safari 갱신이 다른 앱의 WKWebView에도 적용되는지, WebKitGTK `system-ui`·한글 폴백 | g-engine §7.3(`X-DESK-E12`), g-scale §9-4 | `ubuntu:22.04` 컨테이너에서 `xvfb-run` `--smoke`(g-engine E6), 구형 macOS 실기 | D1 하한 문구(`G-ENGINE-R10` 알림 문구), foundations §11 |
| **Q26** | 코어 `Meter`(5초 창·100ms 표본)와 D50 EMA·1초 갱신의 체감 차이, "끝에서 멈추는 것이 더 나쁘다"의 근거 | v-ko(`X-KO-B5`), `E-A11Y-U39`, `E-KO-33` | D62에서 "진행을 읽는가" 관찰. 지각 연구는 5초 막대 실험 하나(`E-KO-33`) | D50 ETA 알고리즘, `--progress-h` |
| **Q27** | macOS WKWebView 1x·분수 배율(확대 비율 해상도)에서의 선 스냅, 실제 WebView2 테두리 스냅 | g-scale §9-1·9-2(`E-A11Y-D04`는 Chromium 헤드리스 셸 실측) | Windows 125·150%, macOS 1x 외장 모니터에서 기기 픽셀 단위 확대 캡처 | foundations §6.2 1·2px 규칙의 실기 확인(규칙 자체는 CSS Values 4 표준 `E-A11Y-D01`) |

### 7.3 닫힌 질문

없다. ADR-0001~0008은 결정 기록이고 위 질문을 닫지 않았다(모두 "채택(잠정)").

---

## 8. 다른 문서와의 충돌, foundations에 추가 요청

### 8.1 보고서 제안과 시스템 결정이 다른 곳

시스템 문서(`README.md` §5·`foundations.md`)가 이긴다. 편집 단계에서 다른 섹션 작성자가 아래 ID를 인용할 때 "뒤집음"을 함께 적어야 한다.

| 보고서 규칙 | 시스템 결정 | 이유 |
|---|---|---|
| `G-A11Y-OS10` 앱 안 테마 선택(3 OS) | D7 Linux에서만 | HIG 앱별 외관 설정 금지(`E-APPLE-12`). Linux GTK3 감지 불신은 받았다(`E-A11Y-A53`) |
| `G-A11Y-OS11` 글자·간격 `rem` | D4 모든 토큰 px | `A-VIS-01`(루트 14로 12.5% 축소) 재발 방지. 320 리플로우는 유지 |
| `G-A11Y-OS12` `zoomHotkeysEnabled: true` | D28 줌 끔 + 글자 크기 설정 | `G-SHELL-H3`(Ctrl+±는 실수로 화면이 깨진다), 200%는 설정 단계로(`E-APPLE-08`) |
| `G-ICON-3` 16·20·32, `G-ICON-4` 크기별 굵기 1.2/1.25~1.5/1.6 | D32 16·20, 1.5 고정[잠정] | 32를 쓸 자리(빈 상태 아이콘)가 없다. 굵기는 Q4 뒤 16px만 1.25로 내릴 수 있다 |
| `G-SCALE-8` 본문 14 | D11 13[잠정] | 사용자 결정 4(J-Q4). Windows 실기 뒤 전환 구조 |
| `G-SCALE-3` 목표 3.5:1, `G-SCALE-10` ΔE2000 15 | D19 ≥ 3:1만, ΔE 검사 없음 | 보고서 제안값(brief §4.3). 쓰려면 ADR |
| `G-SHELL-H7`·`NS7` `overscroll-behavior: none` | 보류 | `X-DESK-E27` Safari 16 partial |
| `G-SHELL-NS21`·`NS22` 알림 20자·24자·3초 | D38 40자소[취향], 묶음 "{첫 제목} 외 {N−1}개" | `X-DESK-N45` 보고서 선택값, ADR-0002 |
| `G-HANDOFF-H1` [폴더에서 보기] 먼저 | D39 [열기] 다음 [폴더에서 보기] | 세 후보 공통 순서. 보고서 스스로 근거 약함 |
| `G-OUTAGE-B5` `info` 배너 `accent-soft` | D10 정보 = `--surface-2` | `A-VIS-41` 정보 = 브랜드 혼동 재발 금지, `J-F-B6` |
| `G-INTER-CF4` 파괴 버튼 danger 면 | D36 왼쪽 빨간 글자 테두리 | 채움은 창에 하나(P3), 사용자 결정 3 |
| `G-INTER-MO2` 100~120/160~200/240~300 | D22 100/200/300 | `X-KO-B2` 구간은 보고서 제안, NN/g 원문 값으로 |
| `G-INTER-NT7` 액션 토스트 최소 10초, `G-INTER-NT8` 3개 이하 | D37 닫을 때까지, 한 번에 하나 | 10초 근거 약함(보고서 자인), `A-VIS-32` |
| `G-INPUT` §9.1 마우스 `--control-h` 36/28·`--row-h` 32 | D16 24/28/36, `--row-h` 36 | AppKit 실측(`E-APPLE-19`). 터치 값만 받았다 |
| `G-ENGINE-R3` 보강 허용, brief §6.1-1 `text-wrap: balance` 장식 허용 | foundations §11 금지 | 검사 단순화(foundations §12-8) |
| brief §6.1-7 행간 "단위 없는 숫자" | foundations §12-1 px 토큰 | 문서 숫자 = 화면 숫자, `J-F-A4` |
| brief §6.16 K3 상태 레일 유지 | ADR-0003 폐기 | `A-VIS-20`, `J-F-B2` |
| `G-EVID` §5.3 "3명 중 2명" 판정 | ADR-0004가 성공색 재검토 조건으로만 채택 | 보고서 제안값(brief §4.3) |
| users C1 "H 140~165°", 다크 accent 하한 170° [추정] | foundations §2.1 H 140~170° 경계 색도 두지 않는다 | 더 엄격한 쪽. 검사 채도 기준은 HSL S로 고정(우리 결정) |
| `G-REPEAT-D8` 일괄 지우기 되돌리기 토스트 5초 | D37 성공 토스트 6초[취향] | 한 값으로 통일, ADR-0002 묶음 |
| `G-OUTAGE-R4`·`R6`·`R11` 72시간·80자·3건 | D41이 그대로 받음 | 보고서 스스로 "측정 근거 없음". ADR에 제안값으로 등록해야 한다(README §6-7 묶음에 **빠져 있다** → 아래 8.2) |
| `G-POWER-R8` 30분·30초, `G-LAUNCH-R2` 1.5초, `G-LAUNCH-R4` 300/400ms, `G-LAUNCH-R9` 100행 | D40·D30·patterns.md가 받음 | 모두 brief §4.3 제안값. 같은 묶음(아래 8.2) |

### 8.2 다른 문서가 고쳐야 할 것(이 문서가 발견했다 — 2026-10-10 편집에서 모두 반영: 1 → ADR-0009·README §6-7, 2 → patterns §5.2·§17-8, 3·4 → ID 인용, 5·6 → foundations §3.1·§3.4·README D13, 7 → README D48, 8 → ADR-0004·README §6-5)

1. **`README.md` §6-7 "출처 없는 수치 묶음"에 빠진 제안값**: 공지 72시간·24시간 캐시·80자·3건 서킷(`G-OUTAGE-R4`·`R6`·`R11`), 네트워크 대기 30분·간격 30초(`G-POWER-R8`), 첫 창 안전장치 1.5초(`G-LAUNCH-R2`), 로딩 표시 300/400ms(`G-LAUNCH-R4`), 목록 100행(`G-LAUNCH-R9`), 완료 그룹 11개·멈춤 30일·기록 100개(`G-REPEAT-R2`·`R3`·`R9`), 1분 회복 알림 기준(`G-POWER-R11`). ADR-0002에 같이 넣어야 README §7.2 규칙("[잠정]·[취향]은 ADR")과 맞는다.
2. **`patterns.md` §5.2 D5 "[나중에] 채움"**: `A-FEAT` P0(4)가 "업데이트의 나중에가 primary"를 결함으로 적었고 README D36이 이긴다(patterns.md 889행이 스스로 적음). §4 P0 표 `A-VIS-05·06…` 행의 "해소" 열에 적용 PR 번호가 들어가야 한다.
3. **`content.md`가 `g-privacy R22`를 인용**했다. 이 문서의 ID는 `G-PRIVACY-R22`다. `g-handoff H1`은 `G-HANDOFF-H1`이고 뒤집힌 규칙이므로 인용할 때 "순서는 D39"를 붙인다.
4. **`platform.md`·`web.md`가 `g-shell` 번호를 H·NS 구분 없이 쓴다면** `G-SHELL-H*`와 `G-SHELL-NS*`로 나눠 적는다(§5.2).
5. **`foundations.md` §3.1 Windows 행 "맑은 고딕 폴백 때의 동작 [미확인]"**과 §3.4 "맑은 고딕 굵기 단계 [미확인](v-ko A5)": 맑은 고딕 굵기가 Semilight·Regular·Bold 세 가지인 것은 **confirmed**(`E-A11Y-D25`, MS 글꼴 목록)다. 미확인인 것은 "CSS 600이 Bold로 폴백돼 400과 구별되는가"(렌더)이지 글꼴 굵기 수가 아니다. 문장을 그렇게 좁히는 것이 맞다(`X-KO-A5` "2굵기"가 refuted).
6. **`README.md` D13 근거 "맑은 고딕 굵기 [미확인](v-ko A5)"**도 5와 같다.
7. **`README.md` D48 근거**: "Finder 문자열 인용은 refuted이나 결론 동일"이 맞다. 붙임의 confirmed 근거는 `E-A11Y-U14`(ko-localized `ByteCountFormatter` `8.4GB`, CLDR ko)다. 편집 때 ID로 바꾼다.
8. **`README.md` P2·D10 "성공색 없음[잠정]"의 재검토 기준 "3명 중 2명"**: `G-EVID-R3`는 형식("N명 중 M명")만 정하고 임계값은 정하지 않는다. ADR-0004가 우리 결정임을 적어야 한다(지금은 judgment §2.5 인용).

### 8.3 foundations에 추가 요청

**없다.** 이 문서는 근거를 모으는 문서라 새 토큰·수치를 요구하지 않는다. 조건부 후보 둘은 README §6에 이미 있다:

- `--success-ink`(Q5가 "못 알아본다"로 끝나면, B 후보의 H 124°·S 39% 초록을 ✓ 아이콘 색 하나로. ADR-0004 재검증 조건).
- `--icon-stroke-sm`(Q4가 "16px 번짐"으로 끝나면 16px만 1.25px. README §6-4).

보고서가 제안했으나 foundations가 이름을 주지 않은 토큰(`--bw-1`·`--bw-2`, `--hit-floor`, `--action-gap`, `--overlay-line`)은 같은 효과를 다른 방법으로 낸다(1·2px 리터럴 허용, `--hit-min`, `--gap-sibling` 8, 다크 그림자 토큰의 inset 선). 새로 요청하지 않는다.

### 8.4 이 문서의 한계

- 검증 보고서 여섯 편의 "확정 사실" 목록은 전부 옮겼다(APPLE 31, KO 34, SCALE 37, A11Y 43, ID 60, DESK §2 전부). 검증 표의 **나머지 confirmed 행**(예: `E-DESK-R01`~`R47` 중 §2에 오르지 않은 것)은 옮기지 않았다. 그런 행을 인용해야 하면 원 보고서가 사라졌으므로 **다시 확인한 뒤** 이 문서에 행을 더한다(`R2`).
- 격차 보고서의 사실 표(§1·§2 등)는 옮기지 않았다. 규칙 문장(`G-*`)만 옮겼고, 규칙의 근거 사실은 대부분 검증 보고서가 `E-*`로 다시 확인했다. 검증을 거치지 않은 보고서 7편(g-ugt·g-repeat·g-handoff·g-save·g-power·g-outage·g-help)의 `G-*`는 E1이고 수치는 [잠정]이다(§0.3).
- 감사 보고서 일곱 편의 결함은 §4에 P0 전부와 P1·P2 주요 항목을 옮겼다. 항목 코드가 §4에 없는 결함(`A-LIT-*` 개별 줄, `A-COPY-P2-*` 개별)은 적용 PR이 코드에서 직접 찾는다.
- 모든 실측은 macOS 한 대(26.6.2, Apple Silicon, DPR 2)다. Windows·Linux 실기는 Q1·Q2·Q15·Q16·Q25·Q27이 열려 있다.
