// 랜딩 화면 렌더러(docs/design/system/web.md §5.1, 계약 §2.7). 순수 함수 renderLanding을 합성 UA·합성 릴리스로 직접 부른다.
// §5.1 강제 (a)~(i)를 모두 단언한다. 헤더 nav·바닥글의 골격은 pages.test.ts가 본다.
import { describe, expect, it } from "vitest";
import type { Config } from "../../src/config";
import { type EntryContext, entryContext } from "../../src/core/entry";
import { MIN_OS } from "../../src/core/landing";
import { assetPath } from "../../src/http/assets";
import { COPY } from "../../src/http/copy";
import type { Downloads } from "../../src/http/landing";
import { type LandingModel, type MemberModel, renderLanding } from "../../src/http/landing-view";
import type { MySessionView } from "../../src/store/types";

const CONFIG = { authorizeUrl: "https://chzzk.example.invalid/authorize", publicOrigin: "https://worker.test" } as unknown as Config;
const CSRF = "C".repeat(43);
const hex = (n: string) => n.repeat(64).slice(0, 64);
const V = "0.2.0";
const FILES = {
  dmg: `chzzk-downloader_${V}_darwin-aarch64.dmg`,
  setup: `chzzk-downloader_${V}_windows-x86_64-setup.exe`,
  msi: `chzzk-downloader_${V}_windows-x86_64.msi`,
  appimage: `chzzk-downloader_${V}_linux-x86_64.AppImage`,
  deb: `chzzk-downloader_${V}_linux-x86_64.deb`,
} as const;
const ROWS = (Object.keys(FILES) as (keyof typeof FILES)[]).map((id, i) => ({ id, file: FILES[id], sha256: hex(String(i + 1)) }));
const OK: Downloads = { kind: "ok", version: V, pubDate: "2030-01-01", rows: ROWS };
const dev = (id: string, o: Partial<MySessionView> = {}): MySessionView => ({ id, kind: "web", client: null, createdAt: Date.UTC(2030, 0, 1), lastSeenAt: Date.UTC(2030, 0, 1), ...o });

// 합성 UA(실제 브라우저 문자열을 줄인 것)
const UA = {
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
  phone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
  kakaoPhone: "Mozilla/5.0 (Linux; Android 14; SM-S911N) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36 KAKAOTALK 2510000",
  bot: "kakaotalk-scrap/1.0",
  unknown: "curl/8.0",
} as const;
type Ua = keyof typeof UA | null;
const entryOf = (ua: Ua): EntryContext => entryContext({ get: (n) => (n === "User-Agent" && ua !== null ? UA[ua] : null) });

const member = (o: Partial<MemberModel> = {}): MemberModel => ({
  csrf: CSRF,
  currentSessionId: "s1",
  downloads: OK,
  devices: [dev("s1"), dev("s2", { kind: "app", client: "app/0.2.0 macos" })],
  ...o,
});
const anon = (ua: Ua = "mac"): LandingModel => ({ entry: entryOf(ua), nav: { kind: "anon" }, flash: null, member: null });
const authed = (ua: Ua = "mac", m: Partial<MemberModel> = {}, o: { channelName?: string; isAdmin?: boolean } = {}): LandingModel => ({
  entry: entryOf(ua),
  nav: { kind: "member", channelName: o.channelName ?? "이름", isAdmin: o.isAdmin ?? false },
  flash: null,
  member: member(m),
});
const render = async (m: LandingModel): Promise<string> => renderLanding(CONFIG, m).text();

const mainOf = (t: string): string => /<main [^>]*>([\s\S]*)<\/main>/.exec(t)?.[1] ?? "";
const count = (t: string, re: RegExp): number => (t.match(re) ?? []).length;
/** 요약 글자로 찾은 details의 여는 태그 */
const detailsOf = (t: string, summary: string): string => {
  const i = t.indexOf(`</svg>${summary}</summary>`);
  expect(i, `${summary} 접힘이 있다`).toBeGreaterThan(-1);
  return t.slice(t.lastIndexOf("<details", i), i);
};
const isOpen = (t: string, summary: string) => detailsOf(t, summary).includes(" open");
const rowHeads = (t: string): string[] => [...t.slice(t.indexOf('id="files-caption"')).matchAll(/<th scope="row">([^<]*)<\/th>/g)].map((x) => x[1] ?? "");
const noActive = (t: string) => {
  for (const bad of ["<script", "<style", "style="]) expect(t).not.toContain(bad);
};

