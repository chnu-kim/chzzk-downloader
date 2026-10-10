// 웹뷰 엔진 미달 경고(platform.md §5·§15). 프로브(`lib/probe.ts`)가 하나라도 false면 `old`가 true다.
// 앱을 막지 않는다: 배너 하나(닫을 수 있음, 이번 실행만)로 알린다.

class EngineStore {
  /** 프로브가 하나라도 false였다 */
  old = $state(false);
  /** 배너를 이번 실행 동안 닫았다 */
  dismissed = $state(false);

  get showBanner(): boolean {
    return this.old && !this.dismissed;
  }

  dismiss() {
    this.dismissed = true;
  }
}

export const engine = new EngineStore();
