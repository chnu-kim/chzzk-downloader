import { describe, expect, it } from 'vitest';
import type { JobDto, JobStatus } from './bindings';
import { t } from './copy/ko';
import { err, hlsProg, job, prog, signedInAs } from '../test/jobFixtures';
import {
  CANCEL_CONFIRM_BYTES,
  RESUMED_NOTE_MS,
  barView,
  blockCopyKey,
  deleteAction,
  enterAction,
  groupJobs,
  jobBlock,
  jobButtons,
  needsCancelConfirm,
  nextQueueOrder,
  queueAhead,
  receivedBytes,
  resumableInterrupted,
  spaceAction,
  statusParts,
  transitionAnnouncement,
  visibleOrder,
} from './jobs';

function line(j: JobDto, p = j.progress, ctx = {}): string {
  return statusParts(j, p, ctx)
    .map((x, i) => (i > 0 && !x.faint ? ' · ' : x.faint ? ' ' : '') + x.text)
    .join('');
}

describe('jobButtons: 상태별 버튼 표(ui-visual §6.5)', () => {
  const MiB = 1024 * 1024;
  const table: [string, JobDto, { primary: string[]; cancel: boolean; menu: string[] }][] = [
    ['대기', job(1), { primary: [], cancel: true, menu: ['copyUrl'] }],
    [
      '준비 중(진행률 없음)',
      job(1, { status: 'running' }),
      { primary: [], cancel: true, menu: ['copyUrl'] },
    ],
    [
      '준비 중(resolving)',
      job(1, { status: 'running', progress: prog({ phase: 'resolving' }) }),
      { primary: [], cancel: true, menu: ['copyUrl'] },
    ],
    [
      '받는 중',
      job(1, { status: 'running', progress: prog() }),
      { primary: ['pause'], cancel: true, menu: ['copyUrl'] },
    ],
    [
      '링크 갱신',
      job(1, { status: 'running', progress: prog({ phase: 'reresolving' }) }),
      { primary: ['pause'], cancel: true, menu: ['copyUrl'] },
    ],
    [
      '마무리 중',
      job(1, { status: 'running', progress: prog({ phase: 'finalizing' }) }),
      { primary: [], cancel: false, menu: ['copyUrl'] },
    ],
    ['멈추는 중', job(1, { status: 'pausing', progress: prog() }), { primary: [], cancel: false, menu: ['copyUrl'] }],
    [
      '일시정지(.part 있음)',
      job(1, { status: 'paused', partialBytes: 5 * MiB }),
      { primary: ['resume'], cancel: true, menu: ['copyUrl', 'restartFresh'] },
    ],
    ['일시정지(.part 없음)', job(1, { status: 'paused' }), { primary: ['resume'], cancel: true, menu: ['copyUrl'] }],
    [
      '중단',
      job(1, { status: 'interrupted', partialBytes: 5 * MiB }),
      { primary: ['resume'], cancel: true, menu: ['copyUrl', 'restartFresh'] },
    ],
    [
      '실패: 디스크 부족(.part 있음)',
      job(1, { status: 'failed', partialBytes: 5 * MiB, error: err('diskFull', { payload: { type: 'path', path: '/v' } }) }),
      { primary: ['resume', 'openFolder'], cancel: false, menu: ['copyUrl', 'restartFresh', 'copyReport', 'remove'] },
    ],
    [
      '실패: 원본 바뀜(.part 없음)',
      job(1, { status: 'failed', error: err('sourceChanged') }),
      { primary: ['restartFresh'], cancel: false, menu: ['copyUrl', 'copyReport', 'remove'] },
    ],
    [
      '실패: 네트워크(.part 없음) → 다시 시도',
      job(1, { status: 'failed', error: err('network', { resumable: true }) }),
      { primary: ['retry'], cancel: false, menu: ['copyUrl', 'copyReport', 'remove'] },
    ],
    [
      '실패: 화질 없음 → 다시 불러오기',
      job(1, { status: 'failed', error: err('qualityNotFound') }),
      { primary: ['reresolve', 'remove'], cancel: false, menu: ['copyUrl', 'copyReport'] },
    ],
    [
      '실패: 지원하지 않음 → 보고 복사가 기본',
      job(1, { status: 'failed', error: err('unsupported') }),
      { primary: ['copyReport', 'remove'], cancel: false, menu: ['copyUrl'] },
    ],
    [
      '완료',
      job(1, { status: 'completed', finalBytes: 10 }),
      { primary: ['openFile', 'openFolder'], cancel: false, menu: ['copyUrl', 'remove'] },
    ],
    [
      '완료(파일 없음)',
      job(1, { status: 'completed', missing: true }),
      { primary: ['openFolder'], cancel: false, menu: ['copyUrl', 'remove'] },
    ],
    [
      '건너뜀',
      job(1, { status: 'skipped' }),
      { primary: ['openFile', 'overwrite'], cancel: false, menu: ['copyUrl', 'remove'] },
    ],
  ];
  it.each(table)('%s', (_, j, want) => {
    expect(jobButtons(j, j.progress)).toEqual(want);
  });

  it('authRequired(쿠키 켜짐)은 로그인 정보 다시 넣기가 먼저', () => {
    const j = job(1, { status: 'failed', partialBytes: 9, error: err('authRequired', { stage: 'resolve' }) });
    expect(jobButtons(j, null, true).primary).toEqual(['reenterCookies', 'resume']);
    expect(jobButtons(j, null, false).primary).toEqual(['openCookieSettings', 'resume']);
  });

  it('모든 상태에 주소 복사가 있다', () => {
    const all: JobStatus[] = ['queued', 'running', 'pausing', 'paused', 'interrupted', 'completed', 'skipped', 'failed'];
    for (const status of all) {
      const j = job(1, { status, error: status === 'failed' ? err('network') : null });
      const b = jobButtons(j, null);
      expect([...b.primary, ...b.menu]).toContain('copyUrl');
    }
  });
});

