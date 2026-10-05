# 코어 행동 명세 (Go → Rust 이식 기준)

Rust 코어(`crates/core`)를 만들고 테스트할 때 기준으로 삼는 문서다. 기준 시점은 `fa21e56`(브랜치 `chore/harness-reset`)의 Go 코드다.

- 이 문서는 **코드가 실제로 하는 일**을 적는다. `CLAUDE.md`나 작업 지시문의 설명과 다르면 코드를 따른다(차이는 §10에 모았다).
- 아래 golden 값은 손으로 계산하지 않았다. 저장소를 건드리지 않는 `go test -overlay`로 Go 함수를 직접 실행해 뽑았다.
- 실물 fixture는 두 묶음이다. 클립(`internal/api/testdata/`)과 빠른 다시보기(`testdata/hls/`: VOD info JSON(`inKey: null`), `liveRewindPlaybackJson`, master/media m3u8, fMP4 세그먼트. 조사 기록은 `docs/research/hls-live-rewind.md`)다. **일반 VOD(DASH, `inKey` 있음)의 info JSON과 MPD는 fixture 파일이 없다.** 이 부분의 서술은 "Go 코드가 읽는 경로와 research 문서 §10의 관찰 기준"이며, 본문에서는 `[실물 미확인]`으로 표시한다.

---

## 1. 입력 URL 판별·파싱

### 1.1 클립 URL (`internal/api/clip.go:37-60`)

`IsClipURL(url)`은 다음 둘 중 하나의 **부분 문자열 포함**이면 true다. 호스트는 파싱하지 않는다.

- `chzzk.naver.com/clips/`
- `chzzk.naver.com/embed/clip/`

`parseClipID(url)`:
1. `IsClipURL`이 false면 오류 `치지직 클립 URL이 아닙니다`
2. 첫 `?`부터 끝까지 잘라낸다. **`#` fragment는 제거하지 않는다.**
3. 오른쪽 끝의 `/`를 모두 지우고 `/`로 split한 뒤 마지막 요소를 쓴다.
4. 결과가 `""` 또는 `"clips"`면 오류 `클립 ID를 추출할 수 없습니다`

Golden(현재 동작이며, 아래 넷째 줄부터는 버그도 함께 보인다):

| 입력 | 결과 |
|---|---|
| `https://chzzk.naver.com/clips/TestClip01` | `TestClip01` |
| `https://chzzk.naver.com/clips/AbCdEf1234?param=1` | `AbCdEf1234` |
| `https://chzzk.naver.com/embed/clip/AbCdEf1234?autoPlay=true` | `AbCdEf1234` |
| `https://chzzk.naver.com/clips/` | 오류 |
| `https://chzzk.naver.com/embed/clip/` | **`clip`** (버그: 오류여야 한다) |
| `https://chzzk.naver.com/clips/abc#frag` | **`abc#frag`** (버그. 다만 HTTP 클라이언트가 fragment를 떼므로 실제 요청 path는 `/clip/abc`다. fragment에 `/`가 있으면(`#a/b`) `b`로 요청한다) |
| `http://evil.com/?chzzk.naver.com/clips/abc` | **`evil.com`** (버그: 호스트 검사가 없다) |

### 1.2 VOD URL (`internal/api/vod.go:98-103`, `:258-263`)

- 판별: `strings.Contains(url, "chzzk.naver.com/video/")`. 아니면 오류 `치지직 VOD URL이 아닙니다`
- videoNo: 오른쪽 끝의 `/`를 모두 지우고 `/`로 split한 마지막 요소. **쿼리스트링과 fragment를 제거하지 않는다.** 숫자인지도 검사하지 않는다.
  - `.../video/123?t=10`이면 videoNo가 `123?t=10`이 된다. `http.NewRequest`가 이를 다시 파싱하므로 요청은 path `/service/v2/videos/123`, query `t=10`이 된다(서버가 여분의 query를 허용하는지는 미확인). `#x`도 fragment로 떨어져 path는 `123`이다.
  - **실제로 깨지는 경우**(golden, Go로 확인): `.../video/123/?t=10`은 path `/service/v2/videos/`, `.../video/123?a=b/c`는 `/service/v2/videos/c`, `.../video/`는 `/service/v2/videos/video`로 요청한다(버그).

### 1.3 분기 (`cmd/chzzk-downloader/main.go:184-199`)

- `IsClipURL`이 true면 클립 흐름(`GetClipQualities`, `DownloadClip`)
- 그렇지 않고 `chzzk.naver.com/video/`를 포함하면 VOD 흐름(`GetVODQualities`, `DownloadVOD`)
- 둘 다 아니면 `치지직 VOD 또는 클립 주소가 아닙니다`

---

## 2. HTTP 공통

### 2.1 API 요청 헤더: `config.GetCookieHeaders()` (`internal/config/config.go:266-291`)

요청마다 `dependent/cookie.json`을 디스크에서 다시 읽는다.

| 헤더 | 값 |
|---|---|
| `User-Agent` (Windows, `runtime.GOOS == "windows"`) | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36` |
| `User-Agent` (그 외 OS: **macOS 포함**) | `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36` |
| `Referer` | `https://chzzk.naver.com/` |
| `Accept` | `application/json, */*` |
| `Origin` | `https://chzzk.naver.com` |
| `Cookie` | cookie.json이 비어 있지 않을 때만. **모든 키**를 `k=v`로 만들어 `"; "`로 잇는다. 순서는 Go map 순회 순서라 **비결정적**이다. |

MPD 요청은 위 헤더에 `Accept: application/dash+xml, application/xml, */*`를 **덮어쓴다**(Origin은 그대로 보낸다).

### 2.2 미디어 요청 헤더: `mediaHeaders()` (`internal/downloader/core.go:57-66`)

`GetCookieHeaders()` 결과 중 `User-Agent`, `Referer`, `Cookie`만, 값이 빈 문자열이 아닐 때 보낸다. pstatic CDN에도 NID 쿠키를 보낸다는 점에 유의한다.

> **정정(설계 §12-8)**: Rust는 미디어 요청에 쿠키를 **보내지 않는다**(UA·Referer만). HLS CDN은 서명만으로 받아지고(research §7), 비성인 PD mp4도 쿠키·Referer 없이 200/206임을 실측했다. 성인 PD는 미실측이며, 필요하면 `ClientConfig.cookies_on_media`로 되돌린다.

### 2.3 공통 동작과 누락

- `http.Client{}` / `http.DefaultClient`: **타임아웃과 취소가 없다.**
- API(JSON·MPD) 응답의 **HTTP 상태 코드를 검사하지 않는다**(`vod.go:117-135`, `vod.go:206-219`, `clip.go:231-237`). 판정은 JSON의 `code` 필드로만 한다. MPD가 200이 아니면 XML 파싱 오류로 나타난다.
- 리다이렉트는 Go 기본값(최대 10회 추종)을 따른다.

---

## 3. 엔드포인트와 읽는 필드

### 3.1 VOD 정보

- `GET https://api.chzzk.naver.com/service/v2/videos/{videoNo}` (상수 `ChzzkVodInfoAPI`, `vod.go:17`)
- 헤더: §2.1
- 응답(`ChzzkResponse`, `vod.go:49-68`). 빠른 다시보기는 `testdata/hls/video_info.json`으로 확인했다. 일반 VOD 응답은 `[실물 미확인]`:

| JSON 경로 | 타입 | 용도 |
|---|---|---|
| `code` | int | `!= 200`이면 오류 `VOD info API 오류: {message}` |
| `message` | string \| null (fixture는 null) | 오류 메시지 |
| `content.videoTitle` | string | 파일명, 최근 목록 제목 |
| `content.videoId` | string | MPD URL |
| `content.inKey` | **string \| null** (빠른 다시보기 fixture는 `null`) | **HLS/DASH 분기 키** (§4) |
| `content.liveOpenDate` | string, fixture `"2026-01-02 12:00:00"` | 파일명 날짜 (§6.4) |
| `content.vodStatus` | string, 빠른 다시보기 `"NONE"`, 인코딩 후 `"ABR_HLS"`(research §1) | 파싱하지만 사용하지 않는다 |
| `content.channel.channelName` | string | 파일명, 제목 |
| `content.liveRewindPlaybackJson` | **JSON을 담은 문자열** (fixture로 확인) | inKey가 없을 때만 쓴다 (§4.1) |
| `content.encryptionType` | string \| null (`"AES"` 가능, research §10) | **파싱하지 않는다** |

