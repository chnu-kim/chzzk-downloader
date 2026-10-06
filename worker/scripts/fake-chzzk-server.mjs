// 가짜 치지직 node:http 래퍼(docs/design/worker.md §12.1, 구현 중 변경 41). test/fake-chzzk.mjs의 handle(Request → Response)을 그대로 쓴다.
// wrangler dev E2E(scripts/e2e-dev.mjs)가 띄우고, 수동 확인에서는 이 파일을 직접 실행한다(터미널 둘: pnpm dev + 이 서버).
// node 전용이라 scripts/에 둔다(test/는 vitest(workerd)가 가져오는 node:* 없는 모듈의 자리다).
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFakeChzzk, FAKE_ACCOUNTS, FAKE_ORIGIN } from "../test/fake-chzzk.mjs";

export const FAKE_HOST = "127.0.0.1";
export const FAKE_PORT = 8788;
// 요청 본문 상한(가짜 서버는 토큰 교환 JSON 정도만 받는다)
export const BODY_MAX = 65_536;

// Worker의 .dev.vars.example·--var가 가리키는 주소와 어긋나면 바로 멈춘다
if (FAKE_ORIGIN !== `http://${FAKE_HOST}:${FAKE_PORT}`) throw new Error(`FAKE_ORIGIN(${FAKE_ORIGIN})이 ${FAKE_HOST}:${FAKE_PORT}와 다르다`);

/** 본문을 BODY_MAX까지 모은다. 넘으면 null */
async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > BODY_MAX) return null;
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

function toRequest(req, body) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }
  const bodiless = req.method === "GET" || req.method === "HEAD";
  return new Request(`${FAKE_ORIGIN}${req.url}`, { method: req.method, headers, body: bodiless ? undefined : body });
}

/**
 * @param {{ fake?: ReturnType<typeof createFakeChzzk>, host?: string, port?: number }} [o]
 * @returns {Promise<{ fake: ReturnType<typeof createFakeChzzk>, origin: string, close(): Promise<void> }>}
 */
export async function startFakeChzzkServer({ fake = createFakeChzzk(), host = FAKE_HOST, port = FAKE_PORT } = {}) {
  const server = createServer(async (req, res) => {
    try {
      const bodiless = req.method === "GET" || req.method === "HEAD";
      const body = bodiless ? undefined : await readBody(req);
      if (body === null) {
        res.writeHead(413, { "Content-Type": "text/plain", Connection: "close" });
        res.end("too large");
        return;
      }
      let response;
      try {
        response = await fake.handle(toRequest(req, body));
      } catch (e) {
        // 시간 초과 흉내: 응답 없이 연결을 끊는다(Worker에는 timedOut:false인 네트워크 실패로 보인다).
        // 시간 초과(timedOut:true) 자체는 vitest가 본다. E2E는 쓰지 않는다
        if (e?.name === "TimeoutError") {
          req.socket.destroy();
          return;
        }
        throw e;
      }
      const out = Buffer.from(await response.arrayBuffer());
      const headers = [...response.headers].filter(([k]) => k !== "content-length");
      headers.push(["content-length", String(out.length)]);
      res.writeHead(response.status, headers);
      res.end(out);
    } catch {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("fake error");
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", (e) => {
      rejectListen(e?.code === "EADDRINUSE" ? new Error(`가짜 치지직 포트 ${port}(${host})를 다른 프로세스가 쓰고 있다`) : e);
    });
    server.listen(port, host, resolveListen);
  });
  return {
    fake,
    origin: `http://${host}:${port}`,
    close: () =>
      new Promise((done) => {
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}

// 수동 확인: node scripts/fake-chzzk-server.mjs [--account a1|b2|c3|d4]
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--account");
  const account = i >= 0 ? process.argv[i + 1] : "b2";
  if (!Object.hasOwn(FAKE_ACCOUNTS, account ?? "")) {
    console.error("사용법: node scripts/fake-chzzk-server.mjs [--account a1|b2|c3|d4]");
    process.exit(2);
  }
  const { fake, origin, close } = await startFakeChzzkServer();
  fake.state.account = account;
  console.log(`가짜 치지직 ${origin} (계정 ${account})`);
  process.on("SIGINT", () => close().then(() => process.exit(0)));
}
