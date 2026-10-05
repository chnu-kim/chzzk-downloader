import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Menu from './Menu.svelte';
import ProgressBar from './ProgressBar.svelte';
import Switch from './Switch.svelte';
import DialogHarness from './test/DialogHarness.svelte';
import RadioHarness from './test/RadioHarness.svelte';

describe('Dialog', () => {
  it('기본 버튼에 포커스, Tab을 가두고, Esc로 닫으면 연 요소로 돌아간다', async () => {
    const user = userEvent.setup();
    render(DialogHarness);
    const opener = screen.getByRole('button', { name: '열기' });
    await user.click(opener);

    const dialog = screen.getByRole('dialog', { name: '다운로드를 멈추고 닫을까요?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const keep = screen.getByRole('button', { name: '계속 받기' });
    const close = screen.getByRole('button', { name: '닫기' });
    expect(keep).toHaveFocus();

    await user.tab();
    expect(close).toHaveFocus();
    await user.tab(); // 끝에서 처음으로
    expect(keep).toHaveFocus();
    await user.tab({ shift: true }); // 처음에서 끝으로
    expect(close).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('closed')).toHaveTextContent('1');
    expect(opener).toHaveFocus();
  });

  it('버튼으로 닫아도 포커스가 돌아간다', async () => {
    const user = userEvent.setup();
    render(DialogHarness);
    const opener = screen.getByRole('button', { name: '열기' });
    await user.click(opener);
    await user.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
});

describe('RadioGroup', () => {
  it('선택 항목만 탭 순서에 있고 ↑↓로 옮기면 바로 고른다', async () => {
    const user = userEvent.setup();
    const onchange = vi.fn();
    render(RadioHarness, { onchange });
    const group = screen.getByRole('radiogroup', { name: '화질' });
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');

    await user.tab();
    expect(radios[1]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(radios[2]).toHaveFocus();
    expect(radios[2]).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('selected')).toHaveTextContent('2');
    expect(onchange).toHaveBeenLastCalledWith(2);

    await user.keyboard('{ArrowDown}'); // 끝에서 처음으로
    expect(radios[0]).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(radios[2]).toHaveFocus();

    await user.click(radios[1]);
    expect(screen.getByTestId('selected')).toHaveTextContent('1');
    expect(onchange).toHaveBeenCalledTimes(4);
  });
});

describe('Menu', () => {
  it('열면 첫 항목, ↑↓로 이동, 파괴 항목은 맨 아래, Esc는 버튼으로 돌아간다', async () => {
    const user = userEvent.setup();
    const remove = vi.fn();
    const copy = vi.fn();
    render(Menu, {
      label: '더 보기',
      items: [
        { label: '목록에서 지우기', danger: true, onselect: remove },
        { label: '주소 복사', onselect: copy },
      ],
    });
    const trigger = screen.getByRole('button', { name: '더 보기' });
    await user.click(trigger);
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent?.trim())).toEqual(['주소 복사', '목록에서 지우기']);
    expect(items[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: '주소 복사' }));
    expect(copy).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('Switch·ProgressBar', () => {
  it('Switch는 role=switch와 aria-checked로 말한다', async () => {
    const user = userEvent.setup();
    const onchange = vi.fn();
    render(Switch, { checked: false, label: '자동으로 이어받기', onchange });
    const sw = screen.getByRole('switch', { name: '자동으로 이어받기' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await user.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(onchange).toHaveBeenCalledWith(true);
  });

  it('ProgressBar는 정수 퍼센트를, 총량을 모르면 값을 생략한다', () => {
    const { unmount } = render(ProgressBar, { value: 0.587, valueText: '58퍼센트, 2분 18초 남음' });
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '58');
    expect(bar).toHaveAttribute('aria-valuetext', '58퍼센트, 2분 18초 남음');
    unmount();
    render(ProgressBar, { value: null });
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  });
});

describe('Menu 스크롤', () => {
  it('열 때 메뉴 항목 포커스가 둘레를 스크롤하지 않는다(preventScroll)', async () => {
    const user = userEvent.setup();
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    render(Menu, { label: '더 보기', items: [{ label: '주소 복사', onselect: () => {} }] });
    await user.click(screen.getByRole('button', { name: '더 보기' }));
    const item = screen.getByRole('menuitem', { name: '주소 복사' });
    expect(item).toHaveFocus();
    const call = focus.mock.contexts.findIndex((c) => c === item);
    expect(call).toBeGreaterThanOrEqual(0);
    expect(focus.mock.calls[call][0]).toEqual({ preventScroll: true });
    focus.mockRestore();
  });
});

describe('Toast', () => {
  it('실패는 role=alert, 나머지는 role=status. 동작 버튼은 실행하고 닫는다', async () => {
    const { default: Toast } = await import('./Toast.svelte');
    const user = userEvent.setup();
    const run = vi.fn();
    const ondismiss = vi.fn();
    const { unmount } = render(Toast, {
      item: { id: 1, kind: 'danger', message: '파일을 찾을 수 없어요', action: { label: '폴더 열기', run } },
      ondismiss,
      onpause: () => {},
      onresume: () => {},
    });
    expect(screen.getByRole('alert')).toHaveTextContent('파일을 찾을 수 없어요');
    await user.click(screen.getByRole('button', { name: '폴더 열기' }));
    expect(run).toHaveBeenCalledOnce();
    expect(ondismiss).toHaveBeenCalledOnce();
    unmount();
    render(Toast, { item: { id: 2, kind: 'success', message: '완료' }, ondismiss, onpause: () => {}, onresume: () => {} });
    expect(screen.getByRole('status')).toHaveTextContent('완료');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
