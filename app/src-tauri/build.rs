const COMMANDS: &[&str] = include!("src/command_names.rs");

fn main() {
    println!("cargo:rerun-if-changed=src/command_names.rs");
    // 앱 command를 명시적 허가제로 둔다. capabilities에 `allow-<command>`를 적어야 프런트가 부를 수 있다.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("tauri-build 실패");
}
