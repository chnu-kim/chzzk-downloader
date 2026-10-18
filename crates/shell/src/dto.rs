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
    PlaybackKind, Progress, Quality, RecentKind, RecentVod, Resolved, TextScale, Theme, TimeRange,
    naming::{FileNameTemplate, default_filename, render_filename, suggested_stem},
};
use serde::{Deserialize, Deserializer, Serialize};
use ts_rs::TS;

use crate::auth::{
    AuthPhase, AuthReason, AuthStatus, DelegatedChannel, EditorStatus, InviteResponse, MeResponse,
};
use crate::chat::{ChatStateDto, SubtitleFormatTs};
use crate::error::AppError;
use chzzk_core::chat::SubtitleFormat;

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
    /// 진행 중인 생방송
    Live,
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
    Live { channel_id: String },
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
    /// 연결이 끊겨 기다리는 중(phase이지 작업 상태가 아니다, platform §15.2)
    WaitingNetwork,
}

impl From<PlaybackKind> for PlaybackKindTs {
    /// 빠짐없는 match. 코어에 방식이 늘면 여기서 컴파일이 깨진다.
    fn from(k: PlaybackKind) -> Self {
        match k {
            PlaybackKind::Progressive => PlaybackKindTs::Progressive,
            PlaybackKind::LiveRewindHls => PlaybackKindTs::LiveRewindHls,
            PlaybackKind::Live => PlaybackKindTs::Live,
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
            ContentRef::Live { channel_id } => ContentRefTs::Live {
                channel_id: channel_id.clone(),
            },
        }
    }
}

/// `chzzk_core::TextScale`의 TS 모양(값 = `data-text-scale`, `default`는 속성 없음).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(rename = "TextScale")]
pub enum TextScaleTs {
    Default,
    Large,
    XLarge,
}

impl From<TextScale> for TextScaleTs {
    /// 빠짐없는 match. 코어에 단계가 늘면 여기서 컴파일이 깨진다.
    fn from(t: TextScale) -> Self {
        match t {
            TextScale::Default => TextScaleTs::Default,
            TextScale::Large => TextScaleTs::Large,
            TextScale::XLarge => TextScaleTs::XLarge,
        }
    }
}

/// `chzzk_core::Theme`의 TS 모양.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "Theme")]
pub enum ThemeTs {
    System,
    Light,
    Dark,
}

impl From<Theme> for ThemeTs {
    /// 빠짐없는 match.
    fn from(t: Theme) -> Self {
        match t {
            Theme::System => ThemeTs::System,
            Theme::Light => ThemeTs::Light,
            Theme::Dark => ThemeTs::Dark,
        }
    }
}

/// `chzzk_core::RecentKind`의 TS 모양(프런트 배지 `vod`·`rewind`·`clip`과 같은 이름).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "RecentKind")]
pub enum RecentKindTs {
    Vod,
    Rewind,
    Clip,
}

impl From<RecentKind> for RecentKindTs {
    /// 빠짐없는 match.
    fn from(k: RecentKind) -> Self {
        match k {
            RecentKind::Vod => RecentKindTs::Vod,
            RecentKind::Rewind => RecentKindTs::Rewind,
            RecentKind::Clip => RecentKindTs::Clip,
        }
    }
}

/// 앱이 도는 OS(system/platform.md §20). 프런트는 `navigator`를 읽지 않고 이 값으로 분기한다(design-lint DX5).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(rename = "Os")]
pub enum OsDto {
    Macos,
    Windows,
    Linux,
}

impl From<Platform> for OsDto {
    fn from(p: Platform) -> Self {
        match p {
            Platform::MacOs => OsDto::Macos,
            Platform::Windows => OsDto::Windows,
            Platform::Linux => OsDto::Linux,
        }
    }
}

/// `open_web_page`가 여는 Worker 페이지(로그인 서버 주소 아래 고정 경로, system/patterns.md §13·§14.4).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum WebPage {
    /// `/privacy` 개인정보 처리방침
    Privacy,
    /// `/licenses` 오픈소스 라이선스
    Licenses,
    /// `/help` 도움말(macOS 도움말 메뉴, platform §7.1)
    Help,
}

