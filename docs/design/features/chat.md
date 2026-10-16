# 기능 ④ 채팅 함께 받기: 설계 초안(3차 개정 2026-10-16, 최신 master `df454c3` v0.7.0 기준)

**상태·확정 결정(2026-10-16)**: 설계 상태이고 코드는 아직 없다(구현 순서는 `plan.md`). 이 문서는 기능 ④(채팅 함께 받기)의 설계다. 이 기능에 직접 걸린 확정: U2(자막 기본 형식은 실측 M-④-8·9 뒤 사용자가 정하고 그 전에는 ④-5를 머지하지 않는다), ④는 ②가 deferred·미정이어도 단독으로 간다(§12.1). 공통으로 확정된 것: Q1 실제 사용자 = 본인 + 지인 스트리머 + **그들의 편집자** · 결정 표 '유지' 26행(C4·C5·C6·C7·D1·D3~D8·R1~R4·B1~B3·U1~U5·L2·L4·L5) 추천대로 · **L6** 배포된 v0.7.0의 생방송 동작(관리자 예외, `/live/` 주소 붙여넣기)을 받아들인다 · **L7** 녹화 `.part`는 지금 경로 그대로 두고 최소 조치로 지킨다(모든 삭제 진입점의 sidecar 소유권 검사, '새 녹화 시작'과 '기존 녹화 저장'의 계약 구분, v0.7.0 파일 호환; 별도 `.rec.part` 체계는 후속) · **C1** 뒤집는 결정 ①(본인 영상 제한 → 로그인 채널 또는 맡긴 채널)·③(app.md §1.2 부분 뒤집기) 승인 · **L8** 끝난 이유 표시 · **L-D1** 맡은 채널의 생방송은 v1에서 닫는다 · **E1** ③ 조기 종료는 끈다 · **R5** 전체 빠른 다시보기 defrag는 실측 뒤 · **U2** 자막 기본 형식은 실측 뒤. UX 기준 ① "숨겨지거나 복잡하면 안 되고, 튀어 촌스러워도 안 된다". Codex 리뷰는 설계 단계에서 세 번 끝냈으므로 구현 PR에서는 중요한 PR만 돌린다. 조사 원자료·근거 확인 표·Codex 리뷰 원문은 저장소에 없다(공개 저장소 규칙). 본문이 이 결정과 다르면 결정(`decisions.md`)이 우선한다.

- 상태: **designed(조건부)**. 조사 판정은 partial이다. 일반 VOD의 채팅은 받을 수 있는 쪽으로 보이지만(실측 필요, 근거 확인 A5), 로그인 필요 여부, 끝 신호의 의미, 빠른 다시보기의 시각 정렬은 아직 모른다. 그래서 PR 1이 파서, 자막 렌더러, 사용자 실측 도구다(3차 개정 N5, §10.1). 실측 결과에 따라 갈리는 절은 §11 "실측 결과 → 선택" 표에 묶었다.
- 원자료(조사 기록)는 저장소에 없다. 엔드포인트, 요청 인자, 응답 필드 이름, 종류 코드 값, 출처 프로젝트는 **이 문서에 옮기지 않는다**(공개 저장소 규칙, CLAUDE.md "공개 저장소 규칙"). 이 문서는 행동만 적는다. serde 이름은 구현 PR이 원자료 §2를 보고 정한다. 저장소에는 합성 fixture와 코드만 남긴다.
- 기준: `docs/design/core.md`·`app.md`의 "구현 중 변경"이 본문보다 우선한다. 시각과 문구는 `docs/design/system/`(README D 표 > foundations > 나머지)을 따른다(CLAUDE.md 머리).
- 근거 표기: `파일:줄`은 기준 커밋 `df454c3`(origin/master, v0.7.0)에서 직접 연 곳이다(읽기 전용 작업 트리 `chzzk-downloader-diff`). 1·2차 개정 기록 안의 줄 번호는 그때의 `bff221d` 기준 그대로이고, 옛 번호가 지금 어느 줄인지는 3차 개정 기록 끝의 표에 있다. `[가정]`은 근거 없는 판단, `[실측 필요]`는 사용자 실측(§10)이나 실기 확인이 있어야 정해지는 것이다. `[잠정] 근거 없음, 실측·ADR-0009 묶음 등록`은 출처 없는 수치다. ADR-0009는 "바꿀 때는 이 ADR을 고치지 않고 새 ADR을 쓴다"(`adr/0009-unsourced-numbers.md` 결정 절)라고 정한다. 그래서 이 기능의 수치는 PR 5에서 새 ADR 한 장에 묶어 등록한다.
- 사용자 확정 Q1(2026-10-16): 실제 사용자는 **본인, 지인 스트리머, 그들의 편집자**다. 이 문서에서 편집자는 "받은 영상과 채팅 자막을 편집 프로그램에 넣는 사람"이다(§1.3·§14 U2에 반영).
- 사용자 확정(2026-10-16): 결정 표의 "유지" 판정 26행은 추천대로 확정했다. U2(자막 기본 형식)는 실측 M-④-8·9 결과를 보고 정한다. UX 기준 ①: 숨겨지거나 복잡하면 안 되고, 튀어 촌스러워도 안 된다.
- 번호(3차, 최신 master 기준): `docs/design/core.md` 구현 중 변경은 60까지 있다(`core.md:829`) → 이 기능은 **61 이후**(머지 순). `app.md`는 77까지다(`app.md:1386`) → **78 이후**. 디자인 시스템 ADR은 `0025-live-recording`까지다(`docs/design/system/adr/`) → **0026 이후**(머지 순). 디자인 결정 D는 D63까지다(`docs/design/system/README.md`) → 이 기능은 D 번호를 새로 만들지 않는다. `patterns.md` §17은 33까지다(`patterns.md:902`) → **34 이후**. 앞선 문서들이 적은 "ADR 0025는 ①"은 낡았다(0025는 생방송 녹화가 가져갔다).

---

## 1. 목표와 범위

### 1.1 목표

1. 일반 VOD나 빠른 다시보기를 받을 때 그 영상의 채팅도 영상 옆에 파일로 남긴다. 사용자가 할 일은 영상 카드의 스위치 하나다.
2. 남기는 형식은 두 가지다.
   - **기록**(`.chat.jsonl`)은 늘 남는다. 받은 메시지를 한 줄에 하나씩 그대로 담아 잃는 것이 없다. 나중에 다른 형식으로 다시 만들 수 있다.
   - **자막**(`.ass` 또는 `.srt`)은 고르면 만든다. 영상과 기본 이름이 같아 mpv가 자동으로 연다(mpv 매뉴얼 `--sub-auto` 기본값 `exact`, 근거 확인 A15). VLC가 자동으로 여는지는 [실측 필요](A16, §11 Q4와 함께 확인).
3. 채팅이 실패해도 영상은 성공으로 끝난다. 채팅은 끊긴 곳부터 이어받는다.
4. 이미 받은 영상의 채팅도 작업 행 메뉴에서 따로 받을 수 있다. 숨은 경로는 두지 않는다. 이 경로도 덮어쓰기 동의를 거친다(§4.5).

### 1.2 하지 않는 것

| 하지 않는 것 | 이유 |
|---|---|
| 클립 채팅 | 클립 정보에는 원본 VOD 번호도, 원본 안의 시작 위치도 없다(근거 확인 A3, 제3자 문서 기준). 그래서 원본 채팅에서 잘라 올 수 없다. 클립 카드에서는 채팅 행을 **숨긴다**. 사유 없는 비활성은 두지 않는다(patterns §6.4) |
| 생방송에 채팅 붙이기(실시간 채팅 기록 포함) | 공식 Open API의 채팅 범주에는 지난 채팅 조회가 없다. 있는 것은 보내기·공지·설정·블라인드뿐이다(A1). 채팅 구독은 세션 이벤트 구독이다. 이것이 라이브에서만 쓰인다는 말은 스펙에 없고, 이벤트 구독이라는 점에서 그렇게 추정했다[가정](A2). **3차 개정에서 이유를 바꿨다.** 초안은 "방송 내내 앱을 켜 둬야 하므로" 범위 밖이라 했다. 그런데 v0.7.0이 생방송 녹화를 넣었다. 녹화는 방송이 끝나거나 [녹화 마치기]까지 받고, 앱을 닫아도 받은 만큼 마무리한다(core.md 58, app.md 77, `manager.rs:494`·`:811`). 앱을 켜 둔 채 도는 작업이 이미 있으므로 그 이유는 쓰지 않는다. 남는 이유는 둘이다. ① 이 문서가 쓰는 경로는 VOD 번호로 부르는 지난 채팅 페이지 조회인데, 생방송 작업은 채널 ID만 가진다(`ContentRef::Live { channel_id }`, `model.rs:27-29`). ② 실시간 구독은 별개 프로토콜이라 이 설계가 다루는 경로가 아니다[가정]. 방송이 끝나 VOD가 생기면 그 VOD는 이 기능의 일반 흐름으로 채팅을 받는다. 녹화본 이름은 `[생방송 …]`이라 그 VOD 이름과 다르다(`naming.rs:54-66`). 생방송 행에는 채팅 스위치도 [⋯] 항목도 없다(§4.6). 이는 이 설계의 판단이며 ROADMAP 확정 결정은 아니다[가정](A4) |
| 자막을 mp4에 넣거나 화면에 굽기 | 확정 결정 "ffmpeg 제거"(`docs/ROADMAP.md:69`)와 부딪친다. 이 설계는 자막을 늘 따로 된 파일로 남기므로 그 결정을 건드리지 않는다 |
| 채팅 분석·검색·뷰어 화면 | 다운로더가 할 일이 아니다. 기록은 다른 도구가 읽는다 |
| 이모티콘·프로필 이미지 받기 | 미디어 CDN 요청이 늘어나는 데 비해 얻는 것이 적다. 기록에 메타데이터가 그대로 남으므로 나중에도 할 수 있다 |
| 앱 안에서 형식 바꾸기(jsonl → srt 다시 만들기) | v1에서는 하지 않는다. 형식을 바꾸려면 [⋯] › "채팅 다시 받기"로 처음부터 받는다. 편집자가 실제 사용자로 확정됐으므로(Q1) 이 항목은 다음 단계 1순위 후보로 올린다(§13 R8) |

### 1.3 뒤집는 기존 결정

**없다.**

- ffmpeg 제거: 자막을 따로 된 파일로만 쓰므로 부딪치지 않는다(`ROADMAP.md:69`).
- 비공식 서비스 API 사용: info·MPD도 같은 종류의 비공식 경로를 쓴다. D34는 고지의 위치와 문구를 정할 뿐, 어떤 API를 써도 되는지는 정하지 않는다(README.md:158, 근거 확인 D2). 그래서 "고지 범위 안"이라는 것은 이 설계의 판단이다[가정]. 경로가 하나 늘어난다는 점은 §14 U4의 기본 꺼짐으로 다룬다.
- 쿠키 규칙: "API·MPD 요청에만, 사용자가 켰을 때만"을 그대로 따른다(`crates/core/src/http.rs:4`·`:155-166`). 채팅 요청은 `RequestKind::Api`이고 `Chzzk::fetch`(`client.rs:202`)를 탄다.
- 본인 영상 제한: 영상과 같은 `OwnershipGate::admit`(`crates/shell/src/ownership.rs:118`)을 거친다(§4.5). 편집자는 본인 채널이 아니므로 위임 기능(①)이 들어오기 전에는 이 gate에서 막힌다. 채팅은 판정을 따로 하지 않고 영상과 같은 gate를 부르므로, ①이 gate의 허용 범위를 넓히면 채팅에도 그대로 적용된다. 채팅 쪽에서 위임을 따로 다루지 않는다.
- 덮어쓰기: "같은 이름 파일 덮어쓰기는 비가역이라 D7로 확인한다"(patterns.md:264)를 채팅 파일에도 그대로 적용한다. 묻지 않고 덮어쓰는 길은 두지 않는다(§4.5).

---

## 2. 사용자 흐름

```
[주소 붙여넣기] → 영상 카드(채팅 행: 스위치, 기본값 = 마지막 선택)
   → [받기] → 작업 행: 영상 받는 중 … 완료
   → (같은 행) 상태 줄 끝에 "채팅 받는 중 · 38%" → "채팅 12,345개"
   → 폴더: 이름.mp4 · 이름.ass · 이름.chat.jsonl
```

- 이미 받은 영상은 완료 행 [⋯] › "채팅 받기"로 받는다. 소유 검사를 다시 거친다. 같은 이름의 채팅 파일이 있으면 D7을 거친다(§4.5). 그 뒤 흐름은 위와 같다.
- 채팅만 실패하면 행은 **완료 그룹에 그대로** 남는다. 상태 줄 아래 본문 한 줄로 알리고, [⋯] › "채팅 이어받기"로 다시 받는다.

---

## 3. 코어 변경(`crates/core`)

### 3.1 새 모듈 `chat/`

| 파일 | 내용 | 순수 여부 |
|---|---|---|
| `chat/mod.rs` | 공개 타입, 상수(§3.2), `Chzzk::fetch_chat_page`, `Chzzk::collect_chat` | I/O |
| `chat/page.rs` | `parse_chat_page(bytes) -> Result<ChatPage, Error>`. 한 페이지 응답을 읽는다 | 순수 |
| `chat/walk.rs` | `next_step(cursor, &ChatPage) -> Step`: 종료 조건 셋, 경계 중복 제거 | 순수 |
| `chat/retry.rs` | `classify(&Error) -> ChatFailure { Retry, Fatal }`. 채팅 전용 실패 분류(§3.2-5) | 순수 |
| `chat/part.rs` | `.chat.jsonl.part`에 이어 쓰기, sidecar(`.chat.jsonl.part.json`), 이어받을 때 마지막 완전한 줄로 자르기, 최종 이름 옮기기(`DuplicatePolicy`) | fs |
| `chat/subtitle.rs` | `render_ass(iter, &SubtitleOpts) -> String`, `render_srt(..)`. 기록을 한 줄씩 읽어 만든다 | 순수 |
| `chat/probe.rs` | 실측 도구의 범주 판정(§10) | 순수 |

- **PR 배치(3차 개정 N5)**: `chat/page`·`walk`·`retry`·`probe`·**`subtitle`**과 `naming::sibling_path`는 PR 1, `chat/part`는 PR 2, `chat/mod.rs`의 `collect_chat`은 PR 3이다. 이유는 §10.1이다. `subtitle`의 입력은 `ChatMessage` 반복자라 `page`(PR 1)에만 기대고 `part`(PR 2)에는 기대지 않는다.

타입 이름은 API 필드가 아니라 행동을 따른다.

```rust
/// 채팅 페이지 커서(재생 위치 ms). 단조 증가는 `walk`가 검사한다.
pub struct ChatCursor(pub u64);

/// 기록 한 줄. `raw`는 받은 메시지 객체 그대로다(원본 보존). 나머지는 파서가 뽑은 값이다.
pub struct ChatMessage {
    pub player_offset_ms: u64,      // 영상 재생 위치(자막 시각은 이것만 쓴다)
    pub written_at_ms: Option<i64>, // 작성 시각(보정에 쓰지 않고 기록에만 남긴다)
    pub kind: ChatMessageKind,      // Normal | Donation | Subscription | System | Other
    pub hidden: bool,               // 블라인드 등으로 가려진 메시지
    pub raw: Box<serde_json::value::RawValue>,
}

pub struct ChatPage { pub messages: Vec<ChatMessage>, pub next: Option<ChatCursor> }

/// 정상 끝. 400은 여기 없다(§3.2-3, 개정 기록 1).
pub enum ChatEnd { NoCursor, CursorNotAdvancing, EmptyPage }

pub struct ChatRequest {
    pub video_no: u64,                // 클립은 타입으로 표현할 수 없다(새 Error 변종 불필요, 개정 기록 9)
    pub output: PathBuf,              // 영상 최종 경로. 채팅 경로는 여기서 확장자만 바꾼다
    pub subtitle: SubtitleFormat,     // None | Ass | Srt
    pub restart: bool,                // 받다 만 채팅 `.part`를 버린다. 덮어쓰기 동의가 아니다
    pub on_existing: DuplicatePolicy, // 기본 Skip. Overwrite는 D7 동의 뒤에만(§4.5)
}

pub enum ChatOutcome {
    Completed { messages: u64, last_offset_ms: Option<u64>, end: ChatEnd },
    /// Skip인데 받는 동안 같은 이름 파일이 생겼다. `.part`·sidecar는 남는다(`part.rs:380-382`과 같은 규칙)
    TargetExists { path: PathBuf },
}

pub struct ChatProgress { pub cursor_ms: u64, pub duration_ms: Option<u64>, pub messages: u64 }
```

- serde rename(세부 필드 이름)은 fixture PR에서 원자료 §2를 보고 정한다. 이 문서에는 적지 않는다.
- 문자열 안에 JSON이 든 필드(프로필·부가 정보)는 파서가 통째로 풀지 않는다. 종류 판정, 가려짐 판정, 자막의 닉네임 표시에 필요한 만큼만 연다. 여는 데 실패하면 그 메시지만 "닉네임 없음"으로 처리하고 페이지 전체를 실패시키지 않는다.
- 초안에 있던 `ChatOutcome::Unavailable`은 지웠다. "채팅이 꺼진 영상"을 알 수 있는 근거는 info 필드(Q3) 하나뿐이다. 그 판정은 요청 전에 셸이 한다(§3.5). 요청해서 메시지가 0개면 `Completed { messages: 0 }`이다.

### 3.2 수집 규칙(`collect_chat`)

1. 시작 커서는 sidecar에 적힌 커서다. sidecar가 없거나 `restart`면 0부터 시작한다.
2. 각 페이지에서 커서 **앞쪽** 메시지 묶음은 버린다(처음부터 긁을 때 생기는 중복이다). 커서 **뒤쪽** 묶음만 쓴다.
3. 정상 끝은 셋이다(`walk.rs`). 공개 구현 하나가 넷을 모두 끝 조건으로 쓰지만(근거 확인 A8), 그것은 서비스 계약이 아니다.
   - 다음 커서가 없다 → `NoCursor`.
   - 다음 커서가 지금 커서 이하다 → `CursorNotAdvancing`(무한 루프 방지).
   - 뒤쪽 묶음이 비었다 → `EmptyPage`.
   - **400은 어느 페이지에서든 오류다**: `HttpStatus { status: 400, kind: Api }`(`client.rs:219-220`가 이미 2xx가 아닌 응답을 이렇게 낸다). RFC 9110 §15.5.1은 400을 클라이언트 요청 오류로 정의할 뿐 "데이터 끝"을 뜻하지 않는다(https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.1). 공개 구현이 400을 끝으로 다룬다는 것(A8·A9)은 서비스가 보장한 것이 아니다. 400이 나면 `.part`와 sidecar를 남긴다. 받은 부분은 이어받을 수 있다. 400이 정상 끝 신호인지는 실측 도구(§10 출력 4)로 확인하고, 결과는 §11 Q8로 처리한다.
4. 경계 중복 제거: 직전 페이지 마지막 재생 위치와 같은 ms를 가진 메시지만 "재생 위치·작성 시각·작성자·본문" 묶음의 해시로 대조한다. sidecar에는 마지막 ms와 그 ms에 있던 해시의 **개수 표**(multiset)를 둔다. 다음 페이지의 같은 ms 메시지는 해시마다 개수만큼만 버린다. 같은 ms에 작성자·본문까지 같은 정상 메시지가 둘 있어도 둘 다 남기기 위해서다(Codex "근거 없는 의심" 3). 서버가 경계 ms의 메시지를 전부 되풀이하는지, 일부만 되풀이하는지는 [실측 필요](§10 출력 4b).
5. 실패 분류는 `retry::classify_failure`를 **쓰지 않는다**. 그 함수는 미디어용이다. 403을 `Expired`로, 401을 `Fatal(HttpStatus{kind: Media})`로 바꾼다(`download/retry.rs:135`·`:148-159`, 근거 확인 B4). 채팅은 `Chzzk::fetch`(`client.rs:202`)가 낸 `Error`를 그대로 받아 새 순수 함수 `chat::retry::classify`로 나눈다.

   | `fetch`가 낸 오류 | 분류 | 끝 오류 |
   |---|---|---|
   | `AuthRequired { 401·403 }`(`client.rs:216-218`) | `Fatal` | `AuthRequired` → 셸 `authRequired` |
   | `HttpStatus { 408·429·500..=599 }` | `Retry` | 상한을 넘기면 그 `HttpStatus` |
   | `Network` | `Retry`. 인내 모드(`retry.rs:130`)는 쓰지 않는다. 채팅은 가볍고 다시 받으면 된다 | `Network` |
   | `HttpStatus { 그 밖, 400 포함 }`, `Parse` | `Fatal` | 그대로 |

   재시도 간격은 기존 `RetryPolicy`(`retry.rs:26`, 지수 백오프 + ±25% jitter `retry.rs:5`)를 그대로 쓴다. 판단은 공개 메서드 `allows_retry(attempts)`(`retry.rs:64`), 간격은 공개 메서드 `delay(retry)`(`retry.rs:69`)다. `delay`가 이미 `self.delay_capped(retry, self.cap)`을 감싸 공개하므로(`retry.rs:69-71`) 비공개 `delay_capped`(`retry.rs:74`)는 넓히지 않는다. 채팅 정책값은 다음과 같다.

   ```rust
   RetryPolicy {
       max_attempts: CHAT_RETRY_MAX + 1, // max_attempts는 첫 시도를 포함한 횟수다(retry.rs:24). 재시도 3회 = 시도 4회
       patience: Duration::ZERO,         // patience는 Duration이다(retry.rs:34). none()도 Duration::ZERO를 쓴다(retry.rs:58)
       ..RetryPolicy::default()          // base 500ms·cap 8초·patience_cap(retry.rs:41-49). 인내가 0이라 patience_cap은 쓰이지 않는다
   }
   ```

   `CHAT_RETRY_MAX`는 **재시도** 횟수다(첫 시도 제외). 그래서 `max_attempts`로 옮길 때 1을 더한다. §10 실측 도구의 "429는 `CHAT_RETRY_MAX`회까지"도 재시도 횟수다. 경계는 단위 테스트로 고정한다: 429를 3번 받고 4번째에 성공하면 `Completed`, 4번 받으면 `HttpStatus{429}`(§9.2).
