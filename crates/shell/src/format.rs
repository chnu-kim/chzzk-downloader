//! 사용자에게 보이는 크기·시간·날짜 문자열(system/content.md §7, D47~D50, platform.md §20).
//!
//! `app/src/lib/format/`의 TS 함수와 같은 이름(snake_case)의 거울이다. 두 구현은 `design/format/*.json`
//! 골든 하나를 함께 읽어(`tests/format_golden.rs`, `format.test.ts`) 어긋나지 않게 한다.
//! 순수 정수 연산만 쓴다: 부동소수·`Intl`·시간대 라이브러리 없음. 지금은 골든 거울이고,
//! 앞으로 셸(Dock 진행·알림)이 같은 문자열이 필요할 때 쓴다.

use crate::dto::OsDto;

/// 숫자와 단위 사이 띄움(D48). 뒤집으려면 이 상수 하나를 바꾼다.
pub const UNIT_GAP: &str = "";

/// Windows 내림 여부는 실기 확인 전이다(content §16-2 [미확인]). TS `WINDOWS_ROUNDING`과 같다.
pub const WINDOWS_ROUNDING: Rounding = Rounding::Round;

/// 정수 나눗셈의 반올림 방식.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rounding {
    /// 0.5 올림
    Round,
    /// 내림
    Floor,
}

/// 바이트 진법. Windows 1024, 그 밖 1000.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SizeBase {
    Decimal = 1000,
    Binary = 1024,
}

impl SizeBase {
    /// 골든의 숫자(1000|1024)에서.
    pub fn from_number(n: u64) -> Option<SizeBase> {
        match n {
            1000 => Some(SizeBase::Decimal),
            1024 => Some(SizeBase::Binary),
            _ => None,
        }
    }

    fn value(self) -> u128 {
        self as u128
    }

    fn rounding(self) -> Rounding {
        match self {
            SizeBase::Binary => WINDOWS_ROUNDING,
            SizeBase::Decimal => Rounding::Round,
        }
    }
}

/// OS 진법.
pub fn size_base_of(os: OsDto) -> SizeBase {
    if os == OsDto::Windows {
        SizeBase::Binary
    } else {
        SizeBase::Decimal
    }
}

const LABELS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
const SPOKEN: [&str; 5] = [
    "바이트",
    "킬로바이트",
    "메가바이트",
    "기가바이트",
    "테라바이트",
];
const MAX_UNIT: usize = LABELS.len() - 1;

fn divide(num: u128, den: u128, mode: Rounding) -> u128 {
    match mode {
        Rounding::Floor => num / den,
        Rounding::Round => (2 * num + den) / (2 * den),
    }
}

fn pow_of(base: SizeBase, k: usize) -> u128 {
    base.value().pow(k as u32)
}

fn unit_of(v: u128, base: SizeBase) -> usize {
    let mut k = 0;
    while k < MAX_UNIT && v >= pow_of(base, k + 1) {
        k += 1;
    }
    k
}

fn with_decimals(r: u128, d: u32) -> String {
    if d == 0 {
        return r.to_string();
    }
    let unit = 10u128.pow(d);
    format!("{}.{:0width$}", r / unit, r % unit, width = d as usize)
}

/// 완료된 크기: 유효숫자 3자리(7.82GB, 22.9KB, 123KB, 999B). 반올림이 한 단위에 닿으면 다음 단위로 올린다.
pub fn format_file_size(bytes: u64, base: SizeBase) -> String {
    let v = bytes as u128;
    let mut k = unit_of(v, base);
    if k == 0 {
        return format!("{v}{UNIT_GAP}B");
    }
    let mode = base.rounding();
    loop {
        let div = pow_of(base, k);
        let mut text = String::new();
        let mut carried = false;
        for d in [2u32, 1, 0] {
            let r = divide(v * 10u128.pow(d), div, mode);
            if d == 0 && r >= base.value() && k < MAX_UNIT {
                carried = true;
                break;
            }
            if r < 1000 || d == 0 {
                text = with_decimals(r, d);
                break;
            }
        }
        if !carried {
            return format!("{text}{UNIT_GAP}{}", LABELS[k]);
        }
        k += 1;
    }
}

/// 소수 1자리 고정 표기의 단위 번호: 반올림 결과가 한 단위에 닿으면 올린다.
fn fixed_unit(v: u128, base: SizeBase) -> usize {
    let mut k = unit_of(v, base);
    let mode = base.rounding();
    while k > 0 && k < MAX_UNIT && divide(v * 10, pow_of(base, k), mode) >= base.value() * 10 {
        k += 1;
    }
    k
}

fn fixed1(v: u128, k: usize, base: SizeBase) -> String {
    if k == 0 {
        return format!("{v}{UNIT_GAP}B");
    }
    format!(
        "{}{UNIT_GAP}{}",
        with_decimals(divide(v * 10, pow_of(base, k), base.rounding()), 1),
        LABELS[k]
    )
}

