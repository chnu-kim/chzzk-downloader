// 루트의 aria-live="polite" 하나(§10 LiveAnnouncer). 상태 전이와 불러오기 결과만 읽는다. 진행률 틱은 읽지 않는다.

class Announcer {
  message = $state('');
  #handle: ReturnType<typeof setTimeout> | null = null;

  /** 같은 문장을 연달아 넣어도 다시 읽도록 한 번 비운 뒤 넣는다. */
  say(text: string) {
    this.message = '';
    if (this.#handle) clearTimeout(this.#handle);
    this.#handle = setTimeout(() => {
      this.message = text;
      this.#handle = null;
    }, 50);
  }
}

export const announcer = new Announcer();
