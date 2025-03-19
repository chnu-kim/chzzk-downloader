package utils

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// SanitizeFilename 파일명을 안전하게 처리하는 함수
func SanitizeFilename(filename string) string {
	// 확장자 분리
	baseName := filename
	extension := ""
	if strings.Contains(filename, ".") && !strings.HasSuffix(filename, ".") {
		parts := strings.Split(filename, ".")
		baseName = strings.Join(parts[:len(parts)-1], ".")
		extension = "." + parts[len(parts)-1]
	}

	// 공백 문자 정규화
	baseName = strings.ReplaceAll(baseName, "\u3000", " ")
	baseName = strings.ReplaceAll(baseName, "\u00a0", " ")

	// 개행, 탭 제거
	baseName = regexp.MustCompile(`[\r\n\t]+`).ReplaceAllString(baseName, "")

	// 금지된 문자 제거
	baseName = regexp.MustCompile(`[\\/:*?"<>|(){}\[\]]`).ReplaceAllString(baseName, "_")

	// 앞뒤 공백 제거
	baseName = strings.TrimSpace(baseName)

	// 빈 파일명 처리
	if baseName == "" {
		baseName = "_"
	}

	// 확장자 붙이기
	return baseName + extension
}

// FormatLiveDate 라이브 날짜를 포맷팅하는 함수
func FormatLiveDate(liveOpenDateRaw string) (string, string) {
	if liveOpenDateRaw == "" {
		return "", ""
	}

	datePart := liveOpenDateRaw
	timePart := "00:00:00"

	parts := strings.Split(liveOpenDateRaw, " ")
	if len(parts) >= 2 {
		datePart = parts[0]
		timePart = parts[1]
	}

	dateElements := strings.Split(datePart, "-")
	if len(dateElements) != 3 {
		return "", ""
	}

	y, m, d := dateElements[0], dateElements[1], dateElements[2]
	timeElements := strings.Split(timePart, ":")
	if len(timeElements) != 3 {
		timeElements = []string{"00", "00", "00"}
	}
	hh, mm, ss := timeElements[0], timeElements[1], timeElements[2]

	recordingTime := y[2:] + m + d + "_" + hh + mm + ss
	startTime := datePart

	return recordingTime, startTime
}

// ValidateTimeRange 시간 범위 형식이 올바른지 검증하는 함수
func ValidateTimeRange(timeRange string) (bool, error) {
	pattern := `^(\d{2}):(\d{2}):(\d{2})~(\d{2}):(\d{2}):(\d{2})$`
	matched, err := regexp.MatchString(pattern, timeRange)
	return matched, err
}

// HmsToSeconds 시:분:초 형식을 초 단위로 변환하는 함수
func HmsToSeconds(hms string) int {
	parts := strings.Split(hms, ":")
	if len(parts) != 3 {
		return 0
	}

	h, _ := strconv.Atoi(parts[0])
	m, _ := strconv.Atoi(parts[1])
	s, _ := strconv.Atoi(parts[2])

	return h*3600 + m*60 + s
}

// IsDigit 문자열이 숫자로만 이루어져 있는지 확인하는 함수
func IsDigit(s string) bool {
	for _, c := range s {
		if !unicode.IsDigit(c) {
			return false
		}
	}
	return true
}

// SecondsToHms 초를 시:분:초 형식으로 변환하는 함수
func SecondsToHms(seconds int) string {
	h := seconds / 3600
	m := (seconds % 3600) / 60
	s := seconds % 60
	return fmt.Sprintf("%02d:%02d:%02d", h, m, s)
}
