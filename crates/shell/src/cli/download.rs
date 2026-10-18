//! `download`(cli-mode.md §3.2·§8·§9): 주소마다 차례로 resolve → 화질 → 이름 검사 → 작업 추가 → 끝날 때까지 진행률.
//!
//! 게이트는 GUI와 같은 함수로만 지난다: `App::resolve` → `App::check_output` → `App::enqueue`(소유 판정은 그 안의
//! `OwnershipGate::admit_checked`), 멈춘 작업을 이어받을 때는 `App::resume_job`. 이 파일은 `manager.enqueue`·코어
//! `download`·`classify`를 부르지 않는다(`tests/cli_gate.rs`가 소스에서 확인한다).

use std::path::Path;
use std::time::Instant;

use chzzk_core::parse_content_url;
use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};

use super::progress::Reporter;
use super::{
    CtrlC, DownloadArgs, Env, Waited, copy, exit, interruptible, line, report_error, stopped,
};
use crate::JobId;
use crate::app::{App, ChatCheck};
use crate::dto::{EnqueueRequest, JobDto, JobEvent, JobStatus, OnExisting, ResolvedDto};
use crate::error::AppError;
use crate::format::{format_file_size, size_base_of};
use crate::manager::QUIT_TIMEOUT;
use crate::power::{NoopGuard, PowerKeeper, SleepGuard};

/// 한 번의 `download` 실행이 주소들을 지나며 들고 다니는 것.
struct Run<'a, 'e> {
    app: &'a App,
    env: &'a mut Env<'e>,
    ctrl_c: &'a mut CtrlC,
    events: UnboundedReceiver<JobEvent>,
    keeper: PowerKeeper<Box<dyn SleepGuard>>,
    keep_awake: bool,
    /// Ctrl+C가 닫혔는가(신호를 더 기다리지 않는다)
    ctrl_closed: bool,
    args: &'a DownloadArgs,
}

pub(super) async fn run(
    app: &App,
    env: &mut Env<'_>,
    ctrl_c: &mut CtrlC,
    args: &DownloadArgs,
) -> u8 {
    // 속도 상한은 이 프로세스의 매니저에만 건다. `update_settings`를 부르지 않으므로 설정 파일은 그대로다
    if let Some(rate) = args.rate {
        let (total, _) = app.manager.rate_limits();
        app.manager
            .set_rate_limits(total, (rate > 0).then_some(rate));
    }
    // 이벤트는 채널로만 넘긴다(매니저가 상태 잠금을 쥔 채 부른다)
    let (tx, events) = unbounded_channel::<JobEvent>();
    app.manager
        .subscribe(Box::new(move |e: JobEvent| tx.send(e).is_ok()));
    let guard: Box<dyn SleepGuard> = env.power.take().unwrap_or_else(|| Box::new(NoopGuard));
    let mut r = Run {
        app,
        keeper: PowerKeeper::new(guard),
        keep_awake: app.settings.settings().keep_awake,
        env,
        ctrl_c,
        events,
        ctrl_closed: false,
        args,
    };
    let mut worst = exit::OK;
    for url in &args.urls {
        let code = r.one(url).await;
        worst = exit::worst(worst, code);
        // 로그인이 없거나 멈추라는 신호면 남은 주소를 받지 않는다
        if matches!(code, exit::LOGIN | exit::INTERRUPTED | exit::BUSY) {
            break;
        }
    }
    r.keeper.update(false, 0);
    worst
}

