// test/e2e-lib.mjs의 타입(tsc가 이 선언으로 검사하고 vitest는 .mjs를 가져온다, seed-release.d.mts와 같은 방식)
export declare const E2E_PORT: 8787;
export declare const E2E_BIND_IP: "127.0.0.1";
export declare const E2E_ORIGIN: "http://localhost:8787";
export declare const E2E_START_RATE: 3;
export declare const E2E_BUCKET: "chzzk-downloader-dist";
export declare const E2E_VERSIONS: readonly string[];
export declare const MIN_CANARY: 6;
export declare const BUILD_ID_RE: RegExp;
export declare const LOG_KEYS: readonly string[];
export declare const REFERRER_POLICIES: readonly string[];
export declare const REQUEST_LINE: RegExp;
export declare const REQUIRED_EVENTS: Readonly<Record<string, number>>;
export declare const EXACT_EVENTS: Readonly<Record<string, number>>;

export declare function wranglerDevArgs(o: { persistTo: string; buildId: string; fakeOrigin: string; startRate?: number }): string[];
export declare const CHILD_ENV_KEYS: readonly string[];
export declare function childEnvFor(o: { tmpRoot: string; parentEnv: Readonly<Record<string, string | undefined>> }): Record<string, string>;
export declare function wranglerR2PutArgs(o: { key: string; file: string; persistTo: string }): string[];
export declare function parseDevVars(text: string): Record<string, string>;
export declare function cookieAttrs(setCookie: string): { name: string; value: string; attrs: string[] };

export declare class CookieJar {
  apply(setCookies: readonly string[]): void;
  header(): string | null;
  get(name: string): string | undefined;
  has(name: string): boolean;
  values(): string[];
}

export declare function parseReferrerPolicy(value: string | null): string;
export declare function browserPostHeaders(o: { documentUrl: string; referrerPolicy: string; targetUrl: string }): { Origin: string; "Sec-Fetch-Site": string };
export declare function extractCsrf(html: string): string | null;
export declare function extractUserCode(html: string): string | null;
export declare function extractRowIds(html: string, o: { channelId: string; actionPrefix: string }): string[];
export declare function extractDownloadLinks(html: string): { href: string; file: string; sha256: string }[];
export declare function stripAnsi(s: string): string;
export type LineClass = "blank" | "event" | "request" | "other";
export declare function classifyLine(raw: string): LineClass;

export type CanaryKind = "secret" | "path";
export interface Canary {
  readonly kind: CanaryKind;
  readonly label: string;
  readonly value: string;
}
export interface Canaries {
  add(kind: CanaryKind, label: string, value: string): void;
  list(): Canary[];
}
export declare function makeCanaries(): Canaries;
export interface ScanResult {
  events: Record<string, number>;
  violations: string[];
  counts: { event: number; request: number; other: number };
}
export declare function scanLogs(lines: readonly string[], canaries: Canaries): ScanResult;
export declare function checkEvents(events: Readonly<Record<string, number>>): string[];
