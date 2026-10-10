//! 본인 영상 게이트(worker.md §11.5, app.md §12, 구현 중 변경 82).
//!
//! 판정 채널은 로그인 묶음의 channelId 하나다(`AuthService::signed_in_channel`). 웹뷰가 보낸
//! `EnqueueRequest.channel_id`는 믿지 않는다: 게이트가 최근 resolve 32개의 `컨텐츠 → 컨텐츠 채널 ID`를 들고 있고,
//! 없으면 다시 resolve한다. 캐시에는 판정이 아니라 채널 ID를 두고, 판정은 enqueue 순간의 로그인 채널로 한다.
//! 컨텐츠에 채널 ID가 없으면(`None`) **거부**한다(fail closed). 클립은 코어가 `ownerChannel`을 채널 ID로 쓰므로
//! 제작자는 보지 않는다.
//!
//! 관리자(로그인 묶음의 `isAdmin`)는 채널과 상관없이 허용한다(worker.md 구현 중 변경 102). 판정 값은 남의 영상·채널 모름
//! 모두 `AdminOverride`이고, 허용할 때도 컨텐츠 채널 ID를 그대로 돌려줘 작업 기록에 실제 채널이 남는다.

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

/// SignedIn일 때의 판정 주체. 채널 ID와 관리자 여부를 한 번에 읽는다(계정이 바뀌는 사이에 섞이지 않게)
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Signer {
    /// 본인 판정 채널 ID
    pub channel_id: String,
    /// 관리자면 채널과 상관없이 허용
    pub is_admin: bool,
}

/// SignedIn일 때 판정 주체를 주는 것(앱은 `AuthService`, 테스트는 가짜)
pub trait SignedInChannel: Send + Sync {
    fn signed_in(&self) -> Option<Signer>;
}

impl<A: WorkerApi, C: Clock> SignedInChannel for AuthService<A, C> {
    fn signed_in(&self) -> Option<Signer> {
        AuthService::signer(self)
    }
}

/// `enqueue`·`resume_job` 앞의 본인 영상 검사.
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

    fn me(&self) -> Option<Signer> {
        self.auth.as_ref().and_then(|a| a.signed_in())
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
        match is_own_channel(meta.channel_id.as_deref(), &me.channel_id) {
            Some(true) => Ownership::Own,
            _ if me.is_admin => Ownership::AdminOverride,
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
        if !me.is_admin {
            verdict(is_own_channel(owner.as_deref(), &me.channel_id))?;
        }
        Ok(owner)
    }

    /// 캐시에 있는 그 컨텐츠의 채널 ID(없거나 채널 ID가 없으면 `None`). 거부한 판정 뒤 기록을 고칠 때 쓴다
    pub fn known_channel(&self, content: &ContentRef) -> Option<String> {
        self.cached(content).flatten()
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

    struct Me(Mutex<Option<Signer>>);
    impl Me {
        fn new(v: Option<&str>) -> Arc<Me> {
            let me = Arc::new(Me(Mutex::new(None)));
            me.set(v);
            me
        }
        fn admin(v: &str) -> Arc<Me> {
            let me = Me::new(None);
            me.set_admin(Some(v));
            me
        }
        fn set(&self, v: Option<&str>) {
            self.put(v, false);
        }
        fn set_admin(&self, v: Option<&str>) {
            self.put(v, true);
        }
        fn put(&self, v: Option<&str>, is_admin: bool) {
            *self.0.lock().unwrap() = v.map(|c| Signer {
                channel_id: c.to_string(),
                is_admin,
            });
        }
    }
    impl SignedInChannel for Me {
        fn signed_in(&self) -> Option<Signer> {
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
    fn on_resolved_marks_admin_override_for_other_and_unknown() {
        let g = OwnershipGate::enabled(Me::admin(A1));
        assert_eq!(g.on_resolved(&video(1), &meta(Some(A1))), Ownership::Own);
        assert_eq!(
            g.on_resolved(&video(2), &meta(Some(C3))),
            Ownership::AdminOverride
        );
        assert_eq!(
            g.on_resolved(&video(3), &meta(None)),
            Ownership::AdminOverride
        );
    }

    #[tokio::test]
    async fn admin_admits_other_and_unknown_with_real_channel() {
        let g = OwnershipGate::enabled(Me::admin(A1));
        let calls = AtomicUsize::new(0);
        let r = admit_with(&g, &video(1), &calls, Ok(Some(C3)))
            .await
            .unwrap();
        // 허용해도 기록에는 실제 컨텐츠 채널이 남는다
        assert_eq!(r.as_deref(), Some(C3));
        let r = admit_with(&g, &video(2), &calls, Ok(None)).await.unwrap();
        assert_eq!(r, None);
    }

    #[tokio::test]
    async fn admin_loses_override_when_signer_changes_before_judging() {
        let me = Me::admin(A1);
        let g = OwnershipGate::enabled(me.clone());
        let calls = AtomicUsize::new(0);
        // 다시 resolve하는 사이에 관리자가 아닌 다른 채널로 바뀌면 판정 순간의 주체로 거부한다
        let e = g
            .admit(&video(1), || async {
                calls.fetch_add(1, Ordering::SeqCst);
                me.set(Some(C3));
                Ok(Some(A1.to_string()))
            })
            .await
            .unwrap_err();
        assert_eq!(e.code, ErrorCode::NotOwnContent);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
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