impl Run<'_, '_> {
    /// 주소 하나를 끝까지 받고 종료 코드를 돌려준다.
    async fn one(&mut self, url: &str) -> u8 {
        let app = self.app;
        // 주소마다 GUI driver의 타이머와 같은 판정으로 세션을 본다: 갱신 예정이 지났으면 갱신하고, 오프라인 유예가 끝났으면
        // 여기서 만료로 바뀌어 아래 게이트가 막는다. 시작 때 한 번만 보면 긴 배치가 유예를 넘겨도 다음 주소를 받는다(§5.2)
        if let Err(e) = app.gate_command("auth_retry") {
            return report_error(self.env, app, &e);
        }
        if interruptible(app, self.env, self.ctrl_c, app.auth_tick())
            .await
            .unless_pressed()
            .is_none()
        {
            return stopped(self.env);
        }
        if let Err(e) = app.gate_command("resolve") {
            return report_error(self.env, app, &e);
        }
        let resolved = match interruptible(app, self.env, self.ctrl_c, app.resolve(url))
            .await
            .unless_pressed()
        {
            None => return stopped(self.env),
            Some(Ok(r)) => r,
            Some(Err(e)) => return report_error(self.env, app, &e),
        };
        let Some(quality) = self.pick_quality(&resolved) else {
            return exit::USAGE;
        };
        let folder = match self.folder() {
            Ok(f) => f,
            Err(code) => return code,
        };
        if let Err(e) = app.gate_command("check_output") {
            return report_error(self.env, app, &e);
        }
        let check = match app.check_output(
            folder.as_deref(),
            &resolved.suggested_file_name,
            &resolved.content,
            &quality.0,
            resolved.playback_kind,
            self.args.range,
            ChatCheck::default(),
        ) {
            Ok(c) => c,
            Err(e) => return report_error(self.env, app, &e),
        };

        // 받다 만 녹화는 지우지 않고 번호 이름으로 받는다(core.md 61). 그 밖은 검사가 정리한 이름이다
        let recording = check.partial.is_some_and(|p| p.recording);
        let fresh = recording && check.free_file_name.is_some();
        let file_name = match (&check.free_file_name, fresh) {
            (Some(free), true) => free.clone(),
            _ => check.file_name.clone(),
        };
        if recording && !fresh {
            line(self.env.err, copy::NAME_UNAVAILABLE);
            return exit::FAILED;
        }
        let mut notes = Vec::new();
        if let Some(p) = check.partial.filter(|_| !fresh) {
            if p.same_job {
                let base = size_base_of(chzzk_core::Platform::current().into());
                notes.push(copy::resuming(&format_file_size(p.bytes, base)));
            } else {
                notes.push(copy::PARTIAL_OTHER.to_string());
            }
        }

        let mut pressed = false;
        let id = if let Some(dup) = check.duplicate_job_id {
            // 같은 파일의 작업이 이미 목록에 있다. 멈춘 것(`paused`·`interrupted`)이 같은 요청이면 그것을 이어받는다
            // (새 기록을 만들면 `duplicateOutput`이다). 그 밖은 건드리지 않는다
            if !self.same_request(dup, &resolved, &quality.1) {
                line(self.env.err, copy::DUPLICATE_OTHER);
                return exit::FAILED;
            }
            if let Err(e) = app.gate_command("resume_job") {
                return report_error(self.env, app, &e);
            }
            match interruptible(app, self.env, self.ctrl_c, app.resume_job(dup, false)).await {
                Waited::Stopped => return stopped(self.env),
                Waited::Done(Err(e)) | Waited::DoneAfterPress(Err(e)) => {
                    return report_error(self.env, app, &e);
                }
                Waited::Done(Ok(())) => {}
                // 다시 줄 세웠다: 첫 Ctrl+C처럼 멈춘다
                Waited::DoneAfterPress(Ok(())) => pressed = true,
            }
            dup
        } else {
            let on_existing = if self.args.overwrite && check.exists && !fresh {
                OnExisting::Overwrite
            } else {
                OnExisting::Skip
            };
            let req = EnqueueRequest {
                url: resolved.url.clone(),
                content: resolved.content.clone(),
                title: resolved.meta.title.clone(),
                channel_name: resolved.meta.channel_name.clone(),
                channel_id: resolved.meta.channel_id.clone(),
                quality_id: quality.0.clone(),
                quality_label: quality.1.clone(),
                expected_kind: resolved.playback_kind,
                folder: folder.clone(),
                file_name,
                on_existing,
                restart: false,
                content_date: resolved
                    .meta
                    .live_open_date
                    .clone()
                    .or_else(|| resolved.meta.publish_date.clone()),
                range: self.args.range,
                save_chat: false,
            };
            if let Err(e) = app.gate_command("enqueue") {
                return report_error(self.env, app, &e);
            }
            match interruptible(app, self.env, self.ctrl_c, app.enqueue(req)).await {
                Waited::Stopped => return stopped(self.env),
                Waited::Done(Ok(job)) => job.id,
                // 작업이 이미 만들어졌다: 첫 Ctrl+C처럼 멈춘다(줄에 남겨 두고 130으로 끝내지 않는다)
                Waited::DoneAfterPress(Ok(job)) => {
                    pressed = true;
                    job.id
                }
                Waited::Done(Err(e)) | Waited::DoneAfterPress(Err(e)) => {
                    return report_error(self.env, app, &e);
                }
            }
        };
        self.follow(id, &notes, pressed).await
    }

