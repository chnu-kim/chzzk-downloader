package downloader

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"chzzk-downloader/internal/config"
	"chzzk-downloader/internal/utils"
)

// buildFFmpegArgs ffmpeg로 sourceURL을 받아 outputFile로 저장하는 인자 목록을 만든다.
// headers의 User-Agent는 -user_agent로, 나머지(Referer/Cookie 등)는 -headers로 전달한다.
// -headers 블록은 키를 정렬해 구성하므로 결과가 결정적이다(테스트 가능).
func buildFFmpegArgs(sourceURL, outputFile string, headers map[string]string) []string {
	var args []string

	if ua := headers["User-Agent"]; ua != "" {
		args = append(args, "-user_agent", ua)
	}

	keys := make([]string, 0, len(headers))
	for k := range headers {
		if k == "User-Agent" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)

	if len(keys) > 0 {
		var b strings.Builder
		for _, k := range keys {
			b.WriteString(k)
			b.WriteString(": ")
			b.WriteString(headers[k])
			b.WriteString("\r\n")
		}
		args = append(args, "-headers", b.String())
	}

	args = append(args,
		"-i", sourceURL,
		"-c", "copy",
		"-y",
		"-stats",
		"-progress", "pipe:2", // 진행 상황을 stderr로 출력
		"-loglevel", "info",
		outputFile,
	)
	return args
}

// redactedCmdString 로그 출력용 ffmpeg 명령 문자열을 만든다.
// -headers 블록 안의 Cookie 라인 값은 민감 정보(NID_AUT/NID_SES)이므로 마스킹한다.
func redactedCmdString(ffmpegPath string, args []string) string {
	redacted := make([]string, len(args))
	copy(redacted, args)
	for i := 0; i+1 < len(redacted); i++ {
		if redacted[i] == "-headers" {
			redacted[i+1] = cookieRedactRe.ReplaceAllString(redacted[i+1], "Cookie: [redacted]")
		}
	}
	return ffmpegPath + " " + strings.Join(redacted, " ")
}

// cookieRedactRe -headers 블록에서 Cookie 라인(다음 \r\n 또는 끝까지)을 매칭한다.
var cookieRedactRe = regexp.MustCompile(`Cookie: [^\r\n]*`)

// DownloadWithFFmpeg HLS(m3u8) 또는 DASH(BaseURL) 소스를 ffmpeg로 직접 받아 저장한다.
// 외부 streamlink 없이 ffmpeg 단일 프로세스로 다운로드하며, 진행률을 텍스트로 표시한다.
func DownloadWithFFmpeg(sourceURL string, outputFile string, headers map[string]string) error {
	fmt.Println("\n[INFO] ffmpeg로 다운로드를 시작합니다.")

	ffmpegPath := config.GetFFmpeg()
	args := buildFFmpegArgs(sourceURL, outputFile, headers)
	ffmpegCmd := exec.Command(ffmpegPath, args...)

	// Cookie 등 민감 헤더는 마스킹해 출력 (자격증명 노출 방지)
	fmt.Printf("ffmpeg CMD: %s\n\n", redactedCmdString(ffmpegPath, args))

	ffmpegStderr, err := ffmpegCmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("ffmpeg stderr pipe 생성 실패: %v", err)
	}

	if err := ffmpegCmd.Start(); err != nil {
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
				if ffmpegCmd.ProcessState != nil && ffmpegCmd.ProcessState.Exited() {
					return
				}
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
	err = ffmpegCmd.Wait()
	wg.Wait()

	if err != nil {
		return fmt.Errorf("ffmpeg 다운로드 실패: %v", err)
	}

	// 최종 다운로드 정보 출력
	fmt.Println("\n완료!")
	fmt.Println("[INFO] 다운로드 완료. 파일을 확인하세요.")

	return nil
}
