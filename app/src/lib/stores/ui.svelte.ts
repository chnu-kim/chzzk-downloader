// 창 전체의 뷰와 단축키 연결(§10 App·GlobalShortcuts).

export type View = 'home' | 'settings' | 'login';

/** URL 입력줄이 단축키에 내놓는 동작(Mod+L, 입력칸 밖 Mod+V). */
export interface UrlTarget {
  focus(): void;
  /** 붙여넣은 글을 입력줄에 넣고 바로 불러온다(§8.10) */
  paste(text: string): void;
}

/** Esc 처리기. 처리했으면 true. */
export type EscapeHandler = () => boolean;

export class UiStore {
  view: View = $state('home');
  urlTarget: UrlTarget | null = null;
  /** 설정의 쿠키 섹션을 펼쳐 열어 달라는 요청(오류 동작 `openCookieSettings`) */
  openCookieSection = $state(false);
  #escape: EscapeHandler[] = [];

  /**
   * Esc 처리기를 쌓는다. 나중에 쌓은 것(더 안쪽)이 먼저다(§10 단축키: 불러오기 취소 → 카드 닫기 → … → 설정에서 뒤로).
   * 대화상자는 스스로 Esc를 받아 멈추므로 여기에 넣지 않는다. 돌려준 함수로 뺀다.
   */
  onEscape(handler: EscapeHandler): () => void {
    this.#escape.push(handler);
    return () => {
      const i = this.#escape.lastIndexOf(handler);
      if (i >= 0) this.#escape.splice(i, 1);
    };
  }

  /** Esc 한 번. 안쪽부터 처리기를 부르고, 아무도 받지 않으면 설정·로그인에서 홈으로 돌아간다. */
  escape(): boolean {
    for (let i = this.#escape.length - 1; i >= 0; i--) {
      if (this.#escape[i]()) return true;
    }
    if (this.view === 'settings') {
      this.view = 'home';
      return true;
    }
    return false;
  }

  goSettings(opts: { cookies?: boolean } = {}) {
    if (opts.cookies) this.openCookieSection = true;
    this.view = 'settings';
  }

  goHome() {
    this.view = 'home';
  }
}

export const ui = new UiStore();

/** macOS는 Cmd, 그 밖은 Ctrl(§10 단축키). */
export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

export function modKey(e: KeyboardEvent, mac = isMac()): boolean {
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

/** 버튼 안 단축키 표시: `⌘↩` / `Ctrl+Enter` */
export function modLabel(key: 'Enter', mac = isMac()): string {
  return mac ? '⌘↩' : `Ctrl+${key}`;
}
