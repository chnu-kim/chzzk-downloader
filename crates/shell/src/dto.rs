//! 프런트로 가는 타입(docs/design/app.md §5). 모두 `ts-rs`로 `app/src/lib/bindings`에 TS 정의를 만든다.
//!
//! - 키는 camelCase. tag 붙은 enum은 `rename_all_fields`도 붙인다(core.md 구현 중 변경 7의 함정).
//! - 숫자만 보낸다. 문자열 포맷("약 5.1 GB")은 프런트(`format/*`)가 한다.
//! - 서명 URL·쿠키 값은 어떤 DTO에도 없다.
//! - 코어 타입(`ContentRef`·`PlaybackKind`·`Phase`)은 코어 직렬화를 그대로 쓰고, ts-rs를 코어에 넣지 않으려고
//!   같은 serde 속성을 가진 셸 미러(`*Ts`)를 `#[ts(as = "...")]`로 붙인다. 미러는 TS 모양을 적는 데만 쓰며,
//!   미러마다 `_` arm 없는 `From<코어>`가 있어 코어에 변형이 늘면 셸 컴파일이 깨진다. `tests/dto_json.rs`는
//!   이 변환을 거쳐 코어 직렬화와 미러 직렬화가 같은지 검사한다.
//! - 코어 구조체를 옮기는 `From`(`Progress`·`ContentMeta`·`Quality`)은 `..` 없이 구조 분해한다. 코어에 필드가
//!   늘면 컴파일이 깨져, 그 필드를 경계 너머로 보낼지 정하게 한다.

use chzzk_core::{
    ContentKind, ContentMeta, ContentRef, DuplicatePolicy, LegacyImport, Phase, Platform,
    PlaybackKind, Progress, Quality, RecentVod, Resolved, naming::default_filename,
};
use serde::{Deserialize, Deserializer, Serialize};
use ts_rs::TS;

use crate::auth::{AuthPhase, AuthReason, AuthStatus};
use crate::error::AppError;

// ---------------------------------------------------------------------------
// 코어 타입의 TS 모양
// ---------------------------------------------------------------------------

/// 작업 id. `jobs.json`의 `nextId`로 단조 증가한다. JSON·TS에서는 숫자다(2^53 미만 전제).
/// serde newtype이라 JSON에서는 감싸지 않은 숫자다.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
pub struct JobId(pub u64);

/// `chzzk_core::PlaybackKind`의 TS 모양.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "PlaybackKind")]
pub enum PlaybackKindTs {
    Progressive,
    LiveRewindHls,
}

/// `chzzk_core::ContentRef`의 TS 모양.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(rename = "ContentRef")]
pub enum ContentRefTs {
    Video { video_no: u64 },
    Clip { clip_id: String },
}

/// `chzzk_core::Phase`의 TS 모양.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "Phase")]
pub enum PhaseTs {
    Resolving,
    Downloading,
    Reresolving,
    Finalizing,
}

impl From<PlaybackKind> for PlaybackKindTs {
    /// 빠짐없는 match. 코어에 방식이 늘면 여기서 컴파일이 깨진다.
    fn from(k: PlaybackKind) -> Self {
        match k {
            PlaybackKind::Progressive => PlaybackKindTs::Progressive,
            PlaybackKind::LiveRewindHls => PlaybackKindTs::LiveRewindHls,
        }
    }
}

impl From<&ContentRef> for ContentRefTs {
    /// 빠짐없는 match. 코어에 컨텐츠 종류가 늘면 여기서 컴파일이 깨진다.
    fn from(c: &ContentRef) -> Self {
        match c {
            ContentRef::Video { video_no } => ContentRefTs::Video {
                video_no: *video_no,
            },
            ContentRef::Clip { clip_id } => ContentRefTs::Clip {
                clip_id: clip_id.clone(),
            },
        }
    }
}

impl From<Phase> for PhaseTs {
    /// 빠짐없는 match. 코어에 단계가 늘면 여기서 컴파일이 깨진다.
    fn from(p: Phase) -> Self {
        match p {
            Phase::Resolving => PhaseTs::Resolving,
            Phase::Downloading => PhaseTs::Downloading,
            Phase::Reresolving => PhaseTs::Reresolving,
            Phase::Finalizing => PhaseTs::Finalizing,
        }
    }
}

