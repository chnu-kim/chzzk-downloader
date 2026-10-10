import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Badge from './Badge.svelte';
import DropOverlay from './DropOverlay.svelte';
import EmptyState from './EmptyState.svelte';
import FieldRow from './FieldRow.svelte';
import PageContainer from './PageContainer.svelte';
import ProgressBar from './ProgressBar.svelte';
import SettingsRow from './SettingsRow.svelte';
import Skeleton from './Skeleton.svelte';
import Surface from './Surface.svelte';
import Toolbar from './Toolbar.svelte';

const text = (s: string) => createRawSnippet(() => ({ render: () => `<span>${s}</span>` }));

afterEach(() => vi.restoreAllMocks());

describe('ProgressBar', () => {
  it('0~100 정수를 aria-valuenow로, 소수는 내리고, null이면 생략한다', () => {
    const { unmount } = render(ProgressBar, { value: 58.7, valuetext: '58퍼센트', label: '진행' });
    const bar = screen.getByRole('progressbar', { name: '진행' });
    expect(bar).toHaveAttribute('aria-valuenow', '58');
    expect(bar).toHaveAttribute('aria-valuetext', '58퍼센트');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('data-state', 'active');
    expect(bar.querySelector<HTMLElement>('.fill')!.style.getPropertyValue('--p')).toBe('0.58');
    unmount();
    render(ProgressBar, { value: null, valuetext: '총량을 몰라요', label: '진행' });
    const unknown = screen.getByRole('progressbar');
    expect(unknown).not.toHaveAttribute('aria-valuenow');
    expect(unknown.querySelector<HTMLElement>('.fill')!.style.getPropertyValue('--p')).toBe('');
  });

  it('labelledby로 이름을 받고 state를 data-state로 말한다', () => {
    render(ProgressBar, { value: 10, state: 'failed', valuetext: '실패', labelledby: 'x' });
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-labelledby', 'x');
    expect(bar).toHaveAttribute('data-state', 'failed');
  });

  it('값이 줄면 그 갱신 동안만 data-instant를 붙였다가 다음 프레임에 뗀다', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb));
    const { rerender } = render(ProgressBar, { value: 80, valuetext: '80', label: '진행' });
    const bar = screen.getByRole('progressbar');
    expect(bar).not.toHaveAttribute('data-instant');
    await rerender({ value: 90, valuetext: '90', label: '진행' });
    expect(bar).not.toHaveAttribute('data-instant');
    await rerender({ value: 20, valuetext: '20', label: '진행' });
    expect(bar).toHaveAttribute('data-instant');
    frames.splice(0).forEach((cb) => cb(0));
    await Promise.resolve();
    await Promise.resolve();
    expect(bar).not.toHaveAttribute('data-instant');
  });

  it('이름 없는 ProgressBar는 컴파일되지 않는다', () => {
    // @ts-expect-error label 또는 labelledby가 필요하다
    render(ProgressBar, { value: 1, valuetext: '1' });
  });
});

describe('Badge', () => {
  it.each([
    ['vod', '일반 VOD'],
    ['clip', '클립'],
    ['rewind', '빠른 다시보기'],
  ] as const)('%s는 글자만 보이고 role이 없다', (kind, label) => {
    render(Badge, { kind });
    const el = screen.getByText(label);
    expect(el).toHaveClass('badge');
    expect(el).not.toHaveAttribute('role');
    expect(el).not.toHaveAttribute('title');
  });

  it('adult만 보이는 글자 19에 role=img와 aria-label을 붙인다', () => {
    render(Badge, { kind: 'adult' });
    const el = screen.getByRole('img', { name: '연령 제한' });
    expect(el).toHaveTextContent('19');
  });
});

describe('Skeleton', () => {
  it('variant·width를 클래스로, 늘 aria-hidden', () => {
    const { container, unmount } = render(Skeleton, { variant: 'title' });
    const el = container.querySelector('.skeleton')!;
    expect(el).toHaveClass('skeleton-title');
    expect(el).not.toHaveClass('skeleton-half');
    expect(el).toHaveAttribute('aria-hidden', 'true');
    unmount();
    const half = render(Skeleton, { variant: 'row', width: 'half' });
    expect(half.container.querySelector('.skeleton')).toHaveClass('skeleton-row', 'skeleton-half');
  });
});

describe('EmptyState', () => {
  it('panel이 기본이고 제목 h2·본문·단계 ol·secondary 버튼을 그린다', async () => {
    const onclick = vi.fn();
    const { container } = render(EmptyState, {
      title: '제목',
      children: text('본문'),
      steps: ['하나', '둘'],
      action: { id: 'go', label: '시작', onclick },
    });
    const root = container.querySelector('.empty')!;
    expect(root).not.toHaveClass('empty-inline');
    expect(root).not.toHaveClass('empty-page');
    expect(screen.getByRole('heading', { level: 2, name: '제목' })).toBeInTheDocument();
    expect(within(root as HTMLElement).getByText('본문')).toBeInTheDocument();
    const items = within(container.querySelector('ol.steps') as HTMLElement).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['하나', '둘']);
    const btn = screen.getByRole('button', { name: '시작' });
    expect(btn).not.toHaveClass('btn-primary');
    await userEvent.setup().click(btn);
    expect(onclick).toHaveBeenCalledOnce();
  });

  it('variant 클래스를 붙이고 steps·action이 없으면 그리지 않는다', () => {
    const { container, unmount } = render(EmptyState, { variant: 'page', title: 't', children: text('b') });
    expect(container.querySelector('.empty')).toHaveClass('empty-page');
    expect(container.querySelector('ol')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    unmount();
    const inline = render(EmptyState, { variant: 'inline', children: text('b') });
    expect(inline.container.querySelector('.empty')).toHaveClass('empty-inline');
    expect(inline.container.querySelector('h2')).toBeNull();
  });

  it('inline에는 제목을 줄 수 없다', () => {
    // @ts-expect-error inline은 title이 없다
    render(EmptyState, { variant: 'inline', title: '제목', children: text('b') });
  });
});

