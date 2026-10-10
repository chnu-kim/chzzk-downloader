// 랜딩 화면 렌더러(docs/design/system/web.md §5, 계약 §2.1·§2.7). 순수 함수: 모든 출력은 HTML 태그드 템플릿을 거친다.
// DOM 순서는 §5.1 표 그대로다: 휴대폰 안내 → 히어로 → 고지 → CTA → 경고 예고 → 다른 운영체제 → 설치하기 → 파일 확인 → 로그인 → 막히면 → 내 기기 → 로그아웃.
// 감지(entryContext)는 순서와 강조만 바꾼다. 행·절을 숨기지 않는다. 스크립트·인라인 스타일 0개(CSP): 동작은 폼과 링크뿐이다.
// 이 모듈은 라우터·저장소·핸들러 파일을 값으로 가져오지 않는다(`landing.ts`는 타입으로만, 계약 §2.1).
import type { Config } from "../config";
import type { EntryContext } from "../core/entry";
import { html, type SafeHtml } from "../core/html";
import { artifactFile, detectedOs, LANDING_FILES, type LandingFile, type LandingId, MIN_OS, OS_NAME, PRIMARY_ARTIFACT } from "../core/landing";
import type { MySessionView } from "../store/types";
import { COPY } from "./copy";
import type { FlashKind } from "./flash";
import { formatDate, kindLabel } from "./format";
import type { Downloads } from "./landing";
import { htmlPage, type Nav } from "./layout";
import { dataTable, disclosure, field, linkButton, notice, postButton, rowHead, when } from "./ui";

type Os = LandingFile["os"];
type Ok = Extract<Downloads, { kind: "ok" }>;

/** 허가 사용자(웹 세션이 있는 사람)에게만 있는 값 */
export interface MemberModel {
  readonly csrf: string;
  readonly currentSessionId: string;
  readonly downloads: Downloads;
  readonly devices: readonly MySessionView[];
}

export interface LandingModel {
  readonly entry: EntryContext;
  readonly nav: Nav;
  /** main 첫 자식 알림(303 뒤 한 번) */
  readonly flash: FlashKind | null;
  /** Set-Cookie 등(덮지 않고 더한다) */
  readonly headers?: HeadersInit;
  /** null이면 비로그인 */
  readonly member: MemberModel | null;
}

const OS_ORDER: readonly Os[] = ["macos", "windows", "linux"];

/** latest.json 요약의 KST 날짜(YYYY-MM-DD) → D49 형식(2026. 10. 3.). 모양이 틀리면 null */
function dateOf(iso: string | null): string | null {
  const m = iso === null ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) return null;
  return formatDate({ y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), h: 0, mi: 0 });
}

const releaseHref = (version: string, file: string): string => `/releases/${version}/${file}`;

const osOfId = (id: LandingId): Os => LANDING_FILES.find((f) => f.id === id)?.os ?? "linux";

// ---- 1. 휴대폰 안내 ----

function mobileBlock(config: Config): SafeHtml {
  const address = field({ id: "page-address", name: "page-address", label: COPY.pageAddress, value: `${config.publicOrigin}/`, readonly: true, mono: true });
  return notice({ tone: "info", icon: "monitor", id: "mobile", body: html`<p>${COPY.mobileBlock}</p>${address}<p>${COPY.mobileHint}</p>` });
}

// ---- 4. CTA ----

/** 비로그인: 로그인 전 고지 네 줄 → 처리방침 링크 → loginForFiles → 로그인 폼. 헤더 [로그인]이 이 블록(#start)으로 온다 */
function anonCta(): SafeHtml {
  const c = COPY.landing.consent;
  return html`<div id="start" class="cta"><p>${c.collect}</p><p>${c.use}</p><p>${c.exclude}</p><p>${c.revoke}</p><p><a href="/privacy">${COPY.privacyTitle}</a></p><p>${COPY.loginForFiles}</p><form method="post" action="/auth/web/start"><button type="submit" class="btn btn-primary btn-lg">${COPY.loginWithChzzk}</button></form></div>`;
}

