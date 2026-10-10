//! 사용자 설정(`{config_dir}/settings.json`, 설계 §3.5·§7).
//!
//! - 키는 camelCase, 모든 필드에 기본값이 있다. 배열 `null`은 빈 목록으로 읽는다(Go가 쓴 파일 호환).
//! - 쓰기 소유자는 `SettingsStore` 하나다. 잠금 → 수정 → `atomic_write` 순서라 동시 갱신이 섞이지 않는다.
//! - 깨진 파일은 `settings.json.bad-{unix_ts}`로 옮기고 기본값으로 계속한다(Go의 "깨지면 이후 저장 불가" 제거).
//! - `schemaVersion`이 없는 파일은 옛(Go) 형식이다. 첫 `update`가 덮어쓰기 전에 원본을
//!   `settings.json.v1`로 복사해 둔다(원본 보존, `import_legacy`가 그것을 읽는다).

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Deserializer, Serialize};

use crate::download::DEFAULT_CONCURRENCY;
use crate::error::Error;
use crate::fsutil::{atomic_write, map_io_error, rename_with_retry};

/// 설정 파일 이름.
pub const SETTINGS_FILE: &str = "settings.json";

/// 옛(Go) 형식 원본을 덮어쓰기 전에 복사해 두는 이름.
pub const LEGACY_BACKUP_FILE: &str = "settings.json.v1";

/// 현재 설정 형식 버전. Go 시절 형식을 1로 본다.
pub const SCHEMA_VERSION: u32 = 2;

/// 최근 VOD 목록 길이 상한.
pub const MAX_RECENT_VODS: usize = 5;

/// 동시에 받는 작업 수 기본값.
pub const DEFAULT_PARALLEL_DOWNLOADS: u8 = 2;

/// 동시에 받는 작업 수 상한. 더 큰 숫자는 이 값으로 읽는다.
pub const MAX_PARALLEL_DOWNLOADS: u8 = 3;

/// 최근 VOD 제목 길이 상한(문자 수). 넘으면 47자 + `...`.
const RECENT_TITLE_MAX_CHARS: usize = 50;
const RECENT_TITLE_KEEP_CHARS: usize = 47;

/// 사용자 설정.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UserSettings {
    /// 형식 버전(`SCHEMA_VERSION`)
    pub schema_version: u32,
    /// `None`이면 셸이 준 기본 다운로드 폴더. 빈 문자열은 `None`으로 읽는다.
    #[serde(deserialize_with = "empty_path_as_none")]
    pub download_folder: Option<PathBuf>,
    /// 네이버 쿠키를 보낼지. 쿠키 전송의 유일한 스위치(spec §9.1-11)
    pub use_naver_cookies: bool,
    /// 마지막으로 고른 화질 라벨(`"720p"`). 소스 종류가 달라도 같은 문자열이다.
    #[serde(deserialize_with = "empty_str_as_none")]
    pub last_quality_label: Option<String>,
    /// 마지막으로 연 주소
    #[serde(deserialize_with = "empty_str_as_none")]
    pub last_url: Option<String>,
    /// 최근 VOD(최대 5개, 최신이 앞)
    #[serde(deserialize_with = "null_as_default")]
    pub recent_vods: Vec<RecentVod>,
    /// HLS 동시 요청 수. 1~255가 아닌 값(0, 음수, 범위 밖, 숫자 아님)은 기본값(4)으로 읽는다.
    #[serde(deserialize_with = "concurrency_or_default")]
    pub segment_concurrency: u8,
    /// 동시에 받는 작업 수(1~3, 기본 2). 앱 셸의 작업 큐가 쓴다. 3보다 큰 정수는 3으로,
    /// 1 미만·숫자 아님은 기본값으로 읽는다.
    #[serde(deserialize_with = "parallel_or_default")]
    pub max_parallel_downloads: u8,
    /// 앱을 다시 열 때 멈춘(`interrupted`) 작업을 자동으로 이어받는다(기본 꺼짐).
    pub auto_resume_interrupted: bool,
    /// 옛 버전 설정을 가져온 폴더. 있으면 다시 묻지 않는다.
    pub imported_from: Option<PathBuf>,
    /// 앱 안 글자 크기(디자인 시스템 D28, `data-text-scale`). 모르는 값은 기본으로 읽는다.
    #[serde(deserialize_with = "lenient_or_default")]
    pub text_scale: TextScale,
    /// 모양(디자인 시스템 D7, `data-theme`). 설정 화면은 Linux에서만 보이고 다른 OS에서는 쓰지 않는다.
    #[serde(deserialize_with = "lenient_or_default")]
    pub theme: Theme,
}

