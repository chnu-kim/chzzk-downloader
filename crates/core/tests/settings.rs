//! 설정·자격증명·레거시 가져오기 테스트(설계 §7, §8.1 settings/legacy, §8.2 credentials).
//!
//! 실제 사용자 파일(저장소 루트 `settings.json`, `dependent/`)은 읽지 않는다. Go 형식 JSON은 여기서 만든다.

use chzzk_core::settings::{MAX_RECENT_VODS, SETTINGS_FILE};
use chzzk_core::{
    CredentialStore, NaverCookies, RecentVod, SettingsStore, UserSettings, add_recent_vod,
};
use std::path::Path;

/// Go가 처음 실행 때 쓰는 형식(8개 키, 빈 slice는 `null`).
const GO_FIRST_RUN: &str = r#"{
  "downloadFolder": "",
  "isAdultContent": false,
  "nidAut": "",
  "nidSes": "",
  "lastQualityName": "",
  "lastVodURL": "",
  "recentVodURLs": null,
  "recentVods": null
}"#;

fn bad_backups(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| n.starts_with("settings.json.bad-"))
        .collect()
}

#[test]
fn recent_vods() {
    let mut s = UserSettings::default();
    for i in 0..7 {
        add_recent_vod(&mut s, &format!("u{i}"), &format!("t{i}"));
    }
    assert_eq!(s.recent_vods.len(), MAX_RECENT_VODS);
    let urls: Vec<_> = s.recent_vods.iter().map(|v| v.url.as_str()).collect();
    assert_eq!(urls, ["u6", "u5", "u4", "u3", "u2"]);
    assert_eq!(s.last_url.as_deref(), Some("u6"));

    // 같은 URL은 맨 앞으로 옮기고 제목을 바꾼다.
    add_recent_vod(&mut s, "u3", "새 제목");
    let urls: Vec<_> = s.recent_vods.iter().map(|v| v.url.as_str()).collect();
    assert_eq!(urls, ["u3", "u6", "u5", "u4", "u2"]);
    assert_eq!(s.recent_vods[0].title, "새 제목");

    // 한글 51자 → 47자 + "..."(문자 기준). 50자는 그대로.
    let long: String = "가".repeat(51);
    add_recent_vod(&mut s, "k", &long);
    assert_eq!(s.recent_vods[0].title, format!("{}...", "가".repeat(47)));
    let fifty: String = "나".repeat(50);
    add_recent_vod(&mut s, "k50", &fifty);
    assert_eq!(s.recent_vods[0].title, fifty);
}

#[test]
fn tolerates_go_file() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join(SETTINGS_FILE), GO_FIRST_RUN).unwrap();
    let store = SettingsStore::open(dir.path().to_path_buf()).unwrap();
    let s = store.get();
    assert_eq!(s.download_folder, None);
    assert!(s.recent_vods.is_empty());
    assert_eq!(s.schema_version, 2);
    assert!(bad_backups(dir.path()).is_empty());

    // 키가 하나도 없어도 된다.
    std::fs::write(dir.path().join(SETTINGS_FILE), "{}").unwrap();
    let store = SettingsStore::open(dir.path().to_path_buf()).unwrap();
    assert_eq!(store.get(), UserSettings::default());
}

#[test]
fn missing_file_is_default_and_update_creates_it() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = dir.path().join("nested").join("cfg");
    let store = SettingsStore::open(cfg.clone()).unwrap();
    assert_eq!(store.get(), UserSettings::default());
    assert!(!cfg.join(SETTINGS_FILE).exists());

    let after = store
        .update(|s| {
            s.last_quality_label = Some("720p".into());
            add_recent_vod(s, "https://chzzk.naver.com/video/1", "제목");
        })
        .unwrap();
    assert_eq!(store.get(), after);

    // 다시 열면 같은 값이다.
    let reopened = SettingsStore::open(cfg.clone()).unwrap();
    assert_eq!(reopened.get(), after);
    let raw: serde_json::Value =
        serde_json::from_slice(&std::fs::read(cfg.join(SETTINGS_FILE)).unwrap()).unwrap();
    assert_eq!(raw["lastQualityLabel"], "720p");
    assert_eq!(raw["schemaVersion"], 2);
    assert!(raw.get("recentVodURLs").is_none(), "옛 키는 쓰지 않는다");
}

