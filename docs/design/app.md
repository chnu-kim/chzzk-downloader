# Phase 2 앱 설계 (Tauri 셸 + Svelte 화면, 확정안)

UX 설계안과 셸 아키텍처 설계안을 대조해 판정한 Phase 2의 기준 문서다. 기준은 `docs/ROADMAP.md`, `docs/design/core.md`(§3 공개 API와 "구현 중 변경" 7·12·27·33·35·47·52), `docs/research/stack.md`, `docs/research/chzzk-oauth.md`(Phase 3 자리), 그리고 `crates/core/src/lib.rs`가 실제로 재노출하는 API다. 코어 API는 바꾸지 않는다. 설계와 다르게 구현한 것은 이 문서 끝 "구현 중 변경"에 번호를 붙여 적는다.

## 0. 판정 요약

| 주제 | 결정 | 한 줄 근거 |
|---|---|---|
| 프런트 형태 | **순수 Vite + Svelte 5 + TS**. SvelteKit은 쓰지 않는다 | 화면이 한 창에 뷰 3개(홈·설정·로그인)라 라우터가 필요 없다. kit 3.0.0·adapter-static 4.0.0이 2026-10-01에 나와 템플릿(kit ^2.65)과 어긋나므로 어느 쪽을 골라도 템플릿을 그대로 따를 수 없다(2026-10-05 npm 확인) |
| Rust 배치 | **`crates/shell`(Tauri 비의존) + `app/src-tauri`(얇은 어댑터)** | DownloadManager·DTO·오류 매핑·작업 저장을 webkit 의존성과 프런트 빌드 없이 3 OS에서 `cargo test -p chzzk-shell`로 검사한다 |
| 상태 판단 위치 | **큐·상태 머신·중복 검사·소유 검사는 Rust**. 프런트는 표시와 입력만 | 재시작 복원과 종료 처리가 Rust에 있어야 하고, UI만 믿지 않기 위해서다 |
| 진행률 전달 | **앱 수명 동안 구독 하나**(`subscribe_jobs`, `Channel<JobEvent>`), 모든 이벤트에 `jobId` | 작업이 `invoke` 한 번보다 오래 살고, 복원된 작업에는 Channel이 없으며, 웹뷰 새로고침 뒤 재구독·스냅샷으로 맞춘다 |
| 스로틀 | 코어 `Meter`(`progress_interval = 250ms`)만 | 간격 제한·단계 변경 강제 전송이 이미 구현·테스트돼 있다 |
| 숫자 표시 | DTO는 숫자만, 문자열 포맷은 TS(`format/bytes.ts`가 코어 `format_bytes` golden을 그대로 이식) | 한국어 문구("약 5.1 GB", "2분 18초 남음")가 copy deck과 함께 TS에 있으므로 한 곳에서 조합한다 |
| 타입 생성 | **ts-rs 12.0.1**을 `crates/shell` DTO에만, `TS_RS_LARGE_INT=number` | tauri-specta는 `2.0.0-rc.25`로 정체 중. 코어에는 TS derive를 넣지 않는다 |
| 작업 저장 | `{app_data_dir}/jobs.json`, 상태 전이 때만 원자적 쓰기, 시작 때 reconcile | 진행률 틱마다 쓰지 않는다. 설정이 아니라 상태라 config가 아닌 data 폴더다 |
| 재시작 후 | **자동 재개하지 않는다.** `interrupted`로 복원하고 배너의 `[모두 이어받기]`로 시작 | 데이터 사용량이 크고 쿠키 만료처럼 상황이 바뀌었을 수 있다 |
| 동시 다운로드 | v1 상수 **2**(HLS 연결은 작업당 `segment_concurrency`) | 설정으로 열면 코어 `UserSettings` 변경이 필요하다. 실측 뒤 결정(열린 질문 1) |
| 새 설정 | **코어 `UserSettings`를 바꾸지 않는다.** 중복 정책 설정·동시 작업 수·클립보드 감시는 v1에서 뺀다 | 셸이 같은 `settings.json`에 모르는 키를 쓰면 `SettingsStore::update`가 지운다. 필요해지면 코어에 `#[serde(default)]` 필드로 더한다 |
| 중복 처리 | 카드에서 묻는다: 완성 파일이 있으면 "번호 붙여 저장(기본) / 덮어쓰기", 같은 작업 `.part`가 있으면 "이어받기(기본) / 처음부터" | 코어가 버린 `Ask`·`Rename`을 셸이 경로 선택으로 구현한다. `Skip`은 UI에 노출하지 않는다 |
| 작업 상태 | `queued · running · pausing · paused · interrupted · completed · skipped · failed` 8개 | UX안의 `needsChoice`·`canceling`, 셸안의 `cancelled`는 뺐다. 화질 재선택은 "다시 불러오기"로, 취소는 `remove_job`으로 표현한다 |
| 창 닫기 | Rust `WindowEvent::CloseRequested`에서 막고 프런트가 D1을 띄움. 확인하면 `quit` command가 전부 일시정지(최대 3초) 후 종료 | 종료 처리가 Rust에 있어야 크래시 불변식과 맞물린다 |
| 플러그인 | `single-instance`(맨 먼저), `dialog`(Rust에서만), `opener`(Rust에서만). `updater`는 Phase 4 | JS에 플러그인 권한을 주지 않는다. capabilities는 `core:default` + 앱 command뿐 |
| 로그 | `tracing-subscriber` + `tracing-appender`(daily, 7개)로 `app_log_dir` | 코어가 `tracing`을 쓴다. `tauri-plugin-log`는 `log` 브리지가 하나 더 필요하다 |
| 스타일 | 일반 CSS 커스텀 프로퍼티 + Svelte scoped style. Tailwind·번들 글꼴 없음 | 컴포넌트 20여 개 규모라 빌드 플러그인과 2 MB 글꼴을 더할 이유가 없다. 테마는 `prefers-color-scheme` |
| 인증(Phase 3) | 토큰은 Rust에만. JS는 `{signedIn, channelId, channelName}`만 본다. 자리는 Phase 2에 미리 둔다 | CSP `connect-src`를 IPC로 고정할 수 있다 |

### 각 설계안에서 가져온 것

- **UX안**: 화면 목록과 와이어프레임, 종류 라벨(빠른 다시보기/일반 VOD/클립), 카드의 충돌 안내 세 형태, 진행률 표시 규칙(HLS 퍼센트는 `media_secs`), 오류 문구와 복구 동작 표, copy deck, 단축키·접근성 규칙, 상태별 시각 표현, 레거시 가져오기 흐름(첫 실행은 D3로 확인), Phase 3 자리(AuthGate·AccountSlot·OwnershipNotice).
- **셸안**: `crates/shell` 분리와 `Backend` trait(가짜 코어 seam), 구독 하나 Channel, ts-rs, `jobs.json`과 reconcile 표, `remove_job`의 "태스크 종료를 기다린 뒤 `discard_partial`", `partial_bytes`를 실제 `.part`로 채우기, `check_output`의 "서로 독립인 두 질문", AppManifest·capabilities·CSP, 로그, 비밀 누출 테스트, CI 3단(shell/frontend/tauri), 버전 표.
- **뺀 것(v1 불필요)**: 클립보드 감시(플러그인 필요), 텍스트 드래그 앤 드롭(3 OS 검증 필요), 중복 정책 설정·동시 작업 수 설정(코어 변경 필요), `needsChoice` 상태와 `choose_quality`, `cancel_resolve`(프런트의 세대 번호로 낡은 결과를 버린다), `resume_all_interrupted`(프런트가 반복 호출), "치지직에서 열기", 업데이트 확인 UI(Phase 4), OS 알림, 트레이, 썸네일, Tailwind, Pretendard.

---

## 1. 범위

### 1.1 코어가 주는 것과 셸이 맡는 것

| 코어(`chzzk_core`) | 셸(`chzzk_shell` + `chzzk_app`) | 프런트(`app/src`) |
|---|---|---|
| `parse_content_url`, `Chzzk::resolve` → `Resolved`, `Resolved::default_quality` | `resolve` command, `ResolvedDto`(서명 URL 제외) | URL 입력(직접 입력·붙여넣기·최근 VOD), 카드 |
| `Chzzk::download` 한 건, `.part` 이어받기, `discard_partial` | **DownloadManager**: 큐(동시 2), 상태 머신, 취소 토큰, `jobs.json`, reconcile | 목록 표시, 버튼 → command |
| `Progress`(숫자) + `Meter` 스로틀 | `ProgressDto`(튜플을 평평하게) → Channel | `format/*`로 문자열 조합, 진행 막대 |
| `naming::{default_filename, sanitize_filename, output_path}` | `check_output`: 최종 경로 계산, 완성 파일·`.part`·목록 중복 판정, 빈 이름 제안 | 파일 이름 편집, 충돌 안내 |
| `SettingsStore`, `CredentialStore`, `import_legacy`, `add_recent_vod` | `SettingsService`: 저장소 열기, 클라이언트 교체, 첫 실행 가져오기 | 설정 화면(즉시 저장), 가져오기 안내 |
| `Error` + `ErrorKind`(20종), `is_resumable` | `AppError`(code + payload + stage) | `errorCopy`로 한국어 제목·설명·동작 |
| `is_own_content` | `OwnershipGate`(Phase 2는 항상 허용) | `OwnershipNotice`(Phase 2는 렌더링 없음) |

### 1.2 v1에서 하지 않는 것

- 창은 하나다. 설정과 로그인은 같은 창 안의 뷰다. 트레이·OS 알림·작업 표시줄 진행률은 없다. 창에 포커스가 없을 때 완료되면 `request_user_attention`만 쓴다.
- 썸네일(요구사항), 일괄 URL 입력, 채널 전체 받기, 재생 미리보기, 목록에서 파일 이름 변경(이어받기가 끊긴다)은 없다.
- 두 번째 실행은 기존 창에 포커스만 준다. 인자로 URL을 넘기지 않는다.

---

## 2. 디렉토리 레이아웃

```
Cargo.toml                    # members = ["crates/core", "crates/shell", "app/src-tauri"]
.cargo/config.toml            # TS_RS_EXPORT_DIR, TS_RS_LARGE_INT
crates/
  core/                       # 그대로
  shell/                      # package "chzzk-shell" (lib chzzk_shell). tauri 의존 없음
    src/
      lib.rs
      backend.rs              # trait Backend + impl for Chzzk
      manager.rs              # DownloadManager: 큐·동시성·취소·상태 전이·종료
      jobs.rs                 # JobRecord, JobStore(jobs.json), reconcile
      events.rs               # trait EventSink, JobEvent
      dto.rs                  # 프런트로 가는 모든 타입 (#[derive(Serialize, TS)])
      error.rs                # AppError, ErrorCode, ErrorPayload, From<chzzk_core::Error>
      output.rs               # check_output 판정, 빈 이름 제안 ("이름 (2)")
      services.rs             # AppPaths, SettingsService(SettingsStore+CredentialStore+Chzzk 교체, legacy)
      ownership.rs            # OwnershipGate (Phase 2: 항상 허용)
    tests/                    # 매니저 통합 테스트(가짜 Backend), DTO JSON 스냅샷, 비밀 누출
app/
  package.json                # pnpm, "type": "module"
  pnpm-lock.yaml
  index.html
  vite.config.ts              # port 1420 strictPort, clearScreen false, envPrefix TAURI_, test 블록
  tsconfig.json
  src/
    main.ts  App.svelte       # view: 'home' | 'settings' | 'login' ($state)
    app.css                   # 커스텀 프로퍼티(라이트/다크), 기본 타이포
    lib/
      bindings/               # ts-rs 생성물(커밋, 손대지 않음)
      api.ts                  # invoke를 부르는 유일한 파일
      copy/ko.ts  copy/errors.ts
      format/{bytes,duration,date}.ts
      stores/{jobs,settings,resolve,auth,toast}.svelte.ts
      components/...          # §10
    test/setup.ts
  src-tauri/                  # package "chzzk-app" (lib chzzk_app_lib)
    Cargo.toml  build.rs  tauri.conf.json
    capabilities/default.json
    icons/
    src/main.rs  src/lib.rs   # Builder, 플러그인, setup(경로·로그·legacy), 창 닫기 이벤트
    src/commands.rs           # #[tauri::command] → chzzk_shell 호출
    src/sink.rs               # ChannelSink: EventSink for tauri::ipc::Channel<JobEvent>
```

- `app/`은 독립 pnpm 프로젝트다. 나중의 `worker/`는 vitest 4(Workers 플러그인 peer)를 쓰므로 루트 workspace로 묶지 않는다.
- `tauri.conf.json`: `frontendDist = "../dist"`, `devUrl = "http://localhost:1420"`, `beforeDevCommand = "pnpm dev"`, `beforeBuildCommand = "pnpm build"`. 창은 `width 960, height 700, minWidth 720, minHeight 520`, 제목 `치지직 다운로더`, `dragDropEnabled: false`.
- `identifier`는 한 번 정하면 바꾸지 않는다(`app_config_dir`·`app_data_dir`·`app_log_dir`이 여기서 나온다). 치지직 금칙어(`chzzk`, `naver`)를 피해 `io.github.chnu-kim.vod-downloader`로 둔다. `productName`은 `치지직 다운로더`.
- `chzzk-app`은 `crate-type = ["rlib"]`(모바일용 `staticlib`·`cdylib` 불필요).
- `.gitignore`에 `app/dist/`, `app/src-tauri/gen/`을 더한다. 루트 `dist/`·`node_modules/`·`target/`은 이미 있다.

---

## 3. 코어와 셸의 경계

셸이 쓰는 코어 API는 다음뿐이다(2026-10-05 `lib.rs` 기준 확인).