- Go `encoding/json`은 string 필드에 온 `null`을 조용히 `""`로 둔다(Go로 확인). **Rust serde의 `String`은 null에서 실패한다.** 이 필드들은 `Option<String>`으로 받고 `None`과 `""`를 같게 취급한다.
- `content.channel.channelId`는 **파싱하지 않는다.** fixture에 `content.channel.channelId`(`000000000000000000000000000000a1`)로 있으므로 Phase 3 본인 채널 검사에 이 경로를 쓴다. `content.adult`(bool)도 있지만 읽지 않는다.
- `encryptionType: "AES"` VOD(research §10)는 MPD에 `video/mp4` AdaptationSet이 없다. Go에서는 `GetVODQualities`가 **오류 없이 빈 목록**을 돌려주고, main이 `사용 가능한 품질 정보를 찾지 못했습니다`를 출력한다(`main.go:217-222`). Rust는 info 단계에서 `encryptionType`을 보고 "암호화 VOD 미지원" 오류를 따로 낸다.

### 3.2 클립 정보

- `GET https://api.chzzk.naver.com/service/v1/play-info/clip/{clipId}` (상수 `ChzzkClipInfoAPI`, `clip.go:16`)
- 헤더: §2.1
- 응답(`clipResponse`, `clip.go:20-33`). fixture `clip_playinfo.json`, `clip_multi_playinfo.json`으로 확인했다.

| JSON 경로 | 타입 | 용도 |
|---|---|---|
| `code` | int | `!= 200`이면 오류 `클립 정보 API 오류: {message}` |
| `message` | string/null | |
| `content.contentTitle` | string | VodInfo.VideoTitle로 매핑 |
| `content.videoId` | string | 빈 값이면 오류 `클립 재생 정보(videoId/inKey)가 없습니다` |
| `content.inKey` | string | 빈 값이면 위와 같은 오류. 클립에는 항상 있다(DASH만 해당) |
| `content.vodStatus` | string, fixture 값 `"ABR_HLS"` | 매핑만 하고 사용하지 않는다 |
| `content.adult` | bool | **파싱하지만 사용하지 않는다** |
| `content.ownerChannel.channelName` | string | VodInfo.Channel.ChannelName으로 매핑 |

fixture에는 있지만 읽지 않는 필드: `content.ownerChannel.channelId`(예: `000000000000000000000000000000c3`, Phase 3에 필요), `contentId`, `contentType`(`"CLIP"`), `userAdultStatus`(`"NOT_LOGIN_USER"`), `makerChannel`. 클립에는 `liveOpenDate`가 없으므로 VodInfo.LiveOpenDate는 `""`이다.

### 3.3 재생 MPD (VOD DASH와 클립이 같은 API)

- `GET https://apis.naver.com/neonplayer/vodplay/v2/playback/{videoId}?key={inKey}` (상수 `ChzzkVodUriAPI`, `vod.go:18`)
- videoId와 inKey는 **URL 인코딩 없이** `fmt.Sprintf`로 끼워 넣는다.
- 헤더: §2.1에 `Accept: application/dash+xml, application/xml, */*`를 더한다.
- 응답: DASH MPD XML (§5)

### 3.4 미디어 다운로드

- PD mp4: MPD의 `BaseURL` 그대로 GET(§6.1). 헤더는 §2.2. 서명 쿼리 `hdnts=exp=...~acl=...~hmac=...`가 들어 있고 **만료된다**(fixture MPD의 `nvod:expireTime`은 서버 시각 +8시간). 그래서 Go는 다운로드 직전에 info와 MPD를 **다시 조회**한다(`clip.go:203-215`, `vod.go:257-`).
- HLS: `liveRewindPlaybackJson.media[0].path`를 ffmpeg에 넘긴다(§6.2).

### 3.5 (죽은 코드) ffmpeg 설치기

- `GET https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip` (`setup.go:29`). 타임아웃은 5분이고 200이 아니면 오류다.
- `internal/setup`은 어디서도 import하지 않으므로 실제로는 호출되지 않는다. 이식하지 않는다(§9.2).

---

## 4. `inKey` 분기

`GetVODQualities`(`vod.go:97-254`)와 `GetVODUrl`(`vod.go:257-407`)이 info 조회부터 분기까지 **같은 코드를 복붙해** 갖고 있다.

### 4.1 `inKey == ""`(또는 null): 빠른 다시보기 (라이브 리와인드, HLS)

fixture `testdata/hls/video_info.json`로 확인했다. research에 따르면 이 상태는 방송 종료 직후부터 인코딩이 끝날 때까지의 **과도 상태**이며, 이후 같은 videoNo에 `inKey`가 생겨 §4.2로 바뀐다.

1. 응답 body를 `map[string]interface{}`로 다시 파싱하고 `content.liveRewindPlaybackJson`을 문자열로 꺼낸다. 문자열이 아니거나 비어 있으면 `liveRewindPlaybackJson 정보가 없습니다`. `content`가 object가 아니면 `content 필드가 올바르지 않습니다`
2. 그 문자열을 다시 JSON으로 파싱한다(이중 인코딩).
3. `media`가 배열이 아니거나 비어 있으면 `HLS 미디어 정보가 없습니다`. **`media[0]`만** 쓴다.
   - **정정(설계 §12-11)**: Rust는 `media[0]`에 고정하지 않고 `protocol == "HLS"`인 첫 항목을 쓴다. 없으면 `Unsupported(NoHlsMedia)`.

**GetVODQualities** (`vod.go:169-186`):
- `media[0].encodingTrack`이 배열이 아니면 `encodingTrack 정보가 없습니다`
- 각 track에서 Quality를 만든다:
  - `ID = Quality = encodingTrackId` (string, 예: `"720p"`. master playlist의 variant 디렉토리 이름과 같다)
  - `Bandwidth = fmt.Sprintf("%v", videoBitRate)`, `Width = %v(videoWidth)`, `Height = %v(videoHeight)`, `FrameRate = %v(videoFrameRate)`
  - JSON 숫자는 float64로 들어오므로 `%v`는 `%g`처럼 찍힌다. 10^6 이상은 `3e+06` 꼴이 되고, 필드가 없거나 null이면 `<nil>`이 된다. Height가 `<nil>`이면 main의 최고 화질 판정에서 0으로 취급된다.
  - **`videoFrameRate`는 JSON 문자열이다**(`"60.0"`). 숫자(`videoBitRate`, `videoWidth`, `videoHeight`)와 타입이 다르므로 Rust에서 `f64`로 선언하면 실물 파싱이 실패한다.
  - `BaseURL`은 비어 있다.
- fixture golden(Go로 확인, 정렬 없이 encodingTrack 순서 그대로):

| ID = Quality | Bandwidth | Width | Height | FrameRate |
|---|---|---|---|---|
| `720p` | `3e+06` | `1280` | `720` | `60.0` |
| `480p` | `1.5e+06` | `852` | `480` | `30.0` |
| `360p` | `600000` | `640` | `360` | `30.0` |
| `144p` | `128000` | `256` | `144` | `30.0` |
| `1080p` | `8.192e+06` | `1920` | `1080` | `60.0` |
- 다음 위치의 type assertion은 검사하지 않아 형태가 다르면 **panic**한다: `vod.go:169` (`media[0]`이 object가 아닐 때), `:176` (track이 object가 아닐 때), `:177` (`encodingTrackId`가 string이 아닐 때)

**GetVODUrl** (`vod.go:328-334`):
- `media[0]`의 type assertion은 검사하지 않는다(`:328`, panic 가능).
- `media[0].path`(string)가 없으면 `HLS 미디어 경로 정보가 없습니다`
- `VODSource{URL: path, Kind: KindHLS}`를 반환한다. **`quality` 인자를 완전히 무시한다.** path는 master playlist(`.../vod_playlist.m3u8?hdnts=...`, fixture에서 variant 5개)이므로 실제 화질은 ffmpeg 기본 스트림 선택에 맡겨진다(추정: 최고 해상도).

### 4.2 `inKey != ""`: 일반 VOD (DASH MPD) `[실물 미확인]`

공통: `videoId`나 `inKey`가 비어 있으면 `필수 videoId 또는 inKey 값이 없습니다`. 이어서 §3.3으로 MPD를 받아 파싱한다.

