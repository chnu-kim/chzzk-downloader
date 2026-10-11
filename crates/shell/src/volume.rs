//! 저장 폴더가 놓인 볼륨의 파일 시스템 종류를 감지해 파일명 규칙(`naming::Platform`)을 고른다(system/platform.md §16).
//!
//! macOS·Linux 호스트에서 FAT·exFAT·NTFS·SMB 볼륨에 저장하면 Windows 규칙(금지 문자·예약어·끝 점/공백)으로 이름을
//! 만든다. 그래야 그 볼륨을 Windows에 꽂았을 때 열 수 없는 이름이 생기지 않는다. 감지에 실패하거나 모르는 종류
//! (FUSE 등)이면 안전한 쪽인 Windows 규칙을 쓴다. 코어 API는 바뀌지 않는다: 셸이 `Platform`을 골라 넘길 뿐이다.
//!
//! 여기서 하지 않는 것(이월): FAT32 4GiB 제한·여유 공간·클라우드 폴더·경로 길이 같은 block/warn 검사, 유니코드 정규화.
//! 이 모듈은 "종류 감지 → `Platform` 선택"까지만 한다.

use std::path::Path;

use chzzk_core::Platform;

/// 볼륨의 파일 시스템 종류.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VolumeFs {
    Fat,
    ExFat,
    Ntfs,
    /// SMB·CIFS·WebDAV·NFS 같은 원격 볼륨(원격 쪽 규칙을 알 수 없어 Windows 규칙으로 본다)
    Smb,
    /// APFS·HFS+·ext4 같은 유닉스 계열(호스트 규칙을 따른다)
    Unix,
    /// 모르거나 감지에 실패했다
    Unknown,
}

/// 호스트 OS와 볼륨 종류에서 파일명 규칙을 고른다. 순수 함수.
///
/// Windows 호스트는 늘 Windows 규칙이다. 그 밖의 호스트에서는 `Unix`만 호스트 규칙이고 나머지(`Unknown` 포함)는
/// Windows 규칙이다.
pub fn naming_platform(host: Platform, fs: VolumeFs) -> Platform {
    if host == Platform::Windows {
        return Platform::Windows;
    }
    match fs {
        VolumeFs::Unix => host,
        VolumeFs::Fat | VolumeFs::ExFat | VolumeFs::Ntfs | VolumeFs::Smb | VolumeFs::Unknown => {
            Platform::Windows
        }
    }
}

/// `dir`이 놓인 볼륨 기준 파일명 규칙: `naming_platform(Platform::current(), detect(dir))`.
pub fn platform_for_dir(dir: &Path) -> Platform {
    naming_platform(Platform::current(), detect(dir))
}

/// macOS `statfs.f_fstypename` → 종류.
pub fn fs_from_macos_name(name: &str) -> VolumeFs {
    match name {
        "msdos" => VolumeFs::Fat,
        "exfat" => VolumeFs::ExFat,
        "ntfs" | "ufsd_NTFS" | "tuxera_ntfs" => VolumeFs::Ntfs,
        "smbfs" | "cifs" | "webdav" | "nfs" => VolumeFs::Smb,
        "apfs" | "hfs" => VolumeFs::Unix,
        _ => VolumeFs::Unknown,
    }
}

/// Linux `statfs.f_type`(매직 넘버) → 종류.
pub fn fs_from_linux_magic(magic: u64) -> VolumeFs {
    match magic {
        0x4d44 => VolumeFs::Fat,
        0x2011_BAB0 => VolumeFs::ExFat,
        0x5346_544e | 0x7366_746e => VolumeFs::Ntfs,
        0x517B | 0xFF53_4D42 | 0xFE53_4D42 => VolumeFs::Smb,
        // ext2/3/4, btrfs, xfs, tmpfs, zfs, f2fs, overlay
        0xEF53 | 0x9123_683E | 0x5846_5342 | 0x0102_1994 | 0x2FC1_2FC1 | 0xF2F5_2010
        | 0x794c_7630 => VolumeFs::Unix,
        // FUSE(0x65735546)와 그 밖은 모른다
        _ => VolumeFs::Unknown,
    }
}

/// 가장 가까운 존재하는 조상 폴더에서 파일 시스템 종류를 읽는다(폴더가 아직 없을 수 있다: `치지직` 폴더는 첫
/// 다운로드 때 만들어진다). Windows는 감지 없이 `Ntfs`다. 실패하면 `Unknown`.
pub fn detect(dir: &Path) -> VolumeFs {
    #[cfg(windows)]
    {
        let _ = dir;
        VolumeFs::Ntfs
    }
    #[cfg(not(windows))]
    {
        let Some(existing) = nearest_existing(dir) else {
            return VolumeFs::Unknown;
        };
        detect_existing(existing)
    }
}

/// 존재하는 가장 가까운 조상(자기 자신 포함). 상대 경로의 끝은 현재 폴더다.
#[cfg(not(windows))]
fn nearest_existing(dir: &Path) -> Option<&Path> {
    let mut cur = dir;
    loop {
        if cur.as_os_str().is_empty() {
            return Some(Path::new("."));
        }
        if cur.exists() {
            return Some(cur);
        }
        cur = cur.parent()?;
    }
}

