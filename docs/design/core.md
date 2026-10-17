# crates/core 설계 (Phase 1, 확정안)

세 설계안(fidelity / robustness / consumer)과 AES 조사 보고를 대조해 판정한 최종 설계다. 기준 문서는 `docs/ROADMAP.md`, `docs/spec/core-behavior.md`(이하 spec), `docs/research/stack.md`, `docs/research/chzzk-oauth.md`다. fixture는 `testdata/`의 합성 파일이다(`testdata/README.md`). 본문의 "research §n"은 비공개 사전 조사 기록을 가리키며 공개 저장소에는 없다.

## 0. 판정 요약

- **베이스는 fidelity 안**이다. 모듈 수가 기능 수와 맞고, trait 없이 mock 서버로 테스트하며, spec §8의 테스트를 1:1로 매핑했다.
- robustness 안에서 가져온 것: 크래시 일관성 불변식(`sync_data` → sidecar 원자적 쓰기, 재개 시 `committed_len`으로 truncate), 재조회 후 playlist 지문 검증(세그먼트 수 + EXTINF crc32 + init 길이), "갱신 직후 같은 요청이 다시 403이면 즉시 실패", `.part`는 상태 코드 확인 뒤에만 생성, Windows rename 재시도, 디스크 부족 `io::Error` 매핑, `std::fs::File::try_lock`으로 이중 다운로드 방지, `Secret` 마스킹, `Error::is_resumable()`.
- consumer 안에서 가져온 것: 직렬화 가능한 `ErrorKind`(UI 분기용), `ownership::is_own_content`(Phase 3 seam), `MediaPlaylist.init: Option<Url>`(AES/TS 대비 최소 seam), 레거시 `lastQualityName`의 `^(\d+)P_` → `"{n}p"` 변환.
- 버린 것(현재 기능에 불필요): 다운로드 큐·JobId·상태 머신·history.json(consumer), `SourceResolver`/`CredentialStore`/`SegmentTransform` trait·offline grace·`fs4` 사전 디스크 점검·EWMA·64 MiB playlist 상한(robustness), `ConflictPolicy::Ask/Rename`, `keyring`/`directories` optional feature. 큐와 Ask는 Phase 2 셸에서 필요해지면 코어 `download()` 위에 얹는다.

### 판정 중 실측으로 확인한 것 (2026-10-05)

| 주장 | 결과 |
|---|---|
| AES VOD에도 `inKey`가 있다 → `encryptionType`을 먼저 봐야 한다 | **확인**. AES 표본에 `encryptionType:"AES"`와 `inKey`가 함께 있었다 |
| 비성인 PD mp4는 쿠키 없이 받아진다 | **확인**. 공개 VOD 표본의 PD URL이 쿠키·Referer 없이 `HEAD` 200, `Range: bytes=0-99` 206. 미디어 호스트는 클립과 다르다. 성인 VOD는 미확인 |
| 일반 VOD MPD 구조(research §10) | **확인**. 같은 구조로 합성 fixture `testdata/vod/`를 만들었다: `video/mp4`(PD_144P, PD_720P) + `video/mp2t`(UUID) + `audio/mp4`. `ContentProtection` 없음 |
| reqwest 0.13.5에 `read_timeout`, `no_gzip`, `pool_max_idle_per_host`가 있다 | **확인**(docs.rs). feature 이름은 `rustls`, `stream`, `json`, `gzip` |
| crate 최신 안정판 | reqwest 0.13.5, tokio 1.53.2, tokio-util 0.7.19, futures-util 0.3.34, bytes 1.12.1, url 2.5.8, serde 1.0.229, serde_json 1.0.151, roxmltree 0.21.1, thiserror 2.0.21, tracing 0.1.44, wiremock 0.6.5, tempfile 3.27.0, crc32fast 1.5.2 |

### 점수 (5점 만점)

| 기준 | fidelity | robustness | consumer |
|---|---|---|---|
| spec 정합성(테스트 매핑, 버그 수정 반영) | 5 | 4 | 4 |
| 견고성(장시간 다운로드, 크래시, 토큰 만료) | 3 | 5 | 4 |
| 소비자(Tauri 셸) 적합성 | 3 | 3 | 5 |
| 단순성(현재 기능 대비) | 5 | 2 | 2 |
| 테스트 용이성(오프라인, trait 없이) | 5 | 4 | 3 |
| **합** | **21** | **18** | **18** |

---

## 1. 결정 (각 한 줄 근거)

1. **package 이름은 `chzzk-core`**(lib `chzzk_core`, 디렉토리 `crates/core`). `core`는 내장 crate와 겹친다. `cargo test -p chzzk-core`.
2. **워크스페이스**: 루트 `Cargo.toml`, `resolver = "3"`, `edition = "2024"`, `rust-version = "1.90"`(Tauri 2.12 기준, 로컬 1.96.1). 지금 멤버는 `crates/core`뿐이고 `app/src-tauri`는 Phase 2에 추가한다.
3. **Tauri 의존 없음**. 진행률은 `&dyn Fn(Progress)` 콜백, 취소는 `tokio_util::sync::CancellationToken`. 셸이 Channel로 브리지한다.
4. **`inKey` 분기는 순수 함수 `classify` 한 곳**. `encryptionType` → `inKey` → `liveRewindPlaybackJson` 순서. AES VOD에도 `inKey`가 있으므로 순서가 중요하다(실측).
5. **AES seam은 `Playback::Encrypted` 하나**. `resolve`의 match arm이 `Err(Error::EncryptedVod)`를 낸다. 지원 여부는 사용자 결정(§11). 2차 방어로 MPD `ContentProtection`과 playlist `EXT-X-KEY`(METHOD≠NONE)도 거부한다.
6. **화질 선택은 정확 일치**(`Quality.id`). 숫자열 추출은 없다. `label`(`"{resolution}p"`)은 표시·마지막 화질 기억에만 쓴다. 소스 종류가 바뀌면 `PlaybackChanged`로 멈추고 사용자가 다시 고른다.
7. **HTTP 클라이언트 하나, 압축 해제 없음**(`gzip` feature 미사용). 자동 해제는 `Content-Length`와 Range offset을 깨뜨린다. API JSON은 작다.
8. **쿠키는 API 요청에만**, `cfg.cookies`가 `Some`일 때만. 미디어에는 보내지 않는다(HLS는 research §7, PD는 이번 실측). 성인 PD가 틀리면 `cookies_on_media` 스위치로 되돌린다.
9. **헤더는 요청 종류(`RequestKind`)로 정한다**. 호스트로 정하지 않는다. 그래야 127.0.0.1 mock으로 검증된다.
10. **`.part` + sidecar(`.part.json`)로 이어받기**. progressive는 Range, HLS는 같은 index부터. 실패·취소 시 둘 다 남긴다. 이어받을 수 없는 오류만 지운다.
11. **크래시 불변식**: sidecar의 `committed_len`은 항상 durable한 바이트 수 이하. 순서는 `flush` → `sync_data` → sidecar 원자적 쓰기. 재개 시 `.part`를 `committed_len`으로 truncate.
12. **403 처리**: 미디어 403은 `Expired`로 보고 `resolve`를 다시 한다. 재조회 직후 같은 요청이 다시 403이면 `AuthRequired`로 끝낸다(무한 루프 방지). 작업당 재조회 상한은 8회.
13. **재조회 후 동일성 검증**: progressive는 `Content-Range` total, HLS는 `segment_count` + EXTINF(ms) 시퀀스 crc32 + init 길이. 다르면 `SourceChanged`. research §11.2(갱신 후 MSN 유지)는 미관찰이므로 추측으로 이어 붙이지 않는다.
14. **파일명**: `[YYMMDD] 채널 - 제목.mp4`, 클립 `[클립] 채널 - 제목.mp4`. 대괄호·소괄호·중괄호 유지. sanitize는 `Platform` 인자(Windows/MacOs/Linux)로 받아 한 호스트에서 세 OS 규칙을 테스트한다. 길이는 UTF-8 **200바이트**(`.part.json` 접미사 + 한글 3바이트 여유).
15. **설정 위치는 셸이 주입**(`config_dir`, `default_download_dir`). `directories` 미사용. 자격증명은 `credentials.json`(unix 0600). 키체인은 미서명 배포(macOS ACL 프롬프트)와 Linux secret-service 때문에 쓰지 않는다.
16. **레거시 가져오기는 `import_legacy(dir)` 하나**. 새 앱은 옛 exe 위치를 모르므로 첫 실행 때 `current_exe().parent()`를 한 번 살피고, 설정 화면의 "가져오기"가 주 경로다.
17. **HLS 손 파서**(m3u8-rs 미사용). 필요한 태그가 적고 미지원 태그를 명시적으로 거부해야 한다.
18. **테스트는 wiremock + raw TcpListener**. wiremock으로 상태 코드 순서·Range·헤더 기록을 다루고, 본문 절단만 raw TCP로 한다. axum을 dev-dependency로 추가하지 않는다.

---

## 2. 모듈 트리

```
Cargo.toml                      # [workspace] resolver="3", members=["crates/core"]
                                # [workspace.package] edition="2024", rust-version="1.90"
crates/core/
  Cargo.toml                    # package "chzzk-core"
  src/
    lib.rs                      # 재노출
    error.rs                    # Error, ErrorKind, Unsupported
    url.rs                      # parse_content_url
    model.rs                    # ContentRef, ContentKind, ContentMeta, Quality, PlaybackKind, Source, PdRep, Resolved
    info.rs                     # 순수: VideoContent, ClipContent, parse_video_info, parse_clip_info, classify  ← 유일한 inKey 분기
    mpd.rs                      # 순수: parse_mpd(roxmltree, local-name), pd_reps, has_content_protection
    hls.rs                      # 순수: parse_master, parse_media, Variant, MediaPlaylist, Segment
    http.rs                     # build_client, RequestKind, 헤더, UA 상수, NaverCookies(Secret), redact_url
    client.rs                   # Endpoints, ClientConfig, Chzzk { resolve(), download() }
    ownership.rs                # is_own_content
    download/
      mod.rs                    # download 진입점: DuplicatePolicy, 사전 검사, 재조회 루프, finalize
      part.rs                   # PartFile(.part 잠금·append·checkpoint·truncate·finalize), Sidecar(.part.json)
      progressive.rs            # 단일 GET + Range 이어받기
      segmented.rs              # HLS fMP4: init + 순서 보장 동시 fetch
      retry.rs                  # RetryPolicy, Failure{Retry,Expired,Fatal}, classify_failure
    progress.rs                 # Progress, Phase, Meter(스로틀), speed_eta, format_bytes, format_hms
    naming.rs                   # Platform, default_filename, sanitize_filename, output_path, parse_live_date
    fsutil.rs                   # atomic_write, rename_with_retry, map_io_error
    settings.rs                 # UserSettings, RecentVod, SettingsStore, add_recent_vod
    credentials.rs              # CredentialStore(load/save/clear, 0600)
    legacy.rs                   # import_legacy(dir) -> Option<LegacyImport>
  tests/
    common/mod.rs               # fixture 로더, 호스트 재작성, 경로 접미사 응답기, raw TCP 서버
    resolve.rs  progressive.rs  segmented.rs  download.rs  settings.rs
  examples/dl.rs                # 수동 스모크 CLI(실서버). format_bytes/format_hms 소비자
testdata/
  hls/   vod/   (clip/ ← Go 삭제 PR에서 internal/api/testdata 이동)
  synthetic/
    README.md                   # 합성임을 명시
    vod_info_aes.json           # testdata/vod/video_info.json에 encryptionType:"AES"만 추가
    media_{discontinuity,two_maps,key_aes,key_none,byterange,no_endlist,long_extinf}.m3u8
```

fixture 경로는 `concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/...")`와 `"/../../internal/api/testdata/..."`를 `tests/common::fixture(path)` 하나로 읽는다.

---

## 3. 공개 API

### 3.1 URL과 모델

```rust
// url.rs
pub fn parse_content_url(s: &str) -> Result<ContentRef, Error>;
// url crate. host ∈ {"chzzk.naver.com", "m.chzzk.naver.com"}. path 세그먼트:
//   ["video", digits] → Video, ["clips", id] | ["embed","clip", id] → Clip (id: [A-Za-z0-9_-]+)
// 쿼리·fragment 무시, 뒤 '/' 허용. 그 밖은 Error::InvalidUrl.

// model.rs
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ContentRef { Video { video_no: u64 }, Clip { clip_id: String } }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ContentKind { Video, Clip }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentMeta {
    pub kind: ContentKind,
    pub title: String,                 // trim
    pub channel_name: String,
    pub channel_id: Option<String>,    // VOD content.channel.channelId / 클립 ownerChannel.channelId, 소문자화
    pub live_open_date: Option<String>,// "YYYY-MM-DD HH:MM:SS" (KST 문자열 그대로)
    pub publish_date: Option<String>,  // 파일명 날짜 폴백
    pub adult: bool,
    pub duration_secs: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quality {
    pub id: String,                // 정확 일치 키: DASH rep@id("PD_720P_1280_2048_192") / HLS encodingTrackId("720p")
    pub label: String,             // 표시·last 선택용: "{resolution}p", 없으면 id
    pub resolution: Option<u32>,   // DASH Label[kind=resolution] / HLS videoHeight (짧은 변)
    pub width: Option<u32>, pub height: Option<u32>,
    pub bandwidth: Option<u64>,
    pub frame_rate: Option<String>,// 실물이 문자열("60.0", "30")
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlaybackKind { Progressive, LiveRewindHls }

pub struct PdRep { pub quality: Quality, pub url: Url }
pub enum Source {
    Progressive { reps: Vec<PdRep> },                        // PD 필터 통과분만
    LiveRewindHls { master_url: Url, tracks: Vec<Quality> },
}
pub struct Resolved { pub content: ContentRef, pub meta: ContentMeta, pub source: Source }
impl Resolved {
    pub fn kind(&self) -> PlaybackKind;
    pub fn qualities(&self) -> Vec<&Quality>;               // 원래 순서(정렬하지 않음)
    pub fn default_quality(&self, last_label: Option<&str>) -> usize;
    //   last_label == label인 첫 항목 → 없으면 resolution.or(height) 최대(같으면 앞) → 없으면 0
}
```

### 3.2 순수 파서

```rust
// info.rs
pub struct VideoContent { /* serde: 문자열은 전부 Option<String>, None == "" (spec §3.1) */ }
pub enum Playback {
    Dash { video_id: String, in_key: String },
    LiveRewind { master_url: Url, tracks: Vec<Quality> },
    Encrypted { method: String, video_id: String, in_key: Option<String> },   // AES seam
}
pub fn parse_video_info(body: &[u8]) -> Result<(ContentMeta, VideoContent), Error>; // code != 200 → Error::Api
pub fn classify(v: &VideoContent) -> Result<Playback, Error>;
//   1) encryptionType 비어 있지 않음 → Encrypted (MPD를 받지 않는다)
//   2) inKey 비어 있지 않음 → Dash (videoId 비면 Error::Parse)
//   3) liveRewindPlaybackJson 이중 디코드 → media 중 protocol=="HLS"인 첫 항목 → LiveRewind
//        tracks: encodingTrack 순서 그대로. videoBitRate/videoWidth/videoHeight는 Option<u64>/<u32>, videoFrameRate는 Option<String>
//   4) 그 밖 → Error::NoPlayback { adult }
pub fn parse_clip_info(body: &[u8]) -> Result<(ContentMeta, Playback /* 항상 Dash */), Error>;
//   videoId/inKey 비면 Error::Parse. channel_id는 ownerChannel.channelId

// mpd.rs
pub struct Representation { pub id: String, pub mime: String, pub bandwidth: Option<u64>,
    pub width: Option<u32>, pub height: Option<u32>, pub frame_rate: Option<String>,
    pub labels: Vec<(String, String)>, pub base_urls: Vec<String>, pub protected: bool }
pub fn parse_mpd(xml: &str) -> Result<Vec<Representation>, Error>;  // 모든 Period/AdaptationSet, local-name 매칭
//   AdaptationSet@mimeType을 Representation으로 상속. ContentProtection(AdaptationSet/Representation)이 있으면 protected=true
pub fn pd_reps(reps: &[Representation]) -> Result<Vec<PdRep>, Error>;
//   mime ∋ "video/mp4" && id ^= "PD_" && base_urls[0] ∋ "/pd/" && !protected. 비면 Error::NoQualities
//   Quality.label = Label[kind=resolution]+"p" (없으면 id), resolution = 그 값

// hls.rs
pub struct Variant { pub uri: Url, pub track_id: String /* 첫 path 세그먼트 */, pub height: Option<u32> }
pub struct MediaPlaylist { pub media_sequence: u64, pub init: Option<Url>, pub segments: Vec<Segment>, pub total_duration_ms: u64 }
pub struct Segment { pub msn: u64, pub duration_ms: u32, pub uri: Url }
pub fn parse_master(text: &str, base: &Url) -> Result<Vec<Variant>, Error>;
pub fn parse_media(text: &str, base: &Url) -> Result<MediaPlaylist, Error>;
//   허용: 빈 줄, PDT, DATERANGE, 모르는 #EXT 태그(경고 로그), KEY:METHOD=NONE, EXTINF > TARGETDURATION
//   거부(Error::Unsupported): DISCONTINUITY, 두 번째 MAP, KEY(METHOD≠NONE → Unsupported::Encrypted(method)), BYTERANGE, ENDLIST 없음
//   init은 Option(fMP4면 Some). MAP URI의 쿼리(?type=hls&filetype=.m4s) 보존. master의 hdnts 쿼리는 전파하지 않는다
pub fn durations_crc(p: &MediaPlaylist) -> u32;   // EXTINF ms 시퀀스의 crc32 (sidecar 지문)
```

### 3.3 클라이언트

```rust
// http.rs
pub enum RequestKind { Api, Mpd, Media }
pub struct NaverCookies { pub nid_aut: Secret<String>, pub nid_ses: Secret<String> } // Debug/Display = "***"
pub fn user_agent() -> &'static str;   // cfg!(target_os): Windows NT 10.0 / Macintosh / X11 Linux. Chrome major 상수 하나
pub fn redact_url(u: &Url) -> String;  // 쿼리 제거 + 경로의 "hdntl=..." 세그먼트를 "hdntl=***"로

// client.rs
pub struct Endpoints { pub chzzk_api: Url /* https://api.chzzk.naver.com/ */, pub vodplay_api: Url /* https://apis.naver.com/ */ }
pub struct ClientConfig {
    pub endpoints: Endpoints,
    pub cookies: Option<NaverCookies>,   // 사용자가 켰고 값이 있을 때만 Some (spec §9.1-11)
    pub cookies_on_media: bool,          // 기본 false. 성인 PD 실측 후 필요하면 true
    pub retry: RetryPolicy,
    pub progress_interval: Duration,     // 기본 200ms, 테스트 0
    pub connect_timeout: Duration,       // 10s
    pub read_timeout: Duration,          // 30s (idle). 전체 timeout은 두지 않는다
}
pub struct Chzzk { /* reqwest::Client, ClientConfig */ }
impl Chzzk {
    pub fn new(cfg: ClientConfig) -> Result<Self, Error>;
    pub async fn resolve(&self, c: &ContentRef) -> Result<Resolved, Error>;
    pub async fn download(&self, req: DownloadRequest, cancel: CancellationToken,
                          on_progress: &(dyn Fn(Progress) + Send + Sync)) -> Result<DownloadOutcome, Error>;
}
```

헤더 정책(요청 종류 기준):

| RequestKind | 헤더 |
|---|---|
| `Api` | UA, `Referer: https://chzzk.naver.com/`, `Origin: https://chzzk.naver.com`, `Accept: application/json, */*`, `Cookie`(cookies가 Some일 때, `NID_AUT=..; NID_SES=..` 고정 순서) |
| `Mpd` | `Api`와 같되 `Accept: application/dash+xml, application/xml, */*` |
| `Media` | UA, Referer. `Cookie`는 `cookies_on_media`일 때만 |

상태 코드: `Api`/`Mpd`는 2xx가 아니면 `HttpStatus`, 401/403은 `AuthRequired`. 그다음 JSON `code`를 본다. `Media`의 403은 공개 오류가 아니라 내부 `Failure::Expired`다.

### 3.4 다운로드

```rust
// download/mod.rs
pub enum DuplicatePolicy { Overwrite, Skip }     // spec §6.3. 최종 파일에만 적용. .part는 자동 처리
pub struct DownloadRequest {
    pub content: ContentRef,
    pub quality_id: String,
    pub expected_kind: PlaybackKind,  // 목록을 보여 줄 때의 종류. 재조회 결과가 다르면 PlaybackChanged
    pub output: PathBuf,              // 최종 경로(naming::output_path). 부모 디렉토리는 코어가 만든다
    pub on_existing: DuplicatePolicy,
    pub concurrency: NonZeroU8,       // HLS, 기본 4, 상한 8
}
pub enum DownloadOutcome {
    Completed { path: PathBuf, bytes: u64, resumed_from: u64 },
    Skipped { path: PathBuf },
}
pub fn discard_partial(output: &Path) -> Result<(), Error>;   // .part + sidecar 삭제 (UI "처음부터")

// progress.rs
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub phase: Phase,                        // Resolving | Downloading | Reresolving | Finalizing
    pub bytes: u64,                          // .part 누적(이어받은 분 포함)
    pub total_bytes: Option<u64>,            // progressive만
    pub total_bytes_estimate: Option<u64>,   // HLS: bytes / media_done * media_total
    pub segments: Option<(u32, u32)>,        // (완료, 전체) HLS만
    pub media_secs: Option<(f64, f64)>,      // (완료, 전체) HLS만
    pub speed_bps: Option<u64>,              // 이번 실행 바이트 / 경과(최근 5초 창)
    pub eta_secs: Option<u64>,
    pub resumed_from: u64,
    pub refreshes: u32,
}
pub fn speed_eta(written: u64, total: Option<u64>, elapsed: Duration) -> (Option<u64>, Option<u64>); // spec §6.1 규칙
pub fn format_bytes(n: u64) -> String;   // spec §6.1 표
pub fn format_hms(secs: u64) -> String;  // spec §6.6
```

- `Meter`는 `progress_interval`마다 한 번만 콜백한다. phase가 바뀔 때와 마지막에는 무조건 보낸다.
- ETA: progressive는 `(total − written) / speed`. HLS는 `(media_total − media_done) / (미디어초 처리율)`. 세그먼트 수 비율은 쓰지 않는다(마지막 세그먼트가 짧고 크기가 제각각).

### 3.5 파일명·설정·자격증명·소유

```rust
// naming.rs
pub enum Platform { Windows, MacOs, Linux }  impl Platform { pub fn current() -> Self }
pub fn default_filename(meta: &ContentMeta, p: Platform) -> String;  // §6
pub fn sanitize_filename(name: &str, p: Platform) -> String;         // 멱등
pub fn output_path(folder: &Path, filename: &str, p: Platform) -> PathBuf; // 확장자 .mp4 고정(대소문자 무시), __mp4 규칙 폐기
pub fn parse_live_date(raw: &str) -> Option<(u16, u8, u8)>;         // "YYYY-MM-DD[ |T]..." 자릿수 검증, panic 없음

// settings.rs  (키는 camelCase, 모든 필드 #[serde(default)], null 배열 → 빈 Vec)
pub struct UserSettings {
    pub schema_version: u32,                 // 2
    pub download_folder: Option<PathBuf>,    // None → 셸이 준 기본값
    pub use_naver_cookies: bool,             // 쿠키 전송의 유일한 스위치
    pub last_quality_label: Option<String>,  // "720p"
    pub last_url: Option<String>,
    pub recent_vods: Vec<RecentVod>,         // 최대 5
    pub segment_concurrency: u8,             // 4
    pub max_parallel_downloads: u8,          // 2 (1~3, 앱 작업 큐. 구현 중 변경 53)
    pub auto_resume_interrupted: bool,       // false (구현 중 변경 53)
    pub imported_from: Option<PathBuf>,
}
pub struct RecentVod { pub url: String, pub title: String }
pub fn add_recent_vod(s: &mut UserSettings, url: &str, title: &str); // 같은 URL 제거 후 맨 앞, 5개, 50자 초과면 47자+"..." (char)
pub struct SettingsStore { /* dir, Mutex<UserSettings> */ }
impl SettingsStore {
    pub fn open(dir: PathBuf) -> Result<Self, Error>;  // 없으면 기본값. 깨졌으면 settings.json.bad-{ts}로 옮기고 기본값
    pub fn get(&self) -> UserSettings;
    pub fn update<F: FnOnce(&mut UserSettings)>(&self, f: F) -> Result<UserSettings, Error>; // lock → f → atomic_write
}

// credentials.rs
pub struct CredentialStore { /* dir */ }   // {dir}/credentials.json, unix 0600
impl CredentialStore { pub fn load(&self) -> Result<Option<NaverCookies>, Error>;
                       pub fn save(&self, c: &NaverCookies) -> Result<(), Error>; pub fn clear(&self) -> Result<(), Error>; }

// legacy.rs
pub struct LegacyImport { pub settings: UserSettings, pub cookies: Option<NaverCookies>, pub warnings: Vec<String> }
pub fn import_legacy(dir: &Path) -> Result<Option<LegacyImport>, Error>; // {dir}/settings.json (+ dependent/cookie.json)

// ownership.rs
pub fn is_own_content(meta: &ContentMeta, my_channel_id: &str) -> Option<bool>; // channel_id 없으면 None. 소문자 정확 일치
```

### 3.6 오류