/// 도움말 주제 id(`help/ids.json`의 `ids`, D51 "앵커 id는 추가만"). Worker `/help`가 주제마다 `h2 id`로 달아
/// `open_web_page(help, anchor)`가 `/help#<id>`로 연다(오류 L2 링크, app.md 구현 중 변경 84).
/// 닫힌 집합이라 모르는 id는 역직렬화에서 거부된다. `ids.json`과 같은지는 `tests/dto_json.rs`가 본다.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
pub enum HelpId {
    Cookie,
    DiskFull,
    InstallMac,
    InstallWindows,
    LoginBrowser,
    Report,
    WindowsOldApp,
    Editors,
    LoginDenied,
    Cli,
}

impl HelpId {
    /// 모든 주제(`ids.json` 대조용)
    pub const ALL: [HelpId; 10] = [
        HelpId::Cookie,
        HelpId::DiskFull,
        HelpId::InstallMac,
        HelpId::InstallWindows,
        HelpId::LoginBrowser,
        HelpId::Report,
        HelpId::WindowsOldApp,
        HelpId::Editors,
        HelpId::LoginDenied,
        HelpId::Cli,
    ];

    /// 앵커 글자(= serde 값). 주소의 `#` 뒤에 그대로 붙는다
    pub fn as_str(self) -> &'static str {
        match self {
            HelpId::Cookie => "cookie",
            HelpId::DiskFull => "disk-full",
            HelpId::InstallMac => "install-mac",
            HelpId::InstallWindows => "install-windows",
            HelpId::LoginBrowser => "login-browser",
            HelpId::Report => "report",
            HelpId::WindowsOldApp => "windows-old-app",
            HelpId::Editors => "editors",
            HelpId::LoginDenied => "login-denied",
            HelpId::Cli => "cli",
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
            Phase::WaitingNetwork => PhaseTs::WaitingNetwork,
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
    Live,
}

impl From<ContentKind> for ContentKindDto {
    fn from(k: ContentKind) -> Self {
        match k {
            ContentKind::Video => ContentKindDto::Video,
            ContentKind::Clip => ContentKindDto::Clip,
            ContentKind::Live => ContentKindDto::Live,
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
    /// 앱이 도는 OS(Windows 고정 데이터·단축키 표기·[Finder에서 보기] 분기)
    pub platform: OsDto,
    /// 저장된 글자 크기. `get_settings`는 로그인 뒤에만 부를 수 있어 로그인 화면도 따르도록 여기에도 싣는다
    #[ts(as = "TextScaleTs")]
    pub text_scale: TextScale,
    /// 저장된 모양(위와 같은 이유)
    #[ts(as = "ThemeTs")]
    pub theme: Theme,
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
    /// 앱 안 글자 크기(기본 `default`)
    #[ts(as = "TextScaleTs")]
    pub text_scale: TextScale,
    /// 모양(기본 `system`). Linux에서만 설정 화면에 보인다
    #[ts(as = "ThemeTs")]
    pub theme: Theme,
    /// 받는 동안 잠들지 않게 한다(기본 켜짐, platform §10)
    pub keep_awake: bool,
    /// 받은 mp4에 제목·채널·날짜·원본 주소와 표지를 넣는다(기본 켜짐, mp4-metadata.md §9). 작업을 추가할 때 값이 고정된다
    pub embed_metadata: bool,
    /// 영상과 함께 채팅도 받기(기본 꺼짐, 마지막 선택, chat.md §4.4)
    pub save_chat: bool,
    /// 채팅 자막 형식(기본 [잠정] U2 결정 대기 `ass`)
    #[ts(as = "SubtitleFormatTs")]
    pub chat_subtitle: SubtitleFormat,
    /// 파일 이름 규칙(템플릿). `null`이면 기본 규칙이다(입력칸에는 `DEFAULT_TEMPLATE`을 보인다)
    pub file_name_template: Option<String>,
    /// 전체 합계 받기 속도 상한(바이트/초). `null` = 제한 없음(기본). 생방송 녹화는 제외(rate-limit.md)
    pub total_rate_limit: Option<u64>,
    /// 작업마다 받기 속도 상한(바이트/초). `null` = 제한 없음(기본)
    pub job_rate_limit: Option<u64>,
}

/// 최근 VOD 한 항목.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RecentVodDto {
    pub url: String,
    pub title: String,
    /// 종류(옛 항목은 없다)
    #[ts(as = "Option<RecentKindTs>")]
    pub kind: Option<RecentKind>,
    /// 방송·공개 날짜(API 문자열 그대로, 프런트 format이 읽는다). 옛 항목은 없다
    pub date: Option<String>,
}

impl From<&RecentVod> for RecentVodDto {
    fn from(r: &RecentVod) -> Self {
        RecentVodDto {
            url: r.url.clone(),
            title: r.title.clone(),
            kind: r.kind,
            date: r.date.clone(),
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
    #[serde(default)]
    #[ts(as = "Option<TextScaleTs>", optional)]
    pub text_scale: Option<TextScale>,
    /// 다른 OS에서도 받아 저장한다(화면이 Linux에서만 보낸다)
    #[serde(default)]
    #[ts(as = "Option<ThemeTs>", optional)]
    pub theme: Option<Theme>,
    #[serde(default)]
    #[ts(optional)]
    pub keep_awake: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub embed_metadata: Option<bool>,
    #[serde(default)]
    #[ts(optional)]
    pub save_chat: Option<bool>,
    #[serde(default)]
    #[ts(as = "Option<SubtitleFormatTs>", optional)]
    pub chat_subtitle: Option<SubtitleFormat>,
    /// 키 없음 = 그대로, `null` = 기본 규칙으로, 문자열 = 그 템플릿으로(읽을 수 없으면 `invalidInput`,
    /// 기본 템플릿 문자열과 같으면 `null`로 저장한다)
    #[serde(default)]
    #[ts(as = "Option<Option<String>>", optional)]
    pub file_name_template: Nullable<String>,
    /// 키 없음 = 그대로, `null` = 제한 없음, 수 = 그 값(바이트/초). 0은 끔, 최소(`MIN_RATE_LIMIT_BPS`)보다 작은 값은 최소로 올린다
    #[serde(default)]
    #[ts(as = "Option<Option<u64>>", optional)]
    pub total_rate_limit: Nullable<u64>,
    /// 작업마다 상한. 규칙은 `total_rate_limit`과 같다
    #[serde(default)]
    #[ts(as = "Option<Option<u64>>", optional)]
    pub job_rate_limit: Nullable<u64>,
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
    /// 파일 이름 규칙(기본은 `default_filename`)으로 만든 이름에서 `.mp4`를 뗀 것
    pub suggested_file_name: String,
    pub ownership: Ownership,
}

impl ResolvedDto {
    /// `Resolved`를 옮긴다. 화질의 서명 URL은 버린다.
    ///
    /// `template`이 없으면 기본 규칙(`default_filename`)을 그대로 쓴다.
    pub fn new(
        url: String,
        r: &Resolved,
        last_quality_label: Option<&str>,
        platform: Platform,
        template: Option<&FileNameTemplate>,
        ownership: Ownership,
    ) -> Self {
        let name = match template {
            Some(t) => render_filename(t, &r.meta, &r.content, platform),
            None => default_filename(&r.meta, platform),
        };
        // 코어가 `suggested_stem` → `output_path` 왕복을 거친 이름을 주므로, 받을 때 이름이 달라지지 않는다
        let suggested_file_name = suggested_stem(&name).to_string();
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

/// `preview_file_name_template` 결과. 읽을 수 없는 템플릿은 오류가 아니라 데이터다(입력 중 상태).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum FileNameTemplatePreview {
    /// 영상·클립·생방송 예시 이름(`.mp4` 포함, 저장 폴더 볼륨의 규칙)
    Ok {
        names: Vec<PreviewName>,
    },
    Invalid {
        error: TemplateErrorDto,
    },
}

/// 예시 이름 하나.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PreviewName {
    pub kind: ContentKindDto,
    pub name: String,
}

/// 템플릿을 거부한 이유(코어 `TemplateError`의 TS 모양). 문구는 화면 copy deck이 정한다.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TemplateErrorDto {
    pub kind: TemplateErrorKind,
    /// `unknownToken`·`duplicateToken`일 때 그 토큰 이름
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub token: Option<String>,
    /// `tooLong`일 때 길이 상한(바이트, 코어 `MAX_TEMPLATE_BYTES`). 화면 문구가 이 값을 쓴다
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub max: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum TemplateErrorKind {
    UnbalancedBrace,
    UnknownToken,
    DuplicateToken,
    PathSeparator,
    MissingTitle,
    TooLong,
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
    /// 영상 없이 오디오 트랙만 받는 선택지("오디오만", 일반 VOD에 서버 오디오 트랙이 있을 때만, audio-only.md)
    pub audio_only: bool,
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
            audio_only,
        } = q;
        QualityDto {
            id: id.clone(),
            label: label.clone(),
            resolution: *resolution,
            width: *width,
            height: *height,
            bandwidth: *bandwidth,
            frame_rate: frame_rate.clone(),
            audio_only: *audio_only,
        }
    }
}

/// 본인 영상 판정. 로그인을 쓰지 않는 빌드와 로그인 전은 `unchecked`.
/// `adminOverride`는 관리자가 남의 영상이나 채널을 모르는 영상을 불러온 것이다(받을 수 있다, worker.md 구현 중 변경 102).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum Ownership {
    Unchecked,
    Own,
    /// 맡은 채널의 영상·클립(받을 수 있다). 생방송은 이 값이 되지 않는다
    Delegated,
    NotOwn,
    Unknown,
    AdminOverride,
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
    /// 입력과 `file_name`이 다르다(잘림·정리·구간 접미사)
    pub truncated: bool,
    /// 완성 파일이 있다
    pub exists: bool,
    /// `exists`일 때 비어 있는 이름("이름 (2)")
    pub free_file_name: Option<String>,
    /// `.part`가 있다
    pub partial: Option<PartialInfo>,
    /// 같은 경로의 활성 작업
    pub duplicate_job_id: Option<JobId>,
    /// 실제로 덮어쓸 파일 이름 전부(채팅을 함께 받으면 자막 → 기록 → 영상 순, chat.md §4.4). 비면 겹치는 파일이 없다
    pub conflict_names: Vec<String>,
}

/// 받다 만 `.part` 정보.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PartialInfo {
    /// sidecar `committed_len`(없거나 깨졌으면 `.part` 길이)
    pub bytes: u64,
    /// 같은 컨텐츠·화질·방식의 `.part`다. 다시 받을 수 없는 생방송 녹화(`recording`)는 늘 false다
    pub same_job: bool,
    /// 다시 받을 수 없는 생방송 녹화의 `.part`다(sidecar `kind = live`). 새 요청은 이 녹화의 주인일 수 없어 `same_job`은 늘 false다.
    /// 카드는 이 이름을 쓰지 않고 `free_file_name`(번호 이름)으로 받는다(core.md 61)
    pub recording: bool,
}