**GetVODQualities** (`vod.go:222-250`):
- `mimeType`에 `video/mp4`가 **포함된 첫 AdaptationSet만** 본다(`break`).
- 그 안의 **모든** Representation을 쓴다. **PD 필터가 없다.**
- `Quality` = `Label[kind="qualityId"]`의 텍스트(예: `720P_1280_2048_192`). 없으면 `rep.id`
- `ID = rep.id`, `BaseURL = BaseURL[0]` (없으면 `""`)

**GetVODUrl** (`vod.go:370-405`):
- `quality` 인자(main은 `Quality.ID`를 넘긴다)에서 정규식 `(\d+)`의 **첫 숫자열**을 뽑는다. 없으면 `올바른 품질 정보가 전달되지 않았습니다`
  - 예: `PD_720P_1280_2048_192`에서 `720`
- `video/mp4`를 포함하는 **모든** AdaptationSet을 순회한다(`break` 없음).
- 각 rep의 `Label[kind="resolution"]` 값을 쓰고, 없으면 `rep.height`를 쓴다. 이 값이 뽑은 숫자와 **같고** BaseURL이 있으면 그 `BaseURL[0]`을 `KindProgressive`로 반환한다.
- 일치하는 것이 없으면 `원하는 품질의 BaseURL을 찾을 수 없습니다`

### 4.3 두 사본의 차이 (반드시 고칠 것)

| 항목 | GetVODQualities | GetVODUrl | 결과 |
|---|---|---|---|
| AdaptationSet 범위 | 첫 video/mp4만 | 모든 video/mp4 | 목록에 없는 rep가 선택될 수 있다 |
| PD 필터 | 없음 | 없음 | 클립 경로(`isPDRepresentation`)와 다르다. non-PD rep의 BaseURL(HLS 디렉토리 등)을 고를 수 있다 |
| 화질 식별 | `qualityId` 라벨 / `rep.id` | `rep.id`의 첫 숫자열을 `resolution` 라벨이나 `height`와 비교 | non-PD id(UUID 등, 예: `265e4b14-...`에서 `265`)면 실패한다. 같은 해상도가 둘이면(60fps/30fps 등) 항상 첫 번째가 선택된다 |
| HLS 화질 | encodingTrack 목록 제공 | 무시 | 사용자 선택이 효과가 없다 |
| 클립과의 차이 | 라벨 `qualityId` | — | 클립 목록 라벨은 `resolution`+`"p"`(`720p`) |

### 4.4 Rust 통합 함수 제안

fetch와 순수 파서를 나눠 fixture만으로 테스트할 수 있게 한다. 클립과 VOD는 같은 MPD 파서와 같은 선택 규칙을 쓴다.

```rust
// --- 입력 ---
pub enum ContentRef { Video { video_no: String }, Clip { clip_id: String } }
pub fn parse_content_url(url: &str) -> Result<ContentRef, UrlError>;   // url crate로 host/path 파싱

// --- 순수 파서 (fixture 테스트 대상) ---
pub struct ContentMeta { title: String, channel_name: String, channel_id: Option<String>,
                         live_open_date: Option<String>, adult: Option<bool> }
pub enum Playback {
    Encrypted { method: String, video_id: String },            // encryptionType 있음(정정 §12-2)
    LiveRewind { media_path: String, tracks: Vec<HlsTrack> }, // inKey 없음
    Dash { video_id: String, in_key: String },                 // inKey 있음
}
pub fn parse_video_info(json: &[u8]) -> Result<(ContentMeta, Playback), ApiError>;
pub fn parse_clip_info(json: &[u8])  -> Result<(ContentMeta, Playback /* 항상 Dash */), ApiError>;
pub fn parse_mpd(xml: &[u8]) -> Result<Vec<Representation>, MpdError>;  // local-name 매칭
pub fn pd_qualities(reps: &[Representation]) -> Vec<Quality>;           // PD_ + "/pd/" 필터

// --- 조합 (네트워크) ---
pub struct Resolved { meta: ContentMeta, qualities: Vec<Quality>, playback: Playback }
pub async fn resolve(http: &Client, c: &ContentRef) -> Result<Resolved, Error>;
pub fn select_source(r: &Resolved, quality_id: &str) -> Result<VodSource, Error>;
// VodSource { url, kind: Progressive | Hls { variant_url } }
```

> **정정(설계 §12-2)**: `Playback`에 `Encrypted`를 더했다. 판정 순서는 `encryptionType` → `inKey` → `liveRewindPlaybackJson`이다(AES VOD에도 `inKey`가 있으므로 `encryptionType`을 먼저 본다, 9000003 실측). 이 분기는 순수 함수 `info::classify` 한 곳에만 있다. `select_source`는 동기 함수로 두지 않고 `Chzzk::download` 안에서 재조회 결과의 variant·rep를 고른다. 확정 API는 `docs/design/core.md` §3.

- 선택 규칙은 **`rep.id` 정확 일치**와 PD 필터다. 숫자열 추출은 버린다.
  - 근거: `vod.go:380-382`의 작성자 주석과 research §10의 관찰(비암호화 VOD 4개의 MPD에 `video/mp4` PD_1080P/PD_720P/PD_144P + `video/mp2t` + `audio/mp4`). VOD MPD fixture는 `testdata/vod/`로 확보했고 PD 필터 테스트(`mpd::vod_pd_filter`)를 VOD에도 걸었다(정정 §12-12).
- HLS도 `quality_id`(encodingTrackId)로 variant를 고르게 한다. variant URI의 첫 디렉토리 이름이 encodingTrackId와 같다(`720p/hdntl=.../vod_chunklist.m3u8`, research §3).
- 서명 URL이 만료되므로 `resolve`는 다운로드 직전에 다시 호출한다. Go처럼 목록 조회 때 받은 URL을 오래 들고 있지 않는다.
- 재조회 사이에 재생 종류가 바뀔 수 있다(빠른 다시보기 → 인코딩 완료 후 `inKey` 생김). Go는 이때 `"720p"`에서 `720`을 뽑아 DASH `resolution` 라벨과 **우연히** 맞춘다. Rust는 목록 때의 `Playback` 종류와 다르면 화질 목록을 다시 보여 주거나 오류를 낸다.

---

## 5. MPD 파싱

### 5.1 Go 구조체 매핑 (`vod.go:71-94`)

- 루트 `MPD`. `Period>AdaptationSet`이므로 모든 Period의 AdaptationSet을 모은다.
- AdaptationSet: `@mimeType`
- Representation: `@id`, `@bandwidth`, `@width`, `@height`, `@frameRate`(모두 string), 자식 `Label`(`@kind`와 텍스트) 목록, 자식 `BaseURL` 텍스트 목록
- **네임스페이스**: 실물의 라벨은 `<nvod:Label kind="...">`(`xmlns:nvod="urn:naver:vod:2020"`)다. Go의 `xml:"Label"`은 네임스페이스를 따지지 않고 local name으로 매칭한다. **Rust 파서(quick-xml/roxmltree)도 local name으로 매칭해야 한다.** 그러지 않으면 라벨 조회가 조용히 실패한다.
- 기본 네임스페이스는 `urn:mpeg:dash:schema:mpd:2011`이다.

### 5.2 fixture `clip_multi.mpd`의 구조

- `MPD@type="static"`, `mediaPresentationDuration="PT30.000S"`, `nvod:expireTime`
- AdaptationSet 1: `mimeType="video/mp4"`
  - `PD_720P_1280_2048_192`: bandwidth `1800000`, width `720`, height `1280`, frameRate `30`. 라벨 qualityId `720P_1280_2048_192`, fps `30`, resolution `720`. BaseURL `https://clip.example.invalid/glive-clip/.../pd/.../1f2a4548-....mp4?hdnts=...`
  - `PD_480P_854_1024_128`: bandwidth `1000000`, width `480`, height `854`, frameRate `30`. resolution `480`. BaseURL은 `/pd/` 경로의 `.mp4`
- AdaptationSet 2: `mimeType="video/mp2t"`(HLS, `nvod:m3u` 속성). Representation id는 UUID(`00000000-0000-0000-0000-0000000000c1` 등)이고 BaseURL은 `.../hls/` 디렉토리다.
- 세로 영상이라 `height`(1280)와 `resolution` 라벨(720)이 **다르다.** 해상도 표기는 라벨을 우선해야 한다.

