//! `.part` 파일과 sidecar(`.part.json`)로 이어받기와 크래시 일관성을 지킨다(설계 §5.1).
//!
//! - **불변식**: sidecar의 `committed_len`은 항상 durable한(`sync_data`가 끝난) 바이트 수 이하다.
//!   checkpoint 순서는 `flush` → `sync_data` → sidecar 원자적 쓰기다.
//! - **재개**: `.part`가 `committed_len`보다 길면 꼬리를 잘라 낸다(크래시 때 반쯤 쓴 부분).
//!   짧거나 sidecar가 맞지 않으면 둘 다 지우고 새로 시작한다.
//! - **잠금**: `.part`를 배타 잠금(`File::try_lock`)한다. 잠금을 쥐기 전에는 `.part`를 자르거나 지우지
//!   않는다(다른 작업이 쓰는 중일 수 있다). 실패하면 `FileLocked`.
//! - **생성 시점**: 새로 시작할 때 `.part`는 첫 응답의 상태 코드를 확인한 뒤에 `create`로 만든다.

use std::fs::{File, OpenOptions, TryLockError};
use std::io::{self, BufWriter, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Error;
use crate::fsutil::{atomic_write, map_io_error, rename_with_retry};
use crate::model::{ContentRef, PlaybackKind};

/// sidecar 형식 버전.
pub const SIDECAR_VERSION: u8 = 1;

/// 쓰기 버퍼 크기.
const WRITE_BUF: usize = 1 << 20;

/// `.part.json`. 이어받기에 필요한 상태를 담는다.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sidecar {
    /// 형식 버전(1)
    pub v: u8,
    pub content: ContentRef,
    pub quality_id: String,
    pub kind: PlaybackKind,
    /// durable한 바이트 수(불변식: ≤ 실제 fsync된 길이)
    pub committed_len: u64,
    #[serde(default)]
    pub progressive: Option<ProgressiveState>,
    #[serde(default)]
    pub hls: Option<HlsState>,
}

impl Sidecar {
    /// 새 작업의 sidecar(`committed_len = 0`).
    pub fn new(content: ContentRef, quality_id: impl Into<String>, kind: PlaybackKind) -> Self {
        Sidecar {
            v: SIDECAR_VERSION,
            content,
            quality_id: quality_id.into(),
            kind,
            committed_len: 0,
            progressive: None,
            hls: None,
        }
    }

    /// 같은 작업(컨텐츠·화질·방식)의 sidecar인가.
    pub fn same_job(&self, content: &ContentRef, quality_id: &str, kind: PlaybackKind) -> bool {
        self.v == SIDECAR_VERSION
            && &self.content == content
            && self.quality_id == quality_id
            && self.kind == kind
    }
}

/// progressive 이어받기 상태.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressiveState {
    /// 전체 크기. 서버가 길이를 주지 않았으면 `None`.
    pub total_len: Option<u64>,
}

/// HLS 이어받기 상태와 playlist 지문.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HlsState {
    /// 다음에 받을 세그먼트 index(0부터, playlist 안 위치)
    pub next_index: u32,
    pub segment_count: u32,
    pub durations_crc: u32,
    pub init_len: u32,
    pub media_sequence: u64,
}

/// `{final}.part`
pub fn part_path(final_path: &Path) -> PathBuf {
    with_suffix(final_path, ".part")
}

/// `{final}.part.json`
pub fn sidecar_path(final_path: &Path) -> PathBuf {
    with_suffix(final_path, ".part.json")
}

fn with_suffix(p: &Path, suffix: &str) -> PathBuf {
    let mut s = p.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

/// 잠근 `.part` 파일.
pub struct PartFile {
    w: BufWriter<File>,
    part: PathBuf,
    sidecar_path: PathBuf,
    final_path: PathBuf,
    sidecar: Sidecar,
    /// 쓴 바이트 수(버퍼 포함)
    written: u64,
}

impl std::fmt::Debug for PartFile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PartFile")
            .field("part", &self.part)
            .field("written", &self.written)
            .field("committed", &self.sidecar.committed_len)
            .finish()
    }
}

/// `.part`를 열고 배타 잠금한다. 잠겨 있으면 `FileLocked`.
fn open_locked(part: &Path, create: bool) -> Result<File, Error> {
    let f = OpenOptions::new()
        .read(true)
        .write(true)
        .create(create)
        .truncate(false) // 잠그기 전에 자르면 다른 작업의 파일을 망가뜨린다.
        .open(part)
        .map_err(|e| map_io_error("open", part, e))?;
    match f.try_lock() {
        Ok(()) => Ok(f),
        Err(TryLockError::WouldBlock) => Err(Error::FileLocked {
            path: part.to_path_buf(),
        }),
        Err(TryLockError::Error(e)) => Err(map_io_error("lock", part, e)),
    }
}