describe('groupJobs: 정렬·그룹(§8.5)', () => {
  it('진행 중 → 대기 → 멈춤 → 완료, 같은 그룹은 최신이 위, 빈 그룹은 뺀다', () => {
    const list = [
      job(1, { status: 'completed', createdAt: 10 }),
      job(2, { status: 'running', createdAt: 20 }),
      job(3, { status: 'failed', createdAt: 30 }),
      job(4, { status: 'pausing', createdAt: 40 }),
      job(5, { status: 'skipped', createdAt: 50 }),
      job(6, { status: 'interrupted', createdAt: 5 }),
      job(7, { status: 'paused', createdAt: 30 }),
    ];
    const groups = groupJobs(list);
    expect(groups.map((g) => [g.id, g.label])).toEqual([
      ['running', '받는 중 2'],
      ['stopped', '멈춤 3'],
      ['finished', '완료 2'],
    ]);
    expect(visibleOrder(groups)).toEqual([4, 2, 7, 3, 6, 5, 1]);
  });
});

describe('대기 순서', () => {
  it('스냅샷은 id 순, 다시 줄 선 작업은 맨 뒤', () => {
    const m = (list: JobDto[]) => new Map(list.map((j) => [j.id, j]));
    let order = nextQueueOrder([], m([job(3), job(1), job(2, { status: 'paused' })]));
    expect(order).toEqual([1, 3]);
    // 2가 다시 줄 서고 1이 시작했다
    order = nextQueueOrder(order, m([job(3), job(1, { status: 'running' }), job(2)]));
    expect(order).toEqual([3, 2]);
    expect(queueAhead(order, 2)).toBe(1);
    expect(queueAhead(order, 3)).toBe(0);
    expect(queueAhead(order, 9)).toBe(0);
    // 바뀌지 않으면 같은 배열
    expect(nextQueueOrder(order, m([job(3), job(2)]))).toBe(order);
  });
});

