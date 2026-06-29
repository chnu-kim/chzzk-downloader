package downloader

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestDownloadDirectMP4_ByteIdentity 서버가 내려준 바이트와 저장된 파일이 바이트 단위로 동일해야 한다.
// chzzk PD_* BaseURL은 faststart muxed mp4이므로 http.Get + io.Copy는 ffmpeg -c copy 패스스루와 동치다.
func TestDownloadDirectMP4_ByteIdentity(t *testing.T) {
	body := bytes.Repeat([]byte("chzzk-progressive-mp4-bytes!"), 5000) // 임의의 충분한 크기

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", itoa(len(body)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	out := filepath.Join(t.TempDir(), "out.mp4")
	if err := downloadDirectMP4(srv.URL, out, nil); err != nil {
		t.Fatalf("downloadDirectMP4: %v", err)
	}

	got, err := os.ReadFile(out)
	if err != nil {
		t.Fatalf("read output: %v", err)
	}
	if !bytes.Equal(got, body) {
		t.Errorf("저장된 파일이 원본과 다름: got %d bytes, want %d bytes", len(got), len(body))
	}
}

// TestDownloadDirectMP4_SendsHeaders User-Agent/Referer/Cookie 헤더를 요청에 실어 보내야 한다.
func TestDownloadDirectMP4_SendsHeaders(t *testing.T) {
	var gotUA, gotReferer, gotCookie string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUA = r.Header.Get("User-Agent")
		gotReferer = r.Header.Get("Referer")
		gotCookie = r.Header.Get("Cookie")
		_, _ = w.Write([]byte("ok"))
	}))
	defer srv.Close()

	headers := map[string]string{
		"User-Agent": "TestUA/1.0",
		"Referer":    "https://chzzk.naver.com/",
		"Cookie":     "NID_AUT=a; NID_SES=b",
	}
	out := filepath.Join(t.TempDir(), "out.mp4")
	if err := downloadDirectMP4(srv.URL, out, headers); err != nil {
		t.Fatalf("downloadDirectMP4: %v", err)
	}

	if gotUA != "TestUA/1.0" {
		t.Errorf("User-Agent = %q, want %q", gotUA, "TestUA/1.0")
	}
	if gotReferer != "https://chzzk.naver.com/" {
		t.Errorf("Referer = %q, want %q", gotReferer, "https://chzzk.naver.com/")
	}
	if gotCookie != "NID_AUT=a; NID_SES=b" {
		t.Errorf("Cookie = %q, want %q", gotCookie, "NID_AUT=a; NID_SES=b")
	}
}

// TestDownloadDirectMP4_Non200DeletesPartial 비정상 상태 코드 시 오류를 반환하고 부분 파일을 남기지 않아야 한다.
func TestDownloadDirectMP4_Non200DeletesPartial(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer srv.Close()

	out := filepath.Join(t.TempDir(), "out.mp4")
	if err := downloadDirectMP4(srv.URL, out, nil); err == nil {
		t.Fatal("downloadDirectMP4: 오류를 기대했지만 nil")
	}

	if _, err := os.Stat(out); !os.IsNotExist(err) {
		t.Errorf("실패 후 부분 파일이 남아 있음: %v", err)
	}
}

// TestComputeSpeedETA 0 나눗셈/미지 길이 경계를 안전하게 처리해야 한다.
func TestComputeSpeedETA(t *testing.T) {
	// 정상: 1MB를 1초에 받음 → 약 1.0 MB/s, 남은 1MB → 약 1초
	speed, eta := computeSpeedETA(1<<20, 2<<20, time.Second)
	if speed == "" {
		t.Error("정상 케이스에서 speed가 비어 있음")
	}
	if eta == "" {
		t.Error("정상 케이스에서 eta가 비어 있음")
	}

	// elapsed≈0: 0으로 나누지 않고 빈 문자열(또는 안전값) 반환, 패닉 없어야 함
	speed, eta = computeSpeedETA(1024, 2048, 0)
	if speed != "" || eta != "" {
		t.Logf("elapsed=0 → speed=%q eta=%q (패닉 없으면 허용)", speed, eta)
	}

	// total<=0(Content-Length 없음): eta 계산 불가 → 빈 ETA
	_, eta = computeSpeedETA(1024, 0, time.Second)
	if eta != "" {
		t.Errorf("total 미지일 때 eta는 비어야 함, got %q", eta)
	}
}

// itoa 테스트용 정수 → 문자열 (strconv 임포트 회피)
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}