6. 상수는 코어 `chat/mod.rs`에 둔다. 코어에는 `consts` 모듈이 없다(`crates/shell/src/consts.rs`는 셸 모듈이다, 근거 확인 B10). 모듈마다 상수를 두는 것이 선례다(`download/retry.rs:15` `NETWORK_PATIENCE_MS`, `download/mod.rs:47` `MAX_REFRESHES`).
   - `CHAT_PAGE_INTERVAL_MS = 300`: 요청 사이 최소 간격. [잠정] 근거 없음, 실측·ADR-0009 묶음 등록. 원자료의 제안값(원자료)이고, 출처 구현이 실제로 몇 ms를 쓰는지는 확인하지 않았다(A14). Q5로 정한다.
   - `CHAT_RETRY_MAX = 3`(재시도 횟수, 첫 시도 제외): [잠정] 근거 없음, 실측·ADR-0009 묶음 등록(원자료의 제안값).
7. 커밋 순서는 `download/part.rs`와 같다(`part.rs:3-5`). 페이지의 줄을 `.part`에 덧붙이고 → flush·`sync_data` → sidecar(`커서`, `줄 수`, `.part` 길이, 경계 해시 개수 표, 정상 끝 `end: Option<ChatEnd>`)를 원자적으로 쓴다. `end`가 있으면 이어받기는 요청 없이 마무리(8번)로 간다. 이어받을 때 `.part`가 sidecar에 적힌 길이보다 길면 그 길이로 자른다.
8. 다 받으면 자막을 만든다(`subtitle.rs`, 기록을 한 줄씩 읽는다). 그다음 자막 → 기록 순으로 `.part`에서 최종 이름으로 옮긴다. 옮기는 방법은 `on_existing`이 정한다(`part.rs:386`의 `finalize(policy)`와 같은 분기).
   - `Skip`(기본): `fsutil::rename_noclobber_with_retry`(`fsutil.rs:126`). 최종 이름이 이미 있으면 옮기지 않는다. `.part`·sidecar를 남기고 `ChatOutcome::TargetExists`를 낸다. 검사(§4.4) 뒤, 받는 동안 사용자가 같은 이름으로 만든 자막도 이렇게 지켜진다.
   - `Overwrite`(D7 동의 뒤에만): `fsutil::rename_with_retry`(`fsutil.rs:112`, Windows 일시 잠금 재시도).
   - 자막 생성이 실패해도 기록은 완성으로 남긴다.
   - 두 파일 중 하나만 `TargetExists`면(예: 자막은 옮겼고 기록 이름이 막힘) 옮긴 쪽은 최종 이름에 둔다. 막힌 쪽의 `.part`와 sidecar는 남기고 결과는 `TargetExists { path: 막힌 파일 }`이다. 다시 마무리할 때는 이미 최종 이름에 있는 자기 파일을 다시 옮기지 않는다(sidecar에 옮긴 파일을 적는다).
9. 진행률은 `ChatProgress`이고, 기존 `Meter` 스로틀(앱이 250ms를 준다, `crates/shell/src/services.rs:43`)을 따른다. 퍼센트는 `cursor_ms / duration_ms`(정수 내림, 99에서 멈춤)다. 길이를 모르면 메시지 수만 보인다(patterns.md:193 P-1, 가짜 퍼센트 없음).

### 3.3 파일 이름(`naming.rs`)

| 파일 | 이름 | 규칙 |
|---|---|---|
| 영상 | `{stem}.mp4` | 그대로 |
| 자막 | `{stem}.ass` 또는 `{stem}.srt` | **중간 접미사 없음**. mpv `sub-auto=exact`가 같은 이름을 연다(A15) |
| 기록 | `{stem}.chat.jsonl` | 플레이어가 열지 않는 확장자라 중간 접미사가 있어도 된다 |
| 임시 | `{stem}.chat.jsonl.part`·`.part.json`, `{stem}.ass.part` | |

- 새 함수 `naming::sibling_path(video: &Path, ext: &str) -> PathBuf`(PR 1, 실측 도구의 `--write-ass`·`--write-srt`가 같은 함수로 이름을 정한다)는 영상 최종 경로에서 `.mp4`만 바꾼다. 메타데이터로 이름을 다시 만들지 않는다(생방송 이름 `[생방송 …]`도 같은 규칙으로 바뀌지만 생방송에는 채팅 파일이 없다, §4.6). 영상 최종 경로는 `enqueue`가 `output_path(...)`로 계산해(`manager.rs:377`) 레코드에 저장한다. 사용자가 고친 이름과 "번호 붙이기"를 거친 실제 이름을 따라야 플레이어가 짝을 찾는다.
- 자막을 한 형식만 고르게 한 것도 같은 이유다. `.ass`와 `.srt`가 둘 다 있으면 플레이어마다 고르는 쪽이 달라질 수 있다[가정].
- 길이: 이름 상한은 `.mp4`를 포함해 200바이트다(`naming.rs:12`·`:69`). 가장 긴 접미사 `.chat.jsonl.part.json`(21바이트)은 `.mp4`보다 17바이트 길어 최대 217바이트가 된다. 주요 파일 시스템의 이름 한도 255바이트보다 짧다(일반 지식[가정]). Windows 전체 경로 한도는 §8에서 다룬다.
- 이 결정으로 "플레이어가 중간 접미사도 자동으로 여는가"는 확인할 필요가 없어졌다. 남은 실측은 "같은 이름 `.ass`가 VLC에서도 자동으로 열리는가"(A16)와 "시각이 맞는가"(§11 Q4, 수동)다.

### 3.4 자막 렌더 규칙

| 항목 | ASS | SRT |
|---|---|---|
| 시작 | 재생 위치(ms) 그대로. 작성 시각으로 보정하지 않는다. 보정하다 어긋난 공개 사례가 있다(근거 확인 A10) | 같음 |
| 끝 | 시작 + `CHAT_CUE_MS`(5000, [잠정] 근거 없음, 실측·ADR-0009 묶음 등록, 사용자 결정 U3) | 같음 |
| 겹침 | 같은 정렬의 이벤트를 렌더러가 위로 쌓는다고 본다[가정](libass 동작의 출처는 확인하지 않음, A19). 화면 왼쪽 아래 정렬. 줄 수 상한은 스타일 여백으로 정한다 | 겹침을 허용한다. 편집 도구가 어떻게 그리는지는 [실측 필요](§13 R5) |
| 줄 모양 | `닉네임: 본문`. 후원은 `닉네임 [후원]: 본문` | 같음 |
| 넣지 않음 | 가려진 메시지, 시스템 메시지, 빈 본문 | 같음 |
| 영상 길이 뒤 | 길이 + `CHAT_TAIL_MS`(5000, [잠정] 근거 없음, 실측·ADR-0009 묶음 등록)를 넘는 메시지는 자막에서 뺀다. 기록에는 남긴다(§11 Q6) | 같음 |
| 이스케이프 | `{`·`}`·`\`, 줄바꿈 → `\N`, 제어 문자 제거 | 숫자만 있는 줄 앞에 공백 하나(번호 줄로 읽히지 않게), 빈 줄 → 한 줄 |
| 해상도 | PlayResX/Y 1920×1080 고정([잠정] 근거 없음, 실측·ADR-0009 묶음 등록). 플레이어가 비율로 맞춘다고 본다[가정] | — |

본문 안의 이모티콘 자리표시는 자막에서 `:이름:` 꼴의 글자로 바꾼다. 기록에는 그대로 둔다. 자리표시의 실제 꼴은 PR 1에서 원자료를 보고 정하고, fixture에는 합성 꼴만 쓴다. ASS 이스케이프와 부딪치지 않도록 이 치환을 이스케이프보다 먼저 한다.

### 3.5 info 확장(`info.rs`)

- `VideoContent`(`info.rs:23-37`)에 `chat_enabled: Option<bool>`를 더한다. 단, **앱이 쓰는 info v2(`info.rs:18`)에 그 필드가 있다고 실측 Q3에서 나올 때만**이다. 지금 확인된 것은 v3 문서뿐이다(근거 확인 A7). 필드가 없으면 이 줄을 지운다. 그러면 카드는 늘 켤 수 있다.
- `ContentMeta`(`model.rs:43`)에 `chat: ChatAvailability { Unknown, Enabled, Disabled }`를 둔다. 클립과 생방송은 늘 `Disabled`다. `ContentMeta` 리터럴을 만드는 곳은 `info.rs`의 세 군데(영상 `:172`, 생방송 `:344`, 클립 `:452`, v0.7.0이 생방송 `parse_live_detail`을 더했다)이고, 테스트 도우미(`naming.rs:280`, 셸 `ownership.rs:233`)도 필드를 채워야 한다. 셸 DTO는 손으로 만든 미러라서(`dto.rs:454-457`·`:469`) `ContentMetaDto` 필드와 `From<&ContentMeta>`도 함께 고친다(B17).

### 3.6 오류

새 `Error` 변종은 만들지 않는다(`error.rs:19-77`의 기존 변종만 쓴다). 클립 거부는 `ChatRequest.video_no` 타입으로 막으므로 코어 오류가 필요 없다. 셸은 기존 `AppError::invalid_input`을 쓴다(§4.5).

| 상황 | 코어 | 셸 `ErrorCode` | 본문 키(§5.5) |
|---|---|---|---|
| 401·403 | `AuthRequired` | `authRequired` | `body.auth` |
| 408·429·5xx 재시도 상한 | `HttpStatus` | `http` | `body.service` |
| 400, 그 밖의 4xx | `HttpStatus` | `http` | `body.other` |
| 연결 끊김 | `Network` | `network` | `body.network` |
| 응답 형식 | `Parse { what: "chat", detail }`. detail에는 **필드 경로와 종류만** 담고 원문은 담지 않는다 | `parse` | `body.other` |
| 디스크 | `DiskFull`·`FileLocked`·`Io` | 같음 | `body.disk`(DiskFull), `body.locked`(FileLocked), `body.other` |
| 받는 동안 같은 이름 파일이 생김 | 오류가 아니다. `ChatOutcome::TargetExists` | — | 상태 `Conflict`(§4.1) |

`ErrorKind` → `ErrorCode`의 빠짐없는 match(`crates/shell/src/error.rs:71-72`)는 그대로다.

---

## 4. 셸 변경(`crates/shell`)

### 4.1 상태 모델: `JobStatus`는 건드리지 않는다

```rust
/// JobRecord·JobDto의 새 필드. 없으면(옛 레코드) None = 채팅을 고르지 않은 작업.
#[serde(default)]
pub chat: Option<ChatState>,

pub struct ChatState {
    pub phase: ChatPhase,             // Waiting | Running | Paused | Interrupted | Completed | Conflict | Failed
    pub subtitle: SubtitleFormat,     // 받기 시점의 선택을 고정한다
    pub on_existing: OnExisting,      // 카드에서 정한 값. 기본 Skip(§4.5)
    pub messages: u64,
    pub percent: Option<u8>,          // Running·Paused·Interrupted·Failed에서 유지(P-4: 뒤로 가지 않음)
    pub error: Option<AppError>,      // Failed
    #[serde(skip)]
    pub partial_bytes: Option<u64>,   // 채팅 `.part`를 실제로 확인한 길이. jobs.json에 쓰지 않는다(아래)
}
```

- `Paused`(사용자가 멈춤)와 `Interrupted`(앱 종료로 멈춤)를 나눈다. 영상도 자동 이어받기는 `Interrupted`만 한다(`manager.rs:617`). 채팅도 그래야 사용자가 멈춘 채팅이 다시 시작되지 않는다.
- `Conflict`는 `ChatOutcome::TargetExists`다. 영상의 `Skipped`와 같은 뜻이다.
- `partial_bytes`는 영상 `JobRecord.partial_bytes`와 같은 규칙이다. `#[serde(skip)]`로 저장하지 않고, 시작 때 reconcile, 실행 중에는 매니저가 실제 파일로 다시 채운다(app.md 구현 중 변경 26 (나)·27). DTO에서는 `ChatStateDto.partialBytes`로 보인다(영상 `JobDto.partial_bytes` `dto.rs:676-677`과 같은 뜻: sidecar에 적힌 길이). 프런트가 "채팅 `.part`가 있는가"를 이 값으로 판단한다(§4.3 지우기 경로, §5.3 `Failed` 메뉴 분기). 저장 형식이 바뀌지 않으므로 아래 `JOBS_VERSION` 논리도 그대로다.
- `JobStatus`(`dto.rs:631-640`, 8개)에 변종을 더하지 않는다. 영상 상태 머신, 그룹 정렬, 기존 테스트가 그대로 남는다.
- **`JOBS_VERSION`(`jobs.rs:29`, 1)은 올리지 않는다.** `jobs::parse`는 버전이 다르면 파일 전체를 거부한다(`jobs.rs:278-279`). 버전을 올리면 앱을 낮은 버전으로 되돌렸을 때 다운로드 목록을 잃는다. 필드 추가는 `#[serde(default)]`로 옛 파일과 호환되고, 옛 앱은 모르는 필드를 무시한다(`deny_unknown_fields` 0건, 근거 확인 C4). 그래서 `!`가 붙지 않는다(versioning.md:31 "사용자 데이터"를 깨지 않음).

### 4.2 실행: `ChatQueue`

- 새 `crates/shell/src/chat.rs`의 `ChatQueue`가 채팅 수집을 맡는다. **한 번에 하나**만 돌린다. 같은 API 호스트에 몰리지 않게 하려는 것이다(info와 같은 호스트, A20). 429가 호스트 단위로 걸리는지, 하나만 돌리면 실제로 줄어드는지는 [실측 필요](C31, Q5).
- 영상 동시 수 슬롯(`max_parallel_downloads`, `manager.rs:3-4`)도, v0.7.0이 더한 생방송 별도 lane(`MAX_LIVE`, `manager.rs:63`)도 쓰지 않는다. 채팅은 세 번째 줄이다. 채팅도 같은 회선을 쓰지만 JSON 페이지라 영상보다 훨씬 작다고 본다[가정](C32).
- 시작 시점은 **영상이 완료된 뒤**다(사용자 결정 U1). `finish`(`manager.rs:1082`)에서 영상 작업이 `Completed`가 되는 분기(`End::Done(Completed)` `manager.rs:1109` → `set_status(JobStatus::Completed)` `:1110`) 안에서 `rec.chat`이 `Some(Waiting)`이면 `ChatQueue::push(id)`를 부른다. 생방송도 이 `Completed` 분기를 타지만(`stop_job`·`pause`·`quit`이 모두 마무리해 `Completed`가 된다, `manager.rs:494`) 생방송 작업의 `chat`은 늘 `None`이라 훅이 발동하지 않는다(§4.6).
- 이벤트는 새 `JobEvent::Chat { id, chat: ChatState }`다(`JobEvent`는 `dto.rs:775-781`의 `tag = "type"` 열거형). 진행 틱은 기존 진행률과 같은 스로틀을 거친다. **프런트가 이 이벤트를 무시하지 못한다.** `app/src/lib/stores/jobs.apply.ts:87-91`은 남은 이벤트를 `never`에 대입하므로, bindings를 다시 만들면 `Chat` 분기가 없는 한 `pnpm check`가 깨진다(Codex "④-4 타입 검사", 근거 확인 C10). 그래서 이벤트 적용 분기는 셸 PR 4에 함께 넣는다(§12).
- 잠자기 방지(`power.rs`): `Running` 채팅도 "받는 중"으로 센다. 몇 분 걸리는 긴 VOD에서 도중에 잠들지 않게 하려는 것이다. 지금 입력은 running+pausing 작업 수뿐이라(`power.rs:225`) 채팅 수를 더해 넓혀야 한다.
- 창 닫기 확인(대화상자 D1, `running_count` `manager.rs:367-369`)에는 채팅을 **세지 않는다**. 닫으면 `Interrupted`로 남고 커서부터 이어받으므로 잃는 것이 없다.
- 앱을 다시 열 때의 규칙:
  - `Running`이던 채팅은 `Interrupted`가 된다.
  - `Waiting`은 영상이 아직 완료가 아니면 **그대로 둔다**. 영상을 이어받아 완료하면 `finish`가 줄을 세운다.
  - 영상은 완료인데 `Waiting`이면(채팅 차례를 기다리다 꺼짐) `Interrupted`로 바꾼다.
  - `auto_resume_interrupted`가 켜져 있을 때 `Interrupted` 채팅을 다시 줄 세우는 시점은 영상과 **같은 자리**다.
    - 로그인을 쓰는 빌드: 매니저를 자동 이어받기 없이 연다. 처음 채널 있는 `SignedIn`이 보일 때 `App::on_auth_status`(`app.rs:342-362`)가 한 번 줄 세운다. 이때 같은 채널 작업만 고르고(`is_own_channel`), 관리자는 모두 고른다. 근거는 worker.md 구현 중 변경 57("재시작 후 자동 이어받기는 로그인 뒤로 미룬다"), 83·102(`app.rs:340-341` 주석)다. 채팅은 `resume_interrupted_where`와 같은 채널 필터를 받는 `ChatQueue::resume_interrupted_where(keep)`로 같은 호출 안에서 함께 줄 세운다.
    - 로그인을 쓰지 않는 빌드: 매니저를 열 때 줄 세운다(`app.rs:154-160`의 `auto_resume: s.auto_resume_interrupted && auth.is_none()`).
    - 꺼져 있으면 [⋯] › "채팅 이어받기"를 기다린다.
  - 짧은 `SignedIn`을 놓치면 자동 이어받기가 다음 `SignedIn`까지 늦어진다. 이것은 영상과 같은 받아들인 동작이다(worker.md 구현 중 변경 57 끝).

### 4.3 생명주기 연동 표

