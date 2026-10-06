// 확인 코드(docs/design/worker.md §3·§7.1, 구현 중 변경 14 (바)). 앱 화면과 확인 페이지에 함께 보이고 사람이 눈으로 맞춘다.
// 알파벳은 혼동 문자(0·1·I·O)를 뺀 32자이고 바이트마다 & 31: 32는 256의 약수라 편향이 없다. 8자 = 40비트, "XXXX-XXXX".
import { randomBytes, type RandomBytes } from "./token";

export const USER_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const USER_CODE = /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/;

/** 정확히 8바이트 → "XXXX-XXXX" */
export function userCodeFromBytes(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 8) throw new TypeError("확인 코드는 8바이트에서 만든다");
  let s = "";
  for (const [i, b] of bytes.entries()) {
    if (i === 4) s += "-";
    s += USER_CODE_ALPHABET[b & 31];
  }
  return s;
}

export function newUserCode(rand: RandomBytes = randomBytes): string {
  return userCodeFromBytes(rand(8));
}

export function isUserCode(s: unknown): s is string {
  return typeof s === "string" && USER_CODE.test(s);
}