/// 앱 안 글자 크기(×1 / ×1.3 / ×2.0, system/foundations.md §3.2). 직렬화 값은 `data-text-scale` 값과 같다
/// (`default`는 속성 없음).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TextScale {
    #[default]
    Default,
    Large,
    XLarge,
}

/// 모양(system/foundations.md §10). `system`은 OS를 따른다.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

/// 최근 영상의 종류(배지와 같은 세 갈래, system/patterns.md §14.1 둘째 줄).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RecentKind {
    /// 일반 VOD
    Vod,
    /// 빠른 다시보기
    Rewind,
    /// 클립
    Clip,
}

impl Default for UserSettings {
    fn default() -> Self {
        UserSettings {
            schema_version: SCHEMA_VERSION,
            download_folder: None,
            use_naver_cookies: false,
            last_quality_label: None,
            last_url: None,
            recent_vods: Vec::new(),
            segment_concurrency: DEFAULT_CONCURRENCY.get(),
            max_parallel_downloads: DEFAULT_PARALLEL_DOWNLOADS,
            auto_resume_interrupted: false,
            imported_from: None,
            text_scale: TextScale::Default,
            theme: Theme::System,
        }
    }
}

/// 최근 VOD 한 항목.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RecentVod {
    pub url: String,
    pub title: String,
    /// 종류. 옛 항목(이 필드 전)·옛 Go 설정에는 없다. 모르는 값은 `None`으로 읽는다.
    #[serde(
        deserialize_with = "lenient_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub kind: Option<RecentKind>,
    /// 방송·공개 날짜(치지직 API가 준 문자열 그대로). 없거나 비면 `None`.
    #[serde(
        deserialize_with = "empty_str_as_none",
        skip_serializing_if = "Option::is_none"
    )]
    pub date: Option<String>,
}

/// 어떤 JSON 값이든 받고, `T`로 읽지 못하면 기본값(손으로 고친 값 하나로 파일 전체가 깨지지 않게).
fn lenient_or_default<'de, D, T>(d: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: serde::de::DeserializeOwned + Default,
{
    let v = Option::<serde_json::Value>::deserialize(d)?;
    Ok(v.and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default())
}

/// 어떤 JSON 값이든 받고, `T`로 읽지 못하면 `None`.
fn lenient_option<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: serde::de::DeserializeOwned,
{
    let v = Option::<serde_json::Value>::deserialize(d)?;
    Ok(v.and_then(|v| serde_json::from_value(v).ok()))
}

/// `null`이면 기본값.
pub(crate) fn null_as_default<'de, D, T>(d: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    Ok(Option::<T>::deserialize(d)?.unwrap_or_default())
}

/// `null`이나 빈(공백뿐인) 문자열이면 `None`.
pub(crate) fn empty_str_as_none<'de, D>(d: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<String>::deserialize(d)?.filter(|s| !s.trim().is_empty()))
}

fn empty_path_as_none<'de, D>(d: D) -> Result<Option<PathBuf>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(empty_str_as_none(d)?.map(PathBuf::from))
}

/// 손으로 고친 값 하나 때문에 파일 전체가 깨진 것으로 처리되지 않도록, 어떤 JSON 값이든 받는다.
fn concurrency_or_default<'de, D>(d: D) -> Result<u8, D::Error>
where
    D: Deserializer<'de>,
{
    let v = Option::<serde_json::Value>::deserialize(d)?;
    Ok(v.as_ref()
        .and_then(serde_json::Value::as_u64)
        .and_then(|n| u8::try_from(n).ok())
        .filter(|&n| n > 0)
        .unwrap_or(DEFAULT_CONCURRENCY.get()))
}

/// 동시 작업 수. 정수 1 이상은 1~3으로 자르고, 그 밖의 값(0, 음수, 소수, 문자열)은 기본값(2)으로 읽는다.
/// 손으로 고친 값 하나 때문에 파일 전체가 깨진 것으로 처리되지 않게 어떤 JSON 값이든 받는다.
fn parallel_or_default<'de, D>(d: D) -> Result<u8, D::Error>
where
    D: Deserializer<'de>,
{
    let v = Option::<serde_json::Value>::deserialize(d)?;
    Ok(v.as_ref()
        .and_then(serde_json::Value::as_u64)
        .filter(|&n| n > 0)
        .map(|n| n.min(u64::from(MAX_PARALLEL_DOWNLOADS)) as u8)
        .unwrap_or(DEFAULT_PARALLEL_DOWNLOADS))
}

