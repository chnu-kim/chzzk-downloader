package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"chzzk-downloader/internal/api"
	"chzzk-downloader/internal/config"
	"chzzk-downloader/internal/downloader"
	"chzzk-downloader/internal/setup"
	"chzzk-downloader/internal/utils"
)

const VERSION = "0.2.0"

// 로컬 의존성 확인 함수(setup 패키지의 함수를 사용)
func checkDependencies() bool {
	return setup.CheckDependencies()
}

// 의존성 자동 설치 여부 확인 및 설치 진행
func ensureDependencies() bool {
	if checkDependencies() {
		return true
	}

	fmt.Println("필요한 의존성 파일이 없습니다.")
	fmt.Print("자동으로 설치를 진행할까요? (y/n): ")

	scanner := bufio.NewScanner(os.Stdin)
	scanner.Scan()
	answer := strings.ToLower(strings.TrimSpace(scanner.Text()))

	if answer != "y" {
		fmt.Println("사용자가 설치를 거부했습니다.")
		return false
	}

	fmt.Println("\n==== 의존성 설치 시작 ====")
	err := setup.InstallDependencies()
	if err != nil {
		fmt.Printf("의존성 설치 중 오류 발생: %v\n", err)
		return false
	}
	fmt.Println("==== 의존성 설치 완료 ====\n")
	return true
}

// 성인 컨텐츠 확인 및 인증 처리 함수
func setupAdultContent(scanner *bufio.Scanner) bool {
	fmt.Println("\n==== 컨텐츠 유형 선택 ====")
	fmt.Println("다운로드할 VOD의 유형을 선택하세요.")
	fmt.Println("1. 일반 컨텐츠")
	fmt.Println("2. 성인 컨텐츠 (네이버 로그인 쿠키 필요)")
	fmt.Print("\n선택 (1-2): ")

	scanner.Scan()
	choice := strings.TrimSpace(scanner.Text())

	// 기본값은 일반 컨텐츠
	if choice != "2" {
		fmt.Println("일반 컨텐츠로 설정합니다.")
		return false
	}

	fmt.Println("\n==== 성인 컨텐츠 인증 설정 ====")
	fmt.Println("성인 컨텐츠 다운로드를 위해 네이버 로그인 쿠키 정보가 필요합니다.")
	fmt.Println("쿠키 정보는 다음 단계로 확인할 수 있습니다:")
	fmt.Println("1. 네이버에 로그인한 상태에서 치지직(chzzk.naver.com) 웹사이트에 접속합니다.")
	fmt.Println("2. 웹 브라우저에서 개발자 도구를 엽니다 (Chrome: F12 또는 Ctrl+Shift+I).")
	fmt.Println("3. '애플리케이션(Application)' 탭을 선택합니다.")
	fmt.Println("4. 왼쪽 메뉴에서 '쿠키' > 'https://chzzk.naver.com'을 선택합니다.")
	fmt.Println("5. 목록에서 'NID_AUT'와 'NID_SES' 값을 복사하여 아래에 입력합니다.")

	fmt.Print("\nNID_AUT 값을 입력하세요: ")
	scanner.Scan()
	nidAut := strings.TrimSpace(scanner.Text())

	fmt.Print("NID_SES 값을 입력하세요: ")
	scanner.Scan()
	nidSes := strings.TrimSpace(scanner.Text())

	if nidAut == "" || nidSes == "" {
		fmt.Println("\n경고: NID_AUT 또는 NID_SES 값이 입력되지 않았습니다.")
		fmt.Println("성인 인증 없이 진행합니다. 성인 컨텐츠는 다운로드되지 않을 수 있습니다.")
		return false
	}

	// 쿠키 저장
	if err := config.SetAdultCookies(nidAut, nidSes); err != nil {
		fmt.Printf("\n쿠키 저장 중 오류 발생: %v\n", err)
		fmt.Println("성인 인증 없이 진행합니다. 성인 컨텐츠는 다운로드되지 않을 수 있습니다.")
		return false
	}

	fmt.Println("\n성인 인증 쿠키가 성공적으로 설정되었습니다.")
	return true
}

