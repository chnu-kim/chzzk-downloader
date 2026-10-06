// test/seed-release.mjs의 타입(tsc가 이 선언으로 검사하고 vitest는 .mjs를 가져온다, fake-chzzk.d.mts와 같은 방식)
export declare const SEED_BASE: "https://worker.example.test";
export declare const SEED_PUB_DATE: "2030-01-01T00:00:00Z";
export declare const SEED_SIZE: 1024;
export declare const OSES: readonly ["linux", "darwin", "windows"];
export declare const PREFIX: "chzzk-downloader";
export interface ExpectedTable {
  readonly [os: string]: unknown;
}
export interface ArtifactRow {
  readonly os: string;
  readonly kind: string;
  readonly file: string;
  readonly updater: string[];
}
export interface BuildOptions {
  readonly base?: string;
  readonly pubDate?: string;
  readonly size?: number;
}
export declare function expectedArtifacts(table: ExpectedTable, version: string): ArtifactRow[];
export declare function expectedFiles(table: ExpectedTable, version: string): Set<string>;
export declare function verifyKeys(table: ExpectedTable, version: string, latest: boolean): string[];
export declare function fakeBytes(file: string, size?: number): Uint8Array;
export declare function fakeSignature(file: string): string;
export declare function sha256Hex(bytes: Uint8Array): Promise<string>;
export declare function buildRelease(table: ExpectedTable, o: BuildOptions & { version: string; previous: string }): Promise<Map<string, Uint8Array>>;
export declare function buildSeed(table: ExpectedTable, versions: readonly string[], opts?: BuildOptions): Promise<Map<string, Uint8Array>>;
