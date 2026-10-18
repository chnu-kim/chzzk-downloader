//! 명령줄 모드(cli-mode.md §4·§8·§9·§14.1): 게이트가 GUI와 같다, 종료 코드, 이어받기, 갱신 횟수, 출력 분리.

mod common;

use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chzzk_shell::cli::exit;
use chzzk_shell::dto::{JobStatus, SettingsPatch};
use common::cli_env::*;
use tempfile::TempDir;
use wiremock::MockServer;

fn out_dir(t: &TempDir) -> String {
    t.path().join("out").to_string_lossy().into_owned()
}

fn ls(dir: &std::path::Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .map(|r| {
            r.flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    v.sort();
    v
}

async fn until(what: &str, mut f: impl FnMut() -> bool) {
    for _ in 0..600 {
        if f() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("기다린 조건이 되지 않음: {what}");
}

// ---------------------------------------------------------------- 게이트(§4.3)

/// T-G1: 로그인 채널 A, 남의 채널의 영상 → notOwnContent(코드 4), 작업·`.part` 없음
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn t_g1_other_channels_video_is_rejected() {
    let api = mock_api(None, false).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session(t.path(), &worker, OTHER);
    let app = open_cli(t.path(), &api, Some(&worker));
    let out = out_dir(&t);
    let r = run(&app, &["download", &url(), "--out", &out], t.path()).await;
    assert_eq!(r.code, exit::REJECTED, "{r:?}");
    assert!(r.err.contains("내 채널의 영상만 받을 수 있어요"), "{r:?}");
    assert!(r.out.is_empty(), "{r:?}");
    assert!(app.manager.list().is_empty());
    assert!(job_statuses(t.path()).is_empty());
    assert!(ls(std::path::Path::new(&out)).is_empty());
}

/// T-G2: 로그인 없음 → notLoggedIn(코드 3), 치지직 API 요청 0회
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn t_g2_signed_out_makes_no_request() {
    let api = mock_api(None, false).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let app = open_cli(t.path(), &api, Some(&worker));
    for args in [
        vec!["download", "https://chzzk.naver.com/video/9000002"],
        vec!["info", "https://chzzk.naver.com/video/9000002"],
    ] {
        let r = run(&app, &args, t.path()).await;
        assert_eq!(r.code, exit::LOGIN, "{r:?}");
        assert!(r.err.contains("`login`으로 로그인한 뒤"), "{r:?}");
    }
    assert_eq!(total(&api).await, 0, "치지직 API를 불렀다");
    assert_eq!(
        total(&worker).await,
        0,
        "세션이 없으면 Worker도 부르지 않는다"
    );
    assert!(job_statuses(t.path()).is_empty());
}

/// T-G3: 맡은 채널의 영상 → 받음, 기록의 channelId는 영상의 채널
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn t_g3_delegated_channel_is_downloaded() {
    let api = mock_api(None, false).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session_at(
        t.path(),
        &worker,
        EDITOR,
        false,
        &[OWN],
        time::Duration::hours(1),
    );
    mock_me(&worker, EDITOR, &[OWN]).await;
    let app = open_cli(t.path(), &api, Some(&worker));
    let out = out_dir(&t);
    let r = run(&app, &["download", &url(), "--out", &out], t.path()).await;
    assert_eq!(r.code, exit::OK, "{r:?}");
    let j = jobs_json(t.path());
    assert_eq!(j["jobs"][0]["channelId"], OWN);
    assert_eq!(j["jobs"][0]["status"], "completed");
}

/// T-G4: 관리자는 남의 영상도 받는다(이 실행에서 서버가 관리자임을 확인한 뒤)
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn t_g4_admin_receives_other_channels_video() {
    let api = mock_api(None, false).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    // 유예(72시간)를 넘긴 세션: 열 때 서버로 확인한다. 디스크의 isAdmin은 그 응답으로 권한이 된다
    save_session_at(
        t.path(),
        &worker,
        OTHER,
        true,
        &[],
        time::Duration::hours(100),
    );
    mock_refresh(&worker, OTHER, true).await;
    let app = open_cli(t.path(), &api, Some(&worker));
    let out = out_dir(&t);
    let r = run(&app, &["download", &url(), "--out", &out], t.path()).await;
    assert_eq!(r.code, exit::OK, "{r:?}");
    assert_eq!(jobs_json(t.path())["jobs"][0]["channelId"], OWN);
    assert_eq!(count(&worker, "/auth/refresh").await, 1);
}

/// T-G6: 컨텐츠 채널을 알 수 없으면 거부(fail closed, 코드 4)
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn t_g6_channelless_content_is_rejected() {
    let api = mock_api(None, true).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session(t.path(), &worker, OWN);
    let app = open_cli(t.path(), &api, Some(&worker));
    let out = out_dir(&t);
    let r = run(&app, &["download", &url(), "--out", &out], t.path()).await;
    assert_eq!(r.code, exit::REJECTED, "{r:?}");
    assert!(r.err.contains("확인하지 못했습니다"), "{r:?}");
    assert!(job_statuses(t.path()).is_empty());
    assert!(ls(std::path::Path::new(&out)).is_empty());
}

/// 로그인을 쓰지 않는 빌드는 GUI와 같이 게이트가 꺼져 있다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn disabled_auth_build_passes_the_gate_like_the_gui() {
    let api = mock_api(None, false).await;
    let t = TempDir::new().unwrap();
    let app = open_cli(t.path(), &api, None);
    let out = out_dir(&t);
    let r = run(&app, &["download", &url(), "--out", &out], t.path()).await;
    assert_eq!(r.code, exit::OK, "{r:?}");
}

// ---------------------------------------------------------------- 받기

/// 성공: stdout은 경로 한 줄, 진행·안내는 stderr, `cli::run`이 돌아온 직후 디스크에 `completed`가 있다(flush)
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn download_prints_path_on_stdout_and_flushes_jobs() {
    let api = mock_api(None, false).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session(t.path(), &worker, OWN);
    let app = open_cli(t.path(), &api, Some(&worker));
    let out = out_dir(&t);
    let r = run(&app, &["download", &url(), "--out", &out], t.path()).await;
    assert_eq!(r.code, exit::OK, "{r:?}");
    let path = r.out.trim_end_matches('\n');
    assert_eq!(r.out.matches('\n').count(), 1, "{r:?}");
    assert!(std::path::Path::new(path).is_absolute(), "{path}");
    assert_eq!(std::fs::metadata(path).unwrap().len(), MEDIA_LEN as u64);
    assert!(r.err.contains("완료"), "{r:?}");
    assert!(!r.err.contains(path) || r.err.contains("완료"), "{r:?}");
    // 쓰기 스레드의 마지막 제출이 디스크에 있다
    assert_eq!(job_statuses(t.path()), vec!["completed"]);
    // 로그인 주소·토큰류는 어디에도 없다
    assert!(!r.out.contains("cda_") && !r.err.contains("cda_"));
}

/// 상대 `--out`은 현재 폴더 기준이다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn relative_out_is_resolved_against_cwd() {
    let api = mock_api(None, false).await;
    let t = TempDir::new().unwrap();
    let app = open_cli(t.path(), &api, None);
    let r = run(&app, &["download", &url(), "--out", "sub/dir"], t.path()).await;
    assert_eq!(r.code, exit::OK, "{r:?}");
    let want = t.path().join("sub/dir");
    assert!(
        r.out
            .trim()
            .starts_with(&want.to_string_lossy().into_owned()),
        "{r:?}"
    );
    assert_eq!(ls(&want).len(), 1);
}

/// 이미 있는 파일은 건너뛴다(코드 0, `skipped`), `--overwrite`는 덮어쓴다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn existing_file_is_skipped_or_overwritten() {
    let api = mock_api(None, false).await;
    let t = TempDir::new().unwrap();
    let app = open_cli(t.path(), &api, None);
    let out = out_dir(&t);
    let first = run(&app, &["download", &url(), "--out", &out], t.path()).await;
    assert_eq!(first.code, exit::OK, "{first:?}");
    let file = first.out.trim().to_string();
    std::fs::write(&file, b"marker").unwrap();

    let second = run(&app, &["download", &url(), "--out", &out], t.path()).await;
    assert_eq!(second.code, exit::OK, "{second:?}");
    assert!(second.err.contains("이미 있어요"), "{second:?}");
    assert_eq!(second.out.trim(), file);
    assert_eq!(std::fs::read(&file).unwrap(), b"marker");
    assert!(job_statuses(t.path()).contains(&"skipped".to_string()));

    let third = run(
        &app,
        &["download", &url(), "--out", &out, "--overwrite"],
        t.path(),
    )
    .await;
    assert_eq!(third.code, exit::OK, "{third:?}");
    assert_eq!(std::fs::metadata(&file).unwrap().len(), MEDIA_LEN as u64);
}

