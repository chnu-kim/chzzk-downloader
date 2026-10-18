//! 명령줄이 게이트를 우회하지 않는다는 정적 확인(cli-mode.md §4.2·§17): `cli` 모듈은 `App`의 함수만 부른다.
//! 동작은 `cli.rs`의 T-G1~T-G6이 본다. 여기는 누군가 `manager`·코어·`classify`를 직접 부르는 변경을 막는다.

use std::path::Path;

use chzzk_shell::cli::GATED;

fn cli_sources() -> Vec<(String, String)> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/cli");
    let mut v = Vec::new();
    for e in std::fs::read_dir(&dir).unwrap() {
        let p = e.unwrap().path();
        if p.extension().is_some_and(|x| x == "rs") {
            v.push((
                p.file_name().unwrap().to_string_lossy().into_owned(),
                std::fs::read_to_string(&p).unwrap(),
            ));
        }
    }
    v
}

/// 테스트 모듈(`#[cfg(test)]`) 앞까지, 주석 줄을 뺀 코드만 본다
fn code_part(src: &str) -> String {
    src.split("#[cfg(test)]")
        .next()
        .unwrap()
        .lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn cli_never_calls_the_manager_or_core_directly() {
    // `.enqueue(`는 `app.enqueue(`(게이트를 지나는 App 함수)만 허용한다
    for (name, src) in cli_sources() {
        let code = code_part(&src);
        for bad in [
            "manager.enqueue",
            "manager.resume",
            "chzzk_core::download",
            "chzzk_core::Chzzk",
            "classify(",
            "admit(",
            "admit_checked",
            "OwnershipGate",
            "enqueue_checked",
            "services::enqueue",
        ] {
            assert!(!code.contains(bad), "{name}에서 `{bad}`를 부른다");
        }
        for (i, l) in code.lines().enumerate() {
            let t = l.trim_start();
            if t.starts_with("//") {
                continue;
            }
            if t.contains(".enqueue(") {
                assert!(t.contains("app.enqueue("), "{name}:{} {t}", i + 1);
            }
        }
    }
}

/// `download`은 resolve → check_output → enqueue(이어받기는 resume_job) 순으로 GUI command 이름의 게이트를 거친다
#[test]
fn download_gates_every_app_call_by_gui_command_name() {
    let (_, dl) = cli_sources()
        .into_iter()
        .find(|(n, _)| n == "download.rs")
        .unwrap();
    let code = code_part(&dl);
    let names = GATED.iter().find(|(s, _)| *s == "download").unwrap().1;
    for n in names {
        assert!(
            code.contains(&format!("gate_command(\"{n}\")")),
            "download.rs가 {n} 게이트를 부르지 않는다"
        );
    }
    // 게이트 뒤에 오는 App 함수 호출 순서
    let pos = |s: &str| code.find(s).unwrap_or_else(|| panic!("{s}"));
    assert!(pos("gate_command(\"resolve\")") < pos("app.resolve("));
    assert!(pos("gate_command(\"check_output\")") < pos("app.check_output("));
    assert!(pos("gate_command(\"enqueue\")") < pos("app.enqueue("));
    assert!(pos("gate_command(\"resume_job\")") < pos("app.resume_job("));
}
