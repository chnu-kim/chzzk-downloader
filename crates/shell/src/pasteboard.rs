//! 클립보드 제안 허용 판단(system/platform.md §11, D56). 홈 화면이 클립보드의 치지직 주소를 제안하려면 클립보드를
//! 읽어야 하는데, macOS 15.4+는 앱이 읽을 때마다 사용자에게 붙여넣기 허용 알림을 띄울 수 있다. 그래서 macOS에서는
//! 사용자가 이미 "항상 허용"으로 둔 경우(또는 이 정책을 모르는 구버전)에만 읽는다. 그 밖의 OS는 늘 읽는다.
//!
//! macOS의 `accessBehavior` 셀렉터는 15.4 이상에만 있다. 13.3~15.3에서 그냥 부르면 ObjC 예외로 앱이 죽으므로
//! `respondsToSelector:`로 먼저 확인하고, 없으면 `Unsupported`(읽는다)로 본다. OS 질의 코드는 이 파일 한 곳에 둔다.

use crate::dto::OsDto;

/// 앱의 클립보드 접근 정책.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AccessBehavior {
    /// 정책 질의를 지원하지 않는 OS·버전
    Unsupported,
    /// 기본: 프로그램이 읽을 때 물어본다(아직 한 번도 묻지 않았다)
    Default,
    /// 읽을 때마다 물어본다
    Ask,
    /// 항상 허용
    AlwaysAllow,
    /// 항상 거부
    AlwaysDeny,
}

/// 접근 정책을 돌려주는 쪽. 테스트는 가짜를 쓴다.
pub trait PasteboardAccess {
    fn behavior(&self) -> AccessBehavior;
}

/// 클립보드를 읽어 제안해도 되는가. 순수 함수.
///
/// macOS는 `AlwaysAllow`·`Unsupported`만 true(묻는 알림을 띄우지 않는다). 그 밖의 OS는 늘 true.
pub fn suggest_allowed(os: OsDto, b: AccessBehavior) -> bool {
    match os {
        OsDto::Macos => matches!(b, AccessBehavior::AlwaysAllow | AccessBehavior::Unsupported),
        OsDto::Windows | OsDto::Linux => true,
    }
}

/// 이 OS의 실제 질의를 쓴 `suggest_allowed`. macOS 밖에서는 질의 없이 true.
pub fn system_suggest_allowed() -> bool {
    #[cfg(target_os = "macos")]
    {
        suggest_allowed(OsDto::Macos, SystemPasteboard.behavior())
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// macOS 일반 클립보드의 실제 질의.
#[cfg(target_os = "macos")]
struct SystemPasteboard;

#[cfg(target_os = "macos")]
impl PasteboardAccess for SystemPasteboard {
    fn behavior(&self) -> AccessBehavior {
        use objc2::runtime::NSObjectProtocol;
        use objc2_app_kit::NSPasteboard;

        let pb = NSPasteboard::generalPasteboard();
        // 15.4 미만에는 셀렉터가 없다. 확인 없이 부르면 ObjC 예외로 죽는다.
        if !pb.respondsToSelector(objc2::sel!(accessBehavior)) {
            return AccessBehavior::Unsupported;
        }
        match pb.accessBehavior().0 {
            0 => AccessBehavior::Default,
            1 => AccessBehavior::Ask,
            2 => AccessBehavior::AlwaysAllow,
            3 => AccessBehavior::AlwaysDeny,
            // 앞으로 늘어날 값은 묻는 쪽으로 본다(읽지 않는 안전한 쪽)
            _ => AccessBehavior::Ask,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fake(AccessBehavior);

    impl PasteboardAccess for Fake {
        fn behavior(&self) -> AccessBehavior {
            self.0
        }
    }

    /// macOS: AlwaysAllow·Unsupported만 읽는다. Windows·Linux는 정책과 상관없이 늘 읽는다
    #[test]
    fn suggest_allowed_table() {
        use AccessBehavior::*;
        for (b, mac) in [
            (Unsupported, true),
            (Default, false),
            (Ask, false),
            (AlwaysAllow, true),
            (AlwaysDeny, false),
        ] {
            let fake = Fake(b);
            assert_eq!(suggest_allowed(OsDto::Macos, fake.behavior()), mac, "{b:?}");
            assert!(suggest_allowed(OsDto::Windows, fake.behavior()), "{b:?}");
            assert!(suggest_allowed(OsDto::Linux, fake.behavior()), "{b:?}");
        }
    }

    /// 실제 질의는 어느 macOS 버전에서도 패닉·예외 없이 돌아온다(셀렉터 가드). 다른 OS는 true
    #[test]
    fn system_query_does_not_crash() {
        let allowed = system_suggest_allowed();
        if !cfg!(target_os = "macos") {
            assert!(allowed);
        }
    }
}
