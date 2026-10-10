// 관리 화면·허가 빼기 확인 페이지 렌더러(docs/design/worker.md §8.1, 구현 중 변경 38, docs/design/system/web.md §6.3·§7·§8).
// 순수 함수: 모든 출력은 HTML 태그드 템플릿을 거치고, 라우터·저장소·핸들러 파일을 값으로 가져오지 않는다(Node에서도 돈다, design-worker).
// 채널 이름·메모·기기 정보는 공격자가 정하는 문자열이다: 값으로만 넣어 이스케이프된다(저장 때 store가 제어·bidi 문자를 지운다).
import type { Config } from "../config";
import { html, type SafeHtml } from "../core/html";
import type { AdminView } from "../store/types";
import { COPY } from "./copy";
import type { FlashKind } from "./flash";
import { auditLabel, kindLabel } from "./format";
import { htmlPage, type Nav } from "./layout";
import { csrfInput, dataTable, errorSummary, field, linkButton, postButton, rowHead, when } from "./ui";

type Allow = AdminView["allowlist"][number];
type Denied = AdminView["denied"][number];
type Session = AdminView["sessions"][number];
type Audit = AdminView["audit"][number];

/** 관리 화면이 읽는 것. 핸들러가 DO에서 읽어 채운다 */
export interface AdminModel {
  readonly view: AdminView;
  readonly admins: readonly string[];
  readonly csrf: string;
  readonly nav: Nav;
}

/** 허가 추가 폼의 채널 ID 입력 칸 id. 오류 요약의 링크가 이 id로 간다 */
export const ALLOW_CHANNEL_FIELD = "allow-channel-id";
const ALLOW_NOTE_FIELD = "allow-note";

export interface AdminOpts {
  /** 400이면 검증 오류를 다시 그린다. 오류와 flash는 함께 오지 않는다(오류가 있으면 flash를 그리지 않는다) */
  readonly status?: 400;
  readonly errors?: readonly { readonly fieldId: string; readonly message: string }[];
  /** 다시 채울 입력값 */
  readonly values?: { readonly channelId: string; readonly note: string };
  readonly flash?: FlashKind | null;
  /** Set-Cookie(flash 지움 등) */
  readonly headers?: HeadersInit;
}

const dash = (v: string | null): string => v ?? "—";

/** 첫 열 둘째 줄: 채널 ID(보조 정보, 고정폭 숫자) */
const idLine = (id: string): SafeHtml => html`<br><span class="meta"><span class="mono num">${id}</span></span>`;

function adminsSection(admins: readonly string[]): SafeHtml {
  const rows = admins.map((id) => html`<tr>${rowHead(html`<span class="mono">${id}</span>`)}</tr>`);
  return html`<section><h2>${COPY.adminsTitle}</h2>${dataTable({ id: "tbl-admins", caption: COPY.adminsNote, head: [COPY.channelIdLabel], rows })}</section>`;
}

function allowRow(a: Allow, admins: readonly string[]): SafeHtml {
  // 관리자 채널은 서버 설정에서만 바꾼다: 글자만 둔다. 그 밖은 확인 페이지로 가는 링크 버튼(D54)
  const last = admins.includes(a.channelId)
    ? html`<span class="muted">${COPY.adminsTitle}</span>`
    : html`<div class="actions">${linkButton(`/admin/${a.channelId}/disallow`, COPY.disallow)}</div>`;
  const note = a.note === null || a.note === "" ? "" : html`${a.note}<br>`;
  return html`<tr>${rowHead(html`${dash(a.channelName)}${idLine(a.channelId)}`)}<td>${note}<span class="meta">${COPY.colAddedBy} <span class="mono num">${a.addedBy}</span></span></td><td>${when(a.addedAt)}</td><td><span class="num">${a.activeSessions}</span></td><td>${last}</td></tr>`;
}

/** 추가 폼. 페이지의 유일한 채움 버튼이다 */
function addForm(csrf: string, o: AdminOpts): SafeHtml {
  const error = o.errors?.find((e) => e.fieldId === ALLOW_CHANNEL_FIELD)?.message;
  const channel = field({
    id: ALLOW_CHANNEL_FIELD,
    name: "channelId",
    label: COPY.channelIdLabel,
    mono: true,
    required: true,
    maxlength: 32,
    pattern: "[0-9a-f]{32}",
    autocomplete: "off",
    ...(o.values === undefined ? {} : { value: o.values.channelId }),
    ...(error === undefined ? {} : { error }),
  });
  const note = field({
    id: ALLOW_NOTE_FIELD,
    name: "note",
    label: COPY.noteLabel,
    maxlength: 64,
    autocomplete: "off",
    ...(o.values === undefined ? {} : { value: o.values.note }),
  });
  return html`<form method="post" action="/admin/allow">${csrfInput(csrf)}${channel}${note}<div class="actions"><button type="submit" class="btn btn-primary">${COPY.add}</button></div></form>`;
}

function allowSection(rows: readonly Allow[], admins: readonly string[], csrf: string, o: AdminOpts): SafeHtml {
  const table =
    rows.length === 0
      ? html`<p>${COPY.allowEmpty}</p>`
      : dataTable({
          id: "tbl-allow",
          caption: COPY.tableTimeNote,
          // 7열을 5열로: 채널 ID는 이름 아래, 메모·추가한 관리자는 한 칸의 둘째 줄로 내린다 [잠정]
          head: [COPY.colName, COPY.colNote, COPY.colAddedAt, COPY.colActive],
          actions: true,
          rows: rows.map((a) => allowRow(a, admins)),
        });
  return html`<section><h2>${COPY.allowTitle}</h2>${table}<h3>${COPY.addTitle}</h3>${addForm(csrf, o)}</section>`;
}