```rust
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    #[error("치지직 VOD 또는 클립 주소가 아닙니다")]                InvalidUrl,
    #[error("API 오류 {code}: {message:?}")]                         Api { code: i64, message: Option<String> },
    #[error("HTTP {status}")]                                        HttpStatus { status: u16, kind: RequestKind },
    #[error("로그인/성인 인증이 필요합니다 (HTTP {status})")]         AuthRequired { status: u16 },
    #[error("재생 정보가 없습니다")]                                  NoPlayback { adult: bool },
    #[error("암호화된 VOD({method})는 지원하지 않습니다")]             EncryptedVod { method: String },
    #[error("다운로드 가능한 화질이 없습니다")]                       NoQualities,
    #[error("선택한 화질({requested})을 찾을 수 없습니다")]           QualityNotFound { requested: String, available: Vec<String> },
    #[error("재생 방식이 바뀌었습니다. 화질을 다시 고르세요")]         PlaybackChanged { was: PlaybackKind, now: PlaybackKind },
    #[error("원본이 바뀌어 이어받을 수 없습니다: {detail}")]          SourceChanged { detail: String },
    #[error("토큰 갱신 한도를 넘었습니다")]                           RefreshExhausted,
    #[error("지원하지 않는 스트림: {0:?}")]                           Unsupported(Unsupported),
    #[error("응답 형식 오류({what}): {detail}")]                     Parse { what: &'static str, detail: String },
    #[error("길이 불일치: 예상 {expected}, 실제 {actual}")]           LengthMismatch { expected: u64, actual: u64 },
    #[error("네트워크 오류: {0}")]                                    Network(#[source] reqwest::Error),
    #[error("디스크 공간이 부족합니다: {path}")]                      DiskFull { path: PathBuf },
    #[error("다른 프로그램이 파일을 사용 중입니다: {path}")]           FileLocked { path: PathBuf },
    #[error("파일 오류({op}) {path}: {source}")]                     Io { op: &'static str, path: PathBuf, #[source] source: std::io::Error },
    #[error("설정 파일 오류: {0}")]                                   Settings(String),
    #[error("취소됨")]                                                Cancelled,
}
pub enum Unsupported { Discontinuity, SecondMap, Encrypted(String), ByteRange, MissingMap, NotEnded, NoHlsMedia }
#[derive(Serialize, Clone, Copy)] #[serde(rename_all = "camelCase")]
pub enum ErrorKind { InvalidUrl, Api, Http, AuthRequired, NoPlayback, Encrypted, NoQualities, QualityNotFound,
                     PlaybackChanged, SourceChanged, RefreshExhausted, Unsupported, Parse, LengthMismatch,
                     Network, DiskFull, FileLocked, Io, Settings, Cancelled }
impl Error {
    pub fn kind(&self) -> ErrorKind;      // Tauri가 직렬화해 UI가 분기
    pub fn is_resumable(&self) -> bool;   // .part가 남아 있어 같은 요청으로 이어받을 수 있는가
}
```

- `Display`와 `Debug` 어디에도 Cookie 값·`hdnts`·`hdntl` 토큰이 들어가지 않는다. URL은 `redact_url`을 거친다. `reqwest::Error`는 URL을 품으므로 `Network`의 Display는 `without_url()`을 적용한 메시지를 쓴다.
- `is_resumable`: Network, HttpStatus(5xx), RefreshExhausted, Cancelled, DiskFull, FileLocked → true. LengthMismatch, SourceChanged, PlaybackChanged, AuthRequired(미디어 403), 4xx → false(코어가 `.part`를 지운다).

---

## 4. 소스별 데이터 흐름

### 4.1 `resolve` (목록 조회와 다운로드 직전 재조회가 같은 함수)

```
Video: GET {chzzk_api}/service/v2/videos/{no}            [Api]   2xx 검사, 401/403 → AuthRequired
       → parse_video_info → classify
          Dash        → GET {vodplay_api}/neonplayer/vodplay/v2/playback/{videoId}?key={inKey}   [Mpd]
                         → parse_mpd → pd_reps → Source::Progressive            (reps가 비면 NoQualities)
          LiveRewind  → Source::LiveRewindHls { master_url, tracks }          (master는 download 때 받는다)
          Encrypted   → Err(EncryptedVod { method })                           ← AES seam (§11)
Clip:  GET {chzzk_api}/service/v1/play-info/clip/{id}    [Api]   → parse_clip_info → Dash 경로와 동일
```

- `videoId`/`inKey`는 `query_pairs_mut`로 인코딩한다. 관찰된 값은 영숫자뿐이라 결과가 같다.
- 화질 선택은 `Resolved` 안에서 `id` 정확 일치. progressive는 `reps[i].quality.id == quality_id`, HLS는 master variant의 `track_id == quality_id`(없으면 `height == tracks[q].height` 폴백 후 그래도 없으면 `QualityNotFound`).

### 4.2 `download` 공통 골격

1. 최종 파일이 있으면 `Skip` → `Skipped`(네트워크 0회), `Overwrite` → 계속.
2. `.part`와 sidecar를 읽는다. `(content, quality_id, kind)`가 같으면 재개 후보. 다르거나 sidecar가 없으면 둘 다 지우고 새로 시작.
3. `Phase::Resolving`: `resolve`. `kind != expected_kind` → `PlaybackChanged`.
4. 엔진 실행(§5). 403 → `Phase::Reresolving` → 3번으로(동일성 검증 포함, 상한 8회).
5. `Phase::Finalizing`: 마지막 checkpoint → 잠금 해제·핸들 drop → `rename_with_retry(.part → final)` → sidecar 삭제.
6. `Completed { resumed_from }`.

실패·취소 시 `.part`와 sidecar를 남긴다. `is_resumable() == false`인 오류만 둘 다 지운다.

---

## 5. 다운로드 엔진

### 5.1 PartFile과 Sidecar (`download/part.rs`)

```rust
#[derive(Serialize, Deserialize)]
pub struct Sidecar {
    pub v: u8,                               // 1
    pub content: ContentRef, pub quality_id: String, pub kind: PlaybackKind,
    pub committed_len: u64,                  // durable한 바이트 수 (불변식: ≤ 실제 fsync된 길이)
    pub progressive: Option<ProgressiveState>,  // { total_len: u64 }
    pub hls: Option<HlsState>,               // { next_index: u32, segment_count: u32, durations_crc: u32, init_len: u32, media_sequence: u64 }
}
pub struct PartFile { /* File(BufWriter 1 MiB), part, sidecar, final_path, written, committed */ }
impl PartFile {
    pub fn open(final_path: &Path, sidecar: Option<Sidecar>) -> Result<(Self, u64 /* resume offset */), Error>;
    pub fn write(&mut self, buf: &[u8]) -> Result<(), Error>;      // map_io_error: StorageFull/ENOSPC/112/39 → DiskFull
    pub fn checkpoint(&mut self, update: impl FnOnce(&mut Sidecar)) -> Result<(), Error>;
    pub fn finalize(self, dup: DuplicatePolicy) -> Result<Finalized, Error>; // Moved(PathBuf) | TargetExists (구현 중 변경 55)
}
```

- **잠금**: `File::try_lock()`(std, 1.89+)로 `.part`를 배타 잠금. 실패하면 `FileLocked`. Windows는 강제, Unix는 advisory.
- **checkpoint 순서**: `flush` → `sync_data`(`spawn_blocking`) → `committed = written` → `fsutil::atomic_write(sidecar)`(tmp → sync → rename). 주기는 HLS 세그먼트 32개 또는 5초, progressive 64 MiB 또는 5초.
- **재개**: `.part` 길이 > `committed_len`이면 truncate(크래시 꼬리). 작으면 sidecar 불일치로 보고 새로 시작.
- **`.part`는 첫 응답의 상태 코드를 확인한 뒤에만 만든다.** 404면 아무 파일도 남지 않는다.
- **finalize**: 핸들을 닫은 뒤 `rename_with_retry`(100ms부터 약 3초까지 지수 재시도, Windows `ERROR_SHARING_VIOLATION`/`ACCESS_DENIED` 대비). 최종 파일이 열려 있으면 `FileLocked`, `.part` 보존. `std::fs::rename`은 Windows에서도 덮어쓴다. `Skip`은 덮어쓰지 않는 rename이다(구현 중 변경 55).

### 5.2 재시도와 403 (`download/retry.rs`)

```rust
pub struct RetryPolicy { pub max_attempts: u32 /*5*/, pub base: Duration /*500ms*/, pub cap: Duration /*8s*/ }
pub enum Failure { Retry, Expired, Fatal(Error) }
pub fn classify_failure(status: Option<u16>, err: Option<&reqwest::Error>) -> Failure;
```

| 결과 | 판정 |
|---|---|
| 연결 실패, read timeout, reset, 조기 EOF, 5xx, 429 | `Retry` — 지수 백오프(jitter는 `base * 2^n`에 ±25%, std `RandomState` 해시로 충분) |
| 403 (Media) | `Expired` → 재조회 |
| 404, 410, 그 밖의 4xx | `Fatal(HttpStatus)` |

- 재조회 직후 **같은 요청**이 다시 403이면 `AuthRequired { status: 403 }`로 즉시 실패(ACL·지역·성인 제한). 작업당 재조회 상한 8회를 넘기면 `RefreshExhausted`.
- 취소는 모든 await를 `tokio::select!`로 `cancel.cancelled()`와 함께 기다린다. 취소되면 checkpoint 후 `Cancelled`.

### 5.3 progressive (`download/progressive.rs`)

1. `offset = committed_len`. `offset > 0`이면 `Range: bytes={offset}-`.
2. 응답 분기:
   - `206`: `Content-Range: bytes {start}-*/{total}`. `start != offset`이거나 `total != sidecar.total_len` → `SourceChanged`.
   - `200`, `offset == 0`: 정상. `total = Content-Length`를 sidecar에 기록(없으면 `total=None`, ETA 없음).
   - `200`, `offset > 0`: 서버가 Range를 무시. truncate(0) 후 처음부터(`resumed_from = 0`).
   - `416`, `offset == total`: 완료로 finalize. 아니면 `SourceChanged`.
   - `403`: `Expired`. `resolve` → 같은 `quality_id`의 새 URL → Range로 계속.
   - 그 밖: §5.2.
3. `bytes_stream()`을 `select!`로 소비하며 `part.write`. 바이트·시간 기준 checkpoint.
4. 스트림이 끝났을 때 `written != total`이면 `Retry`로 보고 같은 루프에서 Range로 이어 받는다. 재시도 소진 시 `LengthMismatch`(hyper도 조기 EOF를 오류로 내지만 길이 없는 응답까지 막기 위해 명시 검사).
5. PD URL은 약 8시간(MPD `expireTime`)에 만료되므로 긴 VOD에서 403 → 재조회 → Range 재개가 실제로 쓰인다.

### 5.4 HLS fMP4 (`download/segmented.rs`)

1. master GET(`Media`) → `parse_master` → `track_id == quality_id` variant. 없으면 `QualityNotFound`.
2. media GET → `parse_media`. 지문 `(segment_count, durations_crc, media_sequence)`를 계산.
   - 새로 시작: init GET → `part.write` → checkpoint(`next_index=0`, `init_len`, 지문).
   - 재개: sidecar 지문과 비교. 다르면 `SourceChanged`. init 길이가 다르면 `SourceChanged`.
3. `stream::iter(next_index..n).map(fetch_segment).buffered(concurrency)`. `buffered`가 순서를 보장하므로 writer는 단일 루프다. 메모리 상한은 약 `concurrency × 세그먼트 크기`(1080p 2 MB × 8 = 16 MB).
4. 각 세그먼트: 2xx 검사, `Content-Length`가 있으면 길이 일치 검사, 첫 4~8바이트의 box type이 `styp`/`moof`/`sidx` 중 하나인지 검사(CDN의 HTML 오류 페이지 방어; init은 `ftyp`). 통과하면 `part.write` → `next_index += 1` → 주기적 checkpoint. `committed_len`은 항상 세그먼트 경계다.
5. 403: stream을 drop(진행 중 fetch 취소) → `Reresolving` → 1~2단계 재실행(지문 검증) → `next_index`부터 계속. 재조회 직후 같은 세그먼트가 403이면 `AuthRequired`. 재조회 결과 `inKey`가 생겼으면 `PlaybackChanged`.
6. 진행률: `bytes`, `segments=(k, n)`, `media_secs`, `total_bytes_estimate`, `speed_bps`, `eta_secs`.

---

## 6. 파일명 (`naming.rs`)

- **VOD**: `[YYMMDD] {채널} - {제목}.mp4`. 날짜는 `live_open_date` → `publish_date` 순. 둘 다 없으면 `{채널} - {제목}.mp4`. 채널이 비면 `[YYMMDD] {제목}.mp4`.
- **클립**: `[클립] {채널} - {제목}.mp4`. 채널이 비면 `[클립] {제목}.mp4`.
- 제목은 trim. 날짜 파싱은 std로 직접(`YYYY-MM-DD`로 시작, 구분자 공백 또는 `T`, 자릿수 검증).
- **sanitize는 채널과 제목 각각에 적용한 뒤 조립**한다(접두어와 ` - `는 코어가 넣으므로 이중 적용 문제 없음). 사용자가 `file_name`을 직접 줄 때는 전체에 한 번 적용(멱등).
  - 공통: 전각 공백·NBSP → 공백, U+0000–001F·U+007F 제거, 연속 공백 하나로, trim, `/` → `_`, 빈 결과 `_`.
  - Windows: `\ : * ? " < > |` → `_`, 끝의 `.`과 공백 제거, 예약어(`CON PRN AUX NUL COM1-9 LPT1-9`, 확장자 앞 base, 대소문자 무시)면 `_` 접미.
  - macOS: `:` → `_`. Linux: 공통만.
  - `[ ] ( ) { }`는 모든 OS에서 유지(사용자 결정).
- **길이**: `{name}.mp4`를 UTF-8 **200바이트** 이하로. 제목부터 char 경계에서 자르고, 다음 채널. Windows의 UTF-16 255 단위 제한은 UTF-8 200바이트면 자동으로 만족한다(한글은 UTF-8 3바이트·UTF-16 1단위).
- 참고(결정 보류): OS별 규칙이라 macOS에서 만든 `?` 포함 파일을 exFAT/NTFS로 옮기면 실패한다. "항상 Windows 규칙" 설정은 Phase 2에서 필요하면 추가.

---

## 7. 설정·자격증명·마이그레이션

- 파일: `{config_dir}/settings.json`, `{config_dir}/credentials.json`(unix 0600). 쓰기는 모두 `fsutil::atomic_write`(tempfile persist). 쓰기 소유자는 `SettingsStore` 하나(Mutex).
- 깨진 `settings.json`은 `settings.json.bad-{unix_ts}`로 옮기고 기본값으로 계속한다(Go의 "깨지면 이후 저장 불가" 버그 제거).
- `recentVodURLs`는 쓰지 않는다. 레거시 읽기에만 쓴다.
- `last_quality_label`로 통일. HLS `"720p"`와 DASH label `"720p"`가 같은 문자열이라 소스 종류를 넘어 기억이 유지된다.
- **마이그레이션** `import_legacy(dir)`:
  - Go DTO는 전 필드 `#[serde(default)]`, 배열 `null` → 빈 Vec.
  - 쿠키: `dependent/cookie.json`의 `NID_AUT`/`NID_SES` 우선, 없으면 settings의 `nidAut`/`nidSes`. 다른 키는 버린다.
  - `use_naver_cookies = isAdultContent && 쿠키 둘 다 비어 있지 않음`.
  - `recentVods`가 비면 `recentVodURLs`를 `"제목 없음"`으로 채운다.
  - `lastQualityName`: `"720p"`는 그대로, `^(\d+)P_`는 `"{n}p"`, 그 밖은 버린다.
  - `downloadFolder`는 디렉토리가 실재할 때만.
  - 원본은 지우지 않는다. 결과에 `warnings`("옛 파일에 평문 쿠키가 남아 있습니다")를 담는다. 가져오면 `imported_from`을 기록해 다시 묻지 않는다.
  - 호출 경로: (1) 첫 실행(새 settings.json 없음) 때 셸이 `current_exe().parent()`를 한 번 시도, (2) 설정 화면 "이전 버전 설정 가져오기"(폴더 선택).

---

## 8. 테스트 계획

공통 도구(`tests/common`): `fixture(path)`, `rewrite_hosts(bytes, mock_uri)`(합성 fixture의 미디어 호스트 `hls.example.invalid`, `clip.example.invalid`, `vod.example.invalid`를 mock 주소로 치환. 이중 인코딩 JSON 안에서도 단순 replace로 된다), 경로 접미사 응답기(custom `Respond`: HLS 경로에 `*`, `~`, `=`가 있어 접미사 매칭이 필요), raw `TcpListener` 절단 서버, `ZeroRetry`, `progress_interval = 0`.

### 8.1 spec §8 이식 (1:1)

| spec 출처 | 상태 | Rust 테스트 | fixture/mock | 기대값 |
|---|---|---|---|---|
| §8.1 TestIsClipURL (6) | 유지 | `url::clip_detection` | — | true 5건은 `Ok(Clip)`, `/video/1234567`은 `Ok(Video)`, `https://chzzk.naver.com/`과 `""`은 Err |
| §8.1 TestParseClipID (6) | 유지 | `url::clip_id` | — | 6개 그대로 |
| §1.1 golden 5~7행 | **변경**(§9.1-2) | `url::clip_rejects_bad` | — | `embed/clip/`은 Err, `abc#frag`는 `abc`, `evil.com/?chzzk...`은 Err |
| §1.2 | **변경**(§9.1-1) | `url::video_no` | — | `123?t=10`, `123/?t=10`, `123?a=b/c` → 123. `/video/`, `/video/abc` → Err. `m.chzzk.naver.com/video/1` → 1 |
| §3.1/§4.1 | 유지+보강 | `info::live_rewind_fixture` | `hls/video_info.json` | 제목 `테스트 다시보기`, 채널 `테스트채널`, channel_id `000…a1`, live_open_date `2026-01-02 12:00:00`, master path, tracks 5개 encodingTrack 순서(bandwidth u64 `2500000`…, frame_rate `"60.0"`) |
| §3.1 DASH info | **신규** | `info::dash_fixture` | `vod/video_info.json` | `Playback::Dash`, channel_id `000…b2`, 채널 `가상채널` |
| §4.4 classify | 신규 | `info::classify_{dash,aes_precedence,no_playback,inkey_empty_string}` | `synthetic/vod_info_aes.json`, Value 변형 | AES+inKey → Encrypted, inKey `""`와 null은 같음, 셋 다 없으면 NoPlayback |
| §8.1 clip fixture | 신규 | `info::clip_fixtures` | `clip_playinfo.json`, `clip_multi_playinfo.json` | §8.1 끝 기대값(합성 제목) + channel_id `000…c3` |
| §8.1 TestParseClipQualitiesFromMPD | 유지+§5.4 표 | `mpd::clip_pd_qualities` | `clip_multi.mpd` | 2개. label `720p`/`480p`, resolution 720/480, bandwidth/width/height/frameRate 표 전체 |
| §8.1 TestSelectClipBaseURLFromMPD | 유지 | `mpd::select_exact` | `clip_multi.mpd` | `PD_720P_…`는 `/pd/`와 `.mp4` 포함, `PD_NONEXISTENT`는 QualityNotFound, UUID rep는 선택 불가 |
| §5.1 namespace | 신규 | `mpd::nvod_label_localname` | `clip_multi.mpd` | `nvod:Label`을 읽는다 |
| §9.1-3 VOD PD 필터 | **신규** | `mpd::vod_pd_filter` | `vod/playback.mpd` | PD_144P, PD_720P 2개. mp2t/audio UUID rep 제외. `protected == false` |
| AES 2차 방어 | 신규 | `mpd::content_protection_rejected` | `vod/playback.mpd`에 `ContentProtection` 삽입(테스트 코드) | `pd_reps`가 NoQualities |
| §5.6 기본 선택 | **변경**(resolution 기준, label 비교) | `model::default_quality` | 두 fixture | HLS는 4(`1080p`), 클립은 0, `last_label="480p"`면 1, 옛 `720P_1280_…`은 폴백 |
| research §9 master | 신규 | `hls::master_join` | `master.m3u8` | 5개. 144p URI가 `…/144p/hdntl=…/vod_chunklist.m3u8`, `hdnts` 쿼리 없음 |
| research §9 media | 신규 | `hls::media_parse` | `media.m3u8` | 30개, msn 0..29, init `?type=hls&filetype=.m4s` 보존, total 60000ms, `durations_crc` 고정값 |
| research §5 미지원 태그 | 신규 | `hls::rejects_{disc,map2,key_aes,byterange,no_endlist}`, `hls::allows_{key_none,long_extinf}` | `synthetic/media_*.m3u8` | 각 Unsupported / Ok |
| 대형 playlist | 신규 | `hls::large_playlist_30k` | 테스트 코드 생성 30,000개 | 개수·crc, 디버그 1초 이내(느슨) |
| §8.2 ByteIdentity | 유지 | `progressive::byte_identity` | wiremock 140000B | 바이트 동일, `.part`·sidecar 없음, `resumed_from == 0` |
| §8.2 SendsHeaders | **변경**(§4.2) | `resolve::api_headers_cookie_opt_in`, `progressive::media_no_cookie` | wiremock 요청 기록 | API: UA·Referer·Origin·`Cookie: NID_AUT=a; NID_SES=b`. Media: UA·Referer만. `cookies: None`이면 API에도 없음. `cookies_on_media=true`면 Media에도 |
| §8.2 Non200DeletesPartial | 유지 | `progressive::status_404_creates_nothing` | wiremock 404 | HttpStatus, 최종 파일·`.part`·sidecar 없음 |
| §8.2 권장(중간 끊김) | **변경**(남긴다) | `progressive::truncated_body_resumes` | raw TCP 500/1000B 후 wiremock 206 | ZeroRetry면 LengthMismatch가 아니라 `.part` 500B 보존(Network). 재실행 시 `Range: bytes=500-` 후 바이트 동일 |
| §8.2 TestComputeSpeedETA | 유지(숫자화) | `progress::speed_eta_golden` | — | (1MiB,2MiB,1s)→(1048576, 1). elapsed 0→(None,None). total None→eta None. (2048,2048,1s)→eta None |
| §6.1 formatBytes | 유지 | `progress::format_bytes_golden` | — | 8행 |
| §6.6 SecondsToHms | 유지(-1 행 삭제) | `progress::format_hms` | — | 0, 59, 3661, 86399, 360000 |
| §8.3 TestDirectDuplicateChoice | **변경**(정책 enum) | `download::duplicate_{skip,overwrite}` | wiremock | Skip → `Skipped`, 요청 0회. Overwrite → 교체 |
| §8.4 Redact 의도 | 의도 이식 | `http::secrets_never_in_debug_or_error` | — | `format!("{:?}")`(cookies, config), 모든 Error Display, `redact_url`에 `secretAUT`/`hmac=`/`hdntl=exp` 없음 |
| §8.4 ffmpeg/EnsureBinaries 7건 | **삭제** | — | — | — |
| §6.4 FormatLiveDate | **변경** | `naming::parse_live_date` | — | `2024-01-02 12:34:56`, `2024-01-02`, `2024-01-02T12:34:56`→(2024,1,2). `2024/01/02`, `""`, `24-01-02…`→None. fixture `2026-01-02 12:00:00`→`260102` |
| §6.4 SanitizeFilename | **변경**(괄호 유지, OS별) | `naming::sanitize_{windows,macos,linux}` | — | `[2024-01-02] 채널 제목.mp4` 그대로. `x:y*z?"<>\|(){}[]/\.mp4`: Win `x_y_z____(){}[]__.mp4`, Mac `x_y*z?"<>\|(){}[]_\.mp4`, Linux `x:y*z?"<>\|(){}[]_\.mp4`. `CON.mp4`: Win `CON_.mp4`. `제목.  .mp4`: Win `제목.mp4`. 공백·제어문자·빈 값 행 유지 |
| §6.4 fixture 파일명 | **변경**(사용자 결정) | `naming::default_filename_fixtures` | 세 fixture | `[260102] 테스트채널 - 테스트 다시보기.mp4`, `[260101] 가상채널 - 가상 일반 VOD 제목 (괄호) 테스트.mp4`, `[클립] 클립채널 - 테스트 클립 하나.mp4` |
| 길이 제한 | 신규 | `naming::truncate_utf8_200` | — | 한글 긴 제목이 char 경계에서 잘리고 `.mp4` 보존, 채널은 남음 |
| §6.5 PrepareOutputPath | **변경**(§9.1-15) | `naming::output_path` | — | `[x] t`→`[x] t.mp4`, `a/b`→`a_b.mp4`, `T.MP4` 그대로, `t__mp4`→`t__mp4.mp4` |
| §7.2 AddRecentVod | 유지(char) | `settings::recent_vods` | — | 5개 제한, 중복 URL 맨 앞, 한글 51자→47자+`...` |
| §7.2 null 배열·키 누락 | 유지 | `settings::tolerates_go_file` | Go 형식 JSON | 파싱 성공 |
| §7.2 깨진 파일 | **변경** | `settings::corrupt_backed_up` | tempdir | `.bad-*` 생성, 이후 저장 가능 |
| §7.2 레거시 | 유지 | `legacy::import_{fills_title,cookie_json_preferred,quality_label_map,adult_flag}` | tempdir | `"제목 없음"`, 쿠키 우선순위, `720P_1280_…`→`720p`, `use_naver_cookies` 규칙, 원본 보존 |

### 8.2 새 테스트

