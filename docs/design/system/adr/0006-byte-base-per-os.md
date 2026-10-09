# 0006 바이트 진법을 OS별로

상태: 채택(잠정)   날짜: 2026-10-09   관련: D47, D48, D2, README §6-10, platform.md 분기 표

## 맥락

현재 앱은 바이트를 1024 진법으로 계산해 `KB·MB·GB` 라벨을 붙인다(Go 시절 골든 승계). 같은 8,400,000,000바이트가 macOS Finder에서는 `8.4GB`, 앱에서는 `7.8GB`로 보인다(약 7.4% = 1.024³ 차이). macOS 사용자에게는 앱이 틀려 보이고, Windows 탐색기는 1024 진법에 `KB·GB` 라벨을 쓰므로 Windows 사용자에게는 앱이 맞아 보인다(g-units §1). 사용자가 가장 자주 대조하는 값은 "내 OS의 파일 관리자가 보여 주는 크기"다.

이 저장소에는 OS별 규칙을 인자로 받아 한 호스트에서 세 OS를 테스트하는 선례가 있다(`naming::Platform`, CLAUDE.md "OS별 분기").

## 결정

파일 크기·속도·디스크 공간은 **OS가 쓰는 진법**으로 표시한다:

| OS | 진법 | 라벨 | 예(8,400,000,000바이트) |
|---|---|---|---|
| Windows | 1024 | KB·MB·GB(KiB 금지) | 7.82GB |
| macOS | 1000 | KB·MB·GB | 8.40GB → 유효숫자 3자리 "8.4GB" |
| Linux | 1000 | KB·MB·GB | 8.4GB |

세부(D47·D48): 완료 값은 유효숫자 3자리, 진행 중은 소수 1자리("2.3GB / 4.0GB"), 예상은 "약", 숫자와 단위는 **붙임**("7.8GB", "12.4MB/s"), 속도는 MB/s(Mbps 금지), 바이트 수는 툴팁. 모든 크기(받은 양·전체·예상·완료·디스크 경고)가 **한 함수**를 거친다: Rust `format_bytes(n, Platform)`과 TS `formatBytes(n, platform)`이 같은 골든 JSON(`design/format/bytes.json`)으로 테스트된다. 플랫폼 값은 셸이 주입한다(코어·프런트가 `navigator`로 추측하지 않는다).

## 근거

| # | 주장 | 등급 | 출처 | 표본·날짜 |
|---|---|---|---|---|
| 1 | macOS Finder는 Snow Leopard 이후 1000 진법 | E0 | https://support.apple.com/en-us/102119 ("iOS 10 및 이전, OS X Leopard 및 이전"이 이진법), 실측 `ByteCountFormatter(.file)` 8.4e9 → `8.4 GB` | g-units §2 표, `E-A11Y-U01` |
| 2 | Windows 탐색기는 1024 진법에 `KB·GB` 라벨(IEC 무시) | E0 | https://devblogs.microsoft.com/oldnewthing/20090611-00/?p=17933 , `StrFormatByteSizeW` 문서 표(1340 → 1.30 KB) | 2차 다수. **단, 같은 MS 문서가 "Windows 10은 10진"이라고도 적어 스스로 모순** → 근거 6 |
| 3 | GNOME Files(GLib `g_format_size`)는 SI 1000 | E0 | https://docs.gtk.org/glib/flags.FormatSizeFlags.html | — |
| 4 | 비기술자는 `KiB`를 이해하지 못한다 | E0 | Raymond Chen(근거 2 글), g-units §4 D안 | — |
| 5 | 숫자·단위 붙임은 ko-localized `ByteCountFormatter`(`8.4GB`)·Apple 한국어 지원 문서(`1GB`)·CLDR ko(`7.8GB`)가 일치. 국립국어원 규범은 라틴 단위를 다루지 않는다(규범 공백) | E0 | v-a11y 확정 32, U16(Finder 문자열 인용은 refuted이나 결론은 ko 번들 실측으로 같다) | 실측 2026-10-09 |
| 6 | Windows 탐색기의 **실제 표시**는 이 조사에서 실기로 확인하지 못했다 | [미확인] | g-units §3 | 확인: Windows 실기(`compose.yml` 환경)에서 8,400,000,000바이트 파일의 속성 창 캡처(README §6-10) |
| 7 | OS별 인자 분기 선례 | E1 | `naming::Platform`, CLAUDE.md | — |

최고 등급: E1(사용자 관찰 없음; 외부 규칙은 E0) / 결정 영향: 중간 / 판정: 채택(잠정)

## 결과

- `content.md` 숫자·단위 절이 표를 소유하고, `platform.md` OS 분기 표에 "바이트 진법" 행이 들어간다.
- 코어: `format_bytes`에 `Platform` 인자. 기존 Go 골든(1024, 띄움 "7.8 GB")은 **바뀐다** → `docs/spec/core-behavior.md`에 변경 기록. 저장 공간 오류(`DiskFull` 계열) 메시지도 같은 함수.
- 셸 DTO에 `platform` 또는 셸이 미리 포맷한 문자열 중 하나. 설계는 `app.md` 구현 중 변경에 적는다(이 ADR은 표시 규칙만 정한다).
- `rust`·`frontend` gate: 골든 JSON 양쪽 테스트(단계 (d)). `design-copy` C4(문자열에 숫자+단위 직접 금지).
- 알려진 결과: 같은 파일을 Windows·macOS 사용자가 스크린샷으로 비교하면 숫자가 다르다(7.82 vs 8.4). 지인 대상 앱이라 드물고, 각자 자기 파일 관리자와는 일치한다.

### 재검증 조건

- README §6-10 Windows 실기 결과가 "탐색기가 1000 진법"이면 Windows 행을 1000으로 고치고 골든을 갱신하는 ADR(그때는 전 OS 1000이 되어 분기가 사라진다).
- D62 T4에서 참가자가 앱의 크기와 파일 관리자의 크기를 대조하며 혼란을 말하면 기록(E3).

## 대안과 버린 이유

| 대안 | 버린 이유 |
|---|---|
| B. 1000 고정, 라벨 KB | Windows 사용자(주 사용자일 가능성, 분포 [미확인])에게 7% 어긋남. 설명이 "SI 표준을 따른다"가 되어 비기술자에게 전달이 어렵다 |
| C. 1024 고정(현재) | macOS 사용자에게 오류처럼 보인다(이 조사의 발단). 이미 구현된 골든이 있다는 것만 장점 |
| D. 1024 + `KiB/GiB` 라벨 | 표준 준수이지만 비기술자가 이해하지 못하고 파일 관리자와 대조 자체가 막힌다 |
| E. 완료 항목에 바이트 수 상시 표기 | 보조 수단으로만(툴팁). 본문에 11자리 숫자는 읽히지 않는다 |