/// sidecar를 읽는다. 없거나 깨졌으면 `None`.
fn read_sidecar(path: &Path) -> Option<Sidecar> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// 파일을 지운다. 없으면 성공으로 본다.
fn remove_if_exists(p: &Path) -> Result<(), Error> {
    match std::fs::remove_file(p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(map_io_error("remove", p, e)),
    }
}

impl PartFile {
    /// 같은 작업의 `.part`가 있으면 잠그고 `committed_len`까지 잘라 연다.
    ///
    /// - `.part`가 없으면 `None`(새로 시작. `.part`는 응답을 확인한 뒤 `create`로 만든다).
    /// - sidecar가 없거나 다른 작업이거나 `.part`가 `committed_len`보다 짧으면, 잠금을 쥔 채
    ///   둘 다 지우고 `None`.
    /// - 다른 작업이 잠그고 있으면 `FileLocked`.
    pub fn resume(
        final_path: &Path,
        content: &ContentRef,
        quality_id: &str,
        kind: PlaybackKind,
    ) -> Result<Option<PartFile>, Error> {
        let part = part_path(final_path);
        let sc_path = sidecar_path(final_path);
        let mut f = match open_locked(&part, false) {
            Ok(f) => f,
            Err(Error::Io { source, .. }) if source.kind() == io::ErrorKind::NotFound => {
                return Ok(None);
            }
            Err(e) => return Err(e),
        };
        let len = f
            .metadata()
            .map_err(|e| map_io_error("stat", &part, e))?
            .len();
        let sidecar = read_sidecar(&sc_path)
            .filter(|s| s.same_job(content, quality_id, kind) && len >= s.committed_len);
        let Some(sidecar) = sidecar else {
            tracing::info!(part = %part.display(), "맞지 않는 .part를 지우고 새로 시작");
            // 잠금을 쥔 채 지운다(std는 Windows에서도 FILE_SHARE_DELETE로 연다).
            remove_if_exists(&sc_path)?;
            remove_if_exists(&part)?;
            return Ok(None);
        };
        if len > sidecar.committed_len {
            tracing::info!(
                len,
                committed = sidecar.committed_len,
                "크래시 꼬리를 잘라 냄"
            );
            f.set_len(sidecar.committed_len)
                .map_err(|e| map_io_error("truncate", &part, e))?;
        }
        f.seek(SeekFrom::Start(sidecar.committed_len))
            .map_err(|e| map_io_error("seek", &part, e))?;
        Ok(Some(PartFile {
            w: BufWriter::with_capacity(WRITE_BUF, f),
            part,
            sidecar_path: sc_path,
            final_path: final_path.to_path_buf(),
            written: sidecar.committed_len,
            sidecar,
        }))
    }

    /// 새 `.part`를 만든다. 잠근 뒤 길이를 0으로 하고 sidecar(`committed_len = 0`)를 곧바로 쓴다.
    ///
    /// sidecar를 바로 써 두어야 첫 checkpoint 전에 죽어도 다음 실행이 `.part`를 버리지 않는다.
    pub fn create(final_path: &Path, mut sidecar: Sidecar) -> Result<PartFile, Error> {
        let part = part_path(final_path);
        let sc_path = sidecar_path(final_path);
        let f = open_locked(&part, true)?;
        f.set_len(0)
            .map_err(|e| map_io_error("truncate", &part, e))?;
        sidecar.committed_len = 0;
        write_sidecar(&sc_path, &sidecar)?;
        Ok(PartFile {
            w: BufWriter::with_capacity(WRITE_BUF, f),
            part,
            sidecar_path: sc_path,
            final_path: final_path.to_path_buf(),
            written: 0,
            sidecar,
        })
    }

    /// 쓴 바이트 수(이어받은 분 포함, 버퍼 포함).
    pub fn written(&self) -> u64 {
        self.written
    }

    /// durable한 바이트 수.
    pub fn committed(&self) -> u64 {
        self.sidecar.committed_len
    }

    /// 마지막으로 기록한 sidecar.
    pub fn sidecar(&self) -> &Sidecar {
        &self.sidecar
    }

