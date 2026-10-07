//! `session.json`(worker.md §11.2) 읽기·쓰기.

mod common;

use chzzk_shell::auth::{LoadOutcome, SessionStore, WorkerBase};
use common::auth::*;
use time::Duration;

fn loaded(o: LoadOutcome) -> chzzk_shell::auth::StoredSession {
    match o {
        LoadOutcome::Loaded(s) => s,
        other => panic!("Loaded가 아님: {other:?}"),
    }
}

fn good_json(dir: &std::path::Path) -> serde_json::Value {
    store(dir)
        .save(&stored(1, t0(), t0() + Duration::days(30)))
        .unwrap();
    read_session(dir).unwrap()
}

#[test]
fn save_load_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let s = stored(1, t0(), t0() + Duration::days(30));
    store(dir.path()).save(&s).unwrap();
    assert_eq!(loaded(store(dir.path()).load()), s);
}

#[test]
fn file_shape_is_v1_with_origin() {
    let dir = tempfile::tempdir().unwrap();
    let v = good_json(dir.path());
    let mut keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
    keys.sort();
    let mut want = vec![
        "v",
        "origin",
        "channelId",
        "channelName",
        "isAdmin",
        "accessToken",
        "accessExpiresAt",
        "refreshToken",
        "refreshExpiresAt",
        "verifiedAt",
    ];
    want.sort();
    assert_eq!(keys, want);
    assert_eq!(v["v"], 1);
    assert_eq!(v["origin"], ORIGIN);
    assert_eq!(v["verifiedAt"], "2030-01-01T00:00:00Z");
}

#[cfg(unix)]
#[test]
fn unix_mode_0600() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("session.json");
    std::fs::write(&p, b"{}").unwrap();
    std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o644)).unwrap();
    store(dir.path())
        .save(&stored(1, t0(), t0() + Duration::days(30)))
        .unwrap();
    let mode = std::fs::metadata(&p).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o600);
}

#[test]
fn missing_is_missing() {
    let dir = tempfile::tempdir().unwrap();
    assert!(matches!(store(dir.path()).load(), LoadOutcome::Missing));
}

#[test]
fn other_origin_is_ignored_not_deleted() {
    let dir = tempfile::tempdir().unwrap();
    let other = SessionStore::new(
        dir.path().to_path_buf(),
        &WorkerBase::parse("https://other.example.invalid").unwrap(),
    );
    other
        .save(&stored(1, t0(), t0() + Duration::days(30)))
        .unwrap();
    assert!(matches!(store(dir.path()).load(), LoadOutcome::OtherOrigin));
    assert!(dir.path().join("session.json").exists());
}

#[test]
fn origin_normalized_by_base() {
    let dir = tempfile::tempdir().unwrap();
    let s = SessionStore::new(
        dir.path().to_path_buf(),
        &WorkerBase::parse("https://WORKER.example.invalid:443/").unwrap(),
    );
    s.save(&stored(1, t0(), t0() + Duration::days(30))).unwrap();
    assert!(matches!(store(dir.path()).load(), LoadOutcome::Loaded(_)));
}

#[test]
fn corrupt_cases_table() {
    let dir = tempfile::tempdir().unwrap();
    let good = good_json(dir.path());
    let path = dir.path().join("session.json");
    let set = |k: &str, v: serde_json::Value| {
        let mut g = good.clone();
        g[k] = v;
        serde_json::to_vec(&g).unwrap()
    };
    let remove = |k: &str| {
        let mut g = good.clone();
        g.as_object_mut().unwrap().remove(k);
        serde_json::to_vec(&g).unwrap()
    };
    let cases: Vec<(&str, Vec<u8>)> = vec![
        ("broken_json", b"{".to_vec()),
        ("array", b"[]".to_vec()),
        ("v2", set("v", 2.into())),
        ("no_v", remove("v")),
        (
            "access_is_refresh",
            set("accessToken", tok("cdr_", "x").into()),
        ),
        (
            "refresh_is_access",
            set("refreshToken", tok("cda_", "x").into()),
        ),
        (
            "channel_upper",
            set("channelId", CH.replace('a', "A").into()),
        ),
        ("channel_31", set("channelId", CH[1..].into())),
        ("bad_time", set("accessExpiresAt", "어제".into())),
        ("no_verified", remove("verifiedAt")),
        ("is_admin_str", set("isAdmin", "no".into())),
        ("name_129", set("channelName", "a".repeat(129).into())),
        // verifiedAt + 72h가 time 범위(9999년)를 넘는다: 시작 판정이 panic하지 않게 깨진 파일로 본다
        ("far_future_verified", {
            let mut g = good.clone();
            g["verifiedAt"] = "9999-12-31T00:00:00Z".into();
            g["refreshExpiresAt"] = "9999-12-31T00:00:00Z".into();
            serde_json::to_vec(&g).unwrap()
        }),
    ];
    for (name, bytes) in cases {
        std::fs::write(&path, &bytes).unwrap();
        assert!(
            matches!(store(dir.path()).load(), LoadOutcome::Corrupt),
            "{name}"
        );
        assert!(path.exists(), "{name}: 파일을 지우면 안 된다");
    }
}

