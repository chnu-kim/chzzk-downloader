package config

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// execName OS에 맞는 실행 파일 이름을 반환 (Windows는 .exe 필요)
func execName(name string) string {
	if runtime.GOOS == "windows" {
		return name + ".exe"
	}
	return name
}

// writeFakeBinary PATH 탐색용 임시 실행 파일을 생성하고 그 경로를 반환
func writeFakeBinary(t *testing.T, dir, name string) string {
	t.Helper()
	path := filepath.Join(dir, execName(name))
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0755); err != nil {
		t.Fatalf("가짜 바이너리 생성 실패: %v", err)
	}
	return path
}

func TestGetFFmpeg_ResolvesFromPath(t *testing.T) {
	dir := t.TempDir()
	want := writeFakeBinary(t, dir, "ffmpeg")
	t.Setenv("PATH", dir)

	if got := GetFFmpeg(); got != want {
		t.Errorf("GetFFmpeg() = %q, PATH의 바이너리 %q 를 기대", got, want)
	}
}

func TestGetStreamlink_ResolvesFromPath(t *testing.T) {
	dir := t.TempDir()
	want := writeFakeBinary(t, dir, "streamlink")
	t.Setenv("PATH", dir)

	if got := GetStreamlink(); got != want {
		t.Errorf("GetStreamlink() = %q, PATH의 바이너리 %q 를 기대", got, want)
	}
}

func TestGetFFmpeg_FallsBackToBundled(t *testing.T) {
	// PATH를 빈 디렉토리로 설정해 ffmpeg를 찾지 못하게 함
	t.Setenv("PATH", t.TempDir())

	got := GetFFmpeg()
	wantSuffix := filepath.Join("dependent", "ffmpeg", "bin", execName("ffmpeg"))
	if filepath.Base(got) != execName("ffmpeg") {
		t.Errorf("GetFFmpeg() = %q, 번들 바이너리 경로를 기대 (suffix %q)", got, wantSuffix)
	}
	if !filepath.IsAbs(got) {
		t.Errorf("GetFFmpeg() = %q, 절대 경로를 기대", got)
	}
}

func TestGetStreamlink_FallsBackToBundled(t *testing.T) {
	t.Setenv("PATH", t.TempDir())

	got := GetStreamlink()
	if filepath.Base(got) != execName("streamlink") {
		t.Errorf("GetStreamlink() = %q, 번들 바이너리 경로를 기대", got)
	}
	if !filepath.IsAbs(got) {
		t.Errorf("GetStreamlink() = %q, 절대 경로를 기대", got)
	}
}

func TestEnsureBinaries_AllPresentReturnsNil(t *testing.T) {
	dir := t.TempDir()
	writeFakeBinary(t, dir, "ffmpeg")
	writeFakeBinary(t, dir, "streamlink")
	t.Setenv("PATH", dir)

	if err := EnsureBinaries(); err != nil {
		t.Errorf("EnsureBinaries() = %v, nil 을 기대", err)
	}
}

func TestEnsureBinaries_MissingReturnsActionableError(t *testing.T) {
	// PATH를 비우고 번들도 없는 상태 → 두 바이너리 모두 없음
	t.Setenv("PATH", t.TempDir())

	err := EnsureBinaries()
	if err == nil {
		t.Fatal("EnsureBinaries() = nil, 오류를 기대")
	}
	msg := err.Error()
	for _, want := range []string{"ffmpeg", "streamlink", "brew", "pip"} {
		if !strings.Contains(msg, want) {
			t.Errorf("EnsureBinaries() 오류에 %q 안내가 없음: %s", want, msg)
		}
	}
}
