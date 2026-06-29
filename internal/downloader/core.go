package downloader

import (
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

	// 다운로드 소스 URL 가져오기 (선택한 품질을 전달해야 DASH에서 올바른 BaseURL을 해석한다)
	// 참고: chzzk DASH의 video/mp4 Representation(PD_*)은 영상+음성이 합쳐진 progressive
	// 파일(codecs에 mp4a 포함)이라 단일 BaseURL만으로 오디오까지 포함된다. 별도 audio
	// AdaptationSet을 쓰는 포맷이 등장하면 이 가정이 깨지므로 그때 MPD 직접 전달로 전환해야 한다.
	sourceURL, err := api.GetVODUrl(vodURL, quality)
	if err != nil {
		return err
	}

	// ffmpeg로 직접 다운로드 (HLS m3u8 / DASH BaseURL 공통)
	return DownloadWithFFmpeg(sourceURL, outputFile, mediaHeaders())
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
