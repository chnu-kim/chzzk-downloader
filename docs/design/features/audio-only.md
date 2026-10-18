# 오디오만 받기: 명세

**상태·확정 결정(2026-10-18)**: **A-1 코어(core.md 84)·A-2 셸(app.md 99)·A-3 앱(app.md 100) 구현됨.** 갤러리 기준선(`card-vod-audio`, Linux CI)과 실측 M-A1~A3은 남았다. 이 문서 본문은 구현에 맞게 고쳤다. 설계 시점과 달라진 곳은 core.md 84 ⑤~⑦과 app.md 99-3(채팅 가드 문구)이다. 사용자 결정은 두 가지다. "오디오만 받기, 원본 m4a(변환 없음)"(ROADMAP "경쟁력 개선 착수" (마))와 **범위 C**다. 범위 C에서는 **일반 VOD의 MPD에 서버의 오디오 전용 트랙이 있을 때만** 화질 목록에 "오디오만"을 보인다. 오디오 전용 트랙이 없는 경우(클립, 빠른 다시보기, 오디오 set이 없는 일반 VOD)에는 숨긴다. 클립과 빠른 다시보기에서 비디오 트랙을 빼는 리먹스는 후속이다(§12).

기준 트리는 `origin/master` `26ca67d`(#165 속도 제한 머지 뒤)다. 이 문서의 `파일:줄`은 모두 이 트리에서 연 줄이다. 형식과 근거 표기는 `range.md`를 따른다.
- **[확인]**: 직접 연 줄이 받친다.
- **[실측]**: 아래 §2의 사용자 실측 요약이 받친다.
- **가정**: 근거 문서가 없는 설계 판단이다.
- **[실측 필요]**: 실물이나 플레이어로만 정할 수 있다.

예시 값(ID·주소·라벨)은 모두 합성 fixture의 가짜 값이다. 공개 저장소 규칙을 따른다.

같은 날 미머지 PR이 둘 있다. #166 파일 이름 템플릿과 #167 mp4 메타데이터다. 이 명세는 둘이 없는 master를 기준으로 한다. 둘이 먼저 머지되면 겹치는 곳을 §11.3에 적었다.

---

## 0. 핵심 결정(요약)

| # | 결정 | 근거 |
|---|---|---|
| A1 | 오디오 rep을 `Source::Progressive`의 화질 하나로 넣는다. 새 `PlaybackKind`는 만들지 않는다 | 실측: 오디오 rep은 단일 파일 GET으로 완성되고 Range가 된다(§2). `PlaybackKind`가 늘면 `recent_kind`·`converts_on_finish`·바인딩·배지가 모두 바뀐다 |
| A2 | 선택 키는 합성 상수 `AUDIO_QUALITY_ID = "audio"`다. rep@id를 쓰지 않는다 | 재조회 뒤 같은 rep을 다시 고르는 키가 있어야 한다(`progressive.rs:60-67`). 오디오 rep@id가 재조회 사이에 같은지는 실측하지 않았다. 셸이 확장자를 `quality_id`만 보고 정할 수 있게 하려는 이유도 있다(A5) |
| A3 | 일반 VOD(`ContentRef::Video` + DASH)만 오디오를 고른다. 클립 경로는 오디오 set이 있어도 버린다 | 범위 C. fixture `clip_multi.mpd`에는 오디오 set이 있지만 실물 클립 8건에는 없었다(§2) |
| A4 | 오디오 rep이 둘 이상이면 `bandwidth`가 가장 큰 것 하나만 보인다(같으면 문서 순서상 앞) | 선택지를 하나로 둔다. 재조회 때도 같은 규칙이라 결과가 결정적이다 |
| A5 | 확장자 `.m4a`의 원천은 코어 `naming` 하나다. 셸은 `quality_id == AUDIO_QUALITY_ID`로 확장자를 정한다. 코어는 받기 전에 확장자와 화질이 맞는지 검사한다 | 웹뷰가 따로 보낸 플래그를 믿지 않는다. 화질과 확장자가 어긋나면 m4a 바이트가 `.mp4`에 써진다 |
| A6 | 마무리에서 기존 `download::defrag`로 일반 mp4(m4a)로 평탄화한다. 최선 노력이다. 바꾸기 전 실패는 fMP4 그대로 마무리한다 | defrag는 트랙 종류를 가리지 않고 `sidx`를 `free`로 바꾼다(§7). 실측에서 fMP4 원본도 ffmpeg·VLC·QuickTime이 재생했다. 그래서 실패해도 결과는 쓸 수 있다 |
| A7 | 평탄화 뒤 `.part`가 `total_len`보다 길어진다. 그 경우 이어받기 요청 없이 곧바로 `finish`로 간다 | 그러지 않으면 416 → `SourceChanged`로 이미 받은 작업이 실패한다(§4.6) |
| A8 | 오디오는 "마지막 화질"로 기억하지 않는다. 기본 선택도 되지 않는다 | `record_enqueued`가 라벨을 저장한다(`services.rs:489-491`). 기억하면 한 번 오디오를 고른 뒤 모든 VOD가 오디오로 시작한다 |
| A9 | 구간 받기와 채팅은 함께 쓰지 않는다. 구간은 지금 검사가 이미 거부한다. 채팅은 셸 가드를 하나 더한다 | 구간: `validated_range`가 빠른 다시보기가 아니면 거부한다(`manager.rs:559`). 채팅: 자막 이름이 `.mp4`만 떼므로(`naming.rs:309-337`) `x.m4a.ass`가 된다 |
| A10 | jobs.json 형식은 바꾸지 않는다. 오디오 작업은 `quality_id = "audio"`와 `.m4a` 출력 경로로 표현한다 | 둘 다 이미 저장되는 필드다(`jobs.rs:48`·`:59`). 옛 앱이 jobs.json을 다시 써도 사라지지 않는다. `JobDto.audioOnly`는 저장하지 않고 계산한다 |

## 1. 목표와 범위

### 1.1 목표
- 일반 VOD에서 서버가 따로 제공하는 오디오 트랙(AAC, m4a)을 **변환 없이** 받는다. 재인코딩하지 않는다. 마무리에서는 상자 구조만 일반 mp4로 바꾼다(A6). ROADMAP의 "ffmpeg 제거, 완전 무설치" 결정을 지킨다(range.md §1.1과 같은 기준).
- 받기는 지금의 progressive 경로를 그대로 쓴다. 다음 동작이 오디오에서도 같아야 한다.
  - `.part` 이어받기
  - 재시도와 인내 모드
  - 서명 만료(403) 재조회
  - 속도 제한 seam(core.md 75)
  - 중지·재개와 앱 재시작 복구
- 기본 흐름(붙여넣기 → [받기])에 단계를 더하지 않는다. "오디오만"은 화질 목록의 행 하나다.

### 1.2 하지 않는 것
- **클립·빠른 다시보기의 오디오**: 서버 오디오 트랙이 없다(§2). 비디오 trak을 빼는 리먹스는 후속이다(§12).
- **오디오 set이 없는 일반 VOD**: 행을 숨긴다. 왜 그 영상에 set이 없는지는 확인하지 못했다.
- **포맷 변환**(mp3·wav·opus 등): ffmpeg가 필요하다. 결정 "원본 m4a"에 따라 하지 않는다.
- **오디오 구간 받기**: 일반 VOD 구간 받기는 지원하지 않는다(range.md §1.2 "일반 VOD(PD mp4)의 구간 받기: 1차에서는 하지 않는다"). 그래서 오디오도 구간 없이 받는다.
- **m4a 메타데이터**(제목·채널·날짜·표지): #167(mp4 메타데이터)이 머지된 뒤 후속에서 m4a에도 넣을지 정한다(§12).
- **생방송 오디오**: 생방송 master의 `audioOnly` track은 지금처럼 화질에서 뺀다(`crates/core/tests/recording.rs:922`·`:1683` [확인]).
- Worker 변경은 없다.

## 2. 실측 근거(2026-10-18, 쿠키 없음, 비성인 공개 영상)

원자료(영상 번호·주소·서명)는 저장소에 두지 않는다. 범주와 구조만 적는다.

| 대상 | 결과 |
|---|---|
| 일반 VOD(vodplay MPD) 5건 | 4건에 세 번째 AdaptationSet `mimeType="audio/mp4"`가 있다. 그 안의 Representation은 하나다: `codecs="mp4a.40.2"`, `bandwidth=128000`, `audioSamplingRate` 44100 또는 48000, `nvod:Label kind="qualityId"`, `contentType` 속성 없음. BaseURL은 서명 쿼리가 붙은 단일 `.m4a`이고, `SegmentList`(Initialization range + SegmentURL mediaRange)도 함께 있다. 1건은 audio set이 없다(video/mp4·video/mp2t만 있고 이유는 확인 못 함) |
| 오디오 파일 구조 | fMP4/CMAF: `ftyp`(compatible brands에 `dash`·`cmfc`) → `moov`(trak 1개, handler `soun`, `mvex`·`trex`) → `sidx` → `moof`+`mdat` 반복 |
| 오디오 파일 받기 | BaseURL을 통째로 GET하면(200) 완성 파일이 온다. 쿠키는 필요 없다. Range가 된다 |
| 클립 8건 | audio set 없음 |
| 빠른 다시보기 | master에 muxed variant만 있다(오디오 전용 없음) |
| fMP4 m4a 재생 | ffmpeg·VLC·QuickTime이 재생한다. 일부 구형 플레이어는 확인하지 않았다 |

지금 코어는 오디오 트랙을 "빼는" 게 아니라 "보지 않는다".
- `parse_mpd`는 모든 AdaptationSet의 Representation을 읽는다(`crates/core/src/mpd.rs:95-115` [확인]). mime은 set에서 물려받는다(`:107`·`:121`).
- PD 필터 `is_pd()`는 `video/mp4` + id `PD_` + BaseURL `/pd/` + 비보호만 통과시킨다(`mpd.rs:70-76` [확인]). 그래서 `pd_reps`(`:137-161`)에서 오디오가 빠진다.
- 합성 fixture에는 이미 오디오 set이 있다(`testdata/vod/playback.mpd:12-14`, `testdata/clip/clip_multi.mpd`, 생성기 `scripts/fixtures/gen-fixtures.mjs:389-395`·`:445-446`·`:498-499` [확인]). 지금은 아무 테스트도 이 set을 쓰지 않는다.

## 3. 기존 결정과의 관계

**뒤집는 결정은 없다.**

| 결정 | 처리 | 근거 |
|---|---|---|
| "ffmpeg 제거, 필요하면 선택적 remux는 나중에"(ROADMAP) | 유지한다. 오디오는 서버가 이미 분리해 둔 파일을 받는다. 마무리 defrag는 데이터를 움직이지 않는다 | `download/defrag.rs:1-21` [확인] |
| PD 필터(`is_pd`) | 바꾸지 않는다. 오디오는 **따로 된 필터**(`is_audio`)로 고른다. 비디오 화질 목록과 선택 규칙은 그대로다 | `mpd.rs:70-76` |
| 화질 `id` 정확 일치(`select_pd`) | 그대로 쓴다. 오디오 id는 합성 상수다(A2) | `mpd.rs:164-171` |
| `converts_on_finish`(core.md 60·64·71) | **넓혀 쓴다.** 조건에 "오디오 요청"을 더한다. 변환기·실패 계약(core.md 61 M4)은 그대로다 | `download/mod.rs:475-486`·`:506-540` |
| 구간 받기는 빠른 다시보기만(R3) | 그대로다. 오디오에는 구간이 없다 | `jobs::validated_range`, `manager.rs:559`·`:644` |
| 채팅은 영상 전체 받기만(chat.md §4.4) | 좁힌다. 오디오도 거부한다 | `manager.rs:560-566` |
| jobs.json `JOBS_VERSION = 1` | 유지한다. 필드를 더하지 않는다(A10) | `jobs.rs:32` |
| `.part` sidecar v1 | 유지한다. 오디오는 지금 progressive sidecar(`quality_id`가 `"audio"`)다 | `progressive.rs:174-181` |
| 쿠키는 API·MPD에만 | 그대로다. 오디오 GET은 `RequestKind::Media`다 | `client.rs:234-242`, 실측 "쿠키 불필요" |

## 4. 코어 변경(`crates/core`)

### 4.1 MPD: 오디오 rep 고르기(`mpd.rs`)
- `Representation`에 `codecs: Option<String>`을 더한다. mime처럼 Representation 값이 없으면 AdaptationSet 값을 물려받는다(`parse_rep`의 `set_mime`과 같은 방식, `mpd.rs:117-132`).
- `Representation::is_audio()`를 더한다. 조건은 넷이다.
  - `mime`에 `audio/mp4`가 있다.
  - `codecs`가 `mp4a.`로 시작한다. AAC가 아니면 `.m4a`라는 이름이 맞지 않아서다.
  - 비보호다(`!protected`).
  - 첫 BaseURL이 있다.

  `PD_`·`/pd/` 조건은 두지 않는다. 실물 오디오 rep은 PD 경로가 아니다([실측]).
- 공개 상수 `pub const AUDIO_QUALITY_ID: &str = "audio";`. 이 값은 PD id(`PD_` 접두)와 겹치지 않는다.
- `pub fn audio_rep(reps: &[Representation]) -> Result<Option<PdRep>, Error>`를 더한다.
  - `is_audio()`인 rep 중 `bandwidth`가 가장 큰 하나를 고른다. 같으면 앞의 것이다(A4).
  - 고른 rep을 `PdRep { quality, url }`로 만든다. `quality` 필드는 다음과 같다.
    - `id = AUDIO_QUALITY_ID`, `label = AUDIO_QUALITY_ID`
    - `resolution`·`width`·`height`·`frame_rate`는 `None`
    - `bandwidth`는 rep 값
    - `audio_only = true`(§4.2)
  - BaseURL을 파싱하지 못하면 `pd_reps`처럼 `Error::Parse`를 낸다. 오류에 원문 URL을 넣지 않는다(`mpd.rs:140-142` 규칙). 호출하는 `Chzzk::progressive`는 이 오류를 경고 로그로 남기고 오디오 행만 뺀다(비디오 받기를 막지 않는다, core.md 84 ⑥).
  - 없으면 `Ok(None)`이다.
- `pd_reps`는 바꾸지 않는다. 비디오 PD가 하나도 없으면 오디오가 있어도 `NoQualities`다. 오디오만 있는 목록을 만들지 않는다. 생방송 `audioOnly` 선례(`recording.rs:1683`)와 같다.

### 4.2 모델(`model.rs`)
- `Quality`에 `pub audio_only: bool`을 더한다. `Quality`는 `Serialize`만 하고 저장하지 않는다(`model.rs:61-75`). 그래서 serde default는 필요 없다.
- `Quality { .. }` 리터럴과 분해(`crates/shell/src/dto.rs:584-595`, `..` 없이 분해한다)가 모두 컴파일 오류로 드러난다. 그 자리마다 값을 채운다. 비디오는 `false`다.
- `default_quality_index`(`model.rs:208-223`)는 `audio_only` 항목을 **두 단계 모두에서 건너뛴다**(A8).
  - 마지막 라벨 일치 단계: 옛 설정에 무엇이 남아 있어도 오디오가 기본이 되지 않게 한다.
  - 최대 해상도 단계: 이미 `resolution.or(height)`가 `None`이라 건너뛰지만, 의도를 코드에 적는다.
- 오디오 행은 `Source::Progressive { reps }`의 **맨 끝**에 붙인다. 화면 순서가 "비디오 화질들 → 오디오만"이 된다.

### 4.3 resolve(`client.rs`)
- `progressive(&self, video_id, in_key)`(`client.rs:195-208`)에 `with_audio: bool`을 더한다.
  - `ContentRef::Video` + `Playback::Dash` 경로(`:139-141`)는 `true`다.
  - `ContentRef::Clip` 경로(`:184`)는 `false`다(A3).
- `with_audio`이면 `pd_reps` 결과 뒤에 `audio_rep`의 결과를 붙인다(있을 때만).
- 재조회(`Job::reresolve`)도 같은 `resolve`를 지난다. 그래서 같은 규칙이 다시 적용되고, `select_pd(&reps, "audio")`가 새 서명 주소를 찾는다(`progressive.rs:60-67`). 재조회 결과에 오디오 set이 없어졌으면 지금처럼 `QualityNotFound`다.

### 4.4 이름(`naming.rs`)
- 확장자를 인자로 받는다. `pub enum MediaExt { Mp4, M4a }`를 만들고 다음을 둔다.
  - `fn as_str()`: `.mp4`·`.m4a`
  - `pub fn for_quality(quality_id: &str) -> MediaExt`: `AUDIO_QUALITY_ID`면 `M4a`, 그 밖은 `Mp4`
- 상수 `EXT`(`naming.rs:15`)는 `MediaExt::Mp4.as_str()` 자리로 남긴다. `range_stem`·`sibling_path`는 mp4 전용 그대로다. 구간과 채팅은 오디오와 같이 쓰지 않는다(A9).
- `output_path(folder, filename, p)`는 **그대로 두고**(`MediaExt::Mp4`로 위임) 확장자를 받는 `output_path_ext(folder, filename, ext: MediaExt, p)`를 더한다(구현 중 확정, core.md 84 ⑤: 같은 날 미머지 #166이 `output_path` 호출처를 건드려 서명을 바꾸면 충돌이 커진다). 규칙은 지금과 같다(`naming.rs:219-230`).
  - 정리한 이름이 `ext`로 끝나지 않으면(대소문자 무시) 붙인다.
  - 200바이트를 넘으면 확장자 앞을 줄인다.

  확장자를 받아야 하는 호출처는 셋이다. `crates/shell/src/output.rs:52`·`:138`, `crates/shell/src/manager.rs:569`, `crates/core/examples/dl.rs:342` [확인]. 나머지(테스트 포함)는 `output_path`를 그대로 쓴다.
- `default_filename`(`naming.rs:42`)은 확장자 없는 "기본 이름"을 만드는 데에도 쓰인다(`ResolvedDto::suggested_file_name` = `.mp4`를 뗀 것, `dto.rs:496`). 오디오여도 같은 기본 이름을 쓴다. 확장자는 `output_path`가 붙인다. 접두(`[YYMMDD]`·`[클립]`)는 바꾸지 않는다. 그래서 같은 영상의 영상 파일과 오디오 파일은 이름이 같고 확장자만 다르다. 경로가 다르므로 충돌도 없다.
- 공개 함수 `pub fn is_audio_output(path: &Path) -> bool`(파일 이름이 `.m4a`로 끝나는지, 대소문자 무시)를 둔다. §4.5의 검사가 쓴다.

### 4.5 요청 검사(`download/mod.rs`)
- 구간 검사 바로 옆(`download/mod.rs:345-352`, "구간 요청의 검증은 맨 앞이다", core.md 64)에서 확인한다. 조건은 `(quality_id == AUDIO_QUALITY_ID) == naming::is_audio_output(&req.output)`이다.
  - 다르면 새 `Unsupported::AudioOutputMismatch`로 거부한다.
  - 오디오인데 `expected_kind != Progressive`일 때도 같은 오류다.
- 이 검사는 `resume`보다 앞이다. 그래서 다른 작업의 `.part`를 지우지 않는다(같은 이유, core.md 64).
- 셸의 오류 코드는 기존 매핑을 그대로 탄다. 코어 `Error::Unsupported(_)`는 변종과 관계없이 `ErrorKind::Unsupported`이고(`crates/core/src/error.rs:160` [확인]), 셸은 이것을 `ErrorCode::Unsupported`로 옮긴다(`crates/shell/src/error.rs:92` [확인]). 변종별 분기는 `Encrypted` 하나뿐이다(`:179`). 그래서 새 오류 코드와 `errors.ts` L0 문구가 생기지 않는다. 정상 UI 흐름에서는 나오지 않는 방어선이다. `Unsupported`는 `is_resumable() == false`지만 이 검사는 `resume` 전이라 지울 `.part`가 없다.
- `DownloadRequest`에는 필드를 더하지 않는다. `quality_id`와 `output`으로 충분하다. 그래서 리터럴 자리(range.md §3.1 목록)는 바뀌지 않는다.

### 4.6 엔진(`download/progressive.rs`·`mod.rs`)
- **평탄화 조건**: `converts_on_finish(kind)`(`mod.rs:479-486`)를 `converts_on_finish(req: &DownloadRequest)`로 바꾼다. 몸통은 다음과 같다.
  ```rust
  match req.expected_kind {
      PlaybackKind::LiveRewindHls | PlaybackKind::Live => true,
      // 오디오 rep은 CMAF 조각 구조라 일반 m4a로 바꾼다(audio-only.md §7). 비디오 PD는 일반 mp4다
      PlaybackKind::Progressive => req.quality_id == AUDIO_QUALITY_ID,
  }
  ```
  `finish`의 호출(`mod.rs:506`)과 테스트(`:602-603`)를 같이 고친다. `defrag_verdict`와 실패 계약(core.md 61 M4)은 그대로다.
  - `Unchanged`: fMP4 그대로 마무리한다.
  - `Modified`: `.part`로 남긴다.
- **평탄화 뒤 이어받기(A7)**: `finish`는 변환이 붙인 `moov`까지 checkpoint한다(`mod.rs:523-529`). 그래서 마무리 직전에 앱이 죽거나 `finalize`가 `TargetExists`로 끝나 `.part`가 남으면, 다음 실행의 `written()`은 sidecar의 `total_len`보다 크다.
  - 지금 `attempt`는 이 경우 `Range: bytes={written}-`를 보낸다. 416을 받고, `total == offset`이 아니므로 `SourceChanged`가 된다(`progressive.rs:146-154`). 다 받은 작업이 실패한다.
  - 그래서 `run` 맨 앞(`progressive.rs:41` 뒤)에 규칙을 넣는다. 오디오 요청이고 `.part`의 `progressive.total_len`이 `Some(t)`이며 `written() >= t`이면 요청하지 않고 곧바로 `finish`로 간다.
  - `finish`의 defrag는 결과에 따라 갈린다.
    - 이미 바꾼 파일이면 `AlreadyFlat`(`defrag.rs:71-72`)이고 그대로 마무리한다.
    - 3단계 도중 끊긴 파일이면, `resume`이 붙인 `moov`를 잘라 `written == t`가 된다. defrag의 멱등 규칙(`defrag.rs:22-24`)이 다시 바꾼다.
  - 비디오 PD에는 이 분기를 열지 않는다. 비디오에서 `written > total`이 생길 경로가 없고, 지금의 416 확인 동작을 바꾸지 않기 위해서다.
- 받기 본문(`attempt`)·throttle seam·재시도·인내 모드·403 재조회는 바꾸지 않는다. 오디오는 `select_pd`로 고른 주소 하나를 받는 progressive 작업일 뿐이다.
- sidecar는 `Sidecar::new(content, quality_id = "audio", Progressive)`다(`progressive.rs:175-179`). 같은 영상의 비디오 작업과 `quality_id`·출력 경로가 모두 달라 서로의 `.part`를 같은 작업으로 보지 않는다.

### 4.7 `examples/dl.rs`
- `--list`에 오디오 행이 보인다. `audio_only`이면 해상도 대신 `audio`를 찍는다.
- `--quality audio`로 고르면 `output_path(.., MediaExt::for_quality(id), ..)`로 `.m4a`가 된다(`dl.rs:342`).
- `--lowest`는 `resolution.or(height).unwrap_or(u32::MAX)`로 고른다(`dl.rs:331`). 그래서 오디오를 고르지 않는다. 바꿀 것이 없고, `tests/live.rs:28-31`의 `lowest`도 같다.

## 5. 셸 변경(`crates/shell`)

- **DTO**:
  - `QualityDto`에 `audio_only: bool`(TS `audioOnly: boolean`)을 더한다(`dto.rs:572-596`).
  - `JobDto`에 계산 필드 `audio_only: bool`을 더한다. 값은 `rec.quality_id == AUDIO_QUALITY_ID`이고 저장하지 않는다(A10).
  - `UPDATE_BINDINGS=1 cargo test -p chzzk-shell --test bindings`로 바인딩을 다시 만든다.
- **출력 경로**: `OutputQuery`(`output.rs:31-42`)는 이미 `quality_id`를 받는다.
  - `check_output`·`free_name`이 `MediaExt::for_quality(q.quality_id)`로 경로를 만든다.
  - `output.rs:25`의 `EXT`와 `stem()`은 그 확장자를 뗀다.
  - `enqueue`(`manager.rs:569`)도 `MediaExt::for_quality(&req.quality_id)`로 경로를 만든다.

  웹뷰의 별도 플래그는 없다(A5).
- **가드**(`manager.rs:558-566`):
  - 오디오 + `save_chat`이면 `invalidInput`이다(A9). 문구는 채팅·영상 종류를 한 가드로 묶은 한 줄이다: "오디오만 받기는 채팅을 함께 받을 수 없고 일반 영상에서만 쓸 수 있습니다"(구현 중 확정, app.md 99-3. 기존 채팅 문구는 "영상 전체"를 말하는데 오디오는 영상이 아니라서 쓰지 않았다). 웹뷰는 이 오류를 정상 경로에서 보지 못한다(채팅 행이 없고 오디오 행은 일반 VOD 카드에만 있다).
  - 오디오인데 `expected_kind != Progressive`이거나 `content`가 `Video`가 아니면 `invalidInput`이다. 코어 검사(§4.5) 앞의 셸 방어선이다.
  - 구간은 `validated_range`가 이미 거부한다. 바꾸지 않는다.
  - 완료 뒤 채팅만 받기(`fetch_chat`·`check_chat_output`)도 같은 이유로 막는다. `chat_target`이 화질 키가 `audio`인 작업을 같은 문구의 `invalidInput`으로 거부한다(Codex 리뷰 지적, 시험 `chat_only_is_rejected_for_completed_audio_job`).
- **마지막 화질(A8)**: `enqueue_checked`(`services.rs:640-650`)는 `req.quality_id == AUDIO_QUALITY_ID`이면 `record_enqueued`에 빈 라벨을 넘긴다. 이 함수는 빈 라벨을 저장하지 않는다(`services.rs:489`). 최근 영상 기록은 그대로 남긴다.
- **최근 영상 배지**: `recent_kind`는 `Progressive`라 "일반 VOD"다(`services.rs:658-665`). 바꾸지 않는다.

## 6. 앱 변경(`app/`)

### 6.1 화질 목록(`QualityPicker.svelte`, `receive.ts`)
- 오디오 행의 라벨은 `t('quality.audioOnly')`("오디오만")다. 코어 label(`"audio"`)을 그대로 보이지 않는다(`QualityPicker.svelte:21`의 `label: q.label`을 `q.audioOnly ? t(..) : q.label`로).
- 꼬리(`tails`)는 fps 없음이다. 오른쪽 크기 열은 지금 규칙 그대로다(`qualitySize`, `estimateSize` = `bandwidth × 길이 / 8`, `format/bytes.ts:9-12`). 예: 128kbps, 1시간이면 "약 57.6MB".
- `bestQualityIndex`(`receive.ts:55-66`)는 오디오 행을 후보와 행 수 세기에서 모두 뺀다. "가장 좋은 화질" 꼬리표는 비디오 행에만 붙는다. 비디오가 하나뿐이면 지금처럼 꼬리표가 없다.
- 기본 선택은 셸의 `defaultQualityIndex`다(§4.2). 웹뷰는 따로 정하지 않는다.

### 6.2 카드의 이름·충돌
- 파일 이름 행 끝의 확장자 표시(`ResolveCard.svelte:366`, `FILE_EXT` = `.mp4`, `receive.ts:265`)를 고른 화질에 따라 `.m4a`로 바꾼다. `receive.ts`에 `fileExt(q: QualityDto)`를 둔다(구현 중 `FILE_EXT`는 없앴다, app.md 100-2). 문구가 아니라 코드 상수라서 deck 밖이다(`receive.ts:264` 주석 규칙).
- `checkKey`는 이미 `qualityId`를 담는다(`receive.ts:108-115`). 그래서 오디오로 바꾸면 `check_output`을 다시 부르고, 충돌·번호 이름을 `.m4a` 기준으로 다시 본다.
- 구간 줄은 빠른 다시보기 카드에만 있다(R3). 오디오 행은 일반 VOD 카드에만 있다. 그래서 둘이 한 카드에 같이 나오지 않는다. 지금 카드에는 채팅 행이 없다(④ 보류). 채팅 행을 다시 그리게 되면 오디오에서는 숨긴다.

### 6.3 작업 행·완료
- `qualityText`(`jobs.ts:355-357`)는 `job.audioOnly`이면 `t('quality.audioOnly')`를 보인다. 저장된 `qualityLabel`은 쓰지 않는다.
- `buildEnqueueRequest`(`receive.ts:234-262`)는 오디오일 때 `qualityLabel`에 `t('quality.audioOnly')`를 보낸다. 셸은 이 값을 jobs.json에 저장만 한다. 옛 앱이 이 작업을 보여 줄 때는 이 글자가 그대로 나온다(§8).
- 완료 행의 [열기]·[Finder에서 보기]는 그대로다. `.m4a`는 OS 기본 플레이어가 연다.

### 6.4 문구와 디자인 시스템
- `ko.ts`에 키 하나를 더한다: `'quality.audioOnly': '오디오만'`(접미 규칙 DC11 통과, `scripts/design/copy.mjs:29`).
- `content.md` §4 용어집에 행 하나를 더한다.
  - 개념: "영상 없이 소리 트랙만 받는 선택지"
  - 쓰는 말: **오디오만**(화질 목록의 행, 작업 행)
  - 쓰지 않는 말: 음원, 음성만, 소리만, MP3
  - 비고: audio-only.md
- `design-copy`가 "쓰지 않는 말"을 deck 전체에서 금지하므로, 더하기 전에 deck에 그 말이 없는지 grep으로 확인한다. 이 명세 시점에는 `ko.ts`·`content.md`에 "오디오·음성·소리"가 없었다.
- `content.md` §15.1 문구 전표에 키를 적고, `patterns.md` §6.5 영상 카드 폼의 화질 행 설명에 "오디오만 행(일반 VOD에 오디오 트랙이 있을 때만, 맨 끝, 꼬리표 없음)"을 더한다.
- 새 컴포넌트·토큰·D 번호는 없다. 기존 `RadioGroup` 행 하나다(governance §5).
- 새 상수도 없다. `AUDIO_QUALITY_ID`·`MediaExt`는 코어 상수이고, foundations §14 상수 표의 대상(`timing.ts`·`crates/shell/src/consts.rs`)이 아니다. `fileExt`는 `receive.ts`의 코드 값이다.

## 7. 마무리: fMP4 그대로 둘까, 평탄화할까

**결정: 평탄화한다(A6).** 기존 `download::defrag`를 쓰고 최선 노력이다.

| 근거 | 내용 |
|---|---|
| 트랙 종류를 가리지 않는다 | `parse_init`은 `trak`마다 `hdlr`·`minf`의 `stbl` 밖 자식(`vmhd`|`smhd`)을 그대로 옮긴다(`InitTrack` `defrag.rs:462-472`, `parse_init` `:489-556` [확인]). defrag 테스트에 이미 `soun` 트랙과 `smhd`가 있다(`defrag/tests.rs:430-438`, `audio_trun` `:646`, trex 기본값 오디오 `:869`) |
| `sidx` | 최상위 `styp`·`emsg`·`sidx`·`mfra`와 모르는 상자를 `free`로 바꾼다(`defrag.rs:889`) |
| 동기 샘플 | 모든 샘플이 동기(AAC)면 `stss`를 쓰지 않는다(`defrag.rs:1124`, `sync.len() == sizes.len()`). 오디오 단일 트랙에 맞는 결과다 |
| 실패 계약 | 바꾸기 전 실패는 fMP4로 마무리한다. 실측에서 fMP4 원본도 ffmpeg·VLC·QuickTime이 재생했다. 바꾸는 도중 실패는 `.part`로 남는다(core.md 61 M4) |
| 비용 | `mdat`을 읽지 않고 `moov`·`moof`만 읽는다(`defrag.rs:7-9`). 오디오 파일은 영상보다 훨씬 작다 |
| 호환 | 생방송·빠른 다시보기에서 QuickTime이 fMP4의 첫 조각만 재생하던 문제(core.md 60, R5)가 평탄화로 풀렸다. 오디오 fMP4는 QuickTime에서 재생됐지만 구형 플레이어·차량·휴대 기기의 동작은 확인하지 않았다. 그래서 일반 mp4 쪽이 더 넓게 호환된다(**가정**) |

- **한계**: 평탄화해도 `ftyp`는 그대로다. compatible brands에 `dash`·`cmfc`가 남는다. 일반 mp4 구조와 함께 있어도 재생에 문제가 없다고 본다(**가정**, [실측 필요] M-A1).
- **멱등·크래시**: core.md 60·61의 규칙을 그대로 따른다. progressive 경로에서만 생기는 "이어받기 요청" 문제는 §4.6 A7이 막는다.
- **조각 수**: 오디오 `moof` 수는 영상 길이 ÷ 조각 길이다. 합성 fixture는 2초다(`playback.mpd:13` `SegmentList duration="2000"`). 실물 조각 길이는 기록하지 않았다. `MAX_META_BOX`(64MB, `defrag.rs:40`)는 상자 하나의 상한이고 상자 수의 상한이 아니다.

## 8. 호환(옛 앱·옛 파일)

- **jobs.json**: 새 필드가 없다(A10). `JobRecord`에는 `deny_unknown_fields`가 없다(`jobs.rs:35-107` [확인]). 오디오 작업을 옛 앱(오디오를 모르는 코어)으로 되돌려 이어받으면 동작은 다음과 같다.
  - `resolve`는 성공하고 sidecar도 맞는다(양쪽 모두 `quality_id = "audio"`). 실패는 그 뒤 `select_pd`(`progressive.rs:41`)에서 난다. 옛 `pd_reps`에 `"audio"`가 없어 `QualityNotFound`가 된다. 이 오류는 `is_resumable() == true`라(`crates/core/src/error.rs:180-210` [확인]) 실패 정리가 `.part`를 지우지 않고 checkpoint한다(`download/mod.rs:438-449`). `keep_partial`(`:220-226`)은 `resolve` 자체의 실패에만 쓰이고 여기에는 해당하지 않는다.
  - 다시 새 앱으로 올리면 이어받는다. 받아들일 만하다고 본다.
  - 옛 앱이 jobs.json을 다시 써도 `quality_id`·`output`·`quality_label`("오디오만")은 그대로라 아무것도 잃지 않는다.
- **설정**: 바꾸는 필드가 없다. 오디오 라벨이 `last_quality_label`에 들어가지 않는다(A8). 그 전 빌드에서 들어갈 경로도 없었다.
- **`.part` sidecar**: v1 progressive 그대로다. 옛 앱은 `quality_id = "audio"`인 sidecar를 자기 작업으로 보지 않는다(`same_job`이 다르다).
- **이미 받은 mp4**: 바뀌는 것이 없다. 비디오 PD의 이름·경로·마무리는 같다.

## 9. 비밀값

- 오디오 BaseURL은 서명 쿼리를 품는다. 다음 경로로만 다룬다.
  - `Representation`의 손으로 쓴 `Debug`(`mpd.rs:36-59`, `redact_url`)
  - `PdRep`의 `Debug`(`model.rs:118-125`)
  - 오류 문구에 원문을 넣지 않는 `audio_rep`(§4.1)
  
  새 타입은 만들지 않는다. `codecs` 필드는 비밀이 아니다.
- 미디어 GET 로그는 `media_get`의 `redact_url`을 지난다(`client.rs:236`).
- 테스트 fixture의 서명 값은 가짜(`_lsu_sa_=0000`)다. Debug 출력에 서명 쿼리가 없는지 단언하는 테스트를 오디오 rep에도 하나 더한다.

## 10. 테스트(구현 PR이 더할 것)

모두 오프라인이다. 파서 규칙은 합성 fixture로 고정한다.

**코어**
- **fixture**: `gen-fixtures.mjs`를 고쳐 `--check`로 확인한다.
  - `audioRep`에 `audioSamplingRate`를 더한다. 실물 모양에 맞춘다.
  - 오디오 set이 없는 일반 VOD MPD(`testdata/vod/playback_noaudio.mpd`)를 더한다.
  - 오디오 rep이 둘인 MPD를 더한다(A4).
  - 합성 CMAF 오디오 파일 `testdata/vod/audio_cmaf.m4a`를 만든다. 구조는 `ftyp` → `moov`(trak 1, `soun`, `mvex`·`trex`) → `sidx` → (`moof`+`mdat`) × 3이다. 평탄화 golden `testdata/vod/audio_cmaf_flat.m4a`는 **생성기가 아니라 코어가 만든 정적 바이너리**다(`hls/full2_flat.mp4`와 같은 방식, `UPDATE_AUDIO_GOLDEN=1`). JS가 defrag를 다시 구현하면 같은 코드를 두 번 믿는 셈이라서다. 바이트 비교와 함께 구조(`moof`·`sidx` 없음, 트랙 1, 샘플 12, `stss` 없음, 미디어 데이터 순서 보존)를 단정한다.
- **`mpd`**:
  - VOD fixture에서 `audio_rep`이 하나이고, `id == "audio"`, `bandwidth` 128000, `audio_only`이다.
  - 오디오 set이 없으면 `None`이다.
  - 둘이면 큰 bandwidth를 고른다.
  - `codecs`가 `mp4a.`가 아니거나 `ContentProtection`이 있으면 `None`이다.
  - Debug에 서명 쿼리가 없다.
- **`client`**(wiremock):
  - VOD는 화질 끝에 오디오가 붙는다.
  - **클립은 fixture에 오디오 set이 있어도 오디오가 없다**(A3).
  - 비디오 PD가 없고 오디오만 있으면 `NoQualities`다.
- **`model`**: `default_quality_index`가 마지막 라벨 `"audio"`여도 오디오를 고르지 않는다.
- **`naming`**:
  - `output_path(.., M4a, ..)`는 `.m4a`를 붙이고 200바이트로 자른다(세 OS).
  - `"x.mp4"` 입력 + M4a면 `x.mp4.m4a`다. 지금 규칙의 연장이고, UI는 확장자 없는 이름만 보낸다.
  - `is_audio_output`
- **`download`(통합, `tests/progressive.rs` 패턴)**:
  1. 오디오를 끝까지 받으면 마무리 결과가 golden 평탄화 파일과 바이트 단위로 같다.
  2. 중간에 끊고 이어받으면 Range를 요청하고, 결과가 같다.
  3. 403 → 재조회 → 같은 `"audio"`의 새 주소로 이어받는다.
  4. **평탄화 뒤 `finalize`가 `TargetExists`로 끝나 `.part`가 남은 상태에서 다시 실행하면, 미디어 요청 없이 완료(AlreadyFlat)된다.** A7을 빼면 이 테스트가 실패하는지 확인한다.
  5. 평탄화 3단계 도중 끊긴 파일을 다시 실행하면 요청 없이 같은 결과로 다시 변환된다. `DefragFile` 실패 주입 seam(`defrag.rs:78`)은 defrag 단위 시험(`defrag/tests.rs`의 `crash_during_patches_then_resume_truncation_reconverts_identically`·`patch_failure_is_modified_and_reconverts_after_truncate`)이 이미 고정한다. 오디오 통합 시험(`tests/audio.rs::interrupted_flatten_is_redone_from_committed_length`)은 엔진을 통해 오디오 단일 트랙 + `sidx` 입력의 모든 끊김 지점(패치 0~5개 + 끝에 붙인 `moov`)을 만들어 A7 경로(`written >= total_len` → 요청 없이 `finish`)에서 golden과 같은 결과가 나옴을 고정한다.
  6. 화질·확장자 불일치(`"audio"` + `.mp4`, PD id + `.m4a`)는 `Unsupported::AudioOutputMismatch`이고 같은 경로의 다른 `.part`를 지우지 않는다.
  7. 비디오 PD는 지금처럼 평탄화하지 않는다(`converts_on_finish` 표 테스트 갱신).
- **`defrag` 단위**: 오디오 단일 트랙 + `sidx` 입력이 `Converted { tracks: 1 }`이고, 결과에 `stss`가 없다.

**셸**
- `check_output`:
  - `quality_id = "audio"`면 `.m4a` 경로와 `.m4a` 기준 충돌·번호 이름이 나온다.
  - 같은 이름의 `.mp4`가 있어도 충돌이 아니다.
- `enqueue`:
  - 오디오 + `save_chat`은 `invalidInput`이다.
  - 오디오 + 구간은 `invalidInput`이다(기존 검사가 막는지 확인).
  - 오디오 + 클립 content는 `invalidInput`이다.
  - 오디오 받기 뒤 `last_quality_label`이 바뀌지 않는다.
- `JobDto.audio_only`가 `quality_id`로 계산된다. 옛 jobs.json 레코드(필드 없음)는 그대로 읽힌다.
- 바인딩 테스트.

**앱**
- vitest:
  - `bestQualityIndex`가 오디오를 뺀다.
  - `fileExt`
  - `qualityText`의 오디오
  - `buildEnqueueRequest`의 라벨
  - `QualityPicker`가 오디오 행에 "오디오만"과 크기를 보이고 꼬리표를 달지 않는다.
- 가짜 백엔드:
  - `app/e2e/mock/backend.ts`와 `app/e2e/fixtures.ts`·`app/src/test/fixtures.ts`의 일반 VOD에 오디오 화질을 더한다.
  - `check_output`의 확장자 규칙도 셸과 같게 흉내 낸다.
- Playwright: 일반 VOD 카드에서 "오디오만"을 고르면 이름 칸 확장자가 `.m4a`가 되고, [받기] 뒤 작업 행에 "오디오만"이 보인다. 클립·빠른 다시보기 카드에는 이 행이 없다.
- `design-shots` 갤러리의 화질 목록 기준선이 바뀐다. Linux CI artifact를 `shots.mjs --accept`로 받는다.

## 11. 구현 단계

### 11.1 PR 표
| PR | 내용 | 커밋 타입 |
|---|---|---|
| A-1 코어 | §4 전부, 코어 테스트·fixture, core.md "구현 중 변경". 셸이 아직 오디오 화질을 거르지 않으므로 이 PR만 머지되면 카드에 "audio" 행이 보인다. 그래서 **A-2·A-3과 같은 릴리스에 묶거나 한 PR로 낸다** | `feat` |
| A-2 셸 | §5, 바인딩, 셸 테스트, app.md "구현 중 변경" | `feat` |
| A-3 앱 | §6, copy deck·용어집·patterns, 가짜 백엔드·Playwright, 갤러리 기준선 | `feat` |

A-1~A-3은 하나의 stacked 묶음이다. 한 브랜치(`feat/audio-only`)에서 단계마다 커밋한다. 데이터·계약·인증·릴리스를 건드리지 않으므로 Codex 리뷰는 필수가 아니다(memory "Codex 리뷰 범위"). 다만 A7(이어받기 경계)은 리뷰 때 따로 본다.

### 11.2 gate
`fmt`, `rust`, `tauri-clippy`, `tauri`, `frontend`, `design-tokens`(design-copy 포함), `scripts-test`, `scan`, `e2e-web`. fixture를 바꾸면 `node scripts/fixtures/gen-fixtures.mjs --check`도 돌린다.

### 11.3 미머지 PR과 겹치는 곳
- **#166 파일 이름 템플릿**: `naming::default_filename`·`output_path`와 셸 `output.rs`를 건드린다. 머지 순서와 관계없이 규칙은 하나다. "확장자는 템플릿 밖에서 `MediaExt`로 붙인다". 템플릿 결과는 확장자 없는 기본 이름이다. 나중에 머지되는 쪽이 `output_path`의 `ext` 인자를 맞춘다.
- **#167 mp4 메타데이터**: 마무리 단계(`finish`)에 메타데이터 쓰기를 더할 가능성이 크다. 오디오에는 이번 범위에서 메타데이터를 넣지 않는다. 그 PR이 먼저 머지되면, 메타데이터를 쓰는 조건에 `quality_id != AUDIO_QUALITY_ID`를 둔다(§12 후속).
  - **구현(master 합친 뒤)**: `download::run`이 `embed_metadata && quality_id != AUDIO_QUALITY_ID`일 때만 태그 재료(`job.tags`)를 만든다. 오디오는 평탄화(defrag)에 `udta`를 넘기지 않고 표지 요청도 보내지 않는다(`tests/audio.rs` `audio_ignores_embed_metadata_and_never_fetches_cover`). 안 넣는 쪽이 작고 안전하다: 넣으려면 m4a용 `ilst` 항목·`covr` 정책이 따로 필요하고, 평탄화가 만드는 새 moov 크기가 달라져 A7 재시작 판정(`written() >= total_len`)과 golden이 모두 바뀐다.
  - **#166 템플릿**: 확장자는 템플릿 밖에서 `MediaExt`로 붙는다. `naming::tests::shown_name_equals_saved_name_for_m4a`가 템플릿 여럿·세 종류·세 OS 전수로 "제안 이름 + `.m4a` = 저장 이름"을 고정한다. 알려진 가장자리 하나: 제안 이름이 이미 `.m4a`로 끝나면(제목이 `.m4a`로 끝남) 붙여 넣은 확장자를 받는 규칙 때문에 저장 이름이 `x.m4a`이고 화면은 `x.m4a.m4a`를 보인다.
  - **#165 속도 제한**: 오디오도 `progressive::run` 경로라 `Throttles`가 걸린다(`tests/audio.rs` `audio_download_is_throttled`).

### 11.4 번호 예약
- 구현 PR은 `core.md`·`app.md`의 "구현 중 변경"에 머지 순으로 번호를 붙인다. 구현 때는 core.md 77·app.md 94가 마지막이라 78·95~96을 잡았고, master에 #166·#167이 먼저 머지돼 **core.md 84·app.md 99~100**으로 옮겼다.
- 같은 날 미머지인 #166·#167이 같은 번호를 잡을 수 있다. 겹치면 나중에 머지되는 쪽이 옮긴다.
- 디자인 시스템 D 번호·ADR은 쓰지 않는다. 용어집 행과 문구 전표 행만 더한다.

## 12. 후속(이번 범위 밖, ROADMAP에 남긴다)

- **클립·빠른 다시보기 오디오(리먹스)**: muxed mp4·fMP4에서 비디오 `trak`을 빼고 오디오 트랙만 남긴 m4a를 만든다. defrag의 `moov` 생성기를 재료로 쓸 수 있다. 하지만 일반 mp4(클립 PD)의 원본 표를 다시 쓰는 일은 range.md §1.2가 미룬 일과 같은 규모다(**가정**). 다시 여는 조건은 사용자 요청이다.
- **m4a 메타데이터**: #167이 머지된 뒤 같은 상자(`udta`/`ilst`)를 m4a에도 쓸지 정한다. 음악 앱이 보이는 표지(`covr`)도 함께 정한다.
- **오디오 set이 없는 일반 VOD의 이유**: 실측 5건 중 1건이다. 공개 시점·인코딩 세대와 관련 있는지 범주로만 관찰한다.

## 13. 실측 필요

| ID | 무엇 | 누가 | 통과 기준 |
|---|---|---|---|
| M-A1 | 평탄화한 m4a를 macOS QuickTime·음악 앱, Windows 미디어 플레이어, VLC에서 처음부터 끝까지 재생하고 중간으로 탐색 | 사용자(본인 영상) | 넷 모두 재생·탐색된다. 하나라도 안 되면 결과를 범주로 적고 A6을 다시 본다 |
| M-A2 | 긴 일반 VOD(1시간 이상)의 오디오 받기 도중 일시정지·앱 종료 → 이어받기, 서명 만료 뒤 이어받기 | 사용자 | 완료되고 M-A1을 통과한다 |
| M-A3 | 오디오 rep의 재생 길이와 영상 길이(`duration_secs`)가 맞는지 | 사용자 | 1초 이내(**가정**: 같은 원본에서 나왔다) |

결과는 범주(된다/안 된다)만 `docs/ROADMAP.md`에 적는다.