func main() {
	fmt.Printf("==== 치지직 다운로더 (v%s) ====\n\n", VERSION)

	// 의존성 확인 및 설치
	if !ensureDependencies() {
		fmt.Println("프로그램 실행에 필요한 의존성이 없습니다.")
		fmt.Print("\n종료하려면 Enter 키를 누르세요...")
		bufio.NewReader(os.Stdin).ReadBytes('\n')
		return
	}

	scanner := bufio.NewScanner(os.Stdin)

	for {
		fmt.Println("==== 영상 다운로드 ====")

		// 성인 컨텐츠 확인 및 인증 처리
		isAdultContent := setupAdultContent(scanner)

		fmt.Print("\n영상 주소 (예: https://chzzk.naver.com/video/1234567): ")
		scanner.Scan()
		vodURL := strings.TrimSpace(scanner.Text())
		if vodURL == "" {
			fmt.Println("주소를 입력해야 합니다.")
			continue
		}

		// 치지직 VOD 다운로드 처리
		if !strings.Contains(vodURL, "chzzk.naver.com/video/") {
			fmt.Println("치지직 VOD 주소가 아닙니다.")
			fmt.Print("계속하려면 Enter를 누르세요.")
			scanner.Scan()
			continue
		}

		// VOD 품질 정보 가져오기
		qualities, vodInfo, err := api.GetVODQualities(vodURL)
		if err != nil {
			fmt.Printf("품질 정보를 가져오는 중 오류 발생: %v\n", err)

			// 성인 컨텐츠 관련 오류 메시지 구체화
			if strings.Contains(strings.ToLower(err.Error()), "성인") ||
				strings.Contains(strings.ToLower(err.Error()), "adult") ||
				strings.Contains(strings.ToLower(err.Error()), "unauthorized") ||
				strings.Contains(strings.ToLower(err.Error()), "인증") {
				fmt.Println("\n이 영상은 성인 인증이 필요한 컨텐츠입니다.")
				fmt.Println("프로그램을 다시 시작하고 '성인 컨텐츠' 옵션을 선택한 후 유효한 네이버 로그인 쿠키를 입력해주세요.")
			}

			fmt.Print("\n계속하려면 Enter를 누르세요.")
			scanner.Scan()
			continue
		}

		if len(qualities) == 0 {
			fmt.Println("사용 가능한 품질 정보를 찾지 못했습니다.")
			fmt.Print("계속하려면 Enter를 누르세요.")
			scanner.Scan()
			continue
		}

		// 파일명 자동 생성 (날짜 형식으로 고정)
		_, startTimeStr := utils.FormatLiveDate(vodInfo.LiveOpenDate)
		channelName := vodInfo.Channel.ChannelName
		videoTitle := strings.TrimSpace(vodInfo.VideoTitle)

		// 항상 옵션 2번(날짜 형식) 사용
		autoFilename := fmt.Sprintf("[%s] %s %s.mp4", startTimeStr, channelName, videoTitle)
		autoFilename = utils.SanitizeFilename(autoFilename)
		fmt.Printf("\n생성된 파일명: %s\n", autoFilename)

		// 품질 선택 (개선된 UI)
		fmt.Println("\n[ 사용 가능한 품질 ]")
		fmt.Println("--------------------")

		// 최고 품질을 자동으로 찾아 기본값으로 설정
		var bestQualityIndex int
		var bestHeight int

		for idx, q := range qualities {
			// 높이 정보 추출
			height := 0
			if q.Height != "" {
				h, err := strconv.Atoi(q.Height)
				if err == nil {
					height = h
				}
			}

			// 품질 표시
			qualityInfo := q.Quality
			extraInfo := ""

			// 최고 품질 업데이트
			if height > bestHeight {
				bestHeight = height
				bestQualityIndex = idx
				extraInfo = " (최고 품질)"
			}

			fmt.Printf("%d. %s%s\n", idx+1, qualityInfo, extraInfo)
		}
		fmt.Println("--------------------")

		var selectedQuality string
		for {
			// 기본값으로 최고 품질 선택 안내
			fmt.Printf("원하는 품질 번호를 선택하세요 (Enter = %d번): ", bestQualityIndex+1)
			scanner.Scan()
			choice := strings.TrimSpace(scanner.Text())

			// Enter키 입력 시 최고 품질 자동 선택
			if choice == "" {
				selectedQuality = qualities[bestQualityIndex].ID
				fmt.Printf("선택된 품질: %s\n", qualities[bestQualityIndex].Quality)
				break
			}

			choiceInt, err := strconv.Atoi(choice)
			if err != nil || choiceInt < 1 || choiceInt > len(qualities) {
				fmt.Println("잘못된 선택입니다. 1~" + strconv.Itoa(len(qualities)) + " 사이의 번호를 입력해주세요.")
				continue
			}

			selectedQuality = qualities[choiceInt-1].ID
			fmt.Printf("선택된 품질: %s\n", qualities[choiceInt-1].Quality)
			break
		}

		// 다운로드 폴더 선택 (개선된 UI)
		// 기본 다운로드 폴더 설정
		defaultFolder := filepath.Join(config.GetBaseDir(), "downloads")

		var outputFolder string
		for {
			fmt.Printf("다운로드 폴더 (Enter = %s): ", defaultFolder)
			scanner.Scan()
			outputFolder = strings.TrimSpace(scanner.Text())

			// 기본값 사용
			if outputFolder == "" {
				outputFolder = defaultFolder
				fmt.Printf("기본 폴더 사용: %s\n", outputFolder)
			}

			// 폴더 생성 또는 확인
			if _, err := os.Stat(outputFolder); os.IsNotExist(err) {
				err := os.MkdirAll(outputFolder, 0755)
				if err != nil {
					fmt.Printf("폴더 생성 실패: %v\n", err)
					continue
				}
				fmt.Printf("폴더 생성됨: %s\n", outputFolder)
			} else {
				fmt.Printf("폴더 확인됨: %s\n", outputFolder)
			}
			break
		}

		// HLS/DASH 분기 처리 (개선된 UI)
		var downloadSection string
		if vodInfo.InKey == "" {
			fmt.Println("\n[알림] 빠른 다시보기(HLS)는 구간 다운로드가 지원되지 않습니다.")
			fmt.Println("      전체 다운로드로 진행합니다.")
			downloadSection = ""
		} else {
			// DASH 분기
			fmt.Println("\n[ 다운로드 구간 설정 ]")
			fmt.Println("전체 영상을 다운로드하려면 Enter를 누르세요.")
			fmt.Println("특정 구간만 다운로드하려면 시작~종료 형식으로 입력하세요 (예: 00:10:30~01:20:45)")

			for {
				fmt.Print("다운로드 구간 (전체: Enter): ")
				scanner.Scan()
				sectionInput := strings.TrimSpace(scanner.Text())

				if sectionInput == "" {
					fmt.Println("전체 영상을 다운로드합니다.")
					downloadSection = ""
					break
				}

				if matched, _ := utils.ValidateTimeRange(sectionInput); !matched {
					fmt.Println("입력 형식이 올바르지 않습니다. 00:00:00~00:00:00 형식으로 입력해주세요.")
					continue
				}

				downloadSection = sectionInput
				fmt.Printf("설정된 구간: %s\n", downloadSection)
				break
			}
		}

		// 다운로드 속도 옵션 선택 (개선된 UI)
		var speedOption string
		if vodInfo.VodStatus == "UPLOAD" || vodInfo.VodStatus == "NONE" {
			speedOption = "100%"
			fmt.Println("\n[알림] VOD 상태에 따라 최대 속도(100%)로 다운로드됩니다.")
		} else {
			fmt.Println("\n[ 다운로드 속도 설정 ]")
			fmt.Println("--------------------")
			fmt.Println("1. 100% (16분할) - 최대 속도")
			fmt.Println("2. 75%  (12분할) - 빠른 속도")
			fmt.Println("3. 50%  (8분할)  - 중간 속도")
			fmt.Println("4. 25%  (4분할)  - 낮은 속도")
			fmt.Println("5. 분할 없음     - 서버 친화적")
			fmt.Println("--------------------")

			speedMapping := map[int]string{
				1: "100%",
				2: "75%",
				3: "50%",
				4: "25%",
				5: "분할 없음",
			}

			for {
				fmt.Print("속도 옵션 (Enter = 1번): ")
				scanner.Scan()
				speedChoice := strings.TrimSpace(scanner.Text())

				// 기본값 (1번) 사용
				if speedChoice == "" {
					speedOption = "100%"
					fmt.Println("최대 속도(100%)로 다운로드합니다.")
					break
				}

				sp, err := strconv.Atoi(speedChoice)
				if err != nil || sp < 1 || sp > 5 {
					fmt.Println("잘못된 선택입니다. 1~5 사이의 번호를 입력해주세요.")
					continue
				}

				speedOption = speedMapping[sp]
				fmt.Printf("선택된 속도: %s\n", speedOption)
				break
			}
		}

		// 최종 정보 확인 (개선된 UI)
		fmt.Println("\n┌─────────────────────────────────────────────┐")
		fmt.Println("│             다운로드 정보 확인               │")
		fmt.Println("├─────────────────────────────────────────────┤")
		fmt.Printf("│ 채널명: %-37s │\n", channelName)
		fmt.Printf("│ 제목: %-40s │\n", videoTitle)
		fmt.Println("├─────────────────────────────────────────────┤")
		fmt.Printf("│ 파일명: %-38s │\n", autoFilename)
		fmt.Printf("│ 저장 위치: %-35s │\n", outputFolder)
		fmt.Println("├─────────────────────────────────────────────┤")

		// 품질 정보 표시
		qualityDisplay := ""
		for _, q := range qualities {
			if q.ID == selectedQuality {
				qualityDisplay = q.Quality
				break
			}
		}
		fmt.Printf("│ 화질: %-40s │\n", qualityDisplay)

		// 속도 표시
		fmt.Printf("│ 다운로드 속도: %-31s │\n", speedOption)

		// 구간 정보 표시
		sectionDisplay := "전체"
		if downloadSection != "" {
			sectionDisplay = downloadSection
		}
		fmt.Printf("│ 다운로드 구간: %-31s │\n", sectionDisplay)

		// 성인 컨텐츠 인증 정보 표시
		if isAdultContent {
			fmt.Printf("│ 성인 컨텐츠 인증: %-29s │\n", "사용함")
		}

		fmt.Println("└─────────────────────────────────────────────┘")

		fmt.Print("\n다운로드를 시작할까요? (Y/n): ")
		scanner.Scan()
		confirm := strings.ToLower(strings.TrimSpace(scanner.Text()))

		// Enter키나 'y'를 입력하면 진행
		if confirm != "" && confirm != "y" {
			fmt.Println("다운로드가 취소되었습니다.")
			fmt.Print("계속하려면 Enter를 누르세요.")
			scanner.Scan()
			continue
		}

		// 다운로드 시작
		fmt.Println("\n다운로드를 시작합니다. 잠시만 기다려주세요...")
		outputFile := filepath.Join(outputFolder, autoFilename)

		// 다운로드 시작 시간 기록
		downloadStartTime := time.Now()

		err = downloader.DownloadVOD(vodURL, selectedQuality, outputFolder, autoFilename, speedOption, downloadSection)

		// 다운로드 종료 시간으로 소요 시간 계산
		elapsedTime := time.Since(downloadStartTime)

		if err != nil {
			fmt.Printf("\n❌ 다운로드 중 오류가 발생했습니다: %v\n", err)
			fmt.Print("\n계속하려면 Enter를 누르세요.")
			scanner.Scan()
			continue
		}

		// 성공 메시지 및 파일 정보 표시
		fileInfo, _ := os.Stat(outputFile)
		var fileSize int64
		if fileInfo != nil {
			fileSize = fileInfo.Size()
		}

		fmt.Println("\n┌─────────────────────────────────────────────┐")
		fmt.Println("│             다운로드 완료!                   │")
		fmt.Println("├─────────────────────────────────────────────┤")
		fmt.Printf("│ 파일명: %-38s │\n", autoFilename)
		fmt.Printf("│ 저장 위치: %-35s │\n", outputFolder)

		if fileSize > 0 {
			fileSizeStr := ""
			if fileSize < 1024*1024 {
				fileSizeStr = fmt.Sprintf("%.2f KB", float64(fileSize)/1024)
			} else if fileSize < 1024*1024*1024 {
				fileSizeStr = fmt.Sprintf("%.2f MB", float64(fileSize)/(1024*1024))
			} else {
				fileSizeStr = fmt.Sprintf("%.2f GB", float64(fileSize)/(1024*1024*1024))
			}
			fmt.Printf("│ 파일 크기: %-35s │\n", fileSizeStr)
		}

		// 다운로드 소요 시간 표시
		elapsedMinutes := int(elapsedTime.Minutes())
		elapsedSeconds := int(elapsedTime.Seconds()) % 60
		fmt.Printf("│ 소요 시간: %-35s │\n", fmt.Sprintf("%d분 %d초", elapsedMinutes, elapsedSeconds))
		fmt.Println("└─────────────────────────────────────────────┘")

		// 다시 실행 여부 확인
		fmt.Print("\n다른 영상을 다운로드 하시겠습니까? (Y/n): ")
		scanner.Scan()
		runAgain := strings.ToLower(strings.TrimSpace(scanner.Text()))
		if runAgain != "" && runAgain != "y" {
			break
		}

		fmt.Println("\n──────────────────────────────────────────────")
	}

	fmt.Println("\n프로그램을 종료합니다. 이용해주셔서 감사합니다!")
	fmt.Print("Enter 키를 누르면 창이 닫힙니다...")
	scanner.Scan()
}