/// 최근 VOD에 넣는다. 같은 URL은 지우고 맨 앞에 넣은 뒤 5개로 자른다. `last_url`도 바꾼다.
///
/// 제목이 50자(char)를 넘으면 47자 + `...`(spec §7.2, 바이트로 잘라 한글이 깨지던 버그 수정).
pub fn add_recent_vod(s: &mut UserSettings, url: &str, title: &str) {
    add_recent_vod_with(s, url, title, None, None);
}

/// `add_recent_vod`에 종류·날짜를 함께 적는다(최근 영상 둘째 줄 "{kind} · {date}").
pub fn add_recent_vod_with(
    s: &mut UserSettings,
    url: &str,
    title: &str,
    kind: Option<RecentKind>,
    date: Option<&str>,
) {
    let title = if title.chars().count() > RECENT_TITLE_MAX_CHARS {
        let mut t: String = title.chars().take(RECENT_TITLE_KEEP_CHARS).collect();
        t.push_str("...");
        t
    } else {
        title.to_string()
    };
    s.recent_vods.retain(|v| v.url != url);
    s.recent_vods.insert(
        0,
        RecentVod {
            url: url.to_string(),
            title,
            kind,
            date: date
                .map(str::trim)
                .filter(|d| !d.is_empty())
                .map(str::to_string),
        },
    );
    s.recent_vods.truncate(MAX_RECENT_VODS);
    s.last_url = Some(url.to_string());
}

/// 설정 저장소. 앱에 하나만 두고 모든 읽기·쓰기를 이것으로 한다.
#[derive(Debug)]
pub struct SettingsStore {
    dir: PathBuf,
    current: Mutex<State>,
}

#[derive(Debug)]
struct State {
    settings: UserSettings,
    /// 디스크의 `settings.json`이 아직 옛(Go) 형식이다. 첫 쓰기 전에 `.v1`로 복사한다.
    legacy_on_disk: bool,
}

