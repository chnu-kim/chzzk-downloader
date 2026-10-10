//! 설정 서비스(app.md §3 쿠키 토글, §7.2, §15-9): 경로 폴백, 패치, 클라이언트 교체, 첫 실행 가져오기 후보,
//! 동시 작업 수 반영, 작업 추가 뒤 최근 VOD 저장.

mod common;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use chzzk_core::{ClientConfig, ContentRef, PlaybackKind, RecentKind, TextScale, Theme};
use chzzk_shell::dto::{Nullable, SettingsPatch};
use chzzk_shell::services::{
    AppPaths, DEFAULT_FOLDER_NAME, SettingsService, default_download_folder, enqueue,
};
use chzzk_shell::{ErrorCode, OwnershipGate};
use common::fake::Script;
use common::harness::{Harness, request, settle, until};
use tempfile::TempDir;
use tokio::sync::Notify;

fn paths(root: &Path) -> AppPaths {
    AppPaths::new(
        root.join("config"),
        root.join("data"),
        root.join("log"),
        None,
        None,
        None,
    )
}

fn open(root: &Path) -> SettingsService {
    SettingsService::open(&paths(root), ClientConfig::default(), None).unwrap()
}

fn open_with_legacy(root: &Path, legacy: &Path) -> SettingsService {
    SettingsService::open(&paths(root), ClientConfig::default(), Some(legacy)).unwrap()
}

fn has_cookies(s: &SettingsService) -> bool {
    s.client().config().cookies.is_some()
}

fn patch() -> SettingsPatch {
    SettingsPatch::default()
}

// ---------------------------------------------------------------------------
// 경로
// ---------------------------------------------------------------------------

#[test]
fn default_folder_fallbacks() {
    let t = TempDir::new().unwrap();
    let video = t.path().join("Movies");
    let down = t.path().join("Downloads");
    let data = t.path().join("data");
    std::fs::create_dir_all(&video).unwrap();
    std::fs::create_dir_all(&down).unwrap();
    let missing = t.path().join("없음");

    let home = t.path().join("home");
    std::fs::create_dir_all(&home).unwrap();

    type Case<'a> = (
        Option<&'a Path>,
        Option<&'a Path>,
        Option<&'a Path>,
        PathBuf,
    );
    let cases: Vec<Case> = vec![
        (
            Some(&video),
            Some(&down),
            Some(&home),
            video.join(DEFAULT_FOLDER_NAME),
        ),
        (
            None,
            Some(&down),
            Some(&home),
            down.join(DEFAULT_FOLDER_NAME),
        ),
        (
            Some(&missing),
            Some(&down),
            None,
            down.join(DEFAULT_FOLDER_NAME),
        ),
        (
            Some(Path::new("Movies")),
            Some(&down),
            None,
            down.join(DEFAULT_FOLDER_NAME),
        ),
        // 비디오·다운로드 폴더가 없으면 홈/치지직(platform §16.1, X8)
        (None, None, Some(&home), home.join(DEFAULT_FOLDER_NAME)),
        (
            Some(&missing),
            Some(&missing),
            Some(&home),
            home.join(DEFAULT_FOLDER_NAME),
        ),
        // 없거나 쓸 수 없는 홈은 건너뛴다. 홈도 없을 때만 옛 `{data}/downloads`
        (Some(&missing), None, Some(&missing), data.join("downloads")),
        (Some(&missing), None, None, data.join("downloads")),
        (None, None, None, data.join("downloads")),
    ];
    for (i, (v, d, h, want)) in cases.into_iter().enumerate() {
        assert_eq!(default_download_folder(v, d, h, &data), want, "행 {i}");
    }

    let p = AppPaths::new(
        t.path().join("c"),
        data.clone(),
        t.path().join("l"),
        Some(video.clone()),
        None,
        None,
    );
    assert_eq!(p.default_download, video.join(DEFAULT_FOLDER_NAME));
}

/// UTF-8이 아닌 OS 폴더는 고르지 않는다(작업 목록에 저장할 수 없다).
#[cfg(unix)]
#[test]
fn default_folder_skips_non_utf8() {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;
    let t = TempDir::new().unwrap();
    let bad = t.path().join(OsStr::from_bytes(b"vid\xff"));
    if std::fs::create_dir_all(&bad).is_err() {
        return; // UTF-8 이름만 받는 파일 시스템(APFS 등)
    }
    let down = t.path().join("Downloads");
    std::fs::create_dir_all(&down).unwrap();
    assert_eq!(
        default_download_folder(Some(&bad), Some(&down), None, t.path()),
        down.join(DEFAULT_FOLDER_NAME)
    );
}

