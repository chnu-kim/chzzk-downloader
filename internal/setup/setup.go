package setup

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"chzzk-downloader/internal/config"
)

// 다운로드할 의존성 정보 구조체
type Dependency struct {
	Name         string
	URL          string
	DesiredName  string
	IsExecutable bool
}

// 다운로드 의존성 목록
var dependencies = []Dependency{
	{
		Name:         "ffmpeg",
		URL:          "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
		DesiredName:  "ffmpeg",
		IsExecutable: false,
	},
	{
		Name:         "streamlink",
		URL:          "https://github.com/streamlink/windows-builds/releases/download/7.1.2-2/streamlink-7.1.2-2-py312-x86_64.zip",
		DesiredName:  "streamlink",
		IsExecutable: false,
	},
	{
		Name:         "aria2c",
		URL:          "https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip",
		DesiredName:  "aria2c",
		IsExecutable: false,
	},
	{
		Name:         "yt-dlp",
		URL:          "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
		DesiredName:  "yt-dlp",
		IsExecutable: true,
	},
}

// DownloadFile URL에서 파일을 다운로드하는 함수
func DownloadFile(url, destPath string) error {
	// HTTP 요청 준비
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}

	// 다운로드 시작
	fmt.Printf("다운로드 시작: %s\n", url)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("다운로드 실패: HTTP %d", resp.StatusCode)
	}

	// 파일 생성
	os.MkdirAll(filepath.Dir(destPath), 0755)
	out, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer out.Close()

	// 파일 쓰기
	_, err = io.Copy(out, resp.Body)
	if err != nil {
		return err
	}

	fmt.Printf("다운로드 완료: %s\n\n", destPath)
	return nil
}

// ExtractZip 압축 파일을 지정된 경로에 해제하는 함수
func ExtractZip(zipPath, extractDir string) (string, error) {
	// 압축 파일 열기
	reader, err := zip.OpenReader(zipPath)
	if err != nil {
		return "", err
	}
	defer reader.Close()

	// 임시 추출 디렉토리 생성
	tempExtractDir := extractDir + "_temp"
	os.RemoveAll(tempExtractDir)
	os.MkdirAll(tempExtractDir, 0755)

	fmt.Printf("압축 해제 중: %s -> %s\n", zipPath, tempExtractDir)

	// 최상위 디렉토리 추출
	var topDirs []string
	for _, file := range reader.File {
		if strings.Contains(file.Name, "/") {
			dir := strings.Split(file.Name, "/")[0]
			if dir != "" && !contains(topDirs, dir) {
				topDirs = append(topDirs, dir)
			}
		}
	}

	// 압축 해제
	for _, file := range reader.File {
		path := filepath.Join(tempExtractDir, file.Name)

		// 디렉토리 생성
		if file.FileInfo().IsDir() {
			os.MkdirAll(path, file.Mode())
			continue
		}

		// 파일 생성 전 디렉토리 확인
		os.MkdirAll(filepath.Dir(path), 0755)

		// 파일 생성
		outFile, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, file.Mode())
		if err != nil {
			return "", err
		}

		// 파일 내용 복사
		inFile, err := file.Open()
		if err != nil {
			outFile.Close()
			return "", err
		}

		_, err = io.Copy(outFile, inFile)
		outFile.Close()
		inFile.Close()
		if err != nil {
			return "", err
		}
	}

	// 최상위 디렉토리 반환
	if len(topDirs) > 0 {
		return filepath.Join(tempExtractDir, topDirs[0]), nil
	}

	return tempExtractDir, nil
}

// contains 배열에 특정 값이 포함되어 있는지 확인하는 함수
func contains(arr []string, val string) bool {
	for _, item := range arr {
		if item == val {
			return true
		}
	}
	return false
}

// MoveDir 디렉토리를 이동하는 함수
func MoveDir(src, dst string) error {
	// 대상 디렉토리 제거
	os.RemoveAll(dst)

	// 부모 디렉토리 생성
	os.MkdirAll(filepath.Dir(dst), 0755)

	// 이동
	return os.Rename(src, dst)
}

// EnsureDirectory 디렉토리가 존재하는지 확인하고 없으면 생성하는 함수
func EnsureDirectory(path string) error {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		err := os.MkdirAll(path, 0755)
		if err != nil {
			return err
		}
		fmt.Printf("디렉토리 생성: %s\n", path)
	} else {
		fmt.Printf("디렉토리 존재: %s\n", path)
	}
	return nil
}

