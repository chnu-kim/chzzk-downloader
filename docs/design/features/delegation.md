# 기능 ① 편집자 위임 — 최종 설계(2026-10-16 3차 개정, master df454c3 · v0.7.0 기준)

**상태·확정 결정(2026-10-16)**: 설계 상태이고 코드는 아직 없다(구현 순서는 `plan.md`). 이 문서는 기능 ①(편집자 위임)의 설계다. 이 기능에 직접 걸린 확정: C1(본인 영상 제한을 로그인 채널 또는 맡긴 채널로 넓히는 뒤집는 결정 승인), L6(①-4가 전제로 하는 생방송 관리자 예외), L-D1(맡은 채널의 생방송은 v1에서 닫고 `verdict_in`에 `ContentRef::Live` 예외를 세 곳에 둔다. 자동 이어받기 필터는 컨텐츠 종류도 받는다). 공통으로 확정된 것: Q1 실제 사용자 = 본인 + 지인 스트리머 + **그들의 편집자** · 결정 표 '유지' 26행(C4·C5·C6·C7·D1·D3~D8·R1~R4·B1~B3·U1~U5·L2·L4·L5) 추천대로 · **L6** 배포된 v0.7.0의 생방송 동작(관리자 예외, `/live/` 주소 붙여넣기)을 받아들인다 · **L7** 녹화 `.part`는 지금 경로 그대로 두고 최소 조치로 지킨다(모든 삭제 진입점의 sidecar 소유권 검사, '새 녹화 시작'과 '기존 녹화 저장'의 계약 구분, v0.7.0 파일 호환; 별도 `.rec.part` 체계는 후속) · **C1** 뒤집는 결정 ①(본인 영상 제한 → 로그인 채널 또는 맡긴 채널)·③(app.md §1.2 부분 뒤집기) 승인 · **L8** 끝난 이유 표시 · **L-D1** 맡은 채널의 생방송은 v1에서 닫는다 · **E1** ③ 조기 종료는 끈다 · **R5** 전체 빠른 다시보기 defrag는 실측 뒤 · **U2** 자막 기본 형식은 실측 뒤. UX 기준 ① "숨겨지거나 복잡하면 안 되고, 튀어 촌스러워도 안 된다". Codex 리뷰는 설계 단계에서 세 번 끝냈으므로 구현 PR에서는 중요한 PR만 돌린다. 조사 원자료·근거 확인 표·Codex 리뷰 원문은 저장소에 없다(공개 저장소 규칙). 본문이 이 결정과 다르면 결정(`decisions.md`)이 우선한다.

> 입력: UX 설계안 셋(맥락형 · 관리형 · 초대 주소형), 조사 원자료, Codex 적대적 리뷰, 근거 확인 표(모두 저장소에 없다). 이 문서는 **행동 기술**만 담는다(엔드포인트 세부·응답 원문·출처는 원자료에만). 예시 채널 이름·ID·날짜는 전부 가짜다(`0000…a1`은 테스트 상수 꼴).
> 기준: `docs/design/core.md`·`app.md`·`worker.md`(각 끝 "구현 중 변경" 우선), 시각·문구는 `docs/design/system/`(README D 표 > foundations > 나머지).
> **사용자 확정(2026-10-16)**: Q1 실제 사용자 = 본인 + 지인 스트리머 + **그들의 편집자**. UX 기준 ① "위임 방법이 숨겨지거나 과정이 복잡하면 안 되고, UI에서 튀어 촌스러워져도 안 된다" — 한 줄로 "숨겨지지 않으면서 튀지 않게".
> 코드 위치(`파일:줄`)는 **origin/master `df454c3`(v0.7.0, 생방송 녹화 포함)** 기준이다(3차 개정). `bff221d..df454c3`에서 바뀐 파일(`ROADMAP.md`·`content.md`·`README.md`·`ko.ts`·`errors.ts`·`dto.rs`·`app.md`·`terms.json`·`Cargo.toml` 등)의 인용은 이 트리에서 다시 열어 줄을 고쳤고, 바뀌지 않은 파일(`worker/` 전체, `crates/shell/src/auth/`, `ownership.rs`, `app.rs`, `gate.rs`, `consts.rs`, `worker.md`, `patterns.md`·`components.md`·`foundations.md`·`governance.md`·`web.md`, `versioning.md`, `.github/`)은 `git diff --stat bff221d df454c3 -- <경로>`가 비어 있어 줄이 그대로다. 등급 표기: **[확인]** 직접 연 줄이 뒷받침 / **[가정]** 설계 판단 / **[실측 필요]** / **[잠정]** 출처 없는 수치(ADR-0009 묶음).
> 개정 내역은 끝의 "개정 기록"(1차·2차는 `bff221d` 기준 기록 그대로, 3차는 최신 master 기준).

---

## 0. 한 장 요약

| 항목 | 결정 |
|---|---|
| 우승안 | **1안 맥락형**. 2·3안에서 여덟 가지를 접붙였다(§1.3). 채점은 설계자 판단이라 [가정]이고 사용자 근거는 D62 UT8·UT9에서 생긴다 |
| 한 줄 | 스트리머는 **앱 설정 › 계정 그룹의 "편집자" 행**에서 [초대 주소 만들기] → [주소 복사] → 카카오톡으로 보낸다. 편집자는 주소를 열고 **[치지직으로 로그인] 한 번이면 편집자가 된다**(이미 로그인돼 있으면 [편집자 되기] 한 번). 앱에서 그 채널 영상 주소를 붙여넣으면 평소처럼 받아지고, 카드 메타 줄에 "맡은 채널" 조각 하나만 더 보인다 |
| 늘 보이는 새 요소 | 앱: 설정 행 하나(편집자) + 맡은 채널이 있을 때만 행 하나. Worker: 초대 페이지·완료 페이지(초대 주소를 연 사람만 본다). 관리 화면: 거부된 시도 행의 꼬리표 하나(**[가정]** 꼬리표면 충분하다는 판단, 근거 확인 A21 — 위임 관계 전체 표는 §18-8). **배너·대화상자·메뉴 항목·랜딩 블록·Badge는 없다** |
| 숨기지 않는 곳 | 편집자가 막히는 바로 그 자리(`notOwnContent` 안내·`auth.denied`)에 다음 행동 한 줄 + 도움말 링크 + **[다시 불러오기]는 누르면 늘 로그인 서버에 맡은 채널을 물은 뒤 영상을 다시 불러온다**(무동작 아님, §5.1. 라벨은 버튼 허용 목록 `content.md:143` 안의 말, 3차 개정 N9) |
| 뒤집는 결정(확장) | ROADMAP "본인 영상 제한"(`ROADMAP.md:72` [확인]: 로그인 채널 == 영상 채널)을 "로그인 채널 **또는 그 채널 주인이 맡긴 채널**"로 넓힌다. 신뢰 수준은 그대로 정책·명분 수준(§16). 표기는 ROADMAP의 기존 관례(취소선 + 날짜, `ROADMAP.md:74` "~~repo private 유지~~ → **2026-10-05 …**" 꼴 [확인])를 따른다 |
| 허용목록 관계 | **가+**: 편집자도 관리자가 따로 허가한다(`ROADMAP.md:74` "앱 사용도 같은 허용목록으로 제한" [확인] 유지). 허가 전에 초대를 연 편집자는 "기다리는 중"으로 기록되고, 관리자가 거부된 시도 표에서 [허가]를 누르면 **위임이 함께 완성**된다. 나안(위임 = 허가)은 고르지 않는다(§15) |
| 신뢰 수준 | **(b) 본인 판정과 같게** [가정, 사용자 결정 §15-2]: 묶음에 실려 온 맡은 채널 목록을 `session.json`에 저장(serde default, v=1 유지)하고 시작 직후·오프라인 72h 유예 중에도 인정한다. 거기에 **"남의 채널 영상 판정 직전, 5분 [잠정]에 한 번 `/api/me` 확인"**(온라인일 때만)을 더한다. **`/api/me`의 명시적 거부(`403 not_allowed`·`401 session_revoked`)는 refresh 거부와 같은 상태 전이(Denied·Expired)로 바로 보내 본인 채널을 포함한 새 작업 전체를 막는다**(진행 중 작업은 계속, `ROADMAP.md:83` [확인]). `401 invalid_token`은 access 만료·회전이라 refresh로 다시 확인한다(§9.4, 3차 개정 N1). `/api/me`는 refresh와 같은 잠금을 잡아 응답 적용 순서가 서버 처리 순서와 같다(3차 개정 N2). 회수가 닿는 최악 지연은 **72h**(§10, 96h는 중복 계산이었다): 온라인이면 시작 refresh(`startup`이 바로 돈다 `service.rs:462-471` [확인]) 뒤 ≤5분이고, 앱 시작 자동 이어받기는 맡은 채널 작업만 **이번 실행의 첫 묶음 뒤로** 미룬다(§9.3) — 이 지연 규칙이 있어야 "72h는 오프라인일 때만"이 참이다 |
| 앱 ↔ Worker 계약 | 토큰 묶음·`/api/me`에 키를 **더하기만** 한다(옛 앱은 모르는 키를 버린다 `auth/api.rs:273-296` [확인], 새 앱은 키 없음 = 빈 목록) → `feat`, `!` 아님(`versioning.md:27-33` [확인]). `session.json` v=1 유지. 같은 태그에서는 **앱이 Worker보다 먼저 닿는다**(`release.yml:480` [확인], §8.7) |
| DO | 스키마 V3(더하기만): `delegation`·`invite` 표 + `flow.invite_hash` 열. **V2 롤백 뒤 허가 제외·재허가가 V3 복귀 때 위임을 되살리지 않도록 위임 행이 두 당사자의 허가 시각을 품는다**(§8.1). **초대 행도 같다**: 열기·수락·청구·관리자 [허가] 때 자동 완성·관리 꼬리표 모두 `invite.owner_allowed_at` = 주인의 현재 허가 시각인 초대만 유효로 본다(§8.1 `inviteValid`, 3차 개정 N3). 감사 표 CHECK는 손대지 않는다 |
| 생방송(v0.7.0) | v0.7.0의 생방송 녹화는 VOD와 **같은 `OwnershipGate`**를 지난다(`app.md:1386` 77 "게이트는 그대로다", ADR-0025 [확인]). 그래서 `Delegated`를 판정에 넣기만 하면 맡은 채널의 생방송 녹화가 **저절로** 열린다. v1은 **맡은 채널의 생방송을 열지 않는다**(decisions.md C4 확정 "⑤는 O-6 뒤"): 판정에 `ContentRef::Live` 예외를 명시하고 그 카드에 맞는 안내 한 줄을 둔다(§9.1·§7.2). 여는 시점은 **새 결정 후보 L-D1**(§15-9) |
| 새 Worker 경로 | 웹 5개(`/invite/:token` GET·start·accept, `/me/delegations/done`, `/me/delegations/leave`) + 앱 API 3개(`/api/editors/invite`·`remove`, `/api/delegations/leave`) + `/api/me` 확장. `/invite/done`은 `/invite/:token`과 겹쳐 쓰지 않는다(§8.3). `restore` API는 없다(되돌리기는 지연 회수, §4.4) |
| 상한(ADR-0009 묶음) | 초대 7일 · 편집자 10명(기다리는 중 포함) · 맡은 채널 20개 · 자동 확인 간격 5분 · 기다리는 초대 보존 30일 · 완료 창 2분. 전부 [잠정] 근거 없음, 실측·ADR-0009 묶음 등록 |

---

## 1. 세 안 채점과 접붙이기

### 1.1 채점표 [가정: 설계자 채점. 사용자 관찰 근거(E3·E4)는 없고 D62 UT8·UT9에서 확인한다]

사용자 기준 둘을 넷으로 쪼개고(숨겨지지 않음 ×2, 튀지 않음 ×2) 보조 기준 넷을 더했다. 5점 만점, 높을수록 좋다. 가중치는 사용자 기준 2, 보조 1.

| 기준 | 가중치 | 1안 맥락형 | 2안 관리형 | 3안 초대 주소형 | 근거 |
|---|---|---|---|---|---|
| 숨겨지지 않음 — 스트리머가 "어디서 맡기나"를 찾는가 | 2 | **5** 설정 › 계정 그룹(로그아웃을 찾으러 오는 자리)의 행, 늘 보인다 | **5** 설정 5번째 절 "편집자" + 랜딩 블록 | **3** 행은 보이지만 누르면 브라우저로 넘어가고 웹 로그인을 한 번 더 한다(`copy.ts:57` `loginTwice` [확인]). "방법"이 다른 창에 있다 | 1안 §4.1, 2안 §4, 3안 §3.3 |
| 숨겨지지 않음 — 편집자가 "왜 막히나·다음에 뭘 하나"를 아는가 | 2 | **4** `notOwnContent` 둘째 문장 + 도움말 + `auth.denied` 한 줄 | **4** 같음 + 랜딩 로그인 절 문장 | **4** 같음 | 세 안 공통. PS2 "거부되면 다음 행동을 알고 싶다"(`research/design-system.md:102` [확인], 페르소나라 [추정]) |
| 튀지 않음 — 앱에 늘 남는 시각 요소 | 2 | **5** 행 1(+조건부 1), 메타 조각 1 | **3** 절 하나(h2 + 상자), "초대 중" 행에 비밀 주소가 설정 화면에 머문다 | **4** 행 2 + 계정 메뉴 항목(중복) | 2안 §4.1, 3안 §4.2 |
| 튀지 않음 — Worker·관리 화면 | 2 | **5** 초대 페이지 하나 | **2** 랜딩 블록 + 접힌 채널 ID 폼 + 초대 2 페이지 + 관리 표 | **3** 랜딩 블록(표 둘) + 초대 페이지 + 꼬리표 | 2안 §5·§7.3, 3안 §3·§5.2 |
| 단계 수 — 스트리머 | 1 | **5** 3번(행 → 만들기 → 복사) 앱 안에서 끝 | **5** 3번 | **2** 5번(앱 → 브라우저 → 웹 로그인 → 만들기 → 손으로 선택·복사. D52 "복사 버튼 없음" `README.md:191` [확인]) | 1안 §3, 3안 §2 |
| 단계 수·실수 방지 — 편집자 | 1 | **4** 3번(열기 → 로그인 → [맡기]) | **4** 2번(로그인 = 수락) | **4** 3번 + [그만 맡기] 출구 | 2안 §3.3, 3안 §5.1 |
| 수락·회수가 앱에 닿는 때 | 1 | **4** 거부 직전 자동 확인 + [다시 불러오기] | **3** [다시 확인] 수동만 | **5** 자동 + 수동 둘 다 | raw §6.2 |
| 구현 비용·디자인 시스템 적합 | 1 | **3** 앱 쓰기 API 셋 + `/api/me`. 새 컴포넌트 0 | **2** 가장 넓다 | **4** 앱 쓰기 API 0 + 초대 페이지 | raw §4 |
| **합계**(가중) | | **54** (38 + 16) | **42** (28 + 14) | **43** (28 + 15) |  |

1안이 사용자 기준 넷(가중 38 대 28·28)에서 앞선다. 2안은 "숨겨지지 않음"에서 같지만 "튀지 않음" 둘에서 크게 잃고, 3안은 스트리머의 길이 브라우저로 꺾이는 데서 잃는다.

### 1.2 1안을 고르는 결정적 이유

- 사용자 기준의 두 축은 서로 당긴다. 1안은 **"이미 있는 자리에 한 줄"**로 둘을 동시에 만족하는 유일한 안이다. 2안의 새 절·랜딩 블록은 발견성을 더 올리지 않으면서 소음만 더한다. 3안은 소음은 적지만 "방법"이 다른 창에 있어 발견성을 잃는다.
- 편집자 쪽 발견 지점은 세 안이 같다(막히는 화면). 그러니 스트리머 쪽에서 갈린다.
- 확인된 바탕: 웹에는 복사 버튼을 둘 수 없고(D52 [확인]) 웹 경로는 로그인을 두 번 한다(`loginTwice` [확인]). 그래서 "앱 완결"(§15-3)은 근거가 있다.

### 1.3 접붙인 것(2·3안에서)

| # | 가져온 것 | 출처 | 1안의 무엇을 바꾸나 | 이유 |
|---|---|---|---|---|
| G1 | **로그인 = 수락** + 완료 페이지에 **로그인한 채널 표시와 [편집자 그만두기] 되돌리기** | 2안 §3.3·§7.2, 3안 §5.2 | "로그인 뒤 [맡기] 한 번 더"를 뺀다. 이미 로그인된 브라우저에서 열었을 때만 확인 페이지([편집자 되기])가 남는다 | 편집자 3번 → 2번. "되돌릴 수 있으면 확인하지 않고 즉시 실행한 뒤 되돌리기를 준다"(`patterns.md:256` [확인]). 수락에 사용자가 놀라는지는 [가정], D62 UT9 |
| G2 | **로그인 전에 채널 주인 이름을 보인다** + 로그인 폼 고지에 "편집자 목록" 변형 | 2안 §7.1, 3안 §5.1 | "로그인 전에는 채널 이름을 숨긴다"를 뒤집는다 | 로그인이 곧 수락이므로 무엇에 동의하는지 로그인 전에 알아야 한다(`G-PRIVACY-R17` `research/design-system.md:1016` [확인]). "주인 채널 이름은 공개 정보"는 [가정] |
| G3 | **자동(거부 직전) + 수동([다시 불러오기]) 두 겹** | 3안 §5.3 | 1안의 [다시 불러오기]를 **유지**하되 누르면 맡은 채널 확인(간격 없이) **뒤에** 영상을 다시 불러온다(3차 개정 N9: 2차까지의 [다시 확인]을 거둠) | 버튼 허용 목록(`content.md:142` 굳은 한자어, `:143` 부사 + 동작 [확인])에 "확인"·"다시 확인"이 없다. [다시 불러오기]는 `:143`에 있고 용어집 뜻("영상 정보를 서버에서 가져와 카드에 보이는 일" `content.md:91` [확인])이 이 동작의 결과(카드를 다시 판정해 다시 그림)와 맞는다. ③의 B2(확정 "유지", `[다시 확인]`은 쓰지 않는다)와 같은 판단. 상태 조각 "마지막 확인 {time}"(`ko.ts:319` [확인])은 라벨이 아니라 그대로 둔다 |
| G4 | **편집자 쪽 [편집자 그만두기]** | 3안 §5.2 | "v1 없음"을 뒤집는다 | 고지의 "끊는 길"(`content.md:344` C7 "어떻게 끊나" [확인])이 편집자 손에 있어야 한다 |
| G5 | **가+꼬리표** | 3안 §6 | 가+로 확정하고 "관리자 [허가] 때 위임 자동 완성"을 더한다 | 가의 2단 마찰을 관리자 클릭 한 번으로 없앤다. 새 표 없음(**[가정]** 꼬리표면 충분하다, 근거 확인 A21: 거부된 시도 표가 있다는 것만 `worker.md` §8.1에서 확인된다) |
| G6 | **잘못 보낸 주소의 안전 문장** | 3안 §3.2 | `editors.invite.help`에 한 문장 | 복구 경로([편집자 빼기])가 같은 화면에 있다 |
| G7 | **기다리는 초대의 상태를 행 도움말로** | 2안 "초대 중" 행의 정보만 | 주소 자체는 다시 보이지 않는다 | 상태는 숨기지 않되 비밀값은 머물지 않는다 |
| G8 | **`job.otherChannel.body`를 둘을 덮는 한 문장으로** | 3안 §5.5 | `jobs.json` 필드 추가 없이 | 거짓이 없는 문장 하나 |

접붙이지 않은 것: 2안 랜딩 "편집자" 블록·채널 ID 입력 폴백(worker.md §8.1 "Open API 채널 조회로 미리 채우지 않는다" [확인]와 충돌), 2안 사회공학 경고 Notice(**[가정]**: 편집자가 수락해서 잃을 것이 "내 채널 이름·ID가 주인의 목록에 보인다"뿐이라는 위협 판단. Codex도 "경고가 반드시 필요하다는 근거를 확보하지 못했다"고 했다. D62 UT9에서 본다), 3안 계정 메뉴 항목(중복), 3안 "기다리는 초대" 표·[초대 지우기], 2안 관리자 "초대받은 편집자" 표.

---

## 2. 용어(content.md §4 용어집에 더할 행, `design/copy/terms.json` 패리티)

"허가"는 관리자가 서비스 사용을 허락하는 뜻으로 이미 쓰여(`README.md:177` D43 [확인]) 위임에 쓰면 W1(`content.md:20` "한 뜻에 한 말" [확인]) 위반이다. "위임·권한·공유·수락·승인·링크·관리자(이 뜻)"는 화면에 쓰지 않는다.

| 개념 | 쓰는 말 | 쓰지 않는 말 | 비고 |
|---|---|---|---|
| 내 채널 영상 받기를 다른 채널에 허락하는 일 | **맡기다** | 위임, 권한 주기, 공유, 허가(이 뜻), 허용 | 스트리머 화면·도움말에만 |
| 맡은 사람 | **편집자** | 매니저, 협업자, 멤버, 관리자(이 뜻) | 행 라벨·목록 이름 |
| 편집자 쪽에서 본 상대 채널 | **맡은 채널** | 위임받은 채널, 다른 채널(이 뜻) | 설정 행·카드 메타 조각·빈 상태 |
| 편집자에게 맡기는 쪽 사람 | **채널 주인** | 스트리머, 소유자, 오너 | 편집자에게 보이는 문구에서만 |
| 편집자가 되게 하는 주소 | **초대 주소** [초대 주소 만들기] [주소 복사] | 초대 링크, 코드, 토큰 | URL = 주소(D43 "링크" 금지 [확인]) |
| 편집자가 되는 동작 | **[편집자 되기]** | 수락, 승인, 맡기 | "대상 + 동사" |
| 스트리머가 편집자를 빼는 동작 | **[편집자 빼기]** | 끊기, 삭제, 해제, 회수, 취소 | 반대 동작의 동사는 "빼기" 하나(허가 빼기와 같다). 가역이라 말줄임·danger·확인 없음 |
| 편집자가 스스로 그만두는 동작 | **[편집자 그만두기]** | 나가기, 탈퇴, 해제 | [편집자 되기]와 짝 |
| 막힌 카드를 다시 판정하는 동작(맡은 채널을 로그인 서버에 묻고 영상을 다시 불러옴) | **[다시 불러오기]**(기존 라벨 `action.reresolve` 재사용, 새 낱말 없음) | 다시 확인, 새로고침, 갱신 | 3차 개정 N9. "다시 확인"은 버튼 허용 목록(`content.md:142`·`:143` [확인]) 밖이다. 상태 조각 "마지막 확인 {time}"은 라벨이 아니라 그대로 |
| 관리자 허가를 기다리는 편집자 | **"관리자 확인 기다리는 중"** | 대기 중, 보류 | 명사형 상태 조각(D44 [확인]) |
| **용어집 행 수정** "방금 한 일을 무르기" | **되돌리기**(되돌리기 토스트의 버튼에만: 목록 지우기·**편집자 빼기**) | (그대로) | `content.md:107`은 지금 "목록 지우기 토스트의 버튼에만"이다 [확인]. 같은 뜻(방금 한 일 무르기)·같은 수단(지연 실행 토스트)이라 W1의 "한 낱말 두 뜻"이 아니고 **자리를 하나 더하는 수정**이다. PR 1에서 행을 고친다. [잠정] 항목 변경이라 README §7.1-5 [확인]로 ADR-0026에 함께 적는다 |

---

## 3. 흐름 한눈에

```
스트리머(앱)                                   카카오톡                   편집자(브라우저, 휴대폰이어도 됨)         편집자(앱)
설정 › 계정 › 편집자 행
 [초대 주소 만들기] → 행이 펼쳐지며 주소 ─[주소 복사]─▶ 보냄 ──────────▶ GET /invite/:token
 (행 도움말: "보낸 초대 주소가 있어요 · 10월 23일까지")                 ├ 로그인 안 됨: "‘A’ 채널이 영상 받기를 맡기려고 해요" [치지직으로 로그인]
                                                                        │   ├ 허가 채널: 로그인 = 편집자 됨 → 303 /me/delegations/done
                                                                        │   │   "‘A’ 채널의 편집자가 됐어요 · 내 채널 ‘B’" [편집자 그만두기]
                                                                        │   └ 허가 없음: /auth/done denied + "초대는 기록해 뒀어요.
                                                                        │       관리자가 허가하면 바로 받을 수 있어요"
                                                                        │       (관리 화면 거부된 시도 행에 꼬리표 "초대 받음 · ‘A’")
                                                                        └ 로그인 됨: "‘A’ 채널의 편집자가 될까요?" [편집자 되기] → 303 /me/delegations/done
편집자 행에 ‘B’가 뜬다(설정을 열 때 /api/me)                                                                      ‘A’ 영상 주소 붙여넣기
 [편집자 빼기] → 행 숨김 + 토스트 [되돌리기](6초 뒤 닫히면 회수 전송)                                                → 남의 채널이면 5분에 한 번 /api/me 확인 → 평소처럼 [받기]
                                                                                                                  막히면 Notice에 한 줄 + [다시 불러오기](누르면 늘 확인)
```

