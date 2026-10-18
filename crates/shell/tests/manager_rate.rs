//! 속도 제한 배선(rate-limit.md §3.3, §10.4): 매니저가 작업을 시작할 때 `DownloadRequest.throttle`을 붙인다.
//! 생방송은 붙이지 않고, 공유 bucket은 모든 작업이 같은 것이며, 작업 bucket은 실행마다 새로 만든다.

mod common;

use std::num::NonZeroU64;
use std::sync::Arc;
use std::time::Duration;

use chzzk_core::{DownloadRequest, Error};
use chzzk_shell::dto::JobStatus;
use chzzk_shell::jobs::JobStore;
use chzzk_shell::manager::ClientFn;
use chzzk_shell::{DownloadManager, ManagerConfig};
use common::fake::{FakeBackend, Script};
use common::harness::{Harness, request, until};
use tokio::sync::Notify;

const MB: u64 = 1_000_000;

fn nz(n: u64) -> Option<NonZeroU64> {
    NonZeroU64::new(n)
}

fn request_for(h: &Harness, name: &str) -> DownloadRequest {
    h.fake
        .download_requests()
        .into_iter()
        .find(|r| r.output == h.output(name))
        .unwrap_or_else(|| panic!("{name}의 요청 없음"))
}

/// 생방송이 아니면 작업·공유 bucket이 둘 다 붙고, 생방송은 아무것도 붙지 않는다.
#[tokio::test(start_paused = true)]
async fn non_live_gets_both_buckets_and_live_gets_none() {
    let h = Harness::new(3);
    h.enqueue("v");
    h.enqueue_live("l");
    until("두 요청", || h.fake.download_requests().len() == 2).await;
    let v = request_for(&h, "v");
    assert!(v.throttle.job.is_some() && v.throttle.shared.is_some());
    let l = request_for(&h, "l");
    assert!(l.throttle.is_unlimited(), "생방송은 제한하지 않는다");
}

/// 공유 bucket은 모든 작업이 같은 것이고, 작업 bucket은 서로 다르다.
#[tokio::test(start_paused = true)]
async fn shared_bucket_is_one_job_buckets_are_distinct() {
    let h = Harness::new(2);
    h.enqueue("a");
    h.enqueue("b");
    until("두 요청", || h.fake.download_requests().len() == 2).await;
    let (a, b) = (request_for(&h, "a").throttle, request_for(&h, "b").throttle);
    assert!(
        a.shared
            .as_ref()
            .unwrap()
            .same_bucket(b.shared.as_ref().unwrap())
    );
    assert!(!a.job.as_ref().unwrap().same_bucket(b.job.as_ref().unwrap()));
}

/// 일시정지 뒤 이어받기는 새 작업 bucket으로 시작하고, 공유 bucket은 그대로다.
#[tokio::test(start_paused = true)]
async fn resume_gets_a_fresh_job_bucket_but_same_shared() {
    let h = Harness::new(2);
    let out = h.output("a");
    h.fake.script_for(
        &out,
        Script::new()
            .bytes(100, Some(1000))
            .until_cancelled()
            .fails(Error::Cancelled),
    );
    let id = h.enqueue("a").id;
    until("진행", || h.job(id).progress.is_some()).await;
    h.mgr.pause(id).unwrap();
    until("paused", || h.status(id) == JobStatus::Paused).await;
    h.fake
        .script_for(&out, Script::new().bytes(1000, Some(1000)));
    h.mgr.resume(id, false).unwrap();
    until("완료", || h.status(id) == JobStatus::Completed).await;
    let reqs = h.fake.download_requests();
    assert_eq!(reqs.len(), 2);
    let (first, second) = (&reqs[0].throttle, &reqs[1].throttle);
    assert!(
        !first
            .job
            .as_ref()
            .unwrap()
            .same_bucket(second.job.as_ref().unwrap())
    );
    assert!(
        first
            .shared
            .as_ref()
            .unwrap()
            .same_bucket(second.shared.as_ref().unwrap())
    );
}

