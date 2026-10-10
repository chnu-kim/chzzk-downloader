# 화면 패턴 (patterns.md)

디자인 시스템 「무색」의 화면 패턴을 정한다. `README.md`의 결정 표(D36~D41, D56, D57)가 "무엇을" 정했고, `foundations.md`가 토큰을 정했다. 이 문서는 그 둘을 화면 위에 어떻게 놓는지를 정한다. 수치와 토큰 이름은 **`foundations.md`에 있는 것만** 쓴다(초안이 요청한 `--label-w`·`--pct-w`·토스트 퇴장·시간 상수는 모두 foundations §5.2·§7.1·§14에 들어갔다, §17).

읽는 법:
- 모든 규칙에 (a) 근거와 (b) 강제 수단을 붙였다. 강제 수단은 `README.md` §4의 gate 이름(`design-gallery`·`frontend`·`design-copy`·`design-lint`·`design-tokens`·`tauri`·`worker`·`rust`)과 리뷰 체크리스트 번호(`R1`~`R10`)다. 강제할 수 없는 규칙은 적지 않았다.
- 근거는 `docs/research/design-system.md`의 ID로 인용한다(README 머리). refuted 값은 쓰지 않았다.
- **[잠정]**은 확인되지 않은 값이고 확인 방법을 같은 줄에 적었다. **[취향]**은 출처 없는 선택이다. 뒤집어도 체계가 깨지지 않는다.
- 와이어프레임의 치수는 토큰 값이다. 예시 값(제목·크기·날짜·채널 이름)은 전부 가짜다.
- 문구의 원천은 `content.md` §15와 copy deck(`app/src/lib/copy/ko.ts`, `worker/src/http/copy.ts`)이다. 이 문서는 문구를 **키 이름**(`job.status.paused` 등)으로 가리키고, 와이어프레임 안의 글자는 그 키의 값을 옮겨 적은 것이다(값이 바뀌면 `design-copy` DC10 문서 패리티가 이 문서의 어긋남을 잡는다).
- 컴포넌트의 내부 치수(패딩·상태 색·forced-colors 매핑)는 `components.md`가 소유한다. 이 문서는 컴포넌트를 "어디에, 언제, 몇 개" 놓는지만 정한다.

---

## 0. 뼈대가 되는 다섯 문장

1. **알림은 사건이 일어난 자리에서 가장 가까운 수단 하나로 알린다.** 행 상태 > 인라인 > 토스트 > 배너(하나) > 대화상자. 같은 사건을 두 수단으로 되풀이하지 않는다(README P5, D37; inter §4.2·`G-INTER-NT1`·`G-INTER-NT2`).
2. **한 화면에 확정 지점은 하나다.** 채워진 버튼은 창에 하나([받기]). 대화상자는 오른쪽 끝 = 안전 = 채움 = Enter, 파괴 동작은 왼쪽 빨간 글자(README P3, D36).
3. **진행은 늘 숫자로 보인다.** 퍼센트는 상시, 막대는 뒤로 가지 않고, 모르면 "계산 중"이라 쓴다(README D23, D50; C5; `G-INTER-DL1`~`G-INTER-DL5`).
4. **정렬선은 하나다.** 툴바 안쪽·배너·입력줄·카드·행·토스트·대화상자가 모두 가운데 열 `--content-max` 800 안에 있고, 열 끝에 오는 유령·아이콘 버튼은 끝자리 보정으로 글자·아이콘 가장자리를 그 선에 맞춘다(README D24; `components.md` §2.1·§2.2; `A-VIS-02`~`A-VIS-04`).
5. **첫 화면에서 정직하게 말한다.** 비공식 도구라는 것, 본인 채널 영상만 받는다는 것, 로그인이 무엇을 받고 무엇을 받지 않는지를 로그인 전에 보인다(C2·C7·C8; g-privacy §3.3).

---

## 1. 알림 위계

### 1.1 다섯 단과 한 사건 한 수단

범위가 좁고 덜 방해하는 것부터 고른다. 위 단으로 충분하면 아래 단으로 내려가지 않는다.

| 단 | 수단 | 컴포넌트(D35) | 언제 | 지속 | 포커스 | ARIA |
|---|---|---|---|---|---|---|
| 1 | 행 상태 | `Notice variant=row`(작업 행의 상태 줄) | 사용자가 시작한 작업의 진행·완료·실패·대기 | 상태가 바뀔 때까지 | 옮기지 않음 | role 없음. 상태 전이는 `aria-live="polite"` 루트 하나가 한 줄로 알린다 |
| 2 | 인라인 | `Notice variant=inline` | 특정 입력칸·카드의 오류·경고·안내. 오류를 일으킨 컨트롤 **바로 아래** | 해결될 때까지 | 옮기지 않음(제출 직후 첫 오류로만) | 오류 `role="alert"`, 그 외 `role="status"` |
| 3 | 토스트 | `Notice variant=toast` | 화면 밖에서 일어난 완료, 복사·되돌리기처럼 한 번 알리고 끝나는 것 | §1.3 | 가져가지 않음 | 오류 `alert`, 그 외 `status` |
| 4 | 배너 | `Notice variant=banner` | 앱 전체 상태: 중단된 다운로드, 설정 저장 실패, 새 버전, 서비스 공지. 한 번에 **하나** | 해결 또는 닫을 때까지 | 가져가지 않음 | `<section aria-labelledby>` 안의 글자 요소에 오류만 `alert`, 그 외 `status`(`components.md` §2.12) |
| 5 | 대화상자 | `Dialog` | 되돌릴 수 없는 결정, 지금 답해야 하는 질문 | 응답할 때까지 | 오른쪽 버튼으로 옮기고 가둠, 닫으면 복귀 | `role="dialog"` + `aria-modal`(`alertdialog`는 쓰지 않는다) |

근거: inter §4.1(GOV.UK 배너 하나·h1 앞·검증 오류 금지, Carbon 인라인·토스트·액션형 구분, WCAG 4.1.3 role 구분), a-feat §2(알림 9갈래 N1~N9 → 하나로), `E-KO-B3`·`E-KO-B4`. 강제: `frontend`(Notice 하나에 `tone × variant`만 존재, 다른 알림 컴포넌트 import 금지), `R7`(새 알림이 어느 단인지와 한 사건 한 수단인지 적는다).