/** 감지한 OS의 큰 버튼 + meta 줄(+ macOS는 늘 Apple Silicon 한 줄). 주 산출물이 표에 없으면 null */
function bigButton(d: Ok, os: Os): SafeHtml | null {
  const row = d.rows.find((r) => r.id === PRIMARY_ARTIFACT[os]);
  if (row === undefined) return null;
  const meta = COPY.metaLine(d.version, dateOf(d.pubDate), MIN_OS[os]);
  const silicon = os === "macos" ? html`<p class="meta">${COPY.appleSiliconOnly}</p>` : "";
  return html`<div class="cta">${linkButton(releaseHref(d.version, row.file), COPY.getFor(OS_NAME[os]), { primary: true, lg: true })}<p class="meta num">${meta}</p>${silicon}</div>`;
}

// ---- 6. 다른 운영체제 ----

/** 감지한 OS의 행을 앞으로(안정 정렬). 행은 숨기지 않는다 */
function sortedRows(d: Ok, os: Os | null): Ok["rows"] {
  return [...d.rows].sort((a, b) => Number(osOfId(b.id) === os) - Number(osOfId(a.id) === os));
}

function otherOsTable(d: Ok, os: Os | null): SafeHtml {
  const rows = sortedRows(d, os).map(
    (r) => html`<tr>${rowHead(COPY.artifact[r.id])}<td><a href="${releaseHref(d.version, r.file)}"><code>${r.file}</code></a></td><td>${MIN_OS[osOfId(r.id)]}</td></tr>`,
  );
  return dataTable({ id: "files-caption", caption: COPY.filesCaption(d.version), head: [COPY.colOs, COPY.colFile, COPY.colMinVersion], rows });
}

/** 허가 사용자의 4~6번: 큰 버튼(감지했을 때) · 경고 예고 · 다른 운영체제 */
function downloadsBlock(d: Downloads, os: Os | null): SafeHtml {
  const head = html`<h2 id="download">${COPY.downloadsTitle}</h2>`;
  switch (d.kind) {
    case "none":
      return html`${head}<p class="muted">${COPY.noRelease}</p>`;
    case "unavailable":
      return html`${head}${notice({ tone: "warning", id: "release-unavailable", body: COPY.releaseUnavailable })}`;
    case "ok": {
      const big = os === null ? null : bigButton(d, os);
      // 감지에 실패했거나 주 산출물이 없으면 큰 버튼 없이 표를 펼친다
      return html`${head}${big ?? ""}<p class="muted">${COPY.warnPreview}</p>${disclosure(COPY.otherOs, otherOsTable(d, os), { open: big === null })}`;
    }
  }
}

// ---- 7. 설치하기 ----

/** 명령에 넣는 파일 이름: 버전을 알면 실제 이름, 모르면 자리표시 */
function fileFor(d: Downloads | null, id: LandingId): string {
  if (d === null || d.kind !== "ok") return COPY.savedFile;
  const row = d.rows.find((r) => r.id === id);
  if (row !== undefined) return row.file;
  const f = LANDING_FILES.find((x) => x.id === id);
  return f === undefined ? COPY.savedFile : artifactFile(d.version, f.name);
}

function macSteps(): SafeHtml {
  return html`<p>${COPY.macDamaged}</p><ol class="steps"><li>${COPY.macMove}</li><li>${COPY.macOpenAnyway}</li><li>${COPY.macTerminal}</li></ol><pre tabindex="0"><code class="selectable">${COPY.macXattr}</code></pre><p>${COPY.macXattrNote}</p>`;
}

function windowsSteps(): SafeHtml {
  return html`${notice({ tone: "warning", id: "win-sac", body: COPY.winSac })}<ol class="steps"><li>${COPY.winSmartScreen}</li></ol>`;
}

function linuxSteps(d: Downloads | null): SafeHtml {
  const chmod = `chmod +x ${fileFor(d, "appimage")}`;
  const apt = `sudo apt install ./${fileFor(d, "deb")}`;
  return html`<p>${COPY.linuxAppImage}</p><pre tabindex="0"><code class="selectable">${chmod}</code></pre><p>${COPY.linuxDeb}</p><pre tabindex="0"><code class="selectable">${apt}</code></pre>`;
}

