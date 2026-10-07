// Worker 주소 규칙(worker.md §11.1, 구현 중 변경 A2-5). build.rs와 src/lib.rs의 테스트가 include!로 함께 쓴다.
// 의존성을 두지 않는다(build-dependencies는 tauri-build뿐). 오류 문구에는 값을 넣지 않는다(cicd.md 84).

/// 빌드 env 이름
pub const WORKER_BASE_ENV: &str = "CHZZK_WORKER_BASE";
/// build.rs가 rustc에 넘기는 이름. 늘 찍는다(없으면 빈 문자열): 셸에 같은 이름을 두어 검사를 건너뛰지 못하게
pub const WORKER_BASE_RUSTC_ENV: &str = "CHZZK_WORKER_BASE_BUILD";
/// 루프백으로 보는 http 호스트(debug만)
pub const LOOPBACK_HOSTS: [&str; 3] = ["localhost", "127.0.0.1", "[::1]"];

/// 규칙 결과
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WorkerBaseRule {
    /// 로그인 없이(debug만)
    Off,
    /// 이 출처를 넣는다(정규 출처 그대로)
    On(String),
}

/// `profile`은 cargo `PROFILE`(`release`|`debug`). `value`는 `CHZZK_WORKER_BASE`(빈 문자열은 없음과 같다)
pub fn worker_base_rule(profile: &str, value: Option<&str>) -> Result<WorkerBaseRule, String> {
    let release = profile == "release";
    match value.filter(|v| !v.is_empty()) {
        None if release => Err(format!(
            "{WORKER_BASE_ENV}가 필요하다: 릴리스 빌드는 Worker 주소 없이 만들지 않는다(fail closed, worker.md §11.1). \
             로컬 확인용 릴리스 빌드는 {WORKER_BASE_ENV}=https://worker.example.invalid"
        )),
        None => Ok(WorkerBaseRule::Off),
        Some(v) => match origin_problem(v, !release) {
            None => Ok(WorkerBaseRule::On(v.to_string())),
            Some(why) => Err(format!("{WORKER_BASE_ENV} 형식이 올바르지 않다: {why}(값은 찍지 않는다)")),
        },
    }
}

/// 정규 출처 `scheme://host[:port]`가 아니면 이유. http는 `allow_loopback_http`이고 루프백 호스트일 때만
fn origin_problem(v: &str, allow_loopback_http: bool) -> Option<&'static str> {
    let (https, rest) = if let Some(r) = v.strip_prefix("https://") {
        (true, r)
    } else if let Some(r) = v.strip_prefix("http://") {
        (false, r)
    } else {
        return Some("https:// 또는 http://로 시작하지 않는다");
    };
    if rest.is_empty() {
        return Some("호스트가 없다");
    }
    if rest.chars().any(|c| matches!(c, '/' | '?' | '#' | '@' | '\\') || c.is_whitespace() || c.is_ascii_uppercase() || !c.is_ascii()) {
        return Some("경로·쿼리·조각·사용자 정보·공백·대문자·ASCII 밖 글자가 있다");
    }
    // 호스트와 포트
    let (host, port) = if rest.starts_with('[') {
        match rest.find(']') {
            Some(i) => {
                let (h, after) = rest.split_at(i + 1);
                match after.strip_prefix(':') {
                    Some(p) => (h, Some(p)),
                    None if after.is_empty() => (h, None),
                    None => return Some("IPv6 주소 뒤에 다른 글자가 있다"),
                }
            }
            None => return Some("IPv6 주소가 닫히지 않았다"),
        }
    } else {
        match rest.split_once(':') {
            Some((h, p)) => (h, Some(p)),
            None => (rest, None),
        }
    };
    if let Some(p) = port {
        if p.is_empty() || p.len() > 5 || !p.bytes().all(|b| b.is_ascii_digit()) {
            return Some("포트가 숫자가 아니다");
        }
        let n: u32 = p.parse().unwrap_or(0);
        if n == 0 || n > 65535 || p.starts_with('0') {
            return Some("포트 범위가 아니다");
        }
        if (https && n == 443) || (!https && n == 80) {
            return Some("기본 포트를 적었다(출처에는 쓰지 않는다)");
        }
    }
    if host.starts_with('[') {
        if host != "[::1]" {
            return Some("IPv6는 [::1]만 받는다");
        }
    } else if !host_ok(host) {
        return Some("호스트 이름 형식이 아니다");
    }
    if !https && !(allow_loopback_http && LOOPBACK_HOSTS.contains(&host)) {
        return Some("http는 debug 빌드의 루프백(localhost·127.0.0.1·[::1])만 받는다");
    }
    None
}

/// 소문자 DNS 이름(점으로 나눈 1~63자 조각, a-z0-9-, 양끝 '-' 없음, 전체 253자 이하)
fn host_ok(h: &str) -> bool {
    !h.is_empty()
        && h.len() <= 253
        && h.split('.').all(|l| {
            !l.is_empty()
                && l.len() <= 63
                && !l.starts_with('-')
                && !l.ends_with('-')
                && l.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
}
