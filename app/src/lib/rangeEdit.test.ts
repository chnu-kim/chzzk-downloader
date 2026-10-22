import { describe, expect, it } from 'vitest';
import {
  clampHandle,
  consumeOwnSeek,
  handleBounds,
  handleKey,
  mark,
  moveHandle,
  nudge,
  playStep,
  reachesEnd,
  seekKey,
  seekTargetOf,
  selection,
  timelineLength,
  type Fields,
  type PlayMode,
} from './rangeEdit';
import { effectiveRange } from './receive';

// 명세 docs/design/features/preview-ux.md §5.1·§6.2·§6.3·§11.2 PVU-1. 예시 값은 모두 가짜다.

const META = { secs: 600, source: 'meta' } as const;
const open = (start: string, end: string): Fields => ({ start, end });
const NONE = { shift: false, alt: false, ctrl: false, meta: false };

describe('timelineLength', () => {
  it.each([
    [600, null, { secs: 600, source: 'meta' }],
    [600, 599.6, { secs: 600, source: 'meta' }],
    [null, 599.6, { secs: 599.6, source: 'video' }],
    [0, 599.6, { secs: 599.6, source: 'video' }],
    [null, Number.NaN, null],
    [null, Number.POSITIVE_INFINITY, null],
    [null, 0, null],
    [null, null, null],
    [0, null, null],
    [Number.NaN, null, null],
  ] as [number | null, number | null, ReturnType<typeof timelineLength>][])('meta %s video %s', (m, v, want) => {
    expect(timelineLength(m, v)).toEqual(want);
  });
});

describe('selection', () => {
  it.each([
    ['열림 정상', open('0:01:00', '0:05:00'), 600, { start: 60, end: 300, band: true }],
    ['못 읽는 시작은 0', open('abc', '0:05:00'), 600, { start: 0, end: 300, band: true }],
    ['못 읽는 끝은 길이', open('0:01:00', 'abc'), 600, { start: 60, end: 600, band: true }],
    ['빈 끝은 길이', open('0:01:00', ''), 600, { start: 60, end: 600, band: true }],
    ['순서 뒤집힘은 띠 없음', open('0:05:30', '0:01:05'), 600, { start: 330, end: 65, band: false }],
    ['같은 값도 띠 없음', open('0:01:00', '0:01:00'), 600, { start: 60, end: 60, band: false }],
    ['둘 다 길이 넘음', open('0:12:00', '0:13:00'), 600, { start: 600, end: 600, band: false }],
    ['시작이 길이와 같음', open('0:10:00', ''), 600, { start: 600, end: 600, band: false }],
    ['소수 길이는 내림', open('0:00:10', ''), 599.6, { start: 10, end: 599, band: true }],
  ] as [string, Fields, number, ReturnType<typeof selection>][])('%s', (_n, f, len, want) => {
    expect(selection(f, len)).toEqual(want);
  });
});

describe('handleBounds (모든 행에서 min ≤ now ≤ max)', () => {
  it.each([
    ['열림 정상', open('0:01:00', '0:05:00'), { s: [0, 299], e: [61, 600] }],
    ['뒤집힘', open('0:05:30', '0:01:05'), { s: [0, 600], e: [0, 600] }],
    ['둘 다 길이 넘음', open('0:12:00', '0:13:00'), { s: [0, 600], e: [0, 600] }],
    ['빈 끝', open('0:01:00', ''), { s: [0, 599], e: [61, 600] }],
  ] as [string, Fields, { s: [number, number]; e: [number, number] }][])('%s', (_n, f, want) => {
    const sel = selection(f, 600);
    const s = handleBounds('start', sel, 600);
    const e = handleBounds('end', sel, 600);
    expect([s.min, s.max]).toEqual(want.s);
    expect([e.min, e.max]).toEqual(want.e);
    expect(s.min).toBeLessThanOrEqual(sel.start);
    expect(sel.start).toBeLessThanOrEqual(s.max);
    expect(e.min).toBeLessThanOrEqual(sel.end);
    expect(sel.end).toBeLessThanOrEqual(e.max);
  });

  it('소수 길이는 내림', () => {
    const sel = selection(open('0:00:10', ''), 599.6);
    expect(handleBounds('end', sel, 599.6)).toEqual({ min: 11, max: 599 });
  });
});

