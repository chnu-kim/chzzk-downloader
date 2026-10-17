//! 작업 목록 저장(`{app_data_dir}/jobs.json`, docs/design/app.md §7.1).
//!
//! - 쓰기는 `fsutil::atomic_write`이고 **상태가 바뀔 때만** 쓴다(진행률 틱마다 쓰지 않는다). 쓰는 쪽은 매니저 하나다.
//! - 깨진 파일(JSON 오류, 최상위가 object가 아님, 모르는 형식 버전)은 `jobs.json.bad-{unix_ts}`로 옮기고 빈 목록으로 시작한다.
//!   권한 같은 읽기 오류는 옮기지 않고 `Io`다(옮길 이유가 없는 파일을 빈 목록으로 덮어쓰지 않으려고).
//! - `DownloadRequest`·`DuplicatePolicy`·`NonZeroU8`는 serde 타입이 아니라 `JobRecord`가 같은 내용을 미러로 들고
//!   `to_request()`로 요청을 만든다. **이어받기 동일성 키**(`content`, `qualityId`, `expectedKind`, `recordingId`, `output`)는
//!   `.part`가 생긴 뒤 바꾸지 않는다.

use std::ffi::OsString;
use std::num::NonZeroU8;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use chzzk_core::download::MAX_CONCURRENCY;
use chzzk_core::download::part::{PartOwner, Sidecar, part_path, sidecar_path};
use chzzk_core::fsutil::{atomic_write, map_io_error, rename_with_retry};
use chzzk_core::{ContentRef, DownloadRequest, Error, PlaybackKind, TimeRange};
use serde::{Deserialize, Serialize};

use crate::chat::{ChatPhase, ChatState};
use crate::dto::{
    ContentKindDto, JobDto, JobId, JobStatus, LiveEndDto, OnExisting, ProgressDto, TimeRangeDto,
};
use crate::error::AppError;

/// 작업 목록 파일 이름.
pub const JOBS_FILE: &str = "jobs.json";

/// 작업 목록 형식 버전.
pub const JOBS_VERSION: u32 = 1;