/// 컨텐츠 종류. 코어 `ContentKind`는 `"Video"`로 직렬화되므로 §5대로 `"video"`가 되게 셸이 옮긴다.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "ContentKind")]
pub enum ContentKindDto {
    Video,
    Clip,
}

impl From<ContentKind> for ContentKindDto {
    fn from(k: ContentKind) -> Self {
        match k {
            ContentKind::Video => ContentKindDto::Video,
            ContentKind::Clip => ContentKindDto::Clip,
        }
    }
}

// ---------------------------------------------------------------------------
// 앱 정보·설정
// ---------------------------------------------------------------------------

/// `app_info` 결과.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub core_version: String,
    pub config_dir: String,
    pub data_dir: String,
    pub log_dir: String,
    pub default_download_folder: String,
    pub features: Features,
    /// 첫 실행에 옛 설정을 찾았을 때 한 번(D3)
    pub legacy_candidate: Option<LegacyCandidate>,
}

/// 기능 플래그. 프런트는 이 값으로만 분기한다.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Features {
    /// 로그인(Worker 주소가 있는 빌드). 릴리스는 늘 true(build.rs가 주소 없이는 막는다)
    pub auth: bool,
}

/// 첫 실행에 찾은 옛 설정 폴더(적용 전).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct LegacyCandidate {
    pub dir: String,
    pub recent_count: u32,
    pub has_cookies: bool,
}

/// `import_legacy` 적용 결과. 쿠키 값은 없다.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct LegacyImportDto {
    pub recent_count: u32,
    pub has_cookies: bool,
    pub warnings: Vec<String>,
}

impl From<&LegacyImport> for LegacyImportDto {
    fn from(l: &LegacyImport) -> Self {
        LegacyImportDto {
            recent_count: count_u32(l.settings.recent_vods.len()),
            has_cookies: l.cookies.is_some(),
            warnings: l.warnings.clone(),
        }
    }
}

fn count_u32(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// `UserSettings` 미러. 쿠키 값은 없다(`naverCookiesSaved`만).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDto {
    pub download_folder: Option<String>,
    /// `download_folder`가 없으면 기본 폴더
    pub effective_download_folder: String,
    pub use_naver_cookies: bool,
    pub naver_cookies_saved: bool,
    pub last_quality_label: Option<String>,
    pub last_url: Option<String>,
    pub recent_vods: Vec<RecentVodDto>,
    pub segment_concurrency: u8,
    /// 동시 다운로드 수(1~3, 기본 2). §16
    pub max_parallel_downloads: u8,
    /// 재시작 후 멈춘 작업을 자동으로 이어받는다(기본 꺼짐). §16
    pub auto_resume_interrupted: bool,
    pub imported_from: Option<String>,
}

/// 최근 VOD 한 항목.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RecentVodDto {
    pub url: String,
    pub title: String,
}

impl From<&RecentVod> for RecentVodDto {
    fn from(r: &RecentVod) -> Self {
        RecentVodDto {
            url: r.url.clone(),
            title: r.title.clone(),
        }
    }
}

/// `update_settings` 인자. 없는 키는 바꾸지 않는다.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    /// 키 없음 = 그대로, `null` = 기본 폴더로, 문자열 = 그 폴더로
    #[serde(default)]
    #[ts(as = "Option<Option<String>>", optional)]
    pub download_folder: Nullable<String>,
    #[serde(default)]
    #[ts(optional)]
    pub use_naver_cookies: Option<bool>,
    /// 1~8로 자른다
    #[serde(default)]
    #[ts(optional)]
    pub segment_concurrency: Option<u8>,
    /// 1~3으로 자른다
    #[serde(default)]
    #[ts(optional)]
    pub max_parallel_downloads: Option<u8>,
    #[serde(default)]
    #[ts(optional)]
    pub auto_resume_interrupted: Option<bool>,
}

/// 키 없음·`null`·값을 구분하는 패치 필드. `#[serde(default)]`와 함께 써야 키 없음이 `Keep`이 된다.
///
/// `Option<Option<T>>`는 serde가 `null`을 바깥 `None`으로 읽어 "키 없음"과 구분하지 못하고,
/// `deserialize_with`는 ts-rs가 읽지 못해 경고를 내므로 전용 타입을 둔다.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum Nullable<T> {
    /// 키 없음: 바꾸지 않는다
    #[default]
    Keep,
    /// `null`: 기본값으로 되돌린다
    Clear,
    Set(T),
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Nullable<T> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(match Option::<T>::deserialize(d)? {
            None => Nullable::Clear,
            Some(v) => Nullable::Set(v),
        })
    }
}

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

