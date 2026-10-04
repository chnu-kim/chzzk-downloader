# crates/core 설계 (Phase 1, 확정안)

세 설계안(fidelity / robustness / consumer)과 AES 조사 보고를 대조해 판정한 최종 설계다. 기준 문서는 `docs/ROADMAP.md`, `docs/spec/core-behavior.md`(이하 spec), `docs/research/hls-live-rewind.md`(이하 research), `docs/research/stack.md`, `docs/research/chzzk-oauth.md`다. fixture는 `internal/api/testdata/`(클립), `testdata/hls/`(빠른 다시보기), `testdata/vod/`(일반 VOD, 이번 판정에서 확보)다.

## 0. 판정 요약

- **베이스는 fidelity 안**이다. 모듈 수가 기능 수와 맞고, trait 없이 mock 서버로 테스트하며, spec §8의 테스트를 1:1로 매핑했다.
- robustness 안에서 가져온 것: 크래시 일관성 불변식(`sync_data` → sidecar 원자적 쓰기, 재개 시 `committed_len`으로 truncate), 재조회 후 playlist 지문 검증(세그먼트 수 + EXTINF crc32 + init 길이), "갱신 직후 같은 요청이 다시 403이면 즉시 실패", `.part`는 상태 코드 확인 뒤에만 생성, Windows rename 재시도, 디스크 부족 `io::Error` 매핑, `std::fs::File::try_lock`으로 이중 다운로드 방지, `Secret` 마스킹, `Error::is_resumable()`.
- consumer 안에서 가져온 것: 직렬화 가능한 `ErrorKind`(UI 분기용), `ownership::is_own_content`(Phase 3 seam), `MediaPlaylist.init: Option<Url>`(AES/TS 대비 최소 seam), 레거시 `lastQualityName`의 `^(\d+)P_` → `"{n}p"` 변환.
- 버린 것(현재 기능에 불필요): 다운로드 큐·JobId·상태 머신·history.json(consumer), `SourceResolver`/`CredentialStore`/`SegmentTransform` trait·offline grace·`fs4` 사전 디스크 점검·EWMA·64 MiB playlist 상한(robustness), `ConflictPolicy::Ask/Rename`, `keyring`/`directories` optional feature. 큐와 Ask는 Phase 2 셸에서 필요해지면 코어 `download()` 위에 얹는다.

### 판정 중 실측으로 확인한 것 (2026-10-05)

