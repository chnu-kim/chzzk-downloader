# 기능 ③ 내 채널 새 영상 확인과 모아 받기(채널 백업): 설계 초안(개정판)

**상태·확정 결정(2026-10-16)**: 설계 상태이고 코드는 아직 없다(구현 순서는 `plan.md`). 이 문서는 기능 ③(내 채널 새 영상 확인과 모아 받기)의 설계다. 이 기능에 직접 걸린 확정: E1(조기 종료는 끈다: 늘 마지막 페이지나 `MAX_LIST_PAGES`까지 훑고 기준점으로 거른다), C1의 ③ 부분(app.md §1.2 부분 뒤집기 승인), Q1(편집자까지 쓰는 사용자). 공통으로 확정된 것: Q1 실제 사용자 = 본인 + 지인 스트리머 + **그들의 편집자** · 결정 표 '유지' 26행(C4·C5·C6·C7·D1·D3~D8·R1~R4·B1~B3·U1~U5·L2·L4·L5) 추천대로 · **L6** 배포된 v0.7.0의 생방송 동작(관리자 예외, `/live/` 주소 붙여넣기)을 받아들인다 · **L7** 녹화 `.part`는 지금 경로 그대로 두고 최소 조치로 지킨다(모든 삭제 진입점의 sidecar 소유권 검사, '새 녹화 시작'과 '기존 녹화 저장'의 계약 구분, v0.7.0 파일 호환; 별도 `.rec.part` 체계는 후속) · **C1** 뒤집는 결정 ①(본인 영상 제한 → 로그인 채널 또는 맡긴 채널)·③(app.md §1.2 부분 뒤집기) 승인 · **L8** 끝난 이유 표시 · **L-D1** 맡은 채널의 생방송은 v1에서 닫는다 · **E1** ③ 조기 종료는 끈다 · **R5** 전체 빠른 다시보기 defrag는 실측 뒤 · **U2** 자막 기본 형식은 실측 뒤. UX 기준 ① "숨겨지거나 복잡하면 안 되고, 튀어 촌스러워도 안 된다". Codex 리뷰는 설계 단계에서 세 번 끝냈으므로 구현 PR에서는 중요한 PR만 돌린다. 조사 원자료·근거 확인 표·Codex 리뷰 원문은 저장소에 없다(공개 저장소 규칙). 본문이 이 결정과 다르면 결정(`decisions.md`)이 우선한다.

상태: **designed(조건부)**. 목록 경로가 공식 Open API에 없어서 비공식 서비스 API에 기댄다(근거 확인 A1: chzzk MCP `chzzk_list_apis` 36개에 VOD·클립 목록 경로 없음). 실서버로 확인하지 못한 사실이 남아 있으므로 **첫 PR은 사용자 실측 도구**다. 둘째 단계부터는 그 도구가 낸 결과를 전제로 진행한다(§12·§15).
작성 2026-10-16, **개정 2026-10-16**(Codex 적대적 리뷰·근거 확인 표 반영) · **2차 개정 2026-10-16**(독립 확인에서 남은 14건, 문서 끝 "개정 기록" › "2차 개정") · **3차 개정 2026-10-16**(최신 master 기준, Codex 2회차 N7, 문서 끝 "3차"). 본문 코드 위치(`파일:줄`)는 **origin/master `df454c3`(v0.7.0, 생방송 녹화 포함)** 기준이다. 3차에서 `bff221d` 기준이던 모든 줄을 새 트리에서 다시 열어 옮겼다(1·2차 개정 기록 표의 줄 번호는 당시 `bff221d` 값이다). 원자료(엔드포인트 경로·쿼리·응답 필드 추정·출처)는 저장소에 없다. 이 문서는 동작만 적는다. 예시 값(제목·날짜·개수·채널 ID)은 모두 가짜다.

표기: **[잠정] 근거 없음, 실측·ADR-0009 묶음 등록** = 출처 없는 수치(ADR-0009 "바꿀 때는 이 ADR을 고치지 않고 새 ADR을 쓴다"이므로 실제 등록은 새 ADR, §6.5). **가정** = 문서·코드 근거가 없는 판단. **실측 필요** = §15 질문으로 답한다.

---

## 0. 한눈에

| 항목 | 결정(초안) | 근거 |
|---|---|---|
| 대상 | **v1은 로그인한 본인 채널의 VOD·클립만.** ① 위임이 들어오면 "맡은 채널"을 대상 고르기로 넓힌다(§4.7). 관리자 권한으로 남의 채널 목록을 여는 일은 범위 밖 | decisions.md Q6 "v1은 본인만, ①이 확정된 뒤 '대상 고르기'로 넓힌다". Q1 = 편집자까지(사용자 확정 2026-10-16) |
| 1단계 (가) | 수동 [새 영상 찾기]: 목록 불러오기 → 받은 기록·있는 파일 표시 → 사용자가 골라 체크 → 한 건씩 resolve → enqueue | §4.2 |
| 2단계 (나) | 앱이 켜져 있는 동안 주기 확인. 기본 꺼짐. 새 영상을 찾으면 **배너 한 장만**. 자동 받기는 따로 켜는 옵션이고 기본 꺼짐 | 기본 꺼짐: `crates/core/src/settings.rs:128` `auto_resume_interrupted: false` 선례, decisions.md Q9 |
| 미룸 (다) | 트레이 상주·로그인 시 자동 시작. 따로 결정한다(§11) | `docs/design/app.md:52` "트레이 … 없다" |
| 목록 순회 | **늘 마지막 페이지나 `MAX_LIST_PAGES`까지 훑고 기준점으로 거른다.** 정렬 관찰('관찰 표본에서 내림차순')은 동작을 바꾸지 않는다. 조기 종료는 v1에 없고 별도 결정 E1(§3.1)로만 켠다 | Codex 2회차 N7, 공개 근거 없음(§3.1, 근거 확인 A1·A6) |
| 생방송 | ③은 VOD·클립 목록만 다룬다. 생방송 녹화는 v0.7.0에 이미 있고(주소 붙여넣기, 수동) ③의 원장·목록·모아 받기에 들이지 않는다. 방송 상태 감시 `LiveWatch`는 ③에 없고 ⑤가 만든다 | `docs/design/app.md:1386`(77), `docs/design/core.md:805`(58), decisions.md C3(§1.2·§4.1·§4.5) |
| 첫 실행 기준점 | 기본은 **"지금부터 올라오는 것만"**. 이전 영상은 사용자가 골라야 받는다 | **가정**(원자료 권장, 근거 확인 E26). D62 ③ 시험에서 확인 |
| 같은 이름 파일 | **모아 받기는 늘 `onExisting: skip`을 보낸다.** 덮어쓰기는 모아 받기에 없다(카드에서만, D7 확인) | `app/src/lib/receive.ts:165`, `crates/core/src/download/part.rs:379-383`(§2.2) |
| 중복 근거 | 새 영속 원장 `backup_ledger.json`(채널 → 컨텐츠 ID, app_data_dir). 원장 + 최종 파일 존재 + 활성 작업 세 겹 | §4.1·§4.3 |
| 원장 갱신 | 기록자는 둘이다. 큐에 들어간 작업은 **매니저 끝 상태 관찰자**(`finish` 안, sink와 별개. 웹뷰 sink 교체·소실과 무관). 큐에 들어가기 전 모아 받기 resolve에서 `EncryptedVod`가 난 항목은 **`BackupService`가 직접** `encrypted`를 쓴다. 둘 다 같은 원장 쓰기 스레드로 간다 | `crates/shell/src/events.rs:4`, `crates/shell/src/manager.rs:354-356`, `:1150-1153`, `crates/core/src/client.rs:115,126-128`(§4.1) |
| 서명 URL | 문제없다. 작업은 시작할 때마다 코어가 다시 resolve한다 | `crates/core/src/download/mod.rs:11-16`(§3.3) |
| 커밋 타입·버전 | 사용자 기능은 `feat`(MINOR). 깨는 변경 없음(새 파일·serde default 필드). 실제 버전 번호는 머지·릴리스 순서로 정해진다(지금 `0.7.0`: 생방송 녹화가 가져갔다 → ③의 첫 `feat` 릴리스는 최소 `0.8.0`) | `docs/versioning.md:19`, `Cargo.toml:9` 0.7.0(decisions.md Q4) |

---

## 1. 목표와 범위

### 1.1 목표
- 스트리머가 자기 채널의 빠른 다시보기·일반 VOD와 클립을 **하나씩 주소로 붙여 넣지 않고** 한 화면에서 골라 받는다.
- "이미 받은 것"을 앱이 기억한다. 목록을 지워도(`manager.rs:780` `clear_finished`), 완료 기록 상한(`manager.rs:60` `MAX_FINISHED = 100`)에 걸려도, 파일 이름을 바꿔도 같은 영상을 다시 "새 영상"으로 올리지 않는다.
- 이 기능은 홈에서 바로 보이는 자리에 둔다(숨기지 않는다). 하지만 채워진 버튼은 창에 하나([받기])라는 규칙(`docs/design/system/README.md:19` P3)과 빈 화면의 조용함은 깨지 않는다. 사용자 기준 ①("숨겨지거나 복잡하면 안 되고, UI에서 튀어 촌스러워져도 안 된다")을 이 기능에도 적용한다: **진입점은 홈 섹션 한 줄, 새 컨트롤은 체크박스 하나 종류, 새 대화상자는 파괴 동작 하나뿐**(§6).

### 1.2 하지 않는 것
- 관리자 AdminOverride(app.md 구현 중 변경 74)로 남의 채널 목록 열기. 74는 주소 붙여넣기 "받기"만 허용했고 목록에 대해서는 말이 없다(근거 확인 B6). 목록까지 넓히는 근거가 없으므로 **가정**으로 범위 밖에 둔다.
- 로그인을 쓰지 않는 빌드(`App.auth == None`, `crates/shell/src/app.rs:63`). "내 채널"이 정의되지 않으므로 기능을 숨긴다. 프런트 분기는 `Features`로만 한다(`crates/shell/src/dto.rs:254` "기능 플래그. 프런트는 이 값으로만 분기한다", decisions.md Q9).
- 트레이·백그라운드 상주·OS 로그인 시 자동 시작. 단계 (다)다.
- 받은 파일 자동 삭제, 보관 기간·용량 회전. 파괴적인 동작이라 하지 않는다.
- **같은 이름 파일 덮어쓰기.** 덮어쓰기는 되돌릴 수 없는 동작이라 D7 확인이 필요하고(`patterns.md` §4, §6 카드 안 경고 `patterns.md:399` "덮어쓰기를 고르면 [받기]가 D7을 연다"), 여러 건을 한꺼번에 묻는 모양은 없다. 모아 받기는 "번호 붙여 저장" 또는 "받지 않음"뿐이다.
- 암호화(AES) VOD 받기. 지금처럼 거부한다(`crates/core/src/error.rs:37,141` `EncryptedVod` → `ErrorKind::Encrypted`).
- 채널 정보·썸네일 백업. 모아 받기의 채팅은 v1에서 늘 끈다(decisions.md Q9).
- **생방송은 ③의 범위 밖이고, 앱에는 이미 있다.** v0.7.0이 `chzzk.naver.com/live/{채널 ID}` 주소를 붙여 넣으면 진행 중인 방송을 방송이 끝나거나 사용자가 [녹화 마치기]를 누를 때까지 받는다(`docs/design/core.md:805`·`:817`·`:829` 58~60, `docs/design/app.md:1386` 77, `docs/design/system/adr/0025-live-recording.md`, D63). 방송 시작을 알아채는 감시는 없고 사용자가 방송 중에 직접 붙여 넣는 수동 흐름이다. ③은 이 위에 아무것도 더하지 않는다: `BackupScheduler`는 목록 주기 확인뿐이고(§4.5) 방송 상태 감시 `LiveWatch`는 기능 ⑤가 실측 게이트 뒤에 만든다(decisions.md C3). ③이 할 일은 생방송이 큐·원장·command에 섞여도 깨지지 않게 하는 것뿐이다(`ContentRef::Live`가 늘었다: §3.2·§4.1·§4.6).
- 치지직 VOD 보관 기간에 대한 단정. 공개 자료로 확인하지 못했으므로(`docs/research/design-system.md:101` PS1 "보관 기간 제약은 값이 바뀌어 확정 불가(`X-ID-U31`)") 문구에 "곧 지워져요" 같은 말을 쓰지 않는다.

---

## 2. 뒤집는 기존 결정과 인접 결정

### 2.1 뒤집는 결정(명시)
| 원문 | 위치 | 바뀌는 내용 |
|---|---|---|
| "**채널 전체 받기** … 은 없다" | `app.md:53`(§1.2 둘째 항목) | **부분적으로 뒤집는다.** 본인 채널(① 뒤에는 맡은 채널도)에 한해 "새 영상 확인 + 골라 받기"를 넣는다. 일괄 URL 입력은 계속 없다. decisions.md Q2 "③-R 승인" |
| "**트레이** · OS 알림 · 작업 표시줄 진행률은 없다" | `app.md:52`(§1.2 첫 항목) | **이번에는 뒤집지 않는다.** OS 알림·작업 표시줄 진행률은 이미 구현 중 변경으로 들어와 있다(`app.md:1354` 71 `notify.rs`, `app.md:1381` 73 (라) Dock·작업 표시줄). (나)는 OS 알림을 새 사건으로 넓히지 않고 배너만 쓴다(§6.6) |

적용할 때 app.md "구현 중 변경"에 새 번호로 적는다. 현재 마지막은 **77**(`app.md:1386`, 생방송 녹화)이다. 3차 개정 전에는 마지막이 76이었고 ①·③이 둘 다 77을 주장했으나(plan.md "①·③이 둘 다 77을 주장 → 머지 순서대로 다시 매긴다") 77은 생방송 녹화가 가져갔다. 그래서 **"78 이후, 머지 순"**으로 적는다(①도 같다). §1.2 본문에는 "→ 구현 중 변경 N"만 남긴다.

### 2.2 인접 결정(뒤집지 않고 긴장만 적는다)
- **app.md §0 "재시작 후 자동 재개하지 않는다"(데이터 사용량 근거, `app.md:17`)**: `auto_resume_interrupted`(기본 꺼짐, `settings.rs:70,128`)가 "사용자가 켜면 자동"이라는 선례다. (나)의 자동 받기도 같은 형태(기본 꺼짐)다. 기본값을 켜짐으로 바꾸는 것만 뒤집는 결정이 된다.
- **ROADMAP "본인 영상 제한"(`docs/ROADMAP.md:72` "정책·명분 수준")**: 충돌하지 않는다. 큐에 넣는 모든 항목은 `services::enqueue` → `OwnershipGate::admit`을 그대로 통과한다(`crates/shell/src/services.rs:580-582`). G-ID로 users/me 채널 = VOD 채널 = 클립 소유 채널이 확인됐다(`ROADMAP.md:56`). 목록 항목의 채널이 같은지는 따로 §15 질문 3이다.
- **app.md §0 "새 설정"(`app.md:19`)**: 원문은 "**코어 `UserSettings`를 바꾸지 않는다.** … 셸이 같은 `settings.json`에 모르는 키를 쓰면 `SettingsStore::update`가 지운다. 필요해지면 코어에 `#[serde(default)]` 필드로 더한다"이다. 이번이 "필요해진" 경우이므로 새 설정을 코어 `UserSettings`에 `#[serde(default)]` 필드로 더한다(선례 `keep_awake` `settings.rs:81`).
- **같은 이름 파일 정책(이번 개정의 핵심, Codex 높음)**: 초안은 `dto.rs:597` 주석 "UI는 `overwrite`만 보낸다"를 근거로 늘 `overwrite`를 보내려 했다. 그러나 실제 호출은 다르다. `app/src/lib/receive.ts:165` `onExisting: check.exists && choices.existing === 'overwrite' ? 'overwrite' : 'skip'` — 사용자가 덮어쓰기를 고른 경우에만 `overwrite`다. 그리고 `Skip`만이 확인 이후에 생긴 파일을 보호한다:
  - 시작 때 최종 파일이 있으면 네트워크 0회로 `Skipped`(`download/mod.rs:11`, `:274-275`).
  - 마무리 때 덮어쓰지 않는 rename을 쓰고, 받는 동안 같은 이름 파일이 생겼으면 옮기지 않고 `TargetExists` → `Skipped`, `.part`는 남긴다(`part.rs:379-383,387-392`, `download/mod.rs:15-16`, `:398`).
  - `Overwrite`는 `rename_with_retry`로 그 파일을 덮는다(`part.rs:379,389`).

  그래서 **모아 받기는 늘 `onExisting: skip`**을 보낸다. 번호 붙여 저장(`free_file_name`)도 `skip`이다(번호 이름이 확인 뒤 생기는 경쟁도 보호된다). `dto.rs:597` 주석은 실제 동작과 틀리므로 ③-4 PR에서 "UI는 사용자가 덮어쓰기를 고르면 `overwrite`, 그 밖에는 `skip`을 보낸다"로 고친다. 이 결정으로 §4.3의 사전 `fileExists` 판정은 **안내용**으로 내려간다. 판정이 틀려도(근거 확인 C11 이름 계산 가정) 파일이 망가지지 않는다.

---

## 3. 코어 변경(`crates/core`)

### 3.1 목록 모듈 `listing`(새 모듈)
- 순수 파서 두 개.
  - `parse_video_page(bytes) -> Result<ListPage<VideoItem>, Error>`
  - `parse_clip_page(bytes) -> Result<ListPage<ClipItem>, Error>`
- 타입(행동 수준. 필드 이름은 실측 뒤 확정한다, §15 질문 2·5):
  ```rust
  pub struct ListPage<T> { pub items: Vec<T>, pub next: Option<PageCursor> }
  pub enum PageCursor { Page(u32), Opaque(String) } // 페이지 번호/커서 둘 다 담는다(질문 2)
  pub struct VideoItem { pub video_no: u64, pub title: String, pub published: Option<String>,
                         pub duration_secs: Option<u64>, pub channel_id: Option<String>,
                         pub flags: ItemFlags }
  pub struct ClipItem  { pub clip_id: String, pub title: String, pub published: Option<String>,
                         pub duration_secs: Option<u64>, pub channel_id: Option<String>, pub flags: ItemFlags }
  pub struct ItemFlags { pub adult: bool, pub encrypted: Option<bool>, pub restricted: Option<bool> } // 모르면 None
  ```
  - `PageCursor::Opaque`는 `Debug`를 손으로 구현하고 길이만 찍는다(CLAUDE.md "서명 값을 품는 새 타입은 `Debug`를 손으로 구현한다"를 서버가 준 불투명 값에 넓게 적용, 근거 확인 F2).