#[test]
fn unknown_field_ignored() {
    let dir = tempfile::tempdir().unwrap();
    let mut g = good_json(dir.path());
    g["extra"] = 1.into();
    std::fs::write(
        dir.path().join("session.json"),
        serde_json::to_vec(&g).unwrap(),
    )
    .unwrap();
    assert!(matches!(store(dir.path()).load(), LoadOutcome::Loaded(_)));
}

#[test]
fn v2_with_other_origin_is_corrupt() {
    let dir = tempfile::tempdir().unwrap();
    let mut g = good_json(dir.path());
    g["v"] = 2.into();
    g["origin"] = "https://other.example.invalid".into();
    std::fs::write(
        dir.path().join("session.json"),
        serde_json::to_vec(&g).unwrap(),
    )
    .unwrap();
    assert!(matches!(store(dir.path()).load(), LoadOutcome::Corrupt));
}

#[test]
fn clear_removes_and_is_idempotent() {
    let dir = tempfile::tempdir().unwrap();
    let s = store(dir.path());
    s.save(&stored(1, t0(), t0() + Duration::days(30))).unwrap();
    s.clear().unwrap();
    assert!(!dir.path().join("session.json").exists());
    s.clear().unwrap();
}

#[cfg(unix)]
#[test]
fn save_failure_keeps_old_file() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let s = store(dir.path());
    s.save(&stored(1, t0(), t0() + Duration::days(30))).unwrap();
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o500)).unwrap();
    let probe = dir.path().join("probe");
    let writable = std::fs::write(&probe, b"x").is_ok();
    if writable {
        eprintln!("읽기 전용 폴더에도 쓸 수 있어(root) 건너뜀");
        let _ = std::fs::remove_file(&probe);
    } else {
        let e = s
            .save(&stored(2, t0(), t0() + Duration::days(30)))
            .unwrap_err();
        assert_eq!(e.op, "write");
    }
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    let s1 = loaded(s.load());
    assert_eq!(
        s1.access_token.expose(),
        &tok("cda_", if writable { "acc2" } else { "acc1" })
    );
}

#[test]
fn save_into_file_path_fails() {
    let dir = tempfile::tempdir().unwrap();
    break_dir(dir.path());
    let e = store(dir.path())
        .save(&stored(1, t0(), t0() + Duration::days(30)))
        .unwrap_err();
    assert_eq!(e.op, "create_dir");
    fix_dir(dir.path());
}

#[test]
fn no_temp_left_after_save() {
    let dir = tempfile::tempdir().unwrap();
    let s = store(dir.path());
    s.save(&stored(1, t0(), t0() + Duration::days(30))).unwrap();
    s.save(&stored(2, t0(), t0() + Duration::days(30))).unwrap();
    let names: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    assert_eq!(names, vec!["session.json".to_string()]);
}

#[test]
fn debug_hides_tokens() {
    let dir = tempfile::tempdir().unwrap();
    let st = stored(1, t0(), t0() + Duration::days(30));
    let s = store(dir.path());
    s.save(&st).unwrap();
    let outs = [
        format!("{st:?}"),
        format!("{s:?}"),
        format!("{:?}", LoadOutcome::Loaded(st.clone())),
    ];
    for o in &outs[..1] {
        assert!(o.contains("***"));
    }
    assert!(outs[2].contains("***"));
    for o in &outs {
        assert!(!o.contains("acc1") && !o.contains("ref1"), "{o}");
    }
}

#[test]
fn directory_in_place_of_file_is_unreadable() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("session.json")).unwrap();
    assert!(matches!(store(dir.path()).load(), LoadOutcome::Unreadable));
}

#[test]
fn store_error_display_has_op_and_kind_only() {
    let dir = tempfile::tempdir().unwrap();
    break_dir(dir.path());
    let e = store(dir.path())
        .save(&stored(1, t0(), t0() + Duration::days(30)))
        .unwrap_err();
    let t = e.to_string();
    assert!(t.starts_with("session.json create_dir 실패("), "{t}");
    assert!(!t.contains(dir.path().to_str().unwrap()));
}