| 주장 | 결과 |
|---|---|
| AES VOD에도 `inKey`가 있다 → `encryptionType`을 먼저 봐야 한다 | **확인**. 9000003: `encryptionType:"AES"`, `inKey` 있음, `vodStatus:"ABR_HLS"` |
| 비성인 PD mp4는 쿠키 없이 받아진다 | **확인**. 9000002 PD URL에 쿠키·Referer 없이 `HEAD` 200, `Range: bytes=0-99` 206. 호스트는 `vod.example.invalid`(클립과 다름). 성인 VOD는 미확인 |
| 일반 VOD MPD 구조(research §10) | **확인 + fixture 확보** `testdata/vod/`: `video/mp4`(PD_144P, PD_720P) + `video/mp2t`(UUID) + `audio/mp4`. `ContentProtection` 없음 |
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
    pub fn finalize(self, dup: DuplicatePolicy) -> Result<PathBuf, Error>;
}
```

- **잠금**: `File::try_lock()`(std, 1.89+)로 `.part`를 배타 잠금. 실패하면 `FileLocked`. Windows는 강제, Unix는 advisory.
- **checkpoint 순서**: `flush` → `sync_data`(`spawn_blocking`) → `committed = written` → `fsutil::atomic_write(sidecar)`(tmp → sync → rename). 주기는 HLS 세그먼트 32개 또는 5초, progressive 64 MiB 또는 5초.
- **재개**: `.part` 길이 > `committed_len`이면 truncate(크래시 꼬리). 작으면 sidecar 불일치로 보고 새로 시작.
- **`.part`는 첫 응답의 상태 코드를 확인한 뒤에만 만든다.** 404면 아무 파일도 남지 않는다.
- **finalize**: 핸들을 닫은 뒤 `rename_with_retry`(100ms부터 약 3초까지 지수 재시도, Windows `ERROR_SHARING_VIOLATION`/`ACCESS_DENIED` 대비). 최종 파일이 열려 있으면 `FileLocked`, `.part` 보존. `std::fs::rename`은 Windows에서도 덮어쓴다.

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

공통 도구(`tests/common`): `fixture(path)`, `rewrite_hosts(bytes, mock_uri)`(`hls.example.invalid`, `clip.example.invalid`, `vod.example.invalid`을 mock 주소로 치환. 이중 인코딩 JSON 안에서도 단순 replace로 된다), 경로 접미사 응답기(custom `Respond`: HLS 경로에 `*`, `~`, `=`가 있어 접미사 매칭이 필요), raw `TcpListener` 절단 서버, `ZeroRetry`, `progress_interval = 0`.

### 8.1 spec §8 이식 (1:1)

| spec 출처 | 상태 | Rust 테스트 | fixture/mock | 기대값 |
|---|---|---|---|---|
| §8.1 TestIsClipURL (6) | 유지 | `url::clip_detection` | — | true 5건은 `Ok(Clip)`, `/video/1234567`은 `Ok(Video)`, `https://chzzk.naver.com/`과 `""`은 Err |
| §8.1 TestParseClipID (6) | 유지 | `url::clip_id` | — | 6개 그대로 |
| §1.1 golden 5~7행 | **변경**(§9.1-2) | `url::clip_rejects_bad` | — | `embed/clip/`은 Err, `abc#frag`는 `abc`, `evil.com/?chzzk...`은 Err |
| §1.2 | **변경**(§9.1-1) | `url::video_no` | — | `123?t=10`, `123/?t=10`, `123?a=b/c` → 123. `/video/`, `/video/abc` → Err. `m.chzzk.naver.com/video/1` → 1 |
| §3.1/§4.1 | 유지+보강 | `info::live_rewind_fixture` | `hls/video_info.json` | 제목 `123`, 채널 `테스트채널`, channel_id `2795e2a0…`, live_open_date `2026-01-02 12:00:00`, master path, tracks 5개 encodingTrack 순서(bandwidth u64 `3000000`…, frame_rate `"60.0"`) |
| §3.1 DASH info | **신규(실물)** | `info::dash_fixture` | `vod/video_info.json` | `Playback::Dash`, channel_id `bb2a278c…`, 채널 `가상채널` |
| §4.4 classify | 신규 | `info::classify_{dash,aes_precedence,no_playback,inkey_empty_string}` | `synthetic/vod_info_aes.json`, Value 변형 | AES+inKey → Encrypted, inKey `""`와 null은 같음, 셋 다 없으면 NoPlayback |
| §8.1 clip fixture | 신규 | `info::clip_fixtures` | `clip_playinfo.json`, `clip_multi_playinfo.json` | §8.1 끝 기대값 + channel_id `9381e7d6…` |
| §8.1 TestParseClipQualitiesFromMPD | 유지+§5.4 표 | `mpd::clip_pd_qualities` | `clip_multi.mpd` | 2개. label `720p`/`480p`, resolution 720/480, bandwidth/width/height/frameRate 표 전체 |
| §8.1 TestSelectClipBaseURLFromMPD | 유지 | `mpd::select_exact` | `clip_multi.mpd` | `PD_720P_…`는 `/pd/`와 `.mp4` 포함, `PD_NONEXISTENT`는 QualityNotFound, UUID rep는 선택 불가 |
| §5.1 namespace | 신규 | `mpd::nvod_label_localname` | `clip_multi.mpd` | `nvod:Label`을 읽는다 |
| §9.1-3 VOD PD 필터 | **신규(실물)** | `mpd::vod_pd_filter` | `vod/playback.mpd` | PD_144P, PD_720P 2개. mp2t/audio UUID rep 제외. `protected == false` |
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
| §6.4 FormatLiveDate | **변경** | `naming::parse_live_date` | — | `2024-01-02 12:34:56`, `2024-01-02`, `2024-01-02T12:34:56`→(2024,1,2). `2024/01/02`, `""`, `24-01-02…`→None. fixture `2026-01-02 12:00:00`→`261005` |
| §6.4 SanitizeFilename | **변경**(괄호 유지, OS별) | `naming::sanitize_{windows,macos,linux}` | — | `[2024-01-02] 채널 제목.mp4` 그대로. `x:y*z?"<>\|(){}[]/\.mp4`: Win `x_y_z____(){}[]__.mp4`, Mac `x_y*z?"<>\|(){}[]_\.mp4`, Linux `x:y*z?"<>\|(){}[]_\.mp4`. `CON.mp4`: Win `CON_.mp4`. `제목.  .mp4`: Win `제목.mp4`. 공백·제어문자·빈 값 행 유지 |
| §6.4 fixture 파일명 | **변경**(사용자 결정) | `naming::default_filename_fixtures` | 세 fixture | `[261005] 테스트채널 - 123.mp4`, `[261004] 가상채널 - 가상 일반 VOD ….mp4`, `[클립] 클립채널 - 테스트 클립 하나.mp4` |
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

### 사실 (조사 보고 + 이번 실측)

- `tvAppViewingPolicyType`은 판별 신호가 아니다.

### 코어의 기본 seam (이 설계에 포함, 결정과 무관하게 구현)

1. `classify`가 `encryptionType`을 **가장 먼저** 보고 `Playback::Encrypted { method }`를 낸다. `resolve`는 MPD를 받지 않고 `Error::EncryptedVod { method }`를 낸다. 메시지: "암호화된 VOD(AES)는 지원하지 않습니다".
2. 2차 방어: `pd_reps`는 `ContentProtection`이 붙은 rep를 제외하고, `parse_media`는 `EXT-X-KEY`(METHOD≠NONE)를 `Unsupported::Encrypted(method)`로 거부한다.
3. `MediaPlaylist.init: Option<Url>`로 두어 TS(MAP 없음) playlist 파싱 자체는 가능하게 한다. 그 이상(복호화·TS 처리)은 넣지 않는다.