// ---------------------------------------------------------------------------
// 패치
// ---------------------------------------------------------------------------

#[test]
fn defaults_and_patch_rules() {
    let t = TempDir::new().unwrap();
    let svc = open(t.path());
    let d = svc.get();
    assert_eq!(d.download_folder, None);
    assert_eq!(
        d.effective_download_folder,
        t.path().join("data").join("downloads").to_string_lossy()
    );
    assert!(!d.use_naver_cookies && !d.naver_cookies_saved);
    assert_eq!((d.segment_concurrency, d.max_parallel_downloads), (4, 2));
    assert!(!d.auto_resume_interrupted);

    let folder = t.path().join("영상");
    let d = svc
        .update(SettingsPatch {
            download_folder: Nullable::Set(format!("  {}  ", folder.display())),
            segment_concurrency: Some(0),
            max_parallel_downloads: Some(9),
            auto_resume_interrupted: Some(true),
            ..patch()
        })
        .unwrap();
    assert_eq!(
        d.download_folder.as_deref(),
        Some(&*folder.to_string_lossy())
    );
    assert_eq!(d.effective_download_folder, folder.to_string_lossy());
    assert_eq!(d.segment_concurrency, 1);
    assert_eq!(d.max_parallel_downloads, 3);
    assert!(d.auto_resume_interrupted);
    assert_eq!(svc.job_defaults().download_folder, folder);

    let d = svc
        .update(SettingsPatch {
            segment_concurrency: Some(200),
            max_parallel_downloads: Some(0),
            ..patch()
        })
        .unwrap();
    assert_eq!((d.segment_concurrency, d.max_parallel_downloads), (8, 1));
    assert_eq!(svc.job_defaults().segment_concurrency, 8);

    // 키 없음은 그대로, `null`은 기본 폴더로
    assert_eq!(
        svc.update(patch()).unwrap().download_folder.as_deref(),
        Some(&*folder.to_string_lossy())
    );
    let d = svc
        .update(SettingsPatch {
            download_folder: Nullable::Clear,
            ..patch()
        })
        .unwrap();
    assert_eq!(d.download_folder, None);

    for bad in [
        "",
        "   ",
        "relative/dir",
        "/tmp/videos/../videos",
        "/tmp/videos/./x",
        "/tmp/videos/..",
    ] {
        let e = svc
            .update(SettingsPatch {
                download_folder: Nullable::Set(bad.into()),
                max_parallel_downloads: Some(3),
                ..patch()
            })
            .unwrap_err();
        assert_eq!(e.code, ErrorCode::InvalidInput, "{bad:?}");
    }
    assert_eq!(
        svc.get().max_parallel_downloads,
        1,
        "거부된 패치는 아무것도 바꾸지 않는다"
    );

    // 다시 열어도 남는다
    drop(svc);
    let d = open(t.path()).get();
    assert_eq!((d.segment_concurrency, d.max_parallel_downloads), (8, 1));
    assert!(d.auto_resume_interrupted);
}

/// 글자 크기·모양: 저장하고 DTO에 싣고 다시 열어도 남는다. 키 없음은 그대로, 거부된 패치는 바꾸지 않는다.
#[test]
fn appearance_patch_persists_and_reaches_dto() {
    let t = TempDir::new().unwrap();
    let svc = open(t.path());
    let d = svc.get();
    assert_eq!((d.text_scale, d.theme), (TextScale::Default, Theme::System));
    assert_eq!(svc.appearance(), (TextScale::Default, Theme::System));

    let d = svc
        .update(SettingsPatch {
            text_scale: Some(TextScale::XLarge),
            ..patch()
        })
        .unwrap();
    assert_eq!((d.text_scale, d.theme), (TextScale::XLarge, Theme::System));

    // theme만 바꿔도 글자 크기는 그대로(OS와 무관하게 저장한다)
    let d = svc
        .update(SettingsPatch {
            theme: Some(Theme::Dark),
            ..patch()
        })
        .unwrap();
    assert_eq!((d.text_scale, d.theme), (TextScale::XLarge, Theme::Dark));
    assert_eq!(svc.appearance(), (TextScale::XLarge, Theme::Dark));

    // 키 없는 패치는 바꾸지 않는다
    let d = svc.update(patch()).unwrap();
    assert_eq!((d.text_scale, d.theme), (TextScale::XLarge, Theme::Dark));

    // 다른 항목이 거부되면 같은 패치의 글자 크기도 적용되지 않는다
    let e = svc
        .update(SettingsPatch {
            text_scale: Some(TextScale::Large),
            download_folder: Nullable::Set("relative".into()),
            ..patch()
        })
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidInput);
    assert_eq!(svc.get().text_scale, TextScale::XLarge);

    // 다시 열어도 남는다
    drop(svc);
    let d = open(t.path()).get();
    assert_eq!((d.text_scale, d.theme), (TextScale::XLarge, Theme::Dark));
}