#[cfg(target_os = "macos")]
fn detect_existing(path: &Path) -> VolumeFs {
    use std::ffi::{CStr, CString};
    use std::os::unix::ffi::OsStrExt;

    let Ok(c) = CString::new(path.as_os_str().as_bytes()) else {
        return VolumeFs::Unknown;
    };
    // SAFETY: `c`는 널로 끝나는 유효한 경로이고, `buf`는 `statfs`가 채울 수 있는 크기의 0 초기화 구조체다.
    let mut buf: libc::statfs = unsafe { std::mem::zeroed() };
    let rc = unsafe { libc::statfs(c.as_ptr(), &mut buf) };
    if rc != 0 {
        return VolumeFs::Unknown;
    }
    // SAFETY: 커널이 `f_fstypename`을 널로 끝내서 채운다(16바이트 배열 안).
    let name = unsafe { CStr::from_ptr(buf.f_fstypename.as_ptr()) };
    fs_from_macos_name(&name.to_string_lossy())
}

#[cfg(target_os = "linux")]
fn detect_existing(path: &Path) -> VolumeFs {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let Ok(c) = CString::new(path.as_os_str().as_bytes()) else {
        return VolumeFs::Unknown;
    };
    // SAFETY: 위와 같다.
    let mut buf: libc::statfs = unsafe { std::mem::zeroed() };
    let rc = unsafe { libc::statfs(c.as_ptr(), &mut buf) };
    if rc != 0 {
        return VolumeFs::Unknown;
    }
    // `f_type`의 정수 폭은 타깃마다 다르다(32비트 부호 있는 형이면 큰 매직이 음수가 된다). 아래 32비트로 맞춘다.
    fs_from_linux_magic(buf.f_type as u64 & 0xFFFF_FFFF)
}

#[cfg(all(unix, not(target_os = "macos"), not(target_os = "linux")))]
fn detect_existing(_path: &Path) -> VolumeFs {
    VolumeFs::Unknown
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 3 호스트 × 6 종류 전수 표
    #[test]
    fn naming_platform_table() {
        use Platform::{Linux, MacOs, Windows};
        use VolumeFs::*;
        for host in [MacOs, Linux] {
            for (fs, want_windows) in [
                (Fat, true),
                (ExFat, true),
                (Ntfs, true),
                (Smb, true),
                (Unknown, true),
                (Unix, false),
            ] {
                let want = if want_windows { Windows } else { host };
                assert_eq!(naming_platform(host, fs), want, "{host:?} {fs:?}");
            }
        }
        for fs in [Fat, ExFat, Ntfs, Smb, Unix, Unknown] {
            assert_eq!(naming_platform(Windows, fs), Windows, "Windows {fs:?}");
        }
    }

    #[test]
    fn macos_names_map() {
        for (name, want) in [
            ("msdos", VolumeFs::Fat),
            ("exfat", VolumeFs::ExFat),
            ("ntfs", VolumeFs::Ntfs),
            ("ufsd_NTFS", VolumeFs::Ntfs),
            ("tuxera_ntfs", VolumeFs::Ntfs),
            ("smbfs", VolumeFs::Smb),
            ("cifs", VolumeFs::Smb),
            ("webdav", VolumeFs::Smb),
            ("nfs", VolumeFs::Smb),
            ("apfs", VolumeFs::Unix),
            ("hfs", VolumeFs::Unix),
            ("macfuse", VolumeFs::Unknown),
            ("", VolumeFs::Unknown),
        ] {
            assert_eq!(fs_from_macos_name(name), want, "{name}");
        }
    }

    #[test]
    fn linux_magics_map() {
        for (magic, want) in [
            (0x4d44, VolumeFs::Fat),
            (0x2011_BAB0, VolumeFs::ExFat),
            (0x5346_544e, VolumeFs::Ntfs),
            (0x7366_746e, VolumeFs::Ntfs),
            (0x517B, VolumeFs::Smb),
            (0xFF53_4D42, VolumeFs::Smb),
            (0xFE53_4D42, VolumeFs::Smb),
            (0xEF53, VolumeFs::Unix),
            (0x9123_683E, VolumeFs::Unix),
            (0x5846_5342, VolumeFs::Unix),
            (0x0102_1994, VolumeFs::Unix),
            (0x2FC1_2FC1, VolumeFs::Unix),
            (0xF2F5_2010, VolumeFs::Unix),
            (0x794c_7630, VolumeFs::Unix),
            (0x6573_5546, VolumeFs::Unknown),
            (0, VolumeFs::Unknown),
        ] {
            assert_eq!(fs_from_linux_magic(magic), want, "{magic:#x}");
        }
    }

    /// 임시 폴더(아직 없는 하위 폴더 포함)는 감지에 실패하지 않는다. Windows는 늘 Ntfs
    #[test]
    fn detect_smoke_on_temp_dir() {
        let t = tempfile::TempDir::new().unwrap();
        let missing = t.path().join("폴더").join("하위");
        let a = detect(t.path());
        let b = detect(&missing);
        assert_eq!(a, b, "없는 하위 폴더는 가장 가까운 조상으로 본다");
        if cfg!(windows) {
            assert_eq!(a, VolumeFs::Ntfs);
        } else if cfg!(target_os = "macos") {
            // Linux 러너의 임시 폴더는 컨테이너마다 달라(FUSE 등) 종류를 단정하지 않는다
            assert_eq!(a, VolumeFs::Unix, "macOS 임시 폴더는 APFS다");
        }
    }

    /// 상대 경로·빈 경로도 패닉하지 않는다
    #[test]
    fn detect_handles_relative_paths() {
        let _ = detect(Path::new("없는-상대-폴더/아래"));
        let _ = detect(Path::new(""));
    }

    #[test]
    fn platform_for_dir_follows_detection() {
        let t = tempfile::TempDir::new().unwrap();
        let want = naming_platform(Platform::current(), detect(t.path()));
        assert_eq!(platform_for_dir(t.path()), want);
    }
}