/// 주소가 여럿: 둘째가 실패해도 셋째를 받고, 코드는 가장 나쁜 것
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn several_urls_continue_after_a_failure() {
    let api = mock_api(None, false).await;
    let t = TempDir::new().unwrap();
    let app = open_cli(t.path(), &api, None);
    let out = out_dir(&t);
    let bad = "https://chzzk.naver.com/video/9999999";
    let r = run(
        &app,
        &["download", &url(), bad, &url(), "--out", &out],
        t.path(),
    )
    .await;
    assert_eq!(r.code, exit::FAILED, "{r:?}");
    // 첫째(받음)와 셋째(이미 있음)의 경로가 stdout에 나온다
    assert_eq!(r.out.lines().count(), 2, "{r:?}");
    assert!(r.err.contains("이미 있어요"), "{r:?}");
}

/// 화질: 라벨(대소문자 무시) 또는 없는 화질은 사용법 오류(코드 2)와 가능한 라벨
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn quality_flag() {
    let api = mock_api(None, false).await;
    let t = TempDir::new().unwrap();
    let app = open_cli(t.path(), &api, None);
    let out = out_dir(&t);
    let r = run(
        &app,
        &["download", &url(), "--out", &out, "--quality", "999p"],
        t.path(),
    )
    .await;
    assert_eq!(r.code, exit::USAGE, "{r:?}");
    assert!(r.err.contains("720p"), "{r:?}");
    assert!(job_statuses(t.path()).is_empty());
    let r = run(
        &app,
        &["download", &url(), "--out", &out, "--quality", "720P"],
        t.path(),
    )
    .await;
    assert_eq!(r.code, exit::OK, "{r:?}");
}