- 클라이언트 메서드: `Chzzk::list_channel_videos(channel_id, cursor)`, `Chzzk::list_channel_clips(channel_id, cursor)`.
  - 요청 종류는 `RequestKind::Api`(`crates/core/src/http.rs:18-20`). 쿠키는 기존 규칙대로 사용자가 켰을 때 API 요청에만 붙는다(CLAUDE.md 주의사항).
  - 응답은 `read_capped`(`crates/core/src/client.rs:242`)로 받고 목록 전용 상한 `LIST_MAX_BYTES` 1 MiB를 둔다. **[잠정] 근거 없음, 실측·ADR-0009 묶음 등록**(질문 1의 페이지 크기 측정으로 다시 본다).
  - 한 번 훑을 때 페이지 상한 `MAX_LIST_PAGES` 50과 **같은 커서·같은 첫 항목 반복 감지**로 무한 루프를 막는다. 50은 **[잠정] 근거 없음, 실측·ADR-0009 묶음 등록**(질문 1의 총 개수 ÷ 페이지 크기로 다시 정한다).
  - 페이지 사이 간격 `LIST_PAGE_GAP` 500ms는 코어가 아니라 셸 반복기가 둔다. 코어는 페이지 하나만 가져온다. 500ms는 **[잠정] 근거 없음, 실측·ADR-0009 묶음 등록**(질문 6).
- 항목의 `channel_id`가 요청한 채널과 다르면 그 항목을 버리고 `warn`을 남긴다(값은 찍지 않고 "다름"만). **가정**(방어 설계, 근거 확인 C17): 섞여 오는지는 질문 3이 답한다. 버려지지 않더라도 enqueue 게이트가 다시 판정하므로 안전에는 영향이 없다.
- **정렬은 가정하지 않는다(근거 확인 A6, Codex 2회차 N7).** "최신순으로 오므로 기준점보다 오래된 항목에서 멈춘다"는 근거가 없다. 두 번 불러 같은 순서였고 인접 항목의 게시일이 내림차순이었다는 **관찰**은 그 표본에서의 사실일 뿐 이후 모든 페이지의 정렬 **보장**이 아니다(정렬 기준이 바뀌거나 예약 게시·공개 전환 같은 항목이 중간에 끼면 깨질 수 있다: **가정**. 공개 문서에 목록 경로 자체가 없다: 근거 확인 A1). 그래서 v1 반복기는 **늘 마지막 페이지(`next == None`)나 `MAX_LIST_PAGES`까지 훑고 기준점으로 거른다.** 기준점보다 오래된 항목을 만나도 그 종류를 멈추지 않는다. 질문 1은 "정렬이 보장되는가"가 아니라 **"관찰한 표본에서 내림차순이었는가"**(결과명 "관찰 표본에서 내림차순", 표본 크기와 함께, §15)를 묻고, 그 답은 어떤 동작도 바꾸지 않는다. 페이지를 도는 사이 항목이 밀려 같은 항목이 두 페이지에 나올 수 있으므로 반복기는 ID로 중복을 거른다(페이지 번호 방식일 때, **가정**). 조기 종료는 이 문서의 v1 범위 밖이고 아래 **열린 결정 E1**로만 켠다.
- **열린 결정 E1: 조기 종료(정렬 가정에 의존하는 최적화, 사용자 결정 대기).** 어느 쪽이든 §15 질문 1의 관찰만으로는 켜지 않는다(N7).

  | 선택지 | 내용 | 비용과 위험 |
  |---|---|---|
  | **A. 켜지 않는다(v1 기본, 추천)** | 상한까지 순회 | 확인 한 번에 최대 `MAX_LIST_PAGES`(50) × 2종(VOD·클립) = 100 요청, `LIST_PAGE_GAP`(500ms)면 최소 약 50초(산술, 세 수치 모두 [잠정]). 페이지 크기·총 개수(질문 1)가 작으면 실제는 훨씬 적다. 누락 위험이 없다(상한 안에서) |
  | B. 안전장치와 함께 켠다 | 주기 확인(나)에서만, 기준점보다 오래된 항목만 담긴 페이지가 연달아 K쪽 나오면 그 종류를 멈춘다. 수동 [새 영상 찾기]와 자동 N번에 한 번은 전체를 훑어 조기 종료 결과와 대조하고, 어긋나면 조기 종료를 그 실행부터 끈다 | 정렬 가정이 틀리면 다음 대조 전까지 뒤 페이지의 새 영상을 놓친다. K·N 값은 근거 없는 [잠정]. 대조 로직과 테스트가 는다 |
  | C. 안전장치 없이 켠다 | 관찰이 맞다고 보고 멈춘다 | N7이 지적한 그대로다. 추천하지 않는다 |

  A로 시작하고, 다음이 **모두** 모이면 B를 다시 연다: ① 질문 1·6 결과 상한 순회의 요청 수나 429가 실제로 문제임이 측정됨, ② 정렬 관찰이 서로 다른 날 여러 번 같음(횟수 [잠정]), ③ B의 대조 로직이 설계·테스트로 갖춰짐. 켜는 변경은 `check`의 분기 하나와 테스트(§13)이고 `ledger`·DTO는 바뀌지 않는다.
- 오류: 새 `ErrorKind`를 만들지 않는다(`error.rs:100-123`에 `Api`·`Http`·`AuthRequired`·`Parse`·`Network`가 있다). 기존 GET 경로의 규칙을 그대로 탄다: **401·403은 `AuthRequired`**, 그 밖의 2xx 아닌 응답은 `HttpStatus`(`client.rs:201` 주석, `:216-217`). 429는 `HttpStatus { status: 429 }`로 셸 payload까지 간다(`error.rs:25`, `crates/shell/src/error.rs:190-191`). 형식이 틀리면 `Parse`, 연결 실패는 `Network`.

### 3.2 `ContentRef` 연결
- `VideoItem → ContentRef::Video { video_no }`, `ClipItem → ContentRef::Clip { clip_id }`.
- 정규 주소 생성 함수 `content_url(&ContentRef) -> String`을 `url` 모듈에 둔다. v0.7.0에서 `ContentRef`에 `Live { channel_id }`가 늘었으므로(`crates/core/src/model.rs:19-29`) 함수는 세 갈래 모두를 다룬다: `Live`는 `https://chzzk.naver.com/live/{channel_id}`(소문자 32자리 hex, 읽는 쪽은 `crates/core/src/url.rs:44`). 목록 파서는 `Live`를 만들지 않는다. `services::enqueue`가 `parse_content_url(req.url) == req.content`를 검사하므로(`services.rs:574`) 모아 받기도 정규 주소를 만들어 넘긴다. 왕복 속성 테스트(`parse_content_url(content_url(c)) == c`)를 `Video`·`Clip`·`Live` 셋 모두에 둔다(`Live`는 대문자 입력이 소문자로 정규화되는 경우 포함, `url.rs`의 기존 `live_channel_id` 테스트와 겹치지 않게 `content_url` 쪽만). 모아 받기는 `Live` 항목을 만들지도 받지도 않는다(§4.6).

### 3.3 resolve 시점
- 코드로 확인했다. `run_download` → `Chzzk::download`(`manager.rs:1211`) → `run()`이 매 시작마다 `Phase::Resolving` → `job.resolve()`를 돈다(`download/mod.rs:325-326`(생방송 `.part` 마무리 분기가 그 앞 `:310-322`에 늘었지만 Video·Clip 경로는 그대로 Resolving → resolve), 골격 주석 `:11-16`).
- `DownloadRequest`(`download/mod.rs:64-78`, 생방송 전용 `live_stop: Option<CancellationToken>`이 늘었을 뿐 서명 값은 아니다)·`JobRecord`(`crates/shell/src/jobs.rs:30-63`)에는 서명 값 필드가 없다(`JobRecord.url`은 컨텐츠 주소다).
- 따라서 미리 resolve해 큐에 오래 넣어 둬도 서명 만료가 문제 되지 않는다. 옛 실측 질문 8은 지운다.

---

## 4. 셸 변경(`crates/shell`)

### 4.1 원장 `ledger.rs`: `BackupLedger`(새 파일 `{app_data_dir}/backup_ledger.json`)
- 상태이므로 config가 아니라 data 폴더에 둔다(`app.md:16` "설정이 아니라 상태라 config가 아닌 data 폴더다").
- 쓰기는 `fsutil::atomic_write`(임시 파일 → `sync_all` → rename, Windows 일시 잠금 재시도, `crates/core/src/fsutil.rs:9-13`)이고, 잠금 밖 쓰기 스레드를 둔다(`app.md:1184` 32, `crates/shell/src/writer.rs:1` "`jobs.json` 쓰기 스레드"와 같은 방식).
- 형식:
  ```jsonc
  { "version": 1,
    "channels": { "<channelId>": {
        "baseline": { "at": "2026-10-16T00:00:00Z" }      // 또는 { "seenIds": ["v:…", "c:…"] } (아래)
        , "lastCheckedAt": "…", "lastCheckResult": "ok|failed",
        "items": { "v:<videoNo>" | "c:<clipId>": {
            "state": "downloaded|failed|encrypted|userExcluded",
            "at": "…", "outputHint": "파일 이름만(폴더 없음)" } } } } }
  ```
  - **상태 이름은 `JobStatus::Skipped`(`dto.rs:638`)와 겹치지 않게 바꿨다.** 초안의 `skipped(encrypted)`·`skipped(needsCookie)`는 `Skipped` 작업 상태(같은 이름 파일이 생겨 옮기지 않음)와 이름이 같아 혼동을 부른다.
  - `downloaded`·`encrypted`·`userExcluded`는 "새 영상"에서 빠진다. `failed`는 다음 확인 때 다시 후보다.
  - 쿠키가 필요한 항목은 원장에 쓰지 않는다. 매 확인 때 목록 표시(`ItemFlags`)와 현재 쿠키 설정으로 다시 계산한다(설정이 바뀌면 바로 반영되도록).
  - `outputHint`는 파일 이름만 담는다. 원장이 새어도 폴더 구조가 드러나지 않게 한다. 화면에는 쓰지 않는다.
  - **기준점 두 모양(근거 확인 A6·A11).** 목록 항목에 게시 시각(`published`)이 있으면 `{ at }`이다. 없으면(질문 5 "없음") 첫 확인 때 본 ID 집합 `{ seenIds }`를 기준점으로 쓰고, 그 밖의 ID를 "새 영상"으로 본다. `seenIds`의 크기는 `MAX_LIST_PAGES × 페이지 크기`를 넘지 않는다.
- **원장 갱신 경로(이번 개정의 둘째 핵심, 근거 확인 D6·Codex "정정된 결정표" 지적).** 초안의 "`JobEvent::Finished/Failed/Skipped`를 구독하는 `LedgerSink`"는 성립하지 않는다. 기록자는 아래 둘이고(2차 개정), 둘 다 원장 쓰기 스레드의 같은 채널에 작은 값을 넣기만 한다. 원장 파일을 직접 쓰는 곳은 쓰기 스레드 하나다.
  - `JobEvent`는 `Added`·`Status`·`Progress`·`Removed`뿐이다(`dto.rs:781-795`). 끝 상태는 `Status { job }` 안에 온다.
  - 구독자는 하나다. `subscribe`가 `st.sink = Some(sink)`로 **교체**하고(`manager.rs:354-356`, `events.rs:4`), sink가 `false`를 돌려주면 매니저가 구독자를 비운다(`events.rs` `EventSink` 주석). 팬아웃 sink를 꽂아도 웹뷰가 다시 구독하거나 사라지면 원장 다리가 함께 없어진다.
  - 그래서 **매니저에 sink와 별개인 끝 상태 관찰자 `TerminalObserver`**를 둔다. `DownloadManager`를 만들 때 한 번 주입하고 `subscribe`가 바꾸지 않는다. 호출 자리는 `finish`에서 상태를 정한 직후, `st.emit(JobEvent::Status { job: dto })` 옆이다(`manager.rs:1150-1153`). 잠금을 쥔 채 불리므로 sink와 같은 제약을 따른다(`events.rs` "오래 막히거나 매니저를 다시 부르면 안 된다"). 관찰자는 `(content, channel_id, status, error kind, file name)` 작은 값을 원장 쓰기 스레드의 채널에 넣기만 한다(디스크 IO·매니저 호출 없음).
  - 무엇을 기록하나: decisions.md Q9 "U4 기록한다"(주소 붙여넣기로 받은 본인 영상도 원장에 넣는다)를 따른다. 그래서 BackupService가 넘긴 `JobId` 집합(초안, 재시작하면 사라진다)은 쓰지 않는다. 대신 `JobRecord.channel_id`(`jobs.rs` "로그인을 쓰는 빌드는 셸이 검증한 값")가 **지금 로그인한 채널(① 뒤에는 맡은 채널 집합 포함)**과 같을 때만 그 채널 칸에 쓴다. `channel_id == None`(관리자 허용 등 채널 모름, `services.rs:583-585`(`req.channel_id = owner` :584))이면 쓰지 않는다.
  - **생방송(`ContentRef::Live`) 작업은 어떤 끝이든 쓰지 않는다(3차 개정).** v0.7.0부터 주소를 붙여 넣은 생방송 녹화도 같은 매니저를 지나 `finish`에 온다(`manager.rs:1109-1153`). 원장 키는 `v:<videoNo>`·`c:<clipId>`뿐이고 같은 방송을 다시 녹화하는 것이 정상이라 "받은 영상" 개념이 없다. 생방송은 [녹화 마치기]·창 닫기(`StopReason::Finish`, `manager.rs:86-92`)로도 `Completed`가 되므로(`docs/design/app.md:1386`) 거르지 않으면 `ContentRef` → 원장 키 변환이 `Live`를 처리하지 못한다. 그래서 키 변환 함수는 `Video`·`Clip`만 `Some`, `Live`는 `None`이고 관찰자는 `None`이면 채널에 넣지 않는다.
  - 끝 상태 → 원장 대응표(Video·Clip 작업만, 위 생방송 제외):

    | 작업 끝 | 원장 | 이유 |
    |---|---|---|
    | `Completed`(`manager.rs:1109-1115`) | `downloaded` | 받았다 |
    | `Skipped`(같은 이름 파일이 있었거나 받는 중 생김, `.part` 남음, `manager.rs:1116-1121`) | **쓰지 않는다** | 받지 않았다. 다음 확인에서 다시 후보로 보이고 `fileExists` 안내가 붙는다. 자동으로 덮어쓰지 않는다 |
    | `Failed` + `Encrypted` | `encrypted` | 다시 시도해도 안 된다 |
    | `Failed`(그 밖) | `failed` | 다시 후보 |
    | 일시정지(`StopReason::Pause` → `Paused`, `manager.rs:1124-1127`)·종료(`StopReason::Quit` → `Interrupted`, `:1128-1131`) | 쓰지 않는다 | 끝 상태가 아니다(나중에 이어받는다). 같은 팔의 `StopReason::Finish`는 생방송 전용이다 |
    | `End::Cancelled` + `StopReason::Remove` 또는 멈춘 이유 없음 → `Failed`(internal "멈춘 이유 없이 취소되었습니다", `manager.rs:1132-1135`) | `failed` | 관찰자가 `:1150-1153`에 붙으므로 이 경우도 `Failed`로 보인다. 해는 없다: `failed`는 다음 확인 때 다시 후보일 뿐이다. 굳이 거르려면 `last_error`가 internal인 `Failed`를 빼야 하는데, 그 구분을 위한 새 필드를 두지 않는 쪽이 작다(**판단**). 대응표 전수 테스트에 이 행을 넣는다(§13) |
- **둘째 기록자: `BackupService`(큐에 들어가기 전).** `enqueue_selected`는 enqueue 전에 직접 resolve한다(§4.2). 암호화 VOD는 resolve에서 `Error::EncryptedVod`로 끝나고(`crates/core/src/client.rs:115` 주석, `:126-128`) 작업이 생기지 않으므로 `finish`·`TerminalObserver`를 거치지 않는다. 그래서 이 경우만 `BackupService`가 `(content, channel_id, encrypted)`를 같은 쓰기 채널에 넣는다. 채널은 `signer().channel_id`(§4.2, 웹뷰 값 아님)이고 기록 조건은 관찰자와 같다(지금 로그인한 채널 집합). resolve의 다른 실패(`Network`·`Http`·`Parse`·소유 판정 거부 등)는 쓰지 않는다: 일시적이거나 게이트가 판정할 일이라 다음 확인에서 다시 보이는 것이 맞다(**판단**). 주소 붙여넣기 카드에서 암호화 VOD를 불러온 경우는 카드 resolve가 실패해 작업도, 원장 기록도 없다(지금 동작 그대로, U4는 "받은" 영상 기록이다).
- 버전과 호환: `version` 필드를 두고 모르는 필드는 serde default로 무시한다. 파일이 깨지면 `backup_ledger.json.bad-<시각>`으로 옮기고 빈 원장으로 시작한다. 기준점이 사라지므로 다음 확인은 첫 확인처럼 기준점을 다시 잡는다(§6.3). 모든 영상을 새 영상으로 쏟아내지 않는다.
- 원장은 실제 영상 번호를 담는 사용자 로컬 데이터다. 공개 저장소에는 합성 값 fixture만 둔다(CLAUDE.md 공개 저장소 규칙).

### 4.2 `BackupService`(새 파일 `backup.rs`)
```rust
pub struct BackupService<B: Backend, L: Lister> { … }
impl BackupService {
    pub async fn check(&self, opts: CheckOptions) -> Result<BackupCheckDto, AppError>;  // 목록 → 후보 계산
    pub async fn enqueue_selected(&self, sel: BackupEnqueueRequest, on_step: impl Fn(BackupStepDto))
        -> Result<BackupEnqueueResultDto, AppError>;                                     // 한 건씩 resolve → enqueue
    pub fn exclude(&self, items: Vec<ContentRef>, excluded: bool) -> Result<(), AppError>; // 받지 않기 / 다시 보이기
    pub fn reset_baseline(&self) -> Result<(), AppError>;
    pub fn clear_ledger(&self) -> Result<(), AppError>;
}
```
- `Lister` trait은 코어 목록 메서드를 감싼 seam이다(`Backend`와 같은 방식). 테스트는 가짜 Lister를 쓴다.
- **채널 ID는 웹뷰에서 받지 않는다.** `AuthService::signer().channel_id`(SignedIn일 때만 `Some`, `crates/shell/src/auth/service.rs:1182-1186`)만 쓴다. 웹뷰 값을 믿지 않는 기존 원칙(`services.rs:577`)과 같다. 로그인 상태가 아니면 `notLoggedIn`이다.
- **계정이 바뀐 뒤 늦게 온 결과를 버린다.** `check`는 시작할 때 읽은 채널 ID를 결과를 원장·화면에 적용하기 직전에 다시 읽어, 다르면(로그아웃 → 다른 계정 로그인) 결과를 버린다. 기존 refresh가 `session_epoch`로 같은 일을 한다(`auth/service.rs:513` 잡기, `:551` 다르면 버림). 같은 계정으로 다시 로그인한 경우는 원장이 채널별이라 섞이지 않는다. enqueue는 `OwnershipGate::admit`이 판정 직전에 로그인 채널을 다시 읽으므로(`ownership.rs:130-133`) 따로 막을 것이 없다.
- `check` 순서:
  1. 디스크 여유를 본다(§4.4). check 직후에는 크기를 모르므로 여유 공간 값만 결과에 싣는다.
  2. VOD·클립 페이지를 차례로 돈다. 페이지 사이 `LIST_PAGE_GAP`, 마지막 페이지(`next == None`)나 `MAX_LIST_PAGES`에서 멈춘다. **기준점보다 오래된 항목을 만나도 멈추지 않는다**(정렬은 관찰일 뿐 보장이 아니다, §3.1·열린 결정 E1). 상한에서 끊기면 결과의 `truncated`를 켠다.
  3. 후보를 분류한다.
     - 원장에 `downloaded`·`encrypted`·`userExcluded`가 있으면 → "이미 받았거나 받지 않기로 함" 묶음.
     - 같은 content의 활성 작업이 있으면 → `inQueue`. 매니저 `enqueue`는 같은 최종 경로의 활성 작업만 막으므로(`manager.rs:375-381`) 컨텐츠 중복은 BackupService가 `manager.list()`로 직접 본다.
     - 기본 파일 이름(`naming::default_filename(&ContentMeta, Platform)`, `crates/core/src/naming.rs:42`)이 기본 저장 폴더에 있으면 → `fileExists`(기본 체크 해제, **안내용**). 이름 계산에 필요한 메타(채널 이름·날짜 등)가 목록 항목에 다 있는지는 **실측 필요**(질문 5, 근거 확인 C11)다. 모자라면 이 판정을 빼고 resolve 뒤 `check_output`의 `exists`만 쓴다. 어느 쪽이든 `skip`이 마지막 보호다(§2.2).
     - 성인·구독자 전용이고 쿠키가 꺼져 있으면 → `needsCookie`(체크 불가, 사유 한 줄).
     - 목록이 암호화로 표시하면 → `encrypted`(체크 불가). 표시가 없으면 `enqueue_selected`의 resolve 때 `EncryptedVod`로 알게 되고 **`BackupService`가 원장에 `encrypted`를 쓴다**(§4.1 둘째 기록자). 원장의 `encrypted`는 후보 계산 때 "받을 수 없음" 묶음으로 간다.
     - 그 밖 → `new`(기준점 이후면 기본 체크) 또는 `older`(기준점 이전, "이전 영상도"일 때만 보이고 체크 해제).
  4. `lastCheckedAt`을 갱신한다.
