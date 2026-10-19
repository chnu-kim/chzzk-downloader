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
//!
//! 맡은 채널(`Delegated`, 편집자 위임)의 영상·클립은 받을 수 있다. 판정 표는 `classify` 하나이고 순서는
//! Own > Delegated > AdminOverride > NotOwn/Unknown이다. 생방송은 v1에서 맡은 채널로 받지 않는다(L-D1 (A)).
//! 판정 직전 확인(`admit_checked`의 `recheck`)은 게이트가 아니라 호출자(App)가 클로저로 주입한다.

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
    /// 디스크 세션은 관리자라고 하지만 이번 실행에서 서버가 아직 확인하지 않았다(`is_admin`은 false).
    /// 남의 영상·채널 모름이면 판정 직전 확인(`recheck`)이 서버에 묻는다(cli-mode.md §5.2)
    pub admin_pending: bool,
    /// 맡은 채널(주인의 판정용 채널 ID, 소문자 32 hex). SignedIn이면 오프라인 유예 중에도 디스크 목록 그대로(신뢰 수준 (b))
    pub delegated: Arc<[String]>,
}

impl Signer {
    /// 이 채널을 맡았는가(대소문자 무시)
    pub fn delegates(&self, channel: &str) -> bool {
        self.delegated
            .iter()
            .any(|d| d.eq_ignore_ascii_case(channel))
    }
}

/// 판정 표(delegation.md §9.1). 생방송은 v1에서 맡은 채널로 받지 않는다(L-D1 (A)): Live면 delegated를 보지 않는다
pub fn classify(content: &ContentRef, channel: Option<&str>, me: &Signer) -> Ownership {
    let own = is_own_channel(channel, &me.channel_id);
    let delegated =
        !matches!(content, ContentRef::Live { .. }) && channel.is_some_and(|c| me.delegates(c));
    match own {
        Some(true) => Ownership::Own,
        _ if delegated => Ownership::Delegated,
        _ if me.is_admin => Ownership::AdminOverride,
        Some(false) => Ownership::NotOwn,
        None => Ownership::Unknown,
    }
}