/// 구간은 빠른 다시보기만: 일반 VOD에 주면 사용법 오류(코드 2)
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn range_on_a_non_rewind_video_is_a_usage_error() {
    let api = mock_api(None, false).await;
    let t = TempDir::new().unwrap();
    let app = open_cli(t.path(), &api, None);
    let out = out_dir(&t);
    let r = run(
        &app,
        &["download", &url(), "--out", &out, "--range", "0:10-0:20"],
        t.path(),
    )
    .await;
    assert_eq!(r.code, exit::USAGE, "{r:?}");
    assert!(job_statuses(t.path()).is_empty());
}

/// `--rate`는 이 프로세스의 매니저에만 걸리고 설정 파일에는 쓰이지 않는다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rate_applies_to_the_manager_only() {
    let api = mock_api(None, false).await;
    let t = TempDir::new().unwrap();
    let app = open_cli(t.path(), &api, None);
    let out = out_dir(&t);
    let before = std::fs::read(t.path().join("config/settings.json")).ok();
    let r = run(
        &app,
        &["download", &url(), "--out", &out, "--rate", "50m"],
        t.path(),
    )
    .await;
    assert_eq!(r.code, exit::OK, "{r:?}");
    assert_eq!(app.manager.rate_limits(), (None, Some(50_000_000)));
    assert_eq!(app.settings.settings().job_rate_limit, None);
    let after = std::fs::read_to_string(t.path().join("config/settings.json")).unwrap();
    assert!(!after.contains("jobRateLimit\": 5"), "{after}");
    let _ = before;
}

