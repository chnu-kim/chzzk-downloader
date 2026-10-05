import { describe, expect, it } from 'vitest';
import type { JobDto, ProgressDto } from '../bindings';
import { applyEvent, emptyJobs, fromSnapshot } from './jobs.apply';

function progress(bytes: number): ProgressDto {
  return {
    phase: 'downloading',
    bytes,
    totalBytes: 1000,
    totalBytesEstimate: null,
    segmentsDone: null,
    segmentsTotal: null,
    mediaSecsDone: null,
    mediaSecsTotal: null,
    speedBps: 10,
    etaSecs: 5,
    resumedFrom: 0,
    refreshes: 0,
  };
}

function job(id: number, over: Partial<JobDto> = {}): JobDto {
  return {
    id,
    url: `https://chzzk.naver.com/video/${id}`,
    title: `영상 ${id}`,
    channelName: '채널',
    kind: 'video',
    playbackKind: 'progressive',
    qualityLabel: '1080p',
    output: `/v/${id}.mp4`,
    status: 'queued',
    progress: null,
    error: null,
    partialBytes: null,
    finalBytes: null,
    missing: false,
    createdAt: 1,
    finishedAt: null,
    ...over,
  };
}

describe('applyEvent', () => {
  it('added → progress → status(completed) → removed', () => {
    let s = emptyJobs();
    s = applyEvent(s, { type: 'added', job: job(1) });
    expect(s.jobs.get(1)?.status).toBe('queued');
    expect(s.progress.has(1)).toBe(false);

    s = applyEvent(s, { type: 'status', job: job(1, { status: 'running' }) });
    s = applyEvent(s, { type: 'progress', id: 1, progress: progress(10) });
    s = applyEvent(s, { type: 'progress', id: 1, progress: progress(20) });
    expect(s.progress.get(1)?.bytes).toBe(20);
    expect(s.jobs.get(1)?.status).toBe('running');

    s = applyEvent(s, { type: 'status', job: job(1, { status: 'completed', finalBytes: 1000 }) });
    expect(s.jobs.get(1)?.finalBytes).toBe(1000);
    // 레코드에 진행률이 없으면 지난 진행률을 남기지 않는다.
    expect(s.progress.has(1)).toBe(false);

    s = applyEvent(s, { type: 'removed', id: 1 });
    expect(s.jobs.size).toBe(0);
    expect(s.progress.size).toBe(0);
  });

  it('status 레코드의 progress를 진행률로 쓴다(일시정지 막대)', () => {
    let s = fromSnapshot([job(2, { status: 'running' })]);
    s = applyEvent(s, { type: 'status', job: job(2, { status: 'paused', progress: progress(400), partialBytes: 400 }) });
    expect(s.progress.get(2)?.bytes).toBe(400);
  });

  it('모르는 id의 progress·removed는 버리고 같은 객체를 돌려준다', () => {
    const s = fromSnapshot([job(1)]);
    expect(applyEvent(s, { type: 'progress', id: 9, progress: progress(1) })).toBe(s);
    expect(applyEvent(s, { type: 'removed', id: 9 })).toBe(s);
  });

  it('이전 상태를 고치지 않는다', () => {
    const s0 = fromSnapshot([job(1, { status: 'running', progress: progress(5) })]);
    const s1 = applyEvent(s0, { type: 'progress', id: 1, progress: progress(6) });
    expect(s0.progress.get(1)?.bytes).toBe(5);
    expect(s1.progress.get(1)?.bytes).toBe(6);
    const s2 = applyEvent(s1, { type: 'removed', id: 1 });
    expect(s1.jobs.has(1)).toBe(true);
    expect(s2.jobs.has(1)).toBe(false);
  });

  it('스냅샷은 전부 바꾸고 레코드의 진행률을 채운다', () => {
    const s = fromSnapshot([job(1, { status: 'running', progress: progress(3) }), job(2)]);
    expect([...s.jobs.keys()]).toEqual([1, 2]);
    expect(s.progress.get(1)?.bytes).toBe(3);
    expect(s.progress.has(2)).toBe(false);
  });
});