| 영역 | 테스트 | 입력 |
|---|---|---|
| resolve | `resolve::{live_rewind,dash,clip}` | wiremock info(+MPD). `expected` Source 종류와 qualities |
| resolve | `resolve::aes_rejected_without_mpd` | synthetic AES info → `EncryptedVod`, MPD 요청 0회 |
| resolve | `resolve::api_401_403_auth_required`, `resolve::api_code_not_200` | wiremock |
| progressive | `range_resume_206`, `range_ignored_200_restarts`, `content_range_total_mismatch`, `416_complete` | wiremock Range 핸들러 |
| progressive | `expired_403_reresolves_and_ranges` | MPD 2회(다른 BaseURL), 첫 URL 403 → 같은 offset부터, 바이트 동일, `refreshes == 1` |
| progressive | `forbidden_after_refresh_is_auth` | 영구 403 → `AuthRequired`, `.part` 삭제 |
| progressive | `5xx_then_ok`, `404_no_retry` | `up_to_n_times` |
| segmented | `fixture_concat_box_order` | init/seg0/seg1 응답기 → 출력 == init‖seg0‖seg1, box `ftyp moov styp moof mdat emsg …` |
| segmented | `ordered_with_jitter` | 30개 합성 세그먼트(각 1 KB 고유 바이트, `styp` 헤더), 무작위 지연, concurrency 6 → 순서 일치 |
| segmented | `retry_5xx`, `html_body_rejected` | 503 2회 / 200에 HTML 본문 → Parse 후 재시도 |
| segmented | `expired_resume_same_index` | seg k≥5에서 403, info 2회(path `/g0/`→`/g1/`) → info 2회, seg0~4는 1회씩, 바이트 동일 |
| segmented | `refresh_fingerprint_mismatch` | 재조회 media 세그먼트 수·EXTINF 다름 → `SourceChanged`, `.part` 보존 |
| segmented | `refresh_became_dash` | 재조회 info에 inKey → `PlaybackChanged` |
| segmented | `forbidden_after_refresh`, `refresh_exhausted` | 영구 403 / 8회 초과 |
| segmented | `cancel_then_resume_byte_identical` | seg10 지연 중 cancel → `Cancelled`, sidecar `next_index ≤ 10`. 재실행 시 커밋된 세그먼트 재요청 없음, 바이트 동일 |
| part | `crash_tail_truncated` | `.part`를 `committed_len`보다 길게 만든 뒤 재개 → 완주 |
| part | `incompatible_sidecar_restarts` | quality_id 다른 sidecar |
| part | `double_download_file_locked` | 같은 output으로 동시 2회 → 두 번째 `FileLocked` |
| fsutil | `rename_with_retry`, `map_io_error_storage_full` | 클로저 주입 / `from_raw_os_error(28/112/39)` |
| progress | `throttle_and_final_event`, `eta_by_media_time` | `progress_interval` 0/큰 값 |
| ownership | `is_own_content` | fixture channel_id, 대소문자, None |
| credentials | `unix_mode_0600` | `#[cfg(unix)]` |

CI(`.github/workflows/core.yml`): `ubuntu-22.04`, `macos-latest`, `windows-latest` × `cargo fmt --check`, `cargo clippy -p chzzk-core -- -D warnings`, `cargo test -p chzzk-core`. 모두 오프라인. 실서버 스모크는 `examples/dl.rs`와 `#[ignore]` 테스트(`CHZZK_LIVE_VIDEO` 환경 변수)로만 한다.

---

## 9. 의존성 (crates.io 2026-10-05 확인)

```toml
[workspace.package]
edition = "2024"
rust-version = "1.90"

[dependencies]
reqwest      = { version = "0.13.5", default-features = false, features = ["rustls", "stream", "json"] }  # gzip 없음
tokio        = { version = "1.53.2", features = ["rt-multi-thread", "macros", "fs", "io-util", "sync", "time"] }
tokio-util   = "0.7.19"      # CancellationToken
futures-util = "0.3.34"      # buffered, bytes_stream
bytes        = "1.12.1"
url          = "2.5.8"
serde        = { version = "1.0.229", features = ["derive"] }
serde_json   = "1.0.151"
roxmltree    = "0.21.1"
thiserror    = "2.0.21"
tracing      = "0.1.44"
crc32fast    = "1.5.2"       # sidecar 지문
tempfile     = "3.27.0"      # atomic_write (persist)

[dev-dependencies]
wiremock = "0.6.5"
tokio    = { version = "1.53.2", features = ["net", "test-util"] }
```

쓰지 않는 것: `m3u8-rs`(손 파서), `chrono`(날짜 형식 하나), `directories`/`keyring`(셸 주입·파일 저장), `axum`(wiremock으로 충분), `fs4`(사전 디스크 점검 불필요), `fastrand`(jitter는 std 해시), `anyhow`, `async-trait`. `reqwest`의 `rustls` feature가 TLS provider를 포함하는지는 `cargo add` 후 `cargo tree -e features`로 확인하고, 아니면 `rustls` + 기본 provider 조합을 고정한다.

---

## 10. 구현 순서 (작은 커밋, 각 커밋은 해당 테스트와 함께)

| # | 커밋 | 파일 | 통과해야 할 테스트 |
|---|---|---|---|
| 1 | workspace 골격 | `Cargo.toml`, `crates/core/{Cargo.toml,src/lib.rs,src/error.rs}`, `.github/workflows/core.yml` | `cargo test -p chzzk-core`(빈), 3 OS CI 녹색 |
| 2 | 순수 포맷 | `progress.rs`(format_bytes, format_hms, speed_eta) | `progress::{format_bytes_golden,format_hms,speed_eta_golden}` |
| 3 | 파일명 | `naming.rs` | `naming::{parse_live_date,sanitize_*,default_filename_fixtures,truncate_utf8_200,output_path}` |
| 4 | URL | `url.rs`, `model.rs`(ContentRef) | `url::*` |
| 5 | info 파서 | `model.rs`, `info.rs`, `testdata/synthetic/vod_info_aes.json` | `info::*`, `model::default_quality`(HLS) |
| 6 | MPD | `mpd.rs` | `mpd::*`, `model::default_quality`(클립), `ownership::is_own_content` |
| 7 | HLS 파서 | `hls.rs`, `testdata/synthetic/media_*.m3u8` | `hls::*` |
| 8 | HTTP + resolve | `http.rs`, `client.rs`(resolve만), `tests/common`, `tests/resolve.rs` | `resolve::*`, `http::secrets_never_in_debug_or_error` |
| 9 | 파일 기반 | `fsutil.rs`, `download/part.rs`, `download/retry.rs` | `fsutil::*`, `part::{crash_tail_truncated,incompatible_sidecar_restarts,double_download_file_locked}` |
| 10 | progressive | `download/progressive.rs`, `download/mod.rs`(골격), `tests/progressive.rs` | `progressive::*`, `download::duplicate_*` |
| 11 | segmented (순차) | `download/segmented.rs` concurrency 1, `tests/segmented.rs` | `fixture_concat_box_order`, `html_body_rejected`, `cancel_then_resume_byte_identical` |
| 12 | segmented (동시·재조회) | `download/segmented.rs` buffered(N) + 403 루프 | `ordered_with_jitter`, `retry_5xx`, `expired_resume_same_index`, `refresh_*`, `forbidden_after_refresh` |
| 13 | 진행률 연결 | `progress.rs`(Meter), `download/mod.rs`(phase·콜백) | `progress::{throttle_and_final_event,eta_by_media_time}` |
| 14 | 설정·자격증명·레거시 | `settings.rs`, `credentials.rs`, `legacy.rs`, `tests/settings.rs` | `settings::*`, `legacy::*`, `credentials::unix_mode_0600` |
| 15 | 스모크·문서 | `examples/dl.rs`, `#[ignore]` 실서버 테스트, `CLAUDE.md`·ROADMAP·spec §10 정정 | 수동: 공개 VOD 1개(HLS), 1개(DASH), 클립 1개. 성인 PD 쿠키 필요 여부 실측 |
| 16 | (별도 PR) Go 삭제 | `cmd/`, `internal/`, `go.mod` 삭제, `internal/api/testdata` → `testdata/clip/` | 전체 테스트 녹색 |

---

## 11. AES 암호화 VOD

**정책: 암호화(AES) VOD는 지원하지 않으며 명확한 오류로 거부한다**(사용자 확정, 2026-10-05). 복호화·키 요청 기능은 넣지 않는다.

판별 규칙(코드가 구현하는 것):

1. `classify`가 `encryptionType`을 **가장 먼저** 본다. 값이 있으면(빈 문자열 제외) `inKey`가 있어도 `Playback::Encrypted { method }`이고, `resolve`는 MPD를 받지 않고 `Error::EncryptedVod { method }`를 낸다. 메시지: "암호화된 VOD(AES)는 지원하지 않습니다".
2. 2차 방어: MPD의 AdaptationSet·Representation에 `ContentProtection`이 있으면 그 rep는 PD로 쓰지 않는다(`pd_reps`). media playlist에 `EXT-X-KEY`(METHOD≠NONE)가 있으면 `Unsupported::Encrypted(method)`로 거부한다.
3. `MediaPlaylist.init: Option<Url>`이라 MAP 없는(TS) playlist도 파싱은 된다. 그 이상(복호화·TS 처리)은 넣지 않는다.

---

## 12. spec·research 정정 사항 (15단계에서 문서에 반영)

1. stack.md `cargo test -p core` → `-p chzzk-core`. reqwest 권장 feature에서 `gzip` 제거.
2. spec §4.4 `Playback`에 `Encrypted` 추가, `encryptionType` 우선 순서 명시, `select_source`는 동기 함수가 아니라 `download` 안의 variant 선택.
3. spec §5.6 기본 화질은 `height`가 아니라 `resolution` 라벨(짧은 변) 기준.
4. spec §6.2 ETA는 세그먼트 수가 아니라 EXTINF 누적 비율.
5. spec §6.1-5·§8.2 "실패 시 파일 삭제" → "`.part` 보존, 최종 파일 없음". 상태 확인 전에는 `.part`를 만들지 않는다.
6. spec §7.1 "첫 실행 때 옛 위치 마이그레이션" → 자동은 best-effort, 수동 가져오기가 주 경로.
7. spec §9.1-17 길이 제한은 255바이트가 아니라 `.part.json` 접미사 몫을 뺀 200바이트. 예약어·끝 `.`은 Windows 프로필만.
8. spec §9.1-20 키체인 → 0600 파일. spec §2.2·§10.4 미디어 쿠키 → 보내지 않음(비성인 PD 실측 완료, 성인 미확인).
9. research §9 "403 = 토큰 만료" → 재조회 직후 재403은 인증 오류. §11.2 미관찰이므로 지문 검증 필수.
10. research §5 거부 목록에 `ENDLIST 없음` 추가, `KEY:METHOD=NONE`은 허용.
11. spec §4.1·§9.1-5 `media[0]` 고정 → `protocol == "HLS"`인 첫 항목.
12. spec §10.1 "VOD MPD fixture 없음" → `testdata/vod/` 확보됨.
13. ROADMAP의 AES 문구 → §11 정책(거부)과 맞춘다.

---

## 구현 중 변경

구현하면서 설계와 달라졌거나 설계가 모호해 고른 내용이다. 단계 번호는 §10 기준이다.

1. **(1단계) 의존성은 단계별로 추가한다.** §9 목록을 한 번에 넣지 않고 그 crate를 처음 쓰는 단계에서 넣는다(1단계 `serde`·`thiserror`, 4단계 `url`, 8단계 `reqwest` 등). `reqwest`의 TLS provider 확인(§9 끝)을 HTTP 단계로 미루기 위해서다. `serde_json`은 1단계부터 dev-dependency다.
2. **(1단계) `Error` 변형도 단계별로 추가한다.** 다른 모듈 타입에 기대는 `HttpStatus`(`RequestKind`, 8단계), `PlaybackChanged`(`PlaybackKind`, 5단계), `Network`(`reqwest::Error`, 8단계)는 그 타입이 생기는 단계에서 `kind()`·`is_resumable()` arm과 함께 넣는다. `Error`가 `#[non_exhaustive]`라 공개 API 호환에는 영향이 없다. `ErrorKind`는 처음부터 전체 목록을 둔다.
3. **(1단계) CI 명령.** §8의 `cargo clippy -p chzzk-core -- -D warnings`에 `--all-targets`를 더해 테스트 코드도 검사하고, `cargo fmt --all --check`, `--locked`를 쓴다. Windows 러너가 fixture를 CRLF로 바꾸지 않도록 checkout 전에 `core.autocrlf=false`를 설정한다.
4. **(3단계) `model.rs`를 3단계에서 만든다.** `default_filename`이 `ContentMeta`·`ContentKind`를 받으므로 그 둘을 먼저 넣고, `ContentRef`는 4단계, 나머지 모델은 5단계에서 더한다. `naming` 테스트는 info 파서 없이 fixture JSON의 `content`에서 제목·채널·날짜만 직접 읽는다.
5. **(3단계) §8.1 Windows sanitize golden 정정.** `x:y*z?"<>|(){}[]/\.mp4`의 Windows 결과는 `x_y_z_____(){}[]__.mp4`다(`z` 뒤 `?"<>|` 다섯 글자가 각각 `_`). 표의 `x_y_z____…`(밑줄 넷)는 오타다. 표의 `\|`는 마크다운 이스케이프이고 실제 입력에 백슬래시가 없다.
6. **(3단계) sanitize 세부.** 모호했던 부분을 이렇게 정했다.
   - 문자 규칙(금지 문자, 제어문자, 공백 정규화·병합)은 확장자까지 이름 전체에 적용한다. trim·빈 값 `_`·끝 `.`/공백 제거·예약어는 확장자 앞 base에 적용한다. 확장자 분리는 Go와 같다(`.`을 포함하고 `.`으로 끝나지 않으면 마지막 `.` 뒤).
   - Windows 예약어는 **첫 `.` 앞**으로 판단한다(Windows는 `NUL.tar.gz`도 막는다). `CON.mp4` → `CON_.mp4`, `NUL.tar.gz` → `NUL_.tar.gz`.
   - `default_filename`은 채널·제목에 문자 규칙만 적용해 조립한 뒤 전체에 `sanitize_filename`을 한 번 더 적용한다(멱등). 그래서 제목 `CON` 같은 조각에 불필요한 `_`가 붙지 않고, 이름 전체가 예약어일 때만 붙는다. "채널이 비었는가"는 정리 후 빈 문자열인지로 본다.
   - 날짜는 `live_open_date`가 없거나 **파싱에 실패하면** `publish_date`로 넘어간다. `parse_live_date`는 자릿수에 더해 월 1–12, 일 1–31 범위도 검사한다.
   - 길이 초과 시 제목을 먼저 자르되 제목은 최소 60바이트(또는 원래 길이)를 남기고, 그래도 넘치면 채널을 자른다. 자른 뒤 trim(Windows는 끝 `.`/공백도)을 다시 한다. 제목이 비면 `_`.
   - `sanitize_filename`은 길이를 자르지 않는다. 사용자가 준 이름은 `output_path`가 `.mp4`를 붙인 뒤 200바이트로 자른다(확장자 보존).
7. **(4단계) `ContentRef` 직렬화 필드도 camelCase.** `#[serde(tag = "kind", rename_all = "camelCase")]`만으로는 변형 이름만 바뀌고 필드는 `video_no`로 남는다. `rename_all_fields = "camelCase"`를 더해 `{"kind":"video","videoNo":123}`, `{"kind":"clip","clipId":"abc"}`로 고정했다(셸·sidecar 공통).
8. **(4단계) URL 해석 세부.** 앞뒤 공백은 지운다. 스킴 없이 붙여 넣은 `chzzk.naver.com/video/123`은 `https://`를 붙여 읽는다. 스킴은 http/https만, 끝 `/`는 하나만 허용한다(`clips/abc//`는 오류). videoNo는 ASCII 숫자만 받고 `u64` 범위를 넘으면 오류다. §8.1 `url::clip_detection`의 "true 5건"은 TestIsClipURL의 실제 true 3건으로 이식했다(나머지 둘은 `clip_id`에 있다).
9. **(3단계 리뷰 수정) sanitize 멱등.** Windows는 이름 전체의 끝 `.`·공백을 **확장자를 나누기 전에** 지운다. 그다음 base에 trim·끝 `.`/공백 제거를 한 번 더 한다. 이전 순서에서는 `.x.` → `.x` → `_.x`처럼 두 번째 적용에서 앞쪽 `.`이 새 확장자 구분자가 됐다. 이제 `.x.` → `_.x`, `a .b.` → `a.b`다. 6번의 "trim은 base에 적용"을 이렇게 다듬는다.
10. **(3단계 리뷰 수정) `default_filename` 예산.** 제목은 Windows에서 끝 `.`·공백까지 지운 뒤 비었는지 보고, 비면 `_`를 **길이 예산을 계산하기 전에** 넣는다(빈 제목 + 긴 채널이 201바이트가 되던 문제). 자른 제목이 trim으로 다 지워지면 `_`를 넣고 채널을 1바이트 더 자른다. 자른 뒤 채널이 비면(Windows 끝 `.` 제거) ` - `도 뺀다(`[클립] 제목.mp4`).
11. **(3단계 리뷰 수정) Windows 예약어 확장.** §6 목록에 `CONIN$`, `CONOUT$`, `COM¹ COM² COM³`, `LPT¹ LPT² LPT³`를 더했다(Microsoft 파일 이름 규칙 문서). 예약어 판단은 첫 `.` 앞 이름에서 끝 공백을 지운 값으로 하고, `_`는 그 끝에 넣는다(`CON .x.mp4` → `CON_ .x.mp4`).
12. **(1단계 리뷰 수정) `is_resumable` 기본값.** §3.6이 나열하지 않은 변형은 "`.part`를 남긴다"(true)로 분류한다. 지우기는 되돌릴 수 없고 재개 시 sidecar 동일성·지문 검증이 낡은 `.part`를 거르기 때문이다. false는 받은 바이트가 틀렸거나 같은 요청이 끝내 완료될 수 없음을 증명하는 오류뿐이다: `LengthMismatch`, `SourceChanged`, `AuthRequired`, `EncryptedVod`, `Unsupported`(나중에 `PlaybackChanged`, 4xx `HttpStatus`). `Io`, `Parse`, `Api`, `NoPlayback`, `QualityNotFound`, `NoQualities`, `InvalidUrl`, `Settings`는 true다. 구현은 `_` arm 없는 `match`라 새 변형은 분류해야 컴파일된다(`#[non_exhaustive]`는 crate 밖에만 적용).
13. **(1단계 리뷰 수정) fixture 줄끝.** 3번의 CI `core.autocrlf=false`만으로는 로컬 Windows 클론(win10 VM 등)을 막지 못한다. 루트 `.gitattributes`에 `testdata/** -text`, `internal/api/testdata/** -text`를 두어 fixture를 바이트 그대로 체크아웃한다. CI 설정은 이중 방어로 남긴다. `crates/core/tests/fixture_bytes.rs`가 텍스트 fixture에 CR이 없음을 검사한다.
14. **(5단계) HLS 화질의 `resolution`.** §3.1의 "HLS videoHeight (짧은 변)"을 `min(videoWidth, videoHeight)`(둘 다 있을 때), 아니면 `videoHeight`로 정했다. 세로 영상에서도 DASH `resolution` 라벨과 같은 뜻(짧은 변)이 되게 하려는 것이다. `label`은 `"{resolution}p"`, 없으면 `id`다.
15. **(5단계) info 응답은 두 단계로 읽는다.** 먼저 `code`·`message`·`content`(raw)만 읽고 `code != 200`이면 `content` 형태와 무관하게 `Error::Api`를 낸다. `code`가 없거나 `content`가 object가 아니면 `Error::Parse`다. `encryptionType`도 다른 문자열과 같이 `""`를 없음으로 본다.
16. **(5단계) 빠른 다시보기 오류 구분.** `liveRewindPlaybackJson`이 있는데 `protocol == "HLS"`인 media가 없으면 `NoPlayback`이 아니라 `Unsupported(NoHlsMedia)`다. HLS media의 `path`가 없거나 URL이 아니면 `Parse`이고, 서명 토큰이 든 원문 URL은 오류 메시지에 넣지 않는다. `encodingTrack`이 비어도 `classify`는 `LiveRewind`를 내고, 빈 목록의 `NoQualities` 판정은 `resolve`가 한다. `Encrypted.video_id`는 비어 있어도 된다(쓰지 않는다).
17. **(5단계) `PlaybackChanged` 추가.** `kind() = PlaybackChanged`, `is_resumable() = false`. 단위 테스트의 fixture 로더는 `src/testutil.rs`(`#[cfg(test)]`)에 둔다. `serde_json`은 이 단계부터 일반 의존성이다.
18. **(6단계) MPD 세부.** PD 판정(`Representation::is_pd`)은 §3.2 조건 그대로이며 `!protected`를 포함한다. PD rep의 첫 BaseURL이 절대 URL로 파싱되지 않으면 `Parse`다(서명 쿼리가 있어 원문은 오류에 넣지 않는다). MPD·Period 수준 `BaseURL` 상속과 상대 BaseURL은 실물에 없어 다루지 않는다. `bandwidth`·`width`·`height`가 숫자가 아니면 `None`이다. 정확 일치 선택은 `mpd::select_pd(reps, quality_id)`로 두어 다운로드 단계가 재사용한다(`QualityNotFound { available }`는 PD id 목록).
19. **(6단계) `is_own_content`.** `my_channel_id`는 trim 후 비교하고, 비어 있으면 `Some(false)`다(컨텐츠에 채널 ID가 없을 때만 `None`).
20. **(7단계) HLS 파서 세부.**
    - 태그 이름은 `:` 앞까지 정확히 비교하고, 속성 목록은 따옴표 안의 `,`를 구분자로 보지 않는 파서 하나로 STREAM-INF·MAP·KEY를 읽는다. 앞 BOM과 줄 끝 `\r`은 지운다. `#EXT`로 시작하지 않는 `#` 줄은 주석이다.
    - `EXT-X-MAP`이 세그먼트 뒤에 처음 나와도(앞 세그먼트는 init 없음) init이 바뀌는 지점이므로 `SecondMap`으로 거부한다. MAP의 `BYTERANGE` 속성도 `ByteRange`로 거부한다. media playlist 자리에 master(`EXT-X-STREAM-INF`)가 오면 `Parse`다.
    - `EXTINF`는 ms로 반올림(가장 가까운 정수)한다. `1.666667` → `1667`. 음수·NaN·숫자 아님은 `Parse`. 세그먼트가 0개이거나 EXTINF 없는 URI 줄은 `Parse`. `ENDLIST` 검사는 세그먼트 수 검사보다 먼저다.
    - `durations_crc`는 각 `duration_ms`를 u32 little-endian 4바이트로 이어 붙인 바이트열의 crc32다(fixture 30×2000ms = `0x84944746`).
    - master의 `track_id`는 variant URL을 master 디렉토리(`base.join("./")`) 기준 상대 경로로 바꾼 첫 세그먼트다. 디렉토리 밖의 URI면 해석한 URL의 첫 비어 있지 않은 path 세그먼트를 쓴다(26번). `height`는 `RESOLUTION=WxH`의 H다.
    - 모르는 `#EXT` 태그 경고에 `tracing`을 이 단계에서 의존성으로 넣는다(`crc32fast`도 함께).
21. **(8단계) TLS provider.** `reqwest`의 `rustls` feature는 `hyper-rustls`의 `aws-lc-rs` provider를 켠다(`cargo tree -e features -i rustls`로 확인). 설계대로 그대로 쓴다. `aws-lc-sys` 0.45.0의 빌드 스크립트를 읽어 보면 Windows x86_64에서는 `nasm`이 PATH에 있거나 `prebuilt-nasm` feature 또는 `AWS_LC_SYS_PREBUILT_NASM=1` 환경 변수가 있어야 하고, reqwest는 그 feature를 켜지 않는다. 그래서 NASM이 없는 `windows-latest` 러너와 로컬 Windows 빌드가 실패할 수 있다(macOS에서는 확인 불가). 실패하면 (a) `core.yml`의 Windows 작업에 `AWS_LC_SYS_PREBUILT_NASM=1`(또는 NASM 설치)을 넣거나 (b) `rustls-no-provider` + `rustls/ring` 조합으로 바꾼다. 결정은 CI 결과를 보고 한다. 다른 crate가 feature 통합으로 압축 해제를 켜도 꺼지도록 `no_gzip`·`no_brotli`·`no_deflate`·`no_zstd`를 모두 호출한다. `json` feature는 넣었지만 응답은 `serde_json::from_slice`로 읽는다.
22. **(8단계) `ClientConfig.retry`는 9단계에서 넣는다.** `RetryPolicy`가 `download/retry.rs`(9단계)에 생기기 때문이다. `ClientConfig`와 `Endpoints`는 `Default`(실서버 주소, 200ms, 10s, 30s)를 구현한다.
23. **(8단계) 요청 URL은 `path_segments_mut`로 만든다.** `join` 대신 기본 주소의 세그먼트 뒤에 `pop_if_empty().extend(...)`로 붙이므로 기본 주소 끝의 `/` 유무와 무관하고, ID에 `/`·`?`가 섞여도 인코딩된다. `Chzzk::new`는 http(s) 기본 주소가 아닌 엔드포인트를 `Parse { what: "endpoint" }`로 거부한다. `inKey`는 `query_pairs_mut().append_pair("key", …)`로 붙인다.
24. **(8단계) 오류 세부.**
    - `HttpStatus`의 `is_resumable`: 4xx는 false이되 408·429는 일시적이라 true다. 5xx와 그 밖은 true. `Network`는 true.
    - `Network`는 `Error::network(e)`(crate 내부)로만 만들고 `e.without_url()`을 적용한다. `#[from]`은 두지 않는다.
    - 쿠키 `Cookie` 헤더 값은 `Chzzk::new`에서 한 번 만들고 `set_sensitive(true)`로 표시한다. 헤더로 보낼 수 없는 문자가 있으면 `Error::Settings`다.
    - `redact_url`은 쿼리·fragment·사용자 정보를 지우고, `hdntl=`로 시작하는 세그먼트부터 `hmac=`이 든 세그먼트까지(토큰의 `acl=*/kr/*`에 `/`가 있어 여러 세그먼트에 걸친다)를 `hdntl=***` 하나로 바꾼다.
    - 빠른 다시보기의 `encodingTrack`이 비면 `resolve`가 `NoQualities`를 낸다.
