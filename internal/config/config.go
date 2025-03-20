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
	CookieFileName   = "cookie.json"
	UserSettingsFile = "settings.json"
)

// RecentVodInfo 최근 VOD 정보를 저장하는 구조체
type RecentVodInfo struct {
	URL   string `json:"url"`
	Title string `json:"title"`
}

// UserSettings 사용자 설정을 저장하는 구조체
type UserSettings struct {
	DownloadFolder  string          `json:"downloadFolder"`
	IsAdultContent  bool            `json:"isAdultContent"`
	NidAut          string          `json:"nidAut"`
	NidSes          string          `json:"nidSes"`
	LastQualityName string          `json:"lastQualityName"`
	LastVodURL      string          `json:"lastVodURL"`    // 마지막으로 다운로드한 VOD URL
	RecentVodURLs   []string        `json:"recentVodURLs"` // 하위 호환성을 위해 유지
	RecentVods      []RecentVodInfo `json:"recentVods"`    // 최근 다운로드한 VOD 정보 목록 (URL과 제목)
}

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

// AddRecentVod 최근 VOD 목록에 VOD 정보를 추가하는 함수
func AddRecentVod(settings *UserSettings, url string, title string) {
	// 짧은 제목으로 처리 (너무 길면 자르기)
	shortTitle := title
	if len(shortTitle) >
		50 {
		shortTitle = shortTitle[:47] + "..."
	}

	// 새 VOD 정보 생성
	newVod := RecentVodInfo{
		URL:   url,
		Title: shortTitle,
	}

	// 기존 목록에서 동일한 URL 제거
	var newList []RecentVodInfo
	for _, item := range settings.RecentVods {
		if item.URL != url {
			newList = append(newList, item)
		}
	}

	// 새 VOD 정보를 맨 앞에 추가
	newList = append([]RecentVodInfo{newVod}, newList...)

	// 최대 5개로 제한
	if len(newList) > 5 {
		newList = newList[:5]
	}

	settings.RecentVods = newList
	settings.LastVodURL = url

	// 하위 호환성 유지: URL만 있는 배열도 업데이트
	var urls []string
	for _, vod := range newList {
		urls = append(urls, vod.URL)
	}
	settings.RecentVodURLs = urls
}

// AddRecentURL 최근 URL 목록에 URL을 추가하는 함수 (하위 호환성용)
func AddRecentURL(settings *UserSettings, url string) {
	// 기존 목록에서 동일한 URL 제거
	var newList []string
	for _, item := range settings.RecentVodURLs {
		if item != url {
			newList = append(newList, item)
		}
	}

	// 새 URL을 맨 앞에 추가
	newList = append([]string{url}, newList...)

	// 최대 5개로 제한
	if len(newList) > 5 {
		newList = newList[:5]
	}

	settings.RecentVodURLs = newList
	settings.LastVodURL = url
}

// LoadUserSettings 사용자 설정을 로드하는 함수
func LoadUserSettings() (UserSettings, error) {
	settingsFile := filepath.Join(GetBaseDir(), UserSettingsFile)
	settings := UserSettings{
		DownloadFolder: filepath.Join(GetBaseDir(), "downloads"), // 기본값 설정
	}

	data, err := os.ReadFile(settingsFile)
	if err != nil {
		if os.IsNotExist(err) {
			// 파일이 없으면 기본 설정 반환
			return settings, nil
		}
		return settings, err
	}

	if err := json.Unmarshal(data, &settings); err != nil {
		return settings, err
	}

	// 하위 호환성 처리: 이전 버전에서 RecentVods가 없고 RecentVodURLs만 있는 경우
	if len(settings.RecentVods) == 0 && len(settings.RecentVodURLs) > 0 {
		for _, url := range settings.RecentVodURLs {
			settings.RecentVods = append(settings.RecentVods, RecentVodInfo{
				URL:   url,
				Title: "제목 없음", // 이전 데이터에는 제목 정보가 없음
			})
		}
	}

	return settings, nil
}

// SaveUserSettings 사용자 설정을 저장하는 함수
func SaveUserSettings(settings UserSettings) error {
	settingsFile := filepath.Join(GetBaseDir(), UserSettingsFile)

	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(settingsFile, data, 0644)
}

// UpdateUserSettings 사용자 설정의 특정 필드만 업데이트하는 함수
func UpdateUserSettings(updateFn func(*UserSettings)) error {
	settings, err := LoadUserSettings()
	if err != nil {
		return err
	}

	updateFn(&settings)

	return SaveUserSettings(settings)
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

	// 설정 파일에도 저장
	err := UpdateUserSettings(func(s *UserSettings) {
		s.IsAdultContent = true
		s.NidAut = nidAut
		s.NidSes = nidSes
	})
	if err != nil {
		return err
	}

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
