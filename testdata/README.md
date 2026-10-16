# testdata — 합성 fixture

여기 파일은 모두 **합성**이다. 실제 방송·채널·영상의 응답이나 미디어가 아니며, 실제 서명 토큰도 없다.
`scripts/fixtures/gen-fixtures.mjs`가 결정적으로 만든다(`--check`로 저장소 파일과 같은지 확인).

- 채널 ID는 0으로 채운 32자리 hex(`000…a1` 등), 채널 이름·제목은 `테스트채널` 같은 가짜 값이다.
- 미디어 호스트는 `*.example.invalid`다(코어는 미디어 호스트를 검사하지 않는다). API 경로 모양만 실제와 같다.
- 서명 자리는 `hdnts=st=0~exp=0~…~hmac=0000`, `hdntl=exp=0~…~hmac=fakepath`, `_lsu_sa_=0000` 같은 자리표시자다. master 쿼리와 variant 경로 토큰의 hmac 자리는 일부러 다르다.
- 날짜·시각·길이·비트레이트도 둥근 가짜 값이다(`2026-01-02 12:00:00`, 740초, `PT1H0M0.000S` 등).
- 클립의 `makerChannel`(`…d4`, `제작자채널`)은 `ownerChannel`(`…c3`, `클립채널`)과 다르다. 소유 판정은 owner를 따라야 한다.
- fMP4(`hls/init.mp4`, `seg0.m4v`, `seg1.m4v`)는 상자 구조(`ftyp`·`moov` / `styp`·(`moof`·`mdat`·`emsg`)×2)만 맞춘 가짜 바이트다. 디코드되지 않는다.
- **예외: `live/synthetic_frag.mp4`는 생성기가 만들지 않는 정적 바이너리다**(`gen-fixtures.mjs`의 출력 목록에 없어 `--check`와 겹치지 않는다). ffmpeg lavfi 합성 신호(`testsrc` 64×64 30fps → libx264 High, B 프레임 2, GOP 30 / `sine` 440Hz 48kHz 모노 → AAC-LC, 3초)를 `-movflags frag_keyframe+empty_moov+default_base_moof`로 조각낸 디코드 가능한 fMP4다(`ftyp`·`moov`(mvex) / (`moof`·`mdat`)×7 / `mfra`, 약 21 KB). 모양은 예: `ffmpeg -f lavfi -i testsrc=duration=3:size=64x64:rate=30 -f lavfi -i sine=frequency=440:duration=3:sample_rate=48000 -c:v libx264 -g 30 -bf 2 -c:a aac -ac 1 -movflags frag_keyframe+empty_moov+default_base_moof synthetic_frag.mp4`(인코더 버전·프리셋에 따라 바이트는 달라진다. 테스트는 바이트가 아니라 구조와 원본 대비 등가성만 본다). 생방송 결과의 일반 mp4 변환(`download::defrag`)과 `tests/recording.rs`의 실제 조각 녹화가 쓴다.

| 폴더 | 내용 | 테스트가 기대는 구조 |
|---|---|---|
| `hls/` | 빠른 다시보기(`inKey: null`) info, master(variant 5개), media(세그먼트 30개 × 2초), fMP4 | `liveRewindPlaybackJson`이 JSON이 든 **문자열**, variant URI 경로의 `hdntl=` 토큰, MAP URI 쿼리 보존 |
| `live/` | 생방송 `live-detail` 응답 넷: 진행 중(HLS·LLHLS 순서 둘), 종료(`CLOSE`, 재생 정보 없음), 성인 차단(재생 정보 없음). 그리고 정적 합성 fMP4 `synthetic_frag.mp4`(위 예외) | `livePlaybackJson`이 JSON이 든 **문자열**, 같은 `protocol: "HLS"`인 media 둘을 `mediaId`로 구분, `audioOnly` 트랙 |
| `vod/` | 일반 VOD(`inKey` 있음) info와 MPD | `video/mp4` PD 2개 + `video/mp2t` UUID 2개(mimeType 상속, PD와 같은 라벨·서명 BaseURL·SegmentTemplate을 가진 미끼) + `audio/mp4` 1개(라벨·SegmentList), `ContentProtection` 없음 |
| `clip/` | 클립 play-info 2개와 MPD(세로 영상, PD 2개) | `%xx` 인코딩 서명 쿼리 보존, resolution 라벨 기준 선택 |
| `synthetic/` | `vod_info_aes.json`(`encryptionType: "AES"`), `media_*.m3u8`(태그 하나씩 넣거나 뺀 변형) | 미지원 태그·암호화 거부와 허용 규칙 |
| `chat/` | 다시보기 채팅 페이지 응답 아홉(첫 페이지·경계 되풀이·경계 쌍둥이·끝 셋·종류·이스케이프·형식 오류)과 자막 골든 `expected/` | 앞쪽 묶음은 버리고 뒤쪽 묶음만 쓴다, profile·extras는 JSON이 든 **문자열**, 닉네임·본문·작성자 해시는 가짜(가상시청자N, user-hash-NN) |

fixture를 바꾸면 생성기를 고치고 다시 만든다. 새 값도 가짜여야 하며 `node scripts/ci/public-scan.mjs`를 통과해야 한다.
