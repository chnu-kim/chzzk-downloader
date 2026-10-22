// 구간 편집 화면(RangeEditor, range-editor.md RE-3). 레이어·초안·검증·Esc·세션·결합과, 카드에서 옮겨 온 손잡이·찍기·구간 보기·키 시험.
// 예시 값(시각·길이·제목)은 모두 가짜다.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { tick } from 'svelte';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppError, TimeRangeDto, WatchOpenDto } from '../../bindings';
import { resolved } from '../../../test/fixtures';
import { t } from '../../copy/ko';
import { kindLabel } from '../../receive';
import { platform } from '../../stores/platform.svelte';
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
const markS = () => inControls(t('watch.mark.start'));
const markE = () => inControls(t('watch.mark.end'));
const controls = () => screen.getByRole('group', { name: t('rangeEditor.controls.label') });
const inControls = (name: string) => within(controls()).getByRole('button', { name });
/** 조작 줄의 보기 ↔ 일시정지 단추(한 단추에서 이름이 바뀐다) */
const playBtn = () => within(controls()).getByRole('button', { name: new RegExp(`^(${t('watch.start.label')}|${t('action.pause')})`) });
const toStartBtn = () => inControls(t('rangeEditor.toStart.label'));
const toEndBtn = () => inControls(t('rangeEditor.toEnd.label'));
const backBtn = () => inControls(t('rangeEditor.back.label', { n: 5 }));
const fwdBtn = () => inControls(t('rangeEditor.forward.label', { n: 5 }));
/** 구간 반복하기: 패널 머리의 토글 단추(aria-pressed) */
const loopSwitch = () => screen.getByRole('button', { name: t('watch.range.loop.label') });
const applyBtn = () => screen.getByRole('button', { name: new RegExp(t('rangeEditor.apply.label')) });
const closeBtn = () => screen.getByRole('button', { name: t('common.close') });
const clearBtn = () => screen.getByRole('button', { name: t('range.clear.label') });
const h1 = () => screen.getByRole('heading', { level: 1, name: t('rangeEditor.title') });
const track = () => document.querySelector('.track') as HTMLElement;
/** 구간 줄 아래 길이 줄(조작 줄 오른쪽 칸의 숨은 전체 길이와 따로 본다) */
const lengthLineEl = () => document.querySelector('.range-length');

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
  let paused = true;
  Object.defineProperty(v, 'paused', { configurable: true, get: () => paused });
  const play = vi.fn(() => Promise.resolve());
  const pause = vi.fn();
  v.play = play as never;
  v.pause = pause as never;
  return {
    setPaused: (x: boolean) => (paused = x),
    /** 브라우저처럼 play()·pause()가 paused를 바꾸고 play·pause 이벤트를 쏜다(우리가 부른 것도 이벤트가 되돌아온다) */
    live() {
      play.mockImplementation(() => {
        paused = false;
        v.dispatchEvent(new Event('play'));
        return Promise.resolve();
      });
      pause.mockImplementation(() => {
        paused = true;
        v.dispatchEvent(new Event('pause'));
      });
    },
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
    const controls = document.querySelector('.editor-controls')!;
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
    await waitFor(() => expect(h1()).toHaveFocus()); // 포커스가 연 단추를 떠난 뒤에 닫는다
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

  it('조작 줄은 늘 그리고 결합 전에는 단추 일곱이 모두 disabled다(RE8). 반복 토글은 조작 줄 밖이라 켜 둘 수 있다', () => {
    mount();
    const all = within(controls()).getAllByRole('button');
    expect(all).toHaveLength(7);
    for (const b of all) expect(b).toBeDisabled();
    expect(loopSwitch()).toBeEnabled();
  });
});