| 사건 | 영상 | 채팅 |
|---|---|---|
| 받기(채팅 켬) | 그대로 | `Some(Waiting)`. 영상이 완료된 뒤 실행 |
| 영상 일시정지·앱 종료 | `Paused`·`Interrupted` | 아직 시작 전이라 `Waiting` 유지 |
| 영상 실패 | `Failed` | `Waiting` 유지. 영상을 이어받아 완료하면 그때 실행 |
| 영상 건너뜀(`Skipped`) | 그대로 | 실행하지 않는다. `Waiting` → `None`. [⋯] › "채팅 받기"로 받을 수 있다 |
| 채팅 실행 중 [⋯] › "채팅 일시정지" | 영향 없음 | `Paused`. `.part`·sidecar를 남긴다. 자동 이어받기 대상이 아니다 |
| 채팅 실행 중 앱 종료 | — | `Interrupted`. 자동 이어받기 대상이다(§4.2) |
| 처음부터 다시 받기(영상) | `.part` 버림 | 채팅 `.part`·sidecar도 버린다. 완성된 채팅 파일은 건드리지 않는다. 채팅을 다시 받을 때는 §4.5의 충돌 규칙을 따른다 |
| 목록에서 지우기(완료, 행 하나), 채팅 `.part` 없음(`None`·`Completed`·`.part` 없는 `Failed`, 아직 시작 전인 `Waiting`) | 파일 그대로 | 완성 파일 그대로. `Waiting`이면 `ChatQueue`에서 뺀다. 기존과 같은 지연 삭제다(토스트 `toast.removed` [되돌리기], patterns.md:260 §4 표 1행·patterns.md:891 §17-23) |
| 목록에서 지우기(완료, 행 하나), 채팅 `.part` 있음(`Running`·`Paused`·`Interrupted`·`Conflict`·`.part` 있는 `Failed`) | 파일 그대로 | 받은 채팅을 버리는 일이라 **비가역**이다(patterns.md:263 ".part 폐기 = 비가역"). 선례 "실패 항목과 받는 동안 생겨 건너뛴 항목은 `.part`가 있으면 D2"(patterns.md:891 §17-23)를 따라 D2 변형 `dialog.removeChat`(§5.5)을 연다. 확인하면 `ChatQueue`에서 빼고(`Running`이면 멈춘 뒤) 채팅 `.part`·sidecar를 지우고 레코드를 지운다(`remove_job`). [그대로 두기]면 아무것도 바꾸지 않는다. 영상과 완성된 채팅 파일은 어느 쪽이든 그대로다 |
| [완료 항목 지우기]·자동 정리(`prune_finished`, `MAX_FINISHED` = 100 `manager.rs:60`) | — | **두 곳을 함께 고친다.** UI의 [완료 항목 지우기]는 셸 `clear_finished`를 부르지 않는다. 프런트 `isClearable`(`app/src/lib/jobs.ts:630-633`, 셸 `Job::clearable`의 거울)로 고른 id를 숨긴 뒤 id마다 `remove_job`을 부른다(`app/src/lib/stores/jobs.svelte.ts:392-399`, patterns.md:891 §17-23). 그래서 셸만 고치면 실제 버튼이 `remove_job`으로 채팅 `.part`를 지운다. 같은 조건을 `isClearable`에도 넣는다(`job.chat`이 `waiting`·`running`이거나 `chat.partialBytes != null`이면 false). 행 하나 지우기의 길은 프런트 `removeRoute`(`jobs.ts:619-628`)에 채팅 조건을 더해 `confirm`(D2 변형)으로 보낸다. 셸 쪽은 채팅 `.part`가 있거나 채팅이 `Waiting`·`Running`인 작업은 `clearable()`(`manager.rs:160-165`)에서 **뺀다**. 두 경로가 같은 함수를 쓴다(`manager.rs:780-786`·`:1160-1165`). 선례는 `.part`가 남은 `Skipped`를 빼는 지금 규칙이다. 이유도 같다: "레코드만 지우면 파일이 버려진 채 남는다"(`manager.rs:157-159` 주석). 일괄 지우기는 "가역, 파일은 그대로, 확인 창 없음"(patterns.md:261)이므로 받은 부분을 지우는 동작을 이 경로에 넣지 않는다. 그래서 `Conflict` → `fetch_chat(id, false, Overwrite)`(§4.5-5)가 쓸 `.part`도 일괄 지우기·자동 정리로 사라지지 않는다. 빠진 작업은 행 하나 지우기(위 행, D2 변형)로만 지운다. `prune_finished`가 이런 작업을 세지 않아 완료 목록이 100개를 넘을 수 있는 것은 `.part` 있는 `Skipped`와 같은 받아들인 동작이다 |
| 완료 그룹 접힘(`COMPLETED_FOLD_AT` = 11, `consts.rs:29`) | — | 채팅이 `Running`인 행은 접힌 쪽에 넣지 않는다. 진행 중인 일이 숨지 않게 하려는 것이다. 접힘은 프런트가 계산하므로(`app/src/lib/jobs.ts:82`) 프런트 PR 5에서 한다 |
| 취소(`.part` 있는 영상) | `.part` 지움 | 시작 전이라 지울 것이 없다 |
| 덮어쓰기(`OnExisting::Overwrite`, 카드에서 D7 동의) | 덮어씀 | `ChatState.on_existing = Overwrite`. 같은 이름의 채팅 파일도 덮어쓴다. 카드의 충돌 검사(§4.4)가 채팅 파일까지 보고 D7에 이름을 넣는다 |
| 카드에서 덮어쓰기를 고르지 않음 | `Skip` | `Skip`. 받는 동안 같은 이름 파일이 생기면 `Conflict` |
| 번호 붙이기(`conflict.number`) | `{stem} (1).mp4` | 채팅도 `{stem} (1).*`(§3.3 `sibling_path`가 그대로 따른다) |
| 완료 · 파일 없음(`missing`, `dto.rs:681`) | — | [⋯] › "채팅 받기"를 숨긴다. 짝이 될 영상이 없다. `fetch_chat`도 영상 파일이 있는지 다시 확인한다(§4.5) |
| 생방송 녹화(`ContentRef::Live`, v0.7.0) | `stop_job`·`pause`·`quit`은 받은 만큼 마무리해 `Completed`가 된다(`manager.rs:494`·`:811`). 취소(`remove`)는 지운다 | 채팅 없음(`chat = None` 고정). 훅·[⋯] 항목·정리 규칙 모두 해당 없다. `enqueue`는 `save_chat: true`를 거부하고(§4.4), `fetch_chat`은 Video가 아니면 `invalid_input`이다(§4.5-2) |
| 구간 작업(②가 머지된 뒤에만 존재) | 구간 파일 | 카드 채팅 행을 숨기고 `save_chat`은 `false`로 보낸다. 완료된 구간 작업의 [⋯] "채팅 받기"도 숨긴다. 채팅 위치는 원본 영상 기준이라 구간 파일과 시각이 어긋난다[가정]. 숨김 조건은 ②와 ④ 중 **나중에 머지되는 쪽**이 건다(§12.1) |

### 4.4 command·DTO

| 이름 | 변경 |
|---|---|
| `EnqueueRequest`(`dto.rs:583`) | `#[serde(default)] save_chat: bool`. `on_existing`(`dto.rs:598`)은 영상과 채팅에 함께 적용한다. **`content`가 Video가 아니면(클립·생방송) `save_chat: true`를 `invalid_input`으로 거부한다.** `services::enqueue`가 이미 하는 요청 검증(`services.rs:573-576`) 바로 옆에 둔다. 카드가 클립·생방송에서 행을 숨기므로 정상 경로에서는 `false`만 오고, 이 가드는 숨김이 깨졌을 때 조용히 무시하지 않기 위한 것이다[가정] |
| `ResolvedDto`(`dto.rs:410`, 카드용 meta) | `ContentMetaDto.chat: ChatAvailabilityDto`(§3.5) |
| `check_output`(`manager.rs:425`)·`OutputCheck`(`dto.rs:553-563`) | 인자에 `save_chat: bool`과 자막 형식을 더한다. 채팅이 켜져 있으면 `exists`는 "영상 **또는** 같은 stem의 자막·기록이 있다"가 된다. `free_file_name`(번호 붙이기)은 세 이름이 모두 비는 번호를 고른다. 새 필드 `conflict_names: Vec<String>`은 실제로 덮어쓸 파일 이름 전부다(순서: 자막 → 기록 → 영상). D7 제목은 하나면 `‘{name}’`, 둘 이상이면 `‘{name}’ 외 {n}개`(첫 이름 + 나머지 수)다(§4.5-6, §5.5 `dialog.overwriteMany.title`). 자막을 맨 앞에 두는 이유는 사용자가 손으로 만든 파일일 가능성이 가장 큰 쪽(R9)이 제목에 보여야 하기 때문이다[가정] |
| `JobDto`(`dto.rs:659`) | `chat: Option<ChatStateDto>` |
| 새 command `check_chat_output(id, subtitle)` | 완료 작업의 채팅 파일 이름 충돌을 조회한다. `{ conflict_names: Vec<String> }`(자막 → 기록 순) |
| 새 command `fetch_chat(id, restart: bool, on_existing: OnExisting)` | 완료 작업의 채팅을 받거나 이어받는다(§4.5). `on_existing` 기본값은 없다. 프런트가 늘 명시한다 |
| 새 command `pause_chat(id)` | 실행 중인 채팅을 `Paused`로 바꾼다 |
| command 추가 절차 | `gate.rs`는 **고치지 않는다**. gate는 기본 거부다. 목록에 없는 새 command는 로그인이 있어야 부를 수 있다(`gate.rs:3-5`). 대신 `app/src-tauri/src/command_names.rs`, `commands.rs`, `lib.rs`의 `generate_handler!`, `capabilities/default.json`을 함께 고친다(`app/src-tauri/src/command_names.rs:2-3`, `tests/ipc.rs`가 검사). 가짜 백엔드 `OPEN_COMMANDS`(`gate.rs:7`)도 그대로 둔다 |
| `UserSettings`(코어 `crates/core/src/settings.rs`) | `save_chat: bool`(기본 false, 마지막 선택을 기억), `chat_subtitle: SubtitleFormat`(기본은 U2). 모르는 값은 기본값으로 읽는다(`settings.rs:74`·`:158` `lenient_or_default`). 셸은 설정 DTO·patch(`dto.rs:310`·`:367` 옆, `services.rs:308` 옆)에 같은 두 필드를 더한다 |

- DTO를 바꾼 PR은 `UPDATE_BINDINGS=1 cargo test -p chzzk-shell --test bindings`로 bindings를 다시 만든다(CLAUDE.md 명령).
- 같은 PR에서 가짜 백엔드 `app/e2e/mock/backend.ts`·`crates/shell/tests/common/fake.rs`와 spec을 함께 고친다(CLAUDE.md "command·DTO·화면 문구를 바꾸면 가짜 백엔드와 spec도 같이 고친다").
- `Backend` trait(`backend.rs:18`)에 `collect_chat`을 더한다. 가짜 Backend는 페이지 표를 받아 순서대로 낸다.
- 소유 검사: `enqueue`의 소유 검사는 command 쪽에서 한다(`manager.rs:374`). 채팅은 같은 작업의 하위 단계라 다시 묻지 않는다. 자동 이어받기는 §4.2의 채널 필터를, `fetch_chat`은 §4.5를 따른다.

### 4.5 채팅만 받기(`fetch_chat`)의 소유 검사와 덮어쓰기 동의

초안은 `fetch_chat`이 "`resume_checked`와 같은 길"을 탄다고 적었다. 그러나 `resume_checked`는 완료 작업을 `invalid_input`("완료된 작업은 다시 받을 수 없습니다")으로 거부한다(`manager.rs:565-569`, 근거 확인 C22). 그래서 새 길을 둔다.

따를 선례는 **이미 있는 작업을 다시 시작하는 `App::resume_job`(`app.rs:257-290`)**이다. 채팅만 받기도 기존 작업에 붙는 일이라 새 작업을 만드는 `enqueue`보다 이쪽에 가깝다. 그런데 `resume_job`의 판정 규칙은 worker.md 구현 중 변경 83 (가)("매니저 잠금 안에서 작업 채널을 로그인 채널과 비교한다", worker.md:999)가 아니라 그것을 고친 **86 (가)**(worker.md:1005)다. 86 (가)는 "매니저 잠금 밖에서 enqueue와 같은 `OwnershipGate::admit(작업 컨텐츠)`로 판정하고, 잠금 안에서 같은 컨텐츠인지만 다시 본 뒤 통과한 채널 ID를 기록에 고쳐 쓴다", "기록의 `channelId`는 판정에 쓰지 않는다"로 정한다. 그래서 잠금 안 채널 재비교를 두지 않는 것은 생략이 아니라 86 (가)를 따른 것이다. 기록 채널로 비교하면 `jobs.json` 변조로 판정을 속일 수 있어 86이 지운 규칙이다.

1. command `fetch_chat`은 `resume_job`과 같은 순서로 간다.
   - 로그인을 쓰지 않는 빌드(`!gate.is_enabled()`)는 판정 없이 2로 간다(`app.rs:258-260`, worker.md 구현 중 변경 82 (라)).
   - 매니저에서 작업 컨텐츠를 읽는다(잠금을 쥔 채 기다리지 않는다, `requeue_content` `app.rs:261`과 같은 모양). 완료가 아니거나 Video가 아니면 여기서 `invalid_input`이다.
   - 잠금 밖에서 `OwnershipGate::admit(&content, ..)`(`ownership.rs:118`, `app.rs:268-271`)를 부른다. 거부되면 `NotOwnContent`·`notLoggedIn`으로 끝나고 상태·`.part`를 바꾸지 않는다. `NotOwnContent`면 게이트가 아는 실제 채널로 기록만 고친다(`note_channel`, `app.rs:275-279`).
2. 허용되면 새 manager 메서드 `start_chat(id, restart, on_existing, check)`를 부른다(`resume_checked` `manager.rs:548-584`와 같은 모양). 이 메서드는 잠금 안에서 다음을 확인한다.
   - 작업 컨텐츠가 판정한 컨텐츠와 같다. 다르면 `ownership_unknown`이다(`app.rs:284-289`와 같다). 같으면 통과한 채널 ID를 기록에 고쳐 쓴다(`manager.rs:575-578`).
   - 작업이 `Completed`이고 컨텐츠가 Video다. 아니면 `AppError::invalid_input`.
   - 영상 최종 파일이 있다. 없으면 `invalid_input`이다. `JobDto.missing`(`dto.rs:681`)은 표시용 값이라 믿지 않고 다시 본다.
   - 채팅이 `Running`·`Waiting`이 아니다. 이미 돌고 있으면 그대로 둔다(멱등).
3. **덮어쓰기 동의는 `restart`와 따로다.** `restart`는 받다 만 `.part`를 버린다는 뜻일 뿐이다. 최종 파일 처리는 `on_existing`만 정한다. 근거는 영상이 `restart`와 `on_existing`을 따로 받는다는 것이다(`dto.rs:598-600`).
4. 프런트 흐름(완료 행 [⋯] › "채팅 받기"·"채팅 다시 받기"·"채팅 이어받기"):
   - `check_chat_output`이 충돌 없음 → `fetch_chat(id, restart, Skip)`을 바로 부른다.
   - 충돌 있음 → 대화상자 D7(content.md D7 행: "‘{name}’ 파일을 덮어쓸까요?" / "지금 있는 파일을 지우고 새로 받아요. 되돌릴 수 없어요." / [덮어쓰고 받기](danger) / [그대로 두기])을 연다. 제목은 `conflict_names`가 하나면 기존 D7 제목, 둘이면 `dialog.overwriteMany.title`이다. [덮어쓰고 받기]는 `fetch_chat(.., Overwrite)`이고, [그대로 두기]는 아무것도 하지 않는다.
   - 채팅만 받을 때는 **번호 붙이기를 고를 수 없다**. `{stem} (1).ass`는 영상 `{stem}.mp4`와 짝이 맞지 않아 플레이어가 열지 않는다(§3.3). 그래서 선택지는 D7의 둘뿐이다.
   - D7을 닫고 덮어쓰지 않은 사용자를 위해 메뉴에 새 경로는 더하지 않는다. 사용자가 파일을 옮기거나 지운 뒤 같은 메뉴를 다시 누르면 된다.
5. 받는 동안 같은 이름 파일이 생기면 `Skip`이 지킨다(§3.2-8) → `Conflict`. 행 [⋯] › `action.chatOverwrite`("채팅 덮어쓰고 받기…")가 D7을 거쳐 `fetch_chat(id, false, Overwrite)`를 부른다. `.part`가 남아 있어 받은 내용으로 곧바로 마무리된다(`part.rs:380-382`과 같은 규칙). 영상 건너뜀 행의 [덮어쓰고 받기…](patterns.md:264)와 같은 모양이다.
6. D7 이름 규칙: patterns.md 자체의 구현 중 변경 §17-27 "(c) D7 덮어쓰기(J17)"(patterns.md:895, §17 머리 patterns.md:867)는 카드 D7의 이름을 "저장될 파일 이름 + `.mp4`"로 정했다(app.md 구현 중 변경 27은 §15-6 reconcile 세부로 이것과 무관하다, app.md:1169). 영상과 사용자 자막 `X.ass`가 함께 있을 때 그 규칙대로 "‘X.mp4’ 파일을 덮어쓸까요?"만 보이면, 동의 한 번으로 `X.ass`까지 묻지 않고 덮어쓰게 된다(Codex 높음 "채팅만 받기"와 같은 구멍이 카드 경로에도 있다). 그래서 카드와 채팅만 받기 **모두** D7 제목이 실제로 덮어쓸 파일을 전부 가리키게 한다. 하나면 기존 제목(`dialog.overwrite.title`, `ko.ts:200`, content.md:180 D7 행)을 쓰고, 둘 이상이면 새 키 `dialog.overwriteMany.title` "‘{name}’ 외 {n}개 파일을 덮어쓸까요?"를 쓴다.
   - 키 모양: `design-copy` DC5는 `?`를 `dialog.*.title`에만 허용하고, 검사기는 키를 `/^dialog\.[^.]+\.title$/`로 맞춘다(`scripts/design/copy.mjs:746`, governance.md:201). 초안의 `dialog.overwrite.titleMany`는 이 정규식에 맞지 않아 DC5로 실패한다. 그래서 대화상자 이름을 따로 둔 `dialog.overwriteMany.title`로 바꿨다. `terms.json` allow 항목은 더하지 않는다(규칙을 넓히지 않고 키를 규칙에 맞춘다).
   - 본문과 버튼은 기존 키를 그대로 다시 쓴다: 본문 `dialog.overwrite.body`, 실행 쪽 `dialog.overwrite.confirm`(`ko.ts:201-202`), 안전 쪽 [그대로 두기](content.md:180). 새로 생기는 문자열은 제목 하나다. DC3(변수 뒤 조사 금지)의 패턴은 변수와 닫는 따옴표 바로 뒤의 조사 목록(이·가·을·를·은·는·과·와·로·의·에요·예요)만 잡는다(governance.md:199, 규칙 원천 `design/copy/terms.json:638-643`). `’ 외`는 띄어 쓴 다른 말이라 걸리지 않는다고 본다. PR 5에서 `design-copy`를 돌려 확인한다.
   - 영상만 겹치면 지금과 같다.
   - 기록할 곳: 이 규칙은 시각·문구 규칙이라 디자인 시스템이 단일 원천이다(CLAUDE.md 머리). 그래서 app.md가 아니라 PR 5에서 patterns.md §17에 새 번호로 적고(§17-27의 "이름 = 저장될 파일 이름 + `.mp4`"를 고친다는 뜻), content.md §5.3 표 D7 행에 제목 변형을 더한다.

### 4.6 생방송 녹화(v0.7.0)와의 접점(3차 개정)

v0.7.0은 생방송 녹화를 같은 `JobRecord`·큐·이벤트 위에 얹었다(core.md 58~60, app.md 77, 디자인 시스템 ADR-0025·D63). 채팅 쪽에서 확인한 것과 결정은 다음과 같다.

| 항목 | v0.7.0 사실(근거) | 채팅 쪽 결정 |
|---|---|---|
| 작업 행 모양 | 생방송도 같은 `JobDto`다. `kind = live`·`playbackKind = live`(필드는 `dto.rs:666-668`, `Live` 값은 `ContentKindDto::Live`, `dto.rs:211-222`. 프런트도 `kind === 'live'`로 본다, `app/src/lib/receive.ts:24` 쪽 기존 검사), 컨텐츠는 `ContentRef::Live { channel_id }`(`model.rs:27-29`) | `ChatState`는 `JobDto.chat`에 둔다. 생방송 작업의 `chat`은 늘 `None`이다. 프런트는 `chat == null`만 보지 않고 `kind`·`playbackKind`로 먼저 거른다(§5.3) |
| `JobEvent` | 변종은 그대로 넷이다: added·status·progress·removed(`dto.rs:775-795`, `app/src/lib/bindings/JobEvent.ts`). v0.7.0은 이벤트를 늘리지 않았다 | `Chat`을 다섯째 변종으로 더한다(§4.2). `app/src/lib/stores/jobs.apply.ts:87-91`의 `never` 검사는 그대로다 |
| `ProgressDto` | `live_recorded_secs`·`live_gaps` 둘이 늘었다(`dto.rs:733-736`, `bindings/ProgressDto.ts`). 길이를 모르는 대상은 막대·퍼센트를 만들지 않는다(D63) | 채팅 진행은 `ProgressDto`를 건드리지 않는다. `ChatState.percent`·`messages`로 따로 둔다. `ProgressDto`는 영상 바이트 진행이고 완료 행에서는 비기 때문이다(`finish`의 `Completed` 분기가 `last_progress = None`으로 비운다, `manager.rs:1109-1114`. `dto.rs:672`는 "마지막 진행률(running·pausing·paused에서 표시)"이라고만 적는다) |
| 완료 의미 | 생방송은 `stop_job`·`pause`·`quit` 모두 마무리해 `Completed`다. `pause`는 생방송에서 `stop_job`과 같다(`pause` 본문의 `StopReason::Finish`, `manager.rs:463-478`). `quit`도 마무리한다(모듈 머리 주석 `manager.rs:20-26`, app.md 77) | `finish`의 `Completed` 분기(`manager.rs:1109`)에 거는 채팅 훅은 `rec.chat == Some(Waiting)`일 때만 발동한다. 생방송은 `None`이라 발동하지 않는다 |
| 큐 | 생방송은 별도 lane(`MAX_LIVE = 3`, `manager.rs:63`). VOD 슬롯과 따로 센다 | `ChatQueue`는 두 lane 어느 쪽도 쓰지 않는다(§4.2). `running_count`(`manager.rs:367-369`)는 생방송을 세고 채팅은 세지 않는다 |
| 창 닫기 | `CloseGuard.svelte`가 생방송이 섞이면 `dialog.closeLive.*`를 연다(`hasLive`) | 채팅은 창 닫기 확인에 세지 않으므로(§4.2) 이 분기와 겹치지 않는다 |
| 자동 이어받기 | `.part`가 없는 생방송은 자동 이어받기에서 뺀다(`manager.rs:617-621`) | `ChatQueue::resume_interrupted_where`는 채팅만 다루는 별도 함수다. 이 필터와 무관하다 |
| 카드 | `kindTone`에 `live`가 늘었고(`receive.ts`) 카드에 방송 중 안내 Notice가 선다(`ResolveCard.svelte:256-259`) | 채팅 행은 클립과 같이 생방송에서도 없다(§5.2). Notice 자리와 채팅 행 자리는 겹치지 않는다 |
| 최근 영상·Dock | `recent_kind`는 `Option`이고 생방송은 `None`(`services.rs:604`). Dock 집계는 생방송을 건너뛴다(`dock.rs:73`) | 채팅 설정(`save_chat`)은 최근 영상과 무관하다. 채팅 진행도 Dock에 넣지 않는다(Dock은 `job.progress`만 본다) |
| 오류 코드 | `ErrorCode`에 `notLive`·`nothingRecorded`가 늘었다(`bindings/ErrorCode.ts`, core `error.rs:30-35`) | 채팅은 새 오류 코드를 만들지 않는다(§3.6). 표의 `ErrorKind → ErrorCode` match(`shell/src/error.rs:71-72`)는 이미 22개를 덮는다 |
| 용어 | D63이 "녹화"를 진행 중인 방송을 받는 일에만 쓰는 명사로 정했다(`content.md` 용어 표, ADR-0025) | 채팅 문구는 "받다"만 쓰고 "녹화"를 쓰지 않는다. `design-copy`가 용어를 보므로 PR 5에서 확인한다 |
| command 목록 | `stop_job`이 허용 목록 밖 command로 `app/src-tauri/src/command_names.rs`에 들어갔다(`:18`) | 채팅 command 셋도 같은 방식으로 더한다(§4.4). `gate.rs`는 고치지 않는다 |
| 테스트 도우미 | `JobDto`를 직접 만드는 곳이 있다: `dock.rs:191`의 테스트 도우미, `tests/dto_json.rs:189`. 프런트는 `app/src/test/jobFixtures.ts`, 가짜 백엔드 `app/e2e/mock/backend.ts`가 생방송 진행을 흉내 낸다. 셸 하니스에 `enqueue_live`가 있다(`tests/common/harness.rs:127`) | `JobDto.chat` 추가로 위 리터럴이 컴파일에서 깨진다. 필드 하나를 채우는 일이며 PR 4에서 함께 고친다(§12). 생방송 하니스로 "생방송은 채팅 훅이 없다"를 시험한다(§9.3) |
| 갤러리 | 배지 행이 하나 늘어 스냅샷 기준선이 바뀌었다. 기준선은 Linux CI에서만 만든다(app.md 77) | PR 5의 `design-shots`는 v0.7.0 이후 master 위에서 만든다. 기준선 받기는 `scripts/design/shots.mjs --accept <run id>`다(CLAUDE.md 명령) |