describe("모양 공통", () => {
  it("늘 200, 읽기 척도, 색인, OG 태그 전부", async () => {
    for (const m of [anon(), authed(), anon("phone"), authed("unknown")]) {
      const res = renderLanding(CONFIG, m);
      expect(res.status).toBe(200);
      expect(res.headers.get("X-Robots-Tag")).toBeNull();
      const t = await res.text();
      expect(t).toContain('data-scale="reading"');
      expect(t).toContain(`<title>${COPY.siteTitle}</title>`);
      const og = `https://worker.test${assetPath("og.png")}`;
      for (const tag of [
        `<meta name="description" content="${COPY.ogDescription}">`,
        `<meta property="og:title" content="${COPY.siteTitle}">`,
        `<meta property="og:type" content="website">`,
        `<meta property="og:url" content="https://worker.test/">`,
        `<meta property="og:description" content="${COPY.ogDescription}">`,
        `<meta property="og:image" content="${og}">`,
        `<meta property="og:image:width" content="1200">`,
        `<meta property="og:image:height" content="630">`,
        `<meta property="og:image:alt" content="${COPY.siteTitle}">`,
      ])
        expect(t).toContain(tag);
      noActive(t);
    }
  });

  it("h1은 하나, siteName에 hero 클래스, 로그인 여부와 무관", async () => {
    for (const m of [anon(), authed(), authed("windows", {}, { isAdmin: true })]) {
      const t = await render(m);
      expect(count(t, /<h1[ >]/g)).toBe(1);
      expect(t).toContain(`<h1 class="hero">${COPY.siteName}</h1>`);
    }
  });

  it("flash와 Set-Cookie 헤더는 골격이 처리한다", async () => {
    const res = renderLanding(CONFIG, { ...anon(), flash: "sessionGone", headers: { "Set-Cookie": "a=b" } });
    expect(res.headers.get("Set-Cookie")).toBe("a=b");
    expect(mainOf(await res.text())).toMatch(/^<section aria-labelledby="flash-body">/);
  });

  it("페이지 안 id는 겹치지 않는다(알림·표 이름)", async () => {
    for (const m of [anon("phone"), authed("windows"), authed("unknown", { downloads: { kind: "unavailable" } })]) {
      const ids = [...(await render(m)).matchAll(/ id="([^"]+)"/g)].map((x) => x[1]);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("§5.1 (a) 휴대폰: 1번이 로그인 폼보다 앞이고 모든 행이 있다", () => {
  it("비로그인 phone: 안내 → 읽기 전용 주소 → 한 줄 → h1 → … → 로그인 폼", async () => {
    const t = await render(anon("phone"));
    const body = mainOf(t);
    const iBlock = body.indexOf(COPY.mobileBlock);
    expect(iBlock).toBeGreaterThan(-1);
    expect(iBlock).toBeLessThan(body.indexOf("<h1"));
    expect(iBlock).toBeLessThan(body.indexOf('action="/auth/web/start"'));
    // monitor 은유 하나, 제목 없음
    const notice = body.slice(0, body.indexOf("<h1"));
    expect(notice).toContain("tone-info");
    expect(notice).not.toContain("notice-title");
    expect(count(notice, /<svg/g)).toBe(1);
    // 읽기 전용 입력: 라벨 "이 페이지 주소", 값 = 출처 + /
    expect(notice).toContain(`<label for="page-address">${COPY.pageAddress}</label>`);
    expect(notice).toMatch(/<input [^>]*id="page-address"[^>]*value="https:\/\/worker\.test\/"[^>]*readonly/);
    expect(notice).toContain(COPY.mobileHint);
    // 아래 내용은 그대로 이어진다: 로그인 폼, 설치 절 셋, 로그인·막히면 절
    expect(body).toContain('action="/auth/web/start"');
    for (const id of ['id="install"', 'id="login"', 'id="help"']) expect(body).toContain(id);
    for (const os of ["macOS", "Windows", "Linux"]) expect(t).toContain(`</svg>${os}</summary>`);
  });

  it("허가 사용자 phone: 안내가 먼저고, 설치 파일 행은 모두 있다(큰 버튼 없이 표가 열림)", async () => {
    const t = await render(authed("phone"));
    const body = mainOf(t);
    expect(body.indexOf(COPY.mobileBlock)).toBeLessThan(body.indexOf("<h1"));
    for (const f of Object.values(FILES)) expect(t).toContain(`href="/releases/${V}/${f}"`);
    expect(count(t, /btn-primary/g)).toBe(0);
    expect(isOpen(t, COPY.otherOs)).toBe(true);
  });

  it("phone이 아니면 안내가 없다", async () => {
    for (const ua of ["mac", "windows", "linux", "unknown", "bot"] as const) expect(await render(anon(ua))).not.toContain(COPY.mobileBlock);
  });

  it("카카오톡 안의 phone도 같은 본문이다(인앱 표지는 랜딩을 바꾸지 않는다)", async () => {
    expect(await render(anon("kakaoPhone"))).toBe(await render(anon("phone")));
  });
});

describe("§5.1 (b) macOS", () => {
  it("mac이면 macOS 행이 맨 위, Apple Silicon 한 줄이 늘 붙는다", async () => {
    const t = await render(authed("mac"));
    expect(rowHeads(t)[0]).toBe(COPY.artifact.dmg);
    expect(t).toContain(`<p class="meta">${COPY.appleSiliconOnly}</p>`);
  });

  it("Apple Silicon 문구는 UA와 무관하게 표 행 이름에 있다", async () => {
    for (const ua of ["mac", "windows", "linux", "phone", "bot", "unknown"] as const) {
      expect(await render(authed(ua))).toContain("macOS(Apple Silicon)");
    }
  });

  it("mac이 아니면 appleSiliconOnly 한 줄은 없다", async () => {
    for (const ua of ["windows", "linux", "phone", "unknown"] as const) expect(await render(authed(ua))).not.toContain(COPY.appleSiliconOnly);
  });

  it("감지한 OS의 행이 앞으로 온다(행은 숨기지 않는다)", async () => {
    expect(rowHeads(await render(authed("windows"))).slice(0, 5)).toEqual([COPY.artifact.setup, COPY.artifact.msi, COPY.artifact.dmg, COPY.artifact.appimage, COPY.artifact.deb]);
    expect(rowHeads(await render(authed("linux"))).slice(0, 5)).toEqual([COPY.artifact.appimage, COPY.artifact.deb, COPY.artifact.dmg, COPY.artifact.setup, COPY.artifact.msi]);
  });
});

describe("§5.1 (c) 감지 실패: 큰 버튼 없이 표와 설치 절이 모두 열린다", () => {
  for (const ua of ["unknown", "bot", "phone", null] as const) {
    it(`${ua ?? "UA 없음"}`, async () => {
      const t = await render(authed(ua));
      expect(count(t, /btn-lg/g)).toBe(0);
      expect(count(t, /btn-primary/g)).toBe(0);
      expect(isOpen(t, COPY.otherOs)).toBe(true);
      for (const os of ["macOS", "Windows", "Linux"]) expect(isOpen(t, os)).toBe(true);
      // 행은 하나도 빠지지 않는다
      for (const f of Object.values(FILES)) expect(t).toContain(`href="/releases/${V}/${f}"`);
    });
  }

  it("OS는 잡혀도 데스크톱 세 종류가 아니면(Android 태블릿 등) 감지 실패다", async () => {
    const t = await render({ ...authed(null), entry: { kind: "desktop", os: "other", inApp: null } });
    expect(count(t, /btn-lg/g)).toBe(0);
    expect(isOpen(t, COPY.otherOs)).toBe(true);
  });
});

describe("감지 성공: 큰 버튼과 meta 줄", () => {
  const big = (t: string) => /<a class="btn btn-primary btn-lg" href="([^"]+)">([^<]*)<\/a>/.exec(t);

  it("mac은 dmg, Windows는 setup.exe, Linux는 AppImage", async () => {
    const cases = [
      ["mac", "macOS", FILES.dmg, MIN_OS.macos],
      ["windows", "Windows", FILES.setup, MIN_OS.windows],
      ["linux", "Linux", FILES.appimage, MIN_OS.linux],
    ] as const;
    for (const [ua, os, file, min] of cases) {
      const t = await render(authed(ua));
      const b = big(t);
      expect(b?.[1]).toBe(`/releases/${V}/${file}`);
      expect(b?.[2]).toBe(COPY.getFor(os));
      // meta 줄: .num, 버전 · 날짜(D49 형식) · 최소 OS 이상
      expect(t).toContain(`<p class="meta num">버전 ${V} · 2030. 1. 1. · ${min} 이상</p>`);
      // 표는 닫혀 있다
      expect(isOpen(t, COPY.otherOs)).toBe(false);
    }
  });

  it("감지한 OS의 설치 절만 열린다", async () => {
    const open = async (ua: Ua) => {
      const t = await render(authed(ua));
      return ["macOS", "Windows", "Linux"].filter((os) => isOpen(t, os));
    };
    expect(await open("mac")).toEqual(["macOS"]);
    expect(await open("windows")).toEqual(["Windows"]);
    expect(await open("linux")).toEqual(["Linux"]);
  });

  it("주 산출물이 표에 없으면 큰 버튼 없이 표를 연다", async () => {
    const t = await render(authed("mac", { downloads: { kind: "ok", version: V, pubDate: null, rows: ROWS.filter((r) => r.id !== "dmg") } }));
    expect(count(t, /btn-lg/g)).toBe(0);
    expect(isOpen(t, COPY.otherOs)).toBe(true);
  });

  it("pub_date가 없으면 meta 줄에 날짜가 없다", async () => {
    const t = await render(authed("windows", { downloads: { kind: "ok", version: V, pubDate: null, rows: ROWS } }));
    expect(t).toContain(`<p class="meta num">버전 ${V} · ${MIN_OS.windows} 이상</p>`);
  });
});

describe("§5.1 (d) 채움 버튼", () => {
  it("비로그인은 로그인 버튼 하나, 감지한 허가 사용자는 받기 버튼 하나", async () => {
    for (const ua of ["mac", "windows", "linux", "phone", "unknown", "bot"] as const) {
      expect(count(await render(anon(ua)), /btn-primary/g), `anon ${ua}`).toBe(1);
    }
    for (const ua of ["mac", "windows", "linux"] as const) expect(count(await render(authed(ua)), /btn-primary/g), `member ${ua}`).toBe(1);
  });

  it("감지 실패·릴리스 없음·목록 실패인 허가 사용자는 0개(1개를 넘지 않는다)", async () => {
    expect(count(await render(authed("unknown")), /btn-primary/g)).toBe(0);
    expect(count(await render(authed("mac", { downloads: { kind: "none" } })), /btn-primary/g)).toBe(0);
    expect(count(await render(authed("mac", { downloads: { kind: "unavailable" } })), /btn-primary/g)).toBe(0);
  });

  it("tone-danger 버튼은 없다(위험 표시는 확인 페이지 최종 단계에만)", async () => {
    expect(await render(authed("mac"))).not.toContain("tone-danger");
  });
});

describe("§5.1 (e) 고지", () => {
  it("h1 뒤 첫 Notice가 notice.short다(휴대폰 안내가 있어도 h1 앞이다)", async () => {
    for (const m of [anon("mac"), anon("phone"), authed("mac"), authed("unknown", { downloads: { kind: "unavailable" } })]) {
      const body = mainOf(await render(m));
      const afterH1 = body.slice(body.indexOf("</h1>"));
      const first = afterH1.indexOf('class="notice ');
      expect(first).toBeGreaterThan(-1);
      const iNotice = afterH1.indexOf(COPY.notice.short);
      expect(iNotice).toBeGreaterThan(first);
      // 그 Notice 안에 있다: 다음 Notice가 시작되기 전에 문구가 나온다
      const next = afterH1.indexOf('class="notice ', first + 1);
      expect(next === -1 || iNotice < next).toBe(true);
    }
  });

  it("h1 → lead → 고지 순서", async () => {
    const body = mainOf(await render(anon("mac")));
    expect(body.indexOf("</h1>")).toBeLessThan(body.indexOf(`<p class="lead">${COPY.anonLead}</p>`));
    expect(body.indexOf('<p class="lead">')).toBeLessThan(body.indexOf(COPY.notice.short));
  });

  it("허가 사용자의 lead는 로그인한 채널 이름(이스케이프됨)", async () => {
    const t = await render(authed("mac", {}, { channelName: "<b>x</b>" }));
    expect(t).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(t).not.toContain("<b>x");
  });
});

describe("(f)(h)(i) 본문 규칙", () => {
  it("(f) 같은 입력은 같은 본문이다(쿼리는 모델에 들어오지 않는다)", async () => {
    expect(await render(anon("mac"))).toBe(await render(anon("mac")));
  });

  it("(h) 본문에 v 접두 버전(v0.1 등)이 없다", async () => {
    for (const m of [anon(), authed("mac"), authed("windows"), authed("linux"), authed("unknown")]) {
      expect(mainOf(await render(m))).not.toMatch(/\bv\d+\.\d+/);
    }
  });

  it("(i) li에 번호 문자열(1.·2.)이 박혀 있지 않다", async () => {
    for (const m of [anon(), authed("unknown")]) {
      const lis = [...(await render(m)).matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => x[1] ?? "");
      expect(lis.length).toBeGreaterThanOrEqual(5);
      for (const li of lis) expect(li).not.toMatch(/^\s*\d+[.)]/);
    }
  });

  it("크기 표시는 없다(요청당 R2 상한)", async () => {
    expect(await render(authed("mac"))).not.toMatch(/\d+(\.\d+)?\s?(MB|KB|GB|MiB)/);
  });
});

