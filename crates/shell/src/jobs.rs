//! 작업 목록 저장(`{app_data_dir}/jobs.json`, docs/design/app.md §7.1).
//!
//! - 쓰기는 `fsutil::atomic_write`이고 **상태가 바뀔 때만** 쓴다(진행률 틱마다 쓰지 않는다). 쓰는 쪽은 매니저 하나다.
//! - 깨진 파일(JSON 오류, 최상위가 object가 아님, 모르는 형식 버전)은 `jobs.json.bad-{unix_ts}`로 옮기고 빈 목록으로 시작한다.
//!   권한 같은 읽기 오류는 옮기지 않고 `Io`다(옮길 이유가 없는 파일을 빈 목록으로 덮어쓰지 않으려고).
//! - `DownloadRequest`·`DuplicatePolicy`·`NonZeroU8`는 serde 타입이 아니라 `JobRecord`가 같은 내용을 미러로 들고
//!   `to_request()`로 요청을 만든다. **이어받기 동일성 키**(`content`, `qualityId`, `expectedKind`, `output`)는
//!   `.part`가 생긴 뒤 바꾸지 않는다.

use std::ffi::OsString;
use std::num::NonZeroU8;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use chzzk_core::download::MAX_CONCURRENCY;
use chzzk_core::download::part::{Sidecar, part_path, sidecar_path};
use chzzk_core::fsutil::{atomic_write, map_io_error, rename_with_retry};
use chzzk_core::{ContentRef, DownloadRequest, Error, PlaybackKind};
use serde::{Deserialize, Serialize};

use crate::dto::{ContentKindDto, JobDto, JobId, JobStatus, OnExisting, ProgressDto};
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
    /// Phase 3 소유 재검사용
    #[serde(default)]
    pub channel_id: Option<String>,
    pub kind: ContentKindDto,
    pub quality_id: String,
    pub quality_label: String,
    pub expected_kind: PlaybackKind,
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
    #[serde(default)]
    pub final_bytes: Option<u64>,
    #[serde(default)]
    pub last_error: Option<AppError>,
    /// 다음 시작 때 `download()` 전에 `discard_partial(output)`한다("처음부터"). 시작하기 전에 앱이 꺼져도
    /// 남아 있어야 옛 `.part`를 이어받지 않는다. 지운 뒤 false로 저장한다.
    #[serde(default)]
    pub discard_on_start: bool,
    /// 멈춘 뒤 실제 `.part`·sidecar로 확인한 바이트. 저장하지 않고 시작 때 reconcile이 다시 채운다
    #[serde(skip)]
    pub partial_bytes: Option<u64>,
    /// completed인데 파일이 없다. 저장하지 않고 reconcile이 채운다
    #[serde(skip)]
    pub missing: bool,
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
        }
    }

    /// 프런트로 보낼 모양.
    pub fn to_dto(&self, progress: Option<ProgressDto>) -> JobDto {
        JobDto {
            id: self.id,
            url: self.url.clone(),
            title: self.title.clone(),
            channel_name: self.channel_name.clone(),
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

/// `jobs.json` 저장소.
#[derive(Clone, Debug)]
pub struct JobStore {
    path: PathBuf,
}

impl JobStore {
    /// `{data_dir}/jobs.json`.
    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        JobStore {
            path: data_dir.into().join(JOBS_FILE),
        }
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
        if let Some(dir) = self.path.parent().filter(|d| !d.as_os_str().is_empty()) {
            std::fs::create_dir_all(dir).map_err(|e| map_io_error("create dir", dir, e))?;
        }
        let bytes = serde_json::to_vec_pretty(file)
            .map_err(|e| Error::Settings(format!("작업 목록 직렬화 실패: {e}")))?;
        atomic_write(&self.path, &bytes)
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
/// | `running`·`pausing`·`queued` | - | `interrupted`(자동 재개는 매니저가 설정을 보고 따로 한다) |
/// | `paused`·`interrupted`·`failed` | `.part`·sidecar가 있고 같은 작업 | `partial_bytes = committed_len` |
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
        }
        j.partial_bytes = None;
        j.missing = false;
        match j.status {
            JobStatus::Paused | JobStatus::Interrupted | JobStatus::Failed => {
                j.partial_bytes = partial_bytes(j);
            }
            JobStatus::Completed => j.missing = !j.output.exists(),
            _ => {}
        }
    }
}

/// 이 작업이 이어받을 수 있는 `.part`의 바이트(sidecar `committed_len`).
///
/// `.part`와 sidecar가 모두 있고 sidecar가 같은 작업(컨텐츠·화질·방식)일 때만 `Some`이다.
/// `discard_on_start`(처음부터)가 켜져 있으면 늘 `None`이다.
/// sidecar가 없거나 깨졌거나 다른 작업이면 코어가 재개 때 새로 시작하므로 `None`이다.
/// (`check_output`은 이와 달리 sidecar가 없으면 `.part` 길이를 보여 준다. 섞지 않는다.)
/// sidecar는 잠그지 않고 읽기만 한다(`atomic_write`로 쓰이므로 반쯤 쓴 파일은 없다).
pub fn partial_bytes(j: &JobRecord) -> Option<u64> {
    // "처음부터"로 표시된 작업은 다음 시작 때 `.part`를 지우므로 이어받을 것이 없다.
    if j.discard_on_start || !part_path(&j.output).is_file() {
        return None;
    }
    let sc = read_sidecar(&j.output)?;
    sc.same_job(&j.content, &j.quality_id, j.expected_kind)
        .then_some(sc.committed_len)
}

/// `{output}.part.json`을 읽는다. 없거나 깨졌으면 `None`.
pub fn read_sidecar(output: &Path) -> Option<Sidecar> {
    let bytes = std::fs::read(sidecar_path(output)).ok()?;
    serde_json::from_slice(&bytes).ok()
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
