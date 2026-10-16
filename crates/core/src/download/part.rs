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

/// `.part`의 주인을 가리는 열쇠(core.md 61). `DownloadRequest::owner`·셸 `JobRecord::owner`가 만든다.
#[derive(Clone, Copy, Debug)]
pub struct PartOwner<'a> {
    pub content: &'a ContentRef,
    pub quality_id: &'a str,
    pub kind: PlaybackKind,
    /// 생방송 녹화 작업의 고유값. 그 밖은 `None`
    pub recording_id: Option<&'a str>,
}

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
    /// 생방송 녹화 작업의 고유값(`DownloadRequest::recording_id`). 같은 값의 요청만 이 `.part`를 마무리하거나 지운다.
    /// v0.7.0이 쓴 sidecar에는 없다(`None`, core.md 61 호환 규칙)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recording_id: Option<String>,
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
            recording_id: None,
        }
    }

    /// 같은 작업(컨텐츠·화질·방식)의 sidecar인가.
    pub fn same_job(&self, content: &ContentRef, quality_id: &str, kind: PlaybackKind) -> bool {
        self.v == SIDECAR_VERSION
            && &self.content == content
            && self.quality_id == quality_id
            && self.kind == kind
    }

    /// 이 요청이 이 `.part`의 주인인가. 생방송은 녹화 고유값까지 같아야 한다(`None == None`은 v0.7.0 호환으로 같다).
    pub fn owned_by(&self, o: &PartOwner<'_>) -> bool {
        self.same_job(o.content, o.quality_id, o.kind)
            && (self.kind != PlaybackKind::Live || self.recording_id.as_deref() == o.recording_id)
    }

    /// 다른 작업의 생방송 녹화인가(다시 받을 수 없으니 지우지도 이어 쓰지도 않는다).
    pub fn is_other_recording(&self, o: &PartOwner<'_>) -> bool {
        self.kind == PlaybackKind::Live && !self.owned_by(o)
    }

    /// 길이 `part_len`인 `.part`가 이 sidecar가 적은 파일일 수 있는가. 불변식(`committed_len` ≤ durable 길이) 때문에
    /// 더 짧은 `.part`는 이 sidecar의 파일이 아니다(완료 뒤 sidecar 삭제 실패로 남은 sidecar 옆에 새로 생긴 빈 `.part` 등).
    /// 그런 sidecar는 남의 녹화라도 지킬 데이터가 없다(Codex PR #113 확인).
    pub fn describes(&self, part_len: u64) -> bool {
        part_len >= self.committed_len
    }

    /// 마무리할 영상 조각이 있는 생방송 `.part`인가(init만 든 것은 아니다). `download::run`과 셸 자동 이어받기가 같은 규칙을 쓴다.
    pub fn has_live_media(&self) -> bool {
        self.kind == PlaybackKind::Live
            && self
                .hls
                .is_some_and(|h| h.init_len > 0 && self.committed_len > u64::from(h.init_len))
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

/// `create`용: `.part`를 만들거나 열어 배타 잠금한다. 이번에 새로 만들었으면(전에 `.part`가 없었다) `true`.
///
/// 새로 만든 파일과 이미 있던 파일을 가르려고 먼저 `create_new`로 열고, 이미 있으면 그대로 연다. 그 사이에 다른
/// 작업이 지웠으면 한 번 더 해 본다.
fn open_locked_new(part: &Path) -> Result<(File, bool), Error> {
    for _ in 0..2 {
        match OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(part)
        {
            Ok(f) => {
                return match f.try_lock() {
                    Ok(()) => Ok((f, true)),
                    Err(TryLockError::WouldBlock) => Err(Error::FileLocked {
                        path: part.to_path_buf(),
                    }),
                    Err(TryLockError::Error(e)) => Err(map_io_error("lock", part, e)),
                };
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(map_io_error("open", part, e)),
        }
        match open_locked(part, false) {
            Ok(f) => return Ok((f, false)),
            Err(Error::Io { source, .. }) if source.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
    }
    open_locked(part, true).map(|f| (f, false))
}

/// sidecar를 읽는다. 없거나 깨졌으면 `Ok(None)`(주인 없는 파일).
///
/// 그 밖의 읽기 실패(권한·Windows 공유 위반 등)는 주인을 모르는 것이 아니라 확인하지 못한 것이라 오류다.
/// 부르는 쪽은 아무것도 지우지 않고 알린다(남의 녹화일 수 있다, core.md 61 D4).
fn read_sidecar(path: &Path) -> Result<Option<Sidecar>, Error> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes).ok()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(map_io_error("read", path, e)),
    }
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
    /// - 다른 작업의 생방송 녹화면 `PartialRecording`(아무것도 지우지 않는다. 녹화는 다시 받을 수 없다).
    /// - 다른 작업이 잠그고 있으면 `FileLocked`.
    pub fn resume(final_path: &Path, owner: &PartOwner<'_>) -> Result<Option<PartFile>, Error> {
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
        let sidecar = read_sidecar(&sc_path)?;
        if let Some(s) = &sidecar
            && s.is_other_recording(owner)
            && s.describes(len)
        {
            // 다른 작업의 녹화다. 다시 받을 수 없으니 지우지 않고 잠금만 풀고 알린다(core.md 61)
            tracing::info!(part = %part.display(), "다른 작업의 녹화라 건드리지 않는다");
            drop(f);
            return Err(Error::PartialRecording { path: part });
        }
        let sidecar = sidecar.filter(|s| s.owned_by(owner) && len >= s.committed_len);
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
    ///
    /// `resume`이 `None`을 준 뒤 첫 응답을 기다리는 사이 다른 작업(다른 프로세스·코어 직접 호출)이 같은 경로에 녹화를
    /// 남기고 잠금을 풀었을 수 있다. 그래서 잠금을 쥔 뒤 sidecar를 다시 보고, 다른 작업의 생방송 녹화면 자르지 않고
    /// `PartialRecording`이다(core.md 61). sidecar를 읽지 못하면 자르지 않고 오류다(`read_sidecar`).
    /// `.part`가 없어 이번에 새로 만들었으면 남은 sidecar는 지킬 데이터가 없는 것이라(완료 뒤 sidecar 삭제 실패·`.part`만
    /// 지움·`finalize`가 옮기고 sidecar를 지우기 전의 틈) 보지 않고 덮어쓴다. `committed_len`보다 짧은 `.part`도 같다.
    pub fn create(final_path: &Path, mut sidecar: Sidecar) -> Result<PartFile, Error> {
        let part = part_path(final_path);
        let sc_path = sidecar_path(final_path);
        let (f, fresh) = open_locked_new(&part)?;
        remove_stale_temps(&sc_path);
        let owner = PartOwner {
            content: &sidecar.content,
            quality_id: &sidecar.quality_id,
            kind: sidecar.kind,
            recording_id: sidecar.recording_id.as_deref(),
        };
        let guarded = |old: Sidecar| -> Result<bool, Error> {
            if fresh || !old.is_other_recording(&owner) {
                return Ok(false);
            }
            let len = f
                .metadata()
                .map_err(|e| map_io_error("stat", &part, e))?
                .len();
            Ok(old.describes(len))
        };
        let old = if fresh { None } else { read_sidecar(&sc_path)? };
        if old.map(guarded).transpose()? == Some(true) {
            tracing::info!(part = %part.display(), "다른 작업의 녹화가 생겨 새로 만들지 않는다");
            drop(f);
            return Err(Error::PartialRecording { path: part });
        }
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

    /// 버퍼에 쓴다. 디스크 부족은 `DiskFull`, 파일 크기 한도는 `FileTooLarge`(받은 부분은 남는다, core.md 61).
    pub fn write(&mut self, buf: &[u8]) -> Result<(), Error> {
        self.write_using(buf, |w, b| w.write_all(b))
    }

    /// `write`의 본체. 쓰기를 주입받아, 실패한 쓰기가 `written`을 늘리지 않는지 테스트한다.
    fn write_using(
        &mut self,
        buf: &[u8],
        write: impl FnOnce(&mut BufWriter<File>, &[u8]) -> io::Result<()>,
    ) -> Result<(), Error> {
        write(&mut self.w, buf).map_err(|e| map_io_error("write", &self.part, e))?;
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

    /// flush한 뒤 같은 열린 파일을 빌려 준다. 오래 걸리는 파일 작업(생방송 변환)이 런타임 스레드를 막지 않게,
    /// flush 뒤 핸들을 복제(`try_clone`, 같은 열린 파일·같은 잠금)해 `spawn_blocking`에서 `f`를 돌린다.
    pub(crate) async fn with_file_blocking<R: Send + 'static>(
        &mut self,
        f: impl FnOnce(&mut File) -> Result<R, Error> + Send + 'static,
    ) -> Result<R, Error> {
        self.w
            .flush()
            .map_err(|e| map_io_error("write", &self.part, e))?;
        let mut file = self
            .w
            .get_ref()
            .try_clone()
            .map_err(|e| map_io_error("sync", &self.part, e))?;
        let r = tokio::task::spawn_blocking(move || f(&mut file))
            .await
            .map_err(|e| Error::Io {
                op: "write",
                path: self.part.clone(),
                source: io::Error::other(e.to_string()),
            })?;
        // 복제 핸들과 위치를 공유한다. `f`가 길이를 바꿀 수 있으니 성공·실패와 상관없이 (sidecar는 바꾸지 않는다) 쓰기 위치와 `written`을 맞춘다.
        let end = self
            .w
            .get_mut()
            .seek(SeekFrom::End(0))
            .map_err(|e| map_io_error("seek", &self.part, e))?;
        self.written = end;
        r
    }

    /// 마지막 checkpoint 뒤에 쓴 바이트를 버린 것으로 한다(`written = committed`). 파일 꼬리는 그대로 두고, 다음 checkpoint는
    /// 그 앞까지만 기록하며 다음 `resume`이 꼬리를 자른다. 생방송 변환이 도중에 실패했을 때 쓴다(core.md 61 M4).
    pub(crate) fn drop_uncommitted_tail(&mut self) {
        self.written = self.sidecar.committed_len;
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
            sidecar: mine,
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
            // Windows의 이 틈에도 sidecar는 rename 뒤에야 지우므로, 잠금을 쥔 뒤 소유를 다시 보는 `resume`·`create`·
            // `discard_partial`은 남의 녹화를 자르거나 지우지 않는다. rename 뒤의 틈에 새로 생긴 `.part`는 `create`가 새 파일로
            // 보고, 그 sidecar는 `remove_own_sidecar`가 지우지 않는다.
            let held = if cfg!(windows) {
                drop(f);
                None
            } else {
                Some(f)
            };
            let moved = rename(&part, &target)?;
            if moved {
                remove_own_sidecar(&sidecar_path, &mine);
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

/// 완료 뒤 sidecar를 지운다. 옮긴 뒤 지우기 전 틈에 다른 작업이 새 `.part`를 만들고 자기 sidecar를 썼으면 그것은
/// 두고 간다(첫 checkpoint 전에 주인을 잃지 않게). 읽기와 지우기 사이의 더 좁은 틈은 남는다. 실패는 경고만 남긴다:
/// 남은 sidecar는 `.part` 없이는 아무것도 막지 않는다(`create`가 덮어쓴다).
fn remove_own_sidecar(path: &Path, mine: &Sidecar) {
    let owner = PartOwner {
        content: &mine.content,
        quality_id: &mine.quality_id,
        kind: mine.kind,
        recording_id: mine.recording_id.as_deref(),
    };
    if let Ok(Some(now)) = read_sidecar(path)
        && !now.owned_by(&owner)
    {
        tracing::info!(path = %path.display(), "다른 작업이 새로 쓴 sidecar라 지우지 않는다");
        return;
    }
    if let Err(e) = remove_if_exists(path) {
        tracing::warn!(error = %e, "완료 후 sidecar 삭제 실패");
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

/// `discard_partial`의 결과.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Discarded {
    /// 지웠다(없었던 경우 포함)
    Removed,
    /// 다른 작업의 `.part`라 지우지 않았다
    NotOwned,
}

/// 이 작업의 `.part`와 sidecar를 지운다(UI의 "처음부터"·목록에서 지우기).
///
/// - sidecar가 `owner`의 것이 아니면 아무것도 지우지 않고 `NotOwned`(core.md 61 M1). sidecar가 없거나 깨졌으면
///   주인을 모르는 파일이라 지운다(생방송 `.part`는 `create`가 sidecar를 곧바로 쓴다).
/// - 다른 작업이 `.part`를 잠그고 있으면 `FileLocked`이고 아무것도 지우지 않는다.
pub fn discard_partial(final_path: &Path, owner: &PartOwner<'_>) -> Result<Discarded, Error> {
    let part = part_path(final_path);
    let sc = sidecar_path(final_path);
    match open_locked(&part, false) {
        Ok(f) => {
            remove_stale_temps(&sc);
            let sidecar = match read_sidecar(&sc) {
                Ok(s) => s,
                Err(e) => {
                    drop(f);
                    return Err(e);
                }
            };
            let len = match f.metadata() {
                Ok(m) => m.len(),
                Err(e) => {
                    drop(f);
                    return Err(map_io_error("stat", &part, e));
                }
            };
            if sidecar.is_some_and(|s| !s.owned_by(owner) && s.describes(len)) {
                tracing::info!(part = %part.display(), "다른 작업의 .part라 지우지 않는다");
                drop(f);
                return Ok(Discarded::NotOwned);
            }
            let res = remove_if_exists(&sc).and(remove_if_exists(&part));
            drop(f);
            res.map(|()| Discarded::Removed)
        }
        Err(Error::Io { source, .. }) if source.kind() == io::ErrorKind::NotFound => {
            remove_if_exists(&sc).map(|()| Discarded::Removed)
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

    fn owner<'a>(c: &'a ContentRef, quality: &'a str) -> PartOwner<'a> {
        PartOwner {
            content: c,
            quality_id: quality,
            kind: PlaybackKind::LiveRewindHls,
            recording_id: None,
        }
    }

    fn resume(out: &Path, quality: &str) -> Result<Option<PartFile>, Error> {
        PartFile::resume(out, &owner(&content(), quality))
    }

    fn discard(out: &Path) -> Result<Discarded, Error> {
        discard_partial(out, &owner(&content(), "720p"))
    }

    fn live_content() -> ContentRef {
        ContentRef::Live {
            channel_id: "chan".into(),
        }
    }

    /// 생방송 sidecar(영상 조각 `committed - init`바이트)
    fn live_sc(id: Option<&str>, init: u32, committed: u64) -> Sidecar {
        let mut s = Sidecar::new(live_content(), "144p", PlaybackKind::Live);
        s.recording_id = id.map(str::to_owned);
        s.committed_len = committed;
        s.hls = Some(HlsState {
            init_len: init,
            ..HlsState::default()
        });
        s
    }

    fn live_owner<'a>(c: &'a ContentRef, id: Option<&'a str>) -> PartOwner<'a> {
        PartOwner {
            content: c,
            quality_id: "144p",
            kind: PlaybackKind::Live,
            recording_id: id,
        }
    }

    /// 생방송 `.part`(init 4바이트 + 영상 8바이트)를 만들어 checkpoint하고 놓는다.
    async fn write_recording(out: &Path, id: Option<&str>) {
        let mut p = PartFile::create(out, live_sc(id, 4, 0)).unwrap();
        p.write(b"initMEDIAmed").unwrap();
        p.checkpoint(|_| {}).await.unwrap();
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

    /// `Debug`는 경로와 바이트 수만 보인다(서명 값이 없다). `path()`는 `.part` 경로를 돌려준다.
    #[test]
    fn debug_and_path_of_part_file() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        let mut p = PartFile::create(&out, sidecar()).unwrap();
        p.write(b"abc").unwrap();
        assert_eq!(p.path(), part_path(&out));
        let d = format!("{p:?}");
        assert!(
            d.contains("PartFile") && d.contains("written: 3") && d.contains("committed: 0"),
            "{d}"
        );
    }

    #[tokio::test]
    async fn create_writes_sidecar_immediately() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        let p = PartFile::create(&out, sidecar()).unwrap();
        let sc = read_sidecar(&sidecar_path(&out)).unwrap().unwrap();
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
        let on_disk = read_sidecar(&sidecar_path(&out)).unwrap().unwrap();
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

    /// F4: 파일 크기 한도(EFBIG)로 쓰기가 반쯤 실패해도 `written`은 늘지 않고, checkpoint는 그 앞까지만 기록한다.
    /// 다음 `resume`은 반쯤 쓴 꼬리를 자르고, 받은 만큼 마무리할 수 있다.
    #[tokio::test]
    async fn write_failure_keeps_committed_prefix() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        let mut p = PartFile::create(&out, sidecar()).unwrap();
        p.write(b"aaaa").unwrap();
        p.checkpoint(|_| {}).await.unwrap();
        p.write(b"bbbb").unwrap();
        let err = p
            .write_using(b"cccccccc", |w, b| {
                w.flush()?;
                w.get_mut().write_all(&b[..3])?;
                Err(io::Error::from(io::ErrorKind::FileTooLarge))
            })
            .unwrap_err();
        assert!(
            matches!(&err, Error::FileTooLarge { path } if *path == part_path(&out)),
            "{err:?}"
        );
        assert_eq!(p.written(), 8, "실패한 쓰기는 written을 늘리지 않는다");
        // 실패 뒤 정리(`cleanup(keep)`)와 같은 순서
        p.checkpoint(|_| {}).await.unwrap();
        assert_eq!(p.committed(), 8);
        drop(p);
        assert_eq!(std::fs::metadata(part_path(&out)).unwrap().len(), 11);
        let p = resume(&out, "720p").unwrap().unwrap();
        assert_eq!(p.written(), 8);
        let path = moved(p.finalize(DuplicatePolicy::Overwrite).await.unwrap());
        assert_eq!(std::fs::read(path).unwrap(), b"aaaabbbb");
    }

    /// M4: 변환이 파일 끝을 늘린 채 실패하면 `written`을 마지막 checkpoint로 돌린다. 그래야 정리 checkpoint가
    /// 반쯤 붙은 꼬리를 `committed_len`에 넣지 않고, 다음 `resume`이 그 꼬리를 자른다.
    #[tokio::test]
    async fn dropped_tail_is_not_committed() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        let mut p = PartFile::create(&out, sidecar()).unwrap();
        p.write(b"abc").unwrap();
        p.checkpoint(|_| {}).await.unwrap();
        p.with_file_blocking(|f| {
            f.seek(SeekFrom::End(0)).map_err(|e| Error::Io {
                op: "seek",
                path: PathBuf::from("t"),
                source: e,
            })?;
            f.write_all(b"XYZ").map_err(|e| Error::Io {
                op: "write",
                path: PathBuf::from("t"),
                source: e,
            })
        })
        .await
        .unwrap();
        assert_eq!(p.written(), 6, "변환이 늘린 길이까지 센다");
        p.drop_uncommitted_tail();
        assert_eq!(p.written(), 3);
        p.checkpoint(|_| {}).await.unwrap();
        assert_eq!(p.committed(), 3);
        drop(p);
        let p = resume(&out, "720p").unwrap().unwrap();
        assert_eq!(p.written(), 3);
        let path = moved(p.finalize(DuplicatePolicy::Overwrite).await.unwrap());
        assert_eq!(std::fs::read(path).unwrap(), b"abc");
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

    #[test]
    fn owned_by_compat_rules() {
        let c = live_content();
        let a = live_sc(Some("a"), 4, 12);
        let none = live_sc(None, 4, 12);
        // 옛 작업(None)+옛 sidecar(None) = 내 것
        assert!(none.owned_by(&live_owner(&c, None)));
        // 새 작업(Some)+옛 sidecar(None) = 남의 것
        assert!(!none.owned_by(&live_owner(&c, Some("a"))));
        assert!(none.is_other_recording(&live_owner(&c, Some("a"))));
        // 옛 작업(None)+새 sidecar(Some) = 남의 것
        assert!(!a.owned_by(&live_owner(&c, None)));
        // Some == Some = 내 것, 다르면 남의 것
        assert!(a.owned_by(&live_owner(&c, Some("a"))));
        assert!(!a.owned_by(&live_owner(&c, Some("b"))));
        assert!(!a.is_other_recording(&live_owner(&c, Some("a"))));
        // VOD sidecar는 recording_id를 보지 않는다
        let v = sidecar();
        let vc = content();
        let vo = |id| PartOwner {
            content: &vc,
            quality_id: "720p",
            kind: PlaybackKind::LiveRewindHls,
            recording_id: id,
        };
        assert!(v.owned_by(&vo(None)) && v.owned_by(&vo(Some("x"))));
        assert!(!v.is_other_recording(&vo(None)));
        // 다른 화질의 생방송 sidecar는 주인이 아니다
        let o = PartOwner {
            quality_id: "720p",
            ..live_owner(&c, Some("a"))
        };
        assert!(!a.owned_by(&o));
    }

    #[test]
    fn has_live_media_needs_more_than_init() {
        assert!(!live_sc(None, 10, 10).has_live_media());
        assert!(live_sc(None, 10, 11).has_live_media());
        // init 길이를 모르면 마무리할 수 없다
        assert!(!live_sc(None, 0, 100).has_live_media());
        let mut no_hls = live_sc(None, 10, 100);
        no_hls.hls = None;
        assert!(!no_hls.has_live_media());
        let mut vod = sidecar();
        vod.committed_len = 100;
        assert!(!vod.has_live_media());
    }

    #[test]
    fn recording_id_is_omitted_when_absent() {
        let v = serde_json::to_value(sidecar()).unwrap();
        assert!(v.get("recordingId").is_none());
        let v = serde_json::to_value(live_sc(Some("a"), 1, 1)).unwrap();
        assert_eq!(v["recordingId"], "a");
        // v0.7.0 sidecar(필드 없음)를 읽는다
        let old: Sidecar =
            serde_json::from_value(serde_json::to_value(sidecar()).unwrap()).unwrap();
        assert_eq!(old.recording_id, None);
    }

    /// 다른 작업의 녹화는 지우지도 이어 쓰지도 않는다(M5): 잠금은 풀려 주인은 계속 쓸 수 있다.
    #[tokio::test]
    async fn resume_refuses_recording_of_other_job() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        write_recording(&out, Some("a")).await;
        let before = std::fs::read(part_path(&out)).unwrap();
        let sc_before = std::fs::read(sidecar_path(&out)).unwrap();
        let c = live_content();
        let err = PartFile::resume(&out, &live_owner(&c, Some("b"))).unwrap_err();
        assert!(
            matches!(&err, Error::PartialRecording { path } if *path == part_path(&out)),
            "{err:?}"
        );
        assert_eq!(std::fs::read(part_path(&out)).unwrap(), before);
        assert_eq!(std::fs::read(sidecar_path(&out)).unwrap(), sc_before);
        // 잠금이 풀렸다: 주인은 이어 받는다
        let p = PartFile::resume(&out, &live_owner(&c, Some("a")))
            .unwrap()
            .unwrap();
        assert_eq!(p.written(), 12);
    }

    #[tokio::test]
    async fn resume_refuses_v070_recording_for_new_job() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        write_recording(&out, None).await;
        let before = std::fs::read(part_path(&out)).unwrap();
        let c = live_content();
        let err = PartFile::resume(&out, &live_owner(&c, Some("b"))).unwrap_err();
        assert!(matches!(err, Error::PartialRecording { .. }), "{err:?}");
        assert_eq!(std::fs::read(part_path(&out)).unwrap(), before);
        assert!(sidecar_path(&out).exists());
    }

    #[tokio::test]
    async fn resume_v070_job_keeps_v070_recording() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        write_recording(&out, None).await;
        let c = live_content();
        let p = PartFile::resume(&out, &live_owner(&c, None))
            .unwrap()
            .unwrap();
        assert_eq!(p.written(), p.committed());
        assert_eq!(p.written(), 12);
    }

    /// 경합: A가 `resume`(없음)을 지난 뒤 응답을 기다리는 동안 B가 녹화를 남기고 잠금을 풀었다. A의 `create`는
    /// 잠금을 쥔 뒤 sidecar를 다시 보고 B의 녹화를 자르지 않는다(Codex PR #113 ①). VOD 요청도 같다.
    #[tokio::test]
    async fn create_refuses_recording_left_meanwhile() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        let c = live_content();
        assert!(
            PartFile::resume(&out, &live_owner(&c, Some("a")))
                .unwrap()
                .is_none()
        );
        write_recording(&out, Some("b")).await;
        let before = std::fs::read(part_path(&out)).unwrap();
        let sc_before = std::fs::read(sidecar_path(&out)).unwrap();
        let err = PartFile::create(&out, live_sc(Some("a"), 4, 0)).unwrap_err();
        assert!(
            matches!(&err, Error::PartialRecording { path } if *path == part_path(&out)),
            "{err:?}"
        );
        let vod = Sidecar::new(
            ContentRef::Video { video_no: 1 },
            "720p",
            PlaybackKind::Progressive,
        );
        let err = PartFile::create(&out, vod).unwrap_err();
        assert!(matches!(err, Error::PartialRecording { .. }), "{err:?}");
        assert_eq!(std::fs::read(part_path(&out)).unwrap(), before);
        assert_eq!(std::fs::read(sidecar_path(&out)).unwrap(), sc_before);
        // 잠금은 풀렸다: 주인은 이어 받는다
        let p = PartFile::resume(&out, &live_owner(&c, Some("b")))
            .unwrap()
            .unwrap();
        assert_eq!(p.written(), 12);
    }

    /// 대조: 남의 VOD `.part`나 주인 없는 `.part`는 지금처럼 잘라 새로 시작한다.
    #[tokio::test]
    async fn create_truncates_other_vod_or_orphan_part() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        let mut p = PartFile::create(&out, sidecar()).unwrap();
        p.write(b"abcdef").unwrap();
        p.checkpoint(|_| {}).await.unwrap();
        drop(p);
        let p = PartFile::create(&out, live_sc(Some("a"), 4, 0)).unwrap();
        assert_eq!(p.written(), 0);
        drop(p);
        std::fs::remove_file(sidecar_path(&out)).unwrap();
        std::fs::write(part_path(&out), b"orphan").unwrap();
        let p = PartFile::create(&out, sidecar()).unwrap();
        assert_eq!(p.written(), 0);
        assert_eq!(std::fs::metadata(part_path(&out)).unwrap().len(), 0);
    }

    /// `.part` 없이 남은 남의 녹화 sidecar(완료 뒤 sidecar 삭제 실패·`.part`만 손으로 지움)는 지킬 데이터가 없다.
    /// `create`는 그 sidecar를 덮어쓰고 새로 시작한다(경로가 영영 막히지 않는다, Codex PR #113 확인).
    #[tokio::test]
    async fn create_overwrites_sidecar_left_without_part() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        let c = live_content();
        write_recording(&out, Some("b")).await;
        std::fs::remove_file(part_path(&out)).unwrap();
        assert!(
            PartFile::resume(&out, &live_owner(&c, Some("a")))
                .unwrap()
                .is_none()
        );
        let p = PartFile::create(&out, live_sc(Some("a"), 4, 0)).unwrap();
        assert_eq!(p.written(), 0);
        drop(p);
        let sc = read_sidecar(&sidecar_path(&out)).unwrap().unwrap();
        assert_eq!(sc.recording_id.as_deref(), Some("a"));
        assert_eq!(sc.committed_len, 0);
        // VOD도 같다
        std::fs::remove_file(part_path(&out)).unwrap();
        std::fs::remove_file(sidecar_path(&out)).unwrap();
        write_recording(&out, Some("b")).await;
        std::fs::remove_file(part_path(&out)).unwrap();
        let p = PartFile::create(&out, sidecar()).unwrap();
        drop(p);
        let sc = read_sidecar(&sidecar_path(&out)).unwrap().unwrap();
        assert_eq!(sc.kind, PlaybackKind::LiveRewindHls);
    }

    /// sidecar의 `committed_len`보다 짧은 `.part`는 그 녹화의 파일이 아니다(불변식: `committed_len` ≤ durable 길이).
    /// 남의 녹화 sidecar라도 지키지 않는다: `resume`은 둘 다 지우고, `discard_partial`은 지우고, `create`는 자른다.
    #[tokio::test]
    async fn other_recording_sidecar_on_shorter_part_is_not_protected() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        let c = live_content();
        let shorten = |out: &Path| {
            std::fs::OpenOptions::new()
                .write(true)
                .open(part_path(out))
                .unwrap()
                .set_len(0)
                .unwrap();
        };
        write_recording(&out, Some("b")).await;
        shorten(&out);
        assert!(
            PartFile::resume(&out, &live_owner(&c, Some("a")))
                .unwrap()
                .is_none()
        );
        assert!(!part_path(&out).exists() && !sidecar_path(&out).exists());

        write_recording(&out, Some("b")).await;
        shorten(&out);
        assert_eq!(
            discard_partial(&out, &live_owner(&c, Some("a"))).unwrap(),
            Discarded::Removed
        );
        assert!(!part_path(&out).exists() && !sidecar_path(&out).exists());

        write_recording(&out, Some("b")).await;
        shorten(&out);
        let p = PartFile::create(&out, live_sc(Some("a"), 4, 0)).unwrap();
        drop(p);
        let sc = read_sidecar(&sidecar_path(&out)).unwrap().unwrap();
        assert_eq!(sc.recording_id.as_deref(), Some("a"));
    }

    /// `finalize`가 옮긴 뒤 sidecar를 지우기 전에 다른 작업이 새 `.part`와 자기 sidecar를 만들었으면, 그 sidecar는
    /// 지우지 않는다(남의 새 녹화가 첫 checkpoint 전에 주인을 잃지 않게).
    #[tokio::test]
    async fn finalize_keeps_sidecar_of_new_owner() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        let mut p = PartFile::create(&out, live_sc(Some("b"), 4, 0)).unwrap();
        p.write(b"initMEDIAmed").unwrap();
        let o = out.clone();
        let path = p
            .finalize_using(move |from, to| {
                rename_with_retry(from, to)?;
                // 틈에 들어온 A의 `create`가 남긴 것
                std::fs::write(part_path(&o), b"").unwrap();
                write_sidecar(&sidecar_path(&o), &live_sc(Some("a"), 4, 0)).unwrap();
                Ok(true)
            })
            .await
            .unwrap();
        assert_eq!(moved(path), out);
        assert_eq!(std::fs::read(&out).unwrap(), b"initMEDIAmed");
        let sc = read_sidecar(&sidecar_path(&out)).unwrap().unwrap();
        assert_eq!(sc.recording_id.as_deref(), Some("a"));
    }

    /// N4: 같은 경로를 쓰는 VOD 요청도 남의 생방송 녹화를 지우지 않는다.
    #[tokio::test]
    async fn resume_vod_refuses_recording() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        write_recording(&out, Some("a")).await;
        let before = std::fs::read(part_path(&out)).unwrap();
        let vc = ContentRef::Video { video_no: 1 };
        let o = PartOwner {
            content: &vc,
            quality_id: "720p",
            kind: PlaybackKind::Progressive,
            recording_id: None,
        };
        let err = PartFile::resume(&out, &o).unwrap_err();
        assert!(matches!(err, Error::PartialRecording { .. }), "{err:?}");
        assert_eq!(std::fs::read(part_path(&out)).unwrap(), before);
        assert!(sidecar_path(&out).exists());
    }

    /// 지우기(M1): 남의 `.part`는 생방송이든 VOD든 지우지 않는다.
    #[tokio::test]
    async fn discard_partial_keeps_other_jobs_part() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        write_recording(&out, Some("a")).await;
        let c = live_content();
        assert_eq!(
            discard_partial(&out, &live_owner(&c, Some("b"))).unwrap(),
            Discarded::NotOwned
        );
        assert!(part_path(&out).exists() && sidecar_path(&out).exists());
        // 다른 화질의 VOD `.part`
        let out2 = dir.path().join("b.mp4");
        let mut p = PartFile::create(&out2, sidecar()).unwrap();
        p.write(b"0123").unwrap();
        p.checkpoint(|_| {}).await.unwrap();
        drop(p);
        assert_eq!(
            discard_partial(&out2, &owner(&content(), "1080p")).unwrap(),
            Discarded::NotOwned
        );
        assert!(part_path(&out2).exists() && sidecar_path(&out2).exists());
    }

    #[tokio::test]
    async fn discard_partial_removes_own_and_orphan() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        // 내 것
        write_recording(&out, Some("a")).await;
        let c = live_content();
        assert_eq!(
            discard_partial(&out, &live_owner(&c, Some("a"))).unwrap(),
            Discarded::Removed
        );
        assert!(!part_path(&out).exists() && !sidecar_path(&out).exists());
        // sidecar 없는 .part(주인을 모른다)
        std::fs::write(part_path(&out), b"xx").unwrap();
        assert_eq!(
            discard_partial(&out, &live_owner(&c, Some("a"))).unwrap(),
            Discarded::Removed
        );
        assert!(!part_path(&out).exists());
        // 깨진 sidecar
        std::fs::write(part_path(&out), b"xx").unwrap();
        std::fs::write(sidecar_path(&out), b"{not json").unwrap();
        assert_eq!(discard(&out).unwrap(), Discarded::Removed);
        assert!(!part_path(&out).exists() && !sidecar_path(&out).exists());
        // .part 없는 sidecar
        std::fs::write(sidecar_path(&out), b"{}").unwrap();
        assert_eq!(discard(&out).unwrap(), Discarded::Removed);
        assert!(!sidecar_path(&out).exists());
    }

    /// sidecar를 읽지 못하면(권한·공유 위반 등) 주인을 모르는 것이 아니다: 지우지 않고 오류다(D4).
    /// "없거나 깨졌을 때"만 주인 없는 파일로 본다.
    #[cfg(unix)]
    #[tokio::test]
    async fn unreadable_sidecar_is_error_not_orphan() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("a.mp4");
        write_recording(&out, Some("a")).await;
        let sc = sidecar_path(&out);
        std::fs::set_permissions(&sc, std::fs::Permissions::from_mode(0o000)).unwrap();
        if std::fs::read(&sc).is_ok() {
            // root로 돌면 권한을 무시한다. 이 검사는 의미가 없다
            return;
        }
        let c = live_content();
        assert!(discard_partial(&out, &live_owner(&c, Some("b"))).is_err());
        assert!(part_path(&out).exists() && sc.exists());
        assert!(PartFile::resume(&out, &live_owner(&c, Some("b"))).is_err());
        assert!(part_path(&out).exists() && sc.exists());
        // VOD 작업이 같은 경로를 처음부터 받으려 해도 지우지 않는다
        assert!(discard(&out).is_err());
        assert!(resume(&out, "720p").is_err());
        assert!(part_path(&out).exists() && sc.exists());
        std::fs::set_permissions(&sc, std::fs::Permissions::from_mode(0o600)).unwrap();
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
        assert!(matches!(discard(&out), Err(Error::FileLocked { .. })));
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
        discard(&out).unwrap();
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
        discard(&out).unwrap();
        let p = PartFile::create(&out, sidecar()).unwrap();
        drop(p);
        discard(&out).unwrap();
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