### 5.3 PD 판정 (`clip.go:133-138`)

`isPDRepresentation`: `rep.id`가 `PD_`로 시작하고, BaseURL이 있으며, `BaseURL[0]`에 `/pd/`가 들어 있어야 한다.

### 5.4 클립 화질 목록 (`parseClipQualitiesFromMPD`, `clip.go:63-109`)

- `video/mp4`를 포함하는 **모든** AdaptationSet에서 PD rep만 고른다.
- `Quality` = `Label[kind="resolution"]` + `"p"`. 라벨이 없으면 `rep.id`
- 결과가 비면 `다운로드 가능한 클립 화질 정보를 찾을 수 없습니다`
- fixture 결과(golden, 순서는 MPD 순서):

| ID | Quality | Bandwidth | Width | Height | FrameRate |
|---|---|---|---|---|---|
| `PD_720P_1280_2048_192` | `720p` | `1800000` | `720` | `1280` | `30` |
| `PD_480P_854_1024_128` | `480p` | `1000000` | `480` | `854` | `30` |

### 5.5 클립 URL 선택 (`selectClipBaseURLFromMPD`, `clip.go:112-130`)

`rep.id == qualityID`, PD 판정 통과, BaseURL 존재를 모두 만족하는 첫 rep의 `BaseURL[0]`을 쓴다. 없으면 `선택한 화질의 다운로드 URL을 찾을 수 없습니다`

### 5.6 정렬과 기본 선택

- **어디서도 정렬하지 않는다.** 목록은 MPD나 encodingTrack 순서 그대로다.
- 기본 선택(main.go:252-307): `Height`를 정수로 바꿨을 때 값이 가장 큰 항목(같으면 앞의 것)이 "최고 품질"이다. 모든 Height가 0이거나 정수가 아니면 index 0이다. `LastQualityName`과 `Quality` 문자열이 정확히 같은 첫 항목이 있으면 그것이 우선한다.
  - golden: 빠른 다시보기 fixture(§4.1 표)는 index 4(`1080p`), 클립 fixture는 index 0(`PD_720P_...`, Height 1280. 세로 영상이라 Height가 해상도 라벨과 다르다)
- **정정(설계 §12-3)**: Rust의 기본 선택은 `Height`가 아니라 `resolution`(짧은 변 라벨, DASH `Label[kind=resolution]`, HLS `min(videoWidth, videoHeight)`)이 가장 큰 항목이고, 없으면 `height`다. 마지막 화질은 `Quality` 문자열이 아니라 `label`(`"720p"`)로 비교한다(`Resolved::default_quality`).

---

## 6. 다운로드

### 6.1 progressive mp4 (`downloadDirectMP4`, `internal/downloader/direct.go:17-112`)

1. GET 요청에 §2.2 헤더를 붙인다(빈 값은 건너뛴다). **Range 헤더는 보내지 않는다.**
2. 상태가 `200`이나 `206`이 아니면 `다운로드 실패: HTTP {code}`를 반환한다. 이 검사는 **파일을 만들기 전**에 한다.
3. `os.Create(outputFile)`로 **최종 파일명에 바로 쓴다**(truncate). `.part` 파일을 쓰지 않는다.
4. `io.Copy(MultiWriter(file, progressWriter), body)`
5. 파일을 먼저 닫고(Windows에서 열린 파일은 지울 수 없다), copy 오류나 close 오류가 있으면 `os.Remove(outputFile)` 뒤 오류를 반환한다.
   - 오류 문자열: `다운로드 중 오류: ...` / `파일 저장 실패: ...`
   - Content-Length보다 짧게 끊기면 Go transport가 `unexpected EOF`를 내므로 삭제 경로로 간다. **Rust에서는 명시해야 한다**: Content-Length를 알고 `written != Content-Length`면 오류를 내고 파일을 지운다.
   - **정정(설계 §12-5)**: Rust는 실패·취소 시 **`.part`(+ sidecar)를 보존하고 최종 파일은 만들지 않는다**. 다음 실행이 Range로 이어받는다. 지우는 것은 받은 바이트가 틀렸음이 증명된 오류(`Error::is_resumable() == false`)뿐이다. 상태 코드를 확인하기 전에는 `.part`를 만들지 않는다.
6. 성공하면 최종 진행률을 한 번 출력한다.
7. 프로세스가 강제 종료되면 최종 파일명으로 부분 파일이 남는다. 다음 실행의 중복 검사는 이 파일을 "완성된 파일"로 보고 건너뛰기를 제안한다(버그).

진행률 계산(`progressWriter`, `computeSpeedETA`):
- 쓸 때마다 누적하고, 마지막 갱신에서 **200ms 이상** 지났을 때만 출력한다.
- `secs <= 0` 또는 `written <= 0`이면 `("", "")`
- `speed = formatBytes(int64(written/secs)) + "/s"`
- ETA는 `total > 0 && bytesPerSec > 0 && written < total`일 때만 `SecondsToHms(int((total-written)/bytesPerSec))`. 정수 초로 내림한다.
- `total`은 `resp.ContentLength`이고, 모르면 -1이다.

`formatBytes`(`common.go:15-26`, 1024진법, 단위 표기 `KB`/`MB`/...):

| 입력 | 출력 |
|---|---|
| 0 | `0 B` |
| 1023 | `1023 B` |
| 1024 | `1.0 KB` |
| 1536 | `1.5 KB` |
| 1048575 | `1024.0 KB` |
| 1048576 | `1.0 MB` |
| 1073741824 | `1.0 GB` |
| 5497558138880 | `5.0 TB` |

`computeSpeedETA` golden:

| (written, total, elapsed) | (speed, eta) |
|---|---|
| (1<<20, 2<<20, 1s) | (`1.0 MB/s`, `00:00:01`) |
| (1024, 2048, 0) | (`""`, `""`) |
| (1024, 0, 1s) | (`1.0 KB/s`, `""`) |
| (2048, 2048, 1s) | (`2.0 KB/s`, `""`) |
| (0, 2048, 1s) | (`""`, `""`) |

상태 줄(`printDownloadStatus`, `common.go:29-63`, CLI 전용): `다운로드: {cur} / {total} ({pct:.1f}%)`, total이 0 이하이면 `다운로드: {cur}`. 이어서 ` | 속도: ..`, ` | 남은 시간: ..`, ` | 진행: ..`를 붙이고 `\r` + 공백 100칸 + `\r`로 덮어쓴다. GUI에서는 같은 값을 이벤트(`{written, total, speed_bps, eta_secs}`)로 내보낸다.

### 6.2 HLS: 현재는 ffmpeg (`internal/downloader/hls.go`), Rust에서 순수 세그먼트 다운로더로 교체

현재 동작(참고용, 이식 대상 아님):
- `config.EnsureBinaries()`로 ffmpeg가 있는지 확인한다. PATH가 우선이고 없으면 `{base}/dependent/ffmpeg/bin/ffmpeg(.exe)`. 없으면 `brew install ffmpeg` 안내 오류를 낸다.
- 인자(`buildFFmpegArgs`): `[-user_agent UA] [-headers "K: V\r\n"... (UA 제외, 키 정렬)] -i {url} -c copy -y -stats -progress pipe:2 -loglevel info {out}`
- 로그에는 `Cookie: [redacted]`로 가린 명령줄을 출력한다(`redactedCmdString`).
- stderr를 파싱한다: `Duration: HH:MM:SS.xx`(총 길이), `time=`, `out_time_ms=`(실제 단위는 µs), `out_time=`, `size=NkB`, `bitrate=...kbits/s`. `Error`/`Warning`이 든 줄은 별도로 출력한다.
- 500ms마다 출력 파일 크기를 폴링해 상태를 표시한다.
- 실패하면 `ffmpeg 다운로드 실패: ...`. **부분 파일을 지우지 않는다.**
- 알려진 문제: `state.durationFound`를 잠금 없이 읽고(`hls.go:177`), `ffmpegCmd.ProcessState`를 다른 고루틴에서 읽는다(`:156`, data race). 루프 안에서 매번 `regexp.MustCompile`한다.