#[test]
fn corrupt_backed_up() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(SETTINGS_FILE);
    std::fs::write(&path, b"{ not json").unwrap();
    let store = SettingsStore::open(dir.path().to_path_buf()).unwrap();
    assert_eq!(store.get(), UserSettings::default());
    let backups = bad_backups(dir.path());
    assert_eq!(backups.len(), 1, "{backups:?}");
    assert_eq!(
        std::fs::read(dir.path().join(&backups[0])).unwrap(),
        b"{ not json"
    );
    assert!(!path.exists());

    // 이후 저장이 된다(Go는 깨진 파일 때문에 영영 저장하지 못했다).
    store.update(|s| s.use_naver_cookies = true).unwrap();
    assert!(
        SettingsStore::open(dir.path().to_path_buf())
            .unwrap()
            .get()
            .use_naver_cookies
    );

    // 형식이 맞지 않는 JSON도 깨진 파일이다. 같은 초에 또 깨져도 백업 이름이 겹치지 않는다.
    std::fs::write(&path, b"[]").unwrap();
    SettingsStore::open(dir.path().to_path_buf()).unwrap();
    assert_eq!(bad_backups(dir.path()).len(), 2);
}

#[test]
fn concurrent_updates_are_not_lost() {
    let dir = tempfile::tempdir().unwrap();
    let store = std::sync::Arc::new(SettingsStore::open(dir.path().to_path_buf()).unwrap());
    let handles: Vec<_> = (0..8)
        .map(|i| {
            let store = store.clone();
            std::thread::spawn(move || {
                store
                    .update(|s| add_recent_vod(s, &format!("u{i}"), "t"))
                    .unwrap();
            })
        })
        .collect();
    for h in handles {
        h.join().unwrap();
    }
    assert_eq!(store.get().recent_vods.len(), MAX_RECENT_VODS);
    let reopened = SettingsStore::open(dir.path().to_path_buf()).unwrap();
    assert_eq!(reopened.get(), store.get());
}

mod credentials {
    use super::*;

    #[test]
    fn save_load_clear() {
        let dir = tempfile::tempdir().unwrap();
        let store = CredentialStore::new(dir.path().join("cfg"));
        assert_eq!(store.load().unwrap(), None);
        store.save(&NaverCookies::new(" aut ", "ses")).unwrap();
        assert_eq!(store.load().unwrap(), Some(NaverCookies::new("aut", "ses")));
        store.clear().unwrap();
        assert_eq!(store.load().unwrap(), None);
        store.clear().unwrap();
    }

