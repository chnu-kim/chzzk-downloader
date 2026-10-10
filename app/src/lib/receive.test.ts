import { describe, expect, it } from 'vitest';
import { check, quality, resolved } from '../test/fixtures';
import { t } from './copy/ko';
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
  shouldSuggestClipboard,
} from './receive';

describe('표시', () => {
  it('종류 라벨', () => {
    expect(kindTone('clip', 'progressive')).toBe('clip');
    expect(kindTone('video', 'liveRewindHls')).toBe('rewind');
    expect(kindTone('video', 'progressive')).toBe('vod');
  });

  it('메타 줄: 방송 날짜가 있으면 방송, 없으면 업로드, 길이 H:MM:SS', () => {
    expect(metaParts(resolved())).toEqual(['채널이름', '2026.10.03 21:00 방송', '3:12:45']);
    const r = resolved();
    r.meta.liveOpenDate = null;
    r.meta.durationSecs = null;
    expect(metaParts(r)).toEqual(['채널이름', '2026.10.04 업로드']);
    r.meta.publishDate = null;
    expect(metaParts(r)).toEqual(['채널이름']);
  });

  it('화질 fps·예상 크기', () => {
    expect(qualityFps(quality())).toBe('60fps');
    expect(qualityFps(quality({ frameRate: null }))).toBeNull();
    // 8 Mbps × 3600초 / 8 = 3.6e9 B
    expect(qualitySize(quality(), 3600)).toBe('약 3.4 GB');
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
    const p = check({ partial: { bytes: 5, sameJob: true } });
    expect(buildEnqueueRequest(r, q, null, p, DEFAULT_CHOICES).onExisting).toBe('skip');
  });

  it('같은 작업의 .part: 이어받기 false / 처음부터 true', () => {
    const c = check({ partial: { bytes: 1_288_490_188, sameJob: true } });
    expect(buildEnqueueRequest(r, q, null, c, DEFAULT_CHOICES).restart).toBe(false);
    expect(buildEnqueueRequest(r, q, null, c, { existing: 'number', partialFresh: true }).restart).toBe(true);
  });

  it('다른 .part는 안내만: restart=false', () => {
    const c = check({ partial: { bytes: 10, sameJob: false } });
    expect(buildEnqueueRequest(r, q, null, c, { existing: 'number', partialFresh: true }).restart).toBe(false);
  });

  it('번호 붙인 새 이름에는 .part 선택이 해당하지 않는다', () => {
    const c = check({ exists: true, freeFileName: '이름 (2)', partial: { bytes: 5, sameJob: true } });
    expect(buildEnqueueRequest(r, q, null, c, { existing: 'number', partialFresh: true })).toMatchObject({
      fileName: '이름 (2)',
      restart: false,
    });
    expect(notices(c, DEFAULT_CHOICES)).toEqual({ duplicate: false, exists: true, partialSame: null, partialOther: false });
    // 덮어쓰기를 고르면 그 이름의 .part 안내가 다시 나온다
    expect(notices(c, { existing: 'overwrite', partialFresh: false }).partialSame).toBe(5);
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
      t('recent.meta', { kind: t('kind.liveRewind'), date: '2026.10.03' }),
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
});

describe('상수', () => {
  it('check_output 디바운스는 150ms', () => {
    expect(CHECK_DEBOUNCE_MS).toBe(150);
  });
});