/// `resolve` 결과. 서명 URL은 없다.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedDto {
    /// 정규화된 입력 주소
    pub url: String,
    #[ts(as = "ContentRefTs")]
    pub content: ContentRef,
    pub meta: ContentMetaDto,
    #[ts(as = "PlaybackKindTs")]
    pub playback_kind: PlaybackKind,
    /// 원래 순서
    pub qualities: Vec<QualityDto>,
    /// `Resolved::default_quality(last_quality_label)`
    pub default_quality_index: u32,
    /// `default_filename`에서 `.mp4`를 뗀 것
    pub suggested_file_name: String,
    pub ownership: Ownership,
}

impl ResolvedDto {
    /// `Resolved`를 옮긴다. 화질의 서명 URL은 버린다.
    pub fn new(
        url: String,
        r: &Resolved,
        last_quality_label: Option<&str>,
        platform: Platform,
        ownership: Ownership,
    ) -> Self {
        let name = default_filename(&r.meta, platform);
        let suggested_file_name = match name.strip_suffix(".mp4") {
            Some(base) => base.to_string(),
            None => name,
        };
        ResolvedDto {
            url,
            content: r.content.clone(),
            meta: ContentMetaDto::from(&r.meta),
            playback_kind: r.kind(),
            qualities: r.qualities().into_iter().map(QualityDto::from).collect(),
            default_quality_index: count_u32(r.default_quality(last_quality_label)),
            suggested_file_name,
            ownership,
        }
    }
}

/// `ContentMeta` 미러.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ContentMetaDto {
    pub kind: ContentKindDto,
    pub title: String,
    pub channel_name: String,
    pub channel_id: Option<String>,
    /// `"YYYY-MM-DD HH:MM:SS"`(KST)
    pub live_open_date: Option<String>,
    pub publish_date: Option<String>,
    pub adult: bool,
    pub duration_secs: Option<f64>,
}

impl From<&ContentMeta> for ContentMetaDto {
    fn from(m: &ContentMeta) -> Self {
        // `..` 없이 분해한다. 코어에 필드가 늘면 여기서 컴파일이 깨진다.
        let ContentMeta {
            kind,
            title,
            channel_name,
            channel_id,
            live_open_date,
            publish_date,
            adult,
            duration_secs,
        } = m;
        ContentMetaDto {
            kind: (*kind).into(),
            title: title.clone(),
            channel_name: channel_name.clone(),
            channel_id: channel_id.clone(),
            live_open_date: live_open_date.clone(),
            publish_date: publish_date.clone(),
            adult: *adult,
            duration_secs: *duration_secs,
        }
    }
}

/// `Quality` 미러.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct QualityDto {
    /// 선택 키(정확 일치)
    pub id: String,
    /// 표시·"마지막 화질" 기억용
    pub label: String,
    pub resolution: Option<u32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub bandwidth: Option<u64>,
    pub frame_rate: Option<String>,
}

impl From<&Quality> for QualityDto {
    fn from(q: &Quality) -> Self {
        // `..` 없이 분해한다. 코어에 필드가 늘면 여기서 컴파일이 깨진다.
        let Quality {
            id,
            label,
            resolution,
            width,
            height,
            bandwidth,
            frame_rate,
        } = q;
        QualityDto {
            id: id.clone(),
            label: label.clone(),
            resolution: *resolution,
            width: *width,
            height: *height,
            bandwidth: *bandwidth,
            frame_rate: frame_rate.clone(),
        }
    }
}

/// 본인 영상 판정. 로그인을 쓰지 않는 빌드와 로그인 전은 `unchecked`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum Ownership {
    Unchecked,
    Own,
    NotOwn,
    Unknown,
}

// ---------------------------------------------------------------------------
// 출력 경로·작업 추가
// ---------------------------------------------------------------------------

