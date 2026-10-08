//! 업데이트 판단(worker.md §11.6, Phase 3b A4): 세션 판정·출처 대조·설치 순서·진행 솎기.
//!
//! 플러그인(`UpdateSource`)과 앱 쪽 일(`InstallHost`)은 가짜로 받는다. 둘이 한 호출 기록을 공유해 순서를 본다.

mod common;

use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use chzzk_core::Secret;
use chzzk_shell::auth::{AuthPhase, AuthService, AuthStatus, WorkerBase};
use chzzk_shell::dto::{UpdateCheckDto, UpdateInstallDto, UpdateProgressEvent};
use chzzk_shell::update::{
    DOWNLOAD_STALL, FoundUpdate, InstallHost, PROGRESS_STEP_UNKNOWN, ProgressThrottle, SourceError,
    UpdateSource, Updates, auto_check_due, bearer_value, update_endpoint,
};
use common::auth::*;
use time::Duration;
use tokio::sync::Notify;

type Log = Arc<Mutex<Vec<&'static str>>>;
type Svc = AuthService<FakeWorkerApi, FakeClock>;

fn found(url_origin: &str) -> FoundUpdate {
    FoundUpdate {
        version: "9.9.9".into(),
        current: "0.1.0".into(),
        notes: Some("메모".into()),
        pub_date: Some(1_900_000_000),
        download_url: format!("{url_origin}/releases/9.9.9/app.bin"),
    }
}

// ---- 가짜 원천 ----

#[derive(Default)]
struct SrcState {
    checks: VecDeque<Result<Option<FoundUpdate>, SourceError>>,
    download: Option<SourceError>,
    install: Option<SourceError>,
    install_panics: bool,
    chunks: Vec<(u64, Option<u64>)>,
    hold: Option<Arc<Notify>>,
    seen: Vec<(String, String)>,
}

struct FakeSource {
    st: Mutex<SrcState>,
    log: Log,
}

impl FakeSource {
    fn new(log: &Log) -> Self {
        Self {
            st: Mutex::default(),
            log: log.clone(),
        }
    }
    fn push_check(&self, r: Result<Option<FoundUpdate>, SourceError>) {
        self.st.lock().unwrap().checks.push_back(r);
    }
    fn count(&self, what: &str) -> usize {
        self.log
            .lock()
            .unwrap()
            .iter()
            .filter(|w| **w == what)
            .count()
    }
    fn seen(&self) -> Vec<(String, String)> {
        self.st.lock().unwrap().seen.clone()
    }
}

impl UpdateSource for FakeSource {
    fn check(
        &self,
        endpoint: &str,
        bearer: &Secret<String>,
    ) -> impl Future<Output = Result<Option<FoundUpdate>, SourceError>> + Send {
        self.log.lock().unwrap().push("check");
        let mut st = self.st.lock().unwrap();
        st.seen
            .push((endpoint.to_string(), bearer.expose().clone()));
        let r = st
            .checks
            .pop_front()
            .unwrap_or_else(|| Ok(Some(found(ORIGIN))));
        async move { r }
    }

    fn download(
        &self,
        on_chunk: &mut (dyn FnMut(u64, Option<u64>) + Send),
    ) -> impl Future<Output = Result<(), SourceError>> + Send {
        self.log.lock().unwrap().push("download");
        let (chunks, hold, fail) = {
            let st = self.st.lock().unwrap();
            (st.chunks.clone(), st.hold.clone(), st.download)
        };
        for (n, t) in chunks {
            on_chunk(n, t);
        }
        async move {
            if let Some(h) = hold {
                h.notified().await;
            }
            fail.map_or(Ok(()), Err)
        }
    }

    async fn install(&self) -> Result<(), SourceError> {
        self.log.lock().unwrap().push("install");
        let (panics, r) = {
            let st = self.st.lock().unwrap();
            (st.install_panics, st.install)
        };
        assert!(!panics, "가짜 설치 패닉");
        r.map_or(Ok(()), Err)
    }
}

// ---- 가짜 호스트 ----

struct FakeHost {
    log: Log,
    running: AtomicUsize,
    pause_ok: bool,
    events: Mutex<Vec<UpdateProgressEvent>>,
}

impl FakeHost {
    fn new(log: &Log, running: usize) -> Self {
        Self {
            log: log.clone(),
            running: AtomicUsize::new(running),
            pause_ok: true,
            events: Mutex::default(),
        }
    }
    fn events(&self) -> Vec<UpdateProgressEvent> {
        self.events.lock().unwrap().clone()
    }
}

