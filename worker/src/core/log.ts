// 로그(docs/design/worker.md §14). 소스에서 console.*을 부르는 곳은 이 파일 하나다(scripts/ci/worker-config.mjs가 검사한다).
//
// 한 줄 JSON, 허용 필드만. 금지: 쿼리스트링, 토큰·해시·쿠키, code·state·handle·loginId·pollSecret, 채널 id·이름,
// 외부 응답 본문, IP 원문, 오류 메시지(URL이 들어 있을 수 있어 error.name만).
// Workers Logs는 이 줄마다 그 호출의 요청 URL 전체를 메타데이터로 붙인다(W9 실측, 구현 중 변경 43): 그래서 URL에 금지 값이 실리는
// 경로(routes.ts의 quiet 행)는 그 Worker 호출 안에서 이 함수를 한 번도 부르지 않고, 남길 이벤트는 DO RPC 쪽(AuthStore.ts)이 남긴다.

export type LogLevel = "info" | "warn" | "error";

export interface LogFields {
  readonly level?: LogLevel;
  /** 경로 표의 패턴(실제 경로가 아니다) */
  readonly route?: string;
  readonly method?: string;
  readonly status?: number;
  readonly stage?: "token" | "user";
  readonly timedOut?: boolean;
  readonly durationMs?: number;
  readonly flowKind?: "app" | "web";
  readonly reason?: string;
  /** 세션 id 앞 6자 */
  readonly sessionIdPrefix?: string;
  /** 치지직 오류 code(^[\w.-]{1,50}$만) */
  readonly chzzkCode?: string;
  /** config.error의 어긋난 설정 키 이름(값은 싣지 않는다) */
  readonly key?: string;
  /** 잡지 못한 예외의 error.name */
  readonly errorName?: string;
}

// 타입을 우회해 들어온 여분 필드도 버린다(이 목록에 있는 것만 나간다)
const ALLOWED: readonly (keyof LogFields)[] = [
  "level",
  "route",
  "method",
  "status",
  "stage",
  "timedOut",
  "durationMs",
  "flowKind",
  "reason",
  "sessionIdPrefix",
  "chzzkCode",
  "key",
  "errorName",
];

/** 한 줄 JSON 문자열(출력하지 않는다). 테스트와 log()가 같이 쓴다. */
export function formatLog(event: string, fields: LogFields = {}): string {
  const out: Record<string, unknown> = { event, level: fields.level ?? "info" };
  for (const k of ALLOWED) {
    const v = fields[k];
    if (v !== undefined && k !== "level") out[k] = v;
  }
  return JSON.stringify(out);
}

export function log(event: string, fields: LogFields = {}): void {
  console.log(formatLog(event, fields));
}

/** 요청 하나의 로거(Ctx.log). URL에 로그 금지 값이 실리는 경로에서는 아무것도 하지 않는다(routes.ts, 구현 중 변경 43) */
export type Logger = (event: string, fields?: LogFields) => void;

export const silent: Logger = () => {};
