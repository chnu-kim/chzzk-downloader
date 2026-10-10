import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import Disclosure from './Disclosure.svelte';
import RadioGroup from './RadioGroup.svelte';
import SecretField from './SecretField.svelte';
import Select from './Select.svelte';
import Switch from './Switch.svelte';
import TextField from './TextField.svelte';
import RadioHarness from './test/RadioHarness.svelte';

const body = createRawSnippet(() => ({ render: () => `<p>안쪽 내용</p>` }));

describe('TextField', () => {
  it('고정 속성과 접근 이름', () => {
    render(TextField, { value: '', label: '주소' });
    const input = screen.getByRole('textbox', { name: '주소' });
    expect(input).toHaveClass('field');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');
    expect(input).toHaveAttribute('autocorrect', 'off');
    expect(input).toHaveAttribute('autocapitalize', 'off');
  });

  it('입력하면 onchange(value), 조합 중에는 부르지 않는다', async () => {
    const onchange = vi.fn();
    render(TextField, { value: '', label: '주소', onchange });
    const input = screen.getByRole('textbox', { name: '주소' }) as HTMLInputElement;
    input.value = 'a';
    await fireEvent.input(input);
    expect(onchange).toHaveBeenLastCalledWith('a');
    onchange.mockClear();
    input.value = 'ㅎ';
    await fireEvent.input(input, { isComposing: true });
    expect(onchange).not.toHaveBeenCalled();
    input.value = '한';
    await fireEvent.compositionEnd(input);
    expect(onchange).toHaveBeenCalledWith('한');
  });

  it('invalid면 aria-invalid와 aria-describedby', () => {
    render(TextField, { value: 'x', label: '주소', invalid: true, 'aria-describedby': 'err' });
    const input = screen.getByRole('textbox', { name: '주소' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'err');
  });

  it('이름 없는 TextField·invalid만 준 TextField는 타입 오류다', () => {
    // @ts-expect-error 이름이 없다
    void (() => render(TextField, { value: '' }));
    // @ts-expect-error invalid만 주고 설명 요소가 없다
    void (() => render(TextField, { value: '', label: '주소', invalid: true }));
  });
});

describe('SecretField', () => {
  it('라벨은 그대로고 aria-pressed로 password와 text를 오간다', async () => {
    const user = userEvent.setup();
    const { container } = render(SecretField, { value: 'abc', label: '쿠키' });
    const input = container.querySelector('input')!;
    expect(input).toHaveAttribute('type', 'password');
    const toggle = screen.getByRole('button', { name: '값 보기' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: '값 보기' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggle);
    expect(input).toHaveAttribute('type', 'password');
  });

  it('입력이 disabled여도 토글은 살아 있다', async () => {
    const user = userEvent.setup();
    const { container } = render(SecretField, { value: 'abc', label: '쿠키', disabled: true });
    const input = container.querySelector('input')!;
    expect(input).toBeDisabled();
    const toggle = screen.getByRole('button', { name: '값 보기' });
    expect(toggle).not.toBeDisabled();
    await user.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
  });
});

describe('Select', () => {
  it('숫자 값을 숫자로 돌려주고 마크업은 select-wrap > select', async () => {
    const user = userEvent.setup();
    const onchange = vi.fn();
    const { container } = render(Select<number>, {
      value: 2,
      label: '동시 받기',
      options: [
        { value: 1, label: '1' },
        { value: 2, label: '2' },
        { value: 3, label: '3' },
      ],
      onchange,
    });
    const select = screen.getByRole('combobox', { name: '동시 받기' });
    expect(select).toHaveClass('select');
    expect(select.parentElement).toHaveClass('select-wrap');
    expect(container.querySelector('svg.icon')).not.toBeNull();
    await user.selectOptions(select, '3');
    expect(onchange).toHaveBeenCalledWith(3);
  });

  it('이름이 필수다', () => {
    // @ts-expect-error 이름이 없다
    void (() => render(Select<string>, { value: 'a', options: [{ value: 'a', label: 'A' }] }));
  });
});

describe('Switch', () => {
  it('aria-checked로 말하고 Space로 토글한다', async () => {
    const user = userEvent.setup();
    const onchange = vi.fn();
    render(Switch, { value: false, label: '자동으로 이어받기', onchange });
    const sw = screen.getByRole('switch', { name: '자동으로 이어받기' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    sw.focus();
    await user.keyboard(' ');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(onchange).toHaveBeenCalledWith(true);
    await user.click(sw);
    expect(onchange).toHaveBeenLastCalledWith(false);
  });

  it('disabled여도 켜짐을 노출한다', () => {
    render(Switch, { value: true, label: '잠김', disabled: true });
    const sw = screen.getByRole('switch', { name: '잠김' });
    expect(sw).toBeDisabled();
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });
});

describe('RadioGroup', () => {
  it('네이티브 라디오이고 방향키로 바로 고른다', async () => {
    const user = userEvent.setup();
    const onchange = vi.fn();
    render(RadioHarness, { onchange });
    expect(screen.getByRole('radiogroup', { name: '화질' })).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios.every((r) => r.getAttribute('name') === 'quality')).toBe(true);
    expect(radios.map((r) => (r as HTMLInputElement).checked)).toEqual([false, true, false]);

    await user.tab();
    expect(radios[1]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(radios[2]).toHaveFocus();
    expect(radios[2]).toBeChecked();
    expect(screen.getByTestId('value')).toHaveTextContent('480');
    expect(onchange).toHaveBeenLastCalledWith(480);

    await user.click(radios[0]);
    expect(screen.getByTestId('value')).toHaveTextContent('1080');
    expect(onchange).toHaveBeenCalledTimes(2);
  });

  it('description·trailing을 그리고 disabled 행은 고를 수 없다', async () => {
    const user = userEvent.setup();
    const onchange = vi.fn();
    render(RadioHarness, { onchange, disabledId: 'q480' });
    expect(screen.getByText('큰 화면')).toHaveClass('choice-description');
    expect(screen.getByTestId('trail-q720').parentElement).toHaveClass('choice-trailing');
    const disabled = screen.getByRole('radio', { name: /480p/ });
    expect(disabled).toBeDisabled();
    await user.click(disabled);
    expect(onchange).not.toHaveBeenCalled();
  });

  it('이름이 필수다', () => {
    // @ts-expect-error 이름이 없다
    void (() => render(RadioGroup<number>, { name: 'x', value: 1, options: [] }));
  });
});

describe('Disclosure', () => {
  it('details/summary이고 제목은 기본 h2, heading="h3"면 h3', () => {
    const { container, unmount } = render(Disclosure, { title: '고급', children: body });
    expect(container.querySelector('details.disclosure > summary > h2')).toHaveTextContent('고급');
    unmount();
    const r = render(Disclosure, { title: '고급', heading: 'h3', children: body });
    expect(r.container.querySelector('summary > h3')).toHaveTextContent('고급');
  });

  it('inline은 disclosure-inline이고 제목이 글자 그대로다', () => {
    const { container } = render(Disclosure, { variant: 'inline', title: '값을 찾는 방법', children: body });
    expect(container.querySelector('details')).toHaveClass('disclosure', 'disclosure-inline');
    expect(container.querySelector('summary h2, summary h3')).toBeNull();
    expect(container.querySelector('.disclosure-panel')).toHaveTextContent('안쪽 내용');
  });

  it('열면 onchange(true), open prop으로 시작할 수 있다', async () => {
    const user = userEvent.setup();
    const onchange = vi.fn();
    const { container, unmount } = render(Disclosure, { title: '고급', onchange, children: body });
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    await user.click(container.querySelector('summary')!);
    await vi.waitFor(() => expect(onchange).toHaveBeenCalledWith(true));
    expect(details.open).toBe(true);
    unmount();
    const r = render(Disclosure, { title: '고급', open: true, children: body });
    expect(r.container.querySelector('details')!.open).toBe(true);
  });
});