- `enqueue_selected` 순서:
  - 고른 항목마다 **resolve(메타·화질만) → 화질 고르기 → 파일 이름 계산 → `check_output` → `services::enqueue`**를 **한 건씩 번갈아** 한다. 전부 resolve한 뒤 한꺼번에 넣지 않는 이유는 `OwnershipGate` 최근 캐시(`ownership.rs:24` `RECENT_RESOLVES = 32`)를 넘으면 오래된 것이 빠지고 miss 때 다시 조회하기 때문이다(`ownership.rs:170`, 테스트 `admit_uses_cache_then_fetches_on_miss_once` `:294`).
  - 요청 모양: `onExisting: skip`, `restart: false`. `check_output`이 `exists`면 `free_file_name`(`dto.rs:563`, "이름 (2)")로 이름을 바꿔 넣는다. `free_file_name == None`(번호 상한 초과, `crates/shell/src/output.rs:22`)이면 그 건은 넣지 않고 결과에 `fileExists`로 남긴다. `duplicate_job_id`가 있으면 넣지 않는다(`inQueue`).
  - 건 사이에 `RESOLVE_GAP` 700ms를 둔다. **[잠정] 근거 없음, 실측·ADR-0009 묶음 등록**(질문 6).
  - 화질은 설정 `backup_quality`로 고른다. `best` = `Resolved::default_quality(None)`(`last_label`에 `None`을 넘겨야 "가장 큰 해상도"가 된다, `crates/core/src/model.rs:187-191`). `smallest` = 해상도가 가장 작은 항목(새 함수, 같은 비교 규칙의 반대).
  - **한 번에 큐에 넣는 수 상한 `BACKUP_ENQUEUE_MAX` 30.** **[잠정] 근거 없음, 실측·ADR-0009 묶음 등록**(완료 상한 `MAX_FINISHED` 100과 목록 소음을 고려한 판단일 뿐이다). 넘는 선택은 UI가 막는다(§6.2).
  - **최근 영상·마지막 화질을 기록하지 않는다.** `record_enqueued`는 최근 영상(`settings.rs:30` `MAX_RECENT_VODS = 5`)과 함께 `last_quality_label`도 저장한다(`services.rs:476-480`). 모아 받기 30건이 최근 영상 5칸을 덮고, 카드의 "마지막으로 고른 화질" 기억도 모아 받기 화질로 바뀐다. 모아 받기는 화질을 `backup_quality`로 따로 정하므로 둘 다 기록하지 않는 것이 맞다(근거 확인 D10의 부작용을 의도로 명시). `services::enqueue`의 몸통을 나눠 `record_recent: bool`을 받는 내부 함수를 두고, 공개 `enqueue`는 `true`로 부른다. v0.7.0에서 `recent_kind`가 `Option`이 되었고(생방송은 `None`, `services.rs:604-612`) 호출부가 `if let Some(kind)`로 감쌌다(`services.rs:594-598`). `record_recent` 분기는 이 `Some` 안에서 가르면 되고 생방송 경로는 그대로 둔다.
  - 진행 상황은 `on_step`으로 "3/12"를 보낸다. 취소는 `CancellationToken`이고 이미 넣은 작업은 그대로 둔다.
  - 한 건이 실패해도(소유 판정 실패, `EncryptedVod`, 같은 경로 활성) 나머지는 계속한다. 결과에 건별 `outcome`을 담는다. 원장에는 `EncryptedVod`만 쓴다(§4.1 둘째 기록자).
- 동시 다운로드 수는 기존 설정을 그대로 쓴다(`settings.rs:68` `max_parallel_downloads`, 기본 2 `:454`). 모아 받기 전용 병렬 수는 없다. 생방송은 별도 lane이다(`MAX_LIVE` 3, `manager.rs:63`, `pump`의 lane 판정 `:976-983`, 모듈 주석 `:6-7`): 모아 받기 30건이 방송 녹화 시작을 막지 않고 녹화가 모아 받기 슬롯을 쓰지도 않는다. 창 닫기 확인의 `running` 수에는 둘 다 센다(`manager.rs:368`, `app.md:1386`).

### 4.3 중복 판정 요약(세 겹 + 마지막 보호)
| 겹 | 근거 | 약점과 보완 |
|---|---|---|
| 원장 | 채널 → 컨텐츠 ID(§4.1) | 원장 밖에서 받은 것은 모른다 → 둘째 겹 |
| 파일 존재 | 기본 이름 + 기본 폴더(볼륨 기준 Platform, §10) | 이름 변경·이동에 약하다 → 첫째 겹. 있으면 기본 체크 해제 + "같은 이름 파일이 있어요". **체크하면 번호를 붙여 저장한다**(`free_file_name`). 덮어쓰기는 없다 |
| 활성 작업 | 같은 content가 큐에 있음 | 체크 불가로 표시한다 |
| **마지막 보호** | `onExisting: skip`(`part.rs:379-383,387-392`) | 확인 뒤 같은 이름(번호 이름 포함) 파일이 생겨도 덮지 않고 `Skipped`, `.part`는 남는다. 원장에는 쓰지 않는다(§4.1 표) |

초안 §2.2("후보에서 뺀다")와 §4.3("체크하면 번호를 붙여 저장")이 어긋났던 것(근거 확인 B13)은 **후자 하나로 정했다**: `fileExists`는 후보에 남되 기본 체크 해제이고, 체크하면 번호 이름 + `skip`이다.

### 4.4 디스크 여유 검사
- 지금 `volume.rs`는 파일 시스템 종류만 판정하고 여유 공간 함수가 없다(공개 함수 `naming_platform` `:32`·`platform_for_dir` `:45`·`fs_from_macos_name` `:50`·`fs_from_linux_magic` `:62`·`detect` `:78`). 새로 만든다.
- **규칙은 새로 정하지 않고 디자인 시스템의 기존 규칙을 쓴다**(초안의 "90%"는 근거 없는 수치라 버린다, 근거 확인 D16): `platform.md:415` "필요량 = (어림 크기 − `.part` 크기) × `LOW_SPACE_FACTOR`(1.05 [취향]) > 여유 → `warn`(`lowSpace`, "약"). macOS는 `volumeAvailableCapacityForImportantUsage` 우선, 없으면 `f_bavail`". 상수는 이미 있다(`crates/shell/src/consts.rs:25` `LOW_SPACE_FACTOR: f64 = 1.05`).
- 어림 크기는 **받기 전 화질의 `bandwidth` × 재생 시간 / 8**이다. resolve 뒤 화질 DTO에 있는 크기 관련 값은 `QualityDto.bandwidth`(`crates/shell/src/dto.rs:506`, `Option<u64>`)뿐이고, 받기 전 크기 어림은 프런트 `estimateSize(bandwidth, durationSecs)`(`app/src/lib/format/bytes.ts:9-11`, 둘 중 하나라도 없으면 `null`)가 한다(카드 선례: `app/src/lib/receive.ts:87` `qualitySize`). 1차 개정이 든 `total_bytes_estimate`(`dto.rs:724`)는 `ProgressDto` 필드(`dto.rs:719` `pub struct ProgressDto`, 생방송 필드 `live_recorded_secs`·`live_gaps`가 늘었지만 받기 전 크기와는 무관)라 **받는 중의 진행값**이고 받기 전에는 없다(1차 개정의 인용 오류, 초안의 `size_estimate`는 없는 이름이었다, 근거 확인 D15). 모아 받기 `lowSpace`는 `enqueue_selected`가 resolve한 화질의 같은 식을 셸에서 합한다. 프런트 식과 어긋나지 않게 셸에 같은 식의 함수를 두고 골든 하나로 양쪽을 맞춘다(`bytes.ts:2` "Rust `chzzk_shell::format`과 같은 골든" 선례). 이미 있는 `.part` 크기는 `platform.md:415`대로 뺀다. 어림이 없는 항목(`bandwidth`·길이 없음)은 합에서 빼고 "약"을 붙인다. check 단계(resolve 전)에는 화질이 없으므로 합을 내지 않는다(§4.2 check 1).
- `volume::available_bytes(dir) -> Option<u64>`. macOS는 위 규칙(`platform.md:415`), Linux는 `statvfs` `f_bavail × f_frsize`, Windows는 `GetDiskFreeSpaceExW`의 호출자 가용 바이트. Linux·Windows API 선택은 저장소 근거가 없는 **가정**(근거 확인 D14)이고 의존성(`libc`·`windows-sys` 직접 또는 작은 crate)은 `supply` gate·cargo-deny 검토 대상이다.
- `warn`이고 막지 않는다(`platform.md:419` "`block`은 쓸 수 없는 폴더와 FAT32 4GiB 둘뿐이다. 그 밖은 `warn`"). 네트워크·가상 볼륨에서 `None`이면 "여유 공간 알 수 없음"으로 보이고 막지 않는다.
- 문구는 `lowSpace` 하나를 쓴다. 이 문구는 `content.md`가 소유하는 오류 문구 8종 가운데 하나이고(`platform.md:419`) 아직 copy deck에 키가 없다. 모아 받기 전용 키(`backup.disk.low`)를 만들지 않고 공용 `lowSpace` 키를 content.md에 먼저 더한다.

### 4.5 주기 확인 `BackupScheduler`(단계 (나))
- 앱 수명 동안 tokio 타이머 하나. 켜는 조건: 설정 `backup_auto_check`, 로그인 SignedIn, 오프라인 유예 중 아님(`auth/service.rs:42-48` 유예 정보).
- 간격은 `backup_check_interval_min`, **하한 60분**, 선택지 1·3·6·12·24시간. 모두 **[잠정] 근거 없음, 실측·ADR-0009 묶음 등록**. 하한은 연속 호출 차단 위험(근거 확인 A9, 실측 필요)을 줄이려는 장치인데 그 위험의 크기가 측정되지 않았다. 질문 6 결과로 다시 정한다.
- 조기 종료가 없으므로(§3.1) 확인 한 번의 요청 수는 `MAX_LIST_PAGES` × 2종 이하다. 간격 하한 60분이면 시간당 100 요청 이하다(산술, 값은 모두 [잠정]). 이 합이 문제임이 질문 1·6으로 측정되기 전에는 조기 종료로 줄이지 않고(열린 결정 E1), 먼저 `MAX_LIST_PAGES`·간격 하한을 조정한다.
- 첫 확인은 앱 시작 후 `BACKUP_FIRST_DELAY` 10분 또는 `lastCheckedAt + 간격` 중 늦은 쪽이다. 10분은 **[잠정] 근거 없음, 실측·ADR-0009 묶음 등록**. 시작 직후 네트워크 일은 실제로 있다: 세션 확인이 처음 성공한 직후 한 번 업데이트를 확인한다(`app/src-tauri/src/lib.rs:179-182` "세션 확인이 처음 성공한 직후 한 번만 업데이트를 확인한다(D8)", `take_auto_update_check` `crates/shell/src/app.rs:457`). 그래서 "시작 직후의 세션 확인·업데이트 확인과 몰리지 않게"라는 이유는 성립한다. 근거가 없는 것은 **10분이라는 값**뿐이다(이 둘이 끝나는 시점을 나타내는 상수가 없고 `crates/shell/src/update.rs:15`는 시간 제한 10초다, 근거 확인 D20). 1차 개정의 "근거를 찾지 못해 이유에서 뺐다"는 틀린 서술이라 고쳤다(2차 개정). 값을 고정 지연 대신 "첫 세션 확인·업데이트 확인이 끝난 뒤 + 지연"으로 묶을지는 ③-7에서 정한다(**판단**, 묶으면 상수가 줄 수 있다).
- 실패하면 지수 백오프(간격 × 2, 최대 24시간). **[잠정] 근거 없음, 실측·ADR-0009 묶음 등록**.
- **목록 서킷은 새 규칙이다.** 초안은 "patterns §10.4와 같다"고 했지만 §10.4는 "같은 종류에서 **서로 다른 영상** `CIRCUIT_FAILURES`(3)건이 연속으로 읽기 오류"를 세는 규칙이고(`patterns.md:526`), 목록 한 경로의 반복 실패에 그대로 맞지 않는다(근거 확인 D22). 또 `CIRCUIT_FAILURES`(`consts.rs:41`)는 정의만 있고 참조가 0건이라 재사용할 서킷 상태 머신이 없다(decisions.md Q10). 그래서: **같은 목록 경로에서 연속 3회 `Parse`, 또는 429 한 번이면** 이번 실행 동안 자동 확인을 멈춘다. 수동 확인은 계속 할 수 있다. 3이라는 값은 `CIRCUIT_FAILURES`와 같게 두되 뜻이 다르므로 새 상수 `LIST_CIRCUIT_FAILURES`로 따로 등록한다(**[잠정] 근거 없음, 실측·ADR-0009 묶음 등록**). 같은 호스트를 쓰는 ④ 채팅과의 합산 예산은 v1에서 두지 않는다(decisions.md Q10 "(다) 각자 상수"). 각자 상수는 잠정 선택이고, **합산 부하는 따로 잰다**(Codex Q10 "유지": "각자 상수는 잠정 선택으로 두고 합산 부하를 측정한다", Codex 1회차 적대적 리뷰 결정별 판정): §15 질문 6-2가 목록 순회 + 모아 받기 resolve + ④ 채팅 요청을 같은 시간대에 겹쳐 돌린 결과를 본다. 429·차단이 나오면 공통 예산(Q10 보류안)을 다시 연다.
- 찾은 결과는 배너 B6 한 장이다(§6.6). `backup_auto_enqueue`(기본 꺼짐, `backup_auto_check`가 켜져 있어야 켤 수 있다)면 `new`이면서 기준점 이후인 항목만 `enqueue_selected`로 넣고 상한 30을 지킨다. `fileExists`·`needsCookie`·`older`는 자동으로 넣지 않는다. `lowSpace`면 자동 받기를 건너뛰고 배너에서 알린다.
- **방송 상태 감시는 하지 않는다(3차 개정).** v0.7.0의 생방송 녹화는 사용자가 방송 중에 주소를 붙여 넣는 수동 흐름이고 방송 시작을 알아채는 감시가 없다(`app.md:1386`). `BackupScheduler`는 VOD·클립 목록의 주기 확인뿐이며 `LiveWatch`(방송 상태 감시)는 ③에 없고 기능 ⑤가 실측 게이트 뒤에 만든다(decisions.md C3). 둘은 같은 호스트를 쓰므로 합산 부하는 질문 6-2에서 방송 상태 조회 요청도 함께 재다(⑤의 요청 경로가 생긴 뒤).
- 잠자기 방지(`keep_awake`)는 받는 작업 수에 묶여 있다(`crates/shell/src/power.rs:228` `update(enabled, running)`). 확인 타이머 때문에 잠들지 않게 막지 않는다.

### 4.6 command·DTO(ts-rs, `UPDATE_BINDINGS=1`)
| command | 입력 | 출력 | AuthGate |
|---|---|---|---|
| `backup_status` | — | `BackupStatusDto { available, baselineSet, lastCheckedAt?, autoCheck, nextCheckAt?, circuitOpen }` | 기본 거부 |
| `backup_check` | `{ includeOlder: bool }` | `BackupCheckDto { items: BackupItemDto[], truncated, freeBytes? }` | 기본 거부 |
| `backup_enqueue` | `BackupEnqueueRequest { items: ContentRefTs[], channel: Channel<BackupStepDto> }` | `BackupEnqueueResultDto { outcomes: {content, outcome, jobId?}[], lowSpace? }` | 기본 거부 |
| `backup_exclude` | `{ items, excluded: bool }` | — | 기본 거부 |
| `backup_reset_baseline` · `backup_clear_ledger` | — | `BackupStatusDto` | 기본 거부 |
| `backup_cancel_enqueue` | — | — | 기본 거부 |

