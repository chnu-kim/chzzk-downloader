// 랜딩 화면 렌더러(docs/design/worker.md §9.5, 구현 중 변경 38). 순수 함수: 모든 출력은 HTML 태그드 템플릿을 거친다.
// 스크립트·인라인 스타일 0개(CSP): 동작은 폼과 링크뿐이다.
import { html, type SafeHtml } from "../core/html";
import { artifactFile } from "../core/landing";
import type { MySessionView } from "../store/types";
import { COPY } from "./copy";
import { kindLabel, kst } from "./format";
import type { Downloads } from "./landing";

export function csrfInput(csrf: string): SafeHtml {
  return html`<input type="hidden" name="csrf" value="${csrf}">`;
}

/** 한 번 누르는 POST 버튼(폼 하나). fields는 숨은 입력이다 */
export function postButton(action: string, csrf: string, label: string, o: { danger?: boolean; fields?: Readonly<Record<string, string>> } = {}): SafeHtml {
  const hidden = Object.entries(o.fields ?? {}).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`);
  const button = o.danger === true ? html`<button type="submit" class="danger">${label}</button>` : html`<button type="submit">${label}</button>`;
  return html`<form class="inline" method="post" action="${action}">${csrfInput(csrf)}${hidden}${button}</form>`;
}

export function anonymousBody(): SafeHtml {
  return html`<h1>${COPY.siteName}</h1><p>${COPY.anonLead}</p><form method="post" action="/auth/web/start"><button type="submit" class="primary">${COPY.loginWithChzzk}</button></form><p class="muted">${COPY.anonAppHint}</p>`;
}

export interface MemberModel {
  readonly channelName: string;
  readonly isAdmin: boolean;
  readonly csrf: string;
  readonly currentSessionId: string;
  readonly downloads: Downloads;
  readonly devices: readonly MySessionView[];
}

function downloadsBody(d: Downloads): SafeHtml {
  switch (d.kind) {
    case "none":
      return html`<p class="muted">${COPY.noRelease}</p>`;
    case "unavailable":
      return html`<p class="warn">${COPY.releaseUnavailable}</p>`;
    case "ok": {
      const rows = d.rows.map(
        (r) =>
          html`<tr><td><a href="/releases/${d.version}/${r.file}">${COPY.artifact[r.id]}</a><br><span class="mono">${r.file}</span></td><td><code>${r.sha256}</code></td></tr>`,
      );
      const linux = `chmod +x ${artifactFile(d.version, "linux-x86_64.AppImage")}\nsudo apt install ./${artifactFile(d.version, "linux-x86_64.deb")}`;
      return html`<p>${COPY.latestVersion(d.version, d.pubDate)}</p><div class="scroll"><table><thead><tr><th>${COPY.colFile}</th><th>SHA-256</th></tr></thead><tbody>${rows}</tbody></table></div><p class="muted">${COPY.appleSiliconOnly}</p><details><summary>${COPY.installHelp}</summary><h3>macOS</h3><p>${COPY.macDamaged}</p><ol><li>${COPY.macMove}</li><li>${COPY.macTerminal}<pre><code>${COPY.macXattr}</code></pre></li><li>${COPY.macReopen}</li></ol><h3>Windows</h3><p>${COPY.winSmartScreen}</p><h3>Linux</h3><pre><code>${linux}</code></pre></details><p>${COPY.sameAccount}</p>`;
    }
  }
}

function devicesBody(m: MemberModel): SafeHtml {
  if (m.devices.length === 0) return html`<p>${COPY.devicesEmpty}</p>`;
  const rows = m.devices.map(
    (s) =>
      html`<tr><td>${kindLabel(s.kind)}${s.id === m.currentSessionId ? ` · ${COPY.thisBrowser}` : ""}</td><td>${s.client ?? "—"}</td><td>${kst(s.createdAt)}</td><td>${kst(s.lastSeenAt)}</td><td>${postButton(`/me/sessions/${s.id}/revoke`, m.csrf, COPY.revoke, { danger: true })}</td></tr>`,
  );
  return html`<div class="scroll"><table><caption>${COPY.tableTimeNote}</caption><thead><tr><th>${COPY.colKind}</th><th>${COPY.colClient}</th><th>${COPY.colCreated}</th><th>${COPY.colLastSeen}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function memberBody(m: MemberModel): SafeHtml {
  const admin = m.isAdmin ? html`<p><a href="/admin">${COPY.adminLink}</a></p>` : "";
  return html`<h1>${COPY.siteName}</h1><p>${COPY.signedInAs(m.channelName)}</p>${admin}<section><h2>${COPY.downloadsTitle}</h2>${downloadsBody(m.downloads)}</section><section><h2>${COPY.devicesTitle}</h2><p class="muted">${COPY.devicesLead}</p>${devicesBody(m)}</section><form method="post" action="/auth/web/logout">${csrfInput(m.csrf)}<button type="submit">${COPY.logout}</button></form>`;
}
