// 파일 이름 규칙(템플릿) 상수. 문구가 아니라 코드 상수다(content.md §2 기술 상수).
// 기본 템플릿은 코어 `chzzk_core::naming::DEFAULT_TEMPLATE`과 같아야 한다: 입력칸에 보이는 값이고, 같은 문자열을
// 저장하면 셸이 "규칙 없음(기본 이름)"으로 바꿔 저장한다(docs/design/features/filename-template.md T1).
export const DEFAULT_FILE_NAME_TEMPLATE = '{prefix} {channel} - {title}';
