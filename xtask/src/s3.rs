//! 최소 S3 클라이언트(R2 S3 API, 시험은 MinIO). AWS SigV4 헤더 서명을 직접 한다(SDK 없음, 서명은 AWS 공개 시험 벡터로 고정).
//! 경로 방식 URL `<endpoint>/<bucket>/<key>`, 본문 해시는 실제 sha256(UNSIGNED-PAYLOAD 아님), 올릴 때 `x-amz-checksum-sha256`.
//! 목록(ListObjectsV2)은 `<endpoint>/<bucket>?list-type=2&prefix=…&max-keys=…`(정규 쿼리 서명). CI(S3 토큰)에서만 쓰고 Worker 경로에는 없다.
//!
//! 환경 변수: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, 그리고 R2_ENDPOINT(시험용 덮어쓰기) 또는 R2_ACCOUNT_ID
//! (→ https://<id>.r2.cloudflarestorage.com), R2_REGION(기본 auto). 비밀 값은 로그에 찍지 않는다.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use hmac::{Hmac, KeyInit, Mac};
use sha2::{Digest, Sha256};

use crate::cli::{Res, env, infra, input};

type HmacSha256 = Hmac<Sha256>;

pub fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

fn hmac(key: &[u8], msg: &[u8]) -> Vec<u8> {
    let mut m = HmacSha256::new_from_slice(key).expect("HMAC은 모든 키 길이를 받는다");
    m.update(msg);
    m.finalize().into_bytes().to_vec()
}

/// URI 인코딩(SigV4): unreserved(A-Z a-z 0-9 - . _ ~)만 그대로, keep_slash면 '/'도 그대로
pub fn uri_encode(s: &str, keep_slash: bool) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        let c = b as char;
        if c.is_ascii_alphanumeric() || "-._~".contains(c) || (keep_slash && c == '/') {
            out.push(c);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// SigV4 정규 쿼리(순수): 키·값을 uri_encode(_, false)로 인코딩하고 (k, v) 순으로 정렬해 k=v를 &로 잇는다
pub fn canonical_query(q: &[(&str, &str)]) -> String {
    let mut pairs: Vec<(String, String)> = q
        .iter()
        .map(|(k, v)| (uri_encode(k, false), uri_encode(v, false)))
        .collect();
    pairs.sort();
    pairs
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&")
}

pub struct Signed {
    // 중간 값은 시험 벡터 비교용이다(요청에는 authorization만 쓴다)
    #[cfg_attr(not(test), allow(dead_code))]
    pub canonical_request: String,
    #[cfg_attr(not(test), allow(dead_code))]
    pub string_to_sign: String,
    pub authorization: String,
}

/// SigV4 서명(순수 함수). headers는 소문자 이름·값이고 모두 서명한다.
#[allow(clippy::too_many_arguments)]
pub fn sign_v4(
    method: &str,
    canonical_uri: &str,
    canonical_query: &str,
    headers: &[(String, String)],
    payload_hash: &str,
    amz_date: &str,
    region: &str,
    service: &str,
    access_key: &str,
    secret_key: &str,
) -> Signed {
    let mut hs: Vec<(String, String)> = headers
        .iter()
        .map(|(k, v)| (k.to_ascii_lowercase(), v.trim().to_string()))
        .collect();
    hs.sort();
    let canonical_headers: String = hs.iter().map(|(k, v)| format!("{k}:{v}\n")).collect();
    let signed_headers = hs
        .iter()
        .map(|(k, _)| k.as_str())
        .collect::<Vec<_>>()
        .join(";");
    let canonical_request = format!(
        "{method}\n{canonical_uri}\n{canonical_query}\n{canonical_headers}\n{signed_headers}\n{payload_hash}"
    );
    let date = &amz_date[..8];
    let scope = format!("{date}/{region}/{service}/aws4_request");
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
        sha256_hex(canonical_request.as_bytes())
    );
    let k_date = hmac(format!("AWS4{secret_key}").as_bytes(), date.as_bytes());
    let k_region = hmac(&k_date, region.as_bytes());
    let k_service = hmac(&k_region, service.as_bytes());
    let k_signing = hmac(&k_service, b"aws4_request");
    let signature = hex::encode(hmac(&k_signing, string_to_sign.as_bytes()));
    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={access_key}/{scope}, SignedHeaders={signed_headers}, Signature={signature}"
    );
    Signed {
        canonical_request,
        string_to_sign,
        authorization,
    }
}

