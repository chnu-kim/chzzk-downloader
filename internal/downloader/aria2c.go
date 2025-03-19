package downloader

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"chzzk-downloader/internal/config"
	"chzzk-downloader/internal/utils"
)

// DownloadWithAria2c aria2c를 사용한 다운로드 함수
func DownloadWithAria2c(options *DownloadOptions, downloadURL string, outputFile string) error {
	headers := config.GetCookieHeaders()
	cookieStr := headers["Cookie"]
	userAgentStr := headers["User-Agent"]
	refererStr := headers["Referer"]

	// 다운로드 인자 준비
	ariaArgs := speedOptionMapping[options.SpeedOption]
	if len(ariaArgs) == 0 {
		ariaArgs = speedOptionMapping["100%"]
	}

	// 추가 인자 설정
	ariaArgs = append(ariaArgs, "--file-allocation=none", "--console-log-level=debug", "--summary-interval=1")

	// 다운로드 파일의 총 크기 확인 (HEAD 요청)
	totalSize, err := getFileSize(downloadURL)
	if err != nil {
		fmt.Printf("[WARNING] 파일 크기를 가져올 수 없습니다: %v\n", err)
		// 파일 크기를 가져올 수 없어도 계속 진행
	} else {
		fmt.Printf("[INFO] 다운로드 파일 크기: %s\n", formatBytes(totalSize))
	}

	// 파일명만 추출
	_, filename := filepath.Split(outputFile)

	// aria2c 명령어 준비
	aria2cPath := config.GetAria2c()
	cmd := exec.Command(
		aria2cPath,
		append(ariaArgs,
			"-d", options.OutputFolder,
			"-o", filename)...,
	)

	// 헤더 추가
	if cookieStr != "" {
		cmd.Args = append(cmd.Args, "--header", fmt.Sprintf("Cookie: %s", cookieStr))
	}

	if userAgentStr != "" {
		cmd.Args = append(cmd.Args, "--header", fmt.Sprintf("User-Agent: %s", userAgentStr))
	}

	if refererStr != "" {
		cmd.Args = append(cmd.Args, "--header", fmt.Sprintf("Referer: %s", refererStr))
	}

	// URL 추가
	cmd.Args = append(cmd.Args, downloadURL)

	// 출력
	fmt.Println("\n[INFO] 치지직 VOD 전체 다운로드: aria2c 직접 다운로드")
	fmt.Printf("%s\n\n", strings.Join(cmd.Args, " "))

	// 이어받기 옵션이 있으면 추가
	if options.ResumeOption != "" {
		cmd.Args = append(cmd.Args, options.ResumeOption)
	}

	// 컨텍스트 생성 (취소 가능하도록)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 명령어 실행
	cmdWithContext := exec.CommandContext(ctx, cmd.Path, cmd.Args...)

	// 출력 파이프 연결
	stdoutPipe, err := cmdWithContext.StdoutPipe()
	if err != nil {
		return fmt.Errorf("aria2c stdout 파이프 연결 실패: %v", err)
	}

	stderrPipe, err := cmdWithContext.StderrPipe()
	if err != nil {
		return fmt.Errorf("aria2c stderr 파이프 연결 실패: %v", err)
	}

	// 명령어 시작
	if err := cmdWithContext.Start(); err != nil {
		return fmt.Errorf("aria2c 실행 실패: %v", err)
	}

	// 다운로드 상태 정보를 위한 구조체
	type downloadState struct {
		currentSize  int64     // 현재 다운로드된 바이트 수
		speed        string    // 다운로드 속도 (포맷팅된 문자열)
		eta          string    // 예상 완료 시간 (포맷팅된 문자열)
		lastUpdateAt time.Time // 마지막 화면 업데이트 시간
	}

	// 다운로드 상태 및 뮤텍스 초기화
	state := downloadState{
		currentSize:  0,
		lastUpdateAt: time.Now(),
	}
	var stateMutex sync.Mutex

	// 상태 업데이트 함수
	updateStatusDisplay := func() {
		stateMutex.Lock()
		defer stateMutex.Unlock()

		// 다운로드 상태 출력 (프로그레스바 대신 텍스트 정보)
		printDownloadStatus(state.currentSize, totalSize, state.speed, state.eta, "", "")

		// 업데이트 시간 갱신
		state.lastUpdateAt = time.Now()
	}

	// 초기 상태 출력
	fmt.Println("다운로드 진행 상황:")
	updateStatusDisplay()

	// 파일 크기를 정기적으로 확인하는 고루틴
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()

		lastSize := int64(0)
		lastSizeCheckTime := time.Now()

		for {
			select {
			case <-ticker.C:
				if totalSize > 0 {
					// 출력 파일이 있는지 확인
					fileStat, err := os.Stat(outputFile)
					if err == nil {
						currentSize := fileStat.Size()

						// 다운로드 속도 계산 (바이트/초)
						timeSinceLastCheck := time.Since(lastSizeCheckTime).Seconds()
						if timeSinceLastCheck > 0 && lastSize > 0 {
							bytesPerSecond := int64(float64(currentSize-lastSize) / timeSinceLastCheck)

							stateMutex.Lock()
							// 상태 업데이트
							if bytesPerSecond > 0 {
								state.speed = formatBytes(bytesPerSecond) + "/s"

								// 남은 시간 계산 (ETA)
								if totalSize > 0 {
									remainingBytes := totalSize - currentSize
									if remainingBytes > 0 {
										secondsRemaining := int(float64(remainingBytes) / float64(bytesPerSecond))
										state.eta = utils.SecondsToHms(secondsRemaining)
									}
								}
							}

							state.currentSize = currentSize
							stateMutex.Unlock()
						}

						lastSize = currentSize
						lastSizeCheckTime = time.Now()

						// 충분한 시간이 지났다면 화면 업데이트 (100ms마다)
						if time.Since(state.lastUpdateAt).Milliseconds() > 100 {
							updateStatusDisplay()
						}
					}
				}

				// 명령어가 완료되었는지 확인
				if cmdWithContext.ProcessState != nil && cmdWithContext.ProcessState.Exited() {
					return
				}
			}
		}
	}()

	// stdout 처리 고루틴
	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdoutPipe)
		for scanner.Scan() {
			line := scanner.Text()

			// aria2c 출력에서 다운로드 진행률 정보 파싱
			if strings.Contains(line, "%") || strings.Contains(line, "DL:") {
				parsedProgress, parsedSpeed, parsedEta := parseAria2cOutput(line)
				if parsedProgress > 0 || parsedSpeed != "" || parsedEta != "" {
					stateMutex.Lock()
					if parsedSpeed != "" {
						state.speed = parsedSpeed
					}
					if parsedEta != "" {
						state.eta = parsedEta
					}
					stateMutex.Unlock()

					// aria2c 출력으로부터 진행률 업데이트가 있으면 화면도 업데이트
					if time.Since(state.lastUpdateAt).Milliseconds() > 100 {
						updateStatusDisplay()
					}
				}
			}
		}
	}()

	// stderr 처리 고루틴
	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderrPipe)
		for scanner.Scan() {
			line := scanner.Text()

			// 에러나 경고 메시지는 별도 출력
			if strings.Contains(line, "Error") || strings.Contains(line, "Warning") {
				fmt.Printf("\n[ARIA2C] %s\n", line)
				// 오류 메시지 출력 후 상태 정보 다시 표시
				updateStatusDisplay()
			} else if strings.Contains(line, "%") || strings.Contains(line, "DL:") {
				// stderr에서도 다운로드 진행률 정보 파싱
				parsedProgress, parsedSpeed, parsedEta := parseAria2cOutput(line)
				if parsedProgress > 0 || parsedSpeed != "" || parsedEta != "" {
					stateMutex.Lock()
					if parsedSpeed != "" {
						state.speed = parsedSpeed
					}
					if parsedEta != "" {
						state.eta = parsedEta
					}
					stateMutex.Unlock()

					// 진행률 업데이트가 있으면 화면도 업데이트
					if time.Since(state.lastUpdateAt).Milliseconds() > 100 {
						updateStatusDisplay()
					}
				}
			}
		}
	}()

	// 명령어 완료 대기
	err = cmdWithContext.Wait()
	wg.Wait()

	// 최종 다운로드 정보 출력
	fmt.Println("\n완료!")

	if err != nil {
		return fmt.Errorf("aria2c 다운로드 실패: %v", err)
	}

	fmt.Println("[INFO] 치지직 VOD 다운로드 완료. 파일을 확인해주세요.\n")
	return nil
}
