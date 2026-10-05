//! `Backend` seam: Send 컴파일 검사와 가짜 Backend의 대본 동작(app.md §3, §15-4).

mod common;

use std::num::NonZeroU8;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chzzk_core::{
    CancellationToken, Chzzk, ClientConfig, ContentKind, ContentMeta, ContentRef, DownloadOutcome,
    DownloadRequest, DuplicatePolicy, Error, Phase, PlaybackKind, Progress, Resolved, Source,
};
use chzzk_shell::Backend;
use common::fake::{Call, FakeBackend, Script, progress};
use tokio::sync::Notify;

/// 매니저가 진행률을 넘기는 클로저.
type Sink = Arc<dyn Fn(Progress) + Send + Sync>;

fn assert_send<T: Send>(_: &T) {}
fn assert_send_static<T: Send + 'static>(_: &T) {}

fn request(output: &str) -> DownloadRequest {
    DownloadRequest {
        content: ContentRef::Video { video_no: 1 },
        quality_id: "720p".into(),
        expected_kind: PlaybackKind::LiveRewindHls,
        output: PathBuf::from(output),
        on_existing: DuplicatePolicy::Overwrite,
        concurrency: NonZeroU8::new(4).unwrap(),
    }
}

/// 매니저가 spawn할 모양: `Arc<B>`와 `Arc` 클로저를 async 블록 안으로 옮기고 빌려 넘긴다.
/// 이 future가 `Send + 'static`이어야 `tokio::spawn`할 수 있다. 반환 타입에 그 경계를 적는 것이
/// 검사 자체이므로 `async fn`으로 바꾸지 않는다.
#[allow(clippy::manual_async_fn)]
fn job_task<B: Backend>(
    backend: Arc<B>,
    req: DownloadRequest,
    cancel: CancellationToken,
    sink: Sink,
) -> impl Future<Output = Result<DownloadOutcome, Error>> + Send + 'static {
    async move {
        let on_progress = move |p: Progress| sink(p);
        backend.download(req, cancel, &on_progress).await
    }
}

#[allow(clippy::manual_async_fn)]
fn resolve_task<B: Backend>(
    backend: Arc<B>,
    c: ContentRef,
) -> impl Future<Output = Result<Resolved, Error>> + Send + 'static {
    async move { backend.resolve(&c).await }
}

/// 실제 `Chzzk`의 두 future가 `Send`이고, 매니저 모양으로 감싸도 `Send + 'static`이다.
/// future를 만들기만 하고 poll하지 않으므로 네트워크를 쓰지 않는다.
#[test]
fn chzzk_futures_are_send() {
    let chzzk = Arc::new(Chzzk::new(ClientConfig::default()).unwrap());
    let c = ContentRef::Video { video_no: 1 };
    let on_progress = |_: Progress| {};

    let f = Backend::resolve(&*chzzk, &c);
    assert_send(&f);
    drop(f);
    let f = Backend::download(
        &*chzzk,
        request("/x/a.mp4"),
        CancellationToken::new(),
        &on_progress,
    );
    assert_send(&f);
    drop(f);

    let f = job_task(
        chzzk.clone(),
        request("/x/a.mp4"),
        CancellationToken::new(),
        Arc::new(|_| {}),
    );
    assert_send_static(&f);
    let f = resolve_task(chzzk, c);
    assert_send_static(&f);
}

fn collector() -> (Arc<Mutex<Vec<Progress>>>, Sink) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let s = seen.clone();
    (seen, Arc::new(move |p| s.lock().unwrap().push(p)))
}