/// 구간 받기의 시각 구간(ms, 반열린 `[start, end)`). 사용자가 넣은 값 그대로다.
/// `endMs = null`은 영상 길이를 모를 때의 "끝까지"이고 셸·코어에서도 `None`으로 둔다(센티널 값 없음).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TimeRangeDto {
    pub start_ms: u64,
    #[serde(default)]
    pub end_ms: Option<u64>,
}

impl From<TimeRange> for TimeRangeDto {
    fn from(r: TimeRange) -> Self {
        let TimeRange { start_ms, end_ms } = r;
        Self { start_ms, end_ms }
    }
}

impl From<TimeRangeDto> for TimeRange {
    fn from(r: TimeRangeDto) -> Self {
        let TimeRangeDto { start_ms, end_ms } = r;
        Self { start_ms, end_ms }
    }
}

/// 생방송 녹화가 끝난 이유(코어 `LiveEndReason`, core.md 65·app.md 82).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum LiveEndReason {
    Ended,
    Stopped,
    Restarted,
    Other,
}

/// 끝난 생방송 녹화의 이유와 놓친 세그먼트 수(`gaps`는 모르면 null).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct LiveEndDto {
    pub reason: LiveEndReason,
    pub gaps: Option<u32>,
}

impl From<chzzk_core::LiveEnd> for LiveEndDto {
    fn from(e: chzzk_core::LiveEnd) -> Self {
        // `..` 없이 분해한다. 코어에 필드나 이유가 늘면 여기서 컴파일이 깨진다.
        let chzzk_core::LiveEnd { reason, gaps } = e;
        let reason = match reason {
            chzzk_core::LiveEndReason::Ended => LiveEndReason::Ended,
            chzzk_core::LiveEndReason::Stopped => LiveEndReason::Stopped,
            chzzk_core::LiveEndReason::Restarted => LiveEndReason::Restarted,
            chzzk_core::LiveEndReason::Other => LiveEndReason::Other,
        };
        Self { reason, gaps }
    }
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
    /// 방송·공개 날짜(`meta.liveOpenDate ?? meta.publishDate`). 최근 영상 둘째 줄에만 쓴다. 없어도 된다
    #[serde(default)]
    #[ts(optional)]
    pub content_date: Option<String>,
    /// 구간 받기(빠른 다시보기만). 없으면 전체. 셸은 시작 < 끝과 방식만 검사한다(길이는 모른다, range.md §4.1)
    #[serde(default)]
    #[ts(optional = nullable)]
    pub range: Option<TimeRangeDto>,
    /// 영상이 끝난 뒤 채팅도 받는다(chat.md §4.4). 영상(Video) 전체 받기에만 쓸 수 있고, 클립·생방송·구간이면 `invalidInput`.
    /// 자막 형식은 받기 시점의 설정 `chatSubtitle`이고 `onExisting`은 영상과 채팅에 함께 적용한다
    #[serde(default)]
    #[ts(as = "Option<bool>", optional)]
    pub save_chat: bool,
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
    /// 오디오만 받는 작업(화질 키가 `audio`). 저장하지 않고 `qualityId`로 계산한다(audio-only.md A10)
    pub audio_only: bool,
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
    /// paused·interrupted·failed로 바뀐 시각(unix 초). 그 밖 상태와 옛 레코드는 null.
    /// "멈춘 지 30일" 판단에 쓴다(`finishedAt`은 완료·건너뜀 전용이라 따로 둔다)
    pub stopped_at: Option<u64>,
    /// 구간 받기 작업의 요청 구간(사용자 입력 원값). 전체 받기는 null
    pub range: Option<TimeRangeDto>,
    /// 끝난 생방송 녹화의 이유와 놓친 조각 수(completed 생방송만, 옛 기록·VOD는 null)
    pub live_end: Option<LiveEndDto>,
    /// 채팅 함께 받기의 하위 상태(chat.md §4.1). 채팅을 고르지 않은 작업·생방송·클립은 null
    pub chat: Option<ChatStateDto>,
}

