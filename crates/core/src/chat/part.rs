//! 채팅 기록 이어받기 파일(기능 ④, PR 2). 설계 chat.md §3.2-7·8, §4.5.
//!
//! `{영상}.chat.jsonl.part`에 메시지 객체를 한 줄씩 덧붙이고, 옆의 sidecar
//! (`{영상}.chat.jsonl.part.json`)에 이어받을 상태를 적는다. 구조는 `download::part`와 같다.
//!
//! - **커밋 순서**: 한 페이지의 줄을 덧붙임 → `flush` → `sync_data` → sidecar 원자적 쓰기.
//!   그래서 sidecar의 `committed_len`은 늘 durable한 길이 이하이고 페이지 경계(줄 끝)에 있다.
//! - **재개**: `.part`가 `committed_len`보다 길면(쓰다 죽은 꼬리) 그 길이로 자른다. 짧거나, sidecar가
//!   없거나 깨졌거나 다른 영상이거나, `committed_len`이 줄 끝이 아니면 처음부터 시작한다.
//! - **잠금**: `.part`를 배타 잠금한다. 잠그기 전에는 자르거나 지우지 않는다(다른 작업이 쓰는 중일 수 있다).
//! - **마무리**: 보조 파일(자막) → 기록 순으로 `.part`에서 최종 이름으로 옮긴다. `Skip`은 OS의
//!   덮어쓰지 않는 rename이라 받는 동안 생긴 같은 이름 파일도 지킨다. 어느 파일이 막히면 거기서 멈추고
//!   `.part`·sidecar를 남긴다. 닉네임·본문은 로그·`Debug`에 내지 않는다.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::{self, BufRead, BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;

use super::walk::WalkState;
use super::{ChatCursor, ChatEnd, ChatMessage};
use crate::download::DuplicatePolicy;
use crate::download::part::{open_locked, part_path, remove_if_exists, sidecar_path};
use crate::error::Error;
use crate::fsutil::{
    atomic_write, map_io_error, remove_stale_temps, rename_noclobber_with_retry, rename_with_retry,
};

/// sidecar 형식 버전.
pub const SIDECAR_VERSION: u8 = 1;

/// 쓰기 버퍼 크기.
const WRITE_BUF: usize = 256 * 1024;

/// `.chat.jsonl.part.json`. 이어받기에 필요한 상태를 담는다.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSidecar {
    /// 형식 버전(1)
    pub v: u8,
    pub video_no: u64,
    /// 다음에 요청할 커서(ms)
    pub cursor_ms: u64,
    /// 직전 페이지의 마지막 재생 위치(ms)
    pub boundary_ms: Option<u64>,
    /// 그 ms에 있던 메시지 해시와 개수(multiset). 해시는 `message_hash`다.
    pub boundary: Vec<(u64, u32)>,
    /// 기록한 줄(메시지) 수
    pub lines: u64,
    /// 기록한 메시지 중 가장 큰 재생 위치(ms)
    pub last_offset_ms: Option<u64>,
    /// durable한 바이트 수. 페이지 경계(줄 끝)다.
    pub committed_len: u64,
    /// 정상 끝에 닿았으면 그 이유. 있으면 이어받기는 요청 없이 마무리로 간다.
    #[serde(default)]
    pub end: Option<ChatEnd>,
    /// 이미 최종 이름으로 옮긴 보조 파일의 이름(다시 마무리할 때 다시 옮기지 않는다)
    #[serde(default)]
    pub moved: Vec<String>,
}

impl ChatSidecar {
    fn new(video_no: u64) -> Self {
        ChatSidecar {
            v: SIDECAR_VERSION,
            video_no,
            cursor_ms: 0,
            boundary_ms: None,
            boundary: Vec::new(),
            lines: 0,
            last_offset_ms: None,
            committed_len: 0,
            end: None,
            moved: Vec::new(),
        }
    }
}

/// 보조 파일(자막). `from`은 이미 다 쓴 임시 파일(`{자막}.part`), `to`는 최종 경로다.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Companion {
    pub from: PathBuf,
    pub to: PathBuf,
}

/// `ChatPart::finalize`의 결과.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChatFinalized {
    /// 모두 최종 이름으로 옮겼다. sidecar를 지웠다.
    Moved,
    /// `Skip`인데 `path`가 이미 있어 거기서 멈췄다. 막히지 않은 앞쪽 파일은 옮겼고, 막힌 파일의
    /// 임시 파일과 기록의 `.part`·sidecar는 남는다.
    TargetExists { path: PathBuf },
}