describe('clampHandle (§6.2 표)', () => {
  it.each([
    ['start', 120, 300, 600, 120],
    ['start', 400, 300, 600, 299],
    ['start', -5, 300, 600, 0],
    ['start', 12.7, 300, 600, 12],
    ['end', 30, 60, 600, 61],
    ['end', 9999, 60, 600, 600],
    ['end', 9999, 60, 599.6, 599],
    ['start', 331, null, 600, 331],
    ['end', -1, null, 600, 0],
    ['start', 0, 599, 600, 0],
    ['start', 9999, null, 600, 600],
    // 엣지: 최소 간격 1초가 끝까지 남는 경계
    ['end', 0, 599, 600, 600],
    ['start', 5, 1, 600, 0],
    ['end', 5, 2, 3, 3],
  ] as ['start' | 'end', number, number | null, number, number][])('%s %s other=%s len=%s → %s', (h, secs, other, len, want) => {
    expect(clampHandle(h, secs, other, len)).toBe(want);
  });

  it.each([
    ['start', 5, 1.9],
    ['end', 5, 1],
    ['start', 5, 0],
    ['start', 5, Number.NaN],
  ] as ['start' | 'end', number, number][])('len < 2는 null (%s %s len=%s)', (h, secs, len) => {
    expect(clampHandle(h, secs, null, len)).toBeNull();
    expect(clampHandle(h, secs, 1, len)).toBeNull();
  });

  it('길이가 정확히 2초면 고칠 수 있다', () => {
    expect(clampHandle('start', 9, 1, 2)).toBe(0);
    expect(clampHandle('end', -9, 0, 2)).toBe(1);
  });

  it('숫자가 아닌 초는 null', () => {
    expect(clampHandle('start', Number.NaN, null, 600)).toBeNull();
  });
});

describe('handleKey', () => {
  it.each([
    ['ArrowLeft', {}, -1],
    ['ArrowDown', {}, -1],
    ['ArrowRight', {}, 1],
    ['ArrowUp', {}, 1],
    ['ArrowRight', { shift: true }, 10],
    ['ArrowLeft', { shift: true }, -10],
    ['PageUp', {}, 60],
    ['PageDown', {}, -60],
    ['Home', {}, 'min'],
    ['End', {}, 'max'],
    ['a', {}, null],
    ['Enter', {}, null],
    ['ArrowRight', { alt: true }, null],
    ['ArrowRight', { ctrl: true }, null],
    ['ArrowRight', { meta: true }, null],
    ['Home', { meta: true }, null],
    ['PageUp', { ctrl: true }, null],
    ['ArrowRight', { shift: true, alt: true }, null],
  ] as [string, Partial<typeof NONE>, ReturnType<typeof handleKey>][])('%s %j → %s', (key, mods, want) => {
    expect(handleKey(key, { ...NONE, ...mods })).toBe(want);
  });
});

describe('seekKey', () => {
  it.each([
    ['ArrowLeft', {}, -5],
    ['ArrowRight', {}, 5],
    ['ArrowUp', {}, null],
    ['PageUp', {}, null],
    ['Home', {}, null],
    ['a', {}, null],
    ['ArrowLeft', { shift: true }, null],
    ['ArrowRight', { alt: true }, null],
    ['ArrowRight', { ctrl: true }, null],
    ['ArrowLeft', { meta: true }, null],
  ] as [string, Partial<typeof NONE>, number | null][])('%s %j → %s', (key, mods, want) => {
    expect(seekKey(key, { ...NONE, ...mods })).toBe(want);
  });
});