describe('Surface', () => {
  it('group은 자식만 그린다', () => {
    const { container } = render(Surface, { children: text('안') });
    const el = container.querySelector('section')!;
    expect(el).toHaveClass('surface', 'surface-group');
    expect(container.querySelector('.card-body')).toBeNull();
  });

  it('card는 header·body·footer를 나눠 그린다', () => {
    const { container } = render(Surface, {
      variant: 'card',
      header: text('머리'),
      footer: text('발'),
      children: text('몸'),
      'aria-label': '카드',
    });
    expect(container.querySelector('section')).toHaveClass('surface-card');
    expect(container.querySelector('.card-header')).toHaveTextContent('머리');
    expect(container.querySelector('.card-body')).toHaveTextContent('몸');
    expect(container.querySelector('.card-footer')).toHaveTextContent('발');
    expect(screen.getByRole('region', { name: '카드' })).toBeInTheDocument();
  });
});

describe('SettingsRow·FieldRow', () => {
  it('SettingsRow는 control에 라벨 요소 id와 도움말 id를 넘긴다', () => {
    let got: { labelId: string; helpId?: string } | undefined;
    const control = createRawSnippet<[{ labelId: string; helpId?: string }]>((args) => {
      got = args();
      return { render: () => `<button aria-labelledby="${got!.labelId}" aria-describedby="${got!.helpId}">c</button>` };
    });
    const { container } = render(SettingsRow, { label: '자동 이어받기', help: '도움말', value: '/a/b', control });
    const label = container.querySelector('.row-label')!;
    const help = container.querySelector('.row-help')!;
    expect(got!.labelId).toBe(label.id);
    expect(got!.helpId).toBe(help.id);
    expect(label.id).not.toBe(help.id);
    expect(container.querySelector('.row-value')).toHaveTextContent('/a/b');
    expect(screen.getByRole('button', { name: '자동 이어받기' })).toHaveAccessibleDescription('도움말');
  });

  it('SettingsRow는 help·value·control이 없으면 그 요소를 그리지 않는다', () => {
    const { container } = render(SettingsRow, { label: '라벨' });
    expect(container.querySelector('.row-help')).toBeNull();
    expect(container.querySelector('.row-value')).toBeNull();
    expect(container.querySelector('.row-control')).toBeNull();
  });

  it('FieldRow는 control의 labelId가 라벨 id이고, value·actions·help를 그린다', () => {
    let got: { labelId: string; helpId?: string } | undefined;
    const control = createRawSnippet<[{ labelId: string; helpId?: string }]>((args) => {
      got = args();
      return { render: () => `<input aria-labelledby="${got!.labelId}" />` };
    });
    const { container, unmount } = render(FieldRow, { label: '폴더', help: '도움', control, actions: text('바꾸기') });
    expect(got!.labelId).toBe(container.querySelector('.fieldrow-label')!.id);
    expect(got!.helpId).toBe(container.querySelector('.fieldrow-help')!.id);
    expect(screen.getByRole('textbox', { name: '폴더' })).toBeInTheDocument();
    expect(container.querySelector('.fieldrow-actions')).toHaveTextContent('바꾸기');
    unmount();
    const plain = render(FieldRow, { label: '이름', value: '값' });
    expect(plain.container.querySelector('.fieldrow-value')).toHaveTextContent('값');
    expect(plain.container.querySelector('.fieldrow-actions')).toBeNull();
    expect(plain.container.querySelector('.fieldrow-help')).toBeNull();
  });
});

describe('PageContainer', () => {
  it('content가 기본, reading이면 col-reading', () => {
    const { container, unmount } = render(PageContainer, { children: text('x') });
    expect(container.querySelector('.col')).not.toHaveClass('col-reading');
    unmount();
    const r = render(PageContainer, { variant: 'reading', children: text('x') });
    expect(r.container.querySelector('.col')).toHaveClass('col', 'col-reading');
  });
});

describe('DropOverlay', () => {
  it('open일 때만 안내를 그린다', async () => {
    const { container, rerender } = render(DropOverlay, { open: false });
    expect(container.querySelector('.drop-overlay')).toBeNull();
    await rerender({ open: true });
    expect(container.querySelector('.drop-overlay .drop-label')).toHaveTextContent('여기에 놓으면 불러와요');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('Toolbar', () => {
  it('start와 end를 같은 열 안에 그린다', () => {
    const { container, unmount } = render(Toolbar, { start: text('앞'), end: text('뒤') });
    const bar = container.querySelector('header.toolbar')!;
    expect(bar.querySelector(':scope > .col')).toHaveTextContent('앞');
    expect(bar.querySelector('.toolbar-end')).toHaveTextContent('뒤');
    unmount();
    const only = render(Toolbar, { start: text('앞') });
    expect(only.container.querySelector('.toolbar-end')).toBeEmptyDOMElement();
  });
});
