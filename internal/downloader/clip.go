package downloader

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"chzzk-downloader/internal/api"
	"chzzk-downloader/internal/config"
)

// DownloadClip 클립 다운로드 함수
// 클립은 MPD의 PD(Progressive Download) representation이 완성된 단일 mp4를 제공하므로
// streamlink/HLS 없이 ffmpeg로 직접 받아 저장한다(현재 다시보기 저장과 동일한 ffmpeg 흐름).
func DownloadClip(clipURL, quality, outputFolder, autoFilename string) error {
	options := &DownloadOptions{
		VodURL:       clipURL,
		Quality:      quality,
		OutputFolder: outputFolder,
		Filename:     autoFilename,
	}

	outputFile, err := PrepareOutputPath(options)
	if err != nil {
		return err
	}

	if !CheckDuplicateFileDirect(outputFile) {
		return nil
	}

	// 서명된 다운로드 URL은 만료되므로 다운로드 직전에 새로 가져온다(저장/캐시 금지).
	downloadURL, err := api.GetClipDownloadURL(clipURL, quality)
	if err != nil {
		return err
	}

	return downloadDirectMP4(downloadURL, outputFile)
}

// downloadDirectMP4 직접 다운로드 가능한 단일 mp4 URL을 ffmpeg로 받아 저장하는 함수
func downloadDirectMP4(downloadURL, outputFile string) error {
	fmt.Println("\n[INFO] 치지직 클립 => ffmpeg 직접 다운로드")

	ffmpegPath := config.GetFFmpeg()
	ffmpegCmd := exec.Command(
		ffmpegPath,
		"-user_agent", config.GetCookieHeaders()["User-Agent"],
		"-headers", "Referer: https://chzzk.naver.com/\r\n",
		"-i", downloadURL,
		"-c", "copy",
		"-y",
		"-progress", "pipe:2",
		"-loglevel", "info",
		outputFile)

	fmt.Printf("ffmpeg CMD: %s\n\n", ffmpegCmd.String())

	ffmpegStderr, err := ffmpegCmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("ffmpeg stderr pipe 생성 실패: %v", err)
	}

	if err := ffmpegCmd.Start(); err != nil {
		return fmt.Errorf("ffmpeg 실행 실패: %v", err)
	}

	var currentSize int64
	var currentTime = "00:00:00"
	var stateMutex sync.Mutex
	var wg sync.WaitGroup

	// 파일 크기 주기적 갱신
	wg.Add(1)
	go func() {
		defer wg.Done()
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		for range ticker.C {
			if fileStat, err := os.Stat(outputFile); err == nil {
				stateMutex.Lock()
				currentSize = fileStat.Size()
				size, ct := currentSize, currentTime
				stateMutex.Unlock()
				printDownloadStatus(size, 0, "", "", ct, "")
			}
			if ffmpegCmd.ProcessState != nil && ffmpegCmd.ProcessState.Exited() {
				return
			}
		}
	}()

	// ffmpeg 진행 정보 파싱
	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(ffmpegStderr)
		fmt.Println("\n다운로드 진행 상황:")
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "out_time=") {
				timeStr := strings.TrimPrefix(line, "out_time=")
				timeParts := strings.Split(strings.Split(timeStr, ".")[0], ":")
				if len(timeParts) == 3 {
					h, _ := strconv.Atoi(timeParts[0])
					m, _ := strconv.Atoi(timeParts[1])
					s, _ := strconv.Atoi(timeParts[2])
					stateMutex.Lock()
					currentTime = fmt.Sprintf("%02d:%02d:%02d", h, m, s)
					stateMutex.Unlock()
				}
			}
			if (strings.Contains(line, "Error") || strings.Contains(line, "error")) &&
				!strings.HasPrefix(line, "frame=") {
				fmt.Printf("\n[FFMPEG] %s\n", line)
			}
		}
	}()

	waitErr := ffmpegCmd.Wait()
	wg.Wait()

	if waitErr != nil {
		return fmt.Errorf("ffmpeg 다운로드 실패: %v", waitErr)
	}

	fmt.Println("\n완료!")
	fmt.Print("[INFO] 치지직 클립 다운로드 완료. 파일을 확인하세요.\n\n")
	return nil
}
