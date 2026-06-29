package downloader

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"chzzk-downloader/internal/utils"
)

// downloadDirectMP4 완성된 단일 mp4(progressive) URL을 순수 Go HTTP로 받아 저장한다.
// chzzk의 PD_* BaseURL(클립·일반 VOD/DASH)은 영상+음성이 합쳐진 faststart mp4라
// ffmpeg `-c copy` 패스스루가 필요 없고 http.Get + io.Copy로 동일한 결과를 얻는다.
// 외부 바이너리·OS 분기 없이 동작한다.
func downloadDirectMP4(downloadURL, outputFile string, headers map[string]string) error {
	fmt.Println("\n[INFO] 순수 Go HTTP 직접 다운로드를 시작합니다.")

	req, err := http.NewRequest("GET", downloadURL, nil)
	if err != nil {
		return fmt.Errorf("요청 생성 실패: %v", err)
	}
	for k, v := range headers {
		if v != "" {
			req.Header.Set(k, v)
		}
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("다운로드 요청 실패: %v", err)
	}
	defer resp.Body.Close()

	// Range 헤더를 보내지 않으므로 정상 응답은 200이다(206은 방어적으로 허용).
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return fmt.Errorf("다운로드 실패: HTTP %d", resp.StatusCode)
	}

	out, err := os.Create(outputFile)
	if err != nil {
		return fmt.Errorf("출력 파일 생성 실패: %v", err)
	}

	pw := &progressWriter{total: resp.ContentLength, start: time.Now(), lastUpdate: time.Now()}
	fmt.Println("\n다운로드 진행 상황:")

	_, copyErr := io.Copy(io.MultiWriter(out, pw), resp.Body)

	// 부분 파일을 지우려면 핸들을 먼저 닫아야 한다(Windows는 열린 파일을 삭제할 수 없다).
	closeErr := out.Close()

	if copyErr != nil {
		os.Remove(outputFile)
		return fmt.Errorf("다운로드 중 오류: %v", copyErr)
	}
	if closeErr != nil {
		os.Remove(outputFile)
		return fmt.Errorf("파일 저장 실패: %v", closeErr)
	}

	pw.report() // 최종 진행률(100%) 출력
	fmt.Println("\n완료!")
	fmt.Println("[INFO] 다운로드 완료. 파일을 확인하세요.")
	return nil
}

// progressWriter io.Copy 경유 바이트 수를 세어 진행률(퍼센트·속도·ETA)을 텍스트로 표시한다.
type progressWriter struct {
	total      int64 // Content-Length (<=0이면 미지)
	written    int64
	start      time.Time
	lastUpdate time.Time
}

func (pw *progressWriter) Write(p []byte) (int, error) {
	n := len(p)
	pw.written += int64(n)

	now := time.Now()
	if now.Sub(pw.lastUpdate) >= 200*time.Millisecond {
		pw.report()
		pw.lastUpdate = now
	}
	return n, nil
}

// report 현재 진행 상황을 한 줄로 갱신 출력한다.
func (pw *progressWriter) report() {
	speed, eta := computeSpeedETA(pw.written, pw.total, time.Since(pw.start))
	printDownloadStatus(pw.written, pw.total, speed, eta, "", "")
}

// computeSpeedETA 누적 바이트·전체 크기·경과 시간으로 속도와 ETA 문자열을 만든다.
// 경계: elapsed≈0(첫 틱)·total<=0(Content-Length 미지)·speed=0은 빈 문자열로 안전 처리한다.
func computeSpeedETA(written, total int64, elapsed time.Duration) (speed string, eta string) {
	secs := elapsed.Seconds()
	if secs <= 0 || written <= 0 {
		return "", ""
	}

	bytesPerSec := float64(written) / secs
	speed = formatBytes(int64(bytesPerSec)) + "/s"

	// 전체 크기를 알고 아직 남았을 때만 ETA를 계산한다.
	if total > 0 && bytesPerSec > 0 && written < total {
		remainSecs := float64(total-written) / bytesPerSec
		eta = utils.SecondsToHms(int(remainSecs))
	}
	return speed, eta
}
