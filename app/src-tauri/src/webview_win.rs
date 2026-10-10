//! Windows WebView2 보강(system/platform.md §4.4·§4.6, D28).
//!
//! 릴리스 빌드에서만 WebView2 설정 두 가지를 바꾼다.
//! - `ICoreWebView2Settings3::SetAreBrowserAcceleratorKeysEnabled(false)`: F5·Ctrl+R·Ctrl+F·Ctrl+P·F12 같은 브라우저
//!   단축키를 끈다(프런트 `guards.ts`가 막지 못하는 WebView2 자체 처리까지).
//! - `ICoreWebView2Settings4::SetIsGeneralAutofillEnabled(false)`: 입력칸 자동완성 제안을 끈다.
//!
//! 컨텍스트 메뉴 설정은 건드리지 않는다: 입력칸의 붙여넣기 메뉴를 살리고 나머지는 프런트가 막는다.
//!
//! 모듈은 어느 OS에서나 컴파일되고(판단 함수·테스트), 실제 COM 호출(`harden`)은 Windows에서만 있다. Windows의 debug
//! 빌드(PR CI의 `tauri-clippy`·`tauri`)도 이 코드를 컴파일하므로 깨지면 PR에서 잡힌다. 효과만 런타임에
//! `!cfg!(debug_assertions)`로 릴리스에서 켠다(개발 중에는 F12 개발자 도구를 쓸 수 있게).

/// 효과를 켤까: 릴리스(`debug_assertions` 꺼짐)에서만.
pub fn should_apply(debug_assertions: bool) -> bool {
    !debug_assertions
}

/// main 창의 WebView2 설정을 바꾼다. debug 빌드에서는 아무것도 하지 않는다. 실패는 로그만 남긴다(앱은 계속 쓸 수 있다).
#[cfg(windows)]
pub fn harden<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    if !should_apply(cfg!(debug_assertions)) {
        return;
    }
    let queued = window.with_webview(|webview| {
        if let Err(e) = apply(&webview.controller()) {
            tracing::warn!(error = %e, "WebView2 설정을 바꾸지 못함");
        }
    });
    if let Err(e) = queued {
        tracing::warn!(error = %e, "WebView2 설정 작업을 맡기지 못함");
    }
}

#[cfg(windows)]
fn apply(
    controller: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
) -> windows::core::Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Settings3, ICoreWebView2Settings4,
    };
    use windows::core::Interface;
    // COM 호출은 unsafe다. 컨트롤러는 UI 스레드에서 받았고 이 클로저도 그 스레드에서 돈다.
    unsafe {
        let settings = controller.CoreWebView2()?.Settings()?;
        // 오래된 런타임에는 인터페이스가 없을 수 있다: 그때는 건너뛴다
        if let Ok(s3) = settings.cast::<ICoreWebView2Settings3>() {
            s3.SetAreBrowserAcceleratorKeysEnabled(false)?;
        }
        if let Ok(s4) = settings.cast::<ICoreWebView2Settings4>() {
            s4.SetIsGeneralAutofillEnabled(false)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effect_is_release_only() {
        assert!(should_apply(false));
        assert!(!should_apply(true));
    }

    // Windows가 아닌 호스트에서도 코드가 있고 빠지지 않았음을 글자로 확인한다(3 OS)
    #[test]
    fn source_sets_both_webview2_switches_and_leaves_context_menus() {
        let src = include_str!("webview_win.rs");
        assert!(src.contains("SetAreBrowserAcceleratorKeysEnabled(false)"));
        assert!(src.contains("SetIsGeneralAutofillEnabled(false)"));
        assert!(
            src.contains("!cfg!(debug_assertions)")
                || src.contains("should_apply(cfg!(debug_assertions))")
        );
        // 컨텍스트 메뉴 설정은 부르지 않는다(입력칸 붙여넣기 메뉴를 살린다)
        let menus = ["SetAreDefault", "ContextMenusEnabled("].concat();
        assert!(!src.contains(&menus));
    }
}