impl InstallHost for FakeHost {
    fn running(&self) -> usize {
        self.log.lock().unwrap().push("running");
        self.running.load(Ordering::SeqCst)
    }
    fn pause_for_install(&self) -> impl Future<Output = bool> + Send {
        self.log.lock().unwrap().push("pause");
        let ok = self.pause_ok;
        async move { ok }
    }
    fn resume_after_failed_install(&self) {
        self.log.lock().unwrap().push("resume");
    }
    fn restart(&self) {
        self.log.lock().unwrap().push("restart");
    }
    fn progress(&self, e: UpdateProgressEvent) {
        self.events.lock().unwrap().push(e);
    }
}

// ---- 환경 ----

struct Env {
    _dir: tempfile::TempDir,
    api: FakeWorkerApi,
    svc: Svc,
    log: Log,
    src: FakeSource,
    up: Updates,
}

impl Env {
    /// 저장 세션(V에 확인)을 V+1h에 연 낙관 SignedIn: access가 아직 유효해 refresh 없이 토큰을 준다
    fn signed_in() -> Self {
        Self::with(true)
    }

    fn signed_out() -> Self {
        Self::with(false)
    }

    fn with(session: bool) -> Self {
        let dir = tempfile::tempdir().unwrap();
        if session {
            store(dir.path())
                .save(&stored(1, t0(), t0() + Duration::days(30)))
                .unwrap();
        }
        let api = FakeWorkerApi::default();
        let clock = FakeClock::at(t0() + Duration::hours(1));
        let svc = service(dir.path(), &api, &clock);
        let log: Log = Arc::default();
        let src = FakeSource::new(&log);
        Self {
            _dir: dir,
            api,
            svc,
            log,
            src,
            up: Updates::default(),
        }
    }

    fn host(&self, running: usize) -> FakeHost {
        FakeHost::new(&self.log, running)
    }

    fn log(&self) -> Vec<&'static str> {
        self.log.lock().unwrap().clone()
    }

    async fn check(&self) -> UpdateCheckDto {
        self.up.check(&self.svc, &base(), &self.src).await
    }

    async fn install(&self, host: &FakeHost, confirm: bool) -> UpdateInstallDto {
        self.up
            .install(&self.svc, &base(), &self.src, host, confirm)
            .await
    }
}

fn acc1() -> String {
    tok("cda_", "acc1")
}

// ---- 순수 함수 ----

#[test]
fn endpoint_keeps_the_placeholder() {
    assert_eq!(
        update_endpoint(&WorkerBase::parse("https://w.example.invalid").unwrap()),
        "https://w.example.invalid/update/{{current_version}}"
    );
    assert_eq!(
        update_endpoint(&WorkerBase::parse("http://127.0.0.1:8787").unwrap()),
        "http://127.0.0.1:8787/update/{{current_version}}"
    );
}

#[test]
fn bearer_value_is_secret() {
    let b = bearer_value(&Secret::new(acc1()));
    assert_eq!(b.expose(), &format!("Bearer {}", acc1()));
    assert!(!format!("{b:?}").contains("cda_"));
    assert!(!format!("{b}").contains("cda_"));
}

#[test]
fn same_origin_table() {
    let b = WorkerBase::parse("https://w.example.invalid").unwrap();
    for same in [
        "https://w.example.invalid/releases/1/app.bin",
        "https://w.example.invalid",
        "https://w.example.invalid:443/x",
        "https://W.EXAMPLE.INVALID/x?y=1",
    ] {
        assert!(b.same_origin(same), "{same}");
    }
    for other in [
        "https://other.example.invalid/x",
        "https://w.example.invalid:8443/x",
        "http://w.example.invalid/x",
        "https://sub.w.example.invalid/x",
        "https://w.example.invalid.evil.invalid/x",
        "data:text/plain,hi",
        "not a url",
        "",
        // 사용자 정보: origin()은 버리지만 다른 주소로 본다
        "https://u:p@w.example.invalid/x",
        "https://w@w.example.invalid/x",
        "https://w.example.invalid@evil.example.invalid/x",
        "https://w.example.invalid:@evil.example.invalid/x",
        // 끝 점은 다른 호스트 글자다
        "https://w.example.invalid./x",
        // IDN: 키릴 문자 а(U+0430)는 punycode로 바뀌어 다르다
        "https://w.ex\u{0430}mple.invalid/x",
    ] {
        assert!(!b.same_origin(other), "{other}");
    }
    // userinfo가 비어 있으면(`@`만) url이 버린다: 같은 주소다
    assert!(b.same_origin("https://@w.example.invalid/x"));
    let lo = WorkerBase::parse("http://127.0.0.1:8787").unwrap();
    assert!(lo.same_origin("http://127.0.0.1:8787/a"));
    assert!(!lo.same_origin("http://127.0.0.1:8788/a"));
}

