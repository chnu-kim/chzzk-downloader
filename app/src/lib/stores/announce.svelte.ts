// 루트의 aria-live="polite" 하나(system/patterns.md §1.5 LiveAnnouncer). 상태 전이와 불러오기 결과만 읽는다. 진행률 틱은 읽지 않는다.

class Announcer {
  message = $state('');
  #frame: number | null = null;

  /**
   * 같은 문장을 연달아 넣어도 다시 읽도록 한 번 비우고, 다음 프레임에 넣는다(숫자 타이머 없음: design-lint DX10).
   * 빈 값이 화면에 한 번 그려진 뒤에 새 글이 들어가야 보조 기술이 변화로 읽는다.
   */
  say(text: string) {
    this.message = '';
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = requestAnimationFrame(() => {
      this.message = text;
      this.#frame = null;
    });
  }
}

export const announcer = new Announcer();
