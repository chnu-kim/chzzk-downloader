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
| `skipped` | O | 이미 같은 이름의 파일이 있어 받지 않았어요 (받은 `.part`가 남았으면 "받는 동안 같은 이름의 파일이 생겨 저장하지 않았어요") | `DownloadOutcome::Skipped`, `partial_bytes`(구현 중 변경 53) |

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
| `exists` | "같은 이름의 파일이 이미 있어요" (●) 번호 붙여 새로 저장 ( ) 덮어쓰기 | 번호: `file_name = free_file_name`, `on_existing = skip`. 덮어쓰기: 그대로, `on_existing = overwrite`(구현 중 변경 53) |
| `partial.same_job` | "이전에 받다 만 파일이 있어요 (1.2 GB). 이어서 받아요" [처음부터 받기] | 이어받기: `restart = false`. 처음부터: `restart = true` |
| `partial && !same_job` | "다른 화질로 받다 만 파일이 있어요. 처음부터 받아요" (안내만) | `restart = false`(코어가 지우고 새로 시작) |
| `duplicate_job_id` | "이 파일은 이미 다운로드 목록에 있어요" [목록에서 보기]. 다운로드 버튼 비활성 | - |

`.part`만 있고 완성 파일이 없으면 중복이 아니라 이어받기 후보다. ~~코어 `DuplicatePolicy::Skip`은 UI에서 쓰지 않는다~~ → 덮어쓰기를 직접 고른 때만 `overwrite`, 그 밖은 모두 `skip`이다(구현 중 변경 53).

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
| `paused`, `interrupted`, `failed`, `skipped`(구현 중 변경 53) | `.part`와 sidecar가 있고 `same_job` | 상태 유지, `partial_bytes = committed_len` |
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
| `diskFull` | D | 저장 공간이 부족해요 / `{path}`가 있는 디스크의 공간을 비운 뒤 이어받으세요. (R이면 "…비운 뒤 다시 시도해 주세요.", 구현 중 변경 44) | 이어받기, 폴더 열기 |
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
| `job.skipped` / `job.skippedMeanwhile` | 이미 같은 이름의 파일이 있어 받지 않았어요 / 받는 동안 같은 이름의 파일이 생겨 저장하지 않았어요 |
| `job.eta` / `job.etaUnknown` / `job.segments` / `job.resumedFrom` | {t} 남음 / 남은 시간 계산 중 / 조각 {done}/{total} / {size}부터 이어받음 |
| `action.pause` / `.resume` / `.retry` / `.restartFresh` / `.cancel` | 일시정지 / 이어받기 / 다시 시도 / 처음부터 다시 받기 / 취소 |
| `action.openFile` / `.openFolder` / `.remove` / `.copyUrl` / `.copyReport` | 파일 열기 / 폴더 열기 / 목록에서 지우기 / 주소 복사 / 문제 보고용 정보 복사 |
| `action.reresolve` / `action.overwriteAndDownload` | 다시 불러오기 / 덮어쓰고 받기 |
| `toast.completed` / `toast.copied` / `toast.reportHasPath` | '{title}' 다운로드를 마쳤어요 / 복사했어요 / 복사한 정보에 파일 경로가 들어 있어요 |
| `toast.copyFailed` | 복사하지 못했어요. 다시 시도해 주세요. |
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
| 14 | 받기 화면 | UrlBar(세대 번호), ResolveSkeleton, ResolveError, RecentList, ResolveCard 일체(QualityPicker, FolderField, FilenameField, ConflictNotice, OwnershipNotice 슬롯) | 컴포넌트 테스트: `invalidUrl`, 기본 화질, 충돌 세 형태 → `EnqueueRequest`. (웹뷰 수동 확인 — CSP 위반 없음, 실제 주소로 `resolve` — 은 17행으로 옮겼다, 구현 중 변경 42·44) |
| 15 | 작업 목록 화면 | JobsStore(재구독), JobList·JobGroup·JobItem·JobProgress·JobStatusLine·JobActions·JobMenu, EmptyJobs, D2, B1 | 상태별 버튼 표, 정렬·그룹, 512 MiB 확인, 모두 이어받기 |
| 16 | 설정 화면 | SettingsView 다섯 섹션, D3, B2 | 쿠키 값 미복원, 즉시 저장, 가져오기 warnings InlineAlert |
| 17 | 창 닫기·마무리 | CloseGuard(D1) ↔ `close-requested`·`quit`, `request_user_attention`, 접근성 점검(aria, 포커스 복귀, reduced-motion), setup 실패 안내(38(바)) | 수동 3 OS 스모크 체크리스트(14에서 옮긴 `pnpm tauri dev` 웹뷰 콘솔 CSP 위반 없음·실제 주소로 `resolve`·텍스트 드롭·창 포커스·입력칸 밖 붙여넣기 포함) |
| 18 | 앱 CI | `app.yml`의 `frontend`·`tauri` 작업 | 3 OS 녹색 |
| 19 | 문서 | ROADMAP, CLAUDE.md(레이아웃·명령·게이트), 이 문서 "구현 중 변경" 정리 | - |

**수동 스모크 체크리스트(17단계)**: 빠른 다시보기·일반 VOD·클립 각 1건 받기 → 일시정지 → 앱 종료(D1) → 재시작(B1) → 이어받기 → 완료 → 파일 열기·폴더 열기. 같은 경로 두 번 추가(`duplicateOutput`). 완성 파일이 있는 이름으로 추가(번호 붙이기). D1 `[닫기]` 두 번 누르기·3초 대기 중 Cmd+Q(38(가)). 읽을 수 없는 `jobs.json`으로 시작(38(바)). 쿠키 넣고 켜기·끄기. 옛 폴더 가져오기. 창 폭 720에서 레이아웃. 다크 모드.

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

**읽는 법.** 번호는 적은 순서이고 고치지 않는다. 같은 주제를 뒤 항목이 다시 다루면 **뒤 항목이 이긴다**. 위 본문(§0~§17)보다 이 절이 우선하고, 이 절보다 §16 "사용자 답변"이 우선한다. 본문을 읽다가 아래 주제에 닿으면 오른쪽 항목을 먼저 본다.

| 주제 (본문 위치) | 지금 기준 |
|---|---|
| identifier·플러그인 다섯 개·JS 플러그인 권한 없음 (§2·§11) | 1, 2 (클립보드도 Rust command `clipboard_link`로 읽는다, 37) |
| bindings 생성·최신 검사 (§2·§14의 `git diff`) | 14 (`cargo test -p chzzk-shell --test bindings`) |
| 코어 `UserSettings` 필드 (§1·§3 "코어 API 그대로") | 28 (22를 앞당김, core.md 구현 중 변경 53) |
| `jobs.json` 쓰기 위치 (§7.1·29(다)) | 32 (잠금 밖 쓰기 스레드) |
| `quit`이 멈춘 작업 상태 (§6.1) | 30 (`interrupted`), 종료 한 번만은 38(가) |
| 쿠키 가져오기·토글 (§7.2·34) | 36 |
| 드래그 앤 드롭·`dragDropEnabled: false` (§11) | 5, 44(가) |
| 상태별 버튼 (§8.5 그림) | 45 (ui-visual §6.5) |
| 완료 알림 (§6.1·§16) | 37, 47 (실패에도 OS 알림) |
| macOS Cmd+Q·메뉴 Quit (§6.1 D1, 37 "창 닫기와 앱 종료") | 52 (기본 메뉴의 Quit은 가드를 지나친다 → 보통 메뉴 항목 + `request_quit`) |
| CI 작업 (§14) | **55** (단일 `ci.yml`, `docs/design/cicd.md`가 기준). 35·49는 기록, 51(가)(Linux 패키지 이름)는 그대로 |
| 다른 프로세스 막기 (§6.1 "중복 방지 세 겹"의 (2)) | 51(다) (single-instance + 데이터 폴더 `app.lock`) |
| 컴포넌트 나눔 (§10) | 48 "하지 않은 것" (3) |
| `on_existing`·`skipped`의 `.part` (§6.4 표·§6.1 상태 표) | 53 |
| 경로 열쇠·`..` 거부 (§6.1 중복 방지·§6.4) | 54 |
| e2e (§13 표의 "v1에서는 하지 않는다") | **57** (웹 E2E Playwright + 네이티브 E2E tauri-driver, `docs/design/cicd.md` 구현 중 변경 36~) |
| 웹뷰·OS 수동 확인 (§15 14·17행) | 아래 "수동 스모크 체크리스트 결과" 표. 미확인 항목은 사람이 3 OS에서 본다 |
| Phase 3 자리·로그인 화면·업데이트 (§12·§8.9·§9 auth 문구) | **59** (`docs/design/worker.md` §11이 기준: 빌드 env로 켜는 auth, 토큰 둘, 3일 유예, 10분 pending, 런타임 updater endpoint, 시작 때 자동 확인). 화면(로그인 화면·AccountSlot·copy)은 **61** (worker.md 구현 중 변경 62~66). 업데이트 배선·[다시 연결] 보강은 **A4-8**(worker.md 구현 중 변경 A4-1~A4-7) |