/// 가짜 Backend도 같은 모양으로 `tokio::spawn`된다. 진행률은 대본 순서대로, 결과는 기본 `Completed`.
#[tokio::test(start_paused = true)]
async fn fake_runs_script_in_spawned_task() {
    let fake = FakeBackend::new();
    fake.script_for(
        "/x/a.mp4",
        Script::new()
            .bytes(10, Some(30))
            .sleep(Duration::from_secs(1))
            .bytes(30, Some(30))
            .progress(progress(Phase::Finalizing, 30, Some(30))),
    );
    let (seen, sink) = collector();
    let out = tokio::spawn(job_task(
        fake.clone(),
        request("/x/a.mp4"),
        CancellationToken::new(),
        sink,
    ))
    .await
    .unwrap()
    .unwrap();

    assert_eq!(
        out,
        DownloadOutcome::Completed {
            path: PathBuf::from("/x/a.mp4"),
            bytes: 30,
            resumed_from: 0
        }
    );
    let seen = seen.lock().unwrap();
    let got: Vec<_> = seen.iter().map(|p| (p.phase, p.bytes)).collect();
    assert_eq!(
        got,
        [
            (Phase::Downloading, 10),
            (Phase::Downloading, 30),
            (Phase::Finalizing, 30)
        ]
    );
    assert_eq!(fake.download_calls(), [PathBuf::from("/x/a.mp4")]);
    assert_eq!(fake.active(), 0);
}

#[tokio::test(start_paused = true)]
async fn fake_wait_cancel_returns_cancelled() {
    let fake = FakeBackend::new();
    fake.script(Script::new().bytes(5, None).wait_cancel());
    let cancel = CancellationToken::new();
    let (seen, sink) = collector();
    let task = tokio::spawn(job_task(
        fake.clone(),
        request("/x/b.mp4"),
        cancel.clone(),
        sink,
    ));

    tokio::time::sleep(Duration::from_secs(60)).await;
    assert!(!task.is_finished());
    assert_eq!(fake.active(), 1);
    cancel.cancel();
    let r = task.await.unwrap();
    assert!(matches!(r, Err(Error::Cancelled)), "{r:?}");
    assert_eq!(seen.lock().unwrap().len(), 1);
    assert_eq!(fake.active(), 0);
}

/// 시작 전에 취소된 토큰이면 대기 단계가 없는 대본도 `Cancelled`다(코어와 같다).
#[tokio::test(start_paused = true)]
async fn fake_precancelled_token_returns_cancelled() {
    let fake = FakeBackend::new();
    fake.script(Script::new().bytes(5, Some(10)));
    let cancel = CancellationToken::new();
    cancel.cancel();
    let r = job_task(fake.clone(), request("/x/p.mp4"), cancel, Arc::new(|_| {})).await;
    assert!(matches!(r, Err(Error::Cancelled)), "{r:?}");
    assert_eq!(fake.active(), 0);
}

#[tokio::test(start_paused = true)]
async fn fake_sleep_and_hold_honor_cancel() {
    let fake = FakeBackend::new();
    fake.script_for("/x/s.mp4", Script::new().sleep(Duration::from_secs(3600)));
    let hold = Arc::new(Notify::new());
    fake.script_for("/x/h.mp4", Script::new().hold(hold.clone()));

    let c1 = CancellationToken::new();
    let t1 = tokio::spawn(job_task(
        fake.clone(),
        request("/x/s.mp4"),
        c1.clone(),
        Arc::new(|_| {}),
    ));
    let c2 = CancellationToken::new();
    let t2 = tokio::spawn(job_task(
        fake.clone(),
        request("/x/h.mp4"),
        c2.clone(),
        Arc::new(|_| {}),
    ));
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert_eq!(fake.max_active(), 2);
    c1.cancel();
    c2.cancel();
    assert!(matches!(t1.await.unwrap(), Err(Error::Cancelled)));
    assert!(matches!(t2.await.unwrap(), Err(Error::Cancelled)));
}

#[tokio::test(start_paused = true)]
async fn fake_hold_releases_on_notify() {
    let fake = FakeBackend::new();
    let hold = Arc::new(Notify::new());
    fake.script(
        Script::new()
            .hold(hold.clone())
            .fails(Error::RefreshExhausted),
    );
    let task = tokio::spawn(job_task(
        fake.clone(),
        request("/x/c.mp4"),
        CancellationToken::new(),
        Arc::new(|_| {}),
    ));
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert!(!task.is_finished());
    hold.notify_one();
    assert!(matches!(task.await.unwrap(), Err(Error::RefreshExhausted)));
}