fn status(phase: AuthPhase, offline: bool) -> AuthStatus {
    use chzzk_shell::auth::{Cause, OfflineInfo};
    AuthStatus {
        phase,
        reason: None,
        channel_id: None,
        channel_name: None,
        is_admin: false,
        pending: None,
        offline: offline.then(|| OfflineInfo {
            since: t0(),
            grace_until: t0() + Duration::hours(72),
            cause: Cause::Network,
        }),
        verified_at: None,
        has_session: false,
    }
}

#[test]
fn auto_check_due_table() {
    assert!(auto_check_due(&status(AuthPhase::SignedIn, false)));
    assert!(!auto_check_due(&status(AuthPhase::SignedIn, true)));
    for p in [
        AuthPhase::Checking,
        AuthPhase::SignedOut,
        AuthPhase::Pending,
        AuthPhase::Denied,
        AuthPhase::Expired,
        AuthPhase::Cancelled,
        AuthPhase::Error,
    ] {
        assert!(!auto_check_due(&status(p, false)), "{p:?}");
    }
}

#[test]
fn progress_throttle_table() {
    use UpdateProgressEvent::{Chunk, Started};
    let mut t = ProgressThrottle::new();
    assert_eq!(
        t.on_chunk(5, Some(1000)),
        [
            Started { total: Some(1000) },
            Chunk {
                received: 5,
                total: Some(1000)
            }
        ]
    );
    assert!(t.on_chunk(4, Some(1000)).is_empty(), "같은 퍼센트(0%)");
    assert_eq!(
        t.on_chunk(100, Some(1000)),
        [Chunk {
            received: 109,
            total: Some(1000)
        }]
    );
    assert!(t.on_chunk(0, Some(1000)).is_empty(), "같은 10%");
    assert_eq!(
        t.on_chunk(891, Some(1000)),
        [Chunk {
            received: 1000,
            total: Some(1000)
        }]
    );

    // 크기를 모르면 1 MiB마다
    let mut u = ProgressThrottle::new();
    assert_eq!(u.on_chunk(1, None).len(), 2);
    assert!(u.on_chunk(PROGRESS_STEP_UNKNOWN - 1, None).is_empty());
    assert_eq!(
        u.on_chunk(1, None),
        [Chunk {
            received: PROGRESS_STEP_UNKNOWN + 1,
            total: None
        }]
    );
    assert!(u.on_chunk(10, None).is_empty());

    // total=0은 모름
    let mut z = ProgressThrottle::new();
    assert_eq!(
        z.on_chunk(3, Some(0)),
        [
            Started { total: None },
            Chunk {
                received: 3,
                total: None
            }
        ]
    );
    // 받은 양이 total을 넘어도 100%에서 멈춘다
    let mut o = ProgressThrottle::new();
    o.on_chunk(10, Some(10));
    assert!(o.on_chunk(5, Some(10)).is_empty());
}

// ---- check ----

#[tokio::test(start_paused = true)]
async fn check_without_session_is_offline_and_calls_nothing() {
    let e = Env::signed_out();
    assert_eq!(e.check().await, UpdateCheckDto::Offline);
    assert_eq!(e.src.count("check"), 0);
    assert_eq!(e.up.available(), None);
}

#[tokio::test(start_paused = true)]
async fn check_offline_grace_tries_refresh_first() {
    let e = Env::signed_in();
    for _ in 0..8 {
        e.api.push_refresh(Reply::Now(Err(transport())));
    }
    e.svc.refresh().await;
    assert!(e.svc.status().offline.is_some());
    assert_eq!(e.check().await, UpdateCheckDto::Offline);
    assert_eq!(e.src.count("check"), 0);
    assert!(
        e.api.refresh_calls().len() > 1,
        "check 앞에서 다시 갱신해 본다"
    );
}

#[tokio::test(start_paused = true)]
async fn check_sends_bearer_and_endpoint() {
    let e = Env::signed_in();
    assert!(matches!(e.check().await, UpdateCheckDto::Available { .. }));
    assert_eq!(
        e.src.seen(),
        [(
            format!("{ORIGIN}/update/{{{{current_version}}}}"),
            format!("Bearer {}", acc1())
        )]
    );
    assert!(
        e.api.refresh_calls().is_empty(),
        "갓 확인한 세션은 refresh하지 않는다"
    );
}