/// `--audio`: 오디오만 행으로 `.m4a`를 받는다. 마지막 화질은 오디오로 바뀌지 않고, `--quality`는 오디오 행을 고르지 못한다.
/// 오디오 트랙이 없는 영상은 사용법 오류(코드 2)
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn audio_flag_downloads_m4a_and_keeps_last_quality() {
    let api = mock_api_with(None, false, true).await;
    let t = TempDir::new().unwrap();
    let app = open_cli(t.path(), &api, None);
    let out = out_dir(&t);
    // 화질 하나를 받아 마지막 화질을 정해 둔다
    let r = run(
        &app,
        &["download", &url(), "--out", &out, "--quality", "720p"],
        t.path(),
    )
    .await;
    assert_eq!(r.code, exit::OK, "{r:?}");
    assert_eq!(
        app.settings.settings().last_quality_label.as_deref(),
        Some("720p")
    );

    let r = run(
        &app,
        &["download", &url(), "--out", &out, "--audio"],
        t.path(),
    )
    .await;
    assert_eq!(r.code, exit::OK, "{r:?}");
    let path = r.out.trim().to_string();
    assert!(path.ends_with(".m4a"), "{path}");
    assert_eq!(std::fs::metadata(&path).unwrap().len(), AUDIO_LEN as u64);
    // 오디오는 마지막 화질로 기억하지 않는다(다음 영상이 오디오로 시작하지 않는다)
    assert_eq!(
        app.settings.settings().last_quality_label.as_deref(),
        Some("720p")
    );
    let j = jobs_json(t.path());
    let audio_job = j["jobs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["qualityId"] == "audio")
        .unwrap();
    assert_eq!(audio_job["status"], "completed");

    // 같은 명령을 다시: 이미 있음(건너뜀)
    let r = run(
        &app,
        &["download", &url(), "--out", &out, "--audio"],
        t.path(),
    )
    .await;
    assert_eq!(r.code, exit::OK, "{r:?}");
    assert!(r.err.contains("이미 있어요"), "{r:?}");

    // `--quality`로는 오디오 행을 고르지 못한다
    let r = run(
        &app,
        &["download", &url(), "--out", &out, "--quality", "audio"],
        t.path(),
    )
    .await;
    assert_eq!(r.code, exit::USAGE, "{r:?}");
    assert!(
        r.err.trim_end().ends_with("고를 수 있는 화질: 720p"),
        "{r:?}"
    );

    // info는 오디오 행을 GUI와 같은 말로 보인다
    let r = run(&app, &["info", &url()], t.path()).await;
    assert!(r.out.contains("720p (기본), 오디오만"), "{r:?}");

    // 오디오 트랙이 없는 영상
    let api2 = mock_api(None, false).await;
    let t2 = TempDir::new().unwrap();
    let app2 = open_cli(t2.path(), &api2, None);
    let r = run(
        &app2,
        &["download", &url(), "--out", &out_dir(&t2), "--audio"],
        t2.path(),
    )
    .await;
    assert_eq!(r.code, exit::USAGE, "{r:?}");
    assert!(r.err.contains("오디오만 받을 수 없어요"), "{r:?}");
    assert!(job_statuses(t2.path()).is_empty());
}

/// 오디오만도 같은 게이트를 지난다: 남의 영상의 오디오는 거부(코드 4)
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn audio_is_gated_like_video() {
    let api = mock_api_with(None, false, true).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session(t.path(), &worker, OTHER);
    let app = open_cli(t.path(), &api, Some(&worker));
    let out = out_dir(&t);
    let r = run(
        &app,
        &["download", &url(), "--out", &out, "--audio"],
        t.path(),
    )
    .await;
    assert_eq!(r.code, exit::REJECTED, "{r:?}");
    assert!(job_statuses(t.path()).is_empty());
    assert!(ls(std::path::Path::new(&out)).is_empty());
}

// ---------------------------------------------------------------- Ctrl+C·이어받기(§9.2)

/// 첫 Ctrl+C는 일시정지: 코드 130, `paused`가 디스크에 있고 `.part`가 남는다. 같은 명령을 다시 실행하면
/// 멈춘 작업(같은 출력)을 이어받아 끝낸다(`duplicateOutput`으로 막히지 않는다).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ctrl_c_pauses_keeps_part_and_next_run_resumes() {
    let raw = RawMedia::start(20_000).await;
    let api = mock_api(Some(&raw.base()), false).await;
    let t = TempDir::new().unwrap();
    let app = open_cli(t.path(), &api, None);
    let out = out_dir(&t);
    let (tx, mut rx) = ctrl();
    let args = ["download", &url(), "--out", &out];
    let first = {
        let app = &app;
        let t = &t;
        let fut = run_with(app, &args, t.path(), &mut rx, None, None);
        let press = async {
            until("받기 시작", || {
                app.manager
                    .list()
                    .iter()
                    .any(|j| j.status == JobStatus::Running)
            })
            .await;
            // 본문 일부가 `.part`에 닿을 시간을 준다
            tokio::time::sleep(Duration::from_millis(300)).await;
            tx.send(()).unwrap();
        };
        let (r, ()) = tokio::join!(fut, press);
        r
    };
    assert_eq!(first.code, exit::INTERRUPTED, "{first:?}");
    assert!(first.err.contains("멈췄어요"), "{first:?}");
    assert!(first.out.is_empty(), "{first:?}");
    assert_eq!(job_statuses(t.path()), vec!["paused"]);
    let parts: Vec<String> = ls(std::path::Path::new(&out))
        .into_iter()
        .filter(|n| n.ends_with(".part"))
        .collect();
    assert_eq!(parts.len(), 1, "{:?}", ls(std::path::Path::new(&out)));

    // 같은 명령을 다시 실행: 이어받아 끝낸다
    let (_tx2, mut rx2) = ctrl();
    let second = run_with(&app, &args, t.path(), &mut rx2, None, None).await;
    assert_eq!(second.code, exit::OK, "{second:?}");
    assert_eq!(
        std::fs::metadata(second.out.trim()).unwrap().len(),
        MEDIA_LEN as u64
    );
    // 이어받기였다면 둘째 연결은 Range로 시작한다(처음 20KB가 `.part`에 남았을 때)
    let ranges = raw.ranges.lock().unwrap().clone();
    assert_eq!(ranges.len(), 2, "{ranges:?}");
    assert!(ranges[1].is_some_and(|s| s > 0), "{ranges:?}");
    // 옛 기록 하나가 이어받혀 완료됐다(새 기록을 만들지 않았다)
    assert_eq!(job_statuses(t.path()), vec!["completed"]);
}