- `BackupItemDto { content, title, kind, publishedAt?, durationSecs?, state: "new"|"older"|"fileExists"|"inQueue"|"needsCookie"|"encrypted"|"failedBefore"|"downloaded"|"userExcluded", defaultChecked }`. `kind`는 기존 배지 종류(빠른 다시보기·일반 VOD·클립, `services.rs` `recent_kind` `:604`)와 같은 규칙이다. 종류 배지에는 v0.7.0에서 "생방송"이 늘었지만(`content.md:96`) 목록 항목은 영상·클립뿐이라 이 배지는 나오지 않는다(`recent_kind`가 생방송을 `None`으로 두는 것과 같은 이유). 목록 단계에서 빠른 다시보기/일반 VOD를 가를 수 없으면(질문 5) resolve 전에는 클립/VOD 배지 없이 둔다(**실측 필요**).
- 웹뷰는 `channelId`를 보내지 않는다(§4.2).
- **`Live`를 거부한다(3차 개정).** `ContentRefTs`에 `Live { channelId }`가 늘었으므로(`crates/shell/src/dto.rs:52-55`) `backup_enqueue`·`backup_exclude`의 `items`에 `Live`가 오면 `BackupService`가 `invalidInput`으로 돌려준다. `services::enqueue`는 `Live`를 정상으로 받으므로(`services.rs:574`) 이 거부는 `BackupService`가 직접 해야 하고, 원장 쓰기 전에 한다.
- AuthGate는 고칠 것이 없다: 목록에 없는 command는 기본 거부다(`crates/shell/src/gate.rs:3-4`, `:19` `OPEN_COMMANDS`). `gate-sync.test.ts`가 가짜 백엔드 목록과 대조한다(`gate.rs:7`).
- 설정 DTO 추가(`SettingsPatch`·`SettingsDto`, 코어 `UserSettings` serde default): `backupAutoCheck`, `backupCheckIntervalMin`, `backupAutoEnqueue`, `backupQuality`. 초안의 `backupIncludeVideos`·`backupIncludeClips`는 뺐다(§6.2 종류 필터를 뺀 것과 같은 이유).
- 같이 고칠 곳: `app/src-tauri/src/command_names.rs`(`:2` "command를 더하면 여기, `commands.rs`, `lib.rs`의 `generate_handler!`, `capabilities/default.json`을 함께 고친다"), `app/src/lib/api.ts`, `app/e2e/mock/backend.ts`, `tests/ipc.rs`(capabilities와 이름 목록 대조, `command_names.rs:3`). capabilities에 `allow-backup-*` 일곱 개.

### 4.7 편집자(Q1 = 편집자까지)에 대비한 자리
- 사용자가 확정한 실제 사용자는 본인 + 지인 스트리머 + 그들의 편집자다(2026-10-16). 디자인 시스템 페르소나 PS2("지인·매니저 겸 편집자 … 주 1~2회 클립을 모아 받는다", `docs/research/design-system.md:102`, [추정] 페르소나)를 보면 **모아 받기를 가장 자주 쓸 사람이 편집자**일 수 있다. 그러나 편집자의 "내 채널"은 편집자 자신의 채널이라 v1에서는 쓸 것이 없을 수 있다.
- 결정: v1은 decisions.md Q6대로 본인만이다(① 확정 전에 대상 채널 규칙을 둘 곳이 없다). 대신 ①-4가 머지되면 바로 넓힐 수 있게 지금 자리를 만든다.
  - 대상 채널의 원천은 **셸이 서버에서 확인한 집합 하나**다: `signer().channel_id` + (① 뒤) 로그인 서버가 준 맡은 채널 목록. 웹뷰가 대상 채널 ID를 보내는 command는 만들지 않는다(웹뷰는 집합 안의 **순번이나 표시용 식별자만** 고른다, 셸이 다시 대조).
  - 원장은 이미 채널별이다(§4.1). `TerminalObserver`의 "기록할 채널" 판정도 같은 집합을 쓴다.
  - enqueue 판정은 그대로 `OwnershipGate::admit` 하나다. ①-4가 판정 순서(`ownership.rs:107-113` `Own` → `AdminOverride` → `NotOwn` → `Unknown`)에 `Delegated`를 끼우면 모아 받기는 바꿀 것이 없다(decisions.md Q6).
  - UI: 맡은 채널이 0개면 **아무것도 바뀌지 않는다**(① 설계의 "맡은 채널이 0개면 … 행들이 없다" 선례, `delegation.md:316`, 상태 표 `:346` "0개 | 행 없음"). 1개 이상이면 "내 채널" 뷰 머리의 제목 자리가 같은 모양의 글자 Menu(`components.md` §2.9 `trigger="text"`, 툴바 계정 Menu와 같은 컴포넌트) "내 채널 ▾"가 되고 항목은 "내 채널"·맡은 채널 이름들이다. 홈 섹션 제목은 "내 채널" 그대로 두고 상태 줄이 대상별 새 영상 합을 보인다. 용어는 ①의 "맡은 채널"(`delegation.md:80` 용어집 행)을 쓴다. 이 UI는 ③-8(① 머지 뒤) PR에서 그리고 D62 시험에 과업을 더한다.

---

## 5. 앱 셸 변경(`app/src-tauri`)
- command 배선 7개와 `Channel<BackupStepDto>`.
- `BackupScheduler` 시작·정지: `on_auth_status`(`app.rs:342`, `app/src-tauri/src/lib.rs:181`)에 맞춰 켜고 끈다. 로그아웃하면 진행 중인 확인을 취소한다.
- **창 닫기(`close_decision`)는 바꾸지 않는다.** 초안은 "바꾸지 않는다"와 "준비 중에 닫으면 D1을 띄운다"를 함께 적어 서로 어긋났다(근거 확인 D27: `close_decision(quitting, running, has_main)`은 받는 중인 작업 수만 본다, `lib.rs:73`). 가장 작은 타당한 선택으로 **D1을 넓히지 않는다**: 준비 중(resolve 루프)에 창을 닫으면 루프를 취소하고, 이미 넣은 작업은 기존 D1 규칙을 따른다(넣은 작업이 받기 시작했으면 `running > 0`이라 D1이 뜬다). 아직 넣지 않은 선택은 사라지지만 원장에 아무것도 쓰지 않았으므로 다음 확인에서 그대로 "새 영상"으로 보인다. 대화상자는 되돌릴 수 없는 결정에만 쓴다는 규칙(`patterns.md` §1.1 5단)과도 맞다. v0.7.0에서 D1 본문은 녹화 중인 생방송이 섞이면 다른 문구("녹화를 마치고 닫을까요?")가 되지만(`app/src/lib/components/app/CloseGuard.svelte`의 `hasLive`, `content.md` `dialog.closeLive.*`) 판단 입력 `running`은 그대로 받는 중인 작업 수라(`lib.rs:73`) 이 결정과 충돌하지 않는다. ③은 생방송을 큐에 넣지 않는다.
- 플러그인 추가 없음(트레이·autostart 없음). 번들 크기 ratchet 영향은 Rust 코드 증가분뿐이다.

## 5.1 Worker
- 변경 없음. 목록 조회는 앱이 치지직 서비스 API를 직접 부른다(지금 info와 같은 경로). Worker를 거치지 않으므로 무료 한도에 영향이 없다. (① 뒤 맡은 채널 목록은 ①이 이미 앱에 내려주는 값을 쓰며 ③이 Worker 경로를 더하지 않는다.)
- 실측 도구만 `worker/scripts/`에 둔다(§12 단계 1). `.dev.vars`를 읽지 않으므로 `DEV_VARS_READERS`(`scripts/ci/worker-config.mjs:261`)에 넣지 않는다. 목록 밖 파일은 `.dev.vars` 이름을 쓸 수 없으므로(`:603`) 도구 안에서도 그 이름을 쓰지 않는다.

---

## 6. UX

사용자 기준 ①을 이렇게 옮긴다: **보이는 곳 하나(홈 섹션), 늘 같은 모양(섹션 머리 패턴), 새 컴포넌트는 Checkbox 하나, 채워진 버튼은 [받기] 하나.**

### 6.1 진입점: 숨기지 않되 튀지 않게
- **홈 "다운로드" 섹션 위에 "내 채널" 섹션 한 줄**을 둔다. 섹션 제목 + 오른쪽 보조 동작 ghost 24 [새 영상 찾기]이고 기존 섹션 머리 패턴과 같은 모양이다(`patterns.md` §14.1 "섹션 제목 body 13 600 `--fg`(h2), 오른쪽 보조 동작 ghost 24(`.edge-end`)"). 채워진 버튼이 아니므로 P3를 지킨다.
  - **라벨 결정(2차 개정).** 1차 개정의 [새 영상 확인]·[다시 확인]은 선례 [업데이트 확인](`app/src/lib/copy/ko.ts:263`)만 들었는데, 버튼 라벨 규칙은 "동사 어간 + `기`"가 기본이고(`docs/design/system/content.md:141`), 굳은 한자어 허용 목록(`:142` 일시정지·로그인·로그아웃·복사·저장·변경·설정·추가·허가·취소·계속)에 "확인"이 없으며 "허용 목록 밖의 한자어 명사 라벨은 금지"다. 부사 + 동작 허용 목록(`:143`)에도 "다시 확인"이 없다. `ko.ts:263`은 규칙보다 앞선 예외로 보고 선례로 쓰지 않는다. 허용 목록을 넓히는 대신(새 ADR·`terms.json` 변경이 든다) **기본형만으로 되는 라벨**을 고른다: 홈 섹션과 뷰 요약 줄 둘 다 **[새 영상 찾기]**(`찾다` 어간 + `기`, 고유어라 허용 목록이 필요 없다). 뷰 안의 다시 하기도 같은 라벨을 쓴다(같은 일에 같은 말, 새 "다시 ~" 조합을 늘리지 않는다). [다시 불러오기](허용 목록 `:143`)는 쓰지 않는다: "불러오기"는 용어집에서 "영상 정보를 서버에서 가져와 카드에 보이는 일"이라(`content.md:91`) 목록에 쓰면 뜻이 넓어진다(W1 "한 낱말 두 뜻" 위험, **판단**). 용어집에 "새 영상 찾기" 행을 더하는 것은 §6.7 용어 행(가정, 사용자 확인 대상)에 넣는다.
  - 상태 줄의 "마지막 확인 {relativeTime}"은 버튼 라벨이 아니라(§5.1 강제 범위는 `action.*`·`*.label`, `content.md:141`) 그대로 둔다. 다만 같은 일을 "찾기"와 "확인" 두 말로 부르게 되므로, 용어 확인(E25) 때 "마지막으로 찾아본 때"로 맞출지 사용자에게 함께 묻는다.
- 섹션 본문은 상태 한 줄(caption `--fg-muted`)뿐이다.
  - 첫 확인 전: `backup.home.intro` "내 채널에 새로 올라온 영상을 한 번에 받을 수 있어요"
  - 확인 뒤: `backup.home.last` "마지막 확인 {relativeTime} · 새 영상 {count}" / 없으면 `backup.home.none`
- 이 섹션은 빈 상태(첫 실행)에서도 같은 자리(힌트 아래, "다운로드" 섹션 위)에 있다. 그래서 **빈 상태 그룹(`patterns.md` §14.2 (a)) 안에는 링크를 더하지 않는다.** 초안의 "빈 상태 링크"는 빈 상태 세 요소("시스템 상태 · 학습 단서 · 직접 경로", `patterns.md:175`)의 구성을 바꾸는데 그 영향을 검토하지 않았고(근거 확인 E27), 섹션이 이미 보이므로 필요 없다. 바꿀 문서는 §14.2 (a) 그림에 섹션 두 줄을 더하는 것뿐이다.
- **계정 Menu 항목은 두지 않는다.** 초안이 든 근거 `patterns.md` §1.1 규칙 4는 "알림 안의 동작은 같은 일을 다른 곳에서도 할 수 있다"이고(`patterns.md` 규칙 4 원문), 메뉴 진입점을 하나 더 두라는 원칙이 아니다(근거 확인 E5). 규칙 4가 실제로 걸리는 곳은 배너 B6의 [보기]이고, 그 짝이 홈 섹션 [새 영상 찾기]이다(§6.6). 진입점을 줄이는 쪽이 "튀지 않게"에도 맞다. 발견성은 D62 ③ 시험에서 본다(과업 "새로 올라온 내 영상을 모두 받아 보세요").
- 카드가 열려 있으면 "내 채널" 섹션은 최근 영상처럼 숨긴다(`patterns.md` §17-10 "카드가 열려 있으면 힌트·최근 영상을 숨긴다. 520 높이 예산(§15) 때문이다").

```
홈 960 (열 안쪽 760)
  [ 치지직 영상 주소                                   ] [불러오기]
  {paste}로 붙여넣으면 바로 불러와요
  24
  내 채널                                               [새 영상 찾기]   ← 섹션 제목 13/600 + ghost 24
  마지막 확인 3시간 전 · 새 영상 2개                                     ← caption muted, 숫자 tabular
  24
  최근 영상
  ┌──────────────────────────────────────────────────────────┐
  …
```

### 6.2 "내 채널" 뷰(네 번째 뷰)
- 설정 뷰와 같은 뼈대다. 툴바 왼쪽 [←](IconButton 28) + "내 채널"(display 17/600), 오른쪽 계정 Menu와 [⚙]은 같은 자리(`patterns.md` §14.1 툴바 행 "설정 화면에서는 왼쪽 [←] … 오른쪽은 같은 자리에"). §14.1 헤더 구성 표에 "내 채널" 행을 더한다(`frontend` 헤더 구성 표 테스트 대상).
- 한 창 안의 뷰이고 새 창을 열지 않는다(`app.md:52` "창은 하나다").

```
내 채널 뷰 960
┌──────────────────────────────────────────────────────────────────────────┐
│ [←] 내 채널                                          [채널이름 ▾] [⚙]    │ 44
│──────────────────────────────────────────────────────────────────────────│
│  (배너, 있을 때만)                                                         │
│  (첫 확인일 때만) ⓘ 지금부터 올라오는 영상을 새 영상으로 볼게요 …          │ Notice inline neutral, 닫기 없음
│  새 영상 2 · 이전 영상 37                                 [새 영상 찾기]   │ 요약 body 13 + ghost 24
│  보기  (●) 새 영상만  ( ) 이전 영상도                                      │ RadioGroup 가로
│  24                                                                       │
│  새 영상                                                       [모두 선택] │ 그룹 머리 caption 12/600 + ghost 24
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │ [✓] 금요 저녁 방송 - 신작 게임 (2부)    [일반 VOD]                   │   │ 행 52(두 줄), 제목 body 말줄임
│  │      10월 14일 · 3시간 12분                             [받지 않기]  │   │ caption muted + ghost 24
│  │ [✓] 하이라이트 모음                     [클립]                       │   │
│  │      10월 15일 · 58초                                   [받지 않기]  │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│  이미 받았거나 받지 않기로 함 5                                  (접힘 ▸)   │ Disclosure, 기본 접힘
│  받을 수 없음 2                                                  (접힘 ▸)   │ needsCookie·encrypted, 이유 한 줄씩
│  ───────────────────────────────────────────────────────────────────────  │
│  저장 폴더  ~/Movies/VOD Clip Downloader              여유 공간 120.4 GB   │ FieldRow + caption
│  화질       가장 좋은 화질 ▾                                                │ Select(가장 좋은 화질 / 가장 작은 파일)
│                                         2개 선택  8  [받기 ⌘↩]              │ sticky 바닥 52, primary 하나
└──────────────────────────────────────────────────────────────────────────┘
```
- **채워진 버튼은 바닥의 [받기] 하나**다(P3). 라벨은 "{n}개 받기"로 하지 않고 개수는 왼쪽 caption에 둔다(버튼 폭이 흔들리지 않게).
- **종류 필터("다시보기 / 클립")를 뺐다.** "다시보기" 단독은 금지어이고(`content.md` §4 "종류(배지) … 다시보기(단독) … 쓰지 않는다"), 근거 표가 제안한 "VOD(…) / 클립"도 "VOD(상위어로)" 금지(`content.md` §4 "영상 상위어")에 걸린다. 행마다 기존 종류 배지(빠른 다시보기·일반 VOD·클립)가 있고 체크로 고르면 되므로 필터 없이도 같은 일을 할 수 있다. 컨트롤 한 줄이 줄어 "튀지 않게"에도 맞다. 실제로 종류별로 거르고 싶다는 신호가 D62 ③ 시험에서 나오면 다시 본다.
- 기본 선택: "새 영상"(기준점 이후, 원장에 없음)은 체크한다. "이전 영상"은 "이전 영상도"를 골랐을 때만 보이고 체크 해제다. `fileExists`는 체크 해제 + 보조 줄 "같은 이름 파일이 있어요 · 받으면 번호를 붙여 저장해요".
- 30개를 넘게 고르면 [받기]를 `aria-disabled`로 두고 사유를 인라인 Notice로 잇는다(`patterns.md` §6.4 "비활성 버튼은 사유가 있으면 보인다(`aria-disabled` + `aria-describedby`로 이유 문장 연결").
- [받기]를 누르면 바닥 줄이 진행 표시로 바뀐다: "받을 준비 중 3/12" + ProgressBar(퍼센트 늘 보임, `patterns.md` §3.1 P-2) + **[취소]**. 초안의 [멈추기]는 금지어다(`content.md` §4 "사용자가 멈춘 상태 … 멈춤, 멈추기, 중단, 정지"). 불러오기 취소의 선례 [취소](`patterns.md` §14.2 (b))를 따른다. 이 [취소]는 아직 넣지 않은 항목만 버리고 넣은 작업은 두므로 확인 창이 없다(`content.md` §4 "[취소](대기 중, 즉시)"와 같은 즉시형). 끝나면 **홈으로 돌아가고** 새 작업은 목록 맨 위 강조(`HIGHLIGHT_MS`, `app/src/lib/timing.ts:11`)를 받는다. 결과 요약은 일부 실패가 있을 때만 토스트 한 번이다(`backup.result.partial`, [자세히]).
- **[받지 않기].** 초안의 [⋯] 메뉴는 항목이 "받지 않기" 하나뿐이었는데, 항목이 1개뿐인 메뉴는 만들지 않고 글자 버튼으로 둔다(`components.md` §2.9 접근성 "항목이 1개뿐인 메뉴는 만들지 않고 글자 버튼으로 둔다"). 그래서 행 둘째 줄 끝 ghost 24 [받지 않기]다. 늘 보이므로 숨겨진 동작이 아니고, ghost라 튀지 않는다.
  - 누르면 즉시 원장 `userExcluded`로 남기고 행이 "이미 받았거나 받지 않기로 함" 묶음으로 옮겨 간다(`role="status"` 한 줄 알림).
  - 되돌리는 길은 토스트 [되돌리기]가 아니다. "되돌리기"는 목록 지우기 토스트의 버튼에만 쓰는 말이다(`content.md` §4 "방금 한 일을 무르기 | **되돌리기**(목록 지우기 토스트의 버튼에만)", W1). 대신 그 묶음 안 행의 ghost [다시 보이기]가 짝이다. 즉시 실행 + 같은 화면 안의 짝 동작이므로 확인하지 않는다(`patterns.md` §4 "되돌릴 수 있으면 확인하지 않고 즉시 실행한 뒤 되돌리기를 준다"의 뜻). "다시 보이기"는 용어집에 없는 새 말이라 **[잠정]**이고 용어집 행을 더한다(§6.7).