    /// `.part` 경로.
    pub fn path(&self) -> &Path {
        &self.part
    }

    /// 버퍼에 쓴다. 디스크 부족은 `DiskFull`.
    pub fn write(&mut self, buf: &[u8]) -> Result<(), Error> {
        self.w
            .write_all(buf)
            .map_err(|e| map_io_error("write", &self.part, e))?;
        self.written += buf.len() as u64;
        Ok(())
    }

    /// 지금까지 쓴 바이트를 durable하게 만들고 sidecar를 갱신한다.
    ///
    /// 순서: `flush` → `sync_data` → `committed_len = written`, `update` 적용 → sidecar 원자적 쓰기.
    /// 어느 단계에서 실패해도 기억한 sidecar(`committed_len`)는 바뀌지 않는다.
    pub async fn checkpoint(&mut self, update: impl FnOnce(&mut Sidecar)) -> Result<(), Error> {
        self.w
            .flush()
            .map_err(|e| map_io_error("write", &self.part, e))?;
        let mut next = self.sidecar.clone();
        next.committed_len = self.written;
        update(&mut next);
        let f = self
            .w
            .get_ref()
            .try_clone()
            .map_err(|e| map_io_error("sync", &self.part, e))?;
        let part = self.part.clone();
        let sc_path = self.sidecar_path.clone();
        let sc = next.clone();
        // fsync는 오래 걸릴 수 있어 blocking 스레드에서 한다.
        tokio::task::spawn_blocking(move || {
            f.sync_data().map_err(|e| map_io_error("sync", &part, e))?;
            write_sidecar(&sc_path, &sc)
        })
        .await
        .map_err(|e| Error::Io {
            op: "sync",
            path: self.part.clone(),
            source: io::Error::other(e.to_string()),
        })??;
        self.sidecar = next;
        Ok(())
    }

    /// 받은 내용을 버리고 처음부터 쓴다(서버가 Range를 무시하고 200을 준 경우).
    /// sidecar는 `committed_len = 0`과 `update`를 적용해 곧바로 기록한다.
    pub async fn restart(&mut self, update: impl FnOnce(&mut Sidecar)) -> Result<(), Error> {
        self.w
            .flush()
            .map_err(|e| map_io_error("write", &self.part, e))?;
        let f = self.w.get_mut();
        f.set_len(0)
            .map_err(|e| map_io_error("truncate", &self.part, e))?;
        f.seek(SeekFrom::Start(0))
            .map_err(|e| map_io_error("seek", &self.part, e))?;
        self.written = 0;
        self.checkpoint(update).await
    }

    /// 최종 파일로 옮긴다. 핸들을 닫아 잠금을 푼 뒤 `rename_with_retry`, 그다음 sidecar를 지운다.
    ///
    /// 최종 파일이 있으면 덮어쓴다(`Skip`은 다운로드 전에 이미 걸렀다).
    /// 최종 파일이 잠겨 있으면 `FileLocked`이고 `.part`는 남는다.
    pub async fn finalize(self) -> Result<PathBuf, Error> {
        let PartFile {
            mut w,
            part,
            sidecar_path,
            final_path,
            ..
        } = self;
        w.flush().map_err(|e| map_io_error("write", &part, e))?;
        let f = w.into_inner().map_err(|e| {
            let p = part.clone();
            map_io_error("write", &p, e.into_error())
        })?;
        let target = final_path.clone();
        tokio::task::spawn_blocking(move || {
            f.sync_data().map_err(|e| map_io_error("sync", &part, e))?;
            drop(f); // 잠금을 풀고 핸들을 닫는다. Windows는 열린 파일을 옮길 수 없다.
            rename_with_retry(&part, &target)?;
            remove_if_exists(&sidecar_path)
        })
        .await
        .map_err(|e| Error::Io {
            op: "rename",
            path: final_path.clone(),
            source: io::Error::other(e.to_string()),
        })??;
        Ok(final_path)
    }

    /// 잠금을 쥔 채 `.part`와 sidecar를 지운다(이어받을 수 없는 오류).
    pub fn discard(self) -> Result<(), Error> {
        let PartFile {
            w,
            part,
            sidecar_path,
            ..
        } = self;
        let res = remove_if_exists(&sidecar_path).and(remove_if_exists(&part));
        drop(w);
        res
    }
}

/// sidecar를 원자적으로 쓴다.
fn write_sidecar(path: &Path, s: &Sidecar) -> Result<(), Error> {
    let json = serde_json::to_vec(s).map_err(|e| Error::Io {
        op: "serialize",
        path: path.to_path_buf(),
        source: io::Error::other(e),
    })?;
    atomic_write(path, &json)
}

