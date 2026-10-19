# 받기 전 미리보기: 명세

**상태·확정 결정(2026-10-20)**: **구현 완료(PV-1~PV-8, 아래 §16 구현 결과).** 사용자 실측 M-PV-1~7이 남았고, 그중 M-PV-5가 PV-7 머지 조건이다. 본문은 설계 당시 그대로이고, 구현이 달라진 곳은 §16과 core.md 86·87, app.md 108~114가 우선한다. 사용자 결정(2026-10-20)은 다음과 같다.
- **1번**: 일반 VOD와 클립(통짜 mp4, PD)을 앱 화면의 기본 `<video>`로 재생한다. Rust가 Tauri 사용자 정의 주소(URI scheme)로 중계한다. 그래서 서명 토큰이 프런트로 가지 않고 CORS도 피한다. 탐색(Range)을 지원한다.
- **2번**: 빠른 다시보기(HLS fMP4)를 hls.js로 재생한다. 미리보기 재생기에서 시작·끝을 찍어 기존 구간 받기 입력에 넣는다.
- 생방송 미리보기는 범위 밖이다.
- **적대적 검토 둘 반영(2026-10-20)**: 보안·정확성 S1~S10, 계획·TDD·제약 P1~P14. 판정과 이유는 §15다.

구현은 TDD로 한다. 실패 테스트를 먼저 쓰고, 최소 구현으로 녹색을 만든다(§10·§11).