25. **(8단계) UA의 Chrome 메이저는 `141`이다.** OS별 UA 세 개가 `chrome_major!()` 하나를 쓴다. 실서버가 UA를 검사한다는 증거는 없으므로 값은 15단계 스모크 때 필요하면 올린다. 실서버 스모크 `resolve::live_smoke`는 `#[ignore]` + `CHZZK_LIVE_VIDEO`로만 돈다.
26. **(5~8단계 리뷰 수정)**
    - **HLS track_id.** 디렉토리 밖 variant의 track_id를 원문이 아니라 `join`한 URL의 첫 비어 있지 않은 path 세그먼트로 바꿨다. 원문을 자르면 절대 URI에서 스킴 `https:`가 나왔다. 파일명 바로 앞 세그먼트는 쓰지 않는다(실물 경로에서는 `hdntl` 토큰 조각이다). 디렉토리 밖 URI는 여전히 받으며, 고르는 쪽은 §4.1의 `height` 폴백에 기댄다. §5.4 1번("없으면 `QualityNotFound`")은 §4.1과 어긋나며 §4.1(폴백 있음)을 기준으로 본다.
    - **URI 없는 EXTINF.** URI 전에 EXTINF가 또 나오거나 URI 없는 EXTINF로 끝나면 `Parse`다. 끝 검사는 ENDLIST 검사 뒤라서, ENDLIST 없이 잘린 playlist는 그대로 `NotEnded`다.
    - **msn 범위.** `EXT-X-MEDIA-SEQUENCE + (세그먼트 수 - 1)`이 u64를 넘으면 패닉 대신 `Parse`다.
    - **GAP·SKIP 거부.** `EXT-X-GAP`은 `Unsupported::Gap`, `EXT-X-SKIP`(delta playlist)은 `Unsupported::Skip`이다. 둘 다 이어 붙이면 구멍 난 파일이 된다. LL-HLS의 `EXT-X-PART`·`EXT-X-PRELOAD-HINT`는 ENDLIST playlist에서도 전체 세그먼트가 함께 나열되므로 거부하지 않고 모르는 태그로 무시한다.
    - **redact_url.** `hdntl=` 뒤에 `hmac=` 세그먼트가 없으면(토큰 형식이 바뀐 경우) 마지막 세그먼트(파일명) 앞까지를 `hdntl=***`로 가린다. `hdntl=` 세그먼트가 마지막이면 그것만 가린다.
    - **서명 값이 든 타입의 `Debug`.** `info::VideoContent`·`info::Playback`·`mpd::Representation`·`model::PdRep`·`model::Source`·`hls::Variant`·`hls::MediaPlaylist`·`hls::Segment`는 `Debug`를 손으로 구현한다. URL은 `redact_url`을 거치고, `in_key`·`live_rewind_playback_json`은 `***`, `Representation.base_urls`는 쿼리를 지운다. `Resolved`는 `Source`를 통해 함께 가려진다. 필드 타입은 그대로 `Url`이다(`Secret<Url>` 같은 newtype은 공개 필드 타입을 바꾸므로 쓰지 않았다). `http::signed_types_debug_redacted`가 합성 fixture로 `hmac`·`hdnts`·`hdntl=exp`·`_lsu_sa_`·fixture inKey 값이 없음을 검사한다. PD가 아닌 rep(HLS 미끼·audio)의 BaseURL에도 서명 쿼리가 있어 그 가림도 함께 검사된다.
    - **`mpd::has_content_protection`(§2) 없음.** ContentProtection 여부는 `Representation.protected` 필드로 노출하고 `is_pd`가 `!protected`를 본다(18번). 별도 함수는 두지 않는다.
    - **API·MPD 응답 상한.** `Chzzk::fetch`는 본문을 8 MiB(`MAX_API_BODY`)까지만 읽는다. `Content-Length`가 넘으면 바로, 아니면 `chunk()`로 읽다가 넘는 순간 `Parse { what: "response" }`다. `read_timeout`은 idle만 끊으므로 계속 흘러오는 본문을 이것으로 막는다. 미디어 다운로드에는 적용하지 않는다.
27. **(9단계) `PartFile` 생성은 `resume`과 `create` 둘로 나눈다.** §5.1의 `open(final_path, Option<Sidecar>)` 하나로는 "재개 offset을 요청 전에 알아야 한다"와 "새 `.part`는 상태 코드 확인 뒤에 만든다"를 함께 지킬 수 없다.
    - `PartFile::resume(final, content, quality_id, kind) -> Option<PartFile>`: `.part`가 있으면 **먼저 잠그고**(`try_lock`, 실패 시 `FileLocked`) sidecar를 읽는다. 같은 작업이고 `.part` 길이 ≥ `committed_len`이면 `committed_len`으로 잘라 연다. 아니면 잠금을 쥔 채 둘 다 지우고 `None`. 잠금 없이 `.part`를 자르거나 지우는 경로는 없다(Unix는 잠긴 파일도 unlink되므로).
    - `PartFile::create(final, sidecar)`: create(자르지 않음) → 잠금 → `set_len(0)` → sidecar(`committed_len = 0`)를 **곧바로** 쓴다. 첫 checkpoint 전에 죽어도 다음 실행이 `.part`를 버리지 않게 하려는 것이다.
    - `checkpoint`는 `async`다. `flush` 뒤 `try_clone`한 핸들로 `spawn_blocking` 안에서 `sync_data` → sidecar 원자적 쓰기를 한다(`block_in_place`는 current_thread 런타임에서 패닉). 실패하면 기억한 `committed_len`은 그대로다.
    - `finalize`는 `DuplicatePolicy`를 받지 않고 항상 덮어쓴다(`Skip`은 네트워크 전에 이미 걸렀다). `restart`(Range를 무시한 200 → truncate(0))와 `discard`(잠금을 쥔 채 삭제)를 더했다. `discard_partial`도 잠금을 먼저 잡고, 잠겨 있으면 `FileLocked`이고 아무것도 지우지 않는다.
    - `ProgressiveState.total_len`은 `Option<u64>`다(`Content-Length` 없는 200). sidecar 키는 camelCase다. 경로는 `{final}.part`, `{final}.part.json`.
28. **(9단계) 재시도 세부.** `RetryPolicy.max_attempts`는 첫 시도를 **포함한** 횟수(기본 5)이고 `RetryPolicy::none()`(1회)이 테스트의 `ZeroRetry`다. `delay(n) = min(base·2ⁿ, cap) × [0.75, 1.25]`. `Failure::Retry`는 재시도 소진 시 낼 오류를 담는다(`Retry(Error)`). `classify_failure`는 `reqwest::Error`를 소유로 받는다(`Error::Network`로 옮기기 위해). 408도 `Retry`다(24번의 `is_resumable`과 맞춤). builder·redirect 오류는 `Fatal`.
29. **(9단계) fsutil 세부.** `map_io_error`는 `ErrorKind::StorageFull`을 먼저 보고, 원시 코드는 OS별로 본다: unix 28(ENOSPC), Windows 112·39. Linux 112는 EHOSTDOWN, 39는 ENOTEMPTY이고 Windows 28은 용지 없음이라 §8.2의 "28/112/39" 테스트도 cfg로 나눴다. `rename_with_retry`는 `PermissionDenied`(모든 OS)와 Windows 32·33을 일시 잠금으로 보고 100·200·400·800·1600ms 뒤 재시도하며(합 3.1초), 끝내 실패하면 `FileLocked { path: 최종 경로 }`다. `atomic_write`는 같은 디렉토리의 `tempfile` → `sync_all` → `persist`다.
30. **(9단계) 의존성.** `tokio`를 일반 의존성(`rt`, `macros`, `time`, `sync`)으로 옮기고 `tokio-util`·`futures-util`·`tempfile`을 넣었다. `ClientConfig.retry`(22번)를 넣었고 통합 테스트 설정은 대기 1~4ms 정책을 쓴다.
31. **(10단계) 다운로드 골격 세부.**
    - 오류로 끝날 때 `download`가 한 곳에서 정리한다. `is_resumable()`이면 `checkpoint(|_| {})`로 받은 만큼 남기고, 아니면 잠금을 쥔 채 `discard`한다. 엔진은 쓰기 직후 `PartFile::stage`로 다음 checkpoint 상태(HLS `next_index` 등)를 갱신해 두므로, 이 공통 checkpoint가 쓴 바이트와 맞지 않는 sidecar를 남기지 않는다.
    - 재시도 횟수(`attempts`)는 "진전 없이 연달아 실패한 요청 수"다. 바이트를 받은 뒤 끊기면 0으로 돌린다. 긴 다운로드가 드문 끊김을 합산해 실패하지 않게 하려는 것이다. 재조회 횟수는 작업 전체로 센다(상한 8, 9번째 요청에서 `RefreshExhausted`).
    - "재조회 직후 같은 요청"은 재조회 뒤 2xx(또는 완료 판정 416)를 받기 전까지다. 그 사이 403이면 `AuthRequired { 403 }`이고 `.part`를 지운다(§3.6).
    - 416은 `offset > 0`, `Content-Range: bytes */N`의 N(없으면 sidecar 값)이 offset과 같고 sidecar 값과도 어긋나지 않을 때만 완료다.
    - 2xx 중 200·206이 아닌 응답은 `Parse { what: "media" }`다. `resolve`(재조회 포함)의 네트워크 오류는 재시도하지 않고 그대로 낸다(`.part`는 남는다).
    - 이 단계에서 진행률은 매 이벤트를 그대로 보낸다(스로틀·속도·ETA는 13단계 `Meter`). 빠른 다시보기 분기는 11단계에서 연결한다.
    - `tokio_util::sync::CancellationToken`을 crate 루트에서 재노출한다. `download::DEFAULT_CONCURRENCY`(4)·`MAX_CONCURRENCY`(8) 상수를 둔다.
32. **(11단계) HLS 엔진 세부.**
    - 지문 비교는 세그먼트 수·EXTINF crc·init 길이다(결정 13). `media_sequence`는 sidecar에 기록만 하고 비교하지 않는다(§5.4 2번과 다름). 세그먼트를 playlist 안 위치(index)로 고르므로 msn이 바뀌어도 이어 붙이는 바이트는 같고, research §11.2(갱신 후 MSN)는 미관찰이라 이 값 하나로 `.part`를 버리지 않는다.
    - init은 재개·재조회 때도 다시 받아 길이를 비교한다(1 KB 남짓). sidecar에 `committed_len == 0`이면 init을 아직 쓰지 않은 것으로 보고 init부터 쓴다(`create` 직후 죽은 경우). init 쓰기와 첫 checkpoint가 함께 일어나므로 `committed_len > 0`이면 init은 이미 들어 있다.
    - master·media playlist는 API와 같은 8 MiB 상한(`read_capped`)으로 읽는다. 세그먼트·init 본문은 상한 없이 `bytes()`로 읽고 `Content-Length` 불일치는 재시도한다. 첫 상자 검사 실패는 `Retry(Parse { what: "segment" | "init segment" })`다.
    - variant는 `track_id` 정확 일치, 없으면 `tracks`에서 같은 id의 `height`로 고른다(26번의 §4.1 기준).
    - 재시도 횟수는 세그먼트(요청)마다 따로 센다. 취소는 writer 루프의 `select!`가 받고, stream을 drop해 진행 중인 fetch도 취소된다.
    - 재개 시작 때(sidecar와 비교) 지문이 다르면 `SourceChanged`이고 `.part`를 지운다(durable한 sidecar와 비교한 결과다). 작업 도중 재조회의 불일치는 35번을 본다.
33. **(12단계) 동시 fetch와 재조회 세부.**
    - 동시 요청 수는 `min(req.concurrency, 8)`이다. 더 큰 값은 오류가 아니라 8로 줄인다.
    - `buffered`가 입력 순서대로 내놓으므로 writer가 받는 첫 `Err`는 늘 `next_index` 세그먼트의 것이다. 403이면 stream을 drop해 앞서 시작한 fetch까지 모두 취소하고, 재조회 → master·media·init을 다시 받아 지문을 비교한 뒤 `next_index`부터 새 stream을 만든다. 이미 받아 버퍼에 있던 뒤쪽 세그먼트는 버리고 다시 받는다(메모리 상한 유지, 단순함).
    - "같은 요청"은 재조회 때의 `next_index`다. 그 세그먼트를 받기 전에 또 403이면 `AuthRequired`다. playlist·init 요청도 403이면 재조회하고, 재조회 직후의 playlist·init 403도 `AuthRequired`다.
    - 재조회 결과가 DASH로 바뀐 것은 `Job::reresolve`의 방식 검사가 `PlaybackChanged`로 잡는다(재조회 `resolve`가 MPD까지 받은 뒤다).
    - `HlsState`에 `Default`를 붙였다(sidecar에 HLS 상태가 없으면 지문 불일치로 끝내기 위해).
34. **(13단계) `Meter` 세부.** `Meter::observe(&mut Progress, now, force) -> bool`가 `speed_bps`·`eta_secs`를 채우고 보낼지 정한다. 시각은 인자로 받아 테스트가 시계를 직접 넘긴다(일시 정지 런타임·sleep 없음). 보내는 조건은 첫 이벤트, 단계 변경, `force`, `progress_interval` 경과다. 다운로드의 마지막 이벤트는 `Finalizing` 단계 변경이라 늘 나간다. 속도는 최근 5초 창(100ms 간격 표본, 창 시작을 대신할 표본 하나 유지)의 바이트 증가율이고, 바이트가 줄면(Range 무시 후 처음부터) 창을 새로 시작한다. 이어받은 바이트는 첫 표본에 들어가므로 속도에 섞이지 않는다. 속도가 0이면 `speed_bps`는 `None`이다. HLS ETA는 `total_bytes`가 없을 때 `media_secs`의 처리율로 계산한다. `Meter`는 crate 루트에서 재노출한다(셸이 자체 이벤트에 재사용할 수 있게).
35. **(13단계 뒤 수정) `is_resumable() == false`여도 `.part`를 남기는 두 경우.** `download`의 정리 단계는 `e.is_resumable() || Job::keep_partial`이면 checkpoint해서 남기고, 아니면 지운다. `is_resumable`의 분류(§3.6, 12번)는 그대로이고, UI는 어차피 `kind()`로 분기한다.
    - **`resolve` 자체의 실패**(처음 조회와 403 뒤 재조회 모두): 예를 들어 로그인 쿠키가 만료되어 info API가 401/403이면 `AuthRequired`인데, §3.6이 지우라고 한 것은 **미디어** 403 뒤의 `AuthRequired`다. API 오류는 받은 바이트가 틀렸다는 증거가 아니므로 수 시간 받은 `.part`를 지우지 않는다. 범위는 `resolve`가 낸 모든 오류로 넓혔다(`EncryptedVod`, `NoPlayback` 포함. 남겨도 다음 실행이 같은 곳에서 멈출 뿐이고 사용자가 `discard_partial`로 지울 수 있다). `resolve`가 성공한 뒤의 방식 검사(`PlaybackChanged`)는 여전히 지운다.
    - **작업 도중 재조회한 HLS playlist의 지문 불일치**(`SourceChanged`): §8.2 `refresh_fingerprint_mismatch` 행대로 남긴다. 받은 바이트는 sidecar 지문(재조회 전)과 맞고, CDN이 잠깐 다른 playlist를 준 것이라면 다음 실행의 재개 지문 검사가 통과해 이어받는다. 정말 바뀌었으면 그 검사가 `SourceChanged`로 지운다. 재개 시작 때의 불일치와 progressive의 `Content-Range` total 불일치는 그대로 지운다.
36. **(9~13단계 리뷰 수정) 덜 받은 본문은 재시도를 다 써도 `.part`를 남긴다.** §5.3 4번("재시도 소진 시 `LengthMismatch`")과 §3.6을 이렇게 바꾼다. progressive에서 쓴 바이트는 모두 `Content-Range` 위치를 확인한 것이라, 본문이 계속 짧게 끝나도 틀린 바이트는 없다. 그래서 재시도를 다 쓰면 `.part`를 지우는 `LengthMismatch`가 아니라 `Parse { what: "media" }`(이어받기 가능)로 끝낸다. `LengthMismatch`는 `total`보다 많이 받은 경우에만 낸다(정말 틀린 바이트가 쓰였다). HLS 세그먼트·init의 `Content-Length` 불일치는 본문을 쓰기 전에 거르므로, 어느 방향이든 `Parse { what: "segment" | "init segment" }`이고 앞서 받은 세그먼트를 지우지 않는다. §8.2 `truncated_body_resumes`(끊김은 `Network`로 남김)와 같은 기준이다.
37. **(9~13단계 리뷰 수정) rename 재시도는 Windows만.** 29번의 "`PermissionDenied`(모든 OS)"를 고친다. 일시 잠금으로 보는 오류는 Windows의 `ERROR_ACCESS_DENIED`(5, `PermissionDenied`)·32·33뿐이다(§5.1). Unix의 rename EACCES/EPERM은 읽기 전용 디렉토리 같은 권한 문제라 3.1초를 기다려도 풀리지 않으므로 바로 `Io { op: "rename" }`이다. `rename_with_retry_using`은 일시 잠금 판정도 주입받아 재시도 루프를 모든 OS에서 테스트한다.
38. **(9~13단계 리뷰 수정) `atomic_write`도 rename을 재시도한다.** sidecar는 checkpoint마다 `atomic_write`로 바뀌는데, Windows에서 백신·색인기가 이전 `.part.json`을 잡고 있으면 rename이 `ERROR_ACCESS_DENIED`로 실패해 다운로드 전체가 `Io`로 끝났다. 이제 임시 파일을 `into_temp_path`로 닫은 뒤 `rename_with_retry`와 같은 판정·간격(합 3.1초)으로 옮기고, 끝내 잠겨 있으면 `FileLocked { path: sidecar }`(이어받기 가능)다. checkpoint의 sidecar 쓰기는 `spawn_blocking` 안이라 기다려도 런타임을 막지 않지만, `PartFile::create`의 첫 sidecar 쓰기는 호출한 스레드에서 돌아 Windows 잠금이 길면 최대 3.1초 그 스레드를 막는다. 실제 Windows 잠금은 macOS에서 재현할 수 없어 rename 주입 테스트로만 검사했다.
39. **(9~13단계 리뷰 수정) `finalize` 순서.** Unix는 `.part` 잠금을 쥔 채 rename하고 sidecar를 지운 뒤 핸들을 닫는다. 잠금을 먼저 풀면 그 사이에 같은 출력의 다른 작업(다른 화질)이 `.part`를 잠그고 지우거나(`resume`의 불일치 정리) `create`로 길이를 0으로 만들 수 있었다. Windows는 열린 파일을 옮길 수 없어 닫고 옮기는 순서를 유지하므로 이 틈이 남는다(짧고, 같은 출력을 동시에 받는 경우뿐이다). rename이 성공한 뒤의 sidecar 삭제 실패는 `tracing::warn!`만 남기고 `Ok(최종 경로)`다. 파일은 이미 완성됐고, 남은 `.part.json`은 다음 실행에서 `.part`가 없으므로 쓰이지 않는다.
40. **(9~13단계 리뷰 수정) 세그먼트·init 본문 상한.** 32번의 "세그먼트·init 본문은 상한 없이 `bytes()`"를 고친다. 동시 요청 수(최대 8)만큼 본문을 메모리에 들고 있으므로, 길이 없이 계속 흘러오는 응답이 메모리를 다 쓰지 않도록 `read_capped`로 세그먼트 256 MiB, init 16 MiB(playlist는 그대로 8 MiB)까지만 읽는다. 네트워크 오류는 재시도, 상한 초과는 재시도하지 않는 `Parse`(`.part`는 남는다)다.
41. **(9~13단계 리뷰 수정) sidecar 임시 파일 이름과 정리.** `atomic_write`의 임시 파일은 `tempfile` 기본 이름(`.tmpXXXXXX`) 대신 `{대상 이름}.XXXXXX.tmp`(무작위 6글자)다. 쓰는 도중 강제 종료되어 남아도 어느 파일의 것인지 알 수 있다. `PartFile::resume`·`create`·`discard_partial`은 `.part` 잠금을 쥔 뒤 그 sidecar의 남은 임시 파일(`{final}.part.json.XXXXXX.tmp` 형식과 정확히 맞는 것만)을 지운다. 잠금을 쥐지 못한 경로(`.part`가 없는 `discard_partial`)에서는 지우지 않는다(같은 출력의 `create`가 막 쓰는 중일 수 있다).
42. **(14단계) 설정 세부.**
    - `UserSettings`는 구조체 수준 `#[serde(default)]` + 손으로 쓴 `Default`(`schema_version = 2`, `segment_concurrency = 4`)다. 배열·문자열의 `null`, 빈(공백뿐인) 문자열 `downloadFolder`·`lastQualityLabel`·`lastUrl`은 없음으로, `segmentConcurrency: 0`은 4로 읽는다. 상한 8은 `download`가 이미 줄인다(33번).
    - serde는 struct를 JSON 배열로도 읽으므로 최상위가 object가 아니면 깨진 파일로 본다(`settings::parse_object`). JSON·형식 오류만 `.bad-{ts}`로 옮기고(같은 초에 겹치면 `-1`, `-2` …), 권한 같은 읽기 오류는 옮기지 않고 `Io`다. 파일이 없으면 기본값이고 첫 `update` 때 폴더와 파일을 만든다.
    - `update`는 쓰기에 성공한 뒤에만 메모리 값을 바꾸고, `schema_version`을 늘 현재 값으로 쓴다. 잠금이 poison되면 안의 값을 그대로 쓴다(쓰기 전 상태다).
    - 공개 API에 `SettingsStore::{dir, path}`, `settings::{SETTINGS_FILE, SCHEMA_VERSION, MAX_RECENT_VODS}`를 더했다.
43. **(14단계) 자격증명 세부.** 파일 형식은 `{"nidAut": …, "nidSes": …}`이고 저장할 때 앞뒤 공백을 지운다. 값 하나라도 비면 `load`는 `None`, 깨진 파일은 값이 섞이지 않은 `Settings` 오류다(serde 메시지를 버린다). 0600은 `tempfile`이 임시 파일을 0600으로 만들고 rename이 그대로 옮기는 것에 더해 저장 뒤 `set_permissions(0o600)`을 한 번 더 한다. Windows는 ACL을 바꾸지 않는다(사용자 프로필 폴더 기본 ACL). 생성자는 `CredentialStore::new(dir)`이다.
44. **(14단계) 레거시 가져오기 세부.**
    - 쿠키는 **한 파일에서 한 쌍**으로만 가져온다. `cookie.json`의 `NID_AUT`·`NID_SES`가 둘 다 있으면 그것, 아니면 settings의 `nidAut`·`nidSes`가 둘 다 있으면 그것, 아니면 `None`이다. 두 파일 값을 섞으면 서로 다른 로그인의 반쪽이 될 수 있다. `use_naver_cookies = isAdultContent && cookies.is_some()`.
    - `settings.json`과 `cookie.json`이 둘 다 없으면 `None`. `settings.json`에 `schemaVersion`이 있으면 새 형식이므로 `None`(셸의 설정 폴더와 옛 exe 폴더가 같은 경우). 옛 `settings.json`이 깨졌으면 `Settings` 오류(값이 섞이지 않게 serde 메시지를 버린다)이고 파일은 그대로다. `cookie.json`을 읽지 못하면 Go처럼 건너뛰되 경고를 남긴다.
    - `recentVods`(없으면 `recentVodURLs` → `"제목 없음"`)는 URL이 빈 항목을 버리고 5개로 자른다. `lastQualityName`은 `^\d+p$` 그대로, `^\d+P_` → `"{n}p"`, 그 밖은 버린다(정규식 crate 없이 손으로). `downloadFolder`가 실재하지 않으면 버리고 경고한다. 평문 쿠키 경고는 settings·cookie.json 어느 쪽이든 값이 남아 있으면 낸다.
    - 결과의 `settings.imported_from = Some(dir)`이다. 저장은 셸이 `SettingsStore::update`·`CredentialStore::save`로 한다.
45. **(15단계) 실서버 스모크 결과(2026-10-05, 비로그인).** `sortType=LATEST` 목록에서 고른 공개·비성인 컨텐츠로 `examples/dl.rs`와 `tests/live.rs`(`#[ignore]`)를 돌렸다. 모두 통과했고 코어 수정은 필요 없었다.
    | 대상 | 방식 | 확인한 것 |
    |---|---|---|
    | 공개 VOD(표본 1) | 빠른 다시보기 HLS(5화질, 144p로) | 약 5 MB에서 취소 → `.part`가 상자 경계에서 끝나고 `ftyp moov moof mdat emsg styp moof …`(상자 761개). `--keep`으로 2 MB에서 멈춘 뒤 다시 실행하면 3.1 MB부터 이어받음 |
    | 공개 VOD(표본 2) | DASH PD(144p) | 3 MB에서 취소 → `ftyp moov free mdat`(mdat 잘림). 2 MB에서 멈춘 뒤 Range로 이어받음 |
    | 공개 클립(표본 3) | PD 720p(세로) | 끝까지 받음, `ftyp moov free mdat`, `.part` 없음 |
    - `tests/live.rs`는 `CHZZK_LIVE_HLS`·`CHZZK_LIVE_DASH`·`CHZZK_LIVE_CLIP`으로 대상을 받고, 없으면 조용히 통과하지 않고 패닉한다(`--ignored`로 일부러 돌릴 때만 쓰이므로). 대상은 시간이 지나면 지워지므로 고정하지 않는다. 설계 §8의 `CHZZK_LIVE_VIDEO`는 `resolve::live_smoke`(8단계)에 그대로 남는다.
    - MP4 상자 검사기는 `tests/support/mp4.rs` 하나를 `tests/live.rs`와 `examples/dl.rs`가 `#[path]`로 함께 쓴다(크기 1 largesize, 0 끝까지, 마지막 상자 잘림 허용). 검사기 자체는 오프라인 테스트 `live::walk_boxes_on_fixture`가 합성 fixture로 검사한다.
    - UA의 Chrome 141(25번)로 막히지 않았다.
    - **성인 PD 쿠키 필요 여부는 미실측이다.** 로그인 쿠키가 필요한데, 저장소의 실제 사용자 파일(루트 `settings.json`, `dependent/`)은 읽지 않는다는 작업 규칙 때문에 쓸 수 있는 쿠키가 없었다. `examples/dl.rs`가 `CHZZK_NID_AUT`·`CHZZK_NID_SES`(+`CHZZK_COOKIES_ON_MEDIA=1`)로 쿠키를 받으므로 사용자가 직접 실측할 수 있다. 그때까지 결정 8(미디어에 쿠키 없음)과 `cookies_on_media` 스위치를 그대로 둔다.