/// 유닉스 초 → `YYYYMMDDTHHMMSSZ`
pub fn amz_date(unix: u64) -> String {
    let days = (unix / 86_400) as i64;
    let secs = unix % 86_400;
    // Howard Hinnant의 days_from_civil 역함수
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}{m:02}{d:02}T{:02}{:02}{:02}Z",
        secs / 3600,
        (secs / 60) % 60,
        secs % 60
    )
}

/// 다시 시도할 HTTP 상태: 5xx와 429(R2의 일시 오류·속도 제한)
pub fn retryable(status: u16) -> bool {
    status == 429 || (500..=599).contains(&status)
}

/// 시도 횟수(env XTASK_RETRY_ATTEMPTS, 기본 4, 1..=10)
fn retry_attempts() -> u32 {
    env("XTASK_RETRY_ATTEMPTS")
        .and_then(|v| v.parse().ok())
        .filter(|n| (1..=10).contains(n))
        .unwrap_or(4)
}

/// n번째 다시 시도 전 대기: base·2^(n-1)(env XTASK_RETRY_BASE_MS, 기본 2000. selftest는 짧게 준다)
fn backoff(n: u32) -> Duration {
    let base = env("XTASK_RETRY_BASE_MS")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(2000);
    Duration::from_millis(base.saturating_mul(1 << (n - 1).min(6)))
}

pub struct Resp {
    pub status: u16,
    pub etag: Option<String>,
    pub body: Vec<u8>,
}

impl Resp {
    /// 오류 응답의 S3 오류 코드(<Code>…</Code>)만. 본문 전체는 찍지 않는다
    pub fn code(&self) -> String {
        let t = String::from_utf8_lossy(&self.body);
        match (t.find("<Code>"), t.find("</Code>")) {
            (Some(a), Some(b)) if b > a + 6 => t[a + 6..b]
                .chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .take(60)
                .collect(),
            _ => String::new(),
        }
    }
}

pub struct S3 {
    endpoint: String,
    host: String,
    region: String,
    bucket: String,
    access: String,
    secret: String,
    http: reqwest::blocking::Client,
}

/// ListObjectsV2 응답에서 읽은 것
pub struct Listing {
    pub keys: Vec<String>,
    pub truncated: bool,
}

/// ListObjectsV2 XML(순수). `<ListBucketResult`가 없으면 기반 시설 오류. `<Key>…</Key>` 텍스트를 전부 모으고(값에 `&`나 `<`가
/// 있으면 이스케이프를 풀지 않으므로 거부한다: 릴리스 키는 ASCII 파일명뿐이다) `<IsTruncated>true</IsTruncated>`면 truncated
pub fn parse_list(xml: &[u8]) -> Res<Listing> {
    let t = std::str::from_utf8(xml).map_err(|_| infra("목록 응답이 UTF-8이 아니다"))?;
    if !t.contains("<ListBucketResult") {
        return Err(infra("목록 응답이 ListBucketResult가 아니다"));
    }
    let mut keys = vec![];
    let mut rest = t;
    // "<Key>"는 ">"까지 찾으므로 <KeyCount>에 걸리지 않는다
    while let Some(a) = rest.find("<Key>") {
        let after = &rest[a + "<Key>".len()..];
        let Some(b) = after.find("</Key>") else {
            return Err(infra("목록 응답의 <Key>가 닫히지 않았다"));
        };
        let k = &after[..b];
        if k.contains('&') || k.contains('<') {
            return Err(infra(
                "목록 키에 XML 이스케이프가 있다 — 풀지 않고 거부한다",
            ));
        }
        keys.push(k.to_string());
        rest = &after[b + "</Key>".len()..];
    }
    Ok(Listing {
        keys,
        truncated: t.contains("<IsTruncated>true</IsTruncated>"),
    })
}

pub enum Put {
    Created,
    /// 412: 조건이 맞지 않았다(이미 있음 / etag가 다름)
    Precondition,
}