/// 웹뷰 엔진 기능 검사(platform §5, `frontend_ready`의 인자). 하나라도 false면 프런트가 경고 배너를 띄운다.
/// 키 이름은 CSS 기능 이름을 따른다.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct EngineProbe {
    pub color_mix: bool,
    pub has: bool,
    pub oklch: bool,
    pub container_query: bool,
    pub inert: bool,
}

impl EngineProbe {
    /// 다섯 기능이 모두 있다
    pub fn all_ok(&self) -> bool {
        let EngineProbe {
            color_mix,
            has,
            oklch,
            container_query,
            inert,
        } = *self;
        color_mix && has && oklch && container_query && inert
    }
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
    /// 생방송 녹화만: 지금까지 녹화한 길이(초)
    pub live_recorded_secs: Option<f64>,
    /// 생방송 녹화만: 놓친 세그먼트 수
    pub live_gaps: Option<u32>,
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
            live,
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
            live_recorded_secs: live.map(|l| l.recorded_secs),
            live_gaps: live.map(|l| l.gaps),
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
    /// 채팅 하위 상태만 바뀌었다(chat.md §4.2). 영상 상태·진행률은 그대로다
    Chat {
        id: JobId,
        chat: ChatStateDto,
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

/// `window-focus` 이벤트: main 창이 포커스를 얻거나 잃을 때(system/platform.md §3 비활성 창, foundations §10).
/// 프런트는 macOS에서만 `html[data-window-active]`에 옮긴다.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WindowFocusPayload {
    pub focused: bool,
}

/// `keep-awake` 이벤트: 잠자기 방지를 **실제로 얻었을 때만** `active: true`(platform §10).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct KeepAwakePayload {
    pub active: bool,
}