46. **(15단계) §12 문서 정정 반영.** 1번은 `docs/research/stack.md`, 2~8·11·12번은 `docs/spec/core-behavior.md`(원래 Go 서술은 남기고 해당 자리에 "정정(설계 §12-n)"을 붙였다), 9·10번은 사전 조사 기록(비공개)에 반영했다. 10번의 거부 목록에는 구현에서 더한 `GAP`·`SKIP`(26번)도 적었다. 13번(ROADMAP의 AES 문구)은 설계 판정 커밋 때 이미 "기본값 거부, 지원 여부는 사용자 결정"으로 고쳐져 있어 바꾸지 않았다. 8번의 성인 PD는 45번대로 미실측으로 적었다.
47. **(14~15단계 리뷰 수정) 옛 형식 `settings.json` 보존.** 셸의 설정 폴더가 옛 exe 폴더와 같으면 `SettingsStore::open`이 Go 파일을 그대로 읽고, 첫 `update`가 Go 전용 키(`nidAut`·`nidSes`·`isAdultContent`·`lastQualityName`·`lastVodURL`·`recentVodURLs`)를 버린 채 덮어써 §7의 "원본은 지우지 않는다"를 어겼다. 44번의 "`schemaVersion`이 있으면 `None`"이 그 뒤의 가져오기도 막았다. 이제 `open`은 원본 JSON에 `schemaVersion` 키가 없으면 옛 형식으로 표시하고, 첫 `update`가 쓰기 직전에 원본을 고정 이름 `settings.json.v1`(`settings::LEGACY_BACKUP_FILE`)로 복사한다(이미 있으면 덮어쓰지 않고, 내용이 다르면 옛 앱을 다시 써서 생긴 새 옛 파일이므로 `settings.json.v1-{unix_ts}`로 따로 남긴다. 복사에 실패하면 덮어쓰지 않고 `Err`). `import_legacy(dir)`는 `settings.json`이 새 형식이면 `settings.json.v1`을 대신 읽고, 그것도 없을 때만 `None`이다. 메모리 값의 `schema_version`은 여전히 기본 2로 읽는다(옛 형식 여부는 따로 들고 있다).
48. **(14~15단계 리뷰 수정) 레거시 `downloadFolder` 상대 경로.** Go는 사용자가 친 문자열을 그대로 저장했고 exe 폴더에서 실행되었으므로, 상대 경로는 `dir` 기준으로 풀어(`dir.join`) 절대 경로로 확인·저장한다. 프로세스 작업 폴더 기준으로 보던 것을 고쳤다.
49. **(14~15단계 리뷰 수정) 설정 세부 보강.** `segmentConcurrency`는 어떤 JSON 값이든 받고 1~255 정수가 아니면(0, 음수, 범위 밖, 소수, 문자열) 그 필드만 4로 읽는다. 값 하나 때문에 파일 전체가 `.bad-*`로 가지 않는다(42번 보강). 깨진 파일 백업 이름은 `OsString`에 접미사를 붙여 만들고(UTF-8이 아닌 경로), `rename_with_retry`로 옮긴다. 재시도 뒤에도 옮기지 못하면 기본값으로 계속하지 않고 `Err`다. 계속하면 첫 `update`가 백업 없이 덮어쓴다.
50. **(14~15단계 리뷰 수정) 이어받은 HLS의 ETA.** `Meter`의 표본은 미디어 초를 `Option`으로 들고, 미디어 초가 없다가 처음 생기면 창을 새로 시작한다. 이어받기의 첫 보고는 이어받은 바이트만 있고 미디어 초가 없어, 다음 보고의 미디어 초(이미 받은 분량)를 방금 처리한 것으로 세어 ETA가 수 초로 나오던 것을 고쳤다(§12-4의 EXTINF 비율 ETA).
51. **(14~15단계 리뷰 수정) 스모크 보강.** `tests/support/mp4.rs`는 `off + size`를 `checked_add`로 계산한다(largesize가 u64 끝 가까이면 debug 빌드가 패닉했다). `examples/dl.rs`의 `--limit-mb`도 `checked_mul`이다. `live_dash_partial`은 취소(`.part` ≥ 3 MiB, 마지막 상자 잘림)와 완주(짧은 VOD, 잘림 없음) 둘 다 받고, 두 경우 모두 `[ftyp, moov, …]` 순서와 `mdat`을 확인한다. 2026-10-05에 짧은 VOD(35초, 완주)와 긴 VOD(35분, 취소)로 두 갈래를 실서버에서 확인했고, 빠른 다시보기 하나를 3 MB에서 멈췄다가 이어받아 ETA가 바이트 기준과 맞는 것(3.7/82.7 MB, 4.4 MB/s, ETA 17초)도 확인했다. 성인 PD 쿠키 실측은 45번대로 여전히 사용자 몫이다.
52. **(최종 리뷰) CI Windows의 NASM.** 21번의 "결정은 CI 결과를 보고 한다"를 (a)로 확정했다. `aws-lc-sys` 0.45.0의 빌드 스크립트(`use_prebuilt_nasm`)를 읽어 보면 Windows x86_64에서 PATH에 `nasm`이 없고 `AWS_LC_SYS_PREBUILT_NASM`도 없으면 "Missing dependency: nasm"으로 실패한다. GitHub 러너 이미지에 NASM이 들어 있어 지금은 통과하더라도 이미지에 기대는 것이라, `core.yml`의 작업 공통 `env`에 `AWS_LC_SYS_PREBUILT_NASM: "1"`을 넣었다. nasm이 있거나 Windows가 아니면 무시되는 값이라 다른 OS에는 영향이 없다. 로컬 Windows(win10 VM)에서 빌드할 때도 같은 변수를 두거나 NASM을 설치해야 한다. `rustls-no-provider` + `ring`(b안)으로 바꾸는 것은 TLS provider 교체라 Phase 2에서 Tauri 쪽 의존성과 함께 볼 때 다시 판단한다.
53. **(Phase 2, app.md §16) 앱 설정 필드 두 개.** 사용자 결정(app.md §16)에 따라 `UserSettings`에 `max_parallel_downloads: u8`(기본 2, `settings::{DEFAULT_PARALLEL_DOWNLOADS, MAX_PARALLEL_DOWNLOADS}`)와 `auto_resume_interrupted: bool`(기본 false)을 더했다. 둘 다 구조체 수준 `#[serde(default)]`로 옛 파일·Go 파일을 그대로 읽는다. `maxParallelDownloads`는 `segmentConcurrency`(49번)처럼 어떤 JSON 값이든 받는다: 1 이상 정수는 1~3으로 자르고(300 → 3), 0·음수·소수·문자열·`null`은 그 필드만 2다. 코어 다운로드 경로는 이 두 값을 쓰지 않는다(앱 셸의 작업 큐가 쓴다). 셸이 같은 `settings.json`에 모르는 키를 쓰면 `SettingsStore::update`가 지우므로 코어 구조체에 둔다(app.md §0).
54. **(Phase 2, app.md 구현 중 변경 37) `VERSION`.** 앱 정보(`AppInfo.coreVersion`, S2 "버전 {app} (코어 {core})")에 쓰려고 `chzzk_core::VERSION = env!("CARGO_PKG_VERSION")`을 더했다. API 추가만이다.
55. **(Phase 2, app.md 구현 중 변경 53) `finalize`가 `DuplicatePolicy`를 받는다.** 27번의 "`finalize`는 `DuplicatePolicy`를 받지 않고 항상 덮어쓴다"를 바꿨다. `Skip`은 시작 전 `exists()`로만 걸러져, 받는 동안 같은 이름의 파일이 생기면 마무리 rename이 덮어썼다. 이제 `PartFile::finalize(policy) -> Finalized`이고 `Skip`은 `fsutil::rename_noclobber_with_retry`를 쓴다. 덮어쓰지 않는 rename은 이미 의존하는 `tempfile`의 `TempPath::persist_noclobber`다(Linux `renameat2(RENAME_NOREPLACE)`, macOS `renamex_np(RENAME_EXCL)`, 그 밖 Unix hard link + unlink, Windows `REPLACE_EXISTING` 없는 `MoveFileExW`). `TempPath`는 만들자마자 `disable_cleanup(true)`로 바꿔 실패해도 `.part`를 지우지 않고, 실패 뒤 `keep()`으로 Windows가 다시 붙인 임시 파일 속성을 되돌린다. 파일 시스템이 지원하지 않으면(exFAT·FAT의 hard link, Windows 긴 경로) 대상이 있는지 본 뒤 보통 rename으로 옮긴다(확인과 rename 사이의 아주 짧은 틈만 남는다). Unix는 39번대로 `.part` 잠금을 쥔 채 옮긴다. 대상이 있으면 `Finalized::TargetExists` → `DownloadOutcome::Skipped`이고 `.part`·sidecar는 남아, 같은 요청을 `Overwrite`로 다시 부르면 이어받아 곧바로 마무리한다. Windows 경로는 이 Mac에서 컴파일·실행하지 못했다(CI에서 본다).
56. **(디자인 시스템 (f), platform.md §15.2) 연결 대기: 인내 모드.** 다운로드 작업의 연결 계열 실패(`Error::Network`: 연결 실패·timeout·reset·조기 EOF)를 30분(`retry::NETWORK_PATIENCE_MS`)까지 기다려 준다. 5xx·408·429·길이 불일치(`Parse`)는 현행(빠른 5회 뒤 끝)이다.
    - **빠른 재시도는 그대로 조용하다.** 지금의 `max_attempts` 5·`cap` 8초를 다 쓴 연결 계열 실패만 인내 모드로 넘어가 `Phase::WaitingNetwork`(serde `waitingNetwork`)를 알린다. 대기는 `min(base·2^k, patience_cap)` ±25%이고 `k`는 빠른 재시도의 지수에서 이어 간다(기본 8초 → 16초 → 30초 상한). `RETRY_BACKOFF_MAX_MS` = 30초. 두 상수는 foundations §14의 파일 열이 `Rust(core)`라 셸 `consts.rs`가 아니라 `retry.rs`에 있다(DT15가 `consts.rs`의 표 밖 상수를 실패시킨다). `RetryPolicy`에 `patience`·`patience_cap`이 생겼고 `Default`는 30분·30초, `none()`은 0·0이다(0이면 인내가 없고, 테스트가 30분을 기다리지 않는다).
    - **진전이 시계를 되돌린다.** `.part`의 바이트가 늘면(progressive는 청크를 쓸 때, segmented는 세그먼트를 쓸 때) 빠른 재시도 횟수와 인내 장부를 0으로 하고 phase를 `Downloading`으로 돌린다. 연결이 돌아왔지만 아직 바이트가 없는 동안은 `WaitingNetwork`다.
    - **잠든 시간을 세지 않는다.** 소비 = Σ(요청한 대기 시간) + Σ min(시도 한 번에 걸린 시간, `patience_cap`). 덮개를 닫은 노트북처럼 시도 하나가 몇 시간으로 재어져도 30초만 센다. 깨어남·연결 복구 OS 신호는 Tauri에 없어 쓰지 않는다. 마지막 대기는 남은 예산으로 줄여, 예산이 끝나는 시각에 시도가 한 번 더 일어난다. 소비가 예산 이상이면 마지막 오류로 끝낸다(`.part`는 `is_resumable`대로 남는다). 장부는 `retry::Patience`이고 순수해서 실제 상수(29분 통과·31분 실패)를 시간을 기다리지 않고 단위 테스트한다.
    - **적용 범위.** progressive 루프, segmented는 `fetch`(buffered 안, Reporter 없음)의 빠른 5회를 그대로 두고 스트림 밖으로 나온 연결 계열 `Retry`를 job 루프가 받아 `drop(segs)` → phase → 대기 → `continue 'refresh`(`next`부터, 403 재조회와 같은 패턴), `acquire`/`load`의 playlist·init 연결 실패, 작업 안의 `Job::resolve`(처음·403 재조회; 빠른 5회를 조용히 한 뒤 인내). 대기는 `Job::sleep`이라 취소가 즉시 먹는다.
    - **홈 카드의 대화형 `Chzzk::resolve`는 바꾸지 않는다.** 사용자가 30분을 기다리면 안 된다. 인내는 `Job` 안에서만 일어난다.
    - 셸은 `PhaseTs::WaitingNetwork`로 옮기고, 실패 단계(`stage_of`)는 `Download`로 센다. 인내를 다 쓴 네트워크 실패만 `failed`가 되므로 셸의 `notify.stalled` 판정은 `failed` + `ErrorCode::Network`다. 테스트는 `crates/core/tests/patience.rs`(단절은 wiremock 앞의 `common::GateProxy`가 만든다. 예산은 1초대로 줄였다).
57. **(디자인 시스템 (f), platform.md §16) 파일 이름 규칙은 저장 폴더가 놓인 볼륨 기준이다.** 코어 API는 바뀌지 않는다(`naming::Platform` 인자는 그대로). 셸이 `chzzk_shell::volume::platform_for_dir(&폴더)`로 고른다: host가 Windows이면 Windows, 그 밖에서는 폴더(또는 가장 가까운 존재하는 조상)의 파일 시스템이 FAT·exFAT·NTFS·원격(SMB·NFS·WebDAV)이거나 알 수 없으면 Windows 규칙, 유닉스 계열 파일 시스템이면 host 규칙이다. 감지에 실패하면 Windows 규칙이다(Windows 규칙이 더 엄격해 어느 볼륨에서도 만들 수 있다). 대상은 `manager`의 `output_path`·`check_output`과 `services`의 `resolve`(제안 파일 이름)이고, `AppInfo.platform`(화면 OS)은 그대로다. 볼륨의 block/warn 검사(FAT32 4GiB·여유 공간·경로 길이)는 이월이다.
58. **(생방송 녹화, 브랜치 `feat/live-download`) 진행 중인 생방송을 받는다.** 사용자 결정: 방송이 끝나거나 사용자가 멈출 때까지 받고(고정 길이·리와인드 구간은 이번 범위 밖), 코어·셸·GUI를 함께 한다. 공식 Open API에는 재생 주소가 없어(`/open/v1/lives`는 목록뿐) 웹이 쓰는 `service/v3/channels/{channelId}/live-detail`을 읽는다. 실물 구조는 사용자 결정(MCP·문서 + 합성 fixture)의 예외로 방송 중인 공개 채널 하나에 읽기 전용으로 한 번 확인했고(세그먼트는 받지 않았다), 값은 어디에도 옮기지 않았다. fixture는 `testdata/live/`의 합성이다(`gen-fixtures.mjs`).
    - **주소·모델.** `https://chzzk.naver.com/live/{32자리 hex}` → `ContentRef::Live { channel_id }`(소문자). `ContentKind::Live`, `PlaybackKind::Live`, `Source::Live { master_url, tracks, live_id }`. 새 오류 `Error::NotLive`(`status != "OPEN"`, kind `notLive`).
    - **`live-detail` 파서는 `classify`와 별개다**(`info::parse_live_detail`). `livePlaybackJson`은 JSON을 담은 문자열이고, media 둘(`HLS`·`LLHLS`)이 모두 `protocol: "HLS"`라서 **`mediaId == "HLS"`로 고른다**(순서에 기대지 않는다. fixture에 LLHLS가 앞선 변형이 있다). `audioOnly` 트랙은 화질에서 뺀다. `livePlaybackJson`이 없으면 `NoPlayback { adult }`.
    - **실측한 playlist 모양.** media playlist는 2초 fMP4 세그먼트 약 20개(≈40초)가 `EXT-X-MEDIA-SEQUENCE`로 밀리는 창이고 `ENDLIST`가 없다. 세그먼트 URI는 상대 경로, `EXT-X-MAP`의 init은 한 개다. 서명은 master 쿼리(`hdnts`)와 variant 경로(`hdntl`)에 있고 비로그인으로 받아진다.
    - **hls.** `parse_live_media`가 `LiveSnapshot { playlist, ended }`를 낸다. `ENDLIST` 없음·세그먼트 0개를 허용하고, `DISCONTINUITY`·두 번째 `MAP`은 오류가 아니라 `ended`(그 앞 세그먼트까지만 담는다). 암호화·BYTERANGE·GAP·SKIP은 그대로 거부한다. VOD용 `parse_media`의 동작과 기존 테스트는 그대로다.
    - **엔진(`download/live.rs`).** `next_msn` 기준으로 새 세그먼트만 순서대로(`buffered`) 이어 쓴다. 창이 `next_msn`을 지나가면 놓친 수를 `Progress.live.gaps`로 세고 계속한다(실패하지 않는다). 끝나는 조건: `ENDLIST`·스트림 재시작(DISCONTINUITY·새 MAP·msn 역행·init 경로 변경)·재조회가 `NotLive`·`liveId` 변경(다른 방송을 이어 붙이지 않는다)·`live_stop`. playlist가 403·404이면 재조회하고, 새 세그먼트를 받을 때마다 `Job::refreshes`를 0으로 되돌린다(몇 시간 녹화에서 일시적 403이 쌓여 `MAX_REFRESHES`에 걸리지 않게). 새 세그먼트가 `live_idle_check`(30초) 없으면 재조회로 종료 여부를 본다. 폴링은 `live_poll_interval`(1초). 연결 계열 실패는 기존 `Patience`를 쓴다.
    - **멈춤과 취소는 다르다.** `DownloadRequest.live_stop`(`Option<CancellationToken>`)이 취소되면 받은 만큼 최종 파일로 마무리하고 `Completed`다. `cancel`은 예전처럼 `.part`를 남기고 `Cancelled`다. 아무것도 받지 못하고 끝나면 init만 든 파일을 남기지 않는다(멈춤 `NothingRecorded`, 방송 종료 `NotLive`).
    - **이어받기는 없다.** 끊긴 `.part`는 같은 요청을 다시 부르면(`download::run`) 받은 만큼을 마무리한다(방송 흐름이 끊겨 이어 붙일 수 없다). `HlsState`·sidecar는 그대로 쓰고 `kind = Live`다.
    - **파일 이름.** `[생방송 YYMMDD-HHMM] {채널} - {제목}.mp4`(`live_open_date`의 KST 시각, `naming::parse_live_time`). 시각이 없으면 날짜만, 날짜도 없으면 `[생방송]`. 같은 방송을 다시 받으면 같은 이름이라 기존 중복 정책(건너뜀·덮어쓰기)이 적용된다.
    - **`Progress.live`.** `LiveProgress { recorded_secs, gaps }`. 전체 길이·ETA가 없다.
    - **알려진 한계(사용자 실기 확인 항목).** 라이브 init에 세그먼트를 이어 붙인 fMP4는 일부 플레이어에서 탐색(seek)이 안 될 수 있다(`moov` 안 길이 정보가 없다). 실서버 스모크 `tests/live_record.rs`는 사용자가 방송 중인 본인 채널로 `#[ignore]`로 돌린다.
    - 테스트는 `tests/recording.rs`(wiremock 상태 기계: ENDLIST·멈춤·취소 후 `.part` 마무리·gap·403 재조회 12회·방송 교체·종료 재조회·DISCONTINUITY·idle·시작 직후 세그먼트 0개·`resolve`)다. 종료 조건·gap 세기·재조회 횟수 리셋을 하나씩 깨 보고 해당 테스트가 실패(또는 멈춤)하는 것을 확인했다.
59. **(생방송 리뷰 반영, 58의 수정) 오래 녹화할 때 받은 것을 잃지 않는 쪽으로 고쳤다.** Codex 대신 Claude 서브에이전트 둘(일반·적대적)이 낸 지적 중 코드로 재현되는 것을 실패하는 테스트(`tests/recording.rs` 후반, `manager_live.rs`)로 먼저 고정했다.
    - **어떤 오류로 끝나도 받은 `.part`를 지우지 않는다.** 엔진이 `.part`를 만든 직후 `Job::keep_partial`을 켠다(암호화 태그·4xx 같은 `is_resumable() == false` 오류가 몇 시간 녹화를 지우던 구멍). 다음 실행이 받은 만큼 마무리한다.
    - **유휴 재조회는 403 재조회 예산을 쓰지 않는다**(`refresh_free`). 방송이 몇 분 쉬어도 `RefreshExhausted`로 죽지 않는다. 방송이 끝났는지는 계속 본다.
    - **기다리는 동안에도 멈춤이 먹는다.** 첫 playlist·init, 연결 대기(`wait_for_network`), 재조회 모두 `live_stop`을 함께 기다린다(`until_stop!`). 첫 playlist가 404이면(방송 시작 직후) 재조회 예산을 몇 ms에 쓰지 않고 `live_poll_interval`마다 기다린다.
    - **init만 든 `.part`(세그먼트 하나도 받기 전에 끊김)와 0바이트 `.part`는 마무리하지 않는다.** 지우고 새로 녹화한다(`download::run`). 세그먼트가 하나라도 있는 `.part`만 마무리한다.
    - **msn 역행은 연달아 3번(`BACK_CONFIRM`) 봐야 스트림 재시작이다.** CDN 엣지가 한 번 낡은 playlist를 줘도 녹화가 끝나지 않는다. init 비교는 주소의 **파일 이름**만 본다(서명이 경로에 들어가는 주소를 갱신해도 재시작이 아니다).
    - **일시 오류(5xx를 다 쓴 재시도·본문 검증 실패)는 구멍으로 세고 계속한다.** 연달아 10번(`MAX_FLAKY`)이면 오류로 끝나고 `.part`는 남는다. playlist 읽기도 같다. 지원하지 않는 형식(암호화 등)은 바로 오류.
    - **연속 일시 오류 카운터는 둘이다**(`flaky`: playlist·init 읽기, `seg_flaky`: 세그먼트). 서로의 성공으로 되돌리지 않는다. 처음에는 하나였는데 playlist 읽기가 성공할 때마다 0이 되어, 모든 새 세그먼트가 5xx인 서버를 만나면 한도(10)에 영영 닿지 않고 녹화가 끝나지 않았다(커버리지용 테스트 `many_consecutive_bad_segments_end_with_error`가 멈추면서 드러났다).
    - **멈춤이 오면 이미 요청한 세그먼트를 최대 3초(`DRAIN`) 마저 받아 쓴다**(마지막 몇 초가 잘리지 않게).
    - **셸: `.part`가 없는 생방송은 자동 이어받기에서 뺀다.** 앱이 비정상 종료돼 `interrupted`로 복원된 생방송을 시작 때 자동으로 다시 줄 세우면 지금 방송 중인 다른 방송을 옛 제목·시각의 파일로 녹화한다. 받은 부분이 있는 것은 그것을 마무리하는 것이라 줄 세운다. 수동 [이어받기]·[다시 시도]는 그대로다.
    - **알려진 한계(이번에 고치지 않았다).** ① 같은 방송을 다시 받으면 파일 이름이 같다(시작 시각 기준). 받기 카드의 `check_output`이 번호 붙이기를 기본으로 제안하므로 보통은 겹치지 않지만, 코어는 충돌을 스스로 피하지 않는다(`Skip`이면 `Skipped`, 녹화 도중 같은 이름이 생기면 마무리가 `Skipped`로 끝나고 `.part`가 남는다). ② 일시 404를 구멍으로 확정한다(최신 조각이 엣지에 아직 없을 때). 실서버 확인 뒤 판단한다. ③ init 내용(해상도·SPS/PPS)은 비교하지 않는다. ④ 첫 playlist에 DISCONTINUITY가 남아 있으면 그 앞까지만 받는다. ⑤ 구멍 수는 완료된 항목에 남지 않는다. ⑥ 디스크 여유·FAT32 4GiB 사전 검사 없음(core.md 57 이월). ⑦ [이어받기] 한 버튼이 "받은 부분까지 저장"을 뜻하는 것은 ADR-0025 재검증 조건이다.