/// 두 번째 Ctrl+C는 바로 끝낸다: 코드 130, 디스크에 멈춘 상태로 저장된다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn second_ctrl_c_quits_immediately() {
    let raw = RawMedia::start(10_000).await;
    let api = mock_api(Some(&raw.base()), false).await;
    let t = TempDir::new().unwrap();
    let app = open_cli(t.path(), &api, None);
    let out = out_dir(&t);
    let (tx, mut rx) = ctrl();
    let args = ["download", &url(), "--out", &out];
    let fut = run_with(&app, &args, t.path(), &mut rx, None, None);
    let press = async {
        until("받기 시작", || {
            app.manager
                .list()
                .iter()
                .any(|j| j.status == JobStatus::Running)
        })
        .await;
        tx.send(()).unwrap();
        tx.send(()).unwrap();
    };
    let (r, ()) = tokio::join!(fut, press);
    assert_eq!(r.code, exit::INTERRUPTED, "{r:?}");
    let st = job_statuses(t.path());
    assert!(st == vec!["paused"] || st == vec!["interrupted"], "{st:?}");
}

/// 첫 연결에서 멈추는 서버로 `args`를 돌리다가 받기 시작하면 Ctrl+C를 한 번 눌러 `paused`를 만든다.
async fn pause_first_run(app: &chzzk_shell::App, args: &[&str], cwd: &std::path::Path) -> Ran {
    let (tx, mut rx) = ctrl();
    let fut = run_with(app, args, cwd, &mut rx, None, None);
    let press = async {
        until("받기 시작", || {
            app.manager
                .list()
                .iter()
                .any(|j| j.status == JobStatus::Running)
        })
        .await;
        // 본문 일부가 `.part`에 닿을 시간을 준다
        tokio::time::sleep(Duration::from_millis(300)).await;
        tx.send(()).unwrap();
    };
    let (r, ()) = tokio::join!(fut, press);
    r
}

/// 같은 출력의 멈춘 작업이 있어도 요청(화질)이 다르면 이어받지 않는다: 코드 1과 안내, 옛 작업은 `paused` 그대로,
/// 새 연결 없음. `same_request`가 빠지면 `--quality 480p`가 720p로 멈춘 작업을 조용히 이어받아 고르지 않은 화질을 받는다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn paused_job_of_another_quality_is_not_resumed() {
    let raw = RawMedia::start(20_000).await;
    let api = mock_api_full(Some(&raw.base()), false, false, true).await;
    let t = TempDir::new().unwrap();
    let app = open_cli(t.path(), &api, None);
    let out = out_dir(&t);
    let first = pause_first_run(
        &app,
        &["download", &url(), "--out", &out, "--quality", "720p"],
        t.path(),
    )
    .await;
    assert_eq!(first.code, exit::INTERRUPTED, "{first:?}");
    assert_eq!(job_statuses(t.path()), vec!["paused"]);
    assert_eq!(raw.accepted.load(Ordering::SeqCst), 1);

    let second = run(
        &app,
        &["download", &url(), "--out", &out, "--quality", "480p"],
        t.path(),
    )
    .await;
    assert_eq!(second.code, exit::FAILED, "{second:?}");
    assert!(
        second.err.contains("같은 파일의 다른 작업이 목록에 있어요"),
        "{second:?}"
    );
    assert!(second.out.is_empty(), "{second:?}");
    assert_eq!(job_statuses(t.path()), vec!["paused"]);
    assert_eq!(raw.accepted.load(Ordering::SeqCst), 1, "새 연결을 열었다");
    let jobs = app.manager.list();
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].quality_label, "720p");
}