#[test]
fn appearance_patch_json_from_frontend() {
    let p: SettingsPatch =
        serde_json::from_str(r#"{"textScale":"x-large","theme":"light"}"#).unwrap();
    assert_eq!(p.text_scale, Some(TextScale::XLarge));
    assert_eq!(p.theme, Some(Theme::Light));
    let p: SettingsPatch = serde_json::from_str(r#"{"textScale":"large"}"#).unwrap();
    assert_eq!((p.text_scale, p.theme), (Some(TextScale::Large), None));
}

#[test]
fn recent_kind_follows_content_then_playback() {
    use chzzk_shell::services::recent_kind;
    let video = ContentRef::Video { video_no: 1 };
    let clip = ContentRef::Clip {
        clip_id: "c".into(),
    };
    assert_eq!(
        recent_kind(&video, PlaybackKind::Progressive),
        RecentKind::Vod
    );
    assert_eq!(
        recent_kind(&video, PlaybackKind::LiveRewindHls),
        RecentKind::Rewind
    );
    // 클립이 먼저다: 재생 방식과 무관하게 clip
    assert_eq!(
        recent_kind(&clip, PlaybackKind::Progressive),
        RecentKind::Clip
    );
    assert_eq!(
        recent_kind(&clip, PlaybackKind::LiveRewindHls),
        RecentKind::Clip
    );
}

#[test]
fn patch_json_from_frontend() {
    let p: SettingsPatch =
        serde_json::from_str(r#"{"downloadFolder":null,"maxParallelDownloads":3}"#).unwrap();
    assert_eq!(p.download_folder, Nullable::Clear);
    assert_eq!(p.max_parallel_downloads, Some(3));
    let p: SettingsPatch = serde_json::from_str("{}").unwrap();
    assert_eq!(p, SettingsPatch::default());
}

// ---------------------------------------------------------------------------
// 쿠키와 클라이언트 교체
// ---------------------------------------------------------------------------

#[test]
fn cookie_toggle_swaps_client() {
    let t = TempDir::new().unwrap();
    let svc = open(t.path());
    let first = svc.client();
    assert!(!has_cookies(&svc));

    // 저장된 값 없이 켤 수 없다
    let e = svc
        .update(SettingsPatch {
            use_naver_cookies: Some(true),
            ..patch()
        })
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidInput);
    assert!(!svc.get().use_naver_cookies);

    // 빈 값은 거부
    for (a, s) in [("", "x"), ("x", "  "), (" ", " ")] {
        assert_eq!(
            svc.set_naver_cookies(a, s).unwrap_err().code,
            ErrorCode::InvalidInput
        );
    }
    assert!(!svc.get().naver_cookies_saved);

    // 저장만 하면 사용 여부는 그대로고 클라이언트도 그대로
    let d = svc.set_naver_cookies(" aut ", " ses ").unwrap();
    assert!(d.naver_cookies_saved && !d.use_naver_cookies);
    assert!(Arc::ptr_eq(&first, &svc.client()));

    // 켜면 새 클라이언트. 이미 받은 클라이언트(실행 중 작업)는 그대로
    let d = svc
        .update(SettingsPatch {
            use_naver_cookies: Some(true),
            ..patch()
        })
        .unwrap();
    assert!(d.use_naver_cookies);
    let on = svc.client();
    assert!(!Arc::ptr_eq(&first, &on));
    let c = on.config().cookies.as_ref().unwrap();
    assert_eq!(
        (c.nid_aut.expose().as_str(), c.nid_ses.expose().as_str()),
        ("aut", "ses")
    );
    assert!(first.config().cookies.is_none());

    // 같은 값으로 다시 켜면 바꾸지 않는다
    svc.update(SettingsPatch {
        use_naver_cookies: Some(true),
        ..patch()
    })
    .unwrap();
    assert!(Arc::ptr_eq(&on, &svc.client()));

    // 켜진 채 새 쿠키를 저장하면 바로 바꾼다
    svc.set_naver_cookies("aut2", "ses2").unwrap();
    let c = svc.client().config().cookies.clone().unwrap();
    assert_eq!(c.nid_aut.expose(), "aut2");

    // client_fn은 부르는 시점의 클라이언트를 준다
    let f = svc.client_fn();
    let before = f();
    svc.update(SettingsPatch {
        use_naver_cookies: Some(false),
        ..patch()
    })
    .unwrap();
    assert!(before.config().cookies.is_some());
    assert!(f().config().cookies.is_none());

    // 다시 열면 설정대로 만든다
    svc.update(SettingsPatch {
        use_naver_cookies: Some(true),
        ..patch()
    })
    .unwrap();
    drop(svc);
    let svc = open(t.path());
    assert!(has_cookies(&svc));

    // 지우면 사용도 꺼지고 쿠키 없는 클라이언트
    let d = svc.clear_naver_cookies().unwrap();
    assert!(!d.use_naver_cookies && !d.naver_cookies_saved);
    assert!(!has_cookies(&svc));
    assert!(!t.path().join("config/credentials.json").exists());
}

/// 헤더로 보낼 수 없는 쿠키는 저장하지 않고, 오류에 값을 넣지 않는다.
#[test]
fn invalid_cookie_is_not_saved() {
    let t = TempDir::new().unwrap();
    let svc = open(t.path());
    svc.set_naver_cookies("good", "good").unwrap();
    svc.update(SettingsPatch {
        use_naver_cookies: Some(true),
        ..patch()
    })
    .unwrap();
    let before = svc.client();
    let e = svc.set_naver_cookies("NIDSECRET\nx", "ses").unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidInput);
    assert!(!serde_json::to_string(&e).unwrap().contains("NIDSECRET"));
    assert!(!format!("{e:?}").contains("NIDSECRET"));
    assert!(Arc::ptr_eq(&before, &svc.client()));
    let saved = std::fs::read_to_string(t.path().join("config/credentials.json")).unwrap();
    assert!(saved.contains("good") && !saved.contains("NIDSECRET"));
}

/// 깨진 credentials.json이어도 시작은 된다(쿠키 없이).
#[test]
fn corrupt_credentials_start_without_cookies() {
    let t = TempDir::new().unwrap();
    let svc = open(t.path());
    svc.set_naver_cookies("a", "b").unwrap();
    svc.update(SettingsPatch {
        use_naver_cookies: Some(true),
        ..patch()
    })
    .unwrap();
    drop(svc);
    std::fs::write(t.path().join("config/credentials.json"), b"{not json").unwrap();
    let svc = open(t.path());
    assert!(!has_cookies(&svc));
    let d = svc.get();
    assert!(!d.naver_cookies_saved);
    // 쿠키를 보내지 않으므로 켜짐으로 보이지 않는다(S2 "저장된 값이 없으면 켤 수 없다")
    assert!(!d.use_naver_cookies);
    // 다시 저장하고 켜면 조용히 무시되지 않고 쿠키를 보낸다
    assert!(
        svc.update(SettingsPatch {
            use_naver_cookies: Some(true),
            ..patch()
        })
        .is_err()
    );
    svc.set_naver_cookies("c", "d").unwrap();
    let d = svc
        .update(SettingsPatch {
            use_naver_cookies: Some(true),
            ..patch()
        })
        .unwrap();
    assert!(d.use_naver_cookies && d.naver_cookies_saved && has_cookies(&svc));
}

// ---------------------------------------------------------------------------
// 첫 실행 가져오기
// ---------------------------------------------------------------------------

/// 옛(Go) 실행 폴더: settings.json + dependent/cookie.json.
fn legacy_dir(t: &TempDir) -> PathBuf {
    let dir = t.path().join("old");
    std::fs::create_dir_all(dir.join("dependent")).unwrap();
    std::fs::create_dir_all(dir.join("downloads")).unwrap();
    std::fs::write(
        dir.join("settings.json"),
        r#"{"downloadFolder":"downloads","isAdultContent":true,"lastQualityName":"1080p",
            "lastVodURL":"https://chzzk.naver.com/video/2",
            "recentVods":[{"url":"https://chzzk.naver.com/video/2","title":"옛 영상 2"},
                          {"url":"https://chzzk.naver.com/video/3","title":"옛 영상 3"}]}"#,
    )
    .unwrap();
    std::fs::write(
        dir.join("dependent/cookie.json"),
        r#"{"NID_AUT":"oldaut","NID_SES":"oldses"}"#,
    )
    .unwrap();
    dir
}