/// 작업 하나의 영속 레코드.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRecord {
    pub id: JobId,
    /// 정규화된 입력 주소(최근 VOD·"다시 불러오기"용)
    pub url: String,
    pub content: ContentRef,
    pub title: String,
    pub channel_name: String,
    /// 컨텐츠 채널 ID(A5: 이어받기 소유 판정). 로그인을 쓰는 빌드는 셸이 검증한 값, 쓰지 않는 빌드는 요청 값이다
    #[serde(default)]
    pub channel_id: Option<String>,
    pub kind: ContentKindDto,
    pub quality_id: String,
    pub quality_label: String,
    pub expected_kind: PlaybackKind,
    /// 구간 받기의 요청 구간(사용자 입력 원값, 끝 없음은 `None`). 이어받기 동일성 키다(`.part`가 생긴 뒤 바꾸지 않는다).
    /// 옛 레코드에는 없다(전체 받기). 재개 요청은 이 값을 그대로 코어에 넘긴다
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range: Option<TimeRange>,
    /// 생방송 녹화 작업의 고유값(core.md 61). `enqueue`가 생방송에만 만든다. v0.7.0 레코드에는 없다(`None`)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recording_id: Option<String>,
    /// 최종 경로. 추가할 때 계산해 둔다(설정 폴더가 바뀌어도 같은 `.part`를 찾게)
    pub output: PathBuf,
    pub on_existing: OnExisting,
    /// 추가 당시의 `segment_concurrency`. 설정을 바꿔도 이 작업에는 적용하지 않는다
    pub concurrency: u8,
    pub status: JobStatus,
    /// unix 초
    pub created_at: u64,
    #[serde(default)]
    pub finished_at: Option<u64>,
    /// paused·interrupted·failed로 바뀐 시각(unix 초). 그 밖 상태는 `None`, 옛 레코드에는 없다.
    /// `finished_at`은 완료·건너뜀 전용(정렬에 쓰인다)이라 재사용하지 않는다
    #[serde(default)]
    pub stopped_at: Option<u64>,
    #[serde(default)]
    pub final_bytes: Option<u64>,
    /// 끝난 생방송 녹화의 이유와 놓친 조각 수(core.md 65). `Completed`일 때만 있다. 옛 레코드에는 없다(`None`).
    /// 모르는 값(뒤 버전이 더한 이유)은 버리고 `None`으로 읽는다: jobs.json 전체를 못 읽게 되면 안 된다
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "lenient_live_end"
    )]
    pub live_end: Option<LiveEndDto>,
    #[serde(default)]
    pub last_error: Option<AppError>,
    /// 채팅 함께 받기의 하위 상태(chat.md §4.1). 채팅을 고르지 않았거나 옛 레코드면 `None`. 생방송·클립은 늘 `None`.
    /// 모르는 모양(뒤 버전이 더한 단계)은 버리고 `None`으로 읽는다: jobs.json 전체를 못 읽게 되면 안 된다
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "lenient_chat"
    )]
    pub chat: Option<ChatState>,
    /// 다음 시작 때 `download()` 전에 `discard_partial(output)`한다("처음부터"). 시작하기 전에 앱이 꺼져도
    /// 남아 있어야 옛 `.part`를 이어받지 않는다. 지운 뒤 false로 저장한다.
    #[serde(default)]
    pub discard_on_start: bool,
    /// 완료 뒤 같은 출력을 다른 컨텐츠가 받아 완료해 영상 파일이 그 컨텐츠로 바뀌었다(Codex PR #141 2차 ①, app.md 85-14).
    /// 그 파일 옆에 이 기록의 채팅·자막을 놓지 않는다(채팅만 받기 거부, 자동·종료 취소 되살리기 건너뜀). 대체한 기록이
    /// 정리돼도 남아야 하므로 저장한다. 이 기록이 다시 받아 완료하면 지운다. 옛 레코드에는 없다(`false`)
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub output_replaced: bool,
    /// 멈춘 뒤 실제 `.part`·sidecar로 확인한 바이트. 저장하지 않고 시작 때 reconcile이 다시 채운다
    #[serde(skip)]
    pub partial_bytes: Option<u64>,
    /// completed인데 파일이 없다. 저장하지 않고 reconcile이 채운다
    #[serde(skip)]
    pub missing: bool,
}

/// `liveEnd`를 읽되 모르는 모양이면 `None`으로 둔다(앱을 옛 버전으로 되돌렸을 때 jobs.json을 지키려고).
fn lenient_live_end<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<LiveEndDto>, D::Error> {
    let v = Option::<serde_json::Value>::deserialize(d)?;
    Ok(v.and_then(|v| serde_json::from_value(v).ok()))
}

/// `chat`을 읽되 모르는 모양이면 `None`으로 둔다(`lenient_live_end`와 같은 이유).
fn lenient_chat<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<ChatState>, D::Error> {
    let v = Option::<serde_json::Value>::deserialize(d)?;
    Ok(v.and_then(|v| serde_json::from_value(v).ok()))
}

impl JobRecord {
    /// 코어 다운로드 요청.
    pub fn to_request(&self) -> DownloadRequest {
        DownloadRequest {
            content: self.content.clone(),
            quality_id: self.quality_id.clone(),
            expected_kind: self.expected_kind,
            output: self.output.clone(),
            on_existing: self.on_existing.into(),
            concurrency: concurrency(self.concurrency),
            live_stop: None,
            recording_id: self.recording_id.clone(),
            range: self.range,
        }
    }

