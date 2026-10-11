//! 받는 동안 컴퓨터가 잠들지 않게 한다(system/platform.md §10, D56 이전의 잠자기 방지 결정).
//!
//! OS 전원 심볼은 이 파일(`power*`)에만 둔다(`release-hygiene`의 소스 훑기 DX15가 확인한다). 정책:
//!
//! - **유휴 잠자기만 막는다.** `keepawake` 빌더에 `idle(true)`·`display(false)`·`sleep(false)`를 늘 명시한다.
//!   화면은 꺼지게 두고, 덮개 닫기·전원 버튼 같은 사용자의 명시적 잠자기는 막지 않는다.
//! - macOS는 같은 스레드에서 App Nap 해제 토큰도 쥔다(유휴 잠자기만 허용하는 활동 옵션: 백그라운드 앱이어도 타이머가
//!   늦춰지지 않는다).
//! - 핸들은 전용 스레드 하나가 소유한다. Windows의 연속 실행 상태는 호출한 스레드에 묶이므로 받는 쪽 스레드와 놓는
//!   쪽 스레드가 같아야 하기 때문이다. 앱 쪽에서는 채널로 부린다.
//!
//! `PowerKeeper`가 `enabled && running > 0`의 0↔1 전이에서 얻고 놓는다. 얻기에 실패하면 표시를 켜지 않고 로그만
//! 남기며(연속 실패의 첫 번만) 다운로드는 계속한다. 원하는데 못 얻은 동안은 틱마다 다시 시도한다.

use std::sync::mpsc;
use std::thread::JoinHandle;

use crate::consts::SLEEP_REASON_MAX;
use crate::notify::power_reason;

/// 잠자기 방지를 얻고 놓는 쪽. 테스트는 가짜로 생명주기를 확인한다.
pub trait SleepGuard: Send {
    /// 얻는다. 이미 쥐고 있으면 사유만 바꿔 다시 얻는다. 실패하면 사람이 읽을 수 있는 이유(비밀 없음).
    fn acquire(&mut self, reason: &str) -> Result<(), String>;
    /// 놓는다. 쥐고 있지 않으면 아무 일도 하지 않는다.
    fn release(&mut self);
}

/// 아무것도 하지 않는 가드(테스트·격리 실행: 사용자의 실제 전원 설정을 건드리지 않는다).
#[derive(Debug, Default, Clone, Copy)]
pub struct NoopGuard;

impl SleepGuard for NoopGuard {
    fn acquire(&mut self, _reason: &str) -> Result<(), String> {
        Ok(())
    }

    fn release(&mut self) {}
}

/// 전용 스레드에 보내는 명령.
enum Cmd {
    Acquire(String, mpsc::Sender<Result<(), String>>),
    Release,
    Stop,
}

/// 실제 OS 가드. 전용 스레드가 핸들을 소유한다.
pub struct SystemGuard {
    tx: Option<mpsc::Sender<Cmd>>,
    thread: Option<JoinHandle<()>>,
}

impl std::fmt::Debug for SystemGuard {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SystemGuard").finish_non_exhaustive()
    }
}

impl SystemGuard {
    /// 전용 스레드를 띄운다. 스레드를 만들지 못하면 `acquire`가 늘 실패하는 가드가 된다(앱은 계속 돈다).
    pub fn spawn() -> Self {
        let (tx, rx) = mpsc::channel::<Cmd>();
        let thread = std::thread::Builder::new()
            .name("sleep-guard".into())
            .spawn(move || run(rx));
        match thread {
            Ok(t) => SystemGuard {
                tx: Some(tx),
                thread: Some(t),
            },
            Err(e) => {
                tracing::warn!(error = %e, "잠자기 방지 스레드를 만들지 못했다");
                SystemGuard {
                    tx: None,
                    thread: None,
                }
            }
        }
    }
}

impl SleepGuard for SystemGuard {
    fn acquire(&mut self, reason: &str) -> Result<(), String> {
        let tx = self.tx.as_ref().ok_or("전원 스레드가 없습니다")?;
        let (reply_tx, reply_rx) = mpsc::channel();
        tx.send(Cmd::Acquire(reason.to_string(), reply_tx))
            .map_err(|_| "전원 스레드가 멈췄습니다".to_string())?;
        reply_rx
            .recv()
            .map_err(|_| "전원 스레드가 응답하지 않았습니다".to_string())?
    }