#[test]
fn legacy_candidate_is_offered_once() {
    let t = TempDir::new().unwrap();
    let old = legacy_dir(&t);
    let svc = open_with_legacy(t.path(), &old);
    let c = svc.legacy_candidate().expect("첫 실행 후보");
    assert_eq!(c.dir, old.to_string_lossy());
    assert_eq!(c.recent_count, 2);
    assert!(c.has_cookies);
    // 적용하지 않았다
    let d = svc.get();
    assert!(d.recent_vods.is_empty() && !d.naver_cookies_saved && d.imported_from.is_none());
    assert!(!has_cookies(&svc));
    // 같은 실행 안에서는 계속 보인다(웹뷰 새로고침)
    assert!(svc.legacy_candidate().is_some());
    drop(svc);

    // 아무것도 하지 않고 다시 열어도 묻지 않는다
    let svc = open_with_legacy(t.path(), &old);
    assert!(svc.legacy_candidate().is_none());
    assert_eq!(
        svc.import_legacy(None).unwrap(),
        None,
        "후보가 없으면 null은 아무것도 안 한다"
    );
}

#[test]
fn no_candidate_without_legacy_files_or_after_first_run() {
    let t = TempDir::new().unwrap();
    let empty = t.path().join("empty");
    std::fs::create_dir_all(&empty).unwrap();
    assert!(
        open_with_legacy(t.path(), &empty)
            .legacy_candidate()
            .is_none()
    );

    // 이미 설정 파일이 있으면 첫 실행이 아니다
    let t = TempDir::new().unwrap();
    let old = legacy_dir(&t);
    open(t.path()).update(patch()).unwrap();
    assert!(
        open_with_legacy(t.path(), &old)
            .legacy_candidate()
            .is_none()
    );

    // 옛 설정이 깨졌으면 후보 없이 시작한다
    let t = TempDir::new().unwrap();
    let old = legacy_dir(&t);
    std::fs::write(old.join("settings.json"), b"{broken").unwrap();
    assert!(
        open_with_legacy(t.path(), &old)
            .legacy_candidate()
            .is_none()
    );
}