누름 수: 스트리머 3번(행 찾기 → 만들기 → 복사), 편집자 2번(열기 → 로그인). 입력칸 0. 앱 설정값은 아무것도 바뀌지 않는다. **UX 기준 재확인**: 이번 개정(지연 회수·인라인 오류·[다시 불러오기] 늘 동작·경로 이름)은 누름 수·화면 요소 수를 바꾸지 않는다.

---

## 4. 스트리머 쪽(앱 설정 › 계정 그룹)

컴포넌트: `Surface group`(components §2.16) 안 `SettingsRow`(§2.17) + `Button secondary sm`(§2.1) + 읽기 전용 `TextField`(§2.3, `readonly` → `--surface-2` `components.md:46` [확인]) + `FieldRow`(`patterns.md:359` §6.2 [확인]). 새 컴포넌트 없음. 섹션 순서(`patterns.md:793` §14.4 [확인])는 바뀌지 않는다. 로그인 안 됨이면 계정 그룹 자체가 없다(`AccountSection.svelte:20` `{#if auth.signedIn}` [확인]).

### 4.1 기본 모습(편집자 없음)

```
│  계정                                                                      │ settings.account 13/600
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ 채널이름                                                [로그아웃…] │ 36 │ 기존 행(ghost sm .edge-end, AccountSection.svelte:33)
│  │ 허가받은 채널이에요 · 마지막 확인 오후 8:12                            │    │
│  │────────────────────────────────────────────────────────────────────│    │ 1px --separator
│  │ 편집자                                          [초대 주소 만들기] │ 36 │ editors.title(라벨 fg) · secondary sm 24 .edge-end
│  │ 영상 받기를 맡긴 사람이 없어요.                                       │    │ editors.empty caption muted
│  └────────────────────────────────────────────────────────────────────┘    │
```

- 늘 보인다. 36px 한 행이라 숨지 않고 튀지 않는다. 관리자도 같은 행을 본다.
- 행 도움말은 상태별 키 하나: 없음 `editors.empty` / 기다리는 초대 `editors.pending` / 편집자 있음 `editors.help` / 상한 `editors.limit` / 오프라인 `editors.offline`.
- 오프라인 유예·상한이면 [초대 주소 만들기]는 `aria-disabled` + `aria-describedby`가 도움말 줄(D21 `README.md:135` [확인], `patterns.md:388` §6.4 [확인]).
- 목록은 **설정 화면이 열릴 때** `/api/me`에서 읽는다(묶음에 싣지 않는다). 읽는 동안은 마지막 값 그대로, 처음이면 도움말 자리에 빈 줄. "300ms 안에 온다"는 [실측 필요]; 넘으면 `patterns.md:151-152` 로더 규칙 [확인].

### 4.2 [초대 주소 만들기]를 누른 뒤(같은 행이 펼쳐진다. 대화상자·새 화면 없음)

```
│  │────────────────────────────────────────────────────────────────────│    │
│  │ 편집자                                          [초대 주소 만들기] │    │ 버튼 그대로(한 번 더 누르면 새 주소, 이전 주소는 무효)
│  │ 보낸 초대 주소가 있어요 · 10월 23일까지                                │    │ editors.pending
│  │   초대 주소                                                         │    │ FieldRow 라벨 caption
│  │   ┌──────────────────────────────────────────────┐ [주소 복사]      │ 28 │ TextField readonly mono --surface-2 · secondary sm
│  │   │ https://…/invite/…                            │                 │    │ break-all, 선택 가능
│  │   └──────────────────────────────────────────────┘                 │    │
│  │   편집자에게 보내 주세요. 주소를 연 사람이 편집자가 되니 다른 사람에게는   │    │ editors.invite.help caption muted
│  │   보내지 마세요. 한 번만 쓸 수 있고 {days}일 뒤 사라져요.               │    │
│  │────────────────────────────────────────────────────────────────────│    │
```

- 즉시 실행(확인 없음, 가역: 다시 만들면 이전 주소 무효). 새 주소는 그 채널의 이전 기다리는 초대를 대신한다.
- [주소 복사] → 라벨 [복사했어요] `COPIED_LABEL_MS`(`timing.ts:13` 2000 [확인], D37 `README.md:166` "복사 확인은 버튼 라벨 전환" [확인], `action.copied` `ko.ts:164` [확인]). 토스트 없음.
- 주소 칸은 `role="status"` 안에 그려져 `editors.invite.made`가 낭독된다. 포커스는 옮기지 않는다.
- **실패(오프라인·서버·옛 Worker 404): 버튼 바로 아래 `Notice variant=inline tone=danger` 한 줄 `editors.invite.failed`, `role=alert`.** `row`가 아니다: `patterns.md:33-34` §1.1에서 `row`는 "작업 행의 상태 줄"이고 "특정 입력칸·카드의 오류"는 "오류를 일으킨 컨트롤 바로 아래 `inline`"이다 [확인]. 같은 사건은 한 수단(낭독은 `alert` 하나, 상태 루트에 또 쓰지 않는다).
- 앱은 주소를 **저장하지 않는다**. 설정을 닫으면 칸은 사라지고 도움말 `editors.pending`만 남는다.

### 4.3 편집자가 있을 때

```
│  │────────────────────────────────────────────────────────────────────│    │
│  │ 편집자                                          [초대 주소 만들기] │ 36 │
│  │ 맡긴 사람은 내 채널의 영상과 클립을 받을 수 있어요.                     │    │ editors.help
│  │────────────────────────────────────────────────────────────────────│    │
│  │ 편집자이름1                                          [편집자 빼기] │ 36 │ 라벨 fg(<bdi>, cleanDisplayText) · ghost sm neutral
│  │ 10월 3일부터                                                        │    │ editors.since caption muted (D49 README.md:183)
│  │────────────────────────────────────────────────────────────────────│    │
│  │ 편집자이름2                                          [편집자 빼기] │ 36 │
│  │ 관리자 확인 기다리는 중 · 10월 16일에 초대를 열었어요                   │    │ editors.waiting(가+)
│  └────────────────────────────────────────────────────────────────────┘    │
```

- 행 하나가 편집자 한 명. 이름 뒤에 ID를 두지 않는다. 외부 이름은 `cleanDisplayText` + `<bdi>`(`content.md:331` 규칙 [확인]) — **앱 코드에는 아직 함수도 `<bdi>`도 없다**(검색 0건 [확인]) → PR 5 구현 비용에 든다.
- 기다리는 편집자도 같은 목록에 보인다. 상태만 말한다(`content.md:301` §9.2-8 [확인]; 302행은 10번 `errorCopy` 항목이다). [편집자 빼기]는 이 행에도 같다(기다리는 초대를 지운다).
- 상한(10명 [잠정])에 닿으면 [초대 주소 만들기] 비활성 + `editors.limit`.

### 4.4 [편집자 빼기] — 지연 회수(개정)

- **즉시 행을 숨기고 토스트 `toast.editorRemoved`("‘{name}’ 편집자를 뺐어요") + [되돌리기]**. 토스트가 사는 동안 Worker에 아무것도 보내지 않고, **토스트가 닫힐 때(타이머 6초·[×]·대기열 교체 모두) `removeEditor`를 보낸다**. [되돌리기]를 누르면 행이 돌아오고 아무것도 보내지 않는다. 이것이 `patterns.md:260` "지연 삭제: 토스트가 보이는 동안은 숨기기만 하고 **토스트가 닫힐 때** … 부른다"와 `:275` "토스트가 사는 동안은 지연 삭제로 **구조적으로** 복구를 보장한다" [확인], D37 `README.md:166` "지연 삭제는 그 토스트가 닫힐 때 확정" [확인], `components.md:437` "[되돌리기] 토스트는 … 지연 삭제는 토스트가 닫힐 때(타이머·[×]·대기열 교체 모두) 확정된다" [확인]의 규칙 그대로다. 이전 안(즉시 회수 + `restore` API)은 이 규칙과 달랐다(근거 확인 A9).
- 그래서 `restore` API·`revoked_by = 'owner'` 복구 분기·`editors_restore` command가 **없다**. 되돌리기 토스트는 대체되지 않는다(`components.md:430` [확인]).
- 회수 전송이 실패하면(오프라인·서버) 행이 다시 보이고 그 행 아래 `Notice inline danger` `editors.remove.failed`. 앱이 토스트가 닫히기 전에 종료되면 회수는 보내지지 않고 다음에 설정을 열면 행이 그대로 보인다(사용자가 다시 뺀다. 작업 목록의 지연 삭제와 같은 성질 [가정]).
- 기다리는 편집자의 빼기는 되돌리기 없이 즉시 보내고 토스트만(초대를 다시 만들면 된다).
- 편집자가 받는 중·대기 중인 작업은 끝까지 받는다(`worker.md:623` §11.5 [확인]).
- `tone=danger` 아님, 말줄임 없음, 대화상자 없음(대화상자 7종 `patterns.md:297` §5.2 [확인]에 추가 없음).

### 4.5 두지 않는 것

툴바 계정 Menu 항목, Worker 랜딩 블록, 처음 띄우는 배너·토스트·툴팁(`patterns.md:29` "위 단으로 충분하면 아래 단으로 내려가지 않는다" [확인]).

---

## 5. 편집자 쪽

### 5.1 발견 지점 1: 막힌 카드(`notOwnContent`)

```
│  │ ┌ ⊗ ───────────────────────────────────────────────────────────┐  │ Notice inline danger (기존 자리, patterns.md:399 §6.5)
│  │ │ 내 채널의 영상만 받을 수 있어요                                  │  │ 제목(맡은 채널이 1개 이상이면 "내 채널이나 맡은 채널의 영상만 받을 수 있어요")
│  │ │ 이 영상은 다른 채널의 영상이에요.                                 │  │ 본문(기존 errors.ts:474)
│  │ │ 영상의 채널: ‘채널이름’                                          │  │ 행(errors.ts rows — copy에는 있으나 OwnershipNotice는 아직 그리지 않는다)
│  │ │ 로그인한 채널: ‘내채널’                                          │  │
│  │ │ 이 채널의 편집자라면 채널 주인에게 초대 주소를 받아 열어 주세요.      │  │ 본문 둘째 문장(새 줄, 같은 색)
│  │ │ 마지막 확인 오후 8:12                            [다시 불러오기] [닫기] │  │ caption(account.lastSeen 재사용) + actions secondary sm ≤3
│  │ │ 도움말 보기: 다른 채널의 영상 받기                                 │  │ L2 링크(helpId editors, D51 README.md:185)
│  │ └──────────────────────────────────────────────────────────────┘  │
│  │                                                   [닫기]  [받기]   │ [받기] 비활성 + aria-describedby(기존)
```

- 안내 문장은 Notice **안**의 둘째 문장이다. 카드 밖에 아무것도 더하지 않는다.
- **구현 범위 정정**(근거 확인 D2): 지금 `OwnershipNotice.svelte`는 `<Notice title>{copy.body}</Notice>`로 **제목과 본문만** 그린다 [확인]. 행·caption·동작은 이 컴포넌트가 새로 그려야 한다(새 컴포넌트 0이지만 수정 범위는 있다). [닫기]의 글자는 `common.close`(`ko.ts:12` [확인]), 동작 id는 `errors.ts:219` `dismiss = job ? 'remove' : 'close'` [확인] — `action.dismiss` 키는 없다.
- **[다시 불러오기]는 누르면 늘 확인한다**(개정, 3차 개정 N9에서 라벨을 [다시 확인] → [다시 불러오기]): 새 ActionId `recheck` = command `ownership_recheck` = ① `WorkerApi::me` 한 번(회전 없음, 간격 무시, §9.4) ② 같은 주소를 **다시 resolve**해 카드를 새 판정으로 다시 그린다. 그래서 라벨의 뜻("영상 정보를 서버에서 가져와 카드에 보이는 일", `content.md:91` [확인])이 실제 동작과 같다(W1). 비용은 클릭당 `/api/me` 1회 + 치지직 info 1회다. ①이 실패해도 ②는 하지 않는다(판정이 같아 의미가 없다). R 카드의 기존 `reload`는 `retry`라 글자가 "다시 시도"다(`errors.ts:215`·`:500` [확인]) — 그래서 `retry` 재사용이 아니라 새 ActionId에 `action.reresolve`(`ko.ts:160` "다시 불러오기" [확인]) 글자를 단다. 자동 확인의 5분 간격은 **적용하지 않는다**. 이유: 간격 안의 클릭을 조용히 무시하면 사유 없는 무동작 버튼이 되는데, `components.md:125` "aria-disabled이면 반드시 aria-describedby로 사유를 잇는다" [확인]·`patterns.md:390` "사유 없는 비활성은 두지 않는다" [확인]에 어긋난다(Codex 지적). 수동 호출에 따로 쿨다운을 두지 않는다. **비용 상한은 없다**(정정): `/api/me` 핸들러(`session.ts:61-69` [확인])에는 상한이 없고, Worker가 429를 내는 곳은 refresh(`session.ts:38-40`)와 start(`auth.ts:102`·`:143`)뿐이다 [확인]. 성공 경로는 DO에 아무것도 쓰지 않는다(`sessions.ts:137` "성공 경로는 아무것도 쓰지 않는다" [확인]). 그래서 한 클릭 = DO 읽기 RPC 1회이고, 앱 쪽 single-flight + `loading`이 한 앱에서 동시에 하나만 보내게 하는 것이 유일한 제한이다(**[가정]** 사람의 클릭 속도면 충분하다. 실측에서 문제가 되면 Worker 쪽 `/api/me` 세션별 상한을 §18-12로 더한다). 보내는 동안 `Button loading`(`aria-busy` + `aria-disabled`, 폭 유지, 컴포넌트가 클릭을 막는다 `components.md:125` [확인]) — 이것이 유일한 "눌러도 안 되는" 상태이고 single-flight다. 결과가 같으면 조용하고 "마지막 확인 {time}"만 바뀐다. 바뀌면 카드가 받을 수 있는 상태가 되고 `announcer`가 `a11y.resolved`를 읽는다. 오프라인·실패면 Notice 본문 끝에 `receive.recheck.offline` 한 줄. 성공하면 `last_me_at`도 갱신된다(자동 확인 시계와 공유).
- 자동 확인(G3): 거부 Notice를 그리기 **전에** 셸이 같은 확인을 한다(§9.4). 방금 편집자가 된 사람은 대개 버튼을 누를 일이 없다. 사용자 시험 UT9에 "초대 수락 직후 열려 있던 거부 카드에서 [다시 불러오기]"을 넣는다(§14).
- 관리자(`adminOverride`)는 이 갈래를 타지 않는다(`OwnershipNotice.svelte` info 분기 [확인]).

### 5.2 초대 페이지 `GET /invite/:token`(Worker, 앱 척도, `web_optional`, `quiet`)

**(가) 로그인 안 됨**

```
┌ VOD 클립 다운로더  [비공식 도구]                                  도움말 ┐ 헤더(nav에 [로그인] 없음)
│                                                                         │
│  ‘채널이름’ 채널이 영상 받기를 맡기려고 해요                              │ h1 invite.title (display 17/600)
│  치지직으로 로그인하면 이 채널의 편집자가 되고, 앱에서 이 채널의 영상과      │ invite.body
│  클립을 받을 수 있어요. 받은 영상은 내 컴퓨터에만 저장돼요.                 │
│                                                                         │
│  로그인하면 채널 이름과 채널 ID만 알게 돼요.                               │ landing.consent.collect(copy.ts:45 기존)
│  허가 확인과 ‘내 기기’ 표시, ‘채널이름’ 채널의 편집자 목록에만 써요.          │ invite.consent.use(이 페이지 변형)
│  네이버 비밀번호는 받지 않아요.                                           │ landing.consent.exclude(기존)
│  편집자는 언제든 그만둘 수 있고, 채널 주인도 언제든 뺄 수 있어요.            │ invite.consent.revoke
│  개인정보 처리방침                                                       │ 링크
│                                                                         │
│  [        치지직으로 로그인        ]                                      │ btn-primary(유일한 채움), form POST /invite/:token/start
└─────────────────────────────────────────────────────────────────────────┘
```

- 네 줄 고지는 `copy.ts:44-49` `landing.consent`의 collect·use·exclude·revoke 구조 [확인]를 따른다(`G-PRIVACY-R17` [확인]).
- **인앱 안내는 폼 아래에 두지 않는다**(정정, 근거 확인 D10): `inAppHint`는 `pages.ts:71-72` "인앱 보충 단락은 실패 뒤에만, 카카오톡 안일 때만" [확인]·`G-WEB-R9` "`/auth/done` `failed`에만" [확인]이다. 초대 흐름의 로그인이 끊기면 같은 `/auth/done failed` 페이지가 뜨고 거기에 기존 `inAppHint`가 나온다. 초대 폼 아래에 미리 두려면 G-WEB-R9를 바꾸는 별도 결정이라 하지 않는다.

**(나) 로그인 됨**(같은 브라우저에 웹 세션) — `web.md:264` "그 페이지의 다음 단계 = primary" [확인].

```
│  ‘채널이름’ 채널의 편집자가 될까요?                                       │ h1 invite.confirm.title
│  맡기는 채널   ‘채널이름’                                                 │ dl
│  내 채널       ‘내채널’                                                   │ 로그인한 채널을 보여 계정 착오를 막는다
│  편집자가 되면 앱에서 ‘채널이름’ 채널의 영상과 클립을 받을 수 있어요.          │ invite.confirm.body
│  내 채널 이름이 ‘채널이름’의 편집자 목록에 보여요. 언제든 그만둘 수 있어요.     │ invite.confirm.body2
│  [편집자 되기]        처음으로                                            │ primary + 링크. POST /invite/:token/accept → 303 /me/delegations/done
```

**상태표**(모두 같은 경로, 상태별 제목, `web.md:193` `<title>` "오류: " 접두·`:205` 4xx `triangle-alert` [확인]):

| 상태 | 판정 | h1 | 본문·동작 |
|---|---|---|---|
| 로그인 안 됨 | 웹 세션 없음 ∧ 토큰 유효 | `invite.title` | (가) |
| 로그인 됨 | 웹 세션 ∧ 토큰 유효 ∧ 상한 미만 | `invite.confirm.title` | (나) |
| 허가 없음(가+) | 콜백에서 admission 실패 | 기존 `/auth/done` denied 페이지 | `doneDenied.*` + 새 줄 `doneDenied.invite` — 흐름 행에 `invite_hash`가 있을 때만 |
| 자기 채널(GET) | 로그인 채널의 판정 ID == 초대 주인 | `invite.self.title` 내 채널의 초대 주소예요 | `invite.self.body` + 처음으로. 아이콘 `info` |
| 자기 채널(콜백·accept POST 뒤) | 같음 | — | 303 `/` + flash `inviteSelf`(같은 문장). 쿼리를 쓰지 않는다(§8.3) |
| 이미 편집자 | 활성 행이 이미 있음 | 303 `/` + flash `alreadyDone`(`flash.ts:5` 기존 [확인]) | 멱등(`web.md` §6.3 [확인]) |
| 만료·사용됨·없음·형식 밖 | 토큰 무효 | `invite.gone.title` 초대 주소가 만료됐어요 | `invite.gone.body` + 처음으로. 셋을 구별하지 않는다 |
| 상한(GET) | 편집자 10 또는 맡은 채널 20 | `invite.full.title` 지금은 더 맡을 수 없어요 | `invite.full.body` |
| 상한(콜백·POST 뒤) | 같음 | — | 303 `/` + flash `inviteFull` |
| 세션 만료 중 POST | — | 303 `/` + flash `sessionGone`(기존) | 주소를 다시 연다 |

- GET은 상태를 바꾸지 않는다(토큰 소비는 콜백·accept POST에서만). `/invite/*`는 OG 없음 + `noindex` + `quiet`(`routes.ts:46-51` URL에 비밀값이 실리면 quiet [확인]).
- 휴대폰·카카오톡 인앱에서 열어도 막지 않는다(`G-WEB-R9` [확인]). `mobileBlock`(`copy.ts:58` [확인])은 두지 않는다.

### 5.3 완료 페이지 `GET /me/delegations/done`(web, 앱 척도) — 경로 이름 개정

콜백(허가 채널) 또는 accept POST 뒤의 303 목적지. 웹 세션의 **최근 2분 [잠정] 안에 생긴 위임 행**을 보인다(없으면 303 `/`). flash 쿠키는 종류 코드만 싣고(`flash.ts:1` [확인]) 값을 실을 수 없어 페이지가 DO에서 읽는다.

**경로를 `/invite/done`에서 바꾼 이유**(근거 확인 C8): `routes.ts:97-115` `matchPattern`은 `:이름`을 "비지 않은 조각 하나"로 맞추므로 `/invite/done`은 `/invite/:token`과도 맞고, `:118-119` `isQuietPath`는 quiet 행과 맞는 경로를 메서드와 상관없이 quiet로 만든다 [확인]. 그래서 `/invite/done`은 로그 0줄이 되고 `/invite/:token` 핸들러와 표 순서로 겨룬다. `/me/delegations/done`은 어느 quiet 패턴과도 겹치지 않는다.

```
│  ✓ ‘채널이름’ 채널의 편집자가 됐어요                                       │ h1 inviteDone.title, circle-check --fg-muted(성공색 없음 D10 README.md:114)
│  내 채널: ‘내채널’                                                        │ 라벨: 값 행
│  이제 앱에서 ‘채널이름’ 채널의 영상 주소를 붙여넣으면 받을 수 있어요.          │ inviteDone.body
│  앱이 이미 열려 있다면 영상 카드의 [다시 불러오기]를 눌러 주세요.                 │ inviteDone.refresh
│  앱은 컴퓨터에서 설치해요.                                                │ inviteDone.desktop(휴대폰·인앱일 때만)
│  다른 계정으로 하려 했다면 아래에서 그만두고 네이버에서 로그아웃한 뒤 주소를 다시 열어 주세요. │ inviteDone.otherAccount
│  [편집자 그만두기]        처음으로                                         │ btn-secondary(neutral) POST /me/delegations/leave(body owner) → 303 / + flash delegationLeft
```

- 되돌리기가 이 페이지에 있으므로 수락 확인 단계를 로그인 앞에 두지 않아도 된다(G1). 고지는 붙이지 않는다(결과 화면).

### 5.4 발견 지점 2: 로그인 거부 화면(`auth.denied`, 가+)

본문 아래 한 줄 `auth.denied.editorHint`. 네 요소·버튼 표(`auth.ts:117` `login('action.retry', 'primary')` + `channelRow` [확인])는 바뀌지 않는다.

### 5.5 맡은 채널의 영상 카드

```
│  │ 영상 제목이 여기에                                        [클립]    │
│  │ 채널이름 · 맡은 채널 · 10월 3일 업로드 · 0:42                        │ meta 조각 하나(receive.meta.delegated)
│  │ … (화질·폴더·파일 이름·[받기] 전부 평소와 같다)                      │
```

- Notice 없음. Badge 아님(D10 "종류 배지" [확인]). 조각은 글자라 forced-colors에서 남는다. `Ownership::Delegated`가 유일한 원천. 작업 행에는 표시하지 않는다.

### 5.6 편집자의 설정 › 계정

```
│  │ 내채널                                                   [로그아웃…] │
│  │ 허가받은 채널이에요 · 마지막 확인 오후 8:12                            │
│  │────────────────────────────────────────────────────────────────────│
│  │ 편집자                                          [초대 주소 만들기] │ (모든 사용자에게 있는 행, §4)
│  │ 영상 받기를 맡긴 사람이 없어요.                                       │
│  │────────────────────────────────────────────────────────────────────│
│  │ 맡은 채널                                                           │ delegated.title(라벨 fg)
│  │ 이 채널의 영상과 클립도 받을 수 있어요.                                │ delegated.help
│  │────────────────────────────────────────────────────────────────────│
│  │ 채널이름1                                       [편집자 그만두기] │ 36 │ <bdi> · ghost sm neutral
│  │ 10월 3일부터                                                        │    │
│  └────────────────────────────────────────────────────────────────────┘    │
```