생방송 녹화가 채팅을 막지도 돕지도 않는다. 두 기능은 같은 목록에서 행 종류만 다르다. 합치는 코드가 없는 대신, "생방송이 아님"을 한 곳에서 거르는 조건이 서버(`enqueue` 가드·`fetch_chat`)와 화면(카드·[⋯])에 하나씩 있다.

---

## 5. UX

### 5.1 원칙

- **숨기지 않고 튀지 않게**(사용자 기준 ①, 2026-10-16). 채팅 행은 영상 카드의 기존 폼 행(FieldRow, ADR-0014) 하나다. 새 컴포넌트, 새 색, 새 배지, 새 배너는 없다(governance.md:390-396 §5 "기존 것 먼저", README.md:18 P2 "색은 두 뜻만"). 채움 버튼은 여전히 [받기] 하나다(README.md:19 P3).
- 발견 경로는 셋이다. 카드의 스위치(늘 보임), 설정 "받기" 섹션, 완료 행의 [⋯] 메뉴다. 마지막 선택을 기억하므로 한 번 켜면 다음 카드에서도 켜져 있다.
- 결과는 작업 행 상태 줄의 조각 하나로 보인다. 완료에 성공색은 없다(README.md:114 D10). 실패는 행 아래 본문 한 줄이다(patterns §10.3과 같은 위계). 토스트와 OS 알림은 더하지 않는다. 영상 완료 알림이 이미 있으므로 한 사건에 한 수단만 쓴다(patterns §1.1 규칙 1).
- 편집자(Q1): 편집 프로그램에 넣을 자막 형식(.srt)을 고르는 길이 숨지 않아야 한다. 카드 도움말 줄이 지금 형식을 늘 말하고, 그 자리에서 설정으로 가는 링크형 버튼 "형식 바꾸기"를 준다(§5.2).
- 카드에 더하는 상호작용 요소는 **둘**이다: 채팅 스위치와 도움말 줄 끝의 "형식 바꾸기". 둘 다 기존 컴포넌트다. 스위치는 Switch(components.md §2.6)이고, "형식 바꾸기"는 Button `variant="ghost"` `size="sm"`에 문장 속 링크형 클래스 `.btn-inline`(밑줄)을 준 것이다(components.md:839 §7-35 (나): "문장 속 링크형 버튼이 색만으로 구별되지 않게", WCAG 1.4.1). 구현에 있는 클래스이고(`app/src/styles/ui.css:125`), 로그인 화면이 같은 모양을 쓴다(`app/src/lib/views/LoginView.svelte:83` `variant="ghost" size="sm"` + `btn-inline`). Button의 `link` variant는 없앴으므로(components.md:58) 새 variant를 만들지 않는다. 보조 동작을 버튼 줄이 아니라 글 줄의 링크로 두는 위계는 오류 행의 "도움말은 버튼이 아니라 링크다"(patterns.md:486 §10.1)와 같은 결이다. 채움 버튼 수는 그대로다(README.md:19 P3). 이것이 "튀지 않는다"는 판단은 [가정]이다. PR 5의 `design-shots` 스냅과 리뷰 R1(네 장 스크린샷, patterns.md:863)로 확인한다.

### 5.2 영상 카드(patterns §14.2 (c)에 한 행 추가)

```
│ 화질      (●) 1080p  60fps  가장 좋은 화질               약 10.8GB     │
│ 12                                                                   │
│ 저장 폴더  ~/Movies/치지직                                   [변경…]   │
│ 12                                                                   │
│ 파일 이름  [ [251003] 채널이름 - 금요 저녁 방송 … ] .mp4 [원래 이름으로] │
│ 12                                                                   │
│ 채팅      채팅도 함께 받기                                    (●  )    │  FieldRow · Switch 54×24(components.md:266 §2.6)
│           영상과 같은 이름의 자막 파일(.ass)도 만들어요. 형식 바꾸기     │  card.chat.help.{ass|srt|none} caption muted + 링크 card.chat.format
│ 16                                                                   │
│──────────────────────────────────────────────────────────────────────│
│                                                [닫기]  8  [받기 ⌘↩]   │
```

| 경우 | 채팅 행 |
|---|---|
| 클립 | **행 없음** |
| 생방송(`kindTone` = `live`, v0.7.0) | **행 없음**. 카드에는 방송 중 안내 Notice(`card.live.body`)만 있다(`ResolveCard.svelte:256-259`) |
| 구간이 켜져 있음(②가 머지된 뒤에만 존재) | **행 숨김**. 사유 없는 비활성은 두지 않는다(`patterns.md:390`). 출처: plan.md 접점 표 "② 구간 × ④ 채팅" |
| 일반 VOD·빠른 다시보기, `chat = Enabled/Unknown` | 스위치. 기본값 = `settings.saveChat` |
| `chat = Disabled`(Q3 필드가 있을 때만) | 스위치에 `aria-disabled` + `aria-describedby` → `card.chat.disabled.off`(patterns §6.4) |
| 쿠키가 필요하다고 실측됐는데 쿠키가 꺼짐(Q1이 "안 된다"일 때만) | 스위치 비활성 + `card.chat.disabled.cookie` + ghost [네이버 로그인 정보 넣기…](`action.openCookieSettings`, `ko.ts:162`). 누르면 "설정 고급을 펼치고 첫 SecretField에 포커스"한다. 문구는 확인했고, 이 동작이 지금 구현과 같은지는 PR 5에서 확인한다[가정](D22) |
| 스위치 켬 + 같은 stem의 채팅 파일이 이미 있음 | 새 알림을 만들지 않는다. **기존 "같은 이름 파일" 충돌에 합친다**(§4.4 `OutputCheck`). 파일 이름 행 아래 warning Notice + `conflict.number`/`conflict.overwrite`(patterns.md:399). 덮어쓰기는 D7을 열고 제목은 `conflict_names` 전부를 가리킨다(§4.5-6) |

- 스위치를 바꾸면 `settings.saveChat`도 바뀐다. 저장 폴더 행과 같은 규칙이다(patterns §6.5 "바꾸면 설정의 기본 폴더도").
- "형식 바꾸기"(`card.chat.format`, Button ghost sm + `.btn-inline`, §5.1)는 설정 "받기" 섹션의 채팅 자막 RadioGroup으로 가서 포커스를 둔다. 카드 안에 RadioGroup을 두지 않는 이유는 카드 높이(아래)와 P3(확정 지점 하나)다. 라벨 끝에 `…`를 붙이지 않는다. `…`는 다른 창을 여는 버튼에만 쓴다(components.md §2.1 규칙, governance.md:201 DC5). 이 버튼은 창을 열지 않고 설정 화면으로 옮겨 갈 뿐이다. 초안의 대안 "ghost 버튼 [형식 바꾸기…]"는 지웠다. `형식 바꾸기`가 `terms.json` `opensWindow`(`design/copy/terms.json:711-720`)에 없어 DC5로 실패하고(`copy.mjs:750-755`), 뜻으로도 맞지 않는다.
- 행 순서는 파일 이름 다음이다. 파일 이름이 채팅 파일 이름을 정하므로 그 아래에 둔다.
- 접근성: Switch의 접근 이름은 `card.chat.switch`이고, 도움말은 `aria-describedby`로 잇는다. 단축키는 더하지 않는다.
- 카드 높이: 행 28 + 간격 12 + 도움말 줄이 늘어난다. 도움말 줄 높이는 caption 토큰과 대조하지 않았다(D13). 합계는 [잠정] 근거 없음, 실측·ADR-0009 묶음 등록. patterns §15의 높이 520 예산(506)은 이미 경고 하나만 있어도 넘친다(patterns.md:830). 그래서 최소 창에서는 채팅 행이 스크롤 아래로 갈 수 있다. sticky 바닥 줄은 [받기]만 보장하고 다른 컨트롤이 보이는 것까지 보장하지는 않는다(Codex Q12 판정). 발견 경로가 설정과 [⋯]에도 있으므로 받아들이되, `design-gallery` 720×520 최악 조합 스냅에 채팅 행을 넣어 "스크롤로 닿음"을 확인한다(patterns.md:835).

### 5.3 작업 행(patterns §3.2 표에 조각 추가)

상태 줄 끝에 ` · ` 뒤로 채팅 조각 하나를 붙인다(명사형, content §3.1 규칙 2). 막대, 퍼센트 칸, 동작 줄은 바꾸지 않는다.

| 영상 상태 | 채팅 | 상태 줄 | 본문 줄 | 동작 |
|---|---|---|---|---|
| 받는 중·대기·일시정지·실패 | `Waiting` | 영상 문구 그대로(채팅 조각 없음) | — | 그대로 |
| 완료 | `Waiting` | ✓ 완료 · 4.0GB · 3분 · `job.chat.waiting`(채팅 대기 중) | — | [열기] [폴더에서 보기] [⋯] |
| 완료 | `Running` | ✓ 완료 · 4.0GB · 3분 · `job.chat.running`(채팅 받는 중 · 38%) | — | 같음 |
| 완료 | `Paused`·`Interrupted` | ✓ 완료 · … · `job.chat.paused`(채팅 일시정지됨 · 38%) | — | 같음 |
| 완료 | `Completed` | ✓ 완료 · 4.0GB · 3분 · `job.chat.done`(채팅 12,345개). 0개면 `job.chat.none`(채팅 없음) | — | 같음 |
| 완료 | `Conflict` | ✓ 완료 · … · `job.chat.conflict`(채팅 파일 이름 겹침) | `job.chat.conflict.body` | 같음 |
| 완료 | `Failed` | ✓ 완료 · … · `job.chat.failed`(채팅 못 받음) | 오류별 본문 한 줄(§3.6·§5.5) | 같음. 쿠키 오류면 [폴더에서 보기] 자리에 [네이버 로그인 정보 넣기…]가 들어간다: [열기] [네이버 로그인 정보 넣기…] [⋯]. [⋯]는 늘 남는다(주소 복사·문제 보고용 정보 복사·지우기·채팅 이어받기 경로) |

- 동작 버튼은 **셋 이하**다(patterns §10.3 강제 "버튼 ≤ 3"). 채팅 동작은 [⋯] 메뉴에만 둔다. patterns §10.3은 "본문이 '문제 보고용 정보를 복사해'를 말하는 코드는 [문제 보고용 정보 복사]가 동작 줄에 있다"고 정한다. 완료 행은 버튼 셋이 이미 다 찼다. 그래서 채팅 실패 본문에는 복사를 말하지 않고, 복사는 L1인 [⋯]에 둔다(근거 확인 D18).
- 메뉴 항목은 상황마다 하나만 보인다.

| 채팅 상태 | [⋯] 항목 |
|---|---|
| `None`(`kind`가 영상이고 `playbackKind`가 `progressive`·`liveRewindHls`, 완료, 파일 있음. 클립·생방송 행과 구간 작업 행에는 항목이 없다) | `action.chatFetch`(채팅 받기) |
| `Running`·`Waiting` | `action.chatPause`(채팅 일시정지) |
| `Paused`·`Interrupted`·`Failed`(`chat.partialBytes` 있음) | `action.chatResume`(채팅 이어받기) |
| `Conflict` | `action.chatOverwrite`(채팅 덮어쓰고 받기…) → D7 |
| `Completed`·`Failed`(`chat.partialBytes` 없음) | `action.chatRefetch`(채팅 다시 받기). 완성 파일이 있으면 D7을 거친다(§4.5) |

- 메뉴 항목 키는 `action.*`이다. 기존 행 동작·메뉴 라벨(`action.remove`·`action.copyUrl`·`action.overwriteAndDownload`, `ko.ts:149-163`)과 같은 이름 공간이고, DC5 명세도 `…`를 `action.*`·`*.label` 끝에 둔다(governance.md:201). 초안의 `job.menu.*`는 선례가 없어 바꿨다.
- `action.chatOverwrite` "채팅 덮어쓰고 받기…"는 늘 D7을 여는 항목이라 `…`가 맞다(components.md §2.1 규칙). 그런데 검사기는 `…`를 뗀 글자가 `terms.json` `opensWindow`에 있어야 통과시킨다(`copy.mjs:750-755`). 목록(`design/copy/terms.json:711-720`)에는 "덮어쓰고 받기"만 있고 "채팅 덮어쓰고 받기"는 없다. 그래서 PR 5에서 `opensWindow`에 "채팅 덮어쓰고 받기"를 더하고, governance.md:201 DC5 명세의 목록도 같이 고친다. allow 항목으로 예외를 두지 않는 이유는 이 라벨이 예외가 아니라 규칙("다른 창을 여는 버튼 라벨 끝")에 맞는 경우이기 때문이다. "덮어쓰고 받기…" 하나로 줄이지 않는 이유는 완료 행 메뉴에서 영상 덮어쓰기로 읽힐 수 있어서다[가정].
- `action.chatRefetch` "채팅 다시 받기"는 완성 파일이 있을 때만 D7을 연다. 그래서 `…`를 붙이지 않는다. 조건부로 D7을 여는 카드 [받기](patterns.md:895 §17-27)에 `…`가 없는 것과 같다.

- 라이브 영역(P-9, patterns.md:201 "진행 틱은 라이브 영역에 읽히지 않는다. 상태 전이와 25% 단위만"): 채팅도 P-9를 그대로 따른다. 전이(`Completed`·`Conflict`·`Failed`)와 25% 단위를 `a11y.jobStatus`(`ko.ts:144`) 합성으로 알린다. 초안은 25% 단위를 뺐는데 이유가 없었다(D20). 그래서 규칙에 맞춘다.
- 퍼센트는 상태 줄 조각 안에만 있다. 막대를 다시 띄우지 않는다. 완료 행에 막대가 없다는 규칙(patterns §3.2), 스피너와 막대를 한 자리에서 바꾸지 않는다는 규칙(patterns.md:200 P-8)을 지킨다.
- 720 폭에서는 상태 줄이 말줄임되고, 접근 이름에 전체 문구가 들어간다(patterns.md:829).

### 5.4 설정("받기" 섹션, patterns §14.4)

```
│  받기                                                                      │
│  │ 동시에 받는 영상 수                                       [ 2 ▾ ]   │
│  │ …                                                                  │
│  │────────────────────────────────────────────────────────────────────│
│  │ 영상과 함께 채팅도 받기                                     (○  )   │ settings.chat Switch
│  │ 일반 VOD와 빠른 다시보기의 채팅을 영상 옆에 파일로 남겨요.             │ settings.chat.help
│  │────────────────────────────────────────────────────────────────────│
│  │ 채팅 자막     (●) 영상 플레이어용(.ass)                              │ settings.chatSubtitle RadioGroup 3개
│  │              ( ) 편집 프로그램용(.srt)                              │
│  │              ( ) 만들지 않기                                        │
│  │ 채팅 기록(.chat.jsonl)은 늘 함께 남아요.                              │ settings.chatSubtitle.help
```

- RadioGroup은 2~5개 규칙 안이다(patterns §6.3). 스위치가 꺼져 있어도 형식 행은 숨기지 않고 비활성으로 두지도 않는다. 카드에서 켤 때 쓸 값이기 때문이다.
- 즉시 저장한다. 저장 실패는 B2 배너다(patterns §2.3 설정 행, 기존).
- 라디오 순서는 U2 결정을 따른다. 기본값이 `.srt`로 정해지면 편집 프로그램용을 위로 올린다.

### 5.5 copy deck 초안(`app/src/lib/copy/ko.ts` + `content.md` §15.1 패리티, DC10 `content.md:10`)

용어집(content §4)에 한 행을 더한다.

| 개념 | 쓰는 말 | 쓰지 않는 말 | 비고 |
|---|---|---|---|
| 영상에 남은 시청자 메시지 | **채팅**: "채팅도 함께 받기", "채팅 12,345개" | 챗, 댓글, 대화 기록, 다시보기 채팅("다시보기" 단독 금지 규칙, content §4) | 동사는 **받다**(README.md:176 D42). 기록 파일은 "채팅 기록", 자막 파일은 "채팅 자막" |

| 키 | 문구 |
|---|---|
| `card.chat.label` | 채팅 |
| `card.chat.switch` | 채팅도 함께 받기 |
| `card.chat.help.ass` | 영상과 같은 이름의 자막 파일(.ass)도 만들어요. |
| `card.chat.help.srt` | 영상과 같은 이름의 자막 파일(.srt)도 만들어요. |
| `card.chat.help.none` | 채팅 기록 파일(.chat.jsonl)만 남겨요. |
| `card.chat.help.rewindLogOnly` | 빠른 다시보기는 채팅 기록 파일(.chat.jsonl)만 남겨요.(§11 Q4가 B일 때만) |
| `card.chat.format` | 형식 바꾸기 |
| `card.chat.disabled.off` | 이 영상은 채팅이 꺼져 있어요. |
| `card.chat.disabled.cookie` | 채팅을 받으려면 네이버 로그인 정보가 필요해요. |
| `job.chat.waiting` | 채팅 대기 중 |
| `job.chat.running` | 채팅 받는 중 · {percent} (길이를 모르면 `job.chat.runningCount` 채팅 받는 중 · {count}개) |
| `job.chat.paused` | 채팅 일시정지됨 · {percent} |
| `job.chat.done` | 채팅 {count}개 |
| `job.chat.none` | 채팅 없음 |
| `job.chat.conflict` | 채팅 파일 이름 겹침 |
| `job.chat.conflict.body` | 받는 동안 같은 이름의 파일이 생겨 덮어쓰지 않았어요. 받은 채팅은 그대로 있어요. |
| `job.chat.failed` | 채팅 못 받음 |
| `job.chat.failed.body.auth` | 채팅은 네이버 로그인 정보가 있어야 받을 수 있어요. 영상은 그대로 있어요. |
| `job.chat.failed.body.service` | 치지직이 잠시 응답하지 않아 채팅을 다 받지 못했어요. 영상은 그대로 있어요. |
| `job.chat.failed.body.network` | 연결이 끊겨 채팅을 다 받지 못했어요. 받은 부분은 그대로 있어요. |
| `job.chat.failed.body.disk` | 저장 공간이 부족해 채팅을 다 받지 못했어요. 받은 부분은 그대로 있어요. |
| `job.chat.failed.body.locked` | 다른 프로그램이 자막 파일을 쓰고 있어 마무리하지 못했어요. 받은 부분은 그대로 있어요. |
| `job.chat.failed.body.other` | 채팅을 받지 못했어요. 영상은 그대로 있어요. |
| `dialog.overwriteMany.title` | ‘{name}’ 외 {n}개 파일을 덮어쓸까요?(D7 변형. 본문·버튼은 `dialog.overwrite.body`·`dialog.overwrite.confirm`을 다시 쓴다(`ko.ts:201-202`). `{n}`은 `formatCount`. 키 모양은 DC5 정규식 `copy.mjs:746`에 맞춘 것이다, §4.5-6) |
| `dialog.removeChat.title` | ‘{title}’ 항목을 목록에서 지울까요?(D2 변형, §4.3. 키 모양은 `dialog.*.title`이라 `?`가 허용된다) |
| `dialog.removeChat.body` | 영상 파일은 그대로 있어요. 받다 만 채팅 파일은 지워지고 되돌릴 수 없어요.(영상이 무사하다는 것을 먼저 말한다, 아래 C6 규칙) |
| `dialog.removeChat.confirm` | 지우기(danger, components.md §2.1 "되돌릴 수 없는 동작만 `tone="danger"`") |
| (안전 쪽) | `dialog.cancel.keepPaused` "그대로 두기"(`ko.ts:192`)를 다시 쓴다 |
| `action.chatFetch` | 채팅 받기 |
| `action.chatPause` | 채팅 일시정지 |
| `action.chatResume` | 채팅 이어받기 |
| `action.chatRefetch` | 채팅 다시 받기 |
| `action.chatOverwrite` | 채팅 덮어쓰고 받기…(`terms.json` `opensWindow`에 "채팅 덮어쓰고 받기"를 더한다, §5.3) |
| `settings.chat` | 영상과 함께 채팅도 받기 |
| `settings.chat.help` | 일반 VOD와 빠른 다시보기의 채팅을 영상 옆에 파일로 남겨요. |
| `settings.chatSubtitle` | 채팅 자막 |
| `settings.chatSubtitle.ass` | 영상 플레이어용(.ass) |
| `settings.chatSubtitle.srt` | 편집 프로그램용(.srt) |
| `settings.chatSubtitle.none` | 만들지 않기 |
| `settings.chatSubtitle.help` | 채팅 기록(.chat.jsonl)은 늘 함께 남아요. |