describe('상태 줄(§8.11)', () => {
  it('progressive 받는 중', () => {
    const j = job(1, { status: 'running', progress: prog() });
    expect(line(j)).toBe('받는 중 · 2.3 GB / 4.0 GB · 12.4 MB/s · 2분 18초 남음');
  });

  it('HLS 받는 중: 예상 총량과 조각(좁은 폭에서 숨김 표시)', () => {
    const j = job(1, { status: 'running', playbackKind: 'liveRewindHls', progress: hlsProg() });
    expect(line(j)).toBe('받는 중 · 1.2 GB / 약 5.1 GB · 조각 1,210/5,580 · 8.1 MB/s · 14분 남음');
    expect(statusParts(j, j.progress).find((p) => p.text.startsWith('조각'))?.wideOnly).toBe(true);
  });

  it('남은 시간을 모르면 계산 중, 속도가 없으면 뺀다', () => {
    const j = job(1, { status: 'running', progress: prog({ etaSecs: null, speedBps: null }) });
    expect(line(j)).toBe('받는 중 · 2.3 GB / 4.0 GB · 남은 시간 계산 중');
  });

  it('이어받음은 처음 10초만', () => {
    const p = prog({ resumedFrom: 1_181_116_006 });
    const j = job(1, { status: 'running', progress: p });
    expect(line(j, p, { runStartedAt: 1000, now: 1000 + RESUMED_NOTE_MS - 1 })).toBe(
      '받는 중 · 2.3 GB / 4.0 GB (1.1 GB부터 이어받음) · 12.4 MB/s · 2분 18초 남음',
    );
    expect(line(j, p, { runStartedAt: 1000, now: 1000 + RESUMED_NOTE_MS })).not.toContain('이어받음');
  });

  it('단계별 문구', () => {
    expect(line(job(1, { status: 'running' }))).toBe('준비 중');
    expect(line(job(1, { status: 'running', progress: prog({ phase: 'reresolving' }) }))).toBe(
      '영상 링크를 새로 받는 중이에요 · 2.3 GB / 4.0 GB',
    );
    expect(line(job(1, { status: 'running', progress: prog({ phase: 'finalizing' }) }))).toBe('마무리 중');
    expect(line(job(1, { status: 'pausing' }))).toBe('멈추는 중…');
  });

  it('대기·멈춤·완료·건너뜀', () => {
    expect(line(job(1), null, { ahead: 2 })).toBe('대기 중 · 앞에 2개');
    expect(line(job(1), null, { ahead: 0 })).toBe('대기 중 · 곧 시작해요');
    expect(line(job(1, { status: 'paused', partialBytes: 1_717_986_918 }))).toBe('일시정지됨 · 1.6 GB 받음');
    expect(line(job(1, { status: 'interrupted', partialBytes: 1_717_986_918 }))).toBe('중단됨 · 1.6 GB 받음');
    expect(line(job(1, { status: 'paused' }))).toBe('일시정지됨');
    expect(line(job(1, { status: 'interrupted' }))).toBe('중단됨');
    expect(
      line(job(1, { status: 'completed', finalBytes: 4_294_967_296, finishedAt: 1_759_668_060 }), null, {
        timeZone: 'Asia/Seoul',
      }),
    ).toBe('완료 · 4.0 GB · 오후 9:41');
    expect(line(job(1, { status: 'completed', missing: true }))).toBe('완료 · 파일을 찾을 수 없어요');
    expect(line(job(1, { status: 'skipped' }))).toBe('이미 같은 이름의 파일이 있어 받지 않았어요');
    // 받는 동안 같은 이름의 파일이 생겨 덮어쓰지 않았다(받은 .part가 남음)
    expect(line(job(1, { status: 'skipped', partialBytes: 1024 }))).toBe('받는 동안 같은 이름의 파일이 생겨 저장하지 않았어요');
    expect(statusParts(job(1, { status: 'failed', error: err('network') }), null)).toEqual([]);
  });
});