// CheckDependencies 의존성이 설치되어 있는지 확인하는 함수
func CheckDependencies() bool {
	dependentDir := config.GetDependentDir()

	// 의존성 디렉토리 확인
	if _, err := os.Stat(dependentDir); os.IsNotExist(err) {
		return false
	}

	// 필요한 의존성 파일 경로들
	paths := []string{
		config.GetFFmpeg(),
		config.GetAria2c(),
		config.GetStreamlink(),
	}

	// 모든 의존성 파일 존재 여부 확인
	for _, path := range paths {
		if _, err := os.Stat(path); os.IsNotExist(err) {
			return false
		}
	}

	return true
}

// InstallDependencies 의존성을 설치하는 함수
func InstallDependencies() error {
	baseDir := config.GetBaseDir()
	dependentDir := config.GetDependentDir()

	// 기본 디렉토리 확인
	if err := EnsureDirectory(dependentDir); err != nil {
		return err
	}

	// 각 의존성 다운로드 및 설치
	for _, dep := range dependencies {
		fmt.Printf("==== %s 설치 시작 ====\n", dep.Name)

		// 실행 파일인 경우
		if dep.IsExecutable {
			tmpExePath := filepath.Join(baseDir, dep.Name+".exe")

			// 다운로드
			if err := DownloadFile(dep.URL, tmpExePath); err != nil {
				fmt.Printf("%s 다운로드 중 오류 발생: %v\n", dep.Name, err)
				continue
			}

			// 디렉토리 생성
			finalDir := filepath.Join(dependentDir, dep.DesiredName)
			if err := EnsureDirectory(finalDir); err != nil {
				os.Remove(tmpExePath)
				fmt.Printf("%s 디렉토리 생성 중 오류 발생: %v\n", dep.Name, err)
				continue
			}

			// 파일 이동
			finalExePath := filepath.Join(finalDir, filepath.Base(tmpExePath))
			if _, err := os.Stat(finalExePath); err == nil {
				os.Remove(finalExePath)
			}

			if err := os.Rename(tmpExePath, finalExePath); err != nil {
				os.Remove(tmpExePath)
				fmt.Printf("%s 파일 이동 중 오류 발생: %v\n", dep.Name, err)
				continue
			}

			fmt.Printf("%s 파일 이동 완료: %s\n", dep.Name, finalExePath)

		} else {
			// ZIP 파일인 경우
			tmpZipPath := filepath.Join(baseDir, dep.Name+".zip")

			// 다운로드
			if err := DownloadFile(dep.URL, tmpZipPath); err != nil {
				fmt.Printf("%s 다운로드 중 오류 발생: %v\n", dep.Name, err)
				continue
			}

			// 압축 해제
			extractedPath, err := ExtractZip(tmpZipPath, filepath.Join(baseDir, "temp_extract_"+dep.Name))
			if err != nil {
				os.Remove(tmpZipPath)
				fmt.Printf("%s 압축 해제 중 오류 발생: %v\n", dep.Name, err)
				continue
			}

			// 디렉토리 이동
			finalPath := filepath.Join(dependentDir, dep.DesiredName)
			if err := MoveDir(extractedPath, finalPath); err != nil {
				os.Remove(tmpZipPath)
				os.RemoveAll(filepath.Dir(extractedPath))
				fmt.Printf("%s 디렉토리 이동 중 오류 발생: %v\n", dep.Name, err)
				continue
			}

			// 임시 파일 정리
			os.Remove(tmpZipPath)
			os.RemoveAll(filepath.Dir(extractedPath))

			fmt.Printf("%s 설치 완료: %s\n", dep.Name, finalPath)
		}

		fmt.Printf("==== %s 설치 완료 ====\n\n", dep.Name)
	}

	// streamlink의 중복 ffmpeg 제거
	streamlinkFFmpeg := filepath.Join(dependentDir, "streamlink", "ffmpeg")
	if _, err := os.Stat(streamlinkFFmpeg); err == nil {
		os.RemoveAll(streamlinkFFmpeg)
		fmt.Printf("중복된 ffmpeg 폴더 삭제 완료: %s\n", streamlinkFFmpeg)
	}

	return nil
}