- 재노출: `Chzzk, ClientConfig, Endpoints, CredentialStore, DownloadOutcome, DownloadRequest, DuplicatePolicy, discard_partial, Error, ErrorKind, NaverCookies, Secret, LegacyImport, import_legacy, ContentKind, ContentMeta, ContentRef, PlaybackKind, Quality, Resolved, Source, Platform, is_own_content, Phase, Progress, RecentVod, SettingsStore, UserSettings, add_recent_vod, CancellationToken, parse_content_url`.
- 모듈 경로: `download::part::{part_path, sidecar_path, Sidecar}`(`Sidecar`는 `Serialize + Deserialize`, `same_job(content, quality_id, kind)`), `download::{DEFAULT_CONCURRENCY, MAX_CONCURRENCY}`, `fsutil::atomic_write`, `naming::{default_filename, sanitize_filename, output_path, MAX_FILENAME_BYTES}`, `settings::{SETTINGS_FILE, MAX_RECENT_VODS}`, `legacy::WARN_PLAINTEXT_COOKIES`.
- 코어 타입 중 `Resolved`·`Source`·`PdRep`는 `Serialize`가 아니다(서명 URL을 품는다). 셸이 DTO로 옮기고 URL은 보내지 않는다.
- `Error`는 crate 밖에서 `#[non_exhaustive]`라 변형 match에 `_` arm이 필요하다. `ErrorKind`는 exhaustive라 `kind()` 기준 match는 빠짐없이 강제된다.
- `is_own_content(meta, "")`는 `Some(false)`, 컨텐츠에 채널 ID가 없을 때만 `None`이다(core.md 구현 중 변경 19).

### Backend trait (가짜 코어 seam)

```rust
// crates/shell/src/backend.rs
pub trait Backend: Send + Sync + 'static {
    fn resolve(&self, c: &ContentRef)
        -> impl Future<Output = Result<Resolved, chzzk_core::Error>> + Send;
    fn download(&self, req: DownloadRequest, cancel: CancellationToken,
                on_progress: &(dyn Fn(Progress) + Send + Sync))
        -> impl Future<Output = Result<DownloadOutcome, chzzk_core::Error>> + Send;
}
impl Backend for Chzzk { /* 위임 */ }
```

- RPITIT에 `+ Send`를 명시한다. `Chzzk::download`·`resolve`의 future가 `Send`인 것은 2026-10-05 별도 crate에서 `assert_send`로 확인했고, `crates/shell`의 컴파일 테스트로 고정한다.
- `on_progress`는 `&dyn Fn`이므로 spawn한 async 블록 안에 `Arc` 클로저를 두고 빌려 넘긴다.
- `Resolved`·`Source`·`PdRep`·`Quality`·`ContentMeta`는 필드가 공개라 테스트에서 직접 만든다.

### 쿠키 토글은 클라이언트 교체

`Chzzk`는 만들 때 `ClientConfig.cookies`를 굳힌다. 셸은 `RwLock<Arc<Chzzk>>`를 들고 `use_naver_cookies` 변경·쿠키 저장·삭제 때 새로 만든다. 실행 중인 작업은 시작할 때 받은 `Arc`를 끝까지 쓴다. `ClientConfig { cookies: use_naver_cookies.then(|| creds.load().ok().flatten()).flatten(), progress_interval: 250ms, ..Default::default() }`.

### TLS provider (core.md 구현 중 변경 52의 이월)

1단계에서 tauri를 넣은 뒤 `cargo tree -i aws-lc-sys`·`cargo tree -i ring`을 본다. 기본은 현행 유지(aws-lc-rs, CI `AWS_LC_SYS_PREBUILT_NASM=1`). tauri가 이미 `ring`을 끌어오고 aws-lc가 빌드 시간을 크게 늘리면 `rustls-no-provider + ring`을 검토하고 결과를 core.md 구현 중 변경에 적는다.

---

## 4. Command / Event API

- Rust command 이름은 snake_case, JS 인자는 Tauri v2 기본대로 camelCase다.
- 모든 command는 `Result<T, AppError>`를 반환하고 I/O가 있는 것은 `async`다.
- `app/src/lib/api.ts`가 `invoke`를 부르는 유일한 파일이다. 아래 TS 시그니처가 그 파일의 공개 함수다.

| command | 인자 | 반환 | 메모 |
|---|---|---|---|
| `app_info` | - | `AppInfo` | 버전, 경로, 기본 폴더, `features`, 첫 실행 가져오기 후보(`legacyCandidate`) |
| `get_settings` | - | `SettingsDto` | `UserSettings` 미러 + `naverCookiesSaved` + `effectiveDownloadFolder`. 쿠키 값은 절대 보내지 않는다 |
| `update_settings` | `patch: SettingsPatch` | `SettingsDto` | `downloadFolder?`, `useNaverCookies?`, `segmentConcurrency?`(1~8로 자름). 쿠키 관련이 바뀌면 클라이언트 교체 |
| `set_naver_cookies` | `nidAut, nidSes` | `SettingsDto` | trim 후 둘 다 비어 있지 않아야 한다. 아니면 `invalidInput` |
| `clear_naver_cookies` | - | `SettingsDto` | `CredentialStore::clear` + `use_naver_cookies = false` + 교체 |
| `import_legacy` | `dir: string \| null` | `LegacyImportDto \| null` | `null`이면 `app_info`가 찾은 후보 폴더를 적용한다. `SettingsStore::update` + `CredentialStore::save` |
| `pick_folder` | `initial?: string` | `string \| null` | Rust `tauri_plugin_dialog`(`spawn_blocking` 안에서 `blocking_pick_folder`). JS에 dialog 권한을 주지 않는다 |
| `resolve` | `url: string` | `ResolvedDto` | `parse_content_url` → `client().resolve`. 서명 URL은 보내지 않는다 |
| `check_output` | `folder: string \| null, fileName: string, content: ContentRef, qualityId: string, expectedKind: PlaybackKind` | `OutputCheck` | 최종 경로 계산과 세 가지 판정(§6.4). 디바운스는 프런트(150ms) |
| `enqueue` | `req: EnqueueRequest` | `JobDto` | §6.2. 성공 시 `last_quality_label`·`last_url`·`add_recent_vod`를 `SettingsStore::update` 한 번으로 갱신 |
| `list_jobs` | - | `JobDto[]` | 재동기화 스냅샷 |
| `subscribe_jobs` | `onEvent: Channel<JobEvent>` | `JobDto[]` | 구독자를 교체하고 스냅샷을 반환. 앱 시작 때와 웹뷰 새로고침 때 |
| `pause_job` | `id` | `()` | `running` → `pausing` → `paused`. `.part` 유지 |
| `resume_job` | `id, restart: boolean` | `()` | `paused · failed · interrupted · skipped` → `queued`. `restart`면 첫 시작 전에 `discard_partial`. `skipped`에서 부르면 `onExisting = overwrite`로 바꿔 `queued` |
| `remove_job` | `id` | `()` | 종료 상태면 레코드만 지운다. `queued`면 지운다. `running · pausing`이면 취소 → 태스크 종료 대기 → `discard_partial` → 지운다(= UX의 "취소"). `paused · interrupted · failed`면 `discard_partial` 후 지운다 |
| `clear_finished` | - | `()` | `completed · skipped` 제거 |
| `open_output` | `id` | `()` | Rust opener `open_path`. 파일이 없으면 `fileMissing` |
| `reveal_output` | `id` | `()` | Rust opener `reveal_item_in_dir`. 파일이 없으면 폴더를 연다 |
| `quit` | - | `()` | D1 확인 뒤. 모든 `running`을 `pausing`으로, 최대 3초 대기, 저장, `app.exit(0)` |
| (Phase 3) `auth_status`, `auth_login`, `auth_cancel`, `auth_logout` | - | `AuthStatusDto` | §12. Phase 2에는 `auth_status`만 있고 늘 `{state: "disabled"}` |

**이벤트**: `subscribe_jobs`의 Channel로 `JobEvent`가 온다. 그 밖의 저빈도 알림은 `emit`이다: `close-requested`(Rust가 창 닫기를 막았을 때, payload `{running: number}`), `auth-changed`(Phase 3).

### Rust 시그니처 (`app/src-tauri/src/commands.rs`)

```rust
#[tauri::command] async fn app_info(state: State<'_, App>) -> Result<AppInfo, AppError>;
#[tauri::command] async fn get_settings(state: State<'_, App>) -> Result<SettingsDto, AppError>;
#[tauri::command] async fn update_settings(state: State<'_, App>, patch: SettingsPatch) -> Result<SettingsDto, AppError>;
#[tauri::command] async fn set_naver_cookies(state: State<'_, App>, nid_aut: String, nid_ses: String) -> Result<SettingsDto, AppError>;
#[tauri::command] async fn clear_naver_cookies(state: State<'_, App>) -> Result<SettingsDto, AppError>;
#[tauri::command] async fn import_legacy(state: State<'_, App>, dir: Option<String>) -> Result<Option<LegacyImportDto>, AppError>;
#[tauri::command] async fn pick_folder(app: AppHandle, initial: Option<String>) -> Result<Option<String>, AppError>;
#[tauri::command] async fn resolve(state: State<'_, App>, url: String) -> Result<ResolvedDto, AppError>;
#[tauri::command] async fn check_output(state: State<'_, App>, folder: Option<String>, file_name: String,
    content: ContentRef, quality_id: String, expected_kind: PlaybackKind) -> Result<OutputCheck, AppError>;
#[tauri::command] async fn enqueue(state: State<'_, App>, req: EnqueueRequest) -> Result<JobDto, AppError>;
#[tauri::command] async fn list_jobs(state: State<'_, App>) -> Result<Vec<JobDto>, AppError>;
#[tauri::command] async fn subscribe_jobs(state: State<'_, App>, on_event: Channel<JobEvent>) -> Result<Vec<JobDto>, AppError>;
#[tauri::command] async fn pause_job(state: State<'_, App>, id: JobId) -> Result<(), AppError>;
#[tauri::command] async fn resume_job(state: State<'_, App>, id: JobId, restart: bool) -> Result<(), AppError>;
#[tauri::command] async fn remove_job(state: State<'_, App>, id: JobId) -> Result<(), AppError>;
#[tauri::command] async fn clear_finished(state: State<'_, App>) -> Result<(), AppError>;
#[tauri::command] async fn open_output(app: AppHandle, state: State<'_, App>, id: JobId) -> Result<(), AppError>;
#[tauri::command] async fn reveal_output(app: AppHandle, state: State<'_, App>, id: JobId) -> Result<(), AppError>;
#[tauri::command] async fn quit(app: AppHandle, state: State<'_, App>) -> Result<(), AppError>;
#[tauri::command] async fn auth_status(state: State<'_, App>) -> Result<AuthStatusDto, AppError>;
```

`App`은 `{ manager: DownloadManager<Chzzk>, settings: SettingsService, paths: AppPaths, gate: OwnershipGate }`다. command 함수는 인자를 풀어 `chzzk_shell`을 부르는 한 줄짜리여야 한다. 로직은 `crates/shell`에 둔다.

### TS 시그니처 (`app/src/lib/api.ts`)

```ts
import { invoke, Channel } from '@tauri-apps/api/core';
import type { AppInfo, SettingsDto, SettingsPatch, LegacyImportDto, ResolvedDto, OutputCheck,
  EnqueueRequest, JobDto, JobEvent, JobId, ContentRef, PlaybackKind, AuthStatusDto, AppError } from './bindings';

export const appInfo = () => invoke<AppInfo>('app_info');
export const getSettings = () => invoke<SettingsDto>('get_settings');
export const updateSettings = (patch: SettingsPatch) => invoke<SettingsDto>('update_settings', { patch });
export const setNaverCookies = (nidAut: string, nidSes: string) => invoke<SettingsDto>('set_naver_cookies', { nidAut, nidSes });
export const clearNaverCookies = () => invoke<SettingsDto>('clear_naver_cookies');
export const importLegacy = (dir: string | null) => invoke<LegacyImportDto | null>('import_legacy', { dir });
export const pickFolder = (initial?: string) => invoke<string | null>('pick_folder', { initial: initial ?? null });
export const resolve = (url: string) => invoke<ResolvedDto>('resolve', { url });
export const checkOutput = (a: { folder: string | null; fileName: string; content: ContentRef; qualityId: string; expectedKind: PlaybackKind }) =>
  invoke<OutputCheck>('check_output', a);
export const enqueue = (req: EnqueueRequest) => invoke<JobDto>('enqueue', { req });
export const listJobs = () => invoke<JobDto[]>('list_jobs');
export const subscribeJobs = (onEvent: Channel<JobEvent>) => invoke<JobDto[]>('subscribe_jobs', { onEvent });
export const pauseJob = (id: JobId) => invoke<void>('pause_job', { id });
export const resumeJob = (id: JobId, restart = false) => invoke<void>('resume_job', { id, restart });
export const removeJob = (id: JobId) => invoke<void>('remove_job', { id });
export const clearFinished = () => invoke<void>('clear_finished');
export const openOutput = (id: JobId) => invoke<void>('open_output', { id });
export const revealOutput = (id: JobId) => invoke<void>('reveal_output', { id });
export const quit = () => invoke<void>('quit');
export const authStatus = () => invoke<AuthStatusDto>('auth_status');
export function isAppError(e: unknown): e is AppError;   // invoke가 던진 값을 좁힌다
```

---

## 5. DTO (`crates/shell/src/dto.rs`)

모두 `#[derive(Serialize, TS)] #[ts(export)] #[serde(rename_all = "camelCase")]`다. enum은 `rename_all_fields = "camelCase"`도 붙인다(core.md 구현 중 변경 7의 함정). `u64`는 `TS_RS_LARGE_INT=number`로 `number`가 된다(바이트·초·id 모두 2^53 미만 전제).

