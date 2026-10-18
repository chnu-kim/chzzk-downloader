//! 명령줄의 종료 신호(cli-mode.md §9.2): SIGINT는 한 번, SIGTERM·SIGHUP은 두 번 누른 것과 같다(바로 quit).
//!
//! 이 파일은 프로세스를 하나만 쓰도록 따로 뒀다. `kill`을 띄우는 `fork`는 같은 프로세스의 열린 잠금 파일을 잠깐 함께 쥐어
//! (flock은 파일 기술자 복제로 풀리지 않는다) 같은 바이너리의 잠금 테스트를 흔든다.
#![cfg(unix)]

use std::time::Duration;

use chzzk_app_lib::cli::spawn_ctrl_c;

fn kill(sig: &str) {
    let ok = std::process::Command::new("kill")
        .args([&format!("-{sig}"), &std::process::id().to_string()])
        .status()
        .unwrap()
        .success();
    assert!(ok, "kill -{sig}");
}

/// 핸들러가 걸려 있으니 프로세스는 죽지 않는다
#[test]
fn unix_signals_map_to_presses() {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .enable_all()
        .build()
        .unwrap();
    let mut rx = spawn_ctrl_c(&rt);
    for (sig, want) in [("INT", 1), ("TERM", 2), ("HUP", 2)] {
        kill(sig);
        rt.block_on(async {
            for _ in 0..want {
                tokio::time::timeout(Duration::from_secs(5), rx.recv())
                    .await
                    .unwrap_or_else(|_| panic!("{sig}: 신호가 오지 않았다"))
                    .unwrap();
            }
            // 더는 오지 않는다
            tokio::time::sleep(Duration::from_millis(100)).await;
            assert!(rx.try_recv().is_err(), "{sig}: 신호가 더 왔다");
        });
    }
}
