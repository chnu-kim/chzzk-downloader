// OS별로 달라지는 화면 글자의 유일한 자리(system/platform.md §20). OS는 Rust가 준다(`AppInfo.platform`):
// 컴포넌트는 `navigator`를 읽지 않는다(design-lint DX5). 문자열은 copy deck의 `platform.*` 키에만 있다(design-copy DC9).
// macOS와 그 밖(Windows·Linux) 두 갈래뿐이다: 표의 모든 행이 Windows와 Linux에서 같다.
import type { Os } from './bindings';
import { t, type CopyKey } from './copy/ko';

export type OsFamily = 'mac' | 'other';

export function osFamily(os: Os): OsFamily {
  return os === 'macos' ? 'mac' : 'other';
}

/** 단축키 표기(§6): `{paste}` 힌트·[받기] 버튼의 Kbd, 쿠키 안내의 `{devtools}` */
const SHORTCUT = {
  paste: { mac: 'platform.mac.paste', other: 'platform.other.paste' },
  submit: { mac: 'platform.mac.submit', other: 'platform.other.submit' },
  /** 쿠키 안내 둘째 단계의 `{devtools}`(개발자 도구를 여는 키) */
  devtools: { mac: 'platform.mac.devtools', other: 'platform.other.devtools' },
} as const satisfies Record<string, Record<OsFamily, CopyKey>>;

export type Shortcut = keyof typeof SHORTCUT;

export function shortcutText(os: Os, s: Shortcut): string {
  return t(SHORTCUT[s][osFamily(os)]);
}

/** 완료 행·설정의 폴더 보기 버튼 라벨(D39): macOS [Finder에서 보기] / 그 밖 [폴더에서 보기] */
const REVEAL = { mac: 'platform.mac.reveal', other: 'platform.other.reveal' } as const satisfies Record<OsFamily, CopyKey>;

export function revealLabel(os: Os): string {
  return t(REVEAL[osFamily(os)]);
}

/** `Mod` 키(macOS ⌘, 그 밖 Ctrl)가 눌렸는가. 다른 쪽 수식 키가 함께 눌리면 아니다 */
export function modPressed(e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey'>, os: Os): boolean {
  return os === 'macos' ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}