- 빈 결과: EmptyState "새 영상이 없어요" + caption "마지막 확인 방금".
- **로딩은 `patterns.md` §2.1 기본값(목록은 행 모양 스켈레톤)을 따른다.** 초안은 §17-2를 들어 스켈레톤을 쓰지 않았지만 §17-2는 "불러오기 중 스켈레톤 **카드**"에 대한 판단(단일 모듈)이고 이 뷰는 목록이다(근거 확인 E11). 그래서 `LOADER_DELAY_MS`(300, `timing.ts:5`) 뒤 행 모양 스켈레톤 3개(홈 다운로드 목록 선례, `patterns.md` §2.3), 1초가 넘으면 그 위에 "새 영상을 찾는 중 · {count}" 한 줄 + [취소](`patterns.md:153` "1초 넘음 … 반드시 보인다").
  - **10초 넘음 행(`patterns.md:154` "퍼센트·남은 시간·[취소]")을 어떻게 옮기나(2차 개정).** 여러 페이지를 돌므로 10초를 넘는다고 보고 이 행을 따른다. [취소]는 처음부터 둔다. **진행은 지금까지 읽은 항목 수 `{count}`로 보인다**(페이지마다 늘어나는 확정 수치). 퍼센트·남은 시간은 **빼고 그 이유를 적는다**: 전체 항목 수·페이지 수를 첫 응답에서 알 수 있는지 모르고(**실측 필요**, §15 질문 1 "총 개수"·질문 2 "페이지 방식"), 조기 종료 없이 마지막 페이지나 페이지 상한까지 도는데(§3.1) 그 상한(`MAX_LIST_PAGES` 50)을 분모로 쓰면 대부분 그보다 일찍 끝나 퍼센트가 거짓 진행이 된다(**판단**). 질문 1이 "응답에 총 개수가 있다"고 답하면 ProgressBar(퍼센트, `patterns.md` §3.1 P-2)를 더하고 남은 시간은 `LIST_PAGE_GAP` × 남은 페이지로 셀 수 있을 때만 보인다(③-6에서 결정, 테스트 둘).
  - 이 줄은 `role="status"`(진행 문구라 말줄임·마침표 없음, `README.md:179` D45).
- 720 폭: 종류 배지는 제목 뒤 같은 줄, 메타와 [받지 않기]는 둘째 줄. 저장 폴더·여유 공간은 두 줄로 나눈다. 가로 스크롤은 없다(`patterns.md` §14.1 "가로 스크롤 | 어디에도 없다").
- 단축키 `⌘↩`/`Ctrl+Enter`는 지금 카드 전용이다(`patterns.md:441`). 이 뷰에 넓히려면 §8 키 표에 "내 채널 뷰 | 받기 | IME 가드 뒤" 행을 더한다(근거 확인 E23).

### 6.3 첫 확인(기준점 정하기)
- 처음 [새 영상 찾기]를 누르면 목록을 불러온 직후 **기준점 = 지금**으로 정한다(§0 기본, 가정). 뷰 맨 위에 인라인 안내 한 장(Notice inline neutral)을 이번 방문 동안 둔다. 대화상자는 쓰지 않는다. 되돌릴 수 있고 지금 답해야 하는 질문이 아니기 때문이다(`patterns.md` §1.1 "5 | 대화상자 | 되돌릴 수 없는 결정, 지금 답해야 하는 질문").
  - `backup.baseline.title` "지금부터 올라오는 영상을 새 영상으로 볼게요"
  - `backup.baseline.body` "‘이전 영상도’를 고르면 이미 올라와 있는 영상도 볼 수 있어요: {count}." (2차 개정: 1차 문구는 `{count}` 바로 뒤에 "은"이 붙어 변수 뒤 조사 규칙(`content.md:273`, `design-copy` DC3 `design/copy/terms.json:639`)에 걸렸고, 곧은 작은따옴표 `'`가 DC5 `terms.json:664` "D45 따옴표는 ‘’만"에 걸렸다. 콜론 후치(`content.md:274` 재구성 패턴 ②)와 U+2018/2019로 고쳤다. Notice 본문이라 마침표를 둔다, D45 `README.md:179`)
  - 초안의 [알겠어요] 버튼은 뺐다. 안내 바로 아래 "이전 영상도" 라디오가 실제 동작이고, 새 버튼 라벨(용어집에 없는 말)을 늘리지 않는다.
- 기준점은 설정 뷰 "내 채널" 섹션의 [기준 다시 정하기…]로 바꿀 수 있다. 원장의 기준점을 지우는 결정이라 대화상자로 묻는다.

### 6.4 설정 뷰 "내 채널" 섹션(SettingsRow)
| 행 | 컨트롤 | 문구(라벨은 `-기` 명사구, `content.md` §5.1) | 단계 |
|---|---|---|---|
| 자동 확인 | Switch | "앱이 켜져 있는 동안 새 영상 찾기" + 보조 "{interval}마다 찾아봐요. 새 영상이 있으면 홈에 알려 드려요." | (나) |
| 간격 | Select | "확인 간격" 1·3·6·12·24시간 | (나) |
| 자동 받기 | Switch(자동 확인이 꺼져 있으면 `aria-disabled` + 사유) | "새 영상을 찾으면 바로 받기" + 보조 "한 번에 {max}까지 받아요." | (나) |
| 화질 | Select | "모아 받을 때 화질" | (가) |
| 기준 | ghost [기준 다시 정하기…] | "새 영상의 기준: {date}부터" | (가) |
| 받은 기록 | ghost [받은 기록 지우기…] | 확인 대화상자. "파일은 그대로 있어요." | (가) |

### 6.5 신규 컴포넌트·수치 등록
- **Checkbox.** `components.md` §2에 Checkbox가 없다(마지막 §2.28 Toolbar, `components.md:609`). 크기 토큰만 있다(`foundations.md:436` `--control-h-sm` 24 "체크박스 상자", `:451` `--radio-size` 16 "AppKit regular 라디오·체크박스 16"). 후보를 여럿 고르는 목록에는 Checkbox가 맞다. Switch는 "즉시 켜짐" 의미라 고르기에 맞지 않고 RadioGroup은 단일 선택이다.
  - **ADR 번호는 "0026 이후, 머지 순"**이다. 0022~0024는 이미 쓰였고(`adr/0022-dock-progress-aggregation.md` 등, 근거 확인 E16), **0025는 v0.7.0에서 생방송 녹화가 가져갔다**(`docs/design/system/adr/0025-live-recording.md`, `docs/design/system/README.md:313`). ①이 주장한 0025(`delegation.md:699`)도 같은 이유로 다시 매겨야 한다(① 문서의 일). 새 결정 D 번호는 D64 이후다(D63은 생방송 녹화, `README.md:212`). core.md '구현 중 변경'은 61 이후(58~60이 생방송 녹화, `core.md:805`·`:817`·`:829`)다.
  - 내용: 근거 등급 E0(HIG·WCAG 체크박스), `components.md` §2.29 Checkbox(꺼짐·켜짐·혼합(그룹 머리 [모두 선택]용)·`aria-disabled`+사유·focus·forced-colors 행), `design-gallery` 상태, `design-icons`(체크 표시 아이콘 허용 목록), `frontend` 단위 테스트(접근 이름 필수, Space 토글, 혼합 `aria-checked="mixed"`).
  - 네이티브 `<input type="checkbox">` 위에 토큰 스타일만 입힌다(`README.md:17` P1 "OS의 일부처럼").
- **출처 없는 수치 묶음.** ADR-0009는 "바꿀 때는 이 ADR을 고치지 않고 새 ADR을 쓴다"(`adr/0009-unsourced-numbers.md` 결정 절)이므로, 이 기능의 수치(`LIST_MAX_BYTES` 1 MiB · `MAX_LIST_PAGES` 50 · `LIST_PAGE_GAP` 500ms · `RESOLVE_GAP` 700ms · `BACKUP_ENQUEUE_MAX` 30 · 간격 하한 60분과 선택지 · 백오프 ×2/24시간 · `BACKUP_FIRST_DELAY` 10분 · `LIST_CIRCUIT_FAILURES` 3)는 **새 ADR 한 장(번호 머지 순)**에 [잠정]으로 등록하고 각 값의 확인 방법(질문 1·6, D62 ③ 시험)을 적는다. 상수는 `crates/shell/src/consts.rs`에 두고 foundations §14 상수 표에 행을 더한다(`scripts/design/check-tokens.test.mjs`가 표와 `consts.rs`를 대조한다). ④·⑤의 같은 성격 수치와 한 장으로 묶을지는 먼저 머지되는 쪽이 정한다.

### 6.6 알림(`patterns.md` §1.2 사건 → 수단 표에 더할 행, R7)
| 사건 | 수단 | 톤 | 비고 |
|---|---|---|---|
| 수동 확인 결과 | 뷰 안 요약 줄 | neutral | 토스트로 되풀이하지 않는다(§1.1 규칙 1) |
| 주기 확인에서 새 영상 발견 (나) | **배너 B6** `backup.banner.found` [보기] [×] | neutral | [×]는 이번 실행 동안 숨김(B1·B4와 같다, `patterns.md:110`). n이 늘면 다시 보인다. [보기]의 짝은 홈 섹션 [새 영상 찾기]다(`patterns.md` §1.1 규칙 4 "알림 안의 동작은 같은 일을 다른 곳에서도 할 수 있다"). 홈 섹션 요약 줄이 함께 바뀌는 것은 같은 사건의 상태 표시라 중복이 아니다 |
| 자동 받기로 넣음 (나) | 작업 행(1차) + 배너 B6 문구 `backup.banner.started` | neutral | 완료는 기존 완료 규칙(창 비활성이면 OS 알림)을 따른다(§1.1 규칙 1) |
| 주기 확인 실패·서킷 열림 | 홈 섹션 요약 줄 `backup.home.failed`만 | neutral | 배너를 쓰지 않는다. 사용자가 시작한 일이 아니고 다른 받기에 영향이 없다 |
| 여유 공간 부족 예상 | 뷰 안 인라인 warning `lowSpace` | warning | [받기]를 막지 않는다(`platform.md:419`) |
- 배너 B6의 우선순위(`patterns.md:109` §1.4 표): ⑥ B1 받다 만 영상 **다음**, ⑦ B4 새 버전 **앞**. 해결해야 할 상태가 아니라 정보이므로 B1보다 뒤에 둔다(이 순서는 이 문서의 판단이다, 근거 확인 E13). 배너 번호 B6이 빈 번호인지는 ⑤가 배너를 더하는지와 함께 머지 순으로 확인한다(지금 쓰인 번호는 B1·B2·B4·B5, B3 없음 `patterns.md:63`).
- **OS 알림은 새 사건으로 넓히지 않는다.** 창이 닫혀 있으면 앱도 없으므로(트레이 없음) 새 영상 발견 OS 알림은 (다)와 함께 정한다.

### 6.7 copy deck 초안(`app/src/lib/copy/ko.ts`, `backup.*`)
숫자와 단위(`{count}`는 "2개", 시간·크기)는 format 함수로만 만들고, **변수 바로 뒤에 조사를 두지 않는다**(`content.md` §8 "변수 뒤 조사 금지"). 초안의 `{count}를`·`{ok}개를`(변수 뒤 조사, 변수 뒤 손 단위)은 고쳤다(근거 확인 E20).

| 키 | 문구 |
|---|---|
| `backup.section.title` | 내 채널 |
| `backup.action.check` | 새 영상 찾기(홈 섹션·뷰 요약 줄 공용, §6.1) |
| `backup.home.intro` | 내 채널에 새로 올라온 영상을 한 번에 받을 수 있어요 |
| `backup.home.last` | 마지막 확인 {relativeTime} · 새 영상 {count} |
| `backup.home.none` | 마지막 확인 {relativeTime} · 새 영상 없음 |
| `backup.home.failed` | 확인하지 못했어요 · {relativeTime} |
| `backup.view.title` | 내 채널 |
| `backup.loading` | 새 영상을 찾는 중 · {count} |
| `backup.filter.newOnly` / `.includeOlder` | 새 영상만 / 이전 영상도 |
| `backup.group.new` / `.older` / `.have` / `.cannot` | 새 영상 {count} / 이전 영상 {count} / 이미 받았거나 받지 않기로 함 {count} / 받을 수 없음 {count} |
| `backup.item.fileExists` | 같은 이름 파일이 있어요 · 받으면 번호를 붙여 저장해요 |
| `backup.item.needsCookie` | 네이버 로그인 정보가 있어야 받을 수 있어요 |
| `backup.item.encrypted` | 보호된 영상이라 받을 수 없어요 |
| `backup.item.failedBefore` | 지난번에 받지 못했어요 |
| `backup.item.exclude` / `.include` | 받지 않기 / 다시 보이기 [잠정] |
| `backup.limit` | 한 번에 {max}까지 받을 수 있어요 |
| `backup.preparing` | 받을 준비 중 {done}/{total} |
| `backup.result.partial` | 다운로드 목록에 넣었어요: {ok} · 넣지 못했어요: {fail} |
| `backup.empty.title` | 새 영상이 없어요 |
| `backup.truncated` | 일부만 불러왔어요: {count} ([잠정]. 정렬이 보장이 아니므로 "최근"이라 하지 않는다, §3.1. 상태 줄이라 마침표 없음) |
| `backup.baseline.title` / `.body` | §6.3 |
| `backup.banner.found` | 내 채널에 새 영상이 있어요: {count}. |
| `backup.banner.started` | 새 영상을 받기 시작했어요: {count}. |
| `backup.error.rateLimited` | 치지직이 잠시 요청을 막았어요. 잠시 뒤 다시 시도해 주세요. (429 수동, §8. 인라인 오류 본문이라 마침표, `잠시 뒤` 표기 `content.md:67`) |
| `settings.backup.autoCheck` | 앱이 켜져 있는 동안 새 영상 찾기 |
| `settings.backup.autoEnqueue` | 새 영상을 찾으면 바로 받기 |
| `dialog.backup.resetLedger.*` | 제목 "받은 기록을 지울까요?" 본문 "앱이 기억하는 받은 영상 목록만 지워요. 파일은 그대로 있어요." 버튼 [닫기] · [지우기](왼쪽 빨간 글자, `README.md:19` P3·`:50` D36) |
| (공용) `lowSpace` | content.md 오류 문구 8종에 먼저 더한다(§4.4). 문구 [잠정] |

- **구두점(2차 개정, D45 `README.md:179`).** 토스트·상태 줄·그룹 머리·버튼은 마침표가 없고 배너·Notice 본문·오류 본문은 있다. 그래서 토스트 `backup.result.partial`은 두 문장을 " · " 구분자로 이은 한 줄로 바꾸고 마침표를 뺐다(기존 토스트 `toast.removed` "목록에서 지웠어요", `content.md:472`). 1차 문구 "{ok} 넣었어요. {fail} 넣지 못했어요."는 토스트 마침표 규칙에 어긋났다. 반대로 배너 B6 두 문구에는 마침표를 더했다. 숫자는 모두 콜론 뒤에 둬 변수 뒤 조사가 생기지 않게 했다(`content.md:274` ②).
- `{ok}`·`{fail}`·`{count}`·`{max}`는 "10개"처럼 단위를 붙여 주는 format 결과다. `backup.result.partial`의 "다운로드 목록"은 용어집의 명사 "다운로드 목록"이다(`content.md` §4 "받는 작업·목록·화면 | 명사 다운로드 … '다운로드 목록'", 초안의 "목록에 넣었어요"는 범위가 모호했다).
- "보호된 영상이라 받을 수 없어요"는 기존 `errors.ts` encrypted 문구와 같다(`app/src/lib/copy/errors.ts:316-318`).
- **용어집에 더할 행**(`content.md` §4). 모두 새 용어 결정이라 **가정**이고 사용자 확인 대상이다(근거 확인 E25):
  - "자기 채널" → **내 채널**(기존 `list.empty.scope` "내 채널의 영상과 클립을 받을 수 있어요", `ko.ts:88`와 같은 말)
  - "새로 올라온 영상을 찾아보는 일" → **새 영상 찾기**(버튼은 동사 어간 + `기` 기본형, `content.md:141`. "확인"은 굳은 한자어 허용 목록 `:142`에 없어 라벨로 쓰지 않는다, §6.1)
  - "원장" → **받은 기록**
  - "후보에서 영구히 빼기 / 되살리기" → **받지 않기 / 다시 보이기** [잠정]
  - 쓰지 않는 말: 백업, 동기화, 구독(이 뜻으로), 일괄 다운로드. v0.7.0이 더한 말 "생방송"(종류 배지)·"녹화"(금지: 중지·끝내기)는 ③의 문구에 쓰지 않는다(`content.md:96-97`, `design/copy/terms.json`). `design-copy`가 `backup.*`에 새 금지어가 걸리는지 본다. "백업"을 빼는 이유는 비기술자에게 "원본이 사라질 때 대비"라는 약속처럼 들린다는 **판단**이다(보관 기간을 단정하지 않는다는 §1.2와 맞춘 것, 사용자 조사 근거는 없다).

---

## 7. 상태 선언(`patterns.md` §2.3 화면별 상태 표에 더할 행)

초안 §7은 idle·ready·preparing을 넣고 success·stale을 빼서 상태 6종(`patterns.md` §2.1: empty·loading·partial·error·success·stale) 정의와 달랐다(근거 확인 E14). §2.3 표의 행 모양으로 다시 쓴다. 기준점 없음·고르는 중은 상태가 아니라 정상 화면이고, 준비 중(enqueue 루프)은 [받기] 동작의 loading이다.

| 화면·영역 | empty | loading | partial | error | success | stale |
|---|---|---|---|---|---|---|
| 홈 · 내 채널 섹션 | 첫 확인 전 `backup.home.intro` | 확인 중에는 [새 영상 찾기]가 `loading`(폭 유지). 준비 중이면 요약 줄 `backup.preparing` | — | `backup.home.failed`(배너 없음) | 요약 줄 갱신(토스트 없음) | "마지막 확인 {relativeTime}"(§2.1 stale 정의 그대로) |
| 내 채널 뷰 · 목록 | EmptyState `backup.empty.title` + "마지막 확인 방금" | `LOADER_DELAY_MS` 뒤 행 모양 스켈레톤 3개, 1초 뒤 `backup.loading`(읽은 항목 수, 페이지마다 갱신) + [취소]. 퍼센트·남은 시간은 총 개수를 알 때만(§6.2, 질문 1) | 페이지 상한·서킷으로 끊김: 받은 목록 그대로 + 인라인 neutral `backup.truncated` "일부만 불러왔어요: {count}" | 인라인 danger + [새 영상 찾기]. 원인 문구는 기존 `errorCopy`(Network·Http·Api·AuthRequired·Parse) | — | 뷰를 다시 열면 지난 결과를 먼저 보이고 "마지막 확인 {relativeTime}", [새 영상 찾기] |
| 내 채널 뷰 · 받기 | — | 바닥 줄 `backup.preparing` + ProgressBar + [취소]. 뷰 밖으로 나가도 계속하고 홈 섹션 요약 줄에 같은 문구 | 일부 실패: 홈 복귀 + 토스트 `backup.result.partial` [자세히] 한 번 | 전부 실패: 바닥 줄 위 인라인 danger | 홈 복귀 + 새 행 `HIGHLIGHT_MS` 강조(토스트 없음, §1.1 규칙 1) | — |

---

