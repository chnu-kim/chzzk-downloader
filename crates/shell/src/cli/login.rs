//! `login`(cli-mode.md §5.3): 앱과 같은 루프백 로그인을 브라우저로 열고 끝날 때까지 기다린다.
//!
//! 로그인 주소는 `Env::open_url`에만 넘기고 터미널·로그에 쓰지 않는다. 브라우저를 열지 못해도 주소를 찍지 않는다.
//! 이 흐름은 GUI 첫 로그인 뒤의 부작용(자동 이어받기·업데이트 확인)을 일으키지 않는다.

use super::{CtrlC, Env, copy, exit, line};
use crate::app::{App, LoginWait};
use crate::dto::{AuthReasonDto, AuthState, AuthStatusDto};

pub(super) async fn run(
    app: &App,
    env: &mut Env<'_>,
    ctrl_c: &mut CtrlC,
    st: &AuthStatusDto,
) -> u8 {
    match st.state {
        AuthState::Disabled => {
            line(env.err, copy::LOGIN_DISABLED);
            return exit::OK;
        }
        AuthState::SignedIn => {
            let name = st.channel_name.as_deref().unwrap_or_default();
            line(env.err, &copy::fill(copy::LOGIN_ALREADY, "name", name));
            return exit::OK;
        }
        _ => {}
    }
    for cmd in ["auth_login", "auth_cancel"] {
        if let Err(e) = app.gate_command(cmd) {
            return super::report_error(env, app, &e);
        }
    }
    let Some(open) = env.open_url.take() else {
        // 브라우저를 열 방법이 없다(호출한 쪽이 주지 않았다)
        line(env.err, copy::LOGIN_OPEN_FAILED);
        return exit::FAILED;
    };
    // 안내는 기다림이 시작되기 전에 쓴다: 브라우저가 열리면 사용자가 바로 이 터미널을 본다
    line(
        env.err,
        &copy::fill(copy::LOGIN_WAITING, "interrupt", copy::INTERRUPT_KEY),
    );
    let login = app.auth_login_wait(open);
    tokio::pin!(login);
    // 신호 채널이 닫히면(`None`) 취소가 아니라 신호를 더 기다리지 않는 것이다
    let mut ctrl_closed = false;
    let waited = loop {
        tokio::select! {
            w = &mut login => break Some(w),
            sig = ctrl_c.recv(), if !ctrl_closed => {
                if sig.is_some() {
                    break None;
                }
                ctrl_closed = true;
            }
        }
    };
    match waited {
        None => {
            // 수신기를 닫고 로그인을 지운다(저장 세션이 없으면 SignedOut). 늦게 끝낸 브라우저 로그인은 세션을 만들지 못한다
            app.auth_cancel();
            line(env.err, copy::LOGIN_CANCELLED);
            exit::INTERRUPTED
        }
        Some(LoginWait::Disabled) => {
            line(env.err, copy::LOGIN_DISABLED);
            exit::OK
        }
        Some(LoginWait::OpenFailed) => {
            line(env.err, copy::LOGIN_OPEN_FAILED);
            exit::FAILED
        }
        Some(LoginWait::Done(done)) => finish(env, &done),
    }
}

/// 로그인이 끝난 상태 → 출력과 종료 코드(§5.3 표).
fn finish(env: &mut Env<'_>, st: &AuthStatusDto) -> u8 {
    match (st.state, st.reason) {
        (AuthState::SignedIn, _) => {
            let name = st.channel_name.as_deref().unwrap_or_default();
            line(env.err, &copy::fill(copy::LOGIN_DONE, "name", name));
            exit::OK
        }
        (AuthState::Denied, Some(AuthReasonDto::DailyLimit)) => {
            line(env.err, copy::AUTH_DAILY_LIMIT);
            line(env.err, copy::LOGIN_DAILY_LIMIT_NEXT);
            exit::LOGIN
        }
        (AuthState::Denied, _) => {
            line(env.err, copy::AUTH_DENIED);
            line(env.err, copy::LOGIN_DENIED_NEXT);
            exit::LOGIN
        }
        (AuthState::Expired, Some(AuthReasonDto::LoginTimeout)) => {
            line(env.err, copy::LOGIN_TIMEOUT);
            exit::LOGIN
        }
        (AuthState::Cancelled, _) => {
            line(env.err, copy::LOGIN_CANCELLED);
            exit::INTERRUPTED
        }
        (AuthState::Error, Some(AuthReasonDto::Network)) => failed(env, copy::AUTH_NETWORK),
        (AuthState::Error, Some(AuthReasonDto::Server)) => failed(env, copy::AUTH_SERVER),
        (AuthState::Error, Some(AuthReasonDto::LoginLost)) => failed(env, copy::AUTH_LOST),
        (AuthState::Error, Some(AuthReasonDto::Receiver)) => failed(env, copy::AUTH_RECEIVER),
        _ => failed(env, copy::AUTH_UNKNOWN),
    }
}

fn failed(env: &mut Env<'_>, msg: &str) -> u8 {
    line(env.err, msg);
    exit::FAILED
}