- 맡은 채널이 0개면 "맡은 채널" 머리 행과 아래 행들이 **없다**.
- [편집자 그만두기]: 즉시 보내고 토스트 `toast.delegationLeft`. 되돌리기 없음(되돌리려면 새 초대). 실패는 그 행 아래 `Notice inline danger`.
- 오프라인이면 버튼 비활성 + 사유는 계정 행의 `account.offline`이 이미 말한다. `aria-describedby`는 계정 행 도움말로.
- 홈 빈 상태: 맡은 채널이 1개 이상이면 `list.empty.scopeDelegated`.

### 5.7 회수됐을 때(편집자)

| 자리 | 모습 | 규칙 |
|---|---|---|
| 알림 | **없다** | 귀책 문구 금지(`content.md:301` §9.2-8 [확인]). 상태만 보인다 |
| 그 채널 영상을 다시 붙여넣음 | §5.1 거부 Notice | 자동 확인이 먼저 돌아 회수가 반영된 상태로 보인다 |
| 받는 중·대기 중 작업 | 끝까지 받는다 | `worker.md:623` [확인] |
| 받다 만 작업의 [이어받기] | 막힌다. 행 본문 `job.otherChannel.body`를 넓힌 문장(§7.1) | 셸은 "다른 계정"과 "맡기 끝남"을 구별하지 않는다(G8) |
| 앱 시작 자동 이어받기 | 필터에서 빠져 B1 배너 집계에 들지 않는다 | §9.3 |
| 설정 › 계정 | 맡은 채널 행에서 사라진다 | |

---

## 6. 상태 요약

| 화면 | 상태 | 보이는 것 |
|---|---|---|
| 앱 설정 편집자 행 | 편집자 0 · 초대 0 | `editors.empty` + [초대 주소 만들기] |
| | 기다리는 초대 1 | `editors.pending`(날짜). 주소 칸은 만든 직후에만 |
| | 편집자 1+ | 행마다 [편집자 빼기], 기다리는 편집자는 `editors.waiting` |
| | 빼기 토스트 중 | 행 숨김 + 토스트 [되돌리기] 6초. 닫히면 전송 |
| | 상한 | 버튼 비활성 + `editors.limit` |
| | 오프라인 | 버튼 비활성 + `editors.offline` |
| | 만들기·빼기 실패 | 그 버튼·행 아래 **Notice inline danger** |
| | 옛 Worker(`/api/me`에 키 없음) | 목록 비움 + 만들기 실패 한 줄(같은 태그 배포라 짧은 창, 길이는 [실측 필요], §8.7) |
| 앱 설정 맡은 채널 | 0개 | 행 없음 |
| | 1+ | 행마다 [편집자 그만두기] |
| 영상 카드 | `delegated` | 메타 조각, 안내 없음 |
| | `notOwn` | danger Notice + 둘째 문장 + 마지막 확인 + [다시 불러오기] [닫기] + 도움말 |
| | [다시 불러오기] 중 | 버튼 `loading`(유일한 눌러도 안 되는 상태), 카드 그대로 |
| | 오프라인 | Notice 본문 끝 `receive.recheck.offline` |
| 작업 행 | 회수 뒤 받다 만 항목 | 넓힌 `job.otherChannel.body` |
| 로그인 화면 | denied | 기존 + `auth.denied.editorHint` |
| 초대 페이지 | 상태표 | §5.2 |
| 완료 페이지 | 최근 위임 있음 / 없음 | 페이지 / 303 `/` |
| 랜딩 `/` | flash `inviteSelf`·`inviteFull`·`delegationLeft` | 배너 한 장(기존 flash 모양) |
| 관리 화면 | 거부된 시도 행 | 꼬리표 "초대 받음 · ‘{owner}’"(caption, Badge 아님. [가정] A21) |

---

## 7. 문구 전표(초안, content.md 규칙: 해요체 · "해 주세요" · 변수 뒤 조사 없음 · 본문만 마침표 · 따옴표 ‘ ’)

### 7.1 앱 `ko.ts`

| 키 | 값 | 자리 |
|---|---|---|
| `editors.title` | 편집자 | 행 라벨 |
| `editors.empty` | 영상 받기를 맡긴 사람이 없어요. | 행 도움말 |
| `editors.help` | 맡긴 사람은 내 채널의 영상과 클립을 받을 수 있어요. | |
| `editors.pending` | 보낸 초대 주소가 있어요 · {date}까지 | 상태 조각(명사형, D49) |
| `editors.waiting` | 관리자 확인 기다리는 중 · {date}에 초대를 열었어요 | 편집자 행 도움말 |
| `editors.limit` | 편집자는 {n}명까지 맡길 수 있어요. | 비활성 사유 |
| `editors.offline` | 로그인 서버에 연결되면 초대 주소를 만들 수 있어요. | 비활성 사유 |
| `editors.since` | {date}부터 | 편집자 행 도움말 |
| `editors.invite.make` | 초대 주소 만들기 | 버튼 |
| `editors.invite.label` | 초대 주소 | 입력칸 라벨 |
| `editors.invite.help` | 편집자에게 보내 주세요. 주소를 연 사람이 편집자가 되니 다른 사람에게는 보내지 마세요. 한 번만 쓸 수 있고 {days}일 뒤 사라져요. | |
| `editors.invite.made` | 초대 주소를 만들었어요 | a11y 낭독 |
| `editors.invite.failed` | 초대 주소를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요. | **inline danger**(`content.md:295` "다시 시도해 주세요"는 이유와 함께 [확인]) |
| `editors.remove` | 편집자 빼기 | 버튼 |
| `editors.remove.failed` | 편집자를 빼지 못했어요. 잠시 뒤 다시 시도해 주세요. | inline danger |
| `toast.editorRemoved` | ‘{name}’ 편집자를 뺐어요 | 토스트 + [되돌리기](`action.undo` `ko.ts:154` [확인]) |
| `delegated.title` | 맡은 채널 | 행 라벨 |
| `delegated.help` | 이 채널의 영상과 클립도 받을 수 있어요. | |
| `delegated.leave` | 편집자 그만두기 | 버튼 |
| `delegated.leave.failed` | 편집자를 그만두지 못했어요. 잠시 뒤 다시 시도해 주세요. | inline danger |
| `toast.delegationLeft` | ‘{name}’ 채널의 편집자를 그만뒀어요 | 토스트 |
| `receive.meta.delegated` | 맡은 채널 | 카드 메타 조각 |
| `receive.notOwn.editorHint` | 이 채널의 편집자라면 채널 주인에게 초대 주소를 받아 열어 주세요. | Notice 둘째 문장 |
| (키 없음) | — | 버튼 글자는 기존 `action.reresolve` **다시 불러오기**(`ko.ts:160` [확인])를 쓴다. 새 ActionId `recheck` → `ACTION_LABEL`에 `action.reresolve`(`errors.ts:499-513` 표에 한 줄). 3차 개정 N9 |
| `receive.recheck.offline` | 로그인 서버에 연결하지 못했어요. 연결되면 다시 불러와 주세요. | Notice 본문 끝(본문이 시키는 말과 버튼 이름을 맞춘다, `content.md:523` 선례 [확인]) |
| `list.empty.scopeDelegated` | 내 채널과 맡은 채널의 영상과 클립을 받을 수 있어요 | 홈 빈 상태 |
| `auth.denied.editorHint` | 초대 주소를 열었다면 관리자가 허가할 때 편집자가 돼요. 허가를 받은 뒤 [다시 시도]를 눌러 주세요. | 로그인 거부 본문 |
| `job.otherChannel.body`(수정, 지금 `ko.ts:138` [확인]) | 지금 로그인한 채널로는 이어받을 수 없는 영상이에요. 이 영상의 채널로 로그인하거나 그 채널의 편집자여야 해요. | 작업 행 |
| `notice.unofficial`(수정, DC6 두 deck 동일 `ko.ts:34-37`·`copy.ts:67` [확인]) | … 이 앱은 로그인한 채널의 영상과 클립, 그리고 채널 주인이 맡긴 채널의 영상과 클립만 받아요. | 고지 상수 |
| `a11y.removeEditor` / `a11y.leaveDelegation` | ‘{name}’ 편집자 빼기 / ‘{name}’ 채널의 편집자 그만두기 | 접근 이름(대상 먼저) |

재사용: `account.lastSeen`("마지막 확인 {time}" `ko.ts:319`), `action.copied`(`:164`), `action.undo`(`:154`), `common.close`(`:12`) — 모두 [확인]. **`action.dismiss`·`auth.consent.use`는 없는 키**라 쓰지 않는다. 앱 로그인 고지는 한 문장 `auth.consent`(`ko.ts:270-271` [확인])뿐이고 "쓰는 곳" 줄이 없어 **바꾸지 않는다**(지금 문장 "채널 이름과 채널 ID만 알게 되고"는 여전히 참). "쓰는 곳"은 Worker `landing.consent.use`에만 있다.

### 7.2 앱 `errors.ts` `notOwnContent`

| 층 | 값 |
|---|---|
| 제목 | 내 채널의 영상만 받을 수 있어요 / (`ctx.delegatedCount > 0`) 내 채널이나 맡은 채널의 영상만 받을 수 있어요 |
| 본문 | 이 영상은 다른 채널의 영상이에요. + `receive.notOwn.editorHint` |
| 행 | 영상의 채널: ‘{channelName}’ / 로그인한 채널: ‘{myChannel}’(`errors.ts:468-475` 기존 [확인]) |
| caption | 마지막 확인 {time}(`ctx.lastCheckedAt`가 있을 때) |
| 버튼 | [다시 불러오기](새 ActionId `recheck`, 글자 `action.reresolve` 재사용, 동작 = `ownership_recheck` 뒤 resolve) [닫기](`close`/`remove`, 기존 `dismiss`) |
| L2 | 도움말 보기: 다른 채널의 영상 받기(`helpId: 'editors'`, `help/ids.json` [확인]) |

골든(content §15.2 버튼 열) 갱신. 새 ErrorCode 없음.

**맡은 채널의 생방송 갈래(3차 개정, v1 제외 §9.1)**: 편집자가 맡은 채널의 `live/{channelId}` 주소를 붙여넣으면 판정은 `NotOwn`이지만 위 문구("이 채널의 편집자라면 초대 주소를 받아 열어 주세요" + [다시 불러오기])는 **사실과 다르고 막다른 길**이다(이미 편집자이고, 다시 불러와도 결과가 같다). 그래서 `errorCopy`가 `ctx.delegatedLive === true`일 때 갈래를 나눈다. `ErrorContext`에는 지금 `place`·`partialBytes`·`cookiesEnabled`·`diagnosis`·`channelName`·`myChannel`만 있어(`errors.ts:34-45` [확인]) 이 깃발 하나를 더한다. 값은 호출부가 계산한다: 카드의 `ContentKindDto::Live`(v0.7.0 `dto.rs` diff [확인]) ∧ 영상 채널 ∈ `AuthStatusDto.delegated_channels`(§9.3). 앞의 `ctx.delegatedCount`(제목 분기)와 함께 PR 5 범위다:

| 층 | 값 |
|---|---|
| 제목 | 맡은 채널의 생방송은 녹화할 수 없어요 |
| 본문 | 방송이 끝나고 영상이 올라오면 받을 수 있어요. |
| 행 | 영상의 채널: ‘{channelName}’ |
| 버튼 | [닫기]만(`close`). [다시 불러오기]·편집자 안내 줄·도움말 L2는 두지 않는다 |

용어는 D63(`README.md:212` "생방송"·"녹화" [확인])·`content.md:97` "진행 중인 방송을 받는 일 = 녹화" 행 그대로이고, "다시보기"는 단독으로 쓰지 않는다(`content.md:96` 종류 행 [확인]) — 그래서 본문은 "영상". "올라오면 받을 수 있다"는 맡은 채널의 VOD 판정(§9.1 `Delegated`)이 뒷받침한다. 다시보기가 꺼진 방송이면 거짓이 되는지는 [가정](그 경우 영상을 불러오면 기존 `noPlayback`이 말한다). content.md §15.2에 `notOwnContent`(맡은 채널 생방송) 행을 더한다(PR 1). L-D1(§15-9)에서 열기로 정하면 이 갈래는 지운다.

### 7.3 Worker `copy.ts`

| 키 | 값 |
|---|---|
| `invite.title(owner)` | ‘{owner}’ 채널이 영상 받기를 맡기려고 해요 |
| `invite.body` | 치지직으로 로그인하면 이 채널의 편집자가 되고, 앱에서 이 채널의 영상과 클립을 받을 수 있어요. 받은 영상은 내 컴퓨터에만 저장돼요. |
| `invite.consent.use(owner)` | 허가 확인과 ‘내 기기’ 표시, ‘{owner}’ 채널의 편집자 목록에만 써요. |
| `invite.consent.revoke` | 편집자는 언제든 그만둘 수 있고, 채널 주인도 언제든 뺄 수 있어요. |
| `invite.confirm.title(owner)` | ‘{owner}’ 채널의 편집자가 될까요? |
| `invite.confirm.owner` / `.me` | 맡기는 채널 / 내 채널 |
| `invite.confirm.body(owner)` | 편집자가 되면 앱에서 ‘{owner}’ 채널의 영상과 클립을 받을 수 있어요. |
| `invite.confirm.body2(owner)` | 내 채널 이름이 ‘{owner}’의 편집자 목록에 보여요. 언제든 그만둘 수 있어요. |
| `invite.accept` | 편집자 되기 |
| `invite.self.title` / `.body` | 내 채널의 초대 주소예요 / 이 주소는 편집자에게 보내 주세요. |
| `invite.gone.title` / `.body` | 초대 주소가 만료됐어요 / 채널 주인에게 새 초대 주소를 받아 주세요. |
| `invite.full.title` / `.body(n)` | 지금은 더 맡을 수 없어요 / 맡을 수 있는 채널이 {n}개를 넘었어요. 채널 주인이나 관리자에게 알려 주세요. |
| `inviteDone.title(owner)` | ‘{owner}’ 채널의 편집자가 됐어요 |
| `inviteDone.me` | 내 채널 |
| `inviteDone.body(owner)` | 이제 앱에서 ‘{owner}’ 채널의 영상 주소를 붙여넣으면 받을 수 있어요. |
| `inviteDone.refresh` | 앱이 이미 열려 있다면 영상 카드의 [다시 불러오기]를 눌러 주세요. |
| `inviteDone.desktop` | 앱은 컴퓨터에서 설치해요. |
| `inviteDone.otherAccount` | 다른 계정으로 하려 했다면 아래에서 그만두고 네이버에서 로그아웃한 뒤 주소를 다시 열어 주세요. |
| `leaveDelegation` | 편집자 그만두기 |
| flash `delegationLeft` | 편집자를 그만뒀어요. 받던 영상은 끝까지 받아요. |
| flash `inviteSelf` | 내 채널의 초대 주소예요. 편집자에게 보내 주세요. |
| flash `inviteFull` | 지금은 더 맡을 수 없어요. 채널 주인이나 관리자에게 알려 주세요. |
| `doneDenied.invite(owner)` | 초대는 기록해 뒀어요. 관리자가 허가하면 바로 ‘{owner}’ 채널의 영상을 받을 수 있어요. |
| 관리 꼬리표 `deniedInvited(owner)` | 초대 받음 · ‘{owner}’ |
| `anonLead` | 바뀌지 않는다(`copy.ts:41` "허가받은 채널만 쓸 수 있어요." [확인]) |
| 허가 사용자 lead | **바꿀 대상이 없다**(정정, 근거 확인 D7): `landing-view.ts:172`는 `signedInAs`를 쓰고 [확인] "본인 채널의 영상만" 문장은 코드에 없다. `landingLead` 키도 `copy.ts`에 없다(web.md:146의 표기가 코드와 다르다 — 이 문서 범위 밖, PR 1에서 web.md 표기만 바로잡는다) |
| `notice.unofficial` · `landing.consent.use` | §7.1과 같은 문자열(DC6는 `notice.*` 둘에 걸린다 `ko.ts:34` [확인]). `landing.consent.use`는 "허가 확인과 ‘내 기기’·편집자 표시에만 써요."로 Worker만 바꾼다(앱에는 짝 키가 없다) |
| `/privacy` 새 항목 `privacy.editors` | 제목 "편집자" / 본문 "다른 채널에 영상 받기를 맡기거나 맡으면 두 채널의 이름과 채널 ID, 맡긴 시각을 함께 저장해요. 편집자를 빼거나 그만두면 {days}일 뒤 지워지고, 허가가 빠지면 함께 지워져요." |

flash 종류 추가: `delegationLeft`·`inviteSelf`·`inviteFull`(종류 코드만, 값 없음 — `flash.ts:1` [확인]). `FlashKind`는 지금 셋(`flash.ts:5` `"loggedIn" | "alreadyDone" | "sessionGone"` [확인])이라 **계약 확장**이고, `web.md:222` "flash와 `seeOther` … 계약의 보완은 worker.md 구현 중 변경이 필요하다" [확인]대로 `seeOther` 세 곳과 **같은 구현 중 변경 105**에 적는다(§8.3·§13).

### 7.4 도움말 `help/editors.md`(새 id, `help/ids.json`에 `editors`, D51 "앵커 id는 추가만" [확인])

제목(증상형) **다른 채널의 영상 받기**. 절: ① 편집자란 ② 채널 주인이 하는 일(`ol` 3단계) ③ 편집자가 하는 일(`ol` 2단계) ④ 바로 안 될 때(카드의 [다시 불러오기], 허가가 없으면 관리자가 허가할 때 편집자가 된다) ⑤ 그만두기·빼기 ⑥ 끝 문장 "문제가 있을 때" 상수.

---

## 8. 데이터·계약(Worker)

### 8.1 DO 스키마 V3(`store/schema.ts`, 더하기만 — `schema.ts:2-3` [확인])

```sql
-- 위임: 주인 채널 → 편집자 채널. 회수는 soft delete(revoked_at)라 /privacy의 보존 기간 문장과 기록이 된다. 감사 표는 손대지 않는다.
-- owner_allowed_at·editor_allowed_at: 만들 때 그 당사자 allowlist 행의 **현재** added_at(관리자는 NULL). 허가가 빠졌다가 다시 허가되면
-- added_at이 바뀌므로, V2 코드로 되돌린 동안(위임 표를 모르는 disallow, allowlist.ts:90) 일어난 제외·재허가가 V3 복귀 때 자동으로 이 행을 무효로 만든다.
-- allowlist의 PK는 로그인 channel_id다(schema.ts:14). 주인 쪽 판정용 ID(owner_channel_id)는 allowlist.owner_channel_id로 치환된 값이라
-- (allowlist.ts:29-30 `row?.owner ?? channelId`) 그 키로는 allowlist 행에 닿지 못한다 → 주인의 **로그인** ID를 따로 둔다(owner_login_channel_id)
CREATE TABLE delegation (
  owner_channel_id        TEXT NOT NULL CHECK (length(owner_channel_id) = 32),        -- 주인의 판정용 ownerChannelId(앱 판정 키, §8.6)
  owner_login_channel_id  TEXT NOT NULL CHECK (length(owner_login_channel_id) = 32),  -- 주인의 로그인 channel_id(allowlist 조인·disallow 키)
  editor_channel_id       TEXT NOT NULL CHECK (length(editor_channel_id) = 32),       -- 편집자의 로그인 channel_id(admission·allowlist 조인·disallow 키)
  owner_name        TEXT,                                                  -- 표시용(clip 128)
  editor_name       TEXT,                                                  -- 표시용(clip 128, 편집자 제어 값)
  owner_allowed_at  INTEGER,                                               -- 생성 때 allowlist(owner_login_channel_id).added_at(관리자 NULL)
  editor_allowed_at INTEGER,                                               -- 생성 때 allowlist(editor_channel_id).added_at(관리자 NULL)
  created_at        INTEGER NOT NULL,
  revoked_at        INTEGER,                                               -- NULL = 활성
  revoked_by        TEXT CHECK (revoked_by IN ('owner','editor')),         -- 기록용(복구 분기 없음)
  PRIMARY KEY (owner_channel_id, editor_channel_id)
);
CREATE INDEX delegation_editor ON delegation(editor_channel_id, revoked_at);
CREATE INDEX delegation_owner_login ON delegation(owner_login_channel_id);
CREATE INDEX delegation_revoked ON delegation(revoked_at);

-- 초대 주소: 해시만. 한 주인에 기다리는(미청구·미만료) 초대 하나. 허가 전 편집자가 열면 claimed_*가 채워지고 관리자 [허가] 때 위임으로 바뀐다
CREATE TABLE invite (
  token_hash              TEXT PRIMARY KEY,
  owner_channel_id        TEXT NOT NULL CHECK (length(owner_channel_id) = 32),        -- 판정용(위임 행으로 옮겨 간다)
  owner_login_channel_id  TEXT NOT NULL CHECK (length(owner_login_channel_id) = 32),  -- 로그인 ID(disallow 키)
  owner_name              TEXT,
  owner_allowed_at        INTEGER,                                                    -- 생성 때 allowlist(owner_login_channel_id).added_at
  created_at          INTEGER NOT NULL,
  expires_at          INTEGER NOT NULL,                                    -- 생성 +7일, 청구되면 claimed_at +30일
  claimed_channel_id  TEXT,
  claimed_name        TEXT,
  claimed_at          INTEGER
);
CREATE INDEX invite_owner ON invite(owner_channel_id);
CREATE INDEX invite_owner_login ON invite(owner_login_channel_id);
CREATE INDEX invite_claimed ON invite(claimed_channel_id);
CREATE INDEX invite_expires ON invite(expires_at);

ALTER TABLE flow ADD COLUMN invite_hash TEXT;
```

