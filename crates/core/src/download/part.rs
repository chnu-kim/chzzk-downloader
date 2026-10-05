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

use super::DuplicatePolicy;
use crate::error::Error;
use crate::fsutil::{
    atomic_write, map_io_error, remove_stale_temps, rename_noclobber_with_retry, rename_with_retry,
};
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
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
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

/// `PartFile::finalize`의 결과.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Finalized {
    /// 최종 경로로 옮겼다
    Moved(PathBuf),
    /// `Skip`인데 최종 파일이 이미 있어 옮기지 않았다(`.part`와 sidecar는 남는다)
    TargetExists,
}

/// 잠근 `.part` 파일.
pub struct PartFile {
    w: BufWriter<File>,
    part: PathBuf,
    sidecar_path: PathBuf,
    final_path: PathBuf,
    /// 마지막으로 디스크에 기록한 sidecar
    sidecar: Sidecar,
    /// 다음 checkpoint에 기록할 상태. 엔진은 쓴 바이트와 맞도록 `stage`로 갱신한다.
    staged: Sidecar,
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
        // 잠금을 쥐었으니 이 sidecar를 쓰는 다른 작업은 없다. 죽은 작업이 남긴 임시 파일을 치운다.
        remove_stale_temps(&sc_path);
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
            staged: sidecar.clone(),
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
        remove_stale_temps(&sc_path);
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
            staged: sidecar.clone(),
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

    /// 다음 checkpoint에 기록할 상태를 바꾼다(디스크에는 아직 쓰지 않는다).
    ///
    /// 엔진은 쓴 바이트와 상태(예: HLS `next_index`)가 늘 맞도록 쓰기 직후에 부른다.
    /// 그래야 오류·취소 경로의 `checkpoint(|_| {})`가 일관된 sidecar를 남긴다.
    pub fn stage(&mut self, update: impl FnOnce(&mut Sidecar)) {
        update(&mut self.staged);
    }