/// 경로별 대본은 호출 순서와 무관하게 그 경로에만 쓰이고, 없으면 공용 줄 → 기본 완료 순서다.
#[tokio::test(start_paused = true)]
async fn fake_scripts_are_keyed_by_output() {
    let fake = FakeBackend::new();
    fake.script_for("/x/b.mp4", Script::new().fails(Error::NoQualities));
    fake.script(Script::new().ends(Ok(DownloadOutcome::Skipped {
        path: PathBuf::from("/x/a.mp4"),
    })));
    let run = |out: &'static str| {
        job_task(
            fake.clone(),
            request(out),
            CancellationToken::new(),
            Arc::new(|_| {}),
        )
    };
    assert!(matches!(
        run("/x/a.mp4").await,
        Ok(DownloadOutcome::Skipped { .. })
    ));
    assert!(matches!(run("/x/b.mp4").await, Err(Error::NoQualities)));
    assert!(matches!(
        run("/x/c.mp4").await,
        Ok(DownloadOutcome::Completed { bytes: 0, .. })
    ));
}

#[tokio::test(start_paused = true)]
async fn fake_resolve_is_scripted_and_recorded() {
    let fake = FakeBackend::new();
    let resolved = Resolved {
        content: ContentRef::Video { video_no: 7 },
        meta: ContentMeta {
            kind: ContentKind::Video,
            title: "제목".into(),
            channel_name: "채널".into(),
            channel_id: None,
            live_open_date: None,
            publish_date: None,
            adult: false,
            duration_secs: None,
        },
        source: Source::Progressive { reps: Vec::new() },
    };
    fake.push_resolve(Ok(resolved.clone()));
    fake.push_resolve(Err(Error::AuthRequired { status: 401 }));
    let c = ContentRef::Video { video_no: 7 };

    assert_eq!(
        tokio::spawn(resolve_task(fake.clone(), c.clone()))
            .await
            .unwrap()
            .unwrap(),
        resolved
    );
    assert!(matches!(
        fake.resolve(&c).await,
        Err(Error::AuthRequired { status: 401 })
    ));
    // 대본이 떨어지면 오류(패닉하지 않는다)
    assert!(matches!(fake.resolve(&c).await, Err(Error::Parse { .. })));
    assert_eq!(fake.calls(), vec![Call::Resolve(c); 3]);
}

/// 가짜는 `download` 요청을 통째로 남긴다(매니저가 넘긴 정책·화질·방식·동시 요청 수를 검사할 수 있게).
#[tokio::test]
async fn fake_records_full_download_request() {
    let fake = FakeBackend::new();
    let mut req = request("/x/b.mp4");
    req.content = ContentRef::Clip {
        clip_id: "c1".into(),
    };
    req.quality_id = "1080p".into();
    req.expected_kind = PlaybackKind::Progressive;
    req.on_existing = DuplicatePolicy::Skip;
    req.concurrency = NonZeroU8::new(2).unwrap();
    fake.download(req, CancellationToken::new(), &|_| {})
        .await
        .unwrap();

    let reqs = fake.download_requests();
    assert_eq!(reqs.len(), 1);
    let r = &reqs[0];
    assert_eq!(
        r.content,
        ContentRef::Clip {
            clip_id: "c1".into()
        }
    );
    assert_eq!(r.quality_id, "1080p");
    assert_eq!(r.expected_kind, PlaybackKind::Progressive);
    assert_eq!(r.output, PathBuf::from("/x/b.mp4"));
    assert_eq!(r.on_existing, DuplicatePolicy::Skip);
    assert_eq!(r.concurrency.get(), 2);
}
