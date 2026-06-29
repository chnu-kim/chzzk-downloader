package api

import (
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"chzzk-downloader/internal/config"
)

const (
	ChzzkClipInfoAPI = "https://api.chzzk.naver.com/service/v1/play-info/clip/%s"
)

// clipResponse 클립 play-info API 응답 구조체
type clipResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Content struct {
		ContentTitle string `json:"contentTitle"`
		VideoID      string `json:"videoId"`
		InKey        string `json:"inKey"`
		VodStatus    string `json:"vodStatus"`
		Adult        bool   `json:"adult"`
		OwnerChannel struct {
			ChannelName string `json:"channelName"`
		} `json:"ownerChannel"`
	} `json:"content"`
}

// IsClipURL 치지직 클립 URL인지 판별하는 함수
// 일반 형식(chzzk.naver.com/clips/{id})과 임베드 형식(chzzk.naver.com/embed/clip/{id}) 모두 지원한다.
func IsClipURL(url string) bool {
	return strings.Contains(url, "chzzk.naver.com/clips/") ||
		strings.Contains(url, "chzzk.naver.com/embed/clip/")
}

// parseClipID 클립 URL에서 클립 ID를 추출하는 함수
func parseClipID(clipURL string) (string, error) {
	if !IsClipURL(clipURL) {
		return "", errors.New("치지직 클립 URL이 아닙니다")
	}

	// 쿼리스트링 제거
	u := clipURL
	if idx := strings.Index(u, "?"); idx >= 0 {
		u = u[:idx]
	}

	parts := strings.Split(strings.TrimRight(u, "/"), "/")
	clipID := parts[len(parts)-1]
	if clipID == "" || clipID == "clips" {
		return "", errors.New("클립 ID를 추출할 수 없습니다")
	}
	return clipID, nil
}

// parseClipQualitiesFromMPD MPD XML에서 PD(직접 다운로드) 화질 목록을 파싱하는 함수
func parseClipQualitiesFromMPD(mpdXML []byte) ([]Quality, error) {
	var mpdRoot MPDRoot
	if err := xml.Unmarshal(mpdXML, &mpdRoot); err != nil {
		return nil, err
	}

	var qualities []Quality
	for _, adaptationSet := range mpdRoot.AdaptationSet {
		if !strings.Contains(adaptationSet.MimeType, "video/mp4") {
			continue
		}
		for _, rep := range adaptationSet.Representations {
			// PD(Progressive Download) representation만 직접 다운로드 가능한 단일 mp4를 가진다.
			if !isPDRepresentation(rep) {
				continue
			}

			qualityValue := rep.ID
			for _, label := range rep.Labels {
				if label.Kind == "resolution" {
					qualityValue = label.Value + "p"
					break
				}
			}

			baseURL := ""
			if len(rep.BaseURL) > 0 {
				baseURL = rep.BaseURL[0]
			}

			qualities = append(qualities, Quality{
				ID:        rep.ID,
				Quality:   qualityValue,
				Bandwidth: rep.Bandwidth,
				Width:     rep.Width,
				Height:    rep.Height,
				FrameRate: rep.FrameRate,
				BaseURL:   baseURL,
			})
		}
	}

	if len(qualities) == 0 {
		return nil, errors.New("다운로드 가능한 클립 화질 정보를 찾을 수 없습니다")
	}
	return qualities, nil
}

// selectClipBaseURLFromMPD MPD XML에서 선택한 화질 ID의 직접 다운로드 URL을 찾는 함수
func selectClipBaseURLFromMPD(mpdXML []byte, qualityID string) (string, error) {
	var mpdRoot MPDRoot
	if err := xml.Unmarshal(mpdXML, &mpdRoot); err != nil {
		return "", err
	}

	for _, adaptationSet := range mpdRoot.AdaptationSet {
		if !strings.Contains(adaptationSet.MimeType, "video/mp4") {
			continue
		}
		for _, rep := range adaptationSet.Representations {
			if rep.ID == qualityID && isPDRepresentation(rep) && len(rep.BaseURL) > 0 {
				return rep.BaseURL[0], nil
			}
		}
	}

	return "", errors.New("선택한 화질의 다운로드 URL을 찾을 수 없습니다")
}

