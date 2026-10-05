//! 코어 클라이언트 seam(docs/design/app.md §3 "Backend trait").
//!
//! `DownloadManager`는 `Chzzk`를 직접 부르지 않고 이 trait을 거친다. 테스트는 가짜 Backend
//! (`tests/common/fake.rs`)로 진행률·오류·취소를 대본대로 흉내 낸다.
//!
//! - RPITIT에 `+ Send`를 명시한다. 매니저가 future를 `tokio::spawn`하므로 필요하고,
//!   `Chzzk`의 future가 실제로 `Send`인지는 이 impl이 컴파일되는 것으로 고정된다(`tests/backend.rs`도 검사).
//! - `on_progress`는 `&dyn Fn`이다. spawn한 async 블록 안에 `Arc` 클로저를 두고 빌려 넘긴다.

use std::future::Future;

use chzzk_core::{
    CancellationToken, Chzzk, ContentRef, DownloadOutcome, DownloadRequest, Error, Progress,
    Resolved,
};

/// 셸이 쓰는 코어 동작 두 가지.
pub trait Backend: Send + Sync + 'static {
    /// 컨텐츠 정보와 화질 목록을 가져온다.
    fn resolve(&self, c: &ContentRef) -> impl Future<Output = Result<Resolved, Error>> + Send;

    /// 한 건을 받는다. `.part` 이어받기·취소·진행률 스로틀은 코어가 한다.
    fn download(
        &self,
        req: DownloadRequest,
        cancel: CancellationToken,
        on_progress: &(dyn Fn(Progress) + Send + Sync),
    ) -> impl Future<Output = Result<DownloadOutcome, Error>> + Send;
}

impl Backend for Chzzk {
    fn resolve(&self, c: &ContentRef) -> impl Future<Output = Result<Resolved, Error>> + Send {
        Chzzk::resolve(self, c)
    }

    fn download(
        &self,
        req: DownloadRequest,
        cancel: CancellationToken,
        on_progress: &(dyn Fn(Progress) + Send + Sync),
    ) -> impl Future<Output = Result<DownloadOutcome, Error>> + Send {
        Chzzk::download(self, req, cancel, on_progress)
    }
}
