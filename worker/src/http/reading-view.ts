// 읽기 페이지 `/help`·`/privacy`·`/licenses`(docs/design/system/web.md §10, 계약 §5). 모두 읽기 척도·색인·자격 없음이다.
// 순수 렌더 함수다: 생성 데이터(HELP·LICENSES)를 구조로 받아 HTML 태그드 템플릿으로 그린다(이스케이프 없는 삽입은 쓰지 않는다).
// 이 모듈은 라우터·핸들러·DO 저장소 클래스를 값으로 가져오지 않는다(design-worker가 Node에서 부른다, 계약 §2.1).
// 보관 기간 숫자는 저장소의 상수에서 가져온다(처리방침과 코드가 어긋나지 않게, vitest가 화면 숫자 = 상수를 본다).
import type { Config } from "../config";
import { html, type SafeHtml } from "../core/html";
import { AUDIT_CAP, DENIED_CAP, DENIED_KEEP_MS } from "../store/allowlist";
import { FLOW_TTL_MS } from "../store/flows";
import { REFRESH_TTL_MS, SESSION_MAX_MS, WEB_TTL_MS } from "../store/sessions";
import { REVOKED_KEEP_MS } from "../store/sweep";
import { COPY } from "./copy";
import { HELP } from "./help.generated";
import { htmlPage, type Nav } from "./layout";
import { LICENSES } from "./licenses.generated";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

type HelpBlock = (typeof HELP)[number]["blocks"][number];

function helpBlock(b: HelpBlock): SafeHtml {
  switch (b.t) {
    case "p":
      return html`<p>${b.text}</p>`;
    case "ol":
      return html`<ol class="steps">${b.items.map((item) => html`<li>${item}</li>`)}</ol>`;
    case "pre":
      return html`<pre tabindex="0"><code class="selectable">${b.text}</code></pre>`;
  }
}

/** GET /help: 첫 문단 → 차례 → 절. id는 h2에만 둔다(접힘 안에는 두지 않는다) */
export function renderHelp(config: Config, nav: Nav): Response {
  const toc = html`<nav aria-label="${COPY.helpToc}"><ul>${HELP.map((a) => html`<li><a href="#${a.id}">${a.title}</a></li>`)}</ul></nav>`;
  const sections = HELP.map((a) => html`<h2 id="${a.id}">${a.title}</h2>${a.blocks.map(helpBlock)}`);
  const body = html`<h1>${COPY.helpTitle}</h1><p>${COPY.helpIntro}</p>${toc}${sections}`;
  return htmlPage(config, 200, COPY.helpTitle, body, { scale: "reading", nav, index: true });
}

/** GET /privacy: 코드 사실만 짧게. 보관 기간 숫자는 저장소 상수에서 온다 */
export function renderPrivacy(config: Config, nav: Nav): Response {
  const p = COPY.privacy;
  const keep = html`<ul><li>${p.keep.web(WEB_TTL_MS / HOUR_MS)}</li><li>${p.keep.app(REFRESH_TTL_MS / DAY_MS, SESSION_MAX_MS / DAY_MS)}</li><li>${p.keep.revoked(REVOKED_KEEP_MS / DAY_MS)}</li><li>${p.keep.denied(DENIED_KEEP_MS / DAY_MS, DENIED_CAP)}</li><li>${p.keep.audit(AUDIT_CAP)}</li><li>${p.keep.flow(FLOW_TTL_MS / MINUTE_MS)}</li></ul>`;
  const contact = html`<dl class="summary"><dt>${COPY.adminsTitle}</dt><dd>${p.operator}</dd><dt>${p.contact.label}</dt><dd><p>${COPY.landing.contact}</p><p><a href="${COPY.issuesUrl}" rel="noopener noreferrer">${COPY.landing.contactLink}</a></p></dd></dl>`;
  const body = html`<h1>${COPY.privacyTitle}</h1><p>${p.intro.body}</p><h2>${p.collect.title}</h2><p>${p.collect.body}</p><h2>${p.use.title}</h2><p>${p.use.body}</p><h2>${p.exclude.title}</h2><p>${p.exclude.body}</p><h2>${p.cookie.title}</h2><p>${p.cookie.body}</p><h2>${p.keep.title}</h2><p>${p.keep.body}</p>${keep}<h2>${p.abroad.title}</h2><p>${p.abroad.body}</p><h2>${p.cut.title}</h2><p>${p.cut.body}</p><h2>${p.contact.title}</h2><p>${p.contact.body}</p>${contact}`;
  return htmlPage(config, 200, COPY.privacyTitle, body, { scale: "reading", nav, index: true });
}

/** GET /licenses: 고지 문서마다 h2 + 원문(앱 정보 화면과 같은 원천 licenses/) */
export function renderLicenses(config: Config, nav: Nav): Response {
  const sections = LICENSES.map((l) => html`<h2>${l.name}</h2><pre class="license">${l.text}</pre>`);
  const body = html`<h1>${COPY.licensesTitle}</h1>${sections}`;
  return htmlPage(config, 200, COPY.licensesTitle, body, { scale: "reading", nav, index: true });
}
