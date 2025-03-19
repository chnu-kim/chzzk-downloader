package downloader

import (
	"bufio"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"sync"

	"chzzk-downloader/internal/config"
	"chzzk-downloader/internal/utils"
)

// DownloadWithFFmpeg FFmpeg를 사용한 구간 다운로드 함수
func DownloadWithFFmpeg(downloadURL string, outputFile string, startSection string, endSection string) error {
	startSeconds := utils.HmsToSeconds(startSection)
	endSeconds := utils.HmsToSeconds(endSection)

	if endSeconds <= startSeconds {
		return fmt.Errorf("구간 다운로드: 종료 시간이 시작 시간보다 작거나 같습니다")
	}

	duration := endSeconds - startSeconds

	// ffmpeg 명령어 준비
	ffmpegPath := config.GetFFmpeg()
	cmd := exec.Command(
		ffmpegPath,
		"-ss", startSection,
		"-i", downloadURL,
		"-t", fmt.Sprintf("%d", duration),
		"-c", "copy",
		"-y", outputFile,
		"-progress", "pipe:1", // 진행 상황을 stdout으로 출력
	)

	// 출력 호출
	fmt.Println("\n[INFO] 치지직 VOD 구간 다운로드: ffmpeg 직접 다운로드")
	fmt.Printf("%s\n\n", cmd.String())

	// stdout 파이프 연결
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("ffmpeg stdout 파이프 연결 실패: %v", err)
	}

	// stderr 파이프 연결 (에러 메시지 확인용)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("ffmpeg stderr 파이프 연결 실패: %v", err)
	}

	// 명령어 시작
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("ffmpeg 실행 실패: %v", err)
	}

	totalDuration := float64(duration)

	// stdout 파싱을 위한 고루틴
	var wg sync.WaitGroup
	wg.Add(2)

	// stdout 읽기 (진행 상황)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdout)
		var currentTime float64
		var lastTimeStr string

		fmt.Println("다운로드 진행 상황:")
		// 초기 상태 출력
		printDownloadStatus(0, 0, "", "", "00:00:00", utils.SecondsToHms(int(totalDuration)))

		for scanner.Scan() {
			line := scanner.Text()

			// out_time_ms=12345 형식의 줄 파싱
			if strings.HasPrefix(line, "out_time_ms=") {
				timeMs := strings.TrimPrefix(line, "out_time_ms=")
				ms, err := strconv.ParseFloat(timeMs, 64)
				if err == nil {
					currentTime = ms / 1000000.0 // ms를 초로 변환

					// 현재 시간/총 시간 형식으로 정보 추가
					currentTimeStr := utils.SecondsToHms(int(currentTime))
					totalTimeStr := utils.SecondsToHms(int(totalDuration))
					timeStr := fmt.Sprintf("%s / %s", currentTimeStr, totalTimeStr)

					// 표시할 정보가 변경된 경우에만 업데이트
					if timeStr != lastTimeStr {
						lastTimeStr = timeStr

						// 바이트 정보 없이 시간 정보만 출력
						printDownloadStatus(0, 0, "", "", currentTimeStr, totalTimeStr)
					}
				}
			}
		}
	}()

	// stderr 읽기 (로그 메시지)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()
			// ffmpeg 통계 정보가 아닌 중요 메시지만 출력
			if !strings.Contains(line, "frame=") && !strings.Contains(line, "size=") {
				fmt.Printf("\n[FFMPEG] %s", line)
			}
		}
	}()

	// 명령어 완료 대기
	err = cmd.Wait()
	wg.Wait()

	// 최종 다운로드 정보 출력
	currentTimeStr := utils.SecondsToHms(int(totalDuration))
	totalTimeStr := utils.SecondsToHms(int(totalDuration))
	printDownloadStatus(0, 0, "", "", currentTimeStr, totalTimeStr)
	fmt.Println("\n완료!")

	if err != nil {
		return fmt.Errorf("ffmpeg 실행 실패: %v", err)
	}

	fmt.Println("[INFO] 치지직 VOD 구간 다운로드 완료. 파일을 확인해주세요.\n")
	return nil
}