impl SettingsStore {
    /// `{dir}/settings.json`을 읽는다.
    ///
    /// - 없으면 기본값(파일은 첫 `update` 때 만든다).
    /// - JSON이 깨졌거나 형식이 맞지 않으면 `settings.json.bad-{unix_ts}`로 옮기고 기본값.
    /// - 그 밖의 읽기 오류(권한 등)는 `Io`. 이때는 아무것도 옮기지 않는다.
    /// - 깨진 파일을 옮기지 못하면(재시도 뒤에도 잠김 등) `Err`다. 기본값으로 계속하면 첫 `update`가
    ///   백업 없이 덮어쓰기 때문이다.
    /// - `schemaVersion`이 없으면(옛 Go 형식) 읽을 수 있는 키만 읽고, 첫 `update` 직전에 원본을
    ///   `settings.json.v1`로 복사한다.
    pub fn open(dir: PathBuf) -> Result<Self, Error> {
        let path = dir.join(SETTINGS_FILE);
        let (settings, legacy_on_disk) = match std::fs::read(&path) {
            Ok(bytes) => match parse_with_version(&bytes) {
                Ok(v) => v,
                Err(e) => {
                    let bad = backup_corrupt(&path)?;
                    tracing::warn!(error = %e, backup = %bad.display(), "깨진 설정 파일을 옮기고 기본값으로 시작");
                    (UserSettings::default(), false)
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (UserSettings::default(), false),
            Err(e) => return Err(map_io_error("read", &path, e)),
        };
        Ok(SettingsStore {
            dir,
            current: Mutex::new(State {
                settings,
                legacy_on_disk,
            }),
        })
    }

    /// 설정 폴더.
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// 설정 파일 경로.
    pub fn path(&self) -> PathBuf {
        self.dir.join(SETTINGS_FILE)
    }

    /// 현재 설정(복사본).
    pub fn get(&self) -> UserSettings {
        self.lock().settings.clone()
    }

    /// 잠금을 쥔 채 `f`로 고치고 파일에 원자적으로 쓴다. 쓰기에 실패하면 메모리 값도 바뀌지 않는다.
    pub fn update<F: FnOnce(&mut UserSettings)>(&self, f: F) -> Result<UserSettings, Error> {
        let mut guard = self.lock();
        let mut next = guard.settings.clone();
        f(&mut next);
        next.schema_version = SCHEMA_VERSION;
        std::fs::create_dir_all(&self.dir).map_err(|e| map_io_error("create dir", &self.dir, e))?;
        let bytes = serde_json::to_vec_pretty(&next)
            .map_err(|e| Error::Settings(format!("설정 직렬화 실패: {e}")))?;
        if guard.legacy_on_disk {
            preserve_legacy(&self.dir)?;
            guard.legacy_on_disk = false;
        }
        atomic_write(&self.path(), &bytes)?;
        guard.settings = next.clone();
        Ok(next)
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        // 다른 스레드가 `f` 안에서 패닉해도 값은 쓰기 전 상태 그대로다.
        self.current.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// 설정 JSON을 읽는다. 모르는 키는 무시한다.
///
/// 최상위가 object가 아니면(serde는 배열도 struct로 읽는다) 깨진 파일로 본다.
pub(crate) fn parse(bytes: &[u8]) -> Result<UserSettings, Error> {
    parse_object(bytes).map_err(|e| Error::Settings(format!("settings.json: {e}")))
}

/// 설정을 읽고, `schemaVersion` 키가 없는(옛 형식) 파일인지도 돌려준다.
fn parse_with_version(bytes: &[u8]) -> Result<(UserSettings, bool), Error> {
    let s = parse(bytes)?;
    let v: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|e| Error::Settings(format!("settings.json: {e}")))?;
    Ok((s, v.get("schemaVersion").is_none()))
}

/// 옛 형식 `settings.json`을 `settings.json.v1`로 복사한다.
///
/// `.v1`이 이미 있으면 덮어쓰지 않는다(`import_legacy`가 읽는 처음 원본). 내용이 다르면(옛 앱을 다시
/// 써서 옛 형식 파일이 또 생긴 경우) `settings.json.v1-{unix_ts}`(겹치면 `-1`, `-2` …)로 따로 남긴다.
fn preserve_legacy(dir: &Path) -> Result<(), Error> {
    let src = dir.join(SETTINGS_FILE);
    let bytes = match std::fs::read(&src) {
        Ok(b) => b,
        // 그사이 누가 지웠으면 보존할 것이 없다.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(map_io_error("read", &src, e)),
    };
    let first = dir.join(LEGACY_BACKUP_FILE);
    let dst = match std::fs::read(&first) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => first,
        Ok(old) if old == bytes => return Ok(()),
        Ok(_) => unique_sibling(&first, "-"),
        Err(e) => return Err(map_io_error("read", &first, e)),
    };
    atomic_write(&dst, &bytes)
}

/// `{path}{sep}{unix_ts}`, 이미 있으면 `-1`, `-2` …를 붙인 없는 경로.
fn unique_sibling(path: &Path, sep: &str) -> PathBuf {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut p = with_suffix(path, &format!("{sep}{ts}"));
    let mut n = 1;
    while p.exists() {
        p = with_suffix(path, &format!("{sep}{ts}-{n}"));
        n += 1;
    }
    p
}

/// 최상위가 JSON object일 때만 `T`로 읽는다.
pub(crate) fn parse_object<T: serde::de::DeserializeOwned>(
    bytes: &[u8],
) -> Result<T, serde_json::Error> {
    use serde::de::Error as _;
    let v: serde_json::Value = serde_json::from_slice(bytes)?;
    if !v.is_object() {
        return Err(serde_json::Error::custom("최상위가 object가 아닙니다"));
    }
    serde_json::from_value(v)
}

/// 깨진 설정 파일을 `{이름}.bad-{unix_ts}`(겹치면 `-1`, `-2` …)로 옮긴다.
///
/// Windows 일시 잠금은 `rename_with_retry`로 재시도한다.
fn backup_corrupt(path: &Path) -> Result<PathBuf, Error> {
    let bad = unique_sibling(path, ".bad-");
    rename_with_retry(path, &bad)?;
    Ok(bad)
}

/// 경로 뒤에 접미사를 붙인다. UTF-8이 아닌 경로도 바이트 그대로 둔다(`display()`는 손실이 있다).
fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut s: OsString = path.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults() {
        let s = UserSettings::default();
        assert_eq!(s.schema_version, 2);
        assert_eq!(s.segment_concurrency, 4);
        assert_eq!(s.max_parallel_downloads, 2);
        assert!(!s.auto_resume_interrupted);
        assert_eq!(parse(b"{}").unwrap(), s);
    }

    #[test]
    fn camel_case_keys_round_trip() {
        let mut s = UserSettings {
            download_folder: Some("/tmp/x".into()),
            use_naver_cookies: true,
            last_quality_label: Some("720p".into()),
            segment_concurrency: 6,
            max_parallel_downloads: 3,
            auto_resume_interrupted: true,
            ..Default::default()
        };
        add_recent_vod(&mut s, "https://chzzk.naver.com/video/1", "제목");
        let v: serde_json::Value = serde_json::to_value(&s).unwrap();
        for k in [
            "schemaVersion",
            "downloadFolder",
            "useNaverCookies",
            "lastQualityLabel",
            "lastUrl",
            "recentVods",
            "segmentConcurrency",
            "maxParallelDownloads",
            "autoResumeInterrupted",
            "importedFrom",
        ] {
            assert!(v.get(k).is_some(), "{k}");
        }
        assert_eq!(parse(&serde_json::to_vec(&s).unwrap()).unwrap(), s);
    }

    #[test]
    fn empty_and_zero_values() {
        let s = parse(
            br#"{"downloadFolder":"","lastQualityLabel":" ","lastUrl":null,
                 "recentVods":null,"segmentConcurrency":0}"#,
        )
        .unwrap();
        assert_eq!(s.download_folder, None);
        assert_eq!(s.last_quality_label, None);
        assert_eq!(s.last_url, None);
        assert!(s.recent_vods.is_empty());
        assert_eq!(s.segment_concurrency, 4);
    }