## 8. 오류 종류
| 상황 | 코어 | 셸 `AppError` | 화면 |
|---|---|---|---|
| 목록 연결 실패 | `Network` | 기존 `network` | 인라인 + [새 영상 찾기] |
| 401·403 | `AuthRequired`(`client.rs:216-217`) | 기존 `authRequired`(`crates/shell/src/error.rs:78`) | 인라인. 쿠키가 꺼져 있으면 "네이버 로그인 정보" 안내(기존 errorCopy). 초안 표에 빠졌던 행(근거 확인 C4) |
| 그 밖 4xx·5xx | `HttpStatus` | 기존 `http` + payload status | 같음 |
| 429 | `HttpStatus`(429) | 새 code 없이 기존 `http` + payload status(`shell error.rs:186-187`) | 수동: `backup.error.rateLimited`("… 잠시 뒤 다시 시도해 주세요.", 1차의 "잠시 뒤에"는 `content.md:67`·DC1 `terms.json:614` `잠시 (?:뒤에|후)` 위반이라 고쳤다. "다시 시도"는 허용 목록 `content.md:143`의 짝 문형). 기존 `errorCopy`의 http 문구로 충분한지는 ③-6에서 보고, 충분하면 이 키를 만들지 않는다. 자동: 서킷(§4.5) |
| 형식 바뀜 | `Parse` | 기존 `parse` | 인라인. 자동은 같은 경로 연속 3회면 서킷(§4.5, 새 규칙) |
| 로그인 아님 | — | `notLoggedIn` | 로그인 화면(기존) |
| 남의 영상 섞임 | — | `notOwnContent`(enqueue 단계) | 건별 실패 → 결과 토스트 [자세히] |
| 암호화 | `Encrypted` | 기존 | 원장 `encrypted`, "받을 수 없음" 묶음 |
| 같은 이름 파일이 받는 중 생김 | — (`Skipped`) | — | 기존 작업 행 "건너뜀" 상태. 원장에 쓰지 않음 |
| 디스크 부족(받는 중) | `DiskFull` | 기존 | 기존 작업 행 실패 |
| 원장 쓰기 실패 | `Io` | 기존 `io` | 받기를 막지 않는다. 다음 확인 때 중복 후보가 생길 수 있음을 `warn` 로그로 남긴다(같은 이름 파일은 `skip`이 보호하므로 덮어쓰기는 생기지 않는다) |
- **새 `ErrorKind`·`ErrorCode`를 만들지 않는다**(`error.rs:100-123`에 필요한 종류가 모두 있다). 바꾸면 bindings·`errorCopy` 전수 테스트·가짜 백엔드가 함께 흔들린다.

---

## 9. 비밀값 규칙
- 목록 요청에 붙는 쿠키(`NID_AUT`/`NID_SES`)는 기존 `ClientConfig.cookies` 경로만 탄다. 사용자가 켰을 때 API 요청에만 붙고(`http.rs:18-24` `Api`/`Mpd`/`Media`), 목록은 미디어 CDN 요청이 아니다.
- 목록 응답에 서명 URL이 있는지는 **가정**(없을 것으로 본다, 근거 확인 A10)이다. 그래서 목록 파서는 썸네일·재생 주소 같은 URL 필드를 **타입에 담지 않는다**. 필요한 필드만 뽑는다. 있든 없든 새지 않는다.
- 로그·오류에 목록 요청 URL을 남기면 `http::redact_url`을 거친다. 채널 ID·영상 번호·제목은 로그에 남기지 않는다. 건수와 상태만 남긴다(예: "목록 2페이지, 새 영상 3").
- `PageCursor::Opaque`·원장 경로는 `Debug`를 손으로 구현해 원문을 숨긴다.
- 원장 파일은 실제 영상 번호를 담는 사용자 데이터다. 로그에 경로는 남기되 내용은 남기지 않는다. 진단 묶음에도 넣지 않는다.
- 실측 도구 출력은 된다/안 된다와 숫자(개수·페이지 크기)뿐이다. ID·제목·URL은 출력하지 않는다(`channel-id-check.mjs`의 "같다/다르다" 선례, `ROADMAP.md:160`).

## 10. OS별 분기
- 디스크 여유: macOS `volumeAvailableCapacityForImportantUsage` 우선, 없으면 `f_bavail`(`platform.md:415`). Linux `statvfs`, Windows `GetDiskFreeSpaceExW`(가정, §4.4). 네트워크 드라이브·외장 볼륨에서 `None`이면 "여유 공간 알 수 없음"으로 보이고 막지 않는다.
- 파일 이름: `fileExists` 판정은 `volume::platform_for_dir(기본 폴더)`로 고른 `naming::Platform` 규칙을 쓴다(`docs/design/core.md:804` 57 "파일 이름 규칙은 저장 폴더가 놓인 볼륨 기준이다"). Windows 예약어·길이 규칙 때문에 macOS에서 만든 이름과 다를 수 있다. 틀려도 `skip`이 마지막 보호다.
- 원장 원자적 쓰기: Windows rename 일시 잠금 재시도(`fsutil` 기존 로직).
- `skip`의 덮어쓰지 않는 rename은 코어 `rename_noclobber_with_retry`가 OS별로 이미 처리한다(`part.rs:392`). 경쟁 테스트는 3 OS `rust` 작업에서 돈다.
- 잠자기: 주기 확인 타이머는 OS 잠자기 중에는 돌지 않는다. 깨어나면 `lastCheckedAt + 간격`이 지났는지 보고 한 번만 확인한다. 밀린 횟수만큼 몰아서 돌지 않는다.
- 단축키: 뷰의 [받기]는 홈 카드와 같은 `⌘↩`/`Ctrl+Enter`(`platform.md:170-171` 표기 표, §6.2 키 표 행 추가).
- 트레이 OS 차이는 (다)의 문제이고 이번 범위 밖이다.

---

## 11. 단계 (다) 트레이 상주: 별도 결정으로 미루는 이유
- 창 닫기의 의미가 바뀐다(`close_decision`: 종료 → 숨김, `lib.rs:73`). D1 대화상자, `quit` command, 크래시 불변식과 맞물린다.
- 3 OS 실기 검증이 필요하다. Linux AppIndicator는 배포판마다 다르다(가정, 저장소 근거 없음).
- 자동 시작 플러그인과 capabilities가 늘어난다. Windows 설치기 크기 ratchet(`ci/ratchet.json:36` `"windows-setup": 5095510`)의 여유가 얼마인지는 저장소만으로 확인하지 못했다(근거 확인 D31, 가정). 미루는 근거 가운데 하나일 뿐이다.
- 다시 열 조건: (가)·(나)를 실제로 쓴 뒤 "앱을 켜 두지 않아서 놓쳤다"는 신호가 2회 이상 나올 때(판단, 근거 없음).

---

## 12. stacked PR 단계(조건부)

릴리스 단위: decisions.md Q4가 Q1 = 편집자까지일 때 "①만 먼저, 그 뒤 ③(가)·③(나)·⑤ 순으로 MINOR 하나씩"이다. ③은 (가)와 (나)를 각각 `feat` MINOR로 낸다(`docs/versioning.md:19`). `!`는 붙이지 않는다(새 파일·serde default, `versioning.md:31-33`의 셋 어디에도 들지 않는다).

| # | 커밋 타입 | 내용 | 전제 |
|---|---|---|---|
| 1 | `chore:` | **실측 도구** `worker/scripts/listing-check.mjs`. 사용자가 본인 VOD 주소 하나를 넣으면 기존 info 경로로 채널을 얻고 목록·클립 엔드포인트를 부른다. 출력은 질문별 된다/안 된다와 숫자뿐. `.dev.vars`·OAuth를 쓰지 않는다. 판정 함수는 `test/listing-check-lib.mjs`에 두고 합성 응답으로 단위 테스트한다(정렬은 "관찰 표본에서 내림차순 / 아님 / 판정 불가"와 표본 수(호출 횟수·항목 수)만 낸다. "보장"이라 부르지 않는다, N7). 결과는 ROADMAP에 "된다/안 된다"만 적는다 | 없음 |
| 2 | `feat:` | 코어 `listing` 파서 + `Chzzk::list_channel_*` + `url::content_url` + 합성 fixture(`testdata/listing/`, `gen-fixtures.mjs`). TDD. 페이지 상한·반복 감지·채널 불일치 버림·크기 상한·401/403 `AuthRequired` 테스트 | 1의 결과로 필드·페이지 방식 확정(정렬은 확정하지 않는다). 클립 목록이 없으면 VOD만으로 축소 |
| 3 | `feat:` | 셸 `BackupLedger`(원자적 쓰기, 깨짐 복구, 기준점 두 모양) + **매니저 `TerminalObserver`**(sink와 별개, `finish`에서 호출) + `volume::available_bytes` + `LOW_SPACE_FACTOR` 규칙 함수 | 2 |
| 4 | `feat:` | 셸 `BackupService`(check·enqueue_selected·exclude·baseline·clear), `services::enqueue` 내부 함수(`record_recent`), **`onExisting: skip` + 경쟁 테스트**, `dto.rs:597` 주석 바로잡기, 계정 바뀜 결과 버림, command 7개·DTO·bindings, `command_names.rs`·capabilities·`tests/ipc.rs`, 가짜 백엔드 | 3 |
| 5 | `feat:` | 디자인 시스템: Checkbox ADR(0026 이후) + `components.md` §2.29·`ui.css`·갤러리·테스트, 수치 묶음 ADR, foundations §14 상수 행, 용어집 행, `lowSpace` 문구, patterns §1.2·§1.4(B6)·§2.3(상태 행)·§8 키 표·§14.1 헤더 표·§14.2 (a) 그림 | 문서와 컴포넌트만(4와 병렬 가능) |
| 6 | `feat:` | 앱 "내 채널" 뷰·홈 섹션·설정 행(화질·기준·받은 기록), copy deck, e2e-web spec(가짜 백엔드), app.md 구현 중 변경(78 이후, 머지 순: §1.2 부분 뒤집기) | 4·5 |
| 7 | `feat:` | (나) `BackupScheduler`(간격 하한·백오프·목록 서킷·잠자기 복귀), 설정 행 셋, 배너 B6, 자동 받기 옵션 | 6을 실제로 쓴 뒤. 질문 6(연속 호출 한도) 결과로 수치를 다시 본다 |
| 8 | `feat:` | 맡은 채널 대상 고르기(§4.7): 대상 집합에 ①의 맡은 채널을 더하고, 1개 이상일 때만 뷰 머리 글자 Menu. D62 과업 추가 | ①-4 머지(Q6) |
| — | (보류) | (다) 트레이 | §11 |

- 각 PR 뒤 Codex 리뷰를 돌린다(글로벌 지침). 쓸 수 없으면 서브에이전트 리뷰 2종으로 대신한다.
- 모든 PR은 `scan`(공개 누출)을 통과해야 한다. fixture의 채널 ID는 `000…a1` 꼴의 합성 값이다.

## 13. 테스트 계획(TDD: 실패하는 테스트를 먼저 쓴다)
- **코어**(`listing`):
  - 합성 fixture로 고정: 정상 1페이지, 다음 페이지 있음, 마지막 페이지, 빈 목록, 필드 누락(선택 필드 None), 형식 깨짐 → `Parse`, 다른 채널 항목 섞임 → 버림, 커서 반복 → 멈춤, 상한 초과 응답 → 거부.
  - wiremock 통합 테스트: 페이지 순회, 401/403 → `AuthRequired`, 429 → `HttpStatus` 상태 보존, 쿠키가 꺼져 있으면 Cookie 헤더 없음, 켜져 있으면 API 요청에만 붙음.
  - `content_url` 왕복 속성 테스트.
  - fuzz target `listing` 추가는 선택이다(지금 4개 `fuzz/fuzz_targets/` → 5, nightly 시간 영향 검토).
- **셸**:
  - **같은 이름 파일 경쟁(Codex 높음) — 층을 나눈다(2차 개정).** 1차 개정은 바이트 보존·Overwrite로 깨기를 가짜 Backend로 하려 했지만, 가짜 Backend의 `download`(`crates/shell/tests/common/fake.rs:251-312`)는 `on_existing`을 보지 않고 대본(`script.end`)대로 결과를 돌려주므로 그 단언이 성립하지 않는다. 실제 보호는 코어 `download/mod.rs:274-275`(시작 전 `Skip`이면 네트워크 0회)과 `part.rs:386-392`(`finalize`의 덮어쓰지 않는 rename)에 있다.
    - **코어(실제 `Chzzk::download`, wiremock·임시 폴더)**: 시작 전 존재 → `Skipped`·바이트 그대로·요청 0회는 이미 있다(`crates/core/tests/download.rs:53` `duplicate_skip`). 받는 중 생김 → `Skipped`·바이트 그대로·`.part` 남음은 progressive에 이미 있다(`crates/core/tests/progressive.rs:774` `skip_does_not_clobber_file_created_while_downloading`). 번호 이름(`a (2).mp4`) 마무리는 단위 테스트가 있다(`crates/core/src/download/part.rs:820` `finalize_skip_does_not_clobber_file_created_meanwhile`). **새로 더하는 것**: segmented(HLS·DASH 조각) 경로의 "받는 중 생김" 테스트(`crates/core/tests/segmented.rs`에 `Skip` 테스트가 없다, 이번에 grep으로 확인). 보강(깨서 잡는지): 테스트의 요청을 `Overwrite`로 바꾸면 바이트 단언이 실패하는지 한 번 확인한다(`download.rs:74` `duplicate_overwrite`가 그 반대 경우를 이미 고정한다).
    - **셸(가짜 Backend)**: ③ 모아 받기가 만든 모든 요청의 `on_existing == Skip` 단언(`fake.rs:202` `download_requests()`로 받은 `DownloadRequest`를 본다). 보강: 구현이 `Overwrite`를 보내도록 바꾸면 이 단언이 실패하는지 확인한다. ④ 대본 끝을 `DownloadOutcome::Skipped`로 둔 작업 → 원장에 `downloaded`가 없다(§4.1 표). 셸 테스트는 바이트 보존을 단언하지 않는다(가짜가 파일을 쓰지 않는다).
  - 원장: 왕복, 모르는 필드 무시, 깨진 파일 → `.bad` 이동 + 기준점 재설정 상태, 동시 쓰기 직렬화, 기준점 두 모양(`at`·`seenIds`).
  - **`TerminalObserver`**: `ContentRef::Live` 작업은 `Completed`·`Failed{nothingRecorded}` 등 어떤 끝이든 원장 쓰기가 0건이다(가짜 Backend의 `until_stopped` 대본, `fake.rs:105`, `crates/shell/tests/manager_live.rs` 선례). 끝 상태 → 원장 대응표(§4.1) 전수(`StopReason::Remove`·이유 없음 → `Failed` → `failed` 행 포함, `manager.rs:1132-1135`). 웹뷰 sink를 `subscribe`로 바꾼 뒤·sink가 `false`를 돌려 비워진 뒤에도 원장이 갱신된다. 잠금 안에서 IO를 하지 않는다(관찰자가 채널에 넣기만 하는지, 막히는 가짜 쓰기 스레드로 `finish`가 막히지 않음). `channel_id == None`·다른 채널은 쓰지 않음. 주소 붙여넣기로 받은 본인 영상도 기록(U4).
  - 후보 계산 표 테스트: 원장 상태 × 파일 존재 × 활성 작업 × 쿠키 × 기준점(두 모양) → `state`·`defaultChecked` 전수.
  - **순회(N7 회귀)**: 정렬이 깨진 합성 응답(뒤 페이지에 기준점 이후 새 영상이 있다)에서도 기본 설정은 새 영상을 놓치지 않는다. 보강: 순회를 "기준점보다 오래된 항목에서 멈춤"으로 바꾸면 이 테스트가 실패하는지 확인한다. 같은 항목이 두 페이지에 나오면 한 번만 센다, 상한에서 끊기면 `truncated`, 커서 반복이면 멈춘다.
  - `enqueue_selected`: 가짜 Backend·Lister로 한 건씩 번갈아 도는지(호출 순서 기록), resolve가 `EncryptedVod`인 건 → 작업 없음 + 원장 `encrypted`(둘째 기록자), resolve가 `Network`인 건 → 원장 기록 없음, 30 상한, 중간 실패에도 계속, 취소하면 이미 넣은 것 유지, 최근 영상·`last_quality_label` 기록 없음, `best` = `default_quality(None)`, `OwnershipGate` 거부 건만 실패, `free_file_name == None`이면 넣지 않음. 보강: 순서를 일괄 resolve로 바꾸면 순서 테스트가 실패하는지 확인한다.
  - 계정 바뀜: 가짜 Lister를 지연시키고 그 사이 로그아웃·다른 계정 로그인 → 결과를 버리고 원장·화면이 바뀌지 않는다(`auth/service.rs:551` 패턴).
  - 스케줄러: tokio `pause`/`advance`로 간격 하한, 첫 지연, 백오프 2배·24시간 상한, 목록 서킷(연속 3회 `Parse`·429 한 번) 뒤 자동 정지·수동 허용, 잠자기 복귀 1회.
  - 여유 공간: `LOW_SPACE_FACTOR` 경계(필요량 = 여유 ± 1바이트), `.part` 크기 빼기, 어림 없음(`bandwidth`·길이 없음) → "약", `None` → 막지 않음, 셸 어림 함수와 프런트 `estimateSize`가 같은 골든을 지나는지(§4.4).
  - 비밀 누출: `BackupItemDto`·로그에 쿠키·URL 원문 없음, `PageCursor` Debug 마스킹.
  - `backup_enqueue`·`backup_exclude`에 `ContentRefTs::Live`가 오면 `invalidInput`이고 원장·큐에 아무것도 없다.
  - AuthGate: 새 command 7개가 `OPEN_COMMANDS`에 없고 로그아웃 상태면 `notLoggedIn`.
  - 로그인을 쓰지 않는 빌드: `Features`의 backup 플래그가 false.
- **앱**:
  - vitest: 기본 선택 규칙, 목록 로딩 줄이 페이지마다 `{count}`를 갱신하고 총 개수가 없으면 퍼센트를 보이지 않음(§6.2), 30 상한 `aria-disabled` + 사유 연결, 진행 → 홈 복귀, [받지 않기] → 묶음 이동 → [다시 보이기], B6 배너 우선순위 표, 상태 표(§7)의 각 칸 렌더, Checkbox 단위 테스트.
  - `design-copy`: `backup.*` 키가 금지어(멈추기·다시보기 단독·VOD 상위어·되돌리기 범위 밖)·변수 뒤 조사 규칙을 지난다.
  - e2e-web(mockIPC·axe): 첫 확인 기준점 안내 → 받기 → 홈 강조 흐름 하나.
  - design-gallery: 내 채널 뷰 720×520·960×700, 다크·forced. [받기]가 뷰포트 안에 있는지 본다.
- **xtask·CI**: 실측 도구는 `scripts-test`에 판정 lib 테스트만 둔다(네트워크 없음).