    /// 이 작업이 `.part`의 주인인지 가리는 열쇠.
    pub fn owner(&self) -> PartOwner<'_> {
        PartOwner {
            content: &self.content,
            quality_id: &self.quality_id,
            kind: self.expected_kind,
            recording_id: self.recording_id.as_deref(),
            range: self.range,
        }
    }

    /// 프런트로 보낼 모양.
    pub fn to_dto(&self, progress: Option<ProgressDto>) -> JobDto {
        JobDto {
            id: self.id,
            url: self.url.clone(),
            title: self.title.clone(),
            channel_name: self.channel_name.clone(),
            channel_id: self.channel_id.clone(),
            kind: self.kind,
            playback_kind: self.expected_kind,
            quality_label: self.quality_label.clone(),
            output: self.output.to_string_lossy().into_owned(),
            status: self.status,
            progress,
            error: self.last_error.clone(),
            partial_bytes: self.partial_bytes,
            final_bytes: self.final_bytes,
            missing: self.missing,
            created_at: self.created_at,
            finished_at: self.finished_at,
            stopped_at: self.stopped_at,
            range: self.range.map(TimeRangeDto::from),
            live_end: self.live_end,
            chat: self.chat.as_ref().map(ChatState::to_dto),
        }
    }

    /// 상태를 바꾸고 `stopped_at`을 맞춘다: paused·interrupted·failed로 바꾸면 `now`, queued·running·completed·
    /// skipped로 바꾸면 `None`. pausing은 멈추는 중이라 건드리지 않는다.
    pub fn set_status(&mut self, status: JobStatus, now: u64) {
        self.status = status;
        match status {
            JobStatus::Paused | JobStatus::Interrupted | JobStatus::Failed => {
                self.stopped_at = Some(now);
            }
            JobStatus::Queued | JobStatus::Running | JobStatus::Completed | JobStatus::Skipped => {
                self.stopped_at = None
            }
            JobStatus::Pausing => {}
        }
    }
}

/// 1~`MAX_CONCURRENCY`로 자른다(손으로 고친 파일의 0도 받는다).
pub fn concurrency(n: u8) -> NonZeroU8 {
    NonZeroU8::new(n.clamp(1, MAX_CONCURRENCY)).unwrap_or(NonZeroU8::MIN)
}

/// `jobs.json` 전체.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobsFile {
    /// 형식 버전(`JOBS_VERSION`)
    pub v: u32,
    /// 다음에 줄 id. 지운 작업의 id를 다시 쓰지 않는다
    pub next_id: u64,
    pub jobs: Vec<JobRecord>,
}

impl Default for JobsFile {
    fn default() -> Self {
        JobsFile {
            v: JOBS_VERSION,
            next_id: 1,
            jobs: Vec::new(),
        }
    }
}

impl JobsFile {
    /// 새 id를 준다(단조 증가).
    pub fn alloc_id(&mut self) -> JobId {
        let id = JobId(self.next_id);
        self.next_id += 1;
        id
    }

    /// `next_id`가 저장된 어떤 id보다 크게 맞춘다(손으로 고친 파일 대비).
    fn repair_next_id(&mut self) {
        let max = self.jobs.iter().map(|j| j.id.0).max().unwrap_or(0);
        self.next_id = self.next_id.max(max + 1).max(1);
    }
}

/// 읽은 결과.
#[derive(Debug)]
pub struct Loaded {
    pub file: JobsFile,
    /// 깨진 파일을 옮긴 경로
    pub backup: Option<PathBuf>,
}

/// 파일 쓰기 함수(테스트가 느린·막힌 디스크를 흉내 내려고 바꾼다).
pub type WriteFn = Arc<dyn Fn(&Path, &[u8]) -> Result<(), Error> + Send + Sync>;

/// `jobs.json` 저장소.
#[derive(Clone)]
pub struct JobStore {
    path: PathBuf,
    write: Option<WriteFn>,
}

impl std::fmt::Debug for JobStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("JobStore")
            .field("path", &self.path)
            .field("custom_write", &self.write.is_some())
            .finish()
    }
}