- `MIGRATIONS = [V1, V2, V3]`(`schema.ts:40-41` [확인]), `/health`의 schema = 3(`health.ts:9` [확인]).
- **롤백 호환(개정, Codex 지적)**: 옛 코드는 새 표·열을 모른 채 돈다(DB가 앞서도 던지지 않는다 `schema.ts:3` [확인]). 그러나 옛 `disallow`(`allowlist.ts:90-96` [확인])는 허용목록 행 삭제·세션 revoke만 하고 위임 표를 모르므로 "V3 위임 생성 → V2 롤백 → 허가 제외·재허가 → V3 복귀"에서 지워졌어야 할 관계가 남는다. 대책은 **활성 판정에 허가 시각 일치를 넣는 것**이다: `delegationsOf`·`editorsOf`·`acceptInvite`·`finish`가 읽는 "활성 위임" = `revoked_at IS NULL` ∧ (주인이 관리자이거나 `allowlist(channel_id = owner_login_channel_id).added_at = owner_allowed_at`) ∧ (편집자가 관리자이거나 `allowlist(channel_id = editor_channel_id).added_at = editor_allowed_at`). **조인 키는 둘 다 로그인 ID**다(개정): `allowlist`의 PK는 로그인 `channel_id`(`schema.ts:14` [확인])이고 판정용 ID는 `row?.owner ?? channelId`(`allowlist.ts:29-30` [확인])로 치환된 값이라 판정용 ≠ 로그인인 행(대안 B)에서는 판정용 ID로 allowlist에 닿지 못한다. 그래서 위임·초대 행이 주인의 로그인 ID(`owner_login_channel_id`)를 함께 품는다. 재허가는 `allow`의 새 INSERT라 `added_at`이 새 값이 되고(`allowlist.ts:57-66` upsert는 행이 **없을 때** 새 시각으로 INSERT [확인]; `disallow`가 행을 지우므로 재허가는 늘 새 행) 옛 위임 행은 자동으로 무효가 된다. V3의 `disallow(channelId)` 확장(`allowlist.ts:90-93`은 로그인 ID를 받는다 [확인])은 `owner_login_channel_id = ? OR editor_channel_id = ?`인 위임 행과 `owner_login_channel_id = ? OR claimed_channel_id = ?`인 초대 행을 지운다 — 판정용 `owner_channel_id`로는 지우지 않는다. 이 판정이 있어 V2 시기의 제외도 덮인다. 무효가 된 행은 sweep이 `revoked_at = now, revoked_by = NULL`로 닫지 않고 **그냥 지운다**(허가가 빠진 당사자의 기록을 남기지 않는다, `/privacy` 문장과 같다).
- 이 순서를 **호환성 테스트로 고정**한다(§14): V3로 위임 생성 → 같은 DB에 V2 `disallow`가 하는 SQL 두 문(allowlist DELETE + session UPDATE)을 직접 실행 → V2 `allow` SQL로 재허가 → V3 `delegationsOf`가 빈 배열, `editorsOf`도 빔. 같은 테스트를 **대안 B 행**(allowlist `channel_id = L`, `owner_channel_id = J`, L ≠ J)으로도 돌린다: 로그인 L이 만든 초대·위임은 `owner_channel_id = J`·`owner_login_channel_id = L`이고, `disallow(L)`·V2 SQL `DELETE … WHERE channel_id = L`이 둘 다 그 행을 무효로 만든다(§8.6). 운영 롤백 대상은 그래도 **V3 직전 버전까지**로 적는다(runbook).
- **초대도 같은 허가 시각 판정을 받는다(3차 개정, Codex N3)**: 위 대책은 이미 만들어진 위임만 덮었다. "V3 초대 생성 → V2 롤백 → 주인 허가 제외·재허가 → V3 복귀 → 옛 초대 수락"에서 옛 초대가 새 허가에 붙으면 안 된다. 옛 `disallow`는 초대 표를 모른다(`allowlist.ts:90-96` [확인], 인용 출처 Codex N3의 `:93`). 그래서 초대 쪽에도 **한 판정식 `inviteValid(invite, now, admins)`** = `expires_at > now` ∧ (주인이 지금 관리자이거나 `allowlist(channel_id = invite.owner_login_channel_id).added_at = invite.owner_allowed_at`)을 두고, 초대를 읽거나 소비하는 **모든 길**이 이 식만 쓴다: `inviteView`(GET 페이지), `acceptInvite`(웹 POST·콜백 허가 갈래), `claimInvite`(콜백 거부 갈래), `allow`·`allowDenied`의 자동 완성, `editorsOf`의 기다리는 편집자·`pendingInviteUntil`, `adminView`의 꼬리표. 식이 거짓인 초대는 읽는 쪽에서 **없는 초대(gone)**이고, 쓰는 쪽(`acceptInvite`·`claimInvite`·자동 완성)은 위임을 만들지 않고 그 초대 행을 지운다. sweep 전에도 이 판정이 막는다(sweep은 지우기만 한다). 새 위임의 `owner_allowed_at`은 다시 SELECT하지 않고 **식을 통과한 초대 행의 값을 그대로 옮긴다**(같은 값임을 판정이 이미 보였다. 다시 읽으면 "옛 초대 + 새 허가 시각"을 만드는 길이 열린다 — N3의 지적 그대로). 관리 꼬리표도 같은 식을 쓰는 이유: 꼬리표가 보이는데 [허가] 때 자동 완성이 안 되면 관리자에게 거짓 약속이다. **[가정]** 남는 구멍: 허가 시각은 ms 시각이라 V2 창 안에서 같은 ms에 제외·재허가하거나 DO 시계가 거꾸로 가면 시각이 같아질 수 있다(Codex "근거 없는 의심" 1). 관리 화면 클릭으로는 같은 ms가 사실상 불가능하다고 보고 받아들인다. 운영 롤백 대상 "V3 직전까지"가 이 창 자체를 줄인다.
- 감사 표 `audit.action` CHECK는 손대지 않는다(`schema.ts:29` [확인]; SQLite는 CHECK를 ALTER로 넓힐 수 없다, raw §1.4).
- 상수(`store/delegation.ts`): `INVITE_TTL_MS` 7일 · `INVITE_CLAIMED_KEEP_MS` 30일 · `EDITORS_MAX` 10 · `DELEGATIONS_MAX` 20 · `REVOKED_DELEGATION_KEEP_MS` 30일 · `DONE_WINDOW_MS` 2분(기존 `FLOW_DONE_TTL_MS = 120_000` `flows.ts:26` [확인]과 같은 꼴). **전부 [잠정] 근거 없음, ADR-0009 묶음 등록**(`adr/0009-unsourced-numbers.md:1` [확인]). Worker 상수는 DT15 파싱 밖(`consts.rs:1-2`·`foundations.md:826` [확인]) → 열린 항목 4.
- 청소(`sweep.ts:12` `remaining` [확인]에 두 표를 더한다): 만료 초대 삭제, 30일 지난 회수 행 삭제, 허가 시각이 어긋난 행 삭제. 멱등.

### 8.2 RPC(`AuthStore`, 모두 `write()` 트랜잭션 안, now 주입)

| RPC | 입력 | 동작 | 결과 |
|---|---|---|---|
| `createInvite(ownerId, ownerLoginId, ownerName, now)` | 앱·웹 세션의 `ownerChannelId`(판정용) + `session.channel_id`(로그인) | 활성 + 기다리는 편집자 수 ≥ 10이면 `limit`(3차: 기다리는 편집자는 `inviteValid`인 청구 초대만 센다 — V2 창의 무효 초대가 상한을 막지 않게. `inviteView`의 `full`·`acceptInvite`의 상한 판정도 같은 셈). 그 주인의 미청구 초대를 지우고 새 행(토큰 `mint("invite")`, 해시 저장, `owner_allowed_at` = `allowlist(ownerLoginId).added_at` 현재 값, 관리자 NULL) | `{ ok, token, expiresAt }` 또는 `{ code: "limit" }` |
| `inviteView(hash, now)` | 토큰 해시 | 읽기만. `inviteValid` ∧ 미청구면 주인 ID·이름·만료(3차: 허가 시각 판정 포함) | 또는 `null` |
| `startWebInvite(hash, ip, limit, now)` | | `startWeb`과 같되 flow 행에 `invite_hash` | `StartWebResult` |
| `finish(...)` 확장(`AuthStore.ts:181` [확인]) | 흐름 행에 `invite_hash`가 있으면 | 허가 채널: `webLogin` 뒤 **같은 트랜잭션**에서 `acceptInvite`. 자기 채널이면 `inviteSelf`. 거부 채널: `claimInvite`(`inviteValid`일 때만 청구, 아니면 초대 삭제 + `invitePending` 없음, 3차) | `FinishResult.web`에 `invite: "accepted" \| "self" \| "full" \| "gone"`, denied에 `invitePending: ownerName` |
| `acceptInvite(hash, editorId, editorName, now)` | 웹 세션 채널 | `inviteValid` ∧ owner ≠ editor ∧ 상한 미만 → `delegation` upsert(`editor_allowed_at` = 편집자 allowlist 행의 **현재** `added_at`을 SELECT, 관리자 NULL; `owner_allowed_at` = **판정을 통과한 초대 행의 값을 그대로**(3차, 다시 SELECT하지 않는다)). `inviteValid`가 거짓이면 초대 행 삭제 + `gone` + 초대 행 삭제. 이미 활성이면 `already`(초대는 소비) | `{ ok, ownerId, ownerName } \| { code: "gone" \| "self" \| "full" \| "already" }` |
| `recentDelegationFor(editorId, now)` | 완료 페이지 | `created_at > now - 2분`인 활성 행 하나 | 또는 `null` |
| `editorsOf(ownerId, now)` | `/api/me` | 활성 위임 + `inviteValid`인 청구된 초대 + `inviteValid`인 미청구 초대의 expires_at | `{ editors, pendingInviteUntil }` |
| `delegationsOf(editorId, now)` | `/api/me`·묶음 | 활성 위임의 `(owner, ownerName, created_at)` ≤ 20 | 배열 |
| `removeEditor(ownerId, editorId, now)` | 앱(토스트가 닫힌 뒤) | 활성 행 → `revoked_at = now, revoked_by = 'owner'`. 청구된 초대면 초대 행 삭제. 없으면 `not_found` | 멱등 |
| `leaveDelegation(editorId, ownerId, now)` | 앱·웹 | `revoked_at = now, revoked_by = 'editor'` | 멱등 |
| `allow`·`allowDenied` 확장(`allowlist.ts:57·76` [확인]) | 기존 | 허가 뒤 **같은 트랜잭션**: 그 채널(로그인 ID)이 청구한 **`inviteValid`인** 초대 → `delegation` 행(식이 거짓인 청구 초대는 위임 없이 삭제, 3차)(`editor_allowed_at` = **그 채널 allowlist 행의 현재 `added_at`을 SELECT**, `owner_allowed_at`은 초대 행의 값) + 초대 삭제. "방금 넣은 시각"이 아니다(정정): `allow`의 upsert는 행이 이미 있으면 note만 바꾸고 `added_at`을 그대로 둔다(`allowlist.ts:58` `ON CONFLICT … DO UPDATE SET note = …` [확인]), `allowDenied`의 이미 허용된 갈래는 아무것도 넣지 않는다(`allowlist.ts:80-82` [확인]) — now를 쓰면 시각이 어긋나 위임이 바로 무효가 되고 sweep이 지운다 | 기존 결과 |
| `disallow(channelId)` 확장(`allowlist.ts:90-93` 로그인 ID를 받는다 [확인]) | 기존 | `owner_login_channel_id = ? OR editor_channel_id = ?`인 위임 행과 `owner_login_channel_id = ? OR claimed_channel_id = ?`인 초대 행 전부 **삭제**(판정용 `owner_channel_id`는 키가 아니다, §8.1) | 기존 결과 |
| `adminView` 확장(`allowlist.ts:112` [확인]) | 기존 | `denied` 행에 `invitedBy: ownerName \| null` — `inviteValid`인 청구 초대만(3차: 무효 초대의 꼬리표는 [허가] 때 자동 완성되지 않으므로 보이지 않는다) | |
| `check`·`rotate`·`activate` 확장(`AuthStore.ts:211·221` [확인]) | 기존 | admission 뒤 같은 트랜잭션에서 `delegationsOf(session.channel_id)` 1문 → 묶음·CheckResult에 `delegatedChannels` | RPC 수 증가 0 |

`restoreEditor`는 **없다**(§4.4 지연 회수).

### 8.3 Worker 경로(경로 표 `routes.ts` + `test/matrix.test.ts` 행렬 + worker.md §4.5 표 행 추가)

| 경로 | 자격 | quiet | 성공 | 오류 |
|---|---|---|---|---|
| `GET /invite/:token` | `web_optional` | O(토큰) | 200 페이지(§5.2 상태별) | 토큰 형식 밖·무효 → `invite.gone` 페이지(404). DO RPC ≤ 2(inviteView + webCheck) |
| `POST /invite/:token/start` | `none` | O | `startWebInvite` → 303 치지직 + F 쿠키 | 토큰 무효 404. **CSRF**: 세션이 없어 hidden `csrf`는 없고 `webStart`와 같은 `sameOriginPost`(Origin = `PUBLIC_ORIGIN`, `auth.ts:136` [확인]) + 같은 IP 스로틀·32행 상한(`config.ts:39`·`flows.ts:27` [확인]) |
| `GET /auth/callback` | `flow` | O(기존) | 흐름에 `invite_hash`: 허가 채널이면 세션 쿠키 + 303 `/me/delegations/done`; `self`·`full`은 303 `/` + flash `inviteSelf`·`inviteFull`; 거부 채널이면 303 `/auth/done?r=denied`(기존 경로, done 페이지가 새 줄) | 기존 |
| `POST /invite/:token/accept` | `web` | O | `acceptInvite` → 303 `/me/delegations/done`. `already` → 303 `/` + flash `alreadyDone` | `gone` 페이지(404), `self`·`full` → 303 `/` + flash |
| `GET /me/delegations/done` | `web` | — | 최근 위임 페이지. 없으면 303 `/` | |
| `POST /me/delegations/leave` | `web` | — | 본문 `owner`(32 hex) → `leaveDelegation` → 303 `/` + flash `delegationLeft`(멱등) | 400 형식 |
| `GET /api/me` | `app` | — | 응답 확장(§8.4) | 기존 |
| `POST /api/editors/invite` | `app` | — | JSON `{ inviteUrl, expiresAt }` | 409 `limit`, 기존 401·403 |
| `POST /api/editors/remove` | `app` | — | 본문 `{ channelId }` → 204 | 404 `not_found`, 400 |
| `POST /api/delegations/leave` | `app` | — | 본문 `{ channelId }`(주인) → 204 | 404 |

- **`seeOther` 계약 확장**(근거 확인 C9): `web-session.ts:40-41` `seeOther(location: "/" | "/admin")` "위치는 쿼리 없는 두 곳뿐" [확인]. 목적지 `/me/delegations/done` 하나를 더하고 **쿼리는 여전히 쓰지 않는다**(self·full은 flash로). worker.md 구현 중 변경 새 번호(지금 기준 105, `worker.md:1188` 마지막 104 [확인])에 "`seeOther` 세 곳 + **`FlashKind` 셋 → 여섯**(`delegationLeft`·`inviteSelf`·`inviteFull`, `flash.ts:5` 지금 셋 [확인])"을 **한 항목**으로 적는다. `web.md:222`가 둘 다("flash와 `seeOther` … 계약의 보완") 구현 중 변경이 필요하다고 했다 [확인].
- 앱 API는 채널 ID를 **본문**에 싣는다(URL에 실리면 quiet). `Authorization: Bearer <access>` + JSON, 본문 4 KiB 상한(`request.ts:4` `JSON_MAX = 4096` [확인]). CSRF 겹은 필요 없다(Bearer). **정정**(근거 확인 C13): 앱 Bearer로 DO 상태를 바꾸는 POST는 `/auth/logout`(`routes.ts:69`·`session.ts:56` [확인])이 이미 있다. 처음 생기는 것은 "위임 데이터를 바꾸는 앱 API"다.
- 행렬 기대(`matrix.test.ts` "모든 경로 × 자격 8종" `worker.md:204` [확인]): `/invite/:token` GET은 자격과 무관하게 200/404, `/invite/:token/accept`·`/me/delegations/done`·`/me/delegations/leave`는 W 200/303, 그 밖 303 `/`. `/api/editors/*`·`/api/delegations/*`는 A 2xx, 그 밖 401, CI **401**. CI 허용 집합 단언은 그대로.
- DO RPC 수: `/invite/:token` ≤ 2(인증 없는 증폭 ≤ 1 유지 `worker.md:887` 38 (라) [확인]), `/api/editors/*`는 2(check + 동작) — `test/http/r2-calls.test.ts` [확인] 표에 행 추가.

### 8.4 토큰 묶음·`/api/me` 확장

```json
// redeem ok · refresh 200 (기존 키 그대로 + 하나)
{ "status": "ok", "...": "...", "channelId": "<판정용>", "channelName": "…", "isAdmin": false,
  "delegatedChannels": [ { "channelId": "<주인의 판정용 32 hex>", "channelName": "…" } ],   // ≤ 20, 없으면 []
  "serverTime": "RFC3339" }

// GET /api/me (session.ts:66 기존 네 키 + 아래)
{ "channelId": "<판정용>", "channelName": "…", "accessExpiresAt": "…", "serverTime": "…",
  "delegatedChannels": [ … ],
  "editors": [ { "channelId": "…", "channelName": "…", "since": "RFC3339", "status": "active" },
               { "channelId": "…", "channelName": "…", "since": "RFC3339", "status": "pending" } ],   // ≤ 10
  "pendingInviteUntil": "RFC3339" | null,
  "limits": { "editors": 10, "delegations": 20 } }
```

- 옛 앱(`parse_bundle` `auth/api.rs:273-296` 필요한 키만 `v.get` [확인])은 모르는 키를 읽지 않으므로 그대로 돈다. 새 앱은 키 없음 = 빈 목록, 원소 하나가 틀리면 그 원소만 버리고(redeem ok는 한 번뿐 `:271-272` [확인]) 20개 넘는 꼬리는 버린다.
- **feat, `!` 아님**: `versioning.md:27-33`의 셋(앱 ↔ Worker 계약: "운영 Worker가 이미 배포된 앱 버전의 요청을 더는 받지 않는다") [확인] 어디에도 들지 않는다. `session.json` v=1 유지(`session.rs:18`·`:177-178` 버전이 다르면 Corrupt [확인]).

### 8.5 앱 API 요청·응답(행동 기술)

| 호출 | 요청 | 응답 | 셸에서 부르는 곳 |
|---|---|---|---|
| `me` | — | §8.4 | 설정 계정 그룹 열림, 남의 채널 영상 판정 직전(§9.4), [다시 불러오기] |
| `createInvite` | — | `{ inviteUrl, expiresAt }`. 주소는 `Secret`으로 다루고 로그·Debug에 내지 않는다(`http.rs:192` `redact_url`은 지금 쿼리·`hdntl`만 가린다 [확인] → `/invite/` 경로 규칙 추가) | [초대 주소 만들기] |
| `removeEditor(channelId)` | JSON | 204 | [편집자 빼기] 토스트가 닫힌 뒤 |
| `leaveDelegation(channelId)` | JSON | 204 | [편집자 그만두기] |

셸 command: `editors_list`(= me), `editors_invite`, `editors_remove`, `delegations_leave`, `ownership_recheck`(= 간격 없는 `me` + 같은 주소 resolve, §5.1). 모두 AuthGate 허용 목록 밖(`gate.rs:19` `OPEN_COMMANDS` [확인]). DTO: `EditorsDto`, `InviteDto { url, expires_at }`, `AuthStatusDto.delegated_channels: Vec<ChannelRefDto>`, `Ownership::Delegated`(`dto.rs:538` [확인]). ts-rs bindings 재생성.

**앱 쓰기 API의 오류 처리(3차)**: `create_invite`·`remove_editor`·`leave_delegation`도 `me`와 같은 Bearer access를 쓰므로(access 수명 약 24시간) 같은 함정이 있다. 규칙은 `me`와 같다(§9.4): 같은 `refresh_lock` 안에서 `held`의 access를 읽어 보내고, 오류는 `me_outcome`으로 나눈다 — `not_allowed`·`session_revoked`는 기존 거부·만료 전이, `invalid_token`은 잠금을 놓고 refresh 한 번 뒤 **그 호출을 한 번만 다시 보낸다**(다시 `invalid_token`이면 실패 한 줄), 네트워크 계열은 각 자리의 인라인 실패 한 줄(§4.2·§4.4·§5.6). `outcome_of_error`에 넣지 않는다(넣으면 access 만료 뒤 첫 [초대 주소 만들기]가 로그아웃이 된다). 테스트: access가 만료됐고 refresh는 되는 상태에서 `editors_invite` → refresh 1회 → 재시도 성공·로그인 유지(§14 셸 행).

### 8.6 키 규칙(worker.md 구현 중 변경 23 "채널 이름 둘" `worker.md:865` [확인])

- **주인 쪽 = 판정용 `ownerChannelId`**(`allowlist.ts:27-30` `row?.owner ?? channelId` [확인]). 초대 생성 때 `CheckResult.ownerChannelId`(앱) 또는 `WebSession.ownerChannelId`(웹, `web-session.ts:36` [확인])를 넣는다.
- **편집자 쪽 = 로그인 `channel_id`**(`session.channel_id`, admission 키).
- 자기 채널 판정은 `초대.owner_channel_id == 로그인한 사람의 ownerChannelId`.
- **주인 쪽 키는 둘**(개정): 앱 판정·`delegatedChannels`·자기 채널 판정은 판정용 `owner_channel_id`, allowlist 조인(활성 판정 §8.1)·`disallow`(로그인 ID를 받는다 `allowlist.ts:90-93` [확인])는 `owner_login_channel_id`. 초대 생성 때 둘을 함께 넣는다(`CheckResult`는 `channelId`(로그인)와 `ownerChannelId`(판정용)를 둘 다 준다, `worker.md:865` 23 [확인]).
- 테스트로 고정: `owner_channel_id ≠ channel_id`인 허가 행(대안 B)에서 ① 편집자 묶음의 `delegatedChannels`에는 판정용 ID가 실리고 ② `disallow(로그인 ID)`가 그 위임을 지우며 ③ V2 SQL 제외·재허가 뒤 활성 판정이 거짓이 된다(§8.1 테스트).

### 8.7 배포 순서(정정)

같은 태그 릴리스의 실제 순서는 **앱이 먼저**다: `release.yml:480` `deploy-worker: needs: [gate, xtask, verify, worker-bundle]`, `:398` `verify: needs: [gate, xtask, sign-publish]` [확인] — 앱 매니페스트가 공개된 뒤 Worker가 배포된다. 그 창에서 새 앱의 `/api/editors/*`는 404이고 설정 행이 인라인 실패 한 줄을 보인다(묶음은 키 없음 = 빈 목록이라 로그인·받기는 멀쩡). 창의 길이는 [실측 필요](실행 기록에서 verify 끝 ~ deploy-worker 끝). PR 2·3(Worker)을 PR 4·5(앱)보다 **먼저 머지·릴리스**하면 이 창이 아예 없다(§17). `TAG_BLOCK` 불필요.

---

## 9. 셸(`crates/shell`)

### 9.1 `Signer`·OwnershipGate 판정 규칙

```rust
pub struct Signer { pub channel_id: String, pub is_admin: bool, pub delegated: Arc<[String]> }  // 소문자 32 hex 집합
```

`AuthService::signer()`(`service.rs:1182-1191` [확인], 지금은 `channel_id`·`is_admin` 둘)가 **한 잠금**에서 셋을 함께 읽는다(`ownership.rs:26-33` "계정이 바뀌는 사이에 섞이지 않게" [확인]). `delegated`는 `held.delegated_channels`의 ID다(phase == SignedIn이면 오프라인이어도, 신뢰 수준 (b)). **예외 없음(3차 개정 N1)**: 2차의 `delegated_suspect`(서버 거부 뒤 위임만 빈 집합)를 없앴다. 서버의 명시적 거부(`not_allowed`·`session_revoked`)는 이제 phase 자체를 Denied·Expired로 바꿔 `signer()`가 None이 되고(`service.rs:1184-1189` SignedIn일 때만 Some [확인]) 본인·맡은 채널·관리자 판정이 **모두** 막힌다(§9.4). `invalid_token`은 거부가 아니라 access 만료·회전이므로 위임만 따로 막을 이유가 없다.

| 입력(컨텐츠 채널 `c`, 나 `me`) | `on_resolved`(`ownership.rs:100-116` [확인]) | `admit`·`resume_job` |
|---|---|---|
| `is_own_channel(c, me) == Some(true)` | `Own` | 허용 |
| `c ∈ delegated` ∧ 컨텐츠가 **`ContentRef::Live`가 아님** | **`Delegated`**(새 변형) | 허용(owner = c를 기록에 남긴다) |
| `c ∈ delegated` ∧ `ContentRef::Live`(3차, v1 제외) | 아래 줄로 내려간다(관리자면 `AdminOverride`, 아니면 `NotOwn` + §7.2 맡은 채널 생방송 문구) | 관리자가 아니면 `notOwnContent` |
| 그 밖에 `is_admin` | `AdminOverride` | 허용 |
| `Some(false)` | `NotOwn` | `notOwnContent` |
| `None`(채널 모름) | `Unknown` | `ownershipUnknown`(fail closed `ownership.rs:177-180` [확인]) |

순서 Own > Delegated > AdminOverride는 **[가정] 표시 취향의 설계 판단**(이 문서 범례에서 [잠정]은 수치에만 쓴다; 지금은 Own > AdminOverride `ownership.rs:109-114` [확인]; 관리자이면서 편집자인 사람에게 더 구체적이고 조용한 표시를 보인다). `verdict`는 `verdict_in(own, delegated)`로 넓힌다. 코어 `is_own_channel`(`crates/core/src/ownership.rs:11-14` [확인])은 바뀌지 않는다. `admit`은 지금처럼 await 뒤 `me()`를 **다시 읽는다**(`ownership.rs:130` "로그인 채널은 판정 직전에 읽는다" [확인]) — `delegated`도 그 읽기에 포함된다.

