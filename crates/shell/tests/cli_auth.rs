//! 명령줄의 로그인 세션 다루기(cli-mode.md §5.2): 관리자 확인, 갱신 중 Ctrl+C, 긴 배치의 유예 만료.
//! GUI와 같은 `session.json`을 쓰므로 여기서 잘못하면 GUI 세션까지 잃는다.

mod common;

use std::time::{Duration, Instant};

use chzzk_shell::auth::{LoadOutcome, SessionStore, WorkerBase};
use chzzk_shell::cli::exit;
use common::cli_env::*;
use tempfile::TempDir;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn out_dir(t: &TempDir) -> String {
    t.path().join("out").to_string_lossy().into_owned()
}

/// 디스크의 refresh 토큰(없으면 None)
fn stored_refresh(root: &std::path::Path, worker: &MockServer) -> Option<String> {
    match SessionStore::new(
        root.join("config"),
        &WorkerBase::parse(&worker.uri()).unwrap(),
    )
    .load()
    {
        LoadOutcome::Loaded(s) => Some(s.refresh_token.expose().clone()),
        _ => None,
    }
}

/// `/auth/refresh` 200을 `delay` 뒤에 준다
async fn mock_refresh_delayed(worker: &MockServer, channel: &str, delay: Duration) {
    let now = OffsetDateTime::now_utc();
    Mock::given(method("POST"))
        .and(path("/auth/refresh"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw(
                    serde_json::json!({
                        "status": "ok",
                        "accessToken": format!("cda_{}", "C".repeat(43)),
                        "accessExpiresAt": (now + time::Duration::hours(24)).format(&Rfc3339).unwrap(),
                        "refreshToken": format!("cdr_{}", "D".repeat(43)),
                        "refreshExpiresAt": (now + time::Duration::days(30)).format(&Rfc3339).unwrap(),
                        "channelId": channel,
                        "channelName": "채널",
                        "isAdmin": false,
                        "serverTime": now.format(&Rfc3339).unwrap(),
                    })
                    .to_string(),
                    "application/json",
                )
                .set_delay(delay),
        )
        .mount(worker)
        .await;
}

// ---------------------------------------------------------------- 관리자(Codex P2-1)

/// GUI에서 방금 로그인한 관리자 세션(유예 안, 갱신 예정 전). 디스크의 isAdmin은 권한이 아니지만, 남의 영상을 판정할 때
/// 서버에 한 번 확인(refresh)해 관리자 예외를 적용한다. 같은 실행의 다음 판정은 다시 묻지 않는다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn recent_admin_session_is_confirmed_once_for_other_channels() {
    let api = mock_api(None, false).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session_at(
        t.path(),
        &worker,
        OTHER,
        true,
        &[],
        time::Duration::hours(1),
    );
    mock_refresh(&worker, OTHER, true).await;
    mock_me(&worker, OTHER, &[]).await;
    let app = open_cli(t.path(), &api, Some(&worker));
    let r = run(&app, &["info", &url()], t.path()).await;
    assert_eq!(r.code, exit::OK, "{r:?}");
    assert!(r.out.contains("받을 수 있어요"), "{r:?}");
    let out = out_dir(&t);
    let r = run(&app, &["download", &url(), "--out", &out], t.path()).await;
    assert_eq!(r.code, exit::OK, "{r:?}");
    assert_eq!(jobs_json(t.path())["jobs"][0]["channelId"], OWN);
    assert_eq!(count(&worker, "/auth/refresh").await, 1);
}

/// 관리자 세션이어도 내 영상이면 확인하지 않는다(회전 상한을 쓰지 않는다)
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn admin_session_own_video_does_not_refresh() {
    let api = mock_api(None, false).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session_at(t.path(), &worker, OWN, true, &[], time::Duration::hours(1));
    mock_refresh(&worker, OWN, true).await;
    let app = open_cli(t.path(), &api, Some(&worker));
    let out = out_dir(&t);
    let r = run(&app, &["download", &url(), "--out", &out], t.path()).await;
    assert_eq!(r.code, exit::OK, "{r:?}");
    assert_eq!(count(&worker, "/auth/refresh").await, 0);
}