/// `check_output` 결과(§6.4).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct OutputCheck {
    /// sanitize + 200바이트 절단 후(확장자 제외)
    pub file_name: String,
    /// 최종 경로
    pub path: String,
    /// 입력과 `file_name`이 다르다
    pub truncated: bool,
    /// 완성 파일이 있다
    pub exists: bool,
    /// `exists`일 때 비어 있는 이름("이름 (2)")
    pub free_file_name: Option<String>,
    /// `.part`가 있다
    pub partial: Option<PartialInfo>,
    /// 같은 경로의 활성 작업
    pub duplicate_job_id: Option<JobId>,
}

/// 받다 만 `.part` 정보.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PartialInfo {
    /// sidecar `committed_len`(없거나 깨졌으면 `.part` 길이)
    pub bytes: u64,
    /// 같은 컨텐츠·화질·방식의 `.part`다
    pub same_job: bool,
}

/// `enqueue` 인자.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueRequest {
    pub url: String,
    #[ts(as = "ContentRefTs")]
    pub content: ContentRef,
    pub title: String,
    pub channel_name: String,
    /// 웹뷰가 아는 컨텐츠 채널 ID. 로그인을 쓰는 빌드에서 셸은 이 값을 믿지 않고 검증한 값으로 덮어쓴다(worker.md 구현 중 변경 82)
    pub channel_id: Option<String>,
    pub quality_id: String,
    pub quality_label: String,
    #[ts(as = "PlaybackKindTs")]
    pub expected_kind: PlaybackKind,
    pub folder: Option<String>,
    pub file_name: String,
    /// UI는 `overwrite`만 보낸다
    pub on_existing: OnExisting,
    /// true면 첫 시작 전에 `discard_partial(output)`
    pub restart: bool,
}

/// 완성 파일이 이미 있을 때.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum OnExisting {
    Overwrite,
    Skip,
}

impl From<OnExisting> for DuplicatePolicy {
    fn from(o: OnExisting) -> Self {
        match o {
            OnExisting::Overwrite => DuplicatePolicy::Overwrite,
            OnExisting::Skip => DuplicatePolicy::Skip,
        }
    }
}

// ---------------------------------------------------------------------------
// 작업·진행률·이벤트
// ---------------------------------------------------------------------------

/// 작업 상태(§6.3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum JobStatus {
    Queued,
    Running,
    Pausing,
    Paused,
    Interrupted,
    Completed,
    Skipped,
    Failed,
}

impl JobStatus {
    /// 같은 경로 중복 검사에 들어가는 상태(queued·running·pausing·paused·interrupted).
    pub fn is_active(self) -> bool {
        matches!(
            self,
            JobStatus::Queued
                | JobStatus::Running
                | JobStatus::Pausing
                | JobStatus::Paused
                | JobStatus::Interrupted
        )
    }
}

/// 작업 하나.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct JobDto {
    pub id: JobId,
    pub url: String,
    pub title: String,
    pub channel_name: String,
    /// 작업의 컨텐츠 채널 ID(없으면 null). 로그인을 쓰는 빌드는 셸이 검증한 값, 쓰지 않는 빌드는 요청 값이다. 막힌 작업 안내에 쓴다
    pub channel_id: Option<String>,
    pub kind: ContentKindDto,
    #[ts(as = "PlaybackKindTs")]
    pub playback_kind: PlaybackKind,
    pub quality_label: String,
    pub output: String,
    pub status: JobStatus,
    /// 마지막 진행률(running·pausing·paused에서 표시)
    pub progress: Option<ProgressDto>,
    /// failed
    pub error: Option<AppError>,
    /// 작업이 멈춘 뒤 `.part`를 실제로 확인한 값(sidecar `committed_len`)
    pub partial_bytes: Option<u64>,
    /// completed
    pub final_bytes: Option<u64>,
    /// completed인데 파일이 없다(reconcile)
    pub missing: bool,
    /// unix 초
    pub created_at: u64,
    pub finished_at: Option<u64>,
}

/// 코어 `Progress`를 평평하게 편 것(튜플은 JSON 배열이 되므로).
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ProgressDto {
    #[ts(as = "PhaseTs")]
    pub phase: Phase,
    pub bytes: u64,
    pub total_bytes: Option<u64>,
    pub total_bytes_estimate: Option<u64>,
    pub segments_done: Option<u32>,
    pub segments_total: Option<u32>,
    pub media_secs_done: Option<f64>,
    pub media_secs_total: Option<f64>,
    pub speed_bps: Option<u64>,
    pub eta_secs: Option<u64>,
    pub resumed_from: u64,
    pub refreshes: u32,
}