#[tokio::test(start_paused = true)]
async fn check_available_caches() {
    let e = Env::signed_in();
    let UpdateCheckDto::Available { info } = e.check().await else {
        panic!("available이어야 한다");
    };
    assert_eq!(info.version, "9.9.9");
    assert_eq!(info.current, "0.1.0");
    assert_eq!(info.notes.as_deref(), Some("메모"));
    assert_eq!(info.pub_date, Some(1_900_000_000));
    assert_eq!(e.up.available(), Some(info));
}

#[tokio::test(start_paused = true)]
async fn check_up_to_date_clears_cache() {
    let e = Env::signed_in();
    e.check().await;
    assert!(e.up.available().is_some());
    e.src.push_check(Ok(None));
    assert_eq!(e.check().await, UpdateCheckDto::UpToDate);
    assert_eq!(e.up.available(), None);
}

#[tokio::test(start_paused = true)]
async fn check_foreign_origin_is_untrusted() {
    let e = Env::signed_in();
    e.check().await;
    e.src
        .push_check(Ok(Some(found("https://evil.example.invalid"))));
    assert_eq!(e.check().await, UpdateCheckDto::Untrusted);
    assert_eq!(e.up.available(), None);
    assert_eq!(e.src.count("download"), 0);
}

#[tokio::test(start_paused = true)]
async fn check_source_error_is_failed_and_keeps_cache() {
    let e = Env::signed_in();
    e.check().await;
    let before = e.up.available();
    assert!(before.is_some());
    e.src.push_check(Err(SourceError::Check));
    assert_eq!(e.check().await, UpdateCheckDto::Failed);
    assert_eq!(e.up.available(), before);
}

// ---- install ----

#[tokio::test(start_paused = true)]
async fn install_asks_before_pausing() {
    let e = Env::signed_in();
    let host = e.host(2);
    assert_eq!(
        e.install(&host, false).await,
        UpdateInstallDto::NeedsConfirm { running: 2 }
    );
    assert_eq!(e.src.count("check"), 0);
    assert!(e.api.refresh_calls().is_empty());
    // 확인했으면 진행한다
    assert_eq!(e.install(&host, true).await, UpdateInstallDto::Restarting);
}

#[tokio::test(start_paused = true)]
async fn install_happy_path_order() {
    let e = Env::signed_in();
    e.src.st.lock().unwrap().chunks = vec![(5, Some(1000)), (995, Some(1000))];
    let host = e.host(1);
    assert_eq!(e.install(&host, true).await, UpdateInstallDto::Restarting);
    assert_eq!(
        e.log(),
        [
            "running", "check", "download", "pause", "install", "restart"
        ]
    );
    let ev = host.events();
    assert_eq!(
        ev.first(),
        Some(&UpdateProgressEvent::Started { total: Some(1000) })
    );
    assert_eq!(
        ev[ev.len() - 2..],
        [
            UpdateProgressEvent::Downloaded,
            UpdateProgressEvent::Installing
        ]
    );
    assert!(ev.contains(&UpdateProgressEvent::Chunk {
        received: 1000,
        total: Some(1000)
    }));
}

#[tokio::test(start_paused = true)]
async fn install_download_failure_keeps_jobs() {
    let e = Env::signed_in();
    e.src.st.lock().unwrap().download = Some(SourceError::Download);
    let host = e.host(1);
    assert_eq!(e.install(&host, true).await, UpdateInstallDto::Failed);
    assert_eq!(e.src.count("install"), 0);
    assert!(!e.log().contains(&"pause"));
    assert!(!host.events().contains(&UpdateProgressEvent::Downloaded));
}

#[tokio::test(start_paused = true)]
async fn install_failure_after_pause_resumes() {
    let e = Env::signed_in();
    e.src.st.lock().unwrap().install = Some(SourceError::Install);
    let host = e.host(1);
    assert_eq!(e.install(&host, true).await, UpdateInstallDto::Failed);
    assert_eq!(
        e.log(),
        ["running", "check", "download", "pause", "install", "resume"]
    );
    assert!(!e.log().contains(&"restart"));
    // 가드가 풀려 다시 부를 수 있다
    e.src.st.lock().unwrap().install = None;
    assert_eq!(e.install(&host, true).await, UpdateInstallDto::Restarting);
}

