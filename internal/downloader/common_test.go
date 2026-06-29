package downloader

import "testing"

// 클립 등 직접 다운로드는 덮어쓰기/건너뛰기만 제공하고 이어받기(덮어쓰기 데이터 손실 경로)는 없어야 한다.
func TestDirectDuplicateChoice(t *testing.T) {
	cases := []struct {
		ans         string
		wantProceed bool
		wantValid   bool
	}{
		{"1", true, true},   // 덮어쓰기
		{"2", false, true},  // 건너뛰기
		{"3", false, false}, // 이어받기 옵션은 존재하지 않음
		{"", false, false},
		{"x", false, false},
	}
	for _, c := range cases {
		proceed, valid := directDuplicateChoice(c.ans)
		if proceed != c.wantProceed || valid != c.wantValid {
			t.Errorf("directDuplicateChoice(%q) = (%v,%v), want (%v,%v)",
				c.ans, proceed, valid, c.wantProceed, c.wantValid)
		}
	}
}