function deniedRow(d: Denied, csrf: string): SafeHtml {
  return html`<tr>${rowHead(html`${dash(d.channelName)}${idLine(d.channelId)}`)}<td><span class="num">${d.attempts}</span></td><td>${when(d.firstAt)}</td><td>${when(d.lastAt)}</td><td><div class="actions">${postButton(`/admin/denied/${d.channelId}/allow`, csrf, COPY.allow)}${postButton(`/admin/denied/${d.channelId}/dismiss`, csrf, COPY.dismiss)}</div></td></tr>`;
}

function deniedSection(rows: readonly Denied[], csrf: string): SafeHtml {
  const table =
    rows.length === 0
      ? html`<p>${COPY.deniedEmpty}</p>`
      : dataTable({
          id: "tbl-denied",
          caption: COPY.tableTimeNote,
          head: [COPY.colName, COPY.colAttempts, COPY.colFirstAt, COPY.colLastAt],
          actions: true,
          rows: rows.map((d) => deniedRow(d, csrf)),
        });
  return html`<section><h2>${COPY.deniedTitle}</h2>${table}</section>`;
}

function sessionRow(s: Session, csrf: string): SafeHtml {
  return html`<tr>${rowHead(html`${dash(s.channelName)}${idLine(s.channelId)}`)}<td>${kindLabel(s.kind)}</td><td>${dash(s.client)}</td><td>${when(s.createdAt)}</td><td>${when(s.lastSeenAt)}</td><td>${s.recovered > 0 ? html`<span class="num">${s.recovered}</span>` : ""}</td><td><div class="actions">${postButton(`/admin/sessions/${s.id}/revoke`, csrf, COPY.revoke)}</div></td></tr>`;
}

function sessionsSection(rows: readonly Session[], csrf: string): SafeHtml {
  const table =
    rows.length === 0
      ? html`<p>${COPY.sessionsEmpty}</p>`
      : dataTable({
          id: "tbl-sessions",
          caption: COPY.tableTimeNote,
          head: [COPY.channelLabel, COPY.colKind, COPY.colClient, COPY.colCreated, COPY.colLastSeen, COPY.colRecovered],
          actions: true,
          rows: rows.map((s) => sessionRow(s, csrf)),
        });
  return html`<section><h2>${COPY.colActive}</h2>${table}</section>`;
}

function auditRow(a: Audit): SafeHtml {
  return html`<tr>${rowHead(when(a.at))}<td><span class="mono">${a.actor}</span></td><td>${auditLabel(a.action)}</td><td><span class="mono">${a.target ?? ""}</span></td></tr>`;
}

function auditSection(rows: readonly Audit[]): SafeHtml {
  const table =
    rows.length === 0
      ? html`<p>${COPY.auditEmpty}</p>`
      : dataTable({ id: "tbl-audit", caption: COPY.tableTimeNote, head: [COPY.colAt, COPY.colActor, COPY.colAction, COPY.colTarget], rows: rows.map(auditRow) });
  return html`<section><h2>${COPY.auditTitle}</h2>${table}</section>`;
}

/**
 * 관리 화면. 400이면 오류 요약이 main의 첫 자식이고(flash는 그리지 않는다) 입력값을 채워 둔다.
 * 표 다섯: 관리자 · 허가한 채널 · 거부된 시도 · 활성 로그인 · 감사 기록
 */
export function renderAdmin(config: Config, m: AdminModel, o: AdminOpts = {}): Response {
  const errors = o.errors ?? [];
  const summary = errors.length === 0 ? "" : errorSummary(errors);
  const body = html`${summary}<h1>${COPY.adminLink}</h1>${adminsSection(m.admins)}${allowSection(m.view.allowlist, m.admins, m.csrf, o)}${deniedSection(m.view.denied, m.csrf)}${sessionsSection(m.view.sessions, m.csrf)}${auditSection(m.view.audit)}`;
  return htmlPage(config, o.status ?? 200, COPY.adminLink, body, {
    scale: "app",
    nav: m.nav,
    flash: errors.length === 0 ? (o.flash ?? null) : null,
    ...(o.headers === undefined ? {} : { headers: o.headers }),
  });
}

/** 허가 빼기 확인 페이지(D54, web.md §7.3). 채움 버튼 없음, 폼은 최종 버튼의 것 하나, 돌아가기는 링크다 */
export function renderDisallowConfirm(
  config: Config,
  m: { readonly channelId: string; readonly channelName: string | null; readonly activeSessions: number; readonly csrf: string; readonly nav: Nav },
): Response {
  const name = dash(m.channelName);
  const button = postButton("/admin/disallow", m.csrf, COPY.audit.disallow, { tone: "danger", fields: { channelId: m.channelId } });
  const body = html`<h1>${COPY.confirmDisallow.title}</h1><dl class="summary"><dt>${COPY.colName}</dt><dd>${name}</dd><dt>${COPY.channelIdLabel}</dt><dd><span class="mono num">${m.channelId}</span></dd><dt>${COPY.colActive}</dt><dd><span class="num">${m.activeSessions}</span></dd></dl><p>${COPY.confirmDisallow.body(name, m.activeSessions)}</p><div class="actions">${button}<a href="/admin">${COPY.confirmDisallow.back}</a></div>`;
  return htmlPage(config, 200, COPY.confirmDisallow.title, body, { scale: "app", nav: m.nav });
}