**생방송과의 맞물림(3차 개정, v0.7.0)**: v0.7.0은 생방송을 같은 게이트에 태운다 — `parse_live_detail`이 `live-detail`의 채널 ID를 `meta.channel_id`로 내고(`info.rs` v0.7.0 diff, 소문자 [확인]) `on_resolved`·`admit`에는 컨텐츠 종류 분기가 없다(`ownership.rs:100-148` [확인], `app.md:1386` 77 "게이트는 그대로다. … 관리자 예외 포함" [확인], ADR-0025 결정 다섯째 줄 [확인]). 그래서 `verdict_in(own, delegated)`를 그대로 넓히면 맡은 채널의 `live/{channelId}`도 `Delegated`로 열린다. v1은 열지 않는다(decisions.md C4 확정 "⑤는 O-6 뒤"): 이유는 **회수 보장의 단위가 "새 작업"인데 생방송은 작업 하나가 방송이 끝날 때까지 새 내용을 계속 받는다**는 점이다. 진행 중 작업은 회수·허가 제외 뒤에도 계속되고(`ROADMAP.md:83` "진행 중 다운로드는 늘 계속", `worker.md:623` [확인]), 생방송 작업을 끝내는 길은 방송 종료·[녹화 마치기]·앱 종료뿐이다(`app.md:1386` 77 "멈춤과 취소는 다르다" [확인]) — §10의 회수 지연 표(≤5분·≤24h·72h)가 생방송에는 성립하지 않는다(decisions.md "보류" O-4와 같은 문제). 구현: `verdict_in`에 `content: &ContentRef`를 넘기고 `ContentRef::Live`이면 `delegated`를 보지 않는다. 같은 규칙을 **세 곳**에 둔다: `on_resolved`, `admit`(→ `resume_job`도 이 경로), `App::on_auth_status` 자동 이어받기 필터(§9.3 둘째 깃발은 Live 작업을 세지 않는다). 셋 다 테스트한다(§14). 관리자 예외는 v0.7.0이 이미 생방송에 적용했으므로(위 인용) 바꾸지 않는다 — decisions.md L2(확정 "관리자 예외 없음")와 출시 코드가 다르다는 사실은 이 문서 몫이 아니어서 열린 항목으로 넘긴다(§18-13).

### 9.2 `session.json`·묶음 파싱

- `StoredSession.delegated_channels`, `SessionFile`에 `#[serde(default)] delegated_channels`, `SESSION_VERSION = 1` 유지. `SessionFile`에 `deny_unknown_fields`가 없어(`session.rs:72-85` [확인]) 새 파일을 옛 앱이 읽어도 그대로 읽힌다.
- `parse_bundle`: `delegatedChannels`가 없거나 배열이 아니면 빈 목록, 원소는 `channelId`(32 hex 소문자)·`channelName`(128자 절단)이 맞는 것만, 20개 상한, 중복 제거, 자기 채널 제외.
- `parse_me`(새): 같은 규칙 + `editors`·`pendingInviteUntil`·`limits`(관대 파싱).

### 9.3 자동 이어받기·상태

- **생방송 작업은 맡은 채널 깃발에 들지 않는다**(3차, §9.1): `ContentRef::Live`인 interrupted 작업은 `delegated.contains(c)`여도 둘째 깃발로 줄 세우지 않는다(본인·관리자 깃발은 v0.7.0 그대로).
- `App::on_auth_status`(`app.rs:342`·`:357` [확인]) 필터: `admin || is_own_channel(c, me) == Some(true)`는 지금처럼 **처음 SignedIn**에서, `delegated.contains(c)`인 작업은 **이번 실행에서 첫 묶음을 받은 뒤의 SignedIn**에서(개정). 이유: 시작 판정 `load_decision`은 `verified_at + 72h` 안이면 Optimistic(`verify.rs:125-135`·`service.rs:334-338` [확인])이고 `on_auth_status`는 처음 SignedIn에서 바로 깃발을 소비하므로(`app.rs:350` `auto_resume_pending.swap(false)` [확인]) 그 자리에서 맡은 채널 작업까지 이어받으면 **온라인이어도 최대 72h 묵은 목록**으로 돈다. 그래서 깃발을 둘로 나눈다: `auto_resume_pending`(본인·관리자, 지금 그대로)과 `auto_resume_delegated_pending`(맡은 채널). 둘째는 이번 실행에서 Worker 묶음을 받은 뒤의 첫 SignedIn 상태(D23 `first_online`과 같은 판단 `service.rs:435-437`·`app.rs:456-458` [확인]; `startup`이 바로 refresh를 돌린다 `service.rs:462-471` [확인])에서만 소비하고, 그 실행 내내 오프라인이면 소비하지 않는다(맡은 채널 작업은 `interrupted`로 남고 사용자의 [이어받기]는 §9.4 (2) 경로로 디스크 목록을 쓴다 — (b)의 오프라인 대가, §10). 두 깃발의 집계는 B1 배너에서 한 번에 보인다 [가정: 배너 문구는 바뀌지 않는다].
- `AuthStatusDto.delegated_channels`(표시용: 설정 행·빈 상태·`notOwnContent` 제목 분기).

### 9.4 "남의 채널 영상 판정 직전 확인"(`AuthService::ensure_delegations_fresh`) — 개정

| 항목 | 규칙 |
|---|---|
| 언제 | (1) `resolve`에서 `meta.channel_id`가 Some이고 내 채널이 아니며 관리자가 아니고 **컨텐츠가 생방송이 아닐 때**(생방송은 v1에서 위임 판정을 쓰지 않는다, §9.1) (2) `admit`·`resume_job`에서 판정이 `delegated`에 달릴 때 (3) [다시 불러오기](`ownership_recheck`) |
| 자동 간격 | (1)·(2): phase SignedIn ∧ 오프라인 아님 ∧ `now - last_me_at ≥ DELEGATION_RECHECK_MIN_GAP`(5분 [잠정]). `last_me_at`은 메모리에만 두고 시작값 None이라 **앱을 켠 뒤 첫 판정은 늘 확인한다**(파일에 적지 않는다). **(3) [다시 불러오기]는 간격 없이 늘 보낸다**(§5.1). 모두 single-flight(진행 중이면 그 결과를 함께 기다린다). 설정 화면의 `editors_list`(§4.1)도 같은 `me` 경로·같은 잠금을 쓴다 |
| **적용 순서**(3차 개정, Codex N2) | **`/api/me`도 refresh와 같은 `refresh_lock`을 잡고 보낸다**(`service.rs:502` `let _g = self.refresh_lock.lock().await` [확인]). 그러면 앱 안에서 위임 목록을 싣는 요청(refresh·`me`)은 **한 번에 하나**이고 다음 요청은 앞 응답을 받은 뒤에 나가므로, **응답 적용 순서 = Worker의 처리 순서**다. N2의 순서("회수 전 `me` 지연 → 회수 → refresh가 빈 목록 적용 → 늦은 `me`가 옛 목록 저장")는 refresh가 `me` 응답 전에 나갈 수 없어 생기지 않는다. 세부 규칙: ① **access 토큰은 잠금을 잡은 뒤에 `held`에서 읽는다**(기다리는 동안 앞 refresh가 회전했을 수 있다. 회전된 옛 access는 `sessions.ts:246`이 `access_hash`를 바꿔 `invalid_token`이 되므로 옛 값을 쓰면 헛 refresh 고리가 생긴다) ② `me`는 **`refresh_gen`을 올리지 않는다**(올리면 뒤에 줄 선 refresh가 `service.rs:505` "다른 호출이 방금 끝냈다"로 보고 건너뛴다) ③ 잠금을 잡은 채로 `refresh_inner`를 부르지 않는다(tokio `Mutex`는 재진입이 안 돼 멈춘다): `invalid_token`이면 **잠금을 놓은 뒤** `refresh_inner`를 부른다 ④ 이중 장치로 잠금 안에서 요청 전 `(session_epoch, refresh_gen)`을 잡고 적용 직전에 둘 다 같은지 본다(잠금이 있으면 늘 같다. 이 검사만으로는 N2를 막지 못한다: 잠금 없이 두 요청이 겹치면 늦게 처리된 쪽 응답이 먼저 도착할 수 있어 세대 비교로 순서를 알 수 없다 — **잠금을 "중복"으로 보고 빼면 N2가 다시 열린다**고 코드 주석에 적는다). 대안 "DO의 위임 revision을 응답에 실어 비교"는 계약·스키마가 늘고 V2 롤백 창에서 revision이 오르지 않는 변경(옛 `disallow`)이 생겨 고르지 않았다 |
| 시간 상한(정정) | `/api/me` 요청 자체는 `HttpWorkerApi`의 요청당 `REQUEST_TIMEOUT` 10초(`http.rs:18`·`:41-50` [확인]). **`AUTH_CHECK_TIMEOUT_MS` 40초는 쓰지 않는다**: 셸 코드에서 이 상수를 읽는 곳은 정의(`consts.rs:5`)뿐이고 앱은 안내 문구의 초 수로만 쓴다(`auth.ts:89` `auth.checking.body` [확인]). refresh를 기다리는 경우는 refresh 자체의 상한을 따른다: 요청 10초 + 응답 유실 재시도 0·10·30초(`verify.rs:183-187` `LOST_RETRY_AT`, `service.rs:524-547` [확인], 마지막 전송 45초 `LOST_RETRY_LAST_SEND`) → 최대 약 55초 [확인된 상수의 합]. **잠금 대기(3차)**: 진행 중인 refresh가 있으면 `me`는 그것이 끝날 때까지 기다리므로 최악은 "앞 refresh 약 55초 + `me` 10초", `invalid_token`이면 그 뒤 refresh 약 55초가 더 붙는다. 그 동안 판정 버튼은 `loading`이다. 새 타이머·상수는 만들지 않는다 |
| **세션 세대**(개정, Codex 지적) | 요청 전에 `session_epoch`를 잡고, 응답 뒤 같은 잠금에서 `session_epoch`가 다르면 **응답을 버린다**(메모리·파일·판정 어디에도 적용하지 않는다). 성공 응답뿐 아니라 **명시적 거부의 상태 전이도** 세대가 같을 때만 한다(3차: A의 늦은 거부가 B를 로그아웃시키지 않게). 기존 refresh가 `service.rs:513`에서 잡고 `:551`에서 버리는 것 [확인]과 같은 규칙이고, 세대는 로그인 완료(`:920`)·로그아웃(`:1116`)에서 오른다 [확인]. 판정을 기다리던 호출자는 버려진 결과 대신 **현재 세대의 `signer()`를 다시 읽어** 판정한다(`ownership.rs:130` 방식) |
| 성공 | 세대가 같으면 `held.delegated_channels` 교체 + `session.json` 저장(`accept_session`과 같은 D10 규칙) + `last_me_at = now`. 상태 변화면 `AuthStatus` 송신 |
| 네트워크 계열 실패(`/api/me` 자체가) | 아무것도 바꾸지 않는다. 오프라인 추적에 넣지 않는다(refresh 경로가 아니다). 판정은 디스크 목록으로(신뢰 수준 (b)) |
| **Worker 형식 오류 응답 — 셋으로 나눈다**(3차 개정, Codex N1) | `/api/me`(`session.ts:61-69` [확인])는 `store.check`의 `judge`(`sessions.ts:138-150` [확인]) 결과를 그대로 낸다. 코드의 뜻이 서로 다르다: **(가) `403 not_allowed`** = 허가 목록에서 빠짐(`judge`가 그 자리에서 세션도 `disallowed`로 폐기, `sessions.ts:144-147` [확인]) **(나) `401 session_revoked`** = 세션이 폐기됨(‘내 기기’에서 끊음·재사용 감지 등, `denial()` `sessions.ts:77-80` "disallowed는 403 not_allowed, 그 밖의 폐기는 401 session_revoked" [확인]; 폐기된 행은 `access_hash`를 지우지 않아 늘 이 코드로 답한다 `sessions.ts:66` [확인]) **(다) `401 invalid_token`** = 행이 없거나 access가 만료됐다(`sessions.ts:139-142` [확인]) — 회전으로 바뀐 옛 access도 행이 없어 여기 든다(`sessions.ts:246` [확인]). 규칙: **(가)·(나)는 명시적 거부다.** refresh를 거치지 않고 **refresh 거부와 같은 상태 전이**로 바로 보낸다 — (가) → `Next::Denied`(`drop_session` + phase Denied + `RemovedFromAllowlist`), (나) → `Next::Expired { reason: Revoked, delete_file: true }`. 이것은 `apply_refresh_error`(`service.rs:585-664` [확인])의 전이 부분을 함수 하나로 뽑아 둘이 함께 쓰게 한다(새 상태 없음). 결과로 `signer()`가 None이 되어 **본인 채널·맡은 채널·관리자 판정 모두의 새 작업이 막히고**(`admit`이 `notLoggedIn`, `ownership.rs:131-133` [확인]) 화면은 기존 거부·만료 화면이다. 진행 중·대기 중 작업은 그대로 끝까지 받는다(`ROADMAP.md:83` "진행 중 다운로드는 늘 계속", `worker.md:623` [확인]) — 차단(새 작업)과 진행 중 유지가 따로인 기존 분리를 그대로 쓴다. **주의**: `/api/me` 오류를 `outcome_of_error`(`verify.rs:138-164` [확인])에 그대로 넣지 않는다. 그 함수는 refresh 토큰 기준이라 `401 invalid_token`을 `InvalidToken` → `classify_verify`의 `Expired(SessionExpired, delete_file: true)`(`verify.rs:211-213` [확인])로 보내는데, `me`의 `invalid_token`은 access 만료(약 24시간마다 정상으로 생긴다)라 그대로 쓰면 하루에 한 번씩 로그아웃된다. 그래서 `me` 전용 분류 `me_outcome(e) -> MeOutcome { Denied, Revoked, NeedRefresh, Transient }` 하나를 둔다. **(다) `invalid_token`은 거부가 아니다.** 잠금을 놓고 기존 `refresh_inner`(single-flight)를 부른다: refresh가 (a) 새 묶음을 주면 그 `delegatedChannels`로 판정 (b) 형식 있는 401·403이면 기존 `outcome_of_error` → `classify_verify`(`verify.rs:199-228` [확인])가 Expired/Denied로 보내 **같은 상태 머신이 차단** (c) 네트워크 계열이면 phase는 유예 규칙 그대로(Transient → `Next::Offline`, SignedIn 유지 `verify.rs:219-223` [확인])이고 **판정은 디스크 목록**이다 — 서버가 거부한 것을 본 것이 아니므로 `/api/me` 자체의 네트워크 실패와 같은 범주(신뢰 수준 (b)). 2차의 `delegated_suspect`(이 경우 위임만 막음)는 **없앤다**: 명시적 거부는 (가)·(나)로 전체 차단이 되었고, (다)는 거부가 아니다. 그 밖의 Worker 형식 4xx·5xx·계약 위반은 네트워크 계열과 같다(`verify.rs:157-158` Worker 형식 기타 → Transient(Server) [확인]과 같은 판단) |
| 왜 `/api/me`인가 | refresh 회전은 채널별 10분 10회 상한(`sessions.ts:14-15` `ROTATE_RATE_10M = 10` [확인])을 소모해 429 → 앱은 오프라인처럼 보인다(`verify.rs:157-158` Worker 형식 4xx(429 포함) → Transient(Server) [확인]). `/api/me`는 회전이 없고 `check` RPC 1회(`session.ts:61-66` [확인]) |
| 비용 | 남의 채널 영상을 불러올 때 5분에 최대 1회 RPC(자동) + 사람이 누른 만큼(수동). 본인 영상에는 0. **Worker 쪽 상한은 없다**(`/api/me`는 429를 내지 않는다 `session.ts:61-69` [확인]; 429는 refresh `session.ts:38-40`·start `auth.ts:102`·`:143`뿐 [확인]). 성공 경로 쓰기 0(`sessions.ts:137` [확인]). 상한이 필요해지면 §18-12 |

`DELEGATION_RECHECK_MIN_GAP`은 `crates/shell/src/consts.rs`(DT15 대상 [확인])와 foundations §14 표에 올린다.

### 9.5 `WorkerApi` 확장(`auth/api.rs:158-181` 지금 start·redeem·refresh·logout뿐 [확인])

`me()`, `create_invite()`, `remove_editor(id)`, `leave_delegation(id)` 넷. 네이티브 E2E 픽스처(`scripts/ci/e2e-fixture-server.mjs:153` `isAdmin: false` [확인])에 `/api/me`·`/api/editors/*` 응답을 더하고 묶음은 `delegatedChannels: []`가 기본, 사례 하나는 목록 하나.

---

## 10. 회수 반영 시점과 72h 유예(개정: 96h → 72h)

시간선의 기준은 하나다: **`verified_at` = 마지막으로 Worker 묶음을 받은 시각**(`service.rs:557` `from_bundle(b, now)` [확인]). 유예 끝은 `verified_at + 72h`(`verify.rs:103` `saturating_add(GRACE)` [확인], `auth_verify.rs:452-457` `net_72h_exact`가 그 시각에 이미 만료 [확인]). 재확인 24h(`verify.rs:11`)는 **같은 `verified_at`에서 센다**. 그래서 "24h + 72h = 96h"는 같은 기준 시각을 두 번 더한 오류였다(Codex 지적).

| 상황 | 회수가 편집자 앱에 닿는 때 | 근거 |
|---|---|---|
| 온라인, 그 채널 영상을 다시 불러옴 | **그 순간**(자동 확인이 먼저 돈다) | §9.4 (1) |
| 온라인, 5분 안에 같은 채널 영상을 또 불러옴 | 다음 확인 창(≤5분) 또는 [다시 불러오기](즉시) | "마지막 확인 {time}"이 보인다 |
| 온라인, 받다 만 맡은 채널 작업을 [이어받기] | 그 순간(`admit` 경로 (2)) | |
| 온라인, 앱 시작 자동 이어받기 | **시작 refresh가 묶음을 준 뒤**(`startup` → `refresh_inner` 즉시 `service.rs:462-471` [확인]; 요청 10초 + 유실 재시도, §9.4 "시간 상한"). 맡은 채널 작업의 깃발은 그 전에 소비하지 않는다(§9.3). 이전 안("낙관 단계에서 소비되면 최대 24h 묵은 값")은 틀렸다: Optimistic은 `verified_at + 72h` 창 전체(`verify.rs:125-135`·`service.rs:334-338` [확인])라 묵은 정도가 최대 72h였다 | (b)의 대가. 관리자 102 (라)(`worker.md:1186` [확인])와 같은 꼴 |
| 온라인, 그 채널 영상을 새로 불러오지 않음 | 다음 refresh(`verified_at + 24h`)에 새 묶음 → **≤24h** | `worker.md` §11.3 재확인 [확인] |
| 오프라인 유예 중 | 반영되지 않는다. 디스크 목록으로 평소처럼 받는다 | (b) [가정: 특정 채널·주인이 직접 준 권한이라 정책 수준에서 받아들인다, 사용자 결정 §15-2] |
| 유예 끝(`verified_at + 72h`) | 전부 막힌다(로그인 화면) | 기존 규칙 |
| 받는 중·대기 중 작업 | 끝까지 받는다 | `worker.md:623` [확인] |
| 허가 제외·세션 폐기(3차) | `/api/me`가 그 코드를 받는 순간 **새 작업 전체**(본인 채널 포함)가 막힌다 — 앞의 행들과 같은 때(그 채널 영상을 불러옴 ≤5분·[다시 불러오기] 즉시·다음 refresh ≤24h)에 닿는다 | §9.4 (가)·(나) |
| `me`가 `invalid_token` + 뒤 refresh가 네트워크 실패(3차) | 반영되지 않는다(오프라인 유예와 같다). 디스크 목록으로 판정 | §9.4 (다)(c). 2차의 "이 경우 위임만 거부"를 거둠 — 서버가 거부를 말한 것이 아니다 |
| 맡은 채널의 생방송(3차) | v1에서는 처음부터 열지 않는다(§9.1). 진행 중·대기 중 작업은 회수 뒤에도 계속된다는 규칙(§10)은 생방송에도 같지만, 방송이 끝날 때까지 새 내용을 받는 점이 달라 녹화 중 회수 정책(O-4)이 따로 필요하다 — 그래서 L-D1(§15-9)로 미뤘고 (A) 닫음으로 확정됐다(2026-10-16). 닫으려면 자동 이어받기 필터가 채널 ID만이 아니라 컨텐츠 종류도 받아야 한다(`manager.rs:610`) | `app.md:1386` 77 · `ROADMAP.md:83` |
| **최악 지연** | **72h**: 회수가 `verified_at` 직후에 일어나고 그때부터 유예 끝까지 내내 오프라인일 때(앱을 켜 둔 채든 꺼 두었다가 켜든). 온라인이면: 아무것도 안 할 때 ≤24h(다음 refresh), 그 채널 영상을 쓸 때 ≤5분, 앱을 새로 켤 때 시작 refresh 뒤(§9.3의 지연 깃발이 전제). 앱을 꺼 두었다가 **온라인으로** 켜는 경우가 72h가 아닌 것은 §9.3 규칙 덕분이고, 그 규칙 없이는 최대 72h 묵은 목록으로 자동 이어받기가 돈다 | `verify.rs:103`·`:125-135`, `service.rs:334-338`·`:462-471`, `app.rs:350` |

신뢰 수준 (a)(이번 실행 서버 확인 ∧ 온라인, 관리자 선례 102 (라) [확인])를 고르면 오프라인·시작 직후에 맡은 채널 영상이 막히고 `Ownership::DelegatedUnverified` + warning Notice + 설정 행 도움말 변형이 필요하다. "주 1~2회 쓰는 PS2에게 가끔 안 된다가 보인다"는 [가정]이다(§15-2는 사용자가 정한다).

---

## 11. 보안

| 위협 | 대책 |
|---|---|
| 초대 주소 추측·열거 | 토큰은 `mint("invite")` = 접두 + b64url(**32바이트 = 256bit**, `token.ts:30-33` [확인]; 이전 "128bit"는 `newId` 16B와 혼동한 오류). `TOKEN_PREFIX`(`token.ts:7` [확인])에 `invite: "cdi_"`를 더하고 `isToken`이 같은 43자 규칙으로 판정. 저장은 SHA-256 해시만(`token.ts:4`·`AuthStore.ts:66` [확인]). URL은 `quiet`. 만료·사용됨·없음을 한 페이지로. GET은 상태를 바꾸지 않고 DO 읽기 1회 |
| 주소를 엉뚱한 사람에게 보냄 | 1회용·7일. 연 사람이 즉시 편집자 행에 보이고 [편집자 빼기]로 복구. 새로 만들면 이전 주소 무효. 도움말 문장(G6). 받은 쪽이 얻는 것은 "그 채널 영상 받기"뿐이고 Worker가 다운로드를 보지 않는 정책 수준은 그대로(`ROADMAP.md:72` [확인]) |
| 주소가 전달 경로에 남음 | 카카오톡 미리보기·브라우저 기록·오류 수집에 남는지는 **[실측 필요]**(Codex도 판정하지 않았다). 설계의 대책: OG 없음 + `noindex`(미리보기 봇의 GET은 상태를 바꾸지 않는다), 토큰은 수락 때 소비되고 7일 만료, 앱은 주소를 저장하지 않는다 |
| 편집자가 로그인해서 잃을 것 | [가정] 없다(채널 이름·ID가 주인의 목록에 보일 뿐). 그래서 사회공학 경고 Notice를 두지 않는다. 로그인 폼 화면의 네 줄 고지는 둔다(`G-PRIVACY-R17` [확인]). D62 UT9에서 "로그인 = 수락"의 놀람과 함께 본다 |
| 다른 계정으로 수락됨 | 완료 페이지가 "내 채널"을 보이고 [편집자 그만두기]가 같은 페이지에 있다. 주인도 [편집자 빼기] |
| 위임 남용 | 편집자 10명(기다리는 중 포함), 편집자당 맡은 채널 20개(둘 다 [잠정]). 편집자도 허가 채널이어야 한다(가+). 관리자는 거부된 시도 표 꼬리표로 본다([가정] A21, 전체 표는 §18-8) |
| DO 쓰기 소모 | 초대 생성은 허가 세션만, 한 주인에 기다리는 초대 하나. `/invite/:token/start`는 `startWeb`과 같은 IP 스로틀·32행 상한 |
| 회수 지연 | §10. 관리자 `disallow`는 위임을 즉시 삭제하고 다음 요청부터 묶음에서 빠진다(admission은 요청마다 `worker.md:887` 38 (카) [확인]). V2 롤백 창의 제외는 허가 시각 판정이 덮는다(§8.1). `/api/me`가 허가 제외·세션 폐기를 알리면 refresh를 기다리지 않고 기존 거부·만료 전이로 **새 작업 전체**를 막는다(§9.4, 3차 N1). 늦게 온 응답이 최신 상태를 덮지 않는다(`me`·refresh 같은 잠금, §9.4 적용 순서, 3차 N2). 맡은 채널의 생방송은 v1에서 열지 않는다(작업 하나가 회수 뒤에도 방송 끝까지 새 내용을 받으므로, §9.1) |
| 수동 [다시 불러오기] 남용 | Worker 쪽 상한 없음(§9.4 비용). 한 클릭 = 읽기 RPC 1회, 쓰기 0. 앱 single-flight. [가정] 사람 클릭 속도면 충분, 실측 뒤 §18-12 |
| 늦은 응답이 다른 계정·최신 상태에 적용 | 다른 계정: 세션 세대로 버린다. 같은 계정의 늦은 `me`: refresh와 같은 잠금이라 생기지 않는다(§9.4 적용 순서) |
| 로그·비밀값 | 초대 주소는 `Secret`, `redact_url`이 `/invite/<token>` 경로를 가린다. `/invite/*` 경로는 quiet. 앱 API는 본문에 ID |
| 이름 위생 | `editor_name`·`claimed_name`은 편집자 제어 값: 저장 때 `clip(128)`(`allowlist.ts:20-23` [확인]), 앱 표시 때 `cleanDisplayText` + `<bdi>`(새로 만든다), Worker는 이스케이프 |
| 앱 API CSRF | Bearer만 받고 쿠키를 보지 않는다. 행렬이 고정 |