Rust 대체 요구사항(ROADMAP Phase 1):
- master playlist에서 encodingTrackId에 해당하는 variant를 고르고, media playlist의 세그먼트를 차례로 받아 이어 붙인다. 사전 조사 결과(`docs/research/hls-live-rewind.md`, fixture `testdata/hls/`): **fMP4**(`EXT-X-MAP` init + `.m4v` 세그먼트, 오디오·비디오 muxed), `EXT-X-KEY` 없음, 모든 URI는 상대경로, 서명은 master의 `hdnts` 쿼리와 media·세그먼트 경로 안의 `hdntl=...` 디렉토리다. UA·Referer·쿠키는 필요 없다. 지원하지 않는 태그(DISCONTINUITY, 두 번째 MAP, KEY)를 만나면 실패한다.
- 진행률은 세그먼트 수와 누적 바이트로, ETA는 세그먼트 비율로 계산한다.
  - **정정(설계 §12-4)**: ETA는 세그먼트 수가 아니라 **EXTINF 누적 비율**(받은 미디어 초 / 전체 미디어 초)로 계산한다. 마지막 세그먼트가 짧아도 왜곡되지 않는다.
- 실패하면 `.part`를 지우거나, 재개 가능하게 남긴다.(→ 남긴다. 정정 §12-5)

### 6.3 중복 파일 처리 (`CheckDuplicateFileDirect`, `common.go:83-125`)

- `os.Stat(outputFile)`이 실패하면(파일 없음 포함) 그대로 진행한다.
- 파일이 있으면 묻는다. `1`이면 덮어쓰고 진행(true), `2`이면 건너뛴다(false, 다운로드 함수가 `nil`을 반환한다). 그 밖의 입력은 다시 묻는다. 입력은 TrimSpace한다.
- **이어받기 옵션은 없다**(테스트로 고정돼 있다. `CLAUDE.md`의 "이어받기" 서술은 옛 내용이다).
- VOD와 클립 모두 이 함수를 쓰고, 소스 URL 조회 **전에** 호출한다.
- Rust/GUI: `enum DuplicatePolicy { Overwrite, Skip }`. UI는 선택만 담당하고, 코어는 정책을 인자로 받는다.

### 6.4 파일명 생성 (main.go:225-245)

```
videoTitle  = TrimSpace(vodInfo.VideoTitle)
channelName = vodInfo.Channel.ChannelName
_, startTimeStr = FormatLiveDate(vodInfo.LiveOpenDate)   // 두 번째 반환값 = "YYYY-MM-DD"
if startTimeStr == "":  "[{channel}] {title}.mp4"
else:                   "[{YYYY-MM-DD}] {channel} {title}.mp4"
autoFilename = SanitizeFilename(위 문자열)
```

- **주의**: `[YYMMDD_HHMMSS]`(첫 번째 반환값 `recordingTime`)는 계산만 하고 **버린다.** 실제로는 `YYYY-MM-DD`를 쓴다.
- **주의**: `SanitizeFilename`이 `[` `]` `(` `)`를 `_`로 바꾸므로, 대괄호를 의도한 형식이 실제로는 다음처럼 나온다(golden):
  - VOD: `[2024-01-02] 채널 제목.mp4`가 `_2024-01-02_ 채널 제목.mp4`가 된다.
  - 클립: `[채널] 제목.mp4`가 `_채널_ 제목.mp4`가 된다.
- Rust에서 어느 형식을 쓸지는 결정 사항이다(§10의 열린 질문).

`FormatLiveDate(raw)` (`internal/utils/utils.go:45-75`):
- `""`이면 `("", "")`
- 공백으로 split한다. 요소가 2개 이상이면 date=[0], time=[1]이고, 아니면 time=`00:00:00`
- date를 `-`로 split해 3개가 아니면 `("", "")`
- time을 `:`로 split해 3개가 아니면 `00`,`00`,`00`
- `recordingTime = y[2:] + m + d + "_" + hh + mm + ss`, `startTime = date`
- `y`가 2글자 미만이면 `y[2:]`에서 **panic**한다.

| 입력 | (recordingTime, startTime) |
|---|---|
| `2024-01-02 12:34:56` | (`240102_123456`, `2024-01-02`) |
| `2024-01-02` | (`240102_000000`, `2024-01-02`) |
| `2024-01-02 12:34` | (`240102_000000`, `2024-01-02`) |
| `2024/01/02` | (`""`, `""`) |
| `""` | (`""`, `""`) |
| `24-01-02 01:02:03` | (`0102_010203`, `24-01-02`) (자릿수 검증 없음) |
| `2024-01-02T12:34:56` | (`240102T12:34:56_000000`, `2024-01-02T12:34:56`) (ISO 형식이면 날짜가 아니라 문자열 전체가 startTime이 된다) |
| `2026-01-02 12:00:00` (fixture) | (`261005_060835`, `2026-10-05`) → 파일명 `_2026-10-05_ 테스트채널 123.mp4` |

`SanitizeFilename(name)` (`utils.go:12-42`):
1. 확장자 분리: `.`을 포함하고 `.`으로 끝나지 않으면 마지막 `.` 뒤를 확장자로 본다. 확장자에는 아무것도 하지 않는다.
2. base에서 `　`(전각 공백)과 ` `(NBSP)을 `" "`로 바꾼다.
3. 정규식 `[\r\n\t]+`에 맞는 부분을 지운다.
4. 정규식 `[\\/:*?"<>|(){}\[\]]`에 맞는 문자를 `_`로 바꾼다. **`( ) { } [ ]`도 포함된다.**
5. base를 TrimSpace한다(Go `unicode.IsSpace` 기준).
6. base가 비면 `_`
7. `base + ext`

| 입력 | 출력 |
|---|---|
| `[2024-01-02] 채널 제목.mp4` | `_2024-01-02_ 채널 제목.mp4` |
| `[채널] 제목.mp4` | `_채널_ 제목.mp4` |
| `a.b.c` | `a.b.c` |
| `noext` | `noext` |
| `trail.` | `trail.` |
| `"  sp　ace x  .mp4"` | `sp ace x.mp4` |
| `"a\r\nb\tc.mp4"` | `abc.mp4` |
| `x:y*z?"<>\|(){}[]/\.mp4` | `x_y_z_____________.mp4` |
| `.mp4` | `_.mp4` |
| `""` | `_` |
| `CON.mp4` | `CON.mp4` (Windows 예약어를 처리하지 않는다) |
| `제목.  .mp4` | `제목..mp4` |

### 6.5 출력 경로 정규화 (`PrepareOutputPath`, `common.go:128-143`)

1. 소문자로 바꾼 파일명이 `__mp4`로 끝나면 `strings.Replace(name, "__mp4", ".mp4", -1)`로 바꾼다. **치환은 대소문자를 구분한다.** 그렇지 않고 `.mp4`로 끝나지 않으면 `.mp4`를 붙인다.
2. `filepath.Join(filepath.Clean(folder), SanitizeFilename(name))`. main에서 이미 한 번 sanitize했으므로 두 번 적용된다(대체로 멱등).
3. 폴더 생성은 main(`main.go:360-366`, `MkdirAll 0755`)이 담당하고 다운로드 함수는 하지 않는다.

| folder=`/tmp/dl/`, Filename | 결과 |
|---|---|
| `[x] t.mp4` | `/tmp/dl/_x_ t.mp4` |
| `t` | `/tmp/dl/t.mp4` |
| `t__mp4` | `/tmp/dl/t.mp4` |
| `T.MP4` | `/tmp/dl/T.MP4` |
| `a__MP4` | `/tmp/dl/a__MP4` (버그: 확장자 없음) |
| `a/b` | `/tmp/dl/a_b.mp4` |

### 6.6 구간 다운로드·속도 옵션: **연결되지 않음**

