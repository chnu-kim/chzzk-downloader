package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// 설정 관련 상수
const (
	CookieFileName = "cookie.json"
)

// GetBaseDir 현재 실행 파일의 디렉토리 경로를 반환
func GetBaseDir() string {
	exePath, err := os.Executable()
	if err != nil {
		// 오류가 발생하면 현재 작업 디렉토리를 사용
		wd, _ := os.Getwd()
		return wd
	}
	return filepath.Dir(exePath)
}

// GetDependentDir 의존성 파일들이 있는 디렉토리 경로를 반환
func GetDependentDir() string {
	return filepath.Join(GetBaseDir(), "dependent")
}

// 의존성 파일들 경로 반환 함수들
func GetFFmpeg() string {
	if runtime.GOOS == "windows" {
		return filepath.Join(GetDependentDir(), "ffmpeg", "bin", "ffmpeg.exe")
	}
	return filepath.Join(GetDependentDir(), "ffmpeg", "bin", "ffmpeg")
}

func GetStreamlink() string {
	if runtime.GOOS == "windows" {
		return filepath.Join(GetDependentDir(), "streamlink", "bin", "streamlink.exe")
	}
	return filepath.Join(GetDependentDir(), "streamlink", "bin", "streamlink")
}

// LoadCookies 쿠키 파일을 로드하는 함수
func LoadCookies() map[string]string {
	cookieFile := filepath.Join(GetDependentDir(), CookieFileName)
	cookies := make(map[string]string)

	data, err := os.ReadFile(cookieFile)
	if err != nil {
		return cookies
	}

	if err := json.Unmarshal(data, &cookies); err != nil {
		return cookies
	}

	return cookies
}

// SaveCookies 쿠키 파일을 저장하는 함수
func SaveCookies(cookies map[string]string) error {
	cookieFile := filepath.Join(GetDependentDir(), CookieFileName)

	// dependent 디렉토리가 없으면 생성
	if err := os.MkdirAll(GetDependentDir(), 0755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(cookies, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(cookieFile, data, 0644)
}

// SetAdultCookies 성인 인증 쿠키를 설정하는 함수
func SetAdultCookies(nidAut, nidSes string) error {
	// 기존 쿠키 로드
	cookies := LoadCookies()

	// 성인 인증 쿠키 설정
	cookies["NID_AUT"] = nidAut
	cookies["NID_SES"] = nidSes

	// 쿠키 저장
	return SaveCookies(cookies)
}

// GetCookieHeaders 치지직 API 호출용 헤더를 생성하는 함수
func GetCookieHeaders() map[string]string {
	userAgent := ""
	if runtime.GOOS == "windows" {
		userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36"
	} else {
		userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36"
	}

	headers := map[string]string{
		"User-Agent": userAgent,
		"Referer":    "https://chzzk.naver.com/",
		"Accept":     "application/json, */*",
		"Origin":     "https://chzzk.naver.com",
	}

	cookies := LoadCookies()
	if len(cookies) > 0 {
		cookieStrParts := make([]string, 0, len(cookies))
		for k, v := range cookies {
			cookieStrParts = append(cookieStrParts, k+"="+v)
		}
		headers["Cookie"] = strings.Join(cookieStrParts, "; ")
	}

	return headers
}
