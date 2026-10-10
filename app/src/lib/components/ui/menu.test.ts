import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Menu from './Menu.svelte';

describe('Menu', () => {
  it('열면 첫 항목, ↑↓로 이동, 위험 항목은 맨 아래(위에 선), Esc는 버튼으로 돌아간다', async () => {
    const user = userEvent.setup();
    const remove = vi.fn();
    const copy = vi.fn();
    render(Menu, {
      label: '더 보기',
      items: [
        { id: 'remove', label: '목록에서 지우기', tone: 'danger', onclick: remove },
        { id: 'copy', label: '주소 복사', onclick: copy },
      ],
    });
    const trigger = screen.getByRole('button', { name: '더 보기' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent?.trim())).toEqual(['주소 복사', '목록에서 지우기']);
    expect(items[1]).toHaveClass('menu-item', 'tone-danger');
    expect(screen.getByRole('menu')).toHaveClass('menu');
    expect(screen.getByRole('menu')).toHaveAccessibleName('더 보기');
    // 위험 항목 위에만 구분선이 있다
    const separator = screen.getByRole('separator');
    expect(separator).toHaveClass('menu-separator');
    expect(separator.nextElementSibling).toBe(items[1]);
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

  it('위험 항목이 없으면 구분선도 없다', async () => {
    const user = userEvent.setup();
    render(Menu, {
      label: '더 보기',
      items: [
        { id: 'a', label: '하나', onclick: () => {} },
        { id: 'b', label: '둘', onclick: () => {} },
      ],
    });
    await user.click(screen.getByRole('button', { name: '더 보기' }));
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('disabled 항목은 aria-disabled이고 속성 disabled가 아니다. 포커스를 받지만 실행하지 않는다', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(Menu, {
      label: '더 보기',
      items: [
        { id: 'open', label: '열기', disabled: true, onclick: run },
        { id: 'copy', label: '복사', onclick: () => {} },
      ],
    });
    await user.click(screen.getByRole('button', { name: '더 보기' }));
    const disabled = screen.getByRole('menuitem', { name: '열기' });
    expect(disabled).toHaveAttribute('aria-disabled', 'true');
    expect(disabled).not.toHaveAttribute('disabled');
    expect(disabled).toHaveFocus(); // 첫 항목이라 포커스가 닿는다
    await user.click(disabled);
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('trigger="text"는 보이는 글자가 이름이고 aria-haspopup·aria-expanded를 가진다', async () => {
    const user = userEvent.setup();
    render(Menu, {
      label: '계정 메뉴',
      trigger: 'text',
      text: '내 채널',
      items: [
        { id: 'out', label: '로그아웃', onclick: () => {} },
        { id: 'switch', label: '계정 바꾸기', onclick: () => {} },
      ],
    });
    const trigger = screen.getByRole('button', { name: '내 채널' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', screen.getByRole('menu').id);
    expect(screen.getByRole('menu')).toHaveAccessibleName('계정 메뉴');
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('Home·End·Tab, 바깥 누르기', async () => {
    const user = userEvent.setup();
    render(Menu, {
      label: '더 보기',
      items: ['a', 'b', 'c'].map((id) => ({ id, label: id, onclick: () => {} })),
    });
    const trigger = screen.getByRole('button', { name: '더 보기' });
    await user.click(trigger);
    await user.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'c' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('menuitem', { name: 'a' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'c' })).toHaveFocus();
    await user.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('IME 조합 중의 키는 무시한다', async () => {
    const user = userEvent.setup();
    render(Menu, { label: '더 보기', items: [{ id: 'a', label: 'a', onclick: () => {} }] });
    const trigger = screen.getByRole('button', { name: '더 보기' });
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, isComposing: true }));
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});

describe('Menu 위치', () => {
  it('아래로 나가면 위로 뒤집고(data-placement="top"), 들어가면 그대로 둔다', async () => {
    const rect = (top: number, bottom: number) =>
      ({ top, bottom, height: bottom - top, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    const spy = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: Element) {
        return this.getAttribute('role') === 'menu' ? rect(window.innerHeight - 20, window.innerHeight + 80) : rect(400, 428);
      });
    const user = userEvent.setup();
    render(Menu, { label: '더 보기', items: [{ id: 'a', label: 'a', onclick: () => {} }] });
    await user.click(screen.getByRole('button', { name: '더 보기' }));
    expect(screen.getByRole('menu')).toHaveAttribute('data-placement', 'top');
    await user.keyboard('{Escape}');
    spy.mockImplementation(() => rect(0, 10));
    await user.click(screen.getByRole('button', { name: '더 보기' }));
    expect(screen.getByRole('menu')).not.toHaveAttribute('data-placement');
    spy.mockRestore();
  });
});

describe('Menu 스크롤', () => {
  it('열 때 메뉴 항목 포커스가 둘레를 스크롤하지 않는다(preventScroll)', async () => {
    const user = userEvent.setup();
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    render(Menu, { label: '더 보기', items: [{ id: 'copy', label: '주소 복사', onclick: () => {} }] });
    await user.click(screen.getByRole('button', { name: '더 보기' }));
    const item = screen.getByRole('menuitem', { name: '주소 복사' });
    expect(item).toHaveFocus();
    const call = focus.mock.contexts.findIndex((c) => c === item);
    expect(call).toBeGreaterThanOrEqual(0);
    expect(focus.mock.calls[call][0]).toEqual({ preventScroll: true });
    focus.mockRestore();
  });
});
