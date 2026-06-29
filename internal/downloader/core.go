package downloader

import (
	"fmt"

	"chzzk-downloader/internal/api"
	"chzzk-downloader/internal/config"
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

	// 중복 파일 처리 (완성 파일을 받으므로 덮어쓰기/건너뛰기만 제공)
	if !CheckDuplicateFileDirect(outputFile) {
		return nil
	}

	// 다운로드 소스 URL과 종류 가져오기 (선택한 품질을 전달해야 DASH에서 올바른 BaseURL을 해석한다)
	source, err := api.GetVODUrl(vodURL, quality)
	if err != nil {
		return err
	}

	switch source.Kind {
	case api.KindProgressive:
		// 클립·DASH는 완성된 단일 mp4라 외부 바이너리 없이 순수 Go HTTP로 받는다.
		return downloadDirectMP4(source.URL, outputFile, mediaHeaders())
	case api.KindHLS:
		// HLS "빠른 다시보기"만 ffmpeg가 필요하다. 진입 시점에 lazy하게 확인한다.
		if err := config.EnsureBinaries(); err != nil {
			return err
		}
		return DownloadWithFFmpeg(source.URL, outputFile, mediaHeaders())
	default:
		return fmt.Errorf("알 수 없는 소스 종류입니다: %v", source.Kind)
	}
}

// mediaHeaders 미디어 요청에 필요한 헤더만 추린다.
// GetCookieHeaders는 JSON API용이라 Accept/Origin 등이 섞여 있으므로,
// 인증·접근에 관여하는 User-Agent/Referer/Cookie만 전달한다.
func mediaHeaders() map[string]string {
	all := config.GetCookieHeaders()
	media := make(map[string]string)
	for _, k := range []string{"User-Agent", "Referer", "Cookie"} {
		if v, ok := all[k]; ok && v != "" {
			media[k] = v
		}
	}
	return media
}