impl JobStore {
    /// `{data_dir}/jobs.json`.
    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        JobStore {
            path: data_dir.into().join(JOBS_FILE),
            write: None,
        }
    }

    /// 마지막 파일 쓰기(`atomic_write`)를 `write`로 바꾼다. 폴더 만들기는 그대로 한다. 테스트용.
    #[doc(hidden)]
    pub fn with_write_fn(mut self, write: WriteFn) -> Self {
        self.write = Some(write);
        self
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// 읽는다. 없으면 빈 목록, 깨졌으면 `.bad-{ts}`로 옮기고 빈 목록.
    pub fn load(&self) -> Result<Loaded, Error> {
        let bytes = match std::fs::read(&self.path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Loaded {
                    file: JobsFile::default(),
                    backup: None,
                });
            }
            Err(e) => return Err(map_io_error("read", &self.path, e)),
        };
        match parse(&bytes) {
            Ok(mut file) => {
                file.repair_next_id();
                Ok(Loaded { file, backup: None })
            }
            Err(reason) => {
                let bad = unique_sibling(&self.path, ".bad-");
                rename_with_retry(&self.path, &bad)?;
                tracing::warn!(%reason, backup = %bad.display(), "깨진 작업 목록을 옮기고 빈 목록으로 시작");
                Ok(Loaded {
                    file: JobsFile::default(),
                    backup: Some(bad),
                })
            }
        }
    }

    /// 원자적으로 쓴다. 폴더가 없으면 만든다.
    pub fn save(&self, file: &JobsFile) -> Result<(), Error> {
        self.write_bytes(&Self::encode(file)?)
    }

    /// 저장할 바이트. 매니저는 상태 잠금 안에서 이것만 하고 쓰기는 잠금 밖의 쓰기 스레드에 넘긴다.
    pub fn encode(file: &JobsFile) -> Result<Vec<u8>, Error> {
        serde_json::to_vec_pretty(file)
            .map_err(|e| Error::Settings(format!("작업 목록 직렬화 실패: {e}")))
    }

    /// `encode`한 바이트를 원자적으로 쓴다. 폴더가 없으면 만든다.
    pub fn write_bytes(&self, bytes: &[u8]) -> Result<(), Error> {
        if let Some(dir) = self.path.parent().filter(|d| !d.as_os_str().is_empty()) {
            std::fs::create_dir_all(dir).map_err(|e| map_io_error("create dir", dir, e))?;
        }
        match &self.write {
            Some(w) => w(&self.path, bytes),
            None => atomic_write(&self.path, bytes),
        }
    }
}

/// 최상위 object이고 형식 버전이 맞을 때만 읽는다.
fn parse(bytes: &[u8]) -> Result<JobsFile, String> {
    let v: serde_json::Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    if !v.is_object() {
        return Err("최상위가 object가 아닙니다".into());
    }
    let file: JobsFile = serde_json::from_value(v).map_err(|e| e.to_string())?;
    if file.v != JOBS_VERSION {
        return Err(format!("모르는 형식 버전 {}", file.v));
    }
    Ok(file)
}

/// 시작 때 한 번 저장된 목록을 실제 파일과 맞춘다(§7.1 reconcile 표).
///
/// | 저장된 상태 | 파일 | 결과 |
/// |---|---|---|
/// | `running`·`pausing`·`queued` | - | `interrupted`(자동 재개는 매니저가 설정을 보고 따로 한다), `stopped_at`이 없으면 지금 |
/// | `paused`·`interrupted`·`failed`·`skipped` | `.part`·sidecar가 있고 같은 작업 | `partial_bytes = committed_len` |
/// | 〃 | `.part`가 있고 sidecar를 읽지 못함(없음·깨짐이 아닌 오류) | `partial_bytes = .part 길이`(모른다, `partial_bytes`) |
/// | 〃 | 그 밖 | `partial_bytes = None` |
/// | `completed` | 최종 파일 없음 | `missing = true` |
///
/// 목록에 없는 고아 `.part`는 찾지 않는다.
pub fn reconcile(file: &mut JobsFile) {
    for j in &mut file.jobs {
        if matches!(
            j.status,
            JobStatus::Running | JobStatus::Pausing | JobStatus::Queued
        ) {
            j.status = JobStatus::Interrupted;
            // 이미 있으면(일시정지 중 앱이 꺼진 pausing 등) 처음 멈춘 시각을 지킨다
            j.stopped_at.get_or_insert_with(now_secs);
        }
        j.partial_bytes = None;
        j.missing = false;
        match j.status {
            JobStatus::Paused | JobStatus::Interrupted | JobStatus::Failed | JobStatus::Skipped => {
                j.partial_bytes = partial_bytes(j);
            }
            JobStatus::Completed => j.missing = !j.output.exists(),
            _ => {}
        }
        reconcile_chat(j);
    }
}