기준 트리는 `origin/master` `9401248`(#176 머지 뒤, 앱 0.11.0)이다. 형식과 근거 표기는 `range.md`와 `audio-only.md`를 따른다.
- **[확인]**: 이 트리에서 직접 연 줄이 받친다.
- **[가정]**: 코드로 확인하지 못한 판단이다. 일반 지식이나 설계 선택이다.
- **[실측 필요]**: 실물 영상이나 3 OS 웹뷰로만 정할 수 있다(§13 M-PV-*).
- **[잠정]**: 숫자 상수다. 근거가 약하고 실측으로 조인다.

예시 값(세션 ID·주소·번호)은 모두 가짜 값이다. 공개 저장소 규칙을 따른다.

---

## 0. 핵심 결정(요약)

| # | 결정 | 근거 |
|---|---|---|
| PV1 | scheme 이름은 `watch`다. 주소는 macOS·Linux가 `watch://localhost/<sid>/…`, Windows가 `http://watch.localhost/<sid>/…`다. 주소 문자열은 Rust가 만들어 DTO로 준다 | Tauri 문서의 OS별 출처(tauri-2.12.2 `app.rs:2331-2333`) [확인]. `useHttpsScheme`은 쓰지 않는다(`tauri.conf.json` 창 설정에 없음) [확인]. command 이름 `preview_*`는 `preview_file_name_template`이 이미 쓴다(`command_names.rs`) [확인] |
| PV2 | 처리기는 `register_asynchronous_uri_scheme_protocol`로 등록한다. 몸통은 tokio 태스크에서 돈다 | 시그니처 `Fn(UriSchemeContext, http::Request<Vec<u8>>, UriSchemeResponder)`(`app.rs:2335-2347`) [확인]. 동기 처리기는 웹뷰 스레드를 막는다 [가정] |
| PV3 | **중계는 스트림이 아니라 상한 크기로 자른 206 조각이다.** `total`은 `watch_open`이 업스트림에 `bytes=0-0`을 한 번 보내 세션에 정해 둔다(검토 반영 S1). 웹뷰 요청이 `bytes=N-`이거나 Range가 없으면 끝을 `min(N + CHUNK - 1, total - 1)`로 자른다. 업스트림에는 닫힌 `Range: bytes=N-M`을 보낸다. 응답의 `Content-Range: bytes a-b/total`과 `Content-Length`는 **업스트림이 실제로 준 `a-b`와 실제로 받은 본문 길이가 일치할 때만** 그 값으로 낸다. 업스트림 `total`이 세션 `total`과 다르면 언제든 `SourceChanged`다. `CHUNK = 4 MiB` **[잠정]** | `UriSchemeResponder::respond`는 본문 전체(`Into<Cow<'static,[u8]>>`)를 한 번에 받는다(`app.rs:2629-2632`) [확인]. 그래서 응답 스트림을 흘릴 수 없다. Tauri asset 프로토콜도 같은 조각 방식이다(`MAX_LEN` 1000 KiB, `protocol/asset.rs:123-139`) [확인]. 받기 쪽 `parse_content_range`는 끝값을 버리고 `bytes */N`을 start 0으로 읽으므로(`progressive.rs:262-274`) 쓰지 않는다 [확인]. `PdRep`에는 크기가 없다(`model.rs:114-118`) [확인] |
| PV4 | 업스트림이 Range를 무시하고 `200`을 주면 중계는 실패로 닫는다(`502`). 프런트는 대체 경로(치지직에서 보기)를 보인다. 전체 본문을 메모리에 올리지 않는다 | 서버가 Range를 무시하는 분기가 코드에 있다(`progressive.rs:6`) [확인]. 수백 MB를 한 응답에 담을 수 없다(PV3) |
| PV5 | 미리보기 세션은 셸 `WatchService<B: Backend>`가 갖는다. 열기는 `watch_open`, 닫기는 `watch_close`다. ID는 `getrandom` 16바이트의 hex 32자다. **앱 전체에서 동시에 1개**다. 새로 열면 이전 세션을 닫는다. 유휴 10분 **[잠정]**이면 버린다(시계는 `tokio::time::Instant`, 테스트는 `start_paused`). 로그아웃하면 모두 닫는다 | `DownloadManager<B>`와 같은 모양이다(`app.rs:88`, `backend.rs:19`) [확인]. `getrandom`은 이미 셸 의존성이다(`crates/shell/Cargo.toml:15`) [확인]. 카드는 한 번에 하나다(`ResolveCard.svelte:69` `{#key}`) |
| PV6 | **게이트는 두 지점에 둔다.** ① `watch_open`은 `enqueue_checked`와 같은 순서로 막는다. command 게이트 → url과 content 일치 → `OwnershipGate::admit_checked(content, fetch, recheck)`이고, fail closed다. `recheck`는 받기와 같은 `App::recheck`(관리자 확인·위임 갱신)를 클로저로 넘긴다. ② scheme 요청은 요청마다 창 라벨 `main`, 로그인(`require_signed_in`), 세션의 로그인 채널 = 현재 채널을 확인한다. 재조회 뒤에도 같은 `recheck`로 `admit_checked`를 다시 부른다. **로그인을 쓰지 않는 빌드(`auth` 없음)는 받기와 같이 허용한다.** `gate_command`·`admit_checked`가 통과시키는 것과 같다. 이때 세션 `me`는 `None`이고 로그인·채널 검사는 건너뛴다(검토 반영 S3·P1) | `enqueue_checked`의 순서(`services.rs:662-674`) [확인], `admit_checked`(`ownership.rs:187-229`) [확인], `gate_command`(`app.rs:471-477`, auth 없으면 Ok) [확인], `admit_checked`(auth 없으면 `Ok(None)`, `ownership.rs:198-200`) [확인], `App::recheck`(`app.rs:401-408`) [확인]. IPC 테스트 픽스처 기본 `auth:false`(`ipc.rs:199`), 가짜 백엔드 기본 `AUTH_DISABLED`(`backend.ts:301`) [확인]. scheme 요청은 invoke 처리기와 AuthGate를 거치지 않는다(`lib.rs:117-176`의 게이트는 invoke 전용) [가정: Tauri 구조] |
| PV7 | 403이면 세션 안에서 한 번만 재조회한다. `Chzzk::resolve` → 같은 `quality_id`를 다시 고르고(`select_pd`·`pick_variant`) → 같은 요청을 1회 재시도한다. 직후 또 403이면 그 요청은 `403`이다. 세션당 재조회(실제 resolve)는 8회까지다. **세대 번호로 재조회를 합친다**(검토 반영 S2): 세션은 `Arc<Session>`이고 원천 상태에 `gen: u64`가 있다. 요청은 자기가 쓴 `gen`을 들고 간다. 403을 받으면 재조회 잠금을 잡은 뒤, 현재 `gen`이 더 크면 resolve 없이 새 주소로 1회만 재시도한다. 재조회 결과는 세션 ID가 그대로이고 `gen`이 같을 때만 쓴다(그 사이 close·새 open·로그아웃이면 버리고 그 요청은 `404`). PD는 `total`이 달라지면, HLS는 `durations_crc`가 달라지면 `409`로 닫는다 | 받기의 규칙(`progressive.rs:9-10`, `MAX_REFRESHES` `download/mod.rs:55`)을 `Job` 없이 다시 쓴다. `Job::resolve`는 비공개다 [확인: 지도, `mod.rs:329`]. `durations_crc`(`hls.rs:459`) [확인: 지도] |
| PV8 | HLS playlist는 **다시 쓰지 않고 새로 만든다.** master → `pick_variant` → media를 `hls::parse_media`로 읽은 뒤 우리 모델로 새 m3u8을 만든다. `#EXT-X-MAP:URI="init"`, 세그먼트는 `s/<i>`(0부터 매긴 불투명 번호), `#EXT-X-PLAYLIST-TYPE:VOD`, `#EXT-X-ENDLIST`다. 원본 텍스트·URI는 한 글자도 프런트로 가지 않는다 | `parse_media`는 받기와 같은 엄격 파서다(`hls.rs:195-200`) [확인: 지도]. 미리보기와 받기가 거부하는 영상이 같아진다. 상대 URI가 서명 경로를 담는다(`hls.rs:1-9`) [확인: 지도] |
| PV9 | hls.js는 **light 빌드**(`hls.js/light`)를 쓰고 동적 import한다. 설정은 `enableWorker: false`(CSP `worker-src`를 더하지 않는다), `lowLatencyMode: false`, 자격 증명 없음이다. 버전은 `minimumReleaseAge`를 넘긴 정확한 버전을 PV-6에서 고른다(`^` 없음). Apache-2.0 고지를 `licenses/hlsjs.txt`, AboutSection, Worker `/licenses` 생성기에 더한다. 생성기는 라이선스 원천을 경로 하나로 받고(`worker-gen.mjs:35`) AboutSection은 Lucide 한 행을 하드코딩한다(`AboutSection.svelte:116`) [확인]. 그래서 생성기 구조·`worker-gen.test.mjs`·`design-worker` 기준선·설정 갤러리 장면이 함께 바뀌고, 운영 반영에는 Worker 배포(별도 승인)가 필요하다. 고지는 **별도 PR PV-6L**로 PV-6 앞에 둔다(검토 반영 P7). `size.dist_gz` 기준은 `write --from-run`이 성공한 실행만 받으므로(`ratchet.json` `$comment`) CI 측정값을 손으로 옮기고 RATCHET_LOG 줄을 더한다(선례 RATCHET_LOG 2026-10-19 `windows-cli`, 검토 반영 P8) | `app/package.json`은 정확한 버전만 쓴다 [확인: 지도]. `gzipTotal`은 `dist` 아래 모든 파일을 더한다(`scripts/ci/measure.mjs:76-83`) [확인]. 그래서 **동적 import로 청크를 나눠도 `dist_gz`는 줄지 않는다.** 기준 87460에 여유는 약 2.6 KB다(`ci/ratchet.json`, 허용 3%) [확인] |
| PV10 | CSP: PV-3에서 `media-src 'self' watch: http://watch.localhost`를 더한다. PV-6에서 `media-src`에 `blob:`를, `connect-src`에 `watch: http://watch.localhost`를 더한다. `worker-src`는 더하지 않는다 | 지금 `media-src`가 없어 `default-src 'self'`로 떨어진다(`tauri.conf.json:31-41`) [확인]. CSP는 `tauri-conf.test.ts:73-84`가 `toEqual`로 고정한다 [확인]. 그래서 테스트를 먼저 고친다 |
| PV11 | hls.js의 XHR은 교차 출처라 scheme 응답에 `Access-Control-Allow-Origin`을 붙인다. 값은 **앱 출처 정확히 하나**다. 릴리스·`tauri build`는 macOS·Linux가 `tauri://localhost`, Windows가 `http://tauri.localhost`다. **dev 실행(`tauri::is_dev()`)은 설정 `build.devUrl`의 출처**(이 저장소는 `http://localhost:1420`)다(검토 반영 S4). `*`는 쓰지 않는다. 다른 `Origin`이 오면 ACAO를 빼고 `403`이다. Origin 검사는 CORS 요청만 거른다. `crossorigin` 없는 `<video>` 요청은 Origin을 보내지 않으므로 실제 방어선은 128비트 ID와 창 라벨이다(§7.3) | scheme 출처는 앱 출처와 다르다(`app.rs:2325-2333`) [확인]. 릴리스 앱 출처는 `manager/mod.rs:785-795`의 단언과 같다 [확인]. dev는 `get_app_url`이 `devUrl`을 쓴다(`manager/mod.rs:345-358`, `tauri.conf.json:8`) [확인]. 실제 웹뷰가 보내는 Origin은 M-PV-2로 확인한다 |
| PV12 | 미리보기 미디어 요청에는 **쿠키를 늘 보내지 않는다.** `cookies_on_media` 스위치를 무시한다. 성인 영상이 그래서 실패하면 대체 경로로 보낸다 | `media_get`은 스위치가 켜지면 쿠키를 붙인다(`client.rs:341-347`, `http.rs:166`) [확인]. CLAUDE.md "쿠키는 API·MPD 요청에만" |
| PV13 | 미리보기 화질은 **가장 낮은 비디오 화질 하나로 고정**한다. 오디오만 행은 빼고, 카드의 화질 선택과 묶지 않는다 | 빠른 시작, 작은 조각, 화질을 바꿀 때 세션을 다시 열지 않음. 오디오 행은 `quality.audio_only`다(`model.rs:63`) [확인: 지도] |
| PV14 | 재생기는 카드 안 `Disclosure variant="inline"`("미리보기")로 **기본 접힘**이다. 펼칠 때 `watch_open`을 부르고, 자동재생은 없다(`preload="metadata"`). 네이티브 `controls`를 쓴다. 접거나 카드가 사라지면 `watch_close`를 부른다. **`ownership`이 `notOwn`·`unknown`이면 줄을 그리지 않는다**(Disclosure에 비활성 상태가 없다, 검토 반영 P4). 접힌 줄 한 행만큼 높이 예산 표가 늘고, PV-4에서 그 표를 고친다 | 높이 520 예산 506이라 여유가 없다(`patterns.md:861`) [확인]. `Disclosure` Props에 `disabled`가 없다(`ui/Disclosure.svelte:10-15`) [확인]. 자동재생은 reduced-motion·소리 문제를 낳는다 [가정] |
| PV15 | 실패 알림은 카드 안 `Notice variant=inline` 하나다. 문구는 하나("미리보기를 열 수 없어요.")이고 동작은 [다시 시도]와 [치지직에서 보기]다. 원인 구분은 v1에 없다. Rust 로그는 원인을 `redact_url`로 남긴다 | scheme 실패는 HTTP 상태로만 끝나 프런트는 `<video>` `error`만 받는다 [가정]. 알림 계층 규칙 1(같은 사건은 한 수단, `patterns.md:30-46`) [확인: 지도] |
| PV16 | Linux 코덱이나 MSE가 없을 때 대체 경로로 보낸다. 판정은 기능 감지(`video.canPlayType`, `MediaSource.isTypeSupported`, `Hls.isSupported()`)와 `error` 이벤트로 한다. `navigator.userAgent`는 쓰지 않는다 | DX5(`governance.md:281`) [확인: 지도] |
| PV17 | 구간 찍기는 빠른 다시보기 카드에만 둔다. 재생기 아래 [시작 찍기]·[끝 찍기]가 `rangeOpen = true`로 만들고 `rangeStart`·`rangeEnd`에 `formatClock(floor(currentTime))`을 넣는다. 새 DTO는 없다. 받을 때 조각 경계로 넓어진다는 안내는 기존 `range.help`를 그대로 쓴다. **찍기 버튼은 hls.js 경로에서만 보인다.** 네이티브 m3u8 대체 경로에서는 그리지 않는다(첫 조각 tfdt가 0이 아니면 시간축이 다를 수 있다). **M-PV-5 통과가 PV-7 머지 조건이다**(검토 반영 P11) | 구간 입력은 이미 `ResolveCard` 상태와 `effectiveRange` 하나로 흐른다(`ResolveCard.svelte:108-110`, `receive.ts:164-180`) [확인]. `range.help` "앞뒤로 몇 초 더 받을 수 있어요."(`ko.ts:76`) [확인]. 일반 VOD·클립은 구간을 받지 않는다(R3, `range.md:340-343`). range.md는 "playlist 첫 조각 = 플레이어 0:00:00"을 장면 대조 실측으로만 통과시켰고(`range.md:110`, `:534`, `:555`), `select_range`는 받을 화질 variant의 EXTINF로 고른다(`range.md:100`) [확인] |
| PV18 | 생방송(`PlaybackKind::Live`)은 `watch_open`이 `invalidInput`으로 거부하고, 카드에는 미리보기 줄을 그리지 않는다. DASH 전용 경로는 없다. MPD는 resolve 안에서 PD 목록으로 바뀐다 | `PlaybackKind`는 셋뿐이다(`model.rs:92`). `Source`도 셋이다(`model.rs:131-142`) [확인]. MPD → PD(`client.rs:234-262`) [확인: 지도] |
| PV19 | [치지직에서 보기]는 새 command `open_content_page`다. Rust가 세션이 아니라 **카드의 `ContentRef`에서** 정식 주소를 만들어 브라우저로 연다. 웹뷰가 준 URL 문자열을 열지 않는다. `clip_id`는 웹뷰가 보낸 문자열이므로, 만든 주소를 `parse_content_url`로 다시 읽어 같은 `ContentRef`가 나올 때만 연다. `Live`는 `invalidInput`이다(검토 반영 S8) | 지금 외부 주소를 여는 command는 Worker 고정 페이지용 `open_web_page`뿐이다(`commands.rs:293-305`) [확인]. `ContentRef::Clip { clip_id: String }`은 검증 없이 역직렬화된다(`model.rs:19-29`) [확인]. 같은 왕복 검사가 `enqueue_checked`에 있다(`services.rs:662-664`) [확인] |

## 1. 목표와 범위

### 1.1 목표
- 받기 전에 그 영상이 맞는지, 어느 구간을 받을지 앱 안에서 본다.
- 서명 주소(`hdnts` 쿼리, `hdntl` 경로 토큰)는 Rust 밖으로 나가지 않는다. 프런트는 불투명 세션 ID와 `watch:` 주소만 안다.
- 받기 게이트와 같은 판정을 거친 영상만 재생한다. 본인 영상, 맡은 채널, 관리자만 해당하고 fail closed다.

### 1.2 하지 않는 것
- 생방송 미리보기(PV18).
- 암호화 VOD. resolve가 이미 `Error::EncryptedVod`로 거부한다.
- 오디오만 행 재생(PV13).
- 화질 고르기, 자막, 채팅 겹쳐 보기, 썸네일 탐색 막대.
- 일반 VOD·클립 구간 받기(R3 그대로). 일반 VOD에도 재생기는 있지만 찍기 버튼은 없다.
- 미리보기 바이트를 디스크에 캐시하는 일. 받기와 섞지 않는다.

### 1.3 사용자 흐름
1. 주소를 붙여 [불러오기]를 누르면 카드가 열린다(지금과 같다).
2. 카드 메타 줄 아래에 접힌 "미리보기" 줄이 있다. 생방송 카드와 받을 수 없는 영상(`ownership`이 `notOwn`·`unknown`) 카드에는 없다.
3. 펼치면 `watch_open`이 불리고 스켈레톤이 보인다. 게이트에 거부되면 받기와 같은 오류 문구가 나온다(`notOwnContent` 등, `errors.ts`).
4. 성공하면 `<video controls>`가 뜬다. 사용자가 재생하고 탐색한다.
5. 빠른 다시보기에서는 [시작 찍기]·[끝 찍기]가 "일부만 받기"를 펼치고 시각 칸을 채운다. 사용자는 칸을 손으로 고칠 수 있다.
6. [받기]는 지금과 같다. 미리보기는 받기를 막거나 바꾸지 않는다.
7. 접거나, 카드를 닫거나, 다른 주소를 불러오면 `watch_close`가 불린다.
8. 재생이 실패하면 inline Notice와 [다시 시도], [치지직에서 보기]가 나온다.
9. 펼친 채 10분 넘게 요청이 없으면 세션이 버려진다. 그 뒤 재생·탐색하면 `404`가 나 8과 같은 Notice가 뜬다. [다시 시도]는 세션을 새로 열고 처음부터 재생한다(재생 위치는 잃는다, v1 한계. §12 후속).

## 2. 실측 근거

없다. 이 설계는 코드와 Tauri 문서만 근거로 한다. 실물에서 정할 것은 §13에 모았다.

## 3. 기존 결정과의 관계

| 기존 | 이 기능에서 | 근거 |
|---|---|---|
| 서명 URL은 IPC로 나가지 않는다 | 그대로다. `Source`와 `Resolved`는 `Serialize`가 아니다. DTO는 세션 ID와 `watch:` 주소만 싣는다 | `model.rs:131-186`, `dto.rs:521` 주석 [확인: 지도] |
| 쿠키는 API·MPD 요청에만 | 미리보기는 `cookies_on_media`도 무시한다(PV12) | `http.rs:140-176` [확인] |
| 소유 게이트는 enqueue·resume에서 막는다 | 세 번째 지점으로 `watch_open`과 scheme 요청을 더한다(PV6) | `services.rs:651-674`, `app.rs:409-415` [확인: 지도] |
| resolve는 막지 않는다 | 그대로다. 카드는 남의 영상도 보여 준다. 미리보기 줄은 `ownership`이 `notOwn`·`unknown`이면 그리지 않는다(`own`·`delegated`·`adminOverride`·`unchecked`는 그린다). Rust가 다시 막는다 | `services.rs:548-557` [확인], `Ownership`(`dto.rs:681`, `unchecked`는 로그인을 쓰지 않는 빌드) [확인] |
| 구간은 빠른 다시보기만(R3) | 찍기 버튼도 빠른 다시보기만이다(PV17) | `ResolveCard.svelte:108-109` [확인] |
| `select_range`는 시작을 내리고 끝을 올린다 | 찍은 시각보다 넓게 받을 수 있다. `range.help`로 이미 알린다 | `hls.rs:411-419` [확인: 지도], `ko.ts:76` [확인] |
| CSP는 테스트로 고정 | PV-3·PV-6에서 테스트를 먼저 고친다 | `tauri-conf.test.ts:73-84` [확인] |
| 프런트 런타임 의존성은 `@tauri-apps/api` 하나 | hls.js가 두 번째다. 공급망·고지·크기 영향은 PV9 | `app/package.json` [확인: 지도] |

## 4. 코어 변경(`crates/core`)

### 4.1 새 모듈 `watch.rs`(PV-1, PV-5)
- `Chzzk::watch_range(url: &Url, start: u64, end_incl: u64, expect_total: Option<u64>) -> Result<RangeChunk, WatchFail>`
  - `media_get`과 같은 UA·Referer를 붙인다. **쿠키 없음**(PV12)이다. 내부에서 `http::headers(RequestKind::Media, None, false)`를 쓴다. 새 `RequestKind`는 만들지 않는다.
  - 업스트림 Range는 `bytes=start-end_incl`이다.
  - `206`: `watch.rs`의 새 파서 `parse_content_range_full(&str) -> Option<(u64, u64, u64)>`로 `start-end/total`을 모두 읽는다. `*` 형식(`bytes */N`, `bytes a-b/*`), `end < start`, `end >= total`은 `None`이다. 받기 쪽 `parse_content_range`(`progressive.rs:262`)는 그대로 둔다.
    - 파싱 실패, 시작 ≠ 요청 시작, 끝 > 요청 끝은 `WatchFail::SourceChanged`다. 끝 < 요청 끝(업스트림이 짧게 줌)은 정상이고, 결과는 업스트림 끝값을 쓴다.
    - `Content-Length`가 있으면 `end - start + 1`과 같아야 한다(다르면 `SourceChanged`).
    - 본문은 `end - start + 1`을 넘지 않게 읽는다(넘으면 `SourceChanged`). 그보다 짧게 끝나면(조기 EOF) `WatchFail::Retry`로 본다. 전송 문제이므로 세션은 버리지 않는다.
    - 호출자가 준 `expect_total: Option<u64>`와 total이 다르면 `SourceChanged`다.
  - `200`: `WatchFail::RangeIgnored`(PV4)다. 본문은 읽지 않고 버린다.
  - `416`: `WatchFail::Unsatisfiable { total }`이다(`Content-Range: bytes */total`).
  - `403`: `WatchFail::Expired`다.
  - 그 밖은 `retry::classify_failure`(`retry.rs:149`)로 `Retry` 또는 `Fatal`이다. 재시도는 1회, 짧게 **[잠정]**. 웹뷰가 다시 요청하므로 길게 버티지 않는다.
  - `RangeChunk { start, end_incl, total: u64, content_type: Option<String>, body: Vec<u8> }`다. `start`·`end_incl`·`total`은 업스트림이 실제로 준 값이고 `body.len() == end_incl - start + 1`이 늘 성립한다. `Debug`는 손으로 구현하고 본문 길이만 찍는다.
  - `open`의 total 탐색은 같은 함수를 `bytes=0-0`, `expect_total: None`으로 부른다.
- `Chzzk::watch_bytes(url, cap: usize) -> Result<Vec<u8>, WatchFail>`: playlist·init·세그먼트용 GET이다(쿠키 없음, 상한 초과는 `TooLarge`). 텍스트(master·media)는 1 MiB, 세그먼트는 32 MiB **[잠정]**가 상한이다.
- `pick_variant`는 옮기지 않는다. `segmented.rs:408`의 `pub(super)`를 `pub`으로 넓히고 `download` 모듈에서 `pub use`로 내보낸다. `live.rs:36`이 `super::segmented::pick_variant`를 import하고(`:571`에서 씀), range.md가 공유 도우미 시그니처를 바꾸지 말라고 했기 때문이다(`range.md:141`) [확인]. 시그니처와 받기 동작은 그대로다.
- HLS(PV-5): `hls::render_watch_playlist(&MediaPlaylist) -> String`은 순수 함수다.
  - `#EXTM3U`, `#EXT-X-VERSION:7`, `#EXT-X-TARGETDURATION:<ceil(max)>`, `#EXT-X-MEDIA-SEQUENCE:0`, `#EXT-X-PLAYLIST-TYPE:VOD`, `#EXT-X-INDEPENDENT-SEGMENTS`를 쓴다.
  - init이 있으면 `#EXT-X-MAP:URI="init"`을 쓴다.
  - 세그먼트마다 `#EXTINF:<초, 소수 셋째 자리>,`와 `s/<i>`를 쓰고 끝에 `#EXT-X-ENDLIST`를 쓴다.
  - 입력의 URI 문자열은 출력에 넣지 않는다. 테스트로 고정한다.
- `WatchFail`은 `Debug`에 URL을 담지 않는다. 오류를 로그에 낼 때는 `redact_url`만 거친다.
- **`WatchFail`은 `reqwest::Error`를 직접 담지 않는다.** 전송 실패·본문 도중 끊김·상한 초과 중단·`RangeIgnored` 본문 버리기 등 새 경로의 reqwest 오류는 모두 `Error::network`(`error.rs:141-144`, `without_url()`)를 거친 `chzzk_core::Error`로만 담는다. `retry::classify_failure`가 지키는 길(`retry.rs:163-166`)과 같다 [확인]. `{e}`로 reqwest 오류를 로그에 쓰지 않는다(검토 반영 S7).

### 4.2 바꾸지 않는 것
- `Source`, `Resolved`, `PdRep`, `PlaybackKind`의 형식.
- 받기 엔진(`progressive.rs`의 `run`·`attempt`·`parse_content_range`, `segmented.rs`의 `fetch_once`, `pick_variant` 시그니처). 미리보기는 파일을 쓰지 않는다.

## 5. 셸 변경(`crates/shell`)

### 5.1 Backend seam
`Backend`(`backend.rs:19-38`) [확인]에 두 메서드를 더한다. `watch_range`와 `watch_bytes`이고, `Chzzk` 구현은 코어로 넘긴다. `FakeBackend`(`tests/common/fake.rs`)에는 대본 큐 `push_range`·`push_bytes`를 더한다. 셸 테스트는 네트워크 없이 상태 기계를 본다.

### 5.2 `watch.rs`: `WatchService<B>`
- 상태: `current: std::sync::Mutex<Option<Arc<Session>>>`(PV5, 1개). 잠금은 `Arc`를 꺼내는 동안만 잡고 await 너머로 들고 가지 않는다(검토 반영 S2). `Session`의 필드는 아래와 같다.
  - `id: [u8;16]`
  - `content: ContentRef`
  - `me: Option<String>`(연 순간의 로그인 채널. 로그인을 쓰지 않는 빌드는 `None`, PV6)
  - `quality_id`
  - `kind: WatchKind { Mp4, Hls }`
  - `state: std::sync::Mutex<SourceState>`. `SourceState`는 `gen: u64`, `src: Secret<…>`(PD 서명 주소와 total, 또는 HLS의 init·세그먼트 서명 주소 목록과 `durations_crc`), `refreshes: u8`, `last_used: tokio::time::Instant`다.
  - `refresh: tokio::sync::Mutex<()>`(재조회를 한 번에 하나로)
- 요청 처리: `current`에서 `Arc<Session>`을 복제하고 잠금을 푼다 → `state`에서 `(gen, 주소)`를 복사한다 → 업스트림 요청. 403이면 `refresh`를 잡고 `state.gen`을 다시 본다. 커졌으면 resolve 없이 새 주소로 1회 재시도한다. 같으면 resolve·`admit_checked`를 하고, 결과를 쓰기 직전에 `current`가 여전히 같은 `Arc`(`Arc::ptr_eq`)이고 `gen`이 같은지 본다. 아니면 결과를 버리고 `404`다. 쓰면 `gen += 1`, `refreshes += 1`이다.
- 유휴 시계는 `tokio::time::Instant`다. 셸 테스트는 `#[tokio::test(start_paused = true)]`와 `tokio::time::advance`로 본다(셸 dev 의존성에 `test-util`이 이미 있다, `crates/shell/Cargo.toml:42`, 선례 `tests/app_f.rs:38`) [확인]. 따로 시계 trait는 두지 않는다(검토 반영 P13).
- `Debug`는 손으로 구현한다. ID 앞 4자와 kind만 찍는다.
- `open(url, content, gate, settings, recheck) -> Result<WatchOpenDto, AppError>`
  1. url과 content가 같은 영상인지 본다. 다르면 `invalidInput`이다(`services.rs:662-664`와 같다).
  2. `gate.admit_checked(content, fetch, recheck)`로 판정한다. `fetch`는 `settings.content_channel`, `recheck`는 `App`이 넘기는 `App::recheck` 클로저다(`app.rs:401-408`, 받기와 같다). 재조회 뒤 재판정에 쓸 수 있게 `WatchService`는 `App`이 준 `recheck` 생성 함수(`Arc<dyn Fn() -> BoxFuture<()>>`)를 생성 때 받는다.
  3. `resolve`를 부른다. `Live`면 `invalidInput`(PV18)이다. 가장 낮은 비디오 화질을 고른다(PV13). 없으면 `invalidInput`이다.
  4. PD면 `watch_range(url, 0, 0, None)`으로 total을 정한다(PV3). `RangeIgnored`·`Unsatisfiable`이면 `unsupported`, 403·네트워크는 받기와 같은 변환이다. HLS면 master와 media를 받아 `parse_media`를 거친다. 실패하면 받기와 같은 오류 변환(`error.rs:313-329`)을 쓴다. **PV-5 전에는 HLS 열기를 `invalidInput`으로 거부한다**(검토 반영 P5).
  5. 이전 세션을 버리고 새 ID를 만든다.
  6. `WatchOpenDto { id, kind, src }`를 돌려준다. `src`는 앱 크레이트가 준 base로 `"{base}/{id}/v"`(mp4) 또는 `"{base}/{id}/pl.m3u8"`(HLS)이다.
- `close(id)`: 같은 ID면 버린다. 없거나 다른 ID여도 `Ok`(멱등)다.
- `on_signed_out()`: 모두 버린다. `App`의 인증 상태 변화 훅(`app.rs`의 SignedIn 처리 옆)에서 부른다.
- `handle(req: &http::Request<Vec<u8>>, ctx: ReqCtx) -> http::Response<Vec<u8>>`는 순수에 가까운 결정 함수다(§5.3). Tauri에 의존하지 않아 셸 테스트가 직접 부른다.

### 5.3 scheme 요청 표(`handle`)
경로는 `/<id32hex>/v`, `/<id32hex>/pl.m3u8`, `/<id32hex>/init`, `/<id32hex>/s/<i>`만 받는다. `<i>`는 10진수이고 앞 0과 부호, 10자 넘는 값은 거부한다. 그 밖은 모두 `404`다. 쿼리는 무시하고 버린다. **주소에서 업스트림 URL을 만드는 길은 없다.** 세션에 있는 주소만 쓴다.

| 조건(위에서부터) | 응답 |
|---|---|
| 메서드가 GET·HEAD가 아님, HEAD인데 `/v`가 아님 | `405` |
| 창 라벨이 `main`이 아님 | `403` |
| 로그인을 쓰지 않는 빌드(`auth` 없음) | 로그인·채널 검사(아래 두 행)를 건너뛴다(PV6) |
| 로그인 아님(`require_signed_in` 실패) | `403`, 세션 버림 |
| `Origin`이 있고 앱 출처가 아님 | `403`(ACAO 없음) |
| 경로 모양이 틀림, 세션 없음, ID 불일치, 유휴 초과 | `404` |
| 세션의 `me` ≠ 현재 로그인 채널(`auth`가 있을 때만) | `403`, 세션 버림 |
| kind와 경로 종류 불일치(mp4 세션에 `/s/0` 등), 번호가 범위 밖 | `404` |
| `/v` HEAD | 업스트림 호출 없이 `200` + `Content-Length: total`(세션 값) + `Accept-Ranges: bytes` + `Content-Type: video/mp4`, 본문 없음. Tauri asset의 HEAD와 같다(`asset.rs:219-222`) [확인] |
| `/v` suffix(`bytes=-N`) | `bytes=max(0,total-N)-total-1`로 바꿔 아래 정상 행으로. `N = 0`은 `416` |
| `/v` 여러 구간(`bytes=a-b,c-d`) | 첫 구간만 보고 아래 정상 행으로(206 한 구간). 재생기는 여러 구간을 보내지 않는다 [가정] |
| `/v` 문법 오류, 끝 < 시작(`bytes=5-3`) | `416` + `Content-Range: bytes */total` |
| `/v` 시작 ≥ total | `416` + `Content-Range: bytes */total` |
| `/v` 정상 | 업스트림에 `bytes=시작-min(요청 끝, 시작+CHUNK-1, total-1)`. `206`, `Content-Range`·`Content-Length`는 **업스트림이 실제로 준 값**(PV3, §4.1), `Content-Type: video/mp4`, `Accept-Ranges: bytes`, `Cache-Control: no-store` |
| `/v` Range 없음 | `bytes=0-`로 보고 `206` **[실측 필요 M-PV-1]**. Tauri asset은 이때 `200` + 전체 본문을 주지만(`asset.rs:223-234`) 우리는 전체를 담을 수 없다(PV3) |
| `/v` 업스트림 total ≠ 세션 total, Content-Range·Content-Length 불일치 | `409`, 세션 버림(`SourceChanged`) |
| `/v` 업스트림 본문 조기 EOF | `502`, 세션 유지(웹뷰가 다시 요청한다) |
| `/pl.m3u8` | `200`, `application/vnd.apple.mpegurl`, PV8 텍스트 |
| `/init`·`/s/<i>` | `200`, `video/mp4`, 본문 전체 |
| 업스트림 403 → 재조회 성공 → 재시도 성공 | 위와 같음. 재조회 뒤 `admit_checked`를 다시 거친다 |
| 재조회 뒤 total이나 `durations_crc`가 다름, 방식 바뀜 | `409`, 세션 버림 |
| 403인데 그 사이 다른 요청이 재조회를 마침(현재 `gen`이 더 큼) | resolve 없이 새 주소로 1회 재시도(PV7) |
| 재조회 중 close·새 open·로그아웃(세션 `Arc`나 `gen`이 바뀜) | 재조회 결과를 버리고 `404` |
| 재조회 횟수 초과, 재조회 직후 또 403 | `403` |
| 업스트림 `RangeIgnored`·`TooLarge`·`Fatal`·네트워크 | `502` |
| 모든 응답 | ACAO = 앱 출처(PV11), `Vary: Origin`, `Cache-Control: no-store` |

로그는 `tracing::debug!`에 세션 ID 앞 4자, 경로 종류, 상태, 바이트 수만 남긴다. 업스트림 URL은 `redact_url`만 거친다.

### 5.4 DTO·command·bindings
- `WatchOpenDto { id: string, kind: 'mp4' | 'hls', src: string }`. `WatchKindDto`는 camelCase이고 `bindings.rs:14-19`·`:45-70`에 더한다 [확인: 지도].
- command는 셋이다. `watch_open(url, content)`, `watch_close(id)`, `open_content_page(content)`(PV19: `Live`는 `invalidInput`, `parse_content_url` 왕복이 다르면 `invalidInput`). 모두 `OPEN_COMMANDS`에 넣지 않는다(로그인 필수, `gate.rs:19-33`) [확인].
- 새 `ErrorCode`는 만들지 않는다. 열기 실패는 기존 코드(`notLoggedIn`·`notOwnContent`·`ownershipUnknown`·`invalidInput`·`unsupported`·`network`·`sourceChanged` 등, `crates/shell/src/error.rs:37`)를 쓴다 [확인].

## 6. 앱 변경

### 6.1 Tauri(`app/src-tauri`, PV-3)
- `lib.rs` Builder에 `.register_asynchronous_uri_scheme_protocol("watch", watch_protocol)`을 둔다. 위치는 `.manage(ShowGate)` 옆이다(`lib.rs:699-751`) [확인: 지도].
- `watch_protocol`은 `ctx.app_handle().try_state::<App>()`를 본다. 없으면 `503`(fail closed)이다. 있으면 `tauri::async_runtime::spawn`으로 `App.watch.handle(...)`을 돌리고 `responder.respond`를 부른다. `webview_label()`은 `ReqCtx`에 넣는다(`app.rs:2648`) [확인].
- `watch_base()`는 `cfg!(windows)`면 `http://watch.localhost`, 아니면 `watch://localhost`다. 앱 출처(ACAO 값)는 `tauri::is_dev()`면 `app.config().build.dev_url`의 출처, 아니면 `cfg!(windows)`로 `http://tauri.localhost` 또는 `tauri://localhost`다(PV11). 출처 계산은 `watch_protocol.rs`의 순수 함수 `app_origin(is_dev, dev_url, windows)` 하나로 두고 표 테스트한다.
- command 네 곳을 맞춘다. `command_names.rs`, `commands.rs`, `generate_handler!`, `capabilities/default.json`이다(`command_names.rs:2-3` 주석) [확인].
- CSP: `tauri.conf.json`과 `tauri-conf.test.ts`를 함께 고친다(PV10).
- 가짜 백엔드 `app/e2e/mock/backend.ts`에 세 command를 같은 PR에서 더한다(CLAUDE.md: command를 바꾸면 가짜 백엔드도 같이 고친다, 검토 반영 P2).

### 6.2 프런트(`app/src`)
- `api.ts`: `watchOpen(url, content)`, `watchClose(id)`, `openContentPage(content)`.
- 새 `receive/WatchPanel.svelte`(기능 컴포넌트라 `ui/` 갤러리 대상이 아니다).
  - prop: `view: ResolvedDto`, `tone`, `onmark?: (which, ms) => void`.
  - 상태는 `closed`·`opening`·`ready`·`failed` 넷이다.
  - `<video controls preload="metadata" playsinline>`이고 `src`는 DTO 값이다. HLS면 `hls.js/light`를 동적 import한다. `Hls.isSupported()`가 거짓이면 `canPlayType('application/vnd.apple.mpegurl')`일 때 네이티브로 재생하고, 둘 다 아니면 `failed`다(PV16).
  - 펼침은 `Disclosure variant="inline"` 하나다. 접힘·`onDestroy`에서 `watchClose`와 `hls.destroy()`를 부른다.
  - 재생기 크기는 카드 열 폭에 16:9이고 최대 높이는 토큰이다. 새 토큰은 D64로 등록한다.
- `ResolveCard.svelte`: 메타 줄(`:293-298`)과 `.fields`(`:300`) 사이에 `{#if watchable}<WatchPanel …/>{/if}`를 둔다. `watchable`은 `ownership`이 `notOwn`·`unknown`이 아니고, PV-4에서는 `view.playbackKind === 'progressive'`, PV-6부터 `liveRewindHls`도 포함한다(검토 반영 P5). `tone`으로 판정하지 않는다(`kindTone`은 클립이면 재생 방식과 무관하게 `clip`이다, `receive.ts:23-27`) [확인]. `onmark`가 `rangeOpen = true`로 만들고 `rangeStart`·`rangeEnd`를 채운다. 끝 칸이 시작보다 앞이면 그대로 두고, 기존 검증(`rangeError` order)이 [받기] 때 알린다.
- 단축키: 재생기 안 키는 `<video>` 기본 동작에 맡긴다. 카드의 Mod+Enter와 `,`는 바꾸지 않는다. **`GlobalShortcuts`의 Escape 분기는 대상이 `HTMLMediaElement`면 건너뛴다**(`editable()`과 같은 꼴). 지금은 `defaultPrevented`가 아니면 `ui.escape()`로 카드를 닫고(`GlobalShortcuts.svelte:16-18`) [확인], 웹뷰가 `<video>` 위 Esc에 `preventDefault`를 해 준다는 보장이 없다 [가정]. 그래서 PV-4에서 `GlobalShortcuts.svelte`를 고친다(검토 반영 P9).
- hls.js 오류 이벤트는 `details`·`fatal`만 쓴다. `frag.url`·`response.url`·`url` 필드(전체 세션 ID가 든 `watch:` 주소)는 화면·로그·IPC 어디에도 넘기지 않는다(검토 반영 S10).

### 6.3 문구·디자인 시스템
- copy deck(`ko.ts`) 새 키(초안, `content.md` 규칙 W1·W2·W5와 접미 규칙).
  - `watch.toggle` "미리보기"
  - `watch.markStart.label` "시작 찍기"
  - `watch.markEnd.label` "끝 찍기"
  - `watch.error.body` "미리보기를 열 수 없어요."
  - `watch.openInChzzk.label` "치지직에서 보기"
  - `watch.player.a11y` "‘{title}’ 미리보기"
  - [다시 시도]는 기존 키를 재사용한다.
- 용어집에 "미리보기" 행을 더한다. 쓰지 않는 말은 "프리뷰"이고 `terms.json` `patterns`에 짝 패턴을 더한다. "재생하기"는 넣지 않는다. 기존 패턴 `"재생"`(`terms.json:670`, `content.md:109` 행의 쓰지 않는 말)이 이미 그 문자열을 잡고, 패턴 키는 쓰지 않는 말과 짝이어야 한다(`copy.mjs:664-666`) [확인]. `design/copy/terms.json` 패리티도 맞춘다. "미리보기"는 지금 copy deck에 없다(grep 0건) [확인].
- **"재생" 금지는 문구 전체에 걸린다**(검토 반영 P3). 이전 판의 "[열기] 자리 한정"은 틀렸다. 초안의 "재생기"가 DC1에 걸려 바뀐 선례가 있다(`content.md:527`) [확인]. 그래서 copy deck, `help/*.md`(DC1 대상, `copy.mjs:26-27`), `patterns.md`·`web.md`(`copy.mjs` DOC_FILES)에 "재생"·"재생기"를 쓰지 않는다. 높이 예산 표 갱신(PV-4)도 "미리보기 줄"로 적는다. 이 설계 문서 자체는 검사 대상이 아니다.
- D64: 미리보기 패널을 정한다. 기본 접힘, 자동재생 없음, 네이티브 컨트롤, 실패는 inline Notice 하나, 높이 토큰 [잠정]. ADR-0027을 둔다. `components.md`에 WatchPanel 절과 forced-colors 행(`foundations.md:305`)을 더한다.
- 아이콘: 새 아이콘은 없다. `play`는 이어받기에 배정돼 있으므로 쓰지 않는다(`README.md:156` D32) [확인: 지도]. Disclosure 기본 표식만 쓴다.
- 접근성: `<video>`에 `aria-label`(`watch.player.a11y`)을 단다. 찍기 버튼은 일반 Button이다. 찍은 뒤 포커스는 버튼에 남기고, 바뀐 칸 값은 RangeField가 보여 준다. axe 위반 0을 PV-8 spec이 본다.

## 7. 보안

1. **서명 주소는 Rust 밖으로 나가지 않는다.** DTO, playlist 본문, 응답 헤더, 로그(redact 전) 어디에도 없다.
   - 테스트로 고정한다. 응답 본문과 헤더에 `hdnts`·`hdntl`·`exp=`·업스트림 호스트가 없어야 한다.
   - `Debug` 출력에 서명이 없어야 한다.
2. **scheme은 임의 URL 프록시가 아니다.** 주소에는 세션 ID와 번호만 있다. 업스트림 주소는 `open` 때 resolve한 값과 그 재조회 값만 쓴다. 번호는 세션 목록의 인덱스만 받는다.
3. **ID 추측**: 128비트 난수, 한 번에 1개, 유휴 만료, 로그아웃 때 폐기다. 다른 창은 거부한다. 다른 출처 거부는 **CORS 요청(Origin을 보내는 요청)에 한한다.** `crossorigin` 없는 `<video>`는 Origin을 보내지 않으므로[가정] 실제 방어선은 ID 비밀성과 창 라벨이다. 앱에는 내비게이션 가드(`on_navigation`)가 없어(`app/src-tauri/src` grep 0건) [확인] main 창이 외부 페이지로 가도 라벨은 `main`이다. 이 경우에도 ID를 모르면 닿지 못한다. 내비게이션 가드는 이 기능 범위 밖이다(검토 반영 S9).
4. **게이트 우회 없음**: 열기는 받기와 같은 판정이고, 요청마다 로그인과 채널을 확인한다. 재조회 뒤 다시 판정해 위임이 취소되면 막는다.
5. **쿠키 없음**(PV12).
6. **응답 크기 상한**: 조각 4 MiB, 세그먼트 32 MiB, 텍스트 1 MiB **[잠정]**. 메모리 고갈을 막는다.
7. **로그**: 세션 ID 앞 4자만 찍는다. 전체 ID는 주소를 만드는 열쇠라 찍지 않는다. 프런트도 hls.js 오류의 url 필드를 쓰지 않는다(§6.2).
8. **오류 체인**: reqwest 오류는 `Error::network`를 거친 것만 담는다(§4.1). 전송 실패·본문 도중 끊김에서도 `{:?}`·`{}`에 서명이 없어야 한다.

## 8. OS별 분기
- 주소와 출처의 분기는 Rust `watch_protocol.rs` 한 곳이다(`cfg!(windows)`, 앱 출처는 dev 여부도 본다, PV11). 프런트는 받은 `src`를 쓴다.
- macOS WKWebView는 `<video>`에 Range를 늘 보내고 206을 기대한다 [가정 → M-PV-1].
- Linux WebKitGTK는 GStreamer 코덱에 의존한다 [가정 → M-PV-3]. 기능 감지로 대체 경로를 보인다(PV16).
- Windows WebView2: `webview_win::harden`은 컨텍스트 메뉴를 건드리지 않는다 [확인: 지도]. 네이티브 컨트롤은 그대로 쓴다.

## 9. 비밀값
- 새 타입 `Session`, `SourceState`, `RangeChunk`, `WatchFail`은 `Debug`를 손으로 구현한다. 서명 주소는 `Secret`이나 `DebugUrl`로 감싼다. `WatchFail`은 `reqwest::Error`를 직접 담지 않는다(§4.1).
- `tracing` 필드에는 `redact_url`만 쓴다.
- playlist 텍스트는 우리가 만든 것만 응답한다(PV8).

## 10. 테스트 원칙
- 코어 HTTP 동작은 `crates/core/tests/watch.rs`(wiremock, 오프라인)로 본다. 셸 상태 기계는 `crates/shell/tests/watch.rs`(`FakeBackend`)로 본다. Tauri 배선은 `app/src-tauri/tests/ipc.rs`(mock 런타임)로 본다. 프런트는 vitest(jsdom, `HTMLMediaElement` 스텁)와 Playwright(mockIPC)로 본다.
- jsdom은 `play`·`load`를 구현하지 않는다. 테스트 setup에 스텁을 둔다. `currentTime`은 `Object.defineProperty`로 정한다.
- Playwright chromium은 H.264를 재생하지 못한다 [가정]. 그래서 E2E는 UI 상태(열기·실패·대체 경로·찍기)만 본다. 실제 재생은 §13 실측이 맡는다.
- 보강 테스트는 구현을 일부러 깨서 잡히는지 확인한다(메모리 규칙 TDD).

## 11. 구현 단계

### 11.1 PR 표(stacked)

| PR | 내용 | 커밋 타입 |
|---|---|---|
| PV-1 코어 PD 중계 | `watch.rs` `watch_range`·`watch_bytes`, 끝값까지 읽는 `parse_content_range_full`, 쿠키 없음 | `feat` |
| PV-2 셸 세션 | `WatchService<B>`(`Arc<Session>`·`gen`), Backend 두 메서드, `handle` 결정 함수(mp4 경로), open의 total 탐색, DTO·bindings, 게이트(auth 없음 포함), 403 재조회 | `feat` |
| PV-3 Tauri 배선 | scheme 등록, command 셋, capabilities, CSP `media-src`, ACAO(dev 출처 포함), 로그아웃 훅, 가짜 백엔드 command 셋 | `feat` |
| PV-4 프런트 PD 재생기 | `api.ts`, `WatchPanel`(mp4), ResolveCard 배치(PD만), GlobalShortcuts Esc, copy deck·용어집, 실패 Notice·치지직에서 보기, 가짜 백엔드 시나리오·`watch.spec.ts`(PD), 갤러리 장면·기준선, `patterns.md` 높이 예산 | `feat` |
| PV-5 코어·셸 HLS | `pick_variant` 공개 범위, `render_watch_playlist`, `/pl.m3u8`·`/init`·`/s/<i>`, `durations_crc` 재조회 | `feat` |
| PV-6L hls.js 고지 | `licenses/hlsjs.txt`, AboutSection 고지 행, `worker-gen.mjs` 라이선스 원천 여럿, `design-worker` 기준선. 운영 반영은 Worker 배포(별도 승인) | `feat` |
| PV-6 hls.js | 의존성(light, 정확한 버전), 동적 import, CSP `blob:`·`connect-src`, 빠른 다시보기 카드에 줄 열기, `size.dist_gz` 손 갱신 | `feat` |
| PV-7 구간 찍기 | [시작 찍기]·[끝 찍기] → RangeField 연결(빠른 다시보기·hls.js 경로만). M-PV-5 통과가 머지 조건 | `feat` |
| PV-8 문서 마감 | D64·ADR-0027 확정, `features/README.md`, `plan.md`, ROADMAP, `tests.playwright` 기준(CI 녹색 실행 뒤 사람이 올린다, §16.4) | `chore` |

각 PR은 앞 PR 위에 쌓는다. PV-5는 PV-2 위에 있으므로 PV-3·PV-4와 병렬로 갈 수 있다. PV-6L은 PV-6 앞이면 어디든 된다. 가짜 백엔드·spec·갤러리는 command·화면을 처음 바꾸는 PR에서 함께 고친다(CLAUDE.md, 검토 반영 P2).

### 11.2 PR별 TDD 순서(먼저 쓸 실패 테스트)

#### PV-1 코어 PD 중계 (`crates/core/tests/watch.rs`, 단위는 `watch.rs` `#[cfg(test)]`)
1. `range_206_passes_bytes_and_total`: wiremock이 `bytes=0-9`에 206 `bytes 0-9/100`을 준다. 결과는 start 0, end 9, total 100, 본문 10바이트다.
1a. `parse_content_range_full_forms`(단위): `bytes 0-9/100` → `(0,9,100)`. `bytes */100`·`bytes 0-9/*`·`bytes 5-3/100`·`bytes 0-100/100`·`bytes x-9/10` → `None`.
1b. `upstream_short_206_uses_upstream_end`: `bytes=0-9`에 206 `bytes 0-4/5`면 결과 끝은 4, 본문 5바이트다.
1c. `body_shorter_than_content_range_is_retry`: Content-Range는 `0-9`인데 본문 5바이트에서 끊긴다(raw TCP). `Retry`이고 `SourceChanged`가 아니다.
1d. `content_length_mismatch_is_source_changed`.
1e. `total_differs_from_expected_is_source_changed`: `expect_total: Some(100)`인데 `bytes 0-9/200`.
1f. `end_beyond_request_is_source_changed`: `bytes=0-9`에 `bytes 0-19/100`.
2. `sends_closed_range_header`: 업스트림이 받은 Range가 정확히 `bytes=N-M`인지 본다.
3. `no_cookie_even_when_cookies_on_media`: `cookies_on_media = true`에 쿠키를 설정해도 요청에 `Cookie`가 없다. Referer와 UA는 있다.
4. `upstream_200_is_range_ignored`: 200에 큰 본문을 주면 `RangeIgnored`이고 본문을 끝까지 읽지 않는다. wiremock으로는 관찰할 수 없으므로 저장소의 raw TCP 서버 방식(`crates/core/tests/`)으로 서버가 보낸 바이트 수와 연결 종료를 본다(검토 반영 P10).
5. `upstream_416_reports_total`: `416` + `bytes */100`이면 `Unsatisfiable{total:100}`이다.
6. `upstream_403_is_expired`.
7. `start_mismatch_is_source_changed`: 206인데 Content-Range 시작이 다르다.
8. `body_longer_than_range_is_source_changed`.
9. `5xx_retries_once_then_fatal`, `404_is_fatal`.
10. `watch_bytes_caps_size`: 상한 + 1바이트면 `TooLarge`다.
11. `debug_has_no_signed_query`: `RangeChunk`·`WatchFail`의 `{:?}`에 `hdnts`·쿼리가 없다.
11a. `transport_errors_have_no_signed_query`: 연결 거부와 본문 도중 끊김(raw TCP)에서 `WatchFail`의 `{:?}`·`{}`에 `hdnts`가 없다(검토 반영 S7).
12. 엣지: `bytes=99-99`(마지막 1바이트), total을 모르는 `bytes 0-9/*`는 `SourceChanged`로 거부한다(중계는 total이 있어야 함). `bytes=0-0` 탐색이 `bytes 0-0/100`을 total 100으로 읽는다.

완료 조건:
- `run.mjs rust`가 녹색이다.
- `tests.rust`가 늘어난다.
- 받기 테스트(`progressive.rs`)는 바뀌지 않는다.

바뀌는 파일: `crates/core/src/{watch.rs,lib.rs,client.rs}`, `crates/core/tests/watch.rs`. `progressive.rs`는 건드리지 않는다.

문서: core.md 구현 중 변경 **86**.

#### PV-2 셸 세션 (`crates/shell/tests/watch.rs`)
1. `open_requires_url_content_match`: 다른 영상이면 `invalidInput`이고 resolve를 부르지 않는다.
2. `open_denied_by_gate_not_own` / `open_unknown_ownership_fails_closed` / `open_not_logged_in`: `admit_checked`와 같은 오류이고 세션이 없다.
2a. `open_verdict_table`: 판정 다섯(`own`·`delegated`·`adminOverride`·`unchecked`(auth 없음)·`notOwn`/`unknown`)을 표 테스트로 고정한다. 앞 넷은 열리고 마지막은 거부다(검토 반영 P1).
2b. `open_passes_recheck`: 판정이 확인 대상이면 넘긴 `recheck`가 1회 불리고, 그 뒤 위임이 생기면 열린다(받기와 같은 결과, 검토 반영 S6).
2c. `auth_disabled_open_and_handle_skip_login_checks`: auth 없음이면 `me = None`이고 `handle`이 로그인·채널 검사 없이 206을 준다(검토 반영 S3).
3. `open_rejects_live`: `Live`면 `invalidInput`이다. `open_rejects_hls_until_pv5`: `LiveRewindHls`면 `invalidInput`이다(PV-5에서 이 테스트를 열기 성공으로 바꾼다, 검토 반영 P5).
3a. `open_probes_total_once`: 열기가 업스트림에 `bytes=0-0`을 정확히 1회 보내고 total을 세션에 둔다. 탐색이 `RangeIgnored`면 `unsupported`, 403이면 받기와 같은 변환이고 세션이 없다(검토 반영 P12).
4. `open_picks_lowest_video_not_audio`: 화질 목록에 오디오 행이 있어도 가장 낮은 비디오를 고른다.
5. `open_returns_opaque_src`: `src`가 `{base}/{32hex}/v`이고 DTO 직렬화에 서명 주소가 없다.
6. `second_open_replaces_first` (동시 상한 1): 첫 ID로 요청하면 `404`다.
7. `close_is_idempotent`, `close_other_id_keeps_session`.
8. `handle_unknown_session_404`, `handle_bad_path_404`(`/v/x`·`/../v`·`/ID/s/01`·대문자 hex·33자).
9. `handle_wrong_webview_403`, `handle_foreign_origin_403_without_acao`, `handle_logged_out_403_and_drops`, `handle_channel_switched_403`.
10. `handle_non_get_405`.
11. `range_open_ended_clamped_to_chunk`: `bytes=0-`면 끝이 CHUNK-1이다.
12. `range_end_clamped_to_total`: `bytes=90-200`(total 100)이면 `90-99`다.
13. `range_start_at_total_416`: `bytes=100-`면 `416` + `bytes */100`이다.
14. `range_suffix_maps_to_tail`: `bytes=-10`(total 100)이면 업스트림에 `bytes=90-99`. `range_multi_uses_first`: `bytes=0-1,5-6`이면 `0-1` 한 구간 206. `range_end_before_start_416`: `bytes=5-3`(검토 반영 S5).
15. `range_missing_treated_as_zero`.
15a. `head_v_answers_from_session_total`: HEAD `/v`는 업스트림 호출 0회, `Content-Length: 100`, `Accept-Ranges`, 본문 없음. HEAD `/pl.m3u8` 등은 `405`.
15b. `upstream_short_206_relayed_as_is`: 업스트림이 `bytes 0-4/100`을 주면 응답 `Content-Range: bytes 0-4/100`, `Content-Length: 5`.
15c. `total_changed_without_refresh_409_and_drops`: 재조회 없이 조각의 total이 달라진다.
15d. `upstream_early_eof_502_keeps_session`.
16. `expired_refresh_then_retry_ok`: 403 → resolve 대본 → 같은 quality_id 새 주소 → 206이다. 재조회 뒤 `admit_checked`를 다시 부르는지도 본다.
17. `expired_twice_403`: 재조회 직후 또 403이다.
18. `refresh_total_changed_409_and_drops`.
19. `refresh_limit_8`: 9번째에서 `403`이다.
20. `concurrent_expired_single_refresh`: 두 요청이 동시에 403이어도 resolve는 1회다.
20a. `stale_403_after_refresh_no_resolve`: 요청 B가 옛 `gen`으로 나갔다가 A의 재조회가 끝난 뒤 403을 받는다. resolve 0회, 새 주소로 1회 재시도, `refreshes`는 1이다(검토 반영 S2).
20b. `refresh_result_dropped_on_close` / `…_on_new_open` / `…_on_sign_out`: 재조회 중(resolve 대본을 멈춰 둔다) close·새 open·로그아웃이면 결과를 쓰지 않고 그 요청은 `404`, 새 세션의 주소는 그대로다.
21. `refresh_gate_revoked_403`: 재조회 때 판정이 `NotOwn`이면 `403`이다. 재판정에도 `recheck`가 넘어가는지 본다.
22. `idle_expired_404`: `#[tokio::test(start_paused = true)]`에서 `advance(10분 + 1초)` 뒤 `404`, 10분 직전은 206이다.
23. `responses_have_acao_vary_nostore`.
24. `debug_and_logs_have_no_secret`: `Session`의 `{:?}`와 tracing 캡처를 본다.

완료 조건:
- `run.mjs rust`와 bindings 테스트가 녹색이다(`UPDATE_BINDINGS=1`로 재생성).

바뀌는 파일: `crates/shell/src/{watch.rs,lib.rs,backend.rs,dto.rs,bindings.rs,app.rs}`, `tests/common/fake.rs`, `tests/watch.rs`, `app/src/lib/bindings/*`. 코어 `download/segmented.rs`(`pick_variant` 공개 범위)는 PV-5에서 바꾼다.

문서: app.md **108**.

#### PV-3 Tauri 배선 (`app/src-tauri/tests/ipc.rs`, `app/src/tauri-conf.test.ts`)
1. `tauri-conf.test.ts`의 CSP 기대값에 `media-src`를 먼저 더한다. 처음에는 실패한다.
2. `capabilities_allow_exactly_the_app_commands`, `every_command_is_wired`가 새 command 셋으로 실패한다. 그다음 네 곳을 고친다.
3. `gated_commands_reject_before_sign_in`에 `watch_open`·`watch_close`·`open_content_page`가 포함된다.
4. `watch_open_over_ipc_returns_src_without_secret`: wiremock VOD 서버(`vod_server_with` `:399`)를 쓴다.
5. `watch_protocol_without_app_state_503`: 처리기 래퍼를 단위로 본다.
6. `watch_base_per_os`: `cfg` 분기 상수를 본다. `app_origin_table`: (dev, `http://localhost:1420`) → `http://localhost:1420`, (릴리스, windows) → `http://tauri.localhost`, (릴리스, 그 밖) → `tauri://localhost`(검토 반영 S4).
7. `sign_out_drops_watch_session`.
8. `open_content_page_builds_from_content_ref`: 열기 seam(`auth_io.rs`의 open_url 가짜)으로 받은 주소가 정식 형식이고 웹뷰 문자열을 쓰지 않는지 본다. `open_content_page_rejects_crafted_clip_id`: `clip_id`가 `../x`·`a?b`·`a#b`·빈 문자열이면 `invalidInput`이고 열기 seam이 불리지 않는다. `Live`도 `invalidInput`이다(검토 반영 S8).
9. 가짜 백엔드: `e2e/mock/backend.ts`에 세 command를 더한다(시나리오 필드 `watch: 'ok' | 'denied' | 'error'`, `src`는 존재하지 않는 경로). 기존 spec이 녹색인지 본다.

완료 조건:
- `tauri`, `tauri-clippy`, `frontend`(conf 테스트) gate가 녹색이다.
- `size.binary.*`는 3% 안이어야 한다. 넘으면 버전 PR 관행대로 처리한다.

바뀌는 파일: `app/src-tauri/src/{lib.rs,commands.rs,command_names.rs,watch_protocol.rs}`, `capabilities/default.json`, `tauri.conf.json`, `tests/ipc.rs`, `app/src/tauri-conf.test.ts`, `app/e2e/mock/backend.ts`.

문서: app.md **109**(CSP 변경은 `app.md`의 CSP 절과 `system/README.md` CSP 언급도 고친다).

#### PV-4 프런트 PD 재생기 (`receive.test.ts`, `WatchPanel.test.ts`)
1. `receive.test.ts`의 `vi.mock('../../api')` 목록에 `watchOpen`·`watchClose`·`openContentPage`를 더한다.
2. `watch panel is collapsed by default and does not call watchOpen`.
3. `expanding calls watchOpen with card url and content, sets video src`.
4. `no watch row on live card`, `no watch row on rewind card yet`(PV-4는 `progressive`만, PV-6에서 뒤집는다, 검토 반영 P5), `watch row on hls clip absent`(클립이라도 재생 방식이 HLS면 없다).
5. `no watch row when ownership notOwn or unknown`, `watch row shown for own, delegated, adminOverride, unchecked`(검토 반영 P1·P4).
6. `gate error shows existing error copy`: `notOwnContent`에서 `errors.ts` 문구.
7. `video error shows inline notice with retry and open-in-chzzk`: 재시도가 `watchOpen`을 다시 부른다.
8. `canPlayType empty → failed without loading`.
9. `collapse and card destroy call watchClose once`.
10. `no autoplay attribute, preload=metadata, aria-label from copy`.
11. `Escape on focused video does not close card`: `GlobalShortcuts`가 대상이 `HTMLMediaElement`면 Escape 분기를 건너뛴다. 같은 테스트에서 카드 다른 곳의 Escape는 여전히 카드를 닫는다(검토 반영 P9).
12. copy deck: `design-copy` gate가 새 키를 검사하고, 용어집과 `terms.json` 패리티를 본다. 새 문구에 "재생"이 없는지 DC1이 본다.
13. E2E `e2e/watch.spec.ts`(PD): 펼치기 → `watch_open` 인자, 실패 Notice와 [치지직에서 보기] 호출, 매 단계 `app.axe` 0. Playwright chromium은 실제 재생을 하지 않는다(§10).
14. 갤러리: `screens-data.ts`에 펼친 미리보기 카드와 실패 카드 두 상태를 더한다. 접힌 줄이 생겨 기존 카드 장면(`card-worst` `:156` 등)의 기준선도 바뀌므로 Linux CI `shots.mjs --accept`로 다시 받는다(검토 반영 P2).

완료 조건:
- `frontend`, `design-*`가 녹색이다.
- 커버리지 ratchet이 떨어지지 않는다.
- `e2e-web`, `design-shots`가 녹색이다(관찰 작업이라도 녹색을 확인한다).
- `size.dist_gz`가 3%를 넘으면 CI 측정값을 손으로 옮기고 RATCHET_LOG 줄을 더한다(PV9).

바뀌는 파일: `app/src/lib/{api.ts,copy/ko.ts}`, `components/receive/{WatchPanel.svelte,ResolveCard.svelte,receive.test.ts}`, `components/app/GlobalShortcuts.svelte`(+테스트), `src/test/setup.ts`, `app/e2e/{mock/backend.ts,watch.spec.ts,screens-data.ts,__shots__/*}`, `docs/design/system/{content.md,components.md,foundations.md,patterns.md}`(patterns.md는 §15 높이 520 예산 표 `:861`에 접힌 미리보기 줄 한 행을 더한다), `design/copy/terms.json`.

문서: app.md **110**, D64 [잠정] 등록.

#### PV-5 코어·셸 HLS (`crates/core/tests/watch.rs`, `crates/shell/tests/watch.rs`)
1. `render_watch_playlist_golden`: 합성 `MediaPlaylist`에서 정확한 텍스트(VERSION·TARGETDURATION 올림·EXTINF 소수 셋째·`s/0..`·ENDLIST)가 나온다.
2. `render_has_no_input_uri`: 입력 URI의 토큰 문자열이 출력에 없다.
3. `render_without_init_has_no_map`.
4. `pick_variant_visibility_only`: 기존 `pick_variant_fallback`(`segmented.rs:633`)은 그대로 녹색이고, 셸에서 `chzzk_core::download::pick_variant`로 부를 수 있다.
5. 셸 `hls_open_builds_session_from_fixture`: `testdata/hls/` 합성 master·media를 쓴다.
6. `hls_open_rejects_what_download_rejects`: DISCONTINUITY 또는 ENDLIST 없음이면 열기 실패다.
7. `seg_index_out_of_range_404`, `seg_index_leading_zero_404`.
8. `init_on_mp4_session_404`, `v_on_hls_session_404`.
9. `seg_403_refresh_same_crc_ok`, `seg_403_refresh_crc_changed_409`.
10. `seg_too_large_502`.

11. `open_rejects_hls_until_pv5`를 `hls_open_ok`로 바꾼다.

완료 조건: `run.mjs rust`(생방송 `tests/recording.rs` 포함), fixture `--check`가 녹색이다(fixture를 더하면 `gen-fixtures.mjs`로).

바뀌는 파일: `crates/core/src/{hls.rs,watch.rs,download/mod.rs,download/segmented.rs}`(`live.rs`는 import 그대로), `crates/core/tests/watch.rs`, `crates/shell/src/watch.rs`, `crates/shell/tests/{watch.rs,common/fake.rs}`, 필요하면 `scripts/fixtures/gen-fixtures.mjs`·`testdata/hls/`.

문서: core.md **87**, app.md 108에 덧붙인다(또는 새 번호).

#### PV-6L hls.js 고지
1. `worker-gen.test.mjs`: 라이선스 원천을 목록으로 받고 `/licenses`에 Lucide와 hls.js 두 절이 나온다. 처음에는 실패한다.
2. AboutSection 테스트: 고지 행이 Lucide와 hls.js(Apache-2.0)를 함께 보인다.
3. `licenses/hlsjs.txt`가 있고 PV-6에서 고를 정확한 버전의 LICENSE와 같다.

완료 조건: `design-icons`(worker-gen `--check`), `worker`, `frontend`가 녹색이다. `design-worker`·`design-shots`(설정 화면) 기준선을 Linux CI에서 다시 받는다. 운영 `/licenses` 반영은 Worker 배포가 필요하고 사용자 승인을 따로 받는다.

바뀌는 파일: `licenses/hlsjs.txt`, `scripts/design/worker-gen.mjs`(`PATHS.license`를 목록으로), `scripts/design/worker-gen.test.mjs`, `worker/src/http/licenses.generated.ts`, `worker/e2e/__shots__/*`, `AboutSection.svelte`(+테스트), `app/e2e/__shots__/*`(설정 장면).

#### PV-6 hls.js (`WatchPanel.test.ts`, `tauri-conf.test.ts`)
1. CSP 테스트에 `media-src … blob:`, `connect-src … watch: http://watch.localhost`를 더한다. 처음에는 실패한다.
2. `hls kind dynamically imports hls light and attaches with enableWorker false`: `vi.mock('hls.js/light')`.
3. `hls unsupported but native m3u8 → uses video src`.
4. `hls unsupported and no native → failed notice`.
5. `hls fatal error → failed notice, hls.destroy called`.
6. `destroy on collapse`.
7. `hls error uses details only`: 오류 처리기가 `data.frag.url`·`data.response.url`을 화면 문구·로그·IPC 인자로 넘기지 않는다(가짜 오류 객체의 url에 표지 문자열을 넣고 DOM·`invoke` 인자에 없는지 본다, 검토 반영 S10).
8. `watch row on rewind card`: PV-4의 `no watch row on rewind card yet`을 뒤집는다. 가짜 백엔드 시나리오와 `watch.spec.ts`에 빠른 다시보기 열기를 더한다.

완료 조건:
- `frontend`, `supply`가 녹색이다.
- `size.dist_gz`는 `write --from-run`이 받지 않는다(크기 단계에서 실패한 실행). CI 측정값(run id)을 `ci/ratchet.json`에 손으로 옮기고 RATCHET_LOG에 키·run id·이유 줄을 더한다(검토 반영 P8). light 빌드라도 수십 KB(gzip) 늘 것이다 [가정].
- 고른 버전과 그 이전 변경점 검토 표를 PR 본문에 둔다(메모리 규칙).

바뀌는 파일: `app/package.json`, `pnpm-lock.yaml`, `WatchPanel.svelte`, `ResolveCard.svelte`(`watchable`에 `liveRewindHls`), `tauri.conf.json`, `tauri-conf.test.ts`, `app/e2e/{mock/backend.ts,watch.spec.ts}`, `ci/ratchet.json`, `ci/RATCHET_LOG.md`.

문서: app.md **111**.

#### PV-7 구간 찍기
1. `mark buttons only on rewind card`: vod·clip에는 없다.
2. `mark start opens range and sets floor(currentTime)`: `currentTime = 65.9`면 `0:01:05`이고 `rangeOpen = true`다.
3. `mark end sets end field`, `mark at duration keeps toEnd semantics`: `effectiveRange`가 null(전체)이 되는 경우.
4. `marked end before start → order error on 받기`.
5. `marks flow into enqueue range`: `enqueue` 인자의 `range`가 찍은 ms다.
6. `buttons disabled until metadata loaded`.
7. `buttons hidden on native m3u8 path`: hls.js 미지원으로 네이티브 재생이면 찍기 버튼이 없다(검토 반영 P11).
8. `buttons disabled while busy`: 카드 `busy`면 찍기 버튼이 비활성이다(RangeField `disabled={busy}`, `ResolveCard.svelte:309`와 같다).
9. `marking keeps existing range error`: 앞 [받기]가 남긴 `rangeErr`는 찍은 뒤에도 남는다. 지금 손으로 칠 때와 같은 동작이다(`rangeErr`는 [받기] 때 정하고 접을 때만 지운다, `:225`·`:311`) (검토 반영 P14).
10. E2E: `watch.spec.ts`에 빠른 다시보기 찍기(`currentTime`을 `page.evaluate`로 설정) → `enqueue` range를 더한다.

완료 조건:
- `frontend`, `e2e-web` 녹색.
- **M-PV-5 통과**(hls.js 경로, 받을 화질을 미리보기와 다르게 고른 경우 포함). 불통과면 PV-7을 보류한다(range.md의 R18 처리와 같다).

바뀌는 파일: `WatchPanel.svelte`, `ResolveCard.svelte`, 테스트, `ko.ts`, `app/e2e/watch.spec.ts`, 갤러리 장면(찍기 버튼).

문서: app.md **112**.

#### PV-8 문서 마감
가짜 백엔드·spec·갤러리는 PV-3·PV-4·PV-6·PV-7로 옮겼다(검토 반영 P2).
1. 문서: D64 [잠정] → 확정 값, ADR-0027, `features/README.md` 행, `plan.md` 트랙, ROADMAP Phase 5 체크박스와 "현재 위치".
2. `tests.playwright` 기준: `ratchet.mjs write --from-run`은 **성공한** push·dispatch 실행만 받는다(`ratchet.json` `$comment`). master 머지 실행이나 브랜치 dispatch 실행이 녹색일 때 그 run id로 올린다(검토 반영 P8).

완료 조건: `scan`, `design-*` 녹색.

### 11.3 gate
`rust`, `tauri-clippy`, `tauri`, `tauri-build`, `frontend`, `design-*`, `scan`, `supply`(PV-6), `worker`·`design-worker`(PV-6L), `coverage`, `e2e-web`, `design-shots`를 돈다. `.github/`는 바꾸지 않는다.

### 11.4 번호 예약
- core.md 구현 중 변경 86·87 [확인: 마지막 85].
- app.md 108~114 [확인: 마지막 107]. PV-6L이 하나를 더 쓴다.
- 디자인 결정 D64 [확인: 마지막 D63], ADR-0027 [확인: 마지막 0026].
- 미머지 PR과 겹치면 나중에 머지되는 쪽이 번호를 옮긴다.

## 12. 후속(범위 밖)
- 생방송 미리보기.
- 미리보기 화질 고르기.
- 썸네일 탐색 막대.
- 실패 원인별 문구(`watch_status` command, §14 Q2).
- 유휴 만료·실패 뒤 [다시 시도]에서 재생 위치 되살리기(§1.3 9).
- main 창 내비게이션 가드(`on_navigation`, §7.3).
- 일반 VOD 구간 받기(range.md §12.1의 재개 조건).

## 13. 실측 필요(사용자 손, 출력은 판정만)

| ID | 무엇 | 누가 | 통과 기준 |
|---|---|---|---|
| M-PV-1 | 3 OS에서 일반 VOD·클립 재생과 탐색(앞·뒤·끝 근처) | 사용자, 본인 영상 | 재생 시작, 탐색 뒤 3초 안 재생, 끝까지 재생. Range 없는 첫 요청에 206을 줘도 되는지 함께 본다 |
| M-PV-2 | 3 OS에서 빠른 다시보기 hls.js 재생·탐색, CORS 출처(릴리스 빌드와 `pnpm tauri dev` 둘 다) | 사용자 | 재생·탐색 성공, 콘솔에 CSP·CORS 위반 없음. 실제 Origin이 PV11의 값과 같다 |
| M-PV-3 | Linux(deb·AppImage) 코덱: H.264·AAC mp4와 MSE | 사용자, Linux 실기 | 재생되거나, 안 되면 대체 경로 Notice가 뜬다(빈 화면이나 멈춤 없음) |
| M-PV-4 | 서명 만료 뒤 재생 지속: 펼친 채로 만료 시간보다 오래 둔 뒤 탐색 | 사용자 | 재조회로 이어 재생, 실패해도 Notice |
| M-PV-5 | 시각 원점: 미리보기(hls.js 경로, 가장 낮은 화질)에서 찍은 구간으로 받은 결과의 시작이 찍은 화면과 같은가. 받을 화질을 미리보기와 다르게(가장 높은 화질) 고른 경우도 본다 | 사용자 | 시작·중간·끝 세 시각 모두 차이가 조각 경계 넓힘 안(`select_range`, range.md 실측 2번과 같은 기준). **PV-7 머지 조건** |
| M-PV-6 | 조각 크기 4 MiB의 체감(탐색 지연·메모리) | 사용자 | 탐색 지연이 받기 전 확인에 거슬리지 않음. 아니면 CHUNK 조정 |
| M-PV-7 | 성인 영상: 쿠키 없이 미리보기가 되는가 | 사용자 | 되거나, 대체 경로로 깔끔히 실패 |

## 14. 열린 질문

| # | 질문 | 선택지 | 추천 |
|---|---|---|---|
| Q1 | 미리보기 화질 | (a) 가장 낮은 비디오 고정 (b) 카드에서 고른 화질 따라감 | **(a)**. 세션을 다시 열 일이 없고 조각이 작다. 원하면 후속에서 (b) |
| Q2 | 실패 원인 구분 | (a) 단일 문구 + 대체 경로 (b) `watch_status`로 `AppError`를 받아 원인별 문구 | **(a)** v1. 원인은 로그에 남긴다 |
| Q3 | 게이트 엄격도 | (a) 받기와 같음(fail closed) (b) resolve처럼 누구나 | **(a)**. 과제 요구이고, 남의 영상 재생 통로가 되지 않게 한다 |
| Q4 | macOS HLS | (a) MSE면 hls.js, 아니면 네이티브 (b) macOS는 늘 네이티브 HLS | **(a)**. 한 경로로 테스트하고, 네이티브는 대체로만 쓴다. M-PV-2에서 (a)가 실패하면 (b) |
| Q5 | scheme 이름 | `watch` / `chzzk-watch` | **`watch`**. 짧고 Tauri 예약 이름(`tauri`·`asset`·`ipc`)과 겹치지 않는다 [가정] |
| Q6 | 동시 세션 수 | 1 / 창마다 여러 개 | **1**. 카드가 하나라서다 |
| Q7 | Esc가 `<video>` 위에서 카드를 닫지 않게 하는 방법 | (a) `GlobalShortcuts`가 `HTMLMediaElement` 대상이면 건너뜀 (b) WatchPanel이 `ui.onEscape` 처리기를 쌓아 펼친 동안 Esc를 먹음 | **(a)**로 적었다(§6.2). (b)는 펼친 미리보기가 있으면 카드 밖 Esc도 막는다. 전체 화면 해제 Esc가 키 이벤트로 오는지는 M-PV-1에서 같이 본다 |
| Q8 | hls.js 고지를 따로 PR로 뺄지 | (a) PV-6L 따로(지금 적은 안) (b) PV-6에 합침 | **(a)**. Worker 생성기·`design-worker` 기준선·Worker 배포 승인이 앱 기능과 다른 박자로 움직인다. 운영 `/licenses` 반영을 앱 릴리스 전에 할지는 사용자 결정 |
| Q9 | 네이티브 m3u8 대체 경로에 찍기 버튼을 둘지 | (a) 두지 않음(지금) (b) M-PV-5를 네이티브 경로로도 통과시키면 둠 | **(a)**. 네이티브 경로는 대체용이고 첫 조각 tfdt가 0이 아니면 시간축이 다를 수 있다(`range.md:460` 음성 fixture) |
| Q10 | Range 없는 첫 요청에 206을 줘도 되는가 | (a) 206 조각(지금) (b) 200 + 앞 조각만 | **(a)**, M-PV-1로 확인. (b)는 `Content-Length`가 전체와 달라 더 나쁘다 [가정] |

## 15. 검토 반영

적대적 검토 둘(보안·정확성 S1~S10, 계획·TDD·제약 P1~P14)을 반영했다. 판정마다 지적한 파일을 직접 열어 확인했다. 겹치는 지적은 서로 가리킨다.

| # | 지적 | 판정 | 이유·바뀐 곳 |
|---|---|---|---|
| S1 | 206 Content-Range 끝값 근거 없음, total을 알 길 없음 | 반영 | `parse_content_range`는 `(start,total)`만 주고 `bytes */N`을 start 0으로 읽는다(`progressive.rs:262-274`), `PdRep`에 크기 없음(`model.rs:114-118`) 확인. 끝값까지 읽는 새 파서, 업스트림 실제 값으로만 응답, total은 `open`에서 `bytes=0-0`으로 정함(PV3, §4.1, §5.2, §5.3, PV-1 1a~1f). 조기 EOF는 `SourceChanged`가 아니라 `Retry`/`502`로 했다(전송 문제라 세션을 버릴 이유가 없다). `progressive.rs`는 건드리지 않는다 |
| S2 | single-flight가 지난 403과 세션 교체를 구분 못 함 | 반영 | std Mutex 가드는 await 너머로 못 든다. `Arc<Session>` + `gen`, 결과는 ID(`Arc::ptr_eq`)·`gen`이 같을 때만 씀(PV7, §5.2, §5.3, PV-2 20a·20b) |
| S3 | 로그인을 끈 빌드에서 scheme 게이트 미정의 | 반영(P1과 같음) | `gate_command`(`app.rs:471-477`)·`admit_checked`(`ownership.rs:198-200`)가 auth 없으면 통과함을 확인. 받기와 같이 허용, `me: Option<String>`(PV6, §5.3, PV-2 2c) |
| S4 | dev 실행의 앱 출처가 `tauri://localhost`가 아님 | 반영 | `get_app_url`의 `#[cfg(dev)]` devUrl 분기(`manager/mod.rs:345-358`), `devUrl` `http://localhost:1420`(`tauri.conf.json:8`) 확인. `tauri::is_dev()`면 devUrl 출처(PV11, §6.1, §8, PV-3 6, M-PV-2) |
| S5 | Range 의미가 RFC·선례와 어긋남(suffix·다중 416, HEAD 미정의) | 반영(Range 없음 행은 유지) | Tauri asset이 suffix·다중을 받고 HEAD는 본문 없이 길이만 줌(`asset.rs:113-121`, `:154-201`, `:219-222`) 확인. suffix → `total-N`, 다중 → 첫 구간, HEAD → 업스트림 호출 없이 세션 total로(검토의 "HEAD마다 `bytes=0-0`"보다 단순하게 바꿨다), `bytes=5-3`은 `416`. Range 없음 206은 이미 [실측 필요]라 M-PV-1·Q10에 둔다 |
| S6 | `open`의 `admit_checked`에 `recheck` 빠짐 | 반영(P1 일부와 같음) | `admit_checked`가 `recheck`를 받고(`ownership.rs:187-224`) App이 `App::recheck`를 넘김(`app.rs:401-408`) 확인. 열기·재판정 모두 같은 클로저(PV6, §5.2, PV-2 2b·21) |
| S7 | 오류 체인으로 서명 URL이 새는 경로 미열거 | 반영 | `Error::network`만 `without_url()`을 거침(`error.rs:141-144`), `classify_failure`가 그 길을 씀(`retry.rs:163-166`) 확인. `WatchFail`은 `reqwest::Error`를 직접 담지 않는다는 규칙(§4.1, §7.8, §9, PV-1 11a) |
| S8 | `open_content_page`의 `clip_id` 미검증 | 반영 | `ContentRef::Clip { clip_id: String }`(`model.rs:19-29`) 확인. `parse_content_url` 왕복, `Live` 거부(PV19, §5.4, PV-3 8) |
| S9 | Origin 검사는 `<video>`를 막지 못함 | 반영 | 앱에 `on_navigation` 없음(grep 0건) 확인. §7.3·PV11을 "CORS 요청에 한해"로 고치고 방어선을 ID·라벨로 적었다. 내비게이션 가드는 범위 밖(§12) |
| S10 | hls.js 오류 객체에 전체 세션 ID | 반영 | 세그먼트 주소에 ID가 든다(§5.2 6). hls.js 오류의 url 필드를 쓰지 않는 규칙과 PV-6 테스트 7(§6.2, §7.7) |
| P1 | auth 꺼짐·`unchecked` 동작 미정의, 양성 테스트 없음 | 반영(S3·S6과 같음) | `Ownership::Unchecked`(`dto.rs:681`), IPC 픽스처 `auth:false`(`ipc.rs:199`), 가짜 백엔드 `AUTH_DISABLED`(`backend.ts:301`) 확인. 판정 다섯 표 테스트(PV-2 2a), 프런트 양성 테스트(PV-4 5) |
| P2 | 가짜 백엔드·spec·갤러리를 PV-8로 미룸 | 반영 | 갤러리 카드 장면(`screens-data.ts:156` `card-worst`, `card: true`)과 높이 예산 표(`patterns.md:861`) 확인. 가짜 백엔드 command는 PV-3, 시나리오·spec·갤러리·높이 예산은 PV-4, HLS는 PV-6, 찍기는 PV-7로 옮기고 PV-8은 문서 마감만 |
| P3 | "재생" 금지어 해석이 틀림 | 반영 | 패턴 `"재생"`(`terms.json:670`), "재생기" 선례(`content.md:527`), 패턴 짝 검사(`copy.mjs:664-666`), 도움말도 DC1(`copy.mjs:26-27`) 확인. §6.3을 고치고 "재생하기"는 avoid에 넣지 않았다(기존 패턴이 잡는다) |
| P4 | Disclosure에 비활성 상태 없음 | 반영 | Props에 `disabled` 없음(`Disclosure.svelte:10-15`) 확인. 허용이 아니면 줄을 그리지 않는다(PV14, §3, PV-4 5). ui 컴포넌트는 바꾸지 않는다 |
| P5 | HLS가 붙기 전 빠른 다시보기 카드 미리보기가 깨짐 | 반영 | PV-4는 `progressive`만 그리고(클립 HLS도 빠짐, `kindTone` `receive.ts:23-27`), PV-2는 HLS 열기를 `invalidInput`(PV-2 3), PV-5·PV-6에서 넓힌다 |
| P6 | `pick_variant`를 옮기면 생방송 엔진이 깨짐 | 반영 | `live.rs:36` import, `:571` 사용, `range.md:141` 경고 확인. 옮기지 않고 공개 범위만 넓힌다(§4.1, PV-5 4, 파일 목록, `recording.rs` 완료 조건) |
| P7 | hls.js 고지 범위 과소평가 | 반영 | `worker-gen.mjs:35` 단일 경로, `AboutSection.svelte:116` 하드코딩 확인. 별도 PR PV-6L로 빼고 Worker 배포 승인을 적었다(PV9, §11, Q8) |
| P8 | ratchet 올리는 절차가 틀림 | 반영 | `ratchet.json` `$comment`(성공한 실행만), RATCHET_LOG 2026-10-19 `windows-cli` 손 옮김 선례 확인. PV9·PV-4·PV-6·PV-8 고침 |
| P9 | Escape 테스트를 통과시킬 구현 없음 | 반영 | `GlobalShortcuts.svelte:16-18`은 `defaultPrevented`만 봄 확인. `HTMLMediaElement` 대상이면 건너뛰게 하고 파일 목록에 넣었다(§6.2, PV-4 11, Q7) |
| P10 | PV-1·PV-2 빠진 엣지, 검증 불가 테스트 | 반영 | 짧은 206·조기 EOF·조각마다 다른 total·`bytes=5-3`·HEAD·재조회 중 교체를 더했고(PV-1 1b~1f, PV-2 14·15a~15d·20b), PV-1 4는 raw TCP로 |
| P11 | 구간 찍기 시간축이 range.md 계약과 어긋날 수 있음 | 반영 | `range.md:100`·`:110`·`:534`·`:555`, 음성 fixture `:460` 확인. M-PV-5를 PV-7 머지 조건으로, 다른 화질 포함, 네이티브 경로는 찍기 버튼 없음(PV17, PV-7 7, Q9) |
| P12 | 열 때 total을 알 길 없음 | 반영(S1과 같음) | 탐색을 `handle`의 숨은 호출이 아니라 `open`의 1회로 두고 횟수·실패를 테스트(PV-2 3a) |
| P13 | 유휴 만료 시계 seam 없음, 사용자 흐름 누락 | 반영 | 셸 dev 의존성 `test-util`(`Cargo.toml:42`)과 `start_paused` 선례(`tests/app_f.rs:38`) 확인. `tokio::time::Instant`로 두고 trait는 두지 않는다. §1.3 9에 흐름, 위치 되살리기는 §12 후속 |
| P14 | 찍기 버튼과 카드 상태 관계 테스트 없음 | 반영 | `disabled={busy}`(`ResolveCard.svelte:309`), `rangeErr` 설정·해제(`:225`·`:311`) 확인. PV-7 8·9 |

기각한 지적은 없다. S1의 조기 EOF 처리와 S5의 HEAD 처리는 검토의 고칠 방향과 다르게(더 단순하게) 반영했다.

## 16. 구현 결과(PV-8, 2026-10-20)

PV-1~PV-7이 `feat/preview-pv1`~`pv7` 브랜치(stacked)로 구현됐다. 아래는 명세와 달라진 점의 요약이고, 원문은 core.md 구현 중 변경 86·87, app.md 구현 중 변경 108~114다. 번호 예약(§11.4)은 PV-6L이 하나를 더 써서 app.md 112 이후가 한 칸씩 밀렸다.

### 16.1 PR과 번호

| PR | 브랜치 | 구현 중 변경 | 비고 |
|---|---|---|---|
| PV-1 코어 PD 중계 | `feat/preview-pv1` | core.md 86 | `watch_range`·`watch_bytes`, 끝값까지 읽는 `parse_content_range_full` |
| PV-2 셸 세션 | `feat/preview-pv2` | app.md 108 | `WatchService<B>`, 리뷰 반영 ⑧~⑫ |
| PV-3 Tauri 배선 | `feat/preview-pv3` | app.md 109 | scheme·command 셋·CSP·가짜 백엔드 command |
| PV-4 프런트 PD 재생기 | `feat/preview-pv4` | app.md 110, D64·ADR-0027 | `WatchPanel`, 갤러리 장면, 높이 예산 506 → 542 |
| PV-5 코어·셸 HLS | `feat/preview-pv5` | core.md 87, app.md 111 | `render_watch_playlist`, `/pl.m3u8`·`/init`·`/s/<i>` |
| PV-6L hls.js 고지 | `feat/preview-pv6l` | app.md 112 | `licenses/hlsjs.txt`, 생성기 원천 여럿 |
| PV-6 hls.js | `feat/preview-pv6` | app.md 113 | hls.js 1.7.3 light, CSP `blob:`·`connect-src` |
| PV-7 구간 찍기 | `feat/preview-pv7` | app.md 114 | hls.js 경로만, **M-PV-5 통과가 머지 조건** |
| PV-8 문서 마감 | `feat/preview-pv8` | (번호 없음) | 이 절, D64·ADR-0027 확정 표기, 기능 안내·계획·ROADMAP |

### 16.2 명세와 달라진 점

- **필드 이름 `gen` → `generation`**: `gen`이 edition 2024 예약어다(app.md 108).
- **게이트·재판정 주입 위치**: `open`의 인자가 아니라 `WatchService::new(client_fn, Arc<OwnershipGate>, RecheckFn)`가 들고 있다. `handle`의 재판정도 같은 것을 써야 해서다. `App.gate`가 `Arc<OwnershipGate>`가 됐고 `recheck_auth(auth)` 한 곳을 App과 세션이 같이 쓴다(app.md 108).
- **로그아웃 훅**: PV-3이 훅을 더하지 않았다. `App::on_auth_status`가 `SignedIn`이 아니면 `watch.on_signed_out()`을 이미 부른다(app.md 108·109).
- **재조회 상한은 resolve 시도 수**로 센다(성공 수가 아니다). 재조회 중 세션이 사라지면 `404`, 비ASCII `Range`는 `416`이다(app.md 108).
- **코어 재시도 규칙(명세는 "1회, 짧게")**: 5xx·408·429·전송 오류를 100ms [잠정] 뒤 한 번 더 한다. 그래도 상태 오류면 `Fatal`, 전송 오류면 `Retry`. `end_incl < start`는 요청 없이 `Fatal(Parse)`(core.md 86).
- **`api.ts` 래퍼 시기**: command 목록과 1:1을 강제하는 `api.test.ts` 때문에 `watchOpen`·`watchClose`·`openContentPage`를 PV-4가 아니라 PV-3에서 더했다(app.md 109).
- **`canPlayType` 확인 시점**: `watch_open` 뒤에 본다. 열기 전에 막으면 Playwright chromium(H.264 없음)에서 E2E가 `watch_open` 인자를 볼 수 없다. 읽지 못하면 받은 세션을 바로 닫는다(app.md 110).
- **열리는 중 자리**: Skeleton 변형 대신 `--surface-2` 상자다(`ui/`는 바꾸지 않는다, app.md 110).
- **HLS 재조회**: master·media를 다시 받아 조각 수와 `durations_crc`가 같으면 주소만 바꾸고 세대를 올린다. 다르면 `409`+세션 버림이다. `refresh`의 반환이 `()`가 되고 호출자가 세션에서 다시 읽는다(app.md 111).
- **`pick_variant`**: 위치·시그니처는 그대로 두고 `pub(super)` → `pub`으로 넓혀 `download`에서 재공개했다(core.md 87).
- **`watchable`의 갈래**: PV-4는 `progressive`만 그렸고, PV-6이 `liveRewindHls`를 더했다. 클립이라도 재생 방식이 HLS면 줄이 있다(PV-4 시험을 뒤집었다, app.md 113).
- **hls.js 오류**: `data.fatal`만 본다. `details`는 화면·로그에 쓰지 않는다(S10의 핵심은 url 필드 금지이고 원인은 한 문구라는 Q2에 맞췄다, app.md 113).
- **PV-7 찍기**: 새 DTO·command·`effectiveRange` 변경이 없다. 버튼은 hls.js로 붙었을 때(`usingHls`)만 그린다. 영상 끝을 찍으면 기존 규칙대로 끝까지 받기다(app.md 114).

### 16.3 남은 것

- **사용자 실측 M-PV-1~7**(§13). M-PV-5(hls.js 경로 시각 원점, 화질을 다르게 고른 경우 포함)는 PV-7 머지 조건이고, 불통과면 PV-7을 보류한다. 높이 상수 `--watch-max-h` 360px는 M-PV-1로 조인다.
- **갤러리 기준선**: `design-shots`(미리보기 장면 다섯과 접힌 줄이 늘어난 기존 카드 장면)·`design-worker`(`/licenses`)의 `__shots__` 기준선은 Linux CI에서만 만든다. 실패한 실행의 artifact를 `node scripts/design/shots.mjs --accept <run id> [--target worker]`로 받는다.
- **운영 `/licenses`**: hls.js 고지를 운영에 반영하려면 Worker 배포가 필요하고 사용자 승인을 따로 받는다(Q8).
- **후속(§12)**: 생방송 미리보기, 화질 고르기, 썸네일 탐색 막대, 원인별 문구, 재생 위치 되살리기, main 창 내비게이션 가드, 일반 VOD 구간 받기.

### 16.4 `tests.playwright` 기준

PV-8은 `ci/ratchet.json`을 올리지 않았다. `ratchet.mjs write --from-run <run id>`는 **성공한** push·dispatch 실행만 받는다(`ratchet.json` `$comment`, 검토 반영 P8). 이 브랜치가 master에 머지돼 `e2e-web`이 녹색인 실행(또는 브랜치 dispatch 녹색 실행)이 나오면 그 run id로 올린다. 올리는 PR이 사람 손이면 `ci/RATCHET_LOG.md`에는 올리기이므로 줄이 필요 없다(느슨하게 할 때만 적는다).