describe('초안·적용(RE2~RE6)', () => {
  it('확정값이 없으면 두 칸이 비어 있고 안내 글자가 처음부터·끝까지다', () => {
    mount();
    expect(startInput()).toHaveValue('');
    expect(endInput()).toHaveValue('');
    expect(startInput()).toHaveAttribute('placeholder', t('range.fromBegin'));
    expect(endInput()).toHaveAttribute('placeholder', t('range.toEnd'));
    expect(lengthLineEl()).toHaveTextContent(t('range.wholeLength.label', { length: '0:10:00' }));
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
    expect(lengthLineEl()).toHaveTextContent(t('range.wholeLengthSize.label', { length: '0:10:00', size: '약 600초분' }));
    await user.type(startInput(), '0:01:00');
    expect(lengthLineEl()).toHaveTextContent(t('range.lengthSize.label', { length: '0:09:00', size: '약 540초분' }));
    await user.clear(startInput());
    await user.type(startInput(), 'abc');
    expect(lengthLineEl()).toBeNull();
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

  it('길게 누른 Mod+Enter(repeat)는 적용하지 않고 막기만 한다. 전파도 막는다(RE16)', async () => {
    const { onapply } = mount();
    const reached = vi.fn();
    window.addEventListener('keydown', reached);
    try {
      expect(await fireEvent.keyDown(startInput(), { key: 'Enter', ctrlKey: true, repeat: true })).toBe(false);
      expect(onapply).not.toHaveBeenCalled();
      expect(reached).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', reached);
    }
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

  it('[다시 시도]를 누르면 사라지는 단추 대신 새로 그려진 [영상 보기]가 포커스를 받는다(F-4)', async () => {
    vi.mocked(api.watchOpen).mockRejectedValueOnce(appError('network'));
    const { user } = mount();
    await user.click(startBtn());
    await screen.findByRole('alert');
    await waitFor(() => expect(h1()).toHaveFocus());
    let resolve!: (d: WatchOpenDto) => void;
    vi.mocked(api.watchOpen).mockReturnValue(new Promise((r) => (resolve = r)));
    const retry = screen.getByRole('button', { name: t('action.retry') });
    retry.focus();
    await user.click(retry);
    await waitFor(() => expect(startBtn()).toHaveFocus());
    resolve(hlsOpened());
  });

  it('길이를 모르는 영상에서 세션이 닫혀 타임라인이 사라질 때 손잡이에 있던 포커스는 제목으로 간다(F-4)', async () => {
    vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
    const user = userEvent.setup();
    render(RangeEditor, { view: noLengthView, applied: null, sizeOf: () => null, onapply: vi.fn(), onclose: vi.fn() } as never);
    await user.click(screen.getByRole('button', { name: t('watch.start.a11y', { title: noLengthView.meta.title }) }));
    await waitFor(() => expect(hlsMock.instances).toHaveLength(1));
    await ready(600);
    slider(t('range.end')).focus();
    expect(slider(t('range.end'))).toHaveFocus();
    hlsError({ fatal: true });
    await waitFor(() => expect(sliders()).toHaveLength(0));
    await waitFor(() => expect(h1()).toHaveFocus());
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
    }, 20_000); // 키를 400번 누른다: 커버리지 측정 중에는 기본 5초를 넘길 수 있다

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

describe('구간 반복(RE-5, §8.2)', () => {
  const RANGE = range(60000, 90000);
  /** 연 뒤 메타데이터를 읽고 브라우저처럼 play·pause 이벤트가 오게 한다 */
  async function live(applied: TimeRangeDto | null = RANGE, duration = 600) {
    const { user } = await openEditor({ applied });
    const m = await ready(duration);
    m.live();
    return { user, m };
  }

  it('반복을 끈 채 보면 구간 끝을 지나 계속 간다: 되돌리지도 멈추지도 않는다', async () => {
    const { user, m } = await live();
    await user.click(playBtn());
    expect(m.play).toHaveBeenCalledTimes(1);
    expect(m.writes).toEqual([]);
    m.setTime(95);
    await fireEvent(m.v, new Event('timeupdate'));
    m.setTime(300);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.writes).toEqual([]);
    expect(m.pause).not.toHaveBeenCalled();
  });

  it('반복을 켜고 구간 밖에서 보기 시작하면 시작으로 가서 보고, 끝에서 시작으로 돌아온다', async () => {
    const { user, m } = await live();
    await user.click(loopSwitch());
    await user.click(playBtn());
    expect(m.writes).toEqual([60]);
    m.setTime(89.8);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.writes).toEqual([60]);
    m.setTime(90);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.writes).toEqual([60, 60]);
    m.setTime(90.1);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.writes).toEqual([60, 60, 60]);
    expect(m.pause).not.toHaveBeenCalled();
  });

  it('반복을 켜고 구간 안에서 보기 시작하면 시작으로 가지 않는다', async () => {
    const { user, m } = await live();
    m.setTime(75);
    await user.click(loopSwitch());
    await user.click(playBtn());
    expect(m.writes).toEqual([]);
    m.setTime(90);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.writes).toEqual([60]);
  });

  it('네이티브 controls로 시작해도(우리가 부르지 않은 play 이벤트) 반복 모드가 걸리고 따라가기가 켜진다', async () => {
    const { user, m } = await live();
    await user.click(loopSwitch());
    // 우리 단추를 거치지 않는다: 영상이 스스로 play 이벤트를 쏜다
    m.setPaused(false);
    await fireEvent(m.v, new Event('play'));
    expect(m.play).not.toHaveBeenCalled();
    expect(m.writes).toEqual([60]);
    m.setTime(90.2);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.writes).toEqual([60, 60]);
  });

  it('우리 탐색(시작·restart)이 만든 seeked는 반복 모드를 끄지 않는다. 키프레임 때문에 0.5초 앞에 닿아도 같다', async () => {
    const { user, m } = await live();
    await user.click(loopSwitch());
    await user.click(playBtn());
    m.setTime(59.8);
    await fireEvent(m.v, new Event('seeked'));
    m.setTime(90);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.writes).toEqual([60, 60]);
  });

  it('우리 것이 아닌 탐색은 구간 밖이면 반복 모드를 끈다. 토글은 켜진 채이고 다시 보기 시작하면 다시 건다', async () => {
    const { user, m } = await live();
    await user.click(loopSwitch());
    await user.click(playBtn());
    m.setTime(60);
    await fireEvent(m.v, new Event('seeked')); // 시작 탐색 표시를 먼저 쓴다
    m.setTime(300);
    await fireEvent(m.v, new Event('seeked'));
    m.setTime(301);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.writes).toEqual([60]);
    expect(loopSwitch()).toHaveAttribute('aria-pressed', 'true');
    // 일시정지 뒤 다시 보기: 구간 밖이라 시작으로 간다
    await user.click(playBtn()); // pause
    await user.click(playBtn()); // play
    expect(m.writes).toEqual([60, 60]);
  });

  it('사용자가 일시정지하면 반복 모드가 꺼진다', async () => {
    const { user, m } = await live();
    await user.click(loopSwitch());
    await user.click(playBtn());
    m.setPaused(false);
    await fireEvent(m.v, new Event('pause'));
    m.setTime(95);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.writes).toEqual([60]);
  });

  it('끝이 영상 끝이면 ended에서 반복은 처음으로 돌아가 다시 보고, 반복을 끈 채면 멈춘다', async () => {
    const { user, m } = await live(range(60000, null));
    await user.click(loopSwitch());
    await user.click(playBtn());
    await fireEvent(m.v, new Event('ended'));
    expect(m.writes).toEqual([60, 60]);
    expect(m.play).toHaveBeenCalledTimes(2);
    // 반복을 끈다(보는 중이라 모드도 꺼진다)
    await user.click(loopSwitch());
    await fireEvent(m.v, new Event('ended'));
    expect(m.writes).toEqual([60, 60]);
    expect(m.play).toHaveBeenCalledTimes(2);
  });

  it('실제 브라우저 순서(timeupdate → pause → ended)에서도 끝까지 반복은 이어진다', async () => {
    const { user, m } = await live(range(60000, null), 599.6);
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

  it('끝이 영상 끝이 아닌데 ended가 오면(meta가 더 길다) 반복도 끝낸다', async () => {
    const { user, m } = await live();
    await user.click(loopSwitch());
    await user.click(playBtn());
    await fireEvent(m.v, new Event('ended'));
    expect(m.writes).toEqual([60]);
    expect(m.play).toHaveBeenCalledTimes(1);
  });

  it('보는 중 토글을 켜면 모드가 걸리고(구간 뒤면 다음 timeupdate가 시작으로), 끄면 풀린다', async () => {
    const { user, m } = await live();
    m.setPaused(false);
    m.setTime(120);
    await user.click(loopSwitch());
    expect(m.writes).toEqual([]);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.writes).toEqual([60]);
    await user.click(loopSwitch());
    expect(loopSwitch()).toHaveAttribute('aria-pressed', 'false');
    m.setTime(95);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.writes).toEqual([60]);
  });

  it('멈춰 있을 때 토글을 켜도 아무 일이 없고 다음 보기 시작에서 건다', async () => {
    const { user, m } = await live();
    await user.click(loopSwitch());
    expect(m.writes).toEqual([]);
    expect(m.play).not.toHaveBeenCalled();
  });

  it('끝 손잡이를 끄는 동안(drag)에도 반복 모드가 꺼진다: restart가 끼어들지 않는다', async () => {
    const { user, m } = await live();
    rectOf(track());
    await user.click(loopSwitch());
    await user.click(playBtn());
    const thumb = slider(t('range.end'));
    await fireEvent.pointerDown(thumb, { clientX: 90, pointerId: 1 });
    await fireEvent.pointerMove(thumb, { clientX: 70, pointerId: 1 });
    m.setTime(100);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.writes).toEqual([60]);
  });

  it('손잡이를 고치면(keydown commit) 반복 모드를 끈다: restart가 끼어들지 않는다', async () => {
    const { user, m } = await live();
    await user.click(loopSwitch());
    await user.click(playBtn());
    await fireEvent.keyDown(slider(t('range.end')), { key: 'ArrowLeft' });
    m.setTime(100);
    await fireEvent(m.v, new Event('timeupdate'));
    await fireEvent(m.v, new Event('seeked'));
    expect(m.writes).toEqual([60, 89]);
  });

  it('순서가 뒤집힌 구간(시작 ≥ 끝)에서는 반복이 걸리지 않는다: 무한 restart가 없다', async () => {
    const { user, m } = await live(null);
    await user.type(startInput(), '0:05:00');
    await user.type(endInput(), '0:01:00');
    await user.click(loopSwitch());
    m.writes.length = 0; // 칸을 떠날 때 영상이 따라간 탐색은 센 값이 아니다
    await user.click(playBtn());
    m.setTime(100);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.writes).toEqual([]);
  });

  it('구간 길이 1초에서도 반복한다', async () => {
    const { user, m } = await live(range(60000, 61000));
    await user.click(loopSwitch());
    await user.click(playBtn());
    expect(m.writes).toEqual([60]);
    m.setTime(61);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.writes).toEqual([60, 60]);
  });

  it('보는 중 찍기로 구간이 지금 위치 앞으로 줄어들면 다음 timeupdate가 시작으로 되돌린다', async () => {
    const { user, m } = await live(range(60000, 120000));
    await user.click(loopSwitch());
    m.setTime(100);
    await user.click(playBtn());
    expect(m.writes).toEqual([]);
    // 끝 칸을 지금 위치(100) 앞으로 줄인다: 칸을 고치는 사용자 조작은 반복 모드를 끄지 않는다(손잡이만 끈다)
    await user.clear(endInput());
    await user.type(endInput(), '0:01:30');
    m.setTime(101);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.writes).toEqual([60]);
  });

  it('play()가 거부되면 반복 모드는 걸리지 않은 것으로 되돌린다', async () => {
    const { user, m } = await live();
    await user.click(loopSwitch());
    m.play.mockRejectedValueOnce(new Error('NotAllowed'));
    await user.click(playBtn());
    await Promise.resolve();
    await Promise.resolve();
    m.setTime(100);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.writes).toEqual([]);
  });

  it('다시 열면(실패 → 다시 시도) 반복 모드는 이어지지 않는다', async () => {
    const { user, m } = await live();
    await user.click(loopSwitch());
    await user.click(playBtn());
    hlsError({ fatal: true });
    await user.click(await screen.findByRole('button', { name: t('action.retry') }));
    await waitFor(() => expect(hlsMock.instances).toHaveLength(2));
    const m2 = await ready();
    m2.setTime(100);
    await fireEvent(m2.v, new Event('timeupdate'));
    expect(m2.writes).toEqual([]);
    expect(m.pause).not.toHaveBeenCalled();
  });
});