- `DownloadOptions.SpeedOption`, `DownloadOptions.DownloadSection`(`types.go:9-10`)은 저장만 하고 **아무도 읽지 않는다.** main은 `downloadSection = ""`, `speedOption = "100%"`로 고정한다(`main.go:385-386`, 주석 "구간 다운로드 관련 코드 제거").
- 호출처가 없는 함수: `ValidateTimeRange`, `HmsToSeconds`, `IsDigit`, `config.AddRecentURL`, `downloader.parseFFmpegOutput`
- 실제로 쓰는 시간 함수는 `SecondsToHms` 하나다(ETA, ffmpeg 총 길이).
- 구간 다운로드를 다시 넣는다면 아래 동작을 참고한다(golden):
  - `ValidateTimeRange`: 정규식 `^(\d{2}):(\d{2}):(\d{2})~(\d{2}):(\d{2}):(\d{2})$`. `01:00:00~02:00:00`은 true, `1:00:00~02:00:00`은 false, `01:00:00-02:00:00`은 false. 시작<끝인지, 분·초가 60 미만인지는 검사하지 않는다.
  - `HmsToSeconds`: `:`로 split해 3개가 아니면 0. 각 요소를 Atoi하고 실패하면 0. `01:02:03`은 3723, `1:2:3`은 3723, `00:00`은 0, `aa:01:02`는 62, `100:00:00`은 360000
  - `SecondsToHms`: `%02d:%02d:%02d`. 0은 `00:00:00`, 59는 `00:00:59`, 3661은 `01:01:01`, 86399는 `23:59:59`, 360000은 `100:00:00`, **-1은 `00:00:-1`**
  - `IsDigit`: `unicode.IsDigit` 기준. `""`은 **true**, `123`은 true, `12a`는 false, `١٢`(아랍 숫자)는 true

---

## 7. 설정·인증 파일

### 7.1 위치

| 항목 | 경로 |
|---|---|
| base | `filepath.Dir(os.Executable())`. 실패하면 cwd. `go run`으로 실행하면 임시 디렉토리가 된다 |
| 설정 | `{base}/settings.json` |
| 쿠키 | `{base}/dependent/cookie.json` |
| 기본 다운로드 폴더 | `{base}/downloads` |
| ffmpeg | PATH(`exec.LookPath("ffmpeg")`)를 먼저 찾고, 없으면 `{base}/dependent/ffmpeg/bin/ffmpeg[.exe]` |

Rust/Tauri에서는 `app_config_dir()`나 `app_data_dir()`로 옮긴다. 실행 파일 디렉토리는 macOS `.app`이나 Program Files에서 쓰기가 막힐 수 있다. 첫 실행 때 옛 위치에서 마이그레이션하는 것을 검토한다.

> **정정(설계 §12-6)**: 첫 실행 때의 자동 마이그레이션(`current_exe().parent()`를 한 번 살핌)은 best-effort다. 새 앱은 옛 exe 위치를 모르므로 **설정 화면의 "이전 버전 설정 가져오기"(폴더 선택)가 주 경로**다. 둘 다 `chzzk_core::import_legacy(dir)`를 쓴다(읽기 전용, 원본 보존).

### 7.2 `settings.json`: `UserSettings` (`config.go:26-35`)

`json.MarshalIndent(_, "", "  ")`로 쓰고, 권한은 `0644`다.

| 필드 | 타입 | 의미 |
|---|---|---|
| `downloadFolder` | string | 마지막 다운로드 폴더. 파일이 없을 때 기본값은 `{base}/downloads` |
| `isAdultContent` | bool | 성인 인증 사용 여부 |
| `nidAut` | string | NID_AUT **평문** (cookie.json과 중복 저장) |
| `nidSes` | string | NID_SES **평문** |
| `lastQualityName` | string | 마지막으로 고른 `Quality.Quality` 문자열(ID가 아니다) |
| `lastVodURL` | string | 마지막 URL |
| `recentVodURLs` | string[] \| **null** | 하위 호환용. RecentVods의 URL만 담는다 |
| `recentVods` | `{url, title}[]` \| **null** | 최근 목록 |

- 직렬화(Go로 확인): `omitempty`가 없어 8개 키를 항상 쓴다. 빈 slice(nil)는 **`null`**로 쓴다. 첫 실행에서 "일반 컨텐츠"를 고르기만 해도 `"recentVodURLs": null, "recentVods": null`인 파일이 생긴다. **Rust는 모든 필드에 `#[serde(default)]`를 두고, 배열은 null을 빈 Vec로 받는다**(그러지 않으면 기존 사용자 설정 마이그레이션이 실패한다).
- 역직렬화: 키가 없으면 미리 채운 기본값(`downloadFolder = {base}/downloads`)이 남는다. `"downloadFolder": ""`처럼 키가 있으면 빈 값이 되고, main이 그때 기본 폴더로 대신한다(`main.go:342-345`). Go는 JSON 키를 **대소문자 구분 없이** 맞추지만(`DOWNLOADFOLDER`도 읽힘) serde는 구분한다. Go가 쓴 파일은 키가 정확하므로 문제되지 않는다.
- 로드: 파일이 없으면 기본값을 반환하고 오류는 없다. JSON 오류는 그대로 반환하며, main은 기본값으로 계속한다. 이때 `UpdateUserSettings`도 로드 오류로 바로 반환하고 main은 반환값을 무시하므로, **settings.json이 깨져 있으면 이후 어떤 설정도 저장되지 않는다.** `SetAdultCookies`도 settings 갱신에서 실패해 cookie.json을 쓰지 못한다.
- 레거시 마이그레이션(로드할 때): `recentVods`가 비고 `recentVodURLs`가 있으면 각 URL을 `{url, title: "제목 없음"}`으로 채운다(메모리에서만, 저장은 다음 Save 때).
- `UpdateUserSettings(fn)`: 매번 Load, fn 실행, Save. 잠금이 없고 원자적 쓰기(임시 파일+rename)도 하지 않는다.
- `AddRecentVod(s, url, title)` (`config.go:88-127`):
  - title이 **50바이트**를 넘으면 `title[:47] + "..."`. 바이트로 자르므로 한글 UTF-8이 깨진다(버그). Go는 직렬화할 때 U+FFFD로 바꾸고, Rust는 panic한다. **Rust는 문자(char) 수 기준**으로 50자를 넘으면 47자+`...`로 한다.
  - 같은 URL을 지우고 맨 앞에 넣은 뒤 **최대 5개**로 자른다.
  - `lastVodURL = url`, `recentVodURLs = RecentVods의 URL들`
- main이 기록하는 제목은 `"[{channelName}] {videoTitle}"`이다(main.go:227). 화질 목록 조회에 성공한 직후, 다운로드 전에 기록한다.

### 7.3 `cookie.json`

- 평면 JSON object(`map[string]string`). 2칸 들여쓰기, 권한 `0644`. 디렉토리가 없으면 `MkdirAll(dependent, 0755)`
  ```json
  {
    "NID_AUT": "...",
    "NID_SES": "..."
  }
  ```
- `SetAdultCookies(aut, ses)`: 기존 맵을 로드하고 두 키를 덮어쓴 다음, settings(`isAdultContent=true`, nidAut, nidSes)와 cookie.json을 모두 저장한다.
- 읽기 실패나 파싱 실패는 빈 맵으로 조용히 처리한다.
- 파일의 **모든 키**가 Cookie 헤더에 들어간다.

---

## 8. 기존 테스트 케이스 (1:1 이식 목록)

`go test ./...` 결과(2026-10-05):

```
?   	chzzk-downloader/cmd/chzzk-downloader	[no test files]
ok  	chzzk-downloader/internal/api	0.550s
ok  	chzzk-downloader/internal/config	0.945s
ok  	chzzk-downloader/internal/downloader	1.383s
?   	chzzk-downloader/internal/setup	[no test files]
?   	chzzk-downloader/internal/utils	[no test files]
```

`go vet ./...`은 출력이 없다(통과).

### 8.1 `internal/api/clip_test.go` → `crates/core` api/mpd

- **TestIsClipURL**
  - `https://chzzk.naver.com/clips/TestClip01` → true
  - `https://chzzk.naver.com/clips/AbCdEf1234/` → true
  - `https://chzzk.naver.com/embed/clip/AbCdEf1234` → true
  - `https://chzzk.naver.com/video/1234567` → false
  - `https://chzzk.naver.com/` → false
  - `""` → false
- **TestParseClipID**
  - `https://chzzk.naver.com/clips/TestClip01` → `TestClip01`
  - `https://chzzk.naver.com/clips/AbCdEf1234/` → `AbCdEf1234`
  - `https://chzzk.naver.com/clips/AbCdEf1234?param=1` → `AbCdEf1234`
  - `https://chzzk.naver.com/embed/clip/AbCdEf1234` → `AbCdEf1234`
  - `https://chzzk.naver.com/embed/clip/AbCdEf1234?autoPlay=true` → `AbCdEf1234`
  - `https://chzzk.naver.com/video/1234567` → 오류
