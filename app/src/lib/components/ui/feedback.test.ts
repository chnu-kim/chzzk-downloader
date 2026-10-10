import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOAST_MS } from '../../timing';
import { toasts } from '../../stores/toast.svelte';
import Toaster from '../app/Toaster.svelte';
import ConfirmDialog from './ConfirmDialog.svelte';
import { leaveMotion } from './focus';
import DialogHarness from './test/DialogHarness.svelte';
import NoticeHarness from './test/NoticeHarness.svelte';
import Toast from './Toast.svelte';

/** inert가 아닌 층(대화상자가 열린 동안 사용자가 닿는 곳) */
function liveLayer(): HTMLElement {
  const layers = [...document.body.children].filter((c) => !c.hasAttribute('inert')) as HTMLElement[];
  expect(layers).toHaveLength(1);
  return layers[0];
}

describe('Dialog', () => {
  it('열면 primary에 포커스, Tab을 가두고, Esc는 onclose만 부르고 연 요소로 돌아간다', async () => {
    const user = userEvent.setup();
    render(DialogHarness);
    const opener = screen.getByRole('button', { name: '열기' });
    await user.click(opener);

    const dialog = screen.getByRole('dialog', { name: '다운로드를 멈추고 닫을까요?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('data-focus-container');
    const keep = screen.getByRole('button', { name: '계속 받기' });
    const close = screen.getByRole('button', { name: '닫기' });
    await waitFor(() => expect(keep).toHaveFocus());

    await user.tab(); // 끝에서 처음으로
    expect(close).toHaveFocus();
    await user.tab({ shift: true }); // 처음에서 끝으로
    expect(keep).toHaveFocus();
    await user.tab({ shift: true });
    expect(close).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('closed')).toHaveTextContent('1');
    expect(screen.getByTestId('primary-runs')).toHaveTextContent('0');
    expect(screen.getByTestId('secondary-runs')).toHaveTextContent('0');
    expect(opener).toHaveFocus();
  });

  it('inert 아닌 층에 .btn-primary가 정확히 1개이고 DOM 마지막 버튼이다', async () => {
    const user = userEvent.setup();
    render(DialogHarness);
    await user.click(screen.getByRole('button', { name: '열기' }));
    const layer = liveLayer();
    const primaries = layer.querySelectorAll('.btn-primary');
    expect(primaries).toHaveLength(1);
    const buttons = layer.querySelectorAll('button');
    expect(buttons[buttons.length - 1]).toBe(primaries[0]);
    expect(buttons[0]).toHaveTextContent('닫기');
  });

  it('primary 위 Enter는 primary.onclick, 버튼이 아닌 곳의 Enter는 아무것도 하지 않는다', async () => {
    const user = userEvent.setup();
    render(DialogHarness);
    await user.click(screen.getByRole('button', { name: '열기' }));
    const dialog = screen.getByRole('dialog');

    dialog.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('primary-runs')).toHaveTextContent('0');
    expect(screen.getByTestId('secondary-runs')).toHaveTextContent('0');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    screen.getByRole('button', { name: '계속 받기' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('primary-runs')).toHaveTextContent('1');
    expect(screen.getByTestId('secondary-runs')).toHaveTextContent('0');
  });

  it('scrim을 눌러도 닫히지 않는다', async () => {
    const user = userEvent.setup();
    render(DialogHarness);
    await user.click(screen.getByRole('button', { name: '열기' }));
    await user.click(document.querySelector('.scrim') as HTMLElement);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('closed')).toHaveTextContent('0');
  });

  it('danger secondary에는 tone-danger, neutral이면 없다', async () => {
    const user = userEvent.setup();
    const danger = render(DialogHarness, { secondaryTone: 'danger' });
    await user.click(screen.getByRole('button', { name: '열기' }));
    expect(screen.getByRole('button', { name: '닫기' })).toHaveClass('tone-danger');
    await user.click(screen.getByRole('button', { name: '닫기' }));
    danger.unmount();

    render(DialogHarness, { secondaryTone: 'neutral' });
    await user.click(screen.getByRole('button', { name: '열기' }));
    expect(screen.getByRole('button', { name: '닫기' })).not.toHaveClass('tone-danger');
  });

  it('열린 동안 body의 다른 자식은 inert이고, 닫으면 원래대로 돌아온다', async () => {
    const user = userEvent.setup();
    const { container } = render(DialogHarness);
    const sibling = document.createElement('div');
    sibling.setAttribute('inert', 'prev');
    document.body.append(sibling);
    await user.click(screen.getByRole('button', { name: '열기' }));

    const scrim = document.querySelector('.scrim') as HTMLElement;
    expect(scrim.parentElement).toBe(document.body);
    expect(scrim.hasAttribute('inert')).toBe(false);
    expect(container.parentElement).toBe(document.body);
    expect(container.hasAttribute('inert')).toBe(true);
    expect(sibling.getAttribute('inert')).toBe('');

    await user.click(screen.getByRole('button', { name: '계속 받기' }));
    await waitFor(() => expect(document.querySelector('.scrim')).toBeNull());
    expect(container.hasAttribute('inert')).toBe(false);
    expect(sibling.getAttribute('inert')).toBe('prev');
    sibling.remove();
  });

  it('버튼으로 닫아도 연 요소로 포커스가 돌아간다', async () => {
    const user = userEvent.setup();
    render(DialogHarness);
    const opener = screen.getByRole('button', { name: '열기' });
    await user.click(opener);
    await user.click(screen.getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(opener).toHaveFocus();
  });

  it('둘째 대화상자는 첫째가 닫힐 때까지 뜨지 않는다', async () => {
    const user = userEvent.setup();
    render(DialogHarness, { second: true });
    await user.click(screen.getByRole('button', { name: '열기' }));
    // 첫째가 떠 있어 둘째 열기 버튼은 inert 층에 있지만 상태는 직접 바꾼다
    screen.getByRole('button', { name: '둘째 열기', hidden: true }).click();
    await Promise.resolve();
    expect(screen.queryByRole('dialog', { name: '둘째 대화상자' })).toBeNull();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: '계속 받기' }));
    const second = await screen.findByRole('dialog', { name: '둘째 대화상자' });
    expect(second).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    // 본문이 없으면 aria-describedby도 없다
    expect(second).not.toHaveAttribute('aria-describedby');
  });

  it('본문이 있으면 aria-describedby가 본문 요소를 가리킨다', async () => {
    const user = userEvent.setup();
    render(DialogHarness);
    await user.click(screen.getByRole('button', { name: '열기' }));
    const dialog = screen.getByRole('dialog');
    const body = document.getElementById(dialog.getAttribute('aria-describedby') ?? '');
    expect(body).toHaveClass('dialog-body');
    expect(body).toHaveTextContent('본문');
  });

  it('loading인 버튼은 aria-busy이고 누른 동작을 실행하지 않는다', async () => {
    const user = userEvent.setup();
    const onclick = vi.fn();
    render(ConfirmDialog, {
      open: true,
      title: '앱을 닫을까요?',
      body: '받는 중인 파일은 이어받을 수 있어요.',
      primary: { id: 'keep', label: '계속 받기', onclick: () => {} },
      secondary: { id: 'close', label: '닫기', onclick, loading: true },
      onclose: () => {},
    });
    const close = await screen.findByRole('button', { name: '닫기' });
    expect(close).toHaveAttribute('aria-busy', 'true');
    await user.click(close);
    expect(onclick).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('받는 중인 파일은 이어받을 수 있어요.');
  });

  it('IME 조합 중의 Esc는 닫지 않는다', async () => {
    const user = userEvent.setup();
    render(DialogHarness);
    await user.click(screen.getByRole('button', { name: '열기' }));
    const dialog = screen.getByRole('dialog');
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true }));
    expect(screen.getByTestId('closed')).toHaveTextContent('0');
    expect(dialog).toBeInTheDocument();
  });
});

