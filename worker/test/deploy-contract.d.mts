// test/deploy-contract.mjs의 타입(tsc가 이 선언으로 검사하고 vitest는 .mjs를 가져온다, seed-release.d.mts와 같은 방식)
export type ContractCred = "ci" | "none" | "garbage";
export interface ContractRow {
  readonly id: string;
  readonly path: string;
  readonly cred: ContractCred;
  readonly status?: number;
  readonly notOk?: true;
  readonly body?: "latest";
  readonly code?: string;
  readonly location?: string;
  readonly deploy: boolean;
}
export declare const GARBAGE_BEARER: "not-a-token";
export declare const DEPLOY_CONTRACT: readonly ContractRow[];
export declare function contractPath(row: ContractRow, version: string): string;