- **TestParseClipQualitiesFromMPD** (`testdata/clip_multi.mpd`)
  - 결과 2개, 모든 ID가 `PD_`로 시작한다.
  - 추가 권장 assert: §5.4 표 전체(ID, `720p`/`480p`, bandwidth/width/height/frameRate, BaseURL이 `/pd/`와 `.mp4`를 포함)
- **TestSelectClipBaseURLFromMPD** (`testdata/clip_multi.mpd`)
  - `PD_720P_1280_2048_192` → URL이 `/pd/`와 `.mp4`를 포함한다.
  - `PD_NONEXISTENT` → 오류
- fixture `clip_playinfo.json`, `clip_multi_playinfo.json`은 **어떤 테스트에서도 쓰지 않는다.** Rust에서는 `parse_clip_info` 테스트에 쓴다. 기대값: code 200, `contentTitle`(`테스트 클립 하나` / `테스트 클립 둘 - A vs B | 여러 화질 #태그`), videoId(`0000000000000000000000000000000000C03` / `0000000000000000000000000000000000C04`), inKey가 비어 있지 않음, adult false, channelName `클립채널`, channelId `000000000000000000000000000000c3`

### 8.2 `internal/downloader/direct_test.go` → download

- **TestDownloadDirectMP4_ByteIdentity**: 서버가 `"chzzk-progressive-mp4-bytes!"`×5000(140000바이트)을 Content-Length와 200으로 보내면 저장 파일이 바이트 단위로 같아야 한다.
- **TestDownloadDirectMP4_SendsHeaders**: headers `{User-Agent: TestUA/1.0, Referer: https://chzzk.naver.com/, Cookie: NID_AUT=a; NID_SES=b}`를 넘기면 서버가 세 값을 그대로 받는다.
- **TestDownloadDirectMP4_Non200DeletesPartial**: 404이면 오류를 반환하고 출력 파일이 없어야 한다.
  - 한계: Go는 상태 검사(`direct.go:37`)가 `os.Create`(`:41`)보다 앞이라 삭제 경로를 실제로 거치지 않는다.
  - **추가 권장**: 스트림 중간에 끊기는 경우(Content-Length보다 적게 보내고 연결을 닫음)에 오류를 내고 파일이 없는지 확인하는 테스트(`:55`, `:59` 경로)
  - **정정(설계 §12-5)**: Rust 테스트는 "파일 삭제"가 아니라 "**`.part` 보존, 최종 파일 없음**"을 본다(`progressive::truncated_body_resumes`). 404는 상태 확인이 먼저라 `.part`도 sidecar도 만들지 않는다(`progressive::status_404_creates_nothing`).
- **TestComputeSpeedETA**
  - (1MiB, 2MiB, 1s) → speed와 eta가 비어 있지 않음. golden은 `1.0 MB/s`, `00:00:01`
  - (1024, 2048, 0) → Go는 panic이 없는지만 보고 `t.Logf`만 한다. **Rust는 `("", "")`를 assert한다.**
  - (1024, 0, 1s) → eta `""`

### 8.3 `internal/downloader/common_test.go`

- **TestDirectDuplicateChoice**: `"1"` → (proceed=true, valid=true), `"2"` → (false, true), `"3"` → (false, false), `""` → (false, false), `"x"` → (false, false). 이어받기 옵션이 없음을 고정하는 테스트다. Rust에서는 CLI 입력 해석 대신 `DuplicatePolicy`가 두 값뿐임을 확인하는 형태로 바꿔도 된다.

### 8.4 ffmpeg/바이너리 관련: **이식하지 않는다** (ffmpeg 제거). 의도만 옮긴다

- `hls_test.go`
  - TestBuildFFmpegArgs_CoreOptions: `-i <url>`, `-c copy`, `-progress`, 마지막 인자 = 출력 파일
  - TestBuildFFmpegArgs_HeadersAndUserAgent: UA는 `-user_agent`로, 나머지는 `-headers "Cookie: NID_AUT=a; NID_SES=b\r\nReferer: https://chzzk.naver.com/\r\n"`(키 정렬)로, `-headers`에 UA가 중복되지 않음
  - TestRedactedCmdString_HidesCookie: `secretAUT`, `secretSES`는 로그에 없고 소스 URL과 `chzzk.naver.com`은 있음
    - **의도를 이식**: Rust 로그와 이벤트에 Cookie 값이 나오지 않는다는 테스트
  - TestBuildFFmpegArgs_NoHeadersOmitsHeaderFlags: 헤더가 없으면 `-user_agent`와 `-headers`가 없음
- `config_test.go`
  - TestGetFFmpeg_ResolvesFromPath, TestGetFFmpeg_FallsBackToBundled, TestEnsureBinaries_AllPresentReturnsNil, TestEnsureBinaries_MissingReturnsActionableError(오류에 `ffmpeg`, `brew` 포함): 모두 폐기

### 8.5 테스트가 없던 순수 함수: Rust에서 새로 고정할 golden

§1.1 표, §1.2(요청 path), §4.1(빠른 다시보기 fixture `testdata/hls/video_info.json`의 화질 표와 master path), §5.4, §5.6(기본 선택 index), §6.1(`formatBytes`, `computeSpeedETA`), §6.4(`FormatLiveDate`, `SanitizeFilename`), §6.5, §6.6, §7.2(`AddRecentVod`: 5개 제한, 중복 URL이 맨 앞으로 이동, 한글 50자 초과 시 잘림, 레거시 `recentVodURLs`가 `"제목 없음"`으로 채워짐)

---

## 9. Rust 이식 시 바꿀 점

### 9.1 버그와 quirk (고친다)

1. **VOD URL의 쿼리/fragment** (`vod.go:102`, `:262`): `?t=10` 같은 것이 videoNo에 섞인다. URL을 파싱해 host가 `chzzk.naver.com`인지, path가 `/video/{숫자}`인지 검증한다.
2. **클립 URL** (`clip.go:50-57`): `/embed/clip/`이면 ID가 `clip`이 되고, `#frag`가 남고, 호스트 검사가 없다. path 세그먼트 기준으로 `clips/{id}` 또는 `embed/clip/{id}`만 허용한다.
3. **DASH 화질 선택 불일치** (§4.3, `vod.go:222-250`과 `:370-405`): 숫자열 추출 대신 `rep.id` 정확 일치와 PD 필터를 쓰고 클립과 공유한다.
4. **HLS 화질 무시** (`vod.go:328-334`): encodingTrackId로 variant를 고른다.
5. **unchecked type assertion으로 인한 panic** (`vod.go:169`, `:176`, `:177`, `:328`): serde 구조체와 `Option`으로 바꾼다. `media[0]` 고정 대신 `protocol == "HLS"`인 첫 항목을 쓴다(정정 §12-11).
6. **`%v` float 포맷** (`vod.go:181-184`): `3e+06`, `<nil>`. 숫자 필드(`videoBitRate`, `videoWidth`, `videoHeight`)는 `Option<u64>`로 둔다. `videoFrameRate`는 실물에서 문자열(`"60.0"`)이므로 `Option<String>`으로 받고 필요하면 따로 파싱한다.
7. **HTTP 상태 미검사** (`vod.go:117-135`, `:206-219`, `clip.go:231-237`): 2xx가 아니면 상태 코드를 담은 오류를 낸다. 401/403은 "인증 필요" 오류 종류로 분리한다. main의 성인 오류 판정(`main.go:204-207`)은 서버 message 문자열에 "성인/adult/unauthorized/인증"이 우연히 들어 있어야만 동작한다. Go 쪽 오류 문자열 중에는 이 단어를 만드는 것이 없다.
8. **타임아웃/취소 없음**: connect와 read 타임아웃을 두고 취소 토큰을 지원한다(GUI 취소 버튼).
9. **부분 파일** (`direct.go:41`): `{name}.part`에 쓰고 성공하면 rename한다. 길이 불일치는 명시적으로 오류 처리한다(§6.1-5). ffmpeg 경로는 실패해도 부분 파일을 지우지 않았다(`hls.go:269-271`). 세그먼트 다운로더도 ffmpeg 경로가 아니라 이 `.part` 규칙을 따른다.
10. **한글 제목 바이트 자르기** (`config.go:91-93`): 문자 수 기준으로 자른다.
11. **"일반 컨텐츠"를 골라도 쿠키를 보냄** (`main.go:54-62`, `config.go:281-288`): `isAdultContent=false`인데 cookie.json이 남아 있으면 계속 전송된다. 쿠키 사용 여부는 설정 플래그 하나로 결정한다.
12. **settings를 한 번만 로드** (`main.go:130`): 루프 두 번째 반복부터 최근 목록, 마지막 화질, 다운로드 폴더가 옛 값이다. GUI에서는 상태 저장소를 하나만 둔다.
13. **비결정적 Cookie 순서** (`config.go:283-287`): 정해진 순서(`NID_AUT`, `NID_SES`, 이후 키 정렬)로 한다.
14. **macOS에 Linux UA** (`config.go:268-272`), Chrome 98 고정: OS별 최신 UA 상수를 쓰고 한 곳에서 관리한다.
15. **`PrepareOutputPath` 대소문자** (`common.go:132-133`): `a__MP4`면 확장자가 붙지 않는다. `__mp4` 레거시 규칙 자체를 없애고 확장자는 코어가 결정한다.
16. **파일명 형식** (main.go:235-244): `[YYMMDD_HHMMSS]`는 버리고 `YYYY-MM-DD`를 쓰며, 대괄호는 sanitize로 `_`가 된다. 형식을 새로 정한다(열린 질문). sanitize 규칙에서 `[]()`를 금지 문자에서 뺄지도 같이 정한다(Windows에서는 합법적인 문자다).
17. **`SanitizeFilename` 보강** (`utils.go:12-42`): Windows 예약어(`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`), 끝의 `.`과 공백, 그 밖의 제어문자(U+0000-001F), 길이 제한(255바이트, 확장자 보존), 두 번 적용하는 문제를 처리한다.
    - **정정(설계 §12-7)**: 길이 제한은 255바이트가 아니라 **UTF-8 200바이트**다(`.part.json` 접미사 몫과 한글 3바이트 여유). 예약어·끝 `.`/공백 규칙은 **Windows 프로필에만** 적용한다(`sanitize_filename(name, Platform)`).
