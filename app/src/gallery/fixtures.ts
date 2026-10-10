// 갤러리 고정 데이터(docs/design/system/governance.md §2.6). 한글 견본은 이 파일에만 둔다(design-lint DS6은 .svelte만 본다).
// 모두 합성 문장이다: 실제 채널 이름·영상 번호·제목을 옮기지 않는다(공개 저장소 규칙).
import type { ICON_BUTTON_ICONS } from '../lib/components/ui/vocab';

/** 글자 견본 네 종: 짧은 한글 · 긴 한글(여러 줄) · 공백 없는 영문 · 큰 숫자 */
export const TEXT = {
  short: '받기',
  long: '긴 제목이 들어오면 두 줄로 나뉘고 그래도 넘치면 잘려서 보이는 견본 문장이에요 이 문장은 일부러 길게 적었어요',
  unbroken: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  number: '1,234,567,890',
} as const;

export const TEXT_SAMPLES = [
  { id: 'short', text: TEXT.short },
  { id: 'long', text: TEXT.long },
  { id: 'unbroken', text: TEXT.unbroken },
  { id: 'number', text: TEXT.number },
] as const;

/** 섹션 제목(h2) */
export const TITLE = {
  page: '무색 갤러리',
  buttons: '버튼',
  iconButtons: '아이콘 버튼',
  fields: '입력 칸',
  select: '고르는 칸',
  switches: '스위치',
  radio: '라디오 묶음',
  disclosure: '펼침',
  notice: '알림',
  dialog: '대화상자',
  menu: '메뉴',
  badge: '배지',
  progress: '진행 막대',
  skeleton: '자리 표시',
  empty: '빈 상태',
  surface: '면과 행',
  toolbar: '툴바와 끌어 놓기',
  icons: '아이콘 시트',
} as const;

/** 상태 이름표(작은 글자) */
export const STATE_LABEL = {
  rest: '기본',
  disabled: '꺼짐',
  ariaDisabled: '잠깐 막힘',
  loading: '불러오는 중',
  invalid: '오류',
  readonly: '읽기 전용',
  open: '열림',
  selected: '선택',
  filled: '값 있음',
  required: '필수',
  on: '켜짐',
  off: '꺼짐',
  tone: '의미',
  size: '크기',
  withActions: '동작 있음',
  samples: '글자 견본',
} as const;

export const WHY = '지금은 할 수 없는 이유를 설명하는 문장이에요.';
export const ERROR_TEXT = '이 값은 쓸 수 없어요. 다시 확인해 주세요.';

export const FIELD = {
  label: '입력 칸',
  placeholder: '여기에 입력해요',
  value: '입력해 둔 값',
  secret: 'NID_AUT=0000000000',
  selectLabel: '고르기',
  switchLabel: '켜고 끄기',
  radioLabel: '하나 고르기',
} as const;

export const SELECT_OPTIONS = [
  { value: 'a', label: '첫째 선택지' },
  { value: 'b', label: TEXT.long },
  { value: 'c', label: TEXT.unbroken },
  { value: 'd', label: '고를 수 없는 선택지', disabled: true },
];

export const RADIO_OPTIONS = [
  { id: 'r1', value: 'one', label: '첫째', description: '짧은 설명이에요.' },
  { id: 'r2', value: 'two', label: TEXT.long, description: TEXT.long },
  { id: 'r3', value: 'three', label: TEXT.unbroken },
  { id: 'r4', value: 'four', label: '고를 수 없음', disabled: true },
] as const;

export const DISCLOSURE = {
  sectionTitle: '펼침 제목',
  inlineTitle: '펼침 글자',
  body: '펼치면 보이는 본문이에요. 자세한 설명이 여기에 들어가요.',
} as const;

export const NOTICE = {
  title: '알림 제목',
  body: '알림 본문이에요. 무슨 일이 있었는지 한두 문장으로 말해요.',
  action1: '다시 시도',
  action2: '자세히',
  action3: '닫기 전에 보기',
} as const;

export const DIALOG = {
  confirmTitle: '이 동작을 할까요?',
  confirmBody: '되돌릴 수 없는 동작이 아니에요. 필요하면 다시 할 수 있어요.',
  dangerTitle: '‘견본 제목’ 받기를 취소할까요?',
  dangerBody: '받던 부분은 지워지고 새로 받아야 해요.',
  customTitle: '값을 입력해요',
  loadingTitle: '창을 닫을까요?',
  loadingBody: '받는 중인 작업이 있어요.',
  safe: '그대로 두기',
  run: '실행하기',
  cancelRun: '취소하기',
  open: {
    confirm: '확인 대화상자',
    danger: '위험 대화상자',
    custom: '본문 있는 대화상자',
    loading: '진행 중 대화상자',
  },
} as const;

export const MENU = {
  label: '더 보기',
  text: '계정 메뉴',
  items: ['폴더 열기', '주소 복사', '목록에서 지우기', '지금은 쓸 수 없음'],
} as const;

export const PROGRESS = {
  label: '받는 정도',
  values: [0, 42, 100] as const,
  valuetext: (v: number | null) => (v == null ? '진행 정도를 알 수 없어요' : `${v}퍼센트 받았어요`),
} as const;

export const EMPTY = {
  title: '받을 주소를 붙여 넣어 보세요',
  body: '영상 주소를 복사해서 위 칸에 붙여 넣으면 화질을 고를 수 있어요.',
  steps: ['주소를 복사해요', '칸에 붙여 넣어요', '화질을 골라 받아요'],
  action: '주소 붙여 넣기',
} as const;

export const SURFACE = {
  groupLabel: '설정 묶음',
  cardTitle: '카드 제목',
  cardBody: '카드 본문이에요.',
  cardAction: '저장',
  rowLabel: '행 이름',
  rowHelp: '이 행이 하는 일을 한 줄로 설명해요.',
  rowValue: '/견본/경로/폴더',
  fieldLabel: '이름',
  fieldHelp: '입력 칸 아래 도움말이에요.',
  fieldAction: '바꾸기',
  readingText: '읽는 글이 들어가는 좁은 열이에요. 줄이 너무 길어지지 않게 폭을 줄여요.',
  contentText: '본문 열이에요.',
} as const;

export const TOOLBAR = {
  app: '앱 이름',
  back: '뒤로',
  settings: '설정',
  dropToggle: '끌어 놓기 안내 보기',
} as const;

/** 이 갤러리가 보여 주는 섹션 이름 전부(shots.spec이 같은 목록을 쓴다) */
export const SECTIONS = [
  'buttons',
  'icon-buttons',
  'fields',
  'select',
  'switches',
  'radio',
  'disclosure',
  'notice',
  'dialog',
  'menu',
  'badge',
  'progress',
  'skeleton',
  'empty',
  'surface',
  'toolbar',
  'icons',
] as const;


/** 아이콘 버튼의 접근 이름(글자 없는 버튼이라 이름이 곧 라벨이다) */
export const ICON_LABELS: Record<(typeof ICON_BUTTON_ICONS)[number], string> = {
  x: '닫기',
  ellipsis: '더 보기',
  'chevron-down': '아래로 펼치기',
  'chevron-up': '위로 접기',
  'chevron-left': '이전',
  'chevron-right': '다음',
  eye: '값 보기',
  'eye-off': '값 가리기',
  'arrow-left': '뒤로 가기',
  settings: '설정 열기',
};

export const KBD = 'Esc';

/** 이름표 조각 결합(템플릿 안 조각 결합은 DS6이 막는다) */
export const pair = (a: string, b: string) => `${a} · ${b}`;