```rust
pub type JobId = u64;                      // jobs.json의 nextId로 단조 증가

pub struct AppInfo {
    pub version: String, pub core_version: String,
    pub config_dir: String, pub data_dir: String, pub log_dir: String,
    pub default_download_folder: String,
    pub features: Features,                // { auth: bool }  Phase 2: false
    pub legacy_candidate: Option<LegacyCandidate>,   // 첫 실행에 옛 설정을 찾았을 때 한 번 (D3)
}
pub struct LegacyCandidate { pub dir: String, pub recent_count: u32, pub has_cookies: bool }
pub struct LegacyImportDto { pub recent_count: u32, pub has_cookies: bool, pub warnings: Vec<String> }

pub struct SettingsDto {                   // UserSettings 미러. 쿠키 값 없음
    pub download_folder: Option<String>, pub effective_download_folder: String,
    pub use_naver_cookies: bool, pub naver_cookies_saved: bool,
    pub last_quality_label: Option<String>, pub last_url: Option<String>,
    pub recent_vods: Vec<RecentVodDto>,    // { url, title }
    pub segment_concurrency: u8, pub imported_from: Option<String>,
}
#[derive(Deserialize)] pub struct SettingsPatch {
    pub download_folder: Option<Option<String>>,   // Some(None) = 기본값으로
    pub use_naver_cookies: Option<bool>, pub segment_concurrency: Option<u8>,
}

pub struct ResolvedDto {
    pub url: String,                       // 정규화된 입력 주소
    pub content: ContentRef,               // 코어 타입 그대로 (#[ts(type = ...)]로 모양 고정)
    pub meta: ContentMetaDto,              // { kind: "video"|"clip", title, channelName, channelId?, liveOpenDate?, publishDate?, adult, durationSecs? }
    pub playback_kind: PlaybackKind,       // "progressive" | "liveRewindHls"
    pub qualities: Vec<QualityDto>,        // { id, label, resolution?, width?, height?, bandwidth?, frameRate? } 원래 순서
    pub default_quality_index: usize,      // Resolved::default_quality(last_quality_label)
    pub suggested_file_name: String,       // default_filename(meta, Platform::current())에서 ".mp4"를 뗀 것
    pub ownership: Ownership,              // "unchecked" | "own" | "notOwn" | "unknown"  (Phase 2: unchecked)
}

pub struct OutputCheck {
    pub file_name: String,                 // sanitize + 200바이트 절단 후 (확장자 제외)
    pub path: String,                      // 최종 경로
    pub truncated: bool,                   // 입력과 file_name이 다르면 true
    pub exists: bool,                      // 완성 파일이 있다
    pub free_file_name: Option<String>,    // exists일 때 "이름 (2)"처럼 비어 있는 이름
    pub partial: Option<PartialInfo>,      // .part가 있다. { bytes: u64, same_job: bool }
    pub duplicate_job_id: Option<JobId>,   // 같은 경로의 활성(queued·running·pausing·paused·interrupted) 작업
}

#[derive(Deserialize)] pub struct EnqueueRequest {
    pub url: String, pub content: ContentRef, pub title: String, pub channel_name: String,
    pub channel_id: Option<String>,        // Phase 3 소유 재검사용
    pub quality_id: String, pub quality_label: String, pub expected_kind: PlaybackKind,
    pub folder: Option<String>, pub file_name: String,
    pub on_existing: OnExisting,           // "overwrite" | "skip"  (UI는 overwrite만 보낸다)
    pub restart: bool,                     // true면 첫 시작 전에 discard_partial(output)
}

pub enum JobStatus { Queued, Running, Pausing, Paused, Interrupted, Completed, Skipped, Failed }

pub struct JobDto {
    pub id: JobId, pub url: String, pub title: String, pub channel_name: String,
    pub kind: ContentKind, pub playback_kind: PlaybackKind, pub quality_label: String,
    pub output: String, pub status: JobStatus,
    pub progress: Option<ProgressDto>,     // 마지막 진행률(running·pausing·paused에서 표시)
    pub error: Option<AppError>,           // failed
    pub partial_bytes: Option<u64>,        // 작업이 멈춘 뒤 .part를 실제로 확인한 값 (sidecar committed_len)
    pub final_bytes: Option<u64>,          // completed
    pub missing: bool,                     // completed인데 파일이 없다 (reconcile)
    pub created_at: u64, pub finished_at: Option<u64>,   // unix secs
}

pub struct ProgressDto {
    pub phase: Phase,                      // "resolving" | "downloading" | "reresolving" | "finalizing"
    pub bytes: u64, pub total_bytes: Option<u64>, pub total_bytes_estimate: Option<u64>,
    pub segments_done: Option<u32>, pub segments_total: Option<u32>,
    pub media_secs_done: Option<f64>, pub media_secs_total: Option<f64>,
    pub speed_bps: Option<u64>, pub eta_secs: Option<u64>,
    pub resumed_from: u64, pub refreshes: u32,
}

#[serde(tag = "type")]
pub enum JobEvent {                        // "added" | "status" | "progress" | "removed"
    Added { job: JobDto },
    Status { job: JobDto },                // 상태가 바뀔 때 전체 레코드
    Progress { id: JobId, progress: ProgressDto },
    Removed { id: JobId },
}

pub struct AuthStatusDto { pub state: AuthState, pub channel_id: Option<String>, pub channel_name: Option<String> }
pub enum AuthState { Disabled, SignedOut, Pending, SignedIn, Denied, Expired, Cancelled, Error }
```

- 코어 `Progress.segments`·`media_secs`(튜플)는 JSON 배열이 되므로 평평하게 편다.
- `ContentRef`·`PlaybackKind`·`Phase`·`ContentKind`는 코어 타입을 그대로 직렬화한다. ts-rs는 코어에 넣지 않으므로 `#[ts(type = "...")]`로 모양을 적고, `tests/dto_json.rs`의 스냅샷이 코어 직렬화와 일치하는지 검사한다.
- `JobEvent::Status`는 `JobDto` 전체를 보낸다. 프런트 `applyEvent`가 단순해지고, 복원·전이·오류·`partialBytes`를 한 모양으로 다룬다.

### 오류 DTO (`crates/shell/src/error.rs`)

```rust
pub struct AppError {
    pub code: ErrorCode,                   // UI 분기 키
    pub message: String,                   // 코어 Error의 Display (비밀 없음은 코어 불변식). 문제 보고용
    pub stage: Option<Stage>,              // "resolve" | "download"  (작업 오류에만)
    pub resumable: bool,                   // Error::is_resumable()
    pub payload: Option<ErrorPayload>,
}
pub enum ErrorCode {
    // chzzk_core::ErrorKind와 1:1 (exhaustive match)
    InvalidUrl, Api, Http, AuthRequired, NoPlayback, Encrypted, NoQualities, QualityNotFound,
    PlaybackChanged, SourceChanged, RefreshExhausted, Unsupported, Parse, LengthMismatch,
    Network, DiskFull, FileLocked, Io, Settings, Cancelled,
    // 셸 전용
    JobNotFound, DuplicateOutput, InvalidInput, FileMissing, NotLoggedIn, NotOwnContent, OwnershipUnknown, Internal,
}
#[serde(tag = "type")]
pub enum ErrorPayload {
    Api { code: i64, api_message: Option<String> },
    Http { status: u16, request_kind: RequestKind },     // "api" | "mpd" | "media"
    AuthRequired { status: u16 },
    NoPlayback { adult: bool },
    QualityNotFound { requested: String, available: Vec<String> },
    PlaybackChanged { was: PlaybackKind, now: PlaybackKind },
    Path { path: String },                               // DiskFull, FileLocked, Io
    DuplicateOutput { job_id: JobId },
}
```

- `code`는 `e.kind()`를 빠짐없이 match해서, `payload`는 `Error` 변형을 match(`_ => None`)해서 정한다.
- **`resumable`과 "`.part`가 남았다"는 다르다.** `resolve` 실패는 `is_resumable() == false`여도 `.part`를 남긴다(core.md 구현 중 변경 35). 그래서 매니저는 작업이 멈출 때마다 `part_path(output)`와 sidecar를 읽어 `partial_bytes`를 채우고, UI의 "이어받기" 버튼은 `partialBytes`로, "다시 시도" 버튼은 그 밖의 경우로 정한다.
- `Cancelled`는 오류로 표시하지 않는다. 매니저가 `paused`로 바꾸거나 제거한다. `AppError.code == cancelled`가 프런트에 오는 일은 없어야 하며, 오면 `Internal`로 취급한다.

---

## 6. DownloadManager와 작업 상태 머신

### 6.1 구조

```rust
pub struct DownloadManager<B: Backend> { inner: Arc<Inner<B>> }
struct Inner<B> {
    client: Arc<dyn Fn() -> Arc<B> + Send + Sync>,     // 작업 시작 시점의 클라이언트
    state: Mutex<State>,                               // jobs: BTreeMap<JobId, Job>, next_id, scheduler_enabled
    sink: Mutex<Option<Box<dyn EventSink>>>,
    store: JobStore,
    max_running: usize,                                // v1 상수 2
    spawner: Spawner,                                  // tokio::runtime::Handle
}
struct Job { rec: JobRecord, cancel: Option<CancellationToken>, handle: Option<JoinHandle<()>>,
             last_progress: Option<ProgressDto>, stop_reason: Option<StopReason /* Pause | Remove | Quit */> }
pub trait EventSink: Send + Sync { fn send(&self, e: JobEvent) -> bool; }
```

- **spawn**: `tokio::runtime::Handle`을 주입한다. 앱은 `tauri::async_runtime::handle().inner().clone()`으로 얻는다(1단계에서 확인. 안 되면 `tauri::async_runtime::spawn` 클로저를 넘기는 2안). 테스트는 `#[tokio::test(start_paused = true)]`의 `Handle::current()`.
- **큐**: `enqueue`는 `queued`로 넣고 `pump()`를 부른다. `pump()`는 `scheduler_enabled`이고 `running + pausing < max_running`인 동안 가장 오래된 `queued`를 `running`으로 바꿔 spawn한다. 작업이 끝나면 다시 `pump()`.
- **취소**: 작업마다 `CancellationToken`. `pause_job`·`remove_job`·`quit`은 `stop_reason`을 먼저 적고 토큰을 취소한다. 태스크가 `Err(Cancelled)`로 끝나면 `stop_reason`에 따라 `paused`(Pause·Quit) 또는 제거(Remove)다. `stop_reason`이 없는데 `Cancelled`가 오면 `failed{internal}`이다.
- **`remove_job`의 순서**: `JoinHandle`을 꺼내고 **state 뮤텍스를 놓은 뒤** 기다린 다음 `discard_partial`을 부른다. 끝나는 태스크가 같은 뮤텍스를 잡으므로 잡은 채 기다리면 교착이고, 먼저 `discard_partial`을 부르면 `.part` 잠금 때문에 `FileLocked`다.
- **진행률**: `on_progress`가 `ProgressDto`로 바꿔 `last_progress`에 저장하고 sink로 보낸다. 셸에 두 번째 스로틀은 없다.
- **순서**: `Status` 이벤트는 `download()`가 반환된 뒤 같은 태스크에서 보낸다. Channel이 순서를 보장하므로 마지막 `Progress`가 `Status`보다 먼저 도착한다. 테스트로 고정한다.
- **sink**: `ChannelSink`는 `Channel::send` 실패 시 `false`를 돌려주고 매니저는 구독자를 비운다. 전송 실패가 작업을 실패시키지 않는다. `subscribe_jobs`가 구독자를 교체하고 스냅샷을 돌려주므로 새로고침 뒤에도 동기화된다.
- **완료 처리**: `Completed{bytes}` → `completed` + `final_bytes` + `finished_at`. `Skipped` → `skipped`. `Err(e)` → `failed` + `AppError{stage}` + `partial_bytes`. 앱 어댑터는 `completed` 이벤트를 받으면 창에 포커스가 없을 때 `request_user_attention(Informational)`을 부른다.
- **중복 방지 세 겹**: (1) 같은 `output`의 활성 작업이 있으면 `duplicateOutput{jobId}`, (2) 다른 프로세스는 `single-instance`, (3) 코어의 `.part` `try_lock`(`FileLocked`).
- **종료(`quit`)**: `scheduler_enabled = false` → 모든 `running`을 `stop_reason = Quit`로 취소 → 최대 3초 동안 `Cancelled`를 기다린다(코어가 checkpoint를 쓴다) → `paused`로 저장(3초를 넘긴 것은 `interrupted`로 저장) → `app.exit(0)`. 비정상 종료라면 다음 시작 때 `interrupted`가 되고, 코어의 크래시 불변식(`committed_len`) 덕분에 이어받을 수 있다.

### 6.2 `enqueue`

1. `OwnershipGate::check(req)`(Phase 2는 항상 `Ok`).
2. `folder = req.folder.or(settings.download_folder).unwrap_or(default_download_folder)`.
3. `output = output_path(folder, sanitize_filename(req.file_name), Platform::current())`. **최종 경로를 계산해 저장한다.** 설정 폴더가 바뀌어도 이어받기가 같은 `.part`를 찾게 하기 위해서다.
4. 같은 `output`의 활성 작업이 있으면 `duplicateOutput`.
5. `JobRecord`를 `queued`로 넣고 저장 → `Added` 이벤트 → `pump()`.
6. `SettingsStore::update` 한 번으로 `last_quality_label = quality_label`, `add_recent_vod(url, title)`(이 함수가 `last_url`도 바꾼다).
7. `restart`면 태스크 시작 직후 `download()` 전에 `discard_partial(output)`.

### 6.3 상태와 전이

