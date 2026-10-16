import { describe, expect, it } from 'vitest';
import { check, liveResolved, quality, resolved } from '../test/fixtures';
import { t } from './copy/ko';
import { formatClock } from './format/duration';
import {
  BLOCK_REASON_ID,
  CHECK_DEBOUNCE_MS,
  bestQualityIndex,
  downloadBlock,
  recentSecondLine,
  DEFAULT_CHOICES,
  buildEnqueueRequest,
  canDownload,
  checkKey,
  kindTone,
  metaParts,
  notices,
  qualityFps,
  qualitySize,
  RANGE_FORMAT_EXAMPLE_SECS,
  effectiveRange,
  rangeChip,
  rangeError,
  rangeSecs,
  shouldSuggestClipboard,
  usesFreeName,
} from './receive';

describe('표시', () => {
  it('종류 라벨', () => {
    expect(kindTone('clip', 'progressive')).toBe('clip');
    expect(kindTone('video', 'liveRewindHls')).toBe('rewind');
    expect(kindTone('video', 'progressive')).toBe('vod');
    // 생방송은 종류와 재생 방식 어느 쪽으로 와도 live(ADR-0025)
    expect(kindTone('live', 'live')).toBe('live');
    expect(kindTone('video', 'live')).toBe('live');
  });

  it('메타 줄: 방송 날짜가 있으면 방송, 없으면 업로드, 길이 H:MM:SS', () => {
    expect(metaParts(resolved())).toEqual(['채널이름', '2026. 10. 3. 오후 9:00 방송', '3:12:45']);
    const r = resolved();
    r.meta.liveOpenDate = null;
    r.meta.durationSecs = null;
    expect(metaParts(r)).toEqual(['채널이름', '2026. 10. 4. 업로드']);
    r.meta.publishDate = null;
    expect(metaParts(r)).toEqual(['채널이름']);
  });

  it('생방송 메타 줄: 길이가 없고 화질 예상 크기도 없다(길이를 모른다)', () => {
    const r = liveResolved();
    expect(metaParts(r)).toEqual(['채널이름', '2026. 10. 16. 오후 9:00 방송']);
    expect(qualitySize(r.qualities[0], r.meta.durationSecs)).toBeNull();
  });

  it('화질 fps·예상 크기', () => {
    expect(qualityFps(quality())).toBe('60fps');
    expect(qualityFps(quality({ frameRate: null }))).toBeNull();
    // 8 Mbps × 3600초 / 8 = 3.6e9 B
    expect(qualitySize(quality(), 3600)).toBe('약 3.6GB');
    expect(qualitySize(quality(), 3600, 1024)).toBe('약 3.4GB');
    expect(qualitySize(quality({ bandwidth: null }), 3600)).toBeNull();
    expect(qualitySize(quality(), null)).toBeNull();
  });
});