describe('moveHandle (§6.2 손잡이 규칙 표)', () => {
  it.each([
    ['start → 120', open('0:01:00', '0:05:00'), 'start', 120, '0:02:00', '0:05:00'],
    ['start → 400은 끝−1', open('0:01:00', '0:05:00'), 'start', 400, '0:04:59', '0:05:00'],
    ['end → 30은 시작+1', open('0:01:00', '0:05:00'), 'end', 30, '0:01:00', '0:01:01'],
    ['end → 9999는 영상 끝', open('0:01:00', '0:05:00'), 'end', 9999, '0:01:00', '0:10:00'],
    ['start → −5는 0', open('0:01:00', '0:05:00'), 'start', -5, '0:00:00', '0:05:00'],
    ['못 읽은 시작은 0으로 보고 자른다', open('abc', '0:05:00'), 'start', 60, '0:01:00', '0:05:00'],
    ['못 읽은 끝은 길이로 보고 끝 칸은 그대로', open('0:01:00', 'abc'), 'start', 60, '0:01:00', 'abc'],
    ['뒤집힘: 시작은 다른 손잡이로 자르지 않는다', open('0:05:30', '0:01:05'), 'start', 331, '0:05:31', '0:01:05'],
    ['뒤집힘: 끝도 마찬가지', open('0:05:30', '0:01:05'), 'end', 66, '0:05:30', '0:01:06'],
    ['뒤집힘: 순서가 바로 서는 값', open('0:05:30', '0:01:05'), 'end', 400, '0:05:30', '0:06:40'],
    ['뒤집힘: 시작은 [0, 길이]만', open('0:05:30', '0:01:05'), 'start', 9999, '0:10:00', '0:01:05'],
    ['둘 다 길이 넘음: band 없음', open('0:12:00', '0:13:00'), 'end', 30, '0:12:00', '0:00:30'],
    ['소수 초는 내림', open('0:01:00', '0:05:00'), 'start', 120.9, '0:02:00', '0:05:00'],
  ] as [string, Fields, 'start' | 'end', number, string, string][])('%s', (_n, f, h, secs, start, end) => {
    expect(moveHandle(f, h, secs, META)).toEqual({ start, end });
  });

  it('읽지 못하는 다른 칸 글자는 그대로 두고 옮긴 칸만 바꾼다(접힘 되돌림은 없다)', () => {
    expect(moveHandle(open('x', 'y'), 'end', 100, META)).toEqual(open('x', '0:01:40'));
  });

  it('입력 칸을 바꾸지 않는다', () => {
    const f = open('0:01:00', '0:05:00');
    moveHandle(f, 'start', 120, META);
    expect(f).toEqual(open('0:01:00', '0:05:00'));
  });

  it('길이 1초 영상은 고칠 수 없다', () => {
    expect(moveHandle(open('0:00:00', ''), 'end', 1, { secs: 1, source: 'meta' })).toBeNull();
    expect(moveHandle(open('0:00:00', ''), 'start', 0, { secs: 1.9, source: 'video' })).toBeNull();
  });

  it('길이 2초 영상: 시작은 0~1, 끝은 1~2', () => {
    const len = { secs: 2, source: 'meta' } as const;
    expect(moveHandle(open('0:00:00', '0:00:02'), 'start', 9, len)).toEqual(open('0:00:01', '0:00:02'));
    expect(moveHandle(open('0:00:00', '0:00:02'), 'end', 0, len)).toEqual(open('0:00:00', '0:00:01'));
  });

  describe('meta가 없고 video 길이만 있을 때(source video)', () => {
    const VIDEO = { secs: 599.6, source: 'video' } as const;
    it('끝 손잡이를 맨 끝까지 옮기면 끝 칸은 빈 문자열(끝까지)', () => {
      expect(moveHandle(open('0:01:00', '0:05:00'), 'end', 9999, VIDEO)).toEqual(open('0:01:00', ''));
    });
    it('맨 끝이 아니면 시각', () => {
      expect(moveHandle(open('0:01:00', ''), 'end', 300, VIDEO)).toEqual(open('0:01:00', '0:05:00'));
    });
    it('floor(길이) 바로 아래는 시각 그대로', () => {
      expect(moveHandle(open('0:01:00', ''), 'end', 598, VIDEO)?.end).toBe('0:09:58');
    });
  });

  describe('receive.effectiveRange와 묶음', () => {
    it('meta: 끝 손잡이를 맨 끝으로 + 시작 0이면 전체 받기(null)', () => {
      const next = moveHandle(open('0:00:00', '0:05:00'), 'end', 9999, META) as Fields;
      expect(effectiveRange({ open: true, ...next }, 600)).toBeNull();
    });
    it('meta: 시작을 옮기면 [시작, 영상 끝]', () => {
      const next = moveHandle(open('', ''), 'start', 60, META) as Fields;
      expect(effectiveRange({ open: true, ...next }, 600)).toEqual({ startMs: 60000, endMs: 600000 });
    });
    it('video(meta 없음): 끝까지(빈 끝 칸)는 끝 없음', () => {
      const next = moveHandle(open('0:01:00', '0:05:00'), 'end', 9999, { secs: 599.6, source: 'video' }) as Fields;
      expect(effectiveRange({ open: true, ...next }, null)).toEqual({ startMs: 60000, endMs: null });
    });
    it('손잡이가 만든 칸은 늘 순서가 선 구간이 된다', () => {
      for (const v of [0, 1, 59, 300, 599, 600, 9999]) {
        const a = effectiveRange({ open: true, ...(moveHandle(open('0:01:00', '0:05:00'), 'start', v, META) as Fields) }, 600);
        const b = effectiveRange({ open: true, ...(moveHandle(open('0:01:00', '0:05:00'), 'end', v, META) as Fields) }, 600);
        expect(a!.endMs!).toBeGreaterThan(a!.startMs);
        expect(b!.endMs!).toBeGreaterThan(b!.startMs);
      }
    });
  });
});

