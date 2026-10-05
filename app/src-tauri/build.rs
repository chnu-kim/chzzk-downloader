fn main() {
    // 앱 command를 명시적 허가제로 둔다. capabilities에 `allow-<command>`를 적어야 프런트가 부를 수 있다.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["app_info"])),
    )
    .expect("tauri-build 실패");
}