1. **§15-1 identifier.** §2의 `io.github.chnu-kim.vod-downloader` 대신 §16 답변대로 `io.github.chnu-kim.chzzk-downloader`를 쓴다. `app/src/tauri-conf.test.ts`가 identifier·창 크기·CSP·`withGlobalTauri`·`dragDropEnabled`를 고정한다.
2. **§15-1 플러그인.** §0·§11의 세 개에 더해 §16 답변대로 `tauri-plugin-notification` 2.5.1·`tauri-plugin-clipboard-manager` 2.4.1을 골격에서부터 Builder에 등록한다. 다섯 개 모두 Rust에서만 부르므로 JS 패키지(`@tauri-apps/plugin-*`)와 capabilities 플러그인 권한은 넣지 않았다. 클립보드를 JS에서 읽기로 하면 그때 `clipboard-manager:allow-read-text` 하나만 더한다.
3. **§15-1 `crates/shell` 앞당김.** workspace members를 §2대로 한 번에 맞추려고 의존성 없는 `crates/shell`(빈 `lib.rs`)을 1단계에 만들었다. 내용은 §15-2부터 채운다.
4. **§15-1 `envPrefix`.** §2의 `TAURI_` 대신 `['VITE_', 'TAURI_ENV_']`. Tauri v2가 빌드 변수를 `TAURI_ENV_*`로 넘기고, `TAURI_`는 Phase 4의 `TAURI_SIGNING_PRIVATE_KEY`까지 번들에 노출할 수 있다. 템플릿대로 `server.watch.ignored: ['**/src-tauri/**']`도 둔다.
5. **§15-1 `dragDropEnabled: false` 유지.** §16에서 URL 드래그 앤 드롭을 넣지만 네이티브 드롭 핸들러는 파일 경로만 넘기고, 이것을 꺼야 웹뷰가 HTML5 `drop`(`text/uri-list`·`text/plain`)을 받는다(Windows는 필수). `true`로 "고치지" 않는다. 3 OS 실제 동작은 드래그 앤 드롭 구현 단계에서 확인한다.
6. **§15-1 확인: `frontendDist` 없이 컴파일.** `app/dist`가 없는 상태에서 `cargo check -p chzzk-app`이 통과한다(macOS, 2026-10-05). `custom-protocol` feature 없이(=`cargo` 직접 실행) 빌드하면 `generate_context!`가 `devUrl`을 쓰기 때문이다. `app/dist`·`gen/`·`permissions/autogenerated/`를 모두 치운 깨끗한 상태에서도 `cargo clippy/test -p chzzk-app`이 통과하고 두 생성 폴더가 다시 만들어졌다. 따라서 `cargo clippy/test --workspace`는 프런트 빌드 없이 돈다. `pnpm tauri build`만 `beforeBuildCommand`로 `dist`를 먼저 만든다.
7. **§15-1 확인: tokio `Handle`.** `tauri::async_runtime::handle().inner().clone()`으로 `tokio::runtime::Handle`을 얻는다(`chzzk_app_lib::tokio_handle`, setup에서 한 번 호출). 앱 crate는 `tokio`(features `rt`)를 직접 의존한다.
8. **§15-1 확인: TLS provider.** 현행 유지(aws-lc-rs). `cargo tree -i ring --target all`은 출력 없음(ring을 끌어오는 crate가 없다). `cargo tree -i aws-lc-sys`는 `aws-lc-rs → rustls → reqwest → chzzk-core` 한 갈래뿐이다. tauri 2.12.1도 `reqwest` 0.13.5를 쓰지만 TLS feature 없이 쓰므로 `-p chzzk-app`에는 `rustls`·`aws-lc-sys`가 없다. 코어를 셸에 붙이면 같은 0.13.5라 한 벌로 합쳐질 것으로 보며, §15-11에서 `cargo tree -i aws-lc-sys -p chzzk-app`로 다시 확인한다.
9. **§15-1 확인: 권한 식별자 형식.** `build.rs`의 `AppManifest::new().commands(&["app_info"])`로 생성된 `gen/schemas/desktop-schema.json`에 `allow-app-info`·`deny-app-info`가 있다. 접두사 없는 `allow-<kebab-command>` 형식이 §11과 같다. 골격의 capabilities는 `core:default` + `allow-app-info`다. `gen/`과 `tauri-build`가 매 빌드 다시 쓰는 `permissions/autogenerated/`는 `.gitignore`에 둔다.
10. **§15-1 확인: `app_log_dir`.** macOS 실측 `~/Library/Logs/io.github.chnu-kim.chzzk-downloader`(debug 빌드 setup에서 출력). Windows·Linux는 §15-11 로그 배선 때 확인한다.
11. **§15-1 확인: CSP(정적 확인만).** `pnpm build` 결과 `dist/index.html`에 인라인 `<script>`·`<style>`·`style=`가 없고 JS·CSS가 `/assets/*` 파일로만 나온다. `pnpm tauri build --debug --no-bundle` 바이너리와 `pnpm tauri dev`가 창을 띄우는 것까지 확인했지만 웹뷰 콘솔을 CLI에서 읽을 수 없어 **런타임 CSP 위반 여부는 확인하지 못했다**. §15-11에서 개발자 도구로 다시 본다. `devCsp`는 아직 두지 않는다(dev에서 Vite가 주입하는 `<style>`이 막히면 그때 더한다).
12. **§15-1 pnpm·도구 버전.** `packageManager: "pnpm@12.9.1"`(로컬 pnpm 10.28이 자동 전환함). `typescript ~6.0`(6.0.3). `vite.config.ts`는 `process`를 쓰므로 `tsconfig.node.json`(`@types/node` 24.19.1)으로 따로 검사하고 `pnpm check`가 `svelte-check`와 `tsc -p tsconfig.node.json`을 함께 돈다. vitest는 §15-12보다 앞당겨 `tauri.conf.json` 불변식 테스트 하나로 시작한다(`pnpm test`가 빈 상태로 실패하지 않게).
13. **§15-1 아이콘.** 치지직 로고·브랜드 색 없이 청록 바탕 아래 화살표의 `icons/icon-source.svg`를 만들고 `pnpm tauri icon`으로 생성했다. 데스크톱 전용이라 `android/`·`ios/` 산출물은 커밋하지 않는다.
14. **§15-2 bindings 생성 방식.** `#[ts(export)]`와 `.cargo/config.toml`(`TS_RS_EXPORT_DIR`·`TS_RS_LARGE_INT`)을 쓰지 않는다. `#[ts(export)]`는 `cargo test`마다 파일을 고쳐 써서 "bindings가 최신인가" 검사를 스스로 통과시킨다. 대신 `chzzk_shell::bindings::export(dir)`가 `ts_rs::Config::new().with_large_int("number")`로 루트 타입과 의존 타입을 모두 쓰고 `index.ts`(`export type * from "./X"`)를 만든다. `tests/bindings.rs`가 임시 폴더에 만든 결과와 커밋된 `app/src/lib/bindings`를 파일 목록·내용 양쪽으로 비교한다(낡은 파일도 잡는다). 다시 만들기: `UPDATE_BINDINGS=1 cargo test -p chzzk-shell --test bindings`. 그래서 §14 CI의 `git diff --exit-code app/src/lib/bindings`는 `cargo test`가 대신한다. derive만 해도 `output_path`가 생기는 것은 ts-rs-macros 12.0.1 소스로 확인했다.
15. **§15-2 `JobId`.** `pub type JobId = u64` 대신 newtype `pub struct JobId(pub u64)`. 타입 별칭은 TS 정의가 생기지 않아 `api.ts`가 `JobId`를 import할 수 없다. serde newtype이라 JSON은 그대로 숫자이고 TS는 `export type JobId = number`다. (`#[serde(transparent)]`는 ts-rs가 경고를 내므로 붙이지 않는다. 붙이지 않아도 직렬화 모양은 같다.)
16. **§15-2 코어 타입의 TS 모양.** `#[ts(type = "...")]` 문자열 대신 셸 미러 타입(`PlaybackKindTs` 등, 코어와 같은 serde 속성, `#[ts(rename = "PlaybackKind")]`)을 `#[ts(as = "...")]`로 붙인다. 이름 있는 TS 타입과 import가 생기고, 미러와 코어의 직렬화가 같은지는 `tests/dto_json.rs`(§15-3)가 검사한다.
17. **§15-2 `RequestKind`.** 코어 `RequestKind`는 `Serialize`가 아니어서 셸 `RequestKindDto`(`"api"|"mpd"|"media"`, TS 이름 `RequestKind`)로 옮긴다.
18. **§15-2 `AppError` 세부.** `Serialize`와 함께 `Deserialize`도 붙인다(`jobs.json`의 `lastError`). 셸 오류 생성자는 `job_not_found`·`duplicate_output`·`invalid_input`·`file_missing`(payload `path`)·`not_logged_in`·`not_own_content`·`ownership_unknown`·`internal`이고 모두 `resumable = false`·`stage = None`이다. 작업 오류는 `AppError::from(e).at(Stage::Download)`로 단계를 붙인다. `Encrypted`·`Unsupported`·`Parse`·`SourceChanged`·`LengthMismatch` 등은 §5대로 payload가 없고 `message`(코어 Display)에 세부가 있다. `Network` 표본을 만들려고 `reqwest`를 dev-dependency로 둔다(잘못된 주소의 `build()` 오류, 네트워크 없음).
19. **§15-3 `ContentKind`.** 코어 `ContentKind`에는 `rename_all`이 없어 `"Video"`·`"Clip"`으로 직렬화된다. §5·§7.1이 적은 `"video"`·`"clip"`이 되도록 셸 `ContentKindDto`(camelCase, TS 이름 `ContentKind`, `From<ContentKind>`)를 `JobDto.kind`·`ContentMetaDto.kind`에 쓴다. 코어는 바꾸지 않는다. `ContentRef`·`PlaybackKind`·`Phase`는 코어 직렬화 그대로이고 미러(`ContentRefTs`·`PlaybackKindTs`·`PhaseTs`)는 TS 모양에만 쓴다.
20. **§15-3 `defaultQualityIndex`.** `usize` 대신 `u32`(TS `number`). 플랫폼마다 폭이 다른 타입을 DTO에 두지 않는다.
21. **§15-3 `SettingsPatch.downloadFolder`.** `Option<Option<String>>` 대신 `Nullable<String>`(`Keep`·`Clear`·`Set`). serde는 `null`을 바깥 `None`으로 읽어 키 없음과 구분하지 못하고, `deserialize_with`는 ts-rs가 읽지 못해 빌드마다 경고를 낸다. TS 모양은 `downloadFolder?: string | null`이다. 나머지 패치 필드도 `?:`(키 없음 = 그대로, `null`도 그대로)다.
22. **§15-3 §16 설정 필드.** `SettingsDto`·`SettingsPatch`에 `maxParallelDownloads`(1~3, 기본 2)와 `autoResumeInterrupted`(기본 꺼짐)를 지금 넣어 bindings가 나중에 흔들리지 않게 한다. 코어 `UserSettings` 필드 추가(`#[serde(default)]`)와 `UserSettings` → `SettingsDto` 변환·패치 적용(범위 자르기 포함)은 그것을 쓰는 §15-9 `SettingsService`에서 한다.
23. **§15-3 DTO 보조 함수.** `ResolvedDto::new(url, &Resolved, last_label, platform, ownership)`(서명 URL을 버리고 `default_filename`에서 `.mp4`를 뗀다), `ProgressDto: From<&Progress>`(튜플 평탄화), `ContentMetaDto`·`QualityDto`·`RecentVodDto`·`LegacyImportDto`의 `From`, `OnExisting` → `DuplicatePolicy`, `JobStatus::is_active`(중복 검사 대상 다섯 상태), `AuthStatusDto::disabled()`를 DTO 옆에 둔다. `EnqueueRequest`·`SettingsPatch`는 `Deserialize`만, `JobStatus`·`OnExisting`·`ContentKindDto`는 `jobs.json`에 쓰므로 양방향이다.
24. **§15-4 Backend와 가짜 Backend.** `Backend`는 §3 시그니처 그대로이고 `impl Backend for Chzzk`가 컴파일되는 것 자체가 `Chzzk`의 두 future가 `Send`라는 검사다. `tests/backend.rs`는 여기에 더해 매니저가 spawn할 모양(`Arc<B>`와 `Arc<dyn Fn(Progress)>`를 async 블록으로 옮겨 빌려 넘김)이 `Send + 'static`인지를 반환 타입 경계로 고정한다(그래서 `clippy::manual_async_fn`을 그 두 함수에만 허용). 가짜(`tests/common/fake.rs`)는 대본을 **출력 경로별 줄** → 공용 줄 → 기본 `Completed{bytes: 마지막 진행률}` 순으로 고른다(동시 작업의 시작 순서에 기대지 않으려고). 단계는 `Progress`·`Sleep`·`Hold(Notify)`·`WaitCancel`이고 대기 단계는 모두 취소 토큰을 함께 기다려 `Err(Cancelled)`로 끝난다. 호출 기록과 동시 실행 수(`active`·`max_active`)를 남겨 §15-7의 동시성 상한 검사에 쓴다. 대본이 없는 `resolve`는 패닉 대신 `Parse` 오류다. `tokio`(`test-util`)는 아직 dev-dependency뿐이고 셸 본체 의존은 매니저(§15-7)에서 더한다.
25. **§15-2~4 리뷰 반영.** (가) 미러(`PlaybackKindTs`·`PhaseTs`·`ContentRefTs`)에 `_` arm 없는 `From<코어>`를 두고 `tests/dto_json.rs`의 미러 검사를 그 변환으로 돌린다. 코어에 변형이 늘면 셸 컴파일이 깨진다(16·19 보완). (나) `ProgressDto`·`ContentMetaDto`·`QualityDto`의 `From`은 코어 구조체를 `..` 없이 분해하고, 테스트가 코어 JSON과 DTO JSON을 필드 단위로 맞춰 본다(빠진 필드 검출). (다) **HLS playlist 암호화는 `encrypted`.** 코어는 미디어 playlist의 `EXT-X-KEY`(METHOD≠NONE)를 `Unsupported::Encrypted`(kind `unsupported`)로 돌려준다. 사용자에게는 정보 API의 `EncryptedVod`와 같은 "보호된 영상"이므로 셸 `AppError`가 이 변형만 `code: encrypted`로 올린다(§9 문구 "보호된 영상이라 받을 수 없어요", 우회·문제 보고 안내 없음). `message`는 코어 Display 그대로, `resumable = false`, payload 없음. 코어 `kind()`는 바꾸지 않는다. 나머지 `Unsupported`는 `unsupported`. (라) 가짜 Backend가 `download` 요청 전체를 `download_requests()`로 남긴다(§15-8의 "건너뛴 작업 이어받기 = `overwrite`", 추가 시점 `concurrency` 유지 검사용). `DownloadRequest`가 `PartialEq`가 아니라 `Call::Download(PathBuf)`는 그대로 둔다.
26. **§15-5 `JobStore` 세부.** (가) `JobRecord`에 `discardOnStart`(기본 false)를 더한다. `restart`로 추가·재개한 작업이 시작하기 전에 앱이 꺼지면 reconcile 뒤 이어받기가 옛 `.part`를 쓰게 되므로, "처음부터"를 저장해 두고 태스크가 `discard_partial`을 마친 뒤 false로 저장한다. (나) `partialBytes`·`missing`은 `#[serde(skip)]`로 저장하지 않는다. 시작 때 reconcile, 실행 중에는 매니저가 실제 파일로 다시 채운다. (다) 깨진 파일은 JSON 오류·최상위가 object가 아님·`v != 1`(모르는 형식 버전)이고 `jobs.json.bad-{ts}`(같은 초면 `-1`, `-2` …)로 옮긴다. 권한 같은 읽기 오류는 옮기지 않고 `Io`다. (라) 읽을 때 `nextId`를 저장된 가장 큰 id + 1 이상으로 맞춘다. (마) `concurrency`는 `to_request()`에서 1~8로 자른다. `ContentRef`·`PlaybackKind`는 코어 serde 그대로 쓴다(`Sidecar`와 같은 모양).
27. **§15-6 reconcile 세부.** `jobs::reconcile(&mut JobsFile)`은 파일 시스템만 읽는 함수이고 저장은 매니저가 한다. `paused`·`interrupted`·`failed`(1행에서 `interrupted`가 된 것 포함)의 `partial_bytes`는 `jobs::partial_bytes`로 정한다: `.part`가 파일로 있고 sidecar가 읽히며 `same_job`일 때만 `committed_len`이다(`.part`가 더 길어도 크래시 불변식대로 `committed_len`). 매니저도 작업이 멈출 때 같은 함수를 쓴다. `check_output`의 `partial.bytes`(sidecar가 없으면 `.part` 길이)와는 규칙이 달라 함수를 나눈다. `completed`·`skipped`는 `partial_bytes`를 보지 않는다(→ `skipped`는 본다, 53).
28. **§15-7 앞당김: 코어 `UserSettings` 필드.** 22번은 코어 필드 추가를 §15-9로 미뤘지만, 매니저가 동시 작업 수와 자동 이어받기를 설정에서 읽어야 하므로 §15-7 앞에 코어 커밋으로 더했다(core.md 구현 중 변경 53). §1·§3의 "코어 API는 바꾸지 않는다"의 예외이며 §16 사용자 답변이 근거다. `UserSettings` → `SettingsDto` 변환·패치 적용은 그대로 §15-9다.
29. **§15-7 매니저 큐 세부.** (가) **동시 작업 수는 상수가 아니라 설정이다**(§16). `ManagerConfig.max_parallel`(설정 `max_parallel_downloads`)로 시작하고 `set_max_parallel(n)`(1~3으로 자름)으로 바꾼다. 늘리면 바로 `pump()`하고, 줄여도 도는 작업은 멈추지 않으며 슬롯이 빌 때까지 새로 시작하지 않는다. `pausing`도 슬롯을 차지한다(태스크가 아직 연결·`.part` 잠금을 쥐고 있다). (나) FIFO는 id가 아니라 **줄 선 순서**(`queued`가 될 때마다 새 번호)다. 오래된 작업을 다시 시작하면 맨 뒤에 선다. (다) **이벤트 순서**: 상태 변경·`jobs.json` 쓰기·sink 전송을 모두 상태 잠금 안에서 한다(잠금 순서는 상태 → sink 하나). `Added`는 저장 뒤 `pump()` 전에 보내고, `Status(running)`은 태스크를 띄운 잠금 안에서 보내므로 다중 스레드 런타임에서도 태스크의 첫 `Progress`보다 먼저다. `subscribe`도 같은 잠금 안에서 sink를 바꾸고 스냅샷을 떠서 빠지거나 겹치는 이벤트가 없다. sink는 `EventSink::send -> bool`이고 클로저도 sink다. (라) **중복 방지**: `enqueue`가 `output_path`로 최종 경로를 먼저 계산한 뒤 활성 작업(`JobStatus::is_active`)과 비교한다. Windows·macOS는 대소문자를 무시해 비교한다(`manager::output_key`, NTFS·APFS 기본). 두 작업이 같은 파일을 마무리(rename)하는 Windows 경합을 여기서 막는다. macOS 유니코드 정규화 차이는 보지 않는다. (마) `enqueue(req, &JobDefaults{download_folder, segment_concurrency})`: 폴더는 요청 값(공백뿐이면 무시) → `JobDefaults.download_folder`이고, 절대 경로가 아니면 `invalidInput`이다. §6.2의 1단계(`OwnershipGate`)와 6단계(설정의 최근 VOD·마지막 화질 갱신)는 매니저가 `SettingsStore`를 모르게 하려고 command 쪽(§15-9 `SettingsService`, §15-11)에서 한다. (바) 작업 태스크는 바깥 태스크가 안쪽 다운로드 태스크를 기다리는 두 겹이라, 다운로드가 패닉해도 `failed{internal}`로 끝나고 다음 작업이 시작된다. (사) 실패의 `stage`는 마지막 진행률 단계로 정한다: 없음·`resolving`·`reresolving`이면 `resolve`, `downloading`·`finalizing`이면 `download`(코어가 단계를 따로 알려 주지 않는다. §9의 `authRequired` 문구 분기에 쓴다). 실패 항목은 마지막 진행률을 남기고(막대 표시), 완료·건너뜀은 비운다. `finishedAt`은 완료·건너뜀에만 둔다. (아) `jobs.json` 쓰기 실패는 로그만 남기고 작업을 멈추지 않는다(다음 전이 때 다시 쓴다). (자) 셸이 `tokio`(`rt`·`sync`·`time`)와 `tracing`을 본 의존성으로 쓴다.
30. **§15-8 매니저 제어 세부.**
    - **`quit`이 멈춘 작업은 `interrupted`로 저장한다**(§6.1의 "`paused`로 저장"을 바꾼다). 자동 이어받기(§16)와 B1 배너는 `interrupted`만 보므로, `paused`로 두면 정상 종료 뒤에는 자동 이어받기가 아무것도 하지 않고 D1의 "다음에 앱을 열면 이어받을 수 있어요"와도 어긋난다. §6.3 표의 `interrupted` 정의("앱이 꺼질 때 받던 항목")와도 맞는다. 사용자가 이미 일시정지한(`pausing`) 작업은 `paused`로 남고 자동으로 이어받지 않는다. 3초(`QUIT_TIMEOUT`) 안에 멈추지 않은 작업도 `interrupted`다. `queued`는 그대로 저장되고 다음 시작 때 reconcile이 `interrupted`로 바꾼다. `quit` 뒤에는 `pump()`하지 않는다. `app.exit(0)`은 앱 어댑터가 부른다.
    - **재시작 후 자동 이어받기**: `ManagerConfig.auto_resume`(설정 `auto_resume_interrupted`)이 켜져 있으면 `open`이 reconcile·저장 뒤 `resume_interrupted()`로 `interrupted`를 id 순으로 다시 줄 세운다. 같은 메서드를 앱이 따로 부를 수도 있다(배너 "모두 이어받기"는 §4대로 프런트가 `resume_job`을 반복해도 된다). 꺼져 있으면 §6.3대로 배너를 기다린다.
    - **중복 검사는 `resume`도 한다.** `failed`·`completed`·`skipped`는 활성이 아니라 새 작업이 같은 경로를 가져갈 수 있으므로, 옛 작업을 다시 줄 세울 때 다른 활성 작업과 경로가 겹치면 `duplicateOutput`이다(자동 이어받기는 그 작업을 건너뛴다).
    - **`resume`**: `paused`·`failed`·`interrupted`·`skipped` → `queued`(줄 맨 뒤), `skipped`는 `onExisting = overwrite`로 저장. `restart`면 `discardOnStart = true`와 진행률·`partialBytes`를 비운다. `queued`·`running`·`pausing`에는 아무것도 하지 않고(배너의 반복 호출이 안전하다) `completed`는 `invalidInput`이다.
    - **`pause`**: `running` → `pausing`(토큰 취소) → 태스크가 `Cancelled`로 끝나면 `paused`, `queued` → 바로 `paused`. 그 밖의 상태는 아무것도 하지 않는다. 멈추는 중 코어가 진짜 오류로 끝나면 오류가 이긴다(`failed`).
    - **`remove`**: 표의 `queued`도 `discard_partial`한다(다시 줄 선 작업은 `.part`가 있을 수 있다). `running`·`pausing`은 `pausing`을 한 번 보낸 뒤 취소 → 잠금 밖에서 `JoinHandle` 대기 → `discard_partial` → `Removed`. 지우는 동안(`removing`) 다른 동작은 그 작업을 없는 것(`jobNotFound`)으로 보지만 중복 검사에는 남는다. `.part`를 지우지 못하면(다른 프로그램의 잠금 등) 오류를 돌려주고 레코드를 멈춘 상태(`paused`)로 남겨 다시 지울 수 있게 한다. `completed`·`skipped`는 레코드만 지운다.
    - **`partial_bytes`**는 작업이 멈출 때마다(`paused`·`interrupted`·`failed`, 대기 중 일시정지 포함) 구현 중 변경 27의 `jobs::partial_bytes`로 실제 파일에서 채운다. resolve 실패처럼 `resumable = false`여도 `.part`가 남으면 채워진다.
    - **`check_output`**: `output::check_output`(파일 시스템 판정)과 매니저의 `check_output(folder, default_folder, …)`(활성 경로를 잠금 안에서 떠 둔 뒤 잠금 밖에서 판정)으로 나눴다. 폴더 규칙은 `enqueue`와 같다(공백뿐이면 기본 폴더, 상대 경로는 `invalidInput`). `truncated`는 정리된 이름이 입력과 다르면 true다(사용자가 `.mp4`를 붙여도 true). `free_file_name`은 `" (n)"`이 들어갈 자리를 먼저 비워 200바이트 안에 두고, 완성 파일·`.part`·활성 작업을 모두 피하며 `(9999)`까지 찾는다. `partial`은 `.part`가 파일로 있을 때만이고 sidecar만 남은 것은 무시한다.
    - 그 밖의 공개 메서드: `clear_finished`, `output_of(id)`(`open_output`·`reveal_output`용), `running_count`(D1). 매니저 테스트에 다중 스레드 런타임 이벤트 순서 검사를 더했다(dev `tokio`에 `rt-multi-thread`). 가짜 Backend에 `UntilCancelled`(취소 뒤 계속)·`Linger`(취소 무시)·`Write`(파일 쓰기) 단계를 더해 "종료 대기 뒤 `discard_partial`" 순서와 `quit` 시간 초과를 검사한다.
