//! 매니저의 `jobs.json` 쓰기(app.md §7.1, 구현 중 변경 29(아)·32): 잠금 밖 쓰기 스레드, 쓰기 실패.

mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use chzzk_core::fsutil::atomic_write;
use chzzk_shell::dto::{JobEvent, JobStatus};
use chzzk_shell::jobs::JobStore;
use chzzk_shell::manager::ClientFn;
use chzzk_shell::{DownloadManager, JobDefaults, ManagerConfig};
use common::fake::{FakeBackend, Script};
use common::harness::{Harness, Recorder, request, until};

/// 열릴 때까지 쓰기를 막는 문. drop하면 열린다(테스트가 실패해도 쓰기 스레드를 풀어 준다).
#[derive(Clone, Default)]
struct Gate(Arc<(Mutex<bool>, Condvar)>);

impl Gate {
    fn wait(&self) {
        let (m, cv) = &*self.0;
        let mut open = m.lock().unwrap();
        while !*open {
            open = cv.wait(open).unwrap();
        }
    }

    fn open(&self) {
        let (m, cv) = &*self.0;
        *m.lock().unwrap() = true;
        cv.notify_all();
    }
}

struct OpenOnDrop(Gate);

impl Drop for OpenOnDrop {
    fn drop(&mut self) {
        self.0.open();
    }
}

/// 실제 시간으로 조건을 기다린다(일반 스레드용, 최대 5초).
fn wait_std(what: &str, mut f: impl FnMut() -> bool) {
    for _ in 0..5_000 {
        if f() {
            return;
        }
        std::thread::sleep(Duration::from_millis(1));
    }
    panic!("기다리던 조건이 오지 않음: {what}");
}

/// 디스크 쓰기가 막혀 있어도(Windows rename 재시도 sleep, 느린 fsync) 추가·진행률·일시정지가 기다리지 않는다.
/// 풀리면 밀린 목록 중 가장 최근 것만 쓴다.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn blocked_jobs_json_write_does_not_hold_state_lock() {
    let dir = tempfile::tempdir().unwrap();
    let fake = FakeBackend::new();
    let gate = Gate::default();
    let _release = OpenOnDrop(gate.clone());
    let writes = Arc::new(AtomicUsize::new(0));
    let store = {
        let gate = gate.clone();
        let writes = Arc::clone(&writes);
        JobStore::new(dir.path().join("data")).with_write_fn(Arc::new(move |p, b| {
            gate.wait();
            writes.fetch_add(1, Ordering::SeqCst);
            atomic_write(p, b)
        }))
    };
    let downloads = dir.path().join("downloads");
    fake.script_for(
        downloads.join("a.mp4"),
        Script::new().bytes(10, Some(100)).wait_cancel(),
    );

    // 잠금 안에서 쓰는 구현이면 여기서 영영 멈추므로 일반 스레드에서 돌리고 시간 제한을 둔다.
    let rt = tokio::runtime::Handle::current();
    let (tx, rx) = std::sync::mpsc::channel();
    {
        let fake = Arc::clone(&fake);
        std::thread::spawn(move || {
            let client: ClientFn<FakeBackend> = Arc::new(move || Arc::clone(&fake));
            let mgr = DownloadManager::open(ManagerConfig {
                client,
                store,
                runtime: rt,
                max_parallel: 1,
                auto_resume: false,
            })
            .unwrap();
            let rec = Recorder::new();
            mgr.subscribe(rec.sink());
            let defaults = JobDefaults {
                download_folder: downloads,
                segment_concurrency: 4,
            };
            let id = mgr.enqueue(request("a"), &defaults).unwrap().id;
            wait_std("진행률", || {
                rec.events()
                    .iter()
                    .any(|e| matches!(e, JobEvent::Progress { .. }))
            });
            mgr.pause(id).unwrap();
            wait_std("멈춤", || {
                mgr.list().iter().any(|j| j.status == JobStatus::Paused)
            });
            let _ = tx.send((mgr, id, rec));
        });
    }
    let got = tokio::task::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(10)))
        .await
        .unwrap();
    let (mgr, id, rec) = got.expect("상태 잠금이 jobs.json 쓰기를 기다렸다");
    assert_eq!(
        rec.trace(id),
        [
            "added:queued",
            "status:running",
            "progress",
            "status:pausing",
            "status:paused"
        ]
    );
    assert_eq!(
        writes.load(Ordering::SeqCst),
        0,
        "문이 닫혀 있는 동안 쓰지 않았다"
    );

    gate.open();
    let m = mgr.clone();
    tokio::task::spawn_blocking(move || m.flush())
        .await
        .unwrap();
    // 밀린 목록은 합쳐진다: 쓰기 스레드가 열 때의 목록을 먼저 집었으면 2번, 늦게 깼으면 가장 최근 것 1번
    let n = writes.load(Ordering::SeqCst);
    assert!(matches!(n, 1..=2), "쓰기 {n}번");
    let v: serde_json::Value =
        serde_json::from_slice(&std::fs::read(dir.path().join("data/jobs.json")).unwrap()).unwrap();
    assert_eq!(v["jobs"][0]["status"], "paused");
    drop(mgr);
}

/// `jobs.json`을 쓰지 못해도 작업은 끝까지 가고 이벤트도 온다. 다시 쓸 수 있게 되면 다음 전이 때 쓴다.
#[tokio::test(start_paused = true)]
async fn jobs_json_write_failure_does_not_stop_jobs() {
    let h = Harness::new(1);
    // 데이터 폴더 자리에 파일을 둬 폴더 만들기부터 실패하게 한다(모든 OS에서 바로 실패, 재시도 sleep 없음).
    let data = h.dir.path().join("data");
    std::fs::remove_dir_all(&data).unwrap();
    std::fs::write(&data, b"not a dir").unwrap();

    h.fake
        .script_for(h.output("a"), Script::new().bytes(5, Some(5)));
    let a = h.enqueue("a").id;
    until("a 완료", || h.status(a) == JobStatus::Completed).await;
    assert_eq!(
        h.rec.trace(a),
        [
            "added:queued",
            "status:running",
            "progress",
            "status:completed"
        ]
    );
    h.mgr.flush();
    assert!(data.is_file(), "쓰지 못했다");

    std::fs::remove_file(&data).unwrap();
    let b = h.enqueue("b").id;
    until("b 완료", || h.status(b) == JobStatus::Completed).await;
    let v = h.jobs_json();
    let st: Vec<_> = v["jobs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|j| {
            (
                j["id"].as_u64().unwrap(),
                j["status"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    assert_eq!(
        st,
        [(a.0, "completed".to_owned()), (b.0, "completed".to_owned())]
    );
}
