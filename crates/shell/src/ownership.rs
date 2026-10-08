//! 본인 영상 게이트(worker.md §11.5, app.md §12, 구현 중 변경 A5-1).
//!
//! 판정 채널은 로그인 묶음의 channelId 하나다(`AuthService::signed_in_channel`). 웹뷰가 보낸
//! `EnqueueRequest.channel_id`는 믿지 않는다: 게이트가 최근 resolve 32개의 `컨텐츠 → 컨텐츠 채널 ID`를 들고 있고,
//! 없으면 다시 resolve한다. 캐시에는 판정이 아니라 채널 ID를 두고, 판정은 enqueue 순간의 로그인 채널로 한다.
//! 컨텐츠에 채널 ID가 없으면(`None`) **거부**한다(fail closed). 클립은 코어가 `ownerChannel`을 채널 ID로 쓰므로
//! 제작자는 보지 않는다.

use std::collections::VecDeque;
use std::fmt;
use std::future::Future;
use std::sync::{Arc, Mutex, PoisonError};

use chzzk_core::{ContentMeta, ContentRef, is_own_channel};

use crate::auth::{AuthService, Clock, WorkerApi};
use crate::dto::Ownership;
use crate::error::AppError;

/// 최근 resolve 캐시 크기
pub const RECENT_RESOLVES: usize = 32;

/// SignedIn일 때 본인 판정 채널 ID를 주는 것(앱은 `AuthService`, 테스트는 가짜)
pub trait SignedInChannel: Send + Sync {
    fn signed_in_channel(&self) -> Option<String>;
}

impl<A: WorkerApi, C: Clock> SignedInChannel for AuthService<A, C> {
    fn signed_in_channel(&self) -> Option<String> {
        AuthService::signed_in_channel(self)
    }
}

/// `enqueue` 앞의 본인 영상 검사.
pub struct OwnershipGate {
    auth: Option<Arc<dyn SignedInChannel>>,
    recent: Mutex<VecDeque<(ContentRef, Option<String>)>>,
}

impl fmt::Debug for OwnershipGate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("OwnershipGate")
            .field("enabled", &self.auth.is_some())
            .field("recent", &self.recent_len())
            .finish()
    }
}

impl Default for OwnershipGate {
    fn default() -> Self {
        Self::disabled()
    }
}

impl OwnershipGate {
    /// 로그인을 쓰지 않는 빌드의 게이트(늘 허용, Phase 2 동작)
    pub fn disabled() -> Self {
        OwnershipGate {
            auth: None,
            recent: Mutex::new(VecDeque::new()),
        }
    }