| 상태 | 영속 | 표시 | 비고 |
|---|---|---|---|
| `queued` | O | 대기 중 · 앞에 N개 | FIFO |
| `running` | X(→ `interrupted`) | `phase`에 따라: 준비 중 / 받는 중 / 영상 링크를 새로 받는 중 / 마무리 중 | |
| `pausing` | X(→ `interrupted`) | 멈추는 중… | 토큰 취소 후 `Cancelled` 대기 |
| `paused` | O | 일시정지됨 · N 받음 | `.part` 유지 |
| `interrupted` | O | 중단됨 · N 받음 | 앱이 꺼질 때 `running`·`pausing`·`queued`였던 항목 |
| `failed` | O | 오류 문구(§9) | `error`, `partial_bytes` |
| `completed` | O | 완료 · 크기 · 시각 | `missing`이면 "파일을 찾을 수 없어요" |
| `skipped` | O | 이미 같은 이름의 파일이 있어 받지 않았어요 | `DownloadOutcome::Skipped` |

```
                 enqueue
                   │
                   ▼
   ┌─────────── queued ◄──────────────────────────────────────────────┐
   │ REMOVE        │ pump() (슬롯 있음, scheduler_enabled)             │ RESUME(restart?)
   │               ▼                                                  │
   │           running ──PROGRESS──► running (phase 갱신)             │
   │           │  │  │                                                │
   │     PAUSE │  │  └── Ok(Completed) ──► completed                  │
   │     QUIT  │  ├──── Ok(Skipped) ────► skipped ───────────────────┤ (onExisting=overwrite로)
   │           ▼  │                                                   │
   │       pausing │ Err(e), e ≠ Cancelled                            │
   │          │    └──► failed { error, partialBytes } ───────────────┤
   │          │ Err(Cancelled)                                        │
   │          ▼                                                       │
   │       paused ───────────────────────────────────────────────────┤
   │                                                                  │
   └─► REMOVE: (running·pausing이면 취소→종료 대기) → discard_partial → (제거됨)
   앱 시작: 저장된 running·pausing·queued → interrupted ───────────────┘ (RESUME, 배너 "모두 이어받기")
```

규칙

- 일시정지와 제거(취소)는 서로 다른 사용자 동작이다. 코어는 둘 다 `Error::Cancelled`로 끝나므로 `stop_reason`으로 구분한다.
- 목록의 "취소"는 `remove_job`이다. 받은 바이트가 512 MiB를 넘으면 프런트가 D2로 확인한다. `queued`나 0바이트는 묻지 않는다.
- `RESUME`(`.part` 있음)·`RETRY`(`.part` 없음)는 둘 다 `resume_job(id, false)`다. 버튼 라벨만 다르다. `download()`가 안에서 다시 resolve하므로 셸이 따로 재조회하지 않는다.
- `qualityNotFound`·`playbackChanged`로 실패한 항목의 동작은 "다시 불러오기"다: 프런트가 그 URL을 입력줄에 넣고 `resolve`해 카드를 띄운다. 사용자가 화질을 골라 `enqueue`하면 새 작업이 되고, 옛 항목은 "목록에서 지우기"로 지운다. 옛 `.part`는 코어가 sidecar 불일치로 지운다(카드의 충돌 안내가 `sameJob = false`를 보여 "처음부터 받아요"로 안내).
- 재시작 후 자동으로 이어받지 않는다. `interrupted`는 배너 `[모두 이어받기]`(프런트가 `resume_job`을 반복 호출)로 시작한다. 배너를 누르기 전에도 새로 `enqueue`한 작업은 돈다(`scheduler_enabled`는 `quit` 때만 false).
- `completed`·`skipped`는 최근 100개만 남긴다(오래된 것부터 지운다). `clear_finished`가 둘을 지운다.

### 6.4 `check_output`과 중복 처리

`check_output(folder, file_name, content, quality_id, expected_kind)`:

1. `file_name = sanitize_filename(file_name, Platform::current())`, `path = output_path(folder_or_default, file_name, platform)`. 결과 이름이 입력과 다르면 `truncated = true`.
2. `exists = path.exists()`. `exists`면 `free_file_name`을 `"{name} (2)"`, `(3)`…으로 완성 파일·`.part`·활성 작업 어디에도 없는 첫 이름으로 채운다. 접미사까지 `output_path`를 다시 거쳐 200바이트 안에 둔다.
3. `.part`가 있으면 `partial = { bytes: sidecar.committed_len (sidecar가 없거나 깨졌으면 .part 길이), same_job: sidecar.same_job(content, quality_id, kind) }`. sidecar는 잠그지 않고 읽기만 한다(`atomic_write`로 쓰이므로 반쯤 쓴 파일은 없다).
4. 같은 `path`의 활성 작업이 있으면 `duplicate_job_id`.

UI는 결과로 **서로 독립인 세 안내**를 한다(§8.3 ConflictNotice).

| 상황 | 안내 | `enqueue`에 넘기는 값 |
|---|---|---|
| `exists` | "같은 이름의 파일이 이미 있어요" (●) 번호 붙여 새로 저장 ( ) 덮어쓰기 | 번호: `file_name = free_file_name`. 덮어쓰기: 그대로. 둘 다 `on_existing = overwrite` |
| `partial.same_job` | "이전에 받다 만 파일이 있어요 (1.2 GB). 이어서 받아요" [처음부터 받기] | 이어받기: `restart = false`. 처음부터: `restart = true` |
| `partial && !same_job` | "다른 화질로 받다 만 파일이 있어요. 처음부터 받아요" (안내만) | `restart = false`(코어가 지우고 새로 시작) |
| `duplicate_job_id` | "이 파일은 이미 다운로드 목록에 있어요" [목록에서 보기]. 다운로드 버튼 비활성 | - |

`.part`만 있고 완성 파일이 없으면 중복이 아니라 이어받기 후보다. 코어 `DuplicatePolicy::Skip`은 UI에서 쓰지 않는다(받지 않을 거면 추가하지 않는다).

---

## 7. 영속화

### 7.1 `jobs.json` (`crates/shell/src/jobs.rs`)

위치 `{app_data_dir}/jobs.json`. `fsutil::atomic_write`로 **상태가 바뀔 때만** 쓴다. 깨졌으면 `jobs.json.bad-{ts}`로 옮기고 빈 목록으로 시작한다.

```json
{ "v": 1, "nextId": 42,
  "jobs": [ { "id": 41, "url": "https://chzzk.naver.com/video/123",
    "content": {"kind":"video","videoNo":123}, "title": "...", "channelName": "...",
    "channelId": "000…a1", "kind": "video", "qualityId": "PD_720P_1280_2048_192", "qualityLabel": "720p",
    "expectedKind": "progressive", "output": "/…/[251005] 채널 - 제목.mp4",
    "onExisting": "overwrite", "concurrency": 4, "status": "paused",
    "createdAt": 1759650000, "finishedAt": null, "finalBytes": null,
    "lastError": null } ] }
```

- `DownloadRequest`·`DuplicatePolicy`·`NonZeroU8`는 serde 타입이 아니므로 `JobRecord`가 같은 내용을 미러로 들고 `to_request()`로 요청을 만든다. **이어받기 동일성 키**(`content`, `qualityId`, `expectedKind`, `output`)는 `.part`가 생긴 뒤 바꾸지 않는다.
- `concurrency`는 추가 당시의 `segment_concurrency`다. 설정을 바꿔도 진행 중·대기 중 작업에는 적용되지 않는다.
- `channelId`는 Phase 3 소유 재검사용이다.

**시작 때 reconcile** (한 번):

| 저장된 상태 | 파일 상태 | 복원 상태 |
|---|---|---|
| `running`, `pausing`, `queued` | - | `interrupted`. 자동 재개하지 않는다 |
| `paused`, `interrupted`, `failed` | `.part`와 sidecar가 있고 `same_job` | 상태 유지, `partial_bytes = committed_len` |
| 〃 | `.part`는 있는데 sidecar가 없거나 다른 작업 | `partial_bytes = None`. 재개하면 코어가 새로 시작 |
| 〃 | `.part` 없음 | `partial_bytes = None` (버튼이 "다시 시도") |
| `completed` | 최종 파일 없음 | `completed` + `missing = true` |

목록에 없는 고아 `.part`는 찾지 않는다.

### 7.2 설정과 자격증명

- `setup()`에서 `AppPaths { config: app_config_dir(), data: app_data_dir(), log: app_log_dir(), default_download }`를 만든다. `default_download`는 `video_dir()/치지직` → 실패하면 `download_dir()/치지직` → 그것도 실패하면 `{data}/downloads`. 폴더는 첫 다운로드 때 코어가 만든다.
- `SettingsStore::open(config)`, `CredentialStore::new(config)`. 셸은 코어 `UserSettings`에 필드를 더하지 않는다(§0).
- **첫 실행 가져오기**: `SettingsStore::open` 전에 `settings.json`이 있었는지 기록한다. 없었고 `imported_from`도 `None`이면 `import_legacy(current_exe().parent())`를 한 번 시도해 결과를 **적용하지 않고** `AppInfo.legacy_candidate`로 보낸다. 프런트가 D3로 확인하면 `import_legacy(null)`이 적용한다. 쿠키가 포함되므로 자동 적용하지 않는다. 설치형 번들에서는 이 경로가 사실상 맞지 않고 Windows 포터블 사용에만 해당하므로 주 경로는 설정 화면의 폴더 선택이다.
- `warnings`(평문 쿠키 경고 등)는 토스트가 아니라 설정 화면의 InlineAlert로 남긴다. 사용자가 행동해야 하는 내용이라 사라지면 안 된다. `imported_from`이 기록되면 첫 실행 검사를 다시 하지 않는다.

### 7.3 로그

`tracing-subscriber`(`fmt`, `env-filter`) + `tracing-appender::rolling::Builder`(daily, `max_log_files(7)`)로 `{app_log_dir}`에 쓴다. 개발 빌드는 stdout에도. 기본 필터 `info,chzzk_shell=debug,chzzk_core=debug`, `RUST_LOG`로 덮어쓴다. 패닉 훅에서 `tracing::error!`.

비밀 규칙: 쿠키·세션 토큰·`sid`는 코어 `Secret<String>`으로 감싸고, 이런 값을 담는 셸 타입은 `Debug`를 직접 구현한다. URL은 `redact_url`을 거쳐서만 로그에 쓴다. `AppError.message`는 코어 Display만 쓴다. 비밀 누출 테스트(§14)가 로그와 모든 `JobEvent` JSON을 검사한다.

---

## 8. 화면

창 기본 960x700, 최소 720x520. 아래 그림은 약 720 폭이다. 아이콘은 `[설정]`처럼 표시했다(실제로는 아이콘에 `aria-label`).

| ID | 화면·영역 | 뷰 | Phase |
|---|---|---|---|
| S1 | 홈: 입력 영역(URL 입력줄, 최근 VOD)과 다운로드 목록 | `home` | 2 |
| S1-a/b/c/d | 홈의 불러오는 중 / 영상 카드 / 불러오기 실패 / 빈 목록 | `home` 상태 | 2 |
| S2 | 설정(저장, 다운로드, 네이버 로그인 정보(고급), 이전 버전, 정보) | `settings` | 2 |
| S2-a | 계정 섹션 | `settings` | 3 |
| S3 | 로그인 | `login` | 3(Phase 2에는 뷰만 있고 들어갈 수 없다) |
| D1 | 창 닫기 확인 | 모달 | 2 |
| D2 | 취소 확인(받은 부분 삭제, 512 MiB 초과일 때) | 모달 | 2 |
| D3 | 첫 실행에 이전 설정을 찾음 | 모달 | 2 |
| B1 | 배너: 중단된 다운로드 N개 | 상단 | 2 |
| B2 | 배너: 설정 저장 실패(`settings`) | 상단 | 2 |
| B3 | 배너: 로그인 만료 | 상단 | 3 |
| T | 토스트: 완료, 복사됨, 가져오기 결과, 파일 없음 | 오버레이 | 2 |

### 8.1 S1 홈, 빈 상태

```
┌────────────────────────────────────────────────────────────────────────┐
│ 치지직 다운로더                                    {AccountSlot} [설정] │  ← AppHeader (48px)
├────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────┐ ┌───────┐ │
│ │ 치지직 VOD나 클립 주소를 붙여넣으세요                     │ │불러오기│ │  ← UrlBar
│ └──────────────────────────────────────────────────────────┘ └───────┘ │
│                                                                        │
│  최근 VOD                                                              │  ← RecentList (카드가 없을 때만)
│   [251003] 금요 노가리 방송 - 신작 게임 해보기               [다시 열기] │
│   역대급 반응 모음                                           [다시 열기] │
│   ...(최대 5개)                                                        │
├────────────────────────────────────────────────────────────────────────┤
│ 다운로드                                                [완료 항목 지우기]│  ← 비활성
│                                                                        │
│                     아직 받은 영상이 없어요                             │
│              위에 치지직 영상 주소를 붙여넣으세요                        │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

최근 VOD가 없으면 그 자리에 `예: https://chzzk.naver.com/video/1234567` 한 줄을 둔다. 최근 VOD는 `{url, title}`만 있으므로 날짜·종류를 표시하지 않는다.

### 8.2 S1-a 불러오는 중

```
│ ┌──────────────────────────────────────────────────────────┐ ┌───────┐ │
│ │ https://chzzk.naver.com/video/1234567                    │ │ [....] │ │  ← 버튼 자리에 스피너, 입력 잠금
│ └──────────────────────────────────────────────────────────┘ └───────┘ │
│ ┌──────────────────────────────────────────────────────────────────┐   │
│ │ ▒▒▒▒▒▒▒▒                                                         │   │
│ │ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒                                    │   │  ← 스켈레톤 (aria-busy)
│ │ 영상 정보를 불러오는 중이에요…                        [취소 (Esc)] │   │
│ └──────────────────────────────────────────────────────────────────┘   │
```

취소는 프런트가 세대 번호(`generation`)를 올려 늦게 온 결과를 버리는 것이다. Rust 요청은 코어 타임아웃(연결 10초, idle 30초)까지 혼자 끝난다.

### 8.3 S1-b 영상 카드

