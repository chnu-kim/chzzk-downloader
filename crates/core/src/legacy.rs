//! 옛(Go) 버전 설정 가져오기(설계 §3.5·§7, 결정 16).
//!
//! 읽기만 한다. 옛 파일은 지우거나 고치지 않는다. 결과를 저장하는 것은 셸(`SettingsStore::update`,
//! `CredentialStore::save`)이다.
//!
//! 옛 위치: `{dir}/settings.json`, `{dir}/dependent/cookie.json`(dir은 옛 실행 파일 폴더).
//! 셸의 설정 폴더와 옛 폴더가 같아 `SettingsStore`가 이미 새 형식으로 덮어썼으면,
//! 그때 보존한 `{dir}/settings.json.v1`을 읽는다.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Deserialize;

use crate::credentials::cookies_if_complete;
use crate::error::Error;
use crate::fsutil::map_io_error;
use crate::http::NaverCookies;
use crate::settings::{
    LEGACY_BACKUP_FILE, MAX_RECENT_VODS, RecentVod, SETTINGS_FILE, UserSettings, empty_str_as_none,
    null_as_default, parse_object,
};

/// 옛 쿠키 파일(`{dir}/dependent/cookie.json`).
const LEGACY_COOKIE_FILE: &[&str] = &["dependent", "cookie.json"];

/// `recentVods`가 비었을 때 `recentVodURLs`를 채우는 제목(spec §7.2).
const UNTITLED: &str = "제목 없음";

/// 평문 쿠키가 옛 파일에 남아 있을 때의 경고.
pub const WARN_PLAINTEXT_COOKIES: &str = "옛 파일에 평문 쿠키가 남아 있습니다";

/// 가져온 결과.
#[derive(Clone, Debug)]
pub struct LegacyImport {
    /// 새 형식 설정. `imported_from`이 채워져 있다.
    pub settings: UserSettings,
    /// 옛 파일의 네이버 쿠키(둘 다 있을 때만)
    pub cookies: Option<NaverCookies>,
    /// 사용자에게 보여 줄 안내
    pub warnings: Vec<String>,
}

/// Go `UserSettings`(옛 Go 코드). 모든 필드가 없거나 `null`이어도 된다.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct GoSettings {
    #[serde(deserialize_with = "empty_str_as_none")]
    download_folder: Option<String>,
    #[serde(deserialize_with = "null_as_default")]
    is_adult_content: bool,
    #[serde(deserialize_with = "null_as_default")]
    nid_aut: String,
    #[serde(deserialize_with = "null_as_default")]
    nid_ses: String,
    #[serde(deserialize_with = "empty_str_as_none")]
    last_quality_name: Option<String>,
    #[serde(rename = "lastVodURL", deserialize_with = "empty_str_as_none")]
    last_vod_url: Option<String>,
    #[serde(rename = "recentVodURLs", deserialize_with = "null_as_default")]
    recent_vod_urls: Vec<Option<String>>,
    #[serde(deserialize_with = "null_as_default")]
    recent_vods: Vec<Option<GoRecentVod>>,
    /// 새 형식 파일인지 가리는 데만 쓴다.
    schema_version: Option<u32>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct GoRecentVod {
    #[serde(deserialize_with = "null_as_default")]
    url: String,
    #[serde(deserialize_with = "null_as_default")]
    title: String,
}