/// 채팅 하위 상태의 reconcile(chat.md §4.2 "앱을 다시 열 때").
///
/// | 저장된 채팅 | 영상 | 결과 |
/// |---|---|---|
/// | `running` | - | `interrupted` |
/// | `waiting` | 완료 | `interrupted`(채팅 차례를 기다리다 꺼짐) |
/// | `waiting` | 완료가 아님 | 그대로(영상을 이어받아 완료하면 줄 선다) |
/// | 그 밖 | - | 그대로 |
///
/// 받다 만 채팅 바이트(`partial_bytes`)는 늘 실제 파일로 다시 센다(`chat_partial_bytes`). 영상이 아닌 기록의 채팅은 버린다.
fn reconcile_chat(j: &mut JobRecord) {
    let ContentRef::Video { video_no } = j.content else {
        j.chat = None;
        return;
    };
    let completed = j.status == JobStatus::Completed;
    let Some(c) = j.chat.as_mut() else {
        return;
    };
    match c.phase {
        ChatPhase::Running => c.phase = ChatPhase::Interrupted,
        ChatPhase::Waiting if completed => c.phase = ChatPhase::Interrupted,
        _ => {}
    }
    c.partial_bytes = match c.phase {
        ChatPhase::Completed => None,
        _ => chzzk_core::chat::chat_partial_bytes(&j.output, video_no),
    };
}

/// 이 작업이 이어받을 수 있는 `.part`의 바이트(sidecar `committed_len`).
///
/// `.part`와 sidecar가 모두 있고 sidecar가 같은 작업(컨텐츠·화질·방식)이며 `.part`가 `committed_len`보다 짧지 않을 때만 `Some`이다.
/// `discard_on_start`(처음부터)가 켜져 있으면 늘 `None`이다.
/// sidecar가 없거나 깨졌거나 다른 작업이면 코어가 재개 때 새로 시작하므로 `None`이다.
/// (`check_output`은 이와 달리 sidecar가 없으면 `.part` 길이를 보여 준다. 섞지 않는다.)
/// 생방송은 마무리할 영상 조각이 있을 때만(`has_live_media`) `Some`이다. init만 든 녹화는 코어가 다음 실행에서 init을
/// 버리고 새로 녹화하므로 받은 것이 없다(core.md 61 M3). 그래서 경로 잡기(`keeps_recording`)·화면의 받은 부분 안내·
/// 자동 이어받기가 모두 이 한 규칙을 따른다.
/// sidecar는 잠그지 않고 읽기만 한다(`atomic_write`로 쓰이므로 반쯤 쓴 파일은 없다).
/// sidecar를 **읽지 못하면**(없음·깨짐이 아닌 읽기 오류: Windows 공유 위반·권한 거부 등) 받은 부분이 없는 것이 아니라
/// 모르는 것이라 `.part` 길이를 준다(Codex PR #113 2회차 ④). 그래야 실패한 녹화가 경로를 계속 잡고(`keeps_recording`),
/// 같은 녹화의 다른 옛 기록이 받은 부분을 잃은 것처럼 보여 형제 갱신(`refresh_siblings`)에서 빠지지 않는다. 코어도 그
/// sidecar를 읽지 못하면 아무것도 지우지 않고 오류다(`read_sidecar`의 세 상태).
pub fn partial_bytes(j: &JobRecord) -> Option<u64> {
    // "처음부터"로 표시된 작업은 다음 시작 때 `.part`를 지우므로 이어받을 것이 없다.
    if j.discard_on_start {
        return None;
    }
    let part_len = std::fs::metadata(part_path(&j.output))
        .ok()
        .filter(|m| m.is_file())?
        .len();
    let sc = match read_sidecar_checked(&j.output) {
        Ok(sc) => sc?,
        Err(e) => {
            tracing::warn!(error = %e, job = j.id.0, "sidecar를 읽지 못해 받은 부분이 있는 것으로 둔다");
            return Some(part_len);
        }
    };
    let live_without_media = sc.kind == PlaybackKind::Live && !sc.has_live_media();
    // `committed_len`보다 짧은 `.part`는 이 sidecar의 파일이 아니다(코어 `resume`이 둘 다 지우고 새로 시작한다, `Sidecar::describes`)
    (sc.owned_by(&j.owner()) && !live_without_media && sc.describes(part_len))
        .then_some(sc.committed_len)
}