/// 주소가 여럿일 때 첫 주소에서 Ctrl+C를 누르면 남은 주소는 시작하지 않는다: 코드 130, 둘째 주소에 대한 API 요청 0회,
/// 기록은 `paused` 하나
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ctrl_c_stops_the_remaining_urls() {
    let raw = RawMedia::start(20_000).await;
    let api = mock_api(Some(&raw.base()), false).await;
    let t = TempDir::new().unwrap();
    let app = open_cli(t.path(), &api, None);
    let out = out_dir(&t);
    let second = "https://chzzk.naver.com/video/9999999";
    let r = pause_first_run(&app, &["download", &url(), second, "--out", &out], t.path()).await;
    assert_eq!(r.code, exit::INTERRUPTED, "{r:?}");
    assert_eq!(job_statuses(t.path()), vec!["paused"]);
    assert_eq!(count(&api, "/service/v2/videos/9999999").await, 0);
    assert_eq!(raw.accepted.load(Ordering::SeqCst), 1);
}

/// 로그인이 없으면(코드 3) 남은 주소도 시도하지 않는다: 안내는 한 번, API 요청 0회
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn signed_out_stops_the_remaining_urls() {
    let api = mock_api(None, false).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let app = open_cli(t.path(), &api, Some(&worker));
    let r = run(
        &app,
        &[
            "download",
            &url(),
            "https://chzzk.naver.com/video/9999999",
            "--out",
            &out_dir(&t),
        ],
        t.path(),
    )
    .await;
    assert_eq!(r.code, exit::LOGIN, "{r:?}");
    assert_eq!(r.err.matches("`login`으로 로그인한 뒤").count(), 1, "{r:?}");
    assert_eq!(total(&api).await, 0);
}

/// 멈춘 작업을 이어받을 때도 로그인한 채널로 다시 판정한다(기록의 channelId를 믿지 않는다): 멈춘 뒤 세션이 남의 채널로
/// 바뀌었으면 같은 명령은 코드 4이고 새 연결도 없다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resuming_a_paused_job_is_judged_again() {
    let raw = RawMedia::start(20_000).await;
    let api = mock_api(Some(&raw.base()), false).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session(t.path(), &worker, OWN);
    let out = out_dir(&t);
    let args = ["download", &url(), "--out", &out];
    {
        let app = open_cli(t.path(), &api, Some(&worker));
        let first = pause_first_run(&app, &args, t.path()).await;
        assert_eq!(first.code, exit::INTERRUPTED, "{first:?}");
    }
    assert_eq!(job_statuses(t.path()), vec!["paused"]);
    assert_eq!(raw.accepted.load(Ordering::SeqCst), 1);

    // 세션이 남의 채널로 바뀐 뒤 같은 명령
    save_session(t.path(), &worker, OTHER);
    let app = open_cli(t.path(), &api, Some(&worker));
    let r = run(&app, &args, t.path()).await;
    assert_eq!(r.code, exit::REJECTED, "{r:?}");
    assert!(r.err.contains("내 채널의 영상만 받을 수 있어요"), "{r:?}");
    assert!(r.out.is_empty(), "{r:?}");
    assert_eq!(job_statuses(t.path()), vec!["paused"]);
    assert_eq!(raw.accepted.load(Ordering::SeqCst), 1, "새 연결을 열었다");
}

/// 60초 늦게 답하는 서버(응답이 오지 않는 네트워크)
async fn hanging_server() -> MockServer {
    let s = MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::any())
        .respond_with(wiremock::ResponseTemplate::new(200).set_delay(Duration::from_secs(60)))
        .mount(&s)
        .await;
    s
}

