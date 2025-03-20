package downloader

// DownloadOptions 다운로드 옵션을 담는 구조체
type DownloadOptions struct {
	VodURL          string
	Quality         string
	OutputFolder    string
	Filename        string
	SpeedOption     string
	DownloadSection string
	ResumeOption    string
}
