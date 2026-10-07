const COMMANDS: &[&str] = include!("src/command_names.rs");

include!("build_rules.rs");

fn main() {
    println!("cargo:rerun-if-changed=src/command_names.rs");
    println!("cargo:rerun-if-changed=build_rules.rs");
    println!("cargo:rerun-if-env-changed={WORKER_BASE_ENV}");
    worker_base();
    embed_manifest_for_tests();
    // 앱 command를 명시적 허가제로 둔다. capabilities에 `allow-<command>`를 적어야 프런트가 부를 수 있다.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("tauri-build 실패");
}

/// Windows(MSVC)에서 통합 테스트 exe(`tests/*.rs`)에도 Common Controls v6 의존을 적은 매니페스트를 넣는다.
///
/// tauri-build는 매니페스트를 리소스로 묶어 bin에만 링크한다(`rustc-link-arg-bins`). 매니페스트 없는
/// 테스트 exe는 System32의 comctl32 5.82를 잡아 `TaskDialogIndirect` 등을 찾지 못하고
/// 0xc0000139(STATUS_ENTRYPOINT_NOT_FOUND)로 시작도 못 한다. `-tests` 인자는 통합 테스트에만 붙으므로
/// bin과 겹쳐 두 번 들어가지 않는다. tauri 저장소가 자기 테스트에 쓰는 우회와 같다
/// (tauri-apps/tauri discussions #11179). 빌드 스크립트는 호스트에서 돌므로 `cfg!`가 아니라 대상 환경 변수로 가른다.
fn embed_manifest_for_tests() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os != "windows" || target_env != "msvc" {
        return;
    }
    // tauri-build 2.x의 기본 매니페스트(src/windows-app-manifest.xml)를 그대로 옮긴 파일
    let manifest =
        std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"))
            .join("windows-test-manifest.xml");
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
    println!(
        "cargo:rustc-link-arg-tests=/MANIFESTINPUT:{}",
        manifest.display()
    );
}

/// Worker 주소 규칙(worker.md §11.1). 릴리스에서 없거나 틀리면 빌드를 멈춘다. 값은 찍지 않는다
fn worker_base() {
    let profile = std::env::var("PROFILE").unwrap_or_default();
    let value = std::env::var(WORKER_BASE_ENV).ok();
    match worker_base_rule(&profile, value.as_deref()) {
        Ok(WorkerBaseRule::On(v)) => println!("cargo:rustc-env={WORKER_BASE_RUSTC_ENV}={v}"),
        Ok(WorkerBaseRule::Off) => println!("cargo:rustc-env={WORKER_BASE_RUSTC_ENV}="),
        Err(m) => panic!("{m}"),
    }
}