    /// 로그인 채널로 판정하는 게이트
    pub fn enabled(auth: Arc<dyn SignedInChannel>) -> Self {
        OwnershipGate {
            auth: Some(auth),
            recent: Mutex::new(VecDeque::new()),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.auth.is_some()
    }

    fn me(&self) -> Option<String> {
        self.auth.as_ref().and_then(|a| a.signed_in_channel())
    }

    fn recent_len(&self) -> usize {
        self.recent
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .len()
    }

    /// resolve 결과를 기록하고 DTO 판정을 낸다. 꺼진 게이트는 `Unchecked`(기록 안 함), 로그인 아님은 `Unchecked`(기록은 함).
    pub fn on_resolved(&self, content: &ContentRef, meta: &ContentMeta) -> Ownership {
        if self.auth.is_none() {
            return Ownership::Unchecked;
        }
        self.record(content, meta.channel_id.clone());
        let Some(me) = self.me() else {
            return Ownership::Unchecked;
        };
        match is_own_channel(meta.channel_id.as_deref(), &me) {
            Some(true) => Ownership::Own,
            Some(false) => Ownership::NotOwn,
            None => Ownership::Unknown,
        }
    }

    /// `enqueue` 앞의 판정. 꺼진 게이트는 `Ok(None)`(fetch를 부르지 않는다), 로그인 아님은 `notLoggedIn`(fetch 없음).
    /// 캐시에 있으면 그 값, 없으면 `fetch`로 다시 resolve한다(성공만 기록, 오류는 그대로). 허용이면 검증한 컨텐츠 채널 ID.
    pub async fn admit<F, Fut>(
        &self,
        content: &ContentRef,
        fetch: F,
    ) -> Result<Option<String>, AppError>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<Option<String>, AppError>>,
    {
        if self.auth.is_none() {
            return Ok(None);
        }
        // 로그인 채널은 판정 직전에 읽는다(await 앞에서 읽은 값을 오래 들고 있지 않는다)
        if self.me().is_none() {
            return Err(AppError::not_logged_in());
        }
        let owner = match self.cached(content) {
            Some(o) => o,
            None => {
                let o = fetch().await?;
                self.record(content, o.clone());
                o
            }
        };
        let Some(me) = self.me() else {
            return Err(AppError::not_logged_in());
        };
        verdict(is_own_channel(owner.as_deref(), &me))?;
        Ok(owner)
    }

    /// `resume_job` 판정에 쓸 로그인 채널. 꺼진 게이트는 `Ok(None)`(검사 안 함), 로그인 아님은 `notLoggedIn`.
    pub fn resume_owner(&self) -> Result<Option<String>, AppError> {
        if self.auth.is_none() {
            return Ok(None);
        }
        self.me().map(Some).ok_or_else(AppError::not_logged_in)
    }

    fn cached(&self, content: &ContentRef) -> Option<Option<String>> {
        self.recent
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .iter()
            .find(|(c, _)| c == content)
            .map(|(_, o)| o.clone())
    }

    /// 같은 키는 지우고 맨 뒤에 넣는다. 32개를 넘으면 맨 앞을 버린다.
    fn record(&self, content: &ContentRef, owner: Option<String>) {
        let mut q = self.recent.lock().unwrap_or_else(PoisonError::into_inner);
        q.retain(|(c, _)| c != content);
        q.push_back((content.clone(), owner));
        while q.len() > RECENT_RESOLVES {
            q.pop_front();
        }
    }
}

/// 작업의 소유 채널을 로그인 채널과 비교한다(`resume_job`·자동 이어받기).
pub fn check_job_owner(me: &str, job_channel: Option<&str>) -> Result<(), AppError> {
    verdict(is_own_channel(job_channel, me))
}

/// 코어 `is_own_channel` 결과를 허용·거부로 바꾼다. `None`은 거부다.
pub fn verdict(own: Option<bool>) -> Result<(), AppError> {
    match own {
        Some(true) => Ok(()),
        Some(false) => Err(AppError::not_own_content()),
        None => Err(AppError::ownership_unknown()),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use chzzk_core::ContentKind;

    use super::*;
    use crate::error::ErrorCode;

    const A1: &str = "000000000000000000000000000000a1";
    const C3: &str = "000000000000000000000000000000c3";

    struct Me(Mutex<Option<String>>);
    impl Me {
        fn new(v: Option<&str>) -> Arc<Me> {
            Arc::new(Me(Mutex::new(v.map(str::to_string))))
        }
        fn set(&self, v: Option<&str>) {
            *self.0.lock().unwrap() = v.map(str::to_string);
        }
    }
    impl SignedInChannel for Me {
        fn signed_in_channel(&self) -> Option<String> {
            self.0.lock().unwrap().clone()
        }
    }

    fn video(n: u64) -> ContentRef {
        ContentRef::Video { video_no: n }
    }

    fn meta(channel: Option<&str>) -> ContentMeta {
        ContentMeta {
            kind: ContentKind::Video,
            title: "t".into(),
            channel_name: "c".into(),
            channel_id: channel.map(str::to_string),
            live_open_date: None,
            publish_date: None,
            adult: false,
            duration_secs: None,
        }
    }

    async fn admit_with(
        g: &OwnershipGate,
        c: &ContentRef,
        calls: &AtomicUsize,
        owner: Result<Option<&str>, ()>,
    ) -> Result<Option<String>, AppError> {
        g.admit(c, || async {
            calls.fetch_add(1, Ordering::SeqCst);
            match owner {
                Ok(o) => Ok(o.map(str::to_string)),
                Err(()) => Err(AppError::internal("down")),
            }
        })
        .await
    }

    #[tokio::test]
    async fn disabled_gate_passes_without_fetch() {
        let g = OwnershipGate::disabled();
        assert_eq!(
            g.on_resolved(&video(1), &meta(Some(A1))),
            Ownership::Unchecked
        );
        let calls = AtomicUsize::new(0);
        assert_eq!(
            admit_with(&g, &video(1), &calls, Ok(Some(A1)))
                .await
                .unwrap(),
            None
        );
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert_eq!(g.resume_owner().unwrap(), None);
        assert_eq!(g.recent_len(), 0);
    }

    #[test]
    fn on_resolved_classifies_by_signed_in_channel() {
        let me = Me::new(Some(A1));
        let g = OwnershipGate::enabled(me.clone());
        assert_eq!(g.on_resolved(&video(1), &meta(Some(A1))), Ownership::Own);
        assert_eq!(g.on_resolved(&video(2), &meta(Some(C3))), Ownership::NotOwn);
        assert_eq!(g.on_resolved(&video(3), &meta(None)), Ownership::Unknown);
        me.set(None);
        assert_eq!(
            g.on_resolved(&video(4), &meta(Some(A1))),
            Ownership::Unchecked
        );
    }

    #[tokio::test]
    async fn admit_uses_cache_then_fetches_on_miss_once() {
        let g = OwnershipGate::enabled(Me::new(Some(A1)));
        g.on_resolved(&video(1), &meta(Some(A1)));
        let calls = AtomicUsize::new(0);
        let r = admit_with(&g, &video(1), &calls, Ok(Some(C3)))
            .await
            .unwrap();
        assert_eq!(r.as_deref(), Some(A1));
        assert_eq!(calls.load(Ordering::SeqCst), 0);

        let r = admit_with(&g, &video(2), &calls, Ok(Some(A1)))
            .await
            .unwrap();
        assert_eq!(r.as_deref(), Some(A1));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        admit_with(&g, &video(2), &calls, Ok(Some(A1)))
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn admit_rejects_other_unknown_and_signed_out() {
        let me = Me::new(Some(A1));
        let g = OwnershipGate::enabled(me.clone());
        let calls = AtomicUsize::new(0);
        let e = admit_with(&g, &video(1), &calls, Ok(Some(C3)))
            .await
            .unwrap_err();
        assert_eq!(e.code, ErrorCode::NotOwnContent);
        let e = admit_with(&g, &video(2), &calls, Ok(None))
            .await
            .unwrap_err();
        assert_eq!(e.code, ErrorCode::OwnershipUnknown);
        me.set(None);
        let before = calls.load(Ordering::SeqCst);
        let e = admit_with(&g, &video(3), &calls, Ok(Some(A1)))
            .await
            .unwrap_err();
        assert_eq!(e.code, ErrorCode::NotLoggedIn);
        assert_eq!(calls.load(Ordering::SeqCst), before);
    }

    #[tokio::test]
    async fn admit_judges_with_channel_at_enqueue_time() {
        let me = Me::new(Some(A1));
        let g = OwnershipGate::enabled(me.clone());
        assert_eq!(g.on_resolved(&video(1), &meta(Some(A1))), Ownership::Own);
        me.set(Some(C3));
        let calls = AtomicUsize::new(0);
        let e = admit_with(&g, &video(1), &calls, Ok(Some(A1)))
            .await
            .unwrap_err();
        assert_eq!(e.code, ErrorCode::NotOwnContent);
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn admit_fetch_error_is_not_cached() {
        let g = OwnershipGate::enabled(Me::new(Some(A1)));
        let calls = AtomicUsize::new(0);
        let first = admit_with(&g, &video(1), &calls, Err(()))
            .await
            .unwrap_err();
        assert_eq!(first.code, AppError::internal("down").code);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        admit_with(&g, &video(1), &calls, Ok(Some(A1)))
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn cache_keeps_32_latest() {
        let g = OwnershipGate::enabled(Me::new(Some(A1)));
        for n in 1..=33u64 {
            g.on_resolved(&video(n), &meta(Some(A1)));
        }
        let calls = AtomicUsize::new(0);
        admit_with(&g, &video(1), &calls, Ok(Some(A1)))
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        // 1은 방금 다시 기록돼 뒤로 갔다. 2는 밀려났고 나머지 31개(3..=33)와 1이 남아 있다
        for n in 4..=33u64 {
            admit_with(&g, &video(n), &calls, Ok(Some(A1)))
                .await
                .unwrap();
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        // 다시 기록(1) 뒤 32개를 더 넣어도 1이 살아 있으려면 그 사이에 1을 다시 기록해야 한다
        g.on_resolved(&video(1), &meta(Some(A1)));
        for n in 100..131u64 {
            g.on_resolved(&video(n), &meta(Some(A1)));
        }
        admit_with(&g, &video(1), &calls, Ok(Some(A1)))
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn check_job_owner_rules() {
        assert!(check_job_owner(A1, Some("000000000000000000000000000000A1")).is_ok());
        assert_eq!(
            check_job_owner(A1, Some(C3)).unwrap_err().code,
            ErrorCode::NotOwnContent
        );
        assert_eq!(
            check_job_owner(A1, None).unwrap_err().code,
            ErrorCode::OwnershipUnknown
        );
    }

    #[test]
    fn verdict_fails_closed() {
        assert!(verdict(Some(true)).is_ok());
        assert_eq!(
            verdict(Some(false)).unwrap_err().code,
            ErrorCode::NotOwnContent
        );
        assert_eq!(verdict(None).unwrap_err().code, ErrorCode::OwnershipUnknown);
    }
}