/// 설치가 패닉해도(quit 뒤 구간) 멈춘 작업과 종료 가드를 되살리고 단일 실행 가드도 풀린다(81)
#[tokio::test(start_paused = true)]
async fn install_panic_after_pause_resumes() {
    let e = Env::signed_in();
    e.src.st.lock().unwrap().install_panics = true;
    let host = e.host(1);
    let fut = std::pin::pin!(e.install(&host, true));
    let caught = CatchUnwind(fut).await;
    assert!(caught.is_err(), "패닉이 전해진다");
    assert_eq!(
        e.log(),
        ["running", "check", "download", "pause", "install", "resume"]
    );
    e.src.st.lock().unwrap().install_panics = false;
    assert_eq!(e.install(&host, true).await, UpdateInstallDto::Restarting);
    assert_eq!(e.log().iter().filter(|w| **w == "resume").count(), 1);
}

/// poll 중 패닉을 잡는 future(테스트 전용, futures 의존성 없이)
struct CatchUnwind<F>(F);

impl<F: Future + Unpin> Future for CatchUnwind<F> {
    type Output = std::thread::Result<F::Output>;
    fn poll(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Self::Output> {
        let inner = &mut self.0;
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            std::pin::Pin::new(inner).poll(cx)
        })) {
            Ok(std::task::Poll::Pending) => std::task::Poll::Pending,
            Ok(std::task::Poll::Ready(v)) => std::task::Poll::Ready(Ok(v)),
            Err(p) => std::task::Poll::Ready(Err(p)),
        }
    }
}

#[tokio::test(start_paused = true)]
async fn install_untrusted_downloads_nothing() {
    let e = Env::signed_in();
    e.src
        .push_check(Ok(Some(found("https://evil.example.invalid"))));
    let host = e.host(1);
    assert_eq!(e.install(&host, true).await, UpdateInstallDto::Untrusted);
    assert_eq!(e.src.count("download"), 0);
    assert!(!e.log().contains(&"pause"));
}

#[tokio::test(start_paused = true)]
async fn install_other_check_results() {
    let e = Env::signed_in();
    let host = e.host(0);
    e.src.push_check(Ok(None));
    assert_eq!(e.install(&host, false).await, UpdateInstallDto::UpToDate);
    e.src.push_check(Err(SourceError::Check));
    assert_eq!(e.install(&host, false).await, UpdateInstallDto::Failed);
    let out = Env::signed_out();
    assert_eq!(
        out.install(&out.host(0), false).await,
        UpdateInstallDto::Offline
    );
}

#[tokio::test(start_paused = true)]
async fn install_when_already_quitting_is_busy() {
    let e = Env::signed_in();
    let mut host = e.host(1);
    host.pause_ok = false;
    assert_eq!(e.install(&host, true).await, UpdateInstallDto::Busy);
    assert_eq!(e.src.count("install"), 0);
}

#[tokio::test(start_paused = true)]
async fn install_is_single_flight() {
    let e = Env::signed_in();
    let hold = Arc::new(Notify::new());
    e.src.st.lock().unwrap().hold = Some(hold.clone());
    let host = e.host(0);
    let first = e.install(&host, true);
    let second = async {
        while e.src.count("download") == 0 {
            tokio::task::yield_now().await;
        }
        let r = e.install(&host, true).await;
        hold.notify_one();
        r
    };
    let (a, b) = tokio::join!(first, second);
    assert_eq!(a, UpdateInstallDto::Restarting);
    assert_eq!(b, UpdateInstallDto::Busy);
    // 끝난 뒤에는 Busy가 아니다
    e.src.st.lock().unwrap().hold = None;
    assert_eq!(e.install(&host, true).await, UpdateInstallDto::Restarting);
}

/// 앱 command(Tauri async)는 `install` future가 `Send`여야 한다(정체 감시가 잠금을 await 너머로 들지 않는다)
#[tokio::test(start_paused = true)]
async fn install_future_is_send() {
    fn assert_send<T: Send>(_: &T) {}
    let e = Env::signed_in();
    let host = e.host(0);
    let b = base();
    let f = e.up.install(&e.svc, &b, &e.src, &host, true);
    assert_send(&f);
    assert_eq!(f.await, UpdateInstallDto::Restarting);
}

