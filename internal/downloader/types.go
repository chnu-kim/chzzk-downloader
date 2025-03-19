package downloader

// 다운로드 속도 옵션에 따른 aria2c 인자 매핑
var speedOptionMapping = map[string][]string{
	"100%":  {"-x", "16", "-s", "16", "-k", "1M"},
	"75%":   {"-x", "12", "-s", "12", "-k", "1M"},
	"50%":   {"-x", "8", "-s", "8", "-k", "1M"},
	"25%":   {"-x", "4", "-s", "4", "-k", "1M"},
	"분할 없음": {"-x", "1", "-s", "1", "-k", "1M"},
}

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