describe('nudge', () => {
  it.each([
    ['시작 +1', open('0:01:00', '0:05:00'), 'start', 1, '0:01:01', '0:05:00'],
    ['시작 −1', open('0:01:00', '0:05:00'), 'start', -1, '0:00:59', '0:05:00'],
    ['끝 +1', open('0:01:00', '0:05:00'), 'end', 1, '0:01:00', '0:05:01'],
    ['끝 −1', open('0:01:00', '0:05:00'), 'end', -1, '0:01:00', '0:04:59'],
    ['시작은 0 아래로 못 간다', open('0:00:00', '0:05:00'), 'start', -1, '0:00:00', '0:05:00'],
    ['시작은 끝−1까지', open('0:04:59', '0:05:00'), 'start', 1, '0:04:59', '0:05:00'],
    ['끝은 시작+1까지', open('0:04:59', '0:05:00'), 'end', -1, '0:04:59', '0:05:00'],
    ['끝은 길이까지', open('0:01:00', '0:10:00'), 'end', 1, '0:01:00', '0:10:00'],
    ['빈 끝 칸은 길이로 본다', open('0:01:00', ''), 'end', -1, '0:01:00', '0:09:59'],
    ['뒤집힘: 시작은 [0, 길이]만', open('0:05:30', '0:01:05'), 'start', 1, '0:05:31', '0:01:05'],
    ['뒤집힘: 끝 +1도 다른 칸으로 자르지 않는다', open('0:05:30', '0:01:05'), 'end', 1, '0:05:30', '0:01:06'],
    ['뒤집힘: 길이 넘는 시작은 길이로 자른다', open('0:12:00', '0:13:00'), 'start', 1, '0:10:00', '0:13:00'],
    ['뒤집힘: 길이 넘는 끝은 길이로 자른다', open('0:12:00', '0:13:00'), 'end', -1, '0:12:00', '0:10:00'],
  ] as [string, Fields, 'start' | 'end', number, string, string][])('%s', (_n, f, h, d, start, end) => {
    expect(nudge(f, h, d, META)).toEqual({ start, end });
  });

  it('고칠 칸을 못 읽으면 null (단추 비활성)', () => {
    expect(nudge(open('abc', '0:05:00'), 'start', 1, META)).toBeNull();
    expect(nudge(open('0:01:00', 'abc'), 'end', 1, META)).toBeNull();
  });

  it('빈 시작 칸은 0초로 읽는다(PS10)', () => {
    expect(nudge(open('', '0:05:00'), 'start', 1, META)).toEqual(open('0:00:01', '0:05:00'));
    expect(nudge(open('  ', '0:05:00'), 'start', -1, META)).toEqual(open('0:00:00', '0:05:00'));
    expect(nudge(open('', ''), 'start', 1, META)).toEqual(open('0:00:01', ''));
    expect(nudge(open('', ''), 'end', -1, META)).toEqual(open('', '0:09:59'));
  });

  it('다른 칸을 못 읽어도 이 칸은 [0, 길이]로 고친다', () => {
    expect(nudge(open('0:01:00', 'abc'), 'start', 1, META)).toEqual(open('0:01:01', 'abc'));
  });

  it('못 읽는 다른 칸은 selection처럼 본다 (시작 0, 끝 길이): moveHandle과 같은 경계', () => {
    expect(nudge(open('0:09:59', 'abc'), 'start', 1, META)).toEqual(open('0:09:59', 'abc'));
    expect(nudge(open('abc', '0:00:01'), 'end', -1, META)).toEqual(open('abc', '0:00:01'));
  });

  it('입력 칸을 바꾸지 않는다', () => {
    const f = open('0:03:00', '0:04:00');
    nudge(f, 'start', 1, META);
    expect(f).toEqual(open('0:03:00', '0:04:00'));
  });

  describe('len = null (meta 없음, 미리보기 닫힘)', () => {
    it('끝 상한이 없다', () => {
      expect(nudge(open('0:01:00', '0:05:00'), 'end', 1, null)).toEqual(open('0:01:00', '0:05:01'));
      expect(nudge(open('0:01:00', '0:05:00'), 'end', 100000, null)).toEqual(open('0:01:00', '27:51:40'));
    });
    it('시작은 끝−1까지', () => {
      expect(nudge(open('0:04:59', '0:05:00'), 'start', 1, null)).toEqual(open('0:04:59', '0:05:00'));
    });
    it('빈 끝 칸이면 시작 상한이 없다', () => {
      expect(nudge(open('0:01:00', ''), 'start', 1, null)).toEqual(open('0:01:01', ''));
    });
    it('빈 끝 칸의 끝은 값을 몰라 고칠 수 없다', () => {
      expect(nudge(open('0:01:00', ''), 'end', 1, null)).toBeNull();
    });
    it('뒤집힘이면 그 칸만 [0, ∞)', () => {
      expect(nudge(open('0:05:30', '0:01:05'), 'start', 1, null)).toEqual(open('0:05:31', '0:01:05'));
      expect(nudge(open('0:05:30', '0:01:05'), 'end', -100000, null)).toEqual(open('0:05:30', '0:00:00'));
    });
  });

  it('video 길이에서 끝을 맨 끝으로 밀면 끝 칸은 빈 문자열', () => {
    const VIDEO = { secs: 599.6, source: 'video' } as const;
    expect(nudge(open('0:01:00', '0:09:58'), 'end', 1, VIDEO)).toEqual(open('0:01:00', ''));
    expect(nudge(open('0:01:00', '0:09:57'), 'end', 1, VIDEO)).toEqual(open('0:01:00', '0:09:58'));
  });

  it('길이 1초 영상은 고칠 수 없다', () => {
    expect(nudge(open('0:00:00', ''), 'end', 1, { secs: 1, source: 'meta' })).toBeNull();
  });
});