describe('buildEnqueueRequest (§6.4 표)', () => {
  const r = resolved();
  const q = r.qualities[1];

  it('충돌이 없으면 검사한 이름 그대로, restart=false, skip(그사이 생긴 파일을 덮어쓰지 않는다)', () => {
    const req = buildEnqueueRequest(r, q, null, check({ fileName: '정리된 이름' }), DEFAULT_CHOICES);
    expect(req).toEqual({
      url: r.url,
      content: r.content,
      title: r.meta.title,
      channelName: '채널이름',
      channelId: 'ch1',
      qualityId: 'q720',
      qualityLabel: '720p',
      expectedKind: 'liveRewindHls',
      folder: null,
      fileName: '정리된 이름',
      onExisting: 'skip',
      restart: false,
      contentDate: '2026-10-03 21:00:00',
    });
  });

  it('contentDate: 방송 날짜 → 공개 날짜 → 없으면 보내지 않는다', () => {
    const a = resolved();
    expect(buildEnqueueRequest(a, q, null, check(), DEFAULT_CHOICES).contentDate).toBe('2026-10-03 21:00:00');
    a.meta.liveOpenDate = null;
    expect(buildEnqueueRequest(a, q, null, check(), DEFAULT_CHOICES).contentDate).toBe('2026-10-04 01:00:00');
    a.meta.publishDate = null;
    expect(buildEnqueueRequest(a, q, null, check(), DEFAULT_CHOICES).contentDate).toBeUndefined();
  });

  it('완성 파일: 번호(기본)는 freeFileName + skip, 덮어쓰기는 그 이름 + overwrite', () => {
    const c = check({ exists: true, freeFileName: '이름 (2)' });
    // 번호 붙인 새 이름은 검사 뒤에 생긴 같은 이름의 파일을 덮어쓰면 안 된다.
    expect(buildEnqueueRequest(r, q, '/v', c, DEFAULT_CHOICES)).toMatchObject({
      fileName: '이름 (2)',
      folder: '/v',
      onExisting: 'skip',
      restart: false,
    });
    expect(buildEnqueueRequest(r, q, '/v', c, { existing: 'overwrite', partialFresh: false })).toMatchObject({
      fileName: c.fileName,
      onExisting: 'overwrite',
      restart: false,
    });
  });

  it('덮어쓰기는 완성 파일이 있을 때 직접 고른 경우에만', () => {
    // 파일이 없으면 덮어쓰기 선택이 남아 있어도(이전 입력) skip이다.
    expect(buildEnqueueRequest(r, q, null, check(), { existing: 'overwrite', partialFresh: false }).onExisting).toBe('skip');
    // 같은 작업의 .part만 있을 때도 skip(이어받아 마무리할 때 그사이 생긴 파일을 덮어쓰지 않는다).
    const p = check({ partial: { bytes: 5, sameJob: true, recording: false } });
    expect(buildEnqueueRequest(r, q, null, p, DEFAULT_CHOICES).onExisting).toBe('skip');
  });

  it('같은 작업의 .part: 이어받기 false / 처음부터 true', () => {
    const c = check({ partial: { bytes: 1_288_490_188, sameJob: true, recording: false } });
    expect(buildEnqueueRequest(r, q, null, c, DEFAULT_CHOICES).restart).toBe(false);
    expect(buildEnqueueRequest(r, q, null, c, { existing: 'number', partialFresh: true }).restart).toBe(true);
  });

  it('다른 .part는 안내만: restart=false', () => {
    const c = check({ partial: { bytes: 10, sameJob: false, recording: false } });
    expect(buildEnqueueRequest(r, q, null, c, { existing: 'number', partialFresh: true }).restart).toBe(false);
  });

  it('번호 붙인 새 이름에는 .part 선택이 해당하지 않는다', () => {
    const c = check({ exists: true, freeFileName: '이름 (2)', partial: { bytes: 5, sameJob: true, recording: false } });
    expect(buildEnqueueRequest(r, q, null, c, { existing: 'number', partialFresh: true })).toMatchObject({
      fileName: '이름 (2)',
      restart: false,
    });
    expect(notices(c, DEFAULT_CHOICES)).toEqual({
      duplicate: false,
      exists: true,
      partialSame: null,
      partialOther: false,
      partialRecording: false,
    });
    // 덮어쓰기를 고르면 그 이름의 .part 안내가 다시 나온다
    expect(notices(c, { existing: 'overwrite', partialFresh: false }).partialSame).toBe(5);
  });
});

describe('받다 만 녹화 .part (core.md 61)', () => {
  const r = liveResolved();
  const q = r.qualities[0];
  const rec = (over = {}) =>
    check({
      exists: true,
      freeFileName: '이름 (2)',
      partial: { bytes: 5, sameJob: false, recording: true },
      ...over,
    });

  it('안내만 띄우고 같은 이름 파일·받다 만 안내는 숨긴다', () => {
    const n = notices(rec(), { existing: 'overwrite', partialFresh: true });
    expect(n).toEqual({
      duplicate: false,
      exists: false,
      partialSame: null,
      partialOther: false,
      partialRecording: true,
    });
    // 완성 파일이 없는 이름이어도 같다
    expect(notices(rec({ exists: false }), DEFAULT_CHOICES).partialRecording).toBe(true);
  });

  it('덮어쓰기를 골라 둬도 늘 번호 이름이고 restart는 false다', () => {
    for (const exists of [true, false]) {
      const c = rec({ exists });
      for (const existing of ['number', 'overwrite'] as const) {
        expect(usesFreeName(c, { existing, partialFresh: true })).toBe(true);
        expect(buildEnqueueRequest(r, q, null, c, { existing, partialFresh: true })).toMatchObject({
          fileName: '이름 (2)',
          restart: false,
          onExisting: 'skip',
        });
      }
    }
  });

  it('빈 번호 이름이 없으면 받을 수 없다', () => {
    const base = {
      fileName: 'a',
      checkedKey: checkKey(null, 'a', 'q'),
      currentKey: checkKey(null, 'a', 'q'),
      busy: false,
      ownership: 'unchecked' as const,
      choices: DEFAULT_CHOICES,
    };
    expect(canDownload({ ...base, check: rec({ exists: false }) })).toBe(true);
    expect(canDownload({ ...base, check: rec({ exists: false, freeFileName: null }) })).toBe(false);
  });
});

