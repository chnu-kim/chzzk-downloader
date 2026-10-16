// 불러오기 상태(ResolveStore): idle | loading | ready | error.
// 취소는 세대 번호를 올려 늦게 온 결과를 버리는 것이다(patterns.md §14.2 (b)). Rust 요청은 코어 타임아웃까지 혼자 끝난다.
import * as api from '../api';
import type { AppError, ResolvedDto } from '../bindings';
import { toAppError } from '../copy/errors';

export type ResolveState =
  | { kind: 'idle' }
  | { kind: 'loading'; gen: number; url: string }
  | { kind: 'ready'; gen: number; view: ResolvedDto }
  | { kind: 'error'; gen: number; url: string; error: AppError };

export class ResolveStore {
  /** URL 입력줄의 글. 최근 VOD·드롭·클립보드 제안·붙여넣기가 함께 쓴다 */
  input = $state('');
  state: ResolveState = $state({ kind: 'idle' });
  #gen = 0;
  /** [다시 불러오기] 중인 카드의 gen(없으면 null) */
  recheckGen: number | null = $state(null);
  /** 마지막 [다시 불러오기] 실패(그 카드 gen에서만 보인다) */
  #recheckError: { gen: number; error: AppError } | null = $state(null);

  get idle(): boolean {
    return this.state.kind === 'idle';
  }

  /** 입력줄에 넣고 불러온다. 새로 시작하면 앞선 요청의 결과는 버린다. */
  async load(url: string): Promise<void> {
    const trimmed = url.trim();
    this.input = trimmed;
    if (!trimmed) return;
    const gen = ++this.#gen;
    this.state = { kind: 'loading', gen, url: trimmed };
    try {
      const view = await api.resolve(trimmed);
      if (gen === this.#gen) this.state = { kind: 'ready', gen, view };
    } catch (e) {
      if (gen === this.#gen) this.state = { kind: 'error', gen, url: trimmed, error: e as AppError };
    }
  }

  get rechecking(): boolean {
    return this.state.kind === 'ready' && this.recheckGen === this.state.gen;
  }

  get recheckFailure(): AppError | null {
    return this.state.kind === 'ready' && this.#recheckError?.gen === this.state.gen ? this.#recheckError.error : null;
  }

  /**
   * 막힌 카드의 [다시 불러오기](delegation.md §5.1): 셸이 맡은 채널을 서버에 묻고 같은 주소를 다시 불러온다.
   * 판정이 같으면 카드를 그대로 둔다(caption "마지막 확인"만 auth-changed로 바뀐다). 바뀌면 새 카드로 다시 그린다
   * ({#key gen}: 제목 포커스·a11y.resolved 낭독은 카드가 한다). 카드 하나에 한 번에 하나(single-flight)
   */
  async recheck(): Promise<void> {
    // 카드(gen)마다 한 번에 하나: 앞 카드의 늦은 요청이 새 카드의 누름을 막지 않는다(늦은 응답은 gen이 달라 버린다)
    if (this.state.kind !== 'ready' || this.recheckGen === this.state.gen) return;
    const { gen, view } = this.state;
    this.recheckGen = gen;
    this.#recheckError = null;
    try {
      const next = await api.ownershipRecheck(view.url);
      if (gen !== this.#gen) return;
      if (next.ownership !== view.ownership) {
        const g = ++this.#gen;
        this.state = { kind: 'ready', gen: g, view: next };
      }
    } catch (e) {
      if (gen === this.#gen) this.#recheckError = { gen, error: toAppError(e) };
    } finally {
      if (this.recheckGen === gen) this.recheckGen = null;
    }
  }

  /** 불러오는 중 취소: 입력은 그대로 두고 처음 상태로. */
  cancel() {
    this.#gen++;
    this.state = { kind: 'idle' };
  }

  /** 카드·오류 닫기. */
  close() {
    this.#gen++;
    this.state = { kind: 'idle' };
  }

  /** 다운로드 목록에 넣은 뒤: 카드를 접고 입력줄을 비운다(patterns.md §9 F-6). */
  finish() {
    this.close();
    this.input = '';
  }
}

export const resolver = new ResolveStore();