- 숫자는 format 함수로 만든다. `{count}`는 `formatCount`(content.md:257 §7 개수 행: 세 자리 쉼표, `만`·`억` 축약 금지)다. `{percent}`는 기존 퍼센트 format이다. 초안은 근거로 D47을 댔는데, D47은 바이트 규칙이다(README.md:181, 근거 확인 D25).
- 본문은 해요체이고, 영상이 무사하다는 것을 먼저 말한다(README.md:21 C6, "받은 부분은 그대로 있어요"와 같은 결). 실패 본문과 `dialog.removeChat.body` 모두에 적용한다.
- 실패 본문 `body.service`는 408·429·5xx에만 쓴다. 400은 "잠시 응답하지 않아"가 사실이 아니라서 `body.other`로 간다(§3.6). 진단 3분류(`local`/`service`/`unknown`, patterns §10.3)에 맞춰 사용자의 인터넷을 먼저 탓하지 않는다. `body.network`는 `Network`일 때만 쓴다.
- `design-copy` 금지어: "저장하다(영상에)"를 쓰지 않는다(content §4). 기능 이름도 "채팅 함께 **받기**"로 맞춘다(D42).

### 5.6 갤러리·상태 선언

- `/__gallery`에 카드 채팅 행의 네 경우(켬, 끔, 비활성 사유, 이미 있음), 완료 행의 채팅 상태 일곱(대기, 받는 중, 일시정지, 완료, 0개, 겹침, 실패), 대화상자 `dialog.overwriteMany`·`dialog.removeChat`을 더한다(`design-gallery`). 초안의 "앞 40자가 같은 제목 둘" 규칙은 출처를 찾지 못해 지웠다(근거 확인 D29).
- 상태 6종 선언(patterns §2.1·§2.3 표, 이름은 empty·loading·partial·error·success·stale)은 다음과 같다.

| 화면·영역 | empty | loading | partial | error | success | stale |
|---|---|---|---|---|---|---|
| 카드 · 채팅 행 | — | — | 이미 있음(충돌 Notice), 비활성 사유 | — | — | — |
| 완료 행 · 채팅 조각 | `job.chat.none`(0개 확정) | `Waiting`·`Running`(퍼센트 또는 개수) | `Paused`·`Interrupted`·`Conflict`(받은 부분 있음, 이어받기 가능) | `Failed` 본문 한 줄 | `job.chat.done` | — |

---

## 6. Worker 변경

**없다.** 채팅은 앱이 치지직에서 직접 받고 Worker를 거치지 않는다. 코어가 치지직 API를 직접 부른다(`client.rs:202-212`, 근거 확인 E7). 앱 ↔ Worker 계약도 바뀌지 않는다.
- `/help`에 "채팅도 받기" 절을 더하는 일은 선택이다. 필요하면 별도 PR로 한다(Worker 생성 모듈 `help.generated.ts`). 이 설계의 단계에는 넣지 않는다.
- `/privacy`의 처리 범위도 바뀌지 않는다. 채팅 파일은 사용자 컴퓨터에만 남고 어디로도 보내지 않는다.

---

## 7. 비밀값과 개인정보

| 규칙 | 적용 |
|---|---|
| 쿠키 | `RequestKind::Api` 규칙 그대로다(`http.rs:155-166`). `use_naver_cookies`가 켜졌을 때만 보낸다(`services.rs:174`). 미디어 CDN 요청은 없다 |
| 서명 토큰 | 채팅 요청에는 서명 토큰이 없다[가정](원자료 기준). 그래도 요청 URL은 `fetch`가 `http::redact_url`을 거쳐 로그에 남긴다(`client.rs:203`) |
| 제3자 정보 | 닉네임, 본문, 작성자 해시, 프로필은 **채팅 파일 밖 어디에도 나오지 않는다.** `tracing` 로그, `AppError.message`, `Parse.detail`, "문제 보고용 정보 복사", 진행 이벤트가 모두 해당한다. 로그에는 페이지 수, 메시지 수, 종료 사유, HTTP 상태 범주만 남긴다 |
| `Debug` | `ChatMessage`는 `Debug`를 손으로 구현한다. 재생 위치와 종류만 보이고 `raw`는 `***`다. `ChatPage`는 메시지 수만 보인다. 저장소 규칙은 "서명 값을 품는 새 타입"이 대상이다(CLAUDE.md 주의사항). 그것을 제3자 정보까지 넓힌 것은 이 설계의 선택이다(근거 확인 B23) |
| 파일 권한 | 채팅 파일은 영상과 같은 폴더, 같은 권한이다. 자격증명 파일이 아니므로 0600을 강제하지 않는다 |
| 공개 저장소 | fixture의 닉네임, 본문, 해시, 채널 ID는 모두 합성 값이다(`가상시청자1`, `테스트 메시지`). 실제 응답 원문은 testdata에 넣지 않는다. 엔드포인트 경로는 코드에만 있고 문서에는 쓰지 않는다 |
| 실측 도구 | 출력은 된다/안 된다, 범주, 예/아니오뿐이다. 닉네임, 본문, ID, 응답 원문, HTTP 본문은 출력하지 않는다 |

이 기능에서 `public-scan` 규칙에 걸릴 만한 실제 값은 새로 생기지 않는다.

---

## 8. OS별 분기

| 항목 | Windows | macOS | Linux |
|---|---|---|---|
| 이름 정리 | `sibling_path`는 정리가 끝난 영상 이름에서 확장자만 바꾼다. 예약어, 끝의 `.`·공백은 이미 처리돼 있다. 테스트는 `naming::Platform`(`naming.rs:22`) 세 값으로 한다 | 같음 | 같음 |
| 전체 경로 길이 | 기록 sidecar 경로는 영상 경로보다 17자 길다. `WINDOWS_PATH_MAX_UTF16`(259, `consts.rs:27`)은 정의만 있고 쓰는 곳이 없다(§13 R6). 채팅 경로가 259를 넘으면 채팅만 `Failed(io)`가 되고 영상은 무사하다 | 해당 없음 | 해당 없음 |
| rename | `Skip`은 `rename_noclobber_with_retry`, `Overwrite`는 `rename_with_retry`(일시 잠금 재시도)다. 플레이어가 `.ass`를 열고 있으면 덮어쓰기 rename이 막힐 수 있다 → `FileLocked` → `body.locked`[가정](Windows 잠금 동작, 실기 확인 필요) | 그대로 | 그대로 |
| 디스크 부족 | 코드 112·39 → `DiskFull`(`fsutil.rs:214-215`) | ENOSPC | ENOSPC |
| 줄바꿈 | 자막과 기록 모두 `\n`이다. SRT는 `\r\n`을 쓰는 도구가 있지만, 주요 플레이어와 편집기는 `\n`도 읽는다고 본다[실측 필요](§13 R5) | 같음 | 같음 |
| 인코딩 | UTF-8, BOM 없음. SRT에만 BOM을 붙일지는 열린 질문이다(옛 Windows 도구 호환, R5와 함께 확인) | 같음 | 같음 |
| "폴더에서 보기" | 영상 파일을 선택한다(기존). 채팅 파일은 그 옆에 보인다 | Finder 같음 | 같음 |

---

## 9. 테스트 계획(TDD)

명세가 분명한 부분은 실패하는 테스트를 먼저 쓴다. 보강 테스트는 구현을 일부러 깨 보고 실제로 잡히는지 확인한다.

### 9.1 합성 fixture(`testdata/chat/`, 생성기 `scripts/fixtures/gen-fixtures.mjs`)