describe('진행 막대', () => {
  it('progressive는 바이트, HLS는 재생 시간 비율', () => {
    const a = job(1, { status: 'running', progress: prog() });
    expect(barView(a, a.progress)).toMatchObject({ percent: '57%', tone: 'accent', striped: false });
    expect(barView(a, a.progress)?.valueText).toBe('57퍼센트, 2분 18초 남음');
    const h = job(2, { status: 'running', playbackKind: 'liveRewindHls', progress: hlsProg() });
    expect(barView(h, h.progress)?.percent).toBe('21%');
  });

  it('총량을 모르면 indeterminate(값·퍼센트 없음), 준비 중도', () => {
    const p = prog({ totalBytes: null });
    expect(barView(job(1, { status: 'running' }), p)).toMatchObject({ value: null, percent: null });
    expect(barView(job(1, { status: 'running' }), null)).toMatchObject({ value: null, valueText: '준비 중' });
  });

  it('링크 갱신은 줄무늬, 멈춤은 회색, 실패(.part 있음)는 빨강', () => {
    expect(barView(job(1, { status: 'running' }), prog({ phase: 'reresolving' }))?.striped).toBe(true);
    expect(barView(job(1, { status: 'paused' }), prog())?.tone).toBe('muted');
    expect(barView(job(1, { status: 'failed', partialBytes: 5 }), prog())?.tone).toBe('danger');
  });

  it('대기·완료·건너뜀, 진행률 없는 멈춤, .part 없는 실패에는 막대가 없다', () => {
    for (const j of [
      job(1),
      job(1, { status: 'completed' }),
      job(1, { status: 'skipped' }),
      job(1, { status: 'paused' }),
      job(1, { status: 'failed' }),
    ]) {
      expect(barView(j, j.progress)).toBeNull();
    }
    expect(barView(job(1, { status: 'failed' }), prog())).toBeNull();
  });
});

describe('취소 확인(D2): 512 MiB 초과일 때만', () => {
  it('경계', () => {
    const at = job(1, { status: 'paused', partialBytes: CANCEL_CONFIRM_BYTES });
    const over = job(1, { status: 'paused', partialBytes: CANCEL_CONFIRM_BYTES + 1 });
    expect(needsCancelConfirm(at, null)).toBe(false);
    expect(needsCancelConfirm(over, null)).toBe(true);
  });

  it('받는 중은 진행률 바이트, 멈춘 작업·실패는 .part 크기, 대기·완료는 묻지 않는다', () => {
    const big = prog({ bytes: CANCEL_CONFIRM_BYTES + 1 });
    expect(receivedBytes(job(1, { status: 'running' }), big)).toBe(CANCEL_CONFIRM_BYTES + 1);
    expect(needsCancelConfirm(job(1, { status: 'running' }), big)).toBe(true);
    expect(needsCancelConfirm(job(1, { status: 'running' }), prog({ bytes: 0 }))).toBe(false);
    expect(needsCancelConfirm(job(1, { status: 'failed', partialBytes: CANCEL_CONFIRM_BYTES * 2 }), null)).toBe(true);
    expect(needsCancelConfirm(job(1, { status: 'queued', partialBytes: CANCEL_CONFIRM_BYTES * 2 }), null)).toBe(false);
    expect(needsCancelConfirm(job(1, { status: 'completed', finalBytes: CANCEL_CONFIRM_BYTES * 2 }), null)).toBe(false);
    // 받는 동안 같은 이름의 파일이 생겨 건너뛴 작업: 지우면 다 받은 .part도 지워지므로 묻는다
    expect(needsCancelConfirm(job(1, { status: 'skipped', partialBytes: CANCEL_CONFIRM_BYTES * 2 }), null)).toBe(true);
    expect(needsCancelConfirm(job(1, { status: 'skipped' }), null)).toBe(false);
  });
});

describe('키보드 동작(§10)', () => {
  it('Space·Enter·Delete', () => {
    const run = job(1, { status: 'running', progress: prog() });
    const b = jobButtons(run, run.progress);
    expect(spaceAction(b)).toBe('pause');
    expect(enterAction(run, b)).toBe('pause');
    expect(deleteAction(run, b)).toBe('cancel');

    const paused = job(1, { status: 'paused' });
    expect(spaceAction(jobButtons(paused, null))).toBe('resume');

    const done = job(1, { status: 'completed' });
    const db = jobButtons(done, null);
    expect(spaceAction(db)).toBeNull();
    expect(enterAction(done, db)).toBe('openFile');
    expect(deleteAction(done, db)).toBe('remove');

    const fin = job(1, { status: 'running', progress: prog({ phase: 'finalizing' }) });
    expect(deleteAction(fin, jobButtons(fin, fin.progress))).toBeNull();
    const pausing = job(1, { status: 'pausing' });
    expect(deleteAction(pausing, jobButtons(pausing, null))).toBeNull();
  });
});

