//! 파일 시스템 도우미: 원자적 쓰기, 재시도하는 rename, `io::Error` → `Error` 변환(설계 §5.1).

use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::error::Error;

/// `path`에 `bytes`를 원자적으로 쓴다. 같은 디렉토리의 임시 파일에 쓰고 `sync_all`한 뒤 rename한다.
///
/// 중간에 프로세스가 죽어도 `path`는 예전 내용이거나 새 내용 둘 중 하나다. rename은
/// `rename_with_retry`와 같이 Windows 일시 잠금(백신·색인기가 이전 파일을 잡은 경우)을 재시도한다.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), Error> {
    atomic_write_using(
        path,
        bytes,
        |a, b| std::fs::rename(a, b),
        is_transient_lock,
        std::thread::sleep,
    )
}

/// `atomic_write`의 본체. rename, 일시 잠금 판정, sleep을 주입받아 테스트한다.
fn atomic_write_using(
    path: &Path,
    bytes: &[u8],
    rename: impl FnMut(&Path, &Path) -> io::Result<()>,
    is_transient: impl Fn(&io::Error) -> bool,
    sleep: impl FnMut(Duration),
) -> Result<(), Error> {
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
    // 핸들을 닫고 경로만 남긴다(Windows는 열린 파일을 옮길 수 없다). 실패하면 drop이 임시 파일을 지운다.
    let tmp = tmp.into_temp_path();
    rename_with_retry_using(&tmp, path, rename, is_transient, sleep)?;
    // 옮긴 뒤에는 drop이 지울 파일이 없다. 같은 이름이 새로 생겨도 지우지 않도록 해제한다.
    let _ = tmp.keep();
    Ok(())
}

/// rename을 재시도 간격. 100ms부터 두 배씩, 합 약 3초(100+200+400+800+1600).
const RENAME_DELAYS_MS: [u64; 5] = [100, 200, 400, 800, 1600];

/// `from`을 `to`로 옮긴다(`to`가 있으면 덮어쓴다).
///
/// Windows에서 백신·탐색기 미리보기가 잠깐 파일을 잡으면 `ERROR_SHARING_VIOLATION`/`ACCESS_DENIED`가
/// 나므로 약 3초 동안 재시도한다. 끝내 잠겨 있으면 `FileLocked { path: to }`다.
pub fn rename_with_retry(from: &Path, to: &Path) -> Result<(), Error> {
    rename_with_retry_using(
        from,
        to,
        |a, b| std::fs::rename(a, b),
        is_transient_lock,
        std::thread::sleep,
    )
}