/** 감지한 OS 절은 열고 나머지는 닫는다. 감지에 실패하면 셋 모두 연다 */
function installSection(d: Downloads | null, os: Os | null): SafeHtml {
  const panels: Readonly<Record<Os, SafeHtml>> = { macos: macSteps(), windows: windowsSteps(), linux: linuxSteps(d) };
  const sections = OS_ORDER.map((k) => disclosure(OS_NAME[k], panels[k], { open: os === null || os === k }));
  return html`<h2 id="install">${COPY.installTitle}</h2>${sections}`;
}

// ---- 8. 파일 확인 ----

function fileCheck(d: Ok): SafeHtml {
  const rows = d.rows.map(
    (r) => html`<tr>${rowHead(html`<a href="${releaseHref(d.version, r.file)}"><code>${r.file}</code></a>`)}<td><code>${r.sha256}</code></td></tr>`,
  );
  const table = dataTable({ id: "sums-caption", caption: COPY.filesCaption(d.version), head: [COPY.colFile, "SHA-256"], rows });
  return disclosure(COPY.fileCheck, html`<p>${COPY.fileCheckLead}</p>${table}`);
}

// ---- 11. 내 기기 ----

function devicesSection(m: MemberModel): SafeHtml {
  const lead = html`<h2 id="devices">${COPY.devicesTitle}</h2><p class="muted">${COPY.devicesLead}</p>`;
  if (m.devices.length === 0) return html`${lead}<p>${COPY.devicesEmpty}</p>`;
  const rows = m.devices.map(
    (s) =>
      html`<tr>${rowHead(`${kindLabel(s.kind)}${s.id === m.currentSessionId ? ` · ${COPY.thisBrowser}` : ""}`)}<td>${s.client ?? "—"}</td><td>${when(s.createdAt)}</td><td>${when(s.lastSeenAt)}</td><td>${postButton(`/me/sessions/${s.id}/revoke`, m.csrf, COPY.revoke)}</td></tr>`,
  );
  const table = dataTable({
    id: "devices-caption",
    caption: `${COPY.devicesTitle}. ${COPY.tableTimeNote}`,
    head: [COPY.colKind, COPY.colClient, COPY.colCreated, COPY.colLastSeen],
    actions: true,
    rows,
  });
  return html`${lead}${table}`;
}

// ---- 본문 ----

function landingBody(config: Config, m: LandingModel): SafeHtml {
  const os = detectedOs(m.entry);
  const member = m.member;
  const lead = m.nav.kind === "member" ? COPY.signedInAs(m.nav.channelName) : COPY.anonLead;
  const phone = m.entry.kind === "phone" ? mobileBlock(config) : "";
  const cta = member === null ? anonCta() : downloadsBlock(member.downloads, os);
  const check = member !== null && member.downloads.kind === "ok" ? fileCheck(member.downloads) : "";
  // 12. 로그아웃은 테두리 버튼 하나(채움 버튼은 페이지에 하나뿐이다)
  const tail = member === null ? "" : html`${devicesSection(member)}<div class="actions">${postButton("/auth/web/logout", member.csrf, COPY.logout)}</div>`;
  return html`${phone}<h1 class="hero">${COPY.siteName}</h1><p class="lead">${lead}</p>${notice({ tone: "info", id: "unofficial", body: COPY.notice.short })}${cta}${installSection(member?.downloads ?? null, os)}${check}<h2 id="login">${COPY.loginSectionTitle}</h2><p>${COPY.loginSectionBody} ${COPY.loginTwice}</p><h2 id="help">${COPY.helpSectionTitle}</h2><p><a href="/help">${COPY.helpTitle}</a></p><p>${COPY.reportHelp} ${COPY.landing.contact}</p><p><a href="${COPY.issuesUrl}" rel="noopener noreferrer">${COPY.landing.contactLink}</a></p>${tail}`;
}

/** GET /의 응답. 늘 200, 읽기 척도, 색인·OG를 켠다. 요청 헤더가 바꾸는 것은 감지 결과(순서·강조)뿐이다 */
export function renderLanding(config: Config, m: LandingModel): Response {
  return htmlPage(config, 200, COPY.siteTitle, landingBody(config, m), {
    scale: "reading",
    nav: m.nav,
    index: true,
    og: true,
    flash: m.flash,
    ...(m.headers === undefined ? {} : { headers: m.headers }),
  });
}
