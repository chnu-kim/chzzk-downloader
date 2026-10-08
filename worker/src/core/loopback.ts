// 루프백 리디렉션(docs/design/worker.md 구현 중 변경 88 (나)). 콜백 303의 행선지는 Worker가 상수 호스트·경로로 직접 만든다(임의 URL을 받지 않는다)
import { isSecret, isToken, sha256B64url } from "./token";

export const LOOPBACK_HOST = "127.0.0.1";
export const LOOPBACK_PATH = "/chzzk-downloader/login";
export const LOOPBACK_PORT_MIN = 1024;
export const LOOPBACK_PORT_MAX = 65535;
/** 루프백 state 도메인 구분 문자열(끝의 줄바꿈 포함) */
export const LOOPBACK_STATE_DOMAIN = "chzzk-downloader/loopback-state\n";

/** JSON number이고 정수이며 1024–65535 */
export function isLoopbackPort(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= LOOPBACK_PORT_MIN && v <= LOOPBACK_PORT_MAX;
}

/** http://127.0.0.1:<port>/chzzk-downloader/login?grant=<grant>&state=<state>. 포트·grant(cdg_)·state(43자) 형식 밖이면 던진다 */
export function loopbackUrl(port: number, grant: string, state: string): string {
  if (!isLoopbackPort(port)) throw new RangeError("루프백 포트는 1024–65535 정수다");
  if (!isToken("grant", grant)) throw new TypeError("grant 형식이 틀렸다");
  if (!isSecret(state)) throw new TypeError("state 형식이 틀렸다");
  return `http://${LOOPBACK_HOST}:${port}${LOOPBACK_PATH}?grant=${grant}&state=${state}`;
}

/** b64url(SHA-256(UTF-8(DOMAIN + loginVerifier))) 43자. verifier가 43자 b64url이 아니면 던진다 */
export async function loopbackState(verifier: string): Promise<string> {
  if (!isSecret(verifier)) throw new TypeError("loginVerifier 형식이 틀렸다");
  return sha256B64url(LOOPBACK_STATE_DOMAIN + verifier);
}