    /// 다음 checkpoint에 기록할 상태.
    pub fn staged(&self) -> &Sidecar {
        &self.staged
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
    /// 순서: `flush` → `sync_data` → `committed_len = written`, `update`를 staged 상태에 적용 →
    /// sidecar 원자적 쓰기. 어느 단계에서 실패해도 기록된 sidecar(`committed_len`)는 바뀌지 않는다.
    pub async fn checkpoint(&mut self, update: impl FnOnce(&mut Sidecar)) -> Result<(), Error> {
        self.w
            .flush()
            .map_err(|e| map_io_error("write", &self.part, e))?;
        update(&mut self.staged);
        let mut next = self.staged.clone();
        next.committed_len = self.written;
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
        self.staged = next.clone();
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

    /// 최종 파일로 옮긴다. 옮긴 뒤 sidecar를 지운다.
    ///
    /// - `Overwrite`: 최종 파일이 있으면 덮어쓴다(`rename_with_retry`).
    /// - `Skip`: 덮어쓰지 않는다(`rename_noclobber_with_retry`). 다운로드를 시작한 뒤에 같은 이름의 파일이
    ///   생겼으면 옮기지 않고 `TargetExists`다. 이때 `.part`와 sidecar는 그대로 남아, 덮어쓰기로 다시
    ///   시작하면 받은 내용으로 곧바로 마무리된다.
    ///
    /// 최종 파일이 잠겨 있으면 `FileLocked`이고 `.part`는 남는다.
    /// 옮긴 뒤의 sidecar 삭제 실패는 경고만 남긴다(다운로드는 끝났다).
    pub async fn finalize(self, policy: DuplicatePolicy) -> Result<Finalized, Error> {
        match policy {
            DuplicatePolicy::Overwrite => {
                self.finalize_using(|a, b| rename_with_retry(a, b).map(|()| true))
                    .await
            }
            DuplicatePolicy::Skip => self.finalize_using(rename_noclobber_with_retry).await,
        }
    }

    /// `finalize`의 본체. rename을 주입받아 잠금을 쥔 채 옮기는지 테스트한다.
    /// `rename`은 옮겼으면 `true`, 최종 파일이 있어 옮기지 않았으면 `false`다.
    async fn finalize_using(
        self,
        rename: impl FnOnce(&Path, &Path) -> Result<bool, Error> + Send + 'static,
    ) -> Result<Finalized, Error> {
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
        let moved = tokio::task::spawn_blocking(move || {
            f.sync_data().map_err(|e| map_io_error("sync", &part, e))?;
            // Windows는 열린 파일을 옮길 수 없어 먼저 닫는다(잠금도 풀린다). Unix는 잠금을 쥔 채
            // 옮겨, 그 사이에 같은 출력의 다른 작업이 `.part`를 잠그고 지우거나 자르지 못하게 한다.
            let held = if cfg!(windows) {
                drop(f);
                None
            } else {
                Some(f)
            };
            let moved = rename(&part, &target)?;
            if moved && let Err(e) = remove_if_exists(&sidecar_path) {
                tracing::warn!(error = %e, "완료 후 sidecar 삭제 실패");
            }
            drop(held);
            Ok::<bool, Error>(moved)
        })
        .await
        .map_err(|e| Error::Io {
            op: "rename",
            path: final_path.clone(),
            source: io::Error::other(e.to_string()),
        })??;
        if moved {
            Ok(Finalized::Moved(final_path))
        } else {
            tracing::info!(path = %final_path.display(), "받는 동안 같은 이름의 파일이 생겨 덮어쓰지 않았다");
            Ok(Finalized::TargetExists)
        }
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
            remove_stale_temps(&sc);
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

    fn moved(f: Finalized) -> PathBuf {
        match f {
            Finalized::Moved(p) => p,
            Finalized::TargetExists => panic!("옮기지 않았다"),
        }
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
        let path = moved(p.finalize(DuplicatePolicy::Overwrite).await.unwrap());
        assert_eq!(std::fs::read(&path).unwrap(), b"hello world");
        assert!(!part_path(&out).exists());
        assert!(!sidecar_path(&out).exists());
    }

    /// stage한 상태는 다음 checkpoint에 함께 기록된다.
    #[tokio::test]
    async fn staged_state_goes_with_checkpoint() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        let mut p = PartFile::create(&out, sidecar()).unwrap();
        p.write(b"seg").unwrap();
        p.stage(|s| s.hls.as_mut().unwrap().next_index = 1);
        assert_eq!(p.sidecar().hls.unwrap().next_index, 0);
        p.checkpoint(|_| {}).await.unwrap();
        assert_eq!(p.sidecar().hls.unwrap().next_index, 1);
        assert_eq!(p.sidecar().committed_len, 3);
        let on_disk = read_sidecar(&sidecar_path(&out)).unwrap();
        assert_eq!(on_disk, *p.sidecar());
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
        let path = moved(p.finalize(DuplicatePolicy::Overwrite).await.unwrap());
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
        let path = moved(first.finalize(DuplicatePolicy::Overwrite).await.unwrap());
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
        let path = moved(p.finalize(DuplicatePolicy::Overwrite).await.unwrap());
        assert_eq!(std::fs::read(path).unwrap(), b"new");
    }

    /// Unix는 잠금을 쥔 채 rename한다. 그 순간 다른 작업은 `.part`를 잠글 수 없다.
    #[cfg(unix)]
    #[tokio::test]
    async fn finalize_renames_while_locked() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        let mut p = PartFile::create(&out, sidecar()).unwrap();
        p.write(b"done").unwrap();
        let path = p
            .finalize_using(|from, to| {
                assert!(matches!(
                    open_locked(from, false),
                    Err(Error::FileLocked { .. })
                ));
                assert!(matches!(
                    PartFile::create(&final_of(from), sidecar()),
                    Err(Error::FileLocked { .. })
                ));
                rename_with_retry(from, to).map(|()| true)
            })
            .await
            .unwrap();
        let path = moved(path);
        assert_eq!(std::fs::read(path).unwrap(), b"done");
        assert!(!part_path(&out).exists() && !sidecar_path(&out).exists());
    }

    /// `{final}.part` → `{final}`
    #[cfg(unix)]
    fn final_of(part: &Path) -> PathBuf {
        PathBuf::from(part.to_str().unwrap().strip_suffix(".part").unwrap())
    }

    /// 옮긴 뒤 sidecar를 지우지 못해도 완료로 본다.
    #[tokio::test]
    async fn finalize_ok_when_sidecar_remove_fails() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        let mut p = PartFile::create(&out, sidecar()).unwrap();
        p.write(b"done").unwrap();
        // sidecar 자리를 비어 있지 않은 디렉토리로 바꿔 remove_file이 실패하게 한다.
        let sc = sidecar_path(&out);
        std::fs::remove_file(&sc).unwrap();
        std::fs::create_dir(&sc).unwrap();
        std::fs::write(sc.join("x"), b"x").unwrap();
        let path = moved(p.finalize(DuplicatePolicy::Overwrite).await.unwrap());
        assert_eq!(path, out);
        assert_eq!(std::fs::read(&out).unwrap(), b"done");
        assert!(!part_path(&out).exists());
    }

