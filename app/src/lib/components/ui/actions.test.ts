import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet, type ComponentProps } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import Button from './Button.svelte';
import IconButton from './IconButton.svelte';
import Kbd from './Kbd.svelte';
import Spinner from './Spinner.svelte';

const text = (s: string) => createRawSnippet(() => ({ render: () => `<span>${s}</span>` }));

describe('Button', () => {
  it('variant·tone·size가 ui.css 클래스가 된다', () => {
    render(Button, { children: text('기본') });
    const plain = screen.getByRole('button', { name: '기본' });
    expect(plain).toHaveClass('btn');
    expect(plain).not.toHaveClass('btn-primary', 'btn-ghost', 'btn-sm', 'btn-lg', 'tone-danger');
    expect(plain).toHaveAttribute('type', 'button');
  });

  it('primary·ghost·sm·lg·danger 클래스', () => {
    const { unmount } = render(Button, { variant: 'primary', size: 'lg', children: text('받기') });
    expect(screen.getByRole('button', { name: '받기' })).toHaveClass('btn-primary', 'btn-lg');
    unmount();
    render(Button, { variant: 'ghost', size: 'sm', tone: 'danger', children: text('지우기') });
    expect(screen.getByRole('button', { name: '지우기' })).toHaveClass('btn-ghost', 'btn-sm', 'tone-danger');
  });

  it('loading이면 aria-busy·aria-disabled, 스피너, 클릭 무시, 포커스 유지', async () => {
    const user = userEvent.setup();
    const onclick = vi.fn();
    const { container } = render(Button, { loading: true, onclick, children: text('저장') });
    const btn = screen.getByRole('button', { name: '저장' });
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).not.toBeDisabled();
    expect(container.querySelector('svg.spinner')).not.toBeNull();
    await user.click(btn);
    expect(onclick).not.toHaveBeenCalled();
    btn.focus();
    expect(btn).toHaveFocus();
  });

  it('aria-disabled면 클릭을 무시한다', async () => {
    const user = userEvent.setup();
    const onclick = vi.fn();
    render(Button, { 'aria-disabled': 'true', onclick, children: text('잠시') });
    await user.click(screen.getByRole('button', { name: '잠시' }));
    expect(onclick).not.toHaveBeenCalled();
  });

  it('평소에는 onclick을 부르고 disabled는 네이티브로 막는다', async () => {
    const user = userEvent.setup();
    const onclick = vi.fn();
    const { unmount } = render(Button, { onclick, children: text('누르기') });
    await user.click(screen.getByRole('button', { name: '누르기' }));
    expect(onclick).toHaveBeenCalledOnce();
    unmount();
    render(Button, { disabled: true, children: text('끔') });
    expect(screen.getByRole('button', { name: '끔' })).toBeDisabled();
  });

  it('kbd는 보이지만 접근 이름에 들어가지 않는다', () => {
    render(Button, { kbd: 'Enter', children: text('다운로드') });
    const btn = screen.getByRole('button', { name: '다운로드' });
    expect(btn).toHaveTextContent('Enter');
    expect(btn.querySelector('kbd.kbd')).not.toBeNull();
  });

  it('못 만드는 조합은 타입 오류다', () => {
    type P = ComponentProps<typeof Button>;
    const children = text('x');
    // @ts-expect-error children이 없는 Button
    const noChildren: P = {};
    // @ts-expect-error primary + danger
    const dangerPrimary: P = { variant: 'primary', tone: 'danger', children };
    // @ts-expect-error primary + disabled
    const disabledPrimary: P = { variant: 'primary', disabled: true, children };
    // @ts-expect-error lg + icon
    const largeIcon: P = { size: 'lg', icon: 'copy', children };
    void [noChildren, dangerPrimary, disabledPrimary, largeIcon];
  });
});

describe('IconButton', () => {
  it('label이 aria-label·title이고 기본 크기는 md', () => {
    const { container } = render(IconButton, { icon: 'settings', label: '설정' });
    const btn = screen.getByRole('button', { name: '설정' });
    expect(btn).toHaveAttribute('title', '설정');
    expect(btn).toHaveClass('icon-btn');
    expect(btn).not.toHaveClass('icon-btn-sm');
    expect(container.querySelector('svg')).toHaveClass('icon-md');
  });

  it('sm은 icon-btn-sm, aria-pressed는 통과한다', () => {
    const { container } = render(IconButton, { icon: 'eye', label: '값 보기', size: 'sm', 'aria-pressed': true });
    const btn = screen.getByRole('button', { name: '값 보기' });
    expect(btn).toHaveClass('icon-btn-sm');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('svg')).not.toHaveClass('icon-md');
  });
});

describe('Kbd·Spinner', () => {
  it('Kbd는 kbd 요소다', () => {
    const { container } = render(Kbd, { children: text('Esc') });
    expect(container.querySelector('kbd.kbd')).toHaveTextContent('Esc');
  });

  it('Spinner는 장식 svg이고 sm에서 spinner-sm', () => {
    const { container, unmount } = render(Spinner, {});
    const md = container.querySelector('svg')!;
    expect(md).toHaveClass('spinner');
    expect(md).not.toHaveClass('spinner-sm');
    expect(md).toHaveAttribute('aria-hidden', 'true');
    expect(md).not.toHaveAttribute('role');
    unmount();
    const r = render(Spinner, { size: 'sm' });
    expect(r.container.querySelector('svg')).toHaveClass('spinner', 'spinner-sm');
  });
});