describe('canDownload', () => {
  const base = {
    fileName: 'a',
    check: check(),
    checkedKey: checkKey(null, 'a', 'q'),
    currentKey: checkKey(null, 'a', 'q'),
    busy: false,
    ownership: 'unchecked' as const,
    choices: DEFAULT_CHOICES,
  };

  it('지금 입력의 검사 결과가 있어야 한다', () => {
    expect(canDownload(base)).toBe(true);
    expect(canDownload({ ...base, checkedKey: checkKey(null, 'b', 'q') })).toBe(false);
    expect(canDownload({ ...base, check: null })).toBe(false);
    expect(canDownload({ ...base, fileName: '  ' })).toBe(false);
    expect(canDownload({ ...base, busy: true })).toBe(false);
  });

  it('목록 중복·빈 이름 없음·본인 영상 아님은 막는다', () => {
    expect(canDownload({ ...base, check: check({ duplicateJobId: 4 }) })).toBe(false);
    expect(canDownload({ ...base, check: check({ exists: true, freeFileName: null }) })).toBe(false);
    expect(
      canDownload({ ...base, check: check({ exists: true }), choices: { existing: 'overwrite', partialFresh: false } }),
    ).toBe(true);
    expect(canDownload({ ...base, ownership: 'notOwn' })).toBe(false);
    expect(canDownload({ ...base, ownership: 'unknown' })).toBe(false);
  });

  it('adminOverride는 받을 수 있고 중복은 여전히 막는다', () => {
    expect(canDownload({ ...base, ownership: 'adminOverride' })).toBe(true);
    expect(canDownload({ ...base, ownership: 'adminOverride', check: check({ duplicateJobId: 4 }) })).toBe(false);
  });
});

describe('shouldSuggestClipboard', () => {
  const link = 'https://chzzk.naver.com/video/1';
  const ok = { inputEmpty: true, idle: true, dismissed: new Set<string>() };
  it('입력이 비고 카드가 없을 때, 닫은 적 없는 주소만', () => {
    expect(shouldSuggestClipboard(link, ok)).toBe(true);
    expect(shouldSuggestClipboard(null, ok)).toBe(false);
    expect(shouldSuggestClipboard(link, { ...ok, inputEmpty: false })).toBe(false);
    expect(shouldSuggestClipboard(link, { ...ok, idle: false })).toBe(false);
    expect(shouldSuggestClipboard(link, { ...ok, dismissed: new Set([link]) })).toBe(false);
  });
});

describe('recentSecondLine', () => {
  it('종류와 날짜 / 종류만 / 종류 없음', () => {
    expect(recentSecondLine({ kind: 'rewind', date: '2026-10-03 21:00:00' })).toBe(
      t('recent.meta', { kind: t('kind.liveRewind'), date: '2026. 10. 3.' }),
    );
    expect(recentSecondLine({ kind: 'clip', date: null })).toBe(t('kind.clip'));
    // 모양이 다른 날짜는 날짜 없음과 같다
    expect(recentSecondLine({ kind: 'vod', date: '어제' })).toBe(t('kind.vod'));
    expect(recentSecondLine({ kind: null, date: '2026-10-03 21:00:00' })).toBeNull();
  });
});

describe('bestQualityIndex', () => {
  it('목록 순서가 아니라 해상도가 가장 높은 행, 같으면 대역폭', () => {
    const q = [
      quality({ id: 'a', resolution: 480 }),
      quality({ id: 'b', resolution: 1080, bandwidth: 5 }),
      quality({ id: 'c', resolution: 1080, bandwidth: 9 }),
      quality({ id: 'd', resolution: null, bandwidth: 99 }),
    ];
    expect(bestQualityIndex(q)).toBe(2);
  });

  it('고를 것이 하나뿐이면 꼬리표를 붙일 곳이 없다', () => {
    expect(bestQualityIndex([quality()])).toBeNull();
    expect(bestQualityIndex([])).toBeNull();
  });
});