impl From<&Progress> for ProgressDto {
    fn from(p: &Progress) -> Self {
        // `..` 없이 분해한다. 코어에 필드가 늘면 여기서 컴파일이 깨진다.
        let Progress {
            phase,
            bytes,
            total_bytes,
            total_bytes_estimate,
            segments,
            media_secs,
            speed_bps,
            eta_secs,
            resumed_from,
            refreshes,
        } = p;
        ProgressDto {
            phase: *phase,
            bytes: *bytes,
            total_bytes: *total_bytes,
            total_bytes_estimate: *total_bytes_estimate,
            segments_done: segments.map(|s| s.0),
            segments_total: segments.map(|s| s.1),
            media_secs_done: media_secs.map(|m| m.0),
            media_secs_total: media_secs.map(|m| m.1),
            speed_bps: *speed_bps,
            eta_secs: *eta_secs,
            resumed_from: *resumed_from,
            refreshes: *refreshes,
        }
    }
}

/// `subscribe_jobs` Channel로 가는 이벤트. 모두 작업 id를 품는다.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum JobEvent {
    Added {
        job: JobDto,
    },
    /// 상태가 바뀔 때 전체 레코드
    Status {
        job: JobDto,
    },
    Progress {
        id: JobId,
        progress: ProgressDto,
    },
    Removed {
        id: JobId,
    },
}

// ---------------------------------------------------------------------------
// 창 이벤트(emit)
// ---------------------------------------------------------------------------

/// `open_app_folder`가 여는 폴더(S2 저장·정보 섹션). 프런트에 opener 권한이 없어 Rust가 연다.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum AppFolder {
    /// 설정 폴더(`settings.json`·`credentials.json`)
    Config,
    /// 로그 폴더
    Logs,
    /// 지금 저장 폴더(설정 폴더, 없으면 기본 폴더)
    Downloads,
}

/// `close-requested` 이벤트(§4). Rust가 창 닫기·앱 종료를 막았을 때 받는 중인 작업 수와 함께 보낸다(D1).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CloseRequestedPayload {
    pub running: u32,
}

// ---------------------------------------------------------------------------
// 인증(worker.md §11.4, 구현 중 변경 54)
// ---------------------------------------------------------------------------

/// `auth_status` 결과이자 `auth-changed` 이벤트 본문. 시각은 모두 유닉스 초(`JobDto.createdAt`과 같다).
/// 비밀(토큰·pollSecret·로그인 주소)은 없다.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatusDto {
    pub state: AuthState,
    pub channel_id: Option<String>,
    pub channel_name: Option<String>,
    pub reason: Option<AuthReasonDto>,
    pub pending: Option<PendingDto>,
    pub offline: Option<OfflineDto>,
    pub verified_at: Option<i64>,
    /// 저장 세션이 있어 [다시 연결]로 확인할 수 있다(A4, worker.md 구현 중 변경 66 (바)를 닫는다)
    pub can_reconnect: bool,
}

/// 로그인 대기(확인 코드와 로컬 기한)
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PendingDto {
    pub user_code: String,
    pub expires_at: i64,
}

/// 오프라인 유예(SignedIn일 때만)
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct OfflineDto {
    pub since: i64,
    pub grace_until: i64,
}

impl AuthStatusDto {
    /// 로그인을 쓰지 않는 빌드(Worker 주소 없음).
    pub fn disabled() -> Self {
        AuthStatusDto {
            state: AuthState::Disabled,
            channel_id: None,
            channel_name: None,
            reason: None,
            pending: None,
            offline: None,
            verified_at: None,
            can_reconnect: false,
        }
    }

