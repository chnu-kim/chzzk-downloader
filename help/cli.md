# 명령줄로 받기

창을 열지 않고 터미널에서 영상을 받을 수 있어요. 앱과 같은 로그인과 같은 설정을 쓰고, 내 채널과 맡은 채널의 영상만 받을 수 있어요. 앱이 열려 있으면 실행되지 않으니 앱을 닫은 뒤 써 주세요.

먼저 로그인해 주세요. 앱에서 이미 로그인했다면 그대로 써요. 앱 없이 하려면 아래 login 명령을 실행해 주세요. 이 컴퓨터의 브라우저가 열려요. 화면이 없는 기기에서는 로그인할 수 없어요.

Windows에서는 설치 폴더의 chzzk-cli.exe를 써 주세요. chzzk-app.exe가 아니에요. 보통 %LOCALAPPDATA%\VOD 클립 다운로더 폴더에 있어요. macOS에서는 앱을 한 번 연 뒤 응용 프로그램 폴더의 앱 안에 있는 Contents/MacOS/chzzk-app을 쓰고, Linux에서는 설치한 chzzk-app이나 AppImage 파일을 그대로 쓰면 돼요. Windows가 아닌 곳에서는 chzzk-cli.exe 대신 chzzk-app을 쓰면 돼요.

```
chzzk-app login
chzzk-app info https://chzzk.naver.com/video/1234567
chzzk-app download https://chzzk.naver.com/video/1234567 --quality 720p
chzzk-app download https://chzzk.naver.com/video/1234567 --audio
chzzk-app status
```

download는 주소를 여럿 줄 수 있고 차례로 받아요. 받은 파일의 경로는 한 줄씩 출력하고 진행은 따로 보여요. 같은 이름의 파일이 있으면 건너뛰어요. 받다 만 파일이 있으면 이어받아요.

--quality는 화질 라벨을, --out은 저장 폴더를 정해요. 없으면 앱 설정을 따라요. --range는 빠른 다시보기의 일부만 받고, --rate는 이번 실행의 속도 상한이에요. --overwrite는 같은 이름의 파일을 덮어쓰고, --audio는 영상 없이 오디오만 받아요. --audio는 --quality와 함께 쓸 수 없어요.

받은 기록은 앱의 목록에도 남고, 마지막으로 고른 화질과 최근 영상도 앱과 같이 바뀌어요. 생방송은 앱에서 녹화해 주세요.

종료 코드는 0이 성공, 1이 실패, 2가 사용법 오류, 3이 로그인 필요, 4가 받을 수 없는 영상, 5가 앱이 열려 있음, 130이 Ctrl+C로 일시정지했다는 뜻이에요.

받는 중에 Ctrl+C를 한 번 누르면 받던 파일을 남기고 멈춰요. 같은 명령을 다시 실행하면 이어받아요. 두 번 누르면 바로 끝내요.

설치할 때 명령 경로에는 등록하지 않아요. 자주 쓴다면 터미널 설정 파일에 아래처럼 한 줄을 더해 주세요.

```
alias chzzk="/Applications/VOD 클립 다운로더.app/Contents/MacOS/chzzk-app"
```

Windows PowerShell 5에서 출력을 다른 명령으로 넘길 때 한글이 깨지면 아래 명령을 먼저 실행해 주세요.

```
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
```

앱에서 [문제 보고용 정보 복사]를 누른 뒤 관리자에게 보내 주세요. 복사한 내용에는 채널 이름이나 로그인 정보가 들어가지 않아요. 관리자는 쿠키나 비밀번호를 절대 묻지 않아요.
