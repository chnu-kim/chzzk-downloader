// copy deck(docs/design/app.md §9 "그 밖의 문구", ui-visual.md §9). 화면 문구는 여기에만 둔다.
// 해요체. `{name}` 자리는 `t(key, { name })`가 채운다.
// `toast.completed`와 앱 이름은 Rust(`app/src-tauri/src/sink.rs`, OS 알림)에도 있다. 고치면 함께 고친다.

export const ko = {
  'app.title': '치지직 다운로더',
  'header.settings': '설정',
  'header.back': '뒤로',
  'common.close': '닫기',

  'url.label': '영상 주소',
  'url.placeholder': '치지직 VOD나 클립 주소를 붙여넣으세요',
  'url.submit': '불러오기',
  'url.hintExample': '예: https://chzzk.naver.com/video/1234567',
  'url.dropHere': '여기에 놓으면 불러와요',
  'url.clipboard.title': '복사한 주소가 있어요',
  'url.clipboard.load': '불러오기',

  'recent.title': '최근 VOD',
  'recent.reopen': '다시 열기',

  'resolve.loading': '영상 정보를 불러오는 중이에요…',
  'resolve.cancel': '취소',
  'resolve.done': '영상 정보를 불러왔어요',

  'card.title': '불러온 영상',
  'card.close': '닫기',
  'card.download': '다운로드',
  'card.cancel': '취소',
  'card.added': '다운로드 목록에 넣었어요',

  'kind.liveRewind': '빠른 다시보기',
  'kind.vod': '일반 VOD',
  'kind.clip': '클립',
  'kind.liveRewind.tip': '방송이 끝난 뒤 바로 볼 수 있는 다시보기예요. 조각으로 나눠 받아요.',
  'badge.adult': '19',
  'badge.adult.label': '연령 제한',

  'meta.liveDate': '{date} 방송',
  'meta.publishDate': '{date} 업로드',

  'quality.title': '화질',
  'quality.sizeEstimate': '약 {size}',

  'folder.label': '저장 폴더',
  'folder.change': '변경',

  'filename.label': '파일 이름',
  'filename.reset': '되돌리기',
  'filename.willSaveAs': '저장될 이름: {name}',
  'filename.ext': '.mp4',

  'conflict.exists': '같은 이름의 파일이 이미 있어요.',
  'conflict.number': '번호 붙여 새로 저장',
  'conflict.overwrite': '덮어쓰기',
  'conflict.partial': '이전에 받다 만 파일이 있어요 ({size}). 이어서 받아요.',
  'conflict.partial.fresh': '처음부터 받기',
  'conflict.partial.continue': '이어서 받기',
  'conflict.partial.freshChosen': '받다 만 파일을 지우고 처음부터 받아요.',
  'conflict.partialOther': '다른 화질로 받다 만 파일이 있어요. 처음부터 받아요.',
  'conflict.inQueue': '이 파일은 이미 다운로드 목록에 있어요.',
  'conflict.showInList': '목록에서 보기',

  'list.title': '다운로드',
  'list.clearFinished': '완료 항목 지우기',
  'list.empty.title': '아직 받은 영상이 없어요',
  'list.empty.body': '위에 치지직 영상 주소를 붙여넣으세요',
  'list.group.running': '받는 중 {n}',
  'list.group.queued': '대기 {n}',
  'list.group.stopped': '멈춤 {n}',
  'list.group.finished': '완료 {n}',

  'job.queued': '대기 중 · 앞에 {n}개',
  'job.phase.resolving': '준비 중',
  'job.phase.downloading': '받는 중',
  'job.phase.reresolving': '영상 링크를 새로 받는 중이에요',
  'job.phase.finalizing': '마무리 중',
  'job.pausing': '멈추는 중…',
  'job.paused': '일시정지됨 · {bytes} 받음',
  'job.interrupted': '중단됨 · {bytes} 받음',
  'job.completed': '완료 · {size} · {time}',
  'job.completedMissing': '완료 · 파일을 찾을 수 없어요',
  'job.skipped': '이미 같은 이름의 파일이 있어 받지 않았어요',
  'job.eta': '{t} 남음',
  'job.etaUnknown': '남은 시간 계산 중',
  'job.segments': '조각 {done}/{total}',
  'job.resumedFrom': '{size}부터 이어받음',

  'action.pause': '일시정지',
  'action.resume': '이어받기',
  'action.retry': '다시 시도',
  'action.restartFresh': '처음부터 다시 받기',
  'action.cancel': '취소',
  'action.openFile': '파일 열기',
  'action.openFolder': '폴더 열기',
  'action.remove': '목록에서 지우기',
  'action.copyUrl': '주소 복사',
  'action.copyReport': '문제 보고용 정보 복사',
  'action.reresolve': '다시 불러오기',
  'action.overwriteAndDownload': '덮어쓰고 받기',
  'action.close': '닫기',
  'action.openCookieSettings': '네이버 로그인 정보 설정',
  'action.reenterCookies': '로그인 정보 다시 넣기',
  'action.openConfigFolder': '설정 폴더 열기',
  'action.showInList': '목록에서 보기',

  'toast.completed': "'{title}' 다운로드를 마쳤어요",
  'toast.copied': '복사했어요',
  'toast.copyFailed': '복사하지 못했어요. 다시 시도해 주세요.',
  'toast.reportHasPath': '복사한 정보에 파일 경로가 들어 있어요',

  'banner.interrupted': '지난번에 받다가 멈춘 다운로드가 {n}개 있어요.',
  'banner.resumeAll': '모두 이어받기',
  'banner.settingsError': '설정을 저장하지 못했어요. 디스크 공간과 권한을 확인해 주세요.',
  'banner.sessionExpired': '로그인이 만료됐어요. 새 영상을 불러오려면 다시 로그인해 주세요.',

  'dialog.close.title': '다운로드를 멈추고 닫을까요?',
  'dialog.close.body': '받는 중인 영상이 {n}개 있어요. 닫으면 일시정지되고, 다음에 앱을 열면 이어받을 수 있어요.',
  'dialog.close.keep': '계속 받기',
  'dialog.close.confirm': '닫기',
  'dialog.cancel.title': '다운로드를 취소할까요?',
  'dialog.cancel.body': '지금까지 받은 {size}도 함께 지워져요.',
  'dialog.cancel.confirm': '취소하고 지우기',
  'dialog.cancel.back': '돌아가기',
  'dialog.legacy.title': '이전 버전 설정을 찾았어요',
  'dialog.legacy.body': '예전 치지직 다운로더의 저장 폴더와 최근 VOD {n}개{cookies}를 가져올까요?',
  'dialog.legacy.cookies': ', 네이버 로그인 정보',
  'dialog.legacy.import': '가져오기',
  'dialog.legacy.later': '나중에',

  'legacy.done': '설정을 가져왔어요',
  'legacy.notFound': '이 폴더에서 예전 설정을 찾지 못했어요',

  'settings.title': '설정',
  'settings.storage': '저장',
  'settings.defaultFolder': '기본 저장 폴더',
  'settings.download': '다운로드',
  'settings.parallel': '동시에 받는 영상 수',
  'settings.parallel.help': '둘 이상이면 빨라질 수 있지만 네트워크를 더 많이 써요.',
  'settings.segments': '빠른 다시보기 연결 수',
  'settings.segments.help':
    '빠른 다시보기는 영상을 작은 조각으로 나눠 받아요. 숫자가 클수록 빠르지만 네트워크를 더 많이 써요.',
  'settings.autoResume': '앱을 열면 멈춘 다운로드를 자동으로 이어받기',
  'settings.autoResume.help': '꺼져 있으면 위쪽 안내 줄에서 직접 이어받아요.',

  'settings.cookie.title': '고급: 네이버 로그인 정보',
  'settings.cookie.why':
    '연령 제한이나 구독자 전용 영상은 네이버에 로그인한 상태여야 받을 수 있어요. 브라우저의 네이버 로그인 쿠키 두 개를 넣으면 이 컴퓨터에만 저장되고, 치지직 영상 정보를 조회할 때만 쓰여요.',
  'settings.cookie.danger':
    '이 값은 비밀번호와 같아요. 다른 사람에게 보여 주지 마세요. 네이버에서 로그아웃하면 값이 만료돼 다시 넣어야 해요.',
  'settings.cookie.use': '로그인 정보 사용',
  'settings.cookie.saved': '저장됨',
  'settings.cookie.notSaved': '저장된 값 없음',
  'settings.cookie.save': '저장',
  'settings.cookie.clear': '지우기',
  'settings.cookie.howto': '값을 찾는 방법',
  'settings.cookie.bothRequired': '두 값을 모두 넣어 주세요',
  'settings.cookie.show': '값 보기',
  'settings.cookie.hide': '값 가리기',
  'settings.cookie.howto.steps':
    '1. 브라우저에서 chzzk.naver.com에 로그인해요. 2. F12를 눌러 개발자 도구를 열어요. 3. 애플리케이션(Application) > 쿠키 > https://chzzk.naver.com 을 열어요. 4. NID_AUT, NID_SES의 값을 각각 복사해 붙여넣어요.',

  'settings.legacy.title': '이전 버전',
  'settings.legacy.body': '예전 치지직 다운로더(명령줄 버전)의 설정과 최근 VOD를 가져와요.',
  'settings.legacy.pick': '폴더 선택해서 가져오기',
  'settings.legacy.last': '마지막 가져오기: {path}',

  'settings.about.title': '정보',
  'settings.about.version': '버전 {app} (코어 {core})',
  'settings.about.openConfig': '설정 폴더 열기',
  'settings.about.openLogs': '로그 폴더 열기',

  'auth.intro': '허가된 채널만 사용할 수 있어요. 치지직 계정으로 로그인하세요.',
  'auth.login': '치지직으로 로그인',
  'auth.pending.title': '브라우저에서 로그인해 주세요',
  'auth.pending.body': '로그인을 마치면 자동으로 넘어가요. 남은 시간 {mmss}',
  'auth.reopen': '브라우저 다시 열기',
  'auth.cancel': '취소',
  'auth.denied.title': '사용 허가가 없는 채널이에요',
  'auth.denied.body': '채널: {channelName}. 허가를 받으려면 관리자에게 채널 이름을 알려 주세요.',
  'auth.otherAccount': '다른 계정으로 로그인',
  'auth.expired': '로그인 시간이 지났어요. 다시 시도해 주세요.',
  'auth.cancelled': '로그인을 취소했어요.',
  'auth.error': '로그인 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.',
  'auth.retry': '다시 로그인',
  'auth.logout': '로그아웃',
  'auth.logout.confirm': '로그아웃할까요? 받는 중인 다운로드는 계속돼요.',
} as const;

export type CopyKey = keyof typeof ko;
export type CopyVars = Record<string, string | number>;

/** 문구를 꺼내 `{name}` 자리를 채운다. 값이 없는 자리는 그대로 둔다(빠진 값이 눈에 띄게). */
export function t(key: CopyKey, vars?: CopyVars): string {
  const s: string = ko[key];
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}
