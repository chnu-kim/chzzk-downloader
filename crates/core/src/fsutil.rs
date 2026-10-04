//! 파일 시스템 도우미: 원자적 쓰기, 재시도하는 rename, `io::Error` → `Error` 변환(설계 §5.1).

use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::error::Error;

/// `path`에 `bytes`를 원자적으로 쓴다. 같은 디렉토리의 임시 파일에 쓰고 `sync_all`한 뒤 rename한다.
///
/// 중간에 프로세스가 죽어도 `path`는 예전 내용이거나 새 내용 둘 중 하나다.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), Error> {
    let dir = match path.parent() {
        Some(d) if !d.as_os_str().is_empty() => d,
        _ => Path::new("."),
    };
    let mut tmp =
        tempfile::NamedTempFile::new_in(dir).map_err(|e| map_io_error("create temp", dir, e))?;
    tmp.write_all(bytes)
        .map_err(|e| map_io_error("write", tmp.path(), e))?;
    tmp.as_file()
        .sync_all()
        .map_err(|e| map_io_error("sync", tmp.path(), e))?;
    tmp.persist(path)
        .map_err(|e| map_io_error("rename", path, e.error))?;
    Ok(())
}

/// rename을 재시도 간격. 100ms부터 두 배씩, 합 약 3초(100+200+400+800+1600).
const RENAME_DELAYS_MS: [u64; 5] = [100, 200, 400, 800, 1600];

/// `from`을 `to`로 옮긴다(`to`가 있으면 덮어쓴다).
///
/// Windows에서 백신·탐색기 미리보기가 잠깐 파일을 잡으면 `ERROR_SHARING_VIOLATION`/`ACCESS_DENIED`가
/// 나므로 약 3초 동안 재시도한다. 끝내 잠겨 있으면 `FileLocked { path: to }`다.
pub fn rename_with_retry(from: &Path, to: &Path) -> Result<(), Error> {
    rename_with_retry_using(from, to, |a, b| std::fs::rename(a, b), std::thread::sleep)
}

/// `rename_with_retry`의 본체. rename과 sleep을 주입받아 테스트한다.
pub(crate) fn rename_with_retry_using(
    from: &Path,
    to: &Path,
    mut rename: impl FnMut(&Path, &Path) -> io::Result<()>,
    mut sleep: impl FnMut(Duration),
) -> Result<(), Error> {
    let mut delays = RENAME_DELAYS_MS.iter();
    loop {
        match rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) if is_transient_lock(&e) => match delays.next() {
                Some(ms) => sleep(Duration::from_millis(*ms)),
                None => {
                    return Err(Error::FileLocked {
                        path: to.to_path_buf(),
                    });
                }
            },
            Err(e) => return Err(map_io_error("rename", from, e)),
        }
    }
}

/// 다른 프로세스가 잠깐 잡고 있어서 나는 오류인가.
fn is_transient_lock(e: &io::Error) -> bool {
    if e.kind() == io::ErrorKind::PermissionDenied {
        return true;
    }
    // ERROR_SHARING_VIOLATION(32), ERROR_LOCK_VIOLATION(33)
    cfg!(windows) && matches!(e.raw_os_error(), Some(32 | 33))
}

/// 디스크 공간 부족을 나타내는 OS 오류 코드인가.
///
/// 코드 값은 OS마다 뜻이 달라 cfg로 나눈다(Linux 112는 EHOSTDOWN, Windows 28은 용지 없음).
fn is_disk_full(e: &io::Error) -> bool {
    if e.kind() == io::ErrorKind::StorageFull {
        return true;
    }
    let Some(code) = e.raw_os_error() else {
        return false;
    };
    if cfg!(windows) {
        // ERROR_DISK_FULL(112), ERROR_HANDLE_DISK_FULL(39)
        matches!(code, 112 | 39)
    } else {
        // ENOSPC(Linux·macOS 모두 28)
        code == 28
    }
}

/// `io::Error`를 코어 오류로 바꾼다. 디스크 부족은 `DiskFull`, 나머지는 `Io`.
pub fn map_io_error(op: &'static str, path: &Path, e: io::Error) -> Error {
    if is_disk_full(&e) {
        return Error::DiskFull {
            path: path.to_path_buf(),
        };
    }
    Error::Io {
        op,
        path: PathBuf::from(path),
        source: e,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn atomic_write_replaces() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.json");
        atomic_write(&p, b"one").unwrap();
        atomic_write(&p, b"two").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"two");
        // 임시 파일이 남지 않는다.
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn rename_with_retry() {
        let a = Path::new("a");
        let b = Path::new("b");
        let slept = Cell::new(Duration::ZERO);
        let sleep = |d| slept.set(slept.get() + d);

        // 잠김 두 번 뒤 성공
        let calls = Cell::new(0);
        let r = rename_with_retry_using(
            a,
            b,
            |_, _| {
                calls.set(calls.get() + 1);
                if calls.get() <= 2 {
                    Err(io::Error::from(io::ErrorKind::PermissionDenied))
                } else {
                    Ok(())
                }
            },
            sleep,
        );
        assert!(r.is_ok());
        assert_eq!(calls.get(), 3);
        assert_eq!(slept.get(), Duration::from_millis(300));

        // 끝내 잠김 → FileLocked, 약 3초 재시도
        slept.set(Duration::ZERO);
        calls.set(0);
        let r = rename_with_retry_using(
            a,
            b,
            |_, _| {
                calls.set(calls.get() + 1);
                Err(io::Error::from(io::ErrorKind::PermissionDenied))
            },
            sleep,
        );
        assert!(matches!(r, Err(Error::FileLocked { ref path }) if path == b));
        assert_eq!(calls.get(), 6);
        assert_eq!(slept.get(), Duration::from_millis(3100));

        // 잠김이 아닌 오류는 바로 Io
        calls.set(0);
        let r = rename_with_retry_using(
            a,
            b,
            |_, _| {
                calls.set(calls.get() + 1);
                Err(io::Error::from(io::ErrorKind::NotFound))
            },
            sleep,
        );
        assert!(matches!(r, Err(Error::Io { op: "rename", .. })));
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn rename_with_retry_real_file() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.part");
        let b = dir.path().join("b.mp4");
        std::fs::write(&a, b"new").unwrap();
        std::fs::write(&b, b"old").unwrap();
        super::rename_with_retry(&a, &b).unwrap();
        assert_eq!(std::fs::read(&b).unwrap(), b"new");
        assert!(!a.exists());
    }

    #[test]
    fn map_io_error_storage_full() {
        let p = Path::new("x.part");
        let full = |e: io::Error| matches!(map_io_error("write", p, e), Error::DiskFull { .. });
        assert!(full(io::Error::from(io::ErrorKind::StorageFull)));
        #[cfg(unix)]
        {
            assert!(full(io::Error::from_raw_os_error(28)));
            // Linux 112(EHOSTDOWN)·39(ENOTEMPTY)는 디스크 부족이 아니다.
            assert!(!full(io::Error::from_raw_os_error(112)));
            assert!(!full(io::Error::from_raw_os_error(39)));
        }
        #[cfg(windows)]
        {
            assert!(full(io::Error::from_raw_os_error(112)));
            assert!(full(io::Error::from_raw_os_error(39)));
            // Windows 28은 ERROR_OUT_OF_PAPER
            assert!(!full(io::Error::from_raw_os_error(28)));
        }
        assert!(matches!(
            map_io_error("write", p, io::Error::other("x")),
            Error::Io { op: "write", .. }
        ));
    }
}