describe('leaveMotion', () => {
  it('전환이 없으면 곧바로 끝낸다', () => {
    const el = document.createElement('div');
    document.body.append(el);
    const done = vi.fn();
    leaveMotion(el, done);
    expect(done).toHaveBeenCalledOnce();
    el.remove();
  });

  it('전환이 있으면 자기 transitionend를 기다리고 자식의 것은 무시한다', () => {
    const el = document.createElement('div');
    const child = document.createElement('span');
    el.append(child);
    document.body.append(el);
    const spy = vi.spyOn(window, 'getComputedStyle').mockReturnValue({ transitionDuration: '0.15s' } as CSSStyleDeclaration);
    const done = vi.fn();
    leaveMotion(el, done);
    expect(el.dataset.motion).toBe('leave');
    child.dispatchEvent(new Event('transitionend', { bubbles: true }));
    expect(done).not.toHaveBeenCalled();
    el.dispatchEvent(new Event('transitionend'));
    el.dispatchEvent(new Event('transitionend'));
    expect(done).toHaveBeenCalledOnce();
    spy.mockRestore();
    el.remove();
  });
});

describe('Notice', () => {
  // tone × variant → role (row는 role 없음)
  const tones = ['neutral', 'info', 'warning', 'danger'] as const;
  const variants = ['inline', 'banner', 'toast', 'row'] as const;
  const cases = tones.flatMap((tone) => variants.map((variant) => [tone, variant] as const));

  it.each(cases)('tone=%s variant=%s의 role', (tone, variant) => {
    const { container } = render(NoticeHarness, { tone, variant });
    const text = container.querySelector('.notice-text') as HTMLElement;
    expect(text).toHaveAttribute('aria-atomic', 'true');
    if (variant === 'row') expect(text.hasAttribute('role')).toBe(false);
    else expect(text).toHaveAttribute('role', tone === 'danger' ? 'alert' : 'status');
    expect(container.querySelector('.notice')).toHaveClass(`notice-${variant}`, `tone-${tone}`);
  });

  it.each([
    ['info', 'info'],
    ['warning', 'triangle-alert'],
    ['danger', 'circle-x'],
  ] as const)('tone=%s는 아이콘 %s', (tone, icon) => {
    const { container } = render(NoticeHarness, { tone });
    expect(container.querySelectorAll('.notice > svg.icon')).toHaveLength(1);
    // 같은 모양의 아이콘을 직접 그린 것과 path가 같다
    const ref = render(NoticeHarness, { tone: 'neutral', icon });
    const a = container.querySelector('.notice > svg')?.innerHTML;
    const b = ref.container.querySelector('.notice > svg')?.innerHTML;
    expect(a).toBe(b);
  });

  it('neutral은 icon이 없으면 아이콘이 없고, row의 아이콘은 sm이다', () => {
    const { container } = render(NoticeHarness, { tone: 'neutral' });
    expect(container.querySelector('.notice > svg')).toBeNull();
    const row = render(NoticeHarness, { tone: 'info', variant: 'row' });
    const svg = row.container.querySelector('.notice > svg') as SVGElement;
    expect(svg).not.toHaveClass('icon-md');
  });

  it('title이 있으면 600 제목 요소가 따로 있다', () => {
    const { container } = render(NoticeHarness, { title: '제목' });
    expect(container.querySelector('.notice-title')).toHaveTextContent('제목');
  });

  it('banner는 section[aria-labelledby]이고 제목이 없으면 본문 요소가 이름이다', () => {
    const titled = render(NoticeHarness, { variant: 'banner', title: '저장하지 못했어요' });
    const region = titled.container.querySelector('section') as HTMLElement;
    expect(region.getAttribute('aria-labelledby')).toBe(titled.container.querySelector('.notice-title')?.id);
    expect(screen.getByRole('region', { name: '저장하지 못했어요' })).toBe(region);
    titled.unmount();

    const plain = render(NoticeHarness, { variant: 'banner' });
    const section = plain.container.querySelector('section') as HTMLElement;
    const target = document.getElementById(section.getAttribute('aria-labelledby') ?? '');
    expect(target).toHaveTextContent('본문 글');
    expect(target?.closest('.notice-text')).not.toBeNull();
  });

  it('actions는 secondary sm 버튼이고 누르면 실행한다. 닫기는 onclose를 부른다', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const onclose = vi.fn();
    const { container } = render(NoticeHarness, {
      actions: [
        { id: 'retry', label: '다시 시도', onclick: retry },
        { id: 'help', label: '도움말', onclick: () => {} },
      ],
      onclose,
    });
    const group = container.querySelector('.notice-actions') as HTMLElement;
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['다시 시도', '도움말', '']);
    for (const b of buttons.slice(0, 2)) {
      expect(b).toHaveClass('btn-sm');
      expect(b).not.toHaveClass('btn-primary', 'btn-ghost');
    }
    // 라이브 영역 밖에 있다
    expect(container.querySelector('.notice-text')?.contains(buttons[0])).toBe(false);
    await user.click(buttons[0]);
    expect(retry).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: '닫기' }));
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('동작 loading은 aria-busy·aria-disabled로 보이고 눌러도 실행하지 않는다(포커스는 남는다)', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    const { container } = render(NoticeHarness, {
      actions: [{ id: 'install', label: '지금 업데이트', loading: true, onclick: run }],
    });
    const btn = within(container.querySelector('.notice-actions') as HTMLElement).getByRole('button', { name: '지금 업데이트' });
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    await user.click(btn);
    expect(run).not.toHaveBeenCalled();
  });

  it('동작이 3개를 넘으면 앞 3개만 보인다', () => {
    const actions = ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id, onclick: () => {} }));
    const { container } = render(NoticeHarness, { actions });
    expect(container.querySelectorAll('.notice-actions .btn')).toHaveLength(3);
  });
});