/// 디스크의 isAdmin을 믿지 않는다: 서버가 관리자가 아니라고 하면 거부(코드 4)
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stored_admin_flag_is_not_trusted() {
    let api = mock_api(None, false).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session_at(
        t.path(),
        &worker,
        OTHER,
        true,
        &[],
        time::Duration::hours(1),
    );
    mock_refresh(&worker, OTHER, false).await;
    mock_me(&worker, OTHER, &[]).await;
    let app = open_cli(t.path(), &api, Some(&worker));
    let out = out_dir(&t);
    let r = run(&app, &["download", &url(), "--out", &out], t.path()).await;
    assert_eq!(r.code, exit::REJECTED, "{r:?}");
    assert_eq!(count(&worker, "/auth/refresh").await, 1);
    assert!(job_statuses(t.path()).is_empty());
}

// ---------------------------------------------------------------- 갱신 중 Ctrl+C(Codex P2-2)

/// 갱신 요청이 나간 뒤 Ctrl+C: 응답을 받아 새 토큰을 저장한 뒤 130으로 끝난다. 버리면 디스크에 옛 토큰이 남고,
/// 60초 복구 창 뒤 그 토큰을 보내면 서버가 재사용으로 보고 세션을 끊는다(GUI 세션도 함께)
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ctrl_c_during_refresh_saves_the_rotated_session() {
    for args in [vec!["status"], vec!["info", "URL"]] {
        let api = mock_api(None, false).await;
        let worker = MockServer::start().await;
        let t = TempDir::new().unwrap();
        // 유예를 넘긴 세션: 시작하자마자 갱신한다
        save_session_at(
            t.path(),
            &worker,
            OWN,
            false,
            &[],
            time::Duration::hours(100),
        );
        let delay = Duration::from_millis(1500);
        mock_refresh_delayed(&worker, OWN, delay).await;
        let app = open_cli(t.path(), &api, Some(&worker));
        let u = url();
        let argv: Vec<&str> = args
            .iter()
            .map(|a| if *a == "URL" { u.as_str() } else { a })
            .collect();
        let (tx, mut rx) = ctrl();
        let started = Instant::now();
        let fut = run_with(&app, &argv, t.path(), &mut rx, None, None);
        let press = async {
            tokio::time::sleep(Duration::from_millis(300)).await;
            tx.send(()).unwrap();
        };
        let (r, ()) = tokio::join!(fut, press);
        assert_eq!(r.code, exit::INTERRUPTED, "{args:?} {r:?}");
        assert!(started.elapsed() >= delay, "{args:?} 갱신을 버렸다");
        assert_eq!(
            stored_refresh(t.path(), &worker).as_deref(),
            Some(format!("cdr_{}", "D".repeat(43)).as_str()),
            "{args:?} 새 토큰을 저장하지 않았다"
        );
        // 갱신 뒤의 일(조회)은 하지 않는다
        assert_eq!(total(&api).await, 0, "{args:?}");
    }
}

// ---------------------------------------------------------------- 긴 배치(Codex P2-3)

/// 유예(72시간)가 배치 도중에 끝나면 다음 주소를 받지 않는다(코드 3). 주소마다 GUI driver와 같은 판정(`tick`)으로
/// 갱신 예정·유예 만료를 본다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn grace_running_out_mid_batch_stops_the_next_url() {
    let api = mock_api(None, false).await;
    // 첫 조회만 느리다(그동안 유예가 끝난다)
    let info = std::fs::read(format!(
        "{}/../../testdata/vod/video_info.json",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();
    Mock::given(method("GET"))
        .and(path(format!("/service/v2/videos/{VOD_NO}")))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw(info, "application/json")
                .set_delay(Duration::from_secs(4)),
        )
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&api)
        .await;
    let worker = MockServer::start().await;
    // Worker 형식 4xx: 응답 유실이 아니라 바로 오프라인(유예 안)으로 본다
    Mock::given(method("POST"))
        .and(path("/auth/refresh"))
        .respond_with(ResponseTemplate::new(429).set_body_raw(
            serde_json::json!({"code": "rate_limited"}).to_string(),
            "application/json",
        ))
        .mount(&worker)
        .await;
    let t = TempDir::new().unwrap();
    save_session_at(
        t.path(),
        &worker,
        OWN,
        false,
        &[],
        time::Duration::hours(72) - time::Duration::seconds(2),
    );
    let app = open_cli(t.path(), &api, Some(&worker));
    let out = out_dir(&t);
    let u = url();
    let r = run(&app, &["download", &u, &u, "--out", &out], t.path()).await;
    assert_eq!(r.code, exit::LOGIN, "{r:?}");
    assert!(r.err.contains("`login`으로 로그인한 뒤"), "{r:?}");
    assert_eq!(job_statuses(t.path()), vec!["completed".to_string()]);
}