```
│ ┌ 불러온 영상 ───────────────────────────────────────────── [닫기] ┐   │
│ │ [빠른 다시보기] [19]                                              │   │  ← KindBadge, AdultBadge
│ │ 금요 노가리 방송 - 신작 게임 해보기                                │   │  ← 제목 (2줄, 넘치면 말줄임 + title)
│ │ 채널이름  ·  2026.10.03 21:00 방송  ·  3:12:45                    │   │
│ │                                                                   │   │
│ │ 화질                                                              │   │
│ │  (●) 1080p   60fps   약 7.8 GB                                    │   │  ← 기본: defaultQualityIndex
│ │  ( ) 720p    60fps   약 4.1 GB                                    │   │
│ │  ( ) 480p    30fps   약 1.6 GB                                    │   │
│ │                                                                   │   │
│ │ 저장 폴더   ~/Movies/치지직                               [변경]  │   │
│ │ 파일 이름  ┌──────────────────────────────────────────┐ .mp4      │   │
│ │            │[251003] 채널이름 - 금요 노가리 방송 - 신…│ [되돌리기]│   │
│ │            └──────────────────────────────────────────┘           │   │
│ │  (있을 때만) ConflictNotice                                        │   │
│ │  (Phase 3, 본인 영상이 아닐 때만) OwnershipNotice                   │   │
│ │                                                                   │   │
│ │                                     [취소]  [ 다운로드  Ctrl+Enter ]│   │
│ └───────────────────────────────────────────────────────────────────┘   │
```

- 종류 라벨: `Clip` → **클립**, `Video + LiveRewindHls` → **빠른 다시보기**, `Video + Progressive` → **일반 VOD**.
- 날짜: `liveOpenDate`가 있으면 `YYYY.MM.DD HH:MM 방송`, 없으면 `publishDate`를 `YYYY.MM.DD 업로드`, 둘 다 없으면 생략. 재생 시간은 `durationSecs`를 `H:MM:SS`로, 없으면 생략.
- 예상 크기는 `bandwidth × durationSecs / 8`에 "약"을 붙인다. 둘 중 하나라도 없으면 비운다.
- 폴더를 카드에서 바꾸면 `update_settings({downloadFolder})`도 부른다("마지막 화질"과 같은 기억 방식).
- 파일 이름 편집마다 150ms 디바운스로 `check_output`을 부른다. `truncated`면 입력 아래 `저장될 이름: …`을 회색으로 보여 준다. 확장자 `.mp4`는 입력칸 밖 라벨이다. `[되돌리기]`는 `suggestedFileName`으로.
- ConflictNotice 세 형태(§6.4). 폭이 720이면 메타 줄이 두 줄로 접힌다.

### 8.4 S1-c 불러오기 실패

```
│ ┌──────────────────────────────────────────────────────────┐ ┌───────┐ │
│ │ https://chzzk.naver.com/live/abcd                        │ │불러오기│ │  ← 입력은 지우지 않는다. aria-invalid
│ └──────────────────────────────────────────────────────────┘ └───────┘ │
│ ┌──────────────────────────────────────────────────────────────────┐   │
│ │ [!] 치지직 VOD나 클립 주소가 아니에요                              │   │  ← role="alert"
│ │     영상 주소는 chzzk.naver.com/video/… 또는 /clips/… 형태예요    │   │
│ │                                                [다시 시도]        │   │
│ └──────────────────────────────────────────────────────────────────┘   │
```

### 8.5 다운로드 목록 항목 (JobItem)

```
진행 중 (일반 VOD, progressive)
│ [일반 VOD] 금요 노가리 방송 - 신작 게임 해보기                    1080p  │
│ ███████████████████░░░░░░░░░░░░░░░  58%                                 │
│ 받는 중 · 2.3 GB / 4.0 GB · 12.4 MB/s · 2분 18초 남음  [일시정지][취소][…]│

진행 중 (빠른 다시보기, HLS)
│ [빠른 다시보기] 새벽 방송                                          720p  │
│ ████████░░░░░░░░░░░░░░░░░░░░░░░░░░  23%                                 │
│ 받는 중 · 1.2 GB / 약 5.1 GB · 조각 1,210/5,580 · 8.1 MB/s · 14분 남음   │
│                                                    [일시정지][취소][…]   │

링크 갱신 (phase = reresolving)
│ ████████░░░░░░░░ (막대가 줄무늬)  23%                                   │
│ 영상 링크를 새로 받는 중이에요 · 1.2 GB / 약 5.1 GB                      │

대기
│ [클립] 역대급 반응 모음                                             720p │
│ 대기 중 · 앞에 2개                                       [취소][…]       │

일시정지 / 중단
│ ██████████░░░░░░░░░░░  41% (회색)                                       │
│ 일시정지됨 · 1.6 GB 받음                                 [이어받기][취소][…]│

실패 (partialBytes 있음)
│ ██████████░░░░░░░░░░░  41% (빨강 테두리)                                │
│ [!] 저장 공간이 부족해요. 공간을 비운 뒤 이어받으세요.                    │
│                                         [이어받기][폴더 열기][…]         │

실패 (partialBytes 없음)
│ [!] 원본 영상이 바뀌어 이어받을 수 없어요.        [처음부터 다시][…]     │

완료
│ [일반 VOD] 금요 노가리 방송 - 신작 게임 해보기                    1080p  │
│ 완료 · 4.0 GB · 오후 9:41                       [파일 열기][폴더 열기][…]│

건너뜀
│ 이미 같은 이름의 파일이 있어 받지 않았어요      [파일 열기][덮어쓰고 받기][…]│
```

`[…]` 메뉴: 주소 복사(항상), 처음부터 다시 받기(`partialBytes`가 있을 때, `resume_job(id, true)`), 문제 보고용 정보 복사(`failed`), 목록에서 지우기(종료 상태). 정렬은 진행 중 → 대기 → 일시정지·중단·실패 → 완료·건너뜀 순, 같은 그룹 안에서는 최신이 위. 그룹 헤더(`받는 중 2`, `완료 5`)를 붙인다.

### 8.6 B1 재시작 직후 배너

```
├────────────────────────────────────────────────────────────────────────┤
│ 지난번에 받다가 멈춘 다운로드가 3개 있어요.       [모두 이어받기] [닫기] │
├────────────────────────────────────────────────────────────────────────┤
```

### 8.7 S2 설정

```
┌────────────────────────────────────────────────────────────────────────┐
│ [뒤로]  설정                                                           │
├────────────────────────────────────────────────────────────────────────┤
│ 저장                                                                   │
│   기본 저장 폴더    ~/Movies/치지직                   [변경] [폴더 열기] │
│                                                                        │
│ 다운로드                                                               │
│   빠른 다시보기 연결 수         [ 4 v ]  (1~8)                          │
│     빠른 다시보기는 영상을 작은 조각으로 나눠 받아요. 숫자가 클수록       │
│     빠르지만 네트워크를 더 많이 써요.                                   │
│                                                                        │
│ (Phase 3) 계정                                                         │
│   치지직 채널: 채널이름                               [로그아웃]         │
│                                                                        │
│ 고급: 네이버 로그인 정보                                       [펼치기] │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │ 연령 제한이나 구독자 전용 영상은 네이버에 로그인한 상태여야      │    │
│   │ 받을 수 있어요. 브라우저의 네이버 로그인 쿠키 두 개를 넣으면     │    │
│   │ 이 컴퓨터에만 저장되고 치지직 영상 정보를 조회할 때만 쓰여요.    │    │
│   │ 이 값은 비밀번호와 같아요. 다른 사람에게 보여 주지 마세요.       │    │
│   └──────────────────────────────────────────────────────────────┘    │
│   로그인 정보 사용          [꺼짐]   (저장된 값이 없으면 켤 수 없다)     │
│   NID_AUT   [                    ]  [보기]                             │
│   NID_SES   [                    ]  [보기]                             │
│   [저장] [지우기]   저장됨 / 저장된 값 없음   > 값을 찾는 방법            │
│                                                                        │
│ 이전 버전                                                              │
│   예전 치지직 다운로더(명령줄 버전)의 설정과 최근 VOD를 가져와요.         │
│   [폴더 선택해서 가져오기]     마지막 가져오기: D:\tools\chzzk           │
│   (가져온 뒤) [!] 옛 파일에 평문 쿠키가 남아 있습니다 …                  │
│                                                                        │
│ 정보                                                                   │
│   버전 0.1.0 (코어 0.1.0)                                              │
│   설정 폴더 열기   로그 폴더 열기   문제 보고용 정보 복사                 │
└────────────────────────────────────────────────────────────────────────┘
```

즉시 저장 방식이다. 쿠키만 `[저장]` 버튼을 둔다. 쿠키 값은 프런트로 다시 보내지 않으며 "저장됨" 여부만 보여 준다. 저장 실패(`settings`)는 B2 배너다.

### 8.8 D1 창 닫기 확인

```
┌ 다운로드를 멈추고 닫을까요? ─────────────────────────────┐
│ 받는 중인 영상이 2개 있어요. 닫으면 일시정지되고,         │
│ 다음에 앱을 열면 이어받을 수 있어요.                      │
│                                     [계속 받기] [닫기]    │
└──────────────────────────────────────────────────────────┘
```

기본 포커스는 `[계속 받기]`. Rust가 `CloseRequested`를 막고 `close-requested`를 emit하면 프런트가 띄운다. 받는 중인 작업이 없으면 Rust가 막지 않고 바로 닫힌다. `[닫기]`는 `quit()`.

### 8.9 S3 로그인 (Phase 3)

```
idle                                         pending (폴링 중, 약 5분)
┌──────────────────────────────────┐        ┌──────────────────────────────────┐
│       치지직 다운로더            │        │   브라우저에서 로그인해 주세요     │
│  허가된 채널만 사용할 수 있어요.   │        │   로그인을 마치면 자동으로        │
│  치지직 계정으로 로그인하세요.     │        │   넘어가요.  남은 시간 4:12       │
│   [ 치지직으로 로그인 ]           │        │  [브라우저 다시 열기]  [취소]     │
└──────────────────────────────────┘        └──────────────────────────────────┘
denied                                       expired / cancelled / error
│ [!] 사용 허가가 없는 채널이에요   │        │ [!] 로그인 시간이 지났어요        │
│     채널: 채널이름               │        │   [다시 로그인]                   │
│   [다른 계정으로 로그인]          │        │                                  │
```

### 8.10 흐름 규칙

- 입력 경로는 직접 입력, 붙여넣기(입력줄 밖에서 Mod+V도 받는다), 최근 VOD `[다시 열기]` 셋이다. 붙여넣기와 `[다시 열기]`는 곧바로 불러온다. 직접 입력은 Enter나 `[불러오기]`.
- 불러오기가 끝나면 카드 제목(`tabindex=-1`)으로 포커스를 옮긴다. `[다운로드]`를 누르면 카드를 접고 입력줄을 비운 뒤 포커스를 입력줄로 되돌리고, 새 항목을 목록 맨 위에 넣어 1초 강조한다.
- `completed` 항목의 `[파일 열기]`가 `fileMissing`이면 토스트 "파일을 찾을 수 없어요. 옮기거나 지웠을 수 있어요"를 띄운다.

### 8.11 진행률 표시 규칙

| 값 | progressive(일반 VOD·클립) | HLS(빠른 다시보기) |
|---|---|---|
| 퍼센트 | `bytes / totalBytes` | `mediaSecsDone / mediaSecsTotal`. 세그먼트 비율은 쓰지 않는다(ETA와 맞춘다) |
| 크기 | `2.3 GB / 4.0 GB` | `1.2 GB / 약 5.1 GB`(`totalBytesEstimate`) |
| 보조 | 없음 | `조각 1,210/5,580`. 폭 720이면 숨긴다 |
| 속도 | `speedBps`가 있으면 `12.4 MB/s` | 같음 |
| ETA | `etaSecs`가 있으면 `2분 18초 남음`, 없으면 `남은 시간 계산 중` | 같음 |
| 이어받음 | `resumedFrom > 0`이면 크기 옆 `(1.1 GB부터 이어받음)`, 첫 10초만 | 같음 |
| 링크 갱신 | - | `phase == reresolving`이면 `영상 링크를 새로 받는 중이에요`. 오류가 아니다. `refreshes`는 툴팁 |
| 총량 모름 | 막대 indeterminate, 퍼센트 숨김 | 같음 |

숫자는 `font-variant-numeric: tabular-nums`. 크기는 코어 `format_bytes`(1024 단위, 소수 한 자리)를 TS로 그대로 옮기고 같은 golden 12건으로 검사한다. 시간은 `1시간 2분`, `2분 18초`, `45초`.

---

## 9. 오류 문구와 복구 동작 (copy deck)

문체는 해요체. **제목**은 무엇이 일어났는지 한 줄, **설명**은 왜 또는 무엇을 하면 되는지. 버튼은 동사로 끝낸다. 위치는 R(불러오기 InlineAlert)과 D(목록 항목). `download()`가 안에서 다시 resolve하므로 resolve 계열 오류가 D에도 나온다. `errorCopy(err, ctx)`가 이 표를 조합한다(`ctx = { place: 'resolve' | 'job', partialBytes?, cookiesEnabled }`).

