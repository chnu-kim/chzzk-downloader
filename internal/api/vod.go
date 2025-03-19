package api

import (
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"

	"chzzk-downloader/internal/config"
)

const (
	ChzzkVodInfoAPI = "https://api.chzzk.naver.com/service/v2/videos/%s"
	ChzzkVodUriAPI  = "https://apis.naver.com/neonplayer/vodplay/v2/playback/%s?key=%s"
)

// Quality 품질 정보 구조체
type Quality struct {
	ID        string `json:"id"`
	Quality   string `json:"quality"`
	Bandwidth string `json:"bandwidth,omitempty"`
	Width     string `json:"width,omitempty"`
	Height    string `json:"height,omitempty"`
	FrameRate string `json:"frameRate,omitempty"`
	BaseURL   string `json:"baseurl,omitempty"`
}

// VodInfo 치지직 VOD 정보 구조체
type VodInfo struct {
	VideoTitle   string      `json:"videoTitle"`
	VideoID      string      `json:"videoId"`
	InKey        string      `json:"inKey"`
	LiveOpenDate string      `json:"liveOpenDate"`
	VodStatus    string      `json:"vodStatus"`
	Channel      ChannelInfo `json:"channel"`
}

// ChannelInfo 채널 정보 구조체
type ChannelInfo struct {
	ChannelName string `json:"channelName"`
}

// ChzzkResponse API 응답 구조체
type ChzzkResponse struct {
	Code    int     `json:"code"`
	Message string  `json:"message"`
	Content VodInfo `json:"content"`
}

// MPDRoot MPD XML 파싱을 위한 구조체
type MPDRoot struct {
	XMLName       xml.Name        `xml:"MPD"`
	AdaptationSet []AdaptationSet `xml:"Period>AdaptationSet"`
}

type AdaptationSet struct {
	MimeType        string           `xml:"mimeType,attr"`
	Representations []Representation `xml:"Representation"`
}

type Representation struct {
	ID        string   `xml:"id,attr"`
	Bandwidth string   `xml:"bandwidth,attr"`
	Width     string   `xml:"width,attr"`
	Height    string   `xml:"height,attr"`
	FrameRate string   `xml:"frameRate,attr"`
	Labels    []Label  `xml:"Label"`
	BaseURL   []string `xml:"BaseURL"`
}

type Label struct {
	Kind  string `xml:"kind,attr"`
	Value string `xml:",chardata"`
}

