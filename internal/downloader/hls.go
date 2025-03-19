package downloader

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"chzzk-downloader/internal/config"
	"chzzk-downloader/internal/utils"
)

// DownloadHLS HLS 스트림 다운로드 함수 (streamlink + ffmpeg)
func DownloadHLS(hlsURL string, quality string, outputFile string) error {
	fmt.Println("\n[INFO] 치지직 빠른 다시보기 => streamlink+ffmpeg 전체 다운로드")

	// streamlink 명령어 준비
	streamlinkPath := config.GetStreamlink()
	streamlinkCmd := exec.Command(streamlinkPath, hlsURL, quality, "--stdout")

	fmt.Printf("streamlink CMD: %s\n", streamlinkCmd.String())

	// ffmpeg 명령어 준비 - 진행 정보 출력 강화
	ffmpegPath := config.GetFFmpeg()
	ffmpegCmd := exec.Command(
		ffmpegPath,
		"-i", "pipe:0",
		"-c", "copy",
		"-y",
		"-stats",
		"-progress", "pipe:2", // 진행 상황을 stderr로 출력
		"-loglevel", "info",
		outputFile)

	fmt.Printf("ffmpeg CMD: %s\n\n", ffmpegCmd.String())

	// 파이프 연결
	streamlinkStdout, err := streamlinkCmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("streamlink stdout pipe 생성 실패: %v", err)
	}

	streamlinkStderr, err := streamlinkCmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("streamlink stderr pipe 생성 실패: %v", err)
	}

	ffmpegStdin, err := ffmpegCmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("ffmpeg stdin pipe 생성 실패: %v", err)
	}

	ffmpegStderr, err := ffmpegCmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("ffmpeg stderr pipe 생성 실패: %v", err)
	}

	// 명령어 실행
	if err := streamlinkCmd.Start(); err != nil {
		return fmt.Errorf("streamlink 실행 실패: %v", err)
	}

	if err := ffmpegCmd.Start(); err != nil {
		streamlinkCmd.Process.Kill()
		return fmt.Errorf("ffmpeg 실행 실패: %v", err)
	}

	// 다운로드 상태 정보를 위한 구조체
	type downloadState struct {
		currentSize   int64
		bitrate       string
		currentTime   string
		totalTime     string
		duration      float64
		durationFound bool
		lastUpdateAt  time.Time
	}

	// 다운로드 상태 및 뮤텍스 초기화
	state := downloadState{
		currentSize:   0,
		currentTime:   "00:00:00",
		totalTime:     "알 수 없음",
		durationFound: false,
		lastUpdateAt:  time.Now(),
	}
	var stateMutex sync.Mutex

	// 상태 업데이트 함수
	updateStatusDisplay := func() {
		stateMutex.Lock()
		defer stateMutex.Unlock()

		// 다운로드 상태 출력 (텍스트 정보)
		printDownloadStatus(state.currentSize, 0, state.bitrate, "", state.currentTime, state.totalTime)

		// 업데이트 시간 갱신
		state.lastUpdateAt = time.Now()
	}

	// 출력 로그 처리
	var wg sync.WaitGroup

	// 파일 크기를 정기적으로 확인하는 고루틴
	wg.Add(1)
	go func() {
		defer wg.Done()
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				// 출력 파일이 있는지 확인
				fileStat, err := os.Stat(outputFile)
				if err == nil {
					stateMutex.Lock()
					state.currentSize = fileStat.Size()
					stateMutex.Unlock()
				}

				// 500ms마다 화면 강제 업데이트
				updateStatusDisplay()

				// 명령어가 완료되었는지 확인
				if ffmpegCmd.ProcessState != nil && ffmpegCmd.ProcessState.Exited() &&
					streamlinkCmd.ProcessState != nil && streamlinkCmd.ProcessState.Exited() {
					return
				}
			}
		}
	}()

	// streamlink stdout -> ffmpeg stdin 복사
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer ffmpegStdin.Close()
		io.Copy(ffmpegStdin, streamlinkStdout)
	}()

	// streamlink stderr 출력 (간략히 표시)
	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(streamlinkStderr)
		for scanner.Scan() {
			line := scanner.Text()
			// 중요 정보만 출력 (에러나 경고)
			if strings.Contains(line, "error") || strings.Contains(line, "warning") {
				fmt.Printf("\r[STREAMLINK] %s\n", line)
			}
		}
	}()

	// ffmpeg stderr 출력 및 다운로드 상태 표시
	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(ffmpegStderr)

		fmt.Println("\n다운로드 진행 상황:")
		// 초기 상태 출력 (정보 없음)
		updateStatusDisplay()

		for scanner.Scan() {
			line := scanner.Text()

			// Duration 정보 추출 (Duration: 01:23:45.67 형식)
			if !state.durationFound && strings.Contains(line, "Duration:") {
				durationRegex := regexp.MustCompile(`Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})`)
				if matches := durationRegex.FindStringSubmatch(line); len(matches) > 3 {
					h, _ := strconv.Atoi(matches[1])
					m, _ := strconv.Atoi(matches[2])
					s, _ := strconv.ParseFloat(matches[3], 64)

					stateMutex.Lock()
					state.duration = float64(h*3600+m*60) + s
					state.durationFound = true
					state.totalTime = utils.SecondsToHms(int(state.duration))
					stateMutex.Unlock()
				}
			}

			// 진행 상황 정보 추출 - 여러 형식 처리
			// 1. 정규식 향상: time=01:23:45.67 또는 time= 01:23:45.67 형식 모두 처리
			if timeMatch := regexp.MustCompile(`time=\s*(\d+:\d+:\d+\.\d+)`).FindStringSubmatch(line); len(timeMatch) > 1 {
				timeStr := timeMatch[1]

				// 시간 문자열 파싱
				timeParts := strings.Split(strings.Split(timeStr, ".")[0], ":")
				if len(timeParts) == 3 {
					h, _ := strconv.Atoi(timeParts[0])
					m, _ := strconv.Atoi(timeParts[1])
					s, _ := strconv.Atoi(timeParts[2])

					stateMutex.Lock()
					state.currentTime = fmt.Sprintf("%02d:%02d:%02d", h, m, s)
					stateMutex.Unlock()
				}
			}

			// 2. out_time_ms=12345 형식도 처리 (ffmpeg -progress 출력)
			if strings.HasPrefix(line, "out_time_ms=") {
				timeMs := strings.TrimPrefix(line, "out_time_ms=")
				ms, err := strconv.ParseFloat(timeMs, 64)
				if err == nil {
					secs := ms / 1000000.0 // ms를 초로 변환
					h := int(secs) / 3600
					m := (int(secs) % 3600) / 60
					s := int(secs) % 60

					stateMutex.Lock()
					state.currentTime = fmt.Sprintf("%02d:%02d:%02d", h, m, s)
					stateMutex.Unlock()
				}
			}

			// 3. out_time=00:00:00.000000 형식도 처리 (ffmpeg -progress 출력)
			if strings.HasPrefix(line, "out_time=") {
				timeStr := strings.TrimPrefix(line, "out_time=")
				timeParts := strings.Split(strings.Split(timeStr, ".")[0], ":")
				if len(timeParts) == 3 {
					h, _ := strconv.Atoi(timeParts[0])
					m, _ := strconv.Atoi(timeParts[1])
					s, _ := strconv.Atoi(timeParts[2])

					stateMutex.Lock()
					state.currentTime = fmt.Sprintf("%02d:%02d:%02d", h, m, s)
					stateMutex.Unlock()
				}
			}

			// 파일 크기 정보 추출 (size=   10240kB 형식)
			if sizeMatch := regexp.MustCompile(`size=\s*(\d+)kB`).FindStringSubmatch(line); len(sizeMatch) > 1 {
				if kb, err := strconv.ParseInt(sizeMatch[1], 10, 64); err == nil {
					stateMutex.Lock()
					state.currentSize = kb * 1024 // KB를 바이트로 변환
					stateMutex.Unlock()
				}
			}

			// 비트레이트 정보 추출 (bitrate= 2097.2kbits/s 형식)
			if bitrateMatch := regexp.MustCompile(`bitrate=\s*([0-9.]+kbits/s)`).FindStringSubmatch(line); len(bitrateMatch) > 1 {
				stateMutex.Lock()
				state.bitrate = bitrateMatch[1]
				stateMutex.Unlock()
			}

			// 중요 오류나 경고 메시지는 별도 라인에 표시
			if (strings.Contains(line, "Error") || strings.Contains(line, "Warning")) &&
				!strings.Contains(line, "frame=") {
				fmt.Printf("\n%s\n[FFMPEG] %s\n", strings.Repeat(" ", 100), line)
			}
		}
	}()

	// 명령어 종료 대기
	ffmpegCmd.Wait()
	streamlinkCmd.Wait()
	wg.Wait()

	// 최종 다운로드 정보 출력
	fmt.Println("\n완료!")

	fmt.Println("[INFO] 치지직 빠른 다시보기 다운로드 완료. 파일을 확인하세요.\n")

	return nil
}
