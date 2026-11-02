// 루트의 상주 라이브 영역 둘(system/patterns.md §1.5 LiveAnnouncer): polite 하나 + assertive 하나(오류 토스트·오류 배너만).
// 상태 전이, 불러오기 결과, 25% 단위 진행, 토스트·배너 문장을 읽는다. 1% 단위 진행률 틱은 읽지 않는다.
// 토스트·배너는 role 없이 그려지고 이 영역이 대신 읽는다(영역이 먼저 있어야 변화로 읽힌다, ADR-0033).

class Announcer {
  message = $state('');
  /** 오류 토스트·오류 배너용(assertive) */
  urgent = $state('');
  #frame: number | null = null;
  /** 다음 프레임에 넣으려고 기다리는 문장 */
  #pending = '';
  #urgentFrame: number | null = null;

  /**
   * 같은 문장을 연달아 넣어도 다시 읽도록 한 번 비우고, 다음 프레임에 넣는다(숫자 타이머 없음: design-lint DX10).
   * 빈 값이 화면에 한 번 그려진 뒤에 새 글이 들어가야 보조 기술이 변화로 읽는다.
   */
  say(text: string) {
    this.message = '';
    this.#pending = text;
    this.#schedule();
  }

  /**
   * 같은 프레임에 기다리는 문장이 있으면 그 앞에 붙여 한 번에 읽는다(`say`는 마지막 문장만 남기므로 덮어써 사라지는 것을 막는다).
   * 기다리는 문장이 없으면 `say`와 같다.
   */
  lead(text: string) {
    this.say(this.#frame !== null && this.#pending ? `${text}. ${this.#pending}` : text);
  }

  #schedule() {
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = requestAnimationFrame(() => {
      this.message = this.#pending;
      this.#pending = '';
      this.#frame = null;
    });
  }

  /** `say`와 같지만 assertive 영역에 넣는다. 프레임 핸들은 따로라 polite와 서로 지우지 않는다 */
  alert(text: string) {
    this.urgent = '';
    if (this.#urgentFrame !== null) cancelAnimationFrame(this.#urgentFrame);
    this.#urgentFrame = requestAnimationFrame(() => {
      this.urgent = text;
      this.#urgentFrame = null;
    });
  }
}

export const announcer = new Announcer();
