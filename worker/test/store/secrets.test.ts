// 원문 토큰이 어떤 표에도 없다(worker.md 구현 중 변경 18): 로그인 각 단계 뒤 표 전체를 덤프해 원문과 그 몸통을 찾는다.
// 설계상 원문으로 저장하는 loginId(flow.id)·user_code·csrf는 대상이 아니다.
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { newSecret, sha256B64url } from "../../src/core/token";
import { A1, ADMINS, T0, dumpAll, freshStub, sha, type Stub } from "./helpers";

const dump = (stub: Stub) => runInDurableObject(stub, (i) => dumpAll(i.db));

describe("토큰 원문은 저장되지 않는다", () => {
  it("앱·웹 로그인 전 단계와 회전·복구·로그아웃 뒤의 덤프", async () => {
    const stub = freshStub();
    const dumps: string[] = [];
    const secrets: string[] = [];
    const tokens: string[] = [];

    await stub.allow(A1, "", A1, T0);
    const pollSecret = newSecret();
    const verifier = await sha256B64url(pollSecret);
    secrets.push(pollSecret);
    const s = await stub.startApp(verifier, "app/0.2.0 macos", "203.0.113.10", 6, T0);
    if (!s.ok) throw new Error("start");
    secrets.push(s.handle);
    dumps.push(await dump(stub));
    const c = await stub.continueApp(await sha(s.handle), T0);
    if (!c.ok) throw new Error("continue");
    secrets.push(c.state, c.binder);
    tokens.push(c.binder);
    dumps.push(await dump(stub));
    const k = await stub.consume(await sha(c.state), await sha(c.binder), T0);
    if (!k.ok) throw new Error("consume");
    expect(await stub.finish(k.flowId, { type: "user", channelId: A1, channelName: "관리자" }, ADMINS, T0)).toEqual({ type: "ok" });
    dumps.push(await dump(stub));
    const claimed = await stub.claim(s.loginId, verifier, ADMINS, T0);
    if (claimed.status !== "ok") throw new Error(claimed.status);
    tokens.push(claimed.bundle.accessToken, claimed.bundle.refreshToken);
    dumps.push(await dump(stub));
    const r = await stub.rotate(await sha(claimed.bundle.refreshToken), ADMINS, T0 + 1000);
    if (!r.ok) throw new Error(r.code);
    tokens.push(r.bundle.accessToken, r.bundle.refreshToken);
    dumps.push(await dump(stub));
    const rec = await stub.rotate(await sha(claimed.bundle.refreshToken), ADMINS, T0 + 2000);
    if (!rec.ok || !rec.recovered) throw new Error("recover");
    tokens.push(rec.bundle.accessToken, rec.bundle.refreshToken);
    dumps.push(await dump(stub));

    const web = await stub.startWeb("203.0.113.20", 6, T0);
    if (!web.ok) throw new Error("startWeb");
    secrets.push(web.state, web.binder);
    tokens.push(web.binder);
    dumps.push(await dump(stub));
    const wk = await stub.consume(await sha(web.state), await sha(web.binder), T0);
    if (!wk.ok) throw new Error("webConsume");
    const wf = await stub.finish(wk.flowId, { type: "user", channelId: A1, channelName: "관리자" }, ADMINS, T0);
    if (wf.type !== "web") throw new Error("webFinish");
    tokens.push(wf.cookieToken);
    dumps.push(await dump(stub));

    await stub.logout(await sha(rec.bundle.accessToken), await sha(rec.bundle.refreshToken), T0 + 3000);
    await stub.logout(await sha(wf.cookieToken), null, T0 + 3000);
    dumps.push(await dump(stub));

    const all = dumps.join("\n");
    for (const t of tokens) {
      expect(all).not.toContain(t);
      expect(all).not.toContain(t.slice(4));
    }
    for (const v of secrets) expect(all).not.toContain(v);
    // 정상 확인: 해시는 저장돼 있다
    expect(dumps[dumps.length - 1]).toContain(await sha(rec.bundle.accessToken));
    expect(dumps[dumps.length - 1]).toContain(await sha(rec.bundle.refreshToken));
  });
});