describe('상태 전이 읽어 주기', () => {
  it('실패·멈춤은 읽고, 같은 상태·완료·대기는 읽지 않는다', () => {
    const a = job(1, { status: 'running', progress: prog() });
    expect(transitionAnnouncement(a, { ...a, status: 'failed', error: err('network') })).toBe(
      "'영상 1' 다운로드에 실패했어요",
    );
    expect(transitionAnnouncement(a, { ...a, status: 'paused' })).toBe('영상 1: 일시정지됨');
    expect(transitionAnnouncement(a, a)).toBeNull();
    expect(transitionAnnouncement(a, { ...a, status: 'completed' })).toBeNull();
    expect(transitionAnnouncement(undefined, job(2))).toBeNull();
  });
});

describe('막힌 작업(A5)', () => {
  const A1 = '000000000000000000000000000000a1';
  const C3 = '000000000000000000000000000000c3';
  const me = signedInAs(A1);

  it('jobBlock 표', () => {
    // 비교 대상이 없으면 막지 않는다
    const stopped = job(1, { status: 'interrupted', channelId: C3 });
    expect(jobBlock(stopped, null)).toBeNull();
    expect(jobBlock(stopped, { ...me, state: 'disabled' })).toBeNull();
    expect(jobBlock(stopped, { ...me, state: 'signedOut' })).toBeNull();
    expect(jobBlock(stopped, signedInAs(null))).toBeNull();
    // 진행 중·대기·완료는 막지 않는다
    for (const status of ['running', 'queued', 'pausing', 'completed'] as const) {
      expect(jobBlock(job(1, { status, channelId: C3 }), me)).toBeNull();
    }
    // 멈춘 작업: 같은 채널(대소문자 무시)은 열려 있다
    for (const status of ['interrupted', 'paused', 'failed', 'skipped'] as const) {
      expect(jobBlock(job(1, { status, channelId: A1.toUpperCase() }), me)).toBeNull();
      expect(jobBlock(job(1, { status, channelId: C3 }), me)).toBe('otherChannel');
      expect(jobBlock(job(1, { status, channelId: null }), me)).toBe('ownerUnknown');
    }
  });

  it('resumableInterrupted는 막힌 작업을 빼고 id 오름차순', () => {
    const list = [
      job(4, { status: 'interrupted', channelId: A1 }),
      job(2, { status: 'interrupted', channelId: C3 }),
      job(1, { status: 'interrupted', channelId: A1 }),
      job(3, { status: 'paused', channelId: A1 }),
    ];
    expect(resumableInterrupted(list, me)).toEqual([1, 4]);
    expect(resumableInterrupted(list, null)).toEqual([1, 2, 4]);
  });

  it('막힌 작업 버튼', () => {
    const interrupted = job(1, { status: 'interrupted', channelId: C3, partialBytes: 5 });
    expect(jobButtons(interrupted, null, false, 'otherChannel')).toEqual({
      primary: [],
      cancel: true,
      menu: ['copyUrl'],
    });
    const skipped = job(2, { status: 'skipped', channelId: C3 });
    expect(jobButtons(skipped, null, false, 'otherChannel').primary).toEqual(['openFile']);
    const failed = job(3, { status: 'failed', partialBytes: 9, error: err('network') });
    const b = jobButtons(failed, null, false, 'ownerUnknown');
    expect(b.primary).not.toContain('resume');
    expect(b.primary).not.toContain('retry');
    expect(b.menu).not.toContain('restartFresh');
    // 막지 않으면 전과 같다
    expect(jobButtons(interrupted, null).primary).toEqual(['resume']);
  });

  it('copy deck 키', () => {
    expect(blockCopyKey('otherChannel')).toBe('job.otherChannel');
    expect(t('job.otherChannel')).toBe('다른 채널로 로그인해 이어받을 수 없어요');
    expect(t('job.ownerUnknown')).toBe('영상의 채널을 확인하지 못해 이어받을 수 없어요');
  });
});