60. **(생방송 녹화, 58·59에 이어) 생방송 결과를 일반 mp4로 변환한다.** 생방송 HLS의 init(`ftyp`+`moov`(mvex))과 `styp`·(`moof`·`mdat`·`emsg`) 조각을 그대로 이어 붙인 파일은 macOS QuickTime(AVFoundation)이 첫 조각 길이(1~10초)만 보고 멈추며 탐색이 안 된다. `mvhd`/`mehd`에 길이를 넣고 `tfdt`를 0으로 바꾼 조각 구조로도 고쳐지지 않아(실물로 확인), 샘플 표(`stbl`)를 가진 일반 mp4로 바꾼다. 모듈은 `download::defrag`(`pub fn defragment(&mut File) -> Result<DefragReport, Error>`, 수동 확인 예제 `examples/defrag.rs`).
    - **복사 없이 제자리.** (1) 최상위 상자는 헤더만 seek로 훑고 `moov`·`moof` 본문만 읽어(`mdat` 본문은 읽지 않는다, 메타 상자 상한 64 MiB) 전부 검증한 뒤 새 `moov`를 메모리에서 완성한다. (2) 새 `moov`를 파일 끝에 붙이고 `sync_data`. 실패하면 `set_len`으로 원래 길이로 되돌린다(되돌리기 자체가 실패하는 경우와 (3) 패치 단계에는 복원이 없었다. 61에서 `DefragError`로 나눈다). (3) 마지막에 원래 init `moov`·`moof`·`styp`·`emsg`와 모르는 상자(`sidx`·`mfra` 등)의 4바이트 종류만 `free`로 바꾼다(오프셋 오름차순으로 몰아서, 그리고 sync). 데이터는 움직이지 않는다. `ftyp`·`mdat`·`free`·`skip`은 그대로다. `ftyp`는 바꾸지 않는다: 실물의 brand는 `iso6`뿐이고(조각 전용 brand인 `dash`·`cmf*`가 없다) 변환 결과를 ffprobe·ffmpeg가 그대로 읽는다. 결과는 `moov`가 파일 끝에 있는 일반 mp4다(로컬 재생용, 네트워크 스트리밍의 빠른 시작은 고려하지 않는다).
    - **새 `moov`.** init의 `mvhd`(duration·next_track_ID 갱신), 트랙마다 `tkhd`(duration), `edts/elst`, `mdia{mdhd(duration), hdlr, minf{vmhd|smhd, dinf, stbl}}`. `mvex`는 뺀다. `stbl`은 init의 `stsd`를 그대로 두고 `stts`·`ctts`(오프셋이 모두 0이면 생략)·`stss`(동기 샘플만, 모두 동기면 생략)·`stsc`·`stsz`(모두 같으면 상수)·`stco`(청크 오프셋이 4 GiB 이상이면 `co64`)를 새로 만든다. duration이 32비트를 넘으면 그 상자를 version 1로 바꿔 쓴다. 샘플이 없는 트랙은 뺀다.
    - **샘플 출처.** `tfhd`(base_data_offset·기본 sdi·duration·size·flags) → 없으면 init `trex` 기본값, `trun`(data_offset·first_sample_flags·샘플별 duration·size·flags·cts, version 1이면 cts는 부호 있음). 데이터 기준은 `base_data_offset` → `default-base-is-moof`면 moof 시작 → 둘 다 없으면 첫 traf는 moof 시작, 다음 traf는 앞 traf 데이터 끝(ISO 14496-12 8.8.7). `trun` 하나가 청크 하나이고 `stsc`는 run-length로 줄인다. 모든 청크가 어떤 `mdat` 본문 안에 있는지 확인한다. `senc`(암호화 조각)는 거부한다.
    - **시각.** 트랙마다 첫 `tfdt`가 방송 시작 기준이라 크다. `stts`는 0부터 샘플 길이만 담고, 트랙 사이의 시작 차이는 `elst`로 남긴다: 가장 이른 트랙의 첫 표시 시각을 0으로 보고, 늦게 시작하는 트랙에는 그 차이만큼 빈 편집(`media_time = -1`)을 앞에 둔다. 음수 cts(version 1 `trun`)는 트랙 전체를 상수만큼 밀어 0 이상으로 만들고(`ctts` version 0), 첫 표시 샘플은 `elst`의 `media_time`(dts + cts의 최솟값)이 가리킨다. 전체 길이는 movie timescale로 (시작 지연 + 트랙 길이)의 최댓값.
    - **멱등.** 최상위에 `mvex` 없는 `moov`가 있으면 `AlreadyFlat`, `moof`가 없으면 `NotFragmented`로 아무것도 하지 않는다.
    - **연동.** `download::finish`가 생방송(`PlaybackKind::Live`)이면 마지막 checkpoint 뒤 `PartFile::with_file`(버퍼를 비우고 같은 잠긴 핸들을 빌려주며, 끝나면 `written`을 실제 파일 길이로 맞춘다)로 변환하고 다시 checkpoint한다(붙인 `moov`까지 `committed_len`에 넣어, 마무리가 `Skipped`로 끝나 `.part`가 남아도 다음 `resume`이 자르지 않게). `live::run`의 정상 마무리와 `download::run`의 "끊긴 `.part` 마무리"가 둘 다 `finish`를 거치므로 같은 변환을 탄다. 변환 실패(가짜 바이트·잘린 파일·모르는 구조)는 파일을 바꾸지 않고 `tracing::warn!`만 남겨 조각 구조 그대로 마무리한다.
    - **한계.** ① `tfdt`가 끊긴 구간(놓친 조각)은 타임라인을 당겨 붙인다(`stts`는 샘플 길이만 담는다). 앞 조각 끝과 0.1초 넘게 어긋난 수를 `DefragReport::Converted::discontinuities`로 센다(오디오 `tfdt`가 반올림으로 ±1틱 흔들리는 것은 세지 않는다). 구멍 뒤 오디오·비디오 싱크가 그 길이만큼 어긋날 수 있다. ② 크래시 복구: (2) 도중 크래시는 `committed_len`이 붙인 `moov`를 잘라 준다. (3) 도중 크래시로 종류 일부만 `free`로 바뀐 파일은, `free`의 첫 자식이 `mfhd`면 `moof`, `mvhd`(+`mvex`)면 init `moov`로 알아보고 다시 변환한다(테스트 `crash_during_patches_then_resume_truncation_reconverts_identically`). `free`로 바뀐 `styp`·`emsg`는 원래 무시할 상자라 문제없다. 두 번째 checkpoint 뒤·rename 전 크래시는 다음 실행이 `AlreadyFlat`으로 넘어간다. ③ 변환은 메모리에 샘플 표를 쥔다(샘플당 크기 4바이트 + run-length 표, 수 시간 녹화에서 수 MB). ④ `moov`가 파일 끝에 있다.
    - **확인.** 단위 테스트(`download/defrag/tests.rs`)는 합성 fixture `testdata/live/synthetic_frag.mp4`(ffmpeg lavfi 합성, 생성기 밖 정적 파일)와 손으로 만든 바이트(traf·trun 여러 개, largesize, 모르는 상자, tfhd/trex 기본값 분할, 절대 base, version 1 음수 cts, 트랙 시작 차이, tfdt 구멍, 잘린 파일, 크래시 중간 상태)로 샘플 수·길이·바이트 범위·stss·elst를 원본 trun과 비교한다. 통합은 `tests/recording.rs`가 fixture 조각을 세그먼트로 서빙해 녹화 결과가 일반 mp4인지(정상 마무리·끊긴 `.part` 마무리) 본다. 실물(720p60 H.264 + AAC, 약 54초)은 변환 뒤 ffprobe 길이 54.02초, 비디오 3240프레임·시작 0.0218초(오디오와의 시작 차이 22 ms 보존), ffmpeg 디코드 오류 0이었다(실물은 저장소에 넣지 않는다).
   - 검증 반영: 끝 상자의 size가 0(파일 끝까지)이면 붙인 moov를 삼키므로 변환하지 않고 원본을 둔다(`Error::Parse`). 샘플별 필드가 없는 trun은 기본 크기로 mdat 범위를 먼저 대조하고 기본 크기 0이면 샘플 수 상한(65536)을 둔다(메모리 보호). `finish`는 변환이 `Converted`일 때만 checkpoint하고 실패는 경고만 남긴 채 마무리한다. 변환은 `spawn_blocking`(`PartFile::with_file_blocking`)에서 돈다. 취소는 변환 중에는 확인하지 않는다(한계).
