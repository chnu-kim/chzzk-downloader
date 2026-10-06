// 가짜 치지직(docs/design/worker.md §12.1, 구현 중 변경 27 (나)). 순수 핸들러다: Request → Response, 바깥 입출력·시계·타이머가 없다.
// vitest(test/network.ts)는 전역 fetch 스파이로, W7의 wrangler dev E2E는 node:http 래퍼로 같은 handle을 쓴다.
// 난수는 crypto.randomUUID뿐이다. Response는 호출마다 새로 만든다(미리 만든 Response를 다시 주면 workerd가 다른 요청의
// I/O 객체라며 거부한다, 구현 중 변경 26 (가)).

export const FAKE_ORIGIN = "http://127.0.0.1:8788";

// 합성 계정(testdata/README.md의 a1 관리자·b2 허용·c3 거부·d4 기타). c3의 이름은 HTML 이스케이프를 확인하는 입력이다
export const FAKE_ACCOUNTS = {
  a1: { channelId: "a1".padStart(32, "0"), channelName: "합성관리자A1" },
  b2: { channelId: "b2".padStart(32, "0"), channelName: "합성허용B2" },
  c3: { channelId: "c3".padStart(32, "0"), channelName: `<script>alert(1)</script>"'&합성거부C3` },
  d4: { channelId: "d4".padStart(32, "0"), channelName: "합성기타D4" },
};

const DEFAULT_OPTS = {
  clientId: "dev-client-id",
  clientSecret: "dev-client-placeholder",
  redirectUri: "http://localhost:8787/auth/callback",
};

/**
 * @param {Partial<{ clientId: string, clientSecret: string, redirectUri: string }>} [overrides]
 */
export function createFakeChzzk(overrides = {}) {
  const opts = { ...DEFAULT_OPTS, ...overrides };
  const state = {
    account: "b2",
    authorize: "approve",
    wrapped: true,
    expiresInType: "string",
    tokenFail: null,
    userFail: null,
    userIdField: "channelId",
    codeReuse: "reject",
    // state: code는 발급 때의 state와 함께만 바꿀 수 있다. none: state를 보지 않는다(재사용 거부만 남겨 Worker 쪽 대조에 쓴다)
    codeBinding: "state",
    calls: [],
    issuedCodes: [],
    issuedTokens: [],
  };
  /** @type {Map<string, { account: string, state: string, used: boolean }>} */
  const codes = new Map();
  /** @type {Map<string, string>} access token → 계정 키 */
  const tokens = new Map();

  const jsonErr = (status) =>
    new Response(JSON.stringify({ code: status, message: "fake error", content: null }), { status, headers: { "Content-Type": "application/json" } });
  const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const wrap = (content) => (state.wrapped ? { code: 200, message: null, content } : content);

  // 실패 스위치 다섯 갈래. null이면 통과(undefined 반환)
  function failure(kind) {
    if (kind === null) return undefined;
    if (kind === "timeout") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    if (kind === "html") return new Response("<html><body>proxy</body></html>", { status: 200, headers: { "Content-Type": "text/html" } });
    return jsonErr(kind);
  }

  function authorize(url) {
    const p = url.searchParams;
    const clientId = p.get("clientId");
    const redirectUri = p.get("redirectUri");
    const st = p.get("state");
    if (clientId !== opts.clientId || redirectUri !== opts.redirectUri || !st) {
      return new Response("invalid client or redirect", { status: 400, headers: { "Content-Type": "text/plain" } });
    }
    if (state.authorize === "cancel") {
      return new Response(null, { status: 302, headers: { Location: `${redirectUri}?state=${encodeURIComponent(st)}` } });
    }
    const code = `fake-code-${crypto.randomUUID()}`;
    codes.set(code, { account: state.account, state: st, used: false });
    state.issuedCodes.push(code);
    return new Response(null, { status: 302, headers: { Location: `${redirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(st)}` } });
  }

  async function token(req) {
    const failed = failure(state.tokenFail);
    if (failed) return failed;
    let body;
    try {
      body = await req.json();
    } catch {
      return jsonErr(401);
    }
    const entry = typeof body?.code === "string" ? codes.get(body.code) : undefined;
    const valid =
      body?.grantType === "authorization_code" &&
      body.clientId === opts.clientId &&
      body.clientSecret === opts.clientSecret &&
      entry !== undefined &&
      (state.codeBinding === "none" || entry.state === body.state) &&
      (state.codeReuse === "allow" || !entry.used);
    if (!valid) return jsonErr(401);
    entry.used = true;
    const at = `fake-at-${crypto.randomUUID()}`;
    const rt = `fake-rt-${crypto.randomUUID()}`;
    state.issuedTokens.push(at, rt);
    tokens.set(at, entry.account);
    return ok(wrap({ accessToken: at, refreshToken: rt, tokenType: "Bearer", expiresIn: state.expiresInType === "string" ? "86400" : 86400, scope: "유저 정보 조회" }));
  }

  function users(req) {
    const failed = failure(state.userFail);
    if (failed) return failed;
    const m = /^Bearer (.+)$/.exec(req.headers.get("Authorization") ?? "");
    const account = m ? tokens.get(m[1]) : undefined;
    if (account === undefined) return jsonErr(401);
    const a = FAKE_ACCOUNTS[account];
    return ok(wrap(state.userIdField === "channelId" ? { channelId: a.channelId, channelName: a.channelName } : { id: a.channelId, channelName: a.channelName }));
  }

  return {
    opts,
    state,
    /** @param {Request} req */
    async handle(req) {
      const url = new URL(req.url);
      state.calls.push(`${req.method} ${url.pathname}`);
      if (req.method === "GET" && url.pathname === "/account-interlock") return authorize(url);
      if (req.method === "POST" && url.pathname === "/auth/v1/token") return token(req);
      if (req.method === "GET" && url.pathname === "/open/v1/users/me") return users(req);
      return new Response("not found", { status: 404 });
    },
  };
}
