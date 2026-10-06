// test/code-binding-lib.mjs의 타입(tsc가 이 선언으로 검사하고 vitest는 .mjs를 가져온다, e2e-lib.d.mts와 같은 방식)
export type Exchange =
  | { readonly kind: "accepted" }
  | { readonly kind: "rejected"; readonly status: number; readonly code?: string }
  | { readonly kind: "transient"; readonly status: number; readonly code?: string }
  | { readonly kind: "unreachable"; readonly timedOut: boolean; readonly status?: number };

/** 대조 결과. 대조가 필요했는데 두 번째 로그인을 받지 못했으면 "login_failed" */
export type Control = Exchange | "login_failed" | null;

export declare function judgeExchange(status: number, body: string): Exchange;
export declare function unreachable(timedOut: boolean, status?: number): Exchange;
export declare function needSecond(first: Exchange): boolean;
export declare function needControl(first: Exchange, second: Exchange | null): boolean;
export declare function thirdTarget(first: Exchange, second: Exchange | null, control: Control): "original" | "control" | null;
export declare function stateVerdict(first: Exchange, second: Exchange | null, control?: Control): string;
export declare function reuseVerdict(third: Exchange | null): string;
export declare function reportLines(r: { first: Exchange; second: Exchange | null; control?: Control; third: Exchange | null }): string[];
