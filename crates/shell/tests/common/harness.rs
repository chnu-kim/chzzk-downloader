//! 매니저 통합 테스트 도구: 가짜 Backend + 임시 폴더 + 기록용 sink.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chzzk_core::{ContentRef, PlaybackKind};
use chzzk_shell::dto::{EnqueueRequest, JobDto, JobEvent, JobStatus, OnExisting};
use chzzk_shell::jobs::JobStore;
use chzzk_shell::manager::ClientFn;
use chzzk_shell::{DownloadManager, JobDefaults, JobId, ManagerConfig};
use tempfile::TempDir;

use super::fake::FakeBackend;

/// 받은 이벤트를 모두 남기는 sink. `alive`를 false로 바꾸면 전송 실패를 흉내 낸다.
#[derive(Clone, Default)]
pub struct Recorder {
    pub events: Arc<Mutex<Vec<JobEvent>>>,
    pub calls: Arc<Mutex<usize>>,
    pub alive: Arc<Mutex<bool>>,
}

impl Recorder {
    pub fn new() -> Self {
        let r = Recorder::default();
        *r.alive.lock().unwrap() = true;
        r
    }

    pub fn sink(&self) -> Box<dyn chzzk_shell::EventSink> {
        let me = self.clone();
        Box::new(move |e: JobEvent| {
            *me.calls.lock().unwrap() += 1;
            if !*me.alive.lock().unwrap() {
                return false;
            }
            me.events.lock().unwrap().push(e);
            true
        })
    }

    pub fn events(&self) -> Vec<JobEvent> {
        self.events.lock().unwrap().clone()
    }

    /// 한 작업의 이벤트를 짧은 이름으로: "added:queued", "status:running", "progress", "removed".
    pub fn trace(&self, id: JobId) -> Vec<String> {
        self.events()
            .into_iter()
            .filter_map(|e| match e {
                JobEvent::Added { job } if job.id == id => {
                    Some(format!("added:{}", status_name(job.status)))
                }
                JobEvent::Status { job } if job.id == id => {
                    Some(format!("status:{}", status_name(job.status)))
                }
                JobEvent::Progress { id: i, .. } if i == id => Some("progress".into()),
                JobEvent::Removed { id: i } if i == id => Some("removed".into()),
                _ => None,
            })
            .collect()
    }
}

pub fn status_name(s: JobStatus) -> String {
    serde_json::to_value(s)
        .unwrap()
        .as_str()
        .unwrap()
        .to_string()
}

/// 필드 순서가 drop 순서다. 매니저(쓰기 스레드)가 임시 폴더보다 먼저 사라져야 지운 폴더를 다시 만들지 않는다.
pub struct Harness {
    pub mgr: DownloadManager<FakeBackend>,
    pub fake: Arc<FakeBackend>,
    pub rec: Recorder,
    pub dir: TempDir,
}

impl Harness {
    /// 현재 tokio 런타임에서 동시 작업 수 `parallel`로 매니저를 연다.
    pub fn new(parallel: u8) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let fake = FakeBackend::new();
        let mgr = open(dir.path(), &fake, parallel);
        let rec = Recorder::new();
        mgr.subscribe(rec.sink());
        Harness {
            mgr,
            fake,
            rec,
            dir,
        }
    }

    /// 같은 데이터 폴더로 매니저를 다시 연다(앱 재시작). 지금 매니저의 밀린 쓰기를 먼저 끝낸다.
    pub fn reopen(&self, parallel: u8) -> DownloadManager<FakeBackend> {
        self.mgr.flush();
        open(self.dir.path(), &self.fake, parallel)
    }

    pub fn downloads(&self) -> PathBuf {
        self.dir.path().join("downloads")
    }

    pub fn defaults(&self) -> JobDefaults {
        JobDefaults {
            download_folder: self.downloads(),
            segment_concurrency: 4,
        }
    }

    /// 파일 이름 `name`의 최종 경로.
    pub fn output(&self, name: &str) -> PathBuf {
        self.downloads().join(format!("{name}.mp4"))
    }

    pub fn enqueue(&self, name: &str) -> JobDto {
        self.mgr
            .enqueue(request(name), &self.defaults())
            .unwrap_or_else(|e| panic!("{name}: {e:?}"))
    }

    pub fn job(&self, id: JobId) -> JobDto {
        self.mgr
            .list()
            .into_iter()
            .find(|j| j.id == id)
            .unwrap_or_else(|| panic!("작업 {id:?} 없음"))
    }

    pub fn status(&self, id: JobId) -> JobStatus {
        self.job(id).status
    }

    /// 매니저의 밀린 쓰기를 끝낸 뒤 `jobs.json`을 읽는다.
    pub fn jobs_json(&self) -> serde_json::Value {
        self.mgr.flush();
        serde_json::from_slice(&std::fs::read(self.dir.path().join("data/jobs.json")).unwrap())
            .unwrap()
    }
}

fn open(dir: &Path, fake: &Arc<FakeBackend>, parallel: u8) -> DownloadManager<FakeBackend> {
    open_with(dir, fake, parallel, false)
}

pub fn open_with(
    dir: &Path,
    fake: &Arc<FakeBackend>,
    parallel: u8,
    auto_resume: bool,
) -> DownloadManager<FakeBackend> {
    open_store(JobStore::new(dir.join("data")), fake, parallel, auto_resume)
}

/// `store`로 매니저를 연다. 열 때 쓴 목록이 디스크에 닿은 뒤 돌려준다.
pub fn open_store(
    store: JobStore,
    fake: &Arc<FakeBackend>,
    parallel: u8,
    auto_resume: bool,
) -> DownloadManager<FakeBackend> {
    let f = Arc::clone(fake);
    let client: ClientFn<FakeBackend> = Arc::new(move || Arc::clone(&f));
    let mgr = DownloadManager::open(ManagerConfig {
        client,
        store,
        runtime: tokio::runtime::Handle::current(),
        max_parallel: parallel,
        auto_resume,
    })
    .unwrap();
    mgr.flush();
    mgr
}

/// 파일 이름 `name`, 기본 폴더로 받는 요청.
pub fn request(name: &str) -> EnqueueRequest {
    EnqueueRequest {
        url: "https://chzzk.naver.com/video/1".into(),
        content: ContentRef::Video { video_no: 1 },
        title: format!("제목 {name}"),
        channel_name: "채널".into(),
        channel_id: Some("ch".into()),
        quality_id: "720p".into(),
        quality_label: "720p".into(),
        expected_kind: PlaybackKind::LiveRewindHls,
        folder: None,
        file_name: name.into(),
        on_existing: OnExisting::Overwrite,
        restart: false,
        content_date: None,
    }
}

/// 조건이 맞을 때까지 가상 시간을 1ms씩 흘리며 기다린다(`start_paused` 런타임 전제, 최대 가상 30초).
pub async fn until(what: &str, mut f: impl FnMut() -> bool) {
    for _ in 0..30_000 {
        if f() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
    panic!("기다리던 조건이 오지 않음: {what}");
}

/// 남은 태스크가 한 바퀴 돌게 한다.
pub async fn settle() {
    for _ in 0..50 {
        tokio::task::yield_now().await;
    }
}
