package downloader

import (
	"chzzk-downloader/internal/api"
)

// DownloadClip 클립 다운로드 함수
// 클립은 MPD의 PD(Progressive Download) representation이 완성된 단일 mp4를 제공하므로
// 외부 바이너리 없이 순수 Go HTTP로 직접 받아 저장한다.
func DownloadClip(clipURL, quality, outputFolder, autoFilename string) error {
	options := &DownloadOptions{
		VodURL:       clipURL,
		Quality:      quality,
		OutputFolder: outputFolder,
		Filename:     autoFilename,
	}

	outputFile, err := PrepareOutputPath(options)
	if err != nil {
		return err
	}

	if !CheckDuplicateFileDirect(outputFile) {
		return nil
	}

	// 서명된 다운로드 URL은 만료되므로 다운로드 직전에 새로 가져온다(저장/캐시 금지).
	downloadURL, err := api.GetClipDownloadURL(clipURL, quality)
	if err != nil {
		return err
	}

	return downloadDirectMP4(downloadURL, outputFile, mediaHeaders())
}
