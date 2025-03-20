package downloader

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"chzzk-downloader/internal/utils"
)

// 바이트 크기를 사람이 읽기 쉬운 형식으로 변환
func formatBytes(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}

// 다운로드 상태 텍스트 출력 함수 (프로그레스바 대체)
func printDownloadStatus(currentBytes int64, totalBytes int64, speed string, eta string, currentTime string, totalTime string) {
	// 이전 출력을 지울 공백 문자열 생성
	clearStr := strings.Repeat(" ", 100)

	// 기본 상태 정보 구성
	var statusText string

	// 바이트 크기 정보
	if totalBytes > 0 {
		statusText = fmt.Sprintf("다운로드: %s / %s (%.1f%%)",
			formatBytes(currentBytes),
			formatBytes(totalBytes),
			float64(currentBytes)/float64(totalBytes)*100)
	} else {
		statusText = fmt.Sprintf("다운로드: %s", formatBytes(currentBytes))
	}

	// 속도 정보 추가
	if speed != "" {
		statusText += fmt.Sprintf(" | 속도: %s", speed)
	}

	// 남은 시간 정보 추가
	if eta != "" {
		statusText += fmt.Sprintf(" | 남은 시간: %s", eta)
	}

	// 동영상 시간 정보 추가 (ffmpeg 및 hls 다운로드용)
	if currentTime != "" {
		statusText += fmt.Sprintf(" | 진행: %s", currentTime)
	}

	// 이전 출력을 지우고 상태 출력
	fmt.Printf("\r%s\r%s", clearStr, statusText)
}

// ffmpeg 출력 파싱 함수
func parseFFmpegOutput(line string) (progress float64, timeInfo string) {
	// 예시: frame= 1000 fps=25 q=-1.0 size=   10240kB time=00:00:40.00 bitrate=2097.2kbits/s speed=1x

	// 시간 정보 추출 (00:00:40.00 등)
	timeRegex := regexp.MustCompile(`time=(\d+:\d+:\d+\.\d+)`)
	if matches := timeRegex.FindStringSubmatch(line); len(matches) > 1 {
		timeInfo = matches[1]

		// 진행률 계산을 위한 정보가 있다면 진행률도 계산
		// (이 부분은 총 길이를 알아야 가능하므로 일반적으로는 제한적)
	}

	return
}

// CheckDuplicateFile 중복 파일 처리 함수
func CheckDuplicateFile(outputFile string) (bool, string) {
	if _, err := os.Stat(outputFile); err == nil {
		fmt.Printf("파일 '%s'이(가) 이미 존재합니다.\n", outputFile)

		scanner := bufio.NewScanner(os.Stdin)
		for {
			fmt.Println("어떻게 하시겠습니까?")
			fmt.Println("1. 중복파일 덮어쓰기")
			fmt.Println("2. 해당파일 이어받기")
			fmt.Println("3. 해당파일 건너뛰기")
			fmt.Print("번호를 선택하세요 (1/2/3): ")

			scanner.Scan()
			ans := strings.TrimSpace(scanner.Text())

			if ans == "3" {
				fmt.Println("완성된 파일이 있으므로 건너뜁니다.")
				return false, ""
			} else if ans == "1" {
				err := os.Remove(outputFile)
				if err != nil {
					fmt.Printf("파일 삭제 실패: %v\n", err)
					return false, ""
				}
				fmt.Println("기존 파일을 삭제하고 재다운로드합니다.")
				return true, ""
			} else if ans == "2" {
				fmt.Println("이어받기를 시도합니다.")
				return true, "--continue"
			} else {
				fmt.Println("잘못된 입력입니다. 1, 2, 또는 3을 입력해주세요.")
			}
		}
	}
	return true, ""
}

// PrepareOutputPath 출력 경로 및 파일명 준비
func PrepareOutputPath(options *DownloadOptions) (string, error) {
	autoFilename := options.Filename

	// 파일 확장자 포맷 보정
	if strings.HasSuffix(strings.ToLower(autoFilename), "__mp4") {
		autoFilename = strings.Replace(autoFilename, "__mp4", ".mp4", -1)
	} else if !strings.HasSuffix(strings.ToLower(autoFilename), ".mp4") {
		autoFilename = autoFilename + ".mp4"
	}

	// 경로 구분자 통일
	outputFolder := filepath.Clean(options.OutputFolder)
	outputFile := filepath.Join(outputFolder, utils.SanitizeFilename(autoFilename))

	return outputFile, nil
}