describe('downloadBlock', () => {
  it('본인 영상이 아니거나 모르면 ownership, 목록에 있으면 duplicate, 먼저 맞는 쪽', () => {
    expect(downloadBlock('own', check())).toBeNull();
    expect(downloadBlock('unchecked', null)).toBeNull();
    expect(downloadBlock('notOwn', null)).toBe('ownership');
    expect(downloadBlock('unknown', check())).toBe('ownership');
    expect(downloadBlock('own', check({ duplicateJobId: 3 }))).toBe('duplicate');
    expect(downloadBlock('notOwn', check({ duplicateJobId: 3 }))).toBe('ownership');
    expect(BLOCK_REASON_ID.duplicate).not.toBe(BLOCK_REASON_ID.ownership);
  });

  it('adminOverride는 소유권으로 막지 않지만 중복은 관리자도 막는다', () => {
    expect(downloadBlock('adminOverride', null)).toBeNull();
    expect(downloadBlock('adminOverride', check())).toBeNull();
    expect(downloadBlock('adminOverride', check({ duplicateJobId: 3 }))).toBe('duplicate');
  });
});

describe('상수', () => {
  it('check_output 디바운스는 150ms', () => {
    expect(CHECK_DEBOUNCE_MS).toBe(150);
  });
});

describe('구간 받기 순수 함수(range.md §5)', () => {
  const D = 11565; // 3:12:45
  const open = (start: string, end: string) => ({ open: true, start, end });

  describe('rangeError', () => {
    it('접혀 있으면 검증하지 않는다', () => {
      expect(rangeError({ open: false, start: 'abc', end: 'x' }, D)).toBeNull();
    });
    it('시작이 틀리거나 비면 start/format', () => {
      expect(rangeError(open('abc', ''), D)).toEqual({ field: 'start', kind: 'format' });
      expect(rangeError(open('', ''), D)).toEqual({ field: 'start', kind: 'format' });
    });
    it('끝이 틀리면 end/format, 둘 다 틀리면 앞 칸 먼저', () => {
      expect(rangeError(open('0:00:00', 'x'), D)).toEqual({ field: 'end', kind: 'format' });
      expect(rangeError(open('abc', 'x'), D)).toEqual({ field: 'start', kind: 'format' });
    });
    it('시작이 길이 이상이면 start/beyond, 올림 길이 안이면 통과', () => {
      expect(rangeError(open('3:12:44', ''), D)).toBeNull();
      expect(rangeError(open('3:12:45', ''), D)).toEqual({ field: 'start', kind: 'beyond' });
      expect(rangeError(open('3:12:45', ''), 11565.4)).toBeNull();
      expect(rangeError(open('3:12:46', ''), 11565.4)).toEqual({ field: 'start', kind: 'beyond' });
    });
    it('끝이 시작보다 앞이거나 같으면 end/order', () => {
      expect(rangeError(open('0:30:00', '0:20:00'), D)).toEqual({ field: 'end', kind: 'order' });
      expect(rangeError(open('0:10:00', '0:10:00'), D)).toEqual({ field: 'end', kind: 'order' });
    });
    it('끝이 길이를 넘는 것은 오류가 아니다', () => {
      expect(rangeError(open('0:10:00', '9:00:00'), D)).toBeNull();
    });
    it('길이를 모르면 길이 비교를 하지 않는다', () => {
      expect(rangeError(open('9:00:00', ''), null)).toBeNull();
    });
  });

  describe('effectiveRange', () => {
    it('접힘·오류·초깃값(전체)은 null', () => {
      expect(effectiveRange({ open: false, start: '0:10:00', end: '0:20:00' }, D)).toBeNull();
      expect(effectiveRange(open('0:30:00', '0:20:00'), D)).toBeNull();
      expect(effectiveRange(open('abc', ''), D)).toBeNull();
      expect(effectiveRange(open(formatClock(0), formatClock(D)), D)).toBeNull();
    });
    it('내림 길이 이상이면 끝까지(11565.4 초깃값 = 전체)', () => {
      expect(effectiveRange(open('0:00:00', formatClock(11565.4)), 11565.4)).toBeNull();
    });
    it('구간은 ms, 표기가 달라도 같은 값', () => {
      expect(effectiveRange(open('0:10:00', '0:20:00'), D)).toEqual({ startMs: 600000, endMs: 1200000 });
      expect(effectiveRange(open('10:00', '20:00'), D)).toEqual({ startMs: 600000, endMs: 1200000 });
    });
    it('끝이 길이를 넘으면 올림 길이로 자른다', () => {
      expect(effectiveRange(open('0:10:00', '9:00:00'), 11565.4)).toEqual({ startMs: 600000, endMs: 11566000 });
    });
    it('끝 칸이 비면 올림 길이까지(시작 0이면 전체)', () => {
      expect(effectiveRange(open('0:10:00', ''), 11565.4)).toEqual({ startMs: 600000, endMs: 11566000 });
      expect(effectiveRange(open('0:00:00', ''), D)).toBeNull();
    });
    it('길이를 모르면 끝 없음(null)을 그대로 둔다', () => {
      expect(effectiveRange(open('0:10:00', ''), null)).toEqual({ startMs: 600000, endMs: null });
      expect(effectiveRange(open('0:00:00', ''), null)).toBeNull();
      expect(effectiveRange(open('0:00:00', '0:20:00'), null)).toEqual({ startMs: 0, endMs: 1200000 });
    });
    it('결과는 늘 1000의 배수', () => {
      const r = effectiveRange(open('0:10:01', '0:20:59'), 11565.4);
      expect(r!.startMs % 1000).toBe(0);
      expect(r!.endMs! % 1000).toBe(0);
    });
  });

  it('rangeSecs: 없으면 영상 길이, 끝 없음이면 null', () => {
    expect(rangeSecs(null, D)).toBe(D);
    expect(rangeSecs({ startMs: 600000, endMs: 1200000 }, D)).toBe(600);
    expect(rangeSecs({ startMs: 600000, endMs: null }, D)).toBeNull();
  });

  it('rangeChip', () => {
    expect(rangeChip({ startMs: 600000, endMs: 1200000 })).toBe(t('range.chip', { start: '0:10:00', end: '0:20:00' }));
    expect(rangeChip({ startMs: 600000, endMs: null })).toBe(t('range.chipToEnd', { start: '0:10:00' }));
  });

  it('형식 오류 예시는 0:10:00', () => {
    expect(formatClock(RANGE_FORMAT_EXAMPLE_SECS)).toBe('0:10:00');
  });

  it('checkKey: 구간이 열쇠에 들어간다', () => {
    expect(checkKey(null, 'a', 'q')).toBe(checkKey(null, 'a', 'q', null));
    const r1 = effectiveRange(open('0:10:00', '0:20:00'), D);
    const r2 = effectiveRange(open('10:00', '20:00'), D);
    const r3 = effectiveRange(open('0:10:00', '0:30:00'), D);
    expect(checkKey(null, 'a', 'q', r1)).toBe(checkKey(null, 'a', 'q', r2));
    expect(checkKey(null, 'a', 'q', r1)).not.toBe(checkKey(null, 'a', 'q', r3));
    expect(checkKey(null, 'a', 'q', r1)).not.toBe(checkKey(null, 'a', 'q'));
    for (const inp of [
      { open: false, start: '0:10:00', end: '0:20:00' },
      open('abc', ''),
      open(formatClock(0), formatClock(D)),
    ]) {
      expect(checkKey(null, 'a', 'q', effectiveRange(inp, D))).toBe(checkKey(null, 'a', 'q', null));
    }
  });

  it('buildEnqueueRequest: range가 있을 때만 키가 있다', () => {
    const r = resolved();
    const q = r.qualities[1];
    const range = { startMs: 600000, endMs: 1200000 };
    expect(buildEnqueueRequest(r, q, null, check(), DEFAULT_CHOICES, range).range).toEqual(range);
    expect('range' in buildEnqueueRequest(r, q, null, check(), DEFAULT_CHOICES, null)).toBe(false);
    expect('range' in buildEnqueueRequest(r, q, null, check(), DEFAULT_CHOICES)).toBe(false);
  });
});