/// 진행 "받은 양 / 전체": 같은 단위로 소수 1자리. 전체를 모르면 받은 양의 단위.
pub fn format_progress_size(
    received: u64,
    total: Option<u64>,
    base: SizeBase,
) -> (String, Option<String>) {
    let r = received as u128;
    let t = total.map(|t| t as u128);
    let basis = match t {
        Some(t) if t > r => t,
        _ => r,
    };
    let k = fixed_unit(basis, base);
    (fixed1(r, k, base), t.map(|t| fixed1(t, k, base)))
}

/// 예상 크기: `약 7.8GB`
pub fn format_estimate(bytes: u64, base: SizeBase) -> String {
    let v = bytes as u128;
    format!("약 {}", fixed1(v, fixed_unit(v, base), base))
}

/// 속도: `12.4MB/s`
pub fn format_speed(bytes_per_sec: u64, base: SizeBase) -> String {
    let v = bytes_per_sec as u128;
    format!("{}/s", fixed1(v, fixed_unit(v, base), base))
}

/// 퍼센트: 정수 내림, 완료 전 0~99.
pub fn format_percent(received: u64, total: u64, complete: bool) -> String {
    if complete {
        return "100%".to_string();
    }
    if total == 0 {
        return "0%".to_string();
    }
    let p = (received as u128 * 100 / total as u128).min(99);
    format!("{p}%")
}

/// 낭독용 크기: `7.8기가바이트`
pub fn format_spoken_size(bytes: u64, base: SizeBase) -> String {
    let v = bytes as u128;
    let k = fixed_unit(v, base);
    if k == 0 {
        return format!("{v}{}", SPOKEN[0]);
    }
    format!(
        "{}{}",
        with_decimals(divide(v * 10, pow_of(base, k), base.rounding()), 1),
        SPOKEN[k]
    )
}

/// 낭독용 속도: `초당 12.4메가바이트`
pub fn format_spoken_speed(bytes_per_sec: u64, base: SizeBase) -> String {
    format!("초당 {}", format_spoken_size(bytes_per_sec, base))
}

/// 낭독용 퍼센트: `58퍼센트`
pub fn format_spoken_percent(p: u64) -> String {
    format!("{}퍼센트", p.min(100))
}

/// 남은 시간. `None`은 계산 전.
pub fn format_remaining(secs: Option<u64>) -> String {
    let Some(s) = secs else {
        return "남은 시간 계산 중".to_string();
    };
    match s {
        0..=9 => "곧 끝나요".to_string(),
        10..=59 => "1분 미만 남음".to_string(),
        60..=3599 => format!("약 {}분 남음", s / 60),
        _ => {
            let (h, m) = (s / 3600, s % 3600 / 60);
            if m > 0 {
                format!("약 {h}시간 {m}분 남음")
            } else {
                format!("약 {h}시간 남음")
            }
        }
    }
}

/// 낭독용 남은 시간.
pub fn format_spoken_remaining(secs: Option<u64>) -> String {
    let Some(s) = secs else {
        return "남은 시간을 계산하고 있어요".to_string();
    };
    match s {
        0..=9 => "곧 끝나요".to_string(),
        10..=59 => "1분도 안 남았어요".to_string(),
        60..=3599 => format!("약 {}분 남아요", s / 60),
        _ => {
            let (h, m) = (s / 3600, s % 3600 / 60);
            if m > 0 {
                format!("약 {h}시간 {m}분 남아요")
            } else {
                format!("약 {h}시간 남아요")
            }
        }
    }
}

/// 일 단위: `3일 전에`(하루 미만이어도 1일).
pub fn format_days_ago(secs: u64) -> String {
    format!("{}일 전에", (secs / 86400).max(1))
}

/// 경과: `2분째`, `1시간 5분째`, `2시간째`. 하루 이상은 `format_days_ago`. 1분 미만은 `1분째`.
pub fn format_elapsed(secs: u64) -> String {
    if secs >= 86400 {
        return format_days_ago(secs);
    }
    if secs < 3600 {
        return format!("{}분째", (secs / 60).max(1));
    }
    let (h, m) = (secs / 3600, secs % 3600 / 60);
    if m > 0 {
        format!("{h}시간 {m}분째")
    } else {
        format!("{h}시간째")
    }
}

/// 지속 시간: 가장 큰 두 단위(`2분 18초`, `1시간 2분`).
pub fn format_span(secs: u64) -> String {
    let (h, m, r) = (secs / 3600, secs % 3600 / 60, secs % 60);
    if h > 0 {
        return if m > 0 {
            format!("{h}시간 {m}분")
        } else {
            format!("{h}시간")
        };
    }
    if m > 0 {
        return if r > 0 {
            format!("{m}분 {r}초")
        } else {
            format!("{m}분")
        };
    }
    format!("{r}초")
}