/// 판정 → 허용·거부. Own·Delegated·AdminOverride는 허용, NotOwn은 notOwnContent, 그 밖은 ownershipUnknown(fail closed)
pub fn verdict_in(o: Ownership) -> Result<(), AppError> {
    match o {
        Ownership::Own | Ownership::Delegated | Ownership::AdminOverride => Ok(()),
        Ownership::NotOwn => Err(AppError::not_own_content()),
        Ownership::Unknown | Ownership::Unchecked => Err(AppError::ownership_unknown()),
    }
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

    /// 지금 판정 주체가 있는가(SignedIn). 꺼진 게이트는 false
    pub fn has_signer(&self) -> bool {
        self.me().is_some()
    }

    fn me(&self) -> Option<Signer> {
        self.auth.as_ref().and_then(|a| a.signed_in())
    }

    /// 지금 판정 주체(SignedIn). 꺼진 게이트나 로그인 아님은 `None`. 미리보기 scheme 요청이 요청마다 읽는다(preview.md PV6)
    pub fn signer(&self) -> Option<Signer> {
        self.me()
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
        classify(content, meta.channel_id.as_deref(), &me)
    }

    /// 판정 직전에 서버에서 다시 확인해야 하는가. 로그인 켜짐·비관리자일 때
    /// - 맡은 채널: Delegated(디스크 목록에만 남은 회수를 잡는다)와 NotOwn(방금 맡은 채널을 잡는다), 생방송 아님
    /// - 관리자 미확인(`admin_pending`): NotOwn·Unknown이면 관리자 예외가 판정을 바꿀 수 있다(생방송 포함)
    pub fn needs_recheck(&self, verdict: Ownership, content: &ContentRef) -> bool {
        self.auth.is_some()
            && self.me().is_some_and(|m| {
                !m.is_admin
                    && ((m.admin_pending
                        && matches!(verdict, Ownership::NotOwn | Ownership::Unknown))
                        || (matches!(verdict, Ownership::Delegated | Ownership::NotOwn)
                            && !matches!(content, ContentRef::Live { .. })))
            })
    }

    /// `enqueue` 앞의 판정(판정 직전 확인 없음). `admit_checked`에 빈 확인을 준 것과 같다
    pub async fn admit<F, Fut>(
        &self,
        content: &ContentRef,
        fetch: F,
    ) -> Result<Option<String>, AppError>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<Option<String>, AppError>>,
    {
        self.admit_checked(content, fetch, || async {}).await
    }

    /// `enqueue` 앞의 판정. 꺼진 게이트는 `Ok(None)`(fetch를 부르지 않는다), 로그인 아님은 `notLoggedIn`(fetch 없음).
    /// 캐시에 있으면 그 값, 없으면 `fetch`로 다시 resolve한다(성공만 기록, 오류는 그대로). 판정이 확인 대상이면
    /// (`needs_recheck`) `recheck`를 기다린 뒤 최신 목록으로 다시 판정한다. 허용이면 검증한 컨텐츠 채널 ID.
    pub async fn admit_checked<F, Fut, R, RFut>(
        &self,
        content: &ContentRef,
        fetch: F,
        recheck: R,
    ) -> Result<Option<String>, AppError>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<Option<String>, AppError>>,
        R: FnOnce() -> RFut,
        RFut: Future<Output = ()>,
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
        let mut v = classify(content, owner.as_deref(), &me);
        if self.needs_recheck(v, content) {
            recheck().await;
            // 확인 중에 로그아웃·거부됐으면 판정할 주체가 없다
            let Some(me) = self.me() else {
                return Err(AppError::not_logged_in());
            };
            v = classify(content, owner.as_deref(), &me);
        }
        verdict_in(v)?;
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
    const D4: &str = "000000000000000000000000000000d4";

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
        /// 나(`me`)가 `delegated` 채널들을 맡은 편집자
        fn editor(me: &str, delegated: &[&str]) -> Arc<Me> {
            let m = Me::new(Some(me));
            m.set_delegated(delegated);
            m
        }
        fn set_delegated(&self, delegated: &[&str]) {
            if let Some(s) = self.0.lock().unwrap().as_mut() {
                s.delegated = delegated.iter().map(|d| d.to_string()).collect();
            }
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
                admin_pending: false,
                delegated: Arc::from(Vec::<String>::new()),
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

    #[tokio::test]
    async fn admin_signed_out_is_unchecked_and_not_logged_in_without_fetch() {
        let me = Me::admin(A1);
        let g = OwnershipGate::enabled(me.clone());
        me.set_admin(None);
        assert_eq!(
            g.on_resolved(&video(1), &meta(Some(C3))),
            Ownership::Unchecked
        );
        let calls = AtomicUsize::new(0);
        let e = admit_with(&g, &video(2), &calls, Ok(Some(C3)))
            .await
            .unwrap_err();
        assert_eq!(e.code, ErrorCode::NotLoggedIn);
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn demoted_admin_is_rejected_from_next_judgement_even_with_cached_channel() {
        let me = Me::admin(A1);
        let g = OwnershipGate::enabled(me.clone());
        assert_eq!(
            g.on_resolved(&video(1), &meta(Some(C3))),
            Ownership::AdminOverride
        );
        assert_eq!(
            g.on_resolved(&video(2), &meta(None)),
            Ownership::AdminOverride
        );
        // 캐시에는 채널만 있고 판정은 그 순간의 주체로 한다
        me.set(Some(A1));
        let calls = AtomicUsize::new(0);
        let e = admit_with(&g, &video(1), &calls, Ok(Some(C3)))
            .await
            .unwrap_err();
        assert_eq!(e.code, ErrorCode::NotOwnContent);
        let e = admit_with(&g, &video(2), &calls, Ok(None))
            .await
            .unwrap_err();
        assert_eq!(e.code, ErrorCode::OwnershipUnknown);
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert_eq!(g.on_resolved(&video(1), &meta(Some(C3))), Ownership::NotOwn);
        assert_eq!(g.on_resolved(&video(2), &meta(None)), Ownership::Unknown);
    }

    #[tokio::test]
    async fn admin_fetch_error_stays_error_and_is_not_cached() {
        let g = OwnershipGate::enabled(Me::admin(A1));
        let calls = AtomicUsize::new(0);
        let e = admit_with(&g, &video(1), &calls, Err(()))
            .await
            .unwrap_err();
        assert_eq!(e.code, AppError::internal("down").code);
        assert_eq!(g.known_channel(&video(1)), None);
        admit_with(&g, &video(1), &calls, Ok(Some(C3)))
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!(g.known_channel(&video(1)).as_deref(), Some(C3));
    }

    #[tokio::test]
    async fn disabled_gate_ignores_admin_concept() {
        let g = OwnershipGate::disabled();
        assert_eq!(
            g.on_resolved(&video(1), &meta(Some(C3))),
            Ownership::Unchecked
        );
        let calls = AtomicUsize::new(0);
        assert_eq!(
            admit_with(&g, &video(1), &calls, Ok(Some(C3)))
                .await
                .unwrap(),
            None
        );
        assert_eq!(calls.load(Ordering::SeqCst), 0);
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

    fn live(ch: &str) -> ContentRef {
        ContentRef::Live {
            channel_id: ch.to_string(),
        }
    }

    fn clip(id: &str) -> ContentRef {
        ContentRef::Clip {
            clip_id: id.to_string(),
        }
    }

    /// recheck 호출 수를 세고 `act`를 실행하는 admit
    async fn admit_counting(
        g: &OwnershipGate,
        c: &ContentRef,
        owner: Option<&str>,
        rechecks: &AtomicUsize,
        act: impl FnOnce(),
    ) -> Result<Option<String>, AppError> {
        g.admit_checked(
            c,
            || async { Ok(owner.map(str::to_string)) },
            || async {
                rechecks.fetch_add(1, Ordering::SeqCst);
                act();
            },
        )
        .await
    }

    #[test]
    fn o1_classify_table() {
        let mine = Signer {
            channel_id: A1.into(),
            is_admin: false,
            admin_pending: false,
            delegated: Arc::from(vec![D4.to_string()]),
        };
        let admin = Signer {
            is_admin: true,
            ..mine.clone()
        };
        assert_eq!(classify(&video(1), Some(A1), &mine), Ownership::Own);
        assert_eq!(classify(&video(1), Some(D4), &mine), Ownership::Delegated);
        assert_eq!(classify(&clip("c"), Some(D4), &mine), Ownership::Delegated);
        assert_eq!(classify(&video(1), Some(C3), &mine), Ownership::NotOwn);
        assert_eq!(classify(&video(1), None, &mine), Ownership::Unknown);
        assert_eq!(
            classify(&video(1), Some(C3), &admin),
            Ownership::AdminOverride
        );
        assert_eq!(classify(&video(1), None, &admin), Ownership::AdminOverride);
        // 관리자라도 맡은 채널이면 Delegated(Own > Delegated > AdminOverride)
        assert_eq!(classify(&video(1), Some(D4), &admin), Ownership::Delegated);
        assert_eq!(classify(&video(1), Some(A1), &admin), Ownership::Own);
        // 대소문자 무시
        assert_eq!(
            classify(&video(1), Some(&D4.to_uppercase()), &mine),
            Ownership::Delegated
        );
    }

    #[test]
    fn o2_live_never_delegated() {
        let mine = Signer {
            channel_id: A1.into(),
            is_admin: false,
            admin_pending: false,
            delegated: Arc::from(vec![D4.to_string()]),
        };
        let admin = Signer {
            is_admin: true,
            ..mine.clone()
        };
        assert_eq!(classify(&live(D4), Some(D4), &mine), Ownership::NotOwn);
        assert_eq!(
            classify(&live(D4), Some(D4), &admin),
            Ownership::AdminOverride
        );
        // 본인 채널의 생방송은 그대로 Own
        assert_eq!(classify(&live(A1), Some(A1), &mine), Ownership::Own);
    }

    #[tokio::test]
    async fn o3_admit_delegated_returns_owner() {
        let g = OwnershipGate::enabled(Me::editor(A1, &[D4]));
        let calls = AtomicUsize::new(0);
        let r = admit_with(&g, &video(1), &calls, Ok(Some(D4)))
            .await
            .unwrap();
        assert_eq!(r.as_deref(), Some(D4));
        assert_eq!(
            g.on_resolved(&video(1), &meta(Some(D4))),
            Ownership::Delegated
        );
    }

    #[tokio::test]
    async fn o4_admit_live_delegated_rejected() {
        let g = OwnershipGate::enabled(Me::editor(A1, &[D4]));
        let calls = AtomicUsize::new(0);
        let e = admit_with(&g, &live(D4), &calls, Ok(Some(D4)))
            .await
            .unwrap_err();
        assert_eq!(e.code, ErrorCode::NotOwnContent);
        // 관리자는 허용
        let me = Me::admin(A1);
        me.set_delegated(&[D4]);
        let g = OwnershipGate::enabled(me);
        admit_with(&g, &live(D4), &calls, Ok(Some(D4)))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn o5_recheck_runs_only_when_needed() {
        let rechecks = AtomicUsize::new(0);
        let run = |g: OwnershipGate, c: ContentRef, owner: Option<&'static str>| {
            let rechecks = &rechecks;
            async move {
                let before = rechecks.load(Ordering::SeqCst);
                let _ = admit_counting(&g, &c, owner, rechecks, || {}).await;
                rechecks.load(Ordering::SeqCst) - before
            }
        };
        let editor = || OwnershipGate::enabled(Me::editor(A1, &[D4]));
        // Delegated·NotOwn은 확인한다
        assert_eq!(run(editor(), video(1), Some(D4)).await, 1);
        assert_eq!(run(editor(), video(2), Some(C3)).await, 1);
        // Own·채널 모름·관리자·생방송은 확인하지 않는다
        assert_eq!(run(editor(), video(3), Some(A1)).await, 0);
        assert_eq!(run(editor(), video(4), None).await, 0);
        assert_eq!(run(editor(), live(D4), Some(D4)).await, 0);
        let admin = Me::admin(A1);
        assert_eq!(
            run(OwnershipGate::enabled(admin), video(5), Some(C3)).await,
            0
        );
        // 꺼진 게이트
        assert_eq!(run(OwnershipGate::disabled(), video(6), Some(D4)).await, 0);
    }

    #[tokio::test]
    async fn o6_recheck_revocation_applies() {
        let me = Me::editor(A1, &[D4]);
        let g = OwnershipGate::enabled(me.clone());
        let rechecks = AtomicUsize::new(0);
        let e = admit_counting(&g, &video(1), Some(D4), &rechecks, || me.set_delegated(&[]))
            .await
            .unwrap_err();
        assert_eq!(e.code, ErrorCode::NotOwnContent);
    }

    #[tokio::test]
    async fn o7_recheck_grant_applies() {
        let me = Me::editor(A1, &[]);
        let g = OwnershipGate::enabled(me.clone());
        let rechecks = AtomicUsize::new(0);
        let r = admit_counting(&g, &video(1), Some(C3), &rechecks, || {
            me.set_delegated(&[C3])
        })
        .await
        .unwrap();
        assert_eq!(r.as_deref(), Some(C3));
    }

    #[tokio::test]
    async fn o8_recheck_sign_out_is_not_logged_in() {
        let me = Me::editor(A1, &[D4]);
        let g = OwnershipGate::enabled(me.clone());
        let rechecks = AtomicUsize::new(0);
        let e = admit_counting(&g, &video(1), Some(D4), &rechecks, || me.set(None))
            .await
            .unwrap_err();
        assert_eq!(e.code, ErrorCode::NotLoggedIn);
    }

    /// 확인 중에 다른 계정으로 바뀌면 새 주체 기준으로 다시 판정한다(세션 세대, delegation.md §14)
    #[tokio::test]
    async fn o10_recheck_account_switch_uses_new_signer() {
        let rechecks = AtomicUsize::new(0);
        // A1이 D4를 맡았다가 C3(맡은 채널 없음)으로 바뀜 → 남의 영상
        let me = Me::editor(A1, &[D4]);
        let g = OwnershipGate::enabled(me.clone());
        let e = admit_counting(&g, &video(1), Some(D4), &rechecks, || me.set(Some(C3)))
            .await
            .unwrap_err();
        assert_eq!(e.code, ErrorCode::NotOwnContent);
        // A1(맡은 채널 없음)의 남의 영상 C3 → C3 본인으로 바뀜 → 본인 영상
        let me = Me::editor(A1, &[]);
        let g = OwnershipGate::enabled(me.clone());
        let r = admit_counting(&g, &video(2), Some(C3), &rechecks, || me.set(Some(C3)))
            .await
            .unwrap();
        assert_eq!(r.as_deref(), Some(C3));
        // A1(맡은 채널 없음)의 남의 영상 D4 → D4를 맡은 C3으로 바뀜 → 맡은 채널
        let me = Me::editor(A1, &[]);
        let g = OwnershipGate::enabled(me.clone());
        let r = admit_counting(&g, &video(3), Some(D4), &rechecks, || {
            me.set(Some(C3));
            me.set_delegated(&[D4]);
        })
        .await
        .unwrap();
        assert_eq!(r.as_deref(), Some(D4));
        assert_eq!(
            g.on_resolved(&video(3), &meta(Some(D4))),
            Ownership::Delegated
        );
    }

    #[test]
    fn o9_needs_recheck_table() {
        let g = OwnershipGate::enabled(Me::editor(A1, &[D4]));
        let v = video(1);
        for (verdict, want) in [
            (Ownership::Delegated, true),
            (Ownership::NotOwn, true),
            (Ownership::Own, false),
            (Ownership::AdminOverride, false),
            (Ownership::Unknown, false),
            (Ownership::Unchecked, false),
        ] {
            assert_eq!(g.needs_recheck(verdict, &v), want, "{verdict:?}");
        }
        assert!(!g.needs_recheck(Ownership::Delegated, &live(D4)));
        assert!(!g.needs_recheck(Ownership::NotOwn, &live(D4)));
        // 관리자·로그아웃·꺼진 게이트
        let admin = Me::admin(A1);
        assert!(!OwnershipGate::enabled(admin).needs_recheck(Ownership::NotOwn, &v));
        let out = Me::new(None);
        assert!(!OwnershipGate::enabled(out).needs_recheck(Ownership::NotOwn, &v));
        assert!(!OwnershipGate::disabled().needs_recheck(Ownership::NotOwn, &v));
        // 관리자 미확인(디스크만 관리자): 남의 영상·채널 모름은 생방송이어도 서버에 묻는다. 내 영상·맡은 채널 생방송은 묻지 않는다
        let pending = Me::new(Some(A1));
        if let Some(s) = pending.0.lock().unwrap().as_mut() {
            s.admin_pending = true;
        }
        let g = OwnershipGate::enabled(pending);
        for (verdict, content, want) in [
            (Ownership::NotOwn, video(1), true),
            (Ownership::Unknown, video(1), true),
            (Ownership::NotOwn, live(D4), true),
            (Ownership::Unknown, live(D4), true),
            (Ownership::Own, video(1), false),
            (Ownership::Delegated, live(D4), false),
        ] {
            assert_eq!(
                g.needs_recheck(verdict, &content),
                want,
                "{verdict:?} {content:?}"
            );
        }
    }

    #[test]
    fn verdict_in_table() {
        for ok in [
            Ownership::Own,
            Ownership::Delegated,
            Ownership::AdminOverride,
        ] {
            assert!(verdict_in(ok).is_ok());
        }
        assert_eq!(
            verdict_in(Ownership::NotOwn).unwrap_err().code,
            ErrorCode::NotOwnContent
        );
        for bad in [Ownership::Unknown, Ownership::Unchecked] {
            assert_eq!(
                verdict_in(bad).unwrap_err().code,
                ErrorCode::OwnershipUnknown
            );
        }
    }
}
