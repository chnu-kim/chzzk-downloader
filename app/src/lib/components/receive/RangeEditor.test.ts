// 구간 편집 화면(RangeEditor, range-editor.md RE-3). 레이어·초안·검증·Esc·세션·결합과, 카드에서 옮겨 온 손잡이·찍기·구간 보기·키 시험.
// 예시 값(시각·길이·제목)은 모두 가짜다.
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppError, TimeRangeDto, WatchOpenDto } from '../../bindings';
import { resolved } from '../../../test/fixtures';
import { t } from '../../copy/ko';
import { kindLabel } from '../../receive';
import { ui } from '../../stores/ui.svelte';

vi.mock('../../api', () => ({
  watchOpen: vi.fn(),
  watchClose: vi.fn(),
  openContentPage: vi.fn(),
}));

// hls.js/light 흉내: 실제 MSE 없이 생성자 인자·호출·오류 이벤트만 본다
const hlsMock = vi.hoisted(() => {
  const instances: Array<{
    handlers: Map<string, (event: string, data: unknown) => void>;
    loadSource: ReturnType<typeof vi.fn>;
    attachMedia: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }> = [];
  class FakeHls {
    static supported = true;
    static isSupported = () => FakeHls.supported;
    static Events = { ERROR: 'hlsError' };
    handlers = new Map<string, (event: string, data: unknown) => void>();
    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    constructor() {
      instances.push(this);
    }
    on(event: string, handler: (event: string, data: unknown) => void) {
      this.handlers.set(event, handler);
    }
    emit(event: string, data: unknown) {
      this.handlers.get(event)?.(event, data);
    }
  }
  return { FakeHls, instances };
});
vi.mock('hls.js/light', () => ({ default: hlsMock.FakeHls }));

const api = await import('../../api');
const { default: RangeEditor } = await import('./RangeEditor.svelte');

const SID = 'ab'.repeat(16);
const HLS_SRC = `watch://localhost/${SID}/pl.m3u8`;
const hlsOpened = (over: Partial<WatchOpenDto> = {}): WatchOpenDto => ({ id: SID, kind: 'hls', src: HLS_SRC, ...over });
const appError = (code: AppError['code']): AppError => ({ code, message: code, stage: null, resumable: false, payload: null });
const lastHls = () => hlsMock.instances[hlsMock.instances.length - 1];
const hlsError = (data: Record<string, unknown>) => (lastHls() as unknown as { emit(e: string, d: unknown): void }).emit('hlsError', data);

/** 길이 600초(0:10:00)의 빠른 다시보기 */
const view = resolved({ meta: { ...resolved().meta, durationSecs: 600 } });
const noLengthView = resolved({ meta: { ...resolved().meta, durationSecs: null } });

const layer = () => document.querySelector('.fullsheet') as HTMLElement;
const startBtn = () => screen.getByRole('button', { name: t('watch.start.a11y', { title: view.meta.title }) });
const videoEl = () => document.querySelector('video') as HTMLVideoElement | null;
const startInput = () => screen.getByRole('textbox', { name: t('range.start' as const) }) as HTMLInputElement;
const endInput = () => screen.getByRole('textbox', { name: t('range.end') }) as HTMLInputElement;
const sliders = () => screen.queryAllByRole('slider');
const slider = (name: string) => screen.getByRole('slider', { name });
const markS = () => screen.getByRole('button', { name: t('watch.mark.start') });
const markE = () => screen.getByRole('button', { name: t('watch.mark.end') });
const playBtn = () => screen.getByRole('button', { name: t('watch.range.play.label') });
const fromStartBtn = () => screen.getByRole('button', { name: t('watch.range.fromStart.label') });
const loopSwitch = () => screen.getByRole('switch', { name: t('watch.range.loop.label' as const) });
const applyBtn = () => screen.getByRole('button', { name: new RegExp(t('rangeEditor.apply.label')) });
const closeBtn = () => screen.getByRole('button', { name: t('common.close') });
const clearBtn = () => screen.getByRole('button', { name: t('range.clear.label') });
const h1 = () => screen.getByRole('heading', { level: 1, name: t('rangeEditor.title') });
const track = () => document.querySelector('.track') as HTMLElement;

const range = (startMs: number, endMs: number | null): TimeRangeDto => ({ startMs, endMs });