18. **`FormatLiveDate` panic** (`utils.go:71`, `y[2:]`): `chrono`로 파싱하고 실패하면 날짜 없이 처리한다.
19. **`SecondsToHms` 음수** (`utils.go:109-114`): `-1`이 `00:00:-1`이 된다. `u64`를 받게 한다.
20. **평문 자격증명 중복 저장** (settings.json의 `nidAut`/`nidSes`와 cookie.json, 권한 `0644`): 한 곳(가능하면 OS 키체인, 아니면 `0600` 파일)에만 저장한다. 미디어 CDN에 쿠키를 보내야 하는지 확인하고, 필요 없으면 API에만 보낸다(`core.go:57-66`).
    - **정정(설계 §12-8)**: 키체인은 쓰지 않고 `{config_dir}/credentials.json`(Unix `0600`, `CredentialStore`) 하나에만 저장한다(미서명 배포의 macOS ACL 프롬프트, Linux secret-service 의존 때문). 미디어에는 쿠키를 보내지 않는다(§2.2 정정).
21. **설정 쓰기 경쟁** (`config.go:197-206`): Load-수정-Save에 잠금이 없고 원자적 쓰기도 아니다. 임시 파일과 rename을 쓰고, 단일 소유자(Tauri state)만 쓴다.
22. **중복 조회**: Go는 화질 목록용과 URL용으로 info와 MPD를 두 번씩 받는다. 서명 URL이 만료되므로 재조회 자체는 맞다. 다만 같은 코드를 두 벌 두지 말고 `resolve()` 하나를 재사용한다.
23. **ffmpeg 경로의 data race** (`hls.go:156`, `:177`): 경로 자체를 버리므로 기록만 남긴다.
24. **채널 ID 미파싱**: VOD는 `content.channel.channelId`(빠른 다시보기 fixture로 확인), 클립은 `content.ownerChannel.channelId`. Phase 3 본인 채널 검사에 필요하므로 `ContentMeta.channel_id`로 노출한다.
25. **main의 안내 문구 오류** (`main.go:383`): DASH VOD에도 "HLS 방식으로 전체 다운로드"라고 출력한다. GUI에서는 실제 소스 종류를 보여 준다.

### 9.2 옮기지 않는 것

- `internal/setup/setup.go` 전체: win64 ffmpeg zip 설치기다. **어디서도 import하지 않는다.** zip 경로 검증이 없고(zip-slip, `setup.go:107`), 오류를 무시하는 곳이 많다.
- ffmpeg 관련 일체: `hls.go`, `config.GetFFmpeg`, `EnsureBinaries`, `resolveBinary`, `exeName`, `parseFFmpegOutput`
- CLI 프롬프트와 출력: `main.go` 전체(성인 인증 질의, 최근 목록 번호 입력 `len(input) <= 2` 규칙, 박스 UI, `printDownloadStatus`의 `\r` 덮어쓰기, "Enter 키를 누르면 창이 닫힙니다"). 대응하는 GUI 화면으로 대체한다.
- `CheckDuplicateFileDirect`의 stdin 대화. 정책 enum만 남긴다.
- 사용하지 않는 코드: `DownloadOptions.SpeedOption`/`DownloadSection`, `ValidateTimeRange`, `HmsToSeconds`, `IsDigit`, `AddRecentURL`. 구간 다운로드를 다시 넣을 때 새로 설계한다.
- `recentVodURLs` 쓰기: 읽기 마이그레이션만 유지하고 새로 쓰지 않는다(필요하면 한 버전만 병행).
- `os.Executable` 기준 데이터 경로: Tauri의 앱 데이터 디렉토리로 바꾼다.

---

## 10. 열린 질문·추가로 확보할 것

1. **fixture 부족**: 빠른 다시보기(inKey 없음)는 `testdata/hls/`로 확보했다. ~~일반 VOD(inKey 있음)의 info JSON과 MPD는 아직 fixture 파일이 없다.~~ **정정(설계 §12-12)**: 일반 VOD의 info와 MPD는 `testdata/vod/`로 확보했다(`video/mp4` PD_144P·PD_720P + `video/mp2t` + `audio/mp4`, `ContentProtection` 없음). AES 지원 여부는 설계 §11(기본값 거부). 당시 남은 확인 사항:
   - VOD MPD fixture 파일 확보. research §10은 비암호화 VOD 4개에서 `PD_*` + `/pd/` rep를 관찰했다. 이 관찰을 테스트로 고정해야 Rust PD 필터를 VOD에도 확정할 수 있다.
   - `encryptionType: "AES"` VOD를 지원할지(research §11.1). 지원하지 않으면 §3.1처럼 info 단계에서 명확한 오류를 낸다.
   - `media[]`에 둘 이상이 오는 경우가 있는지(표본에서는 1개)
   - (해결됨) `encodingTrackId` 형식(`"720p"`)과 variant 디렉토리의 대응, VOD 응답의 `channel.channelId` 경로
   - 참고: research §10은 AES VOD에서 Go가 "원하는 품질의 BaseURL을 찾을 수 없습니다"로 실패한다고 적었지만, 실제로는 그 전에 `GetVODQualities`가 빈 목록을 돌려주고 main이 `사용 가능한 품질 정보를 찾지 못했습니다`에서 멈춘다(§3.1).
2. **성인/구독자 전용 컨텐츠 오류 형태**: 쿠키가 없을 때 info API가 어떤 code와 message를 주는지, `inKey`와 `liveRewindPlaybackJson`이 비어서 오는지
3. **파일명 형식**: 현재 `_YYYY-MM-DD_ 채널 제목.mp4`(사실상 의도치 않은 결과)를 유지할지, `[YYMMDD_HHMMSS]`나 `[YYYY-MM-DD]`로 바꿀지
4. **미디어 요청 Cookie**: HLS CDN(`navercdn.com`)은 UA·Referer·쿠키 없이 URL 서명만으로 받아진다(research §7). PD mp4의 pstatic CDN이 쿠키 없이도 받아지는지는 아직 확인하지 않았다. **정정(설계 §12-8)**: 비성인 PD는 쿠키·Referer 없이 받아짐을 실측했다(2026-10-05, 9000002·9000006·클립 TestClip01). Rust는 미디어에 쿠키를 보내지 않는다. 성인 PD는 미실측(`cookies_on_media` 스위치로 대비).
5. **문서 정합성**: `CLAUDE.md`가 옛 내용이다(streamlink, `DownloadHLS`, 이어받기, 주석 처리된 `ensureDependencies` 호출 모두 현재 코드에 없음). Phase 1에서 함께 갱신한다.
