// test/fake-chzzk.mjs의 타입(tsc 7이 이 선언으로 검사하고 vitest는 .mjs를 가져온다, 구현 중 변경 26 (사))
export declare const FAKE_ORIGIN: "http://127.0.0.1:8788";
export type FakeAccountKey = "a1" | "b2" | "c3" | "d4";
export declare const FAKE_ACCOUNTS: Readonly<Record<FakeAccountKey, { readonly channelId: string; readonly channelName: string }>>;
export type FakeFail = 401 | 429 | 500 | "html" | "timeout";
export interface FakeOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}
export interface FakeState {
  account: FakeAccountKey;
  authorize: "approve" | "cancel";
  wrapped: boolean;
  expiresInType: "string" | "number";
  tokenFail: FakeFail | null;
  userFail: FakeFail | null;
  userIdField: "channelId" | "id";
  codeReuse: "reject" | "allow";
  readonly calls: string[];
  readonly issuedCodes: string[];
  readonly issuedTokens: string[];
}
export interface FakeChzzk {
  handle(req: Request): Promise<Response>;
  readonly state: FakeState;
  readonly opts: FakeOptions;
}
export declare function createFakeChzzk(opts?: Partial<FakeOptions>): FakeChzzk;