// ---------------------------------------------------------------------------
// 인증(worker.md §11.4, 구현 중 변경 54)
// ---------------------------------------------------------------------------

/// `auth_status` 결과이자 `auth-changed` 이벤트 본문. 시각은 모두 유닉스 초(`JobDto.createdAt`과 같다).
/// 비밀(토큰·loginSecret·grant·로그인 주소)은 없다.
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
    /// 관리자(채널과 상관없이 받는다, worker.md 구현 중 변경 102). 안내·막힌 작업 표시용이고 판정은 셸이 한다
    pub is_admin: bool,
    /// 맡은 채널(표시용: 설정 행·빈 상태·notOwn 제목 분기). 판정은 셸이 한다
    pub delegated_channels: Vec<ChannelRefDto>,
    /// 맡은 채널을 마지막으로 서버에서 확인한 시각(묶음 verified_at과 마지막 /api/me 중 늦은 것)
    pub delegations_checked_at: Option<i64>,
}

/// 맡은 채널(표시용)
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ChannelRefDto {
    pub channel_id: String,
    pub channel_name: String,
}

impl From<&DelegatedChannel> for ChannelRefDto {
    fn from(d: &DelegatedChannel) -> Self {
        ChannelRefDto {
            channel_id: d.channel_id.clone(),
            channel_name: d.channel_name.clone(),
        }
    }
}

