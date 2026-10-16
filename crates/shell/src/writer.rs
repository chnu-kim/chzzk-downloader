//! `jobs.json` 쓰기 스레드.
//!
//! 매니저는 상태 잠금 안에서 목록을 바이트로 만들어 `submit`만 하고, 실제 쓰기(`fsync`, Windows rename 재시도의
//! 최대 3초 sleep)는 이 스레드가 잠금 밖에서 한다. 그래서 디스크가 느려도 진행률 콜백(런타임 워커)과 command가
//! 상태 잠금에서 기다리지 않는다.
//!
//! - 쓰기 스레드는 하나이고 **가장 최근 것만** 남긴다(밀린 사이의 중간 상태는 건너뛴다). 제출은 상태 잠금 안에서
//!   하므로 제출 순서가 곧 전이 순서이고, 오래된 목록이 새 목록을 덮어쓰는 일은 없다.
//! - 쓰기 실패는 로그만 남긴다. 다음 제출 때 다시 쓴다.
//! - `flush`는 부른 시점까지 제출된 목록의 쓰기 **시도**가 끝날 때까지 기다린다(실패해도 돌아온다).
//!   `flush_checked`는 같이 기다리고, 그 시점 이후 제출분의 쓰기가 성공했는지 돌려준다. 새 생방송 녹화가 주인 기록을
//!   저장한 뒤에만 시작하는 데 쓴다(core.md 61, Codex PR #113 ③).
//! - 버리면(`Drop`) 남은 것을 쓰고 스레드를 끝낸다.

use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;

use crate::error::AppError;
use crate::jobs::JobStore;

#[derive(Default)]
struct State {
    pending: Option<Vec<u8>>,
    /// 지금까지 제출한 수
    submitted: u64,
    /// 쓰기를 시도한 마지막 제출 번호
    attempted: u64,
    /// 쓰기에 성공한 마지막 제출 번호
    saved: u64,
    /// 마지막 쓰기 실패(성공하면 비운다)
    last_error: Option<AppError>,
    closed: bool,
}

struct Shared {
    state: Mutex<State>,
    cv: Condvar,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn wait<'a>(&self, g: MutexGuard<'a, State>) -> MutexGuard<'a, State> {
        self.cv.wait(g).unwrap_or_else(|e| e.into_inner())
    }
}

/// 쓰기 스레드 손잡이. `flush`용 `Flusher`를 따로 떼어 줄 수 있다.
pub(crate) struct JobsWriter {
    shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
}

/// 쓰기 스레드를 기다리는 손잡이(`'static`이라 `spawn_blocking`에 넘길 수 있다).
#[derive(Clone)]
pub(crate) struct Flusher(Arc<Shared>);

impl Flusher {
    /// 지금까지 제출된 목록의 쓰기 시도가 끝날 때까지 막는다. async 문맥에서는 `spawn_blocking`으로 부른다.
    pub(crate) fn flush(&self) {
        let mut g = self.0.lock();
        let target = g.submitted;
        while g.attempted < target {
            g = self.0.wait(g);
        }
    }

    /// `flush`처럼 기다리고, 부른 시점까지의 제출이 디스크에 닿았는지 돌려준다. 그 뒤 제출분(더 최근 목록)의 성공도
    /// 성공으로 센다(쓰기 스레드는 가장 최근 것만 쓴다). 실패면 마지막 쓰기 오류다.
    pub(crate) fn flush_checked(&self) -> Result<(), AppError> {
        let mut g = self.0.lock();
        let target = g.submitted;
        while g.attempted < target {
            g = self.0.wait(g);
        }
        if g.saved >= target {
            Ok(())
        } else {
            Err(g
                .last_error
                .clone()
                .unwrap_or_else(|| AppError::internal("작업 목록을 저장하지 못했습니다")))
        }
    }
}

impl JobsWriter {
    pub(crate) fn spawn(store: JobStore) -> Self {
        let shared = Arc::new(Shared {
            state: Mutex::new(State::default()),
            cv: Condvar::new(),
        });
        let s = Arc::clone(&shared);
        let thread = std::thread::Builder::new()
            .name("jobs-writer".into())
            .spawn(move || run(&s, &store))
            .expect("jobs.json 쓰기 스레드를 띄우지 못했다");
        JobsWriter {
            shared,
            thread: Some(thread),
        }
    }

    /// 쓸 목록을 넘긴다(앞서 밀린 것은 버린다). 막지 않는다.
    pub(crate) fn submit(&self, bytes: Vec<u8>) {
        let mut g = self.shared.lock();
        g.pending = Some(bytes);
        g.submitted += 1;
        self.shared.cv.notify_all();
    }

    pub(crate) fn flusher(&self) -> Flusher {
        Flusher(Arc::clone(&self.shared))
    }
}

impl Drop for JobsWriter {
    fn drop(&mut self) {
        self.shared.lock().closed = true;
        self.shared.cv.notify_all();
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

fn run(shared: &Shared, store: &JobStore) {
    let mut g = shared.lock();
    loop {
        while g.pending.is_none() && !g.closed {
            g = shared.wait(g);
        }
        let Some(bytes) = g.pending.take() else {
            // 닫혔고 남은 것이 없다
            return;
        };
        let n = g.submitted;
        drop(g);
        let res = store.write_bytes(&bytes);
        if let Err(e) = &res {
            tracing::warn!(error = %e, path = %store.path().display(), "작업 목록을 저장하지 못했다");
        }
        g = shared.lock();
        g.attempted = n;
        match res {
            Ok(()) => {
                g.saved = n;
                g.last_error = None;
            }
            Err(e) => g.last_error = Some(AppError::from(&e)),
        }
        shared.cv.notify_all();
    }
}