/// 영상 길이 `H:MM:SS`(시는 자리 맞춤 없음).
pub fn format_clock(secs: u64) -> String {
    format!("{}:{:02}:{:02}", secs / 3600, secs % 3600 / 60, secs % 60)
}

/// 남은 시간 `m:ss`(분은 자리 맞춤 없음).
pub fn format_mmss(secs: u64) -> String {
    format!("{}:{:02}", secs / 60, secs % 60)
}

/// 개수: 세 자리 쉼표(`1,210`).
pub fn format_count(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// 벽시계 시각(시간대 없음). `mo`는 1~12.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Wall {
    pub y: i64,
    pub mo: i64,
    pub d: i64,
    pub h: i64,
    pub mi: i64,
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: i64, mo: i64) -> i64 {
    [
        31,
        if is_leap(y) { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ][(mo - 1) as usize]
}

/// 1970-01-01부터 센 날 수(그레고리력, 음수 가능).
fn day_number(y: i64, mo: i64, d: i64) -> i64 {
    let yy = if mo <= 2 { y - 1 } else { y };
    let era = yy.div_euclid(400);
    let yoe = yy - era * 400;
    let doy = (153 * (if mo > 2 { mo - 3 } else { mo + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// 치지직 API 날짜 `"YYYY-MM-DD HH:MM:SS"`(KST)를 시간대 변환 없이 벽시계로. 모양·범위가 틀리면 `None`.
pub fn parse_kst_wall(s: &str) -> Option<Wall> {
    let b = s.trim().as_bytes();
    // `YYYY-MM-DD[ T]HH:MM` 16바이트 이상. 뒤(초 이하)는 보지 않는다
    if b.len() < 16
        || b[4] != b'-'
        || b[7] != b'-'
        || !(b[10] == b' ' || b[10] == b'T')
        || b[13] != b':'
    {
        return None;
    }
    let num = |from: usize, to: usize| -> Option<i64> {
        let part = &b[from..to];
        if part.iter().all(u8::is_ascii_digit) {
            Some(part.iter().fold(0, |acc, c| acc * 10 + i64::from(c - b'0')))
        } else {
            None
        }
    };
    let (y, mo, d, h, mi) = (
        num(0, 4)?,
        num(5, 7)?,
        num(8, 10)?,
        num(11, 13)?,
        num(14, 16)?,
    );
    if !(1..=12).contains(&mo) || d < 1 || d > days_in_month(y, mo) || h > 23 || mi > 59 {
        return None;
    }
    Some(Wall { y, mo, d, h, mi })
}

/// unix 초를 `offset_min`(UTC와의 분 차이) 시간대의 벽시계로.
pub fn wall_of(unix_secs: i64, offset_min: i64) -> Wall {
    let shifted = unix_secs + offset_min * 60;
    let days = shifted.div_euclid(86400);
    let rem = shifted.rem_euclid(86400);
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(mo <= 2);
    Wall {
        y,
        mo,
        d,
        h: rem / 3600,
        mi: rem % 3600 / 60,
    }
}

/// `2026. 10. 3.`
pub fn format_date(w: Wall) -> String {
    format!("{}. {}. {}.", w.y, w.mo, w.d)
}

fn time_of_day(w: Wall) -> String {
    let h12 = if w.h % 12 == 0 { 12 } else { w.h % 12 };
    format!(
        "{} {}:{:02}",
        if w.h < 12 { "오전" } else { "오후" },
        h12,
        w.mi
    )
}

/// `2026. 10. 3. 오후 9:00`
pub fn format_date_time(w: Wall) -> String {
    format!("{} {}", format_date(w), time_of_day(w))
}

/// 최근 시각: 올해는 연도 생략, 어제, 오늘은 방금·N분 전·N시간 전. 다른 해는 연도 포함.
pub fn format_when(w: Wall, now: Wall) -> String {
    if w.y != now.y {
        return format_date_time(w);
    }
    let day_diff = day_number(now.y, now.mo, now.d) - day_number(w.y, w.mo, w.d);
    let min_diff = day_diff * 1440 + (now.h * 60 + now.mi) - (w.h * 60 + w.mi);
    if min_diff >= 0 && day_diff == 0 {
        return match min_diff {
            0 => "방금".to_string(),
            1..=59 => format!("{min_diff}분 전"),
            _ => format!("{}시간 전", min_diff / 60),
        };
    }
    if day_diff == 1 {
        return format!("어제 {}", time_of_day(w));
    }
    format!("{}월 {}일 {}", w.mo, w.d, time_of_day(w))
}

/// 짧은 상대 시각: `방금` `N분 전` `N시간 전`.
pub fn format_ago(unix_secs: i64, now_unix_secs: i64) -> String {
    let diff = now_unix_secs - unix_secs;
    if diff < 60 {
        "방금".to_string()
    } else if diff < 3600 {
        format!("{}분 전", diff / 60)
    } else {
        format!("{}시간 전", diff / 3600)
    }
}
