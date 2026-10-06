// 관리 화면 렌더러(docs/design/worker.md §8.1, 구현 중 변경 38). 순수 함수: 모든 출력은 HTML 태그드 템플릿을 거친다.
// 채널 이름·메모·기기 정보는 공격자가 정하는 문자열이다: 값으로만 넣어 이스케이프된다(저장 때 store가 제어·bidi 문자를 지운다).
import { html, type SafeHtml } from "../core/html";
import type { AdminView } from "../store/types";
import { COPY } from "./copy";
import { auditLabel, kindLabel, kst } from "./format";
import { csrfInput, postButton } from "./landing-view";

type Allow = AdminView["allowlist"][number];
type Denied = AdminView["denied"][number];
type Session = AdminView["sessions"][number];
type Audit = AdminView["audit"][number];

const dash = (v: string | null): string => v ?? "—";

function adminsSection(admins: readonly string[]): SafeHtml {
  const items = admins.map((id) => html`<li><span class="mono">${id}</span></li>`);
  return html`<section><h2>${COPY.adminsTitle}</h2><p class="muted">${COPY.adminsNote}</p><ul>${items}</ul></section>`;
}

function allowRow(a: Allow, admins: readonly string[], csrf: string): SafeHtml {
  const last = admins.includes(a.channelId)
    ? html`<span class="muted">${COPY.adminBadge}</span>`
    : postButton("/admin/disallow", csrf, COPY.disallow, { danger: true, fields: { channelId: a.channelId } });
  return html`<tr><td>${dash(a.channelName)}</td><td><span class="mono">${a.channelId}</span></td><td>${a.note ?? ""}</td><td><span class="mono">${a.addedBy}</span></td><td>${kst(a.addedAt)}</td><td>${a.activeSessions}</td><td>${last}</td></tr>`;
}

function allowSection(rows: readonly Allow[], admins: readonly string[], csrf: string): SafeHtml {
  const table =
    rows.length === 0
      ? html`<p>${COPY.allowEmpty}</p>`
      : html`<div class="scroll"><table><thead><tr><th>${COPY.colName}</th><th>${COPY.colChannelId}</th><th>${COPY.colNote}</th><th>${COPY.colAddedBy}</th><th>${COPY.colAddedAt}</th><th>${COPY.colActive}</th><th></th></tr></thead><tbody>${rows.map((a) => allowRow(a, admins, csrf))}</tbody></table></div>`;
  return html`<section><h2>${COPY.allowTitle}</h2>${table}<h3>${COPY.addTitle}</h3><form method="post" action="/admin/allow">${csrfInput(csrf)}<p><label>${COPY.channelIdLabel} <input type="text" name="channelId" required maxlength="32" pattern="[0-9a-f]{32}" autocomplete="off"></label></p><p><label>${COPY.noteLabel} <input type="text" name="note" maxlength="64" autocomplete="off"></label></p><button type="submit" class="primary">${COPY.add}</button></form></section>`;
}

function deniedRow(d: Denied, csrf: string): SafeHtml {
  return html`<tr><td>${dash(d.channelName)}</td><td><span class="mono">${d.channelId}</span></td><td>${d.attempts}</td><td>${kst(d.firstAt)}</td><td>${kst(d.lastAt)}</td><td>${postButton(`/admin/denied/${d.channelId}/allow`, csrf, COPY.allow)} ${postButton(`/admin/denied/${d.channelId}/dismiss`, csrf, COPY.dismiss, { danger: true })}</td></tr>`;
}

function deniedSection(rows: readonly Denied[], csrf: string): SafeHtml {
  const table =
    rows.length === 0
      ? html`<p>${COPY.deniedEmpty}</p>`
      : html`<div class="scroll"><table><thead><tr><th>${COPY.colName}</th><th>${COPY.colChannelId}</th><th>${COPY.colAttempts}</th><th>${COPY.colFirstAt}</th><th>${COPY.colLastAt}</th><th></th></tr></thead><tbody>${rows.map((d) => deniedRow(d, csrf))}</tbody></table></div>`;
  return html`<section><h2>${COPY.deniedTitle}</h2>${table}</section>`;
}

function sessionRow(s: Session, csrf: string): SafeHtml {
  return html`<tr><td>${dash(s.channelName)}<br><span class="mono">${s.channelId}</span></td><td>${kindLabel(s.kind)}</td><td>${dash(s.client)}</td><td>${kst(s.createdAt)}</td><td>${kst(s.lastSeenAt)}</td><td>${s.recovered > 0 ? s.recovered : ""}</td><td>${postButton(`/admin/sessions/${s.id}/revoke`, csrf, COPY.revoke, { danger: true })}</td></tr>`;
}

function sessionsSection(rows: readonly Session[], csrf: string): SafeHtml {
  const table =
    rows.length === 0
      ? html`<p>${COPY.sessionsEmpty}</p>`
      : html`<div class="scroll"><table><thead><tr><th>${COPY.colChannel}</th><th>${COPY.colKind}</th><th>${COPY.colClient}</th><th>${COPY.colCreated}</th><th>${COPY.colLastSeen}</th><th>${COPY.colRecovered}</th><th></th></tr></thead><tbody>${rows.map((s) => sessionRow(s, csrf))}</tbody></table></div>`;
  return html`<section><h2>${COPY.sessionsTitle}</h2>${table}</section>`;
}

function auditRow(a: Audit): SafeHtml {
  return html`<tr><td>${kst(a.at)}</td><td><span class="mono">${a.actor}</span></td><td>${auditLabel(a.action)}</td><td><span class="mono">${a.target ?? ""}</span></td></tr>`;
}

function auditSection(rows: readonly Audit[]): SafeHtml {
  const table =
    rows.length === 0
      ? html`<p>${COPY.auditEmpty}</p>`
      : html`<div class="scroll"><table><thead><tr><th>${COPY.colAt}</th><th>${COPY.colActor}</th><th>${COPY.colAction}</th><th>${COPY.colTarget}</th></tr></thead><tbody>${rows.map(auditRow)}</tbody></table></div>`;
  return html`<section><h2>${COPY.auditTitle}</h2>${table}</section>`;
}

export function adminBody(v: AdminView, admins: readonly string[], csrf: string): SafeHtml {
  return html`<h1>${COPY.adminTitle}</h1><p><a href="/">${COPY.home}</a></p>${adminsSection(admins)}${allowSection(v.allowlist, admins, csrf)}${deniedSection(v.denied, csrf)}${sessionsSection(v.sessions, csrf)}${auditSection(v.audit)}`;
}
