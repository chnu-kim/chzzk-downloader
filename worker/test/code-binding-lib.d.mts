// test/code-binding-lib.mjs의 타입(tsc가 이 선언으로 검사하고 vitest는 .mjs를 가져온다, e2e-lib.d.mts와 같은 방식)
export type Exchange =
  | { readonly kind: "accepted" }
  | { readonly kind: "rejected"; readonly status: number; readonly code?: string }
  | { readonly kind: "unreachable"; readonly timedOut: boolean };

export declare function judgeExchange(status: number, body: string): Exchange;
export declare function unreachable(timedOut: boolean): Exchange;
export declare function needSecond(first: Exchange): boolean;
export declare function needThird(first: Exchange, second: Exchange | null): boolean;
export declare function stateVerdict(first: Exchange, second: Exchange | null): string;
export declare function reuseVerdict(third: Exchange | null): string;
export declare function reportLines(r: { first: Exchange; second: Exchange | null; third: Exchange | null }): string[];