describe('mark (찍기)', () => {
  it.each([
    ['열림 끝: 자르지 않고 뒤집힘을 허용', open('0:05:00', '0:06:00'), 'end', 65.9, '0:05:00', '0:01:05'],
    ['열림 시작: 끝 칸을 건드리지 않는다', open('0:01:00', 'abc'), 'start', 30, '0:00:30', 'abc'],
    ['내림', open('0:01:00', '0:02:00'), 'start', 59.99, '0:00:59', '0:02:00'],
    ['길이 넘는 시각도 자르지 않는다', open('0:01:00', '0:02:00'), 'end', 99999, '0:01:00', '27:46:39'],
    ['음수·NaN은 0', open('0:01:00', '0:02:00'), 'start', Number.NaN, '0:00:00', '0:02:00'],
  ] as [string, Fields, 'start' | 'end', number, string, string][])('%s', (_n, f, h, t, start, end) => {
    expect(mark(f, h, t)).toEqual({ start, end });
  });

  it('입력 칸을 바꾸지 않는다', () => {
    const f = open('0:03:00', '0:04:00');
    mark(f, 'start', 10);
    expect(f).toEqual(open('0:03:00', '0:04:00'));
  });
});

describe('seekTargetOf', () => {
  it.each([
    ['0:01:05', 600, 65],
    ['1:05', 600, 65],
    ['0：01：05', 600, 65],
    ['  0:01:05  ', 600, 65],
    ['0:00:00', 600, 0],
    ['abc', 600, null],
    ['1:5', 600, null],
    ['0:99:00', 600, null],
    ['1:00:00', 600, 600],
    ['0:10:00', 600, 600],
    ['0:09:59', 599.6, 599],
    ['1:00:00', 599.6, 599],
  ] as [string, number, number | null][])('%j (len %s) → %s', (text, len, want) => {
    expect(seekTargetOf(text, len)).toBe(want);
  });

  it('빈칸: 끝 칸은 null(이동 없음), 시작 칸은 0초(PS10)', () => {
    expect(seekTargetOf('', 600)).toBeNull();
    expect(seekTargetOf('   ', 600, 'end')).toBeNull();
    expect(seekTargetOf('', 600, 'start')).toBe(0);
    expect(seekTargetOf('   ', 600, 'start')).toBe(0);
    expect(seekTargetOf('abc', 600, 'start')).toBeNull();
  });
});