/// 생방송 작업의 `.part`에 마무리할 영상 조각이 있는가(이 작업의 sidecar, init만이 아님). 자동 이어받기가 쓴다(core.md 61 M3).
pub fn live_media_ready(j: &JobRecord) -> bool {
    partial_bytes(j).is_some() && read_sidecar(&j.output).is_some_and(|s| s.has_live_media())
}

/// 새 생방송 녹화 작업의 고유값: 16바이트 난수 hex(32자).
pub fn new_recording_id() -> String {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).expect("OS 난수원을 쓸 수 없다");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// `{output}.part.json`을 읽는다. 없거나 깨졌거나 읽지 못하면 `None`(안내용. 받은 부분 판단은 `partial_bytes`).
pub fn read_sidecar(output: &Path) -> Option<Sidecar> {
    read_sidecar_checked(output).ok().flatten()
}

/// `{output}.part.json`을 읽는다. 없거나 깨졌으면 `Ok(None)`, 그 밖의 읽기 실패는 `Err`(주인을 확인하지 못했다).
fn read_sidecar_checked(output: &Path) -> std::io::Result<Option<Sidecar>> {
    match std::fs::read(sidecar_path(output)) {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes).ok()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// 지금 unix 초.
pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// `{path}{sep}{ts}`, 이미 있으면 `-1`, `-2` …
fn unique_sibling(path: &Path, sep: &str) -> PathBuf {
    let ts = now_secs();
    let mut p = with_suffix(path, &format!("{sep}{ts}"));
    let mut n = 1;
    while p.exists() {
        p = with_suffix(path, &format!("{sep}{ts}-{n}"));
        n += 1;
    }
    p
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut s: OsString = path.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

/// `enqueue`의 구간 재검증. 셸은 영상 길이를 모르므로(`EnqueueRequest`에 길이가 없다) 길이 없이 할 수 있는 것만 본다.
/// 시작이 길이를 넘는지·끝을 자를지는 코어 `select_range`(`rangeOutOfBounds`)가 맡는다.
///
/// 값은 바꾸지 않는다(끝 없음 `None`·초 미만 그대로): 정규화 자리는 이 한 번의 형 변환뿐이다.
pub fn validated_range(
    kind: PlaybackKind,
    range: Option<TimeRangeDto>,
) -> Result<Option<TimeRange>, AppError> {
    let Some(r) = range else {
        return Ok(None);
    };
    if kind != PlaybackKind::LiveRewindHls {
        return Err(AppError::invalid_input(
            "구간은 빠른 다시보기에서만 받을 수 있습니다",
        ));
    }
    if r.end_ms.is_some_and(|end| r.start_ms >= end) {
        return Err(AppError::invalid_input(
            "구간의 시작이 끝보다 앞이어야 합니다",
        ));
    }
    Ok(Some(r.into()))
}