/** jsdom은 배치를 하지 않으므로 막대의 좌표를 흉내 낸다(왼쪽 0, 폭 600) */
function rectOf(el: Element) {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 24, width: 600, height: 24, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

/** currentTime 쓰기를 세는 video 흉내(jsdom은 재생·탐색을 하지 않는다) */
function mockVideo(duration = 600, time = 0) {
  const v = videoEl()!;
  let ct = time;
  let dur = duration;
  let ended = false;
  const writes: number[] = [];
  Object.defineProperty(v, 'currentTime', { configurable: true, get: () => ct, set: (x: number) => { ct = x; writes.push(x); } });
  Object.defineProperty(v, 'duration', { configurable: true, get: () => dur });
  Object.defineProperty(v, 'ended', { configurable: true, get: () => ended });
  const play = vi.fn(() => Promise.resolve());
  const pause = vi.fn();
  v.play = play as never;
  v.pause = pause as never;
  return {
    v,
    writes,
    play,
    pause,
    setTime: (x: number) => (ct = x),
    setDuration: (x: number) => (dur = x),
    setEnded: (x: boolean) => (ended = x),
  };
}

type Over = Partial<{ view: typeof view; applied: TimeRangeDto | null; opener: HTMLElement | null }>;

/** 편집 화면을 열기만 한다(세션 없음) */
function mount(over: Over = {}) {
  const onapply = vi.fn();
  const onclose = vi.fn();
  const user = userEvent.setup();
  const utils = render(RangeEditor, { view, applied: null, sizeOf: () => null, onapply, onclose, ...over } as never);
  return { user, onapply, onclose, ...utils };
}

/** [영상 보기]까지 눌러 hls.js 경로를 연다 */
async function openEditor(over: Over = {}) {
  vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
  const m = mount(over);
  await m.user.click(startBtn());
  await waitFor(() => expect(hlsMock.instances).toHaveLength(1));
  return m;
}

/** 메타데이터를 읽은 것처럼 만든다 */
async function ready(duration = 600, time = 0) {
  const m = mockVideo(duration, time);
  await fireEvent(m.v, new Event('loadedmetadata'));
  return m;
}

beforeEach(() => {
  hlsMock.instances.length = 0;
  hlsMock.FakeHls.supported = true;
  vi.mocked(api.watchOpen).mockReset().mockResolvedValue(hlsOpened());
  vi.mocked(api.watchClose).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(api.openContentPage).mockReset().mockResolvedValue(undefined as never);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  ui.rangeEditorOpen = false;
  ui.urlTarget = null;
  Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
});

describe('레이어(RE1)', () => {
  it('열면 body 직속 dialog이고 다른 자식은 inert, 포커스는 제목(h1), ui.rangeEditorOpen은 true, watch_open은 0회', async () => {
    const { container } = mount();
    const dlg = screen.getByRole('dialog', { name: t('rangeEditor.title') });
    expect(dlg).toHaveAttribute('aria-modal', 'true');
    expect(dlg.parentElement).toBe(document.body);
    expect(dlg).toHaveAttribute('tabindex', '-1');
    expect(container).toHaveAttribute('inert');
    expect(dlg).not.toHaveAttribute('inert');
    expect(ui.rangeEditorOpen).toBe(true);
    await waitFor(() => expect(h1()).toHaveFocus());
    expect(h1()).toHaveAttribute('data-focus-container');
    expect(api.watchOpen).not.toHaveBeenCalled();
  });

  it('부제는 "{종류} · {제목}"이고 레이어의 설명이다', () => {
    mount();
    const dlg = screen.getByRole('dialog');
    const sub = document.getElementById(dlg.getAttribute('aria-describedby') ?? '');
    expect(sub).toHaveTextContent(t('rangeEditor.context.label', { kind: kindLabel('rewind'), title: view.meta.title }));
  });

  it('DOM 순서: 머리 → 영상 자리 → 조작 줄 → 타임라인 패널(막대 → 구간 줄)', () => {
    mount();
    const after = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const head = document.querySelector('.head')!;
    const stage = document.querySelector('.stage')!;
    const controls = document.querySelector('.controls')!;
    const panel = document.querySelector('.panel')!;
    expect(after(head, stage)).toBe(true);
    expect(after(stage, controls)).toBe(true);
    expect(after(controls, panel)).toBe(true);
    expect(after(track(), startInput())).toBe(true);
  });

  it('언마운트하면 inert가 돌아오고 깃발이 내려가며 연 단추로 포커스가 돌아간다', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { container, unmount } = mount({ opener });
    expect(container).toHaveAttribute('inert');
    unmount();
    expect(container).not.toHaveAttribute('inert');
    expect(ui.rangeEditorOpen).toBe(false);
    expect(document.querySelector('.fullsheet')).toBeNull();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('연 단추가 사라졌으면 입력줄로 포커스를 돌린다', () => {
    const focus = vi.fn();
    ui.urlTarget = { focus, paste: vi.fn() };
    const opener = document.createElement('button');
    document.body.append(opener);
    const { unmount } = mount({ opener });
    opener.remove();
    unmount();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('레이어 위에 대화상자 층이 올라간 사이 편집 화면이 먼저 사라져도 앱이 inert로 남지 않는다', async () => {
    const { container, unmount } = mount();
    const dialog = document.createElement('div');
    dialog.className = 'fake-dialog';
    document.body.append(dialog);
    const { modalLayer } = await import('../ui/modalLayer');
    const offDialog = modalLayer(dialog);
    expect(layer()).toHaveAttribute('inert');
    unmount();
    expect(container).toHaveAttribute('inert');
    offDialog();
    expect(container).not.toHaveAttribute('inert');
  });

  it('조작 줄은 늘 그리고 결합 전에는 모두 disabled다(RE8)', () => {
    mount();
    for (const b of [markS(), markE(), playBtn(), fromStartBtn()]) expect(b).toBeDisabled();
    expect(loopSwitch()).toBeDisabled();
  });
});

describe('초안·적용(RE2~RE6)', () => {
  it('확정값이 없으면 두 칸이 비어 있고 안내 글자가 처음부터·끝까지다', () => {
    mount();
    expect(startInput()).toHaveValue('');
    expect(endInput()).toHaveValue('');
    expect(startInput()).toHaveAttribute('placeholder', t('range.fromBegin'));
    expect(endInput()).toHaveAttribute('placeholder', t('range.toEnd'));
    expect(screen.getByText(t('range.wholeLength.label', { length: '0:10:00' }))).toBeInTheDocument();
  });

  it('초안은 열 때 확정값에서 만든다: 시작 0이면 빈칸, 영상 끝이면 끝 칸이 빈칸', () => {
    mount({ applied: range(60000, 300000) });
    expect(startInput()).toHaveValue('0:01:00');
    expect(endInput()).toHaveValue('0:05:00');
  });

  it('끝이 영상 끝(올림 길이)인 확정값은 끝 칸이 빈칸이다', () => {
    mount({ applied: range(60000, 600000) });
    expect(startInput()).toHaveValue('0:01:00');
    expect(endInput()).toHaveValue('');
  });

  it('[구간 적용하기]: 통과하면 onapply로 확정값을 보낸다(닫는 것은 카드 몫)', async () => {
    const { user, onapply, onclose } = mount();
    await user.type(startInput(), '0:01:00');
    await user.type(endInput(), '0:05:00');
    await user.click(applyBtn());
    expect(onapply).toHaveBeenCalledExactlyOnceWith(range(60000, 300000));
    expect(onclose).not.toHaveBeenCalled();
  });

  it('두 칸이 비면 전체라 null, 전체를 덮는 값도 null, 끝이 길이를 넘으면 영상 끝으로 자른다', async () => {
    const a = mount();
    await a.user.click(applyBtn());
    expect(a.onapply).toHaveBeenLastCalledWith(null);
    await a.user.type(endInput(), '0:10:00');
    await a.user.click(applyBtn());
    expect(a.onapply).toHaveBeenLastCalledWith(null);
    await a.user.clear(endInput());
    await a.user.type(startInput(), '0:01:00');
    await a.user.type(endInput(), '2:00:00');
    await a.user.click(applyBtn());
    expect(a.onapply).toHaveBeenLastCalledWith(range(60000, 600000));
  });

  it('길이를 모르면 끝이 빈 구간은 끝 없음 그대로 둔다', async () => {
    const { user, onapply } = mount({ view: noLengthView });
    await user.type(startInput(), '0:10:00');
    await user.click(applyBtn());
    expect(onapply).toHaveBeenCalledExactlyOnceWith(range(600000, null));
  });

  it.each([
    ['형식', 'abc', '', 'start', 'range.error.format'],
    ['순서', '0:08:00', '0:05:00', 'end', 'range.error.order'],
    ['길이 넘음', '4:00:00', '', 'start', 'range.error.beyond'],
  ] as const)('적용 오류(%s): 화면은 열린 채, 그 칸 아래 알림·aria-invalid·aria-describedby·포커스, 초안 보존', async (_n, s, e, field, key) => {
    const { user, onapply } = mount();
    await user.type(startInput(), s);
    if (e) await user.type(endInput(), e);
    await user.click(applyBtn());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t(key, { example: '0:10:00' }));
    const el = field === 'start' ? startInput() : endInput();
    expect(el).toHaveAttribute('aria-invalid', 'true');
    const ids = (el.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids.some((id) => document.getElementById(id)?.contains(alert))).toBe(true);
    await waitFor(() => expect(el).toHaveFocus());
    expect(startInput()).toHaveValue(s);
    expect(endInput()).toHaveValue(e);
    expect(onapply).not.toHaveBeenCalled();
    expect(document.querySelector('.fullsheet')).not.toBeNull();
  });

  it('조합 중에는 오류 칸을 전체 선택하지 않는다', async () => {
    const { user } = mount();
    await user.type(startInput(), 'abc');
    const select = vi.spyOn(HTMLInputElement.prototype, 'select');
    await fireEvent.compositionStart(startInput());
    await user.click(applyBtn());
    await screen.findByRole('alert');
    expect(select).not.toHaveBeenCalled();
  });

  it('타이핑은 오류를 지우지 않고, 손잡이·↑/↓·[구간 지우기]는 지운다(§5.1)', async () => {
    const { user } = mount();
    await user.type(startInput(), 'abc');
    await user.click(applyBtn());
    await screen.findByRole('alert');
    await user.type(startInput(), 'd');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await fireEvent.keyDown(slider(t('range.start')), { key: 'ArrowRight' });
    expect(screen.queryByRole('alert')).toBeNull();

    await user.clear(startInput());
    await user.type(startInput(), 'abc');
    await user.click(applyBtn());
    await screen.findByRole('alert');
    await user.click(clearBtn());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('[닫기]는 onclose만 부르고 onapply는 부르지 않는다. 초안은 버려진다', async () => {
    const { user, onapply, onclose } = mount({ applied: range(60000, 300000) });
    await user.clear(startInput());
    await user.type(startInput(), '0:02:00');
    await user.click(closeBtn());
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(onapply).not.toHaveBeenCalled();
  });

  it('편집 화면 [구간 지우기]는 초안만 지운다: 두 칸이 비고 onapply·onclose는 0회, 포커스는 그 자리에 남는다', async () => {
    const { user, onapply, onclose } = mount({ applied: range(60000, 300000) });
    clearBtn().focus();
    await user.click(clearBtn());
    expect(startInput()).toHaveValue('');
    expect(endInput()).toHaveValue('');
    expect(onapply).not.toHaveBeenCalled();
    expect(onclose).not.toHaveBeenCalled();
    expect(clearBtn()).toHaveFocus();
    // 이미 전체인 초안에서도 단추는 그대로 있고 누를 수 있다
    await user.click(clearBtn());
    expect(clearBtn()).toBeEnabled();
  });

  it('길이 줄: 전체는 "전체 길이", 구간이면 "구간 길이", 크기가 있으면 "길이 · 크기", 칸이 틀리면 줄이 없다', async () => {
    const { user } = mount({ sizeOf: (secs: number) => `약 ${secs}초분` } as never);
    expect(screen.getByText(t('range.wholeLengthSize.label', { length: '0:10:00', size: '약 600초분' }))).toBeInTheDocument();
    await user.type(startInput(), '0:01:00');
    expect(screen.getByText(t('range.lengthSize.label', { length: '0:09:00', size: '약 540초분' }))).toBeInTheDocument();
    await user.clear(startInput());
    await user.type(startInput(), 'abc');
    expect(screen.queryByText(/길이:/)).toBeNull();
  });
});

describe('키: Esc·Mod+Enter·Tab(RE15·RE16)', () => {
  it('Esc는 칸·단추·영상·막대 어디서든 편집 화면을 닫고(preventDefault + stopPropagation) 카드까지 닿지 않는다', async () => {
    const { onclose } = await openEditor();
    await ready();
    const reached = vi.fn();
    window.addEventListener('keydown', reached);
    try {
      for (const el of [startInput(), markS() as HTMLElement, videoEl()!, slider(t('range.end')), layer()]) {
        onclose.mockClear();
        const notPrevented = await fireEvent.keyDown(el, { key: 'Escape' });
        expect(notPrevented).toBe(false);
        expect(onclose).toHaveBeenCalledTimes(1);
      }
      expect(reached).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', reached);
    }
  });

  it('길게 누른 Esc(repeat)는 거르기만 하고 닫지 않는다. 전파도 막는다', async () => {
    const { onclose } = mount();
    const reached = vi.fn();
    window.addEventListener('keydown', reached);
    try {
      expect(await fireEvent.keyDown(startInput(), { key: 'Escape', repeat: true })).toBe(false);
      expect(onclose).not.toHaveBeenCalled();
      expect(reached).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', reached);
    }
  });

  it('영상이 전체 화면이면 Esc는 preventDefault 없이 전파만 막고 닫지 않는다(웹뷰가 전체 화면을 푼다)', async () => {
    const { onclose } = await openEditor();
    await ready();
    Object.defineProperty(document, 'fullscreenElement', { value: videoEl(), configurable: true });
    const reached = vi.fn();
    window.addEventListener('keydown', reached);
    try {
      expect(await fireEvent.keyDown(videoEl()!, { key: 'Escape' })).toBe(true);
      expect(onclose).not.toHaveBeenCalled();
      expect(reached).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', reached);
    }
  });

  it('IME 조합 중의 Esc·Mod+Enter는 처리하지 않는다', async () => {
    const { onclose, onapply } = mount();
    await fireEvent.keyDown(startInput(), { key: 'Escape', isComposing: true });
    await fireEvent.keyDown(startInput(), { key: 'Escape', keyCode: 229 });
    await fireEvent.keyDown(startInput(), { key: 'Enter', ctrlKey: true, isComposing: true });
    expect(onclose).not.toHaveBeenCalled();
    expect(onapply).not.toHaveBeenCalled();
  });

  it('포커스가 body에 떨어져 키가 뿌리를 지나지 않아도 Esc 사다리가 편집 화면을 닫고, 전체 화면이면 받은 것으로 치고 닫지 않는다', async () => {
    const { onclose } = mount();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(ui.escape()).toBe(true);
    expect(onclose).toHaveBeenCalledTimes(1);
    onclose.mockClear();
    Object.defineProperty(document, 'fullscreenElement', { value: layer(), configurable: true });
    expect(ui.escape()).toBe(true);
    expect(onclose).not.toHaveBeenCalled();
  });

  it('Mod+Enter는 [구간 적용하기]다: 성공이든 실패든 preventDefault + stopPropagation', async () => {
    const { user, onapply } = mount();
    const reached = vi.fn((e: Event) => {
      if ((e as KeyboardEvent).key === 'Enter') throw new Error('Mod+Enter가 창까지 닿았다');
    });
    window.addEventListener('keydown', reached);
    try {
      expect(await fireEvent.keyDown(startInput(), { key: 'Enter', ctrlKey: true })).toBe(false);
      expect(onapply).toHaveBeenCalledTimes(1);
      await user.type(startInput(), 'abc');
      expect(await fireEvent.keyDown(startInput(), { key: 'Enter', ctrlKey: true })).toBe(false);
      expect(onapply).toHaveBeenCalledTimes(1);
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(reached.mock.calls.filter(([e]) => (e as KeyboardEvent).key === 'Enter')).toHaveLength(0);
    } finally {
      window.removeEventListener('keydown', reached);
    }
  });

  it('칸의 Enter만(수식 키 없음)은 아무것도 하지 않는다', async () => {
    const { onapply } = mount();
    await fireEvent.keyDown(startInput(), { key: 'Enter' });
    expect(onapply).not.toHaveBeenCalled();
  });

  it('Tab은 화면 안에서 돈다(trapTab): 마지막에서 처음으로, 처음에서 마지막으로', async () => {
    const { user } = mount();
    clearBtn().focus();
    await user.tab();
    expect(document.activeElement).toBe(closeBtn());
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(clearBtn());
    expect(layer().contains(document.activeElement)).toBe(true);
  });
});

describe('Tab 순환 보강', () => {
  it('제목(h1)에서 Shift+Tab은 마지막 요소로, 마지막에서 Tab은 처음으로 돈다', async () => {
    const { user } = mount();
    await waitFor(() => expect(h1()).toHaveFocus());
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(clearBtn());
    await user.tab();
    expect(document.activeElement).toBe(closeBtn());
  });
});

describe('세션 수명(RE7)', () => {
  it('열기만으로는 요청이 없고, [영상 보기]를 누르면 watch_open을 한 번 부르고 ready에서 영상으로 포커스를 옮기고 재생을 한 번 시도한다', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const { user } = mount();
    expect(api.watchOpen).not.toHaveBeenCalled();
    vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
    await user.click(startBtn());
    expect(api.watchOpen).toHaveBeenCalledExactlyOnceWith(view.url, view.content);
    await waitFor(() => expect(document.activeElement).toBe(videoEl()));
    expect(play).toHaveBeenCalledTimes(1);
    expect(lastHls().attachMedia).toHaveBeenCalledTimes(1);
  });

  it('ready에서 닫으면 hls.destroy와 watch_close를 한 번씩 부른다', async () => {
    const { unmount } = await openEditor();
    unmount();
    expect(lastHls().destroy).toHaveBeenCalledTimes(1);
    expect(api.watchClose).toHaveBeenCalledExactlyOnceWith(SID);
  });

  it('idle에서 닫으면 watch_close가 0회다', () => {
    const { unmount } = mount();
    unmount();
    expect(api.watchClose).not.toHaveBeenCalled();
  });

  it('opening에서 닫으면 그 순간은 0회이고 늦게 온 세션은 도착할 때 한 번 닫는다', async () => {
    let resolve!: (d: WatchOpenDto) => void;
    vi.mocked(api.watchOpen).mockReturnValue(new Promise((r) => (resolve = r)));
    const { user, unmount } = mount();
    await user.click(startBtn());
    unmount();
    expect(api.watchClose).not.toHaveBeenCalled();
    resolve(hlsOpened());
    await waitFor(() => expect(api.watchClose).toHaveBeenCalledWith(SID));
    expect(api.watchClose).toHaveBeenCalledTimes(1);
  });

  it('failed에서 닫으면 watch_close가 0회다(갈 때 이미 닫았다)', async () => {
    vi.mocked(api.watchOpen).mockRejectedValue(appError('network'));
    const { user, unmount } = mount();
    await user.click(startBtn());
    expect(await screen.findByRole('alert')).toHaveTextContent(t('watch.error.body'));
    unmount();
    expect(api.watchClose).not.toHaveBeenCalled();
  });

  it('열기 실패: 알림(Notice) 한 문구, 포커스가 [영상 보기]나 body에 있었으면 제목으로, [다시 시도]는 다시 연다', async () => {
    vi.mocked(api.watchOpen).mockRejectedValueOnce(appError('network'));
    const { user } = mount();
    await user.click(startBtn());
    expect(await screen.findByRole('alert')).toHaveTextContent(t('watch.error.body'));
    await waitFor(() => expect(h1()).toHaveFocus());
    vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
    await user.click(screen.getByRole('button', { name: t('action.retry') }));
    await waitFor(() => expect(hlsMock.instances).toHaveLength(1));
    expect(api.watchOpen).toHaveBeenCalledTimes(2);
  });

  it('열기 실패 때 포커스가 다른 곳에 가 있으면 그대로 둔다', async () => {
    let reject!: (e: AppError) => void;
    vi.mocked(api.watchOpen).mockReturnValue(new Promise((_, rj) => (reject = rj)));
    const { user } = mount();
    await user.click(startBtn());
    startInput().focus();
    reject(appError('network'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(startInput()).toHaveFocus();
  });

  it('게이트 거부는 받기와 같은 문구이고 포커스는 제목으로 간다', async () => {
    vi.mocked(api.watchOpen).mockRejectedValue(appError('notLoggedIn'));
    const { user } = mount();
    await user.click(startBtn());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await waitFor(() => expect(h1()).toHaveFocus());
  });

  it('재생 중 치명 오류: 포커스가 영상에 있었으면 제목으로, 조작 줄이 disabled가 되며 포커스가 그 줄에 있었으면 제목으로 간다', async () => {
    await openEditor();
    await ready();
    await waitFor(() => expect(document.activeElement).toBe(videoEl()));
    hlsError({ fatal: true });
    expect(await screen.findByRole('alert')).toHaveTextContent(t('watch.error.body'));
    await waitFor(() => expect(h1()).toHaveFocus());
    expect(lastHls().destroy).toHaveBeenCalledTimes(1);
    expect(api.watchClose).toHaveBeenCalledTimes(1);
    expect(markS()).toBeDisabled();
  });

  it('결합이 풀릴 때 포커스가 조작 줄 단추에 있었으면 제목으로 옮긴다', async () => {
    await openEditor();
    await ready();
    markS().focus();
    hlsError({ fatal: true });
    await waitFor(() => expect(h1()).toHaveFocus());
  });

  it('재생 중 오류인데 포커스가 다른 곳(칸)에 있으면 그대로 둔다', async () => {
    await openEditor();
    await ready();
    startInput().focus();
    hlsError({ fatal: true });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await Promise.resolve();
    expect(startInput()).toHaveFocus();
  });

  it('[치지직에서 보기]는 카드의 content로 openContentPage를 부른다', async () => {
    vi.mocked(api.watchOpen).mockRejectedValue(appError('network'));
    const { user } = mount();
    await user.click(startBtn());
    await user.click(await screen.findByRole('button', { name: t('watch.openInChzzk.label') }));
    expect(api.openContentPage).toHaveBeenCalledExactlyOnceWith(view.content);
  });
});

describe('결합(RE8)', () => {
  it('막대는 메타데이터 전에도 meta 길이로 있고, 조작 줄은 hls.js로 붙고 메타데이터를 읽은 뒤에만 켜진다', async () => {
    await openEditor();
    expect(sliders()).toHaveLength(2);
    expect(markS()).toBeDisabled();
    expect(playBtn()).toBeDisabled();
    await ready();
    expect(sliders()).toHaveLength(2);
    expect(markS()).toBeEnabled();
    expect(markE()).toBeEnabled();
    expect(loopSwitch()).toBeEnabled();
  });

  it('메타데이터 전에 durationchange만 와도 조작 줄은 켜지지 않는다', async () => {
    await openEditor();
    const m = mockVideo();
    await fireEvent(m.v, new Event('durationchange'));
    expect(markS()).toBeDisabled();
    await fireEvent(m.v, new Event('loadedmetadata'));
    expect(markS()).toBeEnabled();
    expect(sliders()).toHaveLength(2);
  });

  it('결합 전 손잡이는 초안만 고치고 영상은 건드리지 않는다. 눈금(막대)을 눌러도 아무 일이 없다', async () => {
    const { v } = await (async () => {
      await openEditor();
      return { v: mockVideo() };
    })();
    await fireEvent.keyDown(slider(t('range.end')), { key: 'ArrowLeft' });
    expect(endInput()).toHaveValue('0:09:59');
    rectOf(track());
    await fireEvent.pointerDown(track(), { button: 0, clientX: 300, pointerId: 1 });
    expect(v.writes).toEqual([]);
  });

  it('재생 전(영상 보기 전)에도 막대가 meta 길이로 있고 손잡이는 칸만 고친다(영상·재생 위치 없음)', async () => {
    mount();
    expect(sliders()).toHaveLength(2);
    expect(videoEl()).toBeNull();
    expect(document.querySelector('.position')).toBeNull();
    expect(screen.getByRole('group', { name: t('rangeEditor.timeline.title') })).toHaveAttribute('data-timeline');
    await fireEvent.keyDown(slider(t('range.end')), { key: 'ArrowLeft' });
    // 끝 손잡이만 옮긴다: 시작 칸은 빈칸('')으로 남는다
    expect(endInput()).toHaveValue('0:09:59');
    expect(startInput()).toHaveValue('');
  });

  it('길이를 모르면 결합 전에는 타임라인 대신 안내 한 줄이고, 영상이 길이를 알려 주면 막대가 나온다', async () => {
    await (async () => {
      vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
      const user = userEvent.setup();
      render(RangeEditor, { view: noLengthView, applied: null, sizeOf: () => null, onapply: vi.fn(), onclose: vi.fn() } as never);
      await user.click(screen.getByRole('button', { name: t('watch.start.a11y', { title: noLengthView.meta.title }) }));
      await waitFor(() => expect(hlsMock.instances).toHaveLength(1));
    })();
    expect(sliders()).toHaveLength(0);
    expect(screen.getByText(t('rangeEditor.noLength.body'))).toBeInTheDocument();
    expect(markS()).toBeDisabled();
    await ready(599.6);
    expect(sliders()).toHaveLength(2);
    expect(slider(t('range.end'))).toHaveAttribute('aria-valuemax', '599');
    expect(screen.queryByText(t('rangeEditor.noLength.body'))).toBeNull();
    expect(markS()).toBeEnabled();
  });

  it('mp4 경로에서는 막대·칸만 쓰고 조작 줄이 켜지지 않으며 영상 탐색이 없다', async () => {
    vi.mocked(api.watchOpen).mockResolvedValue({ id: SID, kind: 'mp4', src: `watch://localhost/${SID}/v` });
    const { user } = mount();
    await user.click(startBtn());
    await waitFor(() => expect(videoEl()).not.toBeNull());
    const m = mockVideo();
    await fireEvent(m.v, new Event('loadedmetadata'));
    expect(sliders()).toHaveLength(2);
    expect(markS()).toBeDisabled();
    expect(playBtn()).toBeDisabled();
    expect(screen.getByText(t('rangeEditor.uncoupled.body'))).toBeInTheDocument();
    await fireEvent.keyDown(slider(t('range.end')), { key: 'ArrowLeft' });
    expect(endInput()).toHaveValue('0:09:59');
    expect(m.writes).toEqual([]);
  });

  it('네이티브 m3u8 경로(hls.js 없음)에서도 막대·칸만 쓰고, 안내 줄이 나온다', async () => {
    hlsMock.FakeHls.supported = false;
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation((type) =>
      type === 'application/vnd.apple.mpegurl' ? 'maybe' : '',
    );
    const { user } = mount();
    await user.click(startBtn());
    await waitFor(() => expect(videoEl()).not.toBeNull());
    expect(videoEl()!.getAttribute('src')).toBe(HLS_SRC);
    expect(hlsMock.instances).toHaveLength(0);
    const m = mockVideo();
    await fireEvent(m.v, new Event('loadedmetadata'));
    expect(sliders()).toHaveLength(2);
    expect(markS()).toBeDisabled();
    expect(screen.getByText(t('rangeEditor.uncoupled.body'))).toBeInTheDocument();
    await fireEvent.keyDown(slider(t('range.end')), { key: 'ArrowLeft' });
    expect(endInput()).toHaveValue('0:09:59');
    expect(m.writes).toEqual([]);
  });

  it('치명 오류 뒤 [다시 시도]로 다시 열면 메타데이터 준비가 다시 필요하다', async () => {
    const { user } = await openEditor();
    await ready();
    expect(markS()).toBeEnabled();
    hlsError({ fatal: true });
    await user.click(await screen.findByRole('button', { name: t('action.retry') }));
    await waitFor(() => expect(hlsMock.instances).toHaveLength(2));
    expect(markS()).toBeDisabled();
  });

  it('미리보기가 실패해도 막대는 남는다', async () => {
    vi.mocked(api.watchOpen).mockRejectedValue(appError('network'));
    const { user } = mount();
    await user.click(startBtn());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(sliders()).toHaveLength(2);
  });
});

describe('찍기(PV-7)', () => {
  it('[시작 찍기]는 floor(currentTime)을 시작 칸에, [끝 찍기]는 끝 칸에 넣는다. 다른 칸은 그대로다', async () => {
    const { user } = await openEditor();
    const m = await ready(600, 65.9);
    await user.click(markS());
    expect(startInput()).toHaveValue('0:01:05');
    expect(endInput()).toHaveValue('');
    m.setTime(599.99);
    await user.click(markE());
    expect(endInput()).toHaveValue('0:09:59');
    expect(startInput()).toHaveValue('0:01:05');
  });

  it('찍는 순간의 currentTime을 읽는다(메타데이터 때가 아니다)', async () => {
    const { user } = await openEditor();
    const m = await ready(600, 1);
    m.setTime(120.4);
    await user.click(markS());
    expect(startInput()).toHaveValue('0:02:00');
  });

  it('찍기는 앞 적용의 구간 오류를 지운다(§5.1)', async () => {
    const { user } = await openEditor();
    const m = await ready(600, 30);
    await user.clear(startInput());
    await user.type(startInput(), 'abc');
    await user.click(applyBtn());
    await screen.findByRole('alert');
    m.setTime(30);
    await user.click(markE());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(endInput()).toHaveValue('0:00:30');
  });

  it('메타데이터 전에는 키로도 찍지 않는다', async () => {
    await openEditor();
    await fireEvent.keyDown(layer(), { key: 'i', code: 'KeyI' });
    expect(startInput()).toHaveValue('');
  });
});

describe('손잡이·막대·탐색', () => {
  it('손잡이를 끌면 칸 값만 바꾸고(영상은 그대로), 놓으면 한 번 탐색한다', async () => {
    await openEditor();
    const m = await ready();
    rectOf(track());
    const thumb = slider(t('range.start'));
    await fireEvent.pointerDown(thumb, { button: 0, clientX: 0, pointerId: 1 });
    await fireEvent.pointerMove(thumb, { clientX: 120, pointerId: 1 });
    expect(startInput()).toHaveValue('0:02:00');
    expect(endInput()).toHaveValue('');
    expect(m.writes).toEqual([]);
    await fireEvent.pointerUp(thumb, { clientX: 120, pointerId: 1 });
    expect(startInput()).toHaveValue('0:02:00');
    expect(m.writes).toEqual([120]);
  });

  it('키로 손잡이를 옮기면 누를 때마다 탐색한다', async () => {
    await openEditor({ applied: range(60000, 300000) });
    const m = await ready();
    await fireEvent.keyDown(slider(t('range.start')), { key: 'ArrowRight' });
    expect(startInput()).toHaveValue('0:01:01');
    expect(endInput()).toHaveValue('0:05:00');
    expect(m.writes).toEqual([61]);
  });

  it('막대(손잡이 밖)를 누르면 그 시각으로 탐색하고 칸은 바꾸지 않는다', async () => {
    await openEditor();
    const m = await ready();
    rectOf(track());
    await fireEvent.pointerDown(track(), { button: 0, clientX: 300, pointerId: 1 });
    expect(m.writes).toEqual([300]);
    expect(startInput()).toHaveValue('');
    expect(endInput()).toHaveValue('');
  });

  it('탐색은 [0, video.duration]으로 자른다(meta가 실제 영상보다 길 때)', async () => {
    const { user } = await openEditor();
    const m = await ready(590);
    rectOf(track());
    await fireEvent.pointerDown(track(), { button: 0, clientX: 600, pointerId: 1 });
    await fireEvent.pointerDown(track(), { button: 0, clientX: 0, pointerId: 1 });
    expect(m.writes).toEqual([590, 0]);
    void user;
  });

  it('meta 길이가 있으면 영상이 알려 준 길이보다 meta가 우선이다(막대 길이)', async () => {
    await openEditor();
    await ready(300);
    expect(slider(t('range.end'))).toHaveAttribute('aria-valuemax', '600');
  });

  it('끝 손잡이를 맨 끝으로 보내면 끝 칸에 floor(길이)가 들어간다(meta 길이)', async () => {
    await openEditor();
    await ready();
    await fireEvent.keyDown(slider(t('range.end')), { key: 'End' });
    expect(endInput()).toHaveValue('0:10:00');
  });

  it('meta 길이가 없고 영상 길이로 막대를 그리면 끝 손잡이가 끝일 때 끝 칸은 빈칸(끝까지)이다', async () => {
    vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
    const user = userEvent.setup();
    render(RangeEditor, { view: noLengthView, applied: null, sizeOf: () => null, onapply: vi.fn(), onclose: vi.fn() } as never);
    await user.click(screen.getByRole('button', { name: t('watch.start.a11y', { title: noLengthView.meta.title }) }));
    await waitFor(() => expect(hlsMock.instances).toHaveLength(1));
    await ready(599.6);
    await fireEvent.keyDown(slider(t('range.start')), { key: 'ArrowRight' });
    await fireEvent.keyDown(slider(t('range.end')), { key: 'End' });
    expect(endInput()).toHaveValue('');
    expect(startInput()).toHaveValue('0:00:01');
  });

  it('재생 위치를 막대에 알린다(timeupdate)', async () => {
    await openEditor();
    const m = await ready();
    m.setTime(150);
    await fireEvent(m.v, new Event('timeupdate'));
    const pos = document.querySelector('.position') as HTMLElement;
    expect(pos.style.getPropertyValue('--p')).toBe('0.25');
  });

  it('실패 뒤 다시 열면 앞 영상의 길이는 사라진다', async () => {
    vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
    const user = userEvent.setup();
    render(RangeEditor, { view: noLengthView, applied: null, sizeOf: () => null, onapply: vi.fn(), onclose: vi.fn() } as never);
    await user.click(screen.getByRole('button', { name: t('watch.start.a11y', { title: noLengthView.meta.title }) }));
    await waitFor(() => expect(hlsMock.instances).toHaveLength(1));
    await ready(599.6);
    expect(sliders()).toHaveLength(2);
    hlsError({ fatal: true });
    await screen.findByRole('alert');
    expect(sliders()).toHaveLength(0);
  });
});

describe('칸 ↔ 영상(PVU-5, 카드에서 옮겨 왔다)', () => {
  async function typeInto(user: ReturnType<typeof userEvent.setup>, el: HTMLInputElement, text: string) {
    await user.clear(el);
    await user.type(el, text);
  }

  it('blur on parsed start seeks video (typing does not)', async () => {
    const { user } = await openEditor();
    const m = await ready();
    await typeInto(user, startInput(), '0:05:00');
    expect(m.writes).toEqual([]);
    await user.tab();
    expect(m.writes).toEqual([300]);
  });

  it('blur on invalid does not seek', async () => {
    const { user } = await openEditor();
    const m = await ready();
    await typeInto(user, startInput(), '0:1x');
    await user.tab();
    expect(m.writes).toEqual([]);
  });

  it('blur on parsed end seeks video', async () => {
    const { user } = await openEditor();
    const m = await ready();
    await typeInto(user, endInput(), '0:08:00');
    expect(m.writes).toEqual([]);
    await fireEvent.blur(endInput(), { relatedTarget: loopSwitch() });
    expect(m.writes).toEqual([480]);
  });

  it('blur before metadata does nothing', async () => {
    const { user } = await openEditor();
    const m = mockVideo();
    await typeInto(user, startInput(), '0:05:00');
    await user.tab();
    expect(m.writes).toEqual([]);
  });

  it('blur without change does not seek (Tab으로 지나가기)', async () => {
    const { user } = await openEditor();
    const m = await ready();
    startInput().focus();
    await user.tab();
    expect(m.writes).toEqual([]);
  });

  it('blur into the timeline group or a slider does not override the track seek', async () => {
    const { user } = await openEditor();
    const m = await ready();
    await typeInto(user, startInput(), '0:05:00');
    const group = screen.getByRole('group', { name: t('rangeEditor.timeline.title') });
    await fireEvent.blur(startInput(), { relatedTarget: group });
    expect(m.writes).toEqual([]);
    await typeInto(user, startInput(), '0:06:00');
    await fireEvent.blur(startInput(), { relatedTarget: slider(t('range.end')) });
    expect(m.writes).toEqual([]);
  });

  it('shift+tab from field into the control row still seeks', async () => {
    const { user } = await openEditor();
    const m = await ready();
    await typeInto(user, startInput(), '0:05:00');
    await fireEvent.blur(startInput(), { relatedTarget: markE() });
    expect(m.writes).toEqual([300]);
    void user;
  });

  describe('칸 ↑/↓(PS-1)', () => {
    it('ArrowUp on start field adds one second, ArrowDown subtracts; default prevented', async () => {
      const { user } = await openEditor({ applied: range(60000, 300000) });
      await ready();
      startInput().focus();
      expect(await fireEvent.keyDown(startInput(), { key: 'ArrowUp' })).toBe(false);
      expect(startInput()).toHaveValue('0:01:01');
      await fireEvent.keyDown(startInput(), { key: 'ArrowDown' });
      await fireEvent.keyDown(startInput(), { key: 'ArrowDown' });
      expect(startInput()).toHaveValue('0:00:59');
      void user;
    });

    it('ArrowUp/Down clamps at the ends', async () => {
      await openEditor({ applied: range(0, 300000) });
      await ready();
      await fireEvent.keyDown(startInput(), { key: 'ArrowDown' });
      expect(startInput()).toHaveValue('0:00:00');
      for (let i = 0; i < 400; i++) await fireEvent.keyDown(endInput(), { key: 'ArrowUp' });
      expect(endInput()).toHaveValue('0:10:00');
    });

    it('unreadable field: arrow blocked, value unchanged', async () => {
      const { user } = await openEditor();
      await ready();
      await user.type(startInput(), 'abc');
      expect(await fireEvent.keyDown(startInput(), { key: 'ArrowUp' })).toBe(false);
      expect(startInput()).toHaveValue('abc');
    });

    it('modifier arrows not handled', async () => {
      await openEditor({ applied: range(60000, 300000) });
      await ready();
      for (const mod of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
        expect(await fireEvent.keyDown(startInput(), { key: 'ArrowUp', ...mod })).toBe(true);
      }
      expect(startInput()).toHaveValue('0:01:00');
    });

    it('IME composing arrow ignored', async () => {
      await openEditor({ applied: range(60000, 300000) });
      await ready();
      await fireEvent.keyDown(startInput(), { key: 'ArrowUp', isComposing: true });
      await fireEvent.keyDown(startInput(), { key: 'ArrowUp', keyCode: 229 });
      expect(startInput()).toHaveValue('0:01:00');
    });

    it('arrow seeks video when coupled', async () => {
      await openEditor({ applied: range(60000, 300000) });
      const m = await ready();
      await fireEvent.keyDown(startInput(), { key: 'ArrowUp' });
      expect(m.writes).toEqual([61]);
    });

    it('arrow to the very end of a blank end field still seeks', async () => {
      await openEditor({ applied: range(60000, 599000) });
      const m = await ready();
      await fireEvent.keyDown(endInput(), { key: 'ArrowUp' });
      expect(m.writes).toEqual([600]);
    });

    it('no seek when there is no video yet (before 영상 보기), but the field still changes', async () => {
      mount({ applied: range(60000, 300000) });
      await fireEvent.keyDown(startInput(), { key: 'ArrowUp' });
      expect(startInput()).toHaveValue('0:01:01');
    });

    it('non-repeat keydown after repeats drops the pending seek: keyup does not write twice', async () => {
      await openEditor({ applied: range(60000, 300000) });
      const m = await ready();
      await fireEvent.keyDown(startInput(), { key: 'ArrowUp', repeat: true });
      await fireEvent.keyDown(startInput(), { key: 'ArrowUp' });
      await fireEvent.keyUp(startInput(), { key: 'ArrowUp' });
      expect(m.writes).toEqual([62]);
    });

    it('held key changes field each repeat but seeks once on keyup', async () => {
      await openEditor({ applied: range(60000, 300000) });
      const m = await ready();
      await fireEvent.keyDown(startInput(), { key: 'ArrowUp', repeat: true });
      await fireEvent.keyDown(startInput(), { key: 'ArrowUp', repeat: true });
      expect(startInput()).toHaveValue('0:01:02');
      expect(m.writes).toEqual([]);
      await fireEvent.keyUp(startInput(), { key: 'ArrowUp' });
      expect(m.writes).toEqual([62]);
    });

    it('held key then blur without keyup flushes final seek', async () => {
      await openEditor({ applied: range(60000, 300000) });
      const m = await ready();
      startInput().focus();
      await fireEvent.keyDown(startInput(), { key: 'ArrowUp', repeat: true });
      await fireEvent.blur(startInput(), { relatedTarget: null });
      expect(m.writes).toEqual([61]);
    });

    it('blur after arrow does not seek again', async () => {
      const { user } = await openEditor({ applied: range(60000, 300000) });
      const m = await ready();
      startInput().focus();
      await fireEvent.keyDown(startInput(), { key: 'ArrowUp' });
      await user.tab();
      expect(m.writes).toEqual([61]);
    });

    it('arrow clears previous range error', async () => {
      const { user } = await openEditor();
      await ready();
      await user.type(startInput(), '0:30:00');
      await user.type(endInput(), '0:20:00');
      await user.click(applyBtn());
      await screen.findByRole('alert');
      await fireEvent.keyDown(endInput(), { key: 'ArrowUp' });
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('aria-keyshortcuts on both fields', () => {
      mount();
      expect(startInput()).toHaveAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown');
      expect(endInput()).toHaveAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown');
    });

    it('arrow feeds the applied range', async () => {
      const { user, onapply } = await openEditor({ applied: range(60000, 300000) });
      await ready();
      await fireEvent.keyDown(startInput(), { key: 'ArrowUp' });
      await fireEvent.keyDown(endInput(), { key: 'ArrowDown' });
      await user.click(applyBtn());
      expect(onapply).toHaveBeenCalledExactlyOnceWith(range(61000, 299000));
    });
  });
});

describe('구간 보기(PVU-3)', () => {
  const RANGE = range(60000, 90000);

  it('[구간 보기]는 시작으로 가서 재생하고 끝에서 일시정지한다', async () => {
    const { user } = await openEditor({ applied: RANGE });
    const m = await ready();
    await user.click(playBtn());
    expect(m.writes).toEqual([60]);
    expect(m.play).toHaveBeenCalledTimes(1);
    m.setTime(89.8);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.pause).not.toHaveBeenCalled();
    m.setTime(90);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.pause).toHaveBeenCalledTimes(1);
    // 우리가 건 일시정지가 구간 보기를 다시 끄는 일은 없다(이미 꺼졌다). 더는 아무 일도 없다
    await fireEvent(m.v, new Event('pause'));
    m.setTime(95);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.pause).toHaveBeenCalledTimes(1);
  });

  it('구간 반복하기가 켜져 있으면 끝에서 시작으로 돌아가고 일시정지하지 않는다', async () => {
    const { user } = await openEditor({ applied: RANGE });
    const m = await ready();
    await user.click(loopSwitch());
    await user.click(playBtn());
    m.setTime(90.1);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.writes).toEqual([60, 60]);
    expect(m.pause).not.toHaveBeenCalled();
  });

  it('우리 탐색(시작·restart)이 만든 seeked는 구간 보기를 끄지 않는다', async () => {
    const { user } = await openEditor({ applied: RANGE });
    const m = await ready();
    await user.click(playBtn());
    m.setTime(60);
    await fireEvent(m.v, new Event('seeked'));
    m.setTime(100);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.pause).toHaveBeenCalledTimes(1);
  });

  it('우리 탐색이 키프레임 때문에 시작 조금 앞에 닿아도(0.5초 안) 구간 보기를 끄지 않는다', async () => {
    const { user } = await openEditor({ applied: RANGE });
    const m = await ready();
    await user.click(playBtn());
    m.setTime(59.8);
    await fireEvent(m.v, new Event('seeked'));
    m.setTime(100);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.pause).toHaveBeenCalledTimes(1);
  });

  it('우리 것이 아닌 탐색은 시작 조금 앞이어도 구간 보기를 끈다', async () => {
    const { user } = await openEditor({ applied: RANGE });
    const m = await ready();
    await user.click(playBtn());
    m.setTime(60);
    await fireEvent(m.v, new Event('seeked')); // 시작 탐색 표시를 먼저 쓴다
    m.setTime(59.8);
    await fireEvent(m.v, new Event('seeked'));
    m.setTime(100);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.pause).not.toHaveBeenCalled();
  });

  it('사용자가 일시정지하면 구간 보기에서 빠진다', async () => {
    const { user } = await openEditor({ applied: RANGE });
    const m = await ready();
    await user.click(playBtn());
    await fireEvent(m.v, new Event('pause'));
    m.setTime(100);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.pause).not.toHaveBeenCalled();
  });

  it('구간 밖으로 사용자가 탐색하면 빠진다', async () => {
    const { user } = await openEditor({ applied: RANGE });
    const m = await ready();
    await user.click(playBtn());
    m.setTime(300);
    await fireEvent(m.v, new Event('seeked'));
    m.setTime(301);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.pause).not.toHaveBeenCalled();
  });

  it('끝이 영상 끝이면 ended에서 반복은 처음으로 돌아가고 한 번뿐이면 끝낸다', async () => {
    const { user } = await openEditor({ applied: range(60000, null) });
    const m = await ready();
    await user.click(loopSwitch());
    await user.click(playBtn());
    await fireEvent(m.v, new Event('ended'));
    expect(m.writes).toEqual([60, 60]);
    expect(m.play).toHaveBeenCalledTimes(2);
  });

  it('실제 브라우저 순서(timeupdate → pause → ended)에서도 끝(toEnd) 반복은 이어진다', async () => {
    // 끝 칸이 빈칸이고 영상이 meta보다 짧다: 브라우저는 끝에서 pause를 건 뒤 ended를 보낸다
    const { user } = await openEditor({ applied: range(60000, null) });
    const m = await ready(599.6);
    await user.click(loopSwitch());
    await user.click(playBtn());
    m.setTime(599.6);
    m.setEnded(true);
    await fireEvent(m.v, new Event('timeupdate'));
    await fireEvent(m.v, new Event('pause'));
    await fireEvent(m.v, new Event('ended'));
    expect(m.writes).toEqual([60, 60]);
    expect(m.play).toHaveBeenCalledTimes(2);
  });

  it('반복을 끈 채 ended가 오면 처음으로 돌아가지도 다시 재생하지도 않는다', async () => {
    const { user } = await openEditor({ applied: range(60000, null) });
    const m = await ready();
    await user.click(playBtn());
    m.setEnded(true);
    await fireEvent(m.v, new Event('pause'));
    await fireEvent(m.v, new Event('ended'));
    expect(m.writes).toEqual([60]);
    expect(m.play).toHaveBeenCalledTimes(1);
  });

  it('끝 손잡이를 끄는 동안(drag)에도 구간 보기가 꺼진다: pause·restart가 끼어들지 않는다', async () => {
    const { user } = await openEditor({ applied: RANGE });
    const m = await ready();
    rectOf(track());
    await user.click(loopSwitch());
    await user.click(playBtn());
    const thumb = slider(t('range.end'));
    await fireEvent.pointerDown(thumb, { clientX: 90, pointerId: 1 });
    await fireEvent.pointerMove(thumb, { clientX: 70, pointerId: 1 });
    m.setTime(100);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.pause).not.toHaveBeenCalled();
    expect(m.writes).toEqual([60]);
  });

  it('끝이 영상 끝이 아닌데 ended가 오면(meta가 더 길다) 반복도 끝낸다', async () => {
    const { user } = await openEditor({ applied: RANGE });
    const m = await ready();
    await user.click(loopSwitch());
    await user.click(playBtn());
    await fireEvent(m.v, new Event('ended'));
    expect(m.writes).toEqual([60]);
  });

  it('손잡이를 고치면(keydown commit) 구간 보기를 끈다: restart·pause가 끼어들지 않는다', async () => {
    const { user } = await openEditor({ applied: RANGE });
    const m = await ready();
    await user.click(loopSwitch());
    await user.click(playBtn());
    await fireEvent.keyDown(slider(t('range.end')), { key: 'ArrowLeft' });
    m.setTime(100);
    await fireEvent(m.v, new Event('timeupdate'));
    await fireEvent(m.v, new Event('seeked'));
    await fireEvent(m.v, new Event('pause'));
    expect(m.pause).not.toHaveBeenCalled();
    expect(m.writes).toEqual([60, 89]);
  });

  it('순서가 뒤집혔으면 [구간 보기]는 비활성이다', async () => {
    const { user } = await openEditor();
    await ready();
    await user.type(startInput(), '0:05:00');
    await user.type(endInput(), '0:01:00');
    expect(playBtn()).toBeDisabled();
    expect(fromStartBtn()).toBeEnabled();
  });

  it('play()가 거부되면 구간 보기를 끈다', async () => {
    const { user } = await openEditor({ applied: RANGE });
    const m = await ready();
    m.play.mockRejectedValueOnce(new Error('NotAllowed'));
    await user.click(playBtn());
    await Promise.resolve();
    await Promise.resolve();
    m.setTime(100);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.pause).not.toHaveBeenCalled();
  });

  it('[시작부터 보기]는 시작으로 가서 재생만 하고 끝에서 멈추지 않는다', async () => {
    const { user } = await openEditor({ applied: RANGE });
    const m = await ready();
    await user.click(fromStartBtn());
    expect(m.writes).toEqual([60]);
    expect(m.play).toHaveBeenCalledTimes(1);
    m.setTime(120);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.pause).not.toHaveBeenCalled();
  });

  it('다시 열면(실패 → 다시 시도) 구간 보기는 이어지지 않는다', async () => {
    const { user } = await openEditor({ applied: RANGE });
    const m = await ready();
    await user.click(playBtn());
    hlsError({ fatal: true });
    await user.click(await screen.findByRole('button', { name: t('action.retry') }));
    await waitFor(() => expect(hlsMock.instances).toHaveLength(2));
    const m2 = await ready();
    m2.setTime(100);
    await fireEvent(m2.v, new Event('timeupdate'));
    expect(m2.pause).not.toHaveBeenCalled();
    expect(m.pause).not.toHaveBeenCalled();
  });
});

