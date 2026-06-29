package api

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIsClipURL(t *testing.T) {
	cases := []struct {
		url  string
		want bool
	}{
		{"https://chzzk.naver.com/clips/TestClip01", true},
		{"https://chzzk.naver.com/clips/AbCdEf1234/", true},
		{"https://chzzk.naver.com/embed/clip/AbCdEf1234", true},
		{"https://chzzk.naver.com/video/1234567", false},
		{"https://chzzk.naver.com/", false},
		{"", false},
	}
	for _, c := range cases {
		if got := IsClipURL(c.url); got != c.want {
			t.Errorf("IsClipURL(%q) = %v, want %v", c.url, got, c.want)
		}
	}
}

func TestParseClipID(t *testing.T) {
	cases := []struct {
		url     string
		want    string
		wantErr bool
	}{
		{"https://chzzk.naver.com/clips/TestClip01", "TestClip01", false},
		{"https://chzzk.naver.com/clips/AbCdEf1234/", "AbCdEf1234", false},
		{"https://chzzk.naver.com/clips/AbCdEf1234?param=1", "AbCdEf1234", false},
		{"https://chzzk.naver.com/embed/clip/AbCdEf1234", "AbCdEf1234", false},
		{"https://chzzk.naver.com/embed/clip/AbCdEf1234?autoPlay=true", "AbCdEf1234", false},
		{"https://chzzk.naver.com/video/1234567", "", true},
	}
	for _, c := range cases {
		got, err := parseClipID(c.url)
		if c.wantErr {
			if err == nil {
				t.Errorf("parseClipID(%q) expected error", c.url)
			}
			continue
		}
		if err != nil {
			t.Errorf("parseClipID(%q) unexpected error: %v", c.url, err)
		}
		if got != c.want {
			t.Errorf("parseClipID(%q) = %q, want %q", c.url, got, c.want)
		}
	}
}

func TestParseClipQualitiesFromMPD(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("testdata", "clip_multi.mpd"))
	if err != nil {
		t.Fatalf("read testdata: %v", err)
	}

	qualities, err := parseClipQualitiesFromMPD(data)
	if err != nil {
		t.Fatalf("parseClipQualitiesFromMPD: %v", err)
	}

	if len(qualities) != 2 {
		t.Fatalf("expected 2 PD qualities, got %d: %+v", len(qualities), qualities)
	}

	for _, q := range qualities {
		if !strings.HasPrefix(q.ID, "PD_") {
			t.Errorf("quality ID %q is not a PD representation", q.ID)
		}
	}
}

func TestSelectClipBaseURLFromMPD(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("testdata", "clip_multi.mpd"))
	if err != nil {
		t.Fatalf("read testdata: %v", err)
	}

	url, err := selectClipBaseURLFromMPD(data, "PD_720P_1280_2048_192")
	if err != nil {
		t.Fatalf("selectClipBaseURLFromMPD: %v", err)
	}
	if !strings.Contains(url, "/pd/") || !strings.Contains(url, ".mp4") {
		t.Errorf("expected direct pd mp4 URL, got %q", url)
	}

	if _, err := selectClipBaseURLFromMPD(data, "PD_NONEXISTENT"); err == nil {
		t.Error("expected error for unknown quality ID")
	}
}