/// 받기를 시작하기 전의 기다림(조회·판정)에서도 Ctrl+C가 먹는다: 코드 130으로 곧 끝나고 작업·`.part`가 없다.
/// 신호 핸들러를 달면 기본 동작(종료)이 없어지므로 이 경로를 막으면 명령이 눌러도 멈추지 않는다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ctrl_c_works_before_a_job_starts() {
    // download·info: 치지직 API가 응답하지 않는다
    for args in [vec!["download", "URL", "--out", "OUT"], vec!["info", "URL"]] {
        let api = hanging_server().await;
        let worker = MockServer::start().await;
        let t = TempDir::new().unwrap();
        save_session(t.path(), &worker, OWN);
        let app = open_cli(t.path(), &api, Some(&worker));
        let out = out_dir(&t);
        let u = url();
        let argv: Vec<&str> = args
            .iter()
            .map(|a| match *a {
                "URL" => u.as_str(),
                "OUT" => out.as_str(),
                other => other,
            })
            .collect();
        let (tx, mut rx) = ctrl();
        let started = std::time::Instant::now();
        let fut = run_with(&app, &argv, t.path(), &mut rx, None, None);
        let press = async {
            tokio::time::sleep(Duration::from_millis(300)).await;
            tx.send(()).unwrap();
        };
        let (r, ()) = tokio::join!(fut, press);
        assert_eq!(r.code, exit::INTERRUPTED, "{args:?} {r:?}");
        assert!(r.err.contains("그만뒀어요"), "{r:?}");
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "{args:?} 멈추지 않았다"
        );
        assert!(job_statuses(t.path()).is_empty());
        assert!(ls(std::path::Path::new(&out)).is_empty());
    }
    // 갱신(토큰 회전) 도중의 Ctrl+C는 버리지 않고 결과를 저장한 뒤 멈춘다: `cli_auth.rs`
    // `ctrl_c_during_refresh_saves_the_rotated_session`
}

// ---------------------------------------------------------------- 갱신·자동 이어받기·전원(§5.2·§9.2)

/// 유예 안 `SignedIn`이면 Worker 요청 0회(`retry`), 유예 밖(`Checking`)이면 refresh 1회. `startup`이면 앞의 단정이 깨진다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn refresh_count_follows_retry_rules() {
    let api = mock_api(None, false).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session(t.path(), &worker, OWN);
    let app = open_cli(t.path(), &api, Some(&worker));
    for _ in 0..3 {
        let r = run(&app, &["status"], t.path()).await;
        assert_eq!(r.code, exit::OK, "{r:?}");
    }
    assert_eq!(total(&worker).await, 0);

    let worker2 = MockServer::start().await;
    let t2 = TempDir::new().unwrap();
    save_session_at(
        t2.path(),
        &worker2,
        OWN,
        false,
        &[],
        time::Duration::hours(100),
    );
    mock_refresh(&worker2, OWN, false).await;
    let app2 = open_cli(t2.path(), &api, Some(&worker2));
    let r = run(&app2, &["status"], t2.path()).await;
    assert_eq!(r.code, exit::OK, "{r:?}");
    assert_eq!(count(&worker2, "/auth/refresh").await, 1);
}

/// 자동 이어받기는 로그인 여부와 무관하게 끈다: 다른 `interrupted` 작업은 그대로
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cli_never_auto_resumes_other_jobs() {
    for with_login in [false, true] {
        let hang = {
            let s = MockServer::start().await;
            wiremock::Mock::given(wiremock::matchers::any())
                .respond_with(
                    wiremock::ResponseTemplate::new(200).set_delay(Duration::from_secs(60)),
                )
                .mount(&s)
                .await;
            s
        };
        let worker = MockServer::start().await;
        let t = TempDir::new().unwrap();
        // 자동 이어받기를 켜 두고 멈춘 작업 하나를 만든다
        {
            let gui = open_gui_plain(t.path(), &hang);
            gui.update_settings(SettingsPatch {
                auto_resume_interrupted: Some(true),
                ..SettingsPatch::default()
            })
            .unwrap();
            let job = gui.enqueue(common::harness::request("영상")).await.unwrap();
            until("running", || {
                gui.manager
                    .list()
                    .iter()
                    .any(|j| j.id == job.id && j.status == JobStatus::Running)
            })
            .await;
            gui.manager.quit(Duration::from_secs(3)).await;
        }
        if with_login {
            save_session(t.path(), &worker, OWN);
        }
        let app = open_cli(t.path(), &hang, with_login.then_some(&worker));
        let r = run(&app, &["status"], t.path()).await;
        assert_eq!(r.code, exit::OK, "{r:?}");
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(
            app.manager.list()[0].status,
            JobStatus::Interrupted,
            "with_login={with_login}"
        );
    }
}