    /// `--audio`면 오디오만 행, `--quality` 라벨(대소문자 무시)이면 그 화질, 없으면 기본 화질 → (id, label). 못 고르면 안내를
    /// 쓰고 `None`. 오디오만 행은 화질이 아니라서 라벨·기본 화질 후보에서 뺀다(GUI 카드와 같다, audio-only.md §6.1).
    fn pick_quality(&mut self, r: &ResolvedDto) -> Option<(String, String)> {
        if self.args.audio {
            return match r.qualities.iter().find(|q| q.audio_only) {
                // 요청의 라벨은 GUI와 같은 말이다(마지막 화질로 기억하지 않는다, 셸이 빈 라벨을 넘긴다)
                Some(q) => Some((q.id.clone(), copy::AUDIO_ONLY_LABEL.to_string())),
                None => {
                    line(self.env.err, copy::AUDIO_UNAVAILABLE);
                    None
                }
            };
        }
        let picked = match &self.args.quality {
            Some(label) => r
                .qualities
                .iter()
                .find(|q| !q.audio_only && q.label.eq_ignore_ascii_case(label)),
            None => r
                .qualities
                .get(r.default_quality_index as usize)
                .filter(|q| !q.audio_only),
        };
        match picked {
            Some(q) => Some((q.id.clone(), q.label.clone())),
            None => {
                let labels: Vec<String> = r
                    .qualities
                    .iter()
                    .filter(|q| !q.audio_only)
                    .map(|q| q.label.clone())
                    .collect();
                let want = self.args.quality.as_deref().unwrap_or_default();
                line(self.env.err, &copy::quality_not_found(want, &labels));
                None
            }
        }
    }

    /// `--out`을 절대 경로 문자열로. 상대 경로는 현재 폴더 기준이다. 검사는 매니저가 한다.
    fn folder(&mut self) -> Result<Option<String>, u8> {
        let Some(out) = &self.args.out else {
            return Ok(None);
        };
        let p = Path::new(out);
        let abs = if p.is_absolute() {
            p.to_path_buf()
        } else {
            self.env.cwd.join(p)
        };
        match abs.to_str() {
            Some(s) => Ok(Some(s.to_string())),
            None => {
                line(self.env.err, copy::USAGE_NOT_UTF8);
                Err(exit::USAGE)
            }
        }
    }

    /// 이미 있는 작업 `dup`이 멈춘 상태이고 이번 요청(컨텐츠·화질·구간)과 같은가.
    fn same_request(&self, dup: JobId, r: &ResolvedDto, quality_label: &str) -> bool {
        self.app.manager.list().into_iter().any(|j| {
            j.id == dup
                && matches!(j.status, JobStatus::Paused | JobStatus::Interrupted)
                && j.quality_label == quality_label
                && j.range == self.args.range
                && parse_content_url(&j.url).ok().as_ref() == Some(&r.content)
        })
    }