describe("비로그인 CTA와 로그인 전 고지(§5.3)", () => {
  it("네 줄 → 처리방침 링크 → loginForFiles → 폼 순서이고 #start 블록 안에 있다", async () => {
    const t = await render(anon("mac"));
    const from = t.indexOf('<div id="start"');
    const start = t.slice(from, t.indexOf("</form>", from));
    const c = COPY.landing.consent;
    const order = [c.collect, c.use, c.exclude, c.revoke, 'href="/privacy"', COPY.loginForFiles, 'action="/auth/web/start"'].map((s) => start.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(start).toContain(`>${COPY.privacyTitle}</a>`);
    expect(start).toContain(`>${COPY.loginWithChzzk}</button>`);
  });

  it("로그인 폼에는 csrf 숨은 입력이 없다", async () => {
    expect(await render(anon("mac"))).not.toContain('name="csrf"');
  });

  it("비로그인에서도 설치 안내는 보이고 설치 파일 링크·SHA-256은 없다", async () => {
    const t = await render(anon("mac"));
    expect(t).toContain(`<h2 id="install">${COPY.installTitle}</h2>`);
    expect(t).not.toContain("/releases/");
    expect(t).not.toContain(COPY.fileCheck);
    expect(t).not.toContain(COPY.warnPreview);
  });
});

describe("설치하기(§5.1 7번)", () => {
  it("macOS: macDamaged → ol(macMove · macOpenAnyway · macTerminal) → xattr 코드 → macXattrNote", async () => {
    const t = await render(authed("mac"));
    const mac = t.slice(t.indexOf("</svg>macOS</summary>"), t.indexOf("</svg>Windows</summary>"));
    const order = [
      COPY.macDamaged,
      `<ol class="steps"><li>${COPY.macMove}</li><li>${COPY.macOpenAnyway}</li><li>${COPY.macTerminal}</li></ol>`,
      '<pre tabindex="0"><code class="selectable">xattr -dr com.apple.quarantine &quot;/Applications/치지직 다운로더.app&quot;</code></pre>',
      `<p>${COPY.macXattrNote}</p>`,
    ].map((s) => mac.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    // [잠정] 그래도 열기는 조건문이다
    expect(COPY.macOpenAnyway).toContain("그 단추가 없으면");
  });

  it("Windows: winSac 경고 Notice가 단계 앞이다", async () => {
    const t = await render(authed("windows"));
    const win = t.slice(t.indexOf("</svg>Windows</summary>"), t.indexOf("</svg>Linux</summary>"));
    const iSac = win.indexOf(COPY.winSac);
    expect(iSac).toBeGreaterThan(-1);
    expect(win.slice(0, iSac)).toContain("tone-warning");
    expect(iSac).toBeLessThan(win.indexOf(`<li>${COPY.winSmartScreen}</li>`));
  });

  it("Linux: libfuse2 문장 + chmod, deb는 apt install ./ + 관리자 권한 문장", async () => {
    const t = await render(authed("linux"));
    const linux = t.slice(t.indexOf("</svg>Linux</summary>"));
    expect(linux).toContain("libfuse2t64");
    expect(linux).toContain(`chmod +x ${FILES.appimage}`);
    expect(linux).toContain(`sudo apt install ./${FILES.deb}`);
    expect(linux).toContain("관리자 권한이 필요할 수 있어요");
  });

  it("버전을 모르면 명령에 자리표시 파일 이름이 들어간다", async () => {
    const t = await render(anon("linux"));
    expect(t).toContain(`chmod +x ${COPY.savedFile}`);
    expect(t).toContain(`apt install ./${COPY.savedFile}`);
  });

  it("앵커 id는 details 밖(h2)에만 있다", async () => {
    const t = await render(authed("unknown"));
    for (const d of t.match(/<details[\s\S]*?<\/details>/g) ?? []) expect(d).not.toMatch(/<h2[^>]* id=/);
    for (const id of ["install", "login", "help"]) expect(t).toContain(`<h2 id="${id}">`);
  });
});

describe("다른 운영체제 표와 파일 확인(§5.1 6·8번)", () => {
  it("표: caption(버전), th scope=col 셋, 행머리 th scope=row, 파일명은 code, 최소 버전", async () => {
    const t = await render(authed("mac"));
    const table = t.slice(t.indexOf('<div class="scroll" tabindex="0" role="region" aria-labelledby="files-caption">'));
    expect(table).toContain(`<caption id="files-caption">${COPY.filesCaption(V)}</caption>`);
    for (const h of [COPY.colOs, COPY.colFile, COPY.colMinVersion]) expect(table).toContain(`<th scope="col">${h}</th>`);
    expect(table).toContain(`<th scope="row">${COPY.artifact.dmg}</th><td><a href="/releases/${V}/${FILES.dmg}"><code>${FILES.dmg}</code></a></td><td>${MIN_OS.macos}</td>`);
    expect(table).toContain(`<td>${MIN_OS.linux}</td>`);
  });

  it("SHA-256은 주 표가 아니라 파일 확인 접힘(닫힘)에 있고, 행마다 링크와 해시가 한 행이다", async () => {
    const t = await render(authed("mac"));
    expect(isOpen(t, COPY.fileCheck)).toBe(false);
    const check = t.slice(t.indexOf(`</svg>${COPY.fileCheck}</summary>`));
    expect(check).toContain(COPY.fileCheckLead);
    expect(check).toContain(`<caption id="sums-caption">${COPY.filesCaption(V)}</caption>`);
    expect(check).toContain(`<th scope="col">${COPY.colFile}</th><th scope="col">SHA-256</th>`);
    // worker-e2e 계약: 속성 없는 <tr>, <a href="/releases/…">, <code>{해시}</code>가 한 행에 있다
    const rows = check.split("<tr>").filter((r) => r.includes('<a href="/releases/'));
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r).toMatch(/<a href="\/releases\/0\.2\.0\/[^"]+">/);
      expect(r).toMatch(/<code>[0-9a-f]{64}<\/code>/);
    }
    // 주 표(다른 운영체제)에는 해시가 없다
    const other = t.slice(t.indexOf('aria-labelledby="files-caption"'), t.indexOf(`</svg>${COPY.fileCheck}</summary>`));
    expect(other).not.toMatch(/[0-9a-f]{64}/);
  });

  it("목록이 없으면(none·unavailable) 표·파일 확인·경고 예고 없이 안내만", async () => {
    const none = await render(authed("mac", { downloads: { kind: "none" } }));
    expect(none).toContain(COPY.noRelease);
    expect(none).not.toContain(COPY.fileCheck);
    expect(none).not.toContain(COPY.otherOs);
    expect(none).not.toContain(COPY.warnPreview);
    const bad = await render(authed("mac", { downloads: { kind: "unavailable" } }));
    expect(bad).toContain(COPY.releaseUnavailable);
    expect(bad).toContain("tone-warning");
    // 내 기기·로그아웃은 같은 화면에 남는다
    expect(bad).toContain(COPY.devicesTitle);
    expect(bad).toContain('action="/auth/web/logout"');
  });

  it("경고 예고 줄은 허가 사용자에게만", async () => {
    expect(await render(authed("mac"))).toContain(COPY.warnPreview);
    expect(await render(anon("mac"))).not.toContain(COPY.warnPreview);
  });
});