### 사용자가 고를 선택지

| 선택지 | 내용 | 비용·위험 |
|---|---|---|
| **A. 거부(권고, 기본값)** | 위 seam 그대로. 분명한 오류 메시지. 주기적으로 최신 VOD의 `encryptionType`을 샘플링해 확산을 감시 | 영향 범위가 작다(일반 VOD 0/195). 코드 추가 없음 |
| C. `.ts` → `.mp4` remux까지 | B + 순수 Rust MPEG-TS demux(PES·ADTS·Annex-B)와 MP4 mux(avcC, PTS/DTS) | B의 위험 그대로 + 큰 구현·테스트 부담(크레이트 성숙도 낮음, `hls-transmux` 미검증). 오프라인 fixture는 자체 테스트 키로 암호화한 합성 TS가 필요 |


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
13. ROADMAP "AES 지원하지 않음(확정)" → "기본값 거부, 지원 여부는 사용자 결정(§11)".

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
    - **서명 값이 든 타입의 `Debug`.** `info::VideoContent`·`info::Playback`·`mpd::Representation`·`model::PdRep`·`model::Source`·`hls::Variant`·`hls::MediaPlaylist`·`hls::Segment`는 `Debug`를 손으로 구현한다. URL은 `redact_url`을 거치고, `in_key`·`live_rewind_playback_json`은 `***`, `Representation.base_urls`는 쿼리를 지운다. `Resolved`는 `Source`를 통해 함께 가려진다. 필드 타입은 그대로 `Url`이다(`Secret<Url>` 같은 newtype은 공개 필드 타입을 바꾸므로 쓰지 않았다). `http::signed_types_debug_redacted`가 실물 fixture로 `hmac`·`hdnts`·`hdntl=exp`·`_lsu_sa_`·실제 inKey 값이 없음을 검사한다.
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
    | VOD 9000007 | 빠른 다시보기 HLS(5화질, 144p로) | 약 5 MB에서 취소 → `.part`가 상자 경계에서 끝나고 `ftyp moov moof mdat emsg styp moof …`(상자 761개). `--keep`으로 2 MB에서 멈춘 뒤 다시 실행하면 3.1 MB부터 이어받음 |
    | VOD 9000006 | DASH PD(144p) | 3 MB에서 취소 → `ftyp moov free mdat`(mdat 잘림). 2 MB에서 멈춘 뒤 Range로 이어받음 |
    | 클립 TestClip01 | PD 720p(세로) | 끝까지 13,264,697 B, `ftyp moov free mdat`, `.part` 없음 |
    - `tests/live.rs`는 `CHZZK_LIVE_HLS`·`CHZZK_LIVE_DASH`·`CHZZK_LIVE_CLIP`으로 대상을 받고, 없으면 조용히 통과하지 않고 패닉한다(`--ignored`로 일부러 돌릴 때만 쓰이므로). 대상은 시간이 지나면 지워지므로 고정하지 않는다. 설계 §8의 `CHZZK_LIVE_VIDEO`는 `resolve::live_smoke`(8단계)에 그대로 남는다.
    - MP4 상자 검사기는 `tests/support/mp4.rs` 하나를 `tests/live.rs`와 `examples/dl.rs`가 `#[path]`로 함께 쓴다(크기 1 largesize, 0 끝까지, 마지막 상자 잘림 허용). 검사기 자체는 오프라인 테스트 `live::walk_boxes_on_fixture`가 실물 fixture로 검사한다.
    - UA의 Chrome 141(25번)로 막히지 않았다.
    - **성인 PD 쿠키 필요 여부는 미실측이다.** 로그인 쿠키가 필요한데, 저장소의 실제 사용자 파일(루트 `settings.json`, `dependent/`)은 읽지 않는다는 작업 규칙 때문에 쓸 수 있는 쿠키가 없었다. `examples/dl.rs`가 `CHZZK_NID_AUT`·`CHZZK_NID_SES`(+`CHZZK_COOKIES_ON_MEDIA=1`)로 쿠키를 받으므로 사용자가 직접 실측할 수 있다. 그때까지 결정 8(미디어에 쿠키 없음)과 `cookies_on_media` 스위치를 그대로 둔다.
46. **(15단계) §12 문서 정정 반영.** 1번은 `docs/research/stack.md`, 2~8·11·12번은 `docs/spec/core-behavior.md`(원래 Go 서술은 남기고 해당 자리에 "정정(설계 §12-n)"을 붙였다), 9·10번은 `docs/research/hls-live-rewind.md`에 반영했다. 10번의 거부 목록에는 구현에서 더한 `GAP`·`SKIP`(26번)도 적었다. 13번(ROADMAP의 AES 문구)은 설계 판정 커밋 때 이미 "기본값 거부, 지원 여부는 사용자 결정"으로 고쳐져 있어 바꾸지 않았다. 8번의 성인 PD는 45번대로 미실측으로 적었다.