describe('playStep (range-editor.md §8.2 표)', () => {
  const sel = { start: 60, end: 90, toEnd: false };
  const selEnd = { start: 60, end: 600, toEnd: true };
  type Ev = Parameters<typeof playStep>[1];
  const time = (t: number, byUs = false): Ev => ({ kind: 'time', t, byUs });
  const seeked = (t: number, byUs: boolean): Ev => ({ kind: 'seeked', t, byUs });
  const pause = (byUs: boolean): Ev => ({ kind: 'pause', t: 75, byUs });
  const ended = (): Ev => ({ kind: 'ended', t: 600, byUs: false });
  const play = (t: number, loop: boolean): Ev => ({ kind: 'play', t, loop });
  const toggle = (on: boolean): Ev => ({ kind: 'toggle', on });

  it.each([
    // 보기 시작(play 이벤트): 반복 꺼짐은 지금 자리부터, 켜짐은 구간 밖이면 시작으로
    ['off', '보기 시작 · 반복 꺼짐 · 구간 안', play(75, false), sel, 'off', 'none'],
    ['off', '보기 시작 · 반복 꺼짐 · 구간 뒤(끝을 지나 계속 본다)', play(200, false), sel, 'off', 'none'],
    ['off', '보기 시작 · 반복 켜짐 · 구간 안', play(75, true), sel, 'loop', 'none'],
    ['off', '보기 시작 · 반복 켜짐 · 시작 경계(60)', play(60, true), sel, 'loop', 'none'],
    ['off', '보기 시작 · 반복 켜짐 · 구간 앞(30)', play(30, true), sel, 'loop', 'restart'],
    ['off', '보기 시작 · 반복 켜짐 · 끝 경계(90)', play(90, true), sel, 'loop', 'restart'],
    ['off', '보기 시작 · 반복 켜짐 · 구간 뒤(영상 끝에서 다시 보기)', play(600, true), sel, 'loop', 'restart'],
    ['loop', '보기 시작 · 반복 꺼짐(켜져 있던 모드는 꺼진다)', play(75, false), sel, 'off', 'none'],
    // 보는 중 t ≥ end
    ['off', 'time 지남 · 반복 꺼짐은 계속 본다', time(95), sel, 'off', 'none'],
    ['loop', 'time 89.8', time(89.8), sel, 'loop', 'none'],
    ['loop', 'time 90(= end)', time(90), sel, 'loop', 'restart'],
    ['loop', 'time 90.1', time(90.1), sel, 'loop', 'restart'],
    ['loop', 'time 59.9(시작 앞, 들어가는 중)', time(59.9), sel, 'loop', 'none'],
    // 영상 끝
    ['off', 'ended', ended(), selEnd, 'off', 'none'],
    ['loop', 'ended 끝까지(toEnd)', ended(), selEnd, 'loop', 'restart'],
    ['loop', 'ended 끝까지가 아니다(이미 restart했어야 한다)', ended(), sel, 'off', 'none'],
    // 사용자 탐색
    ['off', 'seeked 30', seeked(30, false), sel, 'off', 'none'],
    ['loop', 'seeked 30 사용자(구간 앞) → off', seeked(30, false), sel, 'off', 'none'],
    ['loop', 'seeked 90(= end) 사용자 → off', seeked(90, false), sel, 'off', 'none'],
    ['loop', 'seeked 75 구간 안 사용자 → 유지', seeked(75, false), sel, 'loop', 'none'],
    ['loop', 'seeked 60(시작 경계) 사용자 → 유지', seeked(60, false), sel, 'loop', 'none'],
    ['loop', 'seeked 60 우리 → 유지', seeked(60, true), sel, 'loop', 'none'],
    ['loop', 'seeked 30 우리(키프레임) → 유지', seeked(30, true), sel, 'loop', 'none'],
    // 일시정지
    ['loop', 'pause 사용자 → off', pause(false), sel, 'off', 'none'],
    ['loop', 'pause 우리 → 유지', pause(true), sel, 'loop', 'none'],
    ['off', 'pause 우리(구간 끝으로 가기)', pause(true), sel, 'off', 'none'],
    ['off', 'pause 사용자', pause(false), sel, 'off', 'none'],
    // 보는 중 토글
    ['off', '토글 켬(위치와 무관: 구간 뒤 되돌림은 아래 별도 it이 고정)', toggle(true), sel, 'loop', 'none'],
    ['loop', '토글 끔', toggle(false), sel, 'off', 'none'],
    ['off', '토글 끔(이미 꺼짐)', toggle(false), sel, 'off', 'none'],
  ] as [PlayMode, string, Ev, typeof sel, PlayMode, string][])('%s · %s', (mode, _n, ev, s, wantMode, wantAction) => {
    expect(playStep(mode, ev, s)).toEqual({ mode: wantMode, action: wantAction });
  });

  it('토글을 켠 뒤 구간 뒤에서 오는 time은 시작으로 되돌린다(구간 뒤에서 켠 경우)', () => {
    const on = playStep('off', toggle(true), sel);
    expect(playStep(on.mode, time(120), sel)).toEqual({ mode: 'loop', action: 'restart' });
  });

  it('PlayMode에는 range가 없다(RE21)', () => {
    // @ts-expect-error 'range' 모드는 지웠다
    const dead: PlayMode = 'range';
    expect(playStep('off', time(95), sel).action).toBe('none');
    void dead;
  });
});