/// 잠근 채팅 `.part` 파일.
pub struct ChatPart {
    w: BufWriter<File>,
    part: PathBuf,
    sidecar_path: PathBuf,
    record_path: PathBuf,
    sidecar: ChatSidecar,
    /// 쓴 바이트 수(버퍼 포함)
    written: u64,
}

impl std::fmt::Debug for ChatPart {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ChatPart")
            .field("part", &self.part)
            .field("lines", &self.sidecar.lines)
            .field("committed", &self.sidecar.committed_len)
            .finish()
    }
}

/// 모르는 sidecar·깨진 sidecar는 `None`.
fn read_sidecar(path: &Path) -> Option<ChatSidecar> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn write_sidecar(path: &Path, s: &ChatSidecar) -> Result<(), Error> {
    let json = serde_json::to_vec(s).map_err(|e| Error::Io {
        op: "serialize",
        path: path.to_path_buf(),
        source: io::Error::other(e),
    })?;
    atomic_write(path, &json)
}

/// `committed` 바로 앞 바이트가 줄바꿈인가(0이면 비어 있으니 참).
fn ends_on_line(f: &mut File, part: &Path, committed: u64) -> Result<bool, Error> {
    if committed == 0 {
        return Ok(true);
    }
    let mut b = [0u8; 1];
    f.seek(SeekFrom::Start(committed - 1))
        .and_then(|_| f.read_exact(&mut b))
        .map_err(|e| map_io_error("read", part, e))?;
    Ok(b[0] == b'\n')
}

/// 줄 하나로 만든다. JSON 안의 문자열에는 날 줄바꿈이 올 수 없으므로(이스케이프된다) 줄바꿈은 모두
/// 토큰 사이 공백이고, 공백으로 바꿔도 같은 JSON이다.
fn single_line(raw: &str) -> String {
    raw.replace(['\r', '\n'], " ")
}

