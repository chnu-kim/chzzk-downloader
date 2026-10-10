// 한국어 문구(해요체). 랜딩·관리·로그인 흐름 화면 전부(§9.5·§8).
// 값의 원천은 docs/design/system/content.md §15.3이다(굵은 글자 그대로). 키는 중첩 객체이고 경로는 `.`로 잇는다(예 linkGone.title).
// 규칙: 요청은 ‘해 주세요’ 하나, 제목·라벨에는 마침표 없음, 본문에는 있음, 따옴표는 ‘ ’(content.md §3·§6).
// 허가 라벨 하나를 `allow`와 감사 기록 `audit.allow`(동작 이름으로 찾는 표)가 같이 쓴다(DC11: 같은 값의 키를 둘 두지 않는다)
const ALLOW_LABEL = "허가";

export const COPY = {
  siteName: "치지직 다운로더",
  // 랜딩 <title>·OG 제목. htmlPage가 이 값이면 " · 앱 이름" 꼬리를 붙이지 않는다
  siteTitle: "치지직 다운로더 — 비공식 다시보기·클립 다운로더",
  errorTitlePrefix: "오류: ",
  loginTitle: "치지직 다운로더 로그인",
  loginWarning: "치지직 다운로더 앱에서 직접 시작한 로그인이 아니면 이 창을 닫아 주세요. 다른 사람이 보낸 주소라면 계속하지 마세요. 로그인 뒤 주소창에 나오는 주소는 다른 사람에게 보내지 마세요.",
  loginContinue: "계속",
  // 안내·오류 페이지: 제목이 무슨 일인지, 본문이 다음에 할 일을 말한다(web.md §6.2). 같은 본문은 키 하나를 같이 쓴다
  linkGone: { title: "로그인 주소가 만료됐어요", body: "앱에서 다시 로그인해 주세요." },
  linkUsed: { title: "이미 사용한 로그인 주소예요" },
  badRequest: { title: "요청을 확인할 수 없어요", body: "페이지를 새로 연 뒤 다시 시도해 주세요." },
  rateLimited: { title: "요청이 너무 많아요" },
  busy: { title: "지금은 로그인 요청이 많아요" },
  retryLater: { body: "잠시 뒤 다시 시도해 주세요." },
  badFormat: { title: "요청 형식이 맞지 않아요" },
  adminOnly: { title: "관리자만 볼 수 있어요" },
  outdatedApp: { title: "앱을 업데이트해야 해요", body: "이 사이트 첫 화면에서 새 버전을 받아 설치해 주세요." },
  doneOk: { title: "로그인했어요" },
  doneDenied: {
    title: "이 채널은 사용 허가가 없어요",
    body: "관리자에게 채널 이름을 알려 주세요. 다른 계정으로 로그인하려면 네이버에서 먼저 로그아웃해 주세요.",
    next: "허가를 받은 뒤 다시 로그인해 주세요.",
  },
  doneCancelled: { title: "로그인을 취소했어요", body: "처음 화면에서 다시 로그인할 수 있어요." },
  // body = 앱 흐름(또는 흐름을 모를 때), webBody = 웹 흐름
  doneFailed: { title: "로그인하지 못했어요", body: "앱에서 다시 시도해 주세요.", webBody: "처음 화면에서 다시 로그인해 주세요." },
  // 웹 흐름의 실패 × 카카오톡 인앱에서만 덧붙이는 한 단락(막지 않고 실패 뒤에만 보충한다, web.md §6.1)
  inAppHint: "카카오톡 안에서 연 화면에서는 로그인이 끊길 수 있어요. 기본 브라우저에서 이 주소를 다시 열어 주세요.",
  channelLabel: "채널",
  channelIdLabel: "채널 ID",
  home: "처음으로",
  // csrf·Origin이 맞지 않은 관리 POST의 오류 페이지에서 원래 화면으로 가는 링크(web.md §6.2)
  reloadAdmin: "관리 화면 새로 열기",
  anonLead: "허가받은 채널만 쓸 수 있어요.",
  // 단계 (e) 배선이 미리 넣은 키(content.md §15.3·§11 값 그대로). 참조는 각 묶음이 만든다(DC11은 그 뒤에 0이 된다)
  landing: {
    consent: {
      collect: "로그인하면 채널 이름과 채널 ID만 알게 돼요.",
      use: "허가 확인과 ‘내 기기’ 표시에만 써요.",
      exclude: "네이버 비밀번호는 받지 않아요.",
      revoke: "로그인한 기기는 ‘내 기기’에서 끊을 수 있어요.",
    },
    // 자리표시: 출시 전 사람이 실제 연락 수단으로 바꾼다(저장소에 실제 값을 두지 않는다)
    contact: "문의 연락처는 출시 전에 채워요.",
  },
  loginForFiles: "로그인하면 내 컴퓨터용 설치 파일이 보여요.",
  loginTwice: "이 페이지에서 로그인했어도 앱을 처음 열 때 한 번 더 로그인해요.",
  mobileBlock: "컴퓨터에서 받는 앱이에요. 휴대폰에는 설치할 수 없어요. 컴퓨터에서 이 주소를 열어 주세요.",
  macXattrNote: "이 명령은 ‘인터넷에서 받은 파일’ 표시만 지워요. 이 명령 말고 다른 명령을 붙여넣으라고 하지 않아요. 그런 안내를 받았다면 사기예요.",
  winSac: "스마트 앱 컨트롤이 켜져 있으면 설치할 수 없어요. 끄면 다시 켤 수 없으니 관리자에게 먼저 물어 주세요.",
  // 골격(헤더 배지·skip link·바닥글 고지, web.md §3). 고지 둘은 앱 ko.ts notice.*와 같은 값이다(DC6)
  pill: "비공식 도구",
  skipLink: "본문으로 건너가기",
  // 헤더 nav의 이름(보조 기술이 읽는다)
  siteNav: "사이트",
  notice: {
    unofficial: "치지직 다운로더는 네이버나 치지직과 관련 없는 비공식 도구예요. 치지직과 NAVER는 NAVER Corp.의 상표일 수 있어요. 이 앱은 로그인한 채널의 영상과 클립만 받아요.",
    short: "비공식 도구예요 · 네이버·치지직과 제휴하거나 보증받지 않았어요",
  },
  // 랜딩 OG·description(content.md §11). 로그인 여부·채널·버전과 무관한 고정 문구
  ogDescription: "내 치지직 다시보기와 클립을 내 컴퓨터에 받아요. 네이버·치지직과 무관한 비공식 도구예요.",
  // 헤더 nav·바닥글·읽기 페이지 제목이 같이 쓴다(같은 값의 키는 하나, content.md §19-14)
  helpTitle: "도움말",
  privacyTitle: "개인정보 처리방침",
  licensesTitle: "오픈소스 라이선스",
  loginLink: "로그인",
  // 도움말 첫 문단(웹이 앱보다 새로울 수 있다, web.md §10)과 절 차례의 이름
  helpIntro: "화면이 앱과 다르면 앱을 업데이트해 주세요.",
  helpToc: "차례",
  // 개인정보 처리방침(web.md §10, 계약 §7-1). 코드에 있는 사실만 적는다. 기간 숫자는 코드 상수가 값을 넘기고(함수 값),
  // 관리자(운영하는 사람)와 연락처는 출시 전에 사람이 채우는 자리표시다(저장소에 실제 값을 두지 않는다)
  privacy: {
    intro: { body: "이 사이트와 앱의 로그인 서버가 받는 정보와 그 쓰임을 적었어요." },
    collect: {
      title: "받는 정보",
      body: "로그인하면 치지직이 알려 주는 채널 이름과 채널 ID를 받아요. 로그인한 기기를 구분하려고 앱 버전이나 브라우저 같은 기기 정보와 로그인한 시각도 적어 둬요.",
    },
    use: { title: "쓰는 곳", body: "허가받은 채널인지 확인하고 ‘내 기기’에 보여 주는 데만 써요. 광고나 통계에는 쓰지 않아요." },
    exclude: {
      title: "받지 않는 정보",
      body: "네이버 비밀번호와 네이버 로그인 정보는 받지 않아요. 접속 주소(IP)는 요청이 너무 많은지 살피는 데만 쓰고 그대로 저장하지 않아요.",
    },
    cookie: { title: "쿠키", body: "로그인 상태를 기억하려고 이 사이트의 쿠키를 써요. 광고용 쿠키는 쓰지 않아요." },
    keep: {
      title: "보관 기간",
      body: "아래 기간이 지나면 지워져요.",
      web: (hours: number): string => `웹 로그인은 ${hours}시간 동안 유지돼요.`,
      app: (idleDays: number, maxDays: number): string => `앱 로그인은 쓰지 않으면 ${idleDays}일 뒤에, 계속 써도 ${maxDays}일 뒤에는 끝나요.`,
      revoked: (days: number): string => `끊은 기기의 기록은 ${days}일 동안 남아요.`,
      denied: (days: number, cap: number): string => `거부된 시도는 마지막 시도 뒤 ${days}일 동안, 채널 ${cap}개까지 남아요.`,
      audit: (cap: number): string => `관리자가 허가를 바꾼 기록은 기간이 아니라 최근 ${cap}건까지 남아요.`,
      flow: (minutes: number): string => `로그인을 진행하는 중의 정보는 ${minutes}분 안에 지워져요.`,
    },
    abroad: { title: "해외 서버", body: "이 사이트는 Cloudflare의 서비스에서 돌아요. 그래서 위 정보가 한국 밖의 서버에 저장될 수 있어요." },
    cut: { title: "끊는 길", body: "‘내 기기’에서 로그인한 기기를 언제든 끊을 수 있어요. 앱에서는 설정 › 계정에서 로그아웃할 수 있어요." },
    contact: { title: "관리자와 연락처", body: "정보를 지워 달라는 요청이나 문의는 아래 연락처로 보내 주세요.", label: "연락처" },
    placeholder: { admin: "{관리자}", contact: "{연락처}" },
  },
  // flash 알림·오류 요약(web.md §6.3)
  sessionGone: "로그인이 만료됐어요. 다시 로그인한 뒤 같은 동작을 해 주세요.",
  alreadyDone: "이미 처리됐어요.",
  errorSummary: "확인해 주세요",
  loginWithChzzk: "치지직으로 로그인",
  signedInAs: (name: string): string => `‘${name}’ 채널로 로그인했어요.`,
  adminLink: "관리",
  downloadsTitle: "설치 파일",
  // 큰 버튼 아래 한 줄. 날짜는 D49 형식(2026. 10. 3.)이고 최소 버전은 호출하는 쪽이 이름까지 넘긴다
  metaLine: (v: string, d: string | null, minOs: string): string => (d === null ? `버전 ${v} · ${minOs} 이상` : `버전 ${v} · ${d} · ${minOs} 이상`),
  getFor: (os: string): string => `${os}용 받기`,
  // 허용 사용자에게만: 첫 실행 경고를 미리 알린다(앱 문제가 아니라는 뜻까지)
  warnPreview: "처음 열 때 경고가 나올 수 있어요. 앱이 문제라는 뜻이 아니에요.",
  otherOs: "다른 운영체제",
  filesCaption: (v: string): string => `설치 파일(버전 ${v})`,
  colOs: "운영체제",
  colMinVersion: "최소 버전",
  fileCheck: "파일 확인(선택)",
  fileCheckLead: "받은 파일이 올바른지 확인하려면 아래 SHA-256 값과 비교할 수 있어요.",
  installTitle: "설치하기",
  loginSectionTitle: "처음 열면 로그인해요",
  loginSectionBody: "앱에서 [치지직으로 로그인]을 누르면 브라우저가 열려요. 받는 것은 채널 이름과 채널 ID뿐이고 네이버 비밀번호는 받지 않아요. 허가되지 않은 채널이면 이유와 다음에 할 일을 앱이 알려 줘요.",
  helpSectionTitle: "막히면",
  // content.md §11 "문제가 있을 때" 상수
  reportHelp: "앱에서 [문제 보고용 정보 복사]를 누른 뒤 관리자에게 보내 주세요. 복사한 내용에는 채널 이름이나 로그인 정보가 들어가지 않아요. 관리자는 쿠키나 비밀번호를 절대 묻지 않아요.",
  // 휴대폰 블록(web.md §5.1 1번): 읽기 전용 칸의 라벨과 한 줄 안내
  pageAddress: "이 페이지 주소",
  mobileHint: "이 주소를 카카오톡 ‘나와의 채팅’에 붙여넣어 컴퓨터에서 열어도 돼요.",
  // Linux 설치 단계(AppImage는 실행 권한, deb는 apt)
  linuxAppImage: "AppImage는 libfuse2(Ubuntu 24.04는 libfuse2t64)를 설치한 뒤 아래 명령으로 실행 권한을 주고 열어 주세요.",
  linuxDeb: "deb는 아래 명령으로 설치해요. 관리자 권한이 필요할 수 있어요.",
  // 버전을 아직 모를 때(비로그인·목록 없음) 명령에 넣는 자리표시
  savedFile: "파일이름",
  noRelease: "아직 올라온 버전이 없어요.",
  releaseUnavailable: "설치 파일 목록을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  colFile: "파일",
  artifact: {
    dmg: "macOS(Apple Silicon)",
    setup: "Windows 설치 프로그램(권장)",
    msi: "Windows MSI",
    appimage: "Linux AppImage",
    deb: "Linux deb(Debian·Ubuntu)",
  },
  appleSiliconOnly: "macOS는 Apple Silicon(M1 이후) Mac만 지원해요.",
  // macOS: 공증하지 않은 앱이라 처음 열 때 손상됐다는 경고가 나온다(W9 실기기 확인). 설정의 열기 버튼·우클릭 열기로는 풀리지 않아
  // 응용 프로그램으로 옮긴 뒤 격리 표시를 지우는 길만 안내한다. 앱 이름은 tauri.conf.json productName(worker-config.mjs checkLandingAppName)
  macDamaged: "처음 열 때 앱이 손상돼 열 수 없다는 경고가 나와도 휴지통으로 옮기지 마세요. Apple 공증을 받지 않은 앱이라 macOS가 막는 거예요. 앱이 문제라는 뜻이 아니에요. 아래 순서대로 해 주세요.",
  // 단계 세 개는 ol 항목이다(번호는 마크업이 붙인다)
  macMove: "받은 .dmg를 열고 앱을 ‘응용 프로그램’ 폴더로 옮겨 주세요.",
  macTerminal: "터미널을 열고 아래 명령을 붙여넣어 실행해 주세요.",
  macXattr: 'xattr -dr com.apple.quarantine "/Applications/치지직 다운로더.app"',
  // [잠정] 실기 전까지 조건문이다: 단추가 없으면 다음 단계로(web.md §5.2, §14-1)
  macOpenAnyway: "처음 열 때 경고가 나오면 시스템 설정 › 개인정보 보호 및 보안에서 ‘그래도 열기’를 눌러 주세요. 그 단추가 없으면 다음 단계로 넘어가 주세요.",
  winSmartScreen: "Windows의 ‘PC 보호’ 창이 뜨면 ‘추가 정보’를 누른 뒤 ‘실행’을 눌러 주세요.",
  devicesTitle: "내 기기",
  devicesLead: "이 채널로 로그인한 앱과 브라우저예요. 모르는 기기가 있으면 끊어 주세요.",
  devicesEmpty: "로그인한 기기가 없어요.",
  // 시각은 한국 시간이다. 열 제목에는 시간대를 쓰지 않고 표 caption에 한 번 적는다
  tableTimeNote: "시각은 한국 시간이에요.",
  colKind: "종류",
  colClient: "기기 정보",
  colCreated: "로그인한 시각",
  colLastSeen: "마지막 확인",
  kindApp: "앱",
  kindWeb: "웹",
  thisBrowser: "이 브라우저",
  revoke: "끊기",
  logout: "로그아웃",
  adminsTitle: "관리자",
  adminsNote: "관리자는 서버 설정에서만 바꿀 수 있어요.",
  allowTitle: "허가한 채널",
  allowEmpty: "허가한 채널이 없어요.",
  colName: "이름",
  colNote: "메모",
  colAddedBy: "추가한 관리자",
  colAddedAt: "추가한 시각",
  colActive: "활성 로그인",
  disallow: "허가 빼기…",
  // 허가 빼기 확인 페이지(D54, web.md §7.3). 최종 버튼 라벨은 audit.disallow를 같이 쓴다
  confirmDisallow: {
    title: "이 채널의 허가를 뺄까요?",
    body: (name: string, n: number): string => `‘${name}’ 채널의 허가를 빼면 로그인한 앱과 브라우저 ${n}개가 다음에 서버에 연결할 때 끊겨요. 다시 허가해도 끊긴 기기는 새로 로그인해야 해요.`,
    back: "허가한 채널 목록으로",
  },
  addTitle: "채널 ID로 추가",
  noteLabel: "메모(선택, 64자까지)",
  add: "추가",
  deniedTitle: "거부된 시도",
  deniedEmpty: "거부된 시도가 없어요.",
  colAttempts: "횟수",
  colFirstAt: "처음",
  colLastAt: "마지막",
  allow: ALLOW_LABEL,
  dismiss: "지우기",
  sessionsEmpty: "활성 로그인이 없어요.",
  colRecovered: "복구",
  auditTitle: "감사 기록",
  auditEmpty: "기록이 없어요.",
  colAt: "시각",
  colActor: "한 사람",
  // 감사 기록의 동작 열, 그리고 버튼 열 머리(빈 <th>를 두지 않는다, web.md §8. .sr-only로 숨긴다)
  colAction: "동작",
  colTarget: "대상",
  audit: {
    allow: ALLOW_LABEL,
    disallow: "허가 빼기",
    revoke_session: "로그인 끊기",
    reuse_detected: "재사용 감지",
    refresh_recovered: "로그인 복구",
    dismiss: "거부 기록 지우기",
  },
  bootstrapAdmin: { title: "아직 관리자가 정해지지 않았어요" },
  badBody: "요청을 읽지 못했어요.",
  badChannelId: "채널 ID는 영문 소문자와 숫자 32자리예요.",
  isAdmin: { title: "관리자 채널은 뺄 수 없어요" },
  adminNoAllow: { title: "관리자 채널은 허가 목록에 넣지 않아요", body: "관리자 설정에서만 정해요." },
  notFound: { title: "대상을 찾지 못했어요", body: "이미 처리됐을 수 있어요." },
} as const;