describe("로그인·막히면(9·10번)", () => {
  it("h2#login 문단과 loginTwice, h2#help에 /help 링크·reportHelp·landing.contact", async () => {
    const t = await render(anon("mac"));
    expect(t).toContain(`<h2 id="login">${COPY.loginSectionTitle}</h2><p>${COPY.loginSectionBody} ${COPY.loginTwice}</p>`);
    expect(t).toContain(`<h2 id="help">${COPY.helpSectionTitle}</h2><p><a href="/help">${COPY.helpTitle}</a></p><p>${COPY.reportHelp} ${COPY.landing.contact}</p>`);
  });

  it("순서: 고지 → CTA → 설치하기 → 파일 확인 → 로그인 → 막히면 → 내 기기 → 로그아웃", async () => {
    const body = mainOf(await render(authed("mac")));
    const marks = [COPY.notice.short, "btn-primary", 'id="install"', `${COPY.fileCheck}</summary>`, 'id="login"', 'id="help"', 'id="devices"', 'action="/auth/web/logout"'].map((s) => body.indexOf(s));
    expect(marks.every((i) => i > -1)).toBe(true);
    expect([...marks].sort((x, y) => x - y)).toEqual(marks);
  });
});

describe("내 기기와 로그아웃(11·12번)", () => {
  it("현재 세션 행에만 이 브라우저 표시, 행머리는 종류", async () => {
    const t = await render(authed("mac"));
    expect(t.split(COPY.thisBrowser)).toHaveLength(2);
    expect(t).toContain(`<th scope="row">웹 · ${COPY.thisBrowser}</th>`);
    expect(t).toContain('<th scope="row">앱</th>');
  });

  it("표: caption에 tableTimeNote, 마지막 열 머리는 숨김 colAction, 시각은 D49 형식(.num), 끊기는 .btn", async () => {
    const t = await render(authed("mac"));
    const table = t.slice(t.indexOf('aria-labelledby="devices-caption"'));
    expect(table).toContain(`<caption id="devices-caption">${COPY.devicesTitle}. ${COPY.tableTimeNote}</caption>`);
    expect(table).toContain(`<th scope="col"><span class="sr-only">${COPY.colAction}</span></th>`);
    expect(table).toContain('<td><span class="when num">2030. 1. 1.</span> <span class="when num">오전 9:00</span></td>');
    expect(table).toContain('<button type="submit" class="btn">끊기</button>');
    expect(table).toContain('action="/me/sessions/s1/revoke"');
    expect(table).toContain('action="/me/sessions/s2/revoke"');
    expect(table).not.toContain("KST");
  });

  it("csrf 숨은 입력은 기기 수 + 1(로그아웃)번, 글자 그대로의 모양", async () => {
    const t = await render(authed("mac"));
    expect(t.split(`<input type="hidden" name="csrf" value="${CSRF}">`)).toHaveLength(4);
    expect(t).toContain('<div class="actions"><form method="post" action="/auth/web/logout">');
    expect(t).toContain(`class="btn">${COPY.logout}</button>`);
  });

  it("기기 정보는 이스케이프된다", async () => {
    const t = await render(authed("mac", { devices: [dev("s1", { client: "<script>c</script>" })] }));
    expect(t).toContain("&lt;script&gt;c&lt;/script&gt;");
    noActive(t);
  });

  it("기기가 없으면 안내 문구이고 표는 없다", async () => {
    const t = await render(authed("mac", { devices: [] }));
    expect(t).toContain(COPY.devicesEmpty);
    expect(t).not.toContain('aria-labelledby="devices-caption"');
  });

  it("관리 링크는 본문이 아니라 헤더 nav가 맡는다", async () => {
    const t = await render(authed("mac", {}, { isAdmin: true }));
    expect(count(t, /href="\/admin"/g)).toBe(1);
    expect(mainOf(t)).not.toContain('href="/admin"');
    expect(await render(authed("mac"))).not.toContain('href="/admin"');
  });

  it("비로그인에는 내 기기·로그아웃이 없다", async () => {
    const t = await render(anon("mac"));
    expect(t).not.toContain('id="devices"');
    expect(t).not.toContain("/auth/web/logout");
  });
});
