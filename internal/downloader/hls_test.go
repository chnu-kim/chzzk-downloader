package downloader

import (
	"strings"
	"testing"
)

// indexOf 슬라이스에서 값의 인덱스를 반환 (없으면 -1)
func indexOf(args []string, want string) int {
	for i, a := range args {
		if a == want {
			return i
		}
	}
	return -1
}

func TestBuildFFmpegArgs_CoreOptions(t *testing.T) {
	args := buildFFmpegArgs("https://example.com/v.mp4", "/out/file.mp4", nil)

	// -i 다음에 소스 URL이 와야 함
	i := indexOf(args, "-i")
	if i < 0 || i+1 >= len(args) || args[i+1] != "https://example.com/v.mp4" {
		t.Errorf("-i <sourceURL> 가 없음: %v", args)
	}

	// -c copy (remux)
	c := indexOf(args, "-c")
	if c < 0 || args[c+1] != "copy" {
		t.Errorf("-c copy 가 없음: %v", args)
	}

	// 진행률 출력 옵션
	if indexOf(args, "-progress") < 0 {
		t.Errorf("-progress 옵션이 없음: %v", args)
	}

	// 출력 파일은 마지막 인자
	if args[len(args)-1] != "/out/file.mp4" {
		t.Errorf("마지막 인자가 출력 파일이 아님: %v", args)
	}
}

func TestBuildFFmpegArgs_HeadersAndUserAgent(t *testing.T) {
	headers := map[string]string{
		"User-Agent": "TestUA/1.0",
		"Referer":    "https://chzzk.naver.com/",
		"Cookie":     "NID_AUT=a; NID_SES=b",
	}
	args := buildFFmpegArgs("https://example.com/v.m3u8", "/out/f.mp4", headers)

	// User-Agent는 -user_agent 로 전달
	ua := indexOf(args, "-user_agent")
	if ua < 0 || args[ua+1] != "TestUA/1.0" {
		t.Errorf("-user_agent <UA> 가 없음: %v", args)
	}

	// 나머지 헤더는 -headers 로 전달, 키 정렬(Cookie < Referer)되어 결정적
	h := indexOf(args, "-headers")
	if h < 0 {
		t.Fatalf("-headers 옵션이 없음: %v", args)
	}
	want := "Cookie: NID_AUT=a; NID_SES=b\r\nReferer: https://chzzk.naver.com/\r\n"
	if args[h+1] != want {
		t.Errorf("-headers 값이 기대와 다름:\n got=%q\nwant=%q", args[h+1], want)
	}

	// User-Agent는 -headers 블록에 중복되면 안 됨
	if strings.Contains(args[h+1], "User-Agent") {
		t.Errorf("-headers 블록에 User-Agent가 중복됨: %q", args[h+1])
	}
}

func TestRedactedCmdString_HidesCookie(t *testing.T) {
	headers := map[string]string{
		"User-Agent": "UA/1.0",
		"Referer":    "https://chzzk.naver.com/",
		"Cookie":     "NID_AUT=secretAUT; NID_SES=secretSES",
	}
	args := buildFFmpegArgs("https://example.com/v.m3u8", "/out/f.mp4", headers)

	log := redactedCmdString("/usr/bin/ffmpeg", args)

	// 민감한 쿠키 값은 로그에 노출되면 안 됨
	for _, secret := range []string{"secretAUT", "secretSES"} {
		if strings.Contains(log, secret) {
			t.Errorf("로그에 쿠키 값 %q 가 노출됨:\n%s", secret, log)
		}
	}
	// 비민감 정보(소스 URL, Referer)는 디버깅 위해 남아야 함
	if !strings.Contains(log, "https://example.com/v.m3u8") {
		t.Errorf("로그에 소스 URL이 없음:\n%s", log)
	}
	if !strings.Contains(log, "chzzk.naver.com") {
		t.Errorf("로그에 Referer가 없음:\n%s", log)
	}
}

func TestBuildFFmpegArgs_NoHeadersOmitsHeaderFlags(t *testing.T) {
	args := buildFFmpegArgs("https://example.com/v.mp4", "/out/f.mp4", nil)

	if indexOf(args, "-user_agent") >= 0 {
		t.Errorf("헤더 없을 때 -user_agent 가 있으면 안 됨: %v", args)
	}
	if indexOf(args, "-headers") >= 0 {
		t.Errorf("헤더 없을 때 -headers 가 있으면 안 됨: %v", args)
	}
}