    /// 셸 상태 → DTO. 구조 분해는 `..` 없이(필드가 늘면 컴파일이 깨져 경계 너머로 보낼지 정하게).
    pub fn from_status(s: &AuthStatus) -> Self {
        let AuthStatus {
            phase,
            reason,
            channel_id,
            channel_name,
            is_admin: _,
            pending,
            offline,
            verified_at,
            has_session,
        } = s;
        AuthStatusDto {
            state: AuthState::from(*phase),
            channel_id: channel_id.clone(),
            channel_name: channel_name.clone(),
            reason: reason.map(AuthReasonDto::from),
            pending: pending.as_ref().map(|p| PendingDto {
                user_code: p.user_code.clone(),
                expires_at: p.expires_at.unix_timestamp(),
            }),
            offline: offline.as_ref().map(|o| OfflineDto {
                since: o.since.unix_timestamp(),
                grace_until: o.grace_until.unix_timestamp(),
            }),
            verified_at: verified_at.map(|t| t.unix_timestamp()),
            can_reconnect: *has_session,
        }
    }
}

/// 로그인 상태. `Checking`은 A2에서 더했다(저장 세션을 서버로 확인하는 중).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum AuthState {
    Disabled,
    Checking,
    SignedOut,
    Pending,
    SignedIn,
    Denied,
    Expired,
    Cancelled,
    Error,
}

impl From<AuthPhase> for AuthState {
    fn from(p: AuthPhase) -> Self {
        match p {
            AuthPhase::Checking => AuthState::Checking,
            AuthPhase::SignedOut => AuthState::SignedOut,
            AuthPhase::Pending => AuthState::Pending,
            AuthPhase::SignedIn => AuthState::SignedIn,
            AuthPhase::Denied => AuthState::Denied,
            AuthPhase::Expired => AuthState::Expired,
            AuthPhase::Cancelled => AuthState::Cancelled,
            AuthPhase::Error => AuthState::Error,
        }
    }
}

/// 사유(worker.md §11.4의 9개). TS 이름은 `AuthReason`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "AuthReason")]
pub enum AuthReasonDto {
    LoginTimeout,
    SessionExpired,
    Revoked,
    RemovedFromAllowlist,
    ReuseDetected,
    GraceExpired,
    Network,
    Server,
    LoginLost,
}

impl From<AuthReason> for AuthReasonDto {
    fn from(r: AuthReason) -> Self {
        match r {
            AuthReason::LoginTimeout => AuthReasonDto::LoginTimeout,
            AuthReason::SessionExpired => AuthReasonDto::SessionExpired,
            AuthReason::Revoked => AuthReasonDto::Revoked,
            AuthReason::RemovedFromAllowlist => AuthReasonDto::RemovedFromAllowlist,
            AuthReason::ReuseDetected => AuthReasonDto::ReuseDetected,
            AuthReason::GraceExpired => AuthReasonDto::GraceExpired,
            AuthReason::Network => AuthReasonDto::Network,
            AuthReason::Server => AuthReasonDto::Server,
            AuthReason::LoginLost => AuthReasonDto::LoginLost,
        }
    }
}

// ---------------------------------------------------------------------------
// 업데이트(worker.md §11.6, Phase 3b A4)
// ---------------------------------------------------------------------------

/// 업데이트 정보(`update-available` 본문, `update_check`·`update_available` 결과). 시각은 유닉스 초.
/// 다운로드 주소는 담지 않는다.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfoDto {
    pub version: String,
    pub current: String,
    pub notes: Option<String>,
    pub pub_date: Option<i64>,
}

/// `update_check` 결과. `offline`은 "세션 판정이 유효하지 않음(오프라인 유예·로그인 아님·refresh 실패)"이다.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(
    tag = "result",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UpdateCheckDto {
    Available { info: UpdateInfoDto },
    UpToDate,
    Offline,
    Failed,
    Untrusted,
}

/// `update_install` 결과
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(
    tag = "result",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UpdateInstallDto {
    /// 받는 중 작업이 있다. `confirmPause=true`로 다시 불러야 한다
    NeedsConfirm {
        running: u32,
    },
    UpToDate,
    Offline,
    Failed,
    Untrusted,
    /// 이미 설치 중이거나 종료 중이다
    Busy,
    /// 설치를 마쳤고 앱이 곧 다시 시작한다
    Restarting,
}

/// `update-progress` 이벤트 본문. `Chunk`는 누적 `received`이고 정수 퍼센트가 오를 때만 보낸다.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UpdateProgressEvent {
    Started { total: Option<u64> },
    Chunk { received: u64, total: Option<u64> },
    Downloaded,
    Installing,
}