/// `dir`의 옛 설정을 읽어 새 형식으로 바꾼다.
///
/// - `settings.json`과 `dependent/cookie.json`이 둘 다 없으면 `None`.
/// - `settings.json`이 이미 새 형식(`schemaVersion` 있음)이면 `settings.json.v1`(덮어쓰기 전에
///   보존한 원본)을 대신 읽는다. 그것도 없으면 `None`(옛 파일이 아니다).
/// - 상대 경로 `downloadFolder`는 `dir` 기준으로 풀어 절대 경로로 저장한다(Go는 exe 폴더에서 실행됐다).
/// - `settings.json`이 깨졌으면 `Settings` 오류. 파일은 그대로 둔다.
/// - `cookie.json`을 읽을 수 없으면 경고만 남긴다(Go도 조용히 빈 맵으로 처리했다).
pub fn import_legacy(dir: &Path) -> Result<Option<LegacyImport>, Error> {
    let settings_path = dir.join(SETTINGS_FILE);
    let cookie_path = LEGACY_COOKIE_FILE
        .iter()
        .fold(dir.to_path_buf(), |p, s| p.join(s));
    let settings_bytes = read_optional(&settings_path)?;
    let mut warnings = Vec::new();
    let cookie_map = match read_optional(&cookie_path) {
        Ok(Some(b)) => match serde_json::from_slice::<BTreeMap<String, Option<String>>>(&b) {
            Ok(m) => Some(m),
            Err(_) => {
                warnings.push("옛 cookie.json을 읽지 못해 건너뛰었습니다".to_string());
                None
            }
        },
        Ok(None) => None,
        Err(_) => {
            warnings.push("옛 cookie.json을 열지 못해 건너뛰었습니다".to_string());
            None
        }
    };
    if settings_bytes.is_none() && cookie_map.is_none() && warnings.is_empty() {
        return Ok(None);
    }

    let go: GoSettings = match &settings_bytes {
        Some(b) => parse_legacy(b)?,
        None => GoSettings::default(),
    };
    let go = if go.schema_version.is_some() {
        match read_optional(&dir.join(LEGACY_BACKUP_FILE))? {
            Some(b) => parse_legacy(&b)?,
            None => return Ok(None),
        }
    } else {
        go
    };
    if go.schema_version.is_some() {
        return Ok(None);
    }

    // 쿠키는 한 파일에서 한 쌍으로만 가져온다(두 파일 값을 섞지 않는다).
    let from_cookie_json = cookie_map.as_ref().and_then(|m| {
        let get = |k: &str| m.get(k).cloned().flatten().unwrap_or_default();
        cookies_if_complete(&get("NID_AUT"), &get("NID_SES"))
    });
    let cookies = from_cookie_json.or_else(|| cookies_if_complete(&go.nid_aut, &go.nid_ses));

    let has_plaintext = !go.nid_aut.trim().is_empty()
        || !go.nid_ses.trim().is_empty()
        || cookie_map.as_ref().is_some_and(|m| {
            m.values()
                .any(|v| v.as_deref().is_some_and(|v| !v.trim().is_empty()))
        });
    if has_plaintext {
        warnings.push(WARN_PLAINTEXT_COOKIES.to_string());
    }

    let download_folder = match go.download_folder.map(|p| dir.join(p)) {
        Some(p) if p.is_dir() => Some(p),
        Some(_) => {
            warnings.push("옛 다운로드 폴더가 없어 기본 폴더를 씁니다".to_string());
            None
        }
        None => None,
    };

    let mut recent_vods: Vec<RecentVod> = go
        .recent_vods
        .into_iter()
        .flatten()
        .filter(|v| !v.url.trim().is_empty())
        .map(|v| RecentVod {
            url: v.url,
            title: v.title,
        })
        .collect();
    if recent_vods.is_empty() {
        recent_vods = go
            .recent_vod_urls
            .into_iter()
            .flatten()
            .filter(|u| !u.trim().is_empty())
            .map(|url| RecentVod {
                url,
                title: UNTITLED.to_string(),
            })
            .collect();
    }
    recent_vods.truncate(MAX_RECENT_VODS);

    let settings = UserSettings {
        download_folder,
        use_naver_cookies: go.is_adult_content && cookies.is_some(),
        last_quality_label: go.last_quality_name.as_deref().and_then(quality_label),
        last_url: go.last_vod_url,
        recent_vods,
        imported_from: Some(dir.to_path_buf()),
        ..UserSettings::default()
    };
    Ok(Some(LegacyImport {
        settings,
        cookies,
        warnings,
    }))
}

/// 옛 settings.json을 읽는다.
fn parse_legacy(b: &[u8]) -> Result<GoSettings, Error> {
    parse_object(b).map_err(|_| {
        // serde 메시지에는 값 조각이 들어갈 수 있다(평문 쿠키). 원문 오류는 버린다.
        Error::Settings("옛 settings.json 형식이 올바르지 않습니다".to_string())
    })
}

/// 옛 `lastQualityName`을 새 라벨로 바꾼다.
///
/// - `"720p"`(숫자 + `p`)는 그대로
/// - `"720P_1280_…"`처럼 `숫자P_`로 시작하면 `"720p"`
/// - 그 밖(`PD_720P_…`, UUID 등)은 버린다
pub(crate) fn quality_label(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let digits = raw.bytes().take_while(u8::is_ascii_digit).count();
    if digits == 0 {
        return None;
    }
    let (n, rest) = raw.split_at(digits);
    (rest == "p" || rest.starts_with("P_")).then(|| format!("{n}p"))
}

/// 파일이 없으면 `None`.
fn read_optional(path: &Path) -> Result<Option<Vec<u8>>, Error> {
    match std::fs::read(path) {
        Ok(b) => Ok(Some(b)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(map_io_error("read", path, e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quality_label_map() {
        assert_eq!(quality_label("720p").as_deref(), Some("720p"));
        assert_eq!(quality_label("1080p").as_deref(), Some("1080p"));
        assert_eq!(quality_label("720P_1280_2500_192").as_deref(), Some("720p"));
        assert_eq!(quality_label("144P_256_100_64").as_deref(), Some("144p"));
        assert_eq!(quality_label("PD_720P_ABC"), None);
        assert_eq!(quality_label("720P"), None);
        assert_eq!(quality_label("720px"), None);
        assert_eq!(quality_label("p"), None);
        assert_eq!(quality_label(""), None);
        assert_eq!(quality_label("6f0c2b9a-uuid"), None);
    }
}
