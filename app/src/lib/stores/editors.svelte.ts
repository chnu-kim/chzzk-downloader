// 설정 › 계정의 편집자·맡은 채널(delegation.md §4·§5.6). 화면이 열릴 때 editors_list로 읽고,
// 편집자 빼기는 지연 회수(patterns.md §4): 토스트가 사는 동안 숨기기만 하고 닫힐 때(동작 버튼 말고) editors_remove.
// 지연 빼기는 시작한 계정에 묶인다(app.md 구현 중 변경 81 (나)): 계정이 바뀌면 보내지 않고, 보내기 직전에도 다시 본다.
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import * as api from '../api';
import type { AppError, AuthStatusDto, ChannelRefDto, DelegatedChannelDto, EditorDto, EditorsDto, InviteDto } from '../bindings';
import { toAppError } from '../copy/errors';
import { t, type CopyKey } from '../copy/ko';
import { cleanDisplayText, clipGraphemes } from '../format/display';
import { NOTIFY_TITLE_MAX_GRAPHEMES } from '../timing';
import { announcer } from './announce.svelte';
import { auth } from './auth.svelte';
import { toasts } from './toast.svelte';

export type EditorsLoad = 'idle' | 'loading' | 'ready' | 'failed';

const lc = (s: string) => s.toLowerCase();

/** 토스트·접근 이름 안의 외부 이름: 위생 처리 뒤 자소 경계로 자른다 */
export const shownName = (s: string) => clipGraphemes(cleanDisplayText(s), NOTIFY_TITLE_MAX_GRAPHEMES);

/** 지금 같은 계정인가(보내기 직전 대조). checking 등 signedIn이 아니면 null */
function ownerOf(s: AuthStatusDto | null): string | null {
  return s?.state === 'signedIn' && s.channelId ? lc(s.channelId) : null;
}

/** 실패 줄 글자. `unsupported`는 아직 쓸 수 없음(79 (마)), 초대 만들기의 `invalidInput`은 상한(409) */
function failText(e: AppError, fallback: CopyKey, max?: number): string {
  if (e.code === 'unsupported') return t('editors.notReady');
  if (e.code === 'invalidInput' && fallback === 'editors.invite.failed') return t('editors.limit', { n: max ?? 10 });
  return t(fallback);
}

export class EditorsStore {
  /** 마지막으로 받은 목록(이 계정, 이번 실행) */
  dto: EditorsDto | null = $state(null);
  load: EditorsLoad = $state('idle');
  /** 만든 직후의 주소. 화면을 닫으면 비운다(저장하지 않는다) */
  invite: InviteDto | null = $state(null);
  inviting = $state(false);
  inviteError: string | null = $state(null);
  /** 지연 빼기로 숨긴 편집자 ID(소문자) */
  hidden = new SvelteSet<string>();
  /** pending 편집자 즉시 빼기 중 */
  removing = new SvelteSet<string>();
  /** 그만두기 중 */
  leaving = new SvelteSet<string>();
  /** 편집자 ID → 실패 줄 */
  rowError = new SvelteMap<string, string>();
  /** 맡은 채널 ID → 실패 줄 */
  leaveError = new SvelteMap<string, string>();

  /** 이 상태가 속한 계정(소문자) */
  #owner: string | null = null;
  /** 대기 중인 지연 빼기 */
  #pending = new Map<string, { toastId: number; owner: string }>();
  /** 늦은 `editors_list` 응답 버리기 */
  #loadSeq = 0;

  get editors(): EditorDto[] {
    return (this.dto?.editors ?? []).filter((e) => !this.hidden.has(lc(e.channelId)));
  }

  get delegated(): DelegatedChannelDto[] {
    if (this.dto) return this.dto.delegatedChannels;
    return (auth.status?.delegatedChannels ?? []).map((c: ChannelRefDto) => ({ ...c, since: null }));
  }