---

## 12. 접근성

- 설정 행: `SettingsRow`의 `labelId`·`helpId`가 버튼의 `aria-describedby`로 이어진다. 편집자 행 버튼 접근 이름 `a11y.removeEditor`(대상 먼저). 두 그룹 머리 행은 컨트롤 없는 행이다.
- 주소 칸: `<label for>` "초대 주소", `readonly`, mono, `word-break: break-all`, 선택·복사 가능. 만든 직후 `role="status"` 낭독, 포커스 이동 없음. [주소 복사] 라벨 전환은 폭 유지.
- 설정 실패: 그 컨트롤 바로 아래 `inline` `role="alert"` 하나(한 사건 한 수단).
- 거부 Notice: `role="alert"` + [받기] `aria-describedby` 그대로. [다시 불러오기]는 `loading`일 때만 `aria-busy`·`aria-disabled`(컴포넌트가 막는다); 그 밖에는 늘 누를 수 있다. 결과가 바뀌면 `announcer`.
- 토스트 [되돌리기]: 6초 + hover·포커스 정지(D37), 지연 회수.
- 초대·완료 페이지: JS 없음(D52 [확인]), skip link, h1 하나, 폼 하나, `.btn-primary` 하나(완료 페이지는 0), 링크 "처음으로"는 `<a>`, 4xx는 `<title>` "오류: " 접두 + 아이콘 + 글자. 키보드만으로 완주 기록 `R8`.
- 카드 메타 조각·관리 꼬리표([가정] A21): 글자. 색만으로 뜻을 주지 않는다. forced-colors 매핑 표 추가 없음.
- 대상 크기: 설정 행 버튼 24(기존 계정 행 `.edge-end` sm `AccountSection.svelte:33` [확인]), Worker 버튼 28.

---

## 13. 디자인 시스템 영향

| 구분 | 내용 |
|---|---|
| 컴포넌트(기존만) | `Surface group` §2.16 · `SettingsRow` §2.17 · `FieldRow`(patterns §6.2) · `Button` §2.1(secondary sm·ghost sm·`loading`) · `TextField readonly` §2.3 · `Notice` §2.12(**inline** danger: 기존 notOwn + 설정 실패) · `Toast` §2.13([되돌리기], 지연 회수) · Worker `.btn-primary`·`.btn-secondary`·`.actions`·`dl`·flash banner. `OwnershipNotice.svelte`는 행·caption·동작을 그리도록 **수정**(새 컴포넌트는 아니다). `cleanDisplayText`·`<bdi>`는 앱에 **처음** 들어간다 |
| 패턴 | patterns §14.4 설정 계정 행(행 셋 추가) · §6.5 카드 안 경고(둘째 문장·동작·caption) · §1.1 위계(인라인 > 토스트, 배너·대화상자 없음) · **§1.2 결정표에 행 추가**: 편집자 빼기 → 토스트 [되돌리기](지연 회수) / 편집자 그만두기 → 토스트 / 초대 만들기 → 인라인(행 펼침) / 만들기·빼기·그만두기 실패 → **inline danger** / 맡은 채널 영상 → 메타 조각 · §4 표에 행 추가("편집자 빼기 | 가역 | 즉시 숨김 + 토스트 [되돌리기] | 지연 회수: 토스트가 닫힐 때 `removeEditor`") · §13 로그인 거부(한 줄) · §14.5 Worker(완료 페이지) |
| 결정 인용 | D10 D21 D36 D37 D42·D43·W1 D44·D45·D46 D49 D51 D52 D53 D54 |
| ADR | **ADR-0026 "맡기기: 본인 영상 제한을 맡은 채널로 넓힌다"** 한 장(번호는 `adr/0025-live-recording.md` 다음 [확인]). D값을 뒤집지는 않지만 README §7.1-4(새 패턴 행)·§7.1-5([잠정] 상수 신설·용어집 "되돌리기" 자리 확장) [확인]에 걸리므로 "의무 아님"이 아니라 **이 ADR이 그 의무를 함께 진다**. 3차에 더하는 것: ① ADR-0025 "게이트는 그대로다" 줄의 예외(맡은 채널 생방송은 v1에서 열지 않는다, README §7.1-3 원칙 예외) ② 막힌 카드 버튼은 새 라벨 없이 기존 [다시 불러오기]를 쓴다(허용 목록 `content.md:142`·`:143` 안, 새 낱말 없음 — 그래서 허용 목록을 고치지 않는다). 번호는 0025가 생방송 녹화(D63)로 쓰였으므로 0026이다(`README.md` §7.3 표 마지막 0025 [확인]). D 번호는 새로 두지 않는다(D63 다음 D64가 필요해지는 것은 ADR 검토에서 D 값이 생길 때). 상수 여섯은 ADR-0009 묶음에 행 추가(foundations §14 표. Worker 상수는 DT15 파싱 밖) |
| gate | `design-copy`(용어집 행 추가 + "되돌리기" 행 수정 + 허용 목록: `invite.confirm.title`의 `?`, 두 deck 고지 동일 DC6, 미참조 키 0) · `frontend`(계정 그룹 행·펼침·복사 전환·지연 회수 토스트·notOwn 둘째 문장·[다시 불러오기] loading·메타 조각·빈 상태 분기·inline 실패) · `worker`(경로 행렬·초대 상태 h1·채움 ≤1·GET 불변·멱등·quiet·noindex·꼬리표·store 단위·V2 롤백 호환) · `design-worker`(초대 페이지 상태 셋 + 완료 페이지 촬영) · `rust`(Signer·판정·parse·session 왕복·recheck·세대·401/403) · `e2e-web`·`worker-e2e`·`e2e-native`(§14) · 리뷰 R1·R3·R7·R8·R10 |
| 문서 | content.md §4(행 추가 + "되돌리기" 행 수정)·§15, `design/copy/terms.json`, patterns.md §1.2·§4·§14.4·§6.5, web.md §1 화면 표(초대·완료 두 행)·§7.2 버튼 표·§12·§6.3(seeOther 세 곳 + FlashKind 여섯, 구현 중 변경 105 한 항목)·`:146` `landingLead` 표기 정정, worker.md §4.2·§4.5·§5·§6.3·§8 + 구현 중 변경 새 번호(지금 기준 **105**), app.md 구현 중 변경(지금 기준 **78**, `app.md:1386` 마지막 77 [확인]), ROADMAP "확정된 결정 › 본인 영상 제한" 행을 **취소선 + 날짜 관례**로 고침(새 열·새 행 아님: "뒤집는 결정(확장)" 관례는 `docs/`에 없다, 검색 0건 [확인]) + 체크리스트, `/privacy`, `help/editors.md`·`help/ids.json`, governance §6.2 과업 UT8·UT9, runbook(롤백 대상 V3 직전까지) |

---

## 14. 테스트 계획

| 층 | 테스트 |
|---|---|
| Worker store(vitest, `test/store/delegation.test.ts`) | V3 마이그레이션(빈 DB → 3, V2 → 3의 `sqlite_master` 동일) · `createInvite`(이전 미청구 초대 대체, 상한 10, 토큰은 돌려주고 해시만 저장, 토큰이 `isToken("invite")`) · `inviteView`(만료·사용·없음 모두 null) · `acceptInvite`(self·full·already·gone, 회수된 행 되살림, 초대 소비, 허가 시각 둘 = 각 allowlist 행의 현재 `added_at`) · `claimInvite` · `allow`·`allowDenied` 뒤 위임 자동 완성(같은 트랜잭션: 실패 주입 시 둘 다 롤백; **이미 허용된 채널에 `allow`를 다시 눌러도**(`allowlist.ts:58` note만 갱신) 위임의 `editor_allowed_at`이 행의 `added_at`과 같아 활성이다) · `disallow(로그인 ID)`가 주인(`owner_login_channel_id`)·편집자·청구 초대를 모두 지움 · **V2 롤백 호환**: V3 위임 생성 → V2 `disallow`의 SQL 두 문 직접 실행 → V2 `allow` SQL로 재허가 → `delegationsOf`·`editorsOf` 빔, sweep이 그 행을 지움 — 보통 행과 **대안 B 행**(`channel_id ≠ owner_channel_id`) 둘 다 · **초대 롤백 호환(3차 N3, sweep을 부르지 않고)**: (i) **미청구 초대** — V3 `createInvite` → V2 `disallow`·`allow` SQL로 주인 제외·재허가 → V3 `inviteView` null, `acceptInvite` `gone` + 위임 행 0 + 초대 행 삭제, 주인의 `editorsOf.pendingInviteUntil` null (ii) **청구된 초대** — V3 `createInvite` → 비허가 편집자의 콜백으로 `claimInvite` → V2 SQL로 주인 제외·재허가 → V3 관리자 `allow(편집자)` → 위임 행 0·초대 삭제, `adminView`에 그 편집자의 꼬리표 없음, `editorsOf`에 기다리는 편집자 없음 (iii) 청구 **전에** 주인이 바뀐 초대를 비허가 편집자가 열면 `claimInvite`가 청구하지 않고 denied 페이지에 `invitePending` 줄 없음 (iv) 바뀌지 않은 초대는 셋 모두 그대로 동작(음성 대조) (vi) 무효가 된 청구 초대 10개가 남아 있어도 `createInvite`가 `limit`이 아님(상한 셈도 `inviteValid`) (v) `acceptInvite`가 만든 위임의 `owner_allowed_at` = 초대 행 값(다시 SELECT하지 않음: 테스트에서 둘 사이에 allowlist 행을 바꿔 끼우면 `gone`) — 여섯 모두 대안 B 행으로도 · `removeEditor` 멱등 · `leaveDelegation` 멱등 · `delegationsOf` 20개 상한·순서 · 키 규칙(대안 B, §8.6 ①②③) · sweep 멱등 · 묶음·check에 `delegatedChannels`, RPC 수 증가 0 |
| Worker http(`test/http/invite.test.ts`·**`test/matrix.test.ts`**(루트, `test/http/` 아래가 아니다 [확인])·`test/http/r2-calls.test.ts`) | 경로 행렬 새 행 10개 × 자격 8종 · 초대 상태표의 h1·`<title>`·채움 수·폼 수 · GET이 DO 상태를 바꾸지 않음 · 콜백 흐름(허가 → done, 거부 → denied + 줄, self → flash, full → flash) · `/me/delegations/done`이 quiet가 **아님**(`isQuietPath` false) · `/invite/:token/start`의 `sameOriginPost` 거부 403 · PRG·flash 세 종류 · `noindex`·OG 없음 · quiet 경로에서 로그 0줄 · 앱 API: Bearer만, 쿠키 무시, 본문 형식 400, CI 토큰 401 · `/api/me` 모양 · 관리 꼬리표 · DO RPC 수 표 행 |
| 셸(`crates/shell/tests/`) | `parse_bundle`·`parse_me` 관대성 · `session.json` 왕복 + 옛 파일 읽기 + 새 파일을 옛 모양으로 읽기 · `Signer.delegated`가 한 잠금에서 읽힘 · `on_resolved` 표 5행 · `admit`·`resume_job`·자동 이어받기 필터 · `ensure_delegations_fresh`: 자동 간격·single-flight·오프라인 때 호출 0·네트워크 실패가 phase를 바꾸지 않음·성공이 파일을 씀·**[다시 불러오기]는 간격 안에서도 요청을 보냄** · **세션 세대**(먼저 쓴다): A 계정의 `/api/me`를 지연시킨 뒤 로그아웃 → B 로그인 → A 응답 도착 순서에서 B의 메모리·파일·판정이 바뀌지 않음, 기다리던 판정이 B의 `signer()`로 다시 판정됨 · **Worker 형식 오류 셋**(3차 N1, 먼저 쓴다): ① `/api/me` 403 `not_allowed` → refresh를 부르지 않고(가짜 API의 refresh 호출 0) phase Denied·`session.json` 지워짐·본인 채널 영상의 새 `admit`도 `notLoggedIn`, **이미 받는 중인 작업과 대기 중 작업은 그대로 진행**(가짜 Backend의 진행 이벤트가 이어지고 완료됨) ② 401 `session_revoked` → 같은 꼴로 Expired(Revoked) ③ 401 `invalid_token` → refresh가 불리고 (a) ok면 새 목록으로 판정 (b) refresh 403 `not_allowed`면 Denied + `notLoggedIn` (c) refresh 네트워크 실패면 phase SignedIn(offline), **판정은 디스크 목록대로 `Delegated`**(서버 거부가 아니다), 로그아웃되지 않음 ④ `me`의 `invalid_token`을 `outcome_of_error`에 넣지 않음을 고정: access만 만료된 묶음(가짜 시계 +24h)에서 `me` → refresh ok → 로그인 유지 ⑤ A 세대의 늦은 `not_allowed`가 로그아웃 → B 로그인 뒤 도착하면 B는 SignedIn 그대로 · **적용 순서**(3차 N2, 먼저 쓴다, 가짜 서버 시간선): 가짜 Worker에 위임 상태를 두고 T에서 회수한다. ⓐ `me`를 보내 응답을 붙잡아 둔다(서버는 T 전에 처리 → `[A]`) ⓑ T에 회수 ⓒ 같은 때 refresh를 시작한다 → **`me` 응답 전에는 refresh 요청이 서버에 닿지 않음**(가짜 API의 refresh 호출 수 0) ⓓ `me`를 풀어 `[A]` 적용 ⓔ refresh가 나가 `[]` 적용 → 끝 상태에서 메모리 `held.delegated_channels`와 `session.json` **둘 다 `[]`**, 다음 판정 `NotOwn`. 보강: 구현에서 `me`의 `refresh_lock`을 빼면 이 테스트가 실패하는지 확인한다(깨서 잡는지) · `me`가 잠금을 잡은 뒤 `held`의 access를 읽음(기다리는 동안 회전된 경우 새 access로 보냄, `invalid_token` 고리 없음) · `me`가 `refresh_gen`을 올리지 않음(`me` 뒤에 줄 선 refresh가 실제로 보내짐) · `invalid_token` 경로가 멈추지 않음(잠금을 놓고 refresh, 시간 상한 안에 끝남) · **앱 쓰기 API 재시도**(3차): access 만료 + refresh 가능 상태에서 `editors_invite`·`editors_remove`·`delegations_leave`가 refresh 1회 뒤 재시도로 성공하고 로그인이 유지됨, `not_allowed`면 Denied · **생방송 예외**(3차): 맡은 채널 c의 `ContentRef::Live` → `on_resolved`가 비관리자 `NotOwn`·관리자 `AdminOverride`, `admit`이 `notOwnContent`, interrupted Live 작업이 둘째 깃발 자동 이어받기에 들지 않음, 같은 c의 Video·Clip은 `Delegated` · **시작 자동 이어받기 지연**: 디스크 목록에 c가 있고 c의 `interrupted` 작업이 있을 때 Optimistic 첫 SignedIn에서는 줄 세우지 않고 첫 묶음 뒤 SignedIn에서 줄 세움, 묶음이 c를 빼면 줄 세우지 않음, 실행 내내 오프라인이면 줄 세우지 않음(본인 작업은 지금처럼 첫 SignedIn에서) · `last_me_at`이 시작값 None이라 첫 판정이 요청을 보냄 · 회수 뒤 `admit`이 `notOwnContent` · bindings 갱신 · 가짜 `WorkerApi` 메서드 4개 |
| 앱(vitest) | `AccountSection` 행 셋(없음·기다리는 초대·편집자·상한·오프라인 비활성 사유) · 펼침 + [주소 복사] 전환 · **[편집자 빼기] 지연 회수**: 토스트 살아 있는 동안 [되돌리기] → 행 복귀·호출 0, 닫히면(타이머·[×]·교체) `editors_remove` 1회, 둘째 빼기 토스트가 와도 첫 회수가 먼저 확정되지 않음(`patterns.md:277` 강제 항목과 같은 꼴 [확인]) · 실패 inline · `OwnershipNotice` 행·둘째 문장·caption·[다시 불러오기] loading(`recheck` → `ownership_recheck` 뒤 resolve 1회, 글자는 `action.reresolve`)·오프라인 줄 · **맡은 채널 생방송 갈래**(3차: `delegatedLive`면 제목·본문·[닫기]만, 편집자 안내 줄·[다시 불러오기]·L2 없음) · 메타 조각 · `list.empty.scopeDelegated` 분기 · `errors.ts` 골든 · `cleanDisplayText`·`<bdi>` · `design-copy` 용어·허용 목록 |
| e2e-web(Playwright, `app/e2e/mock/backend.ts`) | 맡은 채널 영상 카드가 조각을 보이고 받아진다 · 남의 영상은 둘째 문장 + [다시 불러오기] → 가짜 백엔드가 목록을 바꾸면 카드가 열린다(간격 안에서도) · 맡은 채널의 `live/` 주소는 생방송 갈래 문구로 막히고 [받기] 비활성(가짜 백엔드 `resolve`가 Live + 판정 notOwn을 돌려준다, `app/e2e/live.spec.ts` 꼴) · 설정 편집자 행에서 초대 → 복사 → 빼기 → 되돌리기 → 다시 빼기 → 6초 뒤 전송 · axe 0 |
| worker-e2e(`scripts/e2e-dev.mjs`, 가짜 치지직 계정 a1·b2·c3·d4 `fake-chzzk-server.mjs:92` [확인]) | a1(허가 주인) 앱 API로 초대 → b2(허가 편집자) 비로그인 브라우저로 열어 로그인 → `/me/delegations/done` → a1의 `/api/me`에 b2 · b2 묶음에 a1 · c3(비허가) 열어 로그인 → denied 페이지 줄 → 관리자 [허가] → c3 묶음에 a1 · b2 [편집자 그만두기] → 빠짐 · 같은 토큰 두 번 → gone · a1이 자기 주소 열기 → self 페이지 |
| e2e-native(Linux·Windows) | 픽스처 묶음 `delegatedChannels: []` 유지 + 사례 하나로 맡은 채널 영상 받기 1회(결과 sha256) |
| design-worker | 초대 페이지(비로그인·확인·만료)·완료 페이지 스냅샷 기준선(Linux CI) |
| 사용자 시험(D62) | UT8 "다른 사람에게 영상 받기를 맡겨 보세요"(설정 행만으로 찾는가) · UT9 "받은 초대 주소로 그 채널 영상을 받아 보세요"(로그인 = 수락이 놀라움인가, **열려 있던 거부 카드에서 [다시 불러오기]를 찾는가**). **D62 조건과의 관계**(개정): D62·`governance.md:419` §6.1은 "1회차 = 적용 전 현재 앱(기준선), 2회차 이후 = 적용 뒤, 두 회차의 대본은 같은 판"이고 `:423`은 "대본이 바뀌면 이전 회차와 합산하지 않는다" [확인]. 아직 시험 기록은 하나도 없다(`docs/design/system/tests/` 없음 [확인]). UT8·UT9는 적용 전 앱에 기능이 없어 **기준선 회차에서 측정 대상이 없다**. 그래서 ① UT8·UT9는 대본 판을 올리는 **추가 과업**이고 D62의 "기준선 ↔ 적용 뒤" 비교는 UT1~UT7에만 성립한다 ② UT8·UT9의 합산은 이 기능이 들어간 뒤의 회차끼리만(두 회 이상, 회당 3명 — D62의 횟수·인원 조건은 그대로) ③ 이 기능 전에 1회차(기준선)를 이미 돌렸다면 UT8·UT9 행은 그 회차에 "기능 없음·측정 없음"으로 적고 합산에서 뺀다 ④ 한 회만 돌리면 "축소한 시험"으로 적어 발견성·로그인 수락 방식의 확정 근거로 쓰지 않는다(Codex 지적). "D62 충족 조건은 그대로"라는 이전 문장은 UT8·UT9에 기준선이 없다는 점을 빠뜨린 것이라 거둔다 |
| ratchet | `tests.worker`·`tests.vitest`·`tests.rust`·`tests.playwright` 증가, `tests.app_e2e.<os>` 유지 이상 |

---

## 15. 사용자가 정할 것

| # | 결정 | 선택지 | 추천 | 왜 |
|---|---|---|---|---|
| 1 | 허용목록과의 관계 | **가+** / 나(위임 = 허가, 뒤집는 결정) / 다(관리자 "위임 요청" 표) | **가+** | `ROADMAP.md:74` 결정을 지키면서 편집자의 2단 마찰을 관리자 클릭 한 번으로 줄인다 |
| 2 | 신뢰 수준 | (a) 이번 실행 서버 확인 ∧ 온라인 / **(b) 디스크 값 + 72h 유예 + 판정 직전 확인** | **(b)** [가정] | 설명 문구 0개. 회수는 온라인이면 다음 사용 때(≤5분) 또는 ≤24h, 앱을 새로 켜면 시작 refresh 뒤(§9.3 지연 깃발 전제), **최악 72h**는 그 사이 내내 오프라인일 때(§10). 서버가 허가 제외·세션 폐기를 알리면 그 자리에서 새 작업 전체가 막힌다(§9.4 (가)·(나), 3차). (b)의 대가는 "서버 확인을 못 하는 동안 디스크 목록을 믿는다"이고, 그런 때는 ① 오프라인 유예 중 ② `me`가 `invalid_token`(access 만료)인데 뒤 refresh가 네트워크 실패 ③ 오프라인으로 다시 켠 뒤 손으로 [이어받기]다(3차: 2차의 "구멍은 ③뿐"은 좁은 설명이라 거둔다, Codex D2 판정). 관리자 예외를 (a)로 묶은 이유(남의 모든 영상)가 특정 채널에는 약하다는 것은 설계자 판단이다 |
| 3 | 스트리머 관리 자리 | **앱 설정 완결(앱 쓰기 API 3개)** / 앱은 읽기 + 브라우저 랜딩 블록 | **앱 완결** | 3단계 vs 5단계, `loginTwice` 마찰 회피, 복사 버튼(D52) — 둘 다 [확인] |
| 4 | 편집자 수락 방식 | **로그인 = 수락 + 완료 페이지 되돌리기** / 로그인 뒤 [편집자 되기] 확인 한 번 더 | **로그인 = 수락** | 2번 vs 3번. 가역이라 확인 없음 + 되돌리기(`patterns.md:256` [확인]). 놀람은 [가정] → D62 UT9에서 관찰되면 확인 단계를 더한다 |
| 5 | [편집자 빼기] 되돌리기 | **지연 회수 토스트 [되돌리기]**(`restore` API 없음) / 즉시 회수, 되돌리기 없음(다시 초대) | **지연 회수** | patterns §4·D37·components §2.13의 "지연 삭제" 규칙 그대로 [확인]. API·분기가 준다 |
| 6 | 편집자 [편집자 그만두기] | **v1 포함** / v2 | **v1** | 고지의 "끊는 길"(C7 [확인]) |
| 7 | 상한·기한 | 초대 7일 · 편집자 10 · 맡은 채널 20 · 자동 확인 5분 · 청구 보존 30일 · 완료 창 2분 | ADR-0009 묶음 등록 | 전부 [잠정] 근거 없음. 실측 질문: 여러 채널을 맡는 편집자가 흔한가(§18-2) |
| 8 | 초대 전 채널 이름 노출 | **로그인 전에 보인다** / 로그인 뒤에만 | **보인다** | 로그인 = 수락이면 로그인 전에 동의 내용을 알아야 한다(`G-PRIVACY-R17` [확인]). "공개 정보"는 [가정] |
| 9 | **L-D1 (새 결정 후보, 3차)** 맡은 채널의 생방송 녹화를 언제 여나 | (A) v1은 닫고, 녹화 중 회수 처리(⑤ O-4)를 정한 뒤 연다 / (B) v1부터 연다(진행 중 녹화는 회수 뒤에도 방송 끝까지) / (C) v1부터 열되 녹화 중 5분 [잠정]마다 맡은 채널을 확인해 빠지면 [녹화 마치기]와 같이 받은 만큼 마무리 | **(A)** [가정] | "v1은 맡은 채널을 ⑤에 넣지 않는다"는 decisions.md C4 확정("⑤는 O-6 뒤")이다. 새로 정할 것은 **여는 조건과 방식**이다. (B)는 코드가 가장 적지만(§9.1 예외만 빼면 된다) 생방송 작업 하나가 회수 뒤에도 몇 시간씩 새 내용을 받아 §10 상한이 깨진다(`app.md:1386` 77 · `ROADMAP.md:83`). (C)는 상한을 ≤5분으로 되돌리지만 셸에 녹화 중 확인 고리(새 타이머·새 상태 문구)가 생긴다 — UX 기준 ①(복잡하지 않게)을 생각하면 ⑤ O-4(본인 채널의 허가 제외에도 같은 문제)와 한 번에 정하는 편이 작다. (A)를 고르면 §7.2 생방송 갈래 문구 하나가 v1 비용이다. 편집자(Q1)가 생방송 원본을 얼마나 원하는지는 사용자 관찰이 없다 [가정] |