impl S3 {
    pub fn from_env() -> Res<S3> {
        let mut missing = vec![];
        let mut get = |n: &str| {
            let v = env(n);
            if v.is_none() {
                missing.push(n.to_string());
            }
            v.unwrap_or_default()
        };
        let access = get("R2_ACCESS_KEY_ID");
        let secret = get("R2_SECRET_ACCESS_KEY");
        let bucket = get("R2_BUCKET");
        let endpoint = match env("R2_ENDPOINT") {
            Some(e) => e,
            None => format!("https://{}.r2.cloudflarestorage.com", get("R2_ACCOUNT_ID")),
        };
        if !missing.is_empty() {
            return Err(input(format!("S3 설정 없음: {}", missing.join(", "))));
        }
        let endpoint = endpoint.trim_end_matches('/').to_string();
        let url =
            reqwest::Url::parse(&endpoint).map_err(|e| input(format!("R2_ENDPOINT 형식: {e}")))?;
        if url.path() != "/" || url.query().is_some() {
            return Err(input("R2_ENDPOINT는 scheme://host[:port]만"));
        }
        let host = match url.port() {
            Some(p) => format!("{}:{p}", url.host_str().unwrap_or_default()),
            None => url.host_str().unwrap_or_default().to_string(),
        };
        let http = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(600))
            .connect_timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| input(format!("HTTP 클라이언트: {e}")))?;
        Ok(S3 {
            endpoint,
            host,
            region: env("R2_REGION").unwrap_or_else(|| "auto".into()),
            bucket,
            access,
            secret,
            http,
        })
    }

    /// key가 비어 있으면 버킷 자체(`/<bucket>`, 목록)다. query는 서명하는 정규 쿼리로도, URL 쿼리로도 쓴다
    fn request(
        &self,
        method: &str,
        key: &str,
        query: &[(&str, &str)],
        body: &[u8],
        extra: &[(&str, String)],
    ) -> Res<Resp> {
        let path = if key.is_empty() {
            format!("/{}", uri_encode(&self.bucket, false))
        } else {
            format!(
                "/{}/{}",
                uri_encode(&self.bucket, false),
                uri_encode(key, true)
            )
        };
        let cquery = canonical_query(query);
        let what = if key.is_empty() { "(목록)" } else { key };
        let url = if cquery.is_empty() {
            format!("{}{path}", self.endpoint)
        } else {
            format!("{}{path}?{cquery}", self.endpoint)
        };
        let payload_hash = sha256_hex(body);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let date = amz_date(now);
        let mut headers: Vec<(String, String)> = vec![
            ("host".into(), self.host.clone()),
            ("x-amz-content-sha256".into(), payload_hash.clone()),
            ("x-amz-date".into(), date.clone()),
        ];
        for (k, v) in extra {
            headers.push((k.to_string(), v.clone()));
        }
        let signed = sign_v4(
            method,
            &path,
            &cquery,
            &headers,
            &payload_hash,
            &date,
            &self.region,
            "s3",
            &self.access,
            &self.secret,
        );
        let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| input(e.to_string()))?;
        let mut last = String::new();
        let attempts = retry_attempts();
        // 네트워크 오류·본문 읽기 오류·HTTP 5xx·429는 다시 시도한다. 모든 요청이 같은 요청을 다시 보내도 안전하다: GET·DELETE는
        // 멱등이고, PUT은 조건부(If-None-Match·If-Match)라 먼저 보낸 요청이 이미 적용됐으면 412가 오고 호출자가 다시 읽어
        // 판정한다(put_immutable·promote). 끝까지 안 되면 기반 시설 오류(exit 2)다: 내용이 틀렸다는 판정이 아니다.
        for attempt in 0..attempts {
            if attempt > 0 {
                std::thread::sleep(backoff(attempt));
            }
            let mut req = self
                .http
                .request(m.clone(), &url)
                .header("authorization", &signed.authorization);
            for (k, v) in &headers {
                if k != "host" {
                    req = req.header(k.as_str(), v.as_str());
                }
            }
            if !body.is_empty() || method == "PUT" {
                req = req.body(body.to_vec());
            }
            match req.send() {
                Ok(r) => {
                    let status = r.status().as_u16();
                    let etag = r
                        .headers()
                        .get("etag")
                        .and_then(|v| v.to_str().ok())
                        .map(str::to_string);
                    let body = match r.bytes() {
                        Ok(b) => b.to_vec(),
                        Err(e) => {
                            last = format!("본문 읽기 {e}");
                            continue;
                        }
                    };
                    let resp = Resp { status, etag, body };
                    if retryable(status) && attempt + 1 < attempts {
                        last = format!("HTTP {status} {}", resp.code());
                        eprintln!(
                            "s3: {method} {what}: {last} — 다시 시도({}/{attempts})",
                            attempt + 2
                        );
                        continue;
                    }
                    return Ok(resp);
                }
                Err(e) => last = format!("{e}"),
            }
        }
        Err(infra(format!("{method} {what}: {attempts}회 실패({last})")))
    }

    /// 판정할 수 없는 응답(5xx·429를 다시 시도한 뒤, 403 등)은 기반 시설 오류(exit 2)다
    fn unexpected(&self, what: &str, key: &str, r: &Resp) -> crate::cli::Fail {
        infra(format!("{what} {key}: HTTP {} {}", r.status, r.code()))
    }

    /// 없으면 None
    pub fn get(&self, key: &str) -> Res<Option<(Vec<u8>, String)>> {
        let r = self.request("GET", key, &[], b"", &[])?;
        match r.status {
            200 => {
                let etag = r
                    .etag
                    .clone()
                    .ok_or_else(|| infra(format!("GET {key}: ETag 없음")))?;
                Ok(Some((r.body, etag)))
            }
            404 => Ok(None),
            _ => Err(self.unexpected("GET", key, &r)),
        }
    }

    fn put(&self, key: &str, body: &[u8], cond: Option<(&str, String)>) -> Res<Put> {
        let mut extra = vec![(
            "x-amz-checksum-sha256",
            STANDARD.encode(Sha256::digest(body)),
        )];
        if let Some(c) = cond {
            extra.push(c);
        }
        let r = self.request("PUT", key, &[], body, &extra)?;
        match r.status {
            200 | 201 => Ok(Put::Created),
            412 => Ok(Put::Precondition),
            _ => Err(self.unexpected("PUT", key, &r)),
        }
    }

    /// 없을 때만 만든다(If-None-Match: *)
    pub fn put_new(&self, key: &str, body: &[u8]) -> Res<Put> {
        self.put(key, body, Some(("if-none-match", "*".into())))
    }

    /// etag가 같을 때만 바꾼다(If-Match)
    pub fn put_if_match(&self, key: &str, body: &[u8], etag: &str) -> Res<Put> {
        self.put(key, body, Some(("if-match", etag.to_string())))
    }

    /// 조건 없이 덮어쓴다(selftest 변조 전용)
    pub fn put_raw(&self, key: &str, body: &[u8]) -> Res<()> {
        self.put(key, body, None).map(|_| ())
    }

    /// 접두로 시작하는 키 전부(ListObjectsV2, delimiter 없음). 한 번에 max-keys개(env XTASK_LIST_MAX_KEYS, 1..=1000, 기본 1000)이고
    /// 이어받기는 하지 않는다: 잘리면 아무것도 모른 채 지우지 않도록 기반 시설 오류(exit 2)다
    pub fn list(&self, prefix: &str) -> Res<Vec<String>> {
        let max = env("XTASK_LIST_MAX_KEYS")
            .and_then(|v| v.parse::<u32>().ok())
            .filter(|n| (1..=1000).contains(n))
            .unwrap_or(1000);
        let max_s = max.to_string();
        let q = [
            ("list-type", "2"),
            ("prefix", prefix),
            ("max-keys", max_s.as_str()),
        ];
        let r = self.request("GET", "", &q, b"", &[])?;
        if r.status != 200 {
            return Err(self.unexpected("LIST", prefix, &r));
        }
        let l = parse_list(&r.body)?;
        if l.truncated {
            return Err(infra(format!(
                "목록이 잘렸다(max-keys {max}) — 이어받기는 하지 않는다. 지우지 않는다"
            )));
        }
        if let Some(k) = l.keys.iter().find(|k| !k.starts_with(prefix)) {
            return Err(infra(format!("목록에 접두 {prefix}가 아닌 키가 있다: {k}")));
        }
        Ok(l.keys)
    }

    pub fn delete(&self, key: &str) -> Res<()> {
        let r = self.request("DELETE", key, &[], b"", &[])?;
        match r.status {
            200 | 204 | 404 => Ok(()),
            _ => Err(self.unexpected("DELETE", key, &r)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// AWS SigV4 시험 모음 get-vanilla(공개 예시 자격 증명)
    #[test]
    fn sigv4_get_vanilla() {
        let headers = vec![
            ("Host".to_string(), "example.amazonaws.com".to_string()),
            ("X-Amz-Date".to_string(), "20150830T123600Z".to_string()),
        ];
        let secret = ["wJalrXUtnFEMI", "K7MDENG+bPxRfiCYEXAMPLEKEY"].join("/");
        let s = sign_v4(
            "GET",
            "/",
            "",
            &headers,
            &sha256_hex(b""),
            "20150830T123600Z",
            "us-east-1",
            "service",
            "AKIDEXAMPLE",
            &secret,
        );
        assert_eq!(
            sha256_hex(s.canonical_request.as_bytes()),
            "bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63"
        );
        assert!(s.string_to_sign.starts_with(
            "AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n"
        ));
        assert_eq!(
            s.authorization,
            // 공개 시험 벡터의 서명 값. 누출 검사(keyed-hex)에 걸리지 않게 둘로 나눠 적는다
            concat!(
                "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=",
                "5fa00fa31553b73ebf194",
                "2676e86291e8372ff2a22",
                "60956d9b8aae1d763fbf31"
            )
        );
    }

    #[test]
    fn dates_and_encoding() {
        assert_eq!(amz_date(0), "19700101T000000Z");
        assert_eq!(amz_date(1_440_938_160), "20150830T123600Z");
        assert_eq!(amz_date(951_782_400), "20000229T000000Z");
        assert_eq!(
            uri_encode("releases/0.2.0/a b+c.AppImage", true),
            "releases/0.2.0/a%20b%2Bc.AppImage"
        );
        assert_eq!(uri_encode("a/b", false), "a%2Fb");
    }

    #[test]
    fn retry_statuses() {
        for s in [429, 500, 502, 503, 504, 599] {
            assert!(retryable(s), "{s}");
        }
        // 판정 가능한 응답은 다시 시도하지 않는다(412는 조건부 쓰기의 결과, 404는 없음, 403은 자격 증명)
        for s in [200, 201, 204, 400, 403, 404, 412, 499] {
            assert!(!retryable(s), "{s}");
        }
    }

    #[test]
    fn canonical_query_sorted_and_encoded() {
        assert_eq!(
            canonical_query(&[
                ("prefix", "releases/"),
                ("list-type", "2"),
                ("max-keys", "1000")
            ]),
            "list-type=2&max-keys=1000&prefix=releases%2F"
        );
        assert_eq!(canonical_query(&[]), "");
        // 값이 같은 키는 값 순, 인코딩한 뒤 정렬한다
        assert_eq!(canonical_query(&[("b", "2"), ("a", "z y")]), "a=z%20y&b=2");
    }

    #[test]
    fn parse_list_cases() {
        let ok = b"<?xml version=\"1.0\"?><ListBucketResult><Name>b</Name><Prefix>releases/</Prefix><KeyCount>2</KeyCount><IsTruncated>false</IsTruncated><Contents><Key>releases/1.0.0/a</Key></Contents><Contents><Key>releases/1.0.0/b</Key></Contents></ListBucketResult>";
        let l = parse_list(ok).unwrap();
        assert_eq!(l.keys, ["releases/1.0.0/a", "releases/1.0.0/b"]);
        assert!(!l.truncated);
        let t = b"<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>k</Key></Contents></ListBucketResult>";
        assert!(parse_list(t).unwrap().truncated);
        assert!(parse_list(b"<Error><Code>x</Code></Error>").is_err());
        assert!(
            parse_list(
                b"<ListBucketResult><Contents><Key>a&amp;b</Key></Contents></ListBucketResult>"
            )
            .is_err()
        );
        assert!(
            parse_list(b"<ListBucketResult><Contents><Key>a</Contents></ListBucketResult>")
                .is_err()
        );
        let empty =
            parse_list(b"<ListBucketResult><KeyCount>0</KeyCount></ListBucketResult>").unwrap();
        assert!(empty.keys.is_empty());
    }

    #[test]
    fn error_code_only() {
        let r = Resp {
            status: 412,
            etag: None,
            body: b"<Error><Code>PreconditionFailed</Code><Message>x</Message></Error>".to_vec(),
        };
        assert_eq!(r.code(), "PreconditionFailed");
    }
}