/// `rename_with_retry`의 본체. rename, 일시 잠금 판정, sleep을 주입받아 테스트한다.
pub(crate) fn rename_with_retry_using(
    from: &Path,
    to: &Path,
    mut rename: impl FnMut(&Path, &Path) -> io::Result<()>,
    is_transient: impl Fn(&io::Error) -> bool,
    mut sleep: impl FnMut(Duration),
) -> Result<(), Error> {
    let mut delays = RENAME_DELAYS_MS.iter();
    loop {
        match rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) if is_transient(&e) => match delays.next() {
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
///
/// Windows만 해당한다. 백신·색인기가 파일을 잡으면 `ERROR_ACCESS_DENIED`(5, `PermissionDenied`),
/// `ERROR_SHARING_VIOLATION`(32), `ERROR_LOCK_VIOLATION`(33)이 난다. Unix의 rename EACCES/EPERM은
/// 권한 문제(읽기 전용 디렉토리 등)라 기다려도 풀리지 않으므로 바로 `Io`로 낸다.
fn is_transient_lock(e: &io::Error) -> bool {
    cfg!(windows)
        && (e.kind() == io::ErrorKind::PermissionDenied
            || matches!(e.raw_os_error(), Some(5 | 32 | 33)))
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

    /// 이전 파일이 잠깐 잠겨 rename이 실패해도 재시도해 쓴다(Windows 일시 잠금).
    #[test]
    fn atomic_write_retries_transient_lock() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.part.json");
        std::fs::write(&p, b"old").unwrap();
        let locked = |e: &io::Error| e.kind() == io::ErrorKind::PermissionDenied;
        let calls = Cell::new(0);
        let slept = Cell::new(Duration::ZERO);
        atomic_write_using(
            &p,
            b"new",
            |a, b| {
                calls.set(calls.get() + 1);
                if calls.get() <= 2 {
                    Err(io::Error::from(io::ErrorKind::PermissionDenied))
                } else {
                    std::fs::rename(a, b)
                }
            },
            locked,
            |d| slept.set(slept.get() + d),
        )
        .unwrap();
        assert_eq!(calls.get(), 3);
        assert_eq!(slept.get(), Duration::from_millis(300));
        assert_eq!(std::fs::read(&p).unwrap(), b"new");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);

        // 끝내 잠겨 있으면 FileLocked이고 이전 파일은 그대로, 임시 파일은 남지 않는다.
        let r = atomic_write_using(
            &p,
            b"newer",
            |_, _| Err(io::Error::from(io::ErrorKind::PermissionDenied)),
            locked,
            |_| {},
        );
        assert!(
            matches!(r, Err(Error::FileLocked { ref path }) if path == &p),
            "{r:?}"
        );
        assert_eq!(std::fs::read(&p).unwrap(), b"new");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn rename_with_retry() {
        let a = Path::new("a");
        let b = Path::new("b");
        let slept = Cell::new(Duration::ZERO);
        let sleep = |d| slept.set(slept.get() + d);
        // 재시도 루프를 OS와 무관하게 검사하려고 `PermissionDenied`를 잠김으로 본다.
        let locked = |e: &io::Error| e.kind() == io::ErrorKind::PermissionDenied;

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
            locked,
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
            locked,
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
            locked,
            sleep,
        );
        assert!(matches!(r, Err(Error::Io { op: "rename", .. })));
        assert_eq!(calls.get(), 1);
    }

    /// 일시 잠금은 Windows 코드뿐이다. Unix의 EACCES/EPERM은 권한 문제라 재시도하지 않는다.
    #[test]
    fn transient_lock_is_windows_only() {
        let denied = io::Error::from(io::ErrorKind::PermissionDenied);
        #[cfg(unix)]
        {
            assert!(!is_transient_lock(&denied));
            assert!(!is_transient_lock(&io::Error::from_raw_os_error(13))); // EACCES
            assert!(!is_transient_lock(&io::Error::from_raw_os_error(1))); // EPERM
            // 주입 없는 실제 경로도 기다리지 않고 바로 Io다.
            let calls = Cell::new(0);
            let r = rename_with_retry_using(
                Path::new("a"),
                Path::new("b"),
                |_, _| {
                    calls.set(calls.get() + 1);
                    Err(io::Error::from_raw_os_error(13))
                },
                is_transient_lock,
                |_| panic!("Unix 권한 오류에 재시도했다"),
            );
            assert!(matches!(r, Err(Error::Io { op: "rename", .. })), "{r:?}");
            assert_eq!(calls.get(), 1);
        }
        #[cfg(windows)]
        {
            assert!(is_transient_lock(&denied));
            for code in [5, 32, 33] {
                assert!(is_transient_lock(&io::Error::from_raw_os_error(code)));
            }
        }
        assert!(!is_transient_lock(&io::Error::from(
            io::ErrorKind::NotFound
        )));
    }

    /// 읽기 전용 디렉토리로 옮기면 3초 기다리지 않고 바로 `Io`다(`FileLocked` 아님).
    #[cfg(unix)]
    #[test]
    fn rename_into_readonly_dir_is_io() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.part");
        std::fs::write(&a, b"x").unwrap();
        let ro = dir.path().join("ro");
        std::fs::create_dir(&ro).unwrap();
        std::fs::set_permissions(&ro, std::fs::Permissions::from_mode(0o555)).unwrap();
        let start = std::time::Instant::now();
        let r = super::rename_with_retry(&a, &ro.join("b.mp4"));
        std::fs::set_permissions(&ro, std::fs::Permissions::from_mode(0o755)).unwrap();
        // root로 돌면 권한 검사가 없어 성공한다. 그 경우는 검사하지 않는다.
        if r.is_ok() {
            return;
        }
        assert!(matches!(r, Err(Error::Io { op: "rename", .. })), "{r:?}");
        assert!(start.elapsed() < Duration::from_millis(100));
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