/// 편집자 상태
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum EditorStatusDto {
    Active,
    Pending,
}

/// 편집자 한 명(설정 › 계정 그룹)
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct EditorDto {
    pub channel_id: String,
    pub channel_name: String,
    pub since: i64,
    pub status: EditorStatusDto,
}

/// 맡은 채널과 맡은 시각(옛 Worker는 시각이 없다)
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DelegatedChannelDto {
    pub channel_id: String,
    pub channel_name: String,
    pub since: Option<i64>,
}

/// `editors_list` 결과(설정 › 계정 그룹)
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct EditorsDto {
    pub editors: Vec<EditorDto>,
    pub delegated_channels: Vec<DelegatedChannelDto>,
    pub pending_invite_until: Option<i64>,
    pub editors_max: u32,
    pub delegations_max: u32,
}

impl From<&MeResponse> for EditorsDto {
    fn from(m: &MeResponse) -> Self {
        EditorsDto {
            editors: m
                .editors
                .iter()
                .map(|e| EditorDto {
                    channel_id: e.channel_id.clone(),
                    channel_name: e.channel_name.clone(),
                    since: e.since.unix_timestamp(),
                    status: match e.status {
                        EditorStatus::Active => EditorStatusDto::Active,
                        EditorStatus::Pending => EditorStatusDto::Pending,
                    },
                })
                .collect(),
            delegated_channels: m
                .delegated
                .iter()
                .map(|d| DelegatedChannelDto {
                    channel_id: d.channel.channel_id.clone(),
                    channel_name: d.channel.channel_name.clone(),
                    since: d.since.map(|t| t.unix_timestamp()),
                })
                .collect(),
            pending_invite_until: m.pending_invite_until.map(|t| t.unix_timestamp()),
            editors_max: m.editors_max,
            delegations_max: m.delegations_max,
        }
    }
}

/// `editors_invite` 결과. 웹뷰가 주소를 보여 줘야 해서 직렬화는 그대로지만 `Debug`는 가린다
#[derive(Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct InviteDto {
    pub url: String,
    pub expires_at: i64,
}

impl std::fmt::Debug for InviteDto {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("InviteDto")
            .field("url", &"***")
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

impl From<&InviteResponse> for InviteDto {
    fn from(r: &InviteResponse) -> Self {
        InviteDto {
            url: r.invite_url.expose().to_string(),
            expires_at: r.expires_at.unix_timestamp(),
        }
    }
}

/// 로그인 대기(로컬 기한)
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PendingDto {
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
            is_admin: false,
            delegated_channels: vec![],
            delegations_checked_at: None,
        }
    }

    /// 셸 상태 → DTO. 구조 분해는 `..` 없이(필드가 늘면 컴파일이 깨져 경계 너머로 보낼지 정하게).
    pub fn from_status(s: &AuthStatus) -> Self {
        let AuthStatus {
            phase,
            reason,
            channel_id,
            channel_name,
            is_admin,
            pending,
            offline,
            verified_at,
            has_session,
            delegated_channels,
            // 서버 확인 여부는 셸 안의 자동 이어받기 판단용이라 웹뷰에 보내지 않는다
            delegations_verified: _,
            delegations_checked_at,
        } = s;
        AuthStatusDto {
            state: AuthState::from(*phase),
            channel_id: channel_id.clone(),
            channel_name: channel_name.clone(),
            reason: reason.map(AuthReasonDto::from),
            pending: pending.as_ref().map(|p| PendingDto {
                expires_at: p.expires_at.unix_timestamp(),
            }),
            offline: offline.as_ref().map(|o| OfflineDto {
                since: o.since.unix_timestamp(),
                grace_until: o.grace_until.unix_timestamp(),
            }),
            verified_at: verified_at.map(|t| t.unix_timestamp()),
            can_reconnect: *has_session,
            is_admin: *is_admin,
            delegated_channels: delegated_channels.iter().map(ChannelRefDto::from).collect(),
            delegations_checked_at: delegations_checked_at.map(|t| t.unix_timestamp()),
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

/// 사유(worker.md §11.4의 10개 + 거부 이유 둘). TS 이름은 `AuthReason`.
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
    Receiver,
    DailyLimit,
    Blocked,
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
            AuthReason::Receiver => AuthReasonDto::Receiver,
            AuthReason::DailyLimit => AuthReasonDto::DailyLimit,
            AuthReason::Blocked => AuthReasonDto::Blocked,
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