// GetVODQualities VOD 품질 정보를 가져오는 함수
func GetVODQualities(vodURL string) ([]Quality, VodInfo, error) {
	if !strings.Contains(vodURL, "chzzk.naver.com/video/") {
		return nil, VodInfo{}, errors.New("치지직 VOD URL이 아닙니다")
	}

	parts := strings.Split(strings.TrimRight(vodURL, "/"), "/")
	videoNo := parts[len(parts)-1]
	infoApiURL := fmt.Sprintf(ChzzkVodInfoAPI, videoNo)

	headers := config.GetCookieHeaders()
	req, err := http.NewRequest("GET", infoApiURL, nil)
	if err != nil {
		return nil, VodInfo{}, err
	}

	for k, v := range headers {
		req.Header.Set(k, v)
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, VodInfo{}, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, VodInfo{}, err
	}

	var chzzkResp ChzzkResponse
	if err := json.Unmarshal(body, &chzzkResp); err != nil {
		return nil, VodInfo{}, err
	}

	if chzzkResp.Code != 200 {
		return nil, VodInfo{}, fmt.Errorf("VOD info API 오류: %s", chzzkResp.Message)
	}

	vodInfo := chzzkResp.Content
	var qualities []Quality

	// HLS 분기: inKey가 없는 경우
	if vodInfo.InKey == "" {
		var liveData map[string]interface{}

		// liveRewindPlaybackJson 필드가 없을 수 있어서 직접 추출
		var respData map[string]interface{}
		if err := json.Unmarshal(body, &respData); err != nil {
			return nil, vodInfo, err
		}

		content, ok := respData["content"].(map[string]interface{})
		if !ok {
			return nil, vodInfo, errors.New("content 필드가 올바르지 않습니다")
		}

		liveRewindPlaybackJson, ok := content["liveRewindPlaybackJson"].(string)
		if !ok || liveRewindPlaybackJson == "" {
			return nil, vodInfo, errors.New("liveRewindPlaybackJson 정보가 없습니다")
		}

		if err := json.Unmarshal([]byte(liveRewindPlaybackJson), &liveData); err != nil {
			return nil, vodInfo, err
		}

		mediaList, ok := liveData["media"].([]interface{})
		if !ok || len(mediaList) == 0 {
			return nil, vodInfo, errors.New("HLS 미디어 정보가 없습니다")
		}

		media := mediaList[0].(map[string]interface{})
		encodingTracks, ok := media["encodingTrack"].([]interface{})
		if !ok {
			return nil, vodInfo, errors.New("encodingTrack 정보가 없습니다")
		}

		for _, track := range encodingTracks {
			trackInfo := track.(map[string]interface{})
			qualityLabel := trackInfo["encodingTrackId"].(string)
			qualities = append(qualities, Quality{
				ID:        qualityLabel,
				Quality:   qualityLabel,
				Bandwidth: fmt.Sprintf("%v", trackInfo["videoBitRate"]),
				Width:     fmt.Sprintf("%v", trackInfo["videoWidth"]),
				Height:    fmt.Sprintf("%v", trackInfo["videoHeight"]),
				FrameRate: fmt.Sprintf("%v", trackInfo["videoFrameRate"]),
			})
		}
	} else {
		// DASH 분기: inKey가 존재하면 DASH MPD를 파싱
		videoId := vodInfo.VideoID
		inKey := vodInfo.InKey
		if videoId == "" || inKey == "" {
			return nil, vodInfo, errors.New("필수 videoId 또는 inKey 값이 없습니다")
		}

		mpdURL := fmt.Sprintf(ChzzkVodUriAPI, videoId, inKey)
		req, err := http.NewRequest("GET", mpdURL, nil)
		if err != nil {
			return nil, vodInfo, err
		}

		for k, v := range headers {
			req.Header.Set(k, v)
		}
		req.Header.Set("Accept", "application/dash+xml, application/xml, */*")

		resp2, err := client.Do(req)
		if err != nil {
			return nil, vodInfo, err
		}
		defer resp2.Body.Close()

		body2, err := io.ReadAll(resp2.Body)
		if err != nil {
			return nil, vodInfo, err
		}

		var mpdRoot MPDRoot
		if err := xml.Unmarshal(body2, &mpdRoot); err != nil {
			return nil, vodInfo, err
		}

		for _, adaptationSet := range mpdRoot.AdaptationSet {
			if strings.Contains(adaptationSet.MimeType, "video/mp4") {
				for _, rep := range adaptationSet.Representations {
					qualityValue := rep.ID
					for _, label := range rep.Labels {
						if label.Kind == "qualityId" {
							qualityValue = label.Value
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
				break
			}
		}
	}

	return qualities, vodInfo, nil
}

// GetVODUrl VOD URL을 가져오는 함수
func GetVODUrl(vodURL string, quality string) (string, error) {
	if !strings.Contains(vodURL, "chzzk.naver.com/video/") {
		return "", errors.New("치지직 VOD URL이 아닙니다")
	}

	parts := strings.Split(strings.TrimRight(vodURL, "/"), "/")
	videoNo := parts[len(parts)-1]
	infoApiURL := fmt.Sprintf(ChzzkVodInfoAPI, videoNo)

	headers := config.GetCookieHeaders()
	req, err := http.NewRequest("GET", infoApiURL, nil)
	if err != nil {
		return "", err
	}

	for k, v := range headers {
		req.Header.Set(k, v)
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var chzzkResp ChzzkResponse
	if err := json.Unmarshal(body, &chzzkResp); err != nil {
		return "", err
	}

	if chzzkResp.Code != 200 {
		return "", fmt.Errorf("VOD info API 오류: %s", chzzkResp.Message)
	}

	vodInfo := chzzkResp.Content

	// HLS 분기: inKey가 없는 경우
	if vodInfo.InKey == "" {
		var liveData map[string]interface{}

		// liveRewindPlaybackJson 필드가 없을 수 있어서 직접 추출
		var respData map[string]interface{}
		if err := json.Unmarshal(body, &respData); err != nil {
			return "", err
		}

		content, ok := respData["content"].(map[string]interface{})
		if !ok {
			return "", errors.New("content 필드가 올바르지 않습니다")
		}

		liveRewindPlaybackJson, ok := content["liveRewindPlaybackJson"].(string)
		if !ok || liveRewindPlaybackJson == "" {
			return "", errors.New("liveRewindPlaybackJson 정보가 없습니다")
		}

		if err := json.Unmarshal([]byte(liveRewindPlaybackJson), &liveData); err != nil {
			return "", err
		}

		mediaList, ok := liveData["media"].([]interface{})
		if !ok || len(mediaList) == 0 {
			return "", errors.New("HLS 미디어 정보가 없습니다")
		}

		media := mediaList[0].(map[string]interface{})
		path, ok := media["path"].(string)
		if !ok {
			return "", errors.New("HLS 미디어 경로 정보가 없습니다")
		}

		return path, nil
	} else {
		// DASH 분기
		videoId := vodInfo.VideoID
		inKey := vodInfo.InKey
		if videoId == "" || inKey == "" {
			return "", errors.New("필수 videoId 또는 inKey 값이 없습니다")
		}

		mpdURL := fmt.Sprintf(ChzzkVodUriAPI, videoId, inKey)
		req, err := http.NewRequest("GET", mpdURL, nil)
		if err != nil {
			return "", err
		}

		for k, v := range headers {
			req.Header.Set(k, v)
		}
		req.Header.Set("Accept", "application/dash+xml, application/xml, */*")

		resp2, err := client.Do(req)
		if err != nil {
			return "", err
		}
		defer resp2.Body.Close()

		body2, err := io.ReadAll(resp2.Body)
		if err != nil {
			return "", err
		}

		var mpdRoot MPDRoot
		if err := xml.Unmarshal(body2, &mpdRoot); err != nil {
			return "", err
		}

		// 품질 정보에서 숫자만 추출
		desiredQuality := ""
		re := regexp.MustCompile(`(\d+)`)
		matches := re.FindStringSubmatch(quality)
		if len(matches) > 1 {
			desiredQuality = matches[1]
		} else {
			return "", errors.New("올바른 품질 정보가 전달되지 않았습니다")
		}

		// 원하는 품질의 BaseURL 찾기
		for _, adaptationSet := range mpdRoot.AdaptationSet {
			if strings.Contains(adaptationSet.MimeType, "video/mp4") {
				for _, rep := range adaptationSet.Representations {
					var repResolution string
					for _, label := range rep.Labels {
						if label.Kind == "resolution" {
							repResolution = label.Value
							break
						}
					}

					if repResolution == "" {
						repResolution = rep.Height
					}

					if repResolution == desiredQuality && len(rep.BaseURL) > 0 {
						return rep.BaseURL[0], nil
					}
				}
			}
		}

		return "", errors.New("원하는 품질의 BaseURL을 찾을 수 없습니다")
	}
}