| code | 위치 | 제목 / 설명 | 동작 |
|---|---|---|---|
| `invalidUrl` | R | 치지직 VOD나 클립 주소가 아니에요 / 영상 주소는 `chzzk.naver.com/video/…` 또는 `…/clips/…` 형태예요. 라이브 주소는 받을 수 없어요. | 입력 선택, 다시 시도 |
| `api` | R·D | 치지직이 요청을 거절했어요 / `apiMessage`가 있으면 그대로. 없으면 "잠시 뒤 다시 시도해 주세요. (코드 {code})" | 다시 시도 / 이어받기 |
| `http` 404·410 | R·D | 영상을 찾을 수 없어요 / 삭제됐거나 비공개로 바뀌었을 수 있어요. | R: 닫기. D: 목록에서 지우기 |
| `http` 429 | R·D | 요청이 너무 많아요 / 1분쯤 뒤에 다시 시도해 주세요. | 다시 시도 / 이어받기 |
| `http` 그 밖 | R·D | 치지직 서버에 문제가 있어요 (HTTP {status}) / 잠시 뒤 다시 시도해 주세요. | 다시 시도 / 이어받기 |
| `authRequired` (stage resolve, 쿠키 꺼짐) | R·D | 네이버 로그인이 필요한 영상이에요 / 연령 제한이나 구독자 전용 영상이에요. 설정에서 네이버 로그인 정보를 넣으면 받을 수 있어요. | `[네이버 로그인 정보 설정]`(설정의 고급 섹션을 펼쳐 연다), 다시 시도 |
| `authRequired` (stage resolve, 쿠키 켜짐) | R·D | 네이버 로그인 정보가 만료됐어요 / 브라우저에서 네이버에 다시 로그인한 뒤 새 값을 넣어 주세요. | `[로그인 정보 다시 넣기]`, 이어받기(`.part` 유지) |
| `authRequired` (stage download) | D | 영상 서버가 접근을 막았어요 / 링크를 새로 받아도 계속 거절돼요. 받던 부분은 지워졌어요. | 처음부터 다시 |
| `noPlayback` adult | R·D | 성인 인증이 필요한 영상이에요 / 네이버 로그인 정보가 있어야 받을 수 있어요. (쿠키 켜짐: 성인 인증한 계정의 로그인 정보인지 확인해 주세요.) | `[네이버 로그인 정보 설정]`, 다시 시도 |
| `noPlayback` | R·D | 아직 받을 수 없는 영상이에요 / 방송 직후라 처리 중이거나 다시보기가 꺼져 있을 수 있어요. | 다시 시도 |
| `encrypted` | R·D | 보호된 영상이라 받을 수 없어요 / 중계권 등의 이유로 암호화된 영상은 지원하지 않아요. | 닫기 / 목록에서 지우기. **우회 방법이나 쿠키 안내를 넣지 않는다** |
| `noQualities` | R | 받을 수 있는 화질이 없어요 / 영상 처리가 끝나지 않았을 수 있어요. 잠시 뒤 다시 시도해 주세요. | 다시 시도 |
| `qualityNotFound` | D | 고른 화질({requested})이 더 이상 없어요 / 다시 불러와서 다른 화질을 골라 주세요. 받던 부분은 지우고 새로 받아요. | `[다시 불러오기]`, 목록에서 지우기 |
| `playbackChanged` | D | 영상 형식이 바뀌었어요 / 치지직이 영상을 다시 처리했어요. 다시 불러와서 화질을 골라 처음부터 받아야 해요. | `[다시 불러오기]`, 목록에서 지우기 |
| `sourceChanged` | D | 원본 영상이 바뀌어 이어받을 수 없어요 / 받던 부분은 지웠어요. 처음부터 다시 받아 주세요. | 처음부터 다시 |
| `refreshExhausted` | D | 영상 링크가 계속 만료돼요 / 링크를 여러 번 새로 받았지만 받기를 이어 가지 못했어요. 받은 부분은 남아 있어요. | 이어받기 |
| `unsupported` | R·D | 아직 지원하지 않는 영상 형식이에요 / 문제 보고용 정보를 복사해 개발자에게 보내 주세요. | `[문제 보고용 정보 복사]`, 목록에서 지우기 |
| `parse` | R·D | 치지직 응답을 읽지 못했어요 / 치지직이 바뀌었을 수 있어요. 잠시 뒤 다시 시도하고, 계속되면 앱을 업데이트해 주세요. | 다시 시도 / 이어받기, 문제 보고용 정보 복사 |
| `lengthMismatch` | D | 받은 파일이 손상됐어요 / 받은 크기가 예상과 달라 받던 부분을 지웠어요. 처음부터 다시 받아 주세요. | 처음부터 다시 |
| `network` | R·D | 인터넷 연결이 불안정해요 / 연결을 확인한 뒤 다시 시도해 주세요. (D에 `.part`가 있으면: 받은 부분은 남아 있어요.) | 다시 시도 / 이어받기 |
| `diskFull` | D | 저장 공간이 부족해요 / `{path}`가 있는 디스크의 공간을 비운 뒤 이어받으세요. | 이어받기, 폴더 열기 |
| `fileLocked` | D | 다른 프로그램이 파일을 쓰고 있어요 / 이 파일을 연 플레이어나 백신 검사가 끝난 뒤 다시 시도해 주세요. `{path}` | 이어받기, 폴더 열기 |
| `io` | D(드물게 R) | 파일을 저장하지 못했어요 / 폴더에 쓸 권한이 있는지 확인해 주세요. `{path}` | 다시 시도 / 이어받기, 폴더 열기 |
| `settings` | B2 | 설정을 저장하지 못했어요 / 설정 폴더에 쓸 수 없어요. 디스크 공간과 권한을 확인해 주세요. | `[설정 폴더 열기]`, `[다시 시도]` |
| `duplicateOutput` | R(카드) | 이 파일은 이미 다운로드 목록에 있어요 | `[목록에서 보기]` |
| `fileMissing` | T | 파일을 찾을 수 없어요. 옮기거나 지웠을 수 있어요 | 폴더 열기 |
| `invalidInput` | 인라인 | (쿠키) 두 값을 모두 넣어 주세요 | - |
| `jobNotFound`·`internal` | T | 문제가 생겼어요. 앱을 다시 시작해 주세요. ({message}) | 문제 보고용 정보 복사 |
| `cancelled` | - | 표시하지 않는다 | - |
| `notLoggedIn`·`notOwnContent`·`ownershipUnknown` (Phase 3) | R(카드) | 내 채널의 영상만 받을 수 있어요 / 이 영상은 '{channelName}' 채널의 영상이에요. 로그인한 채널: '{myChannel}' · 영상의 채널을 확인하지 못해 받을 수 없어요 | 다운로드 비활성, 닫기 / 다시 불러오기 |

`[문제 보고용 정보 복사]`는 `{앱 버전, OS, code, status?, message, stage, 시각}`을 클립보드에 넣는다(`navigator.clipboard.writeText`, 사용자 제스처 안). 경로에 사용자 이름이 들어갈 수 있으므로 복사 직전 토스트 "복사한 정보에 파일 경로가 들어 있어요"를 띄운다.

### 그 밖의 문구 (`app/src/lib/copy/ko.ts`)

| 키 | 문구 |
|---|---|
| `app.title` / `header.settings` | 치지직 다운로더 / 설정 |
| `url.placeholder` / `url.submit` / `url.hintExample` | 치지직 VOD나 클립 주소를 붙여넣으세요 / 불러오기 / 예: https://chzzk.naver.com/video/1234567 |
| `recent.title` / `recent.reopen` | 최근 VOD / 다시 열기 |
| `resolve.loading` / `resolve.cancel` | 영상 정보를 불러오는 중이에요… / 취소 |
| `card.title` / `card.close` / `card.download` | 불러온 영상 / 닫기 / 다운로드 |
| `kind.liveRewind` / `kind.vod` / `kind.clip` | 빠른 다시보기 / 일반 VOD / 클립 |
| `kind.liveRewind.tip` | 방송이 끝난 뒤 바로 볼 수 있는 다시보기예요. 조각으로 나눠 받아요. |
| `badge.adult` | 19 (aria-label: 연령 제한) |
| `meta.liveDate` / `meta.publishDate` | {date} 방송 / {date} 업로드 |
| `quality.title` / `quality.sizeEstimate` | 화질 / 약 {size} |
| `folder.label` / `folder.change` | 저장 폴더 / 변경 |
| `filename.label` / `filename.reset` / `filename.willSaveAs` | 파일 이름 / 되돌리기 / 저장될 이름: {name} |
| `conflict.exists` / `conflict.number` / `conflict.overwrite` | 같은 이름의 파일이 이미 있어요. / 번호 붙여 새로 저장 / 덮어쓰기 |
| `conflict.partial` / `conflict.partial.fresh` | 이전에 받다 만 파일이 있어요 ({size}). 이어서 받아요. / 처음부터 받기 |
| `conflict.partialOther` | 다른 화질로 받다 만 파일이 있어요. 처음부터 받아요. |
| `conflict.inQueue` / `conflict.showInList` | 이 파일은 이미 다운로드 목록에 있어요. / 목록에서 보기 |
| `list.title` / `list.clearFinished` | 다운로드 / 완료 항목 지우기 |
| `list.empty.title` / `list.empty.body` | 아직 받은 영상이 없어요 / 위에 치지직 영상 주소를 붙여넣으세요 |
| `list.group.running` / `.queued` / `.stopped` / `.finished` | 받는 중 {n} / 대기 {n} / 멈춤 {n} / 완료 {n} |
| `job.queued` | 대기 중 · 앞에 {n}개 |
| `job.phase.resolving` / `.downloading` / `.reresolving` / `.finalizing` | 준비 중 / 받는 중 / 영상 링크를 새로 받는 중이에요 / 마무리 중 |
| `job.pausing` / `job.paused` / `job.interrupted` | 멈추는 중… / 일시정지됨 · {bytes} 받음 / 중단됨 · {bytes} 받음 |
| `job.completed` / `job.completedMissing` | 완료 · {size} · {time} / 완료 · 파일을 찾을 수 없어요 |
| `job.skipped` | 이미 같은 이름의 파일이 있어 받지 않았어요 |
| `job.eta` / `job.etaUnknown` / `job.segments` / `job.resumedFrom` | {t} 남음 / 남은 시간 계산 중 / 조각 {done}/{total} / {size}부터 이어받음 |
| `action.pause` / `.resume` / `.retry` / `.restartFresh` / `.cancel` | 일시정지 / 이어받기 / 다시 시도 / 처음부터 다시 받기 / 취소 |
| `action.openFile` / `.openFolder` / `.remove` / `.copyUrl` / `.copyReport` | 파일 열기 / 폴더 열기 / 목록에서 지우기 / 주소 복사 / 문제 보고용 정보 복사 |
| `action.reresolve` / `action.overwriteAndDownload` | 다시 불러오기 / 덮어쓰고 받기 |
| `toast.completed` / `toast.copied` / `toast.reportHasPath` | '{title}' 다운로드를 마쳤어요 / 복사했어요 / 복사한 정보에 파일 경로가 들어 있어요 |
| `banner.interrupted` / `banner.resumeAll` | 지난번에 받다가 멈춘 다운로드가 {n}개 있어요. / 모두 이어받기 |
| `dialog.close.*` | 다운로드를 멈추고 닫을까요? / 받는 중인 영상이 {n}개 있어요. 닫으면 일시정지되고, 다음에 앱을 열면 이어받을 수 있어요. / 계속 받기 / 닫기 |
| `dialog.cancel.*` | 다운로드를 취소할까요? / 지금까지 받은 {size}도 함께 지워져요. / 취소하고 지우기 / 돌아가기 |
| `dialog.legacy.*` | 이전 버전 설정을 찾았어요 / 예전 치지직 다운로더의 저장 폴더와 최근 VOD {n}개{cookies}를 가져올까요? / , 네이버 로그인 정보 / 가져오기 / 나중에 |
| `legacy.done` / `legacy.notFound` | 설정을 가져왔어요 / 이 폴더에서 예전 설정을 찾지 못했어요 |
| `settings.*` | 설정 / 저장 / 기본 저장 폴더 / 다운로드 / 빠른 다시보기 연결 수 / (도움말) 빠른 다시보기는 영상을 작은 조각으로 나눠 받아요. 숫자가 클수록 빠르지만 네트워크를 더 많이 써요. |
| `settings.cookie.*` | 고급: 네이버 로그인 정보 / (why) 연령 제한이나 구독자 전용 영상은 네이버에 로그인한 상태여야 받을 수 있어요. 브라우저의 네이버 로그인 쿠키 두 개를 넣으면 이 컴퓨터에만 저장되고, 치지직 영상 정보를 조회할 때만 쓰여요. / (danger) 이 값은 비밀번호와 같아요. 다른 사람에게 보여 주지 마세요. 네이버에서 로그아웃하면 값이 만료돼 다시 넣어야 해요. / 로그인 정보 사용 / 저장됨 / 저장된 값 없음 / 저장 / 지우기 / 값을 찾는 방법 / 두 값을 모두 넣어 주세요 |
| `settings.cookie.howto.steps` | 1. 브라우저에서 chzzk.naver.com에 로그인해요. 2. F12를 눌러 개발자 도구를 열어요. 3. 애플리케이션(Application) > 쿠키 > https://chzzk.naver.com 을 열어요. 4. NID_AUT, NID_SES의 값을 각각 복사해 붙여넣어요. |
| `settings.legacy.*` | 이전 버전 / 예전 치지직 다운로더(명령줄 버전)의 설정과 최근 VOD를 가져와요. / 폴더 선택해서 가져오기 / 마지막 가져오기: {path} |
| `settings.about.*` | 정보 / 버전 {app} (코어 {core}) / 설정 폴더 열기 / 로그 폴더 열기 |
| `banner.settingsError` | 설정을 저장하지 못했어요. 디스크 공간과 권한을 확인해 주세요. |
| `auth.*` (Phase 3) | 허가된 채널만 사용할 수 있어요. 치지직 계정으로 로그인하세요. / 치지직으로 로그인 / 브라우저에서 로그인해 주세요 / 로그인을 마치면 자동으로 넘어가요. 남은 시간 {mm:ss} / 브라우저 다시 열기 / 취소 / 사용 허가가 없는 채널이에요 / 채널: {channelName}. 허가를 받으려면 관리자에게 채널 이름을 알려 주세요. / 다른 계정으로 로그인 / 로그인 시간이 지났어요. 다시 시도해 주세요. / 로그인을 취소했어요. / 로그인 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요. / 다시 로그인 / 로그아웃 / 로그아웃할까요? 받는 중인 다운로드는 계속돼요. |
| `banner.sessionExpired` (Phase 3) | 로그인이 만료됐어요. 새 영상을 불러오려면 다시 로그인해 주세요. |