    #[test]
    fn corrupt_error_hides_values() {
        let dir = tempfile::tempdir().unwrap();
        let store = CredentialStore::new(dir.path().to_path_buf());
        std::fs::write(store.path(), br#"{"nidAut":"secretAUT","nidSes":1}"#).unwrap();
        let e = store.load().unwrap_err();
        assert!(!format!("{e} {e:?}").contains("secretAUT"));
        // 값 하나가 비면 없는 것과 같다.
        std::fs::write(store.path(), br#"{"nidAut":"a","nidSes":""}"#).unwrap();
        assert_eq!(store.load().unwrap(), None);
    }

    #[cfg(unix)]
    #[test]
    fn unix_mode_0600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let store = CredentialStore::new(dir.path().to_path_buf());
        // 넓은 권한의 파일이 이미 있어도 저장 뒤에는 0600이다.
        std::fs::write(store.path(), b"{}").unwrap();
        std::fs::set_permissions(store.path(), std::fs::Permissions::from_mode(0o644)).unwrap();
        store.save(&NaverCookies::new("a", "b")).unwrap();
        let mode = std::fs::metadata(store.path())
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
        // 새로 만드는 경우도 같다.
        store.clear().unwrap();
        store.save(&NaverCookies::new("a", "b")).unwrap();
        let mode = std::fs::metadata(store.path())
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

mod legacy {
    use super::*;
    use chzzk_core::import_legacy;
    use chzzk_core::legacy::WARN_PLAINTEXT_COOKIES;

    /// 옛 폴더를 만든다. 원본 보존 검사를 위해 쓴 바이트를 돌려준다.
    fn legacy_dir(settings: Option<&str>, cookie: Option<&str>) -> (tempfile::TempDir, Vec<u8>) {
        let dir = tempfile::tempdir().unwrap();
        let mut snapshot = Vec::new();
        if let Some(s) = settings {
            std::fs::write(dir.path().join("settings.json"), s).unwrap();
            snapshot.extend_from_slice(s.as_bytes());
        }
        if let Some(c) = cookie {
            std::fs::create_dir(dir.path().join("dependent")).unwrap();
            std::fs::write(dir.path().join("dependent/cookie.json"), c).unwrap();
            snapshot.extend_from_slice(c.as_bytes());
        }
        (dir, snapshot)
    }

    /// 옛 파일이 바이트 그대로 남았는지 본다.
    fn assert_untouched(dir: &Path, snapshot: &[u8]) {
        let mut now = std::fs::read(dir.join("settings.json")).unwrap_or_default();
        now.extend(std::fs::read(dir.join("dependent/cookie.json")).unwrap_or_default());
        assert_eq!(now, snapshot);
    }

    fn go_settings(fields: &str) -> String {
        let mut v: serde_json::Value = serde_json::from_str(GO_FIRST_RUN).unwrap();
        let extra: serde_json::Value = serde_json::from_str(fields).unwrap();
        for (k, x) in extra.as_object().unwrap() {
            v[k] = x.clone();
        }
        serde_json::to_string_pretty(&v).unwrap()
    }

    #[test]
    fn import_none_when_empty_or_new_format() {
        let dir = tempfile::tempdir().unwrap();
        assert!(import_legacy(dir.path()).unwrap().is_none());
        std::fs::write(
            dir.path().join("settings.json"),
            serde_json::to_vec(&UserSettings::default()).unwrap(),
        )
        .unwrap();
        assert!(import_legacy(dir.path()).unwrap().is_none());
    }

    #[test]
    fn import_fills_title() {
        let s = go_settings(
            r#"{"recentVodURLs":["https://chzzk.naver.com/video/1","https://chzzk.naver.com/video/2"],
                "lastVodURL":"https://chzzk.naver.com/video/2"}"#,
        );
        let (dir, snap) = legacy_dir(Some(&s), None);
        let imp = import_legacy(dir.path()).unwrap().unwrap();
        assert_eq!(
            imp.settings.recent_vods,
            vec![
                RecentVod {
                    url: "https://chzzk.naver.com/video/1".into(),
                    title: "제목 없음".into()
                },
                RecentVod {
                    url: "https://chzzk.naver.com/video/2".into(),
                    title: "제목 없음".into()
                },
            ]
        );
        assert_eq!(
            imp.settings.last_url.as_deref(),
            Some("https://chzzk.naver.com/video/2")
        );
        assert_eq!(imp.settings.imported_from.as_deref(), Some(dir.path()));
        assert!(imp.cookies.is_none());
        assert!(imp.warnings.is_empty());
        assert_untouched(dir.path(), &snap);

        // recentVods가 있으면 그것을 쓴다(URL 목록은 무시). 5개로 자른다.
        let vods: Vec<_> = (0..7)
            .map(|i| serde_json::json!({"url": format!("u{i}"), "title": format!("t{i}")}))
            .collect();
        let s = go_settings(
            &serde_json::json!({"recentVods": vods, "recentVodURLs": ["x"]}).to_string(),
        );
        let (dir, _) = legacy_dir(Some(&s), None);
        let imp = import_legacy(dir.path()).unwrap().unwrap();
        assert_eq!(imp.settings.recent_vods.len(), 5);
        assert_eq!(imp.settings.recent_vods[0].title, "t0");
    }

    #[test]
    fn import_cookie_json_preferred() {
        let s = go_settings(r#"{"isAdultContent":true,"nidAut":"sa","nidSes":"ss"}"#);
        let c = r#"{"NID_AUT":"ca","NID_SES":"cs","OTHER":"x"}"#;
        let (dir, snap) = legacy_dir(Some(&s), Some(c));
        let imp = import_legacy(dir.path()).unwrap().unwrap();
        assert_eq!(imp.cookies, Some(NaverCookies::new("ca", "cs")));
        assert!(imp.warnings.iter().any(|w| w == WARN_PLAINTEXT_COOKIES));
        assert_untouched(dir.path(), &snap);

        // cookie.json에 한쪽만 있으면 settings의 한 쌍을 쓴다(섞지 않는다).
        let (dir, _) = legacy_dir(Some(&s), Some(r#"{"NID_AUT":"ca"}"#));
        let imp = import_legacy(dir.path()).unwrap().unwrap();
        assert_eq!(imp.cookies, Some(NaverCookies::new("sa", "ss")));

        // cookie.json만 있어도 가져온다.
        let (dir, _) = legacy_dir(None, Some(c));
        let imp = import_legacy(dir.path()).unwrap().unwrap();
        assert_eq!(imp.cookies, Some(NaverCookies::new("ca", "cs")));
        assert!(!imp.settings.use_naver_cookies, "isAdultContent가 없다");

        // 깨진 cookie.json은 경고만 남긴다.
        let (dir, _) = legacy_dir(Some(&s), Some("{oops"));
        let imp = import_legacy(dir.path()).unwrap().unwrap();
        assert_eq!(imp.cookies, Some(NaverCookies::new("sa", "ss")));
        assert!(imp.warnings.iter().any(|w| w.contains("cookie.json")));
    }

    #[test]
    fn import_quality_label_map() {
        for (old, new) in [
            ("720p", Some("720p")),
            ("720P_1280_2500_192", Some("720p")),
            ("PD_720P_ABC", None),
            ("", None),
        ] {
            let s = go_settings(&serde_json::json!({ "lastQualityName": old }).to_string());
            let (dir, _) = legacy_dir(Some(&s), None);
            let imp = import_legacy(dir.path()).unwrap().unwrap();
            assert_eq!(imp.settings.last_quality_label.as_deref(), new, "{old}");
        }
    }

    #[test]
    fn import_adult_flag() {
        let cases = [
            (true, r#"{"NID_AUT":"a","NID_SES":"b"}"#, true),
            (true, r#"{"NID_AUT":"a","NID_SES":""}"#, false),
            (false, r#"{"NID_AUT":"a","NID_SES":"b"}"#, false),
        ];
        for (adult, cookie, expect) in cases {
            let s = go_settings(&serde_json::json!({ "isAdultContent": adult }).to_string());
            let (dir, _) = legacy_dir(Some(&s), Some(cookie));
            let imp = import_legacy(dir.path()).unwrap().unwrap();
            assert_eq!(imp.settings.use_naver_cookies, expect, "{adult} {cookie}");
        }
    }

    #[test]
    fn import_download_folder_only_if_exists() {
        let target = tempfile::tempdir().unwrap();
        let s = go_settings(
            &serde_json::json!({ "downloadFolder": target.path().to_str().unwrap() }).to_string(),
        );
        let (dir, _) = legacy_dir(Some(&s), None);
        let imp = import_legacy(dir.path()).unwrap().unwrap();
        assert_eq!(imp.settings.download_folder.as_deref(), Some(target.path()));

        let gone = target.path().join("gone");
        let s = go_settings(
            &serde_json::json!({ "downloadFolder": gone.to_str().unwrap() }).to_string(),
        );
        let (dir, _) = legacy_dir(Some(&s), None);
        let imp = import_legacy(dir.path()).unwrap().unwrap();
        assert_eq!(imp.settings.download_folder, None);
        assert!(!imp.warnings.is_empty());
    }

    #[test]
    fn import_corrupt_settings_is_error_and_untouched() {
        let (dir, snap) = legacy_dir(
            Some(r#"{"nidAut": "secretAUT", "isAdultContent": "x"}"#),
            None,
        );
        let e = import_legacy(dir.path()).unwrap_err();
        assert!(matches!(e, chzzk_core::Error::Settings(_)));
        assert!(!e.to_string().contains("secretAUT"));
        assert_untouched(dir.path(), &snap);
    }
}