describe('조작 줄(RE-5, §8.1)', () => {
  async function setup(applied: TimeRangeDto | null = range(60000, 90000), duration = 600, time = 100) {
    const { user } = await openEditor({ applied });
    const m = await ready(duration, time);
    return { user, m };
  }

  it('group 이름이 있고 아이콘 단추 일곱이 정해진 순서로 있으며, 결합되면 모두 켜진다', async () => {
    const unmount = mount().unmount;
    const names = within(controls())
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual([
      t('watch.mark.start'),
      t('rangeEditor.toStart.label'),
      t('rangeEditor.back.label', { n: 5 }),
      t('watch.start.label'),
      t('rangeEditor.forward.label', { n: 5 }),
      t('rangeEditor.toEnd.label'),
      t('watch.mark.end'),
    ]);
    // 일곱 모두 글자 없는 아이콘 단추다
    for (const b of within(controls()).getAllByRole('button')) expect(b.textContent?.trim()).toBe('');
    unmount();
    await openEditor();
    await ready();
    for (const b of within(controls()).getAllByRole('button')) expect(b).toBeEnabled();
  });

  it('툴팁: 키가 있는 단추는 "{이름}({키})", 키가 없는 단추는 이름 그대로. aria-keyshortcuts를 단다', async () => {
    await setup();
    expect(markS()).toHaveAttribute('title', t('shortcut.hint.label', { label: t('watch.mark.start'), key: 'I' }));
    expect(markS()).toHaveAttribute('aria-keyshortcuts', 'I');
    expect(markE()).toHaveAttribute('title', t('shortcut.hint.label', { label: t('watch.mark.end'), key: 'O' }));
    expect(markE()).toHaveAttribute('aria-keyshortcuts', 'O');
    expect(backBtn()).toHaveAttribute('title', t('shortcut.hint.label', { label: t('rangeEditor.back.label', { n: 5 }), key: '←' }));
    expect(backBtn()).toHaveAttribute('aria-keyshortcuts', 'ArrowLeft');
    expect(fwdBtn()).toHaveAttribute('title', t('shortcut.hint.label', { label: t('rangeEditor.forward.label', { n: 5 }), key: '→' }));
    expect(fwdBtn()).toHaveAttribute('aria-keyshortcuts', 'ArrowRight');
    expect(playBtn()).toHaveAttribute('title', t('shortcut.hint.label', { label: t('watch.start.label'), key: 'Space' }));
    expect(playBtn()).toHaveAttribute('aria-keyshortcuts', 'Space');
    // 키가 없는 둘은 title = 이름
    expect(toStartBtn()).toHaveAttribute('title', t('rangeEditor.toStart.label'));
    expect(toStartBtn()).not.toHaveAttribute('aria-keyshortcuts');
    expect(toEndBtn()).toHaveAttribute('title', t('rangeEditor.toEnd.label'));
    expect(toEndBtn()).not.toHaveAttribute('aria-keyshortcuts');
  });

  it('보기 단추는 아이콘과 이름이 영상 상태에 따라 바뀌고 같은 요소다(포커스가 body로 가지 않는다)', async () => {
    const { user, m } = await setup();
    m.live();
    const before = playBtn();
    expect(before).toHaveAttribute('aria-label', t('watch.start.label'));
    before.focus();
    await user.click(before);
    const after = playBtn();
    expect(after).toBe(before);
    expect(after).toHaveAttribute('aria-label', t('action.pause'));
    expect(after).toHaveAttribute('title', t('shortcut.hint.label', { label: t('action.pause'), key: 'Space' }));
    expect(document.activeElement).toBe(after);
    await user.click(after);
    expect(playBtn()).toHaveAttribute('aria-label', t('watch.start.label'));
  });

  it('지금 시각(왼쪽)은 결합 뒤에만 있고 전체 길이(오른쪽)는 길이를 알면 있다. 숨은 글자가 짝이다', async () => {
    const { unmount } = mount();
    expect(controls().querySelector('.editor-now')?.textContent?.trim()).toBe('');
    expect(controls()).toHaveTextContent(t('range.wholeLength.label', { length: '0:10:00' }));
    unmount();
    await openEditor();
    const m = await ready(600, 100);
    expect(controls()).toHaveTextContent(t('rangeEditor.now.label', { time: '0:01:40' }));
    m.setTime(101.9);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(controls()).toHaveTextContent(t('rangeEditor.now.label', { time: '0:01:41' }));
  });

  it('N초 뒤로·앞으로: ±5초이고 [0, 길이]로 자른다. 반복 모드는 끈다', async () => {
    const { user, m } = await setup();
    await user.click(fwdBtn());
    await user.click(backBtn());
    expect(m.writes).toEqual([105, 100]);
    m.writes.length = 0;
    m.setTime(2);
    await user.click(backBtn());
    m.setTime(598);
    await user.click(fwdBtn());
    expect(m.writes).toEqual([0, 600]);
  });

  it('구간 처음으로: 시작으로 가고 보던 상태를 그대로 둔다(일시정지·재생 호출 없음)', async () => {
    const { user, m } = await setup();
    m.live();
    await user.click(toStartBtn());
    expect(m.writes).toEqual([60]);
    expect(m.play).not.toHaveBeenCalled();
    expect(m.pause).not.toHaveBeenCalled();
  });

  it('구간 처음으로: 반복이 켜져 있고 보는 중이면 반복 모드가 걸린다', async () => {
    const { user, m } = await setup();
    m.live();
    await user.click(loopSwitch());
    m.setPaused(false);
    m.setTime(100); // 구간 뒤에서 보는 중(반복은 아직 안 걸림)
    await fireEvent(m.v, new Event('seeked'));
    await user.click(toStartBtn());
    m.setTime(90);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.writes).toEqual([60, 60]);
  });

  it('구간 끝으로: 보는 중이면 일시정지하고 끝으로 간다. 멈춰 있으면 일시정지 없이 간다', async () => {
    const { user, m } = await setup();
    m.live();
    await user.click(toEndBtn());
    expect(m.pause).not.toHaveBeenCalled();
    expect(m.writes).toEqual([90]);
    m.setPaused(false);
    m.writes.length = 0;
    await user.click(toEndBtn());
    expect(m.pause).toHaveBeenCalledTimes(1);
    expect(m.writes).toEqual([90]);
  });

  it('구간 끝으로: 끝이 "끝까지"면 floor(길이)로 간다', async () => {
    // meta 길이가 600이라 floor(600)이고, 실제 영상이 599.6초뿐이면 video.duration으로 한 번 더 자른다
    const { user, m } = await setup(range(60000, null), 599.6);
    await user.click(toEndBtn());
    expect(m.writes).toEqual([599.6]);
    m.writes.length = 0;
    m.setDuration(700);
    await user.click(toEndBtn());
    expect(m.writes).toEqual([600]);
  });

  it('구간 끝으로 뒤 반복 모드는 꺼진다: 일시정지 뒤 끝에 있다가 다시 보면 시작으로 간다', async () => {
    const { user, m } = await setup();
    m.live();
    await user.click(loopSwitch());
    await user.click(playBtn()); // 구간 밖(100)에서 시작: 시작으로 가서 반복 모드
    expect(m.writes).toEqual([60]);
    await user.click(toEndBtn()); // 보는 중 → 일시정지 + 끝으로
    expect(m.pause).toHaveBeenCalledTimes(1);
    m.writes.length = 0;
    m.setTime(90);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.writes).toEqual([]); // 모드가 꺼져 있어 timeupdate가 되돌리지 않는다
    await user.click(playBtn()); // 다시 보기: 지금 자리(90)가 구간 밖이라 시작으로
    expect(m.writes).toEqual([60]);
  });

  it('이동 단추는 따라가기를 켜고 지금 위치가 보이게 범위를 한 번 옮긴다(확대했을 때)', async () => {
    const { user, m } = await setup(range(60000, 90000), 600, 300);
    const bar = () => Number(screen.getByRole('scrollbar').getAttribute('aria-valuenow'));
    const zoom = async () => {
      layer().dispatchEvent(new KeyboardEvent('keydown', { key: '+', cancelable: true, bubbles: true }));
      await tick();
    };
    await zoom(); // 지금 위치(300) 기준 ×2 → {150, 300}, 따라가기는 꺼진다
    expect(bar()).toBe(50);
    await user.click(toStartBtn()); // 60초: 범위 밖 → 범위가 옮겨 간다
    expect(bar()).toBeLessThan(50);
    // 따라가기가 켜졌으니 보는 중 timeupdate가 쪽을 넘긴다
    m.setPaused(false);
    m.setTime(500);
    await fireEvent(m.v, new Event('timeupdate'));
    await waitFor(() => expect(bar()).toBe(100));
    await zoom(); // 다시 끈다
    m.setTime(300);
    await fireEvent(m.v, new Event('timeupdate'));
    m.setPaused(true);
    await user.click(fwdBtn()); // 305: 범위 안이라 그대로
    const kept = bar();
    m.setPaused(false);
    m.setTime(10);
    await fireEvent(m.v, new Event('timeupdate'));
    await waitFor(() => expect(bar()).toBeLessThanOrEqual(kept)); // 따라가기가 켜져 있어 10초가 보이게 넘어간다
    expect(bar()).toBe(0);
  });

  it('찍기 단추는 지금 위치를 칸에 넣는다', async () => {
    const { user } = await setup(null);
    await user.click(markS());
    await user.click(markE());
    expect(startInput()).toHaveValue('0:01:40');
    expect(endInput()).toHaveValue('0:01:40');
  });

  it('반복 토글: Button이고 aria-pressed가 켜짐·꺼짐을 말한다. 켠 모양은 CSS가 aria-pressed로 만든다', async () => {
    mount();
    const b = loopSwitch();
    expect(b.tagName).toBe('BUTTON');
    expect(b).toHaveClass('btn');
    expect(b).toHaveAttribute('aria-pressed', 'false');
    await userEvent.setup().click(b);
    expect(b).toHaveAttribute('aria-pressed', 'true');
    expect(b).toHaveTextContent(t('watch.range.loop.label'));
  });

  it('Button 켜짐 모양(중립 눌림 면 + 1px 테두리, 파란 면 없음)은 aria-pressed 선택자 하나다', async () => {
    const css = readFileSync('src/styles/ui.css', 'utf8');
    const rule = /\.btn\[aria-pressed="true"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('background: var(--surface-2)');
    expect(rule).toContain('border-color: var(--border-strong)');
    expect(rule).not.toContain('--accent');
    // forced-colors: Highlight 면 + HighlightText
    const forced = /@media \(forced-colors: active\)[\s\S]*?\.btn\[aria-pressed="true"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(forced).toContain('background: Highlight');
    expect(forced).toContain('color: HighlightText');
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

  it('I/O는 조작 줄의 모든 단추와 반복 토글, 닫기·구간 지우기 위에서도 찍는다(편집 화면은 창 전체가 편집 영역, §9.1)', async () => {
    await setup({ applied: range(60000, 90000) });
    const els = [playBtn(), toStartBtn(), toEndBtn(), backBtn(), fwdBtn(), loopSwitch(), closeBtn(), clearBtn()];
    for (const el of els) {
      expect(await fireEvent.keyDown(el, keyI)).toBe(false);
      expect(startInput()).toHaveValue('0:01:40');
      expect(await fireEvent.keyDown(el, keyO)).toBe(false);
      expect(endInput()).toHaveValue('0:01:40');
      await fireEvent.input(startInput(), { target: { value: '0:01:00' } });
      await fireEvent.input(endInput(), { target: { value: '0:01:30' } });
    }
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
    for (const el of [markS2(), markE(), playBtn(), toStartBtn(), loopSwitch()]) {
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

  it('반복 중 화살표로 옮기면 반복 모드가 꺼진다: 구간 끝에서 되돌리지 않는다', async () => {
    const { user } = await setup({ applied: range(60000, 90000) });
    const m = mockVideo(600, 70);
    m.live();
    await user.click(loopSwitch());
    await user.click(playBtn());
    m.writes.length = 0;
    await fireEvent.keyDown(layer(), { key: 'ArrowRight' });
    m.setTime(95);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(m.writes).toEqual([75]);
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

describe('키 우선순위 표(§9.1, RE-5)', () => {
  const space = { key: ' ', code: 'Space' };
  const timeGroup = () => screen.getByRole('group', { name: t('rangeEditor.timeline.title') });
  async function setup(applied: TimeRangeDto | null = range(60000, 300000)) {
    await openEditor({ applied });
    const m = await ready(600, 100);
    m.live();
    return m;
  }

  it('←/→: 손잡이는 값(영상 5초 이동 없음), 칸은 캐럿(기본 동작을 막지 않는다), 단추·시간 영역·뿌리는 5초', async () => {
    const m = await setup();
    // 손잡이: 값 ∓1, 영상은 그 값으로 한 번 간다
    expect(await fireEvent.keyDown(slider(t('range.start')), { key: 'ArrowRight' })).toBe(false);
    expect(startInput()).toHaveValue('0:01:01');
    expect(m.writes).toEqual([61]);
    // 칸: 처리하지 않는다
    m.writes.length = 0;
    expect(await fireEvent.keyDown(startInput(), { key: 'ArrowLeft' })).toBe(true);
    expect(m.writes).toEqual([]);
    // 단추·시간 영역·뿌리: 5초
    for (const el of [backBtn(), loopSwitch(), timeGroup(), layer()]) {
      m.writes.length = 0;
      m.setTime(100);
      expect(await fireEvent.keyDown(el, { key: 'ArrowRight' })).toBe(false);
      expect(m.writes).toEqual([105]);
    }
  });

  it('Shift+←/→ · ↑/↓ · PageUp · Home은 뿌리·단추에서 처리하지 않는다(손잡이·칸·막대 몫)', async () => {
    const m = await setup();
    for (const el of [backBtn(), timeGroup(), layer()]) {
      for (const init of [{ key: 'ArrowRight', shiftKey: true }, { key: 'ArrowUp' }, { key: 'ArrowDown' }, { key: 'PageUp' }, { key: 'Home' }, { key: 'End' }]) {
        expect(await fireEvent.keyDown(el, init)).toBe(true);
      }
    }
    expect(m.writes).toEqual([]);
  });

  it('범위 막대의 ←/→는 보이는 범위를 옮기고 영상은 건드리지 않는다. Space는 보기 ↔ 일시정지다', async () => {
    const m = await setup();
    layer().dispatchEvent(new KeyboardEvent('keydown', { key: '+', cancelable: true, bubbles: true }));
    await tick();
    const bar = screen.getByRole('scrollbar');
    const before = bar.getAttribute('aria-valuenow');
    expect(await fireEvent.keyDown(bar, { key: 'ArrowRight' })).toBe(false);
    expect(bar.getAttribute('aria-valuenow')).not.toBe(before);
    expect(m.writes).toEqual([]);
    expect(await fireEvent.keyDown(bar, space)).toBe(false);
    expect(m.play).toHaveBeenCalledTimes(1);
  });

  it('Space: 시간 영역 빈 곳·뿌리·손잡이는 보기 ↔ 일시정지, 영상 위는 네이티브, 단추 위는 단추 누름(기본)', async () => {
    const m = await setup();
    for (const el of [timeGroup(), layer(), slider(t('range.end'))]) {
      m.play.mockClear();
      m.pause.mockClear();
      m.setPaused(true);
      expect(await fireEvent.keyDown(el, space)).toBe(false);
      expect(m.play).toHaveBeenCalledTimes(1);
      expect(await fireEvent.keyDown(el, space)).toBe(false);
      expect(m.pause).toHaveBeenCalledTimes(1);
    }
    expect(await fireEvent.keyDown(m.v, space)).toBe(true);
    expect(await fireEvent.keyDown(toStartBtn(), space)).toBe(true);
  });

  it('+ - 0: Shift가 같이 눌려도(+) 확대하고, 단추·영상 위에서도 같다. Ctrl/Meta/Alt면 처리하지 않는다', async () => {
    await setup();
    const bar = () => screen.queryByRole('scrollbar');
    expect(await fireEvent.keyDown(backBtn(), { key: '+', shiftKey: true })).toBe(false);
    expect(bar()).not.toBeNull();
    expect(await fireEvent.keyDown(videoEl()!, { key: '0' })).toBe(false);
    expect(bar()).toBeNull();
    expect(await fireEvent.keyDown(layer(), { key: '=' })).toBe(false);
    expect(bar()).not.toBeNull();
    await fireEvent.keyDown(layer(), { key: '0' });
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(await fireEvent.keyDown(layer(), { key: '+', ...mod })).toBe(true);
    }
    expect(bar()).toBeNull();
    // 칸에서는 글자 그대로
    expect(await fireEvent.keyDown(startInput(), { key: '+' })).toBe(true);
  });

  it('결합 전에는 I/O/Space/←/→ 모두 처리하지 않고 preventDefault도 하지 않는다. 확대 키는 결합 전에도 동작한다', async () => {
    await openEditor();
    for (const init of [{ key: 'i', code: 'KeyI' }, { key: 'o', code: 'KeyO' }, space, { key: 'ArrowLeft' }, { key: 'ArrowRight' }]) {
      expect(await fireEvent.keyDown(layer(), init)).toBe(true);
    }
    expect(await fireEvent.keyDown(layer(), { key: '+' })).toBe(false);
  });

  it('IME 조합 중·229 키는 어떤 편집 키도 처리하지 않는다', async () => {
    const m = await setup();
    for (const init of [{ key: ' ', code: 'Space' }, { key: 'ArrowRight' }, { key: '+' }, { key: 'i', code: 'KeyI' }]) {
      expect(await fireEvent.keyDown(layer(), { ...init, isComposing: true })).toBe(true);
      expect(await fireEvent.keyDown(layer(), { ...init, keyCode: 229 })).toBe(true);
    }
    expect(m.writes).toEqual([]);
    expect(m.play).not.toHaveBeenCalled();
    expect(screen.queryByRole('scrollbar')).toBeNull();
  });

  it('←/→ 반복 keydown은 반복마다 5초씩 간다', async () => {
    const m = await setup();
    for (let i = 0; i < 3; i += 1) {
      await fireEvent.keyDown(layer(), { key: 'ArrowRight', repeat: i > 0 });
    }
    expect(m.writes).toEqual([105, 110, 115]);
  });

  it('끌기 중에는 I/O/Space/←/→/+를 처리하지 않는다(RE13)', async () => {
    const m = await setup();
    rectOf(track());
    const thumb = slider(t('range.start'));
    await fireEvent.pointerDown(thumb, { button: 0, clientX: 60, pointerId: 1 });
    for (const init of [{ key: 'i', code: 'KeyI' }, space, { key: 'ArrowRight' }, { key: '+' }]) {
      expect(await fireEvent.keyDown(layer(), init)).toBe(true);
    }
    expect(m.play).not.toHaveBeenCalled();
    await fireEvent.pointerUp(thumb, { clientX: 60, pointerId: 1 });
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

// ---- RE-4: 타임라인 패널(확대·이동·안내 줄·전체 보기·키·따라가기·끌기 취소) ----
describe('타임라인 패널(RE-4)', () => {
  const group = () => screen.getByRole('group', { name: t('rangeEditor.timeline.title') });
  const fitBtn = () => screen.queryByRole('button', { name: t('rangeEditor.fit.label') });
  const sbar = () => screen.queryByRole('scrollbar');
  const wheelOn = (el: Element, init: WheelEventInit) => {
    const ev = new WheelEvent('wheel', { cancelable: true, bubbles: true, ...init });
    el.dispatchEvent(ev);
    return ev;
  };
  /** 휠로 확대한다(Ctrl+위로 굴림). 트랙 폭 600 */
  async function zoomIn(clientX = 300) {
    rectOf(track());
    wheelOn(group(), { deltaY: -300, ctrlKey: true, clientX });
    await tick();
  }
  const pressKey = async (key: string, init: KeyboardEventInit = {}) => {
    const ev = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true, ...init });
    layer().dispatchEvent(ev);
    await tick();
    return ev;
  };
  const sbNow = () => Number(sbar()!.getAttribute('aria-valuenow'));
  const setPlaying = (m: ReturnType<typeof mockVideo>) => Object.defineProperty(m.v, 'paused', { configurable: true, value: false });

  afterEach(() => platform.set('linux'));

  it('안내 줄은 세 문장(휠·확대 방법, 앞뒤 도움말, 확대 키)이고 시간 영역의 설명이다. range.help는 한 곳에만 있다', () => {
    mount();
    const g = group();
    const help = document.getElementById(g.getAttribute('aria-describedby') ?? '')!;
    expect(help).not.toBeNull();
    expect(help).toHaveTextContent(t('rangeEditor.timeline.help', { mod: 'Ctrl' }));
    expect(help).toHaveTextContent(t('range.help'));
    expect(help).toHaveTextContent(t('rangeEditor.timeline.keys', { zoomIn: '+', zoomOut: '-', fit: '0' }));
    expect(screen.getAllByText(t('range.help'))).toHaveLength(1);
    // 시각 칸은 이 안내 줄 안의 range.help 문장을 가리킨다
    const rangeHelp = screen.getByText(t('range.help'));
    expect(help).toContainElement(rangeHelp);
    expect((startInput().getAttribute('aria-describedby') ?? '').split(' ')).toContain(rangeHelp.id);
  });

  it('모니터 영역은 "영상"이라는 이름의 영역이고 패널은 "타임라인"이다', () => {
    mount();
    expect(screen.getByRole('region', { name: t('rangeEditor.track.video.label') })).toHaveClass('monitor');
    expect(screen.getByRole('region', { name: t('rangeEditor.timeline.title') })).toHaveClass('panel');
  });

  it('macOS는 수식 키가 ⌘로 나온다', () => {
    platform.set('macos');
    mount();
    const help = document.getElementById(group().getAttribute('aria-describedby') ?? '')!;
    expect(help).toHaveTextContent(t('rangeEditor.timeline.help', { mod: '⌘' }));
  });

  it('전체 보기에서는 [전체 보기]·범위 막대가 없고, 휠로 확대하면 나타난다. 툴팁은 "전체 보기(0)"', async () => {
    mount();
    expect(fitBtn()).toBeNull();
    expect(sbar()).toBeNull();
    await zoomIn();
    const fit = fitBtn()!;
    expect(fit).not.toBeNull();
    expect(fit).toHaveAttribute('title', t('shortcut.hint.label', { label: t('rangeEditor.fit.label'), key: '0' }));
    expect(sbar()).not.toBeNull();
    fit.click();
    await waitFor(() => {
      expect(fitBtn()).toBeNull();
      expect(sbar()).toBeNull();
    });
  });

  it('+ - 0 키: Shift+=도 확대, 결합 전에도 동작, 처리한 키만 preventDefault', async () => {
    mount();
    const press = (init: KeyboardEventInit) => {
      const ev = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init });
      layer().dispatchEvent(ev);
      return ev;
    };
    expect(press({ key: '+', shiftKey: true }).defaultPrevented).toBe(true);
    await waitFor(() => expect(sbar()).not.toBeNull());
    const before = sbar()!.getAttribute('aria-valuetext');
    expect(press({ key: '-' }).defaultPrevented).toBe(true);
    await waitFor(() => expect(sbar()).toBeNull());
    expect(before).toBe(t('rangeEditor.viewport.value.label', { from: '2분 30초', to: '7분 30초' }));
    press({ key: '=' });
    await waitFor(() => expect(sbar()).not.toBeNull());
    expect(press({ key: '0' }).defaultPrevented).toBe(true);
    await waitFor(() => expect(sbar()).toBeNull());
  });

  it('Ctrl·Alt·Meta와 함께인 +는 처리하지 않고, 입력칸 안에서는 글자 그대로다', async () => {
    mount();
    for (const init of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      const ev = new KeyboardEvent('keydown', { key: '+', cancelable: true, bubbles: true, ...init });
      layer().dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(sbar()).toBeNull();
    const ev = new KeyboardEvent('keydown', { key: '+', cancelable: true, bubbles: true });
    startInput().dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(sbar()).toBeNull();
  });

  it('IME 조합 중에는 + 를 처리하지 않는다', async () => {
    mount();
    const ev = new KeyboardEvent('keydown', { key: '+', isComposing: true, cancelable: true, bubbles: true });
    layer().dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(sbar()).toBeNull();
  });

  it('길이가 20초 미만이면 확대 키가 아무 일도 하지 않는다', () => {
    mount({ view: resolved({ meta: { ...resolved().meta, durationSecs: 15 } }) });
    const ev = new KeyboardEvent('keydown', { key: '+', cancelable: true, bubbles: true });
    layer().dispatchEvent(ev);
    expect(sbar()).toBeNull();
  });

  it('키 확대의 중심: 지금 위치선이 보이면 그 시각, 아니면 가운데', async () => {
    await openEditor();
    const m = await ready();
    m.setTime(0);
    await fireEvent(m.v, new Event('timeupdate'));
    layer().dispatchEvent(new KeyboardEvent('keydown', { key: '+', cancelable: true, bubbles: true }));
    // 위치 0이 보이면 0을 중심으로: 보이는 범위는 0부터 300초
    await waitFor(() => expect(sbar()).toHaveAttribute('aria-valuetext', t('rangeEditor.viewport.value.label', { from: '0초', to: '5분' })));
  });

  it('끌기 중에는 확대 키도 휠 확대도 무시한다(RE13)', async () => {
    mount({ applied: range(60000, 300000) });
    rectOf(track());
    const thumb = slider(t('range.start'));
    await fireEvent.pointerDown(thumb, { button: 0, clientX: 60, pointerId: 1 });
    const ev = new KeyboardEvent('keydown', { key: '+', cancelable: true, bubbles: true });
    thumb.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(wheelOn(group(), { deltaY: -300, ctrlKey: true, clientX: 300 }).defaultPrevented).toBe(true);
    expect(sbar()).toBeNull();
    await fireEvent.pointerUp(thumb, { clientX: 60, pointerId: 1 });
  });

  it('손잡이를 끄는 값은 보이는 범위의 좌표다(확대 뒤)', async () => {
    mount({ applied: range(300000, 450000) });
    await zoomIn(); // 가운데(300초) 기준 확대
    const text = sbar()!.getAttribute('aria-valuetext')!;
    expect(text).not.toBe('');
    const thumb = slider(t('range.start'));
    await fireEvent.pointerDown(thumb, { button: 0, clientX: 300, pointerId: 1 });
    await fireEvent.pointerMove(thumb, { clientX: 330, pointerId: 1 });
    await fireEvent.pointerUp(thumb, { clientX: 330, pointerId: 1 });
    // 확대했으므로 30px는 600초 폭 전체 기준의 30초보다 훨씬 작다
    const secs = Number(startInput().value.split(':').reduce((a, p) => a * 60 + Number(p), 0));
    expect(secs).toBeGreaterThan(300);
    expect(secs).toBeLessThan(330);
  });

  it('트랙 누름 탐색은 확대한 보이는 범위의 시각이다', async () => {
    await openEditor();
    const m = await ready();
    zoomIn();
    await fireEvent.pointerDown(track(), { button: 0, clientX: 300, pointerId: 1 });
    expect(m.writes).toHaveLength(1);
    expect(m.writes[0]).toBeGreaterThan(200);
    expect(m.writes[0]).toBeLessThan(400);
  });

  it('상대 손잡이가 끌기를 제한한다(시작은 끝−1까지)', async () => {
    mount({ applied: range(60000, 90000) });
    rectOf(track());
    const thumb = slider(t('range.start'));
    await fireEvent.pointerDown(thumb, { button: 0, clientX: 60, pointerId: 1 });
    await fireEvent.pointerMove(thumb, { clientX: 400, pointerId: 1 });
    expect(startInput()).toHaveValue('0:01:29');
  });

  it('끌기 중 Esc는 누르기 전 초안(원래 글자 그대로)으로 되돌리고 편집 화면은 닫지 않는다. 반복 Esc도 닫지 않는다', async () => {
    const { onclose } = mount({ applied: null });
    rectOf(track());
    await user_type_start('0:01:05');
    const thumb = slider(t('range.start'));
    await fireEvent.pointerDown(thumb, { button: 0, clientX: 75, pointerId: 1 });
    await fireEvent.pointerMove(thumb, { clientX: 210, pointerId: 1 });
    expect(startInput()).toHaveValue('0:03:20');
    const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
    thumb.dispatchEvent(esc);
    await tick();
    expect(esc.defaultPrevented).toBe(true);
    expect(startInput()).toHaveValue('0:01:05');
    expect(onclose).not.toHaveBeenCalled();
    layer().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', repeat: true, cancelable: true, bubbles: true }));
    expect(onclose).not.toHaveBeenCalled();
    // 놓아도 commit이 없다
    await fireEvent.pointerUp(thumb, { clientX: 200, pointerId: 1 });
    expect(startInput()).toHaveValue('0:01:05');
    // 끌기가 끝났으니 다음 Esc는 닫는다
    await fireEvent.keyDown(layer(), { key: 'Escape' });
    expect(onclose).toHaveBeenCalledOnce();
  });

  async function user_type_start(text: string) {
    await userEvent.setup().type(startInput(), text);
  }

  it('Esc 사다리 처리기(포커스가 body일 때)도 끌기 중이면 취소만 하고 닫지 않는다', async () => {
    const { onclose } = mount({ applied: range(60000, 90000) });
    rectOf(track());
    const thumb = slider(t('range.start'));
    await fireEvent.pointerDown(thumb, { button: 0, clientX: 60, pointerId: 1 });
    await fireEvent.pointerMove(thumb, { clientX: 20, pointerId: 1 });
    expect(startInput()).toHaveValue('0:00:20');
    expect(ui.escape()).toBe(true);
    await tick();
    expect(startInput()).toHaveValue('0:01:00');
    expect(onclose).not.toHaveBeenCalled();
    expect(ui.escape()).toBe(true);
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('화면 밖 손잡이를 누르면 칸 값은 그대로이고 보이는 범위만 옮겨 간다', async () => {
    mount({ applied: range(10000, 20000) });
    await zoomIn(600); // 오른쪽 끝을 중심으로 확대: 10~20초 손잡이는 왼쪽 밖
    const thumb = slider(t('range.start'));
    expect(thumb).toHaveAttribute('data-placement', 'before');
    const before = sbNow();
    await fireEvent.pointerDown(thumb, { button: 0, clientX: 5, pointerId: 1 });
    expect(startInput()).toHaveValue('0:00:10');
    expect(sbNow()).toBeLessThan(before);
    expect(thumb).toHaveAttribute('data-placement', 'inside');
  });

  it('따라가기: 보는 중 위치선이 범위를 벗어나면 쪽을 넘기고, 휠로 움직이면 멈추고, 다시 보기 시작하면 이어진다', async () => {
    await openEditor();
    const m = await ready();
    setPlaying(m);
    m.setTime(300);
    await fireEvent(m.v, new Event('timeupdate'));
    await pressKey('+');
    // 지금 위치(300초) 기준 ×2 → {150, 300}
    expect(sbNow()).toBe(50);
    // 확대는 따라가기를 끈다: 보기가 시작(play)되면 다시 켜진다
    await fireEvent(m.v, new Event('play'));
    m.setTime(580);
    await fireEvent(m.v, new Event('timeupdate'));
    await waitFor(() => expect(sbNow()).toBe(100));
    // 휠로 앞으로 가면 따라가기가 꺼진다
    rectOf(track());
    wheelOn(group(), { deltaY: -600 });
    await waitFor(() => expect(sbNow()).toBeLessThan(100));
    const kept = sbNow();
    m.setTime(10);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(sbNow()).toBe(kept);
    // 보기 시작(play 이벤트)에서 다시 켜진다
    await fireEvent(m.v, new Event('play'));
    m.setTime(580);
    await fireEvent(m.v, new Event('timeupdate'));
    await waitFor(() => expect(sbNow()).toBe(100));
  });

  it('따라가기는 일시정지 중에는 쪽을 넘기지 않는다', async () => {
    await openEditor();
    const m = await ready();
    m.setTime(300);
    await fireEvent(m.v, new Event('timeupdate'));
    await pressKey('+');
    expect(sbNow()).toBe(50);
    m.setTime(580);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(sbNow()).toBe(50);
  });

  it('seeked에서도 따라간다', async () => {
    await openEditor();
    const m = await ready();
    setPlaying(m);
    m.setTime(300);
    await fireEvent(m.v, new Event('timeupdate'));
    await pressKey('+');
    await fireEvent(m.v, new Event('play'));
    m.setTime(590);
    await fireEvent(m.v, new Event('seeked'));
    await waitFor(() => expect(sbNow()).toBe(100));
  });

  it('+ - 키가 따라가기를 끈다', async () => {
    await openEditor();
    const m = await ready();
    setPlaying(m);
    m.setTime(300);
    await fireEvent(m.v, new Event('timeupdate'));
    await pressKey('+');
    await pressKey('+');
    expect(sbNow()).toBe(50);
    m.setTime(590);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(sbNow()).toBe(50);
    await pressKey('-');
    m.setTime(5);
    await fireEvent(m.v, new Event('timeupdate'));
    const kept = sbNow();
    await fireEvent(m.v, new Event('timeupdate'));
    expect(sbNow()).toBe(kept);
  });

  it('끌기 중에는 따라가기를 적용하지 않는다(범위 고정)', async () => {
    await openEditor({ applied: range(300000, 400000) });
    const m = await ready();
    setPlaying(m);
    m.setTime(300);
    await fireEvent(m.v, new Event('timeupdate'));
    await pressKey('+');
    const before = sbNow();
    rectOf(track());
    const thumb = slider(t('range.end'));
    await fireEvent.pointerDown(thumb, { button: 0, clientX: 380, pointerId: 1 });
    m.setTime(590);
    await fireEvent(m.v, new Event('timeupdate'));
    expect(sbNow()).toBe(before);
    await fireEvent.pointerUp(thumb, { clientX: 380, pointerId: 1 });
  });

  it('길이 변화: 길이를 모르다가 영상이 알려 주면 전체 보기로 나온다. 영상이 닫히면 사라지고 다시 오면 전체 보기다', async () => {
    vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
    const user = userEvent.setup();
    render(RangeEditor, { view: noLengthView, applied: null, sizeOf: () => null, onapply: vi.fn(), onclose: vi.fn() } as never);
    await user.click(screen.getByRole('button', { name: t('watch.start.a11y', { title: noLengthView.meta.title }) }));
    await waitFor(() => expect(hlsMock.instances).toHaveLength(1));
    await ready(599.6);
    expect(sbar()).toBeNull();
    layer().dispatchEvent(new KeyboardEvent('keydown', { key: '+', cancelable: true, bubbles: true }));
    await waitFor(() => expect(sbar()).not.toBeNull());
    hlsError({ fatal: true });
    await screen.findByRole('alert');
    expect(sliders()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: t('action.retry') }));
    await waitFor(() => expect(hlsMock.instances).toHaveLength(2));
    await ready(300);
    expect(sliders()).toHaveLength(2);
    expect(sbar()).toBeNull();
  });

  it('구간 줄·패널 머리에서 굴린 휠은 시간 영역이 처리하지 않는다', () => {
    mount();
    rectOf(track());
    const ev = wheelOn(startInput(), { deltaY: -300, ctrlKey: true, clientX: 300 });
    expect(ev.defaultPrevented).toBe(false);
    expect(sbar()).toBeNull();
  });
});

// ---- RE-4 리뷰 반영 ----
describe('리뷰 반영(RE-4)', () => {
  const group = () => screen.getByRole('group', { name: t('rangeEditor.timeline.title') });
  const sbar = () => screen.queryByRole('scrollbar');
  const fitBtn = () => screen.queryByRole('button', { name: t('rangeEditor.fit.label') });
  const press = async (target: Element, key: string, init: KeyboardEventInit = {}) => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true, ...init }));
    await tick();
  };
  async function zoomed() {
    await press(layer(), '+');
    await waitFor(() => expect(sbar()).not.toBeNull());
  }
  const helpEl = () => screen.getByText(t('range.help'));

  it('[전체 보기]를 누르면 단추가 사라져도 포커스가 시간 영역으로 간다(body로 떨어지지 않는다)', async () => {
    mount();
    await zoomed();
    fitBtn()!.focus();
    fitBtn()!.click();
    await waitFor(() => expect(fitBtn()).toBeNull());
    expect(document.activeElement).toBe(group());
  });

  it('범위 막대에서 0을 눌러 전체 보기로 가도 포커스는 시간 영역에 남는다', async () => {
    mount();
    await zoomed();
    sbar()!.focus();
    await press(sbar()!, '0');
    await waitFor(() => expect(sbar()).toBeNull());
    expect(document.activeElement).toBe(group());
  });

  it('범위 막대에서 -로 전체까지 줄여도 같다', async () => {
    mount();
    await zoomed();
    sbar()!.focus();
    await press(sbar()!, '-');
    await waitFor(() => expect(sbar()).toBeNull());
    expect(document.activeElement).toBe(group());
  });

  it('다른 곳에 포커스가 있으면 전체 보기가 포커스를 끌어오지 않는다', async () => {
    mount();
    await zoomed();
    h1().focus();
    await press(layer(), '0');
    await waitFor(() => expect(sbar()).toBeNull());
    expect(document.activeElement).toBe(h1());
  });

  it('길이를 모르는 영상에도 앞뒤 도움말(range.help)이 구간 줄에 남고 시각 칸이 가리킨다', () => {
    mount({ view: noLengthView });
    expect(screen.getAllByText(t('range.help'))).toHaveLength(1);
    expect((startInput().getAttribute('aria-describedby') ?? '').split(' ')).toContain(helpEl().id);
  });

  it('시각 칸은 안내 줄 전체가 아니라 range.help 문장만 설명으로 가리킨다', () => {
    mount();
    const ids = (startInput().getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toContain(helpEl().id);
    const whole = document.getElementById(group().getAttribute('aria-describedby') ?? '')!;
    expect(ids).not.toContain(whole.id);
  });

  it('대체 경로(네이티브 m3u8)에서도 range.help가 한 번 나온다', async () => {
    hlsMock.FakeHls.supported = false;
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation((type) =>
      type === 'application/vnd.apple.mpegurl' ? 'maybe' : '',
    );
    vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
    const { user } = mount();
    await user.click(startBtn());
    const m = mockVideo();
    await fireEvent(m.v, new Event('loadedmetadata'));
    await screen.findByText(t('rangeEditor.uncoupled.body'));
    expect(screen.getAllByText(t('range.help'))).toHaveLength(1);
  });

  it('끌기 중 타임라인이 사라져도(치명 오류로 길이를 잃음) 확대 키가 영구히 꺼지지 않는다', async () => {
    vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
    const user = userEvent.setup();
    render(RangeEditor, { view: noLengthView, applied: null, sizeOf: () => null, onapply: vi.fn(), onclose: vi.fn() } as never);
    await user.click(screen.getByRole('button', { name: t('watch.start.a11y', { title: noLengthView.meta.title }) }));
    await waitFor(() => expect(hlsMock.instances).toHaveLength(1));
    await ready(599.6);
    rectOf(track());
    await fireEvent.pointerDown(slider(t('range.start')), { button: 0, clientX: 0, pointerId: 1 });
    hlsError({ fatal: true });
    await screen.findByRole('alert');
    expect(sliders()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: t('action.retry') }));
    await waitFor(() => expect(hlsMock.instances).toHaveLength(2));
    await ready(300);
    await press(layer(), '+');
    await waitFor(() => expect(sbar()).not.toBeNull());
  });

  it('끌기 중에는 I/O·Space·←/→가 아무것도 바꾸지 않는다(RE13)', async () => {
    await openEditor({ applied: range(60000, 90000) });
    const m = await ready();
    rectOf(track());
    const thumb = slider(t('range.start'));
    await fireEvent.pointerDown(thumb, { button: 0, clientX: 60, pointerId: 1 });
    const before = [startInput().value, endInput().value];
    const writes = m.writes.length;
    for (const [k, code] of [['i', 'KeyI'], ['o', 'KeyO'], [' ', 'Space'], ['ArrowRight', 'ArrowRight'], ['ArrowLeft', 'ArrowLeft']]) {
      layer().dispatchEvent(new KeyboardEvent('keydown', { key: k, code, cancelable: true, bubbles: true }));
    }
    thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true, bubbles: true }));
    await tick();
    expect([startInput().value, endInput().value]).toEqual(before);
    expect(m.writes).toHaveLength(writes);
    expect(m.play).not.toHaveBeenCalledTimes(2);
    await fireEvent.pointerUp(thumb, { clientX: 60, pointerId: 1 });
  });
});