#[test]
fn applying_candidate_merges_and_swaps_client() {
    let t = TempDir::new().unwrap();
    let old = legacy_dir(&t);
    let svc = open_with_legacy(t.path(), &old);
    // 사용자가 먼저 바꾼 새 설정과 최근 VOD
    svc.update(SettingsPatch {
        max_parallel_downloads: Some(3),
        ..patch()
    })
    .unwrap();
    svc.record_enqueued(
        "https://chzzk.naver.com/video/1",
        "새 영상",
        "720p",
        chzzk_core::RecentKind::Vod,
        None,
    )
    .unwrap();

    let r = svc.import_legacy(None).unwrap().expect("적용 결과");
    assert_eq!(r.recent_count, 2);
    assert!(r.has_cookies);
    assert!(r.warnings.iter().any(|w| w.contains("평문 쿠키")));

    let d = svc.get();
    assert_eq!(d.max_parallel_downloads, 3, "새 설정은 그대로");
    assert_eq!(
        d.download_folder.as_deref(),
        Some(&*old.join("downloads").to_string_lossy())
    );
    assert_eq!(d.last_quality_label.as_deref(), Some("1080p"));
    assert_eq!(
        d.last_url.as_deref(),
        Some("https://chzzk.naver.com/video/2")
    );
    let urls: Vec<_> = d.recent_vods.iter().map(|v| v.url.as_str()).collect();
    assert_eq!(
        urls,
        [
            "https://chzzk.naver.com/video/1",
            "https://chzzk.naver.com/video/2",
            "https://chzzk.naver.com/video/3"
        ]
    );
    assert_eq!(d.imported_from.as_deref(), Some(&*old.to_string_lossy()));
    assert!(d.use_naver_cookies && d.naver_cookies_saved);
    let c = svc.client().config().cookies.clone().unwrap();
    assert_eq!(c.nid_aut.expose(), "oldaut");
    assert!(svc.legacy_candidate().is_none());
}