describe('키보드(PVU-4)', () => {
  const markS2 = () => markS();
  const keyI = { key: 'i', code: 'KeyI' };
  const keyO = { key: 'o', code: 'KeyO' };
  const space = { key: ' ', code: 'Space' };

  /** paused를 바꿀 수 있게 한다(jsdom의 paused는 늘 true) */
  function pausedState(v: HTMLVideoElement, initial = true) {
    let paused = initial;
    Object.defineProperty(v, 'paused', { configurable: true, get: () => paused });
    return (x: boolean) => (paused = x);
  }
  async function setup(over: Over = {}, time = 100) {
    const utils = await openEditor(over);
    const m = await ready(600, time);
    return { m, ...utils };
  }

  it('I는 시작, O는 끝을 찍는다(뿌리·찍기 단추·손잡이·영상)', async () => {
    await setup();
    const targets = [layer(), markS2(), markE(), slider(t('range.start')), slider(t('range.end')), videoEl()!];
    for (const el of targets) {
      const noDefault = await fireEvent.keyDown(el, keyI);
      expect(startInput()).toHaveValue('0:01:40');
      expect(noDefault).toBe(false);
      await fireEvent.keyDown(el, keyO);
      expect(endInput()).toHaveValue('0:01:40');
    }
  });

  it('한글 자판(key가 ㅑ)에서도 물리 키(KeyI)로 동작한다', async () => {
    await setup();
    await fireEvent.keyDown(layer(), { key: 'ㅑ', code: 'KeyI' });
    await fireEvent.keyDown(layer(), { key: 'ㅐ', code: 'KeyO' });
    expect(startInput()).toHaveValue('0:01:40');
    expect(endInput()).toHaveValue('0:01:40');
  });

  it('구간 보기·시작부터 보기 단추와 스위치 위의 I/O는 처리하지 않는다', async () => {
    await setup({ applied: range(60000, 90000) });
    for (const el of [playBtn(), fromStartBtn(), loopSwitch()]) {
      expect(await fireEvent.keyDown(el, keyI)).toBe(true);
      expect(await fireEvent.keyDown(el, keyO)).toBe(true);
    }
    expect(startInput()).toHaveValue('0:01:00');
    expect(endInput()).toHaveValue('0:01:30');
  });

  it('수식 키가 있는 I는 무시하고, 입력칸에서는 글자가 입력된다', async () => {
    await setup();
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
      expect(await fireEvent.keyDown(layer(), { ...keyI, ...mod })).toBe(true);
    }
    expect(await fireEvent.keyDown(startInput(), keyI)).toBe(true);
    expect(startInput()).toHaveValue('');
  });

  it('이미 처리된 키(defaultPrevented)는 무시한다', async () => {
    await setup();
    const el = layer();
    el.addEventListener('keydown', (e) => e.preventDefault(), { capture: true });
    await fireEvent.keyDown(el, keyI);
    expect(startInput()).toHaveValue('');
  });

  it('IME 조합 중의 키는 무시한다', async () => {
    await setup();
    await fireEvent.keyDown(layer(), { ...keyI, isComposing: true });
    await fireEvent.keyDown(layer(), { ...keyI, keyCode: 229 });
    await fireEvent.keyDown(layer(), { ...space, isComposing: true });
    expect(startInput()).toHaveValue('');
  });

  it('Space는 손잡이·뿌리에서 재생 ↔ 일시정지를 바꾸고 스크롤을 막는다', async () => {
    await setup();
    const m = mockVideo(600, 100);
    const setPaused = pausedState(m.v, true);
    for (const el of [layer(), slider(t('range.start'))]) {
      setPaused(true);
      expect(await fireEvent.keyDown(el, space)).toBe(false);
      expect(m.play).toHaveBeenCalledTimes(1);
      m.play.mockClear();
      setPaused(false);
      await fireEvent.keyDown(el, space);
      expect(m.pause).toHaveBeenCalledTimes(1);
      expect(m.play).not.toHaveBeenCalled();
      m.pause.mockClear();
    }
  });

  it('Space·Enter는 단추·스위치에서 재생을 바꾸지 않는다', async () => {
    await setup();
    const m = mockVideo(600, 100);
    pausedState(m.v, true);
    for (const el of [markS2(), markE(), playBtn(), loopSwitch()]) {
      expect(await fireEvent.keyDown(el, space)).toBe(true);
      expect(await fireEvent.keyDown(el, { key: 'Enter', code: 'Enter' })).toBe(true);
    }
    expect(m.play).not.toHaveBeenCalled();
    expect(m.pause).not.toHaveBeenCalled();
  });

  it('영상 위의 Space·화살표는 우리가 처리하지 않는다(네이티브 몫)', async () => {
    await setup();
    const m = mockVideo(600, 100);
    pausedState(m.v, true);
    expect(await fireEvent.keyDown(m.v, space)).toBe(true);
    expect(await fireEvent.keyDown(m.v, { key: 'ArrowRight' })).toBe(true);
    expect(await fireEvent.keyDown(m.v, { key: 'ArrowLeft' })).toBe(true);
    expect(m.play).not.toHaveBeenCalled();
    expect(m.writes).toEqual([]);
  });

  it('뿌리·단추·스위치의 ←/→는 재생 위치를 5초씩 옮긴다(0과 길이로 자름)', async () => {
    await setup({ applied: range(60000, 90000) });
    const m = mockVideo(600, 100);
    for (const el of [layer(), markS2(), loopSwitch()]) {
      m.writes.length = 0;
      m.setTime(100);
      expect(await fireEvent.keyDown(el, { key: 'ArrowRight' })).toBe(false);
      await fireEvent.keyDown(el, { key: 'ArrowLeft' });
      expect(m.writes).toEqual([105, 100]);
    }
    m.writes.length = 0;
    m.setTime(2);
    await fireEvent.keyDown(layer(), { key: 'ArrowLeft' });
    m.setTime(598);
    await fireEvent.keyDown(layer(), { key: 'ArrowRight' });
    expect(m.writes).toEqual([0, 600]);
  });

  it('손잡이 위의 화살표는 손잡이를 옮기고 재생 위치는 5초 이동하지 않는다', async () => {
    await setup({ applied: range(60000, 300000) });
    const m = mockVideo(600, 100);
    await fireEvent.keyDown(slider(t('range.start')), { key: 'ArrowRight' });
    expect(startInput()).toHaveValue('0:01:01');
    expect(endInput()).toHaveValue('0:05:00');
    expect(m.writes).toEqual([61]);
  });

  it('구간 보기 중 화살표로 옮기면 구간 보기가 꺼진다', async () => {
    const { user } = await setup({ applied: range(60000, 90000) });
    const m = mockVideo(600, 100);
    await user.click(playBtn());
    await fireEvent.keyDown(layer(), { key: 'ArrowRight' });
    m.setTime(95);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.pause).not.toHaveBeenCalled();
  });

  it('Ctrl/Meta/Alt + 화살표·Space는 처리하지 않는다', async () => {
    await setup();
    const m = mockVideo(600, 100);
    pausedState(m.v, true);
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      for (const el of [layer(), slider(t('range.start')), markS2()]) {
        expect(await fireEvent.keyDown(el, { key: 'ArrowRight', ...mod })).toBe(true);
        expect(await fireEvent.keyDown(el, { ...space, ...mod })).toBe(true);
      }
    }
    expect(m.writes).toEqual([]);
    expect(m.play).not.toHaveBeenCalled();
  });

  it('Shift+화살표는 뿌리에서 처리하지 않는다', async () => {
    const { m } = await setup();
    expect(await fireEvent.keyDown(layer(), { key: 'ArrowRight', shiftKey: true })).toBe(true);
    expect(m.writes).toEqual([]);
  });

  it('메타데이터 전에는 영상 동작 키를 처리하지 않는다(preventDefault도 하지 않는다)', async () => {
    await openEditor();
    expect(await fireEvent.keyDown(layer(), keyI)).toBe(true);
    expect(await fireEvent.keyDown(layer(), space)).toBe(true);
    expect(startInput()).toHaveValue('');
  });

  it('키를 누르고 있으면(자동 반복) I는 거른다', async () => {
    const { m } = await setup();
    for (const t0 of [100, 101, 102]) {
      m.setTime(t0);
      await fireEvent.keyDown(layer(), { ...keyI, repeat: true });
    }
    expect(startInput()).toHaveValue('');
    m.setTime(103);
    await fireEvent.keyDown(layer(), keyI);
    expect(startInput()).toHaveValue('0:01:43');
  });

  it('찍기 단추에 aria-keyshortcuts가 있다', async () => {
    await setup();
    expect(markS2()).toHaveAttribute('aria-keyshortcuts', 'I');
    expect(markE()).toHaveAttribute('aria-keyshortcuts', 'O');
  });
});

