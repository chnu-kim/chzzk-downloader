//! 코어 클라이언트 seam(docs/design/app.md §3 "Backend trait").
//!
//! `DownloadManager`는 `Chzzk`를 직접 부르지 않고 이 trait을 거친다. 테스트는 가짜 Backend
//! (`tests/common/fake.rs`)로 진행률·오류·취소를 대본대로 흉내 낸다.
//!
//! - RPITIT에 `+ Send`를 명시한다. 매니저가 future를 `tokio::spawn`하므로 필요하고,
//!   `Chzzk`의 future가 실제로 `Send`인지는 이 impl이 컴파일되는 것으로 고정된다(`tests/backend.rs`도 검사).
//! - `on_progress`는 `&dyn Fn`이다. spawn한 async 블록 안에 `Arc` 클로저를 두고 빌려 넘긴다.

use std::future::Future;

use chzzk_core::chat::{ChatOutcome, ChatProgress, ChatRequest};
use chzzk_core::{
    CancellationToken, Chzzk, ContentRef, DownloadOutcome, DownloadRequest, Error, Progress,
    RangeChunk, Resolved, WatchFail,
};
use url::Url;

/// 셸이 쓰는 코어 동작. 받기 셋(조회·받기·채팅)과 미리보기 중계 둘.
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

    /// 영상 옆에 채팅 기록(과 자막)을 받는다(chat.md §3.2). `.part` 이어받기·재시도·요청 간격은 코어가 한다.
    fn collect_chat(
        &self,
        req: ChatRequest,
        cancel: CancellationToken,
        on_progress: &(dyn Fn(ChatProgress) + Send + Sync),
    ) -> impl Future<Output = Result<ChatOutcome, Error>> + Send;

    /// 미리보기: 업스트림에 닫힌 구간 하나를 요청한다(쿠키 없음, preview.md §4.1).
    fn watch_range(
        &self,
        url: &Url,
        start: u64,
        end_incl: u64,
        expect_total: Option<u64>,
    ) -> impl Future<Output = Result<RangeChunk, WatchFail>> + Send;

    /// 미리보기: playlist·init·세그먼트처럼 통째로 받는 GET(상한 `cap`, PV-5).
    fn watch_bytes(
        &self,
        url: &Url,
        cap: usize,
    ) -> impl Future<Output = Result<Vec<u8>, WatchFail>> + Send;
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

    fn collect_chat(
        &self,
        req: ChatRequest,
        cancel: CancellationToken,
        on_progress: &(dyn Fn(ChatProgress) + Send + Sync),
    ) -> impl Future<Output = Result<ChatOutcome, Error>> + Send {
        Chzzk::collect_chat(self, req, cancel, on_progress)
    }

    fn watch_range(
        &self,
        url: &Url,
        start: u64,
        end_incl: u64,
        expect_total: Option<u64>,
    ) -> impl Future<Output = Result<RangeChunk, WatchFail>> + Send {
        Chzzk::watch_range(self, url, start, end_incl, expect_total)
    }

    fn watch_bytes(
        &self,
        url: &Url,
        cap: usize,
    ) -> impl Future<Output = Result<Vec<u8>, WatchFail>> + Send {
        Chzzk::watch_bytes(self, url, cap)
    }
}