#[test]
fn import_from_picked_folder() {
    let t = TempDir::new().unwrap();
    let old = legacy_dir(&t);
    let svc = open(t.path());
    assert_eq!(
        svc.import_legacy(Some("relative")).unwrap_err().code,
        ErrorCode::InvalidInput
    );
    assert_eq!(
        svc.import_legacy(Some("  ")).unwrap_err().code,
        ErrorCode::InvalidInput
    );
    let empty = t.path().join("empty");
    std::fs::create_dir_all(&empty).unwrap();
    assert_eq!(
        svc.import_legacy(Some(&*empty.to_string_lossy())).unwrap(),
        None
    );
    let r = svc
        .import_legacy(Some(&*old.to_string_lossy()))
        .unwrap()
        .unwrap();
    assert_eq!(r.recent_count, 2);
    assert_eq!(svc.get().recent_vods.len(), 2);
}

/// 이미 저장한 쿠키·사용 여부는 옛 cookie.json이 덮지 않는다(가져오기는 병합).
#[test]
fn import_keeps_saved_cookies() {
    let t = TempDir::new().unwrap();
    let old = legacy_dir(&t);
    // 옛 설정은 성인 컨텐츠 꺼짐
    let raw = std::fs::read_to_string(old.join("settings.json")).unwrap();
    std::fs::write(
        old.join("settings.json"),
        raw.replace(r#""isAdultContent":true"#, r#""isAdultContent":false"#),
    )
    .unwrap();
    let svc = open(t.path());
    svc.set_naver_cookies("newaut", "newses").unwrap();
    svc.update(SettingsPatch {
        use_naver_cookies: Some(true),
        ..patch()
    })
    .unwrap();

    let r = svc
        .import_legacy(Some(&*old.to_string_lossy()))
        .unwrap()
        .unwrap();
    assert!(!r.has_cookies);
    assert!(r.warnings.iter().any(|w| w.contains("이미 저장된")));
    let d = svc.get();
    assert!(d.use_naver_cookies && d.naver_cookies_saved);
    assert_eq!(d.recent_vods.len(), 2, "다른 항목은 가져온다");
    let c = svc.client().config().cookies.clone().unwrap();
    assert_eq!(c.nid_aut.expose(), "newaut");
    let saved = std::fs::read_to_string(t.path().join("config/credentials.json")).unwrap();
    assert!(saved.contains("newaut") && !saved.contains("oldaut"));
}

/// 설정 저장이 실패한 가져오기는 옛 쿠키를 남기지 않는다.
#[test]
fn failed_import_rolls_back_cookies() {
    let t = TempDir::new().unwrap();
    let old = legacy_dir(&t);
    let svc = open(t.path());
    // settings.json 자리에 폴더를 둬 설정 저장을 실패시킨다
    let settings = t.path().join("config/settings.json");
    let _ = std::fs::remove_file(&settings);
    std::fs::create_dir_all(settings.join("x")).unwrap();

    assert!(svc.import_legacy(Some(&*old.to_string_lossy())).is_err());
    assert!(!t.path().join("config/credentials.json").exists());
    assert!(!has_cookies(&svc));
    assert!(!svc.get().naver_cookies_saved);
}

// ---------------------------------------------------------------------------
// 매니저와 함께
// ---------------------------------------------------------------------------

/// 동시 작업 수 변경은 설정 파일만이 아니라 도는 매니저에 반영된다.
#[tokio::test(start_paused = true)]
async fn parallel_setting_reaches_manager() {
    let h = Harness::new(1);
    let t = TempDir::new().unwrap();
    let svc = open(t.path());
    let gates: Vec<Arc<Notify>> = (0..2).map(|_| Arc::new(Notify::new())).collect();
    for (n, g) in ["a", "b"].iter().zip(&gates) {
        h.fake
            .script_for(h.output(n), Script::new().hold(g.clone()));
    }
    h.enqueue("a");
    h.enqueue("b");
    settle().await;
    assert_eq!(h.fake.active(), 1);

    let d = svc
        .update_and_apply(
            SettingsPatch {
                max_parallel_downloads: Some(2),
                ..patch()
            },
            &h.mgr,
        )
        .unwrap();
    assert_eq!(d.max_parallel_downloads, 2);
    until("둘째 작업 시작", || h.fake.active() == 2).await;
    for g in &gates {
        g.notify_one();
    }
}

/// 작업 추가: 설정 폴더·연결 수를 쓰고, 마지막 화질·최근 VOD를 저장한다.
#[tokio::test(start_paused = true)]
async fn enqueue_uses_settings_and_records_recent() {
    let h = Harness::new(1);
    let t = TempDir::new().unwrap();
    let svc = open(t.path());
    let folder = t.path().join("내 영상");
    svc.update(SettingsPatch {
        download_folder: Nullable::Set(folder.to_string_lossy().into_owned()),
        segment_concurrency: Some(6),
        ..patch()
    })
    .unwrap();

    let mut req = request("a");
    req.quality_label = "1080p".into();
    let job = enqueue(&svc, &OwnershipGate::disabled(), &h.mgr, req.clone())
        .await
        .unwrap();
    assert_eq!(job.output, folder.join("a.mp4").to_string_lossy());
    until("완료", || h.fake.download_requests().len() == 1).await;
    assert_eq!(h.fake.download_requests()[0].concurrency.get(), 6);

    let d = svc.get();
    assert_eq!(d.last_quality_label.as_deref(), Some("1080p"));
    assert_eq!(d.last_url.as_deref(), Some(&*req.url));
    assert_eq!(d.recent_vods[0].title, req.title);

    // 실패한 추가는 최근 VOD를 바꾸지 않는다
    let e = enqueue(&svc, &OwnershipGate::disabled(), &h.mgr, {
        let mut r = request("b");
        r.folder = Some("relative".into());
        r.url = "https://chzzk.naver.com/video/999".into();
        r
    })
    .await
    .unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidInput);
    assert_eq!(svc.get().recent_vods.len(), 1);
}

