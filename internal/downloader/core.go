package downloader

import (
	"chzzk-downloader/internal/api"
)

// DownloadVOD VOD 다운로드 함수
func DownloadVOD(vodURL, quality, outputFolder, autoFilename, speedOption, downloadSection string) error {
	// 다운로드 옵션 구성
	options := &DownloadOptions{
		VodURL:          vodURL,
		Quality:         quality,
		OutputFolder:    outputFolder,
		Filename:        autoFilename,
		SpeedOption:     speedOption,
		DownloadSection: downloadSection,
	}

	// 출력 경로 및 파일명 준비
	outputFile, err := PrepareOutputPath(options)
	if err != nil {
		return err
	}

	// 중복 파일 처리
	proceed, resumeOption := CheckDuplicateFile(outputFile)
	if !proceed {
		return nil
	}
	options.ResumeOption = resumeOption

	// VOD 정보 가져오기
	_, _, err = api.GetVODQualities(vodURL)
	if err != nil {
		return err
	}

	// HLS URL 가져오기
	hlsURL, err := api.GetVODUrl(vodURL, "")
	if err != nil {
		return err
	}

	// HLS 스트림 다운로드 (streamlink + ffmpeg 사용)
	return DownloadHLS(hlsURL, quality, outputFile)
}
