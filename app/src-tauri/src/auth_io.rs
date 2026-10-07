//! 로그인 주소 열기·복사 seam(A2, D12). 앱은 opener·clipboard-manager 플러그인, 테스트는 기록용 구현을 둔다.
//! JS에는 두 플러그인 권한이 없다(Rust에서만 부른다, app.md 구현 중 변경 2).

use std::sync::Arc;

use tauri::{AppHandle, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;

/// 브라우저로 열기·클립보드 쓰기
pub trait AuthIo: Send + Sync + 'static {
    /// 기본 브라우저로 연다. 성공하면 true
    fn open_url(&self, url: &str) -> bool;
    /// 클립보드에 쓴다. 성공하면 true
    fn copy_text(&self, text: &str) -> bool;
}

/// 관리 상태
#[derive(Clone)]
pub struct AuthIoState(pub Arc<dyn AuthIo>);

/// 플러그인 구현
pub struct PluginAuthIo<R: Runtime>(pub AppHandle<R>);

impl<R: Runtime> AuthIo for PluginAuthIo<R> {
    fn open_url(&self, url: &str) -> bool {
        self.0.opener().open_url(url, None::<&str>).is_ok()
    }
    fn copy_text(&self, text: &str) -> bool {
        self.0.clipboard().write_text(text.to_string()).is_ok()
    }
}
