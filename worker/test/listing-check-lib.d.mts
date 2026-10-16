// test/listing-check-lib.mjs의 타입(tsc가 이 선언으로 검사하고 vitest는 .mjs를 가져온다, code-binding-lib.d.mts와 같은 방식)
export type Judged =
  | { readonly kind: "ok"; readonly content: Record<string, any> }
  | { readonly kind: "http"; readonly status: number }
  | { readonly kind: "api"; readonly code: number }
  | { readonly kind: "shape" }
  | { readonly kind: "down"; readonly timedOut: boolean };

export type Item = Record<string, any>;
export type FieldTable = ReadonlyArray<readonly [string, readonly string[]]>;
export type RateVerdict = { requests: number; first429: number | null; first403: number | null };

export declare const SERVICE_API: string;
export declare const PAGE_SIZE: number;
export declare const SIZE_PROBES: number[];
export declare const SORT_PAGES: number;
export declare const CLIP_SIZE: number;
export declare const STEP_GAP_MS: number;
export declare const BURST_COUNT: number;
export declare const BURST_GAP_MS: number;
export declare const SOAK_LIST_GAP_MS: number;
export declare const SOAK_INFO_GAP_MS: number;
export declare const SOAK_INFO_MAX: number;
export declare const REQUEST_TIMEOUT_MS: number;
export declare const VIDEO_FIELDS: FieldTable;
export declare const CLIP_FIELDS: FieldTable;

export declare function infoPath(no: string): string;
export declare function videoListPath(channelId: string, page: number, size: number): string;
export declare function clipListPath(channelId: string, extraQuery?: Record<string, string>): string;
export declare function parseVodUrl(raw: string): string | null;
export declare function judgeResponse(status: number, bodyText: string | null): Judged;
export declare function unreachable(timedOut: boolean): Judged;
export declare function statusLabel(j: Judged): string;
export declare function findItems(content: any): Item[] | null;
export declare function pagingKind(content: any): "페이지 번호" | "커서" | "판정 불가";
export declare function nextCursorQuery(content: any): Record<string, string> | null;
export declare function countBucket(n: unknown): string;
export declare function sizeVerdict(requested: number, got: number, total: unknown): string;
export declare function sizeLine(requested: number, got: number, total: unknown): string;
export declare function itemDate(item: Item): number | null;
export declare function itemKey(item: Item): string | null;
export declare function sortVerdict(input: { repeatA: Item[]; repeatB: Item[]; pages: Item[][]; repeatOk?: boolean }): {
  verdict: "내림차순" | "아님" | "판정 불가";
  calls: number;
  items: number;
  overlap: boolean;
};
export declare function channelVerdict(items: Item[], infoChannelId: string | null, pick: (item: Item) => unknown): string;
export declare function pickVideoChannel(item: Item): unknown;
export declare function pickClipChannel(item: Item): unknown;
export declare function fieldPresence(items: Item[], fields: FieldTable): [string, string][];
export declare function distinctCount(items: Item[], path: string): number;
export declare function adultLabel(items: Item[]): "있다" | "없다" | "판정 불가(필드 없음)";
export declare function cookieDelta(anonTotal: unknown, cookieTotal: unknown): string;
export declare function rateVerdict(results: Judged[]): RateVerdict;
export declare function rateLines(title: string, v: RateVerdict): string[];
export declare function cookieHeader(aut: string, ses: string): string | null;