규칙:
1. **같은 사건은 한 수단으로만** 알린다. 행 상태가 바뀌었으면 토스트로 되풀이하지 않는다. 완료의 1차 표시는 행 상태이고, OS 알림은 창이 비활성일 때만, 토스트는 사용자가 홈이 아닌 화면에 있을 때만이다(`G-INTER-DL9`; `G-SHELL-NS20`). 강제: `frontend`(완료 이벤트 처리 테스트: 홈 + 창 활성 → 행 상태만, 설정 화면 → 토스트, 창 비활성 → OS 알림 하나), `tauri`(`should_notify`).
2. **입력 오류는 배너·토스트로 알리지 않는다.** 필드 바로 아래 인라인이다(GOV.UK 오류 요약 규칙, `G-INTER-NT4`). Worker의 무스크립트 폼은 `<main>` 첫 요소에 오류 요약 하나를 더한다(`web.md`). 강제: `frontend`(URL 오류가 `Banner`·`Toast`에 가지 않음), `worker`(폼 테스트).
3. **색은 의미의 유일한 수단이 아니다.** 모든 Notice는 톤 아이콘(오류 `circle-x`, 경고 `triangle-alert`, 정보 `info`, 완료 `circle-check`)과 글자를 함께 가진다(README P2, D32 은유 표; `G-INTER-NT9`). 강제: `design-icons`(톤별 아이콘 고정), `frontend`(Notice 렌더에 아이콘 필수).
4. **알림 안의 동작은 같은 일을 다른 곳에서도 할 수 있다**(Scott O'Hara, `G-INTER-NT7`). 토스트의 [되돌리기]는 목록의 지우기와 짝이고, 배너의 [모두 이어받기]는 행의 [이어받기]와 짝이다. 강제: `R7`.

### 1.2 사건 → 수단 결정표

새 알림을 만들 때 이 표에 행을 더한다. 표에 없는 사건은 `R7`에서 단을 정한다.

| 사건 | 수단 | 톤 | 비고 |
|---|---|---|---|
| 받기 시작·진행·일시정지·이어받기 | 행 상태 | neutral | 새 항목은 목록 맨 위에 넣고 `HIGHLIGHT_MS`(1초, foundations §14) 강조(`app.md` §8.10). 강조는 `--accent-soft` 면 → `--motion-base`로 사라짐, reduce면 즉시 |
| 완료 | 행 상태(1차) + 홈 밖이면 토스트 + 창 비활성이면 OS 알림 | neutral | 성공색 없음(README D10). ✓ `--fg-muted` + "완료" + 완료 그룹 위치 |
| 실패(이어받기 가능·불가) | 행 상태 + 행 아래 본문 한 줄 | danger | §10.3 |
| 연결 대기·링크 갱신 | 행 상태 | neutral | 오류가 아니다(README D40). 빨강·실패 문구 금지 |
| 불러오기 실패(URL·API·치지직) | 인라인(입력줄 아래) | danger | 입력은 지우지 않는다(C6) |
| 영상 카드 안 경고(같은 이름 파일, 받다 만 파일, 본인 영상 아님, 종류 차단) | 인라인(카드 안, 해당 행 아래) | warning / danger / neutral | `check_output` 결과(§6.5) |
| 설정 저장 실패 | 배너 B2 | danger | 다른 곳에서 대체 표시 불가 |
| 재시작 뒤 중단된 다운로드 N개 | 배너 B1 | neutral | [모두 이어받기] [×] |
| 새 버전 | 배너 B4 | neutral | §12 |
| 서비스 공지 | 배너 B5 + 실패 지점 인라인 | neutral(info) / warning(warn·block) | README D41; g-outage §8 |
| 로그인 만료·끊김·허가 취소 | 로그인 화면 자체(§13) | — | 배너로 알리지 않는다(`worker.md` 구현 중 변경 62 (사) "B3 없음") |
| 복사 완료 | 버튼 라벨 전환 `action.copied` `COPIED_LABEL_MS`(2초), 토스트 없음 | — | README D37 "가장 가까운 수단". 라벨이 바뀌어도 버튼 폭은 유지(`min-width`를 두 라벨 중 긴 쪽으로) |
| 목록에서 지우기(완료 항목) | 즉시 실행 + 토스트 `toast.removed` [되돌리기] | neutral | §4 |
| 파일 없음([열기] 실패) | 토스트 | danger | 닫을 때까지 |
| 쿠키 저장·지움 | 인라인 상태 글("저장됨"·"저장된 값 없음") + 저장 직후 토스트 한 번 | neutral | g-privacy §1.4 |
| `RECOVERY_SILENT_MS`(1분) 넘긴 단절에서 회복 | 행 상태 보조 줄 `job.recovered.body` `RECOVERY_NOTICE_MS`(10초) | neutral | `G-POWER-R11` |
| 받기 취소(`.part` 있음), 덮어쓰기, 창 닫기, 업데이트 재시작, 로그아웃, 이전 설정 가져오기 | 대화상자 | §5 | |

### 1.3 토스트

| 항목 | 값 | 근거 |
|---|---|---|
| 위치 | 본문 열 기준 **하단**, 열 안쪽 폭 전체(Toaster 안의 `.col`, `components.md` §2.13. 960 창에서 760, 720 창에서 680). 바닥에서 `--edge` 위 | README D37(창 기준 토스트가 목록을 가리던 `A-VIS-32` 해소). 열 기준이라 좌우 정렬선이 행과 같다 |
| 모양 | `components.md` §2.12 `toast` 행(면·그림자·반경·패딩·아이콘)이 원천 | foundations §6.4 그림자 3단, §6.1 오버레이 반경 |
| 개수 | **한 번에 하나 보이고 나머지는 대기열.** 정보·완료 토스트는 새 것이 오면 즉시 바뀌고, 오류·동작 있는 토스트는 바뀌지 않고 줄을 세운다 | README D37. `G-INTER-NT8`(3개 이하)은 README가 대체(§17-1) |
| 지속 | 정보·완료 `TOAST_MS`(6초 [취향], foundations §14, ADR-0009), hover와 키보드 포커스 동안 멈추고 떠나면 처음부터 다시 센다. 오류·`sticky` 토스트는 닫을 때까지. [되돌리기] 토스트는 6초 + 정지이고 닫힐 때 지연 삭제가 확정된다(§4) | README D37; Carbon "위급 메시지에 시간 제한 금지"; WCAG 2.2.2 |
| 닫기 | 모든 토스트에 [×](`IconButton`) | `G-INTER-NT5` |
| 길이 | 제목 한 문장, 동작 하나, 동작 라벨 2단어 이하. 외부 문자열은 `clipGraphemes` | Carbon(`E-KO-31`), `content.md` §3.2·§13 |
| 모션 | 등장 `--motion-base` `--ease-out`(opacity + 아래에서 `--space-8` 이동), 퇴장 `--motion-base` `--ease-in`(opacity만). reduce: 이동 없이 opacity만 | foundations §7.1 |
| 층 | `--z-toast` 40. 모달이 열리면 scrim 뒤에 남고 오류 토스트는 닫을 때까지 남는다 | foundations §7.2 |
| 포커스 | 가져가지 않는다 | `G-INTER-FC3` |
| 목록 가림 | 토스트가 떠 있는 동안 `.main` 바닥에 `calc(var(--row-h) + 2 * var(--edge))` 여백(시각·포커스 모두) | `A-VIS-32`, WCAG 2.4.11 |

강제: `frontend`(Toaster 단위 테스트: 하나만 보임, 대기열 순서, 타이머 정지·재시작, 오류 토스트 비대체, [×] 존재, 지연 삭제가 닫힘 시점에 확정), `design-gallery`(720·960에서 토스트 좌우가 행 가장자리와 같은 x, 토스트 중 마지막 행 버튼이 가려지지 않음), `design-lint`(ms 리터럴 금지).

```
960 창, 토스트가 뜬 홈(열 800 = 안쪽 760, 좌우 바깥 80)
┌──────────────────────────────────────────────────────────────────────────┐
│ 치지직 다운로더                                       [채널이름 ▾] [⚙]  │ 44
│──────────────────────────────────────────────────────────────────────────│
│        ┌────────────────────────────────────────────────────────┐        │
│   80   │ 열 안쪽 760                                            │   80   │
│        │ …                                                      │        │
│        │ ┌────────────────────────────────────────────────────┐ │        │
│        │ │ ⓘ 목록에서 지웠어요                    [되돌리기] [×]│ │ 36↑    │  toast.removed
│        │ └────────────────────────────────────────────────────┘ │        │
│        └─────────────────────────────── 20 ─────────────────────┘        │
└──────────────────────────────────────────────────────────────────────────┘
```
### 1.4 배너

| 항목 | 값 | 근거 |
|---|---|---|
| 자리 | 흐름 안, 본문 열의 **첫 요소**(입력줄 위). 층 없음 | GOV.UK "h1 바로 앞"(inter §4.1), foundations §7.2(배너는 층이 없다) |
| 모양 | `Notice variant=banner`: 열 안쪽 폭 전체, 패딩·반경·아이콘은 `components.md` §2.12 표, 글자 body 13, 동작은 오른쪽 끝(`secondary sm`), 그 오른쪽 [×] | `A-FEAT-C6`(동작 위치 4종 → 하나) |
| 면 | 정보 `--surface-2` + `info` `--fg-muted`, 경고·공지 block `--warning-soft` + `--warning-ink`, 오류 `--danger-soft` + `--danger-ink` | README D10(정보 = 중립, `A-VIS-41` 해소), D37, D41(block은 danger가 아니다) |
| 개수 | **한 번에 하나.** 오류 먼저(README D37): ① B2 설정 저장 실패(danger) ② B4 업데이트 실패(warning: "지금 버전은 계속 쓸 수 있어요") ③ B4 진행(받는 중·설치 중, 닫기 없음) ④ B5 `block`·`warn` ⑤ B1 받다 만 영상 ⑥ B4 새 버전 ⑦ B5 `info`. B4와 B5의 `fixedIn`이 같은 버전이면 한 장으로 합친다 | `G-OUTAGE-B1`·`G-OUTAGE-B5`(info 면은 D10이 뒤집음), README D37·D41, `app.md` 구현 중 변경 62·73 |
| 닫기 | B1·B4·B5 `info`·`warn`은 [×]로 이번 실행 동안 숨김(B5는 같은 `id`). B2는 해결될 때까지. B4 진행은 닫기 없음 | 같은 문서 §4.4-7 |
| 로그인 화면 | 로그인 화면이 열린 동안 배너는 꺼진다. 대신 로그인 패널 안에 B5 한 줄을 둔다(§13) | `worker.md` 구현 중 변경 62 (가), g-outage §8.2 |

강제: `frontend`(`AppBanners` 표 테스트: 활성 상태 조합 전부 → 보이는 배너 하나, 순서), `design-gallery`(배너 좌우 x = 입력줄 x), `R7`.

### 1.5 role 매핑

| 내용 | role | 금지 |
|---|---|---|
| 작업 결과, 대기, 복사됨, 설정 저장됨 | `status` | — |
| 오류(입력·카드·설정 저장 실패·오류 토스트) | `alert` | 경고·정보에 `alert` 금지(`A-FEAT-C2` ConflictNotice 위반 해소). 작업 행의 실패 줄(`variant=row`)은 role 없음 — 새 실패는 라이브 루트가 알린다 |
| 순차 진행 기록 | `log` | 진행 틱을 읽히지 않는다 |
| 진행 막대 | `progressbar` + `aria-valuenow`(정수 %) + `aria-valuetext`(완결 문장 `a11y.progress`, `content.md` §10) | 총량 모르면 `aria-valuenow` 생략 |
| 상태 전이·25% 단위만 라이브 영역에 | `aria-live="polite"` 루트 하나 | 틱마다 읽기 금지 |

근거: WCAG 4.1.3(`E-KO-B3`), `G-INTER-DL11`, brief §6.9-4. 강제: `frontend`(Notice `tone=warning`·`neutral`에 `role="alert"`가 없음을 단언, ProgressBar `aria-valuetext` 골든), `design-gallery`(axe).

---

## 2. 상태 6종과 시간 임계값

### 2.1 여섯 상태

모든 화면(또는 영역)은 아래 여섯 중 자기가 가질 수 있는 상태를 §2.3 표에 선언한다. 표에 없는 상태를 코드가 가지면 설계 결함이다(inter §2.2).

| 상태 | 정의 | 표시 | 알림 |
|---|---|---|---|
| empty | 데이터가 없음이 **확정** | 한 줄 상태 + 학습 단서 + 다음 행동(NN/g 빈 상태 3원칙) | 없음 |
| loading | 응답 대기 | §2.2의 임계값대로. 목록은 행 모양 스켈레톤, 단일 컨트롤은 스피너 | `aria-busy="true"` |
| partial | 일부 성공·일부 실패, 이어받기 가능, 파일 없음 | 성공분은 그대로, 실패분에 인라인 + 다음 행동 | 요약 1회 |
| error | 요청 실패 | 원인 가까이 인라인 + 다음 행동. 입력 보존 | `role="alert"` |
| success | 사용자가 시작한 작업 완료 | 항목 상태 변경이 기본. 토스트는 화면 밖일 때만 | `role="status"` |
| stale | 이전 값을 보이는 중(오프라인, 마지막 확인이 오래됨) | 이전 값 유지 + "마지막 확인 {time}" 또는 "오프라인" 배지 | 없음 |

근거: inter §2.1(NN/g 응답 시간·스켈레톤·빈 상태·오류 지침, 모두 confirmed), brief §6.9-5. 강제: `frontend`(화면별 상태 표 §2.3을 테스트 표로 옮겨 각 상태의 렌더를 단언), `design-gallery`(`/__gallery`가 상태 6종을 모두 그린다).

### 2.2 시간 임계값

| 경과 | 보이는 것 | 근거 |
|---|---|---|
| 0~100ms | 눌림 상태만(`:active`). 다른 표시 없음 | NN/g 0.1초(`E-KO-B1`), RAIL 100ms(g-launch §2.3) |
| ~300ms | **아무것도 보이지 않는다.** 로딩 표시를 띄우지 않는다 | 디자인 시스템 수렴값 200~300ms(g-launch §2.2, 관행이지 표준이 아님) [잠정] |
| 300ms 넘음 | 로딩 표시 시작. 한 번 뜨면 **400ms 이상** 유지(깜박임 방지) | 같은 문서 R4 [잠정] |
| 1초 넘음 | 무엇을 하는지 반드시 보인다("영상 정보를 불러오는 중이에요…") | NN/g 1초 |
| 10초 넘을 것으로 예상 | 퍼센트·남은 시간·[취소] | NN/g 10초, C5 |
| 1초 미만에 끝남 | 로딩 표시를 한 번도 보이지 않은 것이 정상 | NN/g 스켈레톤 표 "1초 미만은 표시 없음" |

구현 규칙: 지연·최소 유지는 **공용 훅 하나**(`useDelayedLoading` 류)만 쓴다. 값은 CSS 토큰이 아니라 foundations §14의 상수(`LOADER_DELAY_MS` 300·`LOADER_MIN_MS` 400, `app/src/lib/timing.ts`)이고 가짜 타이머로 검사한다. 단일 컨트롤의 스피너도 같은 훅을 거친다(`components.md` §2.21). 강제: `frontend`(가짜 타이머: 299ms에 끝나면 렌더 0회, 301ms에 뜨면 700ms까지 유지), `design-lint` DX(컴포넌트 안 `setTimeout(…, 숫자)` 금지, 상수 import만).

### 2.3 화면별 상태 선언

| 화면·영역 | empty | loading | partial | error | success | stale |
|---|---|---|---|---|---|---|
| 홈 · 다운로드 목록 | 빈 상태 그룹(§14.1) | 첫 그림은 `jobs.json`을 읽어 **즉시** 그린다. `LOADER_DELAY_MS` 넘게 비어 있으면 행 모양 스켈레톤 3개(제목 줄 + 상태 줄, `--surface-2` 막대) | 완료인데 파일 없음(`missing`): ✓ 대신 `triangle-alert` `--warning-ink` + `job.completedMissing`("완료 · 파일 없음") + 본문 `job.completedMissing.body` + [폴더에서 보기] [처음부터 다시 받기] | 행 실패(§10.3) | 행 상태 `job.status.completed` | 앱 시작·창 포커스 때 `missing`을 다시 확인한다(`G-REPEAT-R5`) |
| 홈 · 최근 영상 | 힌트 한 줄만(목록 없음) | 없음(로컬 값) | — | — | — | — |
| 홈 · 영상 정보(불러오기) | 카드 없음 | [불러오기] 버튼이 `loading`(안에 스피너, 폭 유지) + 입력 잠금 + 입력줄 아래 한 줄 `resolve.loading`("영상 정보를 불러오는 중", 스피너 없음 — 한 사건에 스피너 하나) [취소](§14.2). **스켈레톤 카드는 쓰지 않는다**(§17-2) | 카드 안 경고(같은 이름·받다 만 파일·본인 영상 아님) | 입력줄 아래 인라인(§10.2) | 카드 열림, 포커스는 카드 제목 | — |
| 설정 | — | 값 자리 스켈레톤(`--surface-2` 막대, 컨트롤 폭) + 컨트롤 비활성. **가짜 기본값을 보이지 않는다** | 쿠키 "저장된 값 없음"은 partial이 아니라 정상 값 | 저장 실패 → B2 배너(저장이 즉시 저장이라 행 아래 둘 수 없다). 쿠키 저장 실패 → [저장] 아래 인라인 | 쿠키 "저장됨" + 토스트 한 번 | 정보 "마지막 확인 {time}" |
| 로그인(§13) | idle | `checking`(최대 `AUTH_CHECK_TIMEOUT_MS`, foundations §14) → 스피너 + `auth.checking`("로그인 상태 확인 중") | — | denied·expired·revoked·network·server | 홈으로 전환 + `toast.signedIn`("‘{channelName}’ 채널로 로그인했어요") 한 번 | 유예 중 `account.offline`("오프라인 · {until}까지 사용 가능") 배지(계정 슬롯) |
| 업데이트(§12) | 배너 없음 | 배너 B4 진행 `update.downloading`("업데이트 받는 중 · 42%") | — | 배너 warning `update.failed` + `update.failed.help` | 재시작 | 설정 › 정보 "마지막 확인 {time}" |
| Worker 관리·내 기기 | `allowEmpty`("허가한 채널이 없어요.") + 폼 | 없음(서버 렌더) | — | 오류 요약 + 필드 옆(`web.md`) | flash 한 줄(h1 앞) | — |

근거: a-feat §5(F1 로딩 5종, F2 가짜 기본값, F3 빈 상태 3종, F4 명세 차이), `G-LAUNCH-R3`(첫 화면은 저장된 상태로 즉시), g-repeat §5.1. 강제: `frontend`(표의 각 칸을 테스트 케이스로), `design-gallery`.

### 2.4 빈 상태

빈 상태는 "시스템 상태 · 학습 단서 · 직접 경로" 세 가지를 준다(NN/g, `E-KO-B1`). 아이콘을 두지 않는다(README D32: 32px 없음, HIG writing "빈 화면엔 다음 행동"). 로딩 중에 "없음"을 먼저 보이지 않는다. "처음"과 "목록을 비움"은 다른 상태다(비운 뒤에 첫 실행 안내를 되풀이하면 거짓이 된다).

| 자리 | 머리 | 본문 | 직접 경로 |
|---|---|---|---|
| 홈 목록(첫 실행, 완료 기록 없음) | `list.empty.title`(display 17/22 600) | `list.empty.scope`(body, `--fg-muted`) + 3단계 `<ol>` `list.empty.step1`~`step3`(요청형, `components.md` §2.15 번호 배지) | 입력줄이 바로 위에 있어 버튼을 더하지 않는다 |
| 홈 목록(비운 뒤) | `list.cleared`(body 13 `--fg-muted` 한 줄, 제목·단계 없음) | — | 입력줄 |
| 최근 영상 없음 | 힌트 한 줄 `url.pasteHint`(caption, `--fg-muted`, `{paste}`는 `platform.md` §6 표기) | — | 입력줄 |
| Worker 허가 목록 비어 있음 | `allowEmpty` | 부트스트랩 안내 | 폼 |

빈 상태 상자는 그룹 상자(`--surface`, `--radius-group`) 안에 상하 `--space-32`, 좌우 `--edge` 패딩, 가운데 정렬이다. 남는 높이를 채우지 않는다(옛 ui-visual의 "남는 높이를 다 쓰되 최소 160"을 폐기, §17-4). 근거: judgment §2.3-3(C의 3단계·C8 문구), C8, `A-FEAT-D2`·`F3`·`F4`, `G-REPEAT-R1`(비운 뒤 상태). 강제: `design-copy` DC7(3단계는 `ol`, 문자열에 번호 금지), `design-gallery`(720×520 빈 상태 스냅 두 종류), `frontend`(완료 기록 유무에 따라 다른 키).

---
## 3. 진행 표시

### 3.1 규칙

| # | 규칙 | 근거 | 강제 |
|---|---|---|---|
| P-1 | 총 크기를 알면 퍼센트(정수, 내림), 모르면 받은 양과 조각 수 같은 절대값, 둘 다 없을 때만 불확정 막대. 가짜 퍼센트를 만들지 않는다 | `G-INTER-DL1`, HIG(`E-APPLE-24`) | `frontend`(ProgressBar: `value` 없으면 퍼센트 글자 숨김) |
| P-2 | **퍼센트는 늘 보인다.** 받는 중·일시정지·중단·실패·연결 대기·링크 갱신 모두 막대 오른쪽 고정 폭 칸에 퍼센트가 있다. 완료·대기·건너뜀만 막대가 없다 | C5, judgment §2.5("퍼센트는 늘 보인다"), C 후보 결함(퍼센트 없음) | `frontend`(상태 × 퍼센트 표시 표 테스트), `design-gallery` |
| P-3 | 막대는 `transform: scaleX` `--progress-tween`(250ms linear)으로 움직이고, 값이 줄면 전환 없이 즉시다. 이어받기에서 처음부터 다시 그리지 않는다 | README D23, `G-INTER-DL5`·`G-INTER-DL6`, `G-LAUNCH-R8` | `frontend`(scaleX·즉시 감소), `design-lint`(width 전환 금지) |
| P-4 | 한 작업 안에서 퍼센트는 뒤로 가지 않는다. 코어 값이 줄어도(재조회·총량 재추정) 표시는 마지막 값을 유지하고 다음 큰 값에서 따라간다 | `G-INTER-DL5`, HIG "고르게" | `frontend`(단조성 테스트) |
| P-5 | 속도는 EMA로 평활한다(코어 `Meter` 5초 창). 표시 갱신은 **1초에 1회**[취향]. 남은 시간은 `content.md` D50 형식("약 14분 남음"), 코어가 `etaSecs`를 주지 않으면 "남은 시간 계산 중" | `E-KO-B5`(EMA만 confirmed, 10~15초 창·1초 갱신은 출처 없음), brief §4.2 | `frontend`(갱신 스로틀 테스트), `rust`(format 골든) |
| P-6 | 완료 전에 100%를 보이지 않는다. 마무리 단계(`finalizing`)는 마지막 퍼센트를 유지하고 상태 줄이 "마무리 중"으로 바뀐다. 100%는 완료 행에서만(막대는 숨김) | brief §6.9-6, `G-INTER-DL5` | `frontend` |
| P-7 | 진행 중 항목에는 [일시정지]와 [취소…]를 함께 둔다. 일시정지는 즉시 반영(낙관적), 취소는 `.part`가 있으면 크기와 무관하게 확인(§5). 두 버튼 사이는 `--gap-sibling` 8(오누름 방지) | HIG "부분 손실이 있으면 일시정지도"(`E-APPLE-24`), `G-INTER-DL7`, WCAG 2.5.8 | `frontend`(버튼 구성 표, `.part` > 0이면 취소가 Dialog를 연다) |
| P-8 | 스피너와 막대를 서로 바꾸지 않는다. 한 자리에는 한 종류 | HIG(확정 24) | `frontend` |
| P-9 | 진행 틱은 라이브 영역에 읽히지 않는다. 상태 전이와 25% 단위만 | `G-INTER-DL11`, brief §6.9-4 | `frontend`(announce 테스트) |
| P-10 | 코어 이벤트 250ms 간격, 화면 갱신은 프레임당 최대 1회 | `G-LAUNCH-R7` | `rust`(`Meter`), `frontend`(폭주 테스트) |
| P-11 | Dock·작업 표시줄 진행은 배치 합계로 초당 1회 이하. 규칙은 `platform.md`(README D29) | g-shell §5.2 | `tauri` |

### 3.2 작업 행의 진행 영역

```
행 안쪽(열 안쪽 760에서 행 좌우 패딩 16을 뺀 728)
┌─ 1줄 ─────────────────────────────────────────────────────────────────┐ 16~32
│ 금요 저녁 방송 - 신작 게임 첫 플레이 (2부) [일반 VOD]              1080p │   제목 body 13(2줄까지, 끝 말줄임) · 배지 18은 제목 뒤 · 화질 muted tabular
├─ 2줄 ───────────────────────────────────────────── 12 ──┬────────────┤  6(막대) / 16(행간)
│ ████████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░  │        58% │   막대 `--progress-h` 6 · 퍼센트 칸 `--pct-w` 40, 오른쪽 정렬
├─ 3줄 ─────────────────────────────────────────────────────────────────┤ 16
│ 받는 중 · 2.3GB / 4.0GB · 12.4MB/s · 약 2분 남음                        │   상태 줄(명사형 조각) muted tabular 말줄임
├─ 4줄(있을 때만) ───────────────────────────────────────────────────────┤ 20
│ 같은 이름의 파일이 이미 있어요.                                           │   본문 줄(해요체 한 문장) `--leading-read
├─ 5줄 ─────────────────────────────────────────────────────────────────┤ 24
│                                            [일시정지]  8  [취소…]  8  [⋯]│   동작 24 버튼, 사이 `--gap-sibling` 8, 끝자리 보정
└───────────────────────────────────────────────────────────────────────┘
행 세로(1줄 제목·막대·상태·동작): 패딩 12 + 16 + 4 + 16(막대 줄 = 퍼센트 행간) + 4 + 16 + 4 + 24 + 패딩 12 = 108. 제목 2줄 +16, 본문 줄 +20. 막대 없는 완료 행 88
```

상태 줄은 **명사형 조각**만, 사건 설명은 **본문 줄**(해요체 한 문장)이다(`content.md` §3.1-2). 동작 줄은 상태 줄 아래 자기 줄이라 폭이 좁아도 접히지 않고, 제목은 2줄까지(`-webkit-line-clamp: 2`) 보여 끝에서 갈리는 "1부/2부"를 구별한다(`G-INPUT-IN2`). 문구는 키로 가리키고 값은 `content.md` §15.1이다.

| 상태 | 막대(`state`) | 퍼센트 | 상태 줄 키 | 본문 줄 키 | 동작(왼쪽부터) |
|---|---|---|---|---|---|
| 받는 중(일반 VOD·클립) | `active` | 있음 | `job.running`(받는 중 · {received} / {total} · {speed} · {remaining}) | — | [일시정지] [취소…] [⋯] |
| 받는 중(빠른 다시보기) | `active` | 있음 | `job.runningSegmented`(… · 조각 {done}/{total} · …) | — | 같음 |
| 준비 중(`resolving`) | `value: null` | 숨김 | `job.status.resolving`(준비 중) | — | [취소] [⋯] |
| 주소 재취득(`reresolving`) | `waiting` | 유지 | `job.phase.reresolving`(주소를 새로 받는 중 · {received} / {total}) | — | [일시정지] [취소…] [⋯] |
| 연결 대기(`waitingNetwork`) | `waiting` | 유지 | `job.status.waitingNetwork`(연결 대기 중 · {elapsed}째 · {received} 받음) | `job.waitingNetwork.body` | [일시정지] [취소…] [⋯] |
| 이어받은 직후 `RECOVERY_NOTICE_MS` | `active` | 있음 | 끝에 `job.resumedFrom`(· {size}부터 이어받음) | — | 같음 |
| 회복 직후(1분 넘긴 단절) | `active` | 있음 | 그대로 | `job.recovered.body` | 같음 |
| 마무리 중(`finalizing`) | 마지막 값 유지 | 마지막 값 | `job.status.finalizing`(마무리 중) | — | [⋯] |
| 대기 | 없음 | 없음 | `job.queued`(대기 중 · 앞에 {n}개) / `job.queuedNext`(대기 중 · 곧 시작) | — | [취소] [⋯] |
| 일시정지하는 중 | 마지막 값 | 유지 | `job.pausing`(일시정지하는 중) | — | [⋯] |
| 일시정지(사용자·앱 종료 모두) | `paused` | 유지 | `job.paused`(일시정지됨 · {received} 받음) | — | [이어받기] [취소…] [⋯] |
| 실패(이어받기 가능) | `failed` | 유지 | 오류 제목(§10.3) | 오류 본문 | [이어받기] [폴더에서 보기] [⋯] |
| 실패(처음부터) | `failed`(막대 있으면) | 유지 | 오류 제목 | 오류 본문 | [처음부터 다시 받기] [⋯] |
| 완료 | 없음 | 없음 | ✓ + `job.completed`(완료 · {size} · {time}) | — | [열기] [Finder에서 보기 / 폴더에서 보기] [⋯] |
| 완료 · 파일 없음 | 없음 | 없음 | ⚠ + `job.completedMissing`(완료 · 파일 없음) | `job.completedMissing.body` | [폴더에서 보기] [처음부터 다시 받기] [⋯] |
| 건너뜀 | 없음 | 없음 | `job.status.skipped`(받지 않음) | `job.skipped.body` | [열기] [덮어쓰고 받기…] [⋯] |
| 멈춘 지 `STALE_DAYS` 넘음 | 그대로 | 유지 | 그대로 | `job.stale.body`({n}일 전에 멈췄어요 · 디스크 {size} 차지) | 그대로 |

- 막대의 색·줄무늬·forced-colors 매핑은 `components.md` §2.20이 원천이다(연결 대기·주소 재취득은 `--accent` 줄무늬 정지, 일시정지 `--border-strong`, 실패 `--danger`).
- 색 세 겹: 막대 색 + 상태 아이콘 + 글자. 상태 레일은 없다(ADR-0003, judgment §2.2 "레일 폐기", `A-VIS-20`).
- [취소…]는 `.part`가 있어 확인 창(D2)을 열 때의 라벨(`action.cancel`)이고 `tone=danger`다. 대기 항목의 [취소](`action.cancelQueued`)는 `.part`가 없어 즉시·`neutral`이다(README D54, `content.md` §5.2).
- `[⋯]` 메뉴: 제목 전체 보기(인라인 펼침, 제목이 잘렸을 때) · 주소 복사(항상) · 처음부터 다시 받기(`.part` 있을 때) · 자세히(실패) · 문제 보고용 정보 복사(실패) · 목록에서 지우기(종료 상태). 아이콘 은유는 foundations §9.1.
- 완료 동작 순서는 README D39([열기] 다음 [폴더에서 보기]). `G-HANDOFF-H1`의 반대 순서는 README가 대체했다(§17-7).

근거: `app.md` §8.5·§8.11(상태 어휘의 원형), judgment §2.2-4(B의 상태 어휘: 건너뜀·원본 바뀜 — 해요체 조각은 `content.md` §3.1-2가 두 층으로 나눴다), README D40(연결 대기), `G-POWER-R11`, `G-REPEAT-R3`·`G-REPEAT-R5`(파일 없음·30일), `A-FEAT-G4`(선두 아이콘 일부만 → 완료·실패·경고에만 아이콘, 나머지는 글자만으로 충분: 색을 쓰지 않기 때문). 강제: `frontend`(`jobs.ts` 상태 → 조각·버튼 표 테스트, 상태마다 한 행), `design-copy`(상태 조각은 명사형, 숫자+단위는 format 함수), `design-gallery`(상태 전부를 `/__gallery`에 그린다. 고정 데이터에 앞 40자가 같고 끝만 다른 제목 둘), `R1`.

---
## 4. 확인과 되돌리기

되돌릴 수 있으면 확인하지 않고 즉시 실행한 뒤 되돌리기를 준다. 되돌릴 수 없는 것만 확인한다(NN/g 확인 대화상자, `G-INTER-CF1`, `E-KO-B1`; brief §6.9-8).

| 동작 | 가역성 | 수단 | 비고 |
|---|---|---|---|
| 완료·건너뜀 항목 목록에서 지우기(파일은 그대로) | 가역 | 즉시 + 토스트 `toast.removed`(목록에서 지웠어요) [되돌리기] | 지연 삭제: 토스트가 보이는 동안은 숨기기만 하고 **토스트가 닫힐 때**(타이머 `TOAST_MS`·[×]·대기열 교체) `remove_job`을 부른다(`G-INTER-CF6`). `G-REPEAT-R1`·`G-REPEAT-D8` |
| 완료 항목 일괄 지우기 | 가역 | 같음(`toast.removedMany`, 개수 포함) | 확인 창 없음. 도움말 `list.clearFinished.help` |
| 대기 항목 취소 | 가역(다시 넣을 수 있음) | 즉시, 토스트 없음, 라벨 [취소](`neutral`) | `.part`가 없다 |
| 받는 중·일시정지 항목 취소(`.part` 있음) | **비가역**(`.part` 폐기) | 대화상자 D2(§5.2), 라벨 [취소…] | 크기와 무관하다(편집 전 512 MiB 미만 즉시 실행은 폐기 — 오누름이 손실로 직결된다, `app.md` 구현 중 변경 67 (나)) |
| 같은 이름 파일 덮어쓰기(건너뜀 행 [덮어쓰고 받기…], 카드 라디오 "덮어쓰기" 뒤 [받기]) | **비가역**(기존 파일 삭제) | 대화상자 D7 | 앱은 사용자의 영상을 지우지 않는다는 원칙의 유일한 예외라 확인한다 |
| 설정 변경 | 가역 | 즉시 저장, 확인 없음 | 쿠키만 [저장] 버튼(`A-DRIFT-K14`) |
| 쿠키 지우기 | 재입력으로 복구 | 즉시 + 인라인 "저장된 값 없음" | 확인 없음 |
| 로그아웃 | 재로그인으로 복구 | 대화상자 D4(받는 중인 다운로드의 운명을 말해야 해서) | README D36 "로그아웃도 같은 규칙" |
| 앱 닫기(받는 중) | 일시정지로 보존 | 대화상자 D1 | — |
| 업데이트 설치(받는 중) | 일시정지로 보존 | 대화상자 D5 | §12 |
| 허가 빼기(Worker) | 비가역(세션 끊김) | 확인 **페이지** | README D54 2단, `web.md` §7.3 |
| 완성 파일 삭제 | — | **앱에 두지 않는다** | 앱은 사용자의 영상을 지우지 않는다(`G-REPEAT-R7`) |

규칙:
- "다시 묻지 않기"는 두지 않는다. 확인이 남은 것은 모두 비가역이라 허용 대상이 아니다(`G-INTER-CF5`). 단어 입력 확인도 쓰지 않는다(`G-INTER-CF7`).
- 되돌리기 토스트의 [되돌리기]는 같은 동작을 다른 곳에서도 할 수 있어야 한다. 지운 항목이 돌아올 곳은 목록이고 다른 경로는 없으므로, 토스트가 사는 동안은 지연 삭제로 **구조적으로** 복구를 보장한다(`G-INTER-NT7`·`G-INTER-CF6`). 되돌리기 토스트는 대기열에서 교체되지 않는다(`components.md` §2.13).

강제: `frontend`(지연 삭제 테스트: 토스트가 살아 있는 동안 [되돌리기] → 항목 복귀, 닫히면 `remove_job` 호출, 둘째 지우기 토스트가 와도 첫 삭제가 먼저 확정되지 않음; `.part` > 0이면 취소가 Dialog를 연다), `rust`(`clear_finished` 전후 파일 존재), `R6`(확인 흐름을 바꾸면 이 표와 대조).

---
## 5. 대화상자

### 5.1 버튼 규칙(D36)

| 규칙 | 값 | 근거 |
|---|---|---|
| 자리 | 버튼 줄은 오른쪽 정렬. **오른쪽 끝 = 안전한 쪽 = 채움(`primary`) = Enter = 기본 포커스**. 그 왼쪽에 실행 쪽 하나 | README D36(사용자 결정 3), HIG 기본 trailing(`E-APPLE-22`), NN/g "위험한 쪽을 기본으로 두지 않는다" |
| 안전한 쪽의 정의 | **대화상자를 연 뒤 아무것도 하지 않은 것과 같은 결과**(현 상태 유지). 보조 규칙 없음 — D3 가져오기도 [나중에]가 오른쪽이다 | README D36. 편집 전 "둘 다 안전하면 연 목적" 보조 규칙은 D3·D5에서 문서마다 다른 답을 냈다(§17-8) |
| 실행 쪽 | 왼쪽. 되돌릴 수 없으면 `secondary tone=danger`(빨간 글자 테두리, 버튼 줄 **왼쪽 끝**으로 띄움), 되돌릴 수 있으면 `secondary neutral`(채움 옆, gap 8) | HIG 파괴적 동작에 Primary 금지(`E-APPLE-21`), README P2, 오누름 거리 |
| 개수 | 2개 | 7종 모두 2개. 3개는 새 패턴(ADR) |
| 라벨 | 결과를 말하는 동사. "예/아니오/확인" 금지. 안전 쪽은 상태를 이어 가는 말(계속 받기·그대로 두기·나중에·로그인 유지), 다른 창을 여는 버튼은 말줄임(…) | `content.md` §5.3(라벨 표의 원천), README D45 |
| Esc | **닫기**(`onclose`). 어떤 버튼도 실행하지 않는다 = 안전한 쪽과 같은 결과 | HIG(취소 대체 수단 Esc, `E-APPLE-22`), `A-DRIFT-K15` |
| 채움 개수 | 포커스할 수 있는 층마다 하나. 대화상자가 열리면 뒤(`inert`)의 [받기]는 셈에서 빠진다 | README P3 |
| OS 분기 | 없다. Windows 관례 [미확인] | README D2·D36 |

강제: `frontend`(Dialog 테스트, `components.md` §2.10: 채움 1개·DOM 마지막·열리면 포커스가 오른쪽·Enter → 오른쪽·Esc → `onclose`만·`tone=danger`면 왼쪽 끝·7종 표의 오른쪽 키 = 호출부 `primary`), `design-gallery`(대화상자 7종 스냅), `R6`, D62 확인 과업 V2·V3.

### 5.2 대화상자 7종

제목·본문·라벨의 **값**은 `content.md` §5.3 표가 소유한다. 이 표는 어느 상황에 어느 대화상자가 뜨고 왼쪽 버튼이 어떤 종류인지만 정한다.

| ID | 언제 | 왼쪽(실행) | 오른쪽(안전·채움·Enter) | 키(`content.md` §15.1) |
|---|---|---|---|---|
| D1 창 닫기 | 받는 중인 영상이 있을 때 창 닫기·⌘Q | `neutral`(일시정지로 보존) | 계속 받기 | `dialog.close.*` |
| D2 받기 취소 | `.part`가 있는 항목의 [취소…] | **`danger`**(받다 만 파일 삭제) | 계속 받기(받는 중) / 그대로 두기(일시정지 중) | `dialog.cancel.*` |
| D3 이전 설정 | 로그인 뒤 홈 첫 진입에 예전 설정을 찾았을 때 | `neutral`(가져오기) | 나중에 | `dialog.legacy.*` |
| D4 로그아웃 | [로그아웃…] | `neutral`(재로그인으로 복구) | 로그인 유지 | `dialog.logout.*` |
| D5 업데이트 재시작 | [지금 업데이트] 뒤 받는 작업이 있을 때 | `neutral`(일시정지로 보존) | 나중에 | `dialog.update.*` |
| D6 데이터 요금 연결(v1.1) | `METERED_CONFIRM_BYTES` 넘는 작업 추가 | `neutral`(그래도 받기) | 받지 않기 | `dialog.metered.*` |
| D7 덮어쓰기 | 건너뜀 행 [덮어쓰고 받기…], 카드 "덮어쓰기" 선택 뒤 [받기] | **`danger`**(기존 파일 삭제) | 그대로 두기 | `dialog.overwrite.*` |

- D5에서 [나중에]가 채움인 것은 `A-FEAT` P0(4)의 "업데이트의 나중에가 primary"를 결함으로 본 시각과 다르다. 그 감사는 **기준 없음**을 지적한 것이고, D36은 기준을 "아무것도 하지 않은 것과 같은 결과"로 정했다(§17-8). 비기술 사용자가 Enter를 눌러도 받던 영상이 멈추지 않는다.
- 편집 전 초안의 "보고 미리보기" 대화상자는 없앴다. [문제 보고용 정보 복사]는 바로 복사하고 라벨이 "복사했어요"로 바뀐다(README D37). 복사되는 내용에 비밀이 없다는 문장은 랜딩 "막히면" 절과 도움말에 있다(`content.md` §11).
- 로그인 화면이 열린 동안 D3·D5는 뜨지 않는다(`worker.md` 구현 중 변경 62 (가)). D3는 로그인 뒤 홈 첫 진입에 뜬다[잠정: 순서는 적용 PR에서 확인].
- 모달은 한 번에 하나(HIG modality, `E-APPLE-23`). 열린 상태에서 다른 모달 요청은 대기열에 넣는다.

### 5.3 모양과 동작

```
scrim(`--scrim`, `--z-dialog` 50) 위, 창 가운데
┌──────────────────────────── 440 (`--dialog-w) ────────────────────────────┐
│ 20                                                                       20 │
│   ‘금요 저녁 방송 - 신작 게임 첫 플레이 (2부)’ 받기를 취소할까요?             │  title 15/20 600, 두 줄까지(외부 문자열은 clipGraphemes)
│   12                                                                        │
│   2.3GB까지 받았어요. 취소하면 받다 만 파일이 지워지고 되돌릴 수 없어요.        │  body 13, `--leading-read 20
│   20                                                                        │
│   [취소하고 지우기]                                     [   계속 받기   ]   │  28 버튼. danger는 왼쪽 끝(margin-inline-end: auto), 채움은 오른쪽 끝
│ 20                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

| 항목 | 값 | 근거 |
|---|---|---|
| 폭·높이 | `--dialog-w` 440, `max-width`·`max-height` = `calc(100% - 2 * var(--edge))`, 넘치면 본문만 스크롤 | foundations §5.2 [취향], `components.md` §2.10 |
| 면 | `--raised` + `--shadow-dialog`, `--radius-overlay` 12, 패딩 `--space-20`. 다크는 그림자 토큰 안의 안쪽 1px 선 | foundations §6.3·§6.4 |
| 글자 | 제목 title 15/20 600(2줄 이하, `E-APPLE-22`), 본문 body 13 `--leading-read` 20, 제목↔본문 `--space-12`, 본문↔버튼 `--space-20`, 버튼 사이 `--gap-sibling` 8 | foundations §3.2·§4 |
| 요소 | `div role="dialog"` + 뒤의 `main` `inert`(네이티브 `<dialog>`는 [잠정] 보류, `components.md` §2.10) | brief §6.1-9, `E-KO-B3` |
| 열기 모션 | scrim opacity + 상자 `scale(.98→1)` `--motion-slow` 300 `--ease-out`. 닫기 `--motion-base` 200 `--ease-in`. reduce: 1ms(opacity만) | foundations §7.1 |
| 포커스 | 열릴 때 **늘** 오른쪽 채움 버튼에 프로그램 포커스. 링은 `:focus-visible` 휴리스틱(포인터로 열면 안 보이고 키보드로 열면 보인다). Enter는 포커스된 버튼을 누른다(Tab으로 왼쪽에 옮기면 왼쪽). 닫으면 열었던 요소로 복귀. 안에 가둔다 | `A-VIS-26`(마우스로 연 대화상자에 autofocus 링), brief §6.7-1·2, `G-INTER-FC2` |
| scrim 클릭 | 닫지 않는다 | `A-DRIFT-K15` |
| 대상 이름 | 제목에 ‘’(U+2018/2019)로 감싸 넣고, 변수 뒤에 조사가 오지 않게 쓴다 | README D46 |

강제: `frontend`(Dialog 테스트), `design-lint`(`translate(-50%` 금지), `design-gallery`(forced-colors에서 `2px solid CanvasText` 테두리, 320×231에서 버튼 줄 보임).

---
## 6. 폼과 검증

### 6.1 검증 시점

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| 언제 | 제출(Enter·[불러오기])·붙여넣기·드롭 때 **한 번만**. 타이핑 중·blur에는 하지 않는다 | NN/g forms(g-ime §6.4), brief §6.7-5 | `frontend`(타이핑 중 오류 없음) |
| 어디 | 오류를 일으킨 컨트롤 **바로 아래** 인라인(`Notice form=inline tone=danger`, `role="alert"`), 컨트롤에 `aria-invalid="true"` + `aria-describedby` | NN/g(원인 가까이), `A-FEAT-F5`(오류 위치 6종 → 하나) | `frontend`, `design-gallery`(axe) |
| 입력 보존 | 오류 뒤 입력을 지우지 않는다. 다시 붙여넣기 쉽게 전체 선택(`select()`)하되 IME 조합이 끝난 뒤에만 | C6, `G-IME-R3` | `frontend`(조합 중 `select()` 미호출) |
| 오류 테두리 | `aria-invalid`면 `--danger-ink` 1px. hover가 덮지 않는다 | `A-PRIM-T1`(hover가 invalid를 덮던 특이도 버그), README D21 | `frontend`(hover + invalid → danger 테두리 유지), `design-gallery` |
| 입력칸 속성 | `type="text" autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off"`. `type="url"` 금지 | `G-IME-R10` | `frontend`(TextField 속성 단언) |
| Enter | 텍스트 입력의 Enter는 `<form>` 제출에 맡긴다. 입력칸에 직접 Enter keydown을 달지 않는다 | 같은 문서 R3·R5(IME 옛 순서) | `design-lint`(입력칸 `onkeydown`에서 `Enter` 분기 금지 grep) |
| 설정 저장 | 즉시 저장. 쿠키만 [저장] | K14, `app.md` §8.7 | `frontend` |

### 6.2 폼 행(FieldRow)

영상 카드와 설정 화면의 "라벨 · 값 · 동작" 행은 한 패턴이다. 색 역할이 화면마다 반대였던 결함(`A-FEAT-E2`)을 하나로 고정한다.

| 요소 | 값 | 근거 |
|---|---|---|
| 라벨 | body 13 400 `--fg`. 카드 폼은 왼쪽 라벨 열 `--label-w` 80(`components.md` §2.26 FieldRow), 설정 행은 행의 주 텍스트(SettingsRow) | macOS 시스템 설정·`NSGridView` 폼: 라벨은 label color, 값은 secondary(`E-APPLE-11` 구조). README P1 |
| 값(현재 설정값·경로) | body 13 `--fg-muted`, 경로는 `.selectable` + 가운데 말줄임(`platform.md`) | 같음. `A-FEAT-E2` 해소(§17-5) |
| 편집 중인 값 | 입력칸 안 `--fg`(컨트롤이 소유) | — |
| 도움말 | caption 12/16 `--fg-muted`, 라벨 아래 `--space-4`. 12px 단독으로 의미를 전하지 않는다(라벨이 뜻을 가진다) | foundations §3.2 |
| 라벨↔컨트롤 | `--gap-label` 6 | AppKit `NSGridView` 6(`E-APPLE-17`) |
| 행 높이 | 최소 `--row-h` 36, 상하 패딩 `--space-6`, 좌우 `--space-12`(글자 쪽)·`--space-8`(아이콘 버튼 쪽) | foundations §4·§5.1 |
| 폼 행 사이 | `--space-12` | foundations §4 |
| 동작 | 오른쪽 끝, `--control-h-sm` 24 또는 `--control-h` 28, 형제 사이 `--gap-sibling` 8 | foundations §5.1 |
| 접힘(좁은 레이아웃) | 라벨 열이 컨트롤 위로 올라간다(1열). 동작은 다음 줄 오른쪽. 라디오 행·입력칸의 면은 값 열 x에서 시작한다(라벨 거터 침범 없음) | foundations §8 분기 600 + `x-large` 두 블록 [잠정] |

강제: `frontend`(FieldRow 하나만 사용, 라벨·값 색 클래스 단언), `design-gallery`(x-large·320 폭에서 1열 리플로우), `R1`.

### 6.3 선택 컨트롤

| 컨트롤 | 언제 | 근거 |
|---|---|---|
| 라디오 행(`RadioGroup`, 네이티브 `<input type=radio class=sr-only>` + 그린 점) | 2~5개 중 하나(화질, Linux 모양 3개, 글자 크기 3개). 선택 행은 `--accent-soft` 면, 점 `--accent-ink` + 안쪽 고리 `--surface`. 가장 높은 화질 행에 꼬리표 `quality.best` | HIG 라디오 2~5(`E-APPLE-25`), judgment §2.3-4(C의 꼬리표), `components.md` §2.7 |
| 팝업(`Select`) | 숫자 선택(동시 수·조각 수). 5개 넘으면 팝업 | HIG(`E-APPLE-25`) |
| 스위치(`Switch`) | 켬·끔 하나(자동 이어받기, 잠자기 방지, 쿠키 사용) | AppKit 스위치 54×24(`E-APPLE-19`) |
| 세그먼트 | **쓰지 않는다.** Linux 모양·글자 크기는 RadioGroup(2~5개 규칙 안) | 새 컴포넌트를 만들지 않는다(governance §5) |
| `accent-color` | 쓰지 않는다(하한 밖). 점은 직접 그린다 | foundations §11, `A-FEAT-D6` |

강제: `design-lint` DL10(`accent-color` 금지), `frontend`.
### 6.4 비활성 컨트롤

비활성 버튼은 사유가 있으면 보인다(`aria-disabled` + `aria-describedby`로 이유 문장 연결, 포커스는 간다). 사유 없는 비활성은 두지 않고 숨긴다([완료 항목 지우기]는 완료가 0개면 **숨김**, `A-VIS-29`). 비활성 색은 `--fg-disabled` 전용(opacity 금지). 근거: brief §6.9-9, README D21, `A-VIS-08`·`A-VIS-29`. 강제: `frontend`(비활성 버튼에 `aria-describedby` 또는 미렌더), `design-lint`(opacity 비활성 금지).

### 6.5 영상 카드의 폼

| 행 | 내용 | 규칙 |
|---|---|---|
| 화질 | 라디오 행 3~5개: `1080p` `60fps` … `약 7.8GB`. 꼬리표는 늘 가장 높은 화질 행. 기본 선택 = 마지막에 고른 화질이 이 영상에 있으면 그 행, 없으면 가장 높은 화질(기억된 낮은 화질이 조용히 기본이 되지만 꼬리표가 더 좋은 행을 가리킨다 [잠정] — D62 UT4에서 "가장 높은 화질"을 찾는지 본다) | `G-REPEAT-R6`, `components.md` §2.7 |
| 저장 폴더 | 값(경로, muted, selectable) + [변경…] | 바꾸면 설정의 기본 폴더도 바뀐다(`app.md` §8.3) |
| 파일 이름 | 입력칸(`--fg`) + ".mp4" 라벨 + [원래 이름으로](ghost sm, `filename.reset` — "되돌리기"는 목록 지우기 토스트의 말이라 쓰지 않는다, W1). 150ms 디바운스로 `check_output`. 잘리면 아래 `filename.willSave`(caption muted) | `app.md` §8.3. 한글을 치는 칸이라 Enter에 동작을 달지 않고 Mod+Enter도 IME 가드(§8) |
| 카드 안 경고 | 해당 행 **아래** `Notice variant=inline`: 같은 이름 파일(warning + 라디오 `conflict.number`/`conflict.overwrite`, 덮어쓰기를 고르면 [받기]가 D7을 연다), 받다 만 파일(neutral `conflict.partial.*` + [처음부터 다시 받기]), 다른 화질 `.part`(neutral `conflict.partialOther`), 이미 목록에 있음(neutral `conflict.inQueue` + [목록에서 보기], [받기] 비활성 + 사유), 본인 영상 아님(danger `notOwnContent`, [받기] 비활성 + 사유), 종류 차단 B5(warning `blocked.kind`: "지금 받을 수 없는 종류예요: {kind}", [받기] 비활성) | `app.md` §6.4, README D41, `G-OUTAGE-R12` |
| 바닥 | [닫기](secondary) [받기 ⌘↩](primary, 층의 유일한 채움). `position: sticky; bottom: 0`(카드가 길어도 보인다, foundations §8) | README D42(불러오기는 테두리), `A-FEAT-D11` |

---

## 7. 붙여넣기 · 드롭 · 클립보드 제안

| 경로 | 동작 | 근거 |
|---|---|---|
| 직접 입력 | Enter 또는 [불러오기](secondary) | `app.md` §8.10 |
| 입력줄에 붙여넣기 | 입력칸이 비었거나 전체 선택이면 **곧바로 불러온다** | 같음 |
| 입력줄 밖 Mod+V | 입력줄에 넣고 곧바로 불러온다. 힌트 `url.pasteHint`("{paste}로 붙여넣으면 바로 불러와요", `{paste}`는 `platform.md` §6) | judgment §2.2-2(B의 힌트) |
| 드롭 | 창 어디든. 드래그 중에는 종류(`text/uri-list`·`text/plain`, `Files` 없음)만 보고 `DropOverlay`(`components.md` §2.27)를 띄우고 `drop`에서 추출 | `G-IME-R8`, `app.md` 구현 중 변경 42 |
| 클립보드 제안 | 창이 **블러 뒤 첫 포커스**를 받을 때 Rust가 클립보드를 읽어 치지직 주소면 입력줄 아래 `Notice variant=inline tone=neutral icon=clipboard-paste`(`clipboard.suggest` + 주소 + [불러오기] secondary sm + [×]). macOS는 `accessBehavior == alwaysAllow`일 때만, 아니면 끔. 같은 값은 한 번만 | README D56, `G-IME-R6` |
| 최근 영상 [다시 열기] | 곧바로 불러온다 | `app.md` §8.10 |

규칙:
1. **다섯 경로는 한 추출기를 거친다.** 앞뒤 글·줄바꿈·괄호·따옴표·끝 구두점·붙은 조사를 견디고, 판정은 코어 `parse_content_url`이 한다. 추출에 성공하면 입력칸을 정리된 주소로 바꾼다. 실패하면 "글에서 치지직 주소를 찾지 못했어요"(인라인, 입력 보존)(`G-IME-R1`·`G-IME-R2`). 강제: `rust`·`frontend`(같은 골든 JSON `testdata/synthetic/url-extract.json`).
2. **드롭은 가속기이고 유일한 경로가 아니다.** 안내 문구는 "끌어다 놓기"만 말하지 않는다(`G-INPUT-IN9`). 강제: `e2e-web`(드롭 없이 붙여넣기만으로 받기 완료).
3. 클립보드 읽기는 Rust command 안에서만 하고 웹뷰에 클립보드 글을 보내지 않는다. JS에 클립보드 플러그인 권한을 주지 않는다(같은 문서 R6·R7). 강제: `frontend`(capabilities 검사 "플러그인 권한 0개").

```
클립보드 제안(입력줄 아래, `Notice variant=inline tone=neutral`, 높이 `--row-h` 36)
┌────────────────────────────────────────────────────────────────────────┐
│ 📋 복사한 주소가 있어요 · https://chzzk.naver.com/video/1234567…  [불러오기] [×] │
└────────────────────────────────────────────────────────────────────────┘
  아이콘 `clipboard-paste` 20 muted · 주소 `.selectable` 말줄임 · [불러오기] secondary 24 · [×] 24 (`clipboard.suggest`)

드롭 오버레이: `components.md` §2.27(라벨 `drop.hint` "여기에 놓으면 불러와요")
```

- 오버레이는 반투명 면으로 본문을 덮지 않는다(`A-FEAT-S4`: 명세 "바깥 내용은 그대로"와 88% 덮개의 차이 해소). 강제: `design-lint`·`design-gallery`(`components.md` §2.27).

---

## 8. 키보드와 단축키

| 키(macOS / 그 외) | 동작 | 비고 |
|---|---|---|
| ⌘L / Ctrl+L | 입력줄로 포커스 | |
| ⌘V / Ctrl+V(입력칸 밖) | 입력줄에 붙여넣고 불러오기 | §7. 힌트 표기는 `{paste}` |
| Enter(입력줄) | 불러오기 | `<form>` 제출 |
| ⌘↩ / Ctrl+Enter(카드) | 받기 | IME 가드 뒤에만. 버튼 안 `kbd` 힌트 |
| Esc | 가장 안쪽부터: 불러오기 취소 → 카드 닫기 → 대화상자(안전한 쪽) → 설정에서 뒤로 | 메뉴·토스트는 Esc로 닫힌다(토스트는 포커스가 안에 있을 때만) |
| ⌘, / Ctrl+, | 설정 | macOS는 메뉴 가속키가 먼저 받는다(`platform.md`) |
| 목록: ↑↓ | 항목 이동(roving tabindex) | K16 |
| 목록: Space | 일시정지 ↔ 이어받기 | |
| 목록: Enter | 완료 항목은 [열기], 그 밖은 첫 동작 버튼 | |
| 목록: Delete | 종료 항목은 목록에서 지우기(되돌리기 토스트), 진행 항목은 취소(D2) | |
| Tab / Shift+Tab | 시각 순서대로. 양수 `tabindex` 금지 | `G-INTER-FC1` |
| ⌘W·⌘M·⌘Q / Alt+F4 | OS 창 동작. ⌘Q는 `request_quit` 가드 | `platform.md` NS-14 |

규칙:
1. **모든 동작에 버튼이 있다.** 단축키는 보조 힌트다(brief §6.7-7). 힌트 표기는 버튼 라벨 뒤 `Kbd`(caption 12, `--radius-badge`, `--surface-2`)이고 OS별 기호(`⌘`·`⇧`·`↩` / `Ctrl`·`Shift`·`Enter`)는 `platform.md` §6 표에서만 온다(이 문서의 `⌘V`·`⌘↩`는 macOS 예시다). 강제: `design-copy` DC9(단축키 기호가 copy deck 문자열에 직접 박히지 않음), `frontend`.
2. **창·문서 수준 keydown은 첫 줄에서 `isImeKey(e)`(`isComposing || keyCode === 229`)를 거른다**(`G-IME-R4`). 강제: `design-lint` DX(keydown 핸들러 파일이 `isImeKey`를 import하는지 grep), `frontend`(옛 순서 합성 테스트).
3. 브라우저 키(F5·Ctrl+R·Ctrl+F·Ctrl+P·F12·Alt+←→, macOS ⌘R·⌘P·⌘F·⌘[ ])는 막는다. 편집 키는 절대 막지 않는다. 목록은 `platform.md`(NS-2). 강제: `e2e-web`.
4. 메뉴(`Menu`)는 ↑↓·Home·End·Enter·Space·Esc, 글자 타이핑 점프 없음. 비활성 항목은 `aria-disabled`로 닿을 수 있다(`A-PRIM-X4` 해소). 강제: `frontend`.

---

## 9. 포커스 관리

| # | 규칙 | 근거 | 강제 |
|---|---|---|---|
| F-1 | 포커스 순서 = 시각·읽는 순서 | `G-INTER-FC1` | `design-gallery`(axe tabindex) |
| F-2 | 대화상자: §5.3(늘 오른쪽 버튼). 메뉴: 열면 첫 항목(키보드) 또는 메뉴 컨테이너(포인터), 닫으면 트리거로 복귀 | `G-INTER-FC2` | `frontend` |
| F-3 | 토스트·배너는 포커스를 가져가지 않는다. 제출 직후 사용자가 반드시 읽어야 하는 오류(입력줄 오류)만 **첫 오류 Notice**로 옮긴다 | `G-INTER-FC3`, GOV.UK | `frontend` |
| F-4 | 항목이 사라지면 다음 항목 → 없으면 이전 → 목록이 비면 입력줄. `body`로 떨어지지 않는다 | `G-INTER-FC4` | `frontend`(지우기·취소 뒤 `document.activeElement`) |
| F-5 | 화면 전환(홈 ↔ 설정 ↔ 로그인) 뒤 포커스는 새 화면 제목(`h1`, `tabindex=-1`, 링 숨김) | `G-INTER-FC5` | `frontend` |
| F-6 | 불러오기가 끝나면 카드 제목(`tabindex=-1`)으로, [받기] 뒤에는 입력줄로 | `app.md` §8.10 | `frontend` |
| F-7 | sticky 입력줄(`--control-h` + `--space-8`)이 포커스를 가리지 않게 스크롤 영역 `.main`에 `scroll-padding-top: calc(var(--control-h) + var(--space-8))`을 둔다. 툴바는 스크롤 영역 밖이라 계산에 없다(`platform.md` §5) | WCAG 2.4.11(`E-KO-B3`), `G-INTER-FC6` | `design-gallery`(마지막 보이는 행에서 ↑로 올라갈 때 가려짐 없음) |
| F-8 | 링은 `:focus-visible`(버튼류), 입력칸은 브라우저 휴리스틱. `[data-focus-container]`(화면 제목·카드 제목·대화상자 컨테이너)만 링 숨김. 포인터로 누른 컨트롤에 링을 그리지 않는다 | README D20, `G-SHELL-NS11`, `components.md` §0.3 | `design-lint` DL8(`outline: none` 금지), `design-gallery`(forced) |
| F-9 | 포커스가 있는 창(`data-window-active`)만 선택 면이 파랗다. 비활성 창은 회색 | foundations §10 | `frontend` |

---

## 10. 오류 회복

### 10.1 네 층

| 층 | 무엇 | 어디 | 언제 |
|---|---|---|---|
| L0 | 제목 + 본문 한 줄 + 동작 버튼(1~3개). 이것만으로 다음 행동이 나온다 | Notice(인라인·행) | 모든 오류 |
| L1 | "자세히": 오류 코드(`http-404` 꼴), 경로·원문 메시지(`.selectable`) | 인라인 Notice는 `Disclosure variant=inline`(들여쓰기 0)으로 본문 아래, 행은 [⋯] 메뉴 항목 → 행 아래 펼침 | 모든 오류 |
| L2 | "도움말 보기: {주제 이름}" 텍스트 링크 하나 | 동작 버튼 줄과 **분리**된 줄 | `helpId`가 있는 오류 |
| L3 | 도움말 시트 안 "웹에서 보기" | 앱 안 도움말 | 온라인일 때 |

규칙: **오류 코드·HTTP 번호는 제목·본문에 쓰지 않는다**(L1에만). 동작 버튼은 3개 이하이고 도움말은 버튼이 아니라 링크다. 본문이 말하는 버튼([문제 보고용 정보 복사])은 L0에 있다. "다시 시도해 주세요"를 단독으로 쓰지 않는다. 근거: README D51, `G-HELP-E1`~`G-HELP-E6`(Apple·Microsoft·GOV.UK·NN/g 네 출처 일치), C6. 강제: `design-copy` DC8(제목·본문에 `코드`·`HTTP \d`·`E\d{3,}` 패턴 금지), `frontend`(`errorCopy` 코드별 `actions`가 `content.md` §15.2 버튼 열과 1:1, `actions.length ≤ 3`, `helpId` 매핑 전수).

### 10.2 위치

오류는 **그 오류를 일으킨 컨트롤 바로 아래**에 둔다. 설정 저장 실패만 어느 행의 실패인지 알 수 없으므로 배너 B2다.

| 오류 | 자리 |
|---|---|
| 주소 잘못됨·불러오기 실패(API·치지직·네트워크) | 입력줄 아래 인라인 |
| 받기 등록 실패(`enqueue`·`check_output`) | 카드 바닥 버튼 줄 **위** 인라인 |
| 작업 실패 | 행 안(§10.3) |
| 쿠키 저장 실패 | [저장] 버튼 아래 |
| 이전 설정 가져오기 실패 | 그 섹션 아래 |
| 설정 저장 실패 | 배너 B2 |
| 로그인 실패·거부·끊김 | 로그인 패널 안(§13) |
| 업데이트 실패 | 배너 B4 자리 |

근거: `A-FEAT-F5`. 강제: `frontend`(오류 코드 × 자리 표 테스트), `e2e-web`(`errors.spec.ts`가 모든 코드를 그린다).

### 10.3 작업 행의 실패

```
┌───────────────────────────────────────────────────────────────────────┐
│ [빠른 다시보기]  주말 합방 1부                                   1080p │
│ ██████████████████████████████████████░░░░░░░░░░░░░░░░░░   │     67% │  채움 `--danger`
│ ⊗ 저장 공간이 부족해요                        [이어받기][폴더에서 보기][⋯]│  `circle-x` `--danger-ink` 16 · 제목 body 13 `--fg`
│   공간을 비운 뒤 이어받으면 받던 곳부터 이어가요. 받은 부분은 그대로 있어요. │  본문 body 13 `--fg-muted, `--leading-read 20, 아이콘 폭만큼 들여쓰기
└───────────────────────────────────────────────────────────────────────┘
```

- 세 겹: 막대 `--danger` + ⊗ 아이콘 + 글자. 행 테두리를 빨갛게 하지 않고 레일도 없다(`A-VIS-20` 5겹 해소, README ADR-0003).
- 상태 줄 = 오류 **제목**(L0), 그 아래 **본문 한 줄**(C 후보 문구, judgment §2.3-1: 현우의 "처음부터 받게 될까" 불안에 답한다). 본문이 없는 오류는 한 줄로 끝난다.
- 자동 재시도 중이면 본문 대신 "{n}초 뒤 다시 시도해요"(`G-INTER-DL8`). 연결 대기는 실패가 아니다(§3.2).
- 동작: 이어받기 가능 [이어받기] [폴더에서 보기] / 불가 [처음부터 다시 받기] / 영상이 치지직에서 사라짐 [받다 만 파일 지우기](`G-REPEAT-R8`). 본문이 "문제 보고용 정보를 복사해"를 말하는 코드는 [문제 보고용 정보 복사]가 동작 줄에 있다. L1은 [⋯].
- 진단 3분류(`local`/`service`/`unknown`)에 따라 제목·본문이 갈린다. 사용자의 인터넷을 먼저 탓하지 않는다(README D41, g-outage §5.5). 문구는 `content.md`.

강제: `frontend`(실패 행 렌더: 아이콘·제목·본문·버튼 ≤ 3), `design-copy`, `design-gallery`(라이트·다크·forced에서 실패 행).

### 10.4 서비스 변경 의심(서킷 열림)

같은 종류에서 서로 다른 영상 `CIRCUIT_FAILURES`(3, foundations §14 [잠정])건이 연속으로 읽기 오류면 자동 재시도·자동 이어받기를 멈추고, 해당 종류 카드에 인라인 `circuit.open`("치지직이 바뀐 것 같아요 · 영상 {n}개를 연달아 읽지 못했어요")을 둔다. 공지(B5)가 있으면 공지 문구가 우선한다. 근거: `G-OUTAGE-R11`(임계값은 그 문서의 판단, 측정 근거 없음 → ADR-0009). 강제: `rust`(서킷 상태 머신), `frontend`(카드 인라인).

---

## 11. 첫 실행

| 순서 | 보이는 것 | 규칙 | 근거 |
|---|---|---|---|
| 0 | 흰 창 없음 | 창은 `visible:false`로 만들고 첫 그림 뒤 `show`. 안전장치 `SHOW_DEADLINE_MS`(1.5초, foundations §14). 창·웹뷰 배경은 테마별 `--bg` | README D30, `G-LAUNCH-R1`·`G-LAUNCH-R2`(`platform.md`) |
| 1 | 로그인 첫 화면(§13) | 비공식 고지·받는 것·받지 않는 것·처리방침 링크가 스크롤 없이 보인다 | C2·C7·C8 |
| 2 | 홈 빈 상태(§14.1) | 3단계 안내. 입력줄에 포커스 | NN/g 빈 상태 |
| 3 | D3 이전 설정 대화상자(있을 때만) | 로그인 뒤 홈 첫 진입에 한 번 | §5.2 [잠정] |
| 4 | 업데이트 확인 | 첫 성공 갱신 직후 한 번, 배너로만. 첫 실행에서 창을 띄우지 않는다 | README D57, `G-INSTALL-R9` |

하지 않는 것: 온보딩 캐러셀, 가입 유도, 권한 요청 선행 화면, 알림 권한 요청(권한 창이 생기는 방식으로 바뀌면 첫 [받기] 때)(users §1.1 함의, `G-SHELL-NS25`). 강제: `tauri`(`visible:false`·`backgroundColor`), `e2e-web`(첫 실행 흐름 spec), `design-gallery`(로그인 첫 화면 720×520에서 고지가 뷰포트 안).

---

## 12. 업데이트

| 순간 | 수단 | 모양 | 근거 |
|---|---|---|---|
| 새 버전 발견 | 배너 B4(neutral) | ⓘ `update.banner`("새 버전이 있어요: {version}") [지금 업데이트](secondary sm) [×](이번 실행 동안 숨김. [나중에]는 [×]와 같은 일이라 두지 않는다) | README D46(조사 재구성), D57 |
| 받는 중 | 같은 배너, 닫기 없음 | `update.downloading`("업데이트 받는 중 · {percent}", 막대 없음) | `worker.md` 구현 중 변경 77 |
| 설치 직전, 받는 작업 있음 | 대화상자 D5 | §5.2 | README D36 |
| 설치 | 배너 `update.installing`("설치하고 다시 시작하는 중") | Windows는 앱이 종료된다(`passive`) | Tauri updater 문서(`G-INSTALL-R10`) |
| 실패 | 같은 배너 자리, **warning**(지금 버전은 계속 쓸 수 있어 막힌 것이 아니다) | `update.failed` + `update.failed.help` [다시 시도] [×] | README D57, `G-INSTALL-R11`, `components.md` §2.12 tone 기준 |
| 서명 확인 실패 | 같은 자리, danger | `update.untrusted` [×] | `worker.md` §11.6 |
| 수동 확인 | 설정 › 정보 행 [업데이트 확인] + 결과 인라인 status 한 줄(`settings.about.upToDate` / `checkFailed` + `checkFailed.help`) | 늘 보이되 상태를 문구로 | README D57 |
| 버전 표기 | 설정 › 정보 행 | "0.1.2"(v 없음). 코어 버전은 [정보 복사]에만 | README D57 |

규칙: 업데이트는 사용자가 일하는 중에 창을 띄우거나 포커스를 가져가지 않는다(Sparkle 관례). "자동으로 업데이트돼요"를 약속하지 않는다. 강제: `frontend`(`update.test.ts` 상태 표), `design-copy`(`v\d` 금지, "자동으로 업데이트" 금지), `e2e-web`.

---

## 13. 로그인 첫 화면(C2·C7)

세 후보 모두 목업하지 않았고 README §6-12가 이 문서의 몫으로 넘긴 화면이다(참조 목업 app-11). 루프백 리디렉션(RFC 8252 §7.3, 폴링·확인 코드 제거)을 반영한다. 루프백은 v0.3.0에 들어갔고 이 절은 그 구현(`app.md` 구현 중 변경 65·66, `worker.md` 구현 중 변경 88·92·93, `app/src/lib/auth.ts` `loginScreen`·`LoginView.svelte`)을 기준으로 적었다(`G-PRIVACY-R9`·`G-PRIVACY-R17`). `app.md` §8.9의 확인 코드 화면은 쓰지 않는다(§17-6).

```
idle (720 창. 열 안쪽 680, 패널 440 가운데, 위 여백 `--space-40`)
┌────────────────────────────────────────────────────────────────────────┐
│ 치지직 다운로더                                                        │ 44 툴바(계정·설정 없음)
│────────────────────────────────────────────────────────────────────────│
│                                                                        │ 40
│              ┌──────────────── 440 ────────────────┐                   │
│              │ 20                                   │                   │
│              │  로그인이 필요해요                     │ auth.signedOut.title display 17/22 600 │
│              │  12                                   │                   │
│              │  허가받은 채널만 쓸 수 있어요. 치지직    │ auth.intro body 13 `--fg`, read 20 │
│              │  계정으로 로그인해 주세요.              │                   │
│              │  12                                   │                   │
│              │  ┌ ⓘ ─────────────────────────────┐  │ Notice inline neutral │
│              │  │ 비공식 도구예요 · 네이버·치지직과   │  │ NOTICE_SHORT      │
│              │  │ 제휴하거나 보증받지 않았어요        │  │                   │
│              │  └──────────────────────────────────┘  │                   │
│              │  12                                   │                   │
│              │  로그인하면 채널 이름과 채널 ID만 알게   │ auth.consent body 13 `--fg`(muted 아님: 신뢰 판단 글자), read 20 │
│              │  되고, 네이버 비밀번호는 받지 않아요.    │                   │
│              │  언제든 설정 › 계정에서 로그아웃할 수    │                   │
│              │  있어요.                               │                   │
│              │  20                                   │                   │
│              │  [        치지직으로 로그인        ]    │ primary 28, 전폭  │
│              │  12                                   │                   │
│              │  개인정보 처리방침                      │ ghost sm 링크형, .edge-start │
│              │ 20                                   │                   │
│              └──────────────────────────────────────┘                   │
│                                                                        │
│  (B5 공지가 있으면 패널 아래 한 줄)  (받는 중인 작업이 있으면 runningNote)  │
└────────────────────────────────────────────────────────────────────────┘
```

| 상태 | 패널 내용 | 동작 |
|---|---|---|
| `checking` | 스피너 20 + `auth.checking`("로그인 상태 확인 중") + `auth.checking.body`(최대 {secs}초, `AUTH_CHECK_TIMEOUT_MS`) | 넘으면 [다시 연결] [다시 로그인] |
| `idle` | 위 그림 | [치지직으로 로그인] |
| `pending` | `auth.pending.title` + `auth.pending.body`(브라우저에서 마치면 자동으로 넘어간다) + 상태 조각 `auth.pending.remaining`(남은 시간 {mmss}, `tabular-nums`, 1초마다 갱신) → [브라우저 다시 열기](primary) [취소] → `auth.browserHelp`(명사구 라벨 "브라우저가 열리지 않을 때", 한 줄) 아래 줄에 링크형 [로그인 주소 복사](라벨에 이어 붙여 문장의 일부로 만들지 않는다: `content.md` §2 조각 금지·§6.2, 지금 `LoginView`는 한 `<p>` 안에 이어 붙인다) → `auth.pending.sameDevice`(이 컴퓨터의 브라우저에서 열기, 다른 기기 불가) → `auth.otherAccount.help` | [브라우저 다시 열기] [취소] [로그인 주소 복사] |
| `pending` · stuck | 기다린 지 90초가 지나면(남은 시간 ≤ `PENDING_STUCK_REMAINING_SECS`, 10분 기한 기준, foundations §14) `auth.pending.sameDevice` 아래(`auth.otherAccount.help` 위)에 `auth.pending.stuck`(`role="status"`: 브라우저에 "연결할 수 없다"는 오류가 보이면 다시 로그인) + [다시 로그인](secondary). 이 버튼은 지금 로그인을 취소하고 새로 시작한다(`auth.restartLogin()`, `worker.md` 92 (사)·94 (가): 취소가 실패하거나 여전히 pending이면 새 로그인을 부르지 않는다) | 위 + [다시 로그인] |
| `denied` | ⊗(`circle-x` `--danger-ink`, 막힘 = danger) `auth.denied.title` / `auth.denied.body` + 행 `auth.channelLabel`: ‘{channelName}’ + 안내 속 링크(다른 계정으로 로그인하려면 브라우저에서 네이버 로그아웃 먼저) | [다시 시도](primary) |
| `removed` | `auth.removed.*` + 같은 채널 행 + 안내 속 링크(`denied`와 같음, `worker.md` 87) + `auth.runningNote` | [다시 시도](primary) |
| `expired`·`revoked`·`reuse`·`lost`·`loginTimeout` | 제목·본문은 `content.md`. 누가 끊었는지 말하지 않는다 | [다시 로그인] |
| `network`·`server`·`unknown`·`graceExpired` | 탓하지 않는 문구 + "받던 다운로드는 계속돼요" | [다시 연결] |
| `receiver`(error) | 수신기를 열지 못함(`AuthReason` `receiver`, `app.md` 66 (다)): ⚠ `auth.receiver.title` / `auth.receiver.body`. 다른 계정 안내 없음 | [다시 로그인] |
| `cancelled` | `auth.cancelled.title`("로그인을 취소했어요") | [치지직으로 로그인] |

규칙:
1. 패널 폭은 `--dialog-w` 440(foundations §5.2 "대화상자와 로그인 패널"), 그룹 상자(`--surface`, `--radius-group`), 패딩 `--space-20`. 가운데 정렬은 로그인 패널·빈 상태·대화상자에만 허용한다. 근거: `A-FEAT` §10-6(가운데 정렬 범위 모순 해소).
2. 비공식 고지(`NOTICE_SHORT`)·받는 것·받지 않는 것·끊는 길(로그아웃 경로)·처리방침 링크는 **스크롤 없이 720×520 안에** 있다(C2·C7). 강제: `frontend`(로그인 뷰가 네 키 `auth.intro`·`notice.short`·`auth.consent`·`auth.privacy`를 렌더, 필수), `design-gallery`(720×520 기본 글자·마우스 조합에서 요소가 뷰포트 안, 관찰), `design-copy` DC6(두 deck의 고지 문자열 동일).
3. 로그인 화면이 열린 동안 배너·[설정]·D3·단축키는 꺼진다(`worker.md` 구현 중 변경 62 (가)). 받는 중인 작업이 있으면 패널 아래 `runningNote` 한 줄.
4. 모든 상태는 (1) 탓하지 않고 (2) 다음 행동 하나를 주고 (3) 다운로드가 계속된다는 것을 말한다(`G-PRIVACY-R11`). 강제: `frontend`(모든 `AuthReason`에 버튼 하나와 계속 문구 존재).
5. 주 버튼은 이 화면에서 [치지직으로 로그인]·[브라우저 다시 열기](pending)·[다시 시도]·[다시 로그인]·[다시 연결] 중 하나만 채움이다(창에 하나). pending의 stuck [다시 로그인]은 secondary다(채움은 [브라우저 다시 열기]에 남는다).
6. 로그인 직후 홈에 토스트 `toast.signedIn`("‘{channelName}’ 채널로 로그인했어요", `TOAST_MS`). 계정 불일치를 바로 알게 한다(`G-PRIVACY-R11`).

Worker 쪽 확인 페이지(`loginWarning` + [계속], 확인 코드 없음)와 웹 흐름·grant 없는 실패의 결과 페이지(`/auth/done`)는 `web.md` §6이 소유한다. 앱 흐름의 브라우저 결과 페이지(로그인했어요 · 허가 없음 · 취소 · 실패)는 Worker가 아니라 **앱 수신기**가 `127.0.0.1`에서 그린다(`app.md` 66 (라), 문구는 `content.md` §15.4 `ReceiverPage`, 모양은 `web.md` §6.5).

---

## 14. 화면 구성

### 14.1 공통 뼈대

```
창(960×700 기본, 720×520 최소). 네이티브 타이틀바는 그림 밖.
┌──────────────────────────────────────────────────────────────────────────┐
│ ←20→ 치지직 다운로더                               [채널이름 ▾] [⚙] ←20→│ 툴바 44, `--bg`, 밑선 `--separator`
│──────────────────────────────────────────────────────────────────────────│
│        ┌─────────────── 열 `--content-max` 800 ───────────────┐          │
│        │←20→                                             ←20→│          │ 열 안쪽 760
│        │ (배너 B*, 있을 때만, 열 첫 요소)                        │          │ 위 여백 `--space-16`
│        │ [ 주소 입력칸                            ] [불러오기]  │          │ 입력줄 28, sticky(top 0, .main 안)
│        │ {paste}로 붙여넣으면 바로 불러와요                      │          │ url.pasteHint caption, 위 6
│        │                                                       │          │ 24
│        │ 최근 영상                                             │          │ recent.title 섹션 제목 body 13 600
│        │ ┌───────────────────────────────────────────────────┐ │          │ 그룹 상자
│        │ │ 금요 저녁 방송 - 신작 게임 첫 플레이 (2부)  [다시 열기]│ │          │ 행 36, 둘째 줄 caption "빠른 다시보기 · 10월 3일"
│        │ └───────────────────────────────────────────────────┘ │          │
│        │                                                       │          │ 24
│        │ 다운로드                            [완료 항목 지우기]  │          │ 섹션 제목 + 보조 동작 ghost 24
│        │ 받는 중 2                                              │          │ 그룹 머리 list.group.* caption 12 600 muted
│        │ ┌───────────────────────────────────────────────────┐ │          │
│        │ │ (작업 행, §3.2)                                     │ │          │
│        │ └───────────────────────────────────────────────────┘ │          │
│        │                                                       │          │ 아래 여백 `--space-32`
│        └───────────────────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────────────────────┘
```

| 요소 | 값 | 근거 |
|---|---|---|
| 툴바 | `components.md` §2.28 Toolbar: 높이 `--toolbar-h` 44, 안쪽은 `.col`, 왼쪽 "치지직 다운로더"(body 13 600; 마크가 나오면 `--icon-md` 20 + 이름), 오른쪽 계정 Menu(`trigger="text"`, ‘{channelName}’ ▾, 글자 `--fg`) · [⚙](IconButton 28, `.edge-end`). 설정 화면에서는 왼쪽 [←](IconButton 28, `.edge-start`) + "설정"(display 17 600, [←]와 `--gap-sibling`), 오른쪽은 **같은 자리**에 계정 Menu + [⚙](`aria-current="page"`, 눌림 모양, 누르면 아무 일도 없음). "설정" 글자 x는 홈의 앱 이름 x와 다르다(28 + 8 들어감; 맞출 근거가 없고 [←] 아이콘 가장자리가 정렬선을 지킨다) | README D26(사용자 결정 2), `A-FEAT-A3`·`A6`(헤더 좌우 비대칭·구성 변동) |
| 툴바 안쪽 정렬 | 툴바의 왼쪽 글자 x와 오른쪽 아이콘 상자 x(끝자리 보정 뒤)는 열의 안쪽 x와 같다. 960 창에서 열이 가운데(좌우 80)면 툴바 내용도 그 열 안에 든다 | README D24 "툴바 안쪽·배너·토스트·대화상자 같은 열 기준"(`A-VIS-02`~`A-VIS-04`) |
| 열 | `--content-max` 800(가장자리 20 포함, 안쪽 760), 가운데. 위 `--space-16`, 아래 `--space-32` | README D24(사용자 결정 5), ADR-0001 |
| 입력줄 | `TextField` 28 + [불러오기](secondary 28, `loading` 가능), 사이 `--gap-sibling` 8. 스크롤 영역 `.main` 안 열 위에서 `position: sticky; top: 0`, 배경 `--bg`, 아래 `--space-8` 패딩, `--z-sticky` | foundations §7.2(sticky 주소 입력줄), `A-FEAT-R2`(520 높이에서 입력줄이 밀려 나감) |
| 힌트 | `url.pasteHint` caption 12 `--fg-muted`, 입력줄 아래 `--gap-label` 6. placeholder는 `url.placeholder`("치지직 영상 주소")라 힌트와 같은 말을 되풀이하지 않는다. 카드가 열리면 숨김 | §2.4, §15(520 예산) |
| 섹션 | 섹션 제목 body 13 600 `--fg`(h2), 오른쪽 보조 동작 ghost 24(`.edge-end`). 섹션 사이 `--space-24`, 제목↔그룹 `--gap-label` 6 | foundations §3.2(섹션 13·600 < 카드 15 < 화면 17), `A-FEAT-E3`(최근 영상 13/500 muted → 섹션 제목과 같은 급) |
| 그룹 머리(`list.group.running`·`queued`·`stopped`·`completed`: 받는 중 {n} · 대기 중 {n} · 받다 만 {n} · 완료 {n}) | caption 12 600 `--fg-muted`(h3), 숫자 tabular. 위 `--space-16` 아래 `--gap-label` 6. 첫 그룹은 위 0 | foundations §3.2(그룹 머리 600, 개수는 12px 보조색 허용 목록) |
| 그룹 상자 | `--surface`, `1px solid --separator`, `--radius-group` 10. 안의 행 사이 `1px solid --separator` | foundations §6.3 |
| 최근 영상 | 행 `--row-h` 36, 제목 body 13 말줄임 + 둘째 줄 caption `--fg-muted` "{kind} · {date}"(같은 이름의 회차 구별) + [다시 열기](ghost 24, `.edge-end`). 최대 `RECENT_MAX` 5개. hover `--surface-2`, 눌림 `--surface-pressed` | judgment §2.2-1(B의 T7), README D21, `G-REPEAT-R9` |
| 완료 그룹 접힘 | 완료 11개부터 기본 접힘(`Disclosure`, 삼각형 왼쪽), 머리에 "완료 23" + 최근 5개 미리보기 | README D39 |
| 가로 스크롤 | 어디에도 없다 | `design-gallery` |

강제: `design-gallery`(720×520·960×700 네 화면 스냅, 가로 스크롤 0, 정렬선 x 동일, 툴바 첫·끝 요소 상자 x), `design-lint` DL13(열 폭 미디어 쿼리는 허용 파일만), `frontend`(헤더 구성 표: 홈·설정·로그인), `R1`.

### 14.2 홈의 세 모습

```
(a) 빈 상태(첫 실행) — 열 안쪽 760
┌─ 치지직 영상 주소 ───────────────────────────────────── [불러오기] ┐ 28  url.placeholder
  {paste}로 붙여넣으면 바로 불러와요                                       caption url.pasteHint
  24
  다운로드                                                              13/600 list.title
  ┌──────────────────────────────────────────────────────────────────┐
  │ 32                                                               │
  │                   아직 받은 영상이 없어요                          │ list.empty.title display 17/22 600
  │                   8                                              │
  │             내 채널의 영상과 클립을 받을 수 있어요                   │ list.empty.scope body 13 muted
  │                   16                                             │
  │  ① 치지직에서 영상 주소를 복사해 주세요  ② 위 칸에 붙여넣어 주세요  ③ 화질을 고르고 받아 주세요 │ ol step1~3, 번호 배지, 가로 나열(좁은 레이아웃 세로)
  │ 32                                                               │
  └──────────────────────────────────────────────────────────────────┘
  목록을 비운 뒤에는 한 줄만: "다운로드 목록이 비어 있어요"(list.cleared)

(b) 불러오는 중 — 입력 잠금, 버튼 loading, 아래 한 줄
┌─ https://chzzk.naver.com/video/1234567 ──────────────── [ ◌ ] ┐ 28   [불러오기] loading(폭 유지)
  영상 정보를 불러오는 중                                    [취소]     resolve.loading, Notice inline neutral(스피너 없음), LOADER_DELAY_MS 뒤 등장
  (최근 영상은 숨김)

(c) 영상 카드 — 그룹 상자, 열 안쪽 760
┌──────────────────────────────────────────────────────────────────────┐
│ 불러온 영상                                                      [×] │ 머리 40(패딩 8 + IconButton sm 24 + 8, 좌 16), body 13 600, 밑선 separator
│──────────────────────────────────────────────────────────────────────│
│ 16                                                                   │
│ [빠른 다시보기] [19]                                                  │ 배지 18, 사이 4
│ 8                                                                    │
│ 금요 저녁 방송 - 신작 게임 첫 플레이 (2부)                              │ title 15/20 600, 2줄 말줄임
│ 4                                                                    │
│ 채널이름 · 10월 3일 오후 9:00 방송 · 3:12:45                           │ body 13 muted tabular(올해는 연도 생략, D49), 720에서 두 줄
│ 16                                                                   │
│ 화질      (●) 1080p  60fps  가장 좋은 화질               약 10.8GB     │ 라디오 행 28, 선택 `--accent-soft`(면은 값 열 x부터), 꼬리표 quality.best
│           ( ) 720p   60fps                               약 5.4GB     │
│           ( ) 480p   30fps                               약 2.1GB     │
│ 12                                                                   │
│ 저장 폴더  ~/Movies/치지직                                   [변경…]   │ FieldRow: 라벨 fg(--label-w 80) · 값 muted selectable
│ 12                                                                   │
│ 파일 이름  [ [251003] 채널이름 - 금요 저녁 방송 - 신작 게… ] .mp4 [원래 이름으로] │ 입력칸 28 + 라벨 + ghost 24 .edge-end
│           저장될 이름: [251003] 채널이름 - 금요 저녁 방송 - 신작 게임 첫 플레이 (2부).mp4 │ filename.willSave caption muted(잘릴 때만)
│ 12                                                                   │
│ (카드 안 경고 Notice, 있을 때만)                                        │
│ 16                                                                   │
│──────────────────────────────────────────────────────────────────────│
│ 12                                             [닫기]  8  [받기 ⌘↩]   │ 바닥 52(패딩 12), secondary · primary, sticky bottom 0
└──────────────────────────────────────────────────────────────────────┘
  (카드가 열려 있으면 힌트·최근 영상은 숨기고, 다운로드 섹션은 카드 아래 24에서 이어진다)
```

- 종류 배지·"19"는 중립 면 + 12px 600 `--fg` 글자(README D10). 카드 상단 "불러온 영상"은 섹션 제목 급(13/600)이고 `h2`, 영상 제목은 `h3`(`A-FEAT-E5`·`E6`).
- 날짜·길이·크기 형식은 `content.md` §7(README D47~D50).
- (b)의 스켈레톤 카드 폐기 이유: NN/g "단일 모듈은 스피너", `A-VIS-19`(125px → 380px 점프). §17-2. 스피너는 버튼 안 하나뿐이다(한 사건 한 수단).

---
### 14.3 작업 목록

§3.2의 행과 그룹 머리로 구성된다. 정렬: 받는 중 → 대기 중 → 받다 만(일시정지·실패) → 완료(완료·건너뜀), 같은 그룹 안에서는 최신이 위(`app.md` §8.5). 그룹 이름은 `list.group.*`("받는 중 · 대기 중 · 받다 만 · 완료", README D43. "받다 만"은 [잠정], `content.md` §16-1).

| 항목 | 값 | 근거 |
|---|---|---|
| 행 | `article` `tabindex=0`(roving), `aria-label` = `a11y.jobStatus`(‘{제목}’: {상태 줄}). 패딩 `--space-12` 상하 · `--space-16` 좌우. 행 사이 separator | `A-DRIFT-K16`, foundations §4 |
| 제목 | body 13 `--fg`, **2줄까지**(`-webkit-line-clamp: 2`) + 끝 말줄임. 전체 제목에 닿는 경로는 [⋯] › "제목 전체 보기"(행 아래 인라인 펼침, 키보드·터치로 닿는다)와 행 포커스 시 `aria-label`. `title=`은 보조. 종류 배지는 제목 **뒤** | foundations §3.5, `G-INPUT-IN2`, `G-UGT-R*` |
| 동작 버튼 | 글자 버튼(ghost 24, 글자 `--fg`) + 아이콘(16, 은유 표). 사이 `--gap-sibling` 8. 취소는 글자 필수. [⋯]는 IconButton 24(`.edge-end`). 자기 줄(상태 줄 아래)이라 폭이 좁아도 접히지 않는다 | README D32, `G-INPUT-IN1`(항상 보이기, hover 노출 없음), WCAG 2.5.8 |
| hover | 작업 행에는 없다. 최근 영상 행·메뉴 항목·유령 버튼만 | README D21 |
| 터치 | `any-pointer: coarse`에서 버튼 40, 행 44. 동작 줄이 넘치면 `flex-wrap`으로 다음 줄 | foundations §5.1 coarse 블록, `G-INPUT-IN4` |
| 100행 넘음 | 완료 접힘(`COMPLETED_FOLD_AT` 11)으로 DOM을 제한한다. 가상화는 실측 뒤 | `G-LAUNCH-R9`, `G-REPEAT-R9` |

### 14.4 설정

```
┌ [←] 설정                                         [채널이름 ▾] [⚙]       ┐ 툴바 44 ([⚙]는 aria-current=page로 자리 유지)
│  열 안쪽 760, 위 16                                                        │
│  저장 위치                                                                 │ settings.storage 13/600
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ 기본 저장 폴더        ~/Movies/치지직          [변경…] [Finder에서 보기] │ 36 │ 라벨 fg · 값 muted · 24 버튼(끝자리 .edge-end)
│  └────────────────────────────────────────────────────────────────────┘    │
│  24                                                                        │
│  받기                                                                      │ settings.download
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ 동시에 받는 영상 수                                       [ 2 ▾ ]   │ 36 │ Select 28
│  │ 둘 이상이면 빨라질 수 있지만 인터넷을 더 많이 써요.                    │    │ settings.parallel.help caption muted
│  │────────────────────────────────────────────────────────────────────│    │
│  │ 한 번에 받는 조각 수                                     [ 4 ▾ ]   │    │ settings.segments
│  │ 빠른 다시보기는 영상을 작은 조각으로 나눠 받아요. …                    │    │ settings.segments.help
│  │────────────────────────────────────────────────────────────────────│    │
│  │ 앱을 열면 받다 만 영상을 자동으로 이어받기                   (  ○)   │    │ settings.autoResume Switch 54×24
│  │────────────────────────────────────────────────────────────────────│    │
│  │ 받는 동안 컴퓨터가 잠들지 않게 하기                         (●  )   │    │ settings.keepAwake
│  │ 끄면 한동안 자리를 비울 때 받기가 멈출 수 있어요. 화면은 꺼져도 돼요.    │    │ settings.keepAwake.help
│  └────────────────────────────────────────────────────────────────────┘    │
│  보기                                                                      │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ 글자 크기             (●) 기본   ( ) 크게   ( ) 아주 크게            │    │ RadioGroup 3개
│  │ (Linux만) 모양        (●) 시스템 ( ) 밝게   ( ) 어둡게               │    │ RadioGroup 3개(세그먼트 없음)
│  └────────────────────────────────────────────────────────────────────┘    │
│  계정                                                                      │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ 채널이름                                                [로그아웃…] │    │ 라벨 fg(채널 이름)
│  │ 허가받은 채널이에요 · 마지막 확인 오후 8:12                            │    │ account.scope·account.lastSeen caption muted
│  └────────────────────────────────────────────────────────────────────┘    │
│  ▸ 고급                                                                    │ settings.advanced Disclosure 36, 삼각형 왼쪽, 제목은 h2
│  이전 버전                                                                 │
│  ┌ … [폴더 고르기…]  마지막 가져오기: D:\…\chzzk ───────────────────────┐    │
│  정보                                                                      │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ 치지직 다운로더 · 버전 0.1.2                  [업데이트 확인] [정보 복사] │    │ 7요소
│  │ 최신 버전이에요 · 마지막 확인 오후 8:12                                 │    │ status 한 줄
│  │────────────────────────────────────────────────────────────────────│    │
│  │ 개인정보 처리방침 · 오픈소스 라이선스 · 설정 폴더 열기 · 로그 폴더 열기   │    │ ghost 24 링크형 버튼 줄
│  │────────────────────────────────────────────────────────────────────│    │
│  │ (NOTICE_UNOFFICIAL 긴 판)                                            │    │ body 13 muted read 20
│  │ © 2026 {owner}. 모든 권리 보유.                                       │    │ copyright 상수
│  └────────────────────────────────────────────────────────────────────┘    │
│  32                                                                        │
└────────────────────────────────────────────────────────────────────────────┘
```

| 규칙 | 값 | 근거 |
|---|---|---|
| 섹션 순서 | 저장 위치 · 받기 · 보기 · 계정 · 고급(접힘) · 이전 버전 · 정보(키 `settings.*`) | 자주 쓰는 것 → 드문 것. 고급은 접힘(UT6, NN/g 점진적 노출 2단) |
| 행 | §6.2 FieldRow. 최소 36. 라벨 fg, 도움말 caption muted, 컨트롤 오른쪽 | foundations §5.1 `--row-h` |
| 즉시 저장 | 바꾸는 순간 저장. 저장 실패는 B2 | K14 |
| 고급 섹션 | `Disclosure` 제목 `settings.advanced`("고급")이 `h2`를 가진다. 펼치면 그룹 상자 안에 `settings.cookie.*`의 다섯 가지(이유 · 저장 위치 · 값의 힘 · 사칭 경고 · 끝내는 길) + `SecretField` 둘 + [저장](secondary) [값 지우기](ghost) + 상태 글 + "도움말 보기: 값을 찾는 방법" 링크. 개발자 도구 단축키는 `{devtools}`(`platform.md` §20). 쿠키 입력은 사용자가 펼쳤을 때만 DOM에 있다. 오류의 [네이버 로그인 정보 넣기…]는 설정을 열고 이 절을 펼친 뒤 첫 SecretField에 포커스한다 | `G-PRIVACY-R1`·`G-PRIVACY-R4`, `A-FEAT-D5` |
| 계정 행 | 채널 이름(fg) / `account.scope`("허가받은 채널이에요") · `account.lastSeen`(caption muted) / [로그아웃…]. 오프라인이면 `account.offline` | judgment §2.2-7(B의 C8 행), `worker.md` 11.7 |
| 보기 | 글자 크기(RadioGroup 기본/크게/아주 크게, `data-text-scale`), Linux만 모양 RadioGroup. macOS·Windows에는 모양 행이 없다 | README D7·D28, §6.3 |
| 정보 7요소 | 앱 이름 · 버전 · [정보 복사] · 비공식 고지(`NOTICE_UNOFFICIAL`) · 처리방침 · 오픈소스 라이선스 · 저작권 줄(`copyright`). [업데이트 확인] + 상태 줄 | brief §6.14-4, README D34·D57 |
| 경로 | 가운데 말줄임, `.selectable`, 복사는 원문. 로그·설정 폴더는 버튼으로만 연다(경로 안내 문구 없음) | `platform.md`, `G-PRIVACY-R14` |

강제: `frontend`(플랫폼별 행 노출: Linux 모양 행·macOS "Finder에서 보기"), `design-copy`(고지 문자열 동일, 금지어), `design-gallery`.

### 14.5 Worker 페이지에 적용되는 패턴

Worker는 JS가 없다(README D52). 이 문서의 패턴은 다음으로 대응된다. 골격·랜딩 구조·OG·휴대폰 진입은 `web.md`가 소유한다.

| 앱 패턴 | Worker 대응 |
|---|---|
| 토스트·배너(§1) | 일회 알림 flash 하나, h1 앞 고정 위치, 자동으로 사라지지 않음(60초 쿠키). 오류 페이지의 헤더 nav에는 [로그인]이 없다(앱 로그인 실패 계열에서 엉뚱한 길을 열지 않게, `web.md` §6.2) |
| 인라인 오류(§6) | 같은 페이지 400 재렌더 + 입력 보존 + 필드 옆 오류 + `<main>` 첫 요소 오류 요약("확인해 주세요") + `<title>` "오류: " 접두 |
| 대화상자(§5) | 확인 **페이지**(허가 빼기만). 왼쪽 빨간 글자 폼 버튼 [허가 빼기], 오른쪽은 링크 "허가한 채널 목록으로"(웹에는 Enter 기본 버튼이 없어 채움이 없다, `web.md` §7.3) |
| 비활성·사유(§6.4) | 비활성 대신 설명 문장 + 링크 하나 |
| 상태 stale(§2) | 내 기기 목록의 "마지막 확인 {time}" |
| 로그인 첫 화면(§13) | 랜딩 [치지직으로 로그인] 위 고지(받는 것·쓰는 곳·받지 않는 것·끊는 길) + 처리방침 링크(`G-PRIVACY-R17`), 확인 페이지, 거부 페이지(이름·ID·관리자 안내·"허가를 받은 뒤 앱에서 [다시 시도]") |
| 열 800(§14.1) | UI 페이지(로그인·관리)는 `--content-max` 800, 읽기 페이지는 `--reading-max` 680 + `data-scale="reading"` |

근거: brief §6.13-3, README D53·D54, `G-WEB-R17`~`G-WEB-R25`. 강제: `worker`(PRG·flash·오류 요약·멱등 테스트, 골격 meta), `R8`.

---

## 15. 720과 960의 반응

분기는 폭 600 하나(foundations §8 [잠정]). 720~960 사이에는 미디어 쿼리가 없고 열 폭 하나로 흡수한다. 좁은 레이아웃은 `layout.css`의 두 블록(`@media (max-width: 599px)`과 `:root[data-text-scale="x-large"]`)이 같은 선언으로 켠다 — `x-large`는 뷰포트를 바꾸지 않아 미디어 쿼리만으로는 켜지지 않는다.

| 조건 | 바뀌는 것 | 근거 |
|---|---|---|
| 960×700(기본) | 열 800이 가운데, 좌우 80. 툴바 내용도 열 안쪽 x에 정렬 | README D24 |
| 720×520(최소) | 열이 창을 채운다(안쪽 680). 작업 행은 제목·막대·상태·동작이 각자 줄이라 접힐 것이 없고, 상태 줄 조각이 길면 말줄임. 카드 메타 줄은 두 줄로 접힘(`flex-wrap`) | `app.md` §8.3·§8.11, `A-FEAT-R8`(숨김과 줄바꿈 모델 둘 → 줄바꿈 하나. "조각 …" 숨김 규칙은 폐기: 폭을 알 길이 컨테이너 쿼리뿐이고 그것은 DL13이 막는다) |
| 높이 520 | 세로 예산(카드 열림, 힌트·최근 숨김): 툴바 44 + 위 16 + 입력줄 28 + 8 + 섹션 간격 24 + 카드[머리 40 + 16 + 배지 18 + 8 + 제목 20 + 4 + 메타 32(두 줄) + 16 + 화질 3×28 + 12 + 폴더 28 + 12 + 파일 이름 28 + 16 + 바닥 52] = **506**. 토큰 그대로 [받기]가 첫 화면 안에 드는 조합은 이것(제목 1줄·화질 3·경고 없음·배너 없음)뿐이고 제목 2줄(+20)·화질 5(+56)·경고 1(+48)·배너 B1(+48) 중 하나만 있어도 넘친다. 그래서 카드 바닥 줄을 `position: sticky; bottom: 0`으로 두어 **어떤 조합에서도 [받기]가 보인다**(foundations §8) | `A-FEAT-R2`. 확인: `design-gallery` 720×520 카드 스냅의 고정 데이터는 **최악 조합**(배너 B1 + 두 줄 제목 + 화질 5 + 경고 1)이고 [받기]가 뷰포트 안 |
| 1440 이상 | 열은 800에서 멈춘다. 행이 과하게 길어지지 않는다 | B 약점 4(judgment §1.4) |
| 좁은 레이아웃(600 미만 또는 `x-large`, Windows 텍스트 225% ≈ 320×231, Worker 휴대폰) | FieldRow 라벨이 컨트롤 위로(1열). 빈 상태 3단계 세로. 대화상자·토스트는 `calc(100% - 2 * var(--edge))`, 대화상자 본문 스크롤. 버튼 줄은 `flex-wrap`(라벨 안 줄바꿈 없음). 가로 스크롤 0 | WCAG 1.4.10(320px 리플로우), foundations §8 |
| `any-pointer: coarse` | 컨트롤·행 높이는 토큰 블록이 올린다(§14.3). 레이아웃 분기는 없다 | foundations §5.1 |

강제: `design-gallery`(720×520·960×700·320×231·`x-large`·coarse 흉내에서 axe + 가로 스크롤 0 + 지정 요소 뷰포트 안(기본 글자·마우스 조합) + 나머지 조합은 "스크롤로 닿음 + 가로 스크롤 0"), `design-lint` DL13(폭 미디어 쿼리는 허용 파일만, 두 블록 동일), `R1`(네 장).

```
720 창                                      960 창
┌────────────────────────────────┐          ┌──────────────────────────────────────────┐
│20│ 열 안쪽 680                │20│          │  80  │  열 800(안쪽 760)        │  80  │
│  │ [입력칸         ][불러오기]│  │          │      │ [입력칸              ][불러오기] │      │
│  │ 행: 제목… [배지]     1080p │  │          │      │ 행: 제목… [배지]            1080p │      │
│  │ ████████░░░░░░        58% │  │          │      │ ███████████░░░░░░░░         58%  │      │
│  │ 받는 중 · 2.3GB / 4.0GB ·… │  │          │      │ 받는 중 · 2.3GB / 4.0GB · 12.4MB/s · 약 2분 남음 │      │
│  │          [일시정지][취소…][⋯]│  │          │      │                  [일시정지][취소…][⋯] │      │
└────────────────────────────────┘          └──────────────────────────────────────────┘
(두 폭에서 줄 구성이 같다. 720에서는 상태 줄이 말줄임된다)
```

---
## 16. 강제 수단 요약

| 수단 | 이 문서에서 거는 것 |
|---|---|
| `frontend` | Notice 하나(`tone × variant`), role 매핑, Toaster(하나·대기열·타이머·비대체), AppBanners 우선순위 표, 상태 6종 × 화면 표, 로딩 훅 가짜 타이머(`LOADER_*`), ProgressBar(퍼센트 상시·scaleX·단조·100% 금지·`aria-valuetext`), `jobs.ts` 상태 → 조각·버튼 표, 지연 삭제 되돌리기(닫힘 시점), Dialog(채움 1·순서·Enter·Esc·포커스·7종 표 대조), FieldRow 색 클래스, 검증 시점, 비활성 사유, URL 추출 골든, IME 옛 순서, 포커스 이동(F-4·F-5·F-6), `errorCopy`(버튼 열 1:1·helpId 전수), AuthReason 전수(버튼 하나·계속 문구), 로그인 뷰 네 키, 플랫폼별 설정 행, 헤더 구성 표(⚙ 자리 유지), 업데이트 상태 표, 취소 라벨·확인 조건 |
| `design-gallery` | 네 화면 + 로그인 × 720×520·960×700·320×231 × 라이트·다크·forced·reduce·contrast·coarse·x-large × 플랫폼 고정 데이터(macOS·Windows), axe, 가로 스크롤 0, 정렬선 x(툴바 첫·끝 요소 포함), 고지 요소·[받기] 뷰포트 안(기본 조합), 토스트·배너 x = 열 x, 토스트 중 마지막 행 가림 없음, 상태 6종·행 상태 전부·대화상자 7종·빈 상태 2종 |
| `design-copy` | 상태 조각 명사형, 숫자+단위 format만, 코드·HTTP 금지, `ol` 번호, 고지 동일, 단축키 기호 직접 금지, `v\d`·"자동으로 업데이트" 금지, 이 문서의 키 인용 ↔ deck 패리티(DC10) |
| `design-lint` | ms·px 리터럴, `setTimeout(…, 숫자)`, 입력칸 Enter keydown, `isImeKey` import, `accent-color`, `translate(-50%`, `outline: none`, hover 노출(`G-INPUT-IN1`), `title=` 허용 목록(`G-INPUT-IN2`), 오버레이 `backdrop-filter`, 폭 쿼리 파일·두 블록 동일 |
| `design-icons` | 톤 아이콘 고정, 은유 유일성 |
| `rust` / `tauri` | `Meter` 250ms, `clear_finished` 파일 보존, URL 추출 골든, `should_notify`, Dock 집계, `visible:false` |
| `worker` | PRG·flash·오류 요약·멱등, 확인 페이지(폼 버튼 왼쪽·링크 오른쪽), 고지 위치, 오류 페이지 nav |
| `e2e-web` | 첫 실행 흐름, 드롭 없이 붙여넣기만으로 완주, 브라우저 키 차단, `errors.spec.ts` 전수 |
| 리뷰 | `R1` 네 장 스크린샷, `R6` 대화상자 대조표, `R7` 알림 단·한 사건 한 수단, `R8` Worker 키보드 완주, `R10` D62 과업 추가 |

---

## 17. 구현 중 변경(이 문서가 app.md·옛 ui-visual.md·보고서와 다르게 정한 것)

1. **토스트는 한 번에 하나 보이고 나머지는 대기열**이다. `G-INTER-NT8`의 "3개 이하"는 README D37로 대체했다. 정보 토스트만 즉시 바뀐다.
2. **불러오기 중 스켈레톤 카드를 쓰지 않는다**(`app.md` §8.2). [불러오기] `loading` + 입력줄 아래 한 줄 + [취소]로 바꾼다. 근거: NN/g "단일 모듈은 스피너"(`E-KO-B1`), `A-VIS-19`(125px → 380px 점프). `app.md` 구현 중 변경 67 (가).
3. **시간 임계값은 토큰이 아니라 상수**(foundations §14, `app/src/lib/timing.ts`)다. CSS가 아니라 JS 타이머가 쓰는 값이고 `design-tokens`의 ms 토큰 집합을 흐리지 않기 위해서다. 가짜 타이머 테스트가 지킨다.
4. **빈 상태는 남는 높이를 채우지 않는다**(옛 ui-visual §8 "최소 160" 폐기). 고정 패딩 `--space-32`. 160은 토큰에 없고 채우기 규칙은 `A-FEAT-F4`처럼 지켜지지 않았다. "처음"과 "비운 뒤"를 나눈다.
5. **FieldRow 색 역할을 라벨 `--fg` · 값 `--fg-muted`로 고정**했다(`A-FEAT-E2`). A 후보의 카드(라벨 muted)는 뒤집었다. 근거는 macOS 시스템 설정·폼의 label/secondary 구조(`E-APPLE-11`). `components.md` §2.26이 같은 값이다.
6. **로그인 화면의 확인 코드·폴링 표현을 없앴다**(`app.md` §8.9, `worker.md` 11.7의 옛 `auth.pending.code`). 루프백(RFC 8252 §7.3, v0.3.0에 구현, `app.md` 구현 중 변경 65·66)을 따른다. `pending`의 남은 시간은 유지하고, 90초 뒤 stuck 안내·[다시 로그인]과 수신기 실패(`receiver`) 화면은 구현을 그대로 받았다.
7. **완료 행 버튼은 [열기] 다음 [폴더에서 보기]**다(README D39). `G-HANDOFF-H1`의 반대 순서는 쓰지 않는다. "파일 열기" 라벨은 "열기"로 줄인다.
8. **대화상자의 안전한 쪽 = 아무것도 하지 않은 것과 같은 결과**로 하나다. 초안의 보조 규칙("둘 다 안전하면 연 목적")과 `components.md` 초안의 "목적이 파괴적이 아니면 그것이 채움"은 D3·D5에서 반대 답을 내서 지웠다. D5 [나중에]·D3 [나중에]가 채움이다. `A-FEAT` P0(4)가 지적한 것은 기준 부재이고 기준은 D36이 정했다.
9. **대화상자 포커스는 늘 오른쪽 버튼**이고 링은 `:focus-visible` 휴리스틱이다. 초안의 "포인터로 열면 컨테이너에 포커스 + `<form method=dialog>`"는 Enter가 어느 버튼을 누르는지 DOM 순서에 끌려가 지웠다(`A-VIS-26`은 휴리스틱으로 해소). Esc는 `onclose`만 부른다.
10. **카드가 열려 있으면 힌트·최근 영상을 숨긴다.** 520 높이 예산(§15) 때문이다. 최근 영상 숨김은 `app.md` §8.1과 같고 힌트 숨김은 이 문서가 더했다.
11. **카드 머리는 40**(패딩 8·닫기 24)이고 바닥 버튼 줄은 sticky다. 초안의 "머리 36 예외"와 "토큰 그대로 2px 넘침" 계산은 합이 틀렸고(검토 U-03) sticky로 모든 조합을 덮는다.
12. **빈 상태에 아이콘이 없다**(B·C 후보의 `download` 32). README D32(32 없음)와 "다운로드 화살표는 앱 마크가 독점"(foundations §9.1)을 따른다.
13. **입력줄은 sticky**다(`app.md`는 미정, `A-FEAT-R2` 제안). 스크롤 영역 `.main` 안 `top: 0`에 붙고 `--z-sticky`를 쓴다. 긴 목록을 내려도 붙여넣을 자리가 보인다(UT1·UT7).
14. **`.part`가 있는 취소는 크기와 무관하게 확인한다.** `app.md` §8 D2 조건(512 MiB 미만 즉시)은 폐기했다(검토 U-10: 오누름이 손실로 직결, [일시정지] 옆 버튼). 대기 취소만 즉시·`neutral`. `app.md` 구현 중 변경 67 (나).
15. **덮어쓰기는 확인 대화상자 D7**을 거친다(검토 P2-20: 기존 파일 삭제는 비가역). 초안의 "보고 미리보기" 대화상자는 없앴다(복사는 즉시 + 라벨 전환).
16. **작업 행은 제목 2줄·배지 뒤·동작 자기 줄**이다(검토 U-14·U-25·U-10). 행 높이 산식은 §3.2.
17. **설정 화면에서 [⚙]를 숨기지 않고 `aria-current="page"`로 둔다**(검토 U-15, `A-FEAT-A3`·`A6` 재발 방지).
18. **업데이트 배너의 [나중에]를 뺐다**([×]와 같은 일, 검토 U-21). 업데이트 실패 배너는 danger가 아니라 warning(계속 쓸 수 있다).
19. **Linux 모양·글자 크기 선택은 RadioGroup**이다(세그먼트 컴포넌트를 만들지 않는다, 검토 P1-17·adv P2-9).
20. **파일 이름 되돌리기 버튼은 [원래 이름으로]**(검토 U-35: "되돌리기"는 목록 지우기 토스트의 말).
21. **거부 화면 아이콘은 앱·웹 모두 `circle-x`(danger)**다(막힌 것 = danger, `components.md` §2.12. 검토 P2-12·U-12).

초안 §18(충돌)·§19(foundations 요청)은 편집에서 모두 닫혔다: foundations §5.2(`--label-w`·`--pct-w`)·§7.1(토스트 퇴장·`--motion-spin`)·§14(상수)·§4(줄무늬 간격 쓰는 곳)·§5.2(`--dialog-w` 로그인 패널), `content.md` §5.3(라벨 표)·§15(문구 키), `web.md` §6·§7.3, `platform.md` §6·§20, `components.md` §2.10·§2.20·§2.26.