---

## 10. 컴포넌트 트리

Svelte 5 runes. 스토어는 `.svelte.ts` 클래스. `JobItem`은 `job`과 `progress`만 보고 그리고 동작은 전부 `JobsStore` 메서드를 거친다. 상태 판단은 Rust가 하고 프런트는 표시만 맡는다.

```
App.svelte                        view = $state<'home'|'settings'|'login'>('home')
├ AppHeader                        ├ AccountSlot (Phase 3; disabled면 빈 노드, 폭 0)  └ IconButton[설정]
├ AppBanners                       InterruptedBanner(B1) · SettingsErrorBanner(B2) · SessionBanner(B3)
├ AuthGate                         features.auth && !signedIn → view = 'login'
├ {#if view === 'home'} HomeView
│   ├ InputPanel
│   │  ├ UrlBar                    TextField + Button, 붙여넣기 즉시 resolve, 세대 번호
│   │  ├ ResolveError              InlineAlert + errorCopy
│   │  └ {#if ready} ResolveCard {:else if loading} ResolveSkeleton {:else} RecentList
│   │       ResolveCard
│   │       ├ KindBadge · AdultBadge · ContentMetaLine
│   │       ├ QualityPicker        RadioGroup, 예상 크기
│   │       ├ FolderField          pickFolder → updateSettings
│   │       ├ FilenameField        checkOutput 디바운스 150ms
│   │       ├ ConflictNotice       exists / partial(sameJob) / partialOther / duplicate
│   │       ├ OwnershipNotice      Phase 3 슬롯
│   │       └ CardActions
│   └ JobList
│      ├ JobListHeader             완료 항목 지우기
│      ├ EmptyJobs
│      └ JobGroup* → JobItem*
│           ├ KindBadge · 제목 · 화질
│           ├ JobProgress          ProgressBar + aria-valuenow/valuetext
│           ├ JobStatusLine        phase / 크기 / 조각 / 속도 / ETA / 오류 문구
│           ├ JobActions           상태별 기본 버튼 1~3개
│           └ JobMenu
├ {:else if view === 'settings'} SettingsView
│   ├ StorageSection · DownloadSection · AccountSection(Phase 3)
│   ├ CookieSection                Disclosure: 설명, Switch, SecretField x2, HowTo
│   ├ LegacySection                pick → 요약 → 적용, warnings InlineAlert
│   └ AboutSection
├ {:else} LoginView (Phase 3)      LoginIdle | LoginPending | LoginResult
├ Dialogs                          CloseGuard(D1, 'close-requested' 이벤트) · ConfirmCancel(D2) · LegacyFound(D3)
├ Toaster
├ LiveAnnouncer                    aria-live="polite" 하나
└ GlobalShortcuts

lib/
  api.ts                           invoke 래퍼 (§4)
  bindings/                        ts-rs 생성물
  stores/jobs.svelte.ts            JobsStore(Map<id, JobDto>, progress Map, 그룹·정렬 파생값, 동작 메서드, 재구독)
  stores/jobs.apply.ts             applyEvent(state, JobEvent) 순수 함수
  stores/settings.svelte.ts        SettingsStore(get/patch, 저장 오류 → 배너)
  stores/resolve.svelte.ts         ResolveStore(idle | loading{gen} | ready(view) | error(AppError))
  stores/auth.svelte.ts            AuthStore(disabled | … , Phase 3 폴링 타이머)
  stores/toast.svelte.ts
  copy/ko.ts  copy/errors.ts       errorCopy(err, ctx) → { title, body, actions: ActionId[] }
  format/{bytes,duration,date}.ts
  components/ui/                   Button, IconButton, Badge, ProgressBar, RadioGroup, Switch, TextField, SecretField,
                                   Dialog, ConfirmDialog, Menu, Toast, InlineAlert, Banner, Spinner, Skeleton, Kbd, Disclosure
```

### 단축키 (macOS는 Cmd, 그 외 Ctrl)

| 키 | 동작 |
|---|---|
| Mod+L | URL 입력줄로 포커스 |
| Mod+V (입력칸 밖) | 입력줄에 붙여넣고 바로 불러오기 |
| Enter (입력줄) / Mod+Enter (카드) | 불러오기 / 다운로드 |
| Esc | 불러오기 취소 → 카드 닫기 → 대화상자 닫기 → 설정에서 뒤로(가장 안쪽부터) |
| Mod+, | 설정 |
| 목록에서 위·아래 / Space / Enter / Delete | 항목 이동(roving tabindex) / 일시정지·이어받기 / 완료 항목은 파일 열기, 그 밖은 기본 버튼 / 종료 항목은 지우기, 진행 항목은 취소(D2) |

### 접근성·시각 기본

- 랜드마크 `header`, `main`, `section aria-labelledby="list-title"`, URL 입력은 `form`. 진행 막대는 `role="progressbar"` + `aria-valuenow`(정수 %) + `aria-valuetext`("58퍼센트, 2분 18초 남음"). 총량을 모르면 `aria-valuenow` 생략.
- `aria-live="polite"` 하나를 루트에 두고 상태 전이와 불러오기 결과만 읽는다. 진행률 틱은 읽지 않는다. 오류 InlineAlert는 `role="alert"`.
- 대화상자는 기본 버튼에 포커스, 포커스 가둠, 닫으면 연 요소로 복귀. 아이콘 버튼은 모두 `aria-label`. 색만으로 상태를 전달하지 않는다(아이콘·문구·테두리 병행). 대비 본문 4.5:1, 보조 3:1. `prefers-reduced-motion`이면 스켈레톤·줄무늬·강조 애니메이션을 끈다.
- `lang="ko"`, 긴 제목은 `word-break: keep-all; overflow-wrap: anywhere`. 본문 14px, 최소 12px, rem 단위.
- 색은 `app.css`의 커스텀 프로퍼티(`--bg --surface --surface-2 --border --fg --fg-muted --accent --accent-soft --danger --danger-soft --warning --success --kind-rewind --kind-vod --kind-clip --focus`)로 라이트·다크 두 벌. 강조색은 중립 청록(치지직 브랜드 색·로고를 쓰지 않는다). 글꼴 `system-ui, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif`. 모서리 8px(배지 6px), 진행 막대 6px, 그림자는 대화상자·메뉴에만.
- 상태별 표현: 진행 `accent`, 링크 갱신 `accent` 줄무늬, 일시정지·중단 `fg-muted`, 실패 `danger` 테두리 + `danger-soft` 오류 줄, 완료는 막대를 숨기고 `success` 체크. 배지는 `kind-*` 테두리와 글자만, 면은 투명. 성인 배지는 `danger` 테두리.

---

## 11. 플러그인·capabilities·CSP

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| { /* main 창 show + unminimize + set_focus */ }))  // 반드시 처음
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .setup(setup)
    .on_window_event(|w, e| if let WindowEvent::CloseRequested { api, .. } = e { /* running > 0이면 api.prevent_close(); emit("close-requested", {running}) */ })
    .invoke_handler(tauri::generate_handler![...])
```

- `single-instance`는 `cfg(any(target_os = "macos", windows, target_os = "linux"))` 타깃 의존성. `dialog`·`opener`는 Rust에서만 부르고 JS 권한을 주지 않는다. `window-state`·`store`·`fs`·`log`·`deep-link`·`notification`은 쓰지 않는다. `updater`는 Phase 4(그때까지 `createUpdaterArtifacts`·`plugins.updater`가 없으므로 PR 빌드에 서명 키가 필요 없다).
- `build.rs`의 `AppManifest::new().commands(&[...])`로 앱 command를 명시적 허가제로 바꾼다. 권한 식별자 형식(`allow-app-info` 등)은 1단계에서 생성된 `gen/schemas`로 확인한다.

```json
{ "$schema": "../gen/schemas/desktop-schema.json", "identifier": "default", "windows": ["main"],
  "permissions": ["core:default",
    "allow-app-info", "allow-get-settings", "allow-update-settings", "allow-set-naver-cookies", "allow-clear-naver-cookies",
    "allow-import-legacy", "allow-pick-folder", "allow-resolve", "allow-check-output", "allow-enqueue", "allow-list-jobs",
    "allow-subscribe-jobs", "allow-pause-job", "allow-resume-job", "allow-remove-job", "allow-clear-finished",
    "allow-open-output", "allow-reveal-output", "allow-quit", "allow-auth-status"] }
```

```json
"app": { "withGlobalTauri": false, "security": {
  "csp": { "default-src": "'self'", "script-src": "'self'", "style-src": "'self'", "img-src": "'self' data:",
           "connect-src": "ipc: http://ipc.localhost", "object-src": "'none'", "base-uri": "'none'",
           "frame-ancestors": "'none'", "form-action": "'none'" },
  "freezePrototype": true } }
```

- Svelte 5 + Vite는 CSS를 파일로 뽑고 `style:` 지시자는 CSSOM이라 `'unsafe-inline'`이 필요 없을 것으로 본다. 1단계 `tauri build --debug`에서 CSP 위반을 확인한다. `devCsp`를 쓰면 HMR용 `ws://localhost:1421`을 더한다.
- `core:default`로 시작한다. 더 좁힐 때는 Channel 전달과 `listen('close-requested')`가 여전히 되는지 함께 확인한다.

---

## 12. Phase 3 자리 (Phase 2에서는 꺼 둠)

- **기능 플래그**: `AppInfo.features.auth`. cargo feature `auth`로 정하고 Phase 2 빌드는 `false`. 프런트는 이 값 하나로만 분기한다.
- **AuthStore**: `disabled`(Phase 2 고정) | `signedOut` | `pending{expiresAt}` | `signedIn{channelId, channelName}` | `denied{channelName}` | `expired` | `cancelled` | `error`. `auth-changed` emit으로 갱신한다.
- **AuthGate**(`App.svelte`): `auth !== disabled && !signedIn`이면 `view = 'login'`. 다운로드 목록은 로그인 화면 뒤에서도 계속 돈다(코어는 앱 세션 토큰을 쓰지 않는다).
- **AccountSlot**: Phase 2에서는 빈 노드. Phase 3에서 `채널이름 v` + 로그아웃.
- **셸**: `AuthState { Unknown | SignedOut | Pending { sid: Secret, poll_secret: Secret, started } | SignedIn { channel_id, channel_name, token: Secret, expires_at } }`. 토큰은 `{app_config_dir}/session.json`(0600, `atomic_write`, `SessionStore`). `CredentialStore`는 네이버 쿠키 전용 스키마라 섞지 않는다. 로그인 흐름(chzzk-oauth.md §9): `auth_login`이 Rust reqwest로 Worker `POST /auth/start` → Rust opener `open_url`로 브라우저 → Rust 태스크가 2초 간격 최대 5분 poll → `SessionStore` 저장 + `emit("auth-changed")`. JS는 Worker 주소도 토큰도 모른다. reqwest는 코어와 같은 버전·feature로 TLS 스택을 하나로 둔다.
- **본인 영상 검사**: `resolve`가 `ResolvedDto.ownership`을 채워 UI가 미리 막고(`notOwn`·`unknown`이면 다운로드 비활성), `enqueue` 앞의 `OwnershipGate`가 실제로 강제한다(최근 resolve 캐시 32개, 없으면 다시 resolve. 로그인 안 함 → `notLoggedIn`, `Some(false)` → `notOwnContent`, `None` → `ownershipUnknown`으로 **거부**). `JobRecord.channel_id`로 `resume_job`과 `auth-changed` 때 현재 채널과 다시 비교해 다르면 재개를 거부한다(`.part`는 유지). 클립은 `ownerChannel` 기준(제작자 포함 여부는 열린 질문 4). Phase 2의 게이트는 항상 허용이다.
- **세션 만료**: 새 resolve가 401이면 B3 배너 + `view = 'login'`. 진행 중인 다운로드는 유지.
- **업데이트**: Phase 4에서 Bearer 토큰이 생기면 설정 > 정보에 `[업데이트 확인]`을 더한다. 업데이트 확인·설치는 Rust command로 하고 `updater_builder().header(...)`로 토큰을 붙인다.

---

## 13. 테스트 전략

| 층 | 도구 | 무엇을 |
|---|---|---|
| `crates/shell` | `tokio::test(start_paused)`, 가짜 `Backend`, `tempfile` | 동시성 상한 2, FIFO, pause/resume/remove 전이, `remove_job`의 종료 대기 → `discard_partial` 순서, `restart`, `Progress` → `Status` 순서, sink 실패 무시, 구독 교체 시 스냅샷, `duplicateOutput`, `quit`(3초 상한, `paused` 저장), 오류 매핑(`ErrorKind` 전체 + payload), `partial_bytes`가 실제 `.part`·sidecar 기준인지(코어 `Sidecar::new`로 만든다), `check_output` 세 판정과 `free_file_name`(200바이트 안), jobs.json 왕복과 `.bad-{ts}`, reconcile 각 행, 쿠키 토글 교체, 첫 실행 legacy 후보 1회, Send 컴파일 검사, 비밀 누출(쿠키 `NIDSECRET` 넣고 전체 흐름 → 로그·모든 `JobEvent` JSON에 없음), DTO JSON 스냅샷(`{"type":"status",…,"partialBytes":…}`, `ContentRef`·`PlaybackKind` 모양, `u64`가 `number`) |
| `app/src-tauri` | `tauri` `test` feature, `mock_builder` + `get_ipc_response` | command 인자의 camelCase와 `AppError` 직렬화. 가능하면 `generate_context!()`로 AppManifest·capabilities까지(11단계에서 확인). 안 되면 command 목록과 capabilities 파일을 비교하는 테스트 |
| 프런트 단위 | vitest 5 + jsdom | `applyEvent` 순수 함수, `errorCopy` 표 테스트(모든 code × 위치), `format/bytes`(코어 golden 12건), `format/duration` |
| `api.ts` | `mockIPC` + `clearMocks` | command 이름과 인자. mock은 인자를 직렬화하지 않고 Channel 객체를 그대로 넘기므로 `args.onEvent.onmessage(...)`를 직접 불러 전달을 흉내 낸다 |
| 컴포넌트 | `@testing-library/svelte` 5.4(`svelteTesting()`), user-event, jest-dom | `vi.mock('$lib/api')`. UrlBar의 `invalidUrl`과 세대 번호, QualityPicker 기본 선택, ConflictNotice 세 형태 → `EnqueueRequest` 값, JobItem의 상태별 버튼(표 전체), SettingsView가 쿠키 값을 다시 채우지 않는지, CloseGuard |
| 타입 | `svelte-check`, bindings drift(`git diff --exit-code`) | |
| e2e | v1에서는 하지 않는다 | tauri-driver가 macOS를 지원하지 않는다. 3 OS 빌드 스모크 + 수동 체크리스트(`docs/design/app.md` 끝) |