| 파일 | 내용 |
|---|---|
| `page_first.json` | 앞쪽 묶음 3 + 뒤쪽 묶음 5, 다음 커서 있음 |
| `page_boundary.json` | 첫 메시지가 직전 페이지 마지막과 **같은 ms**: 되풀이된 메시지 1, 다른 메시지 1 |
| `page_boundary_twins.json` | 같은 ms에 작성자·본문까지 같은 메시지 둘(앞 페이지에 1, 뒤 페이지에 그 하나의 되풀이 + 새 쌍둥이 1) |
| `page_last_null.json` | 다음 커서 없음 |
| `page_not_advancing.json` | 다음 커서 = 지금 커서 |
| `page_empty.json` | 뒤쪽 묶음이 빈 배열 |
| `page_kinds.json` | 일반, 후원, 구독, 시스템, 모르는 종류, 가려진 메시지, 프로필 없음, 프로필 문자열 깨짐 |
| `page_escape.json` | `{`·`}`·`\`·줄바꿈·제어 문자·숫자만 있는 본문·이모티콘 자리표시 |
| `page_bad_shape.json` | 필수 필드 타입이 틀림(Parse, detail에 원문이 없는지 확인) |
| `expected/*.ass`·`*.srt` | 골든 출력 |

`gen-fixtures.mjs --check`가 fixture와 골든이 생성기 결과와 바이트 단위로 같은지 본다. `.gitattributes`의 `-text`로 바이트 그대로 체크아웃한다(CLAUDE.md 레이아웃 `testdata/`).

### 9.2 코어 단위·통합

- `chat::page`: fixture마다 파싱 결과를 본다. 모르는 종류는 `Other`, 가려진 메시지는 `hidden`이다. 프로필이 깨져도 페이지는 성공한다.
- `chat::walk`: 종료 조건 셋을 표 테스트로 확인한다. 경계 중복 제거는 `page_boundary`에서 되풀이 하나만 버려지는지, `page_boundary_twins`에서 새 쌍둥이가 남는지 본다.
- `chat::retry::classify`: 401·403 → `Fatal(AuthRequired)`, 408·429·5xx·`Network` → `Retry`, 400·404·`Parse` → `Fatal`. **403이 `Expired`로 가지 않는다**는 것도 표에 넣는다(미디어 분류와 섞이지 않음, B4).
- **400 음성 테스트**(Codex "400 의미"): (가) 첫 페이지 400 → `Err(HttpStatus{400})`이고 `Completed`가 아니다. (나) 둘째 페이지 400 → `Err(HttpStatus{400})`이고, `.part`·sidecar에 첫 페이지 줄이 남아 이어받을 수 있다. (다) `Completed { messages: 0 }`은 첫 페이지가 성공(2xx)하고 비었을 때만 나온다. §11 Q8에서 400의 정상 끝 조건을 더하더라도 (가)·(나)의 "조건 밖 400" 사례는 지우지 않고 남긴다.
- `chat::part`(PR 2): 덧붙이기 → 중간에 끊긴 `.part`(sidecar보다 김) → 이어받을 때 잘림 → 중복 없이 이어짐. sidecar가 없으면 처음부터 받는다.
- `chat::part` 마무리: `Skip`일 때 최종 이름이 이미 있으면 옮기지 않고 기존 파일의 **바이트가 그대로인지** 단언하며, `.part`·sidecar가 남는지 본다. `Overwrite`면 바뀐다. 검사 시점에는 없다가 마무리 직전에 생긴 파일도 같은 결과여야 한다(경쟁 테스트, Codex "덮어쓰기").
- `chat::subtitle`(PR 1): 골든 비교. 영상 길이 + `CHAT_TAIL_MS`를 넘는 메시지가 빠지는지 본다. 입력이 비면 헤더만 있는 유효한 파일이 나온다.
- `tests/chat.rs`(wiremock): 페이지 셋을 연속으로 받아 완성 파일과 메시지 수를 본다. 429 두 번 뒤 성공. 재시도 경계(§3.2-5): 429 세 번 뒤 네 번째 성공 → `Completed`, 429 네 번 → `HttpStatus{429}`(`max_attempts = CHAT_RETRY_MAX + 1`을 `CHAT_RETRY_MAX`로 바꿔 보면 실패해야 한다). 401 → `AuthRequired`. 요청 간격 ≥ `CHAT_PAGE_INTERVAL_MS`(테스트 시계). 쿠키가 꺼져 있으면 쿠키 헤더가 없고, 켜져 있으면 있다. 취소 토큰이 오면 `.part`를 남긴다.
- `naming::sibling_path`(PR 1): 세 OS, 200바이트를 꽉 채운 이름, `(1)`이 붙은 이름, 대문자 `.MP4`.
- `Debug` 가림: `format!("{:?}", msg)`에 본문 fixture 문자열이 없다.
- fuzz: `chat_page` target을 더할지는 열린 항목이다. 파서가 serde 하나라 기존 `info` target 수준이면 충분하다고 본다[가정]. PR 1에서 정한다.

### 9.3 셸

- `tests/manager_chat.rs`(가짜 Backend): 영상 완료 → 채팅 실행 → `JobEvent::Chat` 순서. 채팅이 실패해도 `JobStatus::Completed`가 유지된다. 큐는 한 번에 하나만 돈다. §4.3 표의 행마다 테스트 하나.
- `jobs.json` 호환: `chat` 필드가 없는 옛 파일을 읽고, 새 파일을 다시 쓴 뒤 `JOBS_VERSION`이 1 그대로인지 본다.
- 재시작 규칙(§4.2) 표 테스트:
  - (영상 미완료, `Waiting`) → 그대로 → 영상이 완료되면 실행.
  - (영상 완료, `Waiting`) → `Interrupted`.
  - (`Running`) → `Interrupted`.
  - (`Paused`) → `Paused` 그대로이고 자동 이어받기 대상이 아니다.
  - 로그인 빌드: `on_auth_status(SignedIn, 채널 A)`에서 A 채널 `Interrupted` 채팅만 줄을 서고, B 채널 채팅은 서지 않는다. 관리자는 모두 선다. `SignedIn` 전에는 하나도 서지 않는다.
  - 로그인 없는 빌드: 열 때 줄을 선다. 자동 이어받기 켬·끔 둘 다 확인.
- 정리 규칙(§4.3): 채팅이 `Waiting`·`Running`이거나 채팅 `.part`가 있는(`Paused`·`Interrupted`·`Conflict`·`.part` 있는 `Failed`) 완료 작업이 `clear_finished`·`prune_finished`에서 빠지고 `.part`·sidecar가 그대로인지 본다(`MAX_FINISHED`를 넘겨도 지워지지 않음). `Conflict` 작업을 `clear_finished` 뒤에 `fetch_chat(id, false, Overwrite)`하면 남은 `.part`로 마무리되는지 본다. `remove_job`으로 지울 때만 채팅 `.part`·sidecar가 사라지는지 본다. 이 테스트는 `clearable()`에서 채팅 조건을 빼 보면 실패해야 한다.
- `check_output`: 영상은 없고 `{stem}.ass`만 있을 때 `exists = true`, `conflict_names = [{stem}.ass]`인지, `{stem}.mp4`와 `{stem}.ass`가 함께 있으면 `[{stem}.ass, {stem}.mp4]`(둘 다 보임)인지, 번호 붙이기가 세 이름이 모두 비는 번호를 고르는지 본다.
- `fetch_chat`:
  - `OwnershipGate` 거부 → `NotOwnContent`이고 채팅 상태가 바뀌지 않는다. 기록 채널만 게이트가 아는 실제 채널로 고쳐진다(`note_channel`).
  - 판정과 `start_chat` 사이에 작업 컨텐츠가 달라지면 → `ownership_unknown`이고 아무것도 시작하지 않는다(`resume_job` 테스트와 같은 모양).
  - 로그인을 쓰지 않는 빌드 → 판정 없이 받는다.
  - 기록의 `channelId`를 남의 채널로 바꿔도 판정은 컨텐츠로 한다(worker.md 구현 중 변경 86 (가)).
  - 클립 작업 → `invalid_input`.
  - 완료가 아닌 작업 → `invalid_input`.
  - 영상 파일 없음 → `invalid_input`.
  - `{stem}.ass`가 있고 `on_existing = Skip` → 받기는 끝나도 `Conflict`가 되고 기존 `.ass` 바이트가 그대로다.
  - `restart = true, on_existing = Skip`도 기존 파일을 덮어쓰지 않는다(`restart` ≠ 동의).
  - `Conflict`에서 `fetch_chat(id, false, Overwrite)` → 요청 없이 곧바로 마무리된다.
- 생방송과의 접점(v0.7.0, `enqueue_live` `tests/common/harness.rs:127`):
  - 생방송 작업이 `stop_job`·`pause`·`quit`으로 `Completed`가 돼도 `ChatQueue`에 들어가지 않고 `chat`이 `None`이다.
  - 클립·생방송 요청에 `save_chat: true`를 실으면 `enqueue`가 `invalid_input`이다(§4.4). 가드를 지우면 이 테스트가 실패해야 한다.
  - 완료된 생방송에 `fetch_chat`을 부르면 `invalid_input`이다.
  - `JobDto`를 직접 만드는 테스트 도우미(`dock.rs:191`, `tests/dto_json.rs:189`)와 `ContentMeta` 리터럴(§3.5)이 새 필드로 컴파일된다.
- command 등록: `tests/ipc.rs`가 새 command 셋을 capabilities·`app/src-tauri/src/command_names.rs`·처리기에서 찾는다(기존 검사). gate 쪽은 새 command가 로그아웃 상태에서 `notLoggedIn`인지 본다.
- 로그 누출: 채팅 실패 경로의 `tracing` 출력을 붙잡아 fixture 본문·닉네임 문자열이 없는지 본다.

### 9.4 프런트·E2E

- vitest(PR 5): `isClearable`이 채팅 `waiting`·`running`·`partialBytes` 있음을 false로 내고, [완료 항목 지우기]가 그 작업에 `remove_job`을 부르지 않는지. `removeRoute`가 채팅 `.part`가 있는 완료 작업을 `confirm`으로 보내는지. 둘 다 채팅 조건을 빼 보면 실패해야 한다.
- vitest(PR 4): `app/src/lib/stores/jobs.apply.ts`의 `Chat` 이벤트 적용(같은 id의 `chat`만 바뀌고 영상 상태·퍼센트 Map은 그대로), 모르는 id 무시, `Removed` 뒤 늦게 온 `Chat` 무시. 재동기화(`subscribe_jobs` 첫 목록)에 `chat`이 실려 오는지.
- vitest(PR 5): 카드 채팅 행 경우 표(§5.2, `kindTone`이 `clip`·`live`면 행이 없다), 완료된 생방송·클립 행의 [⋯]에 채팅 항목이 없다(§5.3), 상태 줄 조각 표(§5.3), [⋯] 항목 표, 동작 버튼 ≤ 3, 실패 본문에 "복사"가 없음, D7 제목이 `conflict_names` 수에 따라 `dialog.overwrite.title`·`dialog.overwriteMany.title`로 갈림, 채팅 `.part`가 있는 완료 행의 [목록에서 지우기]가 `dialog.removeChat`을 열고 [그대로 두기]면 `remove_job`이 불리지 않음, 채팅 `Running` 행이 접히지 않음, P-9 25% 단위 알림.
- Playwright(`app/e2e/`): 카드에서 스위치를 켜고 받기 → 완료 행에 "채팅 12,345개". 클립 카드와 생방송 카드에는 행이 없다(`app/e2e/live.spec.ts`에 단언 한 줄을 더한다[가정]). 완료 행 [⋯] › "채팅 받기"에서 가짜 백엔드가 충돌을 돌려주면 D7이 열리고, [그대로 두기]를 누르면 `fetch_chat`이 불리지 않는다. axe 통과.
- 네이티브 E2E(`e2e-fixture-server.mjs`): 채팅 페이지 fixture를 서빙해 받기 한 번에 세 파일이 생기는지 본다.
- `design-copy`: 새 키의 어미·금지어, content.md §15.1 패리티.

---

## 10. 사용자 실측 도구 `vod-chat-check`(PR 1)

`crates/core/examples/vod_chat_check.rs`. Rust로 쓴다. 쿠키를 기존 `CredentialStore`(`lib.rs:10` 공개 모듈)와 `RequestKind::Api` 규칙 그대로 쓰기 위해서다. `examples/dl.rs`가 선례다. 사용자가 본인 VOD에서 직접 돌리고, 결과만 ROADMAP에 적는다(`worker/scripts/channel-id-check.mjs`와 같은 방식, CLAUDE.md 명령).

- 입력: 본인 VOD 주소 하나(필수). `--cookies`(기존 자격증명 저장소를 읽는다. 값은 출력하지 않는다), `--rewind`(빠른 다시보기임을 알린다), `--write-ass <받은 mp4 경로>`·`--write-srt <받은 mp4 경로>`(수동 확인용 자막을 만든다. **PR 1에 들어가는 제품 `chat::subtitle`과 `naming::sibling_path`를 그대로 쓴다. 임시 렌더러는 없다**, §10.1). 자막은 그 mp4 옆에 `sibling_path`로 정한 이름으로 쓰고 내용은 출력하지 않는다. 둘을 함께 주면 사용법 오류다: 한 폴더에 `.ass`와 `.srt`가 같이 있으면 플레이어가 고르는 쪽이 달라질 수 있다[가정](§3.3). 같은 이름 파일이 이미 있으면 덮어쓰지 않고 멈춘다(R9). 받은 mp4가 입력 주소의 영상인지는 도구가 확인하지 못하므로 사용자가 맞춘다. 영상 길이는 `resolve`의 `ContentMeta.duration_secs`(`model.rs:43-55`)에서 얻는다.
- 요청 간격은 `CHAT_PAGE_INTERVAL_MS` 이상이고, 429는 `CHAT_RETRY_MAX`회까지 지수 백오프한다(둘 다 [잠정], §3.2-6).
- 출력은 한 줄씩, 아래 것만이다.

| # | 출력 | 답하는 질문 |
|---|---|---|
| 1 | `비로그인 첫 페이지: 된다 \| 안 된다(400 \| 401·403 \| 그 밖 4xx \| 5xx)` | Q1 |
| 2 | `로그인 첫 페이지: 된다 \| 안 된다(400 \| 401·403 \| 그 밖 4xx \| 5xx) \| 건너뜀` | Q2 |
| 3 | `info에 채팅 사용 여부 필드: 있다 \| 없다` | Q3 |
| 4 | `끝 신호: 커서 없음 \| 커서 멈춤 \| 빈 페이지 \| 400`, `400이 난 위치: 없음 \| 첫 페이지 \| 마지막 커서 < 길이 \| 마지막 커서 ≥ 길이` | Q8(400 의미) |
| 4b | `경계 ms 되풀이: 없음 \| 전부 \| 일부`, `같은 ms·같은 묶음 해시 둘 이상: 예 \| 아니오` | 경계 중복 제거(§3.2-4) |
| 5 | `페이지 수: <10 \| 10~100 \| 100~1000 \| >1000`, `429 만남: 예 \| 아니오` | Q5 |
| 6 | `재생 위치 단조 증가: 예 \| 아니오`, `마지막 재생 위치 ≤ 길이+CHAT_TAIL_MS: 예 \| 아니오` | Q6 |
| 7 | `작성 시각 − 재생 위치 흩어짐 ≤ 2초: 예 \| 아니오`(2초는 [잠정] 근거 없음, 실측·ADR-0009 묶음 등록) | Q4 단서 |
| 8 | (수동) `--write-ass <mp4>`로 만든 `.ass`를 받은 mp4 옆에 두고 mpv와 VLC로 연다(플레이어는 이 둘로 한정한다, 아래 첫째 항목) → 사용자가 `자동으로 열림: mpv 예·아니오 / VLC 예·아니오`, `시각: 맞다 \| 어긋난다`만 ROADMAP에 적는다 | Q4, A16 |
| 9 | (선택, 수동) `--write-srt <mp4>`로 만든 `.srt`를 편집 프로그램 하나에 넣어 본다 → `읽힘: 예 \| 아니오`, `겹친 줄: 보임 \| 가려짐` | R5, U2(편집자) |

- **시각 확인에 쓰는 플레이어(3차 개정)**: 받은 mp4는 조각 구조(fMP4)를 이어 붙인 파일이다(`download/mod.rs:6`). v0.7.0의 일반 mp4 변환은 생방송 결과에만 걸린다(`download/mod.rs:372`, core.md 60). QuickTime은 조각 구조 파일에서 첫 조각 길이만 보고 탐색이 안 된다고 core.md 60이 실물로 확인했다. 그러므로 출력 8의 "시각" 판정을 QuickTime으로 하지 않고 mpv·VLC로 한다. 이 두 플레이어가 빠른 다시보기 mp4의 길이·탐색을 바르게 다루는지는 이 실측이 함께 알려 준다[실측 필요]. 일반 VOD(progressive) mp4는 조각 구조가 아니다.
- 도구는 `examples/`라 릴리스 번들에 들어가지 않는다고 본다. Tauri 번들은 앱 바이너리만 담는다는 일반 지식에 따른 판단이고, 저장소 문서로는 확인하지 않았다[가정](B22). PR 1에서 `release/expected-artifacts.json`과 대조해 확인한다. `public-scan` 대상이므로 상수에 실제 값을 넣지 않는다.
- 순수 판정 함수(범주 나누기, 흩어짐 계산)는 `chat::probe` 모듈로 떼어 단위 테스트한다(`worker/test/code-binding-lib.mjs`와 같은 분리, B21).

### 10.1 도구와 자막 렌더러의 PR 배치(3차 개정, Codex 2회차 N5)

**문제.** 이전 판은 실측 도구(PR 1)에 `--write-ass`를 두고 출력 8·9의 호환성 판정을 요구했다. 그러나 자막을 만드는 `chat::subtitle`은 PR 2에 있었고, SRT를 만드는 경로는 도구 인자에 없었다. plan.md §5는 도구 PR을 먼저 묶어 머지해 한 세션에서 실측한다고 한다. 그 세션에서 자막 파일을 만들 수 없었다.

| | 가 | 나 |
|---|---|---|
| 내용 | `chat::subtitle`(골든 포함)과 `naming::sibling_path`를 **PR 1로 옮긴다**. 도구에 `--write-ass`·`--write-srt`를 둔다 | PR 1은 지금대로 두고, **PR 2까지 머지한 뒤** 실측한다. 도구의 `--write-*`는 PR 2가 더한다 |
| 실측 전 머지 PR | PR 1 하나 | PR 1과 PR 2, 그리고 도구가 두 PR에 갈라진다 |
| 도구의 모양 | 한 PR에서 끝난다 | PR 1의 도구에 자막 인자가 없고 PR 2가 같은 파일을 다시 고친다 |
| 렌더러 중복 | 없다 | 없다 |

**선택: 가.** 근거는 다음과 같다.
1. plan.md §5가 도구 PR(②-0·③-1·④-1·⑤-1)을 `[P]`로 먼저 묶어 머지하고 실측 다섯을 한 세션에 몰아 돌린다고 정했다. 나(PR 2 뒤 실측)는 그 묶음에 PR 2를 끼워 넣고 도구를 두 PR로 쪼갠다. 가는 묶음을 그대로 둔다.
2. `render_ass(iter, &SubtitleOpts)`·`render_srt(..)`는 기록을 한 줄씩 읽는 순수 함수다(§3.1). 입력은 `ChatMessage` 반복자라 PR 1의 `chat::page`에만 기대고, PR 2의 `chat::part`에 기대지 않는다. 옮겨도 의존 순서가 깨지지 않는다.
3. 9.1의 골든(`expected/*.ass`·`*.srt`)은 이미 PR 1의 `gen-fixtures.mjs`가 만드는 것이다. 골든이 PR 1에 있고 그것을 읽는 코드가 PR 2에 있던 배치가 어색했다.
4. `sibling_path`도 함께 옮긴다. 도구가 mp4 옆에 같은 이름의 자막을 쓰려면(§3.3 "플레이어가 짝을 찾는다") 같은 함수가 필요하고, 순수 함수에 세 OS 테스트 하나뿐이다.
5. 도구의 페이지 순회는 `walk::next_step`을 부르는 얇은 루프다. PR 3의 `collect_chat`도 같은 `next_step`을 부르므로 종료·중복 제거 판정이 둘로 갈라지지 않는다. 루프 몸통이 둘인 것은 도구가 메모리에 모으고 제품이 `.part`에 쓴다는 차이뿐이다[가정].

**비용.** PR 1이 커진다(`subtitle` + 골든 + `sibling_path` + 도구 인자 둘). PR 2는 `chat::part`만 남아 작아지고 여전히 서로 독립이다. 실측 결과(M-④-8·9, R5)가 렌더 규칙(겹침, BOM, 길이 컷)을 바꾸면 `chat::subtitle`을 PR 3 이전에 고치며, 그때 골든을 함께 바꾼다. 이 수정은 나(PR 2 뒤 실측)를 택했어도 같다. 렌더 규칙은 실측 뒤에 어차피 바뀐다.

**결정 표와 계획의 맞춤.** `decisions.md` M-④-8·9의 도구 인자 이름(`--write-ass`)과 `plan.md` 트랙 ④의 PR 행(④-1에 `chat::subtitle`·`sibling_path` 추가, ④-2는 `chat::part`만)을 이 절에 맞춰 고쳐야 한다(이 문서의 범위 밖이라 남은 것에 적는다).

---

## 11. 실측 결과 → 선택(조건부 설계)

| 질문 | 결과 A | 설계 | 결과 B | 설계 |
|---|---|---|---|---|
| Q1 본인 공개 VOD를 비로그인으로 받을 수 있는가[실측 필요](A5) | 된다(제3자 코드 기준 예상) | 본문 그대로 | 안 된다 | 쿠키가 꺼져 있으면 카드 행을 비활성으로 두고 `card.chat.disabled.cookie`를 단다. `settings.chat.help`에 "네이버 로그인 정보가 필요해요"를 더한다. 기능 가치가 크게 줄어드니 ROADMAP에서 다시 판단한다 |
| Q2 연령 제한·구독자 전용은 쿠키가 필요한가[실측 필요](A6) | 필요하다 | 401·403 → `Failed(authRequired)` + `body.auth`. 카드에서 미리 막지 않는다(영상 info의 `adult`만으로는 판단할 수 없다) | 필요 없다 | auth 본문 키는 남기되 그 경로는 드물다 |
| Q3 앱이 쓰는 info v2에 채팅 사용 여부 필드가 있는가[실측 필요](A7) | 있다 | `VideoContent.chat_enabled` → `ChatAvailability::Disabled` → 카드 비활성 + 사유 | 없다 | 필드를 더하지 않는다. 카드는 늘 켤 수 있다. 꺼진 채팅이 어떻게 응답하는지는 출력 1·4로 본다. 그 응답이 400이면 `Failed(http)`로 남는다(Q8이 정할 때까지). 다른 info 버전은 따로 부르지 않는다(요청 수와 계약 면적을 늘리지 않는다) |
| Q4 빠른 다시보기 파일의 0초가 채팅 위치 0인가[실측 필요](A11) | 맞다 | 본문 그대로 | 어긋난다 | 빠른 다시보기에서는 자막을 만들지 않고 기록만 남긴다(`card.chat.help.rewindLogOnly`). 보정 규칙은 원인을 실측한 뒤 따로 설계한다. 빠른 다시보기를 읽는 VOD용 경로는 끊김이 있는 목록을 코어가 이미 거부한다(`hls.rs:306` `Unsupported::Discontinuity`, 생방송용 읽기는 같은 태그를 거부하지 않고 `ended`로 다루지만(`hls.rs:302`) 채팅과 무관하다). 그러니 빠른 다시보기에서 어긋남이 있다면 끊김 말고 다른 원인이다 |
| Q5 긴 VOD의 페이지 수와 429[실측 필요](A14) | <1000·429 드묾 | 간격 300ms([잠정]) | >1000 또는 429 잦음 | `CHAT_PAGE_INTERVAL_MS`를 올리고(값은 실측으로 정한다), 진행 조각은 퍼센트로 유지한다. 영상과 병렬로 돌리는 U1-B는 쓰지 않는다 |
| Q6 마지막 위치가 길이를 넘는가[실측 필요](A13) | 아니다 | 길이 + `CHAT_TAIL_MS` 컷은 방어로만 남긴다 | 넘는다 | 그대로 둔다(자막에서는 빼고 기록에는 남긴다). `job.chat.done`의 수는 기록 기준으로 센다 |
| Q7 중간 접미사 자동 열기 | — | **질문을 없앴다**(§3.3: 자막은 `{stem}.ass`) | — | — |
| **Q8 400은 정상 끝 신호인가**[실측 필요](A9, Codex) | 일반 VOD와 빠른 다시보기 **각 2개 이상**(표본 수 [잠정] 근거 없음, 실측·ADR-0009 묶음 등록)에서 출력 4가 "400은 `마지막 커서 ≥ 길이`에서만 나고, 그 앞 페이지까지 정상"으로 나온다. 표본이 적으므로 이것은 서비스 보장이 아니라 관찰이다 | 좁은 조건 하나만 정상 끝으로 더한다: `ChatEnd::PastEnd` = "첫 페이지가 아니고, 400이고, 지금 커서 ≥ `duration_ms`". 그 조건의 양성 테스트를 더하고, §9.2 음성 테스트(조건 밖 400 → 오류)는 그대로 둔다. 근거(실측 결과)는 core.md 구현 중 변경에 적는다 | 400이 다른 위치에서도 나오거나 구분할 수 없다 | 400은 오류로 둔다(본문 그대로). 끝까지 받고 나서 400이 나는 영상은 `Failed(http)`로 끝나지만 `.part`는 남는다. 이 경우가 흔하면 Q8을 다시 연다 |

---

## 12. stacked PR 단계

| # | 커밋(PR 제목) | 내용 | gate |
|---|---|---|---|
| 1 | `chore: 채팅 페이지 파서, 자막 렌더러, 실측 도구 vod-chat-check를 더한다` | `gen-fixtures.mjs` 채팅 생성기와 `testdata/chat/`, `chat::page`·`chat::walk`·`chat::retry`(TDD, 400 음성 테스트 포함), 공개 seam `Chzzk::fetch_chat_page(video_no, cursor)`(`RequestKind::Api` 헤더와 쿠키 규칙을 그대로 쓰는 유일한 채팅 요청 함수. `http::headers`(`http.rs:145` `pub(crate)`)와 `Chzzk::fetch`(`client.rs:202` 비공개)를 example에서 부를 수 없어 필요하다, B2), 채팅 `RetryPolicy` 값(`max_attempts = CHAT_RETRY_MAX + 1`, §3.2-5. `retry.rs`는 고치지 않는다), `chat::probe`(범주 판정) + 단위 테스트, **`chat::subtitle`(`render_ass`·`render_srt`, 골든 `expected/*` 포함)와 `naming::sibling_path`(3차 개정 N5, §10.1)**, `examples/vod_chat_check.rs`(`--write-ass`·`--write-srt` 포함), ROADMAP 실측 칸. **사용자가 돌린 결과로 §11을 확정한 뒤 다음 PR로 간다** | rust, scan, fixtures `--check` |
| 2 | `refactor: 채팅 이어받기 파일을 더한다` | `chat::part`(`DuplicatePolicy` 마무리, 경쟁 테스트). 자막 렌더와 `sibling_path`는 PR 1로 옮겼다(§10.1) | rust |
| 3 | `refactor: 코어에 채팅 수집 collect_chat을 더한다` | `Chzzk::collect_chat`(PR 1의 fetch·walk·subtitle + PR 2의 part), wiremock 통합 테스트, (Q3가 "있다"면) `VideoContent.chat_enabled`, `ContentMeta.chat`, (Q8이 A면) `ChatEnd::PastEnd` | rust, coverage |
| 4 | `refactor: 셸에 채팅 큐와 작업 하위 상태를 더한다` | `Backend::collect_chat`, `ChatQueue`, `ChatState`(`JOBS_VERSION` 그대로, `Interrupted`·`Conflict`, `#[serde(skip)] partial_bytes`와 reconcile), `JobEvent::Chat`, `on_auth_status` 채팅 이어받기, `clearable()` 규칙, `check_output` 채팅 충돌·`conflict_names`, command `check_chat_output`·`fetch_chat`·`pause_chat`(`app/src-tauri/src/command_names.rs`·`commands.rs`·`generate_handler!`·`capabilities/default.json`), 코어 `UserSettings.save_chat`·`chat_subtitle`와 셸 설정 DTO, DTO + `UPDATE_BINDINGS`, 가짜 Backend `tests/common/fake.rs`. **프런트**: `app/src/lib/stores/jobs.apply.ts`의 `Chat` 분기와 vitest, 가짜 백엔드 `app/e2e/mock/backend.ts`의 타입·이벤트(화면 없음). `JobDto`·`ContentMeta` 리터럴을 만드는 테스트 도우미도 함께 고친다(§4.6). ②가 머지돼 있으면 ②-2 뒤, 아니면 §12.1 | rust, tauri, tauri-clippy, **frontend** |
| 5 | `feat: 영상과 함께 채팅도 받을 수 있게 한다` | **선행: 사용자 결정 U2(실측 M-④-8·9 뒤)**. ②가 머지돼 있으면 ②-3 뒤, 아니면 §12.1. 카드 채팅 행과 "형식 바꾸기", 작업 행 조각·[⋯] 항목·D7·D2 변형 연결, 프런트 `isClearable`·`removeRoute`의 채팅 조건(`jobs.ts:619-633`), 완료 그룹 접힘 규칙(`jobs.ts:82`), 설정 "받기" 두 행, `ko.ts` 키, `content.md` §4·§5.3(D7 제목 변형·D2 변형 `dialog.removeChat`)·§15.1 패리티, `design/copy/terms.json` `opensWindow`에 "채팅 덮어쓰고 받기"와 governance.md:201 DC5 목록, `patterns.md` §2.3·§3.2·§4·§6.5·§14.4 표에 행 추가와 §17 새 번호(D7 이름이 덮어쓸 파일 전부를 가리킴, §17-27을 고친다), 채팅 수치 ADR(ADR-0009 형식), 갤러리, e2e spec, 네이티브 E2E fixture(`scripts/ci/e2e-fixture-server.mjs`가 채팅 페이지도 서빙) | frontend, design-copy, design-tokens, e2e-web, design-shots, e2e-native |
| 6 | `docs: 채팅 함께 받기를 설계 문서와 ROADMAP에 기록한다` | `core.md`·`app.md` "구현 중 변경"에 번호를 붙여 적는다(새 모듈, `JOBS_VERSION` 유지 이유, 400 처리와 Q 결과, 채팅 `.part`가 있는 작업을 `clearable()`에서 빼는 이유). D7 제목 규칙은 시각·문구 규칙이라 PR 5의 patterns.md §17에 적고 여기서는 다시 적지 않는다(CLAUDE.md 머리: 디자인 시스템이 단일 원천). CLAUDE.md 레이아웃 표의 `crates/core/src` 모듈 목록에 `chat`을 더한다 | scan |

- 사용자에게 보이는 기능은 PR 5 하나만 `feat`이다. 0.x에서 `feat`는 MINOR를 올린다(versioning.md:16-20, 근거 확인 C6). 지금 버전은 0.7.0이다(`Cargo.toml:9`, 생방송 녹화 릴리스). 이 기능이 담기는 다음 릴리스는 최소 **0.8.0**이다. 정확한 번호는 태그 직전 `node scripts/ci/release.mjs next-version`이 정한다(plan.md §6). 계약(사용자 데이터·Worker·업데이트)을 깨지 않으므로 `!`는 없다(versioning.md:31).
- PR 1은 실측 도구와 아직 쓰는 곳 없는 파서라 `chore`, PR 2~4는 사용자에게 보이지 않는 내부 추가라 `refactor`로 단다. 저장소 규칙은 타입별 올림 자리만 정하고 "동작 없는 새 코드 = refactor"를 정하지는 않는다. 올림 자리(PATCH)가 같으므로 이것은 판단이다[가정](C7). 화면 없이 머지돼도 동작은 바뀌지 않는다. `save_chat` 기본값이 false이고, UI가 아직 그 값을 보내지 않기 때문이다.
- PR 4의 완료 조건에 `frontend` 통과를 넣는다. 새 이벤트가 bindings에 생기는 순간 `app/src/lib/stores/jobs.apply.ts:88`의 `never` 검사가 깨지기 때문이다(Codex). 화면 표현만 PR 5에 남긴다.
- PR 2는 PR 1 머지 전에도 worktree에서 시작할 수 있다(실측과 무관한 부분). PR 3은 1·2 모두에, PR 4는 3에 기댄다. §11이 B로 갈리면 PR 3~5의 해당 행만 바뀐다[가정](E8).
- 3차 개정(N5): 자막 렌더러와 `sibling_path`가 PR 1에 들어가 PR 1이 커지고 PR 2는 `chat::part`만 남는다. PR 2는 여전히 PR 1 머지 전에 시작할 수 있다(§10.1).
- PR 5는 사용자 결정 U2(실측 M-④-8·9 결과)가 있어야 머지한다. 기본 형식이 카드 도움말 키(`card.chat.help.*`)와 설정 라디오 순서(§5.4)를 정하기 때문이다.
- 번호는 머지 때 최신 master의 마지막 번호 뒤로 다시 잡는다. 지금(`df454c3`)은 core.md 61~, app.md 78~, ADR 0026~, patterns.md §17-34~다(머리말).
- PR 5의 `design-shots` 기준선은 v0.7.0 이후 master 위에서 만든다(갤러리 배지 행이 이미 늘었다, §4.6).

### 12.1 구간 기능(②)과의 순서: ②가 보류돼도 ④는 독립으로 간다(3차 개정, Codex 2회차 N6)

**구분.** plan.md §5의 두 행("②-2 → ④-4", "②-3 → ④-5")은 *둘 다 진행할 때의 머지 순서*이지 *④의 선행 조건*이 아니다. 이전 판은 이 둘을 섞어, ②가 장면 대응·키프레임 실측에서 deferred가 되면 채팅까지 멈추는 것처럼 읽혔다. 채팅이 더하는 필드(`save_chat`, `JobDto.chat`, `conflict_names`, 설정 둘)는 구간 없이 정의된다(§4.4). 채팅의 부모는 영상 완료 분기(§4.2)이고 ②에 기대지 않는다.

| ②의 상태 | ④-1~④-3 | ④-4 | ④-5 | 릴리스 |
|---|---|---|---|---|
| 둘 다 진행, ②가 먼저 | 상관없다 | ②-2 뒤. `EnqueueRequest`·`JobDto`·`check_output` 인자(`dto.rs:583`·`:659`, `manager.rs:425`)를 한 쪽씩 고친다 | ②-3 뒤. 카드 두 행 합산 높이를 ④-5의 720×520 스냅에서 잰다(C7) | ②+④ 묶음 또는 각각 |
| 둘 다 진행, ④가 먼저 | 상관없다 | ②를 기다리지 않는다. 채팅 필드만 더한다 | ②를 기다리지 않는다. 합산 높이는 ②-3이 잰다 | 각각 |
| ② 실측 전(미정) | 상관없다 | ②를 기다리지 않는다 | ②를 기다리지 않는다 | ④ 단독 가능 |
| ② 보류(deferred) | 상관없다 | 현재 master 위에서 그대로 진행 | 그대로 진행. 카드 높이는 채팅 행 **단독**으로 잰다(합산 항목이 사라진다). 구간 숨김 규칙(§5.2)은 쓰지 않는다 | ④ 단독 |

- **②가 deferred가 되는 조건**: ②-0 도구의 실측 M-②-3(조각이 키프레임으로 시작하지 않음), 또는 ②-1 `dl --range`의 실측 M-②-2(장면 대응 세 시각 중 하나라도 "불일치")나 M-②-6(defrag한 구간 파일 재생 "안 된다")이다(`decisions.md` M-②-2·3·6, `range.md` §12 R18·R19 행). M-②-2·6은 ②-1이 머지된 뒤에야 돌릴 수 있다.
- **충돌은 같은 타입을 고칠 때만 난다.** bindings는 타입마다 파일 하나다(plan.md §0 표 6행, 근거 근거 확인 표 P2). 두 PR이 `EnqueueRequest`·`JobDto`·`OutputCheck`에 필드를 *더하기만* 하므로 충돌은 텍스트 충돌이고, 뒤에 머지되는 쪽이 rebase한 뒤 `UPDATE_BINDINGS=1 cargo test -p chzzk-shell --test bindings`로 bindings를 다시 만든다(CLAUDE.md 명령).
- **상호 규칙은 나중에 머지되는 PR이 건다.** 구간이 켜지면 채팅 행을 숨기는 조건(§5.2)과 완료된 구간 작업의 [⋯] 항목 숨김(§4.3)은 ②와 ④ 중 늦게 머지되는 쪽이 넣는다. 먼저 머지되는 쪽은 상대 코드를 모른 채 간다.
- **④의 남은 진짜 선행 조건**: ④-3 ← ④-1(page·walk·retry·subtitle)·④-2(part)·실측, ④-4 ← ④-3, ④-5 ← ④-4·U2. 이것은 ②와 무관하다.
- plan.md §5 의존 표의 두 행과 §6 릴리스 표의 "릴리스 ②+④" 행("④-5가 ②-3 뒤라 함께 끝난다")을 위 표대로 고쳐야 한다. 이 문서의 범위 밖이라 남은 것에 적는다.


---

## 13. 위험

| # | 위험 | 영향 | 대응 |
|---|---|---|---|
| R1 | 비공식 경로가 바뀌거나 막힌다 | 채팅만 실패하고 영상은 무사하다 | 서킷(patterns §10.4)이 생기면 채팅 실패는 그 집계에 **넣지 않는다**. 영상 경로의 서비스 변경 의심과 섞지 않기 위해서다. 지금 셸에는 상수 `CIRCUIT_FAILURES`(`consts.rs:41`)만 있고 집계 코드는 없다(`crates`·`app/src` grep 결과 `consts.rs` 1건, C30). 그래서 이것은 앞으로의 구현에 거는 조건이다. nightly `drift`에 채팅 첫 페이지 확인을 더할지는 열린 항목이다(본인 영상 secret 재사용, kind만 출력) |
| R2 | 429가 같은 API 호스트의 info·재조회까지 늦춘다 | 영상 재조회 지연 | 큐 하나, 간격 [잠정] 300ms, 영상 뒤 실행(U1-A). 같은 호스트인 것은 확인했지만(A20) 429가 호스트 단위인지는 [실측 필요]다. Q5 결과로 간격을 조정한다 |
| R3 | 빠른 다시보기의 시각이 어긋난다 | 자막이 틀린 위치에 뜬다 | Q4 실측. 어긋나면 그 종류는 기록만 남긴다(§11) |
| R4 | 제3자 개인정보(시청자 닉네임·본문)가 로그나 보고 정보로 샌다 | 개인정보 사고 | §7 규칙 + 로그 누출 테스트(§9.3) + `Debug` 손 구현 |
| R5 | SRT·ASS 호환(겹침, 줄바꿈, BOM)이 편집 도구마다 다르다 | 편집기에서 보기 나쁘다. 편집자가 실제 사용자라(Q1) 영향이 커졌다 | 기록은 늘 남아 다시 만들 수 있다. 실기 확인은 §10 출력 9(수동)로 한다. D62 사용자 시험(README.md:211, governance §6.1)은 기준선과 적용 뒤 두 회 이상을 요구한다. 그래서 이 확인 한 번을 D62 충족으로 적지 않는다(Codex "D62") |
| R6 | Windows 전체 경로 259 초과 | 채팅만 `Failed(io)` | 쓰이지 않는 `WINDOWS_PATH_MAX_UTF16`을 `check_output`에 연결하는 일은 이 기능 밖의 별도 `fix`다. 여기서는 영상이 무사하다는 것을 테스트로 고정한다 |
| R7 | 긴 VOD에서 기록 파일이 크다(수십 MB, [가정] 근거 없음) | 디스크 | 영상 크기에 비하면 작다. 여유 공간 경고(`LOW_SPACE_FACTOR`, `consts.rs:25`)는 영상 기준 그대로 둔다 |
| R8 | 자막 형식을 나중에 바꾸고 싶다 | 다시 받아야 한다 | v1은 "채팅 다시 받기"뿐이다. 편집자가 실제 사용자이므로(Q1) 기록 → 자막 변환 메뉴는 다음 단계 1순위다(파이프라인이 이미 기록 → 자막 순이라 렌더 함수를 다시 쓴다) |
| R9 | 이미 있는 `{stem}.ass`(사용자가 만든 자막)를 덮어쓴다 | 사용자 파일 손실 | 카드는 채팅 파일 충돌을 영상 충돌과 합쳐(§4.4) 기존 경고 + 번호 붙이기/덮어쓰기 + D7로 다룬다. 채팅만 받기는 `check_chat_output` + D7로 다룬다(§4.5). 마무리 기본은 `Skip`(`rename_noclobber_with_retry`)이다. 그래서 검사 뒤 생긴 파일도 덮어쓰지 않고 `Conflict`로 남긴다. **묻지 않고 덮어쓰는 길은 없다.** `restart`는 동의로 치지 않는다 |
| R10 | 이용 약관 | 비공식 경로 사용 | 앱의 비공식 고지(D34) 범위 안이라는 것은 판단이다[가정](§1.3). 본인 영상 제한은 그대로 적용한다 |
| R11 | 400을 오류로 두었는데 실제로는 모든 VOD의 끝 신호다 | 끝까지 받은 채팅이 `Failed`로 보인다 | 기록 `.part`는 남는다. PR 1 실측(§10 출력 4)이 PR 3보다 먼저라, 이 경우는 출시 전에 §11 Q8로 드러난다 |
| R12 | 생방송 녹화(v0.7.0)를 쓰는 사용자가 녹화본에서 채팅도 기대한다 | 생방송 행에 채팅이 없다. 숨겨지면 안 된다는 UX 기준 ①에 걸릴 수 있다 | 방송이 끝나 VOD가 생기면 그 카드에 채팅 스위치가 있다(§1.2). 생방송 카드 안내(`card.live.body`)에 채팅 문장을 더할지는 열린 항목이다. 그 문구는 ADR-0025 영역이라 이 설계가 정하지 않는다[가정] |

---

## 14. 사용자 결정 요청

| # | 질문 | 선택지 | 추천 | 이유 |
|---|---|---|---|---|
| U1 | 채팅을 언제 받는가 | A 영상 완료 뒤 / B 영상과 동시에 | **A** | 상태 모델이 단순하다. 영상 상태 머신을 건드리지 않는다(C1·C9). 영상을 취소해도 채팅 고아가 생기지 않는다. 429가 영상의 info 재조회와 겹친다는 점은 [실측 필요](Q5)라 이유의 무게는 낮다. 대신 채팅이 몇 분 늦게 끝난다[가정] |
| U2 | 자막 기본 형식 | `.ass`(플레이어) / `.srt`(편집기) / 없음 | **사용자 결정**(추천 보류. 확정 2026-10-16: 실측 M-④-8·9 결과를 보고 정한다. 그 결정이 나오기 전에는 PR 5를 머지하지 않는다) | 편집자가 실제 사용자로 확정되어(Q1) 근거가 바뀌었다. `.ass`를 고르면 받은 직후 mpv로 열자마자 채팅이 보인다(A15). `.srt`를 고르면 편집 프로그램에 바로 넣을 수 있다. 다만 "편집 도구는 SRT를 받고 ASS를 무시한다"는 일반 지식이고 확인하지 않았다[가정](A18, §10 출력 9). 누가 받기를 누르는지로 갈린다. 편집자가 직접 받으면 `.srt`, 스트리머가 받아 넘기면 `.ass`다. 어느 쪽이든 카드 도움말이 형식을 말하고 "형식 바꾸기"가 바로 옆에 있다(§5.2) |
| U3 | 자막 한 줄 표시 길이 | 고정 5초 / 다음 메시지까지(상한 5초) | **고정 5초**([잠정] 근거 없음, 실측·ADR-0009 묶음 등록) | 채팅이 빠른 구간에서 "다음까지"는 깜빡임이 된다. 겹친 줄을 렌더러가 쌓는다는 것(A19)과 SRT의 겹침(R5)은 [실측 필요]다 |
| U4 | 첫 실행 기본값 | 켬 / 끔 | **끔** | 비공식 경로를 하나 더 쓰고 파일이 둘 더 생긴다. 사용자가 고른 뒤에는 마지막 선택을 기억한다. 기본 꺼짐 선례는 `auto_resume_interrupted`다(E4). 판단이다[가정] |

U1·U3·U4는 추천대로 확정했다(사용자 확정 2026-10-16, "유지" 판정 26행에 든다). U5(고지 변경 없음)도 같다. U2만 실측 뒤 결정이다.

---

## 개정 기록(2026-10-16, 1차. 줄 번호는 `bff221d` 기준)

입력은 Codex 1회차 적대적 리뷰의 채팅 관련 지적과 근거 확인 표의 가정·실측 필요·인용 오류 행이다. 줄 번호는 기준 커밋 `bff221d`에서 직접 열어 확인했다.

### 처리한 지적

1. **400 의미를 오류로 보존한다**(Codex 중간 "미확인 400 응답 의미", 근거 확인 A9). `ChatEnd::OutOfRange`와 `ChatOutcome::Unavailable`을 지웠다. 400은 어느 페이지에서든 `HttpStatus{400, Api}`다(`client.rs:193-194`, RFC 9110 §15.5.1). 음성 테스트 (가)~(다)를 넣었다(§9.2). 실측 출력 4와 §11 Q8에서 좁은 조건 `PastEnd`만 열어 둔다. 실패 본문은 `body.service`(408·429·5xx)와 `body.other`(400)로 나눴다.
2. **채팅만 받기의 덮어쓰기 동의**(Codex 높음, patterns.md:264 §4, D7). `ChatRequest.on_existing`(기본 `Skip`, `fsutil.rs:126` noclobber)을 더했다. `fetch_chat`이 `on_existing`을 받고, `check_chat_output` + D7을 거친다. `restart`는 동의가 아니다(`dto.rs:589-591`이 둘을 나눈다). 받는 동안 생긴 파일은 `Conflict`로 남는다(`part.rs:349-351`과 같은 규칙). 채팅만 받을 때는 번호 붙이기를 뺐다(§3.3 짝 규칙). 경쟁 테스트와 바이트 보존 단언을 넣었다(§9.2·§9.3).
3. **`JobEvent::Chat`과 `never` 검사**(Codex 중간, `app/src/lib/stores/jobs.apply.ts:87-91`, 근거 확인 C10). "프런트가 모르면 무시한다"를 지웠다. `Chat` 분기, vitest, 가짜 백엔드 타입을 PR 4에 넣고 gate에 `frontend`를 더했다. 화면은 PR 5다.
4. **`classify_failure` 정책 차이**(B4). 미디어 분류(`retry.rs:148-159`, 403 → `Expired`)를 쓰지 않는다. `fetch`의 `AuthRequired`(`client.rs:190-192`) 위에 채팅 전용 `chat::retry::classify`를 두었다. 백오프는 `RetryPolicy`(`retry.rs:26`)의 공개 메서드 `delay`·`allows_retry`를 쓴다(2차 개정 6에서 `pub(crate)` 넓히기를 지웠다).
5. **`resume_checked`가 완료 작업을 거부한다**(C22, `manager.rs:500-504`). §4.5에 새 길을 두었다. `admit`(`ownership.rs:118`) → `start_chat`(Completed·Video·파일 있음 확인)이다.
6. **worker.md 구현 중 변경 57: 자동 이어받기를 로그인 뒤로 미룬다**(C13). `ChatPhase::Interrupted`를 `Paused`와 나눴다(`manager.rs:552`가 영상도 `Interrupted`만 이어받는다). 로그인 빌드는 `on_auth_status`(`app.rs:342-362`)에서 같은 채널 필터와 관리자 예외로 줄 세우고, 로그인 없는 빌드는 열 때 줄 세운다(`app.rs:154-160`). 테스트를 §9.3에 넣었다.
7. **`consts` 위치**(B10). 코어에는 `consts`가 없다. 상수를 `chat/mod.rs`에 둔다(선례 `retry.rs:15`, `download/mod.rs:43`).
8. **`InvalidInput` 없음**(B13, `error.rs:19-71`). `ChatRequest.content: ContentRef`를 `video_no: u64`로 바꿔 클립을 표현할 수 없게 했다. 그래서 "새 변종 없음"과 모순되지 않는다. 셸은 기존 `AppError::invalid_input`을 쓴다.
9. **patterns §10.3 복사 버튼 규칙**(D18). `body.other`에서 "복사" 언급을 뺐다. 복사는 L1 [⋯]에 둔다. 버튼 ≤ 3을 유지한다. 초안이 인용한 content §6.5는 이 문제와 무관해서 그 줄을 지웠다.
10. **gate 허용 목록 인용 오류**(C24). `gate.rs`는 기본 거부라(`gate.rs:3-5`) 고치지 않는다. `app/src-tauri/src/command_names.rs:2-3`이 정한 네 곳을 고친다.
11. **D47 인용 오류**(D25). 근거를 `formatCount`(content.md:256)로 바꿨다.
12. **확인됐지만 본문이 틀렸던 곳**:
    - 상태 6종 이름(D28 → §5.6 표).
    - `UserSettings`는 코어에 있다(C25).
    - `ContentMetaDto` 미러와 `From`(B17).
    - D1·D7을 "대화상자"로 표기(C11·C18).
    - P-9 25% 단위를 따른다(D20).
    - 접힘은 프런트에서 계산하므로 PR 5로 옮겼다(C16, `jobs.ts:82`).
    - 잠자기 방지는 입력을 넓혀야 한다(C12).
13. **가정·실측 필요 표시**:
    - [가정]: A2·A4(라이브 제외 판단), A18(편집 도구), A19(libass), B22(examples 번들), C7(refactor 타입), C32(대역폭), D2·R10(D34 범위), D13(카드 높이), D22(쿠키 버튼 동작), E1~E4·E8.
    - [실측 필요]: A5·A6·A7·A11·A13·A14·A16(VLC 자동 열기, §10 출력 8. 2차 개정 10에서 [가정] 목록에서 옮겼다)·C31.
    - 출처 없는 수치는 "[잠정] 근거 없음, 실측·ADR-0009 묶음 등록"으로 표시했다. 대상은 300ms, 5000ms, 길이+5초, 3회, 2초, 1920×1080, 카드 증가분이다. 등록은 ADR-0009 결정 절에 따라 새 ADR로 한다.
14. **같은 ms 해시 중복 제거가 정상 쌍둥이를 잃을 수 있다**(Codex "근거 없는 의심" 3). 해시 집합을 개수 표(multiset)로 바꿨다. fixture `page_boundary_twins`를 더하고 실측 출력 4b를 더했다.
15. **D62 한 번으로 충족이라고 보지 않는다**(Codex 중간 "D62", governance §6.1). R5에서 "D62 과업에 더한다"를 §10 출력 9의 수동 확인으로 바꾸고, D62 충족으로 적지 않는다고 밝혔다.
16. **버전**(Codex "결정표와 실행 계획"). 0.6.3에서 첫 `feat`는 최소 0.7.0이고 `!`는 없다는 것을 §12에 적었다.
17. **카드 높이와 최소 창**(Codex Q12, patterns.md:830). sticky는 [받기]만 보장한다는 것을 적었다. 720×520 최악 조합 스냅에 채팅 행을 넣는다.
18. **D29("앞 40자" 갤러리 규칙)는 출처가 없다.** 문장을 지웠다.
20. **카드 경로 D7도 사용자 자막을 숨긴 채 덮어쓸 수 있었다**(Codex 높음 "채팅만 받기"의 같은 구멍, patterns.md:264, patterns.md §17-27 = patterns.md:895. 처음에 "app.md 구현 중 변경 27"로 잘못 적었고 2차 개정 1에서 고쳤다). `OutputCheck.conflict_names: Vec<String>`(자막 → 기록 → 영상)과 D7 변형(2차 개정 3에서 키를 `dialog.overwriteMany.title`로 바꿨다)을 두어 실제로 덮어쓸 파일을 모두 가리키게 했다(§4.4·§4.5-6·§5.5). `X.mp4`+`X.ass` 테스트를 더했다(§9.3).
21. **이어받기 끝 표시·두 파일 부분 마무리**(내부 검토). sidecar에 `end`를 더해 `Conflict` → Overwrite가 요청 없이 마무리되게 했다. 한 파일만 막힌 경우의 처리를 §3.2-8에 적었다.
22. **Q8 결과 A의 표본**(내부 검토). VOD 하나로 "늘"을 세울 수 없어 표본 조건(종류마다 2개 이상, [잠정])을 붙이고 관찰로 낮췄다.
19. **사용자 확정 Q1(편집자 포함)**:
    - U2 추천을 보류하고 사용자 결정으로 돌렸다.
    - 카드 도움말 옆에 "형식 바꾸기" 링크를 더했다(숨기지 않고 튀지 않게).
    - R5·R8의 영향과 우선순위를 올렸다.
    - 편집자가 위임(①)을 통해 같은 `OwnershipGate`를 따른다는 것을 §1.3에 적었다.

### 반박한 지적

1. **Codex Q8 판정 "자막 호환을 확인하기 전에 확정하면 안 된다" 중 '자막 기능 전체를 보류하라'로 읽힐 수 있는 부분.** 자막 생성은 막지 않는다. 기록 `.chat.jsonl`이 늘 남아 자막을 다시 만들 수 있다(§1.1, R5·R8). 자막 형식은 설정에서 고를 수 있다. 그래서 호환 문제가 생겨도 사용자 데이터는 잃지 않는다. 확인이 안 된 호환 항목(VLC 자동 열기, 편집 도구 SRT, 겹침, BOM)은 확정하지 않고 [가정]·[실측 필요]로 남겼다. U2 기본값도 확정하지 않고 사용자 결정으로 돌렸다.
2. **근거 확인 C30("빼야 할 서킷 집계가 있는지부터 불확실")을 '규칙을 지워라'로 읽는 것.** 집계 코드는 지금 없다(grep 결과 `consts.rs`만). 규칙은 지우지 않고 "서킷이 구현되면 채팅은 세지 않는다"는 앞으로의 조건으로 남겼다. 같은 모듈에 `CIRCUIT_FAILURES`가 이미 정의돼 있어 구현될 가능성이 있다(ADR-0009 표 `CIRCUIT_FAILURES` [잠정]).

### 남은 것(실측·사용자 결정)

- 사용자 실측(PR 1 도구, §10): Q1·Q2·Q3·Q4·Q5·Q6·Q8, 경계 되풀이(출력 4b), VLC 자동 열기(A16), 편집 프로그램 SRT 읽힘·겹침(출력 9).
- 사용자 결정: U1·U3·U4는 추천을 유지하고, U2는 추천을 보류했다(편집자 포함으로 근거가 갈림).
- `{name}` 순서(자막 우선)는 [가정]이다. 키 모양(`dialog.overwriteMany.title`)과 `opensWindow` 추가는 이 문서에서 정했고, PR 5에서 `design-copy`를 돌려 통과를 확인한다.
- Q8 표본 수(종류마다 2개 이상)는 [잠정]이다. 사용자가 본인 영상을 몇 개 돌릴 수 있는지에 따른다.
- "형식 바꾸기"가 카드에서 튀지 않는지(Button ghost sm + `.btn-inline`)는 [가정]이다. PR 5 `design-shots`와 R1으로 확인한다.
- `dialog.removeChat` 문구(D2 변형)는 초안이다. 같은 결의 기존 D2 문구(content.md:173)와 PR 5 리뷰에서 맞춘다.
- 쿠키 버튼 동작(D22)이 지금 구현과 같은지 PR 5에서 확인한다.
- 채팅 수치(300ms, 3회, 5000ms, 길이+5초, 2초, 1920×1080, 카드 증가분)를 새 ADR로 등록한다(PR 5).
- `examples/`가 번들에 들지 않는지(B22) PR 1에서 `release/expected-artifacts.json`과 대조한다.

## 2차 개정 기록(2026-10-16, 독립 확인 반영. 줄 번호는 `bff221d` 기준)

입력은 1차 개정본의 독립 확인에서 남은 문제 10건(1~10)이고, 11·12는 고치는 중의 자기 검토다. 줄 번호는 `bff221d`에서 다시 열어 확인했다.

1. **D7 이름 규칙 출처 인용 오류.** §4.5-6과 1차 개정 20이 "app.md 구현 중 변경 27(patterns.md:895에 인용)"이라고 적었다. patterns.md:895는 patterns.md 자체의 §17(머리 patterns.md:867) 27번 "(c) D7 덮어쓰기(J17)"다. app.md 구현 중 변경 27(app.md:1169)은 "§15-6 reconcile 세부"로 무관하다. 출처를 "patterns.md §17-27(:895)"로 고쳤다. 기록할 곳도 다시 봤다. 이것은 시각·문구 규칙이라 디자인 시스템이 단일 원천이다(CLAUDE.md 머리). 그래서 "PR 6에서 app.md 구현 중 변경에 적는다"를 "PR 5에서 patterns.md §17 새 번호와 content.md §5.3 D7 행"으로 바꿨다(§4.5-6, §12 PR 5·6).
2. **일괄 지우기가 받은 채팅 `.part`를 지우던 모순.** 1차 개정본은 `Paused`·`Interrupted`·`Conflict`를 [완료 항목 지우기]·`prune_finished`로 지우며 채팅 `.part`를 정리했다. 이것은 세 군데와 부딪쳤다. 선례 `clearable()`(`manager.rs:144-152`)은 `.part`가 남은 `Skipped`를 뺀다. §4.5-5의 `Conflict` → Overwrite 마무리는 그 `.part`가 있어야 한다. 일괄 지우기는 "가역, 파일은 그대로, 확인 창 없음"(patterns.md:261)인데 `.part` 폐기는 비가역이다(patterns.md:263). 고친 규칙(§4.3):
   - 채팅이 `Waiting`·`Running`이거나 채팅 `.part`가 있으면 `clearable()`에서 뺀다. 일괄 지우기와 자동 정리가 모두 이 함수를 쓰므로(`manager.rs:712-718`·`:1078-1083`) 둘 다 받은 부분을 건드리지 않는다.
   - 행 하나 지우기는 선례 "`.part`가 있으면 D2"(patterns.md:891 §17-23)를 따른다. 기존 D2 문구(content.md:173)는 "‘{title}’ 받기를 취소할까요?"·"{size}까지 받았어요"라서, 영상이 끝난 행에서는 영상을 지우는 것처럼 읽힌다. 그래서 D2 변형 `dialog.removeChat`(제목·본문·실행 쪽 셋, 안전 쪽은 `dialog.cancel.keepPaused` 재사용)을 더했다(§5.5).
   - **UI 경로도 막았다.** [완료 항목 지우기]는 셸 `clear_finished`가 아니라 프런트 `isClearable`(`app/src/lib/jobs.ts:599-602`)로 고른 id마다 `remove_job`을 부른다(`stores/jobs.svelte.ts:385-392`, patterns.md:891). 그래서 `clearable()`만 고치면 실제 버튼은 여전히 채팅 `.part`를 지운다. `isClearable`과 행 지우기의 `removeRoute`(`jobs.ts:588-597`)에 같은 채팅 조건을 넣는다.
   - 프런트가 채팅 `.part` 유무를 알 수 있게 `ChatState.partial_bytes`(`#[serde(skip)]`, DTO `partialBytes`)를 더했다. 영상 `partial_bytes`의 선례(app.md 구현 중 변경 26 (나)·27, `dto.rs:667-668`)를 그대로 따른다. 저장 형식은 바뀌지 않는다. §5.3 `Failed` 메뉴 분기도 이 값으로 정한다.
   - 테스트를 고쳤다(§9.3 정리 규칙, §9.4 vitest).
3. **`dialog.overwrite.titleMany`가 DC5에 걸림.** `?`는 `/^dialog\.[^.]+\.title$/`에 맞는 키에만 허용된다(`scripts/design/copy.mjs:746`, governance.md:201). 키를 `dialog.overwriteMany.title`로 바꿨다. allow 항목은 더하지 않는다. 본문·버튼은 `dialog.overwrite.body`·`dialog.overwrite.confirm`(`ko.ts:189-190`)을 다시 쓰고, 새 문자열은 제목 하나다(§4.5-6, §5.5).
4. **`job.menu.chatOverwrite`의 `…`가 DC5에 걸림.** "채팅 덮어쓰고 받기"가 `opensWindow`(`terms.json:699-708`)에 없다(`copy.mjs:750-755`). 이 항목은 늘 D7을 연다. 그래서 규칙에 맞는 경우로 보고 PR 5에서 `opensWindow`와 governance.md:201 목록에 더한다. 메뉴 키는 선례(`ko.ts:142-155`)에 맞춰 `job.menu.*`에서 `action.*`으로 옮겼다(§5.3). §5.2의 대안 "[형식 바꾸기…]"는 지웠다. DC5에 걸리고, 창을 열지 않으니 뜻으로도 맞지 않는다.
5. **"새 컨트롤 없음" 단정.** §5.1을 고쳤다. 카드에 더하는 상호작용 요소는 둘이다(Switch, "형식 바꾸기"). 둘 다 기존 컴포넌트다. "형식 바꾸기"는 Button ghost sm에 `.btn-inline`을 준 것이다(components.md:839 §7-35 (나). `link` variant는 없앴다, components.md:58). 링크 위계의 선례는 patterns.md:486을 인용했다. "튀지 않는다"는 [가정]으로 낮췄고 PR 5 `design-shots`·R1로 확인한다.
6. **`delay_capped` 넓히기와 타입 오류.** `pub fn delay`(`retry.rs:69-71`)가 이미 공개라 넓히지 않는다(§3.2-5, PR 1 표, 1차 개정 4). `patience: 0`은 `Duration::ZERO`로 고쳤다(`retry.rs:34`·`:58`). `CHAT_RETRY_MAX`는 재시도 횟수이고 `max_attempts`(첫 시도 포함, `retry.rs:24`)로 옮길 때 1을 더한다고 정했다. 경계 테스트를 더했다(§9.2).
7. **`finish` 인용 줄.** `manager.rs:1031-1032` → `:1027`(`End::Done(Completed)`)·`:1028`(`set_status(JobStatus::Completed)`)로 고쳤다(§4.2).
8. **경로 계산 인용 줄.** `manager.rs:350` → `:347`(`output_path(...)`)로 고쳤다(§3.3).
9. **`fetch_chat`이 따르는 선례.** 기존 작업에 붙는 일이라 `enqueue`가 아니라 `App::resume_job`(`app.rs:257-290`)을 따른다. 잠금 안 채널 재비교(worker.md:999, 구현 중 변경 83 (가))를 두지 않는 이유를 적었다. 83 (가)는 86 (가)(worker.md:1005)가 고쳤다. 86 (가)는 잠금 밖에서 `admit(작업 컨텐츠)`로 판정하고, 잠금 안에서는 같은 컨텐츠인지만 본다. 기록 채널은 판정에 쓰지 않는다. §4.5-1·2를 이 순서로 다시 썼다(로그인 없는 빌드 생략, `note_channel`, `ownership_unknown`, 채널 ID 고쳐 쓰기). 테스트를 더했다(§9.3).
10. **A16 등급 불일치.** A16(VLC 자동 열기)은 §10 출력 8의 사용자 실측으로 정해지므로 [실측 필요]로 맞췄다. 1차 개정 13의 [가정] 목록에서 [실측 필요] 목록으로 옮겼다.
11. **`dialog.removeChat.body` 순서**(2차 개정 2에서 새로 쓴 문구의 자기 검토). §5.5 규칙 "영상이 무사하다는 것을 먼저 말한다"(README.md:21 C6)에 맞춰 "영상 파일은 그대로 있어요."를 앞에 두었다. 그 규칙이 실패 본문과 이 대화상자 본문 모두에 적용된다는 것을 §5.5에 밝혔다.
12. **`.btn-inline`의 실재 확인.** 클래스가 구현에 있다(`app/src/styles/ui.css:125`, `LoginView.svelte:83`의 `<Button class="edge-start btn-inline" variant="ghost" size="sm">`, 테스트 `auth.test.ts:201`·`:283-286`). "형식 바꾸기"는 이 선례와 같은 모양이다. 카드 안에서 튀지 않는지만 [가정]으로 남는다.

## 3차 개정 기록(2026-10-16, 최신 master `df454c3` v0.7.0 기준)

입력은 Codex 2회차 적대적 리뷰(N5·N6), 사용자 확정(2026-10-16), `bff221d..df454c3` 사이에 들어간 생방송 녹화(v0.7.0)다. 줄 번호는 `df454c3`에서 다시 열어 고쳤다(변한 파일은 hunk로 옛 줄을 새 줄에 옮기고, 옮긴 줄 중 본문이 기대는 것은 내용을 직접 열어 확인했다). 1·2차 기록 안의 번호는 손대지 않았다.

### 처리한 지적

1. **N5: 실측 도구가 다음 PR의 자막 렌더러를 필요로 한다.** `chat::subtitle`(골든 포함)과 `naming::sibling_path`를 PR 2에서 PR 1로 옮겼다. 도구에 `--write-ass <mp4>`·`--write-srt <mp4>`를 두어 M-④-9(SRT)의 길도 열었다. 둘을 한 번에 쓰지 않고, 기존 파일을 덮어쓰지 않는다. 대안 "PR 2까지 머지한 뒤 실측"을 택하지 않은 근거는 §10.1이다. 임시 렌더러는 없다(§3.1·§10·§10.1·§12·§9.2).
2. **N6: 구간 기능을 보류하면 독립적인 채팅 출시까지 막힌다.** plan.md의 "②-2 → ④-4", "②-3 → ④-5"는 둘 다 진행할 때의 머지 순서이고 ④의 선행 조건이 아니라고 가려 적었다. ② 상태별 분기 표(둘 다 진행·④가 먼저·②가 미정·②가 deferred)와 "숨김 규칙은 나중에 머지되는 PR이 건다"를 §12.1에 넣었다. ④-5는 U2 확정 뒤에만 머지한다는 조건도 §12에 적었다.
3. **v0.7.0 생방송 녹화와의 접점**(§4.6). 확인한 것과 결정:
   - `JobEvent`는 그대로 넷이고(`dto.rs:775-795`) `ProgressDto`에 `live_recorded_secs`·`live_gaps`가 늘었다(`dto.rs:733-736`). 채팅은 `Chat` 변종과 `ChatState`로 따로 가고 `ProgressDto`를 건드리지 않는다.
   - 생방송은 같은 `JobRecord`·`Completed`를 쓰므로(`stop_job`·`pause`·`quit`이 모두 마무리) 채팅 훅이 발동하지 않게 `chat = None`을 고정하고, `enqueue`의 `save_chat: true` 거부(클립·생방송)를 서버 가드로 더했다(§4.4).
   - 프런트는 `chat == null`만 보지 않고 `kind`·`playbackKind`로 거른다(§5.2·§5.3).
   - §1.2 "라이브 채팅" 행의 이유를 바꿨다. 앱이 이미 몇 시간씩 켜 둔 채 도는 녹화를 가지므로 "앱을 켜 둬야 해서"는 이유가 아니다.
   - `ContentMeta` 리터럴 생성 지점이 셋으로 늘었다(§3.5). 테스트 도우미 갱신 지점을 §4.6에 적었다.
4. **번호 재배정.** core.md 구현 중 변경 61~, app.md 78~, ADR 0026~(0025는 생방송 녹화), patterns.md §17-34~, D 번호 새로 만들지 않음(머리말).
5. **버전.** 지금 0.7.0이라 이 기능의 첫 `feat`는 최소 0.8.0이다(`Cargo.toml:9`, §12).
6. **사용자 확정 반영.** "유지" 26행은 추천대로 확정이라 U1·U3·U4·U5를 그대로 뒀다. U2는 실측 M-④-8·9 결과를 보고 정하며 PR 5의 선행 조건으로 올렸다. UX 기준 ①은 §5.1에 이미 있다.
7. **빠른 다시보기 mp4는 조각 구조 그대로다**(`download/mod.rs:6`·`:372`: 변환은 생방송에만). 시각 확인(출력 8)을 QuickTime이 아니라 mpv·VLC로 한정했다(core.md 60). 두 플레이어가 이 파일을 바르게 다루는지는 [실측 필요].

### 인용 오류 정정

- `content.md:173`으로 D2를 가리킨 곳(1차 기록 "남은 것", 2차 기록 2)은 옛 트리에서도 D1 행이었다. D2 "작업 취소"는 옛 `:174`, 지금 `:175`다.
- 생방송용 읽기 때문에 `hls.rs:275`의 DISCONTINUITY 거부는 지금 `:306`(VOD용 갈래)이고 생방송 갈래는 `:302`다(§11 Q4).

### 반영하지 않은 것

- N5의 대안 "④-2까지 머지한 뒤 실측"은 택하지 않았다. 도구가 두 PR로 갈리고 실측 묶음에 PR 2가 끼어들기 때문이다(§10.1). 렌더러를 임시로 중복 구현하라는 안은 N5 스스로 배제했다.
- 생방송 녹화에 채팅을 붙이는 일은 하지 않았다(§1.2). 이유를 바꾸어 유지했다.
- 생방송 카드 안내(`card.live.body`)에 채팅 문장을 더하는 일은 ADR-0025 영역이라 정하지 않았다(R12).

### 줄 번호 대조(옛 `bff221d` → 새 `df454c3`, 본문이 인용하는 것 중 바뀐 것만)

| 대상 | 옛 | 새 |
|---|---|---|
| `Chzzk::fetch`(`client.rs`) 함수 / 요청 로그 / 401·403 / 그 밖 비2xx | 176 / 177 / 190-192 / 193-194 | 202 / 203 / 216-218 / 219-220 |
| `finish` / `End::Done(Completed)` / `set_status(Completed)`(`manager.rs`) | 1001 / 1027 / 1028 | 1082 / 1109 / 1110 |
| `clearable` 주석·본문 / `running_count` / `enqueue`의 소유 검사 주석·`output_path` / `check_output` | 144-152 / 337-339 / 344·347 / 394 | 157-165 / 367-369 / 374·377 / 425 |
| `resume_checked` / 완료 거부 / 채널 고쳐 쓰기 / 자동 이어받기 `Interrupted` 필터 | 483-519 / 500-504 / 510-513 / 552 | 548-584 / 565-569 / 575-578 / 617 |
| `clear_finished`·`prune_finished`의 `clearable()` 사용 / `MAX_FINISHED` | 712-718·1078-1083 / 55 | 780-786·1160-1165 / 60 |
| `dto.rs`: 설정 DTO·patch / `ResolvedDto` / `ContentMetaDto`·`From` / `OutputCheck` | 301·358 / 401 / 445-448·460 / 544-554 | 310·367 / 410 / 454-457·469 / 553-563 |
| `dto.rs`: `EnqueueRequest`·`on_existing` / `JobStatus` / `JobDto` / `partial_bytes`·`missing` / `JobEvent` | 574·589-591 / 622-631 / 650 / 667-668·672 / 759-765 | 583·598-600 / 631-640 / 659 / 676-677·681 / 775-781 |
| `jobs.ts`: `removeRoute` / `isClearable`, `jobs.svelte.ts` 일괄 지우기 | 588-597 / 599-602, 385-392 | 619-628 / 630-633, 392-399 |
| `ko.ts`: `a11y.jobStatus` / 행 동작 키 묶음 / `openCookieSettings` / `keepPaused` / `dialog.overwrite.*` | 137 / 142-155 / 154 / 180 / 188-190 | 144 / 149-163 / 162 / 192 / 200-202 |
| `content.md`: `formatCount` 행 / D7 행 / D2 행(정정) | 256 / 179 / 173(오인용, 실제 174) | 257 / 180 / 175 |
| `terms.json`: DC3 패턴 / `opensWindow` | 626-631 / 699-708 | 638-643 / 711-720 |
| `ROADMAP.md` ffmpeg 제거 행 / `part.rs` 최종 이름 옮기기 안내·`finalize` / `hls.rs` DISCONTINUITY(VOD 갈래) | 66 / 349-351·355 / 275 | 69 / 380-382·386 / 306 |
| `download/mod.rs` `MAX_REFRESHES` / `model.rs` `ContentMeta` / 셸 `error.rs` `From<ErrorKind>` / 코어 `error.rs` 변종 | 43 / 34 / 69-70 / 19-71 | 47 / 43 / 71-72 / 19-77 |
| `app.md` 구현 중 변경 27(2차 기록 1이 인용) | 1169 | 1170 |

변하지 않은 것(파일이 `bff221d..df454c3`에서 바뀌지 않았거나 hunk가 그 줄 밖): `app.rs`(154-160·257-290·342-362), `power.rs:225`, `gate.rs`, `backend.rs:18`, 셸 `jobs.rs:29`·`:278-279`, `app/src/lib/stores/jobs.apply.ts:87-91`, `retry.rs`, `http.rs`, `fsutil.rs`, `ownership.rs:118`, `settings.rs:74`, `naming.rs:12`·`:22`, `consts.rs`, `info.rs:18`·`:23-37`, `services.rs:43`·`:174`·`:308`, `app/src-tauri/src/command_names.rs:2-3`, `copy.mjs:746`·`:750-755`, `patterns.md`·`components.md`·`governance.md`·`README.md`(시스템)·`versioning.md`·`worker.md`의 인용 줄.

### 남은 것

- **이 문서 밖에서 고쳐야 하는 것**: `plan.md` 트랙 ④ 행(④-1에 `chat::subtitle`·`sibling_path` 추가, ④-2는 `chat::part`만), §5 의존 표 두 행("둘 다 진행하면 이 순서"로), §6 "릴리스 ②+④" 행, 번호 표(ADR 0025는 ①이 아니라 생방송 녹화, core.md 58·app.md 77은 이미 사용됨), `decisions.md` M-④-8·9의 도구 인자(`--write-ass`·`--write-srt`). 트랙 ⑤(옛 생방송 설계(구현되어 core.md 구현 중 변경 58~60과 ADR-0025가 대신한다))의 행은 v0.7.0에 구현된 설계(core.md 58~60, app.md 77, ADR-0025)와 달라 낡았다. 이 문서는 ⑤를 다루지 않았다.
- **[실측 필요]**: mpv·VLC가 빠른 다시보기 mp4(조각 구조)의 길이·탐색을 바르게 다루는가(출력 8과 함께). 위임 기능(①) 아래 편집자가 채팅을 받을 때의 흐름은 ①이 들어온 뒤 확인한다.
- **[가정]으로 남긴 것**: `enqueue`의 `save_chat` 서버 가드(§4.4), 완료된 구간 작업의 [⋯] 채팅 항목 숨김(§4.3), PR 1의 얇은 루프와 PR 3 `collect_chat`이 같은 `next_step`을 쓴다는 것(§10.1), R12의 대응.
- 1·2차 기록의 남은 것은 그대로다: 채팅 수치 ADR 등록, "형식 바꾸기"가 카드에서 튀지 않는지, `dialog.removeChat` 문구, 쿠키 버튼 동작(D22), `examples/` 번들 제외(B22).

## 4차 개정 기록(2026-10-16, 3차 개정본의 독립 확인 반영. 줄 번호는 `df454c3` 기준)

입력은 3차 개정본의 독립 확인에서 남은 문제다. 인용은 `chzzk-downloader-diff`(`df454c3`)에서 다시 열어 확인했다.

### 처리한 것

1. **§4.6 "완료 의미" 인용 분리.** `manager.rs:463-478`은 `pause` 본문(생방송이면 `StopReason::Finish`)이고 `quit`까지 마무리한다는 말은 모듈 머리 주석(`manager.rs:20-26`)에 있다. 두 인용으로 나눴다.
2. **§4.6 "ProgressDto" 근거 교체.** `dto.rs:672`는 "마지막 진행률(running·pausing·paused에서 표시)"일 뿐 완료 행이 빈다고 말하지 않는다. 근거를 `finish`의 `Completed` 분기가 `last_progress = None`으로 비우는 코드(`manager.rs:1109-1114`)로 바꾸고 `dto.rs:672`의 실제 문구를 밝혔다.
3. **§4.6 "작업 행 모양" 근거 보완.** `dto.rs:666-668`은 필드 선언이다. `Live` 값의 출처 `ContentKindDto::Live`(`dto.rs:211-222`)와 프런트 검사(`app/src/lib/receive.ts:24`)를 함께 적었다.
4. **경로 병기.** 경로 없이 쓰던 `jobs.apply.ts`는 `app/src/lib/stores/jobs.apply.ts`로, `command_names.rs`는 `app/src-tauri/src/command_names.rs`로 모든 본문 인용을 고쳤다(1~3차 개정 기록 안의 것 포함).
5. 번호 재배정(core.md 61~, app.md 78~, ADR 0026~, patterns.md §17-34~)은 확인 결과 맞아 바꾸지 않았다.

### 처리하지 않은 것(이 문서 밖, 그대로 열려 있다)

- **N5 닫기**: `plan.md:181`(④-2에 `chat::subtitle` 골든·`naming::sibling_path`가 있음)·`:139`(`④-2(sibling_path)`), `decisions.md` M-④-8·9 행(`--write-ass`만 있고 `--write-srt` 없음)을 이 문서 §10.1에 맞게 고치고 plan.md §5 "도구 PR 먼저 묶어 머지(④-1)"에 자막 렌더러가 들어간다고 적어야 한다. 이 문서만으로는 닫히지 않는다. 가 안을 고른 근거 5개 중 5번(PR 3과 도구가 같은 `walk::next_step`을 쓴다)은 [가정]이다.
- **N6 닫기**: `plan.md:22`(DTO 직렬)·§5·§6의 "②-3 뒤 ④-5"·"릴리스 ②+④" 행을 §12.1 분기 표대로 고쳐야 한다.
