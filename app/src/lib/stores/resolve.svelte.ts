// 불러오기 상태(ResolveStore): idle | loading | ready | error.
// 취소는 세대 번호를 올려 늦게 온 결과를 버리는 것이다(patterns.md §14.2 (b)). Rust 요청은 코어 타임아웃까지 혼자 끝난다.
import * as api from '../api';
import type { AppError, ResolvedDto } from '../bindings';

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