describe('consumeOwnSeek', () => {
  it.each([
    [60, 60.3, true],
    [60, 59.5, true],
    [60, 60.5, true],
    [60, 60.6, false],
    [60, 61, false],
    [60, 30, false],
    [null, 60, false],
  ] as [number | null, number, boolean][])('목표 %s, seeked %s → byUs %s, 표시는 지워진다', (pending, t, byUs) => {
    expect(consumeOwnSeek(pending, t)).toEqual({ byUs, pending: null });
  });

  it('한 번 쓰면 다음은 false', () => {
    const first = consumeOwnSeek(60, 60);
    expect(first.byUs).toBe(true);
    expect(consumeOwnSeek(first.pending, 60).byUs).toBe(false);
  });
});

describe('reachesEnd', () => {
  it.each([
    [{ end: 300 }, '', 600, true],
    [{ end: 300 }, '   ', 600, true],
    [{ end: 600 }, '0:10:00', 600.4, true],
    [{ end: 601 }, '0:10:01', 600, true],
    [{ end: 599 }, '0:09:59', 600, false],
    [{ end: 599 }, '0:09:59', 599.6, true],
    [{ end: 300 }, '0:05:00', 600, false],
  ] as [{ end: number }, string, number, boolean][])('%j %j len %s → %s', (sel, text, len, want) => {
    expect(reachesEnd(sel, text, len)).toBe(want);
  });
});
