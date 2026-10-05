import { describe, expect, it } from 'vitest';
import { check, quality, resolved } from '../test/fixtures';
import {
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

  it('충돌이 없으면 검사한 이름 그대로, restart=false, overwrite', () => {
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
      onExisting: 'overwrite',
      restart: false,
    });
  });

  it('완성 파일: 번호(기본)는 freeFileName, 덮어쓰기는 그 이름', () => {
    const c = check({ exists: true, freeFileName: '이름 (2)' });
    expect(buildEnqueueRequest(r, q, '/v', c, DEFAULT_CHOICES)).toMatchObject({
      fileName: '이름 (2)',
      folder: '/v',
      onExisting: 'overwrite',
      restart: false,
    });
    expect(buildEnqueueRequest(r, q, '/v', c, { existing: 'overwrite', partialFresh: false })).toMatchObject({
      fileName: c.fileName,
      onExisting: 'overwrite',
      restart: false,
    });
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