## 14. 위험
| 위험 | 영향 | 대응 |
|---|---|---|
| 비공식 목록 API가 바뀌거나 사라짐 | 기능 전체가 멈춤 | 목록 서킷 + nightly `drift`에 목록 kind 추가 검토(본인 영상 secret 재사용, kind만 출력, `scripts/ci/gates.mjs:413`) |
| 클립 목록 경로 없음·커서 방식 | 클립 모아 받기 불가 | 단계 2를 VOD만으로 줄이고 클립은 "주소 붙여넣기" 안내 |
| 정렬은 관찰일 뿐 보장이 아님 | 매번 마지막 페이지나 상한까지 훑음 → 호출 수 증가(확인당 최대 100 요청 [잠정]) | 기본은 조기 종료 없음. 켜는 것은 별도 결정 E1(§3.1). 상한·간격은 질문 1·6으로 정한다 |
| 모아 받기 중 생방송 녹화 | 같은 대역폭·디스크를 나눠 쓴다. 녹화는 놓친 조각이 생길 수 있다 [가정] | 슬롯은 lane이 달라 겹치지 않는다(§4.2). 크기를 모르는 녹화는 `lowSpace` 합산에서 빼고 안내하지 않는다 [가정]. 병렬 수는 기존 설정 |
| 연속 호출 차단(IP) | 사용자의 일반 받기까지 막힘 | 페이지 간격·건 간격·간격 하한·백오프·429 즉시 서킷. 모두 [잠정], 질문 6 결과로 조정 |
| 비공개·구독자 전용이 목록에 안 나옴 | 받을 것을 빠뜨림 | "목록에 없는 영상은 주소로 받을 수 있어요" 도움말 한 줄 |
| 대량 큐잉으로 디스크 고갈 | 받기 실패, 다른 앱 영향 | 30 상한, `lowSpace` 경고, 자동 받기 기본 꺼짐, 자동 받기도 여유 부족이면 건너뜀 |
| 같은 이름 사용자 파일 | 사용자 파일 덮어씀 | **`skip` 고정**(§2.2). 덮어쓰기는 모아 받기에 없다 |
| 원장 유실·변조 | 중복 받기 또는 누락 | 파일 존재 겹, 깨짐 복구 시 기준점 재설정, 원장 내용은 소유 판정에 쓰지 않음(게이트는 늘 다시 판정) |
| 원장 갱신 누락(웹뷰 재구독·소실) | 받은 영상이 다시 "새 영상" | `TerminalObserver`가 sink와 별개(§4.1) |
| 기준점 오해("이전 영상이 사라졌다") | 신뢰 하락 | 첫 확인 안내 문구, "이전 영상도" 라디오를 늘 보이게 둠 |
| 네 번째 뷰로 인한 복잡도 | 비기술자가 길을 잃음 | 설정 뷰와 같은 뼈대, [←] 하나, 진입점 하나(홈 섹션) + 배너 [보기] |
| 편집자에게 "내 채널"이 비어 있음(Q1) | 가장 쓸 사람이 쓸 수 없음 | §4.7 자리를 지금 만들고 ①-4 뒤 PR 8로 넓힌다 |
| 큐 100개 완료 상한과 상호작용 | 모아 받기 기록이 목록에서 금방 밀려남 | 원장이 근거이므로 기능에는 문제없음. 완료 접힘(`COMPLETED_FOLD_AT` 11, `timing.ts:27`)으로 소음 억제 |

## 15. 사용자 실측 질문(단계 1 도구가 답한다)
1. 본인 채널 VOD 목록이 비로그인으로 조회되는가(근거 확인 A3·A7). 페이지 크기 상한과 총 개수(숫자만)는 얼마인가. **관찰한 표본에서 게시일 내림차순이었는가**(같은 요청 두 번의 순서가 같은지, 인접 항목의 게시일이 내림차순인지를 "내림차순 / 아님 / 판정 불가"와 표본 수(호출 횟수·항목 수)로만 낸다. 이 답은 정렬 보장의 근거가 아니고 조기 종료를 켜지 않는다, 열린 결정 E1)(근거 확인 A6, Codex 2회차 N7).
2. 채널 클립 목록이 있는가. 페이지 번호 방식인가 커서 방식인가(근거 확인 A5).
3. 목록 항목의 채널 ID가 info 채널 ID와 같은가. G-ID에 따라 info 채널 = users/me이므로 users/me와도 같다.
4. 비공개·구독자 전용·성인 VOD가 목록에 나오는가. 쿠키를 켰을 때만 나오는가(근거 확인 A8). 이 질문은 쿠키를 쓰므로 도구가 쿠키를 받지 않는 한 사용자가 앱의 개발 빌드에서 확인한다.
5. 목록 항목에 영상 번호·클립 ID, 게시일, 길이, 암호화 표시, 빠른 다시보기/일반 VOD 구분, **파일 이름 규칙이 쓰는 메타(채널 이름·날짜)** 필드가 있는가(있음/없음만, 근거 확인 A11·C11).
6. 짧은 간격으로 20회 호출하면 429나 차단이 생기는가(근거 확인 A9). 결과로 `LIST_PAGE_GAP`·`RESOLVE_GAP`·간격 하한을 다시 정한다.
   - 6-2(2차 개정, Codex Q10 "합산 부하를 측정한다"). **같은 호스트 합산 부하**: 목록 순회(`LIST_PAGE_GAP`) + 모아 받기 resolve 30건(`RESOLVE_GAP`) + ④ 채팅 요청(④의 잠정 간격)·(⑤의 방송 상태 조회가 생기면 그것도)을 같은 시간대에 겹쳐 돌렸을 때 429·차단이 생기는가(된다/안 된다와 첫 429까지의 요청 수만). ④의 요청 경로가 정해져야 하므로 ③-1 도구가 아니라 ④ 실측 도구가 생긴 뒤 둘을 함께 돌리거나 개발 빌드에서 사용자가 확인한다(**실측 필요**, 시점은 ③(나)·④ 중 늦게 머지되는 쪽 전).
7. 치지직에 VOD 자동 삭제(보관 기간)가 있는가. 사용자가 치지직 화면에서 직접 확인한다. 결과는 문구에 쓰지 않고 우선순위 판단에만 쓴다.
- (지움) 8. 작업 시작 때 resolve하는가 → 코드로 확인했다(§3.3).

---

## 개정 기록(2026-10-16)

> 아래 1·2차 기록의 줄 번호·번호(app.md 77, ADR 0025 등)는 **당시 `bff221d` 값**이다. 최신 값은 본문과 맨 끝 "3차"가 기준이다.

입력: Codex 1회차 적대적 리뷰(③ 관련 지적은 "자동 백업이 확인 이후 생긴 사용자 파일을 덮어쓴다"(높음), "정정된 결정표와 실제 실행 계획이 서로 다른 지시"(중간)의 `LedgerSink` 전제·버전 부분, 결정별 판정 Q9 "수정"·Q10 "유지"·Q5 "유지"), 근거 확인 표(확인 72 · 가정 14 · 실측 필요 7 · 인용 오류 12), 사용자 확정 Q1 = 편집자까지와 UX 기준 ①.

### 처리한 지적
| 출처 | 처리 | 근거 |
|---|---|---|
| Codex 높음 "늘 `overwrite` → 확인 이후 생긴 파일을 덮는다" | 모아 받기는 늘 `onExisting: skip`(번호 이름 포함). 덮어쓰기를 모아 받기에서 없앰. 경쟁 테스트 셋 + 바이트 보존 단언 + Overwrite로 깨서 잡히는지 확인(§2.2·§4.2·§4.3·§13). `dto.rs:588` 주석을 ③-4에서 바로잡는다 | `receive.ts:163`, `part.rs:348-361`, `download/mod.rs:9-14,266-267,349`, `patterns.md:399`(덮어쓰기 = D7) |
| 근거 확인 B12(확인 등급이었으나 Codex가 반박) | 주석 자체는 있지만 실제 호출 동작과 다르다는 점을 본문에 적음 | `receive.ts:163` |
| Codex 중간(계획 불일치)의 `LedgerSink` 전제 · 근거 확인 D6(인용 오류) | `LedgerSink` 폐기 → 매니저 `TerminalObserver`(sink와 별개, `finish`에서 채널에 넣기만). 끝 상태 → 원장 대응표, 기록 기준을 `JobId` 집합 대신 검증된 `channel_id`로(U4) | `dto.rs:765-779`, `events.rs:4`·`EventSink` 주석, `manager.rs:324-326,1028-1071`, `jobs.rs` `channel_id` 주석, decisions.md Q9 |
| Codex 중간 "버전은 versioning.md대로, `!` 금지" | §0·§12에 MINOR·`!` 없음·실제 번호는 머지 순 | `versioning.md:19,31-33`, decisions.md Q4 |
| 사용자 확정 Q1 = 편집자까지 | §4.7: v1 본인만(Q6) 유지, 대상 집합 seam·원장 채널별·0개면 UI 불변·①-4 뒤 PR 8 | decisions.md Q6, `delegation.md:80,316,346`(2차 개정에서 줄 바로잡음), `design-system.md:102` PS2 |
| UX 기준 ① | 진입점 하나(홈 섹션)로 줄임, 계정 Menu 항목·빈 상태 링크·종류 필터·[알겠어요] 제거 | §6 머리, `patterns.md` §1.1 규칙 4·§14.2 (a) |
| A3·A5·A7·A8·A9·A11(실측 필요) | §15 질문 1·2·4·5·6에 대응 ID를 붙이고 본문에서 단정하지 않음 | 근거 확인 A3~A11 |
| A6(실측 필요, 정렬) | 정렬을 가정하지 않고 상한까지 훑은 뒤 거름. 질문 1에 정렬 확인 추가. 조기 종료는 "된다"일 때만 | 근거 확인 A6, decisions.md Q9 "정렬 확인을 질문 1에 더한다" |
| A10(가정) | 가정으로 표시, URL 필드를 타입에 담지 않는 결정으로 영향 제거(§9) | 근거 확인 A10 |
| B6(가정) | 관리자 목록 범위 밖을 가정으로 표시(§1.2) | `app.md:1382` 74는 받기만 |
| B10(인용 오류) | 원문 "v1에서는 바꾸지 않는다 … 필요해지면 serde default"로 인용을 고침(§2.2) | `app.md:19` |
| B13(인용 오류, 초안 내부 모순) | "후보에 남기고 기본 체크 해제, 체크하면 번호 이름 + skip" 하나로 정함(§4.3) | `dto.rs:554` `free_file_name` |
| C4(인용 오류) | 401·403 = `AuthRequired` 행 추가(§3.1·§8·§13) | `client.rs:175,190-191`, `shell error.rs:76` |
| C11(가정) | `fileExists`를 안내용으로 내림(skip이 보호), 질문 5에 이름 메타 추가, 모자라면 resolve 뒤 `check_output`만 | `naming.rs:42` |
| C12(인용 오류) | `best` = `default_quality(None)`로 명시 | `model.rs:157-161` |
| C16·D21(가정, 수치) | 1 MiB·50·500ms·700ms·30·60분·선택지·백오프에 [잠정] 표기, 새 수치 ADR + foundations §14 행 + `consts.rs`(§6.5) | `adr/0009-unsourced-numbers.md`("새 ADR을 쓴다"), `check-tokens.test.mjs` |
| C17(가정) | 방어 설계임을 표시, 질문 3에 대응 | 근거 확인 C17 |
| D10(가정, 부작용) | `last_quality_label`도 기록하지 않는 것을 의도로 명시, `record_recent` 내부 함수 | `services.rs:476-480,594` |
| D14(가정) | macOS는 `platform.md:415`의 API로 근거 확보, Linux·Windows는 가정으로 남김 | `platform.md:415` |
| D15(인용 오류) | ~~`size_estimate` → `total_bytes_estimate`~~ → 2차 개정에서 다시 고침: 받기 전 어림은 `QualityDto.bandwidth` × 길이 / 8 | `dto.rs:497`, `bytes.ts:9-11`, `receive.ts:85`(2차 개정 표) |
| D16(가정, 90%) | 90% 폐기 → 기존 `LOW_SPACE_FACTOR` 1.05 규칙·`lowSpace` 문구 | `platform.md:415,419`, `consts.rs:25` |
| D20(가정, 10분) | ~~"업데이트 확인과 겹치지 않게" 이유를 뺌~~ → 2차 개정: 이유는 근거가 있어 되살리고 값만 [잠정] | `lib.rs:178-181`, `app.rs:457`(2차 개정 표) |
| D22(확인이나 주의) · Codex Q10 | 목록 서킷을 §10.4 재사용이 아닌 새 규칙·새 상수로, 합산 예산은 v1 각자 상수 | `patterns.md:526`, `consts.rs:41`(참조 0건, decisions.md Q10) |
| D27(인용 오류) | `close_decision` 그대로, 닫으면 루프만 취소(D1 넓히지 않음) | `lib.rs:73`, `patterns.md` §1.1 5단 |
| D31(가정) | 크기 여유는 확인 못 함으로 표시 | `ci/ratchet.json:36` |
| E5(인용 오류) | 계정 Menu 항목 제거, §1.1 규칙 4는 B6 [보기]의 짝 근거로 옮김 | `patterns.md` §1.1 규칙 4 |
| E11(확인이나 주의) | 목록이므로 §2.1 기본 행 스켈레톤 채택 | `patterns.md` §2.1·§2.3 |
| E13(판단) | B6 순서가 이 문서의 판단임을 표시, B 번호 충돌 확인을 머지 순으로 | `patterns.md:63,109` |
| E14(인용 오류) | 상태 표를 §2.3 행 모양 6열로 다시 씀 | `patterns.md` §2.1 |
| E16(인용 오류) | Checkbox ADR "0026 이후, 머지 순" | `adr/0022~0024`, `delegation.md:699`(2차 개정에서 줄 바로잡음) |
| E18(인용 오류) | [멈추기] → [취소](즉시형) | `content.md` §4, `patterns.md` §14.2 (b) |
| E19(인용 오류) | 종류 필터 제거. 근거 표 제안 "VOD(…)"도 상위어 금지라 쓰지 않음 | `content.md` §4 "영상 상위어"·"종류(배지)" |
| E20(규칙 위반) | `{count}를`·`{ok}개를`·"30개" 손 숫자를 format 변수 + 조사 없는 문형으로 | `content.md` §8 |
| E23(주의) | §8 키 표에 행 추가를 PR 5에 넣음 | `patterns.md:441` |
| E25·E26·E27(가정) | 용어·기준점 기본·진입점을 가정/판단으로 표시, 빈 상태 링크 제거, D62 ③ 과업으로 확인 | 근거 확인 E25~E27 |
| 추가 발견: "되돌리기" 범위 | [받지 않기]의 토스트 [되돌리기]를 같은 화면 [다시 보이기] 짝으로 바꿈 | `content.md` §4 "되돌리기(목록 지우기 토스트의 버튼에만)" |
| 추가 발견: 1개 항목 메뉴 금지 | [⋯] 메뉴 → ghost [받지 않기] | `components.md` §2.9 접근성 |
| 추가 발견: 늦은 결과 | 계정 바뀜 결과 버림 + 테스트(Codex의 ① "늦게 도착한 조회" 지적과 같은 꼴을 ③에도 적용) | `auth/service.rs:513,551`, `ownership.rs:130-133` |
| 추가 발견: command 추가 절차 | `command_names.rs` 4곳 절차로 바로잡음(decisions.md Q8 (3)과 같은 정정) | `command_names.rs:2-3` |
| 추가 발견: app.md 번호 | "77 이후, 머지 순" | `app.md:1384`, plan.md 번호 원천 |

### 반박(반영하지 않은 것)
| 지적 | 반박 근거 |
|---|---|
| 근거 확인 D6의 대안 "팬아웃 sink" | sink가 `false`면 매니저가 구독자를 비우고(`events.rs` `EventSink` 주석), `subscribe`는 교체한다(`manager.rs:324-326`). 팬아웃이어도 웹뷰 다리가 사라질 때 함께 사라지는 구조라 원장 근거로 약하다. 끝 상태 관찰자 하나로 정했다 |
| 근거 확인 D27의 대안 "`close_decision` 입력을 넓혀 준비 중에도 D1" | 준비 중에 닫아 잃는 것은 아직 넣지 않은 선택뿐이고 원장에 흔적이 없어 다음 확인에서 그대로 다시 보인다. 되돌릴 수 있는 손실에 대화상자를 두지 않는다(`patterns.md` §1.1 5단). `close_decision` 표 테스트(`lib.rs:839-852`)를 건드리지 않는 가장 작은 선택이다 |
| 근거 확인 E19가 제안한 필터 라벨 "VOD(빠른 다시보기·일반 VOD) / 클립" | "VOD(상위어로)"가 쓰지 않는 말이다(`content.md` §4 "영상 상위어"). 필터 자체를 빼는 쪽이 규칙과 UX 기준 ① 둘 다에 맞다 |
| Codex Q9 판정 중 "원장 기록 선택과 기본 꺼짐은 유지할 수 있다" | 반박이 아니라 동의다. 기본 꺼짐·U4 기록은 그대로 두었다 |

### 남은 것(실측·사용자 결정)
- 실측(§15): 질문 1(비로그인·페이지 크기·**정렬**), 2(클립 목록·페이지 방식), 3(목록 채널 ID), 4(비공개·성인·쿠키, 사용자가 개발 빌드에서), 5(필드·이름 메타·종류 구분), 6(연속 호출 한도 → 모든 [잠정] 간격·하한), 7(보관 기간).
- [잠정] 수치 묶음 전부(§6.5) — 새 ADR 등록과 질문 1·6 결과로 다시 정한다.
- 사용자 결정: 첫 확인 기준점 기본 "지금부터"(E26), 용어 "내 채널·새 영상 찾기(+상태 줄 '마지막 확인'을 맞출지)·받은 기록·받지 않기/다시 보이기·백업 금지"(E25), 진입점을 홈 섹션 하나로 줄인 판단(E27), 종류 필터 제거.
- D62 ③ 시험(decisions.md Q11 "③은 (가) 사용 뒤"): 발견성("새로 올라온 내 영상을 모두 받아 보세요"), 기준점 오해, [받지 않기]/[다시 보이기] 이해. Codex D62 지적대로 한 회로 줄이면 축소 시험이라고 적는다(`README.md:211`, `governance.md` §6.1).
- Linux·Windows 여유 공간 API와 의존성(D14) — `supply` 검토.
- 번호 충돌(머지 순): app.md 구현 중 변경 77 이후, ADR 0026 이후(Checkbox·수치 묶음), 배너 B6.
- 다른 문서에 같은 정정이 필요하다(이 작업은 backup.md만 고쳤다): `decisions.md` Q9의 "③-3에서 매니저 끝 상태 훅 또는 팬아웃 sink를 고른다" → 끝 상태 관찰자로 확정, Q9에 `onExisting: skip` 추가(Codex Q9 "수정"), `plan.md`의 `LedgerSink` 전제·③ PR 표(③-3에 `TerminalObserver`, ③-4에 skip·경쟁 테스트, ③-8 추가)와 ADR 번호("0026+"를 Checkbox·수치 묶음 둘로).
- ①-4 머지 뒤 PR 8(§4.7)의 맡은 채널 목록 원천 이름·형태는 ①의 최종 계약(`delegation.md` §9.4, Codex가 수정 요구 중)에 따른다.

---

### 2차 개정(2026-10-16, 독립 확인에서 남은 문제 14건)

입력: 1차 개정본을 다시 대조한 독립 확인의 남은 문제 목록. 모든 줄 번호는 이번에 다시 열어 확인했다(master `bff221d`, 산출물 `delegation.md`는 지금 파일).