/// 보조 파일을 sidecar `moved`에서 가리키는 키(최종 파일 이름).
fn key_of(to: &Path) -> String {
    to.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

impl ChatPart {
    /// `record_path`(= `{영상}.chat.jsonl`)의 `.part`를 잠그고 연다.
    ///
    /// - `restart`가 아니고 같은 영상의 sidecar가 맞으면 `committed_len`까지 잘라 이어받는다.
    /// - 그 밖에는(`restart`, sidecar 없음·깨짐·다른 영상, `.part`가 짧음, 줄 끝이 아님) 잠금을 쥔 채
    ///   비우고 처음부터 시작한다. 새 sidecar는 곧바로 쓴다(첫 커밋 전에 죽어도 다음 실행이 이어받는다).
    /// - 다른 작업이 잠그고 있으면 `FileLocked`이고 아무것도 바꾸지 않는다.
    pub fn open(record_path: &Path, video_no: u64, restart: bool) -> Result<ChatPart, Error> {
        let part = part_path(record_path);
        let sc_path = sidecar_path(record_path);
        // 항상 `create`로 연다: 없을 때와 있을 때가 한 길이라 만들기 경쟁이 없다. 자르는 것은 잠근 뒤다.
        let mut f = open_locked(&part, true)?;
        // 잠금을 쥐었으니 이 sidecar를 쓰는 다른 작업은 없다. 죽은 작업이 남긴 임시 파일을 치운다.
        remove_stale_temps(&sc_path);
        let len = f
            .metadata()
            .map_err(|e| map_io_error("stat", &part, e))?
            .len();
        let mut resumed = None;
        if !restart
            && let Some(s) = read_sidecar(&sc_path)
            && s.v == SIDECAR_VERSION
            && s.video_no == video_no
            && len >= s.committed_len
            && ends_on_line(&mut f, &part, s.committed_len)?
        {
            resumed = Some(s);
        }
        let sidecar = match resumed {
            Some(s) => {
                if len > s.committed_len {
                    tracing::info!(
                        len,
                        committed = s.committed_len,
                        "채팅 .part의 꼬리를 잘라 냄"
                    );
                    f.set_len(s.committed_len)
                        .map_err(|e| map_io_error("truncate", &part, e))?;
                }
                s
            }
            None => {
                tracing::info!(restart, "채팅 .part를 비우고 처음부터 시작");
                f.set_len(0)
                    .map_err(|e| map_io_error("truncate", &part, e))?;
                let s = ChatSidecar::new(video_no);
                write_sidecar(&sc_path, &s)?;
                s
            }
        };
        f.seek(SeekFrom::Start(sidecar.committed_len))
            .map_err(|e| map_io_error("seek", &part, e))?;
        Ok(ChatPart {
            w: BufWriter::with_capacity(WRITE_BUF, f),
            part,
            sidecar_path: sc_path,
            record_path: record_path.to_path_buf(),
            written: sidecar.committed_len,
            sidecar,
        })
    }

    /// 이어받을 순회 상태(커서·경계 개수표). 처음이면 `WalkState::default()`.
    pub fn resume_state(&self) -> WalkState {
        WalkState {
            cursor: ChatCursor(self.sidecar.cursor_ms),
            boundary_ms: self.sidecar.boundary_ms,
            boundary: self
                .sidecar
                .boundary
                .iter()
                .copied()
                .collect::<BTreeMap<_, _>>(),
        }
    }

    /// 기록한 줄 수.
    pub fn lines(&self) -> u64 {
        self.sidecar.lines
    }

    /// 정상 끝 이유(이어받기는 요청 없이 마무리로 간다).
    pub fn end(&self) -> Option<ChatEnd> {
        self.sidecar.end
    }

    /// durable한 바이트 수.
    pub fn committed(&self) -> u64 {
        self.sidecar.committed_len
    }

    /// 기록한 메시지 중 가장 큰 재생 위치.
    pub fn last_offset_ms(&self) -> Option<u64> {
        self.sidecar.last_offset_ms
    }

    /// 마지막으로 기록한 sidecar.
    pub fn sidecar(&self) -> &ChatSidecar {
        &self.sidecar
    }

    /// 보조 파일 `to`를 이미 최종 이름으로 옮겼는가.
    pub fn is_moved(&self, to: &Path) -> bool {
        self.sidecar.moved.contains(&key_of(to))
    }

    /// 한 페이지를 커밋한다. `kept`는 `next_step`이 남긴 메시지, `state`는 그 걸음 뒤의 상태
    /// (`Next::Continue`의 상태. 끝이면 `resume_state()`를 그대로 넘긴다), `end`는 정상 끝 이유다.
    ///
    /// 순서: 줄 덧붙임 → `flush` → `sync_data` → sidecar 원자적 쓰기. 실패하면 기록된 sidecar는
    /// 바뀌지 않아 다음 `open`이 이전 커밋으로 되돌아간다.
    pub async fn commit_page(
        &mut self,
        kept: &[&ChatMessage],
        state: &WalkState,
        end: Option<ChatEnd>,
    ) -> Result<(), Error> {
        let mut last = self.sidecar.last_offset_ms;
        for m in kept {
            let mut line = single_line(m.raw.get());
            line.push('\n');
            self.w
                .write_all(line.as_bytes())
                .map_err(|e| map_io_error("write", &self.part, e))?;
            self.written += line.len() as u64;
            last = Some(last.map_or(m.player_offset_ms, |l| l.max(m.player_offset_ms)));
        }
        self.w
            .flush()
            .map_err(|e| map_io_error("write", &self.part, e))?;
        let mut next = self.sidecar.clone();
        next.cursor_ms = state.cursor.0;
        next.boundary_ms = state.boundary_ms;
        next.boundary = state.boundary.iter().map(|(h, n)| (*h, *n)).collect();
        next.lines += kept.len() as u64;
        next.last_offset_ms = last;
        next.committed_len = self.written;
        next.end = end;
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

    /// 지금까지 커밋한 기록을 메시지로 읽는다(자막 렌더 입력). 잠근 핸들로 읽는다: Windows의 배타 잠금은
    /// 다른 핸들의 읽기를 막기 때문이다. 읽은 뒤 쓰기 위치를 되돌린다.
    pub fn read_messages(&mut self) -> Result<Vec<ChatMessage>, Error> {
        self.w
            .flush()
            .map_err(|e| map_io_error("write", &self.part, e))?;
        let end = self.written;
        let part = self.part.clone();
        let f = self.w.get_mut();
        f.seek(SeekFrom::Start(0))
            .map_err(|e| map_io_error("seek", &part, e))?;
        let mut out = Vec::new();
        let res = (|| -> Result<(), Error> {
            let reader = BufReader::new((&*f).take(end));
            for line in reader.lines() {
                let line = line.map_err(|e| map_io_error("read", &part, e))?;
                if line.is_empty() {
                    continue;
                }
                let raw = RawValue::from_string(line).map_err(|_| Error::Parse {
                    what: "chat",
                    detail: "기록 줄이 JSON이 아닙니다".into(),
                })?;
                out.push(ChatMessage::from_raw(raw)?);
            }
            Ok(())
        })();
        // 읽기가 실패해도 쓰기 위치는 되돌린다.
        f.seek(SeekFrom::Start(end))
            .map_err(|e| map_io_error("seek", &part, e))?;
        res?;
        Ok(out)
    }

    /// 보조 파일 → 기록 순으로 최종 이름으로 옮긴다(chat.md §3.2-8).
    ///
    /// - `Overwrite`: 있으면 덮어쓴다(`rename_with_retry`, Windows 일시 잠금 재시도).
    /// - `Skip`: 덮어쓰지 않는다(`rename_noclobber_with_retry`). 같은 이름이 이미 있으면 거기서 멈춘다.
    /// - 보조 파일은 옮기면 sidecar `moved`에 적는다. 기록 이름이 막혀 다시 마무리할 때 이미 옮긴
    ///   자기 파일은 다시 옮기지 않는다. 기록은 모든 보조 파일이 옮겨진 뒤에야 옮기므로, sidecar가
    ///   있는 동안은 기록의 `.part`도 늘 있다.
    /// - 기록을 옮긴 뒤의 sidecar 삭제 실패는 경고만 남긴다.
    pub async fn finalize(
        self,
        companions: &[Companion],
        policy: DuplicatePolicy,
    ) -> Result<ChatFinalized, Error> {
        match policy {
            DuplicatePolicy::Overwrite => {
                self.finalize_using(companions, |a, b| rename_with_retry(a, b).map(|()| true))
                    .await
            }
            DuplicatePolicy::Skip => {
                self.finalize_using(companions, rename_noclobber_with_retry)
                    .await
            }
        }
    }

    /// `finalize`의 본체. rename을 주입받아 경쟁을 테스트한다. `rename`은 옮겼으면 `true`,
    /// 최종 파일이 있어 옮기지 않았으면 `false`다.
    async fn finalize_using(
        self,
        companions: &[Companion],
        mut rename: impl FnMut(&Path, &Path) -> Result<bool, Error> + Send + 'static,
    ) -> Result<ChatFinalized, Error> {
        let ChatPart {
            mut w,
            part,
            sidecar_path,
            record_path,
            mut sidecar,
            ..
        } = self;
        let companions = companions.to_vec();
        w.flush().map_err(|e| map_io_error("write", &part, e))?;
        let f = w.into_inner().map_err(|e| {
            let p = part.clone();
            map_io_error("write", &p, e.into_error())
        })?;
        let target = record_path.clone();
        tokio::task::spawn_blocking(move || {
            f.sync_data().map_err(|e| map_io_error("sync", &part, e))?;
            // 보조 파일 먼저. 기록의 `.part`는 잠근 채라 이 사이에 다른 작업이 건드리지 못한다.
            for c in &companions {
                let key = key_of(&c.to);
                if sidecar.moved.contains(&key) {
                    continue;
                }
                if !rename(&c.from, &c.to)? {
                    tracing::info!("받는 동안 같은 이름의 파일이 생겨 덮어쓰지 않았다(보조 파일)");
                    return Ok(ChatFinalized::TargetExists { path: c.to.clone() });
                }
                sidecar.moved.push(key);
                write_sidecar(&sidecar_path, &sidecar)?;
            }
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
            if moved {
                Ok(ChatFinalized::Moved)
            } else {
                tracing::info!("받는 동안 같은 이름의 파일이 생겨 덮어쓰지 않았다");
                Ok(ChatFinalized::TargetExists { path: target })
            }
        })
        .await
        .map_err(|e| Error::Io {
            op: "rename",
            path: record_path.clone(),
            source: io::Error::other(e.to_string()),
        })?
    }
}

#[cfg(test)]
mod tests;