// isPDRepresentation Progressive Download(단일 mp4) representation 여부를 판별하는 함수
func isPDRepresentation(rep Representation) bool {
	if !strings.HasPrefix(rep.ID, "PD_") {
		return false
	}
	return len(rep.BaseURL) > 0 && strings.Contains(rep.BaseURL[0], "/pd/")
}

// fetchClipInfo 클립 정보를 가져와 VodInfo로 매핑하는 함수
func fetchClipInfo(clipURL string) (clipResponse, VodInfo, error) {
	clipID, err := parseClipID(clipURL)
	if err != nil {
		return clipResponse{}, VodInfo{}, err
	}

	infoApiURL := fmt.Sprintf(ChzzkClipInfoAPI, clipID)
	body, err := httpGet(infoApiURL, nil)
	if err != nil {
		return clipResponse{}, VodInfo{}, err
	}

	var clipResp clipResponse
	if err := json.Unmarshal(body, &clipResp); err != nil {
		return clipResponse{}, VodInfo{}, err
	}
	if clipResp.Code != 200 {
		return clipResponse{}, VodInfo{}, fmt.Errorf("클립 정보 API 오류: %s", clipResp.Message)
	}
	if clipResp.Content.VideoID == "" || clipResp.Content.InKey == "" {
		return clipResponse{}, VodInfo{}, errors.New("클립 재생 정보(videoId/inKey)가 없습니다")
	}

	// 기존 VOD 흐름과 동일하게 다루기 위해 VodInfo로 매핑한다. 클립은 날짜 정보가 없다.
	vodInfo := VodInfo{
		VideoTitle: clipResp.Content.ContentTitle,
		VideoID:    clipResp.Content.VideoID,
		InKey:      clipResp.Content.InKey,
		VodStatus:  clipResp.Content.VodStatus,
		Channel:    ChannelInfo{ChannelName: clipResp.Content.OwnerChannel.ChannelName},
	}
	return clipResp, vodInfo, nil
}

// fetchClipMPD 클립의 vodplay 재생 MPD를 가져오는 함수
func fetchClipMPD(videoID, inKey string) ([]byte, error) {
	mpdURL := fmt.Sprintf(ChzzkVodUriAPI, videoID, inKey)
	return httpGet(mpdURL, map[string]string{
		"Accept": "application/dash+xml, application/xml, */*",
	})
}

// GetClipQualities 클립 화질 목록과 정보를 가져오는 함수
func GetClipQualities(clipURL string) ([]Quality, VodInfo, error) {
	_, vodInfo, err := fetchClipInfo(clipURL)
	if err != nil {
		return nil, VodInfo{}, err
	}

	mpdXML, err := fetchClipMPD(vodInfo.VideoID, vodInfo.InKey)
	if err != nil {
		return nil, vodInfo, err
	}

	qualities, err := parseClipQualitiesFromMPD(mpdXML)
	if err != nil {
		return nil, vodInfo, err
	}
	return qualities, vodInfo, nil
}

// GetClipDownloadURL 선택한 화질의 클립 직접 다운로드 URL을 가져오는 함수
func GetClipDownloadURL(clipURL, qualityID string) (string, error) {
	_, vodInfo, err := fetchClipInfo(clipURL)
	if err != nil {
		return "", err
	}

	mpdXML, err := fetchClipMPD(vodInfo.VideoID, vodInfo.InKey)
	if err != nil {
		return "", err
	}

	return selectClipBaseURLFromMPD(mpdXML, qualityID)
}

// httpGet 치지직 API 공통 GET 요청 함수
func httpGet(url string, extraHeaders map[string]string) ([]byte, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	for k, v := range config.GetCookieHeaders() {
		req.Header.Set(k, v)
	}
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	return io.ReadAll(resp.Body)
}