31. **§15-7~8 자체 점검 수정.** (가) **중복 검사 열쇠를 경로 구성 요소로 정규화한다.** `output_key`가 문자열 그대로였으면 `D:/Videos\a.mp4`와 `D:\Videos\a.mp4`, `/x/./d/a.mp4`와 `/x/d/a.mp4`, 겹친·끝 구분자가 서로 다른 작업이 되어 한 `.part`에 두 작업이 붙을 수 있었다(옛 Go 설정의 `downloadFolder`는 친 그대로 저장돼 Windows에서 `/`가 흔하고, 폴더 선택기는 `\`를 준다). 이제 `components()`로 다시 조립한 뒤(Windows는 `/`·`\` 통일, 모든 OS에서 `.`·겹친 구분자 제거, `..`는 풀지 않음) Windows·macOS는 소문자로 비교한다. `check_output`의 `duplicateJobId`·`freeFileName`도 같은 열쇠를 쓴다. (나) 지우는 중(`removing`)인 작업에 다시 온 `remove`·`pause`·`resume`은 `jobNotFound` 대신 조용히 `Ok`다(두 번 누른 "취소"가 "앱을 다시 시작해 주세요" 토스트가 되지 않게). `output_of`는 여전히 `jobNotFound`다. (다) `discardOnStart`가 켜진 작업의 `partialBytes`는 늘 `None`이다(다음 시작 때 지울 `.part`를 "이어받기" 버튼으로 보여 주지 않는다). (라) `finish`는 `Status`를 보낸 뒤 완료 항목 정리(`Removed`)를 한다. 방금 끝난 작업이 정리 대상이 되는 경우에도 프런트에 유령 항목이 남지 않는다.
32. **§15-5~8 리뷰 반영: `jobs.json`은 잠금 밖 쓰기 스레드가 쓴다**(29(다)의 "쓰기도 잠금 안" 일부를 바꾼다). `atomic_write`는 `fsync`와 Windows rename 재시도(100+200+400+800+1600ms `thread::sleep`)를 하므로 잠금 안에서 쓰면 백신이 `jobs.json`을 잠깐 잡을 때 상태 잠금을 약 3초 쥐고, 그동안 다른 작업의 진행률 콜백(런타임 워커)과 command가 모두 멈췄다. 이제 잠금 안에서는 `JobStore::encode`로 바이트만 만들어 `writer::JobsWriter`(전용 스레드 하나)에 넘기고, 쓰기 스레드는 **가장 최근 목록만** 쓴다(밀린 중간 상태는 건너뛴다). 제출이 잠금 안이라 제출 순서 = 전이 순서이고 오래된 목록이 새 목록을 덮지 않는다. 이벤트 순서는 디스크 쓰기와 무관하므로 그대로다. `DownloadManager::flush()`는 부른 시점까지 제출된 목록의 쓰기 **시도**를 기다리고(실패해도 돌아온다), `quit`은 마지막 저장 뒤 `spawn_blocking`으로 `flush`해 `app.exit` 전에 디스크에 닿게 한다. 매니저를 버리면 남은 것을 쓰고 스레드를 끝낸다. 쓰기 실패는 여전히 로그만 남기고 다음 전이 때 다시 쓴다(29(아)). 테스트용으로 `JobStore::with_write_fn`(숨김)이 마지막 파일 쓰기를 바꾼다. 테스트: 쓰기가 막힌 동안 추가·진행률·일시정지가 기다리지 않고 풀린 뒤 최근 것만 쓰는지, 데이터 폴더 자리에 파일이 있어 쓰기가 실패해도 작업이 끝나고 다시 쓸 수 있게 되면 다음 전이 때 쓰는지(`tests/manager_persist.rs`). 테스트 도구의 `jobs_json()`·`reopen()`은 먼저 `flush`한다.
33. **§15-5~8 리뷰 반영: `remove`·폴더 검사.** (가) **경로를 넘긴 `failed`를 지울 때 `.part`를 건드리지 않는다.** `failed`는 활성이 아니라 새 작업이 같은 최종 경로를 가져갈 수 있는데(30 "중복 검사는 `resume`도 한다"), 옛 작업의 `remove`가 `discard_partial`을 부르면 새 작업이 멈춰 있을 때(`.part` 잠금이 없을 때) 그 작업의 `.part`·sidecar를 지워 이어받기가 처음부터가 됐다. 이제 다른 활성 작업이 그 경로를 쥐고 있으면 레코드만 지운다. 또 지우는 중(`removing`)인 작업은 상태와 상관없이 중복 검사(`enqueue`·`resume`·`check_output`)에서 경로를 차지한다(30의 "지우는 동안 중복 검사에는 남는다"를 `failed`에도 지킨다). (나) **종료 중의 `remove`는 받는 중 작업에 아무것도 하지 않는다.** `quit`이 태스크 핸들을 먼저 가져가므로 그 사이 온 `remove`는 기다릴 핸들이 없어 태스크가 `.part`를 쥔 채 `discard_partial`을 부르고, 실패하면 살아 있는 태스크를 `paused`로 적어 결국 `failed{internal}`이 됐다. 스케줄러가 꺼진 뒤(`quit` 뒤) `running`·`pausing`의 `remove`는 조용히 `Ok`이고 작업은 `quit`대로 `interrupted`가 된다(앱이 곧 꺼진다). 멈춘 작업의 `remove`와 다른 제어는 종료 중에도 그대로다. (다) **UTF-8이 아닌 저장 폴더는 `invalidInput`**("저장 폴더 경로에 쓸 수 없는 글자가 있습니다: …"). serde는 `PathBuf`를 UTF-8로만 직렬화하므로 그런 작업 하나가 `jobs.json` 저장 전체를 실패시켰다. 요청 폴더는 이미 문자열이라 기본 폴더(Linux XDG 동영상 폴더 등)만 걸린다. `enqueue`와 `check_output`이 같은 `resolve_folder`를 쓴다. 테스트: `remove_failed_keeps_partial_of_new_owner`, `remove_during_quit_is_ignored`, `non_utf8_default_folder_is_rejected`(unix).
34. **§15-9 `SettingsService` 세부.**
    - **기본 저장 폴더**(§16): `AppPaths::new(config, data, log, video, downloads)`가 OS 폴더를 인자로 받아 `video/치지직` → `downloads/치지직` → `{data}/downloads`로 정한다(`services::default_download_folder`). OS 폴더는 **절대 경로이고 UTF-8이며 실제로 있는 폴더**일 때만 쓴다. "없으면"을 "폴더가 없으면"으로 읽었고, UTF-8이 아닌 폴더는 매니저가 거부하므로(33(다)) 처음부터 고르지 않는다. 앱은 Tauri `video_dir()`·`download_dir()`의 `ok()`를 넘긴다.
    - **클라이언트 교체 순서**: 새 `Chzzk`를 먼저 만들고(헤더로 보낼 수 없는 쿠키면 여기서 실패) → 저장하고 → 바꿔 끼운다. 저장이 실패하면 바꾸지 않는다. 예외로 `clear_naver_cookies`는 쿠키 파일을 지운 뒤 설정 저장 전에 바꾼다(파일이 이미 없으므로 쿠키 없는 클라이언트가 맞다). 쿠키에 닿는 변경(`update`·`set_naver_cookies`·`clear_naver_cookies`·`import_legacy`)은 `ops` 잠금 하나로 줄 세운다. 매니저에는 `client_fn()`(부를 때마다 그 시점 클라이언트)을 넘긴다.
    - **패치 규칙**: `useNaverCookies: true`는 저장된 쿠키가 없으면 `invalidInput`(S2 "저장된 값이 없으면 켤 수 없다"). `set_naver_cookies`는 사용 여부를 바꾸지 않는다(켜져 있으면 새 값으로 바로 교체). `downloadFolder` 문자열은 앞뒤 공백을 지운 절대 경로여야 하고(빈 값·상대 경로는 `invalidInput`), 기본 폴더로 되돌리기는 `null`이다. 거부된 패치는 아무 필드도 바꾸지 않는다.
    - **동시 작업 수 반영**: `update_and_apply(patch, &manager)`가 저장 뒤 `set_max_parallel`을 부른다. 자동 이어받기는 매니저를 열 때만 읽으므로 앱 setup은 `SettingsService`를 먼저 열고 그 값으로 `ManagerConfig`를 만든다.
    - **작업 추가**: `services::enqueue(settings, gate, manager, req)`가 §6.2의 1단계(게이트)·폴더 기본값(`job_defaults`)·6단계(`record_enqueued`: 마지막 화질 + `add_recent_vod`를 `update` 한 번으로)를 묶는다. 설정 저장 실패는 작업이 이미 추가됐으므로 로그만 남긴다. `resolve`도 `SettingsService::resolve`(지금 클라이언트 + 마지막 화질 라벨, `ownership: unchecked`)로 둔다.
    - **깨진 `credentials.json`·쓸 수 없는 저장 쿠키**는 시작을 막지 않는다. 로그만 남기고 쿠키 없는 클라이언트로 시작하며 `naverCookiesSaved = false`다.
    - **첫 실행 후보는 한 번**: `settings.json`이 없었고 `imported_from`이 없을 때만 `import_legacy(legacy_dir)`를 미리 읽는다. 후보를 찾으면 **바로 빈 패치로 `settings.json`을 만든다**. 그러지 않으면 D3를 닫고 아무것도 바꾸지 않은 사용자에게 다음 실행마다 다시 묻는다. 같은 실행 안에서는 적용할 때까지 `legacy_candidate()`가 계속 돌려준다(웹뷰 새로고침). 옛 파일이 깨졌으면 로그만 남기고 후보가 없다. 후보가 없을 때 `import_legacy(null)`은 `Ok(None)`, 고른 폴더는 절대 경로여야 한다.
    - **가져오기 적용은 병합이다**: 옛 값이 있는 항목(폴더·마지막 화질·마지막 주소)만 덮고 최근 VOD는 지금 목록 뒤에 옛 목록을 붙여 5개로 자른다. `segmentConcurrency`·`maxParallelDownloads`·`autoResumeInterrupted`는 그대로다(코어 `LegacyImport.settings`를 통째로 쓰면 기본값으로 되돌아간다). 옛 쿠키가 있으면 저장하고 옛 "성인 컨텐츠" 값으로 사용 여부를 정한다. 헤더로 보낼 수 없는 옛 쿠키는 건너뛰고 `warnings`에 남긴다.
    - **`OwnershipGate`**(`ownership.rs`)는 Phase 2에서 늘 허용한다. Phase 3용 판정 `ownership::verdict(is_own_content 결과)`만 미리 두었다: `Some(false)` → `notOwnContent`, `None` → `ownershipUnknown`(§16 fail closed). 클립의 `ownerChannel` 기준은 코어 `ContentMeta.channel_id`가 이미 지킨다.
    - **비밀 누출 테스트**(`tests/secrets.rs`): 실제 코어 클라이언트를 wiremock에 붙여 조회 성공·실패와 다운로드 성공·실패를 끝까지 돌린다. 쿠키가 API 요청에 실렸고 `credentials.json`에 있다는 양성 대조를 먼저 확인한 뒤, `NIDSECRET`이 로그(`chzzk_core`·`chzzk_shell` TRACE)·모든 `JobEvent` JSON·`SettingsDto`·`ResolvedDto`·`AppError`·`settings.json`·`jobs.json`·`Debug` 출력에 없는지 본다. 로그는 전역 subscriber로 모든 스레드(쓰기 스레드·`spawn_blocking`)에서 잡는다(그 테스트 바이너리에는 테스트가 하나뿐이다). 쿠키 값을 일부러 로그에 쓰면 이 테스트가 실패하는 것을 확인했다. `SettingsService`의 `Debug`는 직접 구현했다(폴더만 보인다). dev 의존성에 `wiremock` 0.6.5와 `tracing-subscriber` 0.3.23을 더했다.
    - 코어 `UserSettings` 필드 두 개와 그 테스트는 28번에서 이미 더했다.
35. **§15-10 shell CI.** `.github/workflows/app.yml`에 `shell` 작업만 둔다(3 OS, `core.autocrlf=false`, rust-cache `workspaces: ". -> target"`, `AWS_LC_SYS_PREBUILT_NASM=1`). §14와 다른 점: (가) `git diff --exit-code app/src/lib/bindings` 대신 `cargo test -p chzzk-shell`의 `tests/bindings.rs`가 최신 검사를 한다(14번). (나) `paths`에 `testdata/**`를 더했다(`tests/secrets.rs`가 코어 fixture를 읽는다). (다) `cargo fmt --all --check`도 돈다(`app/src-tauri`만 바꾼 PR은 `core.yml`이 돌지 않는다). (라) §14의 "`chzzk-app`은 `pnpm build` 뒤에만 컴파일된다"는 6번 실측과 어긋나므로 CLAUDE.md에는 "`app/dist` 없이도 `cargo`로 컴파일되지만 Linux는 webkit 패키지가 필요해 CI `shell` 작업은 `-p chzzk-shell`만 돈다"로 적었다. CLAUDE.md 게이트는 `--workspace` clippy·test + `pnpm check`·`pnpm test`다. 로컬에서 `actionlint`로 검사했고, 아직 푸시하지 않아 3 OS 녹색은 확인하지 못했다(PR A를 올릴 때 확인).
36. **§15-9~10 리뷰 반영: `SettingsService` 쿠키·동시 작업 수.** (가) **가져오기는 저장된 쿠키를 덮지 않는다.** 34의 "옛 쿠키가 있으면 저장하고 옛 성인 컨텐츠 값으로 사용 여부를 정한다"를 바꾼다. 옛 쿠키는 `credentials.json`에 읽을 수 있는 쿠키가 **없을 때만** 저장하고 그때만 옛 값으로 사용 여부를 정한다. 이미 있으면 지금 쿠키·사용 여부를 지키고 `warnings`에 "이미 저장된 네이버 로그인 정보가 있어 옛 쿠키는 가져오지 않았습니다"를 남긴다(`hasCookies: false`). 깨진 `credentials.json`은 없는 것으로 본다. (나) **가져오기의 설정 저장이 실패하면 방금 저장한 옛 쿠키를 지운다**(전에는 저장된 쿠키가 없었으므로 되돌리기 = 지우기). 클라이언트는 바꾸지 않는다. (다) **`useNaverCookies`는 실제로 쿠키를 보낼 때만 `true`다**(`설정 && 지금 클라이언트에 쿠키`). 깨진 `credentials.json`으로 쿠키 없이 시작하면 S2에 꺼짐으로 보이고, `authRequired` 문구도 "쿠키 꺼짐" 행을 고른다. `useNaverCookies: true` 패치는 이 실제 값과 비교하므로 조용히 무시되지 않고 쿠키를 다시 읽는다(없으면 거부). 설정 파일의 값은 고치지 않는다(일시적으로 못 읽은 경우 다음 실행에 되살아난다). (라) **`update_and_apply`는 저장과 `set_max_parallel`을 `ops` 잠금 하나 안에서 한다.** 동시에 온 패치가 저장 순서와 다른 순서로 매니저에 반영되던 경합을 막는다. 경합 창이 `fsync` 뒤 수 마이크로초라 스레드 테스트로 재현되지 않아 회귀 테스트는 두지 않았다. (마) **쿠키 검사 실패만 "쿠키 값에 쓸 수 없는 문자"로 바꾼다.** `Chzzk::new`의 `Error::Settings`(코어는 쿠키 헤더 검사에서만 낸다)만 쿠키 문제로 보고, HTTP 클라이언트 초기화·엔드포인트 오류는 그대로 돌려준다(`set_naver_cookies`·`import_legacy`). 정상 설정에서는 다른 실패를 만들 수 없어 테스트는 없다. 테스트: `import_keeps_saved_cookies`, `failed_import_rolls_back_cookies`, `corrupt_credentials_start_without_cookies` 확장.
37. **§15-11 command 배선 세부.**
    - **command 판단은 셸 `App`(`crates/shell/src/app.rs`)에 둔다.** §4의 `App { manager, settings, paths, gate }`를 셸로 옮겨 `App::open`(설정 → 그 값으로 매니저, 34)·`info`·`update_settings`(`update_and_apply`)·`check_output`(폴더가 없으면 **설정 폴더**, `enqueue`와 같은 `job_defaults().download_folder`)·`enqueue`(`services::enqueue`)·`open_target`·`reveal_target`을 webkit 없이 검사한다(`tests/app.rs`). `open_output`은 최종 파일이 없으면 `fileMissing`, `reveal_output`은 파일 → 폴더 → 둘 다 없으면 `fileMissing`(폴더 경로)이다. 앱의 `commands.rs`는 인자를 풀어 부르는 한 줄과 플러그인 호출만 남는다. 모든 command는 `async`다(동기 command는 메인 스레드에서 돌아 설정 `fsync`가 창을 멈춘다). `AppHandle`을 받는 command는 mock 런타임 테스트를 위해 `R: Runtime` 제네릭이다.
    - **코어 `VERSION`.** `AppInfo.coreVersion`을 채우려고 코어에 `pub const VERSION = env!("CARGO_PKG_VERSION")` 한 줄을 더했다(코어 API 추가만).
    - **capabilities는 `core:default` + 앱 command 21개뿐이다.** §15-11 지시문은 dialog·opener·notification·clipboard-manager(읽기)를 capabilities에 적었지만, 네 플러그인 모두 Rust command 안에서만 부르므로 JS 권한은 쓰는 곳 없이 공격 면만 넓힌다(§0·§11, 2번). §16의 "`clipboard-manager` 읽기 권한만"은 **Rust command `clipboard_link`**로 지킨다: Rust가 `read_text`로 읽고 `app::chzzk_link`가 공백으로 나눈 토큰 중 `parse_content_url`이 받는 첫 토큰만 돌려준다(4096바이트 넘는 글은 보지 않는다). 클립보드의 다른 글(비밀번호 등)은 웹뷰에 닿지 않고 로그에도 쓰지 않는다. 프런트는 창 포커스 때 이것을 부른다. 드래그 앤 드롭은 HTML5 `drop`이라 Rust 배선이 없다(5번).
    - **command 목록은 한 곳(`src/command_names.rs`)**이다(`generate_handler!` 목록과의 일치는 38(라)). `build.rs`(AppManifest)와 `lib.rs`(`COMMANDS`)가 `include!`로 함께 쓰고, `tests/ipc.rs`가 capabilities 권한 집합 = `core:default` ∪ `allow-<kebab>`(목록 전체)인지 검사한다.
    - **완료 알림(§16 OS 알림 + §6.1 `request_user_attention`)은 sink 밖 태스크가 한다.** 매니저는 상태 잠금을 쥔 채 sink를 부르고, 창 API·OS 알림은 메인 스레드를 오가므로 sink에서 부르면 메인 스레드의 창 닫기 처리(`running_count`가 같은 잠금)와 교착할 수 있다. `ChannelSink`는 `Status(completed)`의 제목을 큐(`Notifier`, 구독이 바뀌어도 하나)에 넣고 `channel.send(e).is_ok()`만 돌려준다. `spawn_notifier` 태스크가 main 창에 포커스가 **없을 때만** 주의 요청(`Informational`)과 OS 알림(제목 `치지직 다운로더`, 본문 copy deck `toast.completed` "'{title}' 다운로드를 마쳤어요")을 띄운다. 포커스가 있으면 프런트 토스트로 충분하다. 알림 끄기 설정은 v1에 없다. 문구 두 개가 Rust(`sink.rs`)에도 있어 copy deck과 함께 고쳐야 한다.
    - **창 닫기와 앱 종료.** `CloseRequested`(main)와 `RunEvent::ExitRequested { code: None }`(macOS Cmd+Q·Dock 종료는 창 닫기 없이 여기로 온다) 둘 다 `guard_close`를 거친다(38(가)·(나)·(다)에서 바뀜): `quit` 중이 아니고 `running_count() > 0`이면 막고 main 창을 앞으로 가져와 `close-requested`(`CloseRequestedPayload { running }`, ts-rs 바인딩 추가)를 보낸다. `quit` command는 `Quitting` 깃발을 먼저 세워 3초 대기 중 D1이 다시 뜨지 않게 하고, `manager.quit` 뒤 `app.exit(0)`(`code: Some(0)`이라 막지 않는다). `RunEvent::Exit`에서 `manager.flush()`로 쓰기 스레드에 밀린 `jobs.json`을 디스크에 닿게 한다(완료 직후 창을 닫는 경우). 실제 Cmd+Q가 `ExitRequested`로 오는지는 macOS에서 수동으로 확인해야 한다(§15-17 스모크).
    - **로그**(§7.3): `tracing-appender` daily·7개, 이름 `chzzk-downloader.YYYY-MM-DD.log`, 개발 빌드는 stdout에도. 필터 기본값에 `chzzk_app_lib=debug`를 더했다. 폴더를 먼저 만든다(없으면 appender가 오래된 파일 정리 중 오류를 찍는 것을 실측). 파일을 열지 못해도 앱은 뜬다. `WorkerGuard`는 managed state로 앱 수명 동안 둔다. 패닉 훅이 `tracing::error!` 뒤 기존 훅을 부른다.
    - **남은 command**: S2의 "설정 폴더 열기 / 로그 폴더 열기"(copy deck `settings.about.*`)는 JS에 opener 권한이 없으므로 §15-16에서 Rust command(예: `open_app_folder(kind)`)를 더해야 한다. 그때 `command_names.rs`·`handler`·capabilities를 함께 고친다.
    - **`pick_folder`**는 `spawn_blocking` 안에서 `blocking_pick_folder`, `initial`이 있으면 시작 폴더로 둔다. UTF-8이 아닌 폴더는 `invalidInput`(33(다)와 같은 이유).
    - **IPC 테스트**(`app/src-tauri/tests/ipc.rs`): `mock_builder` + `generate_context!(test = true)`로 실제 capabilities를 붙인다. camelCase 인자(`patch`·`nidAut`·`fileName`·`expectedKind`·`req`), `AppError` JSON(`code`·`resumable`·`stage`), main이 아닌 창에서 같은 command가 `not allowed`로 거부되는지(ACL이 실제로 걸린다), 받는 중인 작업이 있을 때만 닫기를 막고 `{running: 1}`을 보내는지, `quit` 중엔 막지 않는지(38에서 판정 함수만 보던 것을 mock 이벤트 루프로, `quit` 중엔 조용히 막는 것으로 바꿨다). dev 의존성 `tauri`(`test`)·`wiremock`·`url`·`tempfile`·`tokio`.
    - **확인한 것(macOS)**: `pnpm tauri build --debug --no-bundle` 바이너리를 띄워 setup이 끝까지 돌고 `~/Library/Logs/io.github.chnu-kim.chzzk-downloader/chzzk-downloader.2026-10-05.log`에 시작 로그가, `~/Library/Application Support/…/jobs.json`이 생기는 것, 기본 폴더가 `~/Movies/치지직`인 것. macOS는 config·data 폴더가 같다. TLS(8번 이월): `cargo tree -i aws-lc-sys -p chzzk-app`은 `aws-lc-rs → rustls → hyper-rustls → reqwest 0.13.5 → chzzk-core` 한 갈래, `ring`은 없다. **확인하지 못한 것**: 웹뷰 런타임 CSP 위반과 `pnpm tauri dev`의 `resolve` 수동 확인(CLI에서 웹뷰 콘솔·화면을 조작할 수 없고 프런트에 아직 `api.ts`·화면이 없다, §15-12~14에서 확인), Windows·Linux의 `app_log_dir`(10번), OS 알림이 서명 안 된 debug 빌드에서 실제로 뜨는지.
38. **§15-11 리뷰 반영: 종료·닫기 가드, 진행 Channel·배선 검사.**
    - (가) **`quit`은 한 번만 돈다.** `begin_quit`이 `Quitting.swap(true)`로 먼저 선 호출만 `manager.quit`을 돌리고 `true`를 돌려준다(그때만 `app.exit(0)`). 전에는 두 번째 호출(D1 `[닫기]` 두 번 누르기)이 첫 호출의 3초 대기 중에 빈 작업 집합으로 곧바로 끝나, 사용자 일시정지로 `pausing`인 작업을 `interrupted`로 저장하고(자동 이어받기가 켜져 있으면 다음 실행에 사용자 뜻과 달리 다시 받는다) 먼저 종료했다. **`quit` 중의 창 닫기·Cmd+Q는 D1 없이 조용히 막는다**(37의 "quit 중엔 막지 않는다"를 바꾼다): 막지 않으면 대기 중에 창이 닫히고 `RunEvent::Exit`로 프로세스가 끝나 마지막 상태 저장을 건너뛴다. 대기는 최대 3초 + flush이고 `app.exit`는 `ExitRequested { code: Some(0) }`만 보내고 `CloseRequested`를 보내지 않으므로(tauri-runtime-wry 2.12.1 `Message::RequestExit` 확인) 막는 시간은 마지막 flush가 멈추지 않는 한 유한하다. flush에는 시간 제한이 없고, `quit`이 도중에 패닉하면 `Quitting`이 선 채로 남아 닫기가 계속 막힌다. 둘 다 정상 경로에서는 일어나지 않아 코드는 더하지 않았다.
    - (나) **main 창이 이미 없으면 종료를 막지 않는다.** 판단을 순수 함수 `close_decision(quitting, running, has_main) -> Allow | PreventSilently | Ask(n)`로 뽑았다. 닫기 검사(작업 0개)를 통과해 창이 닫힌 뒤 경합으로 작업이 시작되면 이어 오는 `ExitRequested { code: None }`가 막혀 창 없는 프로세스만 남았다. 이제는 그대로 끝나고, 남은 `running`은 다음 실행의 reconcile(§7.1)이 `interrupted`로 바꾼다(파일은 코어 `committed_len` 불변식으로 안전). wry는 `Destroyed`를 Tauri에 먼저 알려 창 목록에서 지운 뒤 `ExitRequested`를 보내므로 `get_webview_window("main")`이 `None`이다. mock 런타임은 `Destroyed`를 보내지 않아 이 경우는 `lib.rs` 단위 테스트(`close_decision_table`)로만 본다.
    - (다) **창 닫기를 `RunEvent::WindowEvent`에서 막는다.** `Builder::on_window_event` 대신 `on_run_event` 한 함수가 `CloseRequested`(main)·`ExitRequested { code: None }`·`Exit`(flush)를 처리한다. wry의 `on_close_requested`는 창 리스너와 run 콜백에 같은 신호를 주고 둘 중 하나라도 막으면 막히므로 동작은 같고, mock 런타임은 run 콜백만 부르므로 IPC 테스트가 실제 처리를 돌린다(`closing_the_main_window_*`: mock 루프를 `run_return`으로 돌려 작업이 없으면 닫혀 끝나고, 받는 중이면 `{running: 1}`을 보내고 막는다. mock은 막지 않은 닫기 바로 뒤에 `ExitRequested { code: None }`을 보내므로 그 수가 0인지로 막힘을 본다. 작업을 멈추면 끝난다). Tauri가 macOS 개발 빌드의 `Ready`에서 Dock 아이콘을 AppKit으로 그리므로 루프 테스트는 한 번에 하나만 돈다(동시에 돌면 SIGTRAP을 실측).
    - (라) **IPC 테스트 보강.** `every_command_is_wired`: `COMMANDS` 전부를 main 창에서 불러 `not allowed`(ACL)도 `Command … not found`(처리기 없음)도 아님을 본다. command_names.rs·capabilities·`generate_handler!` 세 목록이 함께 맞아야 통과한다(`pick_folder`는 실제 창을 열지 않게 잘못된 인자로, `quit`은 종료 중으로 두고 부른다. 이 테스트만 clipboard-manager 플러그인을 등록해 `clipboard_link`도 실제로 돈다. 반대 방향, 처리기에만 있고 목록에 없는 command는 검사하지 않는다. 그런 command는 처음 부를 때 ACL에 거부되어 바로 드러난다). `subscribe_jobs_takes_an_on_event_channel`: `{ onEvent: "__CHANNEL__:1" }`은 받고 `on_event`는 거부한다. `channel_sink_delivers_job_events_and_queues_completion_notice`: 실제 `tauri::ipc::Channel`로 만든 `ChannelSink`를 구독시키고 wiremock 상대로 progressive 작업을 끝까지 받아 `added` → `status(running)` → `status(completed)`가 Channel로 오고 완료 제목이 알림 큐에 한 번 들어가는지 본다. `channel_sink_reports_a_closed_channel`: 전송 실패면 `false`. `quit_runs_once_and_blocks_close_silently_meanwhile`.
    - (마) **CSP·`resolve` 수동 확인은 §15-14의 통과 조건으로 옮겼다**(§15 표 14행). 프런트 `api.ts`와 받기 화면이 생기는 단계라 그때 웹뷰 콘솔과 실제 주소로 확인한다.
    - (바) **setup 실패 안내는 고치지 않고 §15-17로 넘긴다.** `jobs.json`을 읽지 못하거나(NotFound가 아닌 오류) 깨진 파일을 `.bad-*`로 옮기지 못하면 `App::open`이 실패하고 `build()`의 `expect`가 패닉한다. 릴리스 Windows 빌드는 콘솔이 없어 아무것도 보이지 않는다(로그 파일에는 남는다). 고치려면 setup에서 오류를 삼키고 main 창을 숨긴 채 네이티브 오류 창(로그 폴더 경로·오류 문구)을 띄운 뒤 `exit(1)`해야 하는데, setup 시점에 이벤트 루프 밖에서 비동기 메시지 창이 macOS·Windows에서 실제로 뜨는지는 GUI로만 확인할 수 있고 mock 런타임으로는 검사할 수 없다. 문구(copy deck)와 함께 §15-17에서 만들고 스모크 체크리스트("읽을 수 없는 `jobs.json`으로 시작")로 확인한다.
39. **시각 설계(`docs/design/ui-visual.md`)와 디자인 토큰(§15-12 앞당김).** 화면을 만들기 전에 색·글자·간격·모서리·높이·움직임·아이콘·컴포넌트 스펙을 한 문서로 정하고 토큰을 `app/src/styles/tokens.css`에 뒀다(`app.css`가 `@import`, Vite가 합친다). §10과 달라진 것: (가) 토큰 목록에 `--surface-raised --border-strong --scrim --fg-faint --accent-hover --accent-fg --danger-hover --danger-fg --warning-soft --success-soft`와 글꼴·크기·간격·모서리·그림자·`--dur-*`·`--ease-*`·z 토큰을 더했다. `--border`는 장식선, `--border-strong`(3:1)은 입력·라디오·스위치 테두리다. (나) 작업 항목 왼쪽에 3px 상태 레일(받는 중 `accent`, 멈춤 `fg-muted`, 실패 `danger`, 완료 `success`, 대기·건너뜀 `border-strong`)을 더했다. 실패 항목의 `danger` 테두리는 그대로다. (다) 다크 바탕은 검정이 아닌 청회색(`#141A1E`)이고 대화상자·메뉴·토스트는 `--surface-raised`로 한 단계 밝다. (라) 글꼴 스택에 `-apple-system`·`Noto Sans CJK KR`·`Segoe UI`를 더했고 굵기는 400·500·600만 쓴다. (마) `prefers-reduced-motion`은 `--dur-*`를 0ms로 만들어 transition 전부를 끄고, 스켈레톤·줄무늬·스피너 회전·강조는 CSS에서 따로 끈다. 진행 막대 `width`는 transition하지 않는다. (바) §8.7 설정 그림에 없던 §16 설정 두 행("동시에 받는 영상 수" 1~3, "앱을 열면 멈춘 다운로드를 자동으로 이어받기")과 §8에 없던 UrlBar의 드래그 오버·클립보드 제안 상태를 ui-visual.md §6.4·§6.8에 그렸다. copy deck에 `settings.parallel(.help)`·`settings.autoResume(.help)`·`url.dropHere`·`url.clipboard.title`·`url.clipboard.load`를 §15-12에서 더한다. (사) `app/src/styles/tokens.test.ts`가 라이트·다크 토큰 1:1, 두 다크 블록 동일, WCAG 쌍(본문 4.5:1, 보조·비텍스트 3:1) 31개, reduced-motion, 번들 글꼴 없음을 검사한다. `data-theme="light|dark"` 루트 속성은 테스트·스크린샷용 테마 고정이며 사용자 설정이 아니다. 아이콘은 인라인 SVG 22개(`Icon.svelte`, §15-13).
40. **§15-12 프런트 기반 세부.**
    - **`api.ts`는 command 21개 전부**다. §4 TS 목록에 없던 `clipboardLink()`(37번 `clipboard_link`)를 더했다. 모든 함수가 실패를 `toAppError`로 바꿔 던진다: ACL 거부·처리기 없음처럼 문자열로 오는 거부와 프런트에 와서는 안 되는 `cancelled`(§5)는 `internal`이 된다. 그래서 호출하는 쪽의 `catch (e)`는 늘 `AppError`다. `isAppError`·`toAppError`는 `copy/errors.ts`에 두고 `api.ts`가 다시 내보낸다. `api.test.ts`가 `src-tauri/src/command_names.rs`를 읽어 함수와 command가 1:1인지, `mockIPC`로 이름·camelCase 인자(`nidAut`·`fileName`·`expectedKind`·`onEvent`·`initial`)를 검사한다.
    - **`errorCopy(err, ctx)`는 `{ title, body, detail, actions }`**다. `detail`은 문장 밖에 작게 보이는 값(`fileLocked`·`io`·`fileMissing`의 경로, `internal`·`jobNotFound`의 원문 메시지)이다. `diskFull`의 경로는 §9대로 문장 안이다. `ctx.place`에 §9의 R·D 말고 `cookie`(설정 쿠키 입력)·`other`(토스트·배너)를 더했다. `invalidInput`은 `cookie`일 때만 "두 값을 모두 넣어 주세요"이고 그 밖(폴더 이름이 UTF-8이 아님 등)은 "입력한 값을 쓸 수 없어요" + 원문이다. §9 "다시 시도 / 이어받기"는 R이면 `retry`, D면 `partialBytes`가 있을 때 `resume`, 없을 때 `retry`다(§6.3). `noPlayback`(성인) 쿠키 켜짐은 설명을 바꾸고 동작을 `reenterCookies`로 한다. Phase 3 `notLoggedIn`의 설명은 표에 없어 "치지직 계정으로 로그인한 뒤 다시 불러와 주세요."로 정했다. 코드가 늘면 `switch`의 `never` 검사와 `Record<ErrorCode, …>`로 `pnpm check`가 깨진다. 표 테스트는 28 code × 위치 4 × `.part` 유무 × 쿠키 사용 전부를 돈다.
    - **copy deck 키**: §9의 `dialog.*`·`settings.*`·`settings.cookie.*`·`auth.*` 묶음을 이름 있는 키(`dialog.close.title` 등)로 풀었다. 39(바)의 일곱 키에 더해 화면이 쓰는 `header.back`·`common.close`·`url.label`·`resolve.done`(LiveAnnouncer)·`card.cancel`·`badge.adult.label`·`filename.ext`·`conflict.partial.continue`·`action.close/openCookieSettings/reenterCookies/openConfigFolder/showInList`·`settings.cookie.show/hide`를 더했다.
    - **시간 표시 규칙.** §8.11의 `2분 18초`와 ui-visual.md §6.5의 `14분 남음`을 함께 만족하도록 `formatSpan`은 가장 큰 두 단위만 쓰고 둘째가 0이면 뗀다(`1시간 2분`, `2분 18초`, `14분`, `45초`; 한 시간이 넘으면 초를 쓰지 않는다). 카드의 영상 길이는 `formatClock`(`H:MM:SS`, 코어 `format_hms`의 `HH`와 다르다). `liveOpenDate`·`publishDate`는 이미 KST 벽시계 문자열이라 `Date`를 거치지 않고 글자로 바꾼다. 완료 시각은 unix 초를 `Intl`(`ko-KR`)로 `오후 9:41`.
    - **`formatBytes`는 정수 나눗셈 + 짝수 반올림**이다. JS `toFixed`는 `1.25 → "1.3"`이라 코어 golden(`1280 → "1.2 KB"`)과 다르다. BigInt로 몫과 나머지를 구해 정확한 .x5만 짝수로 보낸다. 코어 golden 12건을 그대로 쓴다.
    - **vitest**: 기본 환경을 jsdom(30.1.2)으로 바꾸고 `src/test/setup.ts`(crypto 보강, `afterEach(clearMocks)`)를 건다. jsdom 전역 `URL`은 `file:`을 `readFileSync`에 넘길 수 없어 파일을 읽는 테스트는 `fileURLToPath`를 쓰거나 `// @vitest-environment node`로 node 환경을 고른다(`tokens.test.ts`). `$lib` 별칭은 두지 않고 상대 경로로 가져온다(SvelteKit이 아니다).
    - **pnpm 12 `minimumReleaseAge`**: 막 나온 jsdom 30.1.2와 그 의존성 셋을 받으려고 pnpm이 `app/pnpm-workspace.yaml`에 `minimumReleaseAgeExclude`를 적었다. 이 파일이 없으면 `--frozen-lockfile` 설치가 거부되므로 커밋한다.
41. **§15-13 UI 기본 요소 세부.**
    - **`components/ui/`**: §10 목록(Button·IconButton·Badge·ProgressBar·RadioGroup·Switch·TextField·SecretField·Dialog·ConfirmDialog·Menu·Toast·InlineAlert·Banner·Spinner·Skeleton·Kbd·Disclosure)에 ui-visual.md §5·§7의 `Icon`(아이콘 22개, `icons.ts`. 모양은 Feather Icons(MIT) path를 바탕으로 했다)과 `Select`(네이티브 `<select>`), 포커스 도우미 `focus.ts`를 더했다. EmptyState는 목록 단계(§15-15 EmptyJobs)에서 만든다.
    - **Dialog는 `<dialog>` 요소가 아니라 `role="dialog" aria-modal`**이다. jsdom에 `showModal`이 없어 포커스 가둠을 테스트할 수 없고, 가둠·Esc·포커스 복귀를 직접 해야 하는 것은 같다. 열릴 때 `[data-autofocus]`(기본 버튼) → 첫 요소 순으로 포커스, Tab·Shift+Tab을 안에서 돌리고, Esc는 `onclose`(안전한 쪽), 닫히면 연 요소로 돌아간다. scrim을 눌러 닫지 않는다(D1·D2에서 실수로 닫히지 않게). ConfirmDialog는 버튼 목록(`buttons`, 왼쪽부터, `autofocus` 하나)을 받아 D1(계속 받기 = 기본)·D2(돌아가기 = 기본, 취소하고 지우기 = danger)·D3를 한 모양으로 그린다.
    - **단축키는 `UiStore`가 잇는다.** Esc는 처리기 스택(`ui.onEscape`, 나중에 쌓은 것이 먼저)이고 아무도 받지 않으면 설정에서 홈으로 간다. 대화상자·메뉴는 스스로 Esc를 받아 `preventDefault`하므로 스택에 넣지 않는다. Mod+L은 `ui.urlTarget.focus()`, Mod+,는 설정이다. **입력칸 밖 Mod+V는 `navigator.clipboard`가 아니라 문서 `paste` 이벤트의 글**을 쓴다(사용자 제스처 안이라 권한이 필요 없고 웹뷰에 클립보드 읽기 권한을 주지 않는다). 입력칸이 아닌 곳에 포커스가 있을 때 macOS·Windows 웹뷰가 `paste`를 body로 보내는지는 §15-14 수동 확인 항목이다.
    - **LoginView(S3)는 아직 그리지 않는다.** Phase 2에는 `features.auth`가 늘 false라 들어갈 길이 없다. 뷰 이름 `login`만 `UiStore`에 둔다.
    - **움직임**: `app.css`의 reduced-motion 블록이 모든 `animation`을 즉시 끝낸다(`--dur-*` 0ms는 transition만 끈다). 줄무늬·스피너는 정지 모양을 컴포넌트 CSS가 따로 정한다(ui-visual §4).
    - **CSP 가드**: Svelte는 마크업을 `innerHTML`로 만들기 때문에 템플릿의 `style="…"` 속성은 `style-src 'self'`에 막힌다. 값은 `style:prop` 지시자(Svelte가 `style.cssText`·`setProperty`로 넣는다, CSSOM이라 허용)로만 준다. `src/csp.test.ts`가 모든 `.svelte`에 `style=`·`{@html}`이 없는지 본다. `pnpm build` 결과에 `style="`·`setAttribute("style"`이 없는 것도 확인했다.
    - **테스트 도구**: `@testing-library/svelte` 5.4.2(`svelteTesting()` vite 플러그인, VITEST일 때만 동작)·`jest-dom` 7.0.1·`user-event` 14.6.7. 슬롯이 필요한 컴포넌트는 `components/ui/test/*Harness.svelte`로 감싸 테스트한다.
42. **§15-14 받기 화면 세부.**
    - **판단은 순수 함수(`lib/receive.ts`)**: `buildEnqueueRequest`(§6.4 표), `notices`(충돌 안내 넷), `canDownload`, `shouldSuggestClipboard`, 종류 라벨·메타 줄·화질 행. "번호 붙여 새로 저장"은 `freeFileName`을 보내고 `restart = false`다(새 이름에는 `.part`가 없다). 그래서 번호를 고른 동안은 받다 만 안내를 숨기고, 덮어쓰기를 고르면 그 이름의 `.part` 안내가 다시 나온다. 이름은 입력 그대로가 아니라 `check_output`이 정리한 `fileName`을 보낸다(검사한 경로와 같게). `exists`인데 `freeFileName`이 없으면(셸은 늘 채운다) 번호 쪽 다운로드를 막는다(덮어쓰게 되므로).
    - **낡은 검사 결과로 받지 않는다.** 파일 이름·화질·폴더가 바뀌면 150ms 뒤 `check_output`을 부르고, 결과는 그때의 열쇠(`checkKey(folder, fileName, qualityId)`)가 지금 열쇠와 같을 때만 쓴다. 지금 입력의 결과가 올 때까지, 그리고 `duplicateJobId`가 있으면 [다운로드]를 막는다. `enqueue`가 실패하면 같은 입력으로 다시 검사한다.
    - **같은 작업의 `.part` 안내**는 §8.3의 `[처음부터 받기]`를 토글로 했다. 누르면 "받다 만 파일을 지우고 처음부터 받아요."(`conflict.partial.freshChosen`)와 `[이어서 받기]`(`conflict.partial.continue`)로 바뀐다. 완성 파일 안내의 두 선택지는 네이티브 라디오다(한 줄 안의 작은 선택이라 RadioGroup 묶음 모양을 쓰지 않는다).
    - **최소 `SettingsStore`를 앞당겼다**(§15-16에서 넓힌다): `load`(설정 + `app_info`, 앱 시작 때), `refresh`(enqueue 뒤 최근 VOD·마지막 화질), `patch`(카드에서 폴더를 바꾸면 `downloadFolder` 저장). 저장 실패는 `saveError`에 두고 B2 배너는 §15-16이다. `cookiesEnabled = useNaverCookies && naverCookiesSaved`가 오류 문구 분기(§9)에 쓰인다.
    - **드래그 앤 드롭**(ui-visual §6.4와 다른 점): dragover 동안 브라우저는 끌고 있는 글의 내용을 보여 주지 않는다(보호 모드, `getData`가 빈 문자열). 그래서 "치지직 주소가 아니면 면을 띄우지 않는다"는 할 수 없고, **종류만 본다**: `text/uri-list`나 `text/plain`이 있고 `Files`가 없으면 면을 띄운다. 놓으면 `textFromDrop`이 `text/uri-list`(주석 줄 제외) → `text/plain` 순으로 첫 치지직 주소를 고르고(셸 `chzzk_link`와 같은 규칙의 TS 판 `lib/chzzkUrl.ts`, 코어 url 테스트 사례로 검사), 없으면 첫 줄을 그대로 불러와 Rust가 `invalidUrl`로 알려 준다. 파일 드롭은 dragover·drop 모두 `preventDefault` + `dropEffect = 'none'`으로 막는다(막지 않으면 `dragDropEnabled: false`인 웹뷰가 그 파일로 이동한다). dragenter·dragleave를 세어 자식 요소 사이를 지날 때 깜빡이지 않게 한다. 놓는다고 받지 않는다(불러오기만).
    - **클립보드 제안**: 홈이 열릴 때와 창 `focus` 이벤트 때 `clipboardLink()`를 부른다(창이 처음부터 포커스를 가진 채 열리면 focus 이벤트가 없다). 입력줄이 비어 있고 불러오기·카드·오류가 없을 때만 묻고, 답이 온 뒤 조건을 다시 본다(그 사이 입력했을 수 있다). 닫거나 불러온 주소는 이번 실행 동안 다시 제안하지 않는다. 제안은 불러오기만 하고 받지 않는다.
    - **붙여넣기**: 입력줄이 비었거나 전체 선택일 때 붙여넣으면 바로 불러온다. 글 중간에 붙여넣는 것은 그대로 둔다(§8.10의 "붙여넣기는 곧바로 불러온다"를 고치는 중인 글에 적용하지 않는다).
    - **copy deck 추가**: `card.added`(다운로드 목록에 넣었어요, LiveAnnouncer), `conflict.partial.freshChosen`.
    - **[목록에서 보기]**와 카드 오류의 목록 동작은 `onshowjob(jobId)`로 위에 넘긴다. 목록이 없는 지금은 아무것도 하지 않고 §15-15 JobList가 받는다.
    - **문제 보고용 정보**(`lib/report.ts`): §9의 항목을 줄마다 적어 `navigator.clipboard.writeText`(버튼 클릭 안)로 복사한다. 경로가 들어 있을 수 있으면(`path` payload 또는 메시지에 `/`·`\`) 먼저 `toast.reportHasPath`를 띄운다.
    - **확인하지 못한 것**(§15 표 14행의 수동 확인): `pnpm tauri dev` 웹뷰 콘솔의 런타임 CSP 위반과 실제 주소로의 `resolve`, 3 OS 웹뷰에서 텍스트 드래그 앤 드롭·창 `focus` 이벤트·입력칸 밖 `paste` 이벤트가 실제로 오는지. CLI에서 웹뷰 화면·콘솔을 조작할 수 없어 하지 못했다. 정적으로는 `pnpm build` 결과에 `style="`·`setAttribute("style"`이 없고 `src/csp.test.ts`가 통과한다. §15-17 스모크 체크리스트로 넘긴다.
43. **§15-12~14 자체 점검 수정.** (가) **불러오기(R) 자리에 `폴더 열기`를 두지 않는다.** `diskFull`·`fileLocked`·`io`는 R에서도(`check_output`·`enqueue`·`pick_folder`) 나오지만, 여는 command가 작업 id를 받는 `reveal_output`뿐이라 카드에서 누르면 아무 일도 없는 버튼이었다. `openFolder`는 D(작업)와 토스트(`fileMissing`, 그 작업의 폴더)에만 붙이고 표 테스트의 "R에 없는 동작"에 넣었다. 같은 종류인 `settings`의 `openConfigFolder`는 B2(§15-16, 설정 폴더 열기 command와 함께)에서만 나오므로 그대로 둔다. (나) **파일·링크 드롭 막기를 창 전체로.** 기본 동작을 막는 처리가 홈의 DropOverlay에만 있어 설정 화면에서 파일이나 링크를 떨어뜨리면 웹뷰가 그곳으로 이동할 수 있었다. `GlobalShortcuts`가 window `dragover`(`dropEffect = 'none'`)·`drop`을 늘 막고, 주소 글은 홈의 DropOverlay가 먼저 받아 `copy`로 둔다(`defaultPrevented`면 덮지 않는다). (다) Esc 테스트가 store를 직접 부르던 것을 `ui.escape()`로 바꿔 InputPanel이 쌓은 처리기(불러오기 취소·카드 닫기)를 검사하고, `GlobalShortcuts`의 Esc·Mod+,·드롭 막기 테스트를 더했다. (라) 카드 안 오류에도 `detail`(경로)을 보인다.
    - **알려진 빈자리(§15-16까지)**: 오류 동작 `openCookieSettings`·`reenterCookies`는 설정 뷰로 가지만 설정 화면이 아직 비어 있다.
44. **§15-12~14 리뷰 반영.** (가) **창 안에서 시작한 끌기는 주소 드롭이 아니다.** 카드의 파일 이름 글을 끌어 옮기면 DropOverlay가 받아 카드를 버리고 `invalidUrl`로 바꿨다. `lib/inPageDrag.ts`가 window `dragstart`(capture)에 표시하고 `dragend`·`pointerdown`에 푼다(바깥에서 끌어오면 이 창에 `dragstart`가 없다). 끌던 요소가 끌기 중에 사라지면(카드가 닫힘) `dragend`가 window까지 오지 않아 다음 `pointerdown` 전까지 바깥 드롭을 한 번 놓칠 수 있다(클릭하면 풀린다, §15-17 스모크에서 확인). DropOverlay는 창 안 끌기를 받지 않고, GlobalShortcuts는 창 안 끌기를 입력칸에 놓을 때만 기본 동작(글 옮기기)을 두고 그 밖은 그대로 막는다(웹뷰 이동 방지). 또 카드·오류·불러오기가 열려 있으면 치지직 주소(`pickChzzkLink`)를 놓았을 때만 바꾼다. (나) **클립보드 제안은 주소마다 한 번.** 어느 길로든 불러오기 시작한 주소(`loading.url`)를 `dismissed`에 넣고, 입력줄에 글이 생기면 숨긴 제안을 버린다. 붙여넣기로 받아 목록에 넣은 주소가 입력줄이 비자마자 다시 제안되던 문제다. (다) **닫기·취소 뒤 포커스를 입력줄로.** 카드 [닫기]·[취소], 오류 [닫기], Esc(취소·닫기)가 누르던 버튼을 없애 포커스가 `body`로 떨어졌다. 다운로드 뒤처럼 `tick` 뒤 `ui.urlTarget.focus()`(§8.10). (라) Button의 단축키 표시(`Kbd`)를 `aria-hidden`으로 감싸 버튼 이름이 "다운로드"로 남는다. (마) R의 `diskFull` 설명은 "이어받으세요" 대신 "다시 시도해 주세요"(카드에는 이어받을 `.part`가 없고 동작도 [다시 시도]). `fileLocked`·`io`의 설명은 원래 이어받기 말이 없어 그대로다. (바) 문제 보고용 정보 복사가 실패하면 `toast.copyFailed`(danger)를 띄운다. (사) §15 표 14행의 웹뷰 수동 확인 조건을 17행으로 옮겨 ROADMAP 체크와 맞췄다(42의 "확인하지 못한 것").
45. **§15-15 작업 목록 화면 세부.**
    - **판단은 순수 함수(`lib/jobs.ts`)**: 그룹·정렬(`groupJobs`, `pausing`은 "받는 중" 그룹), 상태 줄 조각(`statusParts`), 진행 막대(`barView`), 상태별 버튼(`jobButtons`), D2 판정(`needsCancelConfirm`), 키보드 동작, 읽어 주기 문장. `JobsStore`(`stores/jobs.svelte.ts`)는 구독·이벤트 반영·command 호출만 한다.
    - **상태별 버튼은 ui-visual §6.5를 따른다**(§8.5 그림보다 우선): 받는 중·링크 갱신 [일시정지][×], 준비 중 [×], 마무리 중·멈추는 중은 메뉴만, 대기 [×], 일시정지·중단 [이어받기][×], 실패는 §9 표(`errorCopy(…, {place: 'job', partialBytes})`)의 동작, 완료 [파일 열기][폴더 열기](파일이 없으면 [폴더 열기]만), 건너뜀 [파일 열기][덮어쓰고 받기]. 메뉴는 주소 복사(늘)·처음부터 다시 받기(멈춘·실패 작업에 `.part`가 있을 때)·문제 보고용 정보 복사(실패)·목록에서 지우기(끝난 항목)이고 기본 버튼에 이미 있는 것은 넣지 않는다.
    - **일시정지·중단 항목의 버튼은 `.part`와 상관없이 "이어받기"다.** §6.3의 "`.part`가 있으면 이어받기, 없으면 다시 시도"는 실패 항목(§9 표)에만 적용한다. 대기 중에 일시정지해 `.part`가 없는 항목에 "다시 시도"는 실패한 적이 없어 맞지 않는다. 받은 바이트가 없으면 상태 줄은 `일시정지됨`·`중단됨`만 쓴다(copy deck `job.pausedNoBytes`·`job.interruptedNoBytes` 추가).
    - **대기 순서("앞에 N개")는 프런트가 따라간다.** `JobDto`에 줄 번호가 없고 매니저의 FIFO는 id 순이 아니다(29(나)). `nextQueueOrder`가 `queued`가 된 순서대로 줄을 쌓고(스냅샷은 id 순), 앞이 0이면 `대기 중 · 곧 시작해요`(`job.queuedNext` 추가)다. 웹뷰를 새로 고친 뒤에는 id 순으로 다시 시작하므로 다시 줄 선 작업이 있으면 잠시 어긋날 수 있다(표시만의 문제다).
    - **D2는 실패 항목의 "목록에서 지우기"에도 건다.** `remove_job`은 `paused`·`interrupted`·`failed`의 `.part`를 지우므로 같은 데이터 손실이다. 받은 바이트는 받는 중이면 마지막 진행률, 멈춘 작업이면 `partialBytes`이고, 512 MiB와 **같으면 묻지 않는다**(초과만). 대기·완료·건너뜀은 묻지 않는다.
    - **구독 순서**: `start()`는 Channel 메시지가 `subscribe_jobs` 응답보다 먼저 오면 모아 두었다가 스냅샷 뒤에 순서대로 반영하고, 다시 구독하면(세대 번호) 앞 Channel의 늦은 메시지·스냅샷을 버린다. 앱 `onMount`에서 한 번 부른다(웹뷰 새로고침이면 다시 돈다).
    - **완료 토스트**는 상태가 완료로 바뀌는 `status` 이벤트에서만 띄운다(스냅샷·`added`의 완료 항목은 알리지 않는다, Rust `completed_title`과 같은 규칙). 포커스가 없을 때의 OS 알림은 Rust가 따로 한다(37). **1초 강조**는 `added`만. LiveAnnouncer는 실패·일시정지·중단·건너뜀·받기 시작을 읽고(진행률 틱과 완료는 읽지 않는다, 완료는 토스트가 `role=status`), 문구 `job.failed`·`job.status` 추가.
    - **진행률 표시**: 막대 퍼센트는 내림(`Math.floor`, `aria-valuenow`와 같다). 진행률이 없는 준비 중은 indeterminate. 진행률이 없는 멈춘 작업(재시작 뒤 복원, `progress`는 저장하지 않는다)은 막대를 그리지 않고 상태 줄의 받은 크기만 보인다. 실패 막대는 `.part`가 있을 때만. "이어받음" 괄호는 프런트가 `running`이 된 시각을 기록해 10초 동안만 붙인다.
    - **항목 키보드**: 항목이 `article`(`aria-label` = 제목)이고 roving tabindex다. `tabindex`·`keydown`을 비대화형 요소에 두는 Svelte a11y 경고 두 개는 이유를 적어 `svelte-ignore`했다. 항목 안 버튼에서 온 키는 무시한다(Space·Enter가 두 번 돌지 않게). Delete와 macOS를 위해 Backspace도 받는다. 포커스를 가진 항목이 지워지면 같은 자리의 이웃 항목, 없으면 목록 제목(`tabindex=-1`)으로 옮긴다. 포커스가 목록 밖에 있으면 옮기지 않는다.
    - **[목록에서 보기]**(받기 카드 충돌 안내·중복 오류)는 `jobs.reveal(id)`로 그 항목에 포커스를 준다. "다시 불러오기"는 홈으로 가서 그 주소를 불러온다.
    - **B1**은 `interrupted` 수를 실시간으로 세어 0이면 숨고, [닫기]는 이번 실행 동안만이다. "모두 이어받기"는 id 순으로 `resume_job`을 부르고 하나가 거부돼도(`duplicateOutput` 등) 토스트로 알린 뒤 계속한다. B2(§15-16)가 있으면 B2가 먼저다.
    - 테스트: `lib/jobs.test.ts`(버튼 표 18행 + 쿠키 분기, 정렬·그룹, 대기 순서, 상태 줄·막대, 512 MiB 경계, 키보드, 읽어 주기), `stores/jobs.test.ts`(이른 이벤트 모으기, 늦은 Channel 버리기, 완료 토스트 규칙, 강조, 모두 이어받기 계속, D2), `components/jobs/jobs.test.ts`(command 연결, 실패 줄, D2 포커스, 키보드, 지운 뒤 포커스, B1).
46. **§15-16 설정 화면 세부.**
    - **폴더 여는 command `open_app_folder(kind)`**(37 "남은 command"). `kind`는 `"config" | "logs" | "downloads"`(셸 `AppFolder`, ts-rs 바인딩 추가)이고, 셸 `App::folder_target`이 경로를 정해 **없으면 만든 뒤** 연다. 저장 폴더는 첫 다운로드 때 코어가 만들므로 설정 화면의 [폴더 열기]가 아직 없는 폴더를 만날 수 있다. 만들지 못하면 코어 `Io`와 같은 `io`(경로 payload)다. command 목록은 22개가 됐고(`command_names.rs`·`handler`·capabilities·`api.ts`), IPC 테스트는 실제 창이 열리지 않게 거부되는 값(`{}`·`"Config"`·`"settings"`)만 보내 camelCase 값과 배선을 보고 경로는 셸 `tests/app.rs`가 본다.
    - **저장 오류 두 갈래.** `SettingsStore.patch`는 이제 던지지 않고 오류를 돌려준다. `settings`(설정 파일을 못 씀)만 B2 배너(`saveError`)에 올리고 [다시 시도]가 **실패한 마지막 패치**를 다시 보낸다. 그 밖(`invalidInput` 등)은 부른 자리에 InlineAlert로 보인다(쿠키는 `place: 'cookie'`). 쿠키 저장·지우기 실패는 B2에 올리지 않는다(다시 보낼 값을 프런트가 들고 있지 않다).
    - **컨트롤은 저장된 값만 읽는다.** Select·Switch를 `settings.dto`에 `bind:`하지 않고 `onchange`에서 패치를 보낸다. 저장이 실패하면 `settings.revision`이 올라 `{#key}`가 컨트롤을 저장된 값으로 되돌린다(컨트롤 안의 상태가 실패한 값을 들고 남지 않게).
    - **쿠키**: 입력칸은 `naverCookiesSaved`와 상관없이 늘 비어서 시작하고 저장 성공·지우기 뒤에 비운다. 두 칸 중 하나라도 비면 Rust로 보내지 않고 "두 값을 모두 넣어 주세요"와 빈 칸에 `aria-invalid`. "로그인 정보 사용" 스위치와 [지우기]는 저장된 값이 없으면 비활성이고, 스위치 값은 `useNaverCookies && naverCookiesSaved`(36(다)와 같은 "실제로 보내는가")다. 오류 동작 [네이버 로그인 정보 설정]·[로그인 정보 다시 넣기]로 들어오면 고급 섹션을 펼치고 첫 입력칸으로 포커스를 옮긴다. "값을 찾는 방법"은 copy deck의 한 줄 단계를 번호로 나눠 목록으로 보인다.
    - **이전 버전 가져오기**: 폴더 선택 → `import_legacy(dir)` → 결과 토스트(`legacy.done`/`legacy.notFound`). 경고는 `SettingsStore.legacyWarnings`에 남겨 D3로 가져온 경우에도 설정 > 이전 버전에 warning InlineAlert로 보인다(§7.2, 이번 실행 동안). 가져온 뒤 설정을 다시 읽어 최근 VOD·폴더·쿠키 상태·"마지막 가져오기"가 바뀐다.
    - **D3**는 `app_info.legacyCandidate`가 있을 때 앱 시작 뒤 한 번 뜬다. [가져오기](기본 포커스)는 `import_legacy(null)`, [나중에]·Esc는 아무것도 바꾸지 않는다. 어느 쪽이든 이번 실행에서 다시 묻지 않는다(셸은 후보를 찾을 때 `settings.json`을 만들어 다음 실행에도 묻지 않는다, 34).
    - **정보**: "버전 {app} (코어 {core})", 설정 폴더 열기 · 로그 폴더 열기 · 문제 보고용 정보 복사. 이 보고는 오류가 없으므로 `buildAppReport`가 앱 버전·OS·시각만 넣고 경로는 넣지 않는다(경로 토스트가 필요 없다).
    - **B2와 B1**: 배너는 하나만 보이고 B2가 먼저다(ui-visual §6.6). B2의 [설정 폴더 열기]는 `open_app_folder("config")`.
    - **반응 폭**: 720~839에서 "기본 저장 폴더" 행의 값이 라벨 아래로 내려간다(ui-visual §8). 섹션 묶음·행 48·도움말 13 `fg-muted`는 ui-visual §6.8 그대로다.
    - 테스트: `components/settings/settings.test.ts`(즉시 저장 3종, B2와 되돌림·다시 시도, 입력 오류는 화면 안, 폴더 열기 3종·버전, 쿠키 값 미복원·저장 뒤 비움·둘 다 필요·비활성·지우기, 오류 동작으로 펼침, 가져오기 경고·마지막 경로·못 찾음, D3 가져오기·나중에), `report.test.ts`(`buildAppReport`에 경로 없음), 셸 `folder_targets_follow_paths_and_settings`, IPC `open_app_folder_takes_camel_case_kind`.
47. **§15-17 창 닫기·알림·접근성·마무리 세부.**
    - **D1 `CloseGuard`**: `api.onCloseRequested`(이 파일만 `listen`을 부른다, `core:default`의 이벤트 권한으로 충분하다)로 `close-requested`를 듣고 `{running}`을 문구에 넣는다. 열린 채 다시 오면 수만 바꾼다. [계속 받기](기본 포커스)·Esc는 닫기만, [닫기]는 `quit()`을 **한 번만** 부르고 그동안 버튼을 막는다(Rust도 38(가)로 한 번만 돈다). `quit`이 실패하면 토스트로 알리고 다시 누를 수 있게 한다. `ConfirmDialog`의 버튼에 `disabled`를 더했다. `core:default`가 `core:event:default`(`allow-listen`·`allow-unlisten`)를 포함하는 것을 `gen/schemas/acl-manifests.json`으로 확인했고, IPC `main_window_may_listen_for_close_requested`가 실제 ACL에서 `plugin:event|listen`이 허락되는지 본다.
    - **OS 알림을 실패에도 띄운다**(§16 "완료 OS 알림"을 완료·실패로 넓힘). 받는 동안 창을 내려 둔 사용자가 실패를 놓치면 다시 열 때까지 아무 일도 없기 때문이다. `sink::notice_of`가 `Status(completed)`→`Completed`, `Status(failed)`→`Failed`를 큐에 넣고(`Added`·건너뜀·멈춤은 알리지 않는다), 알림 태스크는 그대로 main 창에 포커스가 없을 때만 `request_user_attention(Informational)`과 OS 알림을 띄운다. 실패 본문은 copy deck `job.failed`("'{title}' 다운로드에 실패했어요", LiveAnnouncer와 같은 문구)이고 `sink.rs`에도 있다. `quit`이 멈춘 작업은 `interrupted`라 종료 때 실패 알림이 쏟아지지 않는다.
    - **시작 실패 안내(38(바))**: `App::open`이 실패하면 `setup`이 오류를 삼키고 main 창을 숨긴 뒤 dialog 플러그인의 비동기 오류 창(제목 "치지직 다운로더를 시작하지 못했어요", 본문 `startup_failure_message`: 할 일 + 로그 폴더 + 원문 오류)을 띄우고 닫으면 `exit(1)`한다. Tauri 2.12.1 소스로 확인한 것: config 창은 사용자 `setup`보다 먼저 만들어지고(`app.rs` `setup()`), 상태가 없는 command는 패닉하지 않고 "state not managed" 오류를 돌려준다(`state.rs`). 닫기 가드는 상태가 없으면 막지 않는다. `blocking_show`는 메인 스레드(setup)에서 멈추므로 `show(콜백)`을 쓴다. 이 문구는 웹뷰가 뜨기 전이라 Rust에만 있다. **GUI 경로는 확인하지 못했다**(아래 스모크 표).
    - **접근성 점검**: (가) 뷰를 바꾸면 누르던 버튼이 사라져 포커스가 body로 떨어지던 것을, 설정은 제목(`h1 tabindex=-1`), 홈은 입력줄로 옮긴다(다른 곳이 이미 옮겼으면 두고, 쿠키 섹션 펼치기는 첫 입력칸). (나) `src/a11y.test.ts`가 앱 전체를 그려 랜드마크(`banner`·`main`·"다운로드" 구획), 홈·설정의 모든 버튼·스위치·셀렉트·진행 막대에 이름이 있는지, 뷰 전환·Esc 뒤 포커스, 멈춤·완료 항목이 아이콘과 문구를 함께 쓰는지 본다. (다) reduced-motion: 새 항목 강조는 CSS에서 끈다(줄무늬·스피너·스켈레톤은 41에서 이미). (마) 자체 점검 수정: [목록에서 보기] 포커스 요청을 한 번 쓰고 비운다(남아 있으면 설정에서 돌아와 목록이 다시 그려질 때 옛 항목이 입력줄 포커스를 빼앗았다). JobList가 사라지면(뷰 전환) 열린 D2를 닫는다(돌아왔을 때 다시 뜨지 않게). (라) 진행 막대 `aria-valuetext`("57퍼센트, 2분 18초 남음")·대화상자 포커스 가둠·복귀는 45·41의 테스트가 본다.
    - 빌드 확인(macOS, 2026-10-05): `pnpm build` 결과에 `style="`·`setAttribute("style"`이 없고, `pnpm tauri build --debug --no-bundle`이 통과하며 그 바이너리가 setup을 끝까지 돌아 시작 로그를 남긴다(패닉 없음).
48. **§15-15~17 리뷰 반영.**
    - (가) **작업 항목을 `overflow: hidden`으로 깎지 않는다.** [⋯] 메뉴가 항목 테두리에서 잘리고, 메뉴를 열며 첫 항목에 포커스를 주면 브라우저가 항목 안을 스크롤해 제목·오류 줄이 사라졌다. 레일은 항목 전체를 덮는 `::before`(테두리 안쪽 radius, `pointer-events: none`)에 레일 폭만 그라디언트로 칠한다. Menu는 `focus({ preventScroll: true })`. Vite + mock IPC로 960px에서 중단·실패 항목의 메뉴가 모두 보이고 눌리며 `scrollTop`이 0임을 확인했다. 테스트: `styles.test.ts`(소스 검사), `ui.test.ts` Menu `preventScroll`.
    - (나) **상태 줄 구분점은 ` · `.** Svelte가 요소 안 빈칸을 깎아 `받는 중· 2.3 GB`가 됐다. 조각 사이 빈칸을 문자열로만 넣는다(`{' · '}`). `components/jobs/jobs.test.ts`가 글을 본다.
    - (다) **쿠키 스위치의 `settings` 오류는 B2에만**(46과 같은 규칙). 화면 안 알림이 B2 [다시 시도] 뒤에도 남았다.
    - (라) **`fileMissing` 토스트**: §9 문구 그대로(경로를 붙이지 않는다) + [폴더 열기](그 작업의 `reveal_output`). 토스트에 동작 버튼 하나(`ToastAction`)를 더했고, 누르면 실행하고 닫는다. 동작 버튼이 있으므로 마우스뿐 아니라 포커스가 안에 있어도 타이머를 멈춘다. 작업 id가 없는 자리의 오류 토스트에는 버튼을 달지 않는다. 항목을 `missing`으로 바꾸지는 않는다(Rust가 다음 스냅샷에서 정한다).
    - (마) **실패 토스트는 `role=alert`**, 나머지는 `role=status`. 시간(5초)은 그대로다(멈춤은 위 (라)).
    - (바) **D1 종료 중에는 [계속 받기]도 막는다.** 눌러도 아무 일이 없는 살아 있는 버튼이었다.
    - (사) **프로그램으로 준 제목 포커스에 링을 그리지 않는다.** 전역 `:focus-visible`이 `box-shadow`라 `.title:focus { outline: none }`만으로는 설정 제목·목록 제목에 링이 남았다. `box-shadow: none`을 더했다(`styles.test.ts`).
    - (아) **두 번째 실행은 상태가 없으면 창을 꺼내지 않는다.** 시작에 실패해 숨긴 빈 창(command마다 "state not managed")이 앞으로 나왔다. `focus_main`이 `try_state::<App>()`을 먼저 본다. IPC `second_instance_does_not_reveal_the_window_of_a_failed_startup`.
    - (자) **알림 판단을 순수 함수로**: `sink::should_notify(has_main, focused)`(포커스가 있으면 안 함, 묻지 못하면 포커스 없음으로 봄) 단위 테스트, IPC `channel_sink_queues_failure_notice`(404 → `Notice::Failed` 한 번). OS 알림·주의 요청 자체는 여전히 수동 확인이다.
    - (차) a11y 테스트의 "색만으로 말하지 않는다"를 상태 줄 안의 아이콘으로 좁혔다(버튼 아이콘 때문에 실패할 수 없었다). 멈춤 아이콘을 지우면 실패하는 것을 확인했다.
    - **하지 않은 것**: (1) §8.11 "`refreshes`는 툴팁"은 넣지 않는다. copy deck에 문구가 없고, `title` 툴팁은 키보드·화면 낭독기에 닿지 않으며 상태 줄 문구와 줄무늬 막대로 링크 갱신은 이미 알린다. (2) `subscribe_jobs` 실패 시 목록 자리의 오류·다시 시도는 두지 않는다. 그 실패는 상태 없음(시작 실패, 이제 창이 보이지 않는다, (아))이나 ACL 거부(IPC `capabilities_allow_exactly_the_app_commands`가 막는다)뿐이라 사용자에게 닿을 길이 없다. 토스트는 그대로다. (3) **컴포넌트 나눔**: §10·§15-15의 `JobGroup`·`EmptyJobs`는 `JobList.svelte`에, `JobProgress`·`JobStatusLine`·`JobActions`·`JobMenu`는 `JobItem.svelte`에 합쳤다. 판단은 `lib/jobs.ts` 순수 함수에 있어(45) 컴포넌트는 그리기만 하고, 나누면 props만 늘어난다.

49. **§15-18 앱 CI.** `app.yml`에 `frontend`·`tauri` 작업을 더했다(`shell`은 35 그대로). §14와 다른 점:
    - (가) **`tauri` 작업은 `pnpm build`를 따로 돌리지 않는다.** `cargo clippy/test -p chzzk-app`은 `app/dist` 없이 컴파일되고(6), 앱 빌드는 `pnpm tauri build`의 `beforeBuildCommand`가 `dist`를 만든다. `pnpm install`만 앞에 둔다(`tauri` CLI가 `node_modules`에 있다).
    - (나) **pnpm은 `package_json_file: app/package.json`으로 고정한다.** `pnpm/action-setup`은 루트 `package.json`의 `packageManager`만 읽는데 이 저장소의 `package.json`은 `app/`에 있다. `setup-node`의 pnpm 캐시도 `cache-dependency-path: app/pnpm-lock.yaml`.
    - (다) **번들은 `push`(master)·`workflow_dispatch`에서만**(`if: github.event_name != 'pull_request'`): `pnpm tauri build --ci --no-sign` 뒤 workspace `target/release/bundle/`(`app/src-tauri/target`이 아니다)을 `upload-artifact` 7일, 없으면 실패. PR은 `--ci --debug --no-bundle`. `createUpdaterArtifacts`·서명 키 환경 변수는 두지 않는다(updater는 Phase 4). `workflow_dispatch`를 트리거에 더했다.
    - (라) **Linux apt는 §14 목록 + `patchelf`**를 clippy 전에 설치한다(clippy도 webkit2gtk에 링크한다). 러너는 `ubuntu-22.04` 그대로.
    - (마) **액션 버전**: 새 액션은 §14대로 `pnpm/action-setup@v6`·`actions/setup-node@v7`(node 24)과 `actions/upload-artifact@v7`(2026-10-05 최신). `actions/checkout`은 `core.yml`·`shell`과 같게 `@v4`로 둔다(한 파일 안에서 갈리지 않게, 올리려면 두 워크플로를 함께).
    - (바) `frontend`는 `ubuntu-22.04` 하나, `tauri`는 3 OS `needs: [shell, frontend]`, `fail-fast: false`. `tauri`의 rust-toolchain은 `clippy`만(fmt는 `shell`이 본다).
    - (사) **MSI는 `bundle.windows.wix.language: "ko-KR"`로 만든다.** 한글 `productName`("치지직 다운로더")은 WiX 기본 en-US(코드 페이지 1252)로 MSI를 만들 때 `light.exe`가 LGHT0311로 실패한다(같은 문제의 공개 사례: 중국어 `productName` → `zh-CN`). 949 코드 페이지인 `ko-KR`로 바꾸고 `tauri-conf.test.ts`가 고정한다. **Linux deb·rpm의 패키지 이름**은 `productName`을 소문자 kebab으로 만든 것이라 한글이 들어가 거부될 수 있다. 확인하지 못해 그대로 두고, master 첫 번들 실행에서 실패하면 `tauri.linux.conf.json`에 ASCII `productName`을 두는 것(창 제목은 `windows[].title`이 따로 정한다)을 가장 작은 고침으로 본다.
    - **확인한 것**: `actionlint` 통과. macOS에서 `pnpm tauri build --ci --debug --no-bundle`(custom-protocol, `dist`를 바이너리에 넣는 경로)이 성공하고 그 바이너리가 시작 로그를 남기며 떴다(아래 표). Linux는 `ubuntu:22.04` 컨테이너(arm64, Docker)에서 위 apt 목록으로 `cargo clippy -p chzzk-app --all-targets --locked -- -D warnings`와 `cargo test -p chzzk-app --locked`(IPC 17개 포함)가 화면·D-Bus 없이 통과했다. 그래서 `xvfb-run`은 두지 않는다. **GitHub에서 3 OS로 돌려 보지는 않았다**(푸시 금지). Windows `tauri` 작업과 Linux `targets: all` 번들(AppImage·deb·rpm, linuxdeploy 내려받기)은 첫 master 실행에서 확인한다.

50. **§15-19 문서 정리.** 1~49는 고치거나 다시 번호를 매기지 않고, 이 절 머리에 "읽는 법"(뒤 항목 우선, 우선순위 §16 > 이 절 > 본문)과 주제별 "지금 기준" 표를 더했다. 본문(§0~§17)은 설계 당시 기록으로 두고 고치지 않는다(§14의 `git diff`·`pnpm build` 선행 같은 어긋남은 표가 35·49로 보낸다). CLAUDE.md는 레이아웃(`crates/shell`·`app/`·`app/src-tauri`·`app.yml`), 앱 실행·빌드 명령, Linux 의존성 메모, app.md 기준 규칙으로 갱신했다.

51. **§15-18~19 리뷰 반영.**
    - (가) **Linux에서는 `productName`을 ASCII로 덮는다.** 49(사)는 deb·rpm 패키지 이름을 첫 master 번들 실패 때 고치기로 했지만 실패하지 않는다. tauri-bundler가 `.deb`를 `ar`·`tar` crate로 직접 만들고 `dpkg-deb`를 부르지 않아, 빌드는 `Package: 치지직-다운로더`로 통과하고 설치(`dpkg -i`)에서야 거부된다(dpkg 패키지 이름은 소문자 ASCII·숫자·`+-.`만). Tauri 설정에 deb·rpm 패키지 이름 항목이 없어 `app/src-tauri/tauri.linux.conf.json`(Tauri CLI가 Linux에서 합치는 플랫폼 설정)에 `productName: "chzzk-downloader"` 하나만 둔다. 창 제목(`windows[].title`)·알림 제목(`sink::NOTIFY_TITLE`)·앱 데이터 폴더(identifier)는 따로 정해지므로 그대로고, Windows·macOS 번들 이름도 그대로다. Linux 메뉴의 `.desktop` `Name`이 `chzzk-downloader`가 되는 것은 받아들인다(한글로 하려면 `bundle.linux.deb.desktopTemplate`를 둔다, 후속). `tauri-conf.test.ts`가 합친 이름의 kebab이 `/^[a-z0-9][a-z0-9+.-]*$/`인지 고정한다. 플랫폼 설정 합치기는 소스로 확인했다(`tauri-utils` 2.10.1 `config/parse.rs`가 Linux 대상에서 `tauri.linux.conf.json`을 JSON merge patch로 합친다. `generate_context!`도 같은 경로라 Linux의 `package_info().name`도 바뀌지만 Rust 코드는 이것을 읽지 않는다). 실제 `.deb` 설치는 첫 master·수동 번들 실행에서 본다.
    - (나) **ROADMAP §15-18을 둘로 나눴다.** 작업을 쓴 것은 끝, "3 OS 녹색 + 번들(Windows MSI ko-KR, Linux deb·rpm·AppImage)"은 GitHub에서 한 번 돌 때까지 열어 둔다(`workflow_dispatch`로 머지 전에 돌릴 수 있다).
    - (다) **데이터 폴더 잠금(`<app_data_dir>/app.lock`).** macOS의 `tauri-plugin-single-instance` 2.5.2는 소켓 확인(`NotFound`)과 생성 사이에 경합이 있어, 거의 동시에(debug 빌드에서 약 2초 안) 뜬 두 실행이 둘 다 첫 실행이 되고(뒤의 것이 앞의 소켓을 지운다) 각자 매니저로 같은 `jobs.json`을 덮어써 한쪽 작업이 사라졌다(리뷰어 실측: 두 "앱 시작" 로그 3ms 차, 둘 다 살아 있음). setup이 `App::open` 전에 `acquire_instance_lock`으로 `File::try_lock`(코어 `.part`와 같은 방식)을 쥐고 프로세스 끝까지 `manage`해 둔다. 이미 잡혀 있으면 main 창을 숨기고 경고 로그를 남긴 뒤 `exit(0)`한다(시작 실패 창은 띄우지 않는다. 다른 실행이 멀쩡히 돈다). 잠금 파일을 열지 못하면 잠금 없이 계속한다(폴더 문제는 `App::open`이 시작 실패 창으로 알린다). 그래서 §6.1 "중복 방지 세 겹"의 (2)는 single-instance(창 포커스 넘기기) + `app.lock`(상태 단일 소유)이다. 남는 것: 경합에서 진 쪽이 살아 있는 소켓의 주인이었다면 이긴 쪽은 소켓이 없어, 이후 명령줄 실행(`open -n` 등)은 포커스를 넘기지 못하고 잠금에 막혀 조용히 끝난다. 데이터는 안전하고, Finder·Dock 실행은 macOS가 이미 떠 있는 앱을 앞으로 가져오므로 받아들인다. `lib.rs` 단위 테스트가 두 번째 잠금이 `HeldElsewhere`이고 놓으면 다시 잡히는지 고정한다.
    - (라) **실제 실행(2026-10-05 macOS).** `pnpm tauri build --ci --debug --no-bundle` 성공. 다른 세션이 띄워 둔 debug 앱(부모가 끝난 고아 프로세스)이 돌고 있어 기본 identifier 바이너리는 single-instance로 그 창에 포커스를 넘기고 시작 로그 없이 끝났다(순차 실행 넘기기 확인). 그 프로세스는 건드리지 않고 `--config '{"identifier":"io.github.chnu-kim.chzzk-downloader.smoke"}'`로 소켓·데이터·로그 폴더가 따로인 사본을 만들어 봤다. (1) 혼자 실행: 떠 있고, 시작 로그(기본 폴더 `~/Movies/치지직`)와 데이터 폴더의 `app.lock`·`jobs.json`이 생겼다. (2) 한 줄에서 두 개 실행: 시작 로그 두 줄(10ms 차)로 **둘 다 single-instance를 지났고**(경합 재현), 뒤의 것이 `다른 실행이 데이터 폴더를 쓰는 중이라 이 실행을 끝냄`을 남기고 끝나 하나만 남았다. 확인 뒤 기본 identifier로 다시 빌드했다.

52. **Phase 2 최종 리뷰(macOS 실행): Cmd+Q·메뉴 Quit이 D1을 지나쳤다.** 37의 "macOS Cmd+Q·Dock 종료는 `ExitRequested { code: None }`로 온다"는 틀렸다. Tauri 기본 macOS 메뉴(`Menu::default`)의 Quit(=Cmd+Q)은 muda `PredefinedMenuItem::quit`이고 macOS에서는 `NSApp terminate:` 셀렉터다. tao 0.37.1의 앱 델리게이트는 `applicationShouldTerminate:`를 두지 않고 `applicationWillTerminate:`에서 `AppState::exit()` → `LoopDestroyed` → `RunEvent::Exit`만 보내므로(소스 확인), 받는 중에 메뉴 Quit을 누르면 D1 없이 프로세스가 끝나고 `manager.quit`이 돌지 않아 작업이 `running`으로 남았다(실측: `jobs.json`에 `running`, 다음 실행의 reconcile이 `interrupted`로 바꿈. `RunEvent::Exit`의 flush는 돌아 데이터는 안전했다). 고침: macOS에서만 `Builder::menu`로 기본 메뉴와 같은 구성(앱·File·Edit·View·Window)을 만들되 Quit을 보통 `MenuItem`(id `quit`, "Quit {앱 이름}", `CmdOrCtrl+Q`)으로 두고 `on_menu_event`에서 `request_quit`(= `guard_close` → 막히지 않으면 `app.exit(0)`)을 부른다. Edit 메뉴의 predefined 항목은 WKWebView의 붙여넣기·전체 선택이 responder chain으로 받으므로 그대로 둔다. **남는 것**: Dock의 "종료", AppleScript `quit`, 로그아웃·시스템 종료는 여전히 `terminate:`라 가드를 지나친다(데이터는 flush + reconcile로 안전, D1만 없다). 막으려면 tao 델리게이트 클래스에 objc 런타임으로 `applicationShouldTerminate:`를 덧붙여야 해 후속으로 둔다. 테스트: IPC `quit_menu_is_guarded_while_a_job_runs`(받는 중이면 `close-requested` 한 번·끝내지 않음, `quit` 중이면 조용히 막음). 실제 메뉴 Quit → D1 → [닫기] → `interrupted` 저장 → 종료 → 재시작 B1 → 이어받기 완료까지 GUI로 확인했다(아래 표).

53. **PR #14 Codex 리뷰: 번호 붙인 새 이름이 그사이 생긴 파일을 덮어쓸 수 있었다.** §6.4 표는 번호·덮어쓰기 모두 `on_existing = overwrite`였고, 코어 `finalize`는 정책과 상관없이 덮어썼다(core.md 구현 중 변경 27). 그래서 `check_output`이 빈 이름 `이름 (2)`를 준 뒤 다운로드가 끝나기 전(몇 분~몇 시간)에 다른 프로그램이나 다른 실행이 같은 이름을 만들면 마무리 rename이 그 파일을 지웠다. 고친 것:
    - (가) **프런트**: `buildEnqueueRequest`는 완성 파일이 있고 사용자가 덮어쓰기를 직접 고른 때만 `overwrite`, 그 밖(번호 붙인 새 이름·충돌 없음·`.part`만 있음)은 `skip`을 보낸다.
    - (나) **코어 `finalize(policy)`**: `Skip`이면 덮어쓰지 않는 rename(`fsutil::rename_noclobber_with_retry`)을 쓴다. 시작 전 `exists()` 검사만으로는 받는 동안 생긴 파일을 막지 못하기 때문이다. 대상이 있으면 옮기지 않고 `Finalized::TargetExists` → `DownloadOutcome::Skipped`이고, 받은 `.part`와 sidecar는 남는다(core.md 구현 중 변경 55).
    - (다) **셸**: `Skipped`로 끝나면 `partial_bytes`를 채운다(reconcile도 `skipped`를 본다). 받은 `.part`가 남은 `skipped`는 "완료 지우기"·`MAX_FINISHED` 정리가 레코드만 지우지 않는다(`Job::clearable`, 지우면 수 GB `.part`가 주인 없이 남는다). `remove`는 `failed`와 같은 규칙으로 `.part`도 지운다.
    - (라) **알림**: 새 대화 상자 없이 기존 흐름을 쓴다. 작업 줄은 새 문구 `job.skippedMeanwhile`("받는 동안 같은 이름의 파일이 생겨 저장하지 않았어요")이고 [파일 열기][덮어쓰고 받기]는 그대로다. "목록에서 지우기"는 다 받은 `.part`까지 지우므로 실패 항목과 같이 받은 크기가 512 MiB를 넘으면 D2로 묻는다(`receivedBytes`가 `skipped`의 `partialBytes`를 센다). "덮어쓰고 받기"(`resume` → `overwrite`)는 남은 `.part`를 이어받아(점진 다운로드는 `416, offset == total`, HLS는 `next_index == n`) 바로 마무리한다.
    - 테스트: 코어 `tests/progressive.rs` `skip_does_not_clobber_file_created_while_downloading`(실제 엔진: 받는 중 진행률 콜백에서 같은 이름의 파일을 만들면 `Skipped` + `.part` 보존, 같은 요청을 `Overwrite`로 다시 부르면 416으로 `resumed_from == total` 완료), `finalize_skip_does_not_clobber_file_created_meanwhile`·`finalize_skip_moves_when_free`·`rename_noclobber_real_file`·`rename_noclobber_missing_source_is_io`, 셸 `skipped_with_partial_is_kept_and_removable`·`skipped_without_partial_clears`, 프런트 `receive.test.ts`(번호·충돌 없음 → `skip`, 덮어쓰기 → `overwrite`)·`jobs.test.ts`·`stores/jobs.test.ts`.
54. **PR #14 Codex 리뷰: `..` 별칭으로 중복 경로 검사를 지나칠 수 있었다.** 31(가)의 `output_key`는 구성 요소로 다시 조립해 `.`·구분자 차이는 없애지만 `..`는 풀지 않아, `/tmp/videos/a.mp4`와 `/tmp/videos/../videos/a.mp4`가 서로 다른 열쇠가 되어 같은 파일에 두 작업이 붙을 수 있었다(`.part` 잠금이 두 번째 작업을 `fileLocked`로 막지만 마무리 rename·`discard_partial` 경합은 31(가)가 막으려던 그것이다). `..`를 글자로 풀면 심볼릭 링크를 지날 때 실제 위치와 달라지므로 **입력에서 거부한다**: `manager::check_folder_segments`가 원래 글자를 구분자(Windows는 `/`·`\` 둘 다)로 나눠 `.`이나 `..` 구성 요소가 있으면 `invalidInput`이다(`Path::components()`는 중간의 `.`를 말없이 버려 쓰지 않는다). `resolve_folder`(`check_output`·`enqueue`, 요청 폴더와 설정에서 온 기본 폴더 모두)와 `update_settings`·`import_legacy`의 `absolute_dir`이 부른다. 절대 경로 요구는 전과 같다. `resume`은 검사를 지난 `enqueue`가 저장한 `rec.output`을 같은 `output_key`로 비교하므로 세 곳의 열쇠가 같다. 31(가)의 "`/x/./d/a.mp4`와 `/x/d/a.mp4`를 같은 열쇠로" 보던 것은 이제 `.` 쪽이 거부된다(`duplicate_output_normalizes_path_spelling`에서 `.` 경우를 `dot_segments_in_folder_are_rejected`로 옮겼다). Windows 드라이브 글자·경로 대소문자와 구분자 차이는 31(가)대로 같은 열쇠다(`windows_path_variants_are_keyed_consistently`, `#[cfg(windows)]`라 이 Mac에서는 돌리지 못했고 CI에서 본다). **하지 않은 것**: 심볼릭 링크·하드 링크 별칭(macOS `/tmp` 대 `/private/tmp`, Windows `\\?\` 접두사·8.3 짧은 이름), Windows가 구성 요소 끝의 `.`·공백을 떼는 것(`C:\Videos.\a.mp4`와 `C:\Videos\a.mp4`)은 같은 파일로 보지 않는다. 폴더 선택기와 OS 기본 폴더가 주는 경로는 이런 별칭을 섞지 않고, 두 작업이 정말 같은 파일에 붙으면 `.part` 잠금이 뒤 작업을 `fileLocked`로 멈춘다. 테스트: `dot_segments_in_folder_are_rejected`(`..`·`.`·끝 `..`, 설정 기본 폴더, 이름 일부인 `..videos`는 허용), `services.rs` `defaults_and_patch_rules`(설정 폴더 `/tmp/videos/../videos`·`/tmp/videos/./x`·`/tmp/videos/..`).

55. **CI를 `ci.yml` 하나로 옮김(Phase 4 G1, `docs/design/cicd.md`).** §14와 35·49의 `core.yml`·`app.yml`(그리고 `public-scan.yml`)을 지우고 경로 필터 없는 `.github/workflows/ci.yml`로 합쳤다. 작업은 `changes` → `lint`·`scripts (windows)`·`supply`·`rust`(3 OS, `-p chzzk-core -p chzzk-shell`)·`frontend`·`tauri`(3 OS, `-p chzzk-app` clippy·test + `pnpm tauri build --ci --debug --no-bundle`) → 집계 `ci-ok`이고, 모든 `run:`은 `node scripts/ci/run.mjs <gate>`다. 달라진 점: (가) `tauri`는 `shell`·`frontend`를 기다리지 않고 바로 돈다(gate 안에서 `pnpm install`, `dist`는 `beforeBuildCommand`가 만든다). (나) 러너는 `ubuntu-24.04`다(22.04는 deprecated). 산출물의 glibc 하한은 G3의 번들 작업이 `ubuntu:22.04` 컨테이너와 `glibc-floor` gate로 지킨다. (다) master push의 서명 없는 번들 업로드(49)는 G3의 `bundle`·`smoke-install`이 대신할 때까지 없다. (라) Linux apt 목록에서 `curl wget file patchelf`를 뺐다(번들 없음, `--no-install-recommends`). 명령과 이유는 cicd.md "구현 중 변경"에 있다.

56. **기동 스모크 `--smoke`와 command `frontend_ready`(Phase 4 G3, `docs/design/cicd.md` §6).** CI가 실제 바이너리·webview를 띄워 프런트가 `dist`를 읽고 CSP를 지나 IPC에 닿는지 본다. (가) **command `frontend_ready`**(23번째)를 `command_names.rs`·`commands.rs`·`generate_handler!`·`capabilities/default.json`(`allow-frontend-ready`)·`api.ts`(`frontendReady`)에 더했다. 프런트 `main.ts`가 mount 직후 `lib/ready.ts`의 `signalReady()`로 한 번 부른다(몇 번 불려도 한 번, 실패는 삼킨다). 보통 실행에서 Rust는 아무것도 하지 않는다(`SmokeState`가 없다). (나) **`--smoke`**(`src/smoke.rs`): 명령행에 정확히 `--smoke`가 있으면 single-instance 플러그인을 붙이지 않고(이미 떠 있는 앱에 포커스만 주고 끝나면 아무것도 증명하지 못한다), 설정·데이터·로그를 `CHZZK_SMOKE_DIR`(없으면 `<temp>/chzzk-smoke-<pid>`) 아래 `config`·`data`·`logs`로 바꾸고, OS 비디오·다운로드 폴더와 실행 파일 옆 옛 설정(legacy)을 보지 않는다. `frontend_ready`가 오면 `CHZZK_SMOKE_OUT`에 `{"version":"…","ready":true}` 한 줄을 쓰고 `exit(0)`, 쓰지 못하면 `exit(3)`. 60초 안에 오지 않으면 감시 스레드가 `ready:false`를 쓰고 `exit(2)`(시작 실패 창이 떠 멈춘 경우도 여기서 끝난다). 네트워크는 쓰지 않는다. 테스트: `smoke.rs`(인자 판정, 폴더, 마커 JSON, 시간 초과·한 번만 신호), `src/ready.test.ts`(main.ts를 실으면 한 번, 여러 번 불러도 한 번, `#app`이 없으면 0번), `api.test.ts` 표. 실측(macOS, debug 빌드): `CHZZK_SMOKE_OUT=… chzzk-app --smoke` → 약 2초에 exit 0, 마커 `{"version":"0.1.0","ready":true}`, 임시 폴더에 `data`·`logs`만 생김.

57. **e2e를 한다(Phase 4 G4, §13 표 마지막 행을 바꾼다, `docs/design/cicd.md` §6·구현 중 변경 36~).** §13의 "e2e는 v1에서 하지 않는다(tauri-driver가 macOS를 지원하지 않는다)"는 macOS만의 한계였다. 두 층으로 한다. (가) **웹 E2E**(`app/e2e/`, PR마다): 실제 프로덕션 `dist`를 `vite preview`로 띄우고 가짜 Rust 백엔드(`app/e2e/mock/backend.ts`, `@tauri-apps/api/mocks`의 `mockIPC`)를 앱보다 먼저 싣는다. 23개 command를 모두 받고 `subscribe_jobs` Channel에는 실제 IPC와 같은 `{index, message}`로 이벤트를 보낸다. 시간을 쓰지 않는다: 진행·완료·실패는 테스트가 `window.__e2e`로 하나씩 일으킨다. 흐름은 URL → 카드 → 화질 고르기 → `enqueue` 인자 전체 → 진행 → 일시정지·이어받기 → 완료 알림 → 완료 지우기, 받는 중 취소(D2), copy deck의 오류 카드 전부(28개 코드 × 불러오기·목록 항목), 설정(즉시 저장 패치 세 개·쿠키 저장 뒤 비움), 닫기 가드(D1)이고, 화면마다 `axe-core` 위반 0과 `pageerror`·`console.error` 0을 본다. (나) **네이티브 E2E**(`scripts/ci/e2e-native.mjs`, master·nightly Linux, weekly Windows): cargo feature `e2e`(`app/src-tauri/src/e2e.rs`)로 만든 debug 앱이 `CHZZK_E2E_API_BASE`(루프백 http만)·`CHZZK_E2E_DIR`(절대 경로, 설정·데이터·로그·기본 저장 폴더 `data/downloads`)이 둘 다 있을 때만 로컬 fixture 서버(`testdata/hls/`)에 붙는다. 하나만 있으면 시작하지 않는다. single-instance와 옛 설정 찾기를 끈다(스모크와 같다). tauri-driver로 받기 흐름 하나를 끝까지 돌리고 결과 파일의 sha256이 init‖seg0‖seg1과 같은지 본다. 릴리스 빌드에는 이 코드가 없다(`release-hygiene`, 그 씨앗 `hygiene-seed`). macOS는 여전히 수동 체크리스트(아래 표)와 `--smoke`(56)뿐이다.

58. **axe가 찾은 대비 문제 둘(57의 웹 E2E 첫 실행).** (가) 입력줄 아래 예시 글자(`RecentList` `.hint`, `url.hintExample`)가 `--fg-faint`(3:1, "본문에 쓰지 않음" 토큰)였다 → `--fg-muted`(4.5:1). (나) `SettingsView`의 `.settings :global(.label)`이 `Button`의 `<span class="label">`에도 걸려 쿠키 [저장](강조 버튼)의 글자가 흰색이 아니라 본문색(#1c262e, 청록 바탕에서 대비 2.77)이었다 → `.settings :global(.label:not(.btn > .label))`. 둘 다 vitest(jsdom)는 계산된 색을 보지 않아 잡지 못했다. 재발 검사: `app/e2e/flow.spec.ts`('빈 홈')·`settings.spec.ts`('쿠키 섹션')의 axe.

59. **Phase 3 앱 설계는 `docs/design/worker.md` §11이 기준이다(§12 "Phase 3 자리"와 §8.9를 대체한다. 설계만이고 구현은 Phase 3b A1~A5).** §12와 다른 점: (가) **기능 플래그는 cargo feature `auth`가 아니라 빌드 env `CHZZK_WORKER_BASE`의 유무**다(`features.auth = 주소가 있음`). `build.rs`가 읽어 `cargo:rustc-env`로 넘기고(`cargo:rerun-if-env-changed=CHZZK_WORKER_BASE`도 찍는다 — 값이 바뀌면 다시 빌드되게), 릴리스 프로필에서 값이 없거나 `https://`가 아니거나 경로·쿼리가 있으면 **컴파일 실패**(조용히 `auth=false`인 릴리스가 나가지 않게). debug는 없으면 `false`, 있으면 https 또는 루프백 http. `--features e2e`만 런타임 env `CHZZK_E2E_WORKER_BASE`(루프백 http)로 덮고 코드는 `e2e.rs`에만. PR·리허설 릴리스 빌드는 `https://worker.example.invalid`를 받고 태그 모드만 `DIST_BASE_URL`과 일치를 검사한다(cicd.md 82). (나) **토큰은 둘**: access `cda_…`(24h, Bearer)와 refresh `cdr_…`(30일 슬라이딩 rotation + 세션 절대 상한 60일, 사용자 결정 2026-10-06. POST 본문). §12의 `token: Secret`·`expires_at` 하나가 아니다. 갱신은 `tokio::sync::Mutex`로 single-flight, 새 쌍을 `session.json`에 원자적으로 쓴 뒤 상태를 바꾼다. 응답 유실은 같은 refresh로 1회 재시도(Worker가 60초 안 후계 미사용이면 재발급). `session.json`에 `origin` 필드를 두고 현재 빌드의 Worker 출처와 다르면 무시한다. (다) **`AuthState`에 `Checking`**을 더하고 `AuthStatusDto`에 `reason: Option<AuthReason>`(LoginTimeout·SessionExpired·Revoked·RemovedFromAllowlist·ReuseDetected·GraceExpired·Network·Server·LoginLost)·`pending: Option<PendingDto{user_code, expires_at}>`·`offline: Option<OfflineDto{since, grace_until}>`·`verified_at`을 더한다. 유예 중도 `signedIn`이고 오프라인은 필드로. bindings 재생성. (라) **3일 유예**: 마지막 성공 갱신 `verifiedAt` + 72h 안(단 `session.json`의 `refreshExpiresAt` = 60일 상한을 넘지 않는다)이고 실패가 네트워크 계열(연결·DNS·TLS·시간 초과·5xx·429·Worker 형식 `{code}`가 아닌 응답)일 때만 저장 세션으로 사용. 형식 있는 401·403은 즉시 차단. 유예 밖에서도 파일은 지우지 않아 [다시 연결]이 로그인 없이 복구한다. 시작은 유예 안이면 바로 메인(낙관), 밖이면 `checking`(최대 10초). 재확인은 `verifiedAt + 24h`, 10분마다 벽시계·창 포커스·절전 복귀에도. 판정은 순수 함수 `classify_verify` 표 하나. (마) **pending은 10분**(서버 `expiresAt`, §8.9 그림의 "약 5분"을 바꾼다). 확인 코드(`userCode`)를 앱 화면과 브라우저 확인 페이지에 함께 보여 공격자가 시작한 로그인 URL을 눈에 보이게 한다. `auth_copy_login_url`(URL에는 handle뿐)을 더한다. (바) **§12 "세션 만료: 새 resolve가 401이면"은 성립하지 않는다**(코어는 앱 세션을 쓰지 않는다). 세션 판정은 Worker 갱신 결과로만 한다. 진행 중·대기 중 다운로드는 어떤 전이에서도 계속되고, `resume_job`·재시작 후 자동 이어받기만 `signedIn`(같은 채널)을 요구한다(보류 시 B1 문구 "로그인하면 이어받을 수 있어요"). (사) **업데이트**(§12 "Phase 4에서 설정에만"을 바꾼다): 시작 후 첫 성공 갱신 직후 한 번 자동 `update_check` → 배너 B4, 설치는 사용자. endpoint는 `tauri.conf.json`에 커밋하지 않고 런타임 `updater_builder().endpoints([base + "/update/{{current_version}}"]).header("Authorization", …)`로 넣는다(헤더는 확인·다운로드 요청 둘 다에 붙는다). `check()`는 401과 네트워크를 구분하지 못하므로 세션 판정이 유효할 때만 부르고, `Update.download_url`의 출처가 Worker 출처와 다르면 받지 않는다(`update.untrusted`). 설치 전에 받는 중 작업이 있으면 D1식 확인 뒤 `quit` 경로로 일시정지·`jobs.json` flush. (아) **OwnershipGate는 G-ID 게이트(worker.md §15)가 녹색일 때만 켠다**(별 커밋). 판정 채널 ID는 토큰 묶음의 `channelId`(Worker가 본인 판정용 값을 채운다) 하나다. (자) 새 command: `auth_login`·`auth_reopen`·`auth_copy_login_url`·`auth_cancel`·`auth_retry`·`auth_logout`·`update_check`·`update_install`, 이벤트 `auth-changed`·`update-available`·`update-progress`. copy deck 추가 키는 worker.md §11.7. CSP의 `connect-src`는 그대로(Worker 호출은 전부 Rust).

60. **Phase 3b A2(worker.md 구현 중 변경 54~61).** 59 (가)의 `features.auth`는 로그인 서비스가 있는지이고 릴리스는 늘 켜져 있다(59, 설치 스모크가 확인). 셸 command 층 게이트가 생겼다: 로그인 전에는 허용 목록(`app_info`·`auth_*`·`frontend_ready`·`quit`·`list_jobs`·`subscribe_jobs`) 밖 command가 `notLoggedIn`이다. A3 화면은 (1) `onAuthChanged`를 먼저 듣고 `authStatus()`를 부르고 (2) `features.auth`이고 `signedIn`이 아니면 로그인 화면만 그리며 (3) `get_settings` 등 게이트 뒤 command는 `signedIn`이 된 뒤에 부른다(`subscribe_jobs`는 그 전에도 된다). `notLoggedIn` 오류 문구(`errors.ts`의 "내 채널의 영상만…")는 로그인 전 거부와 맞지 않으므로 A3에서 나눈다. 시각 DTO는 유닉스 초다.

61. Phase 3b A3(worker.md 구현 중 변경 62~66). §8.9 S3 그림·§9 `auth.*` 문구·§12 AccountSlot·B3를 바꾼다. 화면은 `LoginView`(뷰가 아니라 App의 게이트 분기, `View`에서 `'login'`을 지웠다), 헤더 `AccountSlot`(채널 이름 + 오프라인 배지 `Badge tone=warning` + 계정 메뉴 [다시 연결]·[로그아웃], 로그아웃 확인 대화상자 기본 [취소]), 표시 전용 `UpdateBanner`(A4가 배선). copy deck의 `auth.retry`는 `auth.relogin`(다시 로그인)으로 이름을 바꿨다(command `auth_retry` = [다시 연결]과 헷갈리지 않게). `banner.sessionExpired`(B3)는 지웠다. `errors.ts`의 `notLoggedIn`은 '로그인이 필요해요 / 치지직 계정으로 로그인한 뒤 다시 시도해 주세요.'로 나눴다(60). 설정 화면 로드는 로그인 상태가 열릴 때마다 한다(`get_settings`가 게이트 뒤).

A4-8. Phase 3b A4(worker.md 구현 중 변경 A4-1~A4-7). 59 (사)의 업데이트를 배선한다. 배너 B4: `UpdateBanner`를 `AppBanners`의 B1 뒤에 두고 하나만 보인다. 받는 중·설치 중에는 진행 문구가 나오고 닫을 수 없으며 B2·B1보다 앞선다(A4-7). 확인 대화상자: `UpdateDialog`는 `dialog.update.*`이고 기본은 [나중에]다. 설정 > 정보: [업데이트 확인]은 로그인했을 때만 있고 결과는 `settings.about.*` 한 줄이다(`settings.about.checking` 새 키). 프런트 `update` store는 `update-available`·`update-progress`를 듣고, 잠금이 풀릴 때 `update_available`로 캐시를 읽는다. [나중에]는 이 실행 동안 그 버전만 숨긴다. 로그인 화면은 `canReconnect`이면 [다시 연결]을 붙인다.

### 수동 스모크 체크리스트 결과 (§15 17행, 2026-10-05 macOS)

**최종 리뷰 추가 실행(2026-10-05, macOS, 52를 고친 debug 바이너리).** CLI에서 `screencapture`로 창을 찍고 `cliclick`·System Events로 눌러 확인했다(합성 키 입력은 메뉴 가속키(Cmd+A·V·Q)에 닿지 않고 한글 IME가 켜져 있으면 글자가 깨져, 붙여넣기·Cmd+Q 자체는 사람이 확인해야 한다). 확인한 것: 창이 디자인대로 그려짐(다크, 토큰·레이아웃, 런타임 CSP로 깨진 스타일 없음) · 실제 주소 `resolve`(없는 VOD → `notFound` 카드, 잘못된 주소 → `invalidUrl` 카드, 클립 2건 → 카드에 종류 배지·제목·채널·화질 1~2개·폴더·파일 이름) · 창 포커스 때 클립보드 제안(블러 뒤 다시 포커스하면 "복사한 주소가 있어요", 이미 불러온 주소는 다시 제안하지 않음) · 제안 [불러오기] → [다운로드] → 목록 "받는 중"(막대·크기·속도·남은 시간) → 완료 토스트·"완료 · 12.7 MB · 오후 2:12" · 일시정지(95%, "일시정지됨 · 12.4 MB 받음") → 이어받기 → 완료 · 메뉴 Quit(작업 없음) → "앱 종료" 로그 · 메뉴 Quit(받는 중) → D1 → [닫기] → `interrupted` + `.part`·sidecar → 종료 · 재시작 → B1 "지난번에 받다가 멈춘 다운로드가 1개 있어요" → [모두 이어받기] → 완료 · 최근 VOD 2건 · 설정 화면 다섯 섹션(기본 폴더 `~/Movies/치지직`, 동시 2, 연결 4, 자동 이어받기 꺼짐, 고급 접힘, 이전 버전, 버전 0.1.0 (코어 0.1.0)). 번들 없는 debug 바이너리라 메뉴 바 앱 이름은 `chzzk-app`이다(.app 번들에서는 `productName`).

CLI 세션에서는 웹뷰 화면·개발자 도구를 조작할 수 없어 대부분을 실행하지 못했다. 자동 테스트가 같은 판단을 대신 보는 항목은 "대신 본 것"에 적었다. **미확인 항목은 사람이 3 OS에서 돌려야 한다.**

| 항목 | 결과 | 대신 본 것 |
|---|---|---|
| 웹뷰 콘솔 런타임 CSP 위반 없음 | **화면으로 확인**(콘솔은 미확인) | `csp.test.ts`(템플릿 `style=`·`{@html}` 없음), `pnpm build` 결과 정적 검사 |
| 실제 주소로 `resolve` → 빠른 다시보기·일반 VOD·클립 각 1건 받기 | **클립 2건 확인**(빠른 다시보기·일반 VOD는 미확인) | 셸 `tests/secrets.rs`·IPC `channel_sink_delivers_job_events…`(wiremock 끝까지 받기) |
| 일시정지 → D1 → 재시작 → B1 → 이어받기 → 완료 → 파일 열기·폴더 열기 | **확인**(파일 열기·폴더 열기 버튼은 미확인, 52) | 매니저 전이·`quit` 테스트, `jobs.test.ts`·`closeguard.test.ts`·`a11y.test.ts` |
| 같은 경로 두 번 추가(`duplicateOutput`), 완성 파일 이름으로 추가(번호 붙이기) | 미확인 | 셸 매니저 테스트, `receive.test.ts` 충돌 세 형태 |
| D1 `[닫기]` 두 번·3초 대기 중 Cmd+Q(`ExitRequested`로 오는지) | **메뉴 Quit → D1 확인**(52에서 고침). 두 번 누르기·대기 중 Cmd+Q는 미확인 | IPC `quit_runs_once_and_blocks_close_silently_meanwhile`, `closeguard.test.ts` |
| 읽을 수 없는 `jobs.json`으로 시작 → 시작 실패 창 | 미확인 | `startup_failure_message` 단위 테스트, Tauri 소스 확인(위) |
| 쿠키 넣고 켜기·끄기, 옛 폴더 가져오기 | 미확인 | `settings.test.ts`, 셸 `SettingsService` 테스트 |
| 텍스트 드래그 앤 드롭·창 포커스 클립보드 제안·입력칸 밖 붙여넣기(3 OS 웹뷰가 이벤트를 주는지) | **macOS 클립보드 제안 확인**(드롭·붙여넣기는 미확인) | `receive.test.ts`·`shortcuts.test.ts`(jsdom 이벤트) |
| 끌던 요소가 사라진 뒤 바깥 드롭 한 번 놓침(44(가)) | 미확인 | - |
| 창 포커스가 없을 때 완료·실패 OS 알림과 Dock·작업 표시줄 주의(서명 안 된 debug 빌드) | 미확인 | `sink.rs` 단위 테스트(알릴 일·본문·`should_notify`), IPC 완료·실패 알림 큐 |
| 창 폭 720 레이아웃, 다크 모드 | **다크 모드 확인**(960px). 720은 미확인 | `tokens.test.ts`(다크 토큰·대비). 960px 브라우저(mock IPC)에서 작업 메뉴·상태 줄·토스트는 48(가)에서 봤다 |
| debug 바이너리 시작·로그 | **확인** | `~/Library/Logs/…/chzzk-downloader.*.log`에 시작 로그, 패닉 없음 |
| `pnpm tauri build --ci --debug --no-bundle`(넣은 `dist`) 바이너리 시작(§15-18, 49) | **확인**(창 내용은 미확인) | 빌드 성공, `target/debug/chzzk-app`이 떠서 시작 로그(기본 폴더 `~/Movies/치지직`)를 남기고 패닉 없이 돌다 종료 신호로 끝남. 창이 다른 앱 뒤에 떠 화면 캡처로 내용을 보지 못했다 |
| 거의 동시 두 실행 → 하나만 남음(51(다)) | **확인**(`.smoke` identifier 사본) | `instance_lock_admits_one_holder_and_frees_on_drop` |
| 51 고친 바이너리 시작(`app.lock` 생성·시작 로그) | **확인**(`.smoke` identifier 사본, 창 내용은 미확인) | 51(라) |