| # | 남은 문제 | 처리 | 근거(이번에 연 곳) |
|---|---|---|---|
| 1 | D15 "해소"가 새 인용 오류(`total_bytes_estimate`는 진행값) | §4.4: 받기 전 어림 = `QualityDto.bandwidth` × 길이 / 8. 셸에 같은 식 + 프런트와 같은 골든. check 단계는 합을 내지 않음. §13 골든 테스트 | `crates/shell/src/dto.rs:497`(bandwidth), `:708-715`(`ProgressDto`), `app/src/lib/format/bytes.ts:2,9-11`, `app/src/lib/receive.ts:84-86` |
| 2 | 경쟁 테스트가 가짜 Backend로는 성립 안 함 | §13을 두 층으로: 바이트 보존·Overwrite로 깨기는 코어 실제 `Chzzk::download`(기존 세 테스트 + segmented 새 테스트), 셸은 요청 모양 `on_existing == Skip`·`Skipped` → 원장 기록 없음만 | `crates/shell/tests/common/fake.rs:241-295`(`on_existing` 안 봄, `script.end`), `:192`, `crates/core/src/download/mod.rs:266-267`, `part.rs:355-361`, `crates/core/tests/download.rs:52,73`, `progressive.rs:773`, `part.rs:774` |
| 3 | E20 미해소: `{count}은`, 곧은 따옴표 | `backup.baseline.body`를 콜론 후치 + ‘’로 | `content.md:272-273`, `design/copy/terms.json:627`(DC3), `:652`(DC5) |
| 4 | "잠시 뒤에" 위반 | §8 429 수동 문구 → `backup.error.rateLimited` "잠시 뒤 다시 시도해 주세요." | `content.md:67`, `terms.json:602`(DC1) |
| 5 | 토스트 마침표 | `backup.result.partial` → "다운로드 목록에 넣었어요: {ok} · 넣지 못했어요: {fail}"(마침표 없음). 배너 B6 두 문구에는 반대로 마침표를 더함 | `README.md:179` D45(토스트 없음·배너 있음), `content.md:459` `toast.removed` |
| 6 | 원장 `encrypted` 기록 경로 없음(문서 안 모순) | §4.1에 둘째 기록자 `BackupService`(큐 전 resolve의 `EncryptedVod`만, 같은 쓰기 채널). §0·§4.2·§13 맞춤. 다른 resolve 실패는 쓰지 않음(판단) | `crates/core/src/client.rs:108,119-121` |
| 7 | D20 "근거 없음"이 틀린 서술 | §4.5: 시작 직후 세션 확인 → 업데이트 확인이 실제로 있음을 적고, 근거 없는 것은 10분 값뿐으로 정정 | `app/src-tauri/src/lib.rs:178-181`, `crates/shell/src/app.rs:457`, `update.rs:15` |
| 8 | delegation.md 줄 이동 | 맡은 채널 용어 `:80`, 0개면 행 없음 `:316`·`:346`, ADR-0025 `:699` | `delegation.md` 지금 파일 |
| 9 | PS1 줄 | `design-system.md:101`(PS2 인용 `:102`는 그대로) | `docs/research/design-system.md:101-102` |
| 10 | B10 위치 표기 | `app.md` §0 "N행" → 파일 줄 `app.md:16`(작업 저장)·`:17`(재시작 후)·`:19`(새 설정) | `docs/design/app.md:16,17,19` |
| 11 | [새 영상 확인]·[다시 확인] 라벨 근거 부족 | 허용 목록을 넓히지 않고 기본형 **[새 영상 찾기]** 하나로(홈·뷰 공용). [다시 불러오기]는 용어집 "불러오기" 뜻 밖이라 쓰지 않음(판단). 로딩 문구도 "새 영상을 찾는 중". 상태 줄 "마지막 확인"은 라벨이 아니라 두되 용어 확인 때 함께 묻는다 | `content.md:91,140-142`, `ko.ts:251`(선례로 쓰지 않음) |
| 12 | 10초 넘음 행에서 진행 표시 누락 | §6.2·§7: 읽은 항목 수 `{count}`를 진행으로 보이고, 퍼센트·남은 시간은 총 개수를 모르므로 뺀 이유를 적음(상한을 분모로 쓰면 거짓 진행). 질문 1이 총 개수를 주면 ProgressBar 추가 | `patterns.md:153-154`, §15 질문 1·2 |
| 13 | Codex Q10 "합산 부하 측정" 누락 | §4.5에 합산 측정 문장, §15 질문 6-2(목록 + resolve + ④ 채팅 겹쳐 돌리기) | Codex 1회차 적대적 리뷰 결정별 판정 |
| 14 | §4.1 대응표가 `End::Cancelled` + Remove/None → `Failed`와 어긋남 | 표에 행 추가(`failed`로 기록, 해 없음, 거르지 않음은 판단). 일시정지·종료 행은 `StopReason`으로 나눔. §13 전수 테스트에 포함 | `crates/shell/src/manager.rs:78-82`(`StopReason` 셋), `:1041-1053,1068-1071` |

#### 2차 개정에서 반박한 것
- 없음. 14건 모두 다시 열어 보니 지적이 맞아 반영했다. 다만 다음 둘은 해결 방식이 지적의 제안과 다르다.
  - 11번: 지적은 "허용 목록 추가나 다른 라벨 결정"을 요구했다. 허용 목록 추가(새 ADR·`terms.json`)보다 작은 쪽인 **다른 라벨**을 골랐다.
  - 14번: 지적은 "표에 행으로 적어야 한다"였다. 행을 적고, 그 경우를 원장에서 거르지는 않았다(`failed`는 다시 후보일 뿐이라 해가 없고, 거르려면 internal 오류를 가르는 새 판정이 든다).

#### 2차 개정 뒤에도 남은 것
- 라벨·용어: [새 영상 찾기]와 상태 줄 "마지막 확인"의 말 맞춤, `backup.error.rateLimited`를 따로 둘지(기존 `errorCopy` http로 충분한지)는 ③-6과 사용자 용어 확인(E25)에서.
- 목록 로딩의 퍼센트·남은 시간은 질문 1(총 개수) 결과에 달렸다.
- 질문 6-2(합산 부하)는 ④ 실측 경로가 생겨야 잴 수 있다.
- 시작 지연을 "첫 세션 확인·업데이트 확인이 끝난 뒤"에 묶을지는 ③-7에서.

---

### 3차 개정(2026-10-16, 최신 master 기준)

기준 트리: origin/master `df454c3`(v0.7.0). 이 문서의 이전 기준은 `bff221d`였고 그 사이에 다른 세션이 생방송 녹화를 넣었다(`git diff bff221d df454c3`: 145개 파일, core.md 구현 중 변경 58~60, app.md 77, ADR-0025, D63, `crates/core/src/download/{live,defrag}.rs`). 입력: Codex 2회차 N7(Codex 2회차 적대적 리뷰), 사용자 확정(Q1 = 본인 + 지인 스트리머 + 그들의 편집자, UX 기준 ①), 결정 표 `decisions.md`, 계획 `plan.md`.

#### N7 처리(정렬 관찰을 보장으로 올리지 않는다)
| 이전 서술 | 고친 서술 | 위치 | 근거 |
|---|---|---|---|
| 질문 1이 "최신순 정렬이 보장되는가"를 묻고 "된다"일 때만 조기 종료를 켠다 | 질문 1은 **"관찰한 표본에서 내림차순이었는가"**를 "내림차순 / 아님 / 판정 불가" + 표본 수로만 묻는다. 그 답은 동작을 바꾸지 않는다 | §3.1·§15 질문 1 | Codex N7: "결과명을 '관찰 표본에서 내림차순'으로 낮추십시오" |
| `check`가 정렬이 확인되면 기준점 이전에서 순회를 멈춘다 | `check`는 늘 마지막 페이지나 `MAX_LIST_PAGES`까지 훑는다. 기준점보다 오래된 항목을 만나도 멈추지 않는다. 상한에서 끊기면 `truncated` | §4.2 check 2 | N7: "상한까지 순회하는 기본을 유지" |
| 조기 종료는 실측 "된다" 뒤 | 조기 종료는 **별도 결정 E1**. 선택지 A(켜지 않음, v1 기본·추천) / B(안전장치와 함께) / C(안전장치 없이, 비추천), B를 다시 여는 조건 셋 | §3.1 E1 | N7: "조기 종료를 가정에 의존하는 최적화로 별도 결정해야 합니다" |
| 후보 계산 테스트에 "정렬 보장 여부" 축 | 축을 뺐다. 정렬이 깨진 합성 응답에서도 새 영상을 놓치지 않는 회귀 테스트와 "조기 종료로 바꾸면 실패하는지" 보강을 더했다 | §13 | TDD 보강 규칙 |
| 실측 도구 PR 1의 "정렬 판정", PR 2의 "정렬 확정" | 도구는 "관찰 표본에서 내림차순/아님/판정 불가"와 표본 수만 낸다. PR 2는 필드·페이지 방식만 확정한다 | §12 | |
| 상태 표의 "최근 {count}까지만 보여요" | `backup.truncated` "일부만 불러왔어요: {count}"([잠정]). 정렬 보장이 없으므로 "최근"이라 하지 않는다 | §6.7·§7 | 같은 이유 |
| 위험 표의 "정렬 보장 없음" | "정렬은 관찰일 뿐 보장이 아님": 확인당 최대 100 요청(산술, 전부 [잠정]) | §14·§4.5 | |

다른 문서에 같은 정정이 필요하다(이 작업은 backup.md만 고쳤다): `decisions.md` M-③-1("최신순 정렬 보장" → "관찰 표본에서 내림차순", 조기 종료 결정 E1 추가). `decisions.md` Q9의 "정렬 확인을 질문 1에 더한다"도 같은 문장으로 맞춘다.

#### 생방송(v0.7.0)·`LiveWatch` 서술을 현실에 맞춤
| 이전 서술 | 고친 서술 | 위치 | 근거(새 트리) |
|---|---|---|---|
| §1.2 "라이브 녹화"는 하지 않는다 | 생방송 녹화는 **이미 있다**(주소 붙여넣기, 수동). ③은 그 위에 감시·자동 녹화를 더하지 않는다. ③이 할 일은 `ContentRef::Live`가 원장·command·큐에 섞여도 깨지지 않게 하는 것뿐 | §0 표·§1.2 | `core.md:805`·`:817`·`:829`(58~60), `app.md:1386`(77), `adr/0025-live-recording.md`, `README.md:212`(D63) |
| (암묵) `LiveWatch`는 ③이 먼저 만든다 | `BackupScheduler`는 목록 주기 확인뿐이고 방송 상태 감시는 없다. `LiveWatch`는 ⑤가 만든다. 합산 부하(질문 6-2)에 방송 상태 조회를 더한다 | §4.5·§15 질문 6-2 | decisions.md C3. v0.7.0에는 방송 시작을 알아채는 감시가 없다(`app.md:1386` 수동 흐름) |
| `content_url`·왕복 테스트가 영상·클립 둘 | 셋(`Live` 포함). 목록 파서는 `Live`를 만들지 않는다 | §3.2 | `model.rs:19-29`, `url.rs:44` |
| 원장 관찰자가 모든 끝 상태를 대응표로 기록 | **`Live` 작업은 어떤 끝이든 쓰지 않는다.** 키 변환은 `Video`·`Clip`만 `Some`. 대응표는 영상·클립 작업만이고 `StopReason::Finish`는 생방송 전용 | §4.1 | `manager.rs:86-92`, `:1109-1153`, `dto.rs:781-795` |
| (없음) | `backup_enqueue`·`backup_exclude`가 `ContentRefTs::Live`를 `invalidInput`으로 거부하고 테스트를 둔다 | §4.6·§13 | `dto.rs:52-55`, `services.rs:574`(서비스는 Live를 받는다) |
| `recent_kind`가 항상 값을 돌려줌 | `Option`(생방송 `None`), 호출부 `if let Some(kind)`. `record_recent` 분기는 `Some` 안에서 가른다 | §4.2 | `services.rs:594-598`, `:604-612` |
| 동시 다운로드는 설정 한 가지 | 생방송은 별도 lane(`MAX_LIVE` 3). 모아 받기 30건과 서로 슬롯을 막지 않는다 | §4.2·§14 | `manager.rs:63`, `:976-983`, `:6-7` |
| 창 닫기 D1은 그대로 | D1 본문이 생방송 섞임에서 다른 문구가 되지만 판단 입력은 그대로라 결정과 충돌하지 않는다 | §5 | `lib.rs:73`, `CloseGuard.svelte` `hasLive` |
| 종류 배지는 셋 | 배지는 넷이 되었으나(생방송) ③ 목록은 영상·클립뿐이라 안 나온다. 새 용어 "녹화"(금지: 중지·끝내기)를 ③ 문구에 쓰지 않는다 | §4.6·§6.7 | `content.md:96-97`, `terms.json` |

#### 번호 재조정(새 트리의 마지막 번호 뒤로)
| 종류 | 이전 | 지금 | 근거 |
|---|---|---|---|
| app.md 구현 중 변경 | "77 이후" (마지막 76) | **"78 이후, 머지 순"**(77 = 생방송 녹화) | `app.md:1386` |
| 디자인 시스템 ADR | "0026 이후"(0025는 ①이 주장) | 0026 이후는 그대로. **0025는 생방송 녹화가 가져갔다.** ①의 0025 주장도 다시 매겨야 한다 | `adr/0025-live-recording.md`, `README.md:313` |
| 디자인 결정 D | (③은 새 D를 만들지 않음) | 새 D는 D64 이후(D63 = 생방송 녹화) | `README.md:212` |
| core.md 구현 중 변경 | (언급 없음) | ③의 `listing`은 61 이후(58~60 = 생방송 녹화) | `core.md:805`·`:817`·`:829` |
| 버전 | "지금 0.6.3 → 최소 0.7.0" | 지금 **0.7.0** → ③의 첫 `feat` 릴리스는 최소 **0.8.0** | `Cargo.toml:9`, `versioning.md:19` |

#### 줄 번호 갱신 요약
`bff221d` → `df454c3`에서 내용은 같고 줄만 밀린 것(대표): `manager.rs` 끝 상태 처리 `:1027-1071` → `:1109-1153`, `subscribe` `:324-326` → `:354-356`, `enqueue` 중복 검사 `:345-351` → `:375-381`, `MAX_FINISHED` `:55` → `:60`, `clear_finished` `:712` → `:780`; `dto.rs` `:497` → `:506`(+9), `free_file_name` `:554` → `:563`, 주석 `:588` → `:597`, `JobStatus::Skipped` `:629` → `:638`, `JobEvent` `:765-779` → `:781-795`; `part.rs` `:348-361` → `:379-392`; `download/mod.rs` 골격 주석 `:9-14` → `:11-16`, Skip 선검사 `:266-267` → `:274-275`, `finalize` Skipped `:349` → `:398`; `client.rs` `:108,119-121` → `:115,126-128`, `read_capped` `:216` → `:242`; `error.rs` `ErrorKind` `:94-115` → `:100-123`(`NotLive`·`NothingRecorded` 둘이 늘었다), core `EncryptedVod` `:31,131` → `:37,141`; `model.rs` `default_quality` `:157-161` → `:187-191`; `receive.ts` `:163` → `:165`, `:85` → `:87`; `ko.ts` `:251` → `:263`, `:86` → `:88`; `errors.ts` `:306-308` → `:316-318`; `content.md` `:140-142` → `:141-143`, `:272-273` → `:273-274`, `:459` → `:472`; `terms.json` `:602`·`:627`·`:652` → `:614`·`:639`·`:664`; `lib.rs` `:178-181` → `:179-182`, `:180` → `:181`; `fake.rs` `:241-295` → `:251-312`, `:192` → `:202`; 코어 테스트 `download.rs:52,73` → `:53,74`, `progressive.rs:773` → `:774`, `part.rs:774` → `:820`; `app.md` `:1183`·`:1353`·`:1380`·`:1384` → `:1184`·`:1354`·`:1381`·`:1385`; `ROADMAP.md` `:53`·`:69`·`:157` → `:56`·`:72`·`:160`. **줄이 같은 것**(파일이 이 범위에서 바뀌지 않았다): `app.rs`, `settings.rs`, `ownership.rs`, `consts.rs`, `gate.rs`, `volume.rs`, `jobs.rs`, `update.rs`, `power.rs`, `output.rs`, `writer.rs`, `events.rs`, `http.rs`, `naming.rs:42`, `patterns.md`, `platform.md`, `components.md`, `foundations.md`, `README.md:17-19,50,179,211`, `ci/ratchet.json:36`(값 `windows-setup`은 그대로, `darwin` 두 값만 올랐다).
**내용이 바뀌어 다시 쓴 것**: `download/mod.rs:60-70` → `:64-78`(`live_stop` 필드가 늘었다), `download/mod.rs:302-304` → `:325-326`(생방송 `.part` 마무리 분기가 앞에 `:310-322`로 늘었다), `services.rs:594`(`record_enqueued` 호출) → `:594-598`(`if let Some(kind)` 안), `dto.rs:708` → `:719`(`ProgressDto`에 생방송 필드 둘이 늘었다), `manager.rs` 대응표 `Pause`팔 → `Pause | Finish`팔(`:1124-1127`). 자동 매핑이 잘못 옮긴 `content.md:142` 인용 하나(`ko.ts:142`로 읽힘)를 `:143`으로 고쳤다.

#### 3차 개정 뒤에도 남은 것
- **열린 결정 E1(조기 종료)**: 추천 A(켜지 않음). B를 다시 여는 조건은 §3.1. 사용자 확인이 필요하다.
- 실측(§15): 질문 1은 이제 "관찰 표본에서 내림차순"까지만 답한다. 질문 6-2는 ④·⑤의 요청 경로가 생긴 뒤에 잰다.
- Codex 2회차 **N9**(확인 라벨의 허용 규칙을 기능마다 다르게 적용): ③은 [새 영상 찾기]로 풀었지만 ①·⑤가 [다시 확인]·[지금 확인]을 확정 문구로 쓰면 규칙이 갈린다. 공통 허용 목록에 등록하거나 통일하는 결정은 `decisions.md`의 일이다.
- ⑤ 설계(옛 생방송 설계(구현되어 core.md 구현 중 변경 58~60과 ADR-0025가 대신한다))는 v0.7.0에 이미 구현된 수동 녹화(`RecordingManager` 대신 기존 `DownloadManager`의 별도 lane)를 기준으로 다시 써야 한다. 이 문서는 ⑤가 `LiveWatch`를 만든다는 전제만 유지한다.
- 이 문서가 인용하는 `decisions.md`의 Q-번호(Q6·Q9·Q10)는 개정된 표의 ID(C3·C5·B1~B3·M-③-*)와 다르다. 본문 인용 정리는 `decisions.md` 확정 뒤에 한다.
- 머지 순 번호: app.md 78 이후, ADR 0026 이후(Checkbox·수치 묶음), 새 D는 D64 이후, core.md 61 이후, 배너 B6.