---

## 16. 뒤집는 결정 모음

| 대상 | 지금 | 이 기능 뒤 | 표시 |
|---|---|---|---|
| ROADMAP "확정된 결정 › 본인 영상 제한"(`ROADMAP.md:72` [확인]) | 클라이언트에서 로그인 채널 ID == VOD/클립 채널 ID | 로그인 채널 **또는 그 채널 주인이 맡긴 채널** == 영상 채널. 신뢰 수준·판정 자리는 그대로 | 그 행을 `~~옛 결정~~ → **2026-10-16 …**` 꼴로 고친다(`ROADMAP.md:74` 관례 [확인]) + ADR-0026 |
| 공개 약속 문구 `notice.unofficial` 끝 문장(`ko.ts:34-37`·`copy.ts:67` DC6 [확인]) | "이 앱은 로그인한 채널의 영상과 클립만 받아요." | "… 그리고 채널 주인이 맡긴 채널의 영상과 클립만 받아요." | 두 deck 함께 바뀜 |
| Worker 로그인 고지 "쓰는 곳" `landing.consent.use`(`copy.ts:46` [확인]) | 허가 확인과 ‘내 기기’ 표시에만 | + 편집자 표시 | Worker만(앱 `auth.consent`에는 "쓰는 곳" 줄이 없다 `ko.ts:270-271` [확인]) |
| `/privacy` | 채널 이름·ID만 | 편집자 항목 추가 | 함께 바뀜 |
| `notOwnContent` 제목·`list.empty.scope` | 내 채널만 | 맡은 채널이 있을 때 "내 채널이나 맡은 채널" | 함께 바뀜. ~~`landingLead`~~는 코드에 없어 대상이 아니다(§7.3) |
| `content.md:107` 용어집 "되돌리기" 자리 | 목록 지우기 토스트의 버튼에만 | 되돌리기 토스트의 버튼에만(목록 지우기·편집자 빼기) | 같은 뜻·같은 수단, 자리 추가. ADR-0026에 함께 |
| ROADMAP "배포: 본인·지인만, 허용목록으로 제한"·"허용목록은 관리자가 /admin에서"(`ROADMAP.md:74`·`:82` [확인]) | — | **그대로**(가+는 허용목록을 넓히지 않는다) | 뒤집지 않음 |
| ROADMAP "형식 있는 401·403은 즉시 차단"(`ROADMAP.md:83` [확인]) | — | **그대로**(`/api/me`의 거부도 같은 상태 머신으로, §9.4) | 뒤집지 않음(이전 초안은 뒤집으면서 표시하지 않았다 — Codex 지적) |
| worker.md §8.1 "Open API 채널 조회로 미리 채우지 않는다" [확인] | — | 그대로 | 뒤집지 않음 |
| `G-WEB-R9` "inAppHint는 failed에만" [확인] | — | 그대로(초대 폼 아래에 두지 않는다) | 뒤집지 않음 |
| ADR-0025 결정 "게이트는 그대로다: 생방송도 … 본인 채널 판정을 한다(관리자 예외 포함). 별도 규칙이 없다" [확인] | 생방송도 VOD와 같은 판정 | 판정에 맡은 채널이 생기되 **생방송에는 쓰지 않는다**(§9.1). 본인·관리자 판정은 그대로 | 좁히는 예외 하나(뒤집지 않음). ADR-0026에 "ADR-0025 게이트 줄의 예외"로 적는다(README §7.1-3 원칙 예외 `README.md:248` [확인]) |
| D36 대화상자 7종 · D52 Worker JS 없음 · D53 랜딩 채움 하나 | — | 그대로 | 뒤집지 않음 |

---

## 17. PR 단계(stacked, 각 PR 뒤 Codex 리뷰)

| # | 커밋 타입: 요약 | 범위 | 완료 조건 |
|---|---|---|---|
| 1 | `docs: 편집자 위임 설계를 적는다` | worker.md·app.md 구현 중 변경 번호(105·78), content.md 용어집(행 추가 + 되돌리기 행 수정) + `terms.json`, patterns §1.2·§4·§14.4, web.md §1·§6.3·§7.2·`landingLead` 표기 정정, foundations §14 상수, ADR-0026 + ADR-0009 행, governance UT8·UT9, ROADMAP 행 고침·체크리스트, runbook 롤백 범위 | `design-copy` 패리티·`adr.test`·`spec-check` 녹색 |
| 2 | `feat: Worker DO에 위임·초대 표와 RPC를 더하고 토큰 묶음에 맡은 채널을 싣는다` | `schema.ts` V3, `store/delegation.ts`, `sessions.ts`·`allowlist.ts`·`sweep.ts` 확장, `types.ts`, `core/token.ts`(`invite` 접두), `session.ts`(`/api/me` 확장·`tokenBundleJson`) | store 단위 + V2 롤백 호환 + 묶음·`/api/me` 모양 + RPC 수 표. 이 PR만 배포돼도 옛 앱 무영향 |
| 3 | `feat: Worker 초대·완료 페이지와 앱 편집자 API를 연다` | `routes.ts`(10행), `http/invite.ts`·`invite-view.ts`, `auth.ts` 콜백 분기, `web-session.ts` `seeOther` 세 곳, `flash.ts` 종류 셋, `admin-view.ts` 꼬리표, `copy.ts`, `/privacy`, 도움말 `editors`, worker-e2e 흐름, design-worker 기준선 | 행렬·상태표·quiet·R8 기록 |
| 3½ | `chore: 버전을 0.8.0으로 올린다` | `Cargo.toml` `[workspace.package] version`·`tauri.conf.json`·`app/package.json`(`versions` gate가 셋을 대조) | 릴리스 1에 **필수**(개정): 태그 gate는 "버전 = 태그, 단조 증가"를 본다(`release.yml:50-79` `release-gate` 작업·`scripts/ci/release.mjs:6`·`:355` [확인]). 버전 올림이 PR 6에만 있으면 릴리스 1 태그 `v0.8.0`이 gate에서 빨개진다. 지금 버전은 0.7.0(`Cargo.toml:9` [확인], 생방송 녹화 릴리스)이다(3차). `node scripts/ci/release.mjs next-version`으로 확인 |
| — | **릴리스 1**(`feat` → 0.8.0): PR 2·3·3½만 담아 Worker를 먼저 운영에 올린다 | | 옛 앱은 키를 버린다. §8.7의 "앱 먼저" 창을 없앤다 |
| 4 | `feat: 셸이 맡은 채널을 판정에 넣고 판정 직전에 확인한다` | `ownership.rs`, `auth/{api,http,session,service,verify}.rs`(`me`·3 API·`ensure_delegations_fresh`·세대·`me_outcome`(not_allowed·session_revoked → 기존 전이, invalid_token → refresh)·`me`의 `refresh_lock`·`last_me_at`·consts, `ownership.rs` 생방송 예외(`verdict_in`에 컨텐츠)), `dto.rs`·bindings, `app.rs` 필터(깃발 둘)·command 5개, `gate.rs`, 가짜 API·테스트, 네이티브 픽스처 | `rust`·`tauri` gate, bindings 갱신 |
| 5 | `feat: 앱 설정에 편집자·맡은 채널 행을 두고 막힌 카드에 다음 행동을 보인다` | `AccountSection.svelte`(+ `EditorsRows.svelte`), `OwnershipNotice.svelte`(행·caption·동작)·`ResolveCard` 메타, `cleanDisplayText`+`<bdi>`, `errors.ts`(ActionId `recheck` → `action.reresolve`, `ErrorContext.delegatedLive`·맡은 채널 생방송 갈래, 3차)·`ko.ts`, `api.ts` 래퍼, `help/editors.md`·`ids.json`, e2e mock·spec, 갤러리 고정 데이터 | `frontend`·`e2e-web`·`design-*` gate, R1 네 장 |
| 6 | `docs: ROADMAP 현재 위치와 편집자 위임 결과를 적는다` + `chore: 버전을 0.9.0으로 올린다` | ROADMAP, 버전 셋 | **릴리스 2**: 릴리스 1이 0.8.0이면 4·5도 `feat`라 0.9.0(`versioning.md` §2 표 "0.x 동안 MINOR" [확인], `release.mjs next-version`으로 확인). 한 릴리스로 묶으면 3½이 빠지고 여기서 0.8.0 하나(3차: 0.7.0은 이미 나갔다) |

2·3은 Worker 영역, 4·5는 app 영역이라 `changes` 필터로 CI가 갈린다. 2는 3 없이도, 2+3은 4·5 없이도 머지·배포할 수 있다(앱이 키를 버린다). **릴리스를 둘로 나누는 것이 §8.7 창을 없애는 가장 작은 방법**이고, 하나로 묶으면 그 창(길이 [실측 필요])을 받아들이는 것이다 — 사용자 결정.

---

## 18. 열린 항목·실측 도구

1. **카카오톡 인앱 브라우저에서 초대 → 치지직 로그인 → 돌아오기**가 끊기는지 — [실측 필요] 사용자가 본인 계정 둘로 직접. 출력은 "돌아왔다/안 돌아왔다"만. 끊기면 `/auth/done failed` 페이지의 기존 `inAppHint`(`pages.ts:71-72` [확인])가 나온다(초대 폼 아래에는 두지 않는다, §5.2).
2. **상한 N·M·기간** — [잠정] 사용자 인터뷰(여러 채널을 맡는 편집자가 흔한가). 도구 불필요.
3. **D62 UT9 "로그인 = 수락"의 놀람·사회공학 경고 필요성** — [가정] 관찰되면 확인 단계·경고 추가(결정 4).
4. **Worker 상수의 DT15 대조** — `check-tokens.mjs`가 Worker `store/delegation.ts`의 `export const`도 파싱하도록 넓힐지. 넓히지 않으면 foundations §14 "파일" 열만.
5. **streaming-roles(방송 관리자 목록에서 고르기)** — 보조안. 역할에 "편집자"가 없고 scope "채널 관리자 조회"가 필요하다(MCP 명세 [확인]). scope 추가가 모든 사용자의 동의 화면을 바꾸는지 [실측 필요]. v1 밖.
6. **기능 ⑤ 생방송 녹화와의 접점**(3차: v0.7.0으로 이미 출시) — 생방송은 같은 `OwnershipGate`를 지나므로(`app.md:1386` 77) v1은 판정에 생방송 예외를 명시해 맡은 채널의 녹화를 닫는다(§9.1). 여는 시점은 L-D1(§15-9).
7. **편집자 초대 주소를 앱 주소 칸에 붙여넣는 경로** — 새 카드 종류(새 패턴 → ADR)라 v1 밖.
8. **관리자에게 위임 관계 전체 표를 보일지** — 지금은 꼬리표만([가정] A21: 꼬리표면 충분하다는 판단에 근거가 없다. 관리자가 "누가 누구의 편집자인가"를 물으면 표를 더한다).
9. **같은 태그 릴리스에서 앱이 Worker보다 먼저 닿는 창의 길이** — [실측 필요] 실행 기록(verify 끝 ~ deploy-worker 끝). 릴리스를 둘로 나누면 문제가 없다(§17).
10. **`/api/me` 응답 시간이 300ms 안인지** — [실측 필요](§4.1 로더 규칙 분기).
11. **초대 주소가 전달 앱 미리보기·브라우저 기록에 남는 범위** — [실측 필요](§11).
12. **수동 [다시 불러오기]의 Worker 쪽 상한** — 지금은 없다(§9.4 비용, `/api/me`는 429를 내지 않는다). 읽기 1회·쓰기 0이라 두지 않는다 [가정]. 운영 로그에서 한 세션의 `/api/me` 호출이 눈에 띄면 세션별 상한(기존 `ROTATE_RATE_10M` 꼴)을 더한다.
13. **출시된 생방송의 관리자 예외 ↔ decisions.md L2(확정 "관리자 예외 없음")** — v0.7.0은 생방송에도 관리자 예외를 적용했다(`app.md:1386` 77 "관리자 예외 포함", ADR-0025 [확인]). 이 문서는 출시 코드를 기준으로 §9.1 생방송 행에 `AdminOverride`를 두었다. L2와의 차이는 ⑤(옛 생방송 설계(구현되어 core.md 구현 중 변경 58~60과 ADR-0025가 대신한다))·결정 표가 정리할 몫이다.
14. **"마지막 확인 {time}" 시각과 [다시 불러오기]의 짝** — 라벨은 "불러오기", 시각 조각은 "확인"이라 낱말이 다르다. 둘은 다른 것(버튼 = 동작, 조각 = 마지막 서버 확인 시각)을 말해 W1 위반은 아니라고 본다 [가정]. UT9에서 "[다시 불러오기]를 눌러 맡은 채널을 다시 확인한다"를 찾는지 함께 본다.

---

## 개정 기록(2026-10-16)

입력: Codex 1회차 적대적 리뷰(이 문서 몫 6건 + 결정별 판정 Q2·Q3·Q4·Q11) · 근거 확인 표(가정 13 · 실측 필요 4 · 인용 오류 10). 모든 근거는 이번 개정에서 master `bff221d`를 직접 다시 열어 확인했다.

### 반영한 지적

| 출처 | 어떻게 | 근거 |
|---|---|---|
| Codex "`/api/me`의 명시적 거부를 무시하는 것은 확정 결정을 뒤집는다" | §9.4 실패 행을 고쳤다: 형식 있는 401·403이면 그 응답을 적용하지 않고 기존 refresh(single-flight)를 즉시 불러 **상태 머신 하나**가 차단한다. 판정은 refresh 결과를 기다리고, 확인 전에는 기존 위임으로 새 작업을 허용하지 않는다. §16에 "뒤집지 않음" 행 추가, §14 셸 테스트 (a)(b)(c) | `ROADMAP.md:80` "형식 있는 401·403은 즉시 차단" · `worker.md:583` §11.3(머리는 `:564`) 같은 문장 · `verify.rs:138-164` `outcome_of_error` → `:199-228` `classify_verify`(이전 표기 "140-160 `classify_verify`"는 함수 이름·줄이 틀렸다) · `session.ts:68` `/api/me`도 같은 코드 |
| Codex "늦게 도착한 위임 조회가 다른 계정에 적용되지 않도록 하는 규칙이 빠졌다" | §9.4에 세션 세대 행: 요청 전 `session_epoch` 캡처, 응답 뒤 다르면 버림, 기다리던 판정은 현재 `signer()`로 재판정. §14에 "먼저 쓰는" 순서 테스트(A 지연 → 로그아웃 → B 로그인 → A 도착) | `service.rs:513`(캡처)·`:551`(버림)·`:920`·`:1116`(세대 증가) · `ownership.rs:130` 판정 직전 재읽기 |
| Codex "더하기만 하는 스키마가 위임 회수의 롤백 안전성까지 보장하지 않는다" | §8.1 `delegation`에 `owner_allowed_at`·`editor_allowed_at` 열, 활성 판정에 "허가 시각 = `allowlist.added_at`" 조건(관리자 NULL 예외). V2 롤백 중 제외·재허가는 `added_at`을 바꿔 V3 복귀 때 자동 무효. §14 호환성 테스트(V2 SQL 직접 실행), runbook에 롤백 대상 V3 직전까지 | `schema.ts:3` 앞선 DB 허용 · `allowlist.ts:90-96` 옛 `disallow`는 위임 표를 모름 · `:57-66` `allow`는 행이 없으면 새 `added_at`으로 INSERT |
| Codex "최악 96시간은 구현을 확인한 계산이 아니다" | §0·§10·§15-2를 **72h**로 고치고 시간선(기준 `verified_at` 하나)을 적었다. 온라인 ≤24h/≤5분, 오프라인 최악 72h | `verify.rs:9·11·103`(`verified_at + GRACE`) · `auth_verify.rs:452-457` `net_72h_exact` 만료 · `service.rs:557` `from_bundle(b, now)`(이전 표기 559는 두 줄 어긋났다) · **시작 직후 경로는 2차 개정에서 다시 고쳤다**(아래) |
| Codex "[다시 확인]이 실제로 확인하지 않는 기간을 숨긴다" | §5.1·§9.4: 수동 [다시 확인]은 간격 없이 늘 보낸다. 눌러도 안 되는 상태는 `loading`(single-flight)뿐. UT9에 "열려 있던 거부 카드에서 [다시 확인]" 추가, e2e-web에 "간격 안에서도 카드가 열린다" | `components.md:125` aria-disabled에는 사유 필수 · `patterns.md:390` 사유 없는 비활성 금지 · `session.ts:61-66` `/api/me`는 check 1회라 쿨다운 불필요 |
| Codex "설정 오류에 작업 행용 Notice를 쓰도록 남아 있다" | §4.2·§4.4·§5.6·§6·§7.1·§12·§13: 만들기·빼기·그만두기 실패를 그 컨트롤 바로 아래 `inline danger`로. 낭독은 `alert` 하나 | `patterns.md:33-34` §1.1(`row` = 작업 행 상태 줄, `inline` = 컨트롤 바로 아래) |
| Codex "사용자 시험 한 번으로 D62를 충족한다고 볼 수 없다" | §14 사용자 시험 행: UT8·UT9는 기존 과업에 더하는 것, D62 조건(기준선 + 적용 뒤, 회당 3명, 두 회 이상)은 그대로, 한 회면 "축소한 시험"으로 표기 | `README.md:211` D62 · `governance.md:415-425` §6.1 |
| Codex Q4 "`release.yml:480`의 실제 배포 순서" | §8.7을 "앱이 먼저"로 정정, §17에 릴리스를 둘로 나누는 선택지(Worker 먼저 운영) | `release.yml:480`·`:398` |
| Codex "근거 없는 의심: 초대 주소가 미리보기·기록에 남는지" | §11 행 추가([실측 필요]) + 설계 대책(OG 없음·noindex·소비·만료·앱 저장 안 함), §18-11 | 판정하지 않음(Codex와 같다) |
| 근거 확인 A9 "되돌리기 = 지연 삭제, 용어집은 목록 지우기에만" | §4.4를 **지연 회수**로: 토스트가 닫힐 때 `removeEditor`, [되돌리기]는 전송 없음. `restore` API·`revoked_by='owner'` 복구·`editors_restore` 제거(§8.2·§8.3·§8.5·§9.5·§17). §2에 용어집 행 수정(자리 추가, W1 아님), §13 ADR-0025가 §7.1-5 의무를 함께 진다 | `patterns.md:260·275` 지연 삭제 · `README.md:166` D37 · `components.md:437`(438은 빈 줄) · `content.md:106` 용어집 · `content.md:20` W1 |
| 근거 확인 C1 "토큰은 256bit, `invite` 접두 필요" | §11: 32B = 256bit로 정정, `TOKEN_PREFIX`에 `invite: "cdi_"` + `isToken` 확장(§17 PR 2 범위, §14 테스트) | `token.ts:7·30-33` |
| 근거 확인 C8·C9 "`/invite/done` 경로 충돌·quiet, `seeOther` 두 곳" | 완료 페이지를 `/me/delegations/done`으로(§3·§5.3·§8.3·§14). `?r=self`·`?r=full` 쿼리를 버리고 flash `inviteSelf`·`inviteFull`로. `seeOther` 계약을 세 곳으로 넓히는 worker.md 구현 중 변경 105 명시 | `routes.ts:97-115` `matchPattern` · `:118-119` `isQuietPath` · `web-session.ts:40-41` · `web.md:222` |
| 근거 확인 C11 "`/invite/:token/start`의 CSRF 가드 미기재" | §8.3: `webStart`와 같은 `sameOriginPost` + IP 스로틀, hidden csrf 없음(세션 없음). §14 403 테스트 | `auth.ts:136` |
| 근거 확인 C13 "앱 쓰기 경로는 처음이 아니다" | §8.3 문장 정정("위임 데이터를 바꾸는 앱 API"가 처음) | `routes.ts:69`·`session.ts:56` |
| 근거 확인 C15 "행렬 테스트 경로" | §14: `test/matrix.test.ts`(루트) | 파일 존재 |
| 근거 확인 D2 "OwnershipNotice는 제목·본문만 그린다" | §5.1·§13·§17: 행·caption·동작을 그리도록 수정 범위 명시 | `OwnershipNotice.svelte` |
| 근거 확인 D4 "`action.dismiss` 없음" | §5.1·§7.1·§7.2: `common.close` + ActionId `close`/`remove` | `ko.ts:12`·`errors.ts:217` |
| 근거 확인 D5 "`auth.consent.use` 없음" | §7.1·§16: 앱 `auth.consent`는 바꾸지 않고 Worker `landing.consent.use`만 | `ko.ts:258-259`·`copy.ts:46`·`ko.ts:34`(DC6는 notice.* 둘) |
| 근거 확인 D7 "`landingLead` 없음" | §7.3·§16: 바꿀 대상 없음, web.md:146 표기 정정은 PR 1 | `landing-view.ts:172`·`copy.ts` |
| 근거 확인 D10 "`inAppHint`는 failed에만" | §5.2·§18-1: 초대 폼 아래에 두지 않는다, 실패 페이지의 기존 단락이 덮는다 | `pages.ts:71-72`·`G-WEB-R9` |
| 근거 확인 D16 "`cleanDisplayText`·`<bdi>`가 코드에 없다" | §4.3·§13·§17 PR 5 구현 비용에 포함 | 검색 0건 |
| 근거 확인 E26 "ROADMAP '뒤집는 결정(확장)' 관례 없음" | §0·§13·§16: 기존 행을 취소선 + 날짜로 고치는 관례 | `ROADMAP.md:71` 형식, `docs/` 검색 0건 |
| 근거 확인 A17 "순서 Own > Delegated > AdminOverride는 취향" | §9.1 [가정] 표시(1차에서 [잠정]으로 적은 것은 범례 위반이라 2차에서 고쳤다) | `ownership.rs:109-114` |
| 근거 확인 A23 "ADR 의무 아님이 확실하지 않다" | §13: ADR-0025가 §7.1-4·5 의무를 함께 진다 | `README.md:243-250` |
| 근거 확인 A1·A4·A6·A8·A11·A12(일부)·A21·A22·A26, E14·A20, F2·F3·F4 | 가정은 [가정], 수치는 [잠정], 실측은 [실측 필요]로 본문에 표시(§0·§1.1·§1.3·§4.1·§8.1·§8.7·§10·§11·§15·§18) | 각 절 |

### 반영하지 않은 지적(반박)