    fn release(&mut self) {
        if let Some(tx) = &self.tx {
            let _ = tx.send(Cmd::Release);
        }
    }
}

impl Drop for SystemGuard {
    fn drop(&mut self) {
        if let Some(tx) = self.tx.take() {
            let _ = tx.send(Cmd::Stop);
        }
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// 전용 스레드 본체: 핸들을 쥐고, 채널이 닫히거나 `Stop`이 오면 놓고 끝난다.
fn run(rx: mpsc::Receiver<Cmd>) {
    let mut hold = Held::default();
    for cmd in rx {
        match cmd {
            Cmd::Acquire(reason, reply) => {
                // 사유를 바꿔 다시 얻을 수 있게 먼저 놓는다
                hold.release();
                let result = hold.acquire(&reason);
                let _ = reply.send(result);
            }
            Cmd::Release => hold.release(),
            Cmd::Stop => break,
        }
    }
    hold.release();
}

/// 스레드가 쥔 OS 핸들들.
#[derive(Default)]
struct Held {
    awake: Option<keepawake::KeepAwake>,
    #[cfg(target_os = "macos")]
    activity: Option<AppNapToken>,
}

impl Held {
    fn acquire(&mut self, reason: &str) -> Result<(), String> {
        let awake = keepawake::Builder::default()
            .idle(true)
            .display(false)
            .sleep(false)
            .reason(reason)
            .app_name("VOD 클립 다운로더")
            .app_reverse_domain("io.github.chnu-kim.chzzk-downloader")
            .create()
            .map_err(|e| e.to_string())?;
        self.awake = Some(awake);
        #[cfg(target_os = "macos")]
        {
            self.activity = Some(AppNapToken::begin(reason));
        }
        Ok(())
    }

    fn release(&mut self) {
        #[cfg(target_os = "macos")]
        if let Some(a) = self.activity.take() {
            a.end();
        }
        // 드롭이 OS 핸들을 놓는다
        self.awake = None;
    }
}

/// macOS App Nap 해제 토큰(유휴 시스템 잠자기는 허용하는 활동, `keepawake`의 유휴 방지와 짝).
#[cfg(target_os = "macos")]
struct AppNapToken(
    objc2::rc::Retained<objc2::runtime::ProtocolObject<dyn objc2::runtime::NSObjectProtocol>>,
);

#[cfg(target_os = "macos")]
impl AppNapToken {
    fn begin(reason: &str) -> Self {
        use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};
        let info = NSProcessInfo::processInfo();
        let token = info.beginActivityWithOptions_reason(
            NSActivityOptions::UserInitiatedAllowingIdleSystemSleep,
            &NSString::from_str(reason),
        );
        AppNapToken(token)
    }

    fn end(self) {
        use objc2_foundation::NSProcessInfo;
        // SAFETY: `begin`이 받은 토큰이고, 한 번만 끝낸다(self를 소비한다).
        unsafe { NSProcessInfo::processInfo().endActivity(&self.0) };
    }
}

/// 사유를 `max` 바이트 안으로 자른다(넘으면 문자 경계에서).
pub fn clip_reason(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// 설정과 실행 중 작업 수에서 가드를 얻고 놓는 전이를 만든다.
pub struct PowerKeeper<G: SleepGuard> {
    guard: G,
    /// `enabled && running > 0`의 직전 값(전이 판단)
    wanted: bool,
    /// 실제로 얻었다고 알린 값
    shown: bool,
    /// 연속 실패의 첫 경고를 이미 남겼는가(성공·놓기에서 초기화)
    warned: bool,
}

impl<G: SleepGuard> PowerKeeper<G> {
    pub fn new(guard: G) -> Self {
        PowerKeeper {
            guard,
            wanted: false,
            shown: false,
            warned: false,
        }
    }

    /// `enabled`는 설정 keepAwake, `running`은 running+pausing 작업 수. 0↔1 전이에서 얻고 놓는다.
    /// 원하는데 아직 못 얻었으면(일시 실패) 호출마다 다시 얻기를 시도한다(경고는 연속 실패의 첫 번만).
    /// 표시값(보호를 실제로 얻었는가)이 바뀌면 `Some(active)`.
    pub fn update(&mut self, enabled: bool, running: usize) -> Option<bool> {
        let want = enabled && running > 0;
        let before = self.shown;
        if want != self.wanted {
            self.wanted = want;
            if !want {
                self.guard.release();
                self.shown = false;
                self.warned = false;
            }
        }
        if want && !self.shown {
            let reason = power_reason(running);
            let reason = clip_reason(&reason, SLEEP_REASON_MAX);
            match self.guard.acquire(reason) {
                Ok(()) => {
                    self.shown = true;
                    self.warned = false;
                }
                Err(e) => {
                    // 다운로드는 계속한다. 표시는 켜지 않고 다음 호출에서 다시 얻어 본다
                    if !self.warned {
                        tracing::warn!(error = %e, "잠자기 방지를 얻지 못했다");
                        self.warned = true;
                    }
                }
            }
        }
        (self.shown != before).then_some(self.shown)
    }

    /// 지금 표시값(`keep-awake` 이벤트를 다시 보낼 때 쓴다)
    pub fn active(&self) -> bool {
        self.shown
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[derive(Debug, PartialEq, Eq, Clone)]
    enum Call {
        Acquire(String),
        Release,
    }

    /// 호출을 기록하는 가짜 가드. `fail`이 켜져 있으면 얻기에 실패한다.
    #[derive(Clone, Default)]
    struct Fake {
        calls: Arc<Mutex<Vec<Call>>>,
        fail: Arc<Mutex<bool>>,
    }

    impl Fake {
        fn calls(&self) -> Vec<Call> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl SleepGuard for Fake {
        fn acquire(&mut self, reason: &str) -> Result<(), String> {
            self.calls
                .lock()
                .unwrap()
                .push(Call::Acquire(reason.to_string()));
            if *self.fail.lock().unwrap() {
                Err("거부됨".into())
            } else {
                Ok(())
            }
        }

        fn release(&mut self) {
            self.calls.lock().unwrap().push(Call::Release);
        }
    }

    /// 0→1 얻기, 1→2는 호출 없음, 2→0 놓기
    #[test]
    fn acquires_on_first_and_releases_on_last() {
        let fake = Fake::default();
        let mut k = PowerKeeper::new(fake.clone());
        assert_eq!(k.update(true, 0), None);
        assert!(fake.calls().is_empty());
        assert_eq!(k.update(true, 1), Some(true));
        assert_eq!(k.update(true, 2), None);
        assert_eq!(k.update(true, 1), None);
        assert_eq!(
            fake.calls(),
            vec![Call::Acquire(power_reason(1))],
            "1→2는 호출하지 않는다(사유는 처음 값 그대로)"
        );
        assert_eq!(k.update(true, 0), Some(false));
        assert_eq!(fake.calls().last(), Some(&Call::Release));
        assert_eq!(fake.calls().len(), 2);
        assert!(!k.active());
    }

    /// 설정을 끄면 받는 중이어도 놓는다. 다시 켜면 얻는다
    #[test]
    fn disabling_releases_while_running() {
        let fake = Fake::default();
        let mut k = PowerKeeper::new(fake.clone());
        assert_eq!(k.update(true, 2), Some(true));
        assert_eq!(k.update(false, 2), Some(false));
        assert_eq!(k.update(false, 3), None);
        assert_eq!(k.update(true, 3), Some(true));
        assert_eq!(
            fake.calls(),
            vec![
                Call::Acquire(power_reason(2)),
                Call::Release,
                Call::Acquire(power_reason(3)),
            ]
        );
    }

    /// 설정이 꺼진 채 받기가 시작되면 가드를 부르지 않는다
    #[test]
    fn disabled_never_touches_guard() {
        let fake = Fake::default();
        let mut k = PowerKeeper::new(fake.clone());
        assert_eq!(k.update(false, 1), None);
        assert_eq!(k.update(false, 0), None);
        assert!(fake.calls().is_empty());
    }

    /// 얻기에 실패하면 표시를 켜지 않는다(Some도 없다). 실패한 동안은 호출마다 다시 시도하고, 끝나면 놓기는 부른다
    #[test]
    fn acquire_failure_keeps_indicator_off() {
        let fake = Fake::default();
        *fake.fail.lock().unwrap() = true;
        let mut k = PowerKeeper::new(fake.clone());
        assert_eq!(k.update(true, 1), None);
        assert!(!k.active());
        assert_eq!(k.update(true, 2), None);
        assert_eq!(k.update(true, 0), None);
        assert_eq!(
            fake.calls(),
            vec![
                Call::Acquire(power_reason(1)),
                Call::Acquire(power_reason(2)),
                Call::Release
            ]
        );
        // 다음 받기에서 성공하면 켜진다
        *fake.fail.lock().unwrap() = false;
        assert_eq!(k.update(true, 1), Some(true));
    }

    /// 일시 실패 뒤 다음 틱에 성공하면 다시 얻고, 얻은 뒤에는 더 부르지 않는다
    #[test]
    fn retries_acquire_after_transient_failure() {
        let fake = Fake::default();
        *fake.fail.lock().unwrap() = true;
        let mut k = PowerKeeper::new(fake.clone());
        assert_eq!(k.update(true, 1), None);
        assert_eq!(k.update(true, 1), None);
        assert!(k.warned, "연속 실패에서 경고는 한 번만 남긴다");
        *fake.fail.lock().unwrap() = false;
        assert_eq!(k.update(true, 1), Some(true));
        assert!(!k.warned, "성공하면 초기화");
        assert_eq!(k.update(true, 1), None);
        assert_eq!(fake.calls().len(), 3, "얻은 뒤에는 호출하지 않는다");
        // 놓았다 다시 실패해도 첫 실패를 다시 기록한다
        assert_eq!(k.update(true, 0), Some(false));
        *fake.fail.lock().unwrap() = true;
        k.update(true, 1);
        assert!(k.warned);
    }

    /// 사유는 `SLEEP_REASON_MAX` 바이트 안으로, 문자 경계에서 자른다
    #[test]
    fn reason_is_clipped_on_char_boundary() {
        assert_eq!(clip_reason("abc", 128), "abc");
        let long = "치".repeat(100); // 300바이트
        let clipped = clip_reason(&long, SLEEP_REASON_MAX);
        assert!(clipped.len() <= SLEEP_REASON_MAX);
        assert_eq!(clipped.len(), 126, "128 안의 마지막 문자 경계");
        assert!(long.starts_with(clipped));
        assert_eq!(clip_reason("치", 2), "");
        // 실제 사유는 상한 안이다
        assert!(power_reason(1_000_000).len() <= SLEEP_REASON_MAX);
    }

    /// 사유가 긴 가드 호출도 상한을 넘지 않는다
    #[test]
    fn long_counts_stay_within_limit() {
        let fake = Fake::default();
        let mut k = PowerKeeper::new(fake.clone());
        k.update(true, usize::MAX);
        let calls = fake.calls();
        let Some(Call::Acquire(r)) = calls.first() else {
            panic!("얻기 호출이 없다");
        };
        assert!(r.len() <= SLEEP_REASON_MAX);
    }

    /// 실제 OS 가드는 얻기가 성공하든 실패하든(헤드리스 CI) 멈추지 않고 정리된다
    #[test]
    fn system_guard_lifecycle_does_not_hang() {
        let mut g = SystemGuard::spawn();
        let _ = g.acquire("치지직 영상 1개 받는 중");
        let _ = g.acquire("치지직 영상 2개 받는 중");
        g.release();
        g.release();
        drop(g);
    }

    /// `NoopGuard`는 늘 성공한다
    #[test]
    fn noop_guard_always_succeeds() {
        let mut k = PowerKeeper::new(NoopGuard);
        assert_eq!(k.update(true, 1), Some(true));
        assert_eq!(k.update(true, 0), Some(false));
    }
}