describe('Toast', () => {
  it('실패는 role=alert, 나머지는 role=status. 동작 버튼은 실행하고 닫는다', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    const onclose = vi.fn();
    const { unmount } = render(Toast, {
      item: { id: 1, kind: 'danger', message: '파일을 찾을 수 없어요', action: { label: '폴더 열기', run } },
      onclose,
    });
    expect(screen.getByRole('alert')).toHaveTextContent('파일을 찾을 수 없어요');
    await user.click(screen.getByRole('button', { name: '폴더 열기' }));
    expect(run).toHaveBeenCalledOnce();
    expect(onclose).toHaveBeenCalledOnce();
    unmount();

    render(Toast, { item: { id: 2, kind: 'success', message: '완료' }, onclose });
    expect(screen.getByRole('status')).toHaveTextContent('완료');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('.notice-toast')).toHaveClass('tone-neutral');
  });

  it('올려 두면 멈추고 떠나면 처음부터 다시 센다', async () => {
    vi.useFakeTimers();
    try {
      toasts.clear();
      const id = toasts.push('저장했어요', 'info');
      render(Toast, { item: toasts.items[0], onclose: () => toasts.dismiss(id) });
      const el = document.querySelector('.notice-toast') as HTMLElement;
      vi.advanceTimersByTime(TOAST_MS - 1000);
      el.dispatchEvent(new MouseEvent('mouseenter'));
      vi.advanceTimersByTime(TOAST_MS * 3);
      expect(toasts.items).toHaveLength(1);
      el.dispatchEvent(new MouseEvent('mouseleave'));
      vi.advanceTimersByTime(TOAST_MS - 1);
      expect(toasts.items).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(toasts.items).toHaveLength(0);
    } finally {
      toasts.clear();
      vi.useRealTimers();
    }
  });
});

describe('Toaster', () => {
  afterEach(() => {
    toasts.clear();
  });

  it('한 번에 하나만 보이고, 닫으면 대기열의 다음이 뜬다', async () => {
    const user = userEvent.setup();
    toasts.push('첫째 오류', 'danger');
    toasts.push('둘째 오류', 'danger');
    const { container } = render(Toaster);
    expect(container.querySelector('.toaster > .col')).not.toBeNull();
    expect(container.querySelectorAll('.notice-toast')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('첫째 오류');
    await user.click(screen.getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('둘째 오류'));
    expect(container.querySelectorAll('.notice-toast')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(container.querySelector('.notice-toast')).toBeNull());
  });

  it('정보 토스트는 새 토스트가 오면 바로 대체된다', async () => {
    const { container } = render(Toaster);
    toasts.push('복사했어요', 'copied');
    await waitFor(() => expect(container.querySelector('.notice-toast')).toHaveTextContent('복사했어요'));
    toasts.push('저장했어요', 'info');
    await waitFor(() => expect(container.querySelector('.notice-toast')).toHaveTextContent('저장했어요'));
    expect(container.querySelectorAll('.notice-toast')).toHaveLength(1);
  });
});