`test/setup.ts`는 jsdom에 `crypto.getRandomValues`를 채우고 `afterEach(clearMocks)`를 건다.

---

## 14. CI

`core.yml`은 그대로 둔다. 새로 `.github/workflows/app.yml`:

```yaml
on:
  pull_request: { paths: ["app/**", "crates/**", "Cargo.toml", "Cargo.lock", ".cargo/**", ".github/workflows/app.yml"] }
  push: { branches: [master], paths: [같음] }
env: { CARGO_TERM_COLOR: always, CARGO_INCREMENTAL: "0", AWS_LC_SYS_PREBUILT_NASM: "1" }
jobs:
  shell:      # 3 OS. webkit·프런트 빌드 불필요
    - cargo clippy -p chzzk-shell --all-targets --locked -- -D warnings
    - cargo test -p chzzk-shell --locked
    - git diff --exit-code app/src/lib/bindings      # ubuntu에서만
  frontend:   # ubuntu, pnpm/action-setup@v6, setup-node@v7 (node 24, cache pnpm)
    - pnpm install --frozen-lockfile; pnpm check; pnpm test; pnpm build
  tauri:      # 3 OS, needs [shell, frontend]. ubuntu는 apt
    - pnpm install --frozen-lockfile && pnpm build   # frontendDist 선행
    - cargo clippy -p chzzk-app --all-targets --locked -- -D warnings
    - cargo test -p chzzk-app --locked
    - pnpm tauri build --ci --debug --no-bundle      # PR
    # master·workflow_dispatch: pnpm tauri build --ci --no-sign (번들) + upload-artifact 7일
```

- 모든 작업은 checkout 전에 `core.autocrlf=false`, rust-cache는 `workspaces: ". -> target"`.
- Ubuntu apt: `libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`(번들 때 `patchelf`). 러너는 `ubuntu-22.04` 유지(산출물의 최소 glibc).
- `core.yml`의 `paths`에는 `crates/**`가 이미 있어 셸 변경도 코어 CI를 돌린다. 코어 작업은 `-p chzzk-core`라 영향 없다.
- `CLAUDE.md` 검증 게이트에 `cargo clippy -p chzzk-shell …`, `cargo test -p chzzk-shell`, `pnpm check`, `pnpm test`를 더하고 `chzzk-app`은 `pnpm build` 뒤에만 컴파일된다고 적는다.

---

## 15. 구현 순서 (작은 커밋, 각 커밋에 해당 테스트 포함)

1~10단계는 Tauri 없이 진행되므로 stacked PR을 둘로 나눈다: **PR A** `crates/shell`(1~10), **PR B** 앱 + 화면(11~19). 각 단계가 끝나면 ROADMAP "현재 위치"를 갱신한다.

| # | 커밋 | 파일 | 통과해야 할 것 |
|---|---|---|---|
| 1 | 골격 | `app/`(Vite + Svelte 5 + TS, `index.html`, `vite.config.ts`, `App.svelte` 빈 화면), `app/src-tauri/`(Builder·플러그인·빈 command), `Cargo.toml` members, `.gitignore`, `tauri.conf.json`(창·CSP·identifier). 확인해서 이 문서 "구현 중 변경"에 적는다: `frontendDist` 없이 `cargo check -p chzzk-app`이 되는지, `tauri::async_runtime::handle().inner()`로 tokio `Handle`을 얻는지, TLS provider(`cargo tree -i aws-lc-sys/ring`), 권한 식별자 형식, `app_log_dir` 실제 경로, CSP 위반 | `pnpm tauri dev`, `pnpm tauri build --debug --no-bundle`, `pnpm check` |
| 2 | shell 골격 + 오류 DTO | `crates/shell/{Cargo.toml,src/lib.rs,src/error.rs,src/dto.rs(빈)}`, `.cargo/config.toml`, `tests/error_map.rs` | `ErrorKind` 전체 → `ErrorCode` 매핑, payload, JSON 스냅샷, bindings 생성 |
| 3 | 나머지 DTO | `dto.rs`(`ResolvedDto`, `OutputCheck`, `EnqueueRequest`, `JobDto`, `ProgressDto`, `JobEvent`, `SettingsDto`, `AppInfo`), `tests/dto_json.rs` | 스냅샷, `u64` → `number`, `ContentRef`·`PlaybackKind` 모양 일치 |
| 4 | Backend trait | `backend.rs`, `tests/common/fake.rs`(스크립트형 가짜 Backend: 진행률 시퀀스·오류·취소 대기) | Send 컴파일 검사 |
| 5 | JobStore | `jobs.rs`(JobRecord, 읽기/쓰기, `.bad-{ts}`) | 왕복, nextId, 깨진 파일 |
| 6 | reconcile | `jobs.rs` | §7.1 표 각 행(코어 `Sidecar::new` + `atomic_write`로 sidecar 생성) |
| 7 | 매니저 큐 | `manager.rs`, `events.rs` | 동시성 2, FIFO, `Added`→`Progress`→`Status` 순서, sink 실패 무시, 구독 교체 스냅샷, `duplicateOutput` |
| 8 | 매니저 제어 | `manager.rs`(pause/resume/remove/quit/restart), `output.rs`(`check_output`, `free_file_name`) | 상태 전이 표, remove 순서, `partial_bytes`, resolve 실패 시 `.part` 반영, `quit` 3초, `check_output` 세 판정 |
| 9 | SettingsService | `services.rs`(AppPaths 폴백, 클라이언트 교체, 최근 VOD, 첫 실행 legacy 후보, `ownership.rs` 항상 허용 게이트) | 교체, legacy 1회, 비밀 누출 |
| 10 | shell CI | `app.yml`의 `shell` 작업, CLAUDE.md 게이트 | 3 OS 녹색 |
| 11 | command 배선 | `commands.rs`, `sink.rs`, `lib.rs`(setup·로그·창 닫기 이벤트·`request_user_attention`), `build.rs` AppManifest, `capabilities/default.json` | IPC 테스트, CSP 위반 없음, `pnpm tauri dev`로 `resolve` 수동 확인 |
| 12 | 프런트 기반 | `api.ts`, `bindings` import, `stores/jobs.apply.ts`, `copy/ko.ts`, `copy/errors.ts`, `format/*`, vitest 설정, `test/setup.ts`, `app.css` | `applyEvent`, `errorCopy` 표, `format` golden, `mockIPC` |
| 13 | UI 기본 요소 | `components/ui/*`, `App.svelte` 뷰 전환, AppHeader, Toaster, LiveAnnouncer, GlobalShortcuts | 컴포넌트 테스트(Dialog 포커스 가둠, RadioGroup) |
| 14 | 받기 화면 | UrlBar(세대 번호), ResolveSkeleton, ResolveError, RecentList, ResolveCard 일체(QualityPicker, FolderField, FilenameField, ConflictNotice, OwnershipNotice 슬롯) | 컴포넌트 테스트: `invalidUrl`, 기본 화질, 충돌 세 형태 → `EnqueueRequest` |
| 15 | 작업 목록 화면 | JobsStore(재구독), JobList·JobGroup·JobItem·JobProgress·JobStatusLine·JobActions·JobMenu, EmptyJobs, D2, B1 | 상태별 버튼 표, 정렬·그룹, 512 MiB 확인, 모두 이어받기 |
| 16 | 설정 화면 | SettingsView 다섯 섹션, D3, B2 | 쿠키 값 미복원, 즉시 저장, 가져오기 warnings InlineAlert |
| 17 | 창 닫기·마무리 | CloseGuard(D1) ↔ `close-requested`·`quit`, `request_user_attention`, 접근성 점검(aria, 포커스 복귀, reduced-motion) | 수동 3 OS 스모크 체크리스트 |
| 18 | 앱 CI | `app.yml`의 `frontend`·`tauri` 작업 | 3 OS 녹색 |
| 19 | 문서 | ROADMAP, CLAUDE.md(레이아웃·명령·게이트), 이 문서 "구현 중 변경" 정리 | - |

**수동 스모크 체크리스트(17단계)**: 빠른 다시보기·일반 VOD·클립 각 1건 받기 → 일시정지 → 앱 종료(D1) → 재시작(B1) → 이어받기 → 완료 → 파일 열기·폴더 열기. 같은 경로 두 번 추가(`duplicateOutput`). 완성 파일이 있는 이름으로 추가(번호 붙이기). 쿠키 넣고 켜기·끄기. 옛 폴더 가져오기. 창 폭 720에서 레이아웃. 다크 모드.

---

## 16. 열린 질문 (사용자 결정)

### 사용자 답변 (2026-10-05) — 아래 질문보다 우선한다

- **identifier: `io.github.chnu-kim.chzzk-downloader`** (repo 이름과 일치)
- **클립 소유: 원 채널(`ownerChannel`)만.** 채널 ID를 모르면(`None`) 거부(fail closed)
- **기본 저장 폴더: OS 비디오 폴더/치지직** (설계안 기본값 유지, 없으면 다운로드/치지직)
- **v1에 모두 포함**: 완료 OS 알림(`notification` 플러그인), 동시 다운로드 수 설정(기본 2, 1~3, 코어 `UserSettings`에 필드 추가), 재시작 후 자동 이어받기 설정 토글, 드래그 앤 드롭·클립보드 감지(창 포커스 때 치지직 링크 제안, `clipboard-manager` 읽기 권한만)
- "항상 Windows 파일명 규칙"(질문 7)은 v1 제외

1. **동시 다운로드 상한.** v1은 상수 2(빠른 다시보기 둘이면 연결 8개). 실측 뒤 1로 낮추거나 설정(1~3)으로 열 것인가? 설정으로 열면 코어 `UserSettings`에 `max_parallel_downloads`를 더한다.
2. **재시작 후 자동 이어받기.** v1은 배너를 한 번 눌러야 한다. 설정 토글이 필요한가?
3. **기본 저장 폴더.** `~/Movies/치지직`(OS 비디오 폴더) → 없으면 `다운로드/치지직`. 다운로드 폴더를 우선할 것인가?
4. **본인 영상 검사에서 `None`(채널 ID 없음)의 기본.** 거부(fail closed)를 권장한다. 클립 제작자(`makerChannel`)도 허용할지는 chzzk-oauth.md 열린 질문 5.
5. **`identifier`.** `io.github.chnu-kim.vod-downloader`로 둔다. 한 번 정하면 바꿀 수 없으므로 1단계 전에 확정이 필요하다.
6. **클립보드 감시·드래그 앤 드롭.** v1에서 뺐다. 필요하면 v1.1에 `clipboard-manager` 플러그인(읽기 권한만)과 `dragDropEnabled` 검증을 더한다.
7. **"항상 Windows 파일명 규칙" 설정**(core.md §6 보류). macOS에서 만든 파일을 NTFS로 옮기는 사용자가 있는가?
8. **완료 알림.** `request_user_attention`만으로 충분한가? OS 알림이 필요하면 `notification` 플러그인을 더한다.

---

## 17. 확인한 버전 (2026-10-05, crates.io·npm 재조회)

| 패키지 | 버전 | 메모 |
|---|---|---|
| `tauri` / `tauri-build` | 2.12.1 / 2.7.1 | 3.0.0-alpha는 쓰지 않는다 |
| `tauri-plugin-dialog` / `-opener` / `-single-instance` | 2.8.1 / 2.7.0 / 2.5.2 | Rust에서만 |
| `tauri-plugin-updater` | 2.13.1 | Phase 4 |
| `ts-rs` | 12.0.1 | `TS_RS_LARGE_INT=number` |
| `tracing-subscriber` / `tracing-appender` | 0.3.23 / 0.2.5 | |
| `@tauri-apps/api` / `cli` | 2.12.1 | |
| `svelte` / `vite` / `@sveltejs/vite-plugin-svelte` | 5.57.1 / 8.3.2 / 7.3.1 | |
| `@sveltejs/kit` / `adapter-static` | 3.0.0 / 4.0.0 (2026-10-01) | 쓰지 않는다 |
| `typescript` | ~6.0 | 최신 7.0.2는 svelte-check 4.7.6 peer(^5 \|\| ^6) 밖 |
| `svelte-check` / `vitest` / `jsdom` | 4.7.6 / 5.0.3 / 30.1.2 | vitest 5는 node ^22.12 또는 ^24 |
| `@testing-library/svelte` / `jest-dom` / `user-event` | 5.4.2 / 7.0.1 / 14.6.7 | |
| Node / pnpm | 24 LTS / 12.x | `packageManager` 필드로 고정 |

---

## 구현 중 변경

구현하면서 설계와 달라졌거나 설계가 모호해 고른 내용이다. 단계 번호는 §15 기준이다.

(아직 없음)