    /// 재개·처음부터(`discard_partial`)는 잠금을 쥔 뒤 죽은 작업의 sidecar 임시 파일을 치운다.
    #[tokio::test]
    async fn stale_sidecar_temps_cleaned() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        let stale = dir.path().join("a.mp4.part.json.Ab12Cd.tmp");
        let mut p = PartFile::create(&out, sidecar()).unwrap();
        p.write(b"x").unwrap();
        p.checkpoint(|_| {}).await.unwrap();
        drop(p);
        std::fs::write(&stale, b"{").unwrap();
        let p = resume(&out, "720p").unwrap().unwrap();
        assert!(!stale.exists());
        drop(p);
        std::fs::write(&stale, b"{").unwrap();
        discard_partial(&out).unwrap();
        assert!(!stale.exists());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn finalize_overwrites_and_discard_removes() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        std::fs::write(&out, b"old").unwrap();
        let mut p = PartFile::create(&out, sidecar()).unwrap();
        p.write(b"new").unwrap();
        p.finalize(DuplicatePolicy::Overwrite).await.unwrap();
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

    /// `Skip`: 받는 동안 같은 이름의 파일이 생겼으면 덮어쓰지 않는다. `.part`와 sidecar는 남아 이어받을 수 있다.
    #[tokio::test]
    async fn finalize_skip_does_not_clobber_file_created_meanwhile() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a (2).mp4");
        let mut p = PartFile::create(&out, sidecar()).unwrap();
        p.write(b"new").unwrap();
        p.checkpoint(|_| {}).await.unwrap();
        // 사전 검사 뒤 다른 프로그램(또는 사용자)이 같은 이름을 만들었다.
        std::fs::write(&out, b"theirs").unwrap();
        let r = p.finalize(DuplicatePolicy::Skip).await.unwrap();
        assert_eq!(r, Finalized::TargetExists);
        assert_eq!(std::fs::read(&out).unwrap(), b"theirs");
        assert_eq!(std::fs::read(part_path(&out)).unwrap(), b"new");
        assert!(sidecar_path(&out).exists());
        // 남은 `.part`는 같은 작업으로 이어받을 수 있고, 덮어쓰기로 마무리된다.
        let p = resume(&out, "720p").unwrap().unwrap();
        assert_eq!(p.written(), 3);
        let path = moved(p.finalize(DuplicatePolicy::Overwrite).await.unwrap());
        assert_eq!(std::fs::read(path).unwrap(), b"new");
        assert!(!part_path(&out).exists() && !sidecar_path(&out).exists());
    }

    /// `Skip`이어도 최종 파일이 없으면 보통처럼 옮긴다.
    #[tokio::test]
    async fn finalize_skip_moves_when_free() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        let mut p = PartFile::create(&out, sidecar()).unwrap();
        p.write(b"done").unwrap();
        let path = moved(p.finalize(DuplicatePolicy::Skip).await.unwrap());
        assert_eq!(path, out);
        assert_eq!(std::fs::read(&out).unwrap(), b"done");
        assert!(!part_path(&out).exists() && !sidecar_path(&out).exists());
    }
}