/// 최종 경로에 딸린 `.part`와 sidecar를 지운다(UI의 "처음부터").
///
/// 다른 작업이 `.part`를 잠그고 있으면 `FileLocked`이고 아무것도 지우지 않는다.
pub fn discard_partial(final_path: &Path) -> Result<(), Error> {
    let part = part_path(final_path);
    let sc = sidecar_path(final_path);
    match open_locked(&part, false) {
        Ok(f) => {
            let res = remove_if_exists(&sc).and(remove_if_exists(&part));
            drop(f);
            res
        }
        Err(Error::Io { source, .. }) if source.kind() == io::ErrorKind::NotFound => {
            remove_if_exists(&sc)
        }
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn content() -> ContentRef {
        ContentRef::Video { video_no: 1 }
    }

    fn sidecar() -> Sidecar {
        let mut s = Sidecar::new(content(), "720p", PlaybackKind::LiveRewindHls);
        s.hls = Some(HlsState {
            next_index: 0,
            segment_count: 10,
            durations_crc: 7,
            init_len: 3,
            media_sequence: 0,
        });
        s
    }

    fn resume(out: &Path, quality: &str) -> Result<Option<PartFile>, Error> {
        PartFile::resume(out, &content(), quality, PlaybackKind::LiveRewindHls)
    }

    #[test]
    fn paths() {
        let out = Path::new("/d/[x] a.mp4");
        assert_eq!(part_path(out), Path::new("/d/[x] a.mp4.part"));
        assert_eq!(sidecar_path(out), Path::new("/d/[x] a.mp4.part.json"));
    }

    #[test]
    fn sidecar_json_shape() {
        let v = serde_json::to_value(sidecar()).unwrap();
        assert_eq!(v["v"], 1);
        assert_eq!(v["content"]["kind"], "video");
        assert_eq!(v["qualityId"], "720p");
        assert_eq!(v["kind"], "liveRewindHls");
        assert_eq!(v["committedLen"], 0);
        assert_eq!(v["hls"]["nextIndex"], 0);
    }

    #[tokio::test]
    async fn create_writes_sidecar_immediately() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        let p = PartFile::create(&out, sidecar()).unwrap();
        let sc = read_sidecar(&sidecar_path(&out)).unwrap();
        assert_eq!(sc.committed_len, 0);
        assert_eq!(sc.hls.unwrap().segment_count, 10);
        drop(p);
        // 첫 checkpoint 전에 죽어도 재개 대상이다.
        let p = resume(&out, "720p").unwrap().unwrap();
        assert_eq!(p.written(), 0);
    }

    #[tokio::test]
    async fn checkpoint_then_resume() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        let mut p = PartFile::create(&out, sidecar()).unwrap();
        p.write(b"hello").unwrap();
        assert_eq!(p.committed(), 0);
        p.checkpoint(|s| s.hls.as_mut().unwrap().next_index = 2)
            .await
            .unwrap();
        assert_eq!(p.committed(), 5);
        drop(p);
        let mut p = resume(&out, "720p").unwrap().unwrap();
        assert_eq!(p.written(), 5);
        assert_eq!(p.sidecar().hls.unwrap().next_index, 2);
        p.write(b" world").unwrap();
        p.checkpoint(|_| {}).await.unwrap();
        let path = p.finalize().await.unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"hello world");
        assert!(!part_path(&out).exists());
        assert!(!sidecar_path(&out).exists());
    }

    /// 크래시로 `.part`가 `committed_len`보다 길면 꼬리를 잘라 내고 이어 쓴다.
    #[tokio::test]
    async fn crash_tail_truncated() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        let mut p = PartFile::create(&out, sidecar()).unwrap();
        p.write(b"0123").unwrap();
        p.checkpoint(|_| {}).await.unwrap();
        drop(p);
        // checkpoint 뒤에 쓰였지만 sidecar에 반영되지 않은 꼬리(크래시)
        let mut raw = OpenOptions::new()
            .append(true)
            .open(part_path(&out))
            .unwrap();
        raw.write_all(b"GARBAGE").unwrap();
        drop(raw);
        assert_eq!(std::fs::metadata(part_path(&out)).unwrap().len(), 11);

        let mut p = resume(&out, "720p").unwrap().unwrap();
        assert_eq!(p.written(), 4);
        p.write(b"4567").unwrap();
        p.checkpoint(|_| {}).await.unwrap();
        let path = p.finalize().await.unwrap();
        assert_eq!(std::fs::read(path).unwrap(), b"01234567");
    }

    /// `.part`가 `committed_len`보다 짧으면 믿을 수 없으므로 새로 시작한다.
    #[tokio::test]
    async fn short_part_restarts() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        let mut p = PartFile::create(&out, sidecar()).unwrap();
        p.write(b"0123").unwrap();
        p.checkpoint(|_| {}).await.unwrap();
        drop(p);
        std::fs::write(part_path(&out), b"01").unwrap();
        assert!(resume(&out, "720p").unwrap().is_none());
        assert!(!part_path(&out).exists());
        assert!(!sidecar_path(&out).exists());
    }

    #[tokio::test]
    async fn incompatible_sidecar_restarts() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        let mut p = PartFile::create(&out, sidecar()).unwrap();
        p.write(b"0123").unwrap();
        p.checkpoint(|_| {}).await.unwrap();
        drop(p);
        // 다른 화질
        assert!(resume(&out, "1080p").unwrap().is_none());
        assert!(!part_path(&out).exists());
        assert!(!sidecar_path(&out).exists());

        // sidecar 없이 `.part`만 있어도 새로 시작
        std::fs::write(part_path(&out), b"xx").unwrap();
        assert!(resume(&out, "720p").unwrap().is_none());
        assert!(!part_path(&out).exists());

        // 깨진 sidecar
        std::fs::write(part_path(&out), b"xx").unwrap();
        std::fs::write(sidecar_path(&out), b"{not json").unwrap();
        assert!(resume(&out, "720p").unwrap().is_none());
        assert!(!part_path(&out).exists());

        // 아무것도 없으면 None
        assert!(resume(&out, "720p").unwrap().is_none());
    }

    /// 같은 출력으로 두 작업: 두 번째는 `FileLocked`이고 첫 작업의 파일을 건드리지 않는다.
    #[tokio::test]
    async fn double_download_file_locked() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        let mut first = PartFile::create(&out, sidecar()).unwrap();
        first.write(b"abc").unwrap();
        first.checkpoint(|_| {}).await.unwrap();

        // 새로 시작하려는 두 번째 작업
        assert!(matches!(
            PartFile::create(&out, sidecar()),
            Err(Error::FileLocked { .. })
        ));
        // 이어받으려는 두 번째 작업(다른 화질이라 지우려 해도 잠금 때문에 못 지운다)
        assert!(matches!(
            resume(&out, "1080p"),
            Err(Error::FileLocked { .. })
        ));
        assert!(matches!(
            discard_partial(&out),
            Err(Error::FileLocked { .. })
        ));
        assert!(part_path(&out).exists());

        // 첫 작업은 그대로 끝난다.
        first.write(b"def").unwrap();
        first.checkpoint(|_| {}).await.unwrap();
        let path = first.finalize().await.unwrap();
        assert_eq!(std::fs::read(path).unwrap(), b"abcdef");
    }

    #[tokio::test]
    async fn restart_truncates() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        let mut p = PartFile::create(&out, sidecar()).unwrap();
        p.write(b"old data").unwrap();
        p.checkpoint(|_| {}).await.unwrap();
        p.restart(|_| {}).await.unwrap();
        assert_eq!(p.committed(), 0);
        p.write(b"new").unwrap();
        p.checkpoint(|_| {}).await.unwrap();
        let path = p.finalize().await.unwrap();
        assert_eq!(std::fs::read(path).unwrap(), b"new");
    }

    #[tokio::test]
    async fn finalize_overwrites_and_discard_removes() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        std::fs::write(&out, b"old").unwrap();
        let mut p = PartFile::create(&out, sidecar()).unwrap();
        p.write(b"new").unwrap();
        p.finalize().await.unwrap();
        assert_eq!(std::fs::read(&out).unwrap(), b"new");

        let p = PartFile::create(&out, sidecar()).unwrap();
        p.discard().unwrap();
        assert!(!part_path(&out).exists());
        assert!(!sidecar_path(&out).exists());

        // discard_partial: 없으면 성공, 있으면 지운다.
        discard_partial(&out).unwrap();
        let p = PartFile::create(&out, sidecar()).unwrap();
        drop(p);
        discard_partial(&out).unwrap();
        assert!(!part_path(&out).exists());
        assert!(!sidecar_path(&out).exists());
    }
}
