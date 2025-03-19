package downloader

import (
	"fmt"
	"strings"

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
	qualities, vodInfo, err := api.GetVODQualities(vodURL)
	if err != nil {
		return err
	}

	// HLS 분기: inKey가 없는 경우 (빠른 다시보기)
	if vodInfo.InKey == "" {
		hlsURL, err := api.GetVODUrl(vodURL, "")
		if err != nil {
			return err
		}

		// HLS 스트림 다운로드 (streamlink + ffmpeg 사용)
		return DownloadHLS(hlsURL, quality, outputFile)
	} else {
		// DASH MPD 분기 (일반 VOD)
		// 선택한 품질 찾기
		var selectedRep *api.Quality
		for i := range qualities {
			if qualities[i].ID == quality {
				selectedRep = &qualities[i]
				break
			}
		}

		if selectedRep == nil || selectedRep.BaseURL == "" {
			return fmt.Errorf("선택한 품질의 다운로드 URL(BaseURL)이 없습니다")
		}

		downloadURL := selectedRep.BaseURL
		fmt.Printf("\n[INFO] 선택한 품질의 BaseURL: %s\n", downloadURL)

		// 구간 다운로드 처리
		if downloadSection != "" {
			parts := strings.Split(downloadSection, "~")
			if len(parts) != 2 {
				return fmt.Errorf("download_section 형식이 올바르지 않습니다. (예: 00:10:00~00:20:00)")
			}

			startSection := parts[0]
			endSection := parts[1]

			// FFmpeg를 사용한 구간 다운로드
			return DownloadWithFFmpeg(downloadURL, outputFile, startSection, endSection)
		} else {
			// 전체 VOD 다운로드 (aria2c 사용)
			return DownloadWithAria2c(options, downloadURL, outputFile)
		}
	}
}
