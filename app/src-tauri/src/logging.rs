//! 로그(§7.3): `{app_log_dir}`에 하루 단위 파일 7개, 개발 빌드는 stdout에도.
//! 기본 필터 `info,chzzk_shell=debug,chzzk_core=debug`, `RUST_LOG`로 덮어쓴다. 패닉도 로그에 남긴다.

use std::path::Path;
use std::sync::Mutex;

use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{Builder, Rotation};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, fmt};

/// 기본 필터.
pub const DEFAULT_FILTER: &str = "info,chzzk_shell=debug,chzzk_core=debug,chzzk_app_lib=debug";

/// 보관하는 로그 파일 수.
pub const MAX_LOG_FILES: usize = 7;

/// 로그 파일 쓰기 스레드의 guard. 앱이 살아 있는 동안 들고 있어야 밀린 로그가 버려지지 않는다.
pub struct LogGuard(Mutex<Option<WorkerGuard>>);

impl LogGuard {
    /// 밀린 로그를 파일에 쓰고 쓰기 스레드를 닫는다(`WorkerGuard`는 drop할 때만 flush한다). 뒤 로그는 버려진다.
    /// 소멸자가 돌지 않는 종료(Windows 업데이트 설치의 `std::process::exit(0)`) 직전에 부른다(worker.md 구현 중 변경 81).
    pub fn close(&self) {
        let g = self.0.lock().unwrap_or_else(|e| e.into_inner()).take();
        drop(g);
    }
}

/// 전역 subscriber를 건다. 파일을 열지 못하면 stdout만(개발 빌드) 쓰고 `None`이다.
pub fn init(dir: &Path) -> Option<LogGuard> {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(DEFAULT_FILTER));
    // 폴더가 없으면 appender가 오래된 파일 정리 중 오류를 찍는다.
    let file = std::fs::create_dir_all(dir)
        .map_err(|e| e.to_string())
        .and_then(|()| {
            Builder::new()
                .rotation(Rotation::DAILY)
                .filename_prefix("chzzk-downloader")
                .filename_suffix("log")
                .max_log_files(MAX_LOG_FILES)
                .build(dir)
                .map_err(|e| e.to_string())
        });
    let (file_layer, guard) = match file {
        Ok(appender) => {
            let (w, guard) = tracing_appender::non_blocking(appender);
            (
                Some(fmt::layer().with_ansi(false).with_writer(w)),
                Some(LogGuard(Mutex::new(Some(guard)))),
            )
        }
        Err(e) => {
            eprintln!("로그 파일을 열지 못함({}): {e}", dir.display());
            (None, None)
        }
    };
    let stdout_layer = cfg!(debug_assertions).then(fmt::layer);
    if tracing_subscriber::registry()
        .with(filter)
        .with(file_layer)
        .with(stdout_layer)
        .try_init()
        .is_err()
    {
        return guard;
    }

    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        tracing::error!(panic = %info, "패닉");
        prev(info);
    }));
    guard
}