fn open_gui_plain(root: &std::path::Path, api: &MockServer) -> chzzk_shell::App {
    chzzk_shell::App::open_with(
        paths(root),
        config(api),
        None,
        tokio::runtime::Handle::current(),
    )
    .unwrap()
}

/// 받는 동안 잠자기 방지를 얻고 끝나면 놓는다. 설정 keepAwake가 꺼져 있으면 얻지 않는다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn sleep_guard_follows_the_job_and_the_setting() {
    for keep in [true, false] {
        let api = mock_api(None, false).await;
        let t = TempDir::new().unwrap();
        let app = open_cli(t.path(), &api, None);
        app.update_settings(SettingsPatch {
            keep_awake: Some(keep),
            ..SettingsPatch::default()
        })
        .unwrap();
        let out = out_dir(&t);
        let log = GuardLog::default();
        let (_tx, mut rx) = ctrl();
        let r = run_with(
            &app,
            &["download", &url(), "--out", &out],
            t.path(),
            &mut rx,
            None,
            Some(Box::new(log.clone())),
        )
        .await;
        assert_eq!(r.code, exit::OK, "{r:?}");
        let calls = log.0.lock().unwrap().clone();
        if keep {
            assert_eq!(
                calls.first().map(String::as_str),
                Some("acquire"),
                "{calls:?}"
            );
            assert_eq!(
                calls.last().map(String::as_str),
                Some("release"),
                "{calls:?}"
            );
        } else {
            assert!(calls.iter().all(|c| c != "acquire"), "{calls:?}");
        }
    }
}

// ---------------------------------------------------------------- info·status·help

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn info_prints_facts_without_channel_id_and_judges() {
    let api = mock_api(None, false).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session(t.path(), &worker, OWN);
    let app = open_cli(t.path(), &api, Some(&worker));
    let r = run(&app, &["info", &url()], t.path()).await;
    assert_eq!(r.code, exit::OK, "{r:?}");
    assert!(
        r.out.contains("제목: ") && r.out.contains("화질: 720p (기본)"),
        "{r:?}"
    );
    assert!(r.out.contains("받을 수 있어요"), "{r:?}");
    assert!(
        !r.out.contains(OWN) && !r.err.contains(OWN),
        "채널 ID를 출력했다"
    );
    assert!(job_statuses(t.path()).is_empty());

    let t2 = TempDir::new().unwrap();
    let worker2 = MockServer::start().await;
    save_session(t2.path(), &worker2, OTHER);
    let app2 = open_cli(t2.path(), &api, Some(&worker2));
    let r = run(&app2, &["info", &url()], t2.path()).await;
    assert_eq!(r.code, exit::REJECTED, "{r:?}");
    assert!(r.out.contains("받을 수 없어요"), "{r:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn status_reports_login_and_version() {
    let api = mock_api(None, false).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let app = open_cli(t.path(), &api, Some(&worker));
    let r = run(&app, &["status"], t.path()).await;
    assert_eq!(r.code, exit::LOGIN, "{r:?}");
    assert!(
        r.out.contains("버전: 0.0.0-test") && r.out.contains("로그인 필요"),
        "{r:?}"
    );

    save_session(t.path(), &worker, OWN);
    let app = open_cli(t.path(), &api, Some(&worker));
    let r = run(&app, &["status"], t.path()).await;
    assert_eq!(r.code, exit::OK, "{r:?}");
    assert!(r.out.contains("로그인됨 · 채널"), "{r:?}");

    let t2 = TempDir::new().unwrap();
    let app = open_cli(t2.path(), &api, None);
    let r = run(&app, &["status"], t2.path()).await;
    assert_eq!(r.code, exit::OK, "{r:?}");
    assert!(r.out.contains("로그인을 쓰지 않아요"), "{r:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn help_and_usage_errors_touch_nothing() {
    let api = mock_api(None, false).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let app = open_cli(t.path(), &api, Some(&worker));
    let r = run(&app, &["help"], t.path()).await;
    assert_eq!(r.code, exit::OK);
    assert!(r.out.contains("download") && r.out.contains("130"));
    let r = run(&app, &["download"], t.path()).await;
    assert_eq!(r.code, exit::USAGE);
    let r = run(&app, &["bogus"], t.path()).await;
    assert_eq!(r.code, exit::USAGE);
    assert_eq!(total(&api).await + total(&worker).await, 0);
}

#[allow(dead_code)]
fn _keep(_: Arc<Mutex<()>>) {}