/// 기본은 끔이고, `set_rate_limits`는 이미 받는 중인 요청에도 곧바로 보인다(같은 knob).
#[tokio::test(start_paused = true)]
async fn set_rate_limits_applies_to_running_and_new_jobs() {
    let h = Harness::new(2);
    assert_eq!(h.mgr.rate_limits(), (None, None));
    let gate = Arc::new(Notify::new());
    h.fake
        .script_for(h.output("a"), Script::new().hold(gate.clone()));
    h.enqueue("a");
    until("a 시작", || h.fake.download_requests().len() == 1).await;
    let a = request_for(&h, "a").throttle;
    assert_eq!(a.job.as_ref().unwrap().rate(), None);
    assert_eq!(a.shared.as_ref().unwrap().rate(), None);

    h.mgr.set_rate_limits(Some(5 * MB), Some(2 * MB));
    assert_eq!(h.mgr.rate_limits(), (Some(5 * MB), Some(2 * MB)));
    assert_eq!(
        a.job.as_ref().unwrap().rate(),
        nz(2 * MB),
        "받는 중인 작업에도 바로"
    );
    assert_eq!(a.shared.as_ref().unwrap().rate(), nz(5 * MB));

    h.enqueue("b");
    until("b 시작", || h.fake.download_requests().len() == 2).await;
    let b = request_for(&h, "b").throttle;
    assert_eq!(b.job.as_ref().unwrap().rate(), nz(2 * MB));
    assert_eq!(b.shared.as_ref().unwrap().rate(), nz(5 * MB));

    // 하나만 끄거나 둘 다 끈다.
    h.mgr.set_rate_limits(None, Some(3 * MB));
    assert_eq!(a.shared.as_ref().unwrap().rate(), None);
    assert_eq!(b.job.as_ref().unwrap().rate(), nz(3 * MB));
    h.mgr.set_rate_limits(None, None);
    assert_eq!(h.mgr.rate_limits(), (None, None));
    assert_eq!(a.job.as_ref().unwrap().rate(), None);
    // 0은 끔으로 본다(방어).
    h.mgr.set_rate_limits(Some(0), Some(0));
    assert_eq!(h.mgr.rate_limits(), (None, None));
    gate.notify_one();
}

/// 처음 값은 `ManagerConfig`에서 온다(앱 시작 때 저장된 설정 값).
#[tokio::test(start_paused = true)]
async fn initial_limits_come_from_config() {
    let dir = tempfile::tempdir().unwrap();
    let fake = FakeBackend::new();
    let f = Arc::clone(&fake);
    let client: ClientFn<FakeBackend> = Arc::new(move || Arc::clone(&f));
    let mgr = DownloadManager::open(ManagerConfig {
        client,
        store: JobStore::new(dir.path().join("data")),
        runtime: tokio::runtime::Handle::current(),
        max_parallel: 2,
        auto_resume: false,
        total_rate_limit: Some(4 * MB),
        job_rate_limit: Some(MB),
    })
    .unwrap();
    assert_eq!(mgr.rate_limits(), (Some(4 * MB), Some(MB)));
    let defaults = chzzk_shell::JobDefaults {
        download_folder: dir.path().join("downloads"),
        segment_concurrency: 4,
        chat_subtitle: chzzk_core::chat::SubtitleFormat::Ass,
        embed_metadata: false,
    };
    mgr.enqueue(request("a"), &defaults).unwrap();
    until("요청", || fake.download_requests().len() == 1).await;
    let t = fake.download_requests().remove(0).throttle;
    assert_eq!(t.job.as_ref().unwrap().rate(), nz(MB));
    assert_eq!(t.shared.as_ref().unwrap().rate(), nz(4 * MB));
    mgr.flush();
    tokio::time::sleep(Duration::from_millis(1)).await;
}