/// 작업 추가는 최근 영상에 종류(클립 > 빠른 다시보기 > VOD)와 `contentDate`를 남긴다.
#[tokio::test(start_paused = true)]
async fn enqueue_records_recent_kind_and_date() {
    let h = Harness::new(2);
    let t = TempDir::new().unwrap();
    let svc = open(t.path());
    let gate = OwnershipGate::disabled();

    // 일반 VOD(Progressive) + 날짜
    let mut vod = request("v");
    vod.url = "https://chzzk.naver.com/video/11".into();
    vod.content = ContentRef::Video { video_no: 11 };
    vod.expected_kind = PlaybackKind::Progressive;
    vod.content_date = Some("2026-03-04 05:06:07".into());
    enqueue(&svc, &gate, &h.mgr, vod).await.unwrap();
    let r = svc.get().recent_vods[0].clone();
    assert_eq!(
        (r.kind, r.date.as_deref()),
        (Some(RecentKind::Vod), Some("2026-03-04 05:06:07"))
    );

    // 빠른 다시보기(HLS), 날짜 없음
    let mut rewind = request("r");
    rewind.url = "https://chzzk.naver.com/video/12".into();
    rewind.content = ContentRef::Video { video_no: 12 };
    rewind.expected_kind = PlaybackKind::LiveRewindHls;
    enqueue(&svc, &gate, &h.mgr, rewind).await.unwrap();
    let r = svc.get().recent_vods[0].clone();
    assert_eq!((r.kind, r.date), (Some(RecentKind::Rewind), None));

    // 클립: 재생 방식이 HLS여도 clip, 공백뿐인 날짜는 남기지 않는다
    let mut clip = request("c");
    clip.url = "https://chzzk.naver.com/clips/abcDEF123".into();
    clip.content = ContentRef::Clip {
        clip_id: "abcDEF123".into(),
    };
    clip.expected_kind = PlaybackKind::LiveRewindHls;
    clip.content_date = Some("  ".into());
    enqueue(&svc, &gate, &h.mgr, clip).await.unwrap();
    let d = svc.get();
    assert_eq!(d.recent_vods.len(), 3);
    assert_eq!(
        (d.recent_vods[0].kind, d.recent_vods[0].date.clone()),
        (Some(RecentKind::Clip), None)
    );
    assert_eq!(d.recent_vods[2].kind, Some(RecentKind::Vod));
}