61. **(생방송 사후 점검 ⑤ fix, 2026-10-16) 녹화 안전 수정.** v0.7.0 사후 점검(F1·F2·F4·F5, M1~M5)에서 나온, 받은 녹화를 잃거나 엉뚱하게 마무리하는 경로를 막는다. 사용자 데이터·계약을 깨지 않도록 sidecar·`jobs.json`에는 선택 필드만 더했다(patch).
    - **F1 `live_stop`이 먹는 곳 셋.** `live.rs`의 세그먼트 403 뒤 재조회, 반복 playlist 읽기, `download::run`의 첫 resolve. 모두 `select!`로 멈춤을 함께 기다린다(공통 fetch 도우미는 `cancel`만 본다). 받은 조각이 있으면 받은 만큼 마무리하고, 없으면 `NothingRecorded`다.
    - **M5·M1 `.part`의 주인.** 생방송 작업마다 16바이트 난수 hex `recording_id`를 셸이 `enqueue`에서 만들어 `JobRecord`(선택 필드 `recordingId`)와 `DownloadRequest::recording_id`에 싣고, 코어는 새 `.part`의 sidecar(`recording_id`, `skip_serializing_if`)에 적는다. 방송 ID(`Source::Live.live_id`)는 쓰지 않는다: 옛 파일 마무리는 resolve보다 먼저 하므로 그 시점에 아직 모르고, 같은 방송을 다시 붙여넣는 경우(7-b)도 새 녹화여야 한다. 소유 판정은 `PartOwner`(content·quality·kind·recording_id)로 한다. `Sidecar::owned_by`는 `same_job`에 더해 **생방송이면 `Option<String>` 같음**이 맞아야 한다(옛 작업 None + 옛 sidecar None = 내 것, 새 작업 Some + 옛 sidecar None = 남의 것, 옛 작업 None + 새 sidecar Some = 남의 것, Some = Some = 내 것). 그래서 v0.7.0 jobs.json·sidecar의 `interrupted`·`failed` 녹화는 업그레이드 뒤에도 이어받기로 그대로 저장된다(셸 테스트 `v070_failed_recording_upgrade`). `SIDECAR_VERSION`은 1 그대로다(올리면 v0.7.0 녹화가 모두 `same_job` 불일치가 된다).
        - `PartFile::resume(final, &PartOwner)`: sidecar가 **생방송이고 내 것이 아니면**(`is_other_recording`) 아무것도 지우지 않고 잠금만 풀어 `Error::PartialRecording{path}`(`is_resumable() == true`: 지우면 안 된다)다. 남의 VOD sidecar는 지금처럼 지우고 새로 받는다(화면 `conflict.partialOther`가 약속한 동작). VOD 요청이 같은 경로의 생방송 녹화를 지우던 경우(N4)도 같은 규칙으로 막힌다.
        - `discard_partial(final, &PartOwner) -> Discarded{Removed, NotOwned}`: **모든 sidecar**에 소유를 확인한다. 내 것이 아니면 `NotOwned`로 아무것도 지우지 않고, sidecar가 없거나 깨졌으면 주인을 모르는 파일이라 지운다(생방송 `.part`는 `create`가 sidecar를 곧바로 쓴다). sidecar를 **읽지 못하면**(권한·Windows 공유 위반 등, 없음과 다르다) `resume`·`discard_partial` 모두 아무것도 지우지 않고 `Error::Io`(이어받을 수 있다)다(`read_sidecar`의 세 상태, 테스트 `unreadable_sidecar_is_error_not_orphan`). 셸 `remove`·`run_download`의 "처음부터"가 이것을 쓴다.
        - 셸 `resume(restart = true)`는 받다 만 녹화(생방송 + `partial_bytes`)를 `invalidInput`으로 거부한다. 화면은 그 버튼을 보이지 않고(D8), 화면 밖 호출·늦게 그려진 버튼을 셸에서 막는다.
        - ②-1 range 트랙의 sidecar 변경(v2)은 `recordingId`를 옮겨 간다. range가 `resume`에 인자를 더하려던 계획은 **`PartOwner`에 필드(`range`)를 더하는 것**으로 바꾼다. 그러면 `resume`·`owned_by`·`discard_partial`의 시그니처가 두 트랙에서 엇갈리지 않는다.
    - **M3 자동 이어받기.** `Sidecar::has_live_media`(생방송이고 `hls.init_len > 0`이고 `committed_len > init_len`) 한 규칙을 `download::run`(끊긴 `.part` 마무리 여부)과 셸 자동 이어받기(`live_media_ready`)가 같이 쓴다. init만 든 `.part`는 코어가 지우고 지금 방송을 새로 녹화하므로 자동으로 줄 세우지 않는다. 셸 `jobs::partial_bytes`도 생방송은 이 규칙일 때만 값을 준다: 그래서 실패한 작업이 경로를 잡는지(`keeps_recording`), 화면의 받은 부분 안내·[이어받기]·[처음부터] 막기가 모두 같은 규칙이다(init만 든 실패 녹화는 "다시 시도"이고 같은 이름을 막지 않는다).
    - **M4 변환 도중 실패.** `defrag::defragment_in`이 실패를 `DefragError{Unchanged, Modified}`로 나눈다. 구조 검증 실패(읽기 입출력 오류는 2회차 리뷰 ②부터 `Modified`)와, 덧붙인 moov를 `set_len`+`sync`로 되돌리는 데 성공한 경우는 `Unchanged`(조각 구조로 마무리, 이전과 같다). 되돌리기가 실패했거나 종류 패치(3단계) 도중 실패했으면 `Modified`이고 `finish`가 마무리하지 않고 `.part`로 남긴다(`defrag_verdict`). 이때 `PartFile::drop_uncommitted_tail`이 `written`을 변환 전 `committed_len`으로 되돌려, 뒤따르는 정리 checkpoint가 반쯤 붙은 moov를 `committed_len`에 넣지 않게 한다(다음 `resume`이 꼬리를 자르고 다시 변환한다). 덧붙이기 실패를 모두 보존으로 돌리지 않은 이유: FAT32 4 GiB 근처에서 moov 덧붙이기가 늘 EFBIG로 실패하면 녹화를 영영 저장할 수 없다.
    - **F4 파일 크기 한도.** `Error::FileTooLarge{path}`·`ErrorKind::FileTooLarge`(Unix EFBIG 27, Windows `ERROR_FILE_TOO_LARGE` 223, `io::ErrorKind::FileTooLarge`). `is_resumable() == true`라 `.part`는 남고, 실패한 쓰기는 `written`을 늘리지 않아 checkpoint가 받은 만큼만 기록한다(`PartFile::write_using` seam 테스트). 다음 실행이 받은 만큼 마무리한다. 자동 분할(새 파트)은 하지 않는다(59 한계 ⑥ 유지).
    - **F5.** LL-HLS 태그 다섯(`PART`·`PART-INF`·`PRELOAD-HINT`·`SERVER-CONTROL`·`RENDITION-REPORT`)은 조용히 무시한다(폴링마다 경고가 쌓이던 것). 그 밖의 모르는 태그는 `warn!`이다. 생방송 서명(`hdnts`·`hdntl` 경로 토큰)이 로그·오류·진행률·sidecar·`resolve` 결과 `Debug`에 없는지 `tests/live_secrets.rs`가 끝에서 끝까지 본다(회귀 방지, 양성 대조로 서명 경로를 실제로 탔는지 확인).
    - 알려진 한계: 첫 목록 전체를 받는다(약 40초 앞부터, `live.rs`). 설계와 다르지만 그대로 둔다. 옛 앱(≤0.7.0)으로 되돌리면 새 sidecar의 `recordingId`를 모르고 v0.7.0 규칙대로 판단한다. **주인 레코드를 잃은 녹화는 앱에서 저장도 삭제도 못 한다**(파일은 지우지 않는다): (가) `jobs.json`이 깨져 `jobs.json.bad-{ts}`로 옮겨지고 빈 목록으로 시작하면, `recordingId`가 있는 녹화 `.part`는 모두 남의 것이 된다(카드는 번호 이름으로 받고, `resume`은 `PartialRecording`, `remove`는 `NotOwned`). (나) 0.7.1 이후로 녹화한 뒤 0.7.0으로 되돌린 동안 `jobs.json`이 다시 저장되면(0.7.0 `JobRecord`는 모르는 필드를 버린다) 그 작업의 `recordingId`가 사라져, 다시 올린 뒤에는 기록 None + sidecar Some(D2의 ③ 남의 것)으로 자기 `.part`도 저장하지 못한다. 손으로 되살리려면 `.part`를 `이름.mp4`로 바꾼다(조각 구조 fMP4 그대로라 일반 mp4 변환은 되지 않고, 크래시 꼬리도 잘리지 않는다). 주인 없는 녹화를 저장하는 동작(예: sidecar가 생방송이고 맞는 레코드가 없을 때 "이 녹화 저장")은 D2 계약을 바꾸므로 이번에 넣지 않고 열린 항목으로 둔다. VOD `fileTooLarge`의 [이어받기]는 같은 저장 장치에서 다시 실패한다(작업 경로는 추가할 때 정해진다, content.md §15.2 알려진 한계). 사용자가 녹화 `.part`를 손으로 지우면 그 실패 작업이 다음 reconcile 전까지 경로를 잡는다.
    - **리뷰 반영(Codex, PR #113).**
        - **연속 변환 실패(M4 보강).** 앞선 시도가 init `moov`나 `moof`를 이미 `free`로 바꾼 채 `.part`로 남으면(`Modified`), 다음 `resume`이 붙인 moov만 잘라도 파일은 원래 조각 구조가 아니다(진짜 `moov`가 없을 수 있다). 그래서 `plan`이 `free` 안의 `mfhd`·`mvhd`(+`mvex`)를 되살렸으면 `Plan::resumed`를 켜고, 이번 시도의 덧붙이기 실패는 잘라 되돌려도 `Unchanged`가 아니라 `Modified`다(`.part`로 남고 다음 실행이 다시 변환한다). 앞선 시도가 아무 패치도 못 했으면 그대로 `Unchanged`다(테스트 `append_failure_after_earlier_patch_is_not_unchanged`·대조 `…_patchless_attempt_is_unchanged`). 바뀐 파일의 계획 단계에서 읽기 입출력 오류가 나는 틈은 2회차 리뷰 ②에서 막았다(아래). 대가: 앞선 시도가 패치한 파일에 덧붙이기가 계속 실패하면(디스크 부족·`FileTooLarge`) 이제는 늘 `Modified`로 `.part`에 남는다(전에는 손상 파일로 완료됐다). 위 M4의 FAT32 근거(덧붙이기 실패를 모두 보존으로 돌리지 않는다)는 패치 전 파일에만 그대로이고, 이미 패치된 파일은 공간을 마련해 다시 시도해야 저장된다(Codex 확인).
        - **`create`의 소유 재확인.** `resume`이 `None`을 준 뒤 첫 응답을 기다리는 사이(생방송은 연결 대기 최대 30분) 다른 작업(셸 중복 검사 밖: 다른 프로세스·코어 직접 호출)이 같은 경로에 녹화를 남기고 잠금을 풀 수 있다. `PartFile::create`는 잠금을 쥔 뒤 sidecar를 다시 읽고, 넘겨받은 sidecar로 만든 `PartOwner`에게 **다른 작업의 생방송 녹화**면(`is_other_recording`) 자르지 않고 `PartialRecording`이다. 읽지 못하면 자르지 않고 `Io`, 남의 VOD·주인 없는 `.part`는 지금처럼 자른다(테스트 `create_refuses_recording_left_meanwhile`·`create_truncates_other_vod_or_orphan_part`). Windows `finalize`가 rename 직전 잠금을 푸는 틈은 구조를 바꾸지 않았다(실기 검증 없이 열린 파일 rename으로 바꾸지 않는다). sidecar는 rename 뒤에 지우므로 그 틈에 들어온 `resume`·`create`·`discard_partial`도 소유를 다시 보고 남의 녹화를 건드리지 않는다(rename 뒤 sidecar를 지우기 전의 틈은 아래 "짝 잃은 sidecar").
        - **짝 잃은 sidecar(위 소유 재확인의 보강).** 소유 재확인 뒤로 `.part` 없이 남은 남의 녹화 sidecar가 경로를 영영 막았다: `finalize`가 옮긴 뒤 sidecar 삭제에 실패(Windows 백신·인덱서)했거나 사용자가 `.part`만 지웠으면, `resume`은 `.part`가 없어 `None`을 주고 `create`는 빈 `.part`를 만든 뒤 그 sidecar를 보고 `PartialRecording`이었다(재시작해도 같다). 그 빈 `.part` 때문에 셸 `partial_bytes`가 끝난 옛 기록을 [이어받기]로 되살리기도 했다. 그래서 (1) `create`는 **잠근 `.part`가 비었으면 남은 sidecar를 덮어쓴다**(지킬 데이터가 없다. 처음에는 `create_new`로 새로 만든 파일이면 sidecar를 보지 않았으나 2회차 리뷰 ①로 잠근 뒤 길이로 판단하도록 바꿨다, 아래). `finalize`가 rename을 마치고 sidecar를 지우기 전 틈(Windows는 잠금을 푼 뒤, Unix도 rename으로 inode가 옮겨 가 새 `.part`를 잠글 수 있다)에 들어온 `create`도 이제 헛실패하지 않는다. (2) `Sidecar::describes(part_len)`(`part_len >= committed_len`): 불변식(`committed_len` ≤ durable 길이) 때문에 더 짧은 `.part`는 그 sidecar의 파일이 아니다. `resume`·`create`·`discard_partial`은 남의 sidecar라도 이 조건일 때만 지키고, 셸 `partial_bytes`도 이 조건일 때만 받은 부분으로 센다(이미 남은 빈 `.part` + 남의 sidecar도 풀린다). (3) `finalize`는 지우기 전에 sidecar를 다시 읽어 **다른 주인의 것이거나 읽지 못하면 지우지 않는다**(틈에 들어온 새 녹화가 첫 checkpoint 전에 주인을 잃지 않게. 읽기와 지우기 사이의 더 좁은 틈과 같은 주인끼리는 남는다). 셸 `free_name`·`partial_info`는 `.part`만 보는 그대로 둔다: 짝 잃은 sidecar는 이제 아무것도 막지 않는다(`partial_info`는 `describes`를 보지 않아, `create_new`와 sidecar 쓰기 사이에 죽어 남은 빈 `.part` + 남의 sidecar를 "녹화가 있다"로 보인다. 보수적인 안내일 뿐 코어는 그 `.part`를 자른다). 테스트 `create_overwrites_sidecar_left_without_part`·`other_recording_sidecar_on_shorter_part_is_not_protected`·`finalize_keeps_sidecar_of_new_owner`(코어), `part_shorter_than_committed_is_not_partial`(셸 reconcile).
        - **v0.7.0 옛 기록 여럿(셸).** v0.7.0은 실패한 작업의 경로를 새 작업에 내줬고 옛 기록·sidecar는 모두 `recordingId`가 없어(None = None) 한 녹화를 여러 기록이 함께 가리킬 수 있다(A는 init만 받고 실패, B는 조각을 받고 실패). 업그레이드 뒤 둘 다 `partial_bytes`가 있어 `keeps_recording`으로 서로 경로를 막던 것을, 다시 줄 세우는 세 곳(`resume_checked`·`resume_interrupted_where`·`cancel_quit`)이 `State::blocks_requeue`로 바꿔 **멈춰 있고 같은 주인(`PartOwner` 네 값이 같다)인 `keeps_recording` 기록은 막지 않는다**. 받는 중·줄 선·멈춘(paused·interrupted) 기록은 원래대로 막고, 새 녹화(`enqueue`)와 `remove`(다른 기록이 잡은 `.part`는 지우지 않는다)는 예외를 쓰지 않는다. 새 녹화는 고유값이 저마다 달라 이 예외에 걸리지 않는다(테스트 `v070_two_failed_records_do_not_block_each_other`·`…_remove_keeps_part`·`v070_failed_and_interrupted_records_auto_resume`). 한 기록이 그 녹화를 저장하거나 실패로 끝나면 `finish`가 같은 주인인 멈춘 옛 기록의 `partial_bytes`를 다시 센다(`refresh_siblings`): 저장해 `.part`가 없어졌는데 다른 기록이 받은 부분을 그대로 보이면, [이어받기]가 지금 방송을 옛 이름으로 새로 녹화해 방금 저장한 파일을 덮어쓸 수 있다(테스트 `v070_sibling_loses_partial_when_recording_is_saved`). 저장했으면 받은 부분이 없어진 그 옛 기록의 `onExisting = overwrite`도 `skip`으로 내린다: 그 기록을 다시 시도하면 지금 방송을 같은 출력에 새로 녹화하므로 덮어쓰기면 방금 저장한 녹화를 덮어쓴다(Codex 확인. 이 예외 전에도 B로 저장한 뒤 받은 부분이 남은 A를 다시 시도하면 같았다). 건너뛰기면 코어가 시작 때 녹화하지 않고 `skipped`이고, 덮어쓰려면 [덮어쓰고 받기]를 따로 누른다(`requeue`가 `overwrite`로 되돌린다). 멈춘(paused·interrupted) 옛 기록끼리는 v0.7.0처럼 서로 막는다.
        - **주인 기록을 저장한 뒤 녹화(셸).** 소유가 `jobs.json`의 `recordingId`에 기대는데 `enqueue`는 저장을 쓰기 스레드에 넘기기만 하고 바로 시작했다. 저장이 실패한 채(다운로드 폴더는 정상) 녹화하고 앱이 꺼지면 다시 열었을 때 주인 기록이 없어 그 `.part`를 저장도 삭제도 못 한다(위 알려진 한계 (가)가 정상 추가에서도 생긴다). 그래서 새로 추가한 생방송 작업(`Job::saved == false`, 파일에서 읽은 기록은 `true`)은 `run_download`가 코어를 부르기 전에 `Flusher::flush_checked`로 그 시점까지의 제출이 디스크에 닿았는지 확인한다(상태 잠금 밖 `spawn_blocking`, 취소와 `select!`). 실패하면 녹화를 시작하지 않고 마지막 쓰기 오류(`AppError::from`, 보통 `diskFull`·`io`)로 `failed`다(새 오류 코드 없음, `.part` 없음). 쓰기 스레드는 가장 최근 목록만 쓰므로 더 나중 제출의 성공도 성공으로 센다(그 목록에도 기록이 있다). VOD는 기다리지 않는다(다시 받을 수 있다). 테스트 `live_does_not_start_until_owner_record_is_saved`·`live_starts_after_owner_record_write_lands`(쓰기가 끝날 때까지 코어를 부르지 않는다)·대조 `vod_starts_even_if_jobs_json_save_fails`.
    - **리뷰 반영(Codex 2회차, PR #113).**
        - **① `create`의 열기·잠그기 틈.** 위 (1)의 "새로 만든 `.part`면 sidecar를 보지 않는다"는 `create_new`가 성공한 직후·`try_lock` 전에 B가 같은 파일을 열어 잠그고 자기 sidecar와 영상 조각을 checkpoint한 뒤 놓으면, A가 잠금을 얻고도 B의 녹화를 `set_len(0)`으로 잘랐다(독립 코어 호출·두 프로세스). 그래서 `create`는 새로 만들었는지와 관계없이 **잠근 뒤 늘 sidecar를 다시 읽고**, 다른 작업의 생방송 녹화가 그 바이트를 담고 있으면(`.part` 길이 > 0이고 `describes(len)`) 자르지 않고 `PartialRecording`이다. `.part`가 비었거나 `committed_len`보다 짧으면 지금처럼 덮어쓴다(짝 잃은 sidecar·첫 checkpoint 전에 죽은 `committed_len = 0` sidecar). 이미 있던 빈 `.part` 옆의 남의 `committed_len = 0` sidecar도 이제 막지 않는다(지킬 바이트가 없다). `open_locked_new`·`fresh`는 없앴다. 테스트 `create_rechecks_owner_after_lock_even_when_fresh`(열기와 잠그기 사이 seam `open_locked_using`)·대조 `create_overwrites_empty_orphan_sidecar`.
        - **② 계획 단계 읽기 입출력 오류.** `defragment_in`은 계획(`plan`) 실패를 모두 `Unchanged`로 바꿨다. 앞선 시도가 init `moov`를 `free`로 바꾼 채 `.part`로 남은 파일에서(`resumed`는 계획이 성공해야 안다) 다음 시도의 계획 읽기 한 번이 EIO로 실패하면 `Unchanged` → 조각 구조로 마무리 → 진짜 `moov`가 없는 파일로 `Completed`, sidecar까지 지웠다. 이제 **계획·길이 읽기의 입출력 오류(`Fail::Io`, `UnexpectedEof` 제외)는 `Modified`**다: 파일이 원래 조각 구조인지 확인하지 못했으니 `finish`가 마무리하지 않고 `.part`·sidecar를 남긴다(다음 실행이 다시 변환한다). 패치 전 파일이라도 같다(무엇을 읽었는지 모른다. 읽기 오류가 계속되면 녹화는 `.part`로 남고 사용자가 장치를 고친 뒤 이어받는다). 순수 구조 판정(`Fail::Bad`·잘린 파일의 `UnexpectedEof`, 가짜 바이트·모르는 구조)은 같은 바이트에서 결정적이라 지금처럼 `Unchanged`로 조각 구조 그대로 마무리한다(가짜 바이트 계약, 테스트 `plan_failure_is_unchanged` 그대로). 테스트 `plan_read_error_after_earlier_patch_is_not_unchanged`(Codex 재현: `Patch{after:1}` → `committed_len`으로 자름 → 첫 읽기 EIO → `Modified`, 아무것도 쓰지 않음, `defrag_verdict`가 `Err`라 `Completed`가 아니고 `.part`·sidecar가 남는다, 다음 시도는 같은 결과로 변환)·`plan_read_error_is_not_unchanged`. `finish`의 실제 `File`에는 읽기 오류를 주입할 seam이 없어 마무리 쪽은 `defrag_verdict`(+ 기존 `Modified` 경로 테스트)로 잇는다.
        - **④ sidecar 읽기 실패와 형제 기록(셸).** 셸 `jobs::read_sidecar`는 읽기 실패를 `None`으로 삼켜 `partial_bytes`가 "받은 부분 없음"이었다. 같은 녹화의 v0.7.0 옛 기록 A·B(`recordingId` None, `overwrite`)에서 sidecar를 잠깐 읽지 못하는 동안(Windows 공유 위반·권한 거부) B를 이어받으면 코어는 실패하고 녹화를 남기는데, 실패 처리와 `refresh_siblings`가 A·B의 받은 부분을 내렸다. 접근이 돌아와 B가 저장해도 A는 이미 `partial_bytes = None`이라 `refresh_siblings`(`keeps_recording`만 보던 조건)에서 빠져 `overwrite`가 남고, A의 다시 시도가 B가 저장한 녹화를 덮어썼다. 그래서 (1) `partial_bytes`는 sidecar를 **읽지 못하면 모르는 것**으로 보고 `.part` 길이를 준다(`read_sidecar_checked`: 없음·깨짐은 `Ok(None)`, 그 밖은 `Err`). 실패한 녹화가 경로를 계속 잡고(`keeps_recording`) [처음부터]도 막힌다. 불러올 때(`reconcile`)도 같다. 자동 이어받기(`live_media_ready`)는 sidecar를 읽어야 켜지므로 읽지 못하면 줄 세우지 않는다. 코어도 그 sidecar를 읽지 못하면 아무것도 지우지 않는다. (2) `refresh_siblings`는 받은 부분 표시와 관계없이 **같은 출력·같은 주인인 끝난(failed·skipped) 생방송 기록 모두**를 보고, 저장했으면 받은 부분이 없는 그 기록의 `overwrite`를 `skip`으로 내린다(받은 부분이 이미 내려간 기록도 놓치지 않는다). `.part` 자체의 `metadata` 실패는 지금처럼 없음으로 본다(sidecar보다 드물고 코어 `resume`이 같은 파일을 연다). 테스트 `v070_sibling_keeps_partial_while_sidecar_is_unreadable`(Codex 재현 1~7: 같은 자리 폴더로 읽기 오류 → B 실패 → A·B 받은 부분 유지·새 녹화 `duplicateOutput` → 접근 복구·B 저장 → A 받은 부분 없음 → A의 다시 시도는 `skip`)·`v070_sibling_without_partial_is_downgraded_when_recording_is_saved`·`unreadable_sidecar_is_unknown_not_none`(reconcile).
        - **③ 완료 뒤 sidecar 확인·삭제 틈(코드 변경 없음, 전제로 둔다).** `finalize`의 `remove_own_sidecar`가 sidecar를 읽어 내 것임을 확인한 뒤 지우기 전에, 다른 작업이 새 `.part`를 만들고(비어 있어 남은 sidecar를 덮어쓴다, 위 ①) 자기 sidecar와 영상 조각을 checkpoint하면 그 새 sidecar를 지운다. 그 작업이 다음 checkpoint 전에 비정상 종료하면 재시작한 `resume`이 sidecar 없는 `.part`로 보고 지운다. Codex 재현: (1) 다른 녹화 고유값의 A·B 요청이 파일 없는 시점의 사전 검사를 통과하고 B의 첫 응답을 늦춘다(B는 `overwrite`), (2) A가 녹화를 마쳐 `.part`를 옮기고 `remove_own_sidecar`가 A의 sidecar를 읽은 직후 멈춘다, (3) B가 새 `.part`를 만들어 남은 A sidecar를 덮어쓰고 자기 sidecar·조각을 checkpoint한다, (4) A가 이어서 B의 sidecar를 지운다, (5) B를 다음 checkpoint 전에 죽인다, (6) 재시작 뒤 B를 이어받으면 `.part`가 지워진다. 이 순서는 **같은 다운로드 폴더(같은 출력 경로)를 두 프로세스·두 독립 호출이 동시에 쓸 때만** 성립한다. 앱은 이를 전제로 막는다: 한 사용자 세션에 앱은 하나만 뜨고(`app/src-tauri/src/lib.rs` `tauri_plugin_single_instance`, 두 번째 실행은 기존 창에 포커스만 준다) 거의 동시에 뜬 두 실행이 플러그인을 함께 지나도 `<data>/app.lock`(`acquire_instance_lock`, 구현 중 변경 51(다))을 쥔 쪽만 `DownloadManager`를 연다(매니저 하나). 한 매니저 안에서는 `active_with_output`·`blocks_requeue`·`enqueue`의 중복 검사가 같은 출력의 두 활성 작업을 만들지 않는다(A가 완료 처리 중이면 활성이라 B가 같은 이름을 갖지 못한다). 그래서 이 틈은 고치지 않고(경로 단위 잠금 파일이나 sidecar 삭제를 `.part` 잠금 아래로 옮기는 구조 변경이 필요하다) 전제로 적는다. 남는 경우: `examples/dl.rs` 같은 독립 코어 호출을 앱과 같은 출력 폴더에 동시에 돌릴 때, 데이터 폴더가 다른 두 설치(예: 제품명이 바뀐 앞뒤 버전을 나란히 설치)가 같은 다운로드 폴더를 쓸 때, `app.lock`을 열거나 잠그지 못해(`Unavailable`) 잠금 없이 계속한 실행. 이 경우의 손실은 다음 checkpoint 전에 비정상 종료한 녹화의 받은 조각이다.
62. **(기능 ④ 채팅 함께 받기, chat.md §3.2-7·8, PR 2) `chat::part`: 채팅 기록 이어받기 파일.** `ChatPart`가 `{영상}.chat.jsonl.part`에 메시지 객체(`raw`)를 한 줄씩 덧붙이고 옆의 `.part.json`(`ChatSidecar`)에 이어받을 상태를 적는다. 구조는 `download::part`와 같다: 커밋 순서 줄 덧붙임 → `flush` → `sync_data` → sidecar 원자적 쓰기, 잠근 뒤에만 자르거나 비운다(`open_locked`, `remove_if_exists`를 `pub(crate)`로 넓혀 같은 코드를 쓴다).
    - **sidecar 내용.** 다음 커서, 경계 ms와 해시 개수표(multiset, `Vec<(해시, 개수)>`: JSON 키 제약을 피한다), 기록한 줄 수, 기록 중 가장 큰 재생 위치(`Completed.last_offset_ms`용), `committed_len`, 정상 끝 `end: Option<ChatEnd>`(`ChatEnd`에 serde를 더했다), 옮긴 보조 파일 이름 `moved`. `committed_len`은 늘 페이지 경계(줄 끝)다.
    - **재개.** `.part`가 `committed_len`보다 길면 자른다(쓰다 죽은 꼬리). sidecar가 없거나 깨졌거나 다른 영상이거나 `.part`가 더 짧거나 `committed_len` 앞 바이트가 줄바꿈이 아니면 잠금을 쥔 채 비우고 처음부터 시작한다(`restart`도 같다). 항상 `create`로 열어 "없을 때"와 "있을 때"를 한 길로 만들었다(만들기 경쟁이 없다). 설계의 "마지막 완전한 줄로 자르기"는 페이지 단위 커밋이라 `committed_len`으로 자르는 것과 같고, 줄 끝 검사로 sidecar와 파일이 어긋난 경우를 따로 막는다.
    - **한 줄 보장.** `raw`는 서버 JSON 그대로라 토큰 사이에 줄바꿈이 있을 수 있다. 문자열 안의 줄바꿈은 이스케이프되므로 남은 `\r`·`\n`은 모두 공백이고, 공백으로 바꿔도 같은 JSON이다.
    - **마무리 `finalize(companions, policy)`.** 보조 파일(자막, 호출자가 `{자막}.part`로 다 써 둔다) → 기록 순으로 옮긴다. `Skip`은 `rename_noclobber_with_retry`, `Overwrite`는 `rename_with_retry`(Windows 일시 잠금 재시도). 막히면 거기서 멈추고 `ChatFinalized::TargetExists { path }`를 내며 막힌 파일의 임시 파일과 기록 `.part`·sidecar를 남긴다. 설계(§3.2-8)는 "하나만 막힌 경우"만 적었는데, 보조 파일이 막히면 기록을 옮기지 않고 멈추는 쪽으로 정했다: sidecar가 있는 동안 기록 `.part`가 늘 있다는 불변식이 유지되고, 기록을 옮겨 버리면 다시 마무리할 때 `end`·`moved`를 읽을 곳이 사라진다. 옮긴 보조 파일은 sidecar `moved`에 적어 다시 마무리할 때 다시 옮기지 않는다(그새 사용자가 고친 자막도 그대로). 기록 마무리는 `download::part`와 같이 Unix에서는 잠금을 쥔 채, Windows에서는 핸들을 닫고 옮긴다.
    - **읽기.** `read_messages()`는 잠근 핸들로 커밋한 기록을 `ChatMessage`로 읽는다(자막 렌더 입력, PR 3). Windows의 배타 잠금은 다른 핸들의 읽기를 막기 때문이다. 닉네임·본문은 로그·`Debug`에 내지 않는다(`Debug`는 경로·줄 수·길이만).
    - **범위 밖.** 400 처리와 `ChatEnd::PastEnd`는 확정하지 않았다(오류 그대로, Q8). `ChatRequest`·`collect_chat`·`ChatOutcome`은 PR 3이고 `DuplicatePolicy`는 기존 `download::DuplicatePolicy`를 쓴다.
    - 테스트(`chat/part/tests.rs`, 17개, 63에서 22개): 이어받기 상태 복원(쌍둥이 개수표 포함), 꼬리 자르기 뒤 중복 없음, 처음부터 시작 조건 넷(sidecar 없음·다른 영상·짧은 `.part`·줄 끝 아님)과 `restart`, 잠금 경쟁(두 번째 `open`은 `FileLocked`이고 바이트·sidecar가 그대로), 한 줄 보장, `end` 보존, `Debug` 비밀 없음, `Skip`이 기존 파일 바이트를 지킴·`Overwrite`가 바꿈·마무리 직전에 파일이 생기는 경쟁(주입한 rename), 보조 파일 이동 후 기록 막힘 → 재마무리, 보조 파일 막힘. 구현을 일부러 깨 보았다: `Skip`을 덮어쓰기로, 꼬리 자르기 제거, `moved` 무시, 줄바꿈 접기 제거, 영상 번호 검사 제거, 줄 끝 검사 제거 각각 해당 테스트가 실패한다.
63. **(기능 ④, 62의 리뷰 반영) `ChatPart`의 실패 계약과 읽기·마무리 보강.** 리뷰 지적 다섯 중 넷을 고치고 하나는 계약으로 남겼다.
    - **독 상태.** `commit_page`가 `Err`를 내거나 그 future가 도중에 버려지면 `ChatPart`는 독 상태가 되어 `commit_page`·`read_messages`·`for_each_message`·`finalize`가 모두 `Err`다. 줄을 쓸 때마다 `written`을 먼저 늘리므로, 실패 뒤 같은 페이지를 다시 커밋하면 줄이 두 번 들어가고 `lines`와 어긋나며 커밋하지 않은 줄이 자막·최종 기록에 섞인다. 계약은 "`Err`면 버리고 `open`으로 다시 연다"(꼬리를 sidecar 길이로 자른다)이고, PR 3의 페이지 재시도는 그렇게 한다. 되감기 대신 독을 고른 이유: 실패 원인이 디스크라 `set_len` 되돌리기도 실패할 수 있다. 취소(`select!`)도 같은 독이지만 Windows에서 끝나지 않은 blocking 작업의 sidecar 쓰기가 새 `open`의 sidecar를 덮을 수 있는 틈은 남는다(`download::part`와 같은 기존 모양). 그래서 `commit_page`를 취소 지점으로 쓰지 않고 취소는 페이지 사이에서만 본다(모듈 문서에 적었다). `JoinHandle`을 들고 기다리는 방식은 이번에 하지 않았다.
    - **스트리밍 읽기.** `for_each_message(f)`를 더해 기록을 한 줄씩 콜백에 넘긴다(콜백 오류에서 멈추고 쓰기 위치는 늘 되돌린다). `read_messages()`는 이것을 `Vec`로 모으는 편의 함수이며 메모리 한계(메시지당 raw의 두 배 남짓)를 문서에 적었다. 자막 렌더러 `render_*`는 `&ChatMessage` 반복자를 받아 지금도 큐 목록을 만들 때 모으므로, 메시지 전체를 쥐지 않는 렌더는 PR 3에서 필요하면 렌더러 쪽을 바꾼다.
    - **마무리.** `moved`에 있는 보조 파일은 건너뛰되, 호출자가 다시 만든 `from`은 지운다(고아 방지). 옮긴 직후 `moved` 기록이 실패해도 멈추지 않고 경고만 남기며, 다시 마무리할 때 `from`이 없고 `to`만 있으면 옮긴 것으로 본다(자기 자막이 `Skip`에서 `TargetExists`가 되는 꼬임을 막는다).
    - 테스트 다섯을 더했다(`chat/part/tests.rs`, 22개): 실패 주입(sidecar 자리를 디렉터리로 막음)으로 독·재`open` 뒤 중복 없음, future 취소 독, `for_each_message` 스트리밍·중단·쓰기 위치, 다시 만든 보조 `.part` 삭제, `moved` 없이 자리에 있는 보조 파일. `poisoned` 설정을 빼 보니 앞의 둘이 실패했다.
64. **(구간 받기 코어 ②-1, 2026-10-16, 브랜치 `feat/range-core`) 빠른 다시보기의 시각 구간만 받는다.** 설계 `docs/design/features/range.md`(4차까지)를 61 뒤의 코드 위에 옮겼다. 이 PR은 코어만이고 셸 DTO(②-2)·앱 UI(②-3)는 따로다.
    1. **요청과 선택.** `model::TimeRange { start_ms, end_ms: Option }`(끝을 모르면 playlist 끝까지, serde camelCase)를 `DownloadRequest.range`로 받는다. `hls::select_range(&MediaPlaylist, TimeRange) -> SegmentSpan { first, last_excl }`는 순수 함수다. 조각 i의 시작 누적 `c[i]`에서 `first`는 `c[i] <= start`인 가장 큰 i(시작은 내린다), `last_excl`은 `c[j] >= end`인 가장 작은 j(끝은 올린다)이고 끝이 playlist보다 크면 자른다. 받는 시각은 요청 구간을 늘 포함한다. 시작 ≥ 끝, 시작 ≥ 전체, 고른 조각 없음은 `RangeOutOfBounds`다. 길이 0 조각이 시작 경계에 있으면 건너뛴다(테스트로 고정). 전제 "playlist 첫 조각의 시작 = 플레이어 0:00:00"은 사용자 실측 M-②-2로만 확인한다. 생방송 창(`parse_live_media`)에는 쓰지 않는다.
    2. **sidecar v2 = 구간 전용.** `SIDECAR_VERSION`은 1 그대로이고 구간 받기만 `SIDECAR_VERSION_RANGE = 2`를 쓴다(올리면 진행 중인 모든 `.part`가 불일치로 지워지므로). `HlsState.range: Option<HlsRange { first, last_excl, start_ms, end_ms }>`는 `skip_serializing_if`라 전체 받기·생방송 sidecar의 JSON 모양은 그대로다. `same_job`은 버전 규칙(v1이면 구간 없음, v2면 구간 있음, 그 밖은 모름)과 요청 시각(`start_ms`·`end_ms`) 일치를 본다. 고른 위치는 비교하지 않는다(같은 지문의 playlist에서는 같은 위치). 61이 정한 대로 `resume` 인자가 아니라 `PartOwner`에 `range` 필드를 더했고, 시그니처는 그대로다. `Sidecar::owner()`가 sidecar에서 주인 열쇠를 만들며 `create`의 소유 재확인과 완료 뒤 sidecar 삭제가 이것을 쓴다(`range: None`으로 손으로 만들면 구간 받기를 마칠 때마다 내 sidecar를 남의 것으로 보고 `.part.json`이 남는다. `finalize_removes_own_range_sidecar`가 잡는다). 업그레이드: v1 sidecar는 요청 range가 `None`이면 지금과 같다. 다운그레이드: 옛 앱은 `v == 1`만 받아 v2를 같은 작업이 아니라고 보고 지우고 새로 받는다(구간 `.part`를 전체로 잘못 이어받지 않는다).
    3. **엔진(`segmented::run`).** 구간은 `PartFile::create`보다 먼저 고른다(잘못된 구간이면 `.part`가 생기지 않는다). 재개는 `select_range`를 다시 계산하지 않고 sidecar의 `first`·`last_excl`을 쓴다(방어: 요청과 다른 구간이거나 `first < last_excl <= n`이 아니면 `SourceChanged`). `next_index ∈ [first, last_excl]`이고 init 쓰기 checkpoint는 `next_index = first`다. 조각 URI 목록은 `segments[next..last_excl]`, 진행률의 분모와 `media_secs`는 구간 기준이다. `.part`에는 늘 원본 조각만 들어가고 시각 정규화는 마무리 defrag가 파일 전체에 한 번 한다. 403 재조회·지문 검사는 그대로다. 루프가 끝났는데 `next != last_excl`이면 `ensure_complete`가 `SourceChanged`를 내고 `keep_partial`로 받은 조각을 남긴다. 이 검사는 URI 목록을 모두 소비해야 루프가 끝나므로 닿을 수 없는 방어라 도우미 단위 테스트로만 확인한다. 전체 받기에도 같은 검사를 둔다.
    4. **마무리.** `finish`의 defrag 조건을 `Live || range.is_some()`으로 넓혔다. 실패 계약(`Unchanged` → 조각 구조로 마무리, `Modified` → `.part`로 둠)은 61 M4 그대로다. 구간 조각의 시각이 이어지지 않으면(`discontinuities > 0`) 경고 로그만 남기고 판정으로 쓰지 않는다. 변환이 끝난 뒤 rename 전에 끊긴 `.part`는 조각을 다시 받지 않고 `AlreadyFlat`으로 마무리한다(통합 테스트). 전체 빠른 다시보기의 defrag(R5)는 이 변경에 넣지 않는다.
    5. **요청 검증과 오류.** `Chzzk::download`의 **맨 앞**(최종 파일 Skip 검사와 `resume`보다 앞)에서 `range`가 `Some`인데 `expected_kind != LiveRewindHls`이면 `Unsupported(RangeNotHls)`, `start >= end`이면 `RangeOutOfBounds`로 끝낸다(`resume` 뒤면 같은 경로의 남의 `.part`가 소유 불일치로 지워지고, Skip 뒤면 잘못된 요청이 `Skipped`로 조용히 성공한다). 새 `ErrorKind::RangeOutOfBounds`는 코어 25번째, 셸 `ErrorCode`는 33개가 됐다(`is_resumable() == false`). 1:1 표 때문에 `errors.ts`(`ALL_CODES`·`case`)·`errors.test.ts`·`content.md` §15.2 한 행과 bindings를 이 PR에 같이 넣었다. 셸에서는 `manager.rs` `same_owner`에 `range`를 더하고, `jobs.rs`·`output.rs`는 컴파일을 맞추는 `None`(②-2가 `JobRecord.range`·`OutputQuery.range`로 바꾼다)만 넣었다.
    6. **`dl --range <A~B>`.** 실측 M-②-2·M-②-6(장면 대응, defrag한 구간 파일 재생)용이다. `H:MM:SS`·`M:SS`·초를 받고 B를 비우면 끝까지다. 이름 끝에 ` (H.MM.SS~H.MM.SS)`를 붙인다(`:` 없음). 이름이 길이 상한(200바이트)을 넘으면 `output_path`가 끝을 잘라 접미사가 사라지므로, `dl`은 제목 쪽을 먼저 줄여 접미사를 지킨다(`range_name`). 접미사가 잘리면 다른 구간이 같은 경로가 되어, 코어의 끝 검사(`start ≥ 전체`, `segmented`)보다 앞선 `resume`이 남의 구간 `.part`를 소유 불일치로 지우거나 Skip이면 남의 파일로 `Skipped`가 된다. 같은 경로에 다른 구간을 주는 호출자의 이 위험은 코어가 막지 않는다(경로는 호출자 몫, 앱은 ②-2 `naming::range_suffix`가 같은 규칙으로 제목을 줄인다). 보조로 master·media playlist를 직접 받아 "EXTINF 누적 = 영상 길이(±1조각)"를 같다/다르다/모름으로만 찍고, 받기·해석에 실패하면 단계 이름 없이 `확인 못 함`만 찍는다. 원점 검사가 아니고 주소는 어디에도 찍지 않는다. 실측 값은 사용자 로컬에만 두고 ROADMAP에는 판정만 적는다. 실서버 `#[ignore]` 스모크 `live_hls_range`는 nightly drift 목록(`live.rs`) 밖의 `crates/core/tests/live_range.rs`에 있다(`CHZZK_LIVE_HLS=<빠른 다시보기 no> cargo test -p chzzk-core --test live_range -- --ignored --nocapture`).
    7. **range.md와 다른 점.** (D1) `PartFile::resume` 인자 대신 `PartOwner.range` 필드. (D2) `TimeRange`는 `download`가 아니라 `model.rs`(`hls`가 `download`를 import하면 층이 뒤집힌다). (D3) 오류 코드 번호는 #113 뒤의 코어 25번째·셸 33개. (D4) 오류 코드 하나에 `errors.ts`·골든·`content.md` 한 행이 같이 바뀐다. (D5) "루프가 끝났는데 `next != last_excl`"은 wiremock이 아니라 `ensure_complete` 단위 테스트로 확인한다. (D6) ⑤-F4가 이미 머지돼 "늦으면 경고만" 갈래는 없다. (D7) 합성 fixture 생성기는 바꾸지 않는다(`synth_segment(i)`와 `testdata/live/synthetic_frag.mp4`로 충분하고 non-sync 음성 fixture는 ②-0 몫). (D8) `dl`은 코어의 `pub(crate)` 헤더·요청 함수를 공개하지 않고 playlist를 직접 받아 `hls::parse_*`로 읽는다. (D9) 끝 검사는 구간만이 아니라 전체 받기에도 둔다.
    8. **남은 것(2026-10-18 ②-5에서 고침).** ②-2 셸(#123, app.md 80)·②-3 앱(#127, app.md 88)이 머지됐고, 사용자 실측 M-②-2(세 시각 장면 일치)·M-②-6(구간 파일 macOS QuickTime 재생·탐색 된다)이 2026-10-18에 통과했다. M-②-3(조각 키프레임)은 부분 관찰(세 구간 첫 프레임만, ②-0 도구 미작성)이다. 남은 것은 관찰뿐이다: 전체 받기 파일 재생·탐색(R5 재료, 판정 뒤 별도 `fix:`) · 거의 전체 길이 구간의 마무리 시간·메모리 · M-②-3 전체 조각 검사 · Windows 미디어 플레이어 재생. ② 전체 정리는 app.md 구현 중 변경 89.
    9. **②-2가 한 일.** 이름 접미사 helper가 코어 `naming::range_suffix`(` (H.MM.SS~H.MM.SS)`, 끝 없음 ` (H.MM.SS~)`)와 `naming::range_stem`(제목을 `sanitize_filename` 하고 `.mp4`까지 200바이트 안이 되게 제목 쪽을 줄인 뒤 접미사를 붙인다)으로 코어에 생겼다. 6의 `dl --range` 이름도 `range_stem`을 쓰므로 이제 제목이 정리된다(옛 `range_name`은 정리 없이 붙였다). 위 4번 설명처럼 앱이 제목을 줄이는 함수는 `range_suffix`가 아니라 `range_stem`이다. 상세·셸 쪽은 app.md 80.
65. **(생방송 사후 점검 ⑤-F3, 2026-10-16, 브랜치 `feat/live-end-reason`, live-audit (3)(a)·(7-e), 결정 L8) 녹화 결과에 끝난 이유와 놓친 조각 수를 싣는다.** 번호는 머지 순서로 맞춘다.
    1. **결과 모양.** `DownloadOutcome::Completed.live: Option<LiveEnd>`(`reason: LiveEndReason`, `gaps: Option<u32>`). 생방송이 아니면 `None`. `finish()` 시그니처는 그대로 두고 생방송 두 곳(`live::run` 끝, `mod.rs`의 이어서 마무리)에서 `with_live`로 붙인다. progressive·segmented는 건드리지 않는다.
    2. **이유 넷과 대응.** `Ended`: `EXT-X-ENDLIST`, 재조회가 `NotLive`(403 만료 뒤·유휴 확인·playlist 403 뒤 재조회 모두). `Stopped`: `live_stop` 토큰으로 끝난 모든 길(셸은 [녹화 마치기]뿐 아니라 앱 닫기와 생방송 `pause`도 `live_stop`을 쓴다). `Restarted`: msn 역행 `BACK_CONFIRM`번 연속, init 파일 이름 바뀜, `EXT-X-DISCONTINUITY`, 두 번째 `EXT-X-MAP`, 재조회 결과의 `liveId` 바뀜(새 방송이 이미 시작된 것이라 채널은 방송 중이다). `Other`: 앞선 실행에서 끊긴 `.part`를 받은 만큼 마무리. 설계의 `notLive`는 사용자에게 `Ended`와 같은 뜻이라 합쳤다. `Refreshed::Over`는 `Ended`·`NewLive`로 나눴다(`Refreshed::end()`가 이유를 낸다).
    3. **`LiveSnapshot.restarted`.** `ended`가 ENDLIST와 DISCONTINUITY·두 번째 MAP을 함께 뜻해 이유를 가를 수 없었다. `ended`는 그대로 두고 재시작 표시를 더했다(`parse_media_inner`가 `(목록, ended, restarted)`를 낸다).
    4. **구멍 수.** 녹화 엔진이 끝낸 것은 `Some(gaps)`(0 포함). 앞선 실행의 `.part` 마무리(`Other`)는 sidecar에 구멍 수가 없어 `None`이다(sidecar는 바꾸지 않았다, `SIDECAR_VERSION` 1). 모르는 값을 0으로 꾸미지 않는다.
    5. **닫은 한계.** 59 한계 ⑤("끝난 기록에서 구멍 수·끝난 이유가 사라진다")를 이 항목이 닫는다(셸 기록은 app.md 82).
    6. **테스트.** `hls::tests::live_media_restart_ends`·`live_media_ended_and_empty`(`restarted`), `download::tests::with_live_keeps_skipped`, `tests/recording.rs`의 `endlist_finishes_without_gaps`·`stop_finalizes_recording`·`gaps_are_counted_and_recording_continues`·`different_live_id_ends_recording`·`closed_after_expiry_finishes`·`discontinuity_ends_recording`·`idle_rechecks_status`·`unsupported_midway_keeps_part_and_next_run_finalizes`·`interrupted_real_recording_is_converted_when_finalized`·`single_stale_playlist_is_not_a_restart`(이유 단언)와 새 `three_backward_playlists_end_as_restart`(msn 역행 3회 → `Restarted`).
    7. **알려진 한계(이번에 고치지 않았다).** 외부에서 같은 이름의 최종 파일이 생겨 `Skipped`로 끝난 뒤(`DownloadOutcome::Skipped`는 끝 정보를 버린다, `mod.rs`의 `with_live`) 같은 `.part`를 [덮어쓰고 받기]로 저장하면 이미 관측한 끝난 이유와 놓친 조각 수가 `Other`/`None`으로 바뀐다(`mod.rs`의 이어서 마무리 경로). 녹화 파일은 보존된다. 보존 범위를 넓히는 일은 sidecar·레코드 계약을 넓히는 후속으로 둔다.
66. **(기능 ④-3a 채팅 수집 코어, 2026-10-17, 브랜치 `feat/chat-collect-core`, chat.md §3.2·§11 끝 정정) `Chzzk::collect_chat`.** 사용자 승인(2026-10-17)으로 ④-3을 실측 없는 ④-3a와 실측 뒤 ④-3b로 나눴고, 이 항목은 ④-3a다. 번호는 머지 순서로 맞춘다. 모듈은 `chat/collect.rs`(설계 표는 `chat/mod.rs`였지만 `mod.rs`가 상수·seam 자리라 수집 몸통을 따로 뒀다, 공개 경로는 `chat::{ChatRequest, ChatOutcome, ChatProgress}` 재수출).
    1. **넣지 않은 것(④-3b).** Q3에 기대는 `VideoContent.chat_enabled`·`ContentMeta.chat`(`ChatAvailability`)와 Q8에 기대는 `ChatEnd::PastEnd`는 넣지 않았다. 그래서 400은 첫 페이지든 중간이든 늘 `Error::HttpStatus { status: 400, kind: Api }`이고 `.part`·sidecar가 남는다. 채팅 사용 여부는 모름(카드는 늘 켤 수 있음)으로 간다.
    2. **`ChatRequest.duration_ms: Option<u64>`를 더했다.** 설계 구조체(§3.1)에는 없지만 자막 꼬리 컷(`SubtitleOpts.duration_ms`)과 `ChatProgress.duration_ms`가 영상 길이를 요구한다. 셸은 `ContentMeta.duration_secs`를 넘긴다. 코어가 info를 다시 부르지 않는다(요청 수를 늘리지 않는다).
    3. **`ChatOutcome::Completed.subtitle_failed: bool`을 더했다.** 설계는 "자막 생성이 실패해도 기록은 완성으로 남긴다"(§3.2-8)만 적었다. 조용히 자막이 빠지면 사용자가 모르므로 결과에 싣는다(셸 표현은 ④-4·④-5). 실패 원인은 내용 없는 `warn` 로그만 남긴다.
    4. **요청 간격·재시도 정책은 `ClientConfig`에 둔다.** `chat_page_interval`(기본 `CHAT_PAGE_INTERVAL_MS` 300ms)과 `chat_retry`(기본 `chat_retry_policy()`: 시도 `CHAT_RETRY_MAX + 1`회, 인내 없음, base 500ms·cap 8초). 미디어용 `retry`와 따로다. `live_poll_interval`과 같은 선례이고, 통합 테스트가 대기 시간만 줄이고 횟수는 제품 값 그대로 쓰게 한다(테스트는 `..chat_retry_policy()`로 횟수를 물려받아 `+ 1`을 빼면 경계 테스트가 실패한다). 간격은 **앞 응답을 받은 뒤부터** 다음 요청(재시도 포함)까지 잰다. 보낸 시각 기준이면 응답 지연이 들쭉날쭉할 때 서버가 보는 간격이 300ms보다 짧아질 수 있다.
    5. **실패·취소에도 `.part`·sidecar를 지우지 않는다.** `download()`의 `cleanup`(이어받을 수 없는 오류면 지움)과 달리 채팅 기록은 어느 오류 뒤에도 같은 요청으로 커서부터 이어받을 수 있다(커밋 단위가 페이지라 sidecar가 늘 일관적이다). 버리는 길은 `restart`와 셸의 작업 삭제뿐이다.
    6. **취소는 요청·대기 중에만 본다.** 요청과 간격·백오프 대기를 `select!`로 감싸고, `commit_page`는 감싸지 않는다(63의 독 계약). 시작 전에 이미 취소됐으면 파일을 열지 않고 `Cancelled`.
    7. **`commit_page` 실패는 그 호출을 끝낸다.** 63은 "버리고 다시 열어 그 페이지부터"를 계약으로 적었는데, 커밋 실패 원인은 디스크(공간·잠금·입출력)라 같은 호출 안에서 곧바로 다시 해도 대개 다시 실패한다. 그래서 오류를 그대로 내고, 다음 `collect_chat` 호출의 `open`이 꼬리를 잘라 그 페이지부터 다시 한다.
    8. **정상 끝 페이지도 커밋한다.** `Next::End`의 `keep`(커서 멈춤 페이지에는 새 메시지가 있다)을 지금 상태와 `end`로 커밋한다. sidecar에 `end`가 있으면 다음 호출은 요청 없이 마무리로 간다(받는 동안 같은 이름이 생겨 `TargetExists`로 멈춘 작업을 동의 뒤 `Overwrite`로 마무리하는 길).
    9. **자막.** `sidecar.moved`에 있으면 다시 만들지 않는다(68-2에서 "`moved`에 있고 최종 자막이 있으면"으로 좁혔다). 아니면 커밋한 기록을 `read_messages`로 읽어 `render_ass`·`render_srt`로 `{자막}.part`에 쓰고 `Companion`으로 넘긴다. 렌더러가 큐 목록을 모으므로 지금은 기록 전체를 메모리에 올린다(63에 적은 한계 그대로, 긴 영상의 메모리 측정은 실측 M-④-5 뒤 필요하면 렌더러를 스트리밍으로 바꾼다). 메모리 상한과 내용 sync는 13.
    10. **진행률.** 시작 때 한 번, 커밋한 페이지마다 한 번 `ChatProgress { cursor_ms, duration_ms, messages(누적 줄 수) }`를 낸다. 요청 사이가 300ms 이상이라 셸의 250ms 스로틀(`Meter`)보다 드물어 따로 스로틀하지 않는다.
    11. **경쟁.** 같은 출력을 다른 작업이 받는 중이면 `ChatPart::open`이 `FileLocked`(요청 없음, 남의 `.part`·sidecar 그대로). 받는 동안 같은 이름의 기록·자막이 생기면 `Skip`은 `TargetExists`이고 기존 바이트를 지킨다. `restart`도 덮어쓰기 동의가 아니다.
    12. **중단된 자막 이동은 이동 의도로 되살린다(Codex adversarial 지적).** 자막 rename 뒤·sidecar `moved` 갱신 전에 프로세스가 멈추면 최종 자막은 있고 임시 파일은 없고 `moved`에 없다. 9대로 자막을 다시 만들면 임시 파일이 생겨 `finalize`의 복구 분기("원본 없음·최종만 있음")가 꺼지고, `Skip`이 자기 자막에 `TargetExists`로 막혀 끝나지 못했다. 반대로 "원본 없음·최종만 있음"만으로 우리 것이라 보면 사용자가 원래 갖고 있던 무관한 자막을 우리 것으로 친다. 그래서 sidecar에 `moving: Vec<String>`(이동 의도, `#[serde(default)]`라 형식 버전 1 그대로)을 더했다. `finalize`는 보조 파일마다 **rename 전에 의도를 sidecar에 원자적으로 쓰고**(쓰지 못하면 옮기지 않고 `Err`), 옮기면 의도를 `moved`로 넘기고, 막히거나 rename이 오류면 의도를 지운다(지우기 실패는 경고). 복구 조건은 **의도 있음 + 원본 없음 + 최종 있음**이고(`ChatPart::is_move_interrupted`), 의도가 없으면 최종 파일은 무관한 기존 파일이라 `Skip`이 지킨다(앞의 "원본 없음·최종만 있음이면 옮긴 것" 규칙을 좁혔다). 수집기는 `moved`이거나 이 조건이면 자막을 다시 만들지 않는다. 테스트: `tests/chat.rs`의 `interrupted_subtitle_move_resumes_and_completes_with_skip`(Codex 시나리오 그대로: 기록 이름이 막혀 자막만 옮긴 뒤 sidecar를 "의도만 있고 `moved` 없음"으로 바꾸고 사용자 기록을 치운다 → `Skip` 재시도가 요청 없이 `Completed`, 자막 바이트 그대로, 수정 전에는 `TargetExists{자막}`)·`unrelated_existing_subtitle_without_intent_is_kept`(사용자 자막에 막힌 뒤 임시 파일이 사라져도 `TargetExists`, 사용자 바이트 그대로), `chat::part::tests`의 rename 직후 패닉으로 만든 중단 → 의도로 복구, 의도 없는 최종 파일은 `TargetExists`, 막힘·rename 오류 뒤 의도 지움, 의도를 쓰지 못하면 옮기지 않음. 구현을 일부러 깨 보았다: 복구 조건의 의도 검사 제거, 막힘 뒤 의도 지우기 제거, 의도 쓰기 실패 무시, 수집기 검사 제거, 의도 기록 제거가 각각 위 테스트를 빨갛게 한다.
    13. **자막 메모리 예산과 내용 sync(Codex 2차 지적 둘).** (가) 9대로 기록 전체를 메모리에 올리면 큰 기록에서 할당 실패로 프로세스가 죽고 `subtitle_failed` 경로를 건너뛴다. 렌더러를 스트리밍으로 바꾸는 대신(큐 정렬·꼬리 컷이 목록을 요구한다) 크기 예산을 둔다: 커밋한 기록 바이트(`ChatPart::committed`)가 `ClientConfig.chat_subtitle_max_bytes`(기본 `chat::CHAT_SUBTITLE_MAX_BYTES` = 256 MiB)를 **넘으면** 기록을 읽지 않고 `FileTooLarge`로 자막 실패(`subtitle_failed = true`)로 끝내고, 기록은 그대로 완성으로 옮긴다. 같으면 만든다. 메시지 수가 아니라 바이트로 잰다: 메모리는 raw 길이에 비례하고(메시지당 raw의 두 배 남짓) 바이트는 sidecar에 이미 있어 읽지 않고 안다. 256 MiB는 **[잠정] 근거 없음, ADR-0009 묶음 등록**이고 실측 M-④-5(긴 VOD의 기록 크기·메모리) 뒤 조정한다. (나) 자막 임시 파일을 `std::fs::write`로 쓰고 sync 없이 `finalize`(rename)로 넘기면 크래시 뒤 덜 쓴 자막이 완성 이름으로 남을 수 있었다. `File::create` → `write_all` → `sync_all`이 성공해야 `Companion`으로 넘기고, 쓰기·sync 실패는 자막 실패(임시 파일 삭제)다. sync 실패 주입은 `chat::collect`의 비공개 `write_synced(tmp, text, sync)` seam(제품은 `File::sync_all`)으로 단위 테스트한다. 테스트: `tests/chat.rs`의 `subtitle_over_budget_fails_subtitle_but_keeps_record`(사슬 셋 기록 길이 L로 상한 L−1·0 → `subtitle_failed`·기록 8줄 바이트 그대로·자막·임시 파일 없음, 상한 L → 자막 있음, 기본값 = 상수), `chat::collect::tests`의 sync가 전체 쓰기 뒤에 불리는지·sync 실패가 `Io{op: "sync"}`인지. 구현을 일부러 깨 보았다: sync 호출 제거, 예산 검사 제거, `>`를 `>=`로 바꾸기가 각각 빨갛다.
    - 테스트(`tests/chat.rs`, 28개, wiremock): 세 페이지 완성(경계 되풀이 한 번, 줄마다 JSON 객체, 임시 파일 없음, 진행률), SRT·자막 없음, 없는 폴더 만들기, 커서 멈춤 페이지 기록, **400 음성 (가) 첫 페이지 → `HttpStatus{400}`·재시도 없음 (나) 둘째 페이지 → 첫 페이지 5줄과 커서 15000이 남고 다시 부르면 15000부터 중복 없이 8줄 (다) 첫 페이지 2xx·빈 → `Completed{0, EmptyPage}`**와 이어받은 뒤 빈 페이지면 이전 수, 형식 오류 → `Parse`, 429 세 번 뒤 성공·네 번이면 `HttpStatus{429}`, 408·500·503 재시도, 401·403은 재시도 없이 `AuthRequired`, 쿠키 켬·끔, 요청 간격(실제 시계, 아래 경계만)·재시도 간격, 요청 중 취소 → `.part` 남고 이어받기, 시작 전 취소 → 요청 없음, `restart`, 받는 동안 생긴 기록 → `TargetExists`·바이트 그대로 → `Skip` 재호출도 그대로 → `Overwrite`는 요청 없이 마무리, 있는 자막은 `Skip`(`restart` 포함)이 지킴, 같은 출력 동시 실행 → `FileLocked`, 다른 영상 sidecar는 처음부터, 자막 실패 → `subtitle_failed`. 구현을 일부러 깨 보았다: `max_attempts`의 `+ 1` 제거(429 경계 둘 실패), 간격 대기 제거(간격 둘 실패), sidecar `end` 무시와 끝 페이지 메시지 버림(10개 실패).

67. **(기능 ④-4 채팅 셸이 쓰는 코어 추가, 2026-10-17, 브랜치 `feat/chat-shell`, chat.md §4) 설정 두 키·받다 만 채팅 정리 함수·`SubtitleFormat` 직렬화.** 번호는 머지 순서로 맞춘다(앞선 PR이 67을 쓰면 다시 매긴다).
    1. **`UserSettings.save_chat: bool`(기본 꺼짐, 불리언이 아니면 꺼짐)과 `chat_subtitle: SubtitleFormat`.** `chat_subtitle`의 기본은 상수 `settings::DEFAULT_CHAT_SUBTITLE` = `Ass`다. **[잠정] U2 결정 대기**: 사용자가 실측 M-④-8·9 뒤 정한다(decisions.md U2). 그때까지는 chat.md §5.4 와이어프레임이 고른 영상 플레이어용 `.ass`를 쓰고, 바꿀 때는 이 상수 하나만 고친다. 없는 키·`null`·모르는 값은 이 기본값으로 읽는다(전용 `subtitle_or_default`. `lenient_or_default`는 `SubtitleFormat::default()` = `None`으로 떨어져 쓰지 않는다. 코어 `Default`는 ④-1 테스트가 고정해 그대로다). 스키마 버전 2 그대로다.
    2. **`SubtitleFormat`에 serde(`"none"`·`"ass"`·`"srt"`)를 붙였다.** 설정과 `jobs.json`(셸 `ChatState.subtitle`)에 저장된다.
    3. **`chat::chat_partial_bytes(video, video_no)`·`chat::discard_chat_partial(video, video_no)`.** 셸이 영상 최종 경로만으로 받다 만 채팅을 세고 지운다(기록 경로는 `sibling_path(video, RECORD_EXT)`). 센다: 같은 영상 sidecar면 `committed_len`(0일 수 있다. `ChatPart::open`이 sidecar를 곧바로 쓰므로 첫 페이지 전 실패도 파일이 남는다), sidecar가 없거나 깨졌으면 `.part` 길이, 다른 영상이면 `None`. 지운다: `.part`를 잠근 채 기록 `.part`·sidecar·자막 임시 파일(`{stem}.ass.part`·`.srt.part`)을 지우고 완성 파일은 건드리지 않는다. 다른 영상 sidecar면 `NotOwned`, 잠겨 있으면 `FileLocked`(아무것도 지우지 않음). `download::part::discard_partial`과 같은 규칙이다.
    4. **셸이 기대는 진행 계약(Codex PR #141 ②, app.md 85-13).** `collect_chat`의 첫 진행 콜백은 `ChatPart::open`이 성공한 뒤(`restart`면 `.part`를 비운 뒤)에만 온다. 그 앞에서 끝나는 실패(시작 전 취소·폴더 만들기·`FileLocked`)에는 진행이 한 번도 없다. 셸은 이것으로 "처음부터"가 쓰였는지 가른다. 코드는 그대로이고 테스트 `locked_restart_reports_no_progress_and_keeps_part`(`tests/chat.rs`: 다른 작업이 잠근 채 `restart`로 부르면 `FileLocked`·진행 0번·남의 `.part` 바이트 그대로)로 고정했다.
    - 테스트: `chat::part` 단위(정리 넷: 자막 임시 파일까지 지움·완성 자막 그대로, 다른 영상 `NotOwned`, 파일 없음, 잠김 `FileLocked` / 세기 둘: 같은 영상만·짧은 `.part`는 `None`, sidecar 없음은 `.part` 길이), `settings` 단위(두 키 기본·관대한 읽기·왕복). 소유 검사를 끄면 `discard_keeps_other_videos_part`가 실패하는 것을 확인했다.

68. **(기능 ④-3a 후속, 2026-10-17, 브랜치 `fix/chat-followups`, Codex PR #138 3차 지적 둘) 자막 단계를 블로킹 스레드로 옮기고 낡은 `moved` 표시를 고친다.** 번호는 머지 순서로 맞춘다. 셸 쪽 후속 셋은 app.md 86이다.
    1. **자막 생성은 `spawn_blocking`에서 한다(3차 P2).** 66-9·13의 자막(예산 검사·`read_messages`·`render_ass`/`render_srt`·`write_all`·`sync_all`)이 async 함수 안에서 그대로 돌아 긴 기록이면 tokio 작업 스레드를 오래 막았다. `collect.rs`의 `subtitle_stage(part, SubtitleJob, sync)`가 잠근 `ChatPart`를 **통째로 블로킹 작업 안으로 옮겨** 판정(아래 2)·읽기·렌더·쓰기·sync를 하고 `(ChatPart, SubtitleMade)`를 돌려준다(`Ready(Companion)`·`Kept`·`Failed`). 잠금은 작업이 끝날 때까지 작업이 쥔다: 바깥 future가 버려져도 블로킹 작업이 끝나야 `.part` 잠금이 풀리므로 그 사이 다른 작업이 `.part`를 자르거나 지우지 못한다. Windows 배타 잠금 때문에 기록은 잠근 핸들로만 읽어야 하므로(`for_each_message`) 핸들을 나눠 주는 대신 소유를 옮겼다. 작업이 패닉하면 `ChatPart`를 잃으므로 `subtitle_failed`가 아니라 `Error::Io { op: "subtitle" }`이고 `.part`·sidecar는 남아 다음 호출이 이어받는다. 실패 계약(66-13 (나): 쓰기·sync 실패는 자막 실패, 임시 파일 삭제)은 그대로다. `sync` seam은 `Send + 'static`을 받는다(제품은 `File::sync_all`).
    2. **`moved`에 있는데 최종 자막이 없으면 다시 만든다(3차 medium).** 자막을 옮긴 뒤 기록 이름에 막혀(`TargetExists`) 멈춘 사이 사용자가 그 자막을 지우거나 옮기면, 재시도는 `moved`만 보고 다시 만들지 않았고 `finalize`도 표시를 보고 넘어가 `Completed { subtitle_failed: false }`인데 자막이 없었다. 이제 `moved`이고 최종 자막이 **있으면** 그대로 두고(사용자가 고친 바이트도 지킨다), **없으면** `ChatPart::forget_moved(to)`로 표시를 지운 뒤 커밋된 기록으로 다시 만든다. 표시는 메모리에서만 지운다: `finalize`가 rename 전에 이동 의도(`moving`)와 함께 sidecar를 다시 쓰므로 따로 쓰지 않고, 자막을 만들지 못하면 보조 파일 없이 기록만 옮겨 sidecar가 사라진다. 그래서 `finalize`가 낡은 표시 때문에 새로 만든 임시 자막을 지우는 길(`moved`면 `from` 삭제)에 닿지 않는다. 중단된 이동(66-12, 의도 있음·원본 없음·최종 있음)은 최종 자막이 있으므로 이 판정과 겹치지 않는다.
    - 테스트: `chat::collect::tests`의 `subtitle_stage_runs_off_the_runtime_thread_and_keeps_the_lock`(current-thread 런타임에서 sync seam이 테스트 스레드가 아닌 스레드에서 불리고, 돌려받은 `ChatPart`가 잠금을 쥐어 다시 열기가 `FileLocked`)·`subtitle_stage_panic_is_error_and_releases_lock`, `tests/chat.rs`의 `stale_moved_subtitle_is_regenerated_on_retry`(자막 이동 성공 → 기록 `TargetExists` → 사용자가 막힌 기록과 자막을 지움 → `Skip` 재시도가 요청 없이 `Completed{8, subtitle_failed: false}`, 자막이 처음과 같은 바이트로 다시 생김, 임시 파일·sidecar 없음)·`moved_subtitle_still_present_is_not_regenerated`(사용자가 고친 자막 바이트 그대로). 구현을 일부러 깨 보았다: `spawn_blocking`을 그 자리 호출로 바꾸기(스레드 테스트·패닉 테스트 실패), `forget_moved` 호출 제거와 최종 자막 확인 없이 늘 `Kept`(각각 재생성 테스트 실패).
69. **(기능 ④-3a 후속, 2026-10-17, 브랜치 `fix/chat-sidecar-read`, Codex high) 채팅 sidecar를 읽지 못하면 자르거나 지우지 않는다.** 번호는 머지 순서로 맞춘다. 셸 쪽 짝은 app.md 87이다.
    1. **읽기 실패와 없음을 나눈다.** `chat::part::read_sidecar`가 모든 읽기 오류를 `None`(없음)으로 바꿨다. 권한·Windows 공유 위반(다른 핸들의 원자적 쓰기가 닿는 중)·I/O 오류로 sidecar를 잠깐 못 읽으면 `ChatPart::open`이 sidecar 없음으로 보고 받은 기록(`.part`)을 0으로 자른 뒤 새 sidecar를 썼고, `discard_chat_partial`은 영상 소유 확인을 건너뛰어 다른 영상의 받다 만 채팅·자막 임시 파일을 지울 수 있었다. 이제 `Result<Option<ChatSidecar>, Error>`이고 `download::part::read_sidecar`(core.md 61 D4)와 같은 세 상태다: NotFound는 `Ok(None)`, 깨짐(파싱 실패·모르는 형식)은 지금까지처럼 `Ok(None)`(처음부터 시작, 모듈 문서·chat.md §3.2-7), 그 밖의 읽기 실패는 `Err(Io{op: "read"})`.
    2. **호출부.** `open`은 `restart`가 아니면 잠근 뒤·자르기 전에 읽어 실패면 아무것도 바꾸지 않고 오류다(`restart`는 버리는 것이 의도라 읽지 않는다). `discard_chat_partial`은 실패면 잠금을 놓고 아무것도 지우지 않고 오류다(`.part`가 없을 때도). 셸의 지우기(`remove_job`)는 이 오류를 이미 지우기 실패로 받아 레코드를 남기고, 영상 "처음부터"의 채팅 지우기는 경고만 남기고 코어가 `restart`로 비운다(읽지 않는다). `chat_partial_bytes`는 반환형을 그대로 두고 읽기 실패를 "주인을 모르는 남은 파일"로 세어 `.part` 길이를 준다(화면에서 숨기지 않고, 지우기는 위처럼 오류로 멈춘다).
    - 테스트: `chat::part::tests`의 `open_with_unreadable_sidecar_errors_and_keeps_record`·`discard_with_unreadable_sidecar_errors_and_keeps_files`·`discard_without_part_and_unreadable_sidecar_errors`(sidecar 자리에 디렉터리를 두어 플랫폼과 상관없이 NotFound가 아닌 읽기 실패를 만든다. 오류인지만이 아니라 `.part` 바이트·자막 임시 파일·sidecar 자리가 그대로인지 본다: 고치기 전에도 새 sidecar 쓰기·디렉터리 지우기가 실패해 오류는 났지만 그 전에 자르고 지웠다)·`open_restart_ignores_sidecar_read`·`partial_bytes_with_unreadable_sidecar_is_part_len`·`broken_sidecar_still_starts_over`. 고친 뒤 읽기 실패를 다시 `Ok(None)`으로 되돌려 보았다(앞의 셋 실패).