describe('영상 크기(monitorSize, RE-3)', () => {
  let roCallback: (() => void) | null = null;
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          roCallback = cb;
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    roCallback = null;
  });

  function size(el: Element, w: number, h: number) {
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: w });
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: h });
  }
  const box = () => document.querySelector('.videobox') as HTMLElement;

  it('ResizeObserver가 있으면 모니터 크기에서 16:9 영상 상자를 inline 크기로 정한다', async () => {
    mount();
    size(document.querySelector('.monitor')!, 1000, 600);
    roCallback!();
    await waitFor(() => expect(box().style.width).toBe('1000px'));
    expect(box().style.height).toBe('563px');
  });

  it('높이가 모자라면 높이에서 맞춘다(폭이 남는다)', async () => {
    mount();
    size(document.querySelector('.monitor')!, 1000, 300);
    roCallback!();
    await waitFor(() => expect(box().style.height).toBe('300px'));
    expect(box().style.width).toBe('533px');
  });

  it('좁은 레이아웃(표지 .fullsheet-probe가 block)은 폭에서만 정한다: 모니터 높이를 바꿔도 같다', async () => {
    mount();
    // layout.css가 좁은 레이아웃에서 표지를 block으로 바꾼다(jsdom에는 layout.css가 없어 inline으로 흉내 낸다)
    (document.querySelector('.fullsheet-probe') as HTMLElement).style.display = 'block';
    const monitor = document.querySelector('.monitor')!;
    size(monitor, 400, 100);
    roCallback!();
    await waitFor(() => expect(box().style.width).toBe('400px'));
    const h1px = box().style.height;
    size(monitor, 400, 900);
    roCallback!();
    await waitFor(() => expect(box().style.height).toBe(h1px));
    expect(h1px).toBe('225px');
  });

  it('ResizeObserver가 없으면(jsdom) inline 크기를 주지 않아 CSS가 폭 100%·16:9로 둔다', () => {
    vi.unstubAllGlobals();
    mount();
    expect(box().style.width).toBe('');
    expect(box().style.height).toBe('');
  });
});