    /// 범위 밖·음수·숫자 아닌 동시 요청 수는 그 필드만 기본값이 되고 나머지는 남는다.
    #[test]
    fn out_of_range_concurrency_keeps_rest() {
        for raw in ["300", "-1", "1.5", "\"8\"", "256"] {
            let s = parse(
                format!(r#"{{"downloadFolder":"/x","segmentConcurrency":{raw}}}"#).as_bytes(),
            )
            .unwrap_or_else(|e| panic!("{raw}: {e}"));
            assert_eq!(s.download_folder.as_deref(), Some(Path::new("/x")), "{raw}");
            assert_eq!(s.segment_concurrency, 4, "{raw}");
        }
        assert_eq!(
            parse(br#"{"segmentConcurrency":255}"#)
                .unwrap()
                .segment_concurrency,
            255
        );
    }

    /// 동시 작업 수: 정수는 1~3으로 자르고, 그 밖은 그 필드만 기본값(2)이다. 나머지 키는 남는다.
    #[test]
    fn parallel_downloads_is_clamped_or_default() {
        for (raw, want) in [
            ("1", 1),
            ("2", 2),
            ("3", 3),
            ("4", 3),
            ("300", 3),
            ("0", 2),
            ("-1", 2),
            ("1.5", 2),
            ("\"3\"", 2),
            ("null", 2),
        ] {
            let s = parse(
                format!(r#"{{"downloadFolder":"/x","maxParallelDownloads":{raw}}}"#).as_bytes(),
            )
            .unwrap_or_else(|e| panic!("{raw}: {e}"));
            assert_eq!(s.max_parallel_downloads, want, "{raw}");
            assert_eq!(s.download_folder.as_deref(), Some(Path::new("/x")), "{raw}");
        }
        assert!(
            parse(br#"{"autoResumeInterrupted":true}"#)
                .unwrap()
                .auto_resume_interrupted
        );
    }

    /// 접미사는 바이트 그대로 붙는다(UTF-8이 아닌 폴더 이름).
    #[cfg(unix)]
    #[test]
    fn with_suffix_keeps_non_utf8() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;
        let p = Path::new(OsStr::from_bytes(b"/tmp/\xff/settings.json"));
        let got = with_suffix(p, ".bad-1");
        assert_eq!(got.as_os_str().as_bytes(), b"/tmp/\xff/settings.json.bad-1");
    }

    #[test]
    fn wrong_type_is_error() {
        assert!(matches!(parse(b"[]"), Err(Error::Settings(_))));
        assert!(matches!(
            parse(br#"{"useNaverCookies":"yes"}"#),
            Err(Error::Settings(_))
        ));
    }
}