| 출처 | 왜 |
|---|---|
| Codex 제안 "수동 확인은 별도의 짧은 쿨다운을 쓰거나 제한 중임과 재시도 가능 시점을 보인다" 중 **쿨다운 쪽** | 쿨다운을 두면 그 동안 또 사유 문구·시각 계산이 필요해 UX 기준 ①(복잡하지 않게)에 어긋난다. `/api/me`는 회전 없는 `check` 1회(`session.ts:61-66`)라 사람의 클릭 속도로 묶이는 비용이 작다. 그래서 "늘 보낸다 + single-flight"를 골랐다(§5.1). ~~비용 상한이 필요하면 Worker 쪽 429를 앱이 오프라인처럼 다루는 기존 규칙이 이미 있다~~ — **2차 개정에서 거둠**: `/api/me`에는 429가 없다(`session.ts:61-69`; 429는 refresh `session.ts:38-40`·start `auth.ts:102`·`:143`뿐). 지금 상한은 앱 single-flight뿐이고 [가정]으로 적었다(§5.1·§9.4 비용·§18-12). 반박의 결론(쿨다운을 두지 않는다)은 유지한다 |
| Codex 제안 "회수 의미까지 보존하는 **선행 호환 패치**(V2에 먼저 배포)" | 선행 패치는 옛 코드에 새 표를 알게 하는 것이라 "더하기만" 규칙(`schema.ts:2-3`)과 롤백 대상 자체를 복잡하게 한다. 대신 **데이터 쪽**에 허가 시각을 품게 해 옛 코드가 아무것도 몰라도 제외·재허가가 자동으로 무효를 만든다(§8.1). Codex가 든 경로를 테스트로 고정하는 제안은 그대로 반영했다 |
| Codex "라이브 문구·버튼도 D43·D36과 정합"(Q2 판정 안) | 라이브(⑤) 문서 몫이다. 이 문서는 D43(링크→주소, 허가/허용)·D36(새 대화상자 없음)을 §2·§4.4에서 지킨다 |
| 근거 확인 A22 "사회공학 경고 Notice 재검토 필요" | 경고를 **두지 않는** 결정은 유지하되 [가정]으로 표시하고 D62 UT9 관찰에 건다(§1.3·§11). Codex도 "경고가 반드시 필요하다는 근거를 확보하지 못했다". 경고를 더하면 CTA 하나짜리 페이지에 요소가 늘어 UX 기준 ①(튀지 않게)에 역행한다 |
| 근거 확인 A9의 대안 "용어집을 넓힌다면 W1·ADR 대상" 중 **W1 위반** 부분 | W1은 "한 낱말을 두 뜻으로 쓰지 않는다"(`content.md:20`)이다. [편집자 빼기]의 되돌리기는 목록 지우기의 되돌리기와 **같은 뜻(방금 한 일 무르기)·같은 수단(지연 실행 토스트)**이라 뜻이 둘이 되지 않는다. 파일 이름 칸이 "원래 이름으로"를 쓰는 이유(`patterns.md:398`: 되돌리기 ≠ 초기화)와 다르다. 그래서 용어집 행은 "자리 추가"로 고치고 ADR-0025에 적는다(§2) |

### 남은 것(실측·사용자 결정)

- 사용자 결정 §15의 8개(특히 2 신뢰 수준 (b), 4 로그인 = 수락, 5 지연 회수). 추천은 적었고 모두 [가정]·[잠정] 위에 있다.
- §17 릴리스를 둘로 나눌지(Worker 먼저 → §8.7 창 제거) 또는 하나로 묶고 창을 받아들일지.
- [실측 필요] §18-1(카카오톡 인앱 왕복), §18-5(scope 추가가 동의 화면을 바꾸는지), §18-9(태그 릴리스의 앱→Worker 창 길이), §18-10(`/api/me` 300ms), §18-11(초대 주소가 미리보기·기록에 남는 범위).
- [잠정] 상수 여섯(§8.1)과 `DELEGATION_RECHECK_MIN_GAP`: ADR-0009 묶음 등록, §18-2 인터뷰.
- D62 UT8·UT9 관찰 전에는 1안 채점(§1.1)·로그인 = 수락(§15-4)·경고 없음(§11)이 모두 [가정]이다.
- `web.md:146` `landingLead` 표기와 `web.md` §6.3 "표시용 값도 허용"이 코드(`copy.ts`·`flash.ts:1`)와 다른 점은 이 문서 범위 밖이라 PR 1에서 표기만 바로잡는다.

---

## 개정 기록 2차(2026-10-16, 독립 확인 반영)

입력: 1차 개정본에 대한 독립 확인 16건(미해소 4 · 새 인용 오류 3 · 누락 2 · 표기·인용 오류 7). 모든 줄 번호는 master `bff221d`를 이번에 다시 열어 확인했다. 사용자 확정(Q1 = 본인 + 지인 스트리머 + **그들의 편집자**, UX 기준 ①)은 그대로이고, 이번 개정은 누름 수·늘 보이는 요소 수를 바꾸지 않는다(§3).

### 반영한 지적

| 출처 | 어떻게 | 근거 |
|---|---|---|
| 미해소 "`/api/me` 명시적 거부 무시, §9.4 (c) 갈래" | (c)를 **"phase는 유예 규칙대로, 이번 판정은 거부"**로 명시. 메모리 깃발 `delegated_suspect`: `/api/me` 401·403 뒤 refresh가 네트워크 실패면 세우고, 서 있는 동안 `signer().delegated`는 빈 집합(§9.1) → (1)·(2)·자동 이어받기 모두 거부. 내리는 조건은 새 묶음(refresh 성공·재로그인)·`/api/me` 성공·로그아웃. 파일에는 적지 않는다[가정]. §0·§11·§14·§15-2에 반영 | refresh Transient → `classify_verify` → `Next::Offline`(SignedIn 유지) `verify.rs:219-223` · `signer()`는 SignedIn이면 오프라인이어도 Some `service.rs:1182-1191` · 신뢰 수준 (b) §9.1 "phase == SignedIn이면 늘"과 겹치면 구멍이 열린다는 지적이 맞다 |
| 미해소 "최악 96시간, 시작 직후 경로" | §9.3 자동 이어받기 깃발을 둘로: 본인·관리자는 지금처럼 처음 SignedIn에서, **맡은 채널 작업은 이번 실행에서 첫 묶음을 받은 뒤의 SignedIn에서만**(D23 `first_online`과 같은 판단). 실행 내내 오프라인이면 소비하지 않는다. §0·§10(시작 행·최악 행)·§15-2를 "온라인이면 시작 refresh 뒤, 72h는 내내 오프라인일 때"로 고쳤고, 이전 "최대 24h 묵은 값"·"온라인이면 ≤24h"가 근거 없는 단정이었다고 적었다 | `load_decision`은 `verified_at + 72h` 창 전체가 Optimistic `verify.rs:125-135`·`service.rs:334-338` · `on_auth_status`는 처음 SignedIn에서 깃발 소비 `app.rs:350` · `startup`은 바로 refresh `service.rs:462-471` · D23 `service.rs:435-437`·`app.rs:456-458` |
| 새 인용 오류 "판정 상한 40초" | §9.4에 "시간 상한(정정)" 행: `/api/me`는 요청당 `REQUEST_TIMEOUT` 10초, 거부 뒤 refresh 대기는 10초 + 유실 재시도 0·10·30초(마지막 전송 45초) → 최대 약 55초. `AUTH_CHECK_TIMEOUT_MS`는 쓰지 않는다(셸에서 읽는 곳이 없고 앱 안내 문구 초 수뿐). 새 장치 없음 | `http.rs:18`·`:41-50` · `verify.rs:183-187` `LOST_RETRY_AT`·`:181` `LOST_RETRY_LAST_SEND` · `service.rs:524-547` · `consts.rs:5` 정의뿐(`crates/` grep 1건) · `auth.ts:89` `auth.checking.body` |
| 미해소 "롤백 호환 대책이 대안 B와 어긋남" | §8.1 위임·초대 행에 `owner_login_channel_id` 열 추가. 활성 판정의 allowlist 조인 키는 **둘 다 로그인 ID**(`owner_login_channel_id`·`editor_channel_id`), 판정용 `owner_channel_id`는 앱 판정·`delegatedChannels`·자기 채널 판정에만. `disallow(로그인 ID)` 확장은 `owner_login_channel_id = ? OR editor_channel_id = ?`로 지운다. §8.2 `createInvite`에 로그인 ID 인자, §8.6 키 규칙 ①②③, §14 대안 B 행으로도 V2 롤백 테스트 | `schema.ts:14` allowlist PK = 로그인 `channel_id` · `allowlist.ts:29-30` `row?.owner ?? channelId` 치환 · `allowlist.ts:90-93` `disallow`는 로그인 ID · `worker.md:865` 23 `CheckResult`에 둘 다 있음 |
| 새 근거 없는 표현 "허가 시각 = 방금 넣은 `added_at`" | §8.2 `allow`·`allowDenied`·`acceptInvite`·`createInvite`를 "그 채널 allowlist 행의 **현재** `added_at`을 SELECT"로. §14에 "이미 허용된 채널에 `allow`를 다시 눌러도 활성" 테스트 | `allowlist.ts:58` `ON CONFLICT … DO UPDATE SET note`(added_at 유지) · `:80-82` 이미 허용된 갈래는 INSERT 없음 |
| 반박의 근거 없음 "쿨다운 반박의 429" | 1차 반박의 "429 기존 규칙" 문장을 거두고(취소선 + 사유) §5.1·§9.4 비용·§11에 "**Worker 쪽 상한 없음**, 한 클릭 = 읽기 RPC 1회·쓰기 0, 앱 single-flight뿐 [가정]"으로 적었다. §18-12 열린 항목(세션별 상한). 결론(쿨다운을 두지 않는다)은 유지 | `session.ts:61-69` `/api/me`에 상한 없음 · 429는 `session.ts:38-40`·`auth.ts:102`·`:143`뿐(`grep 429 worker/src`) · `sessions.ts:137` 성공 경로 쓰기 0 |
| 불완전 "D62 '조건 그대로'" | §14 사용자 시험 행을 다시 썼다: UT8·UT9는 기준선 회차에 측정 대상이 없어 D62의 기준선 비교는 UT1~UT7에만 성립, UT8·UT9 합산은 기능이 들어간 뒤 회차끼리만(두 회·3명 조건은 그대로), 이미 돌린 기준선이 있으면 "기능 없음·측정 없음"으로 적고 합산 제외. 시험 기록이 아직 없다는 사실도 적었다 | `governance.md:419` "두 회차의 대본은 같은 판" · `:423` "대본이 바뀌면 이전 회차와 합산하지 않는다" · `docs/design/system/tests/` 없음 |
| 해소 주장과 다름 "A21 [가정] 표시 없음" | §0·§1.3 G5·§6·§11·§12·§18-8의 꼬리표 줄에 [가정] A21을 붙였다 | — |
| 표기 오류 "A17 [잠정] → [가정]" | §9.1 고침. 범례(문서 머리 6행)대로 설계 판단은 [가정] | — |
| 누락 "flash 계약" | §7.3·§8.3·§13: `FlashKind` 셋 → 여섯 확장을 `seeOther` 세 곳과 **같은 구현 중 변경 105 한 항목**으로 | `flash.ts:1·5` · `web.md:222` "flash와 `seeOther` … 계약의 보완" 둘 다 |
| 누락 "릴리스 1 버전 올림" | §17에 PR 3½ `chore: 버전을 0.7.0으로 올린다`(릴리스 1 필수), PR 6은 0.8.0. 한 릴리스로 묶으면 3½이 빠진다 | `release.yml:50-79` `release-gate`(버전 = 태그, 단조 증가) · `release.mjs:6`·`:355` · `versions` gate(CLAUDE.md) |
| 새 인용 오류 `verify.rs:140-160 classify_verify` | §9.4·1차 기록: `outcome_of_error` `:138-164` → `classify_verify` `:199-228`로 | 직접 셈 |
| 새 인용 오류 `worker.md` §11.3 line 579 | 1차 기록·§9.4: `:583`(머리 `:564`) | 직접 셈 |
| 인용 오류 `components.md:438` | §4.4·1차 기록: `:437`(438은 빈 줄) | 직접 셈 |
| 인용 오류 `content.md:302` | §4.3·§5.7: `:300`(302는 10번 항목). 근거 표 E12의 [확인] 줄 번호도 같은 오류다 — 표는 입력이라 고치지 않고 여기 적는다 | 직접 셈 |
| 사소한 인용 오류 `service.rs:559` | §10·1차 기록: `:557` | 직접 셈 |

### 반영하지 않은 지적(반박)

| 출처 | 왜 |
|---|---|
| (없음) | 16건 모두 반영했다. 다만 두 곳은 지적이 요구한 "명시"를 넘어 **새 장치**를 더했다: `delegated_suspect` 깃발(§9.4 (c))과 자동 이어받기 깃발 분리(§9.3). 둘 다 기존 장치(D23 `first_online`, `session_epoch`)와 같은 꼴이라 새 상수·새 화면·새 문구가 없고, 그래서 UX 기준 ①에 닿지 않는다. 메커니즘의 세부(파일에 적지 않음, 배너 문구 불변)는 [가정] |

### 남은 것(실측·사용자 결정) — 1차에 더해

- `delegated_suspect`를 파일에 적지 않는 선택(§9.4 (c)): 앱을 껐다 켜면 깃발이 사라지지만, 켠 뒤 첫 판정은 `last_me_at = None`이라 늘 확인하고 자동 이어받기는 첫 묶음 뒤라(§9.3) 구멍은 "오프라인으로 다시 켠 뒤 사용자가 직접 [이어받기]"뿐이다 — (b)의 오프라인 대가와 같은 범주. 이것도 막으려면 파일에 깃발을 적는다(사용자 결정 §15-2에 딸린 세부).
- §18-12 `/api/me` 세션별 상한: 운영 로그 관찰 뒤.
- 1차 "남은 것" 전부 그대로.

---

## 개정 기록 3차(2026-10-16, 최신 master 기준)

입력: Codex 2회차 적대적 리뷰(이 문서 몫 N1·N2·N3·N9, 결정별 판정 D2 "수정"), `decisions.md`, `plan.md`. **기준 트리를 `bff221d`에서 origin/master `df454c3`(v0.7.0)로 옮겼다.** 그 사이 다른 세션이 생방송 녹화를 넣었다(core.md 구현 중 변경 58~60, app.md 77, ADR-0025, D63, `crates/core/src/download/{live,defrag}.rs`, URL `live/{channelId}`). 사용자 확정(2026-10-16): Q1 = 본인 + 지인 스트리머 + 그들의 편집자, 결정 표 "유지" 26행은 추천대로 확정(이 문서에 닿는 것: C4·C6·D1·D3~D8·L2·B2), U2는 실측 M-④-8·9 뒤(이 문서 밖), UX 기준 ①. 1차·2차 기록의 줄 번호는 `bff221d` 기준 그대로 두었다(그때의 기록이다). 본문 인용은 이 트리에서 다시 열었다.

### 반영한 지적

| 출처 | 어떻게 | 근거(df454c3) |
|---|---|---|
| **N1** 명시적 허가 제외를 위임만 막는 상태로 낮춘다 | §9.4 "Worker 형식 오류 셋": `403 not_allowed`·`401 session_revoked`는 refresh를 거치지 않고 **refresh 거부와 같은 상태 전이**(Denied / Expired(Revoked))로 바로 보낸다 → `signer()` None → 본인·맡은 채널·관리자 모두 새 작업 차단, 진행 중·대기 중은 계속. `401 invalid_token`(access 만료·회전)만 refresh로 다시 확인. `me` 오류를 `outcome_of_error`에 그대로 넣지 않는 `me_outcome` 분류(넣으면 access 만료마다 로그아웃). 2차의 `delegated_suspect`를 **없앴다**(§9.1·§9.4·§10·§11·§14·§15-2). 거부 전이도 세션 세대가 같을 때만 | `session.ts:61-69` · `sessions.ts:66`(폐기된 행은 `access_hash` 유지 → 늘 `session_revoked`) · `:77-80` `denial()` · `:138-150` `judge` · `:246`(회전이 `access_hash`를 바꿔 옛 access는 `invalid_token`) · `verify.rs:138-164`·`:211-213` · `service.rs:585-664` `apply_refresh_error` · `service.rs:1184-1189` · `ownership.rs:131-133` · `ROADMAP.md:83` "진행 중 다운로드는 늘 계속" · `worker.md:623` |
| **N2** 같은 세션의 늦은 `/api/me`가 최신 refresh를 덮는다 | §9.4 "적용 순서": `me`도 `refresh_lock`을 잡는다 → 위임을 싣는 요청이 한 번에 하나 → 적용 순서 = 서버 처리 순서. 세부 ① 잠금 뒤 access 읽기 ② `me`는 `refresh_gen`을 올리지 않음 ③ 잠금을 놓고 `refresh_inner` 호출(재진입 금지) ④ `(session_epoch, refresh_gen)` 이중 검사 + "잠금을 빼면 N2가 다시 열린다" 주석. 시간 상한 행에 잠금 대기 추가. §14에 가짜 서버 시간선 테스트(메모리·`session.json` 둘 다 회수 상태 유지) + 잠금을 빼면 실패하는지 확인 | `service.rs:502`(잠금)·`:505`(gen 비교로 건너뜀)·`:513`·`:550-551` · `sessions.ts:246` |
| **N3** 롤백 대책이 미사용 초대까지 보호하지 않는다 | §8.1 새 판정식 `inviteValid` = 미만료 ∧ (주인 관리자 ∨ 주인 allowlist `added_at` = `invite.owner_allowed_at`). `inviteView`·`acceptInvite`·`claimInvite`·자동 완성·`editorsOf`·`adminView` 꼬리표가 모두 이 식만 쓴다. 거짓이면 gone + 행 삭제(sweep 전에도). 새 위임의 `owner_allowed_at`은 초대 값을 그대로 옮긴다(다시 SELECT 금지). §8.2 행 여섯 고침, §14에 미청구·청구·청구 전·음성 대조·재SELECT 금지 다섯 테스트(대안 B 포함) | `allowlist.ts:90-96`(옛 `disallow`는 초대 표를 모름) · `:57-66`·`:58` · `schema.ts:3`·`:14` |
| **N9** 확인 라벨이 허용 목록과 어긋난다 | 막힌 카드 버튼 [다시 확인]을 거두고 기존 **[다시 불러오기]**(`action.reresolve`)로. 동작은 간격 없는 `me` **뒤에 같은 주소 resolve**라 라벨 뜻(영상 정보를 다시 불러옴)과 맞다. R 카드의 `reload`는 글자가 "다시 시도"라 새 ActionId `recheck`. `receive.recheck` 키 삭제, `receive.recheck.offline` 본문 "다시 불러와 주세요"(본문과 버튼 말 맞춤). §0·§1.3 G3·§2·§3·§5.1·§6·§7.1·§7.3 `inviteDone.refresh`·§12·§14 UT9 | `content.md:142`(굳은 한자어, "확인" 없음)·`:143`(부사 + 동작, "다시 불러오기" 있음, "다시 확인" 없음)·`:91`(불러오기 뜻)·`:523`(본문·버튼 말 맞춤 선례) · `errors.ts:9-23`·`:215`·`:499-513` · `ko.ts:160` · ③ B2(확정 유지) |
| Codex D2 "재시작 뒤 구멍은 오프라인 수동 이어받기뿐도 좁은 설명" | §15-2를 (b)의 대가 셋(오프라인 유예 중·`invalid_token` 뒤 refresh 네트워크 실패·오프라인 재시작 뒤 수동 이어받기)으로 고쳐 2차 "남은 것"의 설명을 거뒀다 | §9.4 (다)(c) |
| (새 사실) v0.7.0 생방송이 같은 게이트를 지난다 | §0 행, §9.1 "생방송과의 맞물림": `Delegated`를 넣으면 생방송이 저절로 열리므로 `ContentRef::Live` 예외를 `on_resolved`·`admit`(`resume_job`)·자동 이어받기 필터 세 곳에 둔다(C4 확정 "⑤는 O-6 뒤" 이행). 편집자에게 거짓 안내가 가지 않게 §7.2 맡은 채널 생방송 갈래(`ErrorContext.delegatedLive`, [닫기]만). §10·§11에 생방송 행, §16에 ADR-0025 예외 행, **§15-9 새 결정 후보 L-D1**(여는 조건: A/B/C, 추천 A) | `app.md:1386` 77 · ADR-0025 결정 다섯째 줄 · `info.rs` `parse_live_detail` `channel_id` · `ownership.rs:100-148` · `dto.rs` `ContentKindDto::Live` · `errors.ts:34-45` · `README.md:212` D63 · `content.md:96-97` |
| (최종 확인에서 더함) | 앱 쓰기 API 셋도 `me`와 같은 오류 분류·잠금·`invalid_token` 뒤 1회 재시도(§8.5), 상한 셈도 `inviteValid`(§8.2 `createInvite`), §9.3에 생방송 작업 제외 줄 | 같은 Bearer access(`session.ts:61-69` 꼴의 `app` 자격) · §8.1 |
| (번호 재조정) | ADR-0025 → **ADR-0026**(0025는 생방송), app.md 구현 중 변경 77 → **78**, worker.md 105 그대로(`worker/`·`worker.md` 바뀌지 않음), 버전: 릴리스 1 **0.8.0**·릴리스 2 **0.9.0**(지금 0.7.0) | `adr/0025-live-recording.md` · `app.md:1386` · `worker.md:1188` 마지막 104 · `Cargo.toml:9` |
| (인용 줄 고침, 바뀐 파일) | `ROADMAP.md` 69·71·79·80 → 72·74·82·83, `content.md` 106·294·300·330·343 → 107·295·301·331·344, `ko.ts` 131·146·156·258-259·307 → 138·154·164·270-271·319, `errors.ts` 217·458-465·464 → 219·468-475·474, `dto.rs:529` → 538, `app.md:1384` → 1386 | 이 트리에서 직접 셈 |

### 반영하지 않은 지적(반박)

| 출처 | 왜 |
|---|---|
| N2 제안 중 "서버의 위임 revision 비교" | 고르지 않았다(대안으로 §9.4에 적음). 계약·DO 스키마가 늘고, V2 롤백 창에서 옛 `disallow`가 revision을 올리지 않아 비교가 틀릴 수 있다. 앱 안 직렬화(같은 잠금)가 새 계약 없이 순서를 정확히 맞춘다 |
| N9 제안 중 "확인 라벨을 공통 허용 목록에 등록" | 등록하지 않았다. 허용 목록 안의 기존 라벨로 같은 일을 하고 W1·용어집을 건드리지 않는 쪽이 더 작다. ③ B2(확정)와도 같은 판단이다. ⑤ 옛 생방송 설계(구현되어 core.md 구현 중 변경 58~60과 ADR-0025가 대신한다)의 [지금 확인]은 이 문서 몫이 아니다 |
| N4~N8 | 이 문서 몫이 아니다(N4 생방송 임시 파일·N5 채팅 실측 순서·N6 구간↔채팅 의존·N7 정렬 관찰·N8 G5 진행 조건 — 옛 생방송 설계(구현되어 core.md 구현 중 변경 58~60과 ADR-0025가 대신한다)·`chat.md`·`range.md`·`backup.md`·`plan.md`) |
| Codex 근거 없는 의심 "허가 시각을 세대 식별자로 쓰는 충돌(같은 ms·시계 역행)" | 설계를 바꾸지 않고 §8.1에 [가정]으로 적었다. 관리 화면 클릭으로 같은 ms 제외·재허가는 사실상 없고, 롤백 대상 "V3 직전까지"가 창 자체를 줄인다 |

### UX 기준 ① 재확인

늘 보이는 요소·누름 수는 그대로다(§3). 버튼 하나의 글자가 [다시 확인] → [다시 불러오기]로 바뀌었고(새 낱말 0), 생방송 갈래는 이미 있는 거부 Notice 자리의 다른 문장일 뿐이다(새 컴포넌트·새 알림 수단 0). 명시적 거부의 전체 차단은 기존 거부·만료 화면을 그대로 쓴다.

### 남은 것 — 1차·2차에 더해

- **L-D1**(§15-9): 맡은 채널 생방송을 여는 조건·방식. 사용자 결정, 추천 (A).
- decisions.md **D2 세부 (b-1)/(b-2)**(`delegated_suspect`를 메모리/파일)는 깃발이 없어져 **선택지가 사라졌다** — 결정 표에서 지울 행.
- decisions.md **L2(확정 "관리자 예외 없음")와 출시된 v0.7.0(관리자 예외 포함)이 다르다**(§18-13) — ⑤·결정 표 몫.
- decisions.md **T-D62**의 UT9 문구 "[다시 확인]" → "[다시 불러오기]"로 고칠 것. 옛 생방송 설계(구현되어 core.md 구현 중 변경 58~60과 ADR-0025가 대신한다) [지금 확인]도 N9로 정리할 몫.
- §18-14 "마지막 확인" 조각과 [다시 불러오기] 낱말 차이는 [가정], UT9에서 본다.