    fn job(&self, id: JobId) -> Option<JobDto> {
        self.app.manager.list().into_iter().find(|j| j.id == id)
    }

    fn update_power(&mut self) {
        let running = self.app.manager.running_count();
        self.keeper.update(self.keep_awake, running);
    }

    /// 작업 `id`가 끝날 때까지 진행률을 쓰고 Ctrl+C를 다룬다. 첫 Ctrl+C는 일시정지(`.part`를 남기고 `paused`),
    /// 두 번째는 바로 끝낸다(`interrupted`로 저장). `pressed`면 작업을 만들기 전에 이미 한 번 눌렀다(바로 일시정지).
    async fn follow(&mut self, id: JobId, notes: &[String], pressed: bool) -> u8 {
        let app = self.app;
        let base = size_base_of(chzzk_core::Platform::current().into());
        let mut reporter = Reporter::new(self.env.tty, base);
        for n in notes {
            reporter.note(self.env.err, n);
        }
        let started = Instant::now();
        let mut presses = 0u32;
        if pressed {
            presses = 1;
            let _ = app.manager.pause(id);
        }
        self.update_power();
        let last = loop {
            let Some(job) = self.job(id) else {
                reporter.end_line(self.env.err);
                line(self.env.err, copy::JOB_LOST);
                self.update_power();
                return exit::FAILED;
            };
            if is_final(job.status) {
                break job;
            }
            tokio::select! {
                ev = self.events.recv() => match ev {
                    Some(JobEvent::Progress { id: i, progress }) if i == id => {
                        reporter.progress(self.env.err, &progress, started.elapsed());
                    }
                    Some(JobEvent::Status { .. } | JobEvent::Added { .. }) => self.update_power(),
                    Some(_) => {}
                    None => {
                        reporter.end_line(self.env.err);
                        line(self.env.err, copy::JOB_LOST);
                        return exit::FAILED;
                    }
                },
                sig = self.ctrl_c.recv(), if !self.ctrl_closed => {
                    if sig.is_none() {
                        self.ctrl_closed = true;
                        continue;
                    }
                    presses += 1;
                    if presses == 1 {
                        let _ = app.manager.pause(id);
                    } else {
                        app.manager.quit(QUIT_TIMEOUT).await;
                        let job = self.job(id);
                        reporter.end_line(self.env.err);
                        line(self.env.err, copy::PAUSED);
                        self.update_power();
                        return match job.map(|j| j.status) {
                            Some(JobStatus::Completed | JobStatus::Skipped) => exit::OK,
                            _ => exit::INTERRUPTED,
                        };
                    }
                }
            }
        };
        reporter.end_line(self.env.err);
        self.update_power();
        match last.status {
            JobStatus::Completed => {
                let size = last
                    .final_bytes
                    .map_or(String::new(), |b| format_file_size(b, base));
                line(self.env.err, &copy::done_line(&size));
                line(self.env.out, &last.output);
                exit::OK
            }
            JobStatus::Skipped => {
                line(
                    self.env.err,
                    &copy::fill(copy::EXISTS, "path", &last.output),
                );
                line(self.env.out, &last.output);
                exit::OK
            }
            JobStatus::Failed => {
                let e = last
                    .error
                    .unwrap_or_else(|| AppError::internal(copy::JOB_FAILED));
                report_error(self.env, app, &e)
            }
            // 멈춘 작업(`paused`·`interrupted`): 우리가 멈추라고 했다
            _ => {
                line(self.env.err, copy::PAUSED);
                exit::INTERRUPTED
            }
        }
    }
}

/// 더 기다릴 것이 없는 상태.
fn is_final(s: JobStatus) -> bool {
    matches!(
        s,
        JobStatus::Completed
            | JobStatus::Skipped
            | JobStatus::Failed
            | JobStatus::Paused
            | JobStatus::Interrupted
    )
}