/// 다운로드가 `DOWNLOAD_STALL` 동안 아무것도 주지 않으면 실패로 끝내고 가드를 푼다(받던 작업은 멈추지 않는다)
#[tokio::test(start_paused = true)]
async fn install_stalled_download_fails_and_releases_the_guard() {
    let e = Env::signed_in();
    // notify하지 않는 hold: 영원히 끝나지 않는 전송
    e.src.st.lock().unwrap().hold = Some(Arc::new(Notify::new()));
    let host = e.host(1);
    let t0 = tokio::time::Instant::now();
    assert_eq!(e.install(&host, true).await, UpdateInstallDto::Failed);
    assert!(t0.elapsed() >= DOWNLOAD_STALL);
    assert!(!e.log().contains(&"pause"));
    assert!(!host.events().contains(&UpdateProgressEvent::Downloaded));
    // 가드가 풀렸다
    e.src.st.lock().unwrap().hold = None;
    assert_eq!(e.install(&host, true).await, UpdateInstallDto::Restarting);
}

/// 청크가 계속 오면 전체가 `DOWNLOAD_STALL`보다 길어도 끊지 않는다
#[tokio::test(start_paused = true)]
async fn install_slow_but_moving_download_is_not_stalled() {
    struct Slow;
    impl UpdateSource for Slow {
        async fn check(
            &self,
            _: &str,
            _: &Secret<String>,
        ) -> Result<Option<FoundUpdate>, SourceError> {
            Ok(Some(found(ORIGIN)))
        }
        async fn download(
            &self,
            on_chunk: &mut (dyn FnMut(u64, Option<u64>) + Send),
        ) -> Result<(), SourceError> {
            for _ in 0..4 {
                tokio::time::sleep(DOWNLOAD_STALL / 2).await;
                on_chunk(1, Some(4));
            }
            Ok(())
        }
        async fn install(&self) -> Result<(), SourceError> {
            Ok(())
        }
    }
    let e = Env::signed_in();
    let host = e.host(0);
    let t0 = tokio::time::Instant::now();
    assert_eq!(
        e.up.install(&e.svc, &base(), &Slow, &host, false).await,
        UpdateInstallDto::Restarting
    );
    assert!(t0.elapsed() >= DOWNLOAD_STALL * 2);
}

/// 받는 중 작업 없이 시작했는데 받는 동안 새 받기가 시작되면, 멈추기 전에 묻는다
#[tokio::test(start_paused = true)]
async fn install_rechecks_running_jobs_after_download() {
    let e = Env::signed_in();
    let hold = Arc::new(Notify::new());
    e.src.st.lock().unwrap().hold = Some(hold.clone());
    let host = e.host(0);
    let first = e.install(&host, false);
    let start_job = async {
        while e.src.count("download") == 0 {
            tokio::task::yield_now().await;
        }
        host.running.store(1, Ordering::SeqCst);
        hold.notify_one();
    };
    let (r, ()) = tokio::join!(first, start_job);
    assert_eq!(r, UpdateInstallDto::NeedsConfirm { running: 1 });
    assert!(!e.log().contains(&"pause"));
    assert_eq!(e.src.count("install"), 0);
}

/// 설치 때 다시 확인한 버전이 배너와 다르면 캐시를 맞춘다
#[tokio::test(start_paused = true)]
async fn install_refreshes_the_cached_version() {
    let e = Env::signed_in();
    e.check().await;
    assert_eq!(e.up.available().unwrap().version, "9.9.9");
    let mut newer = found(ORIGIN);
    newer.version = "9.9.10".into();
    e.src.push_check(Ok(Some(newer)));
    e.src.st.lock().unwrap().download = Some(SourceError::Download);
    assert_eq!(e.install(&e.host(0), false).await, UpdateInstallDto::Failed);
    assert_eq!(e.up.available().unwrap().version, "9.9.10");
}

// ---- 비밀·주소가 새지 않는다 ----

#[test]
fn found_update_debug_hides_the_download_url() {
    let f = found("https://dl.example.invalid");
    let text = format!("{f:?}");
    assert!(!text.contains("example.invalid"), "{text}");
    assert!(!text.contains("releases"), "{text}");
    assert!(text.contains("9.9.9"));
}

#[test]
fn source_error_display_is_fixed_words() {
    for (e, want) in [
        (SourceError::Unavailable, "업데이트 기능을 쓸 수 없음"),
        (SourceError::Check, "업데이트 확인 실패"),
        (SourceError::Download, "업데이트 다운로드 실패"),
        (SourceError::Install, "업데이트 설치 실패"),
    ] {
        assert_eq!(e.to_string(), want);
    }
}