  /** App.svelte effect가 auth.status가 바뀔 때마다 부른다 */
  onAuth(s: AuthStatusDto | null) {
    if (s?.state === 'checking') return; // 지나가는 상태: 아무것도 하지 않는다
    const owner = ownerOf(s);
    if (owner === this.#owner) return;
    // 계정이 바뀌었거나 로그인을 벗어났다: 대기 중인 빼기는 보내지 않는다(행은 다음에 다시 보인다).
    // onclose가 #pending에 항목이 없음을 보고 보내지 않도록 먼저 지우고 닫는다
    const ps = [...this.#pending.values()];
    this.#pending.clear();
    for (const p of ps) toasts.dismiss(p.toastId, 'clear');
    this.#resetView();
    this.#owner = owner;
  }

  #resetView() {
    this.hidden.clear();
    this.removing.clear();
    this.leaving.clear();
    this.rowError.clear();
    this.leaveError.clear();
    this.dto = null;
    this.load = 'idle';
    this.invite = null;
    this.inviteError = null;
    this.#loadSeq++;
  }

  /** 설정 화면이 열릴 때 */
  async openView() {
    this.inviteError = null;
    this.rowError.clear();
    this.leaveError.clear();
    if (!ownerOf(auth.status) || auth.status?.offline) return; // 오프라인이면 묻지 않는다
    const seq = ++this.#loadSeq;
    const owner = this.#owner;
    if (this.load !== 'ready') this.load = 'loading';
    try {
      const d = await api.editorsList();
      if (!d) throw new Error('empty editors_list');
      if (seq !== this.#loadSeq || owner !== this.#owner) return;
      this.dto = d;
      this.load = 'ready';
    } catch {
      if (seq !== this.#loadSeq) return;
      // 값이 있으면 그대로 둔다
      this.load = this.dto == null ? 'failed' : 'ready';
    }
  }

  closeView() {
    this.invite = null;
    this.inviteError = null;
    this.rowError.clear();
    this.leaveError.clear();
  }

  async createInvite() {
    if (this.inviting) return;
    this.inviting = true;
    this.inviteError = null;
    const owner = this.#owner;
    try {
      const inv = await api.editorsInvite();
      if (owner !== this.#owner) return;
      this.invite = inv;
      if (this.dto) this.dto = { ...this.dto, pendingInviteUntil: inv.expiresAt };
      announcer.say(t('editors.invite.made'));
    } catch (e) {
      if (owner === this.#owner) this.inviteError = failText(toAppError(e), 'editors.invite.failed', this.dto?.editorsMax);
    } finally {
      this.inviting = false;
    }
  }

  /** 행이 화면에서 빠졌으면 true(지연 빼기는 곧바로, 기다리는 편집자는 서버가 받은 뒤). 포커스 이동이 이것을 본다 */
  async remove(ed: EditorDto): Promise<boolean> {
    const id = lc(ed.channelId);
    const owner = this.#owner;
    if (!owner || this.hidden.has(id) || this.removing.has(id)) return false;
    this.rowError.delete(id);
    if (ed.status === 'pending') return this.#removeNow(ed, owner);
    this.hidden.add(id);
    const toastId = toasts.push(t('toast.editorRemoved', { name: shownName(ed.channelName) }), 'info', {
      action: {
        label: t('action.undo'),
        run: () => {
          this.#pending.delete(id);
          this.hidden.delete(id);
        },
      },
      onclose: (reason) => {
        if (reason === 'action') return;
        const p = this.#pending.get(id);
        if (!p) return; // 계정 전환으로 취소됐다
        this.#pending.delete(id);
        void this.#send(ed, p.owner);
      },
    });
    this.#pending.set(id, { toastId, owner });
    return true;
  }

  async #send(ed: EditorDto, owner: string) {
    const id = lc(ed.channelId);
    // 보내기 직전 대조(Z1 ②): 지금 같은 계정이 아니면 보내지 않고 행을 되돌린다
    if (ownerOf(auth.status) !== owner || owner !== this.#owner) {
      this.hidden.delete(id);
      return;
    }
    try {
      await api.editorsRemove(ed.channelId);
      if (owner !== this.#owner) return;
      this.#dropEditor(id);
      this.hidden.delete(id);
    } catch (e) {
      if (owner !== this.#owner) return;
      this.hidden.delete(id); // 행을 다시 보이고 그 아래 실패 줄
      this.rowError.set(id, failText(toAppError(e), 'editors.remove.failed'));
    }
  }

  async #removeNow(ed: EditorDto, owner: string): Promise<boolean> {
    const id = lc(ed.channelId);
    this.removing.add(id);
    try {
      if (ownerOf(auth.status) !== owner || owner !== this.#owner) return false;
      await api.editorsRemove(ed.channelId);
      if (owner !== this.#owner) return false;
      this.#dropEditor(id);
      toasts.push(t('toast.editorRemoved', { name: shownName(ed.channelName) }), 'info');
      return true;
    } catch (e) {
      if (owner === this.#owner) this.rowError.set(id, failText(toAppError(e), 'editors.remove.failed'));
      return false;
    } finally {
      this.removing.delete(id);
    }
  }

  #dropEditor(id: string) {
    if (this.dto) this.dto = { ...this.dto, editors: this.dto.editors.filter((e) => lc(e.channelId) !== id) };
  }

  /** 행이 화면에서 빠졌으면 true */
  async leave(ch: DelegatedChannelDto | ChannelRefDto): Promise<boolean> {
    const id = lc(ch.channelId);
    const owner = this.#owner;
    if (!owner || this.leaving.has(id)) return false;
    this.leaving.add(id);
    this.leaveError.delete(id);
    try {
      await api.delegationsLeave(ch.channelId);
      if (owner !== this.#owner) return false;
      if (this.dto) {
        this.dto = { ...this.dto, delegatedChannels: this.dto.delegatedChannels.filter((d) => lc(d.channelId) !== id) };
      }
      toasts.push(t('toast.delegationLeft', { name: shownName(ch.channelName) }), 'info');
      return true;
    } catch (e) {
      if (owner === this.#owner) this.leaveError.set(id, failText(toAppError(e), 'delegated.leave.failed'));
      return false;
    } finally {
      this.leaving.delete(id);
    }
  }

  /** 테스트용: 모든 상태 초기화(토스트는 건드리지 않는다) */
  reset() {
    this.#pending.clear();
    this.#resetView();
    this.#owner = null;
  }
}

export const editors = new EditorsStore();
