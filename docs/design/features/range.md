# 기능 ② 구간만 받기: 설계 초안

**상태·확정 결정(2026-10-16, 상태 2026-10-18 고침)**: **구현 끝**(②-1 #121·②-2 #123·②-3 #127 머지, ②-5 문서 정리, v0.10.0에 담긴다). 실측 M-②-2·M-②-6 통과(2026-10-18), M-②-3은 부분 관찰이고 R5·마무리 시간·메모리 관찰이 남았다(app.md 구현 중 변경 89, 코드와 다른 곳은 core.md 64·app.md 80·88). 아래 본문은 설계 당시 기록이다(구현 순서는 `plan.md`). 이 문서는 기능 ②(구간만 받기)의 설계다. 이 기능에 직접 걸린 확정: R5(전체 빠른 다시보기 defrag는 M-②-6 관찰 뒤 별도), ⑤-F2가 먼저 머지된 위에서 ②-1이 `same_job`에 `range`를 얹는다(필수 선행 조건 하나). defrag 실패 계약은 ⑤-F4가 정하고(§3.5 정정) ②도 따른다. 공통으로 확정된 것: Q1 실제 사용자 = 본인 + 지인 스트리머 + **그들의 편집자** · 결정 표 '유지' 26행(C4·C5·C6·C7·D1·D3~D8·R1~R4·B1~B3·U1~U5·L2·L4·L5) 추천대로 · **L6** 배포된 v0.7.0의 생방송 동작(관리자 예외, `/live/` 주소 붙여넣기)을 받아들인다 · **L7** 녹화 `.part`는 지금 경로 그대로 두고 최소 조치로 지킨다(모든 삭제 진입점의 sidecar 소유권 검사, '새 녹화 시작'과 '기존 녹화 저장'의 계약 구분, v0.7.0 파일 호환; 별도 `.rec.part` 체계는 후속) · **C1** 뒤집는 결정 ①(본인 영상 제한 → 로그인 채널 또는 맡긴 채널)·③(app.md §1.2 부분 뒤집기) 승인 · **L8** 끝난 이유 표시 · **L-D1** 맡은 채널의 생방송은 v1에서 닫는다 · **E1** ③ 조기 종료는 끈다 · **R5** 전체 빠른 다시보기 defrag는 실측 뒤 · **U2** 자막 기본 형식은 실측 뒤. UX 기준 ① "숨겨지거나 복잡하면 안 되고, 튀어 촌스러워도 안 된다". Codex 리뷰는 설계 단계에서 세 번 끝냈으므로 구현 PR에서는 중요한 PR만 돌린다. 조사 원자료·근거 확인 표·Codex 리뷰 원문은 저장소에 없다(공개 저장소 규칙). 본문이 이 결정과 다르면 결정(`decisions.md`)이 우선한다.

작성 2026-10-16, 같은 날 세 번 개정했다(끝의 "개정 기록"·"2차 개정"·"3차 개정(최신 master 기준)" 참고). 상태: **설계됨(designed)**. 판정은 partial이다. 1차는 빠른 다시보기만 하고, 일반 VOD는 뒤로 미루며, 클립과 생방송은 대상이 아니다.

**기준 트리는 `origin/master` `df454c3`(v0.7.0)이다**(3차 개정). 그 트리의 작업 트리 읽기 전용 작업 트리에서 읽었다. 1·2차는 `bff221d` 기준이었다. 그 사이에 생방송 녹화가 들어왔다(core.md 구현 중 변경 58~60, app.md 77, ADR-0025, D63, `crates/core/src/download/{live,defrag}.rs`). 이 문서의 `파일:줄`은 모두 `df454c3`에서 다시 연 줄이다.

근거 표기 규칙은 이렇다. `R##`은 1·2차 근거 확인 표 근거 확인 표의 행 번호다. 그 표는 `bff221d` 기준이라 줄 번호는 이 문서 쪽을 따른다. **가정**은 근거 문서가 없는 설계 판단이다. **실측 필요**는 실물 조각이나 플레이어로만 정할 수 있는 것이다. 근거가 없는 수치에는 `[잠정] 근거 없음, 실측·ADR-0009 묶음 등록`을 붙였다(`docs/design/system/adr/0009-unsourced-numbers.md`).

이 초안을 저장소에 넣을 때는 `docs/design/core.md`·`app.md`의 "구현 중 변경"에 번호를 붙여 옮긴다. 번호는 지금 마지막 번호 뒤에서 머지 순으로 잡는다. core.md는 60 다음인 **61부터**, app.md는 77 다음인 **78부터**다. 디자인 시스템 결정이 필요하면 D63 다음인 **D64**, ADR-0025 다음인 **ADR-0026**부터 쓴다. 다만 이 기능에서 지금 D 번호를 새로 받을 결정은 없다(§5.4의 기호 등록은 `content.md` 표 행이다).

시각·문구 결정은 `docs/design/system/`의 해당 절에 넣는다(R82). 고칠 곳은 다음과 같다.
- `patterns.md` §6.5 표의 파일 이름 행(`:398`)
- 영상 카드 와이어프레임의 "저장될 이름" 줄(`:713`)
- `content.md` §6.5 구분 기호 표(`:219-232`)
- §15.1(`ko.ts` 신설·변경 키)
- §15.2(`errors.ts` 코드별 L0)

사용자 결정 R4로 `conflict.partialOther` 문구를 고치면 `patterns.md` §6.5 카드 안 경고 행(`:399`)도 고친다.

**사용자 확정(2026-10-16)**
- Q1: 실제 사용자는 본인, 지인 스트리머, 그리고 **그 스트리머들의 편집자**까지다.
- ① UX 기준: "숨겨지거나 과정이 복잡하면 안 되고, UI에서 튀어 촌스러워져도 안 된다." 이 기능에서는 "구간을 고르는 방법"에 이 기준을 적용한다(§5.1).
- 결정 표 R1~R4: Codex 2회차가 "유지"로 판정했고(Codex 2회차 결정별 판정 표의 R1~R4 행), 사용자가 추천대로 확정했다. 그래서 다음을 **확정**으로 다룬다.
  - R1: 새 오류 kind `rangeOutOfBounds`
  - R2: 접미사 ` (H.MM.SS~H.MM.SS)`, 끝을 모르면 ` (H.MM.SS~)`, 기호 등록
  - R3: 일반 VOD 카드에서는 구간 줄을 그리지 않는다
  - R4: `conflict.partialOther`를 원인을 말하지 않는 문구로 고친다(새 문구는 초안이다)

이 기능이 Q1과 맞닿는 곳은 이렇다. 긴 다시보기에서 일부만 받는 사람은 하이라이트를 만드는 편집자일 가능성이 높다(**가정**: 사용 분포 근거는 없다). 그래서 "찾기 쉽다"는 기준이 본인보다 편집자에게 더 중요하다. 편집자가 남의 영상을 받을 때도 본인 영상 게이트(`crates/shell/src/services.rs:567-600`의 `gate.admit`)는 지금처럼 돈다. 구간은 게이트를 통과한 뒤에 붙는 요청 속성일 뿐이고, 게이트에 새 분기를 만들지 않는다.

---

## 1. 목표와 범위

### 1.1 목표
- 긴 빠른 다시보기에서 **사용자가 고른 시각 구간만** 받는다. 받는 시간과 디스크 사용량이 구간 길이만큼 줄어야 한다. 전체를 받은 뒤 잘라 내는 방식은 쓰지 않는다.
- ffmpeg 없이 한다. 조각을 고른 뒤, **마무리 때 이미 있는 `download::defrag`로 일반 mp4로 바꾼다**(3차 개정, §3.5). ROADMAP의 "ffmpeg 제거, 완전 무설치" 결정을 지킨다(`docs/ROADMAP.md:69`, R04·R05). defrag는 데이터를 옮기거나 재인코딩하지 않는다. 새 `moov`를 덧붙이고 상자 종류만 바꾼다(core.md 60 "복사 없이 제자리", `docs/design/core.md:830`).
- 지금의 이어받기, 403 재조회, 중지·재개, 앱 재시작 복구가 구간 작업에서도 그대로 동작한다(§3.4).
- 구간 기능은 찾기 쉬워야 하지만 화면을 어지럽히면 안 된다. 기본 흐름(붙여넣기 → [받기])에는 단계나 확정 지점을 하나도 더하지 않는다(README P3, `docs/design/system/README.md:19`, R51).

### 1.2 하지 않는 것
- **클립**: UI에 나오지 않는다. 클립은 일반 VOD와 같은 PD mp4 경로다(`crates/core/src/client.rs:161-166`, R02). 그래서 HLS 방식을 그대로 쓸 수 없다. "짧아서 얻는 게 거의 없다"는 판단은 **가정**이다(클립 길이 분포 근거는 없다).
- **생방송**(3차 개정): UI에 나오지 않는다. 생방송은 끝 시각이 없고, 사용자 결정으로 "고정 길이·리와인드 구간은 이번 범위 밖"이다(core.md 58, `docs/design/core.md:805`). 요청 검증은 §3.6에 있다.
- **일반 VOD(PD mp4)의 구간 받기**: 1차에서는 하지 않는다. 이 경로는 moov의 표(stts·stsz·stco 등)를 다시 써야 한다. 파일은 만들어지는데 싱크가 깨지는 식의 실패가 날 수 있다. 규모가 "HLS의 3~4배"라는 말은 조사 담당의 **추정**이고 측정 근거는 없다(R01). 다시 여는 조건은 §12.1에 있다. 참고로 defrag의 샘플 표 생성기가 생겨 "표를 새로 쓰는" 부분의 재료는 늘었다. 하지만 defrag의 입력은 조각 구조(moof/trun)이고, PD mp4의 원본 표를 구간으로 잘라 내는 일은 하지 않는다(`crates/core/src/download/defrag.rs:768-817` `plan`이 `moof`가 없으면 `NotFragmented`다). 그래서 규모 판단은 바뀌지 않는다(**가정**).
- 프레임 단위로 정확하게 자르기. 구간은 **조각 경계로 넓힌다.** 조각 길이는 약 2초다(`docs/ROADMAP.md:99`, R03). 그래서 앞뒤로 각각 한 조각 미만을 더 받는다. 재인코딩은 하지 않는다.
- 구간 여러 개를 한 작업으로 받기, 미리보기 썸네일, 타임라인 슬라이더. 이것들은 새 컴포넌트가 필요하다. governance §5는 기존 prop 조합으로 되는 것을 새로 만들지 않는다고 정한다(`governance.md:396`, R54).
- 이미 받은 파일에서 구간 잘라내기(로컬 편집기).
- **전체 빠른 다시보기 받기의 defrag**(3차 개정): 이 기능의 범위가 아니다. 지금 전체 받기는 조각 구조 그대로 마무리한다(`download/mod.rs:372`의 조건이 `PlaybackKind::Live`뿐이다). 이것을 바꿀지는 별도 결정이다(§12, "남은 것").
- Worker 변경. 치지직 Open API에는 VOD나 재생 API가 없다(R14). 이 기능은 앱 내부 재생 경로에서만 성립한다.

## 2. 기존 결정과의 관계

**뒤집는 결정은 없다.**

| 결정 | 처리 | 근거 |
|---|---|---|
| ROADMAP "ffmpeg 제거, 필요하면 선택적 remux는 나중에" | 유지한다. 조각을 고르고 마무리 때 기존 defrag만 탄다. defrag는 재인코딩하지 않고 데이터 바이트를 움직이지 않는다. remux 도구는 없다 | `ROADMAP.md:69`(R04·R05), core.md 60(`core.md:830`) |
| core.md 60 "생방송 결과를 일반 mp4로 변환한다" | **넓혀 쓴다**(3차 개정). `finish`의 변환 조건에 "구간 요청"을 더한다. 변환기·크래시 복구·실패 정책은 그대로 쓴다 | `download/mod.rs:369-389` |
| 옛 Go 구간 옵션 | 연결되지 않은 죽은 코드였다. 지킬 호환성이 없어서 새로 설계한다 | `core-behavior.md:447`·`:628`(R06) |
| `.part` 이어받기 sidecar v1 | 형식은 유지한다. **구간 작업만 v=2로 쓴다.** 새 코드는 v1과 v2를 모두 읽는다(§3.3). 전체 받기와 생방송 녹화의 sidecar는 v1 그대로다 | `core.md` §5.1(`:407`·`:412`), `part.rs:25`·`:62-67`(R08), 생방송 sidecar `live.rs:201-209` |
| jobs.json `JOBS_VERSION = 1` | 유지한다. `range` 필드는 `serde(default)`로 더한다 | `jobs.rs:29`, `channel_id` 선례 `:42-43`(R12) |
| 화질 정확 일치, `PlaybackChanged` | 그대로 쓴다. 첫 resolve든 재조회든 결과가 HLS가 아니면 기존 `PlaybackChanged`가 난다. 재조회 쪽은 이제 `Source::Live`도 같은 오류로 보낸다 | 첫 resolve `download/mod.rs:239-244`, 재조회 `segmented.rs:279-286`(R13·R36) |
| 본인 영상 게이트 | 바꾸지 않는다. 구간은 게이트를 통과한 뒤의 요청 속성이다 | `services.rs:580-585` |
| D63 생방송 용어("생방송"·"녹화"·[녹화 마치기]) | 겹치지 않는다. 구간 문구(§5.5)는 "녹화"를 쓰지 않는다 | `docs/design/system/README.md`의 D63 행, ADR-0025 |

## 3. 코어 변경(`crates/core`)

### 3.1 타입
```rust
// download/mod.rs
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TimeRange { pub start_ms: u64, pub end_ms: Option<u64> }   // 반열린 구간 [start, end). None = playlist 끝까지

pub struct DownloadRequest {
    // … 기존 필드(mod.rs:64-78, R15). live_stop(:76-78)이 생방송 녹화에서 더해졌다
    /// None = 전체. Some이면 expected_kind가 LiveRewindHls여야 한다(§3.6).
    pub range: Option<TimeRange>,
}
```
- `TimeRange`는 시각만 담는다. 비밀값이 없으므로 `Debug`를 derive해도 된다(CLAUDE.md 비밀값 규칙의 대상은 서명 값을 품는 타입이다).
- **필드를 더할 때 바꿀 리터럴 자리는 `live_stop` 선례와 같다**(3차 개정, 4차 개정에서 목록 바로잡음). 생방송 PR이 `DownloadRequest`에 `live_stop`(`download/mod.rs:77`)을 더하면서 `DownloadRequest { … }` 리터럴마다 `live_stop` 줄을 넣었다. 그 리터럴마다 `range`를 더한다. 하나라도 빠지면 컴파일이 깨진다. 아래는 `grep -rn live_stop crates app/src-tauri`(df454c3) 결과에서 `DownloadRequest` 리터럴만 고른 것이다.
  - 코어 테스트(`range: None`): `crates/core/tests/download.rs:22`, `segmented.rs:30`, `patience.rs:64`·`:76`, `progressive.rs:35`, `live.rs:67`, `recording.rs:305`(`live_stop: stop`), `live_record.rs:63`(`live_stop: Some(stop)`)
  - 코어 예제: `crates/core/examples/dl.rs:229`(`live_stop: live.then(..)`). 여기는 ②-1이 `--range`를 더하므로 `range: range_arg`처럼 인자 값을 넘긴다(§11)
  - 셸 테스트(`range: None`): `crates/shell/tests/backend.rs:32`
  - 셸 본문: `crates/shell/src/jobs.rs:88`(`to_request`, 여기는 `None` 대신 `JobRecord.range`를 넘긴다, §4.1). 매니저는 이 결과를 받아 `req.live_stop`만 덮어쓴다(`manager.rs:1022-1023`). 그래서 매니저에는 `range`를 따로 넣을 곳이 없다.
  - **대상이 아닌 것**: `crates/shell/src/manager.rs:136`의 `live_stop: None`은 `DownloadRequest`가 아니라 매니저 내부 `Job` 구조체(`manager.rs:112-129`, 필드 `:115-116`, 생성자 `Job::new` `:131-`)의 리터럴이다. `range`는 `Job.rec: JobRecord`(§4.1)에 들어가므로 `Job`에는 더하지 않는다.
- **끝을 모르면 `end_ms = None`이다.** 길이를 모를 수 있다는 것은 사실이다(`crates/core/src/model.rs:55` `duration_secs: Option<f64>`). 그래서 센티널 값을 두지 않고 `Option`을 코어까지 그대로 넘긴다. `None`을 "playlist 끝"으로 바꾸는 곳은 `select_range` 하나뿐이다(§3.2).
- **정규화는 웹뷰가 한다.**
  - 전체를 덮는 구간(start = 0이고 end ≥ 영상 길이)이면 웹뷰가 `range`를 보내지 않는다(§4.1, §5.2).
  - 길이를 알고 끝이 길이를 넘으면, 웹뷰는 끝을 길이로 줄여서 보낸다. 그래야 접미사에 실제로 받는 범위가 찍힌다.
  - 줄인 값은 **초 단위 정수**로 만든다. 길이는 `f64`라서(`model.rs:55`) 그대로 쓰면 `end_ms`에 1초 미만 자리가 생긴다. 그러면 초 단위 접미사는 같은데 `end_ms`만 다른 두 요청이 생긴다(§5.6 partial 행).
  - 올림(`ceil(durationSecs) × 1000`)을 쓴다. 내림이면 마지막 조각이 1초보다 짧을 때 `select_range`가 그 조각을 빠뜨릴 수 있다. 그 대가로 접미사의 끝 시각이 메타 줄의 길이보다 1초 늦게 찍힐 수 있다. 메타 줄의 `formatClock`은 내림이다(`duration.ts:3-5`·`:22`). **가정**: 이 차이는 받아들일 만하다고 본다.
  - 끝을 줄이는 판정이 코어 `select_range`에도 남아 있는 것은 셸을 우회한 요청에 대비하기 위해서다. 셸은 영상 길이를 모르므로 이 정규화를 할 수 없다(R42).
  - 웹뷰가 정규화를 빼먹어도 결과는 "접미사가 붙고 v2 sidecar를 쓰는 전체 받기"일 뿐이다. 이 경우에는 defrag로 일반 mp4가 된다. 내용은 맞으므로 안전 문제는 없다(**가정**에 기댄 결정: 정규화를 신뢰 경계로 보지 않는다).

### 3.2 조각 고르기: `hls::select_range`(순수 함수)
```rust
/// EXTINF 누적 c[i] = Σ duration_ms[0..i]로 조각 범위를 고른다(duration_ms는 hls.rs:44, 합은 :332, R17).
/// first = max{i : c[i] <= start}, last_excl = min{j : c[j] >= end}(끝은 올림).
/// end가 None이거나 playlist 전체보다 크면 playlist 끝으로 자른다.
pub fn select_range(pl: &MediaPlaylist, r: TimeRange) -> Result<SegmentSpan, Error>;

pub struct SegmentSpan { pub first: u32, pub last_excl: u32 }
```
- 입력은 VOD용 `parse_media`가 만든 playlist뿐이다. 생방송용 `parse_live_media`(`LiveSnapshot`, core.md 58 "hls" 항목)의 창 playlist에는 쓰지 않는다. 생방송 창은 계속 밀리므로 위치 기반 구간이 성립하지 않는다. doc 주석에 이 제한을 적는다.
- 오류는 세 경우다. `start >= end`(end가 Some일 때만), `start >= playlist 전체`, 고른 결과가 빔. 셋 모두 새 kind `rangeOutOfBounds`다(§7, R1 확정).
- 출력 시각은 `[c[first], c[last_excl])`다. 고른 구간을 늘 포함하고, 앞뒤로 각각 한 조각 미만을 더 받는다.
- **시간축 전제(실측 필요, R18)**: 이 함수는 "playlist 첫 조각의 시작 = 치지직 플레이어의 0:00:00"을 전제한다. EXTINF는 각 조각의 **지속 시간**이다(RFC 8216 §4.3.2.1, https://www.rfc-editor.org/rfc/rfc8216.html#section-4.3.2.1). 그래서 EXTINF 합이 영상 길이와 같아도 원점이 같다는 증명은 되지 않는다. 이 전제는 §13 실측 2번(장면 대응)으로만 통과시킨다.
- **defrag는 이 전제를 풀어 주지 않는다**(3차 개정). defrag는 출력 파일 안의 시각을 0부터 다시 쌓을 뿐이다(§3.5). "사용자가 적은 0:10:00이 어느 조각인가"는 이 함수가 EXTINF로 정한다. defrag는 그 대응에 관여하지 않는다.

### 3.3 이어받기 상태(`download/part.rs`)
```rust
pub struct HlsState { /* 기존(part.rs:79-88) */ #[serde(default)] pub range: Option<HlsRange> }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]   // HlsState가 Copy·Default라서(part.rs:79, R22)
pub struct HlsRange {
    pub first: u32,
    pub last_excl: u32,
    /// 사용자가 요청한 시각. 같은 작업인지 비교할 때 쓴다
    pub start_ms: u64,
    pub end_ms: Option<u64>,   // TimeRange와 같다. None = 끝까지
}
```
- **`Timeline` enum과 `base_us`는 뺀다**(3차 개정, 1·2차의 R23 결정을 뒤집는다). 1·2차가 `Timeline`을 첫 PR부터 넣은 이유는 하나였다. 안 A로 시작한 `.part`를 안 B를 아는 앱이 이어받으면 재기준한 조각과 하지 않은 조각이 한 파일에 섞인다는 것이다. 이제는 `.part`에 늘 원본 조각만 들어간다. 시각 정규화는 마무리 때 defrag가 파일 전체에 한 번만 한다(§3.5). 그래서 섞일 형식이 없다.
- `HlsState`는 `Default`를 derive한다(`part.rs:79`). 생방송 엔진이 `..HlsState::default()`로 만든다(`live.rs:206-209`). `Option` 필드라서 `Default`는 그대로 `range: None`이 된다.
- 버전 규칙:
  - 쓰기: `range`가 있으면 `v = 2`, 없으면 지금처럼 `v = 1`이다. 생방송 녹화는 `range`가 늘 없으므로 v1 그대로다(`live.rs:201-205` `Sidecar::new` → `SIDECAR_VERSION`).
  - 읽기: `same_job`은 `v ∈ {1, 2}`를 받는다. 그리고 **`(v == 2) == range.is_some()`**이어야 하고, 요청 range의 시작·끝 시각이 sidecar와 같아야 한다.
  - 옛 앱은 v2 sidecar를 만나면 `same_job`이 false라고 보고 `.part`를 지운 뒤 새로 시작한다(`part.rs:200-207`, R09). 구간 sidecar를 전체로 잘못 이어받는 일은 없으므로 다운그레이드 쪽은 안전하다.
  - 상수 `SIDECAR_VERSION` 자체는 올리지 않는다. 올리면 `part.rs:63`의 비교 때문에 진행 중이던 모든 전체 받기 작업과 끊긴 생방송 `.part`가 업데이트 직후 지워진다(R10). 생방송 `.part`는 다시 받을 수 없다(core.md 58 "이어받기는 없다").
- **`same_job` 호출처는 셋이고, 셋 모두 range를 넘긴다(R41).** `PartFile::resume`도 인자를 하나 더 받는다(`download/mod.rs:280`, 생방송 경로도 같은 호출을 지나므로 `req.range`(늘 `None`)를 넘긴다).
  - 코어 재개: `part.rs:201`
  - 카드의 충돌 확인: `crates/shell/src/output.rs:114`
  - 작업 행의 이어받기 바이트: `crates/shell/src/jobs.rs:330`(`partial_bytes`). 고치지 않으면 구간이 다른 `.part`를 같은 작업으로 세어 엉뚱한 "{size}부터 이어받음"이 보인다.
- 지문(`mismatch`: 세그먼트 수, EXTINF crc, init 길이)은 지금처럼 **playlist 전체 기준**으로 둔다(`segmented.rs:86-87`, R20). 재조회하면 늘 전체 playlist를 받기 때문이다. 지문이 같으면 같은 위치는 같은 조각이다. 그래서 재개할 때는 `select_range`를 다시 계산하지 않고 sidecar의 `first`·`last_excl`을 쓴다(위치 기반 규칙 `core.md:744`, R21).

### 3.4 엔진(`download/segmented.rs`)에서 바꿀 곳(빠짐없이)

줄 번호는 `df454c3` 기준이다. 생방송 PR이 이 파일에서 바꾼 것은 세 가지다. 첫째, `Body`·`utf8`·`pick_variant`·`fetch_cancellable`·`fetch`를 `pub(super)`로 열어 `live.rs`와 나눠 쓴다(`:37`·`:335`·`:346`·`:370`·`:382`). 둘째, 재조회의 `PlaybackChanged`에 `Source::Live`를 더했다(`:279-286`). 셋째, 그 때문에 그 뒤 줄이 한 줄씩 밀렸다. `run`(`:117-263`)은 그대로라서 아래 줄은 1·2차와 같다. 구간 변경은 `run` 안에서만 하고, 공유 도우미의 시그니처는 바꾸지 않는다. 그래야 생방송 엔진에 영향이 가지 않는다.

| 위치 | 지금 | 구간 |
|---|---|---|
| `run` 시작, 새 sidecar(`state()` `:106-114`, `next_index: 0`은 `:108`) | `next_index: 0` | `state()`에 `range: Some(HlsRange{..})`를 더하고 `select_range` 결과를 쓴다. 구간이면 v=2 |
| 재개 분기(`:129-138`) | `mismatch` 검사 | 그대로 둔다. 추가로 `last_excl ≤ n`인지 확인하고, 아니면 `SourceChanged` |
| init을 쓴 직후 checkpoint(`:153-157`) | `next_index = 0` | `next_index = first`(R26) |
| `total_ms`(`:168`) | playlist 전체 | `c[last_excl] - c[first]` |
| `next > n` 검사(`:170`) | 전체 n | `next < first \|\| next > last_excl`이면 `SourceChanged` |
| `done_ms`(`:175`) | `durations[..next]`의 합 | `durations[first..next]`의 합 |
| `report`(`:179-188`, segments는 `:182`) | `segments = (k, n)`, 호출은 `report(job, …, next, …)` | 분모는 `last_excl - first`이고, 호출하는 쪽이 `k = next - first`를 넘긴다(R30). 추정 크기 식(`:184-185`)은 `total_ms`가 바뀌므로 저절로 구간 기준이 된다 |
| 스트림 범위(`:201`) | `segments[next..]` | `segments[next..last_excl]`(R25) |
| 쓰기 직전(`:244`) | `p.write(&bytes)` | **바꾸지 않는다**(3차 개정). 1·2차의 `mp4frag::rebase`는 없앴다(§3.5) |
| 루프를 빠져나온 뒤(`:260-263`) | 검사 없이 곧바로 `finish` | **새 검사**: `next == last_excl`이 아니면 `SourceChanged`로 멈춘다. 지금 코드에 이런 검사가 없다(R27). 이 검사는 `finish`(곧 defrag) **앞**에 둔다. 덜 받은 파일을 변환하지 않기 위해서다. 전체 받기 경로에도 넣을지는 이 PR의 범위가 아니다 |
| `finish`(`download/mod.rs:355-399`, 변환 조건은 `:372`) | `expected_kind == PlaybackKind::Live`일 때만 defrag | 조건을 `expected_kind == Live \|\| req.range.is_some()`로 넓힌다(§3.5). 로그 문구 "생방송 파일 …"(`:376`·`:387`)은 두 경우를 다 덮는 말로 고친다 |

- 403 재조회 흐름(`acquire(job, None)` → `mismatch` → `refreshed_at`, `:215-228`)은 바꾸지 않는다. `continue 'refresh`는 `:201`에서 `next`부터 다시 시작한다. 그곳만 `..last_excl`로 자르면 구간에서도 같다(R28).
- `PlaybackChanged`(HLS → PD, 또는 HLS → 생방송)도 같은 오류다. 구간을 다른 방식에서 이어 받을 방법은 없다.
- 진행 중 다운로드는 계속된다는 규칙과 연결 대기(인내 장부, `core.md` 구현 중 변경 56)는 바뀌지 않는다(`segmented.rs:196`, R29).

### 3.5 마무리: 구간 결과를 `download::defrag`로 일반 mp4로 바꾼다(3차 개정, 1·2차의 안 A·안 B·`mp4frag`를 대체)

**결론.** 1·2차의 안 A(조각을 그대로 붙이기)와 안 B(`tfdt`를 제자리에서 0으로 맞추기)를 **둘 다 버린다.** 구간 결과는 생방송 녹화와 같은 `finish` 경로로 일반 mp4로 바꾼다. 새 모듈(`mp4frag`), `Timeline`, fuzz target은 만들지 않는다.

**두 안을 버리는 근거(core.md 60 실측).** core.md 60이 생방송 실물로 확인한 내용은 이렇다(`docs/design/core.md:829`).
- init과 조각을 그대로 이어 붙인 파일은 "macOS QuickTime(AVFoundation)이 첫 조각 길이(1~10초)만 보고 멈추며 탐색이 안 된다". 이것이 안 A가 만드는 파일의 모양이다.
- "`mvhd`/`mehd`에 길이를 넣고 `tfdt`를 0으로 바꾼 조각 구조로도 고쳐지지 않"았다. 이것이 안 B가 만드는 파일의 모양이다. 안 B는 1·2차 §3.5에서 tfdt를 0 기준으로 옮기고 init `mvhd`·`mehd`를 고치는 안이었다.
- 빠른 다시보기도 같은 fMP4 구조다(`docs/ROADMAP.md:99` "init + `styp/moof/mdat` 세그먼트"). 그래서 두 안 모두 QuickTime에서 같은 문제가 날 것으로 본다. 이 판단은 **가정**이다. 실측은 생방송 실물로만 했고 빠른 다시보기 실물은 보지 않았다. 확인은 §13 실측 6번에 넣었다.

**defrag가 tfdt 시작이 0이 아닌 입력을 처리하는가: 처리한다(코드와 테스트로 확인).**
- `Tables::on_tfdt`(`defrag.rs:535-550`)는 트랙의 첫 `tfdt`를 그 값 그대로 `first_tfdt`로 받는다. 0이라고 가정하지 않는다. 그 뒤 조각은 앞 조각 끝과 이어지는지만 센다(`discontinuities`).
- `tfdt` version 0(32비트)과 version 1(64비트)을 모두 읽는다(`defrag.rs:655-665`). tfdt가 없는 조각도 받는다(테스트 `fragment_without_tfdt_after_a_first_one_is_accepted`, `defrag/tests.rs:1495`).
- `build_moov`(`defrag.rs:913-988`)의 처리는 이렇다.
  - 트랙마다 `first_tfdt + min_pts`를 movie timescale로 바꾼다(`:924-931`).
  - 그중 가장 이른 값을 0으로 본다(`earliest`, `:932`).
  - `stts`는 0부터 샘플 길이만 담는다.
  - 늦게 시작하는 트랙에는 차이만큼 빈 편집(`elst` `media_time = -1`)을 앞에 둔다(`put_edts`, `:990-1019`).
  - `mvhd`·`tkhd`·`mdhd` 길이는 샘플 합으로 다시 쓴다(`:958-984`).
  - `mvex`(곧 `mehd`)는 새 `moov`에 넣지 않는다.
- 테스트 `later_track_gets_empty_edit_for_start_difference`(`defrag/tests.rs:936-966`)가 "방송 기준의 큰 tfdt"(오디오 1,127,000,000틱)와 트랙 사이 22ms 차이를 넣는다. 그리고 비디오 `elst = [(22, -1), (100, 0)]`, 오디오는 지연 없음을 단언한다.
- **이번에 직접 돌려 보았다**(3차 개정, 저장소 밖 실행). `CARGO_TARGET_DIR`을 저장소 밖 임시 폴더로 두고 `examples/defrag`로 합성 fixture `testdata/hls/init.mp4 ‖ seg1.m4v`를 변환했다. 저장소 트리에는 쓰지 않았다. seg1은 `tfdt = 2000`이라 첫 조각 시각이 0이 아니다(`gen-fixtures.mjs:626` `msn × 2000`). 결과는 이렇다.
  - `Converted { tracks: 2, samples: 8, discontinuities: 0 }`
  - 두 트랙 모두 `stts [(4, 1000)]`(0부터)
  - 비디오 `elst [(44, 0)]`, 오디오 `elst [(19, -1), (83, 0)]`. 같은 틱 값 2000이 timescale 90000과 48000에서 서로 다른 초가 되어 생긴 약 19ms 차이가 빈 편집으로 남았다.
  - 원래 `moov`·`moof`·`styp`·`emsg`는 `free`로 바뀌었다.
  - 합성 init의 `stsd`는 entry가 0개라서(`gen-fixtures.mjs:580` `full('stsd', 0, 0, be32(0))`, `stbl` 상자는 `:578`부터) 이 결과는 재생할 수 있는 파일이 아니다. 구조만 확인한 것이다.

**그래서 1·2차의 쟁점은 이렇게 정리된다.**

| 1·2차 쟁점 | defrag로 마무리한 뒤 | 근거 |
|---|---|---|
| 첫 `tfdt`가 0이 아니면 앞이 비어 보이는가(안 A/B 판정, R33·R79·R80) | 대상이 없어졌다. 출력의 시각은 가장 이른 트랙 기준 0부터다 | `defrag.rs:924-932` |
| 기준 T = 트랙 최솟값 하나(R31) | defrag의 `earliest`가 같은 규칙을 이미 구현했다. 트랙 사이 차이는 `elst`로 남는다 | `defrag.rs:932`·`:990-1019`, `defrag/tests.rs:936` |
| tfdt 크기 불변·version 유지(R32) | 대상이 없어졌다. tfdt를 고치지 않는다 | — |
| init `mvhd`·`mehd` 길이(R34) | defrag가 다시 쓴다(`mvex`를 뺀다) | `defrag.rs:958-984` |
| 조각 안 `sidx`·`emsg v1`(R35) | `styp`·`emsg`·`sidx`·`mfra`·모르는 상자를 `free`로 바꾼다 | `defrag.rs:812-813`, core.md 60 "복사 없이 제자리" (3) |
| `mp4frag` 오류(음수·모르는 track_id) | defrag의 검증으로 대신한다. init에 없는 트랙은 `Err`(`defrag.rs:640-643`)이고, `senc`도 거부한다(`:615`) | `defrag.rs` |

**연결 방법.**
- `finish`의 조건 한 줄을 넓힌다(§3.4 표 마지막 행). 나머지는 생방송 경로를 그대로 쓴다.
  - 마지막 checkpoint 뒤 `PartFile::with_file_blocking(defrag::defragment)`로 변환한다(`mod.rs:374`, `part.rs:331-360`).
  - `Converted`이면 다시 checkpoint해서 붙인 `moov`까지 `committed_len`에 넣는다(`mod.rs:379-383`).
  - 실패하면 `tracing::warn!`만 남기고 조각 구조 그대로 마무리한다(`mod.rs:386-388`).
- **실패 정책은 생방송과 같게 둔다(가정).** 변환에 실패해도 내용은 맞고, 구간 파일이 아예 남지 않는 것보다 낫다고 본다. 대가는 QuickTime에서 첫 조각만 재생되는 파일이 남을 수 있다는 것이다(§12 위험 행).
- **크래시 복구는 defrag의 것을 그대로 쓴다.** (2)단계 도중 크래시는 `committed_len`이 붙인 `moov`를 잘라 준다. (3)단계 도중 크래시는 `free`의 첫 자식으로 원래 상자를 알아보고 다시 변환한다(core.md 60 "한계" ②, 테스트 `crash_during_patches_then_resume_truncation_reconverts_identically`, `defrag/tests.rs:1006`).
- **재개 순서를 따져 본 결과**(코드에서 따진 것이고 실행한 것은 아니다): 두 번째 checkpoint 뒤·rename 전에 끊긴 구간 `.part`를 다시 부르면 이렇게 흐른다. 이 흐름은 통합 테스트로 고정한다(§10.4).
  1. `PartFile::resume`
  2. `segmented::run` 재개 분기(지문 확인, 네트워크 요청 있음)
  3. `next == last_excl`이라 스트림이 비어 있음
  4. 끝 검사 통과
  5. `finish`
  6. `AlreadyFlat`(`defrag.rs:780-784`)
  7. rename
- **한계(그대로 물려받는다).**
  - 변환 중에는 취소를 확인하지 않는다(core.md 60 "검증 반영" 끝).
  - `moov`가 파일 끝에 있다. 로컬 재생용이라 네트워크 스트리밍의 빠른 시작은 고려하지 않는다.
  - 변환은 샘플 표를 메모리에 쥔다(`defrag.rs:514-521`: 샘플마다 `sizes`의 `u32` 하나, 동기 샘플마다 `sync`의 `u32` 하나, `trun`마다 `chunks`의 `u64` 하나, `stts`·`ctts`·`stsc`는 run-length). 메타 상자 하나의 상한은 64 MiB다(core.md 60 "복사 없이 제자리"). **구간이 녹화보다 짧다는 보장은 없다.** 구간은 0 근처에서 거의 끝까지 고를 수 있고, 정규화는 "정확히 전체"만 `None`으로 바꾼다(§3.1). 그래서 최악은 "전체 빠른 다시보기 하나를 defrag하는 것"과 같다. 규모 어림: 한 시간 = 비디오 30fps + 오디오 약 47 프레임/초(AAC 48 kHz ÷ 1024)라면 약 28만 샘플, `sizes`만 약 1.1 MB다(**가정**: 프레임률·오디오 형식은 실측하지 않았다). 실제 마무리 시간과 메모리는 **실측 필요**(실측 6번에 관찰을 더했다, §13).

**`DefragReport::discontinuities`.** 구간은 연속 조각만 받으므로 0이어야 한다. 0이 아니면 `tracing::warn!`(조각 index만, §8)으로 남긴다. 판정이나 오류로 쓰지는 않는다(**가정**: VOD 조각의 tfdt 연속성은 실측하지 않았다).

**정정(Codex 3회차 M4, 2026-10-16): "defrag 실패면 조각 구조로 남는다"는 모든 I/O 실패에 성립하지 않는다.** 복원 시도는 moov 덧붙이기 실패에만 있고 그 복원 실패도 무시되며(`defrag.rs:90-101`), 종류 패치 도중 실패하면 이미 바뀐 파일이 그대로 반환되고 호출자는 경고만 남기고 최종 파일로 옮긴다(`mod.rs:386`). 그래서 이 기능은 defrag를 쓰되, 변경 전 검증 실패(원본 그대로)와 변경 도중 I/O 실패를 구분하는 계약을 ⑤-F4가 정한 뒤 구간 결과에도 같이 적용한다(plan.md ⑤-F4·§5-B). defrag를 채택하는 판단(첫 `tfdt`를 0으로 가정하지 않고 트랙 간 차이를 편집 목록으로 보존한다는 서술)은 코드·테스트와 일치해 유지한다.

### 3.6 일반 VOD(PD)·클립·생방송 요청 거부(R36 바로잡음 유지, 3차 개정에서 생방송 추가)
`expected_kind = LiveRewindHls`인 요청에 PD나 생방송이 오면 첫 resolve에서 이미 `PlaybackChanged`가 난다(`download/mod.rs:239-244`). 그래서 다음처럼 둘로 나눈다.
- **요청 자체가 잘못된 경우**: `range.is_some() && expected_kind != LiveRewindHls`.
  - 클립·일반 VOD(`Progressive`)·생방송(`Live`, `model.rs:90-95`) 모두 여기에 든다.
  - 셸이 `invalidInput`으로 먼저 막는다(§4.1).
  - 코어에서는 `Error::Unsupported(Unsupported::RangeNotHls)`를 **`Chzzk::download`의 맨 처음**에 낸다. 곧 최종 파일 Skip 검사(`mod.rs:274-276`)와 `PartFile::resume`(`mod.rs:280`)보다 앞이다. 네트워크 요청도 하기 전이다. 위치가 중요한 이유는 둘이다(3차 개정에서 바로잡음).
    - `resume`보다 뒤에 두면 `.part`를 잃는다. 예를 들어 셸을 우회한 `expected_kind = Live` + `range: Some` 요청이 있고, 같은 경로에 끊긴 생방송 `.part`(v1, `kind = Live`)가 있다고 하자. 그러면 `resume`의 `same_job`이 새 규칙 `(v == 2) == range.is_some()`에 걸려 false가 되고, `part.rs:200-207`이 그 `.part`를 지운다. 다시 받을 수 없는 녹화가 사라진 뒤에야 `run` 안의 검사가 오류를 낸다. 생방송의 "끊긴 `.part` 마무리" 분기(`mod.rs:313-324`)도 `resume` 뒤라서 그곳에 두어도 같다.
    - Skip 검사보다 뒤에 두면 잘못된 요청이 `Skipped`로 조용히 성공할 수 있다.
  - `Unsupported` enum에 새 변형 하나를 더하는 일이다(`error.rs:80-82`). ErrorKind는 그대로 `Unsupported`라서(`error.rs:147`) 셸 `ErrorCode` 표는 바뀌지 않는다(`crates/shell/src/error.rs:88`·`:173`).
  - 셸 테스트 `crates/shell/tests/error_map.rs:300-308`은 `Unsupported` 변형을 하나씩 나열하고, 모두 `ErrorCode::Unsupported`인지 단언한다. 이 목록에 `Unsupported::RangeNotHls`를 더한다.
- **요청은 HLS였는데 실제가 PD나 생방송인 경우**: 기존 `PlaybackChanged`를 그대로 쓴다. 새 분기는 없다.

## 4. 셸 변경(`crates/shell`)

### 4.1 DTO·command
- `EnqueueRequest`(`dto.rs:583-605`, R38)에 `range?: TimeRangeDto | null` 필드를 더한다. 모양은 `{ startMs: number, endMs: number | null }`(ts-rs)다. `endMs = null`은 영상 길이를 모를 때의 "끝까지"이고, 셸과 코어에서도 `None` 그대로 둔다. 바꾼 뒤 `UPDATE_BINDINGS=1`로 bindings를 다시 만든다.
- **`check_output`에는 DTO가 없다(R39).** `check_output`은 command 인자를 펼쳐 받는다(`app/src-tauri/src/commands.rs:109-115`). 그래서 인자 `range: Option<TimeRangeDto>`를 하나 더한다. 같이 바뀌는 곳은 다음과 같다.
  - `App::check_output`(`crates/shell/src/app.rs:223`)
  - 매니저(`manager.rs:425`)
  - `OutputQuery`(`output.rs:26`)
  - 앱 래퍼 `checkOutput`(`app/src/lib/api.ts:61`)과 그 인자 형
  - 카드의 호출(`ResolveCard.svelte:130`)

  목적은 둘이다. ① 같은 이름 `.part`의 sidecar 비교(`partialSame`·`partialOther`, `receive.ts:129-130`, R40)가 구간까지 보게 한다. ② 접미사가 붙은 최종 이름을 돌려준다(§4.2).
- **셸 재검증은 길이 없이 할 수 있는 것만 한다(R42).** `enqueue` 경로에는 영상 길이가 들어오지 않는다. 근거는 셋이다. `EnqueueRequest`에 길이 필드가 없다(`dto.rs:583-605`). `services.rs:567-600`은 meta를 조회하지 않는다. ownership 캐시에는 채널 ID만 있다(`ownership.rs:156`). 그래서 길이 검증은 코어 `select_range`에 맡긴다. 셸이 하는 검증은 둘이고, 실패는 기존 `invalidInput`이다(`crates/shell/src/error.rs:63`, `services.rs:575` 선례, R43).
  - `expected_kind != LiveRewindHls`(클립·일반 VOD·생방송에 구간) → 거부
  - `end_ms`가 있고 `start_ms >= end_ms` → 거부
  - 시작이 길이를 넘는지, 끝을 자를지, 전체를 덮으면 `None`으로 바꿀지는 웹뷰와 코어가 맡는다. 웹뷰는 사용자에게 바로 알리는 편의이고, 신뢰 경계는 코어(`select_range`)다.
- `JobRecord`에 `#[serde(default)] range: Option<TimeRange>`를 더하고, `to_request`(`jobs.rs:80-90`, `live_stop: None`은 `:88`, R46)가 넘긴다. `JobDto`에는 작업 행 표시용 `range: TimeRangeDto | null`을 더한다.
- "이미 목록에 있음"(`conflict.inQueue`)은 지금처럼 출력 경로로 판단한다(`output.rs:54`, R45). 구간이 다르면 이름도 달라서 겹치지 않는다.
- 생방송 자동 이어받기 제외 규칙(core.md 59 "셸: `.part`가 없는 생방송은 자동 이어받기에서 뺀다")은 `is_live()` 기준이다(`manager.rs:1021`). 구간 작업은 `LiveRewindHls`라서 이 규칙과 만나지 않는다.

### 4.2 파일 이름 접미사(`naming`)
- `naming::range_suffix(r: &TimeRange) -> String`: 이름 끝에 ` (H.MM.SS~H.MM.SS)`를 붙인다. 예: `제목 (0.10.00~0.20.00).mp4`. 끝을 모르면(`end_ms = None`) ` (H.MM.SS~)`다. 예: `제목 (0.10.00~).mp4`. 끝 시각을 지어내 찍지 않으려는 것이다. R2로 이 모양이 확정됐다. "~ 뒤가 비면 끝까지"로 읽힌다는 근거는 여전히 없다(**가정**). 번호 이름이 이미 ` ({n})`을 쓴다(`output.rs:80`). 그래서 같은 이름이 있으면 `제목 (0.10.00~0.20.00) (2)`가 된다.
- **`:`는 쓰지 않는다.** Windows는 `:`를 `_`로 바꾸고 macOS도 바꾼다(`naming.rs:143-144`, R47). `~`와 `.`는 금지 목록에 없다. 접미사를 붙인 뒤 이름 전체는 기존 `sanitize_filename(Platform)`을 거친다.
- **생방송 이름과 모양이 겹치지 않는다**(3차 개정). 생방송 이름은 앞에 `[생방송 YYMMDD-HHMM] `를 붙인다(`naming.rs`의 `ContentKind::Live` 갈래, core.md 58 "파일 이름"). 구간 접미사는 뒤에 붙고 둥근 괄호다.
- **자를 때는 제목 쪽을 줄인다.** 지금 `output_path`는 이름 끝부터 자르므로(`naming.rs:225-228`), 그대로 두면 접미사가 잘린다. "제목 쪽을 줄이는" helper는 생방송 PR에서도 생기지 않았다. 생방송 접두는 `default_filename`에서 제목 앞에 붙고, 길이 처리는 기존 `output_path`에 맡긴다(`git diff bff221d df454c3 -- crates/core/src/naming.rs`에 자르기 helper 추가가 없다). 그래서 이 PR이 새로 만든다. `free_name`의 선례(`output.rs:72-84`: 접미사 길이만큼 이름을 먼저 줄인다)를 따른다(R48). 세 `Platform`을 한 호스트에서 테스트한다.
- **접미사는 `check_output` 한 곳에서만 붙인다.**
  - 웹뷰는 `check_output`이 돌려준 `fileName`을 그대로 `enqueue`에 보낸다(`app/src/lib/receive.ts:142` "이름은 `check_output`이 정리한 `fileName`을 보낸다(검사한 경로와 같게)").
  - 번호 이름이면 `freeFileName`을 보낸다(`receive.ts:152`). `freeFileName`도 `check_output`이 정리한 이름에서 만든다(`crates/shell/src/output.rs:38`·`:42`).
  - `enqueue`는 받은 이름으로 경로를 다시 만든다(`crates/shell/src/manager.rs:377` `output_path(&folder, &req.file_name, …)`).
  - 그래서 `enqueue`에서도 접미사를 붙이면 `제목 (구간) (구간)`, 번호 이름이면 `제목 (구간) (2) (구간)`이 된다.

  규칙은 이렇다.
  - `check_output`: 입력 이름 + `range_suffix` → `output_path` → `fileName`·`path`·`freeFileName`·`partial`. 접미사가 붙은 경로로 충돌과 `.part`를 본다.
  - `enqueue`: `range_suffix`를 부르지 않는다. `req.file_name`을 이미 최종 이름으로 보고 지금처럼 `output_path`만 거친다. `req.range`는 코어 요청(`to_request`)과 `JobDto` 표시에만 쓴다.
  - 이 규칙은 "`enqueue`의 `output_path(check.fileName)` = `check.path`"라는 지금의 약속(`receive.ts:142`)에 기댄다. 구간 이름에서도 이 약속이 지켜지는지 셸 테스트로 고정한다(§10.3).
  - 번호 이름도 접미사를 지켜야 한다. 지금 `free_name`은 받은 이름 끝을 잘라 ` ({n})` 자리를 만든다(`output.rs:72-84`, `truncate_utf8(name, room)`). 접미사가 붙은 이름을 그대로 넘기면 긴 제목에서 구간 접미사가 잘린다. 그래서 `free_name`에 제목과 구간 접미사를 따로 넘기고 `{제목을 줄인 것}{구간 접미사} ({n})`로 만든다.
  - 웹뷰를 우회해 접미사 없는 이름으로 `range`를 보내면, 이름에 구간 표시가 없는 구간 파일이 생긴다. 내용은 맞으므로 받아들인다(§3.1의 정규화와 같은 판단, **가정**: 이름을 신뢰 경계로 보지 않는다).
- 카드의 파일 이름 칸에는 제목만 두고 접미사는 넣지 않는다. 그래서 사용자가 파일 이름을 고쳐도 구간 표시는 남는다.
- **"저장될 이름" 표시 조건(R49).** 지금은 이름이 잘렸을 때만 `filename.willSaveAs`가 보인다. 표시 조건은 `ResolveCard.svelte:251`이고, `truncated = file_name != q.file_name`은 `output.rs:39`다. 가장 작은 변경은 `OutputCheck.truncated`의 뜻을 "최종 이름이 입력과 다르다(잘림 또는 구간 접미사)"로 넓히는 것이다. 필드 이름과 카드 조건은 그대로 두고 doc 주석(`dto.rs:558` "입력과 `file_name`이 다르다")만 다듬는다. 이 주석은 이미 넓은 뜻이라 사실상 그대로 맞다. 이 뜻을 고정하거나 규정하는 곳은 모두 이렇다.
  - 앱: `ResolveCard.svelte:251`(표시 조건), `app/src/test/fixtures.ts:70`(`truncated: false`).
  - 가짜 백엔드: `app/e2e/mock/backend.ts:324`. 지금은 늘 `truncated: false`이고 이름을 그대로 돌려준다(`:316-331`). `range`가 있으면 접미사를 붙인 이름과 `truncated: true`를 돌려주게 고친다(§5.7).
  - 셸 테스트: `crates/shell/tests/output.rs:50`(깨끗한 이름은 `!truncated`), `:57-70`(잘림·공백·`.mp4`·`:` 치환은 `truncated`). 넓힌 뜻에서도 그대로 참이므로 고치지 않는다. 구간 접미사 경우만 더한다(§10.3).
  - **디자인 시스템**(시각·문구의 단일 원천, CLAUDE.md): `patterns.md` §6.5 표의 파일 이름 행 "잘리면 아래 `filename.willSave`"(`:398`)와 와이어프레임 주석 "(잘릴 때만)"(`:713`)이 지금의 표시 조건을 규정한다. 둘 다 "최종 이름이 입력과 다를 때(잘림 또는 구간 접미사)"로 고친다. 이 절의 키 이름 `filename.willSave`는 실제 키 `filename.willSaveAs`(`app/src/lib/copy/ko.ts:73`)와 다르다. patterns 쪽의 오기로 보고, 고치는 김에 실제 키로 맞춘다(기존 불일치, 이 기능과 무관하다).
  - 설계 문서: `core.md`·`app.md` 구현 중 변경에 필드 이름과 뜻이 어긋난다는 것을 적는다. 이름을 바꿀지는 PR ②-2 리뷰에서 정한다.
- 파일 이름 접미사에는 `content.md` §6.5의 괄호 규칙(앞말에 붙인다)을 적용하지 않는다. 그 규칙은 copy deck 문구에 관한 것이고, 번호 이름 ` (2)`도 공백을 둔다(`output.rs:80`).

### 4.3 진행률
- `ProgressDto`의 의미는 그대로다. 분모가 구간 기준이 되므로 퍼센트, 남은 시간, 추정 크기가 저절로 구간 기준이 된다(R30·R50). 생방송 PR이 `ProgressDto`에 `live` 필드를 더했다(`app/src/lib/bindings/ProgressDto.ts` 변경). 구간 작업에서는 늘 `null`이라 상관없다.
- defrag는 `Finalizing` 단계 안에서 돈다(`mod.rs:360` `phase(Phase::Finalizing)` 뒤, 변환 호출은 `:374`). 그래서 새 단계나 DTO 변경은 없다. 마무리가 얼마나 길어지는지는 측정하지 않았다(**실측 필요**, 실측 6번). 변환은 `mdat` 본문을 읽지 않으므로(core.md 60 "복사 없이 제자리") 시간은 파일 크기보다 조각·샘플 수에 따른다고 본다(**가정**). 실측에서 마무리가 길게 보이면(범주 "10초 넘음", 기준값은 **[잠정]**) 그때 `Finalizing` 안의 하위 표시(예: "파일 정리 중")를 따로 정한다.

## 5. 앱 변경(`app/`)

### 5.1 원칙(사용자 기준 ①을 이 기능에 옮긴 것)
- **숨기지 않는다**: 빠른 다시보기의 영상 카드에서 화질 행 바로 아래에 늘 한 줄로 보인다. 설정이나 메뉴 안에 넣지 않는다. 편집자가 처음 보는 카드에서도 찾을 수 있어야 한다(Q1).
- **복잡하지 않다**: 펼치고, 시각 두 개를 적고, [받기]를 누른다. 확인 단계와 추가 버튼은 없다. [전체로] 버튼은 없다. 접으면 전체 받기가 되므로 같은 일을 하는 컨트롤이 둘일 이유가 없다.
- **튀지 않는다**: 접힌 상태는 `Disclosure variant=inline` 한 줄이다. 글자는 `--fg` body, 화살표는 `--fg-muted`, 높이는 `--control-h-sm`이다(`components.md` §2.8, `ui/vocab.ts:11`, R52). 색 면, 배지, 채운 버튼, 새 아이콘은 없다. [받기]는 여전히 창에서 유일한 채움 버튼이다(P3, R51).
- **기본 흐름은 그대로다**: 접혀 있으면 지금과 똑같이 전체를 받는다. **구간은 펼쳐져 있을 때만 적용된다.** 펼친 뒤 칸을 초깃값 그대로 두어도 전체다. 웹뷰가 정규화해 `range`를 보내지 않는다(§3.1).
- 새 컴포넌트는 없다. 기존 `Disclosure`·`FieldRow`·`TextField`·`Notice`만 쓴다(`app/src/lib/components/ui/`, R53).

### 5.2 와이어프레임(영상 카드, 빠른 다시보기)

접힘(기본):
```
┌ 불러온 영상 ───────────────────────────────────────────┐
│ [빠른 다시보기] 제목 …                                 │
│ 채널 · 3:12:45                                         │   ← 길이는 이미 메타 줄에 있다(receive.ts:75)
│ 화질      (●) 1080p 60fps  약 7.8GB   가장 좋은 화질   │
│           ( ) 720p …                                    │
│ ▸ 일부만 받기                                           │   ← Disclosure inline, 화질 행 아래 --space-12(폼 행 사이, patterns §6.2)
│ 저장 폴더  ~/Movies/…                       [변경…]    │
│ 파일 이름  [제목                    ].mp4               │
│                                     [닫기] [받기 ⌘↩]   │
└────────────────────────────────────────────────────────┘
```

펼침:
```
│ ▾ 일부만 받기                                           │
│ 구간      [0:10:00 ] ~ [0:20:00 ]                       │   ← FieldRow(label=range.label), TextField 두 개
│           앞뒤로 몇 초 더 받을 수 있어요.                │   ← FieldRow 도움말 caption --fg-muted(patterns §6.2)
│ 저장 폴더  …                                            │
│ 파일 이름  [제목                    ].mp4               │
│           저장될 이름: 제목 (0.10.00~0.20.00).mp4       │   ← 기존 filename.willSaveAs(§4.2)
```

오류(제출할 때만):
```
│ 구간      [0:30:00 ] ~ [0:20:00 ]                       │  ← 끝 칸 aria-invalid, --danger-ink 1px
│           ⚠ 끝 시각이 시작 시각보다 뒤여야 해요.          │  ← Notice variant=inline tone=danger, role=alert(patterns §6.1)
```

- 오류 Notice는 **`variant=inline`**이다(R56). patterns §6.1은 폼 오류를 컨트롤 바로 아래 `Notice form=inline tone=danger`, `role="alert"`로 정한다. 오류가 난 칸에는 `aria-invalid="true"`와 `aria-describedby`(Notice id)를 단다.
- `TextField` 두 개는 각자 접근 이름을 갖는다(`range.start`·`range.end`, sr-only 라벨). 칸 폭은 `H:MM:SS` 여덟 글자에 맞춘 고정 폭이다. 값(`ch` 단위 폭)은 `[잠정] 근거 없음, 실측·ADR-0009 묶음 등록`이고 토큰이나 상수로 둔다. 좁은 레이아웃(600 미만)에서는 FieldRow 규칙대로 라벨이 위로 올라가고 두 칸은 한 줄에 둔다(patterns §6.2 "접힘" 행).
- 입력 모양: `formatClock`과 같은 `H:MM:SS`를 기본으로 보여 준다(`app/src/lib/format/duration.ts:21-22`, R57). 받는 모양은 `H:MM:SS`, `M:SS`, `MM:SS`(시가 0일 때)다. 전각 콜론(`：`)과 앞뒤 공백도 받는다. 파서는 순수 함수 `parseClock(text) → ms | null`이고 `app/src/lib/format/`에 둔다. 골든은 `design/format/`에 새 JSON으로 더하고, TS와 Rust가 같이 읽는다(`duration.ts:37` "Rust `chzzk_shell::format`과 같은 골든을 읽는다.", R58).
- 펼쳤을 때 칸의 초깃값: 시작은 `0:00:00`, 끝은 영상 길이(`formatClock(durationSecs)`)다. 길이를 모르면(`durationSecs == null`, `model.rs:55`, R44) 끝 칸을 비우고 placeholder를 둔다.
- 검증 시점(patterns §6.1, R55): **[받기]를 누를 때 한 번만** 한다. 타이핑하거나 blur할 때는 하지 않는다. 오류가 나도 입력을 지우지 않는다. 오류가 난 칸만 `select()`하고, IME 조합이 끝난 뒤에만 한다(`isImeKey`, `focus.ts:18`, R59). Enter keydown은 달지 않는다(카드 `<form>` 제출에 맡긴다).
- **조용한 파싱**: 화질 행의 "약 N GB"(`QualityPicker.svelte:38`, R61)와 `check_output`의 `range` 인자(→ "저장될 이름")는 칸 값이 파싱될 때만 구간 기준으로 바뀐다. 기존 150ms 디바운스를 그대로 쓴다(`receive.ts:19` `CHECK_DEBOUNCE_MS`, patterns §6.5). 파싱이 안 되면 전체 기준 그대로 두고 오류도 보이지 않는다. 이 미리보기는 검증이 아니어서 "타이핑 중 오류 없음" 규칙과 부딪히지 않는다. 크기 추정은 `(끝 - 시작) / 전체` 비율이고 지금처럼 "약"을 붙인다. defrag가 붙이는 `moov`는 샘플 표 크기라 작다. 그래서 추정에 따로 더하지 않는다(**가정**).
- **검사 열쇠에 구간을 넣는다.** 지금 열쇠는 `[folder, fileName, qualityId]`뿐이다(`app/src/lib/receive.ts:103-104`). [받기]는 `checkedKey !== currentKey`일 때만 막힌다(`receive.ts:203`, `ResolveCard.svelte:84`·`:91`). 그래서 구간 칸만 고치고 바로 [받기]를 누르면, 이전 구간의 `fileName`과 `partial` 판정이 그대로 `enqueue`에 들어간다(`receive.ts:152`). 다음처럼 고친다.
  - `checkKey(folder, fileName, qualityId, range)`로 넷째 인자를 더한다. `range`는 **실제로 보낼 값**이다. 곧 접힘·파싱 실패·정규화(전체를 덮음) 뒤의 `TimeRangeDto | null`이다. 칸에 적힌 글자를 넣지 않는다. 같은 구간을 다르게 적은 경우(`0:10:00`과 `10:00`)에 검사를 다시 부르지 않게 하려는 것이다.
  - 같은 값을 `checkOutput`의 `range` 인자와 `buildEnqueueRequest`의 `range`로 쓴다. 세 곳이 한 함수(`effectiveRange`, `receive.ts`)에서 값을 얻는다. 그래야 검사한 구간과 보내는 구간이 어긋나지 않는다.
  - 파싱 실패로 `range = null`인 채 검사가 녹색이어도, [받기]를 누르면 제출 검증이 먼저 막는다. 그래서 전체 받기로 새지 않는다.
- 카드에서는 조각 경계에 맞춘 "실제 구간"을 미리 보여 주지 않는다. resolve는 info에서 master 주소와 track만 얻고, master도 media playlist도 받지 않는다(`client.rs:133-138`, R60). 그래서 도움말에는 일반 안내(`range.help`)만 둔다.
- 펼침 상태는 카드마다 새로 시작한다. 기억하지 않는다. 다음 영상에서 실수로 구간을 받는 일을 막기 위해서다(**가정**, R62).
- 단축키는 더하지 않는다.

### 5.3 일반 VOD·클립·생방송에서
- 클립: 줄 자체를 그리지 않는다.
- 일반 VOD: **그리지 않는다**(R3 확정). 근거는 patterns §6.4 "사유 없는 비활성은 두지 않고 숨긴다"이다(`patterns.md:390`, R63). PD를 열면 같은 줄을 그대로 보이면 된다.
- **생방송**(3차 개정): 그리지 않는다. 카드의 종류 판정은 `kindTone`이 `'live'`를 돌려주는 갈래다(`app/src/lib/receive.ts:22-26`). 구간 줄은 `tone === 'rewind'`일 때만 그린다. 생방송 카드의 안내 Notice(`ResolveCard.svelte:256-259` `card.live.body`)와 구간 줄은 서로 배타적이다. 그래서 카드 높이를 합산할 일이 없다.

### 5.4 작업 행(JobItem)(R64·R65)
- 구간 조각은 **1줄의 화질 칸**에 둔다. 모양은 `1080p · 0:10:00~0:20:00`이다. patterns §3.2에서 화질은 1줄(제목 줄 오른쪽, muted tabular)에 있다. 시각은 `formatClock`으로 만든다. 끝을 모르면 `1080p · 0:10:00~`다(§4.2와 같은 모양).
- **기호 두 개는 근거가 없어서 등록한다(R2 확정).** `content.md` §6.5 구분 기호 표(`:219-232`)에는 범위 기호가 없다. ` · `는 그 표에서 "상태 줄의 조각 사이" 용도다.
  - 범위 기호 `~`(붙임, 공백 없음): 파일 이름 접미사와 모양을 맞추려고 고른 것이다(§4.2). `content.md` §6.5 표에 "범위 · 시각 두 개 사이 · `~`(붙임)" 행을 더하는 것으로 PR ②-3에서 등록한다. 근거 칸에는 "이 문서, 근거 조사 없음"을 적는다.
  - 1줄 화질 칸의 ` · `: 같은 표의 "조각 구분" 행 쓰임을 "상태 줄의 조각 사이, 작업 행 1줄 화질 칸의 조각 사이"로 넓히는 개정으로 등록한다. 템플릿에서 `·` 리터럴로 잇지 않고 deck 함수가 만든다(같은 절의 `design-lint` 강제).
- 1줄은 제목과 화질 칸을 나눠 쓴다. 조각이 길어지면 제목 말줄임이 앞당겨진다. 720·960 폭에서 제목이 몇 글자 보이는지는 **실측 필요**다(design-shots 갤러리 장면, §5.7).
- 상태 줄의 퍼센트와 남은 시간은 구간 기준이다. 분모가 바뀌었으므로 따로 할 일은 없다. 생방송 행의 "녹화 중 · {span} · {received}"(`job.live.running`, D63)와는 다른 갈래다.
- **접근 이름은 바꾸지 않는다.** `content.md` §10은 작업 행의 이름을 `"‘{title}’: {status}"` 하나로 정했다. 그리고 `a11y.*` 값은 `‘{…}’`로 시작해야 `design-copy` DC12를 통과한다(`scripts/design/copy.mjs:762-765`). 구간 조각은 행 안의 보이는 글자로 낭독된다. `0:10:00~0:20:00`이 스크린 리더에서 자연스럽게 읽히는지는 **실측 필요**다.

### 5.5 copy deck 초안(`app/src/lib/copy/ko.ts`)

| 키 | 문구 | 비고 |
|---|---|---|
| `range.toggle` | 일부만 받기 | Disclosure summary. `content.md` §5.1 **기본형(동사 어간 + `기`)**이다(R67) |
| `range.label` | 구간 | FieldRow 라벨. `*.label`은 DC5 "마침표 없음" 대상이다(`copy.mjs:733-736`). 기존 `filename.label` '파일 이름'(`ko.ts:71`)과 같은 명사 라벨이다 |
| `range.start` | 시작 시각 | sr-only 접근 이름 |
| `range.end` | 끝 시각 | sr-only 접근 이름 |
| `range.help` | 앞뒤로 몇 초 더 받을 수 있어요. | `.help`는 마침표로 끝나야 한다(DC5, `copy.mjs:738`, R66) |
| `range.chip` | {start}~{end} | 작업 행 1줄 조각, 마침표 없음. `~`는 §5.4의 등록 대상 |
| `range.chipToEnd` | {start}~ | 끝을 모를 때. `{start}부터`는 변수 바로 뒤 조사라 DC3에 걸리므로(`content.md` §8) 쓰지 않는다 |
| `conflict.partialOther`(**고침**, R4 확정) | 지금: 다른 화질로 받다 만 파일이 있어요. 지우고 처음부터 받아요.(`ko.ts:81`) → 새: 조건이 다른 받다 만 파일이 있어요. 지우고 처음부터 받아요. | 이유와 범위는 §5.6 partial 행. 고치는 것은 확정이고 새 문구는 초안이다(PR ②-3 리뷰에서 다듬는다). `content.md` §15.1 표에 "현재 키 → 새 문구"로 등록하고, `patterns.md` §6.5 카드 안 경고 행의 "다른 화질 `.part`"(`:399`)도 고친다 |
| `range.error.format` | 시각은 {example}처럼 적어 주세요. | 인라인 오류. `{example}`은 deck 함수가 `formatClock`으로 만든다(W5, `content.md:24`, R69) |
| `range.error.order` | 끝 시각이 시작 시각보다 뒤여야 해요. | |
| `range.error.beyond` | 시작 시각이 영상 길이보다 뒤예요. | 끝이 길이를 넘는 것은 오류가 아니다(자른다) |

**오류 L0 문구는 `ko.ts` 키가 아니다.** 실제 오류 L0는 `app/src/lib/copy/errors.ts`의 `case` 안에 있는 `copy('제목', '본문', [동작])` 리터럴이다. `errors.ts:1` 머리 주석이 "content.md §9 틀·§15.2 코드별 L0 표"라고 밝힌다. 예는 `:348-353` `sourceChanged`, `:364-370` `unsupported`다. 원천 표는 `content.md` §15.2다. R1이 새 kind로 확정됐으므로 아래를 더한다.

| 자리 | 제목 | 본문 | 동작 |
|---|---|---|---|
| `errors.ts` `case 'rangeOutOfBounds'` + `content.md` §15.2 행 | 고른 구간을 이 영상에서 찾지 못했어요 | 영상 길이가 바뀌었을 수 있어요. 구간을 다시 골라 주세요. | `playbackChanged`(`errors.ts:341-346`)와 같은 `reload`(`:215`, 작업 행이면 `reresolve`) |

- **R1의 근거(확정 기록).** `sourceChanged`를 재사용하면 L0는 "원본 영상이 바뀌어 이어받을 수 없어요 / 받다 만 파일은 지웠어요. 처음부터 다시 받아 주세요."이고 동작은 `restartFresh`다(`errors.ts:348-353`, `:217`). 첫 실행에서 구간이 playlist 밖이면 받다 만 파일도 없고, 처음부터 다시 받아도 같은 오류가 난다. 그래서 재사용하면 문구와 동작이 둘 다 사실과 맞지 않는다.
- 어미는 해요체(D44)다. 마침표는 `content.md` §6.1을 따른다. 본문·도움말에는 있고, 라벨·제목에는 없다. 숫자와 단위는 모두 자리표시자라서 `design-copy`의 숫자+단위 리터럴 금지에 걸리지 않는다.
- 변수 바로 뒤에 조사가 오는 문구는 없다(DC3, `content.md` §8).
- D63 용어(녹화·녹화 마치기·생방송)는 쓰지 않는다. `content.md` 용어 표의 "진행 중인 방송을 받는 일" 행은 생방송에만 해당한다.

### 5.6 상태(patterns §2.1의 여섯 상태, R70)

이 영역은 `patterns.md` §2.3 표의 "홈 · 영상 정보(불러오기)" 행 안에 있는 하위 영역이다.

| 상태 | 구간 줄 |
|---|---|
| empty | 해당 없음. 카드가 있을 때만 줄이 있다 |
| loading | 해당 없음. 카드는 resolve가 끝난 뒤에 생긴다 |
| partial | 해당 없음. 받다 만 파일 경고는 기존 카드 안 경고(`conflict.partial.*`)가 맡는다. 같은 경로에 구간이 다른 `.part`가 있으면 `conflict.partialOther`로 보인다(§4.1). 아래 주석 참고 |
| error | 제출 오류. 해당 칸에 `aria-invalid`, 바로 아래 inline danger Notice, 포커스는 첫 오류 칸으로 간다. 입력은 그대로 둔다 |
| success | 해당 없음. [받기]가 성공하면 카드가 닫히고 작업 행(§5.4)이 결과를 맡는다 |
| stale | 해당 없음 |

**partial 행 주석.** 구간은 이름 접미사에 들어가므로(§4.2), 구간이 다르면 보통 경로도 달라서 이 경고는 나오지 않는다. 같은 경로에 "구간이 다른 `.part`"가 생기는 경우는 이렇다. 코드에서 따져 본 것이고 관찰한 것은 아니다.
- 사용자가 파일 이름 칸에 접미사 모양까지 직접 적어서 다른 작업의 최종 이름과 같아진 경우.
- 같은 접미사인데 요청 시각이 다른 경우. 웹뷰를 거친 요청에서는 생기지 않는다고 본다. 이 성질은 `effectiveRange` 단위 테스트로 고정한다(§10.3).
- sidecar가 없거나 읽히지 않는 `.part`. 이때는 지금도 `same_job = false`다(`crates/shell/src/output.rs:116-119`).
- **(3차 개정)** 같은 경로에 끊긴 생방송 `.part`(sidecar `kind = Live`)가 있는 경우. 이때도 `same_job = false`다. 이 경우 지금 문구 "다른 화질로"는 사실이 아니다. 고친 문구 "조건이 다른"은 맞는다. 다만 이 경로로 구간을 받으면 생방송 `.part`가 지워진다(§12 위험 행).

지금 문구 "다른 화질로 받다 만 파일이 있어요. 지우고 처음부터 받아요."(`app/src/lib/copy/ko.ts:81`)는 위의 첫째·셋째·넷째 경우에 사실과 다르다. 그래서 R4대로 원인을 말하지 않는 문구로 고친다. 이 경고를 찍은 `design-shots` 장면이 있으면 그 기준선도 다시 받는다(ADR-0008, 장면이 있는지는 미확인이다). 가짜 백엔드와 spec에서 이 문구를 단언하는 곳도 같이 고친다(CLAUDE.md "화면 문구를 바꾸면 가짜 백엔드와 spec도 같이 고친다").

상태가 아닌 변형(갤러리 장면으로 그린다)은 셋이다.
- 접힘
- 펼침(초깃값)
- 펼침(길이 모름): 끝 칸이 비고 placeholder가 있다. 비워 두면 "끝까지"다. 웹뷰가 `endMs = null`을 보내고, 셸과 코어는 `None` 그대로 두며, `select_range`가 playlist 끝으로 자른다. 저장될 이름은 `제목 (0.10.00~).mp4`다.

### 5.7 가짜 백엔드·E2E
- `app/e2e/mock/backend.ts`(R71): `enqueue`·`checkOutput`의 `range`, `JobDto.range`를 다룬다. `check_output`(`:316-331`)은 지금 이름을 그대로 돌려주고 늘 `truncated: false`다(`:324`). `range`가 있으면 접미사를 붙인 `fileName`·`path`와 `truncated: true`를 돌려주게 고친다. `enqueue` 쪽은 접미사를 붙이지 않는다(§4.2의 한 곳 규칙을 가짜에서도 지킨다).
- Playwright spec 하나(`range.spec`)를 더한다. 흐름은 펼치기 → 값 입력 → [받기] → 작업 행 1줄 조각이다. 다음을 단언한다.
  - 오류 두 종류(형식, 순서)와 axe
  - 접힌 상태에서 [받기]를 누르면 `range`가 없다. 펼쳤다가 접은 뒤 [받기]를 눌러도 없다.
  - 구간 칸만 바꾸고 곧바로 [받기]를 누르면, 보낸 `fileName`이 새 구간의 접미사를 갖고 접미사가 한 번만 있다.
  - 생방송 카드(`live.spec.ts` 선례의 fixture)에는 구간 줄이 없다(3차 개정).
- 갤러리(`design-shots`)에 장면을 더한다. 접힘, 펼침, 오류, 길이 모름, 구간 작업 행(720·960 폭)이다. 기준선은 CI에서 받는다(ADR-0008).

## 6. Worker
변경 없음(R14).

## 7. 오류 종류

| 상황 | 층 | 종류 |
|---|---|---|
| 형식이 틀린 시각, 시작 ≥ 끝, 시작 ≥ 길이(웹뷰가 길이를 알 때) | 앱 인라인 | 오류 코드 없음(`range.error.*`) |
| 클립·일반 VOD·생방송 요청에 구간, 시작 ≥ 끝(셸 재검증) | 셸 | `invalidInput`(R43) |
| 같은 요청 속성 위반이 코어까지 왔을 때(셸 우회) | 코어 | `unsupported`(새 하위 변형 `RangeNotHls`, kind는 기존 그대로, §3.6) |
| 실행할 때 playlist가 요청 구간보다 짧거나 구간이 비었다 | 코어 | **새 `rangeOutOfBounds`**(R1 확정, §5.5) |
| 재개할 때 sidecar의 `last_excl > n`, 지문 불일치, 루프가 끝났는데 `next != last_excl` | 코어 | `sourceChanged`(기존) |
| 요청은 HLS였는데 첫 resolve나 재조회 결과가 PD 또는 생방송 | 코어 | `playbackChanged`(기존, `mod.rs:239-244`·`segmented.rs:279-286`) |
| 마무리 변환(defrag) 실패 | 코어 | 변경 전 검증 실패는 **오류 아님**: `tracing::warn!`만 남기고 조각 구조로 마무리한다(생방송과 같다, `mod.rs:386-388`, §3.5). 변경 도중 I/O 실패는 같지 않다: ⑤-F4가 정한 "복구·검증 성공 전까지 `.part` 보존" 계약을 따른다(§3.5 정정) |

- 새 kind를 더하면 바꿀 곳은 다음과 같다. 앱 ↔ Worker 계약이 아니므로 `!`는 붙지 않는다(`versioning.md:30-33`).
  - `chzzk_core::ErrorKind`
  - 셸 `ErrorCode`: 앞 **22개** 1:1 표가 **23개**가 된다(`crates/shell/src/error.rs:34` "앞 22개는 `chzzk_core::ErrorKind`와 1:1", 빠짐없는 match `:71-`). 3차 개정에서 바로잡았다. 생방송이 `notLive`·`nothingRecorded`를 더해 20 → 22가 됐다(`content.md` §15.2의 두 행).
  - bindings(`ErrorCode.ts`)
  - `errors.ts` 전수 매핑(`case` 리터럴)과 테스트
  - `content.md` §15.2의 코드별 L0 표
  - 가짜 백엔드
- 생방송 PR이 같은 표를 먼저 고쳤으므로, 머지 순서만 지키면 충돌은 표 끝 추가뿐이다.

## 8. 비밀값 규칙
- 구간 기능은 새 주소를 만들지 않는다. 고른 조각의 서명 주소는 기존 `Segment`의 `Debug`를 거친다(`redact_url`, `hls.rs:38`·`:69`, R72). 오류 detail과 tracing에는 조각 주소를 넣지 않고 **index만** 넣는다(`"조각 {i}/{n}"`).
- defrag는 파일만 읽고 쓴다. 주소를 다루지 않는다. `DefragReport`의 `Debug`(`mod.rs:376` `report = ?r`)는 트랙 수·샘플 수·구멍 수뿐이다(`defrag.rs:58-72`).
- `HlsRange`·`TimeRange`에는 시각과 index만 있다. 쿠키나 토큰을 담지 않으므로 `Debug`를 derive해도 된다.
- 쿠키 규칙은 바뀌지 않는다(API·MPD에만 보내고 미디어 CDN에는 보내지 않는다, CLAUDE.md, R73).
- 실측 도구와 실측 절차(§11 PR ②-0, §13)는 "된다/안 된다", "있다/없다", "같다/다르다", "일치/불일치"만 출력한다. 길이·시각·크기·tfdt 값도 준식별자이므로 찍지 않는다(CLAUDE.md 공개 저장소 규칙). `examples/defrag.rs`는 `DefragReport`를 그대로 찍는다(샘플 수 포함). 그래서 실측 절차에서는 그 출력을 기록하지 않고 "변환됨/안 됨"만 적는다.

## 9. OS별 분기
- 파일 이름: `range_suffix`는 `:`를 쓰지 않으므로 세 OS에서 모양이 같다(R47). 예약어, 끝 공백·점, 길이 처리는 기존 `sanitize_filename(Platform)`이 맡는다. 볼륨 기준 규칙(core.md 57)도 그대로다. 셸이 `volume::platform_for_dir`로 고른 `Platform`을 `check_output`이 쓴다. Windows 경로 길이 때문에 이름을 자를 때 접미사가 잘리지 않는지 세 `Platform`으로 테스트한다(R48).
- defrag의 OS 분기: 없다. `File` seek·`set_len`·`sync_data`만 쓴다(`defrag.rs:78-116`). 다만 `with_file_blocking`은 `try_clone`한 핸들을 쓴다(`part.rs:339-344`). Windows에서 같은 잠긴 핸들로 쓰는 것은 생방송 PR의 CI가 이미 돈다(core.md 60 "연동").
- 재생 호환(사람이 확인): Windows 미디어 플레이어와 macOS QuickTime에서 처음부터 재생되는지, 길이가 맞는지 본다(실측 6번, 3차 개정에서 "defrag 결과 하나"로 좁혔다). 이미 확인된 것은 생방송 실물을 변환한 파일의 QuickTime 길이·탐색 정상(`docs/ROADMAP.md:8`), ffprobe 길이와 ffmpeg 디코드 오류 0(core.md 60 "확인")이다. Windows 미디어 플레이어는 생방송에서도 확인 기록이 없다. Linux는 기본 플레이어가 배포판마다 달라 확인 대상에서 뺀다(**가정**, R78).
- 입력: 전각 콜론은 한국어 IME에서 섞여 들어갈 수 있어서 받아 준다(OS 공통, **가정**). macOS와 Windows 모두 IME 조합 중에는 검증하지 않는다(기존 `isImeKey` 가드, R59).

## 10. 테스트 계획(TDD)

명세가 분명한 순수 함수(`select_range`, `parseClock`, `range_suffix`, `same_job` 규칙)는 **실패하는 테스트를 먼저** 쓴다. 보강 테스트는 구현을 일부러 깨서 그 테스트가 잡는지 확인한다. defrag 자체의 테스트는 생방송 PR이 이미 두었다(`download/defrag/tests.rs`). 그래서 이 기능은 "구간 결과가 defrag를 탄다"는 연결만 테스트한다.

### 10.1 합성 fixture(`scripts/fixtures/gen-fixtures.mjs`, `--check`)
- HLS: 조각마다 바이트가 다르게 나오도록 만든다. 지금의 `tfdt = msn × 2000`(`gen-fixtures.mjs:626`)은 유지하고, mdat 내용은 이미 msn마다 다른 noise다(`:626` `noise(…, msn * 16 + k + 1)`). 지금 조각 파일은 seg0·seg1뿐이고 media.m3u8은 30조각이다(R74). 테스트 응답기가 30조각을 각각 다르게 준다(`segment(msn)`을 응답기에서 생성).
- 첫 샘플의 non-sync 비트를 켠 조각 하나. 키프레임 판정 도구(PR ②-0)의 음성 fixture다.
- EXTINF 합과 첫 조각 시각 원점이 어긋난 변형. 첫 조각 tfdt가 0이 아닌데 EXTINF 합은 길이와 같은 경우다. `dl --range`의 보조 길이 대조가 "같다"를 내도 원점까지 통과시키지 않는다는 음성 fixture다(Codex 1회차 지적). 3차 개정에서도 유지한다. defrag가 파일 안 시각을 0으로 맞춰도 이 대응 문제는 그대로이기 때문이다(§3.2).
- **뺀 것**(3차 개정, 모두 defrag 테스트가 이미 덮는다): tfdt v0·v1 읽기(`defrag.rs:655-665`, 짧은 v0 거부 테스트 `defrag/tests.rs:1393`)·tfdt 없는 변형(`:1495`), 길이 필드 다시 쓰기(`mvhd` 길이 단언 `:961-964`, 32비트를 넘는 길이의 version 1 전환 `:1026-1034`, 짧은 길이 자리 거부 `:1437`), 트랙 사이 시작이 다른 변형(`:936`).
- **재생 가능한 구간 통합용 입력**: 합성 HLS init은 `stsd` entry가 0개라 재생 파일이 아니다(`gen-fixtures.mjs:580`). 그래서 "실제 디코드 가능한 결과" 단언이 필요하면 생방송 PR의 `testdata/live/synthetic_frag.mp4`(ffmpeg lavfi 합성, 생성기 밖 정적 파일)를 조각으로 나눠 서빙하는 `tests/recording.rs`의 방식을 따른다(`recording.rs:1071-1091`). VOD playlist 모양은 응답기가 만든다. 합성 HLS fixture로 변환이 `Converted`가 되는 것은 이번에 `examples/defrag`로 확인했다(§3.5). 구현 PR에서 테스트로 다시 고정한다.

### 10.2 검사기(`crates/core/tests/support/mp4.rs`)
- `tests/recording.rs:1054-1069`의 `assert_flat_mp4`(최상위에 `moof` 없음, 끝은 `moov` 하나, `mdat` 있음)를 `support/mp4.rs`로 옮겨 녹화와 구간이 함께 쓴다. 옮기는 것은 테스트 코드 이동뿐이다.
- 출력이 일반 mp4인지와 함께, 출력의 각 `mdat` 본문이 원본 조각 `seg[first..last_excl]`의 `mdat`과 바이트까지 같은지 본다. defrag는 데이터를 움직이지 않으므로(core.md 60) mdat 바이트는 순서대로 같아야 한다. 샘플 표의 정확성은 defrag 단위 테스트가 원본 trun과 비교해 맡는다(`defrag/tests.rs`의 `assert_equivalent`). 이 기능에서 다시 하지 않는다.
- 1·2차의 "컨테이너 안으로 내려가 조각별 tfdt·mvhd·mehd를 읽는다"는 뺀다. 대상이 없어졌다.

### 10.3 단위
- `select_range`: 정확히 경계인 시각, start 0, 끝 = 전체, 끝 > 전체(자름), start ≥ 전체(오류), start ≥ end(오류), EXTINF 반올림이 누적된 경계, 조각 하나짜리 구간, `end = None`이면 playlist 끝까지.
- `same_job`: v1+None 일치, v2+Some 일치, v2+None 불일치, v1+Some 불일치, 구간이 다르면 불일치, 옛 sidecar JSON(필드 없음)을 읽을 수 있음.
- **생방송 sidecar(3차 개정)**: `kind = Live`·v1·`range` 필드 없는 sidecar JSON이 새 코드에서 그대로 `same_job == true`(요청 range `None`)다. 생방송 `.part`를 업데이트가 지우지 않는다는 것을 고정한다(§3.3).
- `partial_bytes`(`jobs.rs:330`): 구간이 다른 v2 sidecar면 `None`, 같으면 `committed_len`(R41).
- `range_suffix` + `sanitize_filename`: 세 Platform, 긴 제목 자르기(접미사가 남는지), `:` 없음, 번호 이름과 함께 쓸 때, `end_ms = None`이면 ` (H.MM.SS~)`이고 큰 수가 찍히지 않는지.
- 셸 검증: 클립·PD·**생방송** 요청의 구간 거부, `end_ms`가 있을 때 start ≥ end 거부, `endMs = null`이 `None` 그대로 코어 요청까지 가는지.
- **접미사 한 번**: `check_output(title, range)`의 `fileName`을 `enqueue`에 넣은 결과의 `output`이 `check.path`와 같고, 접미사가 한 번만 있다. 번호 이름(`freeFileName`)을 넣어도 같다. 긴 제목에서 `freeFileName`이 구간 접미사와 ` ({n})`을 둘 다 갖는다. 구현을 일부러 깨서(`enqueue`에서도 접미사를 붙이기, `free_name`에 합친 이름을 넘기기) 이 테스트가 잡는지 확인한다.
- `crates/shell/tests/error_map.rs:300-308`의 `Unsupported` 변형 목록에 `RangeNotHls`를 더한다.
- 앱 `effectiveRange`: 끝이 길이를 넘으면 `ceil(durationSecs) × 1000`으로 줄이고, 결과의 `startMs`·`endMs`는 늘 1000의 배수다(길이에 소수가 있어도).
- 앱 `checkKey`: 구간만 바꾸면 열쇠가 달라져 `canDownload`가 false다. 같은 구간을 다르게 적으면(`0:10:00`과 `10:00`) 열쇠가 같다. 접힘·파싱 실패·전체를 덮는 구간은 모두 `range = null` 열쇠다. 카드 테스트: 구간만 바꾸고 새 검사 결과가 오기 전에는 [받기]가 막힌다.
- 코어 요청 검증: `range.is_some() && expected_kind != LiveRewindHls`면 네트워크 요청 0번에 `Unsupported(RangeNotHls)`다. 다음 두 경우를 함께 단언한다(§3.6).
  - `expected_kind = Live`에 구간을 주고 같은 경로에 끊긴 생방송 `.part`가 있어도, 이 오류가 먼저 난다. 그 `.part`와 sidecar는 **바이트까지 그대로 남는다**(마무리도 삭제도 하지 않는다).
  - 최종 파일이 이미 있고 `Skip`이어도 `Skipped`가 아니라 이 오류다.
  - 구현을 일부러 깨서(검사를 `resume` 뒤로 옮기기) 이 테스트가 잡는지 확인한다.
- `check_output`: range가 있으면 `truncated == true`이고 최종 이름에 접미사가 있다. 같은 경로의 구간이 다른 `.part`(v1 sidecar ↔ 구간 요청, v2 ↔ 전체 요청)는 `partialOther`다. 기존 `crates/shell/tests/output.rs:50`·`:57-70`은 고치지 않고 그대로 녹색이어야 한다.
- 앱: `parseClock` 골든(TS·Rust가 같은 JSON을 쓴다). 카드 테스트로 다음을 본다.
  - 접힘이면 range 없음
  - 펼쳤다 접으면 range 없음
  - 초깃값 그대로면 range 없음(정규화)
  - 타이핑 중 오류 없음
  - 제출 오류의 위치·포커스·`variant=inline`
  - 파싱되는 값일 때만 크기와 이름 미리보기가 바뀜
  - 생방송 카드에는 구간 줄이 없음
- copy deck: 새 키가 `design-copy`(DC3·DC5·DC12)를 통과한다.

### 10.4 통합(wiremock, 오프라인, `crates/core/tests/segmented.rs`)
- 구간을 주면 범위 밖 조각을 **0번** 요청한다(요청 기록으로 단언).
- **결과는 일반 mp4다**(3차 개정): `assert_flat_mp4`이고, mdat 본문들 = seg[first..last_excl]의 mdat이다(§10.2). 1·2차의 "출력 = init ‖ seg[first..last_excl]"는 마무리 변환 때문에 더는 참이 아니다.
- **전체 받기는 그대로 조각 구조다**(3차 개정, 회귀 방지): range 없는 빠른 다시보기의 출력은 지금처럼 init ‖ seg[0..n]이다. 이 기능이 전체 받기 동작을 바꾸지 않는다는 것을 고정한다.
- 중간에 취소하고 재개한 결과가 끊김 없이 받은 결과와 바이트까지 같다. 1·2차의 "안 A, 안 B 각각"은 하나로 줄었다.
- **변환 뒤·rename 전 크래시 흉내**(3차 개정): 변환된 `.part`와 sidecar를 남긴 채(`Skip` + 받는 동안 최종 파일 생성 → `Skipped`, `mod.rs:398-400`) 같은 요청을 `Overwrite`로 다시 부르면 다음을 확인한다. 조각을 다시 받지 않는다. `AlreadyFlat`으로 넘어간다. 최종 파일이 처음 결과와 같다.
- 구간 도중 403 → 재조회 → 이어서 받음. 같은 조각에서 다시 403이면 `AuthRequired`.
- 재조회 지문 불일치 → `SourceChanged`, 받은 바이트는 보존.
- 응답기가 스트림을 일찍 끝내 `next != last_excl`로 루프를 빠져나오면 `SourceChanged`다. 이때 `finish`(곧 defrag)가 불리지 않는다. 파일이 조각 구조 그대로 남는지로 단언한다(R27).
- sidecar의 구간과 요청 구간이 다르면 새로 시작한다.
- 진행률 분모가 구간 기준인지(`segments`, `media_secs`).
- v2 sidecar를 v1만 아는 규칙(옛 앱 흉내)으로 비교하면 false.

### 10.5 실서버·fuzz
- `tests/live_range.rs`(nightly drift 목록인 `live.rs` 밖)에 `#[ignore]` 구간 스모크 하나를 둔다(본인 빠른 다시보기). 결과는 kind와 된다/안 된다만 남기고, `assert_flat_mp4`도 확인한다.
- **fuzz target은 더하지 않는다**(3차 개정). 1·2차의 `mp4frag` target(4 → 5)은 없앴다. 지금 target은 `url`·`info`·`mpd`·`hls` 넷이다(`scripts/ci/fuzz.mjs:28` `export const TARGETS = ['url', 'info', 'mpd', 'hls']`). defrag도 fuzz target이 없다. defrag에 target을 더할지는 생방송 쪽 판단이다. 구간 입력은 앱이 받은 조각이라 생방송과 위험 성격이 같으므로 이 기능에서 따로 열지 않는다(**가정**).
- ratchet: 테스트 수와 커버리지는 올라가기만 한다. 앱 크기 변화는 작다고 본다(**가정**). 새 모듈이 없어 1·2차보다 더 작다. 번들 크기 ratchet으로 확인한다.

## 11. stacked PR 단계

| # | 커밋 타입·제목 | 내용 | 영역 |
|---|---|---|---|
| ②-0 | `chore: 빠른 다시보기 조각 키프레임 실측 도구를 더한다` | **줄였다**(3차 개정). `crates/core/examples/range_check.rs`는 오프라인 판정 하나만 한다. 이미 받은 본인 전체 받기 파일(조각 구조, §1.2)을 읽어 `조각 첫 샘플이 동기 샘플인가`를 된다/안 된다로 낸다(실측 3번). 판정 함수는 순수 모듈로 두고 §10.1의 non-sync 음성 fixture로 단위 테스트한다. 1·2차의 `첫 조각 tfdt 0`·`init 길이 필드 0`·`sidx/emsg v1` 판정과 `--make-sample A\|B`는 없앴다(§13 1·4·5번). 장면 대응 표본(`--make-scene-samples`)은 PR ②-1의 `dl --range`로 옮겼다(아래) | core(examples), testdata |
| ②-1 | `feat: 코어가 빠른 다시보기의 시각 구간만 받는다` | `TimeRange`(end `Option`), `hls::select_range`, `HlsState.range`/`HlsRange`(**`Timeline` 없음**), sidecar v1/v2 규칙과 `same_job`(+ `PartFile::resume` 인자), segmented.rs §3.4 표(끝 검사 포함), **`finish`의 defrag 조건에 `range.is_some()`**(§3.5), `Unsupported::RangeNotHls`, 새 kind `rangeOutOfBounds`(R1, 셸 `ErrorCode` 23번째·bindings·`error_map.rs`), `DownloadRequest` 리터럴 `range: None`(§3.1 목록), fixture·`assert_flat_mp4` 이동, wiremock 통합. **`examples/dl.rs --range START~END`**: 실측 2·6번용으로 구간 파일을 만든다. 코어 경로를 그대로 타므로 결과는 defrag된 파일이다. 보조로 "EXTINF 누적 = info 길이(±1조각)"를 같다/다르다로만 찍는다 | core, shell(ErrorCode·error_map), app(bindings `ErrorCode.ts`만), testdata |
| ②-2 | `feat: 셸이 구간 작업을 큐에 넣고 이어받는다` | `EnqueueRequest`·`JobDto`의 `range`, `check_output` command 인자 `range`(+`App`·매니저·`OutputQuery`), `JobRecord.range`, `partial_bytes`의 range 비교, 재검증 두 가지(생방송 포함), `naming::range_suffix`와 제목 쪽 자르기(`check_output`에서만 붙임, `free_name`이 접미사를 지킴), `truncated` 뜻 넓히기, bindings 재생성, 가짜 Backend | shell, app(bindings·`commands.rs`·`api.ts` 래퍼만) |
| ②-3 | `feat: 영상 카드에서 일부만 받기를 고른다` | ResolveCard Disclosure + FieldRow(`tone === 'rewind'`만), `parseClock` + 골든, `checkKey`에 구간, `effectiveRange`, 조용한 미리보기(크기·이름), JobItem 1줄 조각, copy deck(`conflict.partialOther` 고침), `errors.ts` `rangeOutOfBounds`, e2e mock·spec, 갤러리 장면. **실측 2번 세 시각 모두 "일치"와 실측 6번 "된다"가 머지 조건**(§12). 1·2차의 "안 B면 PR 4 뒤"는 없어졌다 | app, design-system(`content.md` §6.5 기호 표·§15.1·§15.2, `patterns.md` §6.5 표 `:398`·카드 안 경고 행 `:399`·와이어프레임 `:713`) |
| ~~②-4~~ | ~~`feat: 구간 파일의 시작 시각을 0으로 맞춘다`~~ | **없앴다**(3차 개정). `mp4frag`·`Timeline::Rebase`·fuzz target 다섯째가 모두 필요 없다. defrag가 그 일을 한다(§3.5) | — |
| ②-5 | `docs: 구간 받기 설계와 실측 결과를 기록한다` | core.md **61~**·app.md **78~** 구현 중 변경 번호(머지 순), ROADMAP 체크박스, `/help`의 짧은 안내(선택) | docs, worker(`/help` 문서를 고칠 때만). **끝**(2026-10-18, v0.10.0 버전 PR에 함께, app.md 89. `/help`는 더하지 않았다) |

- PR ②-1~②-3은 `feat`이고 `!`는 없다. sidecar는 v1을 그대로 읽고, jobs.json은 필드만 더하며, 앱 ↔ Worker 계약은 바뀌지 않는다. 지금 0.7.0(`Cargo.toml:9`)에서 다음 버전은 MINOR가 오른다(`docs/versioning.md:16-20` 표의 `feat` 행(`:19`), R77). PR ②-0은 `chore`라 PATCH다.
- 실측 순서가 바뀌었다. ②-0(키프레임, 실측 3번)은 1·2차처럼 도구 PR들과 묶어 먼저 머지하고 한 세션에서 돌린다. 장면 대응(실측 2번)과 재생 확인(실측 6번)은 **②-1이 머지된 뒤** `dl --range`로 한 번에 한다. 그 사이에 ②-2를 진행할 수 있다. ②-3만 두 결과를 기다린다. 이렇게 바꾼 이유는 이렇다. 1·2차의 ②-0 표본 생성기는 `select_range`와 조각 이어 쓰기를 도구 안에서 따로 구현해야 했다. 그러면 실측이 실제 코어 경로가 아니라 사본을 시험하게 된다. Codex 2회차 N5가 채팅 도구에 대해 "별도 임시 렌더러를 중복 구현할 이유는 없다"고 한 것과 같은 판단이다(Codex 2회차 적대적 리뷰 N5).
- 대가: 실측 2번이 불일치로 나오면 ②-1·②-2가 머지된 채로 기능이 deferred된다. 1·2차도 "PR 1·2는 실측 전에 먼저 진행할 수 있다"였으므로 이 위험은 이미 받아들인 것이다. 머지된 코드는 UI가 없으면 아무 데서도 불리지 않는다(셸 재검증이 막는 것이 아니라 웹뷰가 `range`를 보내지 않는다).

## 12. 위험

| 위험 | 영향 | 대응 |
|---|---|---|
| **defrag 변환 실패로 구간 파일이 조각 구조로 남는다**(3차 개정, 1·2차의 "tfdt ≠ 0 재생" 행을 대체) | QuickTime에서 첫 조각만 재생되고 탐색이 안 된다(core.md 60과 같은 증상, 빠른 다시보기에서는 **가정**). 그 조각 구조는 첫 tfdt도 0이 아닐 수 있다 | 실패 정책은 생방송과 같다(경고만, **가정**, §3.5). 통합 테스트로 정상 입력에서는 늘 `Converted`임을 고정한다. 실물에서 실패가 관찰되면 그때 "실패를 오류로 낼지"를 다시 정한다 |
| 조각이 키프레임으로 시작하지 않는다(실측 필요, R19) | 첫 1~2초가 깨진 화면. defrag는 `stss`를 샘플 플래그에서 옮길 뿐이고, `elst` media_time은 sync 샘플이 아니라 가장 이른 pts를 가리킨다(`defrag.rs:943-946`). 그래서 이 문제를 풀지 않는다 | 실측 3번(PR ②-0). "안 된다"면 1차 범위를 다시 본다. 앞 조각 하나를 더 받는 정도로는 해결되지 않는다. 그때는 이 기능을 deferred로 되돌린다. 참고: `EXT-X-INDEPENDENT-SEGMENTS`는 `hls.rs:255`가 경고 없이 무시하는 태그라서 이 태그로는 판정하지 않는다 |
| **playlist 시간축의 원점이 치지직 플레이어 시각과 다르다**(실측 필요, R18) | 모든 구간이 일정하게 또는 점점 밀린다. defrag와 무관하다(§3.2) | 실측 2번을 **장면 대응 확인**으로 한다. 시작·중간·끝 세 시각 모두 "일치"여야 PR ②-3을 머지한다. 하나라도 "불일치"면 PR ②-3을 보류하고 이 기능을 deferred로 되돌린다. **보정 상수는 이 설계에 두지 않는다.** 원점 보정이 필요해 보이면 별도 조사로 연다 |
| 전체 받기와 구간 받기의 결과 모양이 다르다(3차 개정) | 같은 영상인데 전체 파일은 조각 구조(QuickTime 문제 가능성), 구간 파일은 일반 mp4다. 사용자가 "전체 파일만 깨진다"고 느낄 수 있다 | 이 기능의 범위 밖이다(§1.2). 전체 빠른 다시보기에도 defrag를 적용할지는 별도 결정이다(실측 6번에 "전체 받기 파일도 QuickTime에서 끝까지 재생되는가"를 같이 보면 판단 재료가 된다, "남은 것") |
| 같은 경로에 끊긴 생방송 `.part`가 있을 때 구간 작업을 시작한다(3차 개정) | `PartFile::resume`이 `same_job = false`로 보고 생방송 `.part`를 지운다(`part.rs:200-207`). 다시 받을 수 없는 녹화가 사라진다 | 이름 모양이 겹치지 않아(§4.2) 사용자가 이름을 직접 맞춘 경우에만 생긴다. 이 위험은 구간 기능이 만든 것이 아니라 모든 VOD 받기에 이미 있다(Codex 2회차 N4와 같은 구조, core.md 59 "알려진 한계" ①). 카드는 `conflict.partialOther`로 미리 알린다(§5.6). 해결(라이브 임시 파일 경로 분리)은 생방송 쪽 과제로 남긴다 |
| 변환 중 취소가 먹지 않는다(3차 개정) | 긴 구간이면 마무리 몇 초 동안 [취소]가 바로 반영되지 않는다 | core.md 60의 한계를 그대로 물려받는다. 구간이 녹화보다 짧다는 보장은 없다(거의 전체 길이도 고를 수 있다, §3.5 "한계"). 마무리가 몇 초인지는 **실측 필요**(실측 6번). 길게 나오면 변환 중 취소 확인을 생방송 쪽과 함께 연다 |
| 버전을 낮추면(수동 설치) 옛 앱이 jobs.json의 range를 무시하고 구간 이름의 파일에 전체를 받는다 | 이름과 내용이 맞지 않는다 | updater는 앞으로만 간다. v2 sidecar라 잘못 이어받지는 않는다(R09). 위험으로만 기록한다 |
| 일반 VOD에도 구간이 있을 거라는 기대(특히 편집자, Q1) | 문의 | 일반 VOD에서는 줄을 그리지 않는다(R3). `/help`에 "빠른 다시보기만" 한 줄을 둘 수 있다 |
| 조각을 고르는 동안 playlist가 바뀐다(재조회 사이) | 다른 조각을 받는다 | 지문을 전체 기준으로 두므로 `SourceChanged`로 멈춘다(R20) |
| 크기 추정 비율이 실제와 다르다 | 작은 혼란 | "약"을 유지한다. 받는 동안 추정이 실제 값으로 바뀐다(`segmented.rs:184-185`) |
| 웹뷰가 정규화를 빼먹는다 | 전체를 덮는 "구간" 작업(접미사 + v2 + defrag) | 내용은 맞으므로 받아들인다(§3.1). 카드 테스트로 정규화를 고정한다 |
| 펼친 뒤 접으면 입력이 남아 있지만 적용되지 않는다 | "구간으로 받은 줄 알았다" | 접혀 있으면 "저장될 이름"에 접미사가 없고 작업 행에 조각이 없다. 그래도 헷갈리는지는 사용자 관찰이 필요하다(**가정**). D62 시험을 하면 governance §6.1의 조건(기준선 포함 두 회 이상)을 따르고, 한 회만 하면 축소 시험이라고 표시한다 |

### 12.1 일반 VOD를 다시 열 조건
- 다시 열려면 두 조건이 모두 필요하다. 1차가 출시된 뒤 일반 VOD 구간 요청이 실제로 있어야 하고(편집자 포함, Q1), 실측 7번이 "된다"로 나와야 한다.
- 실측 7번은 넷을 본다. moov가 앞에 있는지, co64·ctts·edts가 있는지, 오디오 트랙이 1개인지, moov 크기가 상한 이내인지다. 지금까지 관찰된 것은 "moov가 앞"뿐이다(영상 두 개, `core.md:792`, R81). 나머지는 미확인이다. moov 크기 상한 값은 `[잠정] 근거 없음, 실측·ADR-0009 묶음 등록`이다.
- 그때 방식은 "일반 MP4 재작성 + 원본 바이트 [S,E)를 그대로 복사"다. 이어받기는 지금의 열린 Range 하나로 하고, 재개할 때 moov 지문이 같은지 확인한다. 모르는 형태는 `Unsupported`로 거부한다. 핵심 오라클은 샘플별 바이트 동일성 검사다. defrag 테스트의 `assert_equivalent` 방식(원본 trun ↔ 새 stbl 대조)을 같은 발상으로 쓸 수 있다(**가정**). 규모는 추정이 아니라 그때 스파이크로 잰다(R01).

## 13. 사용자 실측 목록(출력은 판정만)

번호는 1·2차와 `decisions.md`의 M-②-n과 맞추려고 그대로 두었다. 없앤 항목은 이유와 함께 남긴다.

1. ~~지금 전체 받기 파일의 첫 조각 tfdt가 0인가~~ **없앴다**(3차 개정). 안 A/B 판정용이었다. 구간 결과는 defrag가 가장 이른 트랙 기준 0부터 시각을 다시 쌓는다(`defrag.rs:924-932`). 그래서 원본 tfdt가 무엇이든 결과가 같다.
2. **시간축 장면 대응**(사람 눈, 유지): 본인 빠른 다시보기 하나에서 시각 셋(시작 근처, 중간, 끝 근처)을 고른다. PR ②-1의 `cargo run -p chzzk-core --example dl -- <주소> --lowest --range <시작>~<끝>`로 각 시각에서 시작하는 짧은 구간 파일을 만든다(결과는 defrag된 파일이다). 사람이 그 파일의 첫 장면과 치지직 플레이어에서 같은 시각의 장면을 비교한다. 판정은 시각마다 "일치(±1조각 안)/불일치"이고 ROADMAP에는 이 판정만 적는다. 조각 길이가 약 2초라서(`ROADMAP.md:99`) "±1조각"이 허용 폭이다. 보조로 `dl`이 "EXTINF 누적 = info 길이(±1조각)"를 같다/다르다로 찍지만, 이것은 길이 검사일 뿐 원점 검사가 아니다(RFC 8216 §4.3.2.1). **PR ②-3 머지 조건.**
3. 각 조각이 키프레임으로 시작하는가(오프라인, PR ②-0 도구, 유지). "안 된다"면 deferred.
4. ~~init의 mvhd·mehd duration이 0인가~~ **없앴다**(3차 개정). defrag가 `mvhd`·`tkhd`·`mdhd` 길이를 샘플 합으로 다시 쓰고 `mvex`(`mehd`)를 뺀다(`defrag.rs:958-984`).
5. ~~조각 안에 sidx 또는 emsg v1이 있는가~~ **없앴다**(3차 개정). defrag가 `styp`·`emsg`·`sidx`·`mfra`와 모르는 최상위 상자를 `free`로 바꾼다(`defrag.rs:812-813`).
6. **좁혔다**(3차 개정, 1·2차 "안 A·안 B 각각"): 실측 2번에서 만든 구간 파일 하나가 Windows 미디어 플레이어와 macOS QuickTime에서 처음부터 재생되고, 길이가 맞고, 탐색되는가(사람 눈). 판정은 된다/안 된다다. 생방송 실물 변환 파일은 QuickTime에서 이미 확인됐다(`ROADMAP.md:8`). 빠른 다시보기 실물과 Windows 미디어 플레이어는 처음이다. 같은 세션에서 **전체 받기 파일**(조각 구조)도 QuickTime에서 끝까지 재생·탐색되는지 된다/안 된다로 함께 본다. 이것은 이 기능의 판정이 아니라 "전체 빠른 다시보기에도 defrag를 적용할지"(남은 것)의 재료다. **PR ②-3 머지 조건**은 구간 파일 쪽만이다. 덧붙여 관찰한다(4차 개정, 머지 조건 아님): **거의 전체 길이의 구간 하나**(시작 0:00:10 근처 ~ 끝 근처)를 `dl --range`로 받아 ① 마무리(변환) 시간이 "10초 안 / 넘음"(기준값 **[잠정]**), ② 마무리 동안 앱·`dl` 메모리가 눈에 띄게 늘었는가 "아니다 / 그렇다"(macOS 활동 모니터·Windows 작업 관리자로 사람 눈)를 범주로만 적는다. 숫자(초·MB)는 영상 길이를 드러내는 준식별자라 옮기지 않는다. 결과는 §3.5 "한계"·§4.3·§12 "변환 중 취소" 행의 **가정**을 닫는다.
7. (일반 VOD를 할 때만) mp4의 moov가 앞에 있는가, co64·ctts·edts가 있는가, 오디오 트랙이 1개인가, moov 크기가 상한 이내인가.

---

## 개정 기록(2026-10-16)

입력: Codex 1회차 적대적 리뷰와 근거 확인 표(확인 51 · 가정 14 · 실측 필요 7 · 인용 오류 10). 저장소는 `bff221d`에서 읽기만 했다. 실서버 요청은 하지 않았다.

### 처리한 지적
| 출처 | 처리 | 근거 |
|---|---|---|
| Codex "EXTINF 합과 전체 길이가 같아도 시각의 원점은 검증되지 않는다" | 실측 2번을 시작·중간·끝 세 시각의 **장면 대응 확인**으로 바꿨다. 길이 비교는 보조 출력으로 낮췄다. PR 3 머지 조건에 넣었다. 원점이 어긋난 음성 fixture를 더했다(§3.2, §10.1, §11, §12, §13) | RFC 8216 §4.3.2.1(EXTINF = 지속 시간) |
| Codex 같은 절 "3~4배는 추정으로 표시" | §1.2와 §12.1에 추정이라고 적고, 다시 열 때 스파이크로 재게 했다 | R01 |
| R07 인용 오류(sidecar 절) | core.md §8 → **§5.1** | `core.md:407`·`:412` |
| R11 가정(`feat!`) | `!` 판정을 지우고 R10의 이유만 남겼다 | `versioning.md:30-33` |
| R16·R42 가정(셸 길이 재검증·정규화) | 셸은 길이 없이 할 수 있는 검증 둘만 한다. 길이 관련 판정은 웹뷰(편의)와 코어 `select_range`(최종)가 맡고, 정규화는 웹뷰가 한다 | `dto.rs`, `services.rs`, `ownership.rs:156` |
| R18 실측 필요 | 위 Codex 처리와 같다 | — |
| R24 인용 오류(줄 번호) | `:168`·`:170`·`:175`·`:179-188`으로 바로잡고 다시 열어 확인했다. report의 `k` 인자를 호출하는 쪽에서 바꿔야 한다는 점을 더했다 | `segmented.rs:160-188` |
| R27 인용 오류(끝 검사) | "지금 없는 새 검사"로 적고 통합 테스트를 더했다 | `segmented.rs:260-263` |
| R31·R32 가정(기준 T, 크기 불변) | 가정이라고 표시하고, 명세 출처(ISO/IEC 14496-12 tfdt)는 구현 PR에서 확인한다고 적었다(3차 개정: 둘 다 대상이 없어졌다, §3.5) | — |
| R33·R34·R35·R79·R80·R81 실측 필요 | 각 주장 옆에 실측 번호를 붙였다(3차 개정: R33·R34·R35·R79·R80은 defrag로 대상이 없어졌다) | §13 |
| R36 가정(PD 거부 경로) | 요청 속성 위반은 셸 `invalidInput`과 코어 `Unsupported::RangeNotHls`(네트워크 전), 실제 PD는 기존 `PlaybackChanged`로 나눴다 | `mod.rs`, `error.rs` |
| R39 인용 오류(`CheckOutputRequest`) | DTO가 아니라 command 인자다. 같이 바뀌는 셋을 적었다 | `commands.rs:109-115`, `app.rs:223`, `output.rs:26` |
| R41 누락(`same_job` 호출처) | 호출처 셋을 모두 적고 `partial_bytes` 단위 테스트를 더했다 | `jobs.rs`, `part.rs:201`, `output.rs:114` |
| R49 가정("저장될 이름") | `truncated`의 뜻을 넓히는 가장 작은 변경으로 정했다(2차 개정에서 가짜 백엔드·셸 테스트·patterns §6.5를 더했다) | `ResolveCard.svelte:251`, `output.rs:39` |
| R56 가정(Notice) | `variant=row` → **`variant=inline`** | patterns §6.1, content §10 role 행 |
| R60 인용 오류(resolve 범위) | "master도 받지 않는다"로 바로잡았다 | `client.rs` |
| R63 근거 없는 덧붙임 | 지우고 사용자 결정 3으로 남겼다 | patterns §6.4 |
| R64 인용 오류(작업 행 위치) | 구간 조각을 4줄 본문에서 **1줄 화질 칸**으로 옮겼다 | patterns §3.2 |
| R65 인용 오류(`a11y.range`, DC12) | 키를 지우고 접근 이름은 그대로 두었다. 낭독 품질은 실측 필요로 남겼다 | content §10, `copy.mjs:762-765` |
| R66 인용 오류(`range.help`, DC5) | 마침표로 끝나는 한 문장으로 바꾸고 `{duration}`을 뺐다 | `copy.mjs:738`, content §8 |
| R67 인용 오류(라벨 형식) | "일부만 받기"는 기본형(동사 어간 + 기)으로 바로잡았다. "전체로" 버튼은 기능이 겹쳐서 뺐다 | content §5.1 |
| R70 인용 오류(상태 이름) | §2.1의 여섯 이름으로 다시 쓰고 상태가 아닌 변형은 따로 적었다 | patterns §2.1·§2.3 |
| R01·R02·R23·R62·R78 가정 | 본문에 **가정**이라고 표시하고 판단 이유를 적었다(3차 개정: R23은 뒤집었다) | — |
| Q1 사용자 확정(편집자까지) | 머리말에 반영했다 | `services.rs:580-585` |
| 근거 없는 수치 | 칸 폭(`ch`), moov 크기 상한에 `[잠정] … ADR-0009`를 붙였다 | `adr/0009-unsourced-numbers.md` |

### 반영하지 않은 지적과 근거
- **Codex의 다른 지적들**: 대상 문서가 `backup.md`·`chat.md`·`delegation.md`·옛 생방송 설계(구현되어 core.md 구현 중 변경 58~60과 ADR-0025가 대신한다)·`00-*.md`다. 이 문서의 범위가 아니므로 여기서는 고치지 않았다.
- **Codex "사용자 시험 한 번으로 D62를 충족한다고 볼 수 없다"**: 이 문서는 D62 충족을 주장하지 않는다.
- **R23(Timeline을 첫 PR부터 넣는 것)**: 1·2차에서는 유지했다. 3차 개정에서 defrag로 대상이 없어져 뺐다.
- **R67의 "전체로"를 형식 등록으로 푸는 길**: 택하지 않았다. 문구를 등록하는 것보다 기능이 겹치는 버튼을 빼는 쪽이 작다.

### 2차 개정(2026-10-16, 독립 확인에서 남은 문제 10건)
입력: 1차 개정본의 독립 확인 결과. 저장소는 `bff221d`에서 읽기만 했다.

| 지적 | 처리 |
|---|---|
| 접미사가 두 번 붙는다(§4.2) | 접미사는 `check_output` 한 곳에서만 붙인다. `free_name`에 제목과 접미사를 따로 넘긴다. "접미사 한 번" 테스트를 더했다 |
| 구간만 바꾸면 이전 검사 결과가 쓰인다(§5.2) | `checkKey`에 실제로 보낼 `range`를 넷째 인자로 넣는다. `effectiveRange` 한 함수에서 값을 얻는다 |
| R49 해소가 불완전하다 | 가짜 백엔드·셸 테스트·디자인 시스템 `patterns.md:398`·`:713`을 고칠 대상에 넣었다 |
| 길이를 모를 때 접미사가 `u64::MAX`로 찍힌다 | `end_ms`를 `Option<u64>`로 두었다 |
| `conflict.partialOther` 문구가 구간 경우와 맞지 않는다 | 생기는 경우를 따져 적고 사용자 결정 4로 넘겼다(3차: R4 확정) |
| 오류 L0를 `ko.ts` 키로 잘못 적었다 | `errors.ts` `case` 리터럴 + `content.md` §15.2 행으로 고쳤다 |
| `duration.ts:36` 줄 밀림 | `:37`로 바로잡았다 |
| 원점 상수 보정은 근거 없는 단정이다 | 지웠다 |
| `~`와 1줄 ` · `의 근거로 content §6.5를 잘못 들었다 | 둘 다 가정으로 표시하고 등록 개정으로 돌렸다(3차: R2 확정) |
| `error_map.rs` 변형 목록 누락 | 바꿀 곳과 테스트에 더했다 |

### 3차 개정(최신 master 기준, 2026-10-16)

**입력.** 아래 셋과 사용자 확정을 입력으로 받았다.
- Codex 2회차 원문: R1~R4 "유지", N5·N6
- 결정 표(`decisions.md`)
- 계획(`plan.md`)
- 사용자 확정(2026-10-16): 결정 표 "유지" 행은 추천대로 확정

**기준 트리.** `origin/master` `df454c3`(v0.7.0)이다. 작업 트리 읽기 전용 작업 트리에서 읽기만 했다. `git -C … diff bff221d df454c3`과 `git log`로 생방송 녹화 변경(PR #104·#105, core.md 58~60, app.md 77, ADR-0025, D63)을 확인했다.

**실행.** `examples/defrag` 한 번을 `CARGO_TARGET_DIR=<임시 폴더>/target`으로 빌드했다. 입력은 임시 폴더의 합성 fixture 사본이고, 출력도 임시 폴더에 두었다. 저장소 트리·`worker/.dev.vars`·루트 `settings.json`·`dependent/`는 열지 않았다. 실서버 요청은 하지 않았다.

**줄 번호.** `bff221d` 기준 인용은 `git diff -U0` hunk로 새 위치를 계산했다(일회용 스크립트). 그 뒤 인용하는 줄을 `sed -n`으로 다시 열어 내용을 확인했다.

| 변경 | 처리 | 근거 |
|---|---|---|
| **안 A·안 B·`mp4frag`를 버리고 defrag로 마무리** | §3.5를 다시 썼다. `finish`의 변환 조건에 `range.is_some()`을 더한다. 안 A는 core.md 60이 QuickTime 실패를 확인한 모양이다. 안 B(tfdt 0 + mvhd/mehd)도 "고쳐지지 않았다"고 실물로 확인된 모양이다. 빠른 다시보기도 같은 구조라는 판단은 **가정**이다 | `core.md:829`, `ROADMAP.md:99`, `download/mod.rs:369-389` |
| defrag가 tfdt 시작이 0이 아닌 입력을 처리하는가 | **처리한다.** 첫 tfdt를 그대로 받고(`defrag.rs:535-550`), 가장 이른 트랙을 0으로 보고(`:924-932`), 트랙 사이 차이는 `elst` 빈 편집으로 남긴다(`:990-1019`). 테스트 `defrag/tests.rs:936-966`이 큰 tfdt를 다룬다. 합성 `init ‖ seg1`(tfdt 2000)을 직접 변환해 `Converted`, stts 0부터, 오디오 elst 빈 편집을 확인했다 | §3.5 |
| 구간 결과를 defrag로 마무리하면 tfdt 원점 문제는 | **파일 안 원점 문제는 사라진다**(1·2차의 R31·R32·R33·R34·R35·R79·R80). **playlist ↔ 플레이어 시각 대응(R18, 실측 2번)은 그대로 남는다.** defrag는 고른 조각 안의 시각만 다시 쌓는다 | §3.2 끝, §3.5 표 |
| `Timeline`·`base_us` 삭제(R23 뒤집음) | `.part`에 늘 원본 조각만 들어가므로 섞일 형식이 없다 | §3.3 |
| 실측 정리 | 1·4·5번은 없앴다. 6번은 "defrag한 구간 파일의 WMP·QuickTime 재생"으로 좁히고 전체 받기 파일 관찰을 덧붙였다. 2·3·7번은 유지한다 | §13 |
| PR 정리 | ②-4를 없앴다(fuzz target 4개 그대로, `scripts/ci/fuzz.mjs:28`. 처음 3차에는 `:9`로 잘못 적었다, 4차 개정). ②-0은 키프레임 판정 하나로 줄였다. 장면 표본은 ②-1의 `dl --range`로 옮겼다(코어 경로를 그대로 시험, N5와 같은 판단). ②-3 머지 조건에 실측 6번을 더했다 | §11 |
| 테스트 정리 | §10.1에서 tfdt·mvhd·트랙 시작 변형을 뺐다(defrag 테스트가 덮음). §10.2는 `assert_flat_mp4`(`recording.rs:1054-1069`)를 `support/mp4.rs`로 옮기고 mdat 동일성만 본다. §10.4 출력 단언을 "일반 mp4"로 바꾸고, 전체 받기 회귀·변환 뒤 재개·끝 검사 실패 시 미변환을 더했다. 생방송 sidecar 호환 단위 테스트를 더했다 | §10 |
| 라이브 녹화와의 접점 | 아래 여섯 가지를 확인했다 | — |
| ① `segmented.rs` | `run`은 그대로이고, 공유 도우미 `pub(super)`화와 재조회 `Source::Live` 분기만 바뀌었다. 구간 변경은 `run` 안에서만 한다 | `segmented.rs:37`·`:279-286`·`:335-382` |
| ② `part.rs` | `HlsState`는 그대로다. 생방송이 v1·`kind = Live`로 같은 형식을 쓴다(`live.rs:201-209`). `with_file_blocking`이 새로 생겼다(`part.rs:331-360`). plan.md의 "②-1 → ⑤-3 sidecar(`SidecarKind`·`content: Option`)" 의존은 생방송이 그 리팩터 없이 출시돼 낡았다 | §3.3 |
| ③ `hls.rs` | `parse_live_media`가 따로 생겼고 `parse_media`는 그대로다. `select_range`는 VOD playlist에만 쓴다 | core.md 58, `hls.rs:255`·`:332` |
| ④ `DownloadRequest.live_stop` 선례 | `range: None` 리터럴 자리 목록을 적었다 | §3.1 |
| ⑤ 셸 `ErrorCode` | 1:1 표가 20 → 22가 됐으므로 새 kind는 23번째다 | `crates/shell/src/error.rs:34` |
| ⑥ 생방송 요청·카드 | 생방송에 구간을 주면 거부한다(셸 `invalidInput`, 코어 `RangeNotHls`, 끊긴 생방송 마무리 분기보다 앞). 카드는 `tone === 'rewind'`만 줄을 그린다 | §3.6, §5.3, `receive.ts:22-26`, `ResolveCard.svelte:256-259` |
| `RangeNotHls` 검사 위치 정정 | 처음 3차 초안은 "끊긴 생방송 마무리 분기(`mod.rs:313-324`)보다 앞"이라고 적었다. 그런데 그 분기는 `run` 안이고, `.part`는 그보다 먼저 `PartFile::resume`(`mod.rs:280`)이 연다. 새 `same_job` 규칙 때문에 생방송 `.part`가 그때 지워진다. 그래서 검사를 `Chzzk::download` 맨 처음(Skip 검사·`resume` 앞)으로 옮기고, `.part`가 남는다는 단언과 Skip 경우를 테스트에 더했다 | §3.6, §10.3, `mod.rs:274-280`, `part.rs:200-207` |
| 새 위험 | 넷을 더했다. defrag 실패 시 조각 구조로 남음, 전체 받기와 결과 모양이 다름, 같은 경로의 생방송 `.part` 삭제(N4와 같은 구조), 변환 중 취소 불가 | §12 |
| 사용자 확정 반영 | R1~R4를 확정으로 적었다(R4의 새 문구는 초안). 머리말·§5.5·§7에 반영했다 | Codex 2회차 결정별 판정 표, 사용자 확정 |
| 번호 | core.md 61~·app.md 78~·D64~·ADR-0026~로 잡았다. 버전은 0.7.0 → MINOR | `Cargo.toml:9`, core.md 60, app.md 77, D63, ADR-0025 |
| 줄 번호 갱신 | 많이 바뀐 것은 다음과 같다. `ROADMAP.md` +3(`:66→:69`, `:96→:99`), `download/mod.rs`(`:231-236→:239-244`), `hls.rs`(`:232→:255`, `:301→:332`), `error.rs`(`:76→:80-82`, `:137→:147`), `model.rs:46→:55`, `naming.rs`(+13), `client.rs`, `dto.rs`(+9), `manager.rs`(`:347→:377`, `:394→:425`), 셸 `error.rs`(`:61→:63`, `:84→:88`, `:169→:173`), `error_map.rs:294-302→:300-308`, `jobs.rs:329→:330`, `receive.ts`(+2), `ko.ts`(`:69→:71`, `:71→:73`, `:79→:81`), `errors.ts`(+10, `:213→:215`, `:215→:217`), `backend.ts:318→:324`, `fixtures.ts:48→:70`, `content.md` §6.5 `:218-231→:219-232`, `gen-fixtures.mjs`(+91). `segmented.rs`의 `run`·`part.rs` 앞부분·`output.rs`·`patterns.md`·`governance.md`·`duration.ts`·`copy.mjs`는 그대로다 | `git diff -U0 bff221d df454c3` |

### 4차 개정(2026-10-16, 독립 확인에서 남은 문제 5건)

**입력.** 3차 개정에 대한 독립 확인 결과. 핵심(defrag가 첫 tfdt를 0으로 가정하지 않는다, `defrag.rs:537-550`·`:924-932`, 합성 fixture 재실행 `Converted { tracks: 2, samples: 8, discontinuities: 0 }`)은 맞다고 확인됐다. "빠른 다시보기도 core.md 60과 같은 QuickTime 문제가 난다"·"defrag 실패 시 경고만"은 이미 **가정**으로 표시돼 실측 6번에 이어져 있어 지적 대상이 아니었다. 아래 다섯 건만 고쳤다. 기준 트리는 같다(`df454c3`, 읽기만). 줄은 `sed -n`·`grep -n`으로 다시 열어 확인했다.

| 지적 | 처리 | 근거 |
|---|---|---|
| 1. fuzz `TARGETS` 줄 번호 | `scripts/ci/fuzz.mjs:9` → **`:28`**로 고쳤다(§10.5, 3차 표 "PR 정리" 행). 9번 줄은 주석이다 | `fuzz.mjs:28` `export const TARGETS = ['url', 'info', 'mpd', 'hls'];` |
| 2. 합성 `stsd` entry 0개 근거 줄 | `gen-fixtures.mjs:578` → **`:580`**으로 고쳤다(§3.5 끝, §10.1). 578은 `const stbl = box(`다 | `gen-fixtures.mjs:578-580` |
| 3. `DownloadRequest` 리터럴 목록 | 빠진 셋을 더했다: `crates/core/tests/recording.rs:305`, `crates/core/tests/live_record.rs:63`, `crates/core/examples/dl.rs:229`(여기는 `--range` 인자 값을 넘긴다). `manager.rs:136`은 목록에서 빼고 "대상이 아닌 것"으로 옮겼다. 매니저 내부 `Job` 리터럴이다. 매니저의 요청은 `to_request`(`jobs.rs:88`)가 만들고 `manager.rs:1023`은 `live_stop`만 덮어쓴다 | §3.1, `grep -rn live_stop crates app/src-tauri`, `manager.rs:112-129`·`:1021-1023`, `download/mod.rs:77` |
| 4. "구간은 녹화보다 짧다" 단정 | 셋 다 고쳤다. §3.5 "한계"는 "보장 없음"으로 바꾸고 최악(거의 전체 길이 = 전체 defrag)을 적었다. 샘플 표 구조(`defrag.rs:514-521`)와 한 시간 규모 어림(**가정**: 프레임률·오디오 형식 미실측)도 붙였다. §4.3 "조금 길어질 뿐"은 **실측 필요**로 바꿨다. §12 "변환 중 취소" 행에서 근거 없는 문장을 뺐다. 실측 6번에는 거의 전체 길이 구간의 마무리 시간("10초 안/넘음", **[잠정]**)과 메모리("늘었다/아니다")를 범주로만 관찰하는 항목을 더했다. 머지 조건은 아니다. 초·MB 숫자는 영상 길이를 드러내는 준식별자라 옮기지 않는다(CLAUDE.md 공개 저장소 규칙) | §3.5, §4.3, §12, §13 6번, core.md 60 "복사 없이 제자리"(메타 상자 64 MiB, `mdat` 본문 안 읽음) |
| 5. 형제 문서가 낡음 | 같은 변경에서 고쳤다(고치기 전 사본: range 4차 이전의 결정 표·range 4차 이전의 계획). **decisions.md**: M-②-1·4·5는 줄을 긋고 "없앴다"와 이유를 적었다(번호는 range.md §13과 맞추려고 남겼다). M-②-2·6의 도구는 ②-0에서 **②-1 `dl --range`**로 옮겼다. M-②-6은 "defrag한 구간 파일 재생 + 전체 받기 관찰 + 마무리 관찰"로 고쳤다. 실측 묶음 안내 문단(`:50`)에 "M-②-2·6은 ②-1 뒤"를 더했다. **plan.md**: `:78`(②-4 참조 뺌), `:138`(`Timeline` 없음), `:140`(fuzz ②-4 행 뺌), `:168`(②-0을 키프레임 하나로), `:170`(`Timeline` 없음, defrag 조건·리터럴·`dl --range` 더함), `:172`(②-4 줄 긋기), `:173`(②-3 조건을 M-②-2·6으로), `:229`(의존 그래프에서 `(②-4)` 빼고 실측 위치 옮김), `:251`(`(②-4)` 뺌, 조건 M-②-2·6) | §11, §13, `grep -n "②-4\|mp4frag\|Timeline\|make-sample" plan.md decisions.md`(고친 뒤 남은 것은 "없앴다" 설명뿐) |

### 남은 것(실측·사용자 결정)
- 실측 2·3·6번(§13). 3번은 PR ②-0 도구로 먼저 하고, 2·6번은 PR ②-1 뒤 `dl --range`로 한다. 2번 장면 대응(세 시각 모두 일치)과 6번 재생(된다)이 PR ②-3의 머지 조건이다.
- **전체 빠른 다시보기 받기에도 defrag를 적용할지**(이 기능 밖의 새 결정). core.md 60이 빠른 다시보기에도 맞다면 지금 전체 받기 파일도 QuickTime에서 첫 조각만 재생될 수 있다(**가정**, 실측 6번의 "전체 받기 파일" 관찰이 재료). 하기로 하면 `finish` 조건을 `expected_kind != Progressive`로 넓히는 별도 `fix:` PR이고, ②와 독립이다.
- `decisions.md`·`plan.md`의 ② 행은 **4차 개정에서 고쳤다**(아래 4차 표). 남은 것은 ② 밖이라 손대지 않은 둘이다.
  - plan.md의 "조각 엔진 `segmented.rs`·`part.rs`·`hls.rs`" 접점 행(`plan.md:138`)의 ⑤ 쪽과 `chore/live-parser`(⑤-3)의 "②-1 sidecar 형식" 의존. 생방송은 `SidecarKind` 리팩터 없이 v1 그대로 출시됐다(`live.rs:201-209`). ⑤ 계획을 고치는 쪽에서 정리한다.
  - N6(②가 deferred되면 ④가 막힌다)은 plan.md에서 풀 일이다(`plan.md:251` "릴리스 ②+④").
- 실측 6번의 마무리 시간·메모리 관찰(4차 개정). "10초" 기준값은 **[잠정]**이다. 길게 나오면 `Finalizing` 하위 표시와 변환 중 취소 확인을 연다(§4.3, §12).
- `design-shots`에 `conflict.partialOther` 장면이 있는지(문구를 고치면 기준선을 다시 받는다).
- 원점 보정이 필요해 보일 때의 별도 조사(실측 2번이 불일치일 때만).
- `truncated` 필드 이름을 그대로 둘지(PR ②-2 리뷰).
- 작업 행 1줄에서 구간 조각이 제목 공간을 얼마나 줄이는지(갤러리 720·960 실측), `0:10:00~0:20:00`의 스크린 리더 낭독 품질.
- `conflict.partialOther` 새 문구 다듬기(R4는 확정, 문구는 초안).
- defrag 실패를 구간에서도 경고만으로 둘지(생방송과 같게 둔 것은 **가정**). 실물에서 실패가 관찰되면 다시 본다.
- 같은 경로의 생방송 `.part`가 VOD·구간 받기로 지워지는 위험(N4와 같은 구조). 생방송 쪽 과제다.
- 칸 폭 `ch` 값, moov 크기 상한: `[잠정]`, ADR-0009 묶음 등록.
