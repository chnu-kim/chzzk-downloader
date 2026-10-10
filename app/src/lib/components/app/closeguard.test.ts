import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppError } from '../../bindings';

vi.mock('../../api', () => ({
  onCloseRequested: vi.fn(),
  quit: vi.fn(),
}));

const api = await import('../../api');
const { toasts } = await import('../../stores/toast.svelte');
const { default: CloseGuard } = await import('./CloseGuard.svelte');

let fire: (n: number) => void = () => {};
const unlisten = vi.fn();

beforeEach(() => {
  unlisten.mockReset();
  vi.mocked(api.onCloseRequested).mockReset().mockImplementation(async (cb) => {
    fire = cb;
    return unlisten;
  });
  vi.mocked(api.quit).mockReset();
  toasts.clear();
});

async function mounted() {
  const r = render(CloseGuard);
  await waitFor(() => expect(api.onCloseRequested).toHaveBeenCalled());
  return r;
}

describe('D1 창 닫기 확인', () => {
  it('close-requested가 오면 받는 중 수와 함께 뜨고 기본 포커스는 계속 받기', async () => {
    await mounted();
    expect(screen.queryByRole('dialog')).toBeNull();
    fire(2);
    const d = await screen.findByRole('dialog', { name: '다운로드를 멈추고 닫을까요?' });
    expect(
      within(d).getByText('받는 중인 영상이 2개 있어요. 닫으면 일시정지되고, 다음에 앱을 열면 이어받을 수 있어요.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(within(d).getByRole('button', { name: '계속 받기' })).toHaveFocus());
    // 오른쪽(primary, 첫 포커스)이 안전한 쪽, 왼쪽(secondary)이 실행 쪽이다
    expect(within(d).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['닫기', '계속 받기']);
    expect(within(d).getByRole('button', { name: '계속 받기' })).toHaveClass('btn-primary');
    expect(within(d).getByRole('button', { name: '닫기' })).not.toHaveClass('btn-primary');
    // 열린 채 다시 오면 수만 바뀐다
    fire(1);
    expect(await within(d).findByText(/받는 중인 영상이 1개/)).toBeInTheDocument();
  });

  it('계속 받기·Esc는 닫기만 하고 quit을 부르지 않는다', async () => {
    const user = userEvent.setup();
    await mounted();
    fire(1);
    await user.click(await screen.findByRole('button', { name: '계속 받기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fire(1);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.quit).not.toHaveBeenCalled();
  });

  it('[닫기]는 quit을 한 번만 부르고 그동안 진행 중으로 막고, [계속 받기]도 닫지 않는다', async () => {
    let done!: () => void;
    vi.mocked(api.quit).mockReturnValue(new Promise<void>((r) => (done = r)));
    const user = userEvent.setup();
    await mounted();
    fire(3);
    const d = await screen.findByRole('dialog');
    const close = within(d).getByRole('button', { name: '닫기' });
    await user.click(close);
    // loading 버튼은 disabled가 아니라 aria-busy + aria-disabled다(포커스는 남는다)
    await waitFor(() => expect(close).toHaveAttribute('aria-busy', 'true'));
    expect(close).toHaveAttribute('aria-disabled', 'true');
    // 종료 중에는 [계속 받기]를 눌러도 닫히지 않는다(되돌릴 수 없는데 닫히는 척하지 않게)
    await user.click(within(d).getByRole('button', { name: '계속 받기' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(close);
    expect(api.quit).toHaveBeenCalledTimes(1);
    done();
  });

  it('quit이 실패하면 알리고 다시 누를 수 있다', async () => {
    const e: AppError = { code: 'internal', message: 'x', stage: null, resumable: false, payload: null };
    vi.mocked(api.quit).mockRejectedValueOnce(e);
    const user = userEvent.setup();
    await mounted();
    fire(1);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(toasts.items.map((t) => t.kind)).toEqual(['danger']));
    expect(screen.queryByRole('dialog')).toBeNull();
    fire(1);
    const again = within(await screen.findByRole('dialog'));
    expect(again.getByRole('button', { name: '닫기' })).not.toHaveAttribute('aria-disabled', 'true');
    expect(again.getByRole('button', { name: '계속 받기' })).toBeEnabled();
  });

  it('사라지면 그만 듣는다', async () => {
    const r = await mounted();
    r.unmount();
    expect(unlisten).toHaveBeenCalled();
  });
});
