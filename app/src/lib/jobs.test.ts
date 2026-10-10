import { describe, expect, it } from 'vitest';
import type { JobDto, JobStatus } from './bindings';
import { t } from './copy/ko';
import { COMPLETED_FOLD_AT } from './timing';
import { ICONS } from './components/ui/icons';
import { err, hlsProg, job, prog, signedInAs } from '../test/jobFixtures';
import {
  FOLD_PREVIEW_COUNT,
  RESUMED_NOTE_MS,
  barView,
  blockCopyKey,
  bodyKey,
  cancelLabel,
  deleteAction,
  displayPercent,
  jobActionIcon,
  jobActionLabel,
  enterAction,
  groupJobs,
  isClearable,
  jobBlock,
  jobButtons,
  needsCancelConfirm,
  nextQueueOrder,
  outputFileName,
  queueAhead,
  receivedBytes,
  removeRoute,
  resumableInterrupted,
  shownJobs,
  spaceAction,
  statusLine,
  statusParts,
  statusWord,
  transitionAnnouncement,
  visibleOrder,
} from './jobs';

function line(j: JobDto, p = j.progress, ctx = {}): string {
  return statusLine(statusParts(j, p, ctx));
}

describe('jobButtons: 상태별 버튼 표(patterns.md §2·§14.3)', () => {
  const MiB = 1024 * 1024;
  const table: [string, JobDto, { primary: string[]; cancel: boolean; menu: string[] }][] = [
    ['대기', job(1), { primary: [], cancel: true, menu: ['showTitle', 'copyUrl'] }],
    [
      '준비 중(진행률 없음)',
      job(1, { status: 'running' }),
      { primary: [], cancel: true, menu: ['showTitle', 'copyUrl'] },
    ],
    [
      '준비 중(resolving)',
      job(1, { status: 'running', progress: prog({ phase: 'resolving' }) }),
      { primary: [], cancel: true, menu: ['showTitle', 'copyUrl'] },
    ],
    [
      '받는 중',
      job(1, { status: 'running', progress: prog() }),
      { primary: ['pause'], cancel: true, menu: ['showTitle', 'copyUrl'] },
    ],
    [
      '링크 갱신',
      job(1, { status: 'running', progress: prog({ phase: 'reresolving' }) }),
      { primary: ['pause'], cancel: true, menu: ['showTitle', 'copyUrl'] },
    ],
    [
      '마무리 중',
      job(1, { status: 'running', progress: prog({ phase: 'finalizing' }) }),
      { primary: [], cancel: false, menu: ['showTitle', 'copyUrl'] },
    ],
    ['멈추는 중', job(1, { status: 'pausing', progress: prog() }), { primary: [], cancel: false, menu: ['showTitle', 'copyUrl'] }],
    [
      '일시정지(.part 있음)',
      job(1, { status: 'paused', partialBytes: 5 * MiB }),
      { primary: ['resume'], cancel: true, menu: ['showTitle', 'copyUrl', 'restartFresh'] },
    ],
    ['일시정지(.part 없음)', job(1, { status: 'paused' }), { primary: ['resume'], cancel: true, menu: ['showTitle', 'copyUrl'] }],
    [
      '중단',
      job(1, { status: 'interrupted', partialBytes: 5 * MiB }),
      { primary: ['resume'], cancel: true, menu: ['showTitle', 'copyUrl', 'restartFresh'] },
    ],
    [
      '실패: 디스크 부족(.part 있음)',
      job(1, { status: 'failed', partialBytes: 5 * MiB, error: err('diskFull', { payload: { type: 'path', path: '/v' } }) }),
      { primary: ['resume', 'openFolder'], cancel: false, menu: ['showTitle', 'copyUrl', 'restartFresh', 'copyReport', 'remove'] },
    ],
    [
      '실패: 원본 바뀜(.part 없음)',
      job(1, { status: 'failed', error: err('sourceChanged') }),
      { primary: ['restartFresh'], cancel: false, menu: ['showTitle', 'copyUrl', 'copyReport', 'remove'] },
    ],
    [
      '실패: 네트워크(.part 없음) → 다시 시도',
      job(1, { status: 'failed', error: err('network', { resumable: true }) }),
      { primary: ['retry'], cancel: false, menu: ['showTitle', 'copyUrl', 'copyReport', 'remove'] },
    ],
    [
      '실패: 화질 없음 → 다시 불러오기',
      job(1, { status: 'failed', error: err('qualityNotFound') }),
      { primary: ['reresolve', 'remove'], cancel: false, menu: ['showTitle', 'copyUrl', 'copyReport'] },
    ],
    [
      '실패: 지원하지 않음 → 보고 복사가 기본',
      job(1, { status: 'failed', error: err('unsupported') }),
      { primary: ['copyReport', 'remove'], cancel: false, menu: ['showTitle', 'copyUrl'] },
    ],
    [
      '완료',
      job(1, { status: 'completed', finalBytes: 10 }),
      { primary: ['openFile', 'openFolder'], cancel: false, menu: ['showTitle', 'copyUrl', 'remove'] },
    ],
    [
      '완료(파일 없음)',
      job(1, { status: 'completed', missing: true }),
      { primary: ['openFolder'], cancel: false, menu: ['showTitle', 'copyUrl', 'remove'] },
    ],
    [
      '건너뜀',
      job(1, { status: 'skipped' }),
      { primary: ['openFile', 'overwrite'], cancel: false, menu: ['showTitle', 'copyUrl', 'remove'] },
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

describe('상태 줄(§3.2): 명사형 조각', () => {
  it('progressive 받는 중', () => {
    const j = job(1, { status: 'running', progress: prog() });
    expect(line(j)).toBe('받는 중 · 2.3 GB / 4.0 GB · 12.4 MB/s · 2분 18초 남음');
  });

  it('HLS 받는 중: 예상 총량과 조각이 같은 줄의 조각이다(폭 쿼리로 숨기지 않는다)', () => {
    const j = job(1, { status: 'running', playbackKind: 'liveRewindHls', progress: hlsProg() });
    expect(line(j)).toBe('받는 중 · 1.2 GB / 약 5.1 GB · 조각 1,210/5,580 · 8.1 MB/s · 14분 남음');
  });

  it('남은 시간을 모르면 계산 중, 속도가 없으면 뺀다', () => {
    const j = job(1, { status: 'running', progress: prog({ etaSecs: null, speedBps: null }) });
    expect(line(j)).toBe('받는 중 · 2.3 GB / 4.0 GB · 남은 시간 계산 중');
  });

  it('이어받음은 맨 끝 조각으로 처음 10초만', () => {
    const p = prog({ resumedFrom: 1_181_116_006 });
    const j = job(1, { status: 'running', progress: p });
    expect(line(j, p, { runStartedAt: 1000, now: 1000 + RESUMED_NOTE_MS - 1 })).toBe(
      '받는 중 · 2.3 GB / 4.0 GB · 12.4 MB/s · 2분 18초 남음 · 1.1 GB부터 이어받음',
    );
    expect(line(j, p, { runStartedAt: 1000, now: 1000 + RESUMED_NOTE_MS })).not.toContain('이어받음');
  });

  it('단계별 조각은 job.status.* 키에서 온다', () => {
    expect(line(job(1, { status: 'running' }))).toBe(t('job.status.resolving'));
    expect(line(job(1, { status: 'running', progress: prog({ phase: 'reresolving' }) }))).toBe(
      `${t('job.phase.reresolving')} · 2.3 GB / 4.0 GB`,
    );
    expect(line(job(1, { status: 'running', progress: prog({ phase: 'finalizing' }) }))).toBe(t('job.status.finalizing'));
    expect(line(job(1, { status: 'pausing' }))).toBe(t('job.pausing'));
  });

  it('대기·멈춤·완료·건너뜀: 상태 줄에는 조각만, 사건 설명은 본문 키', () => {
    expect(line(job(1), null, { ahead: 2 })).toBe(t('job.queued', { n: 2 }));
    expect(line(job(1), null, { ahead: 0 })).toBe(t('job.queuedNext'));
    // 중단(interrupted)도 일시정지와 같은 어휘다
    for (const status of ['paused', 'interrupted'] as const) {
      expect(line(job(1, { status, partialBytes: 1_717_986_918 }))).toBe(t('job.paused', { bytes: '1.6 GB' }));
      expect(line(job(1, { status }))).toBe(t('job.status.paused'));
    }
    expect(
      line(job(1, { status: 'completed', finalBytes: 4_294_967_296, finishedAt: 1_759_668_060 }), null, {
        timeZone: 'Asia/Seoul',
      }),
    ).toBe(t('job.completed', { size: '4.0 GB', time: '오후 9:41' }));
    // 완료 시각이 없으면 끝에 ` · `가 남지 않는다(.replace 없이 전용 키)
    const noTime = line(job(1, { status: 'completed', finalBytes: 4_294_967_296 }));
    expect(noTime).toBe(t('job.completedNoTime', { size: '4.0 GB' }));
    expect(noTime).not.toMatch(/ · $/);
    expect(line(job(1, { status: 'completed', missing: true }))).toBe(t('job.completedMissing'));
    expect(line(job(1, { status: 'skipped' }))).toBe(t('job.status.skipped'));
    expect(line(job(1, { status: 'skipped', partialBytes: 1024 }))).toBe(t('job.status.skipped'));
    expect(statusParts(job(1, { status: 'failed', error: err('network') }), null)).toEqual([]);
  });

  it('본문 줄 키: 파일 없음·건너뜀(시작 전/받는 동안)에만 있다', () => {
    expect(bodyKey(job(1, { status: 'completed', missing: true }))).toBe('job.completedMissing.body');
    expect(bodyKey(job(1, { status: 'completed' }))).toBeNull();
    expect(bodyKey(job(1, { status: 'skipped' }))).toBe('job.skipped.body');
    expect(bodyKey(job(1, { status: 'skipped', partialBytes: 1 }))).toBe('job.skippedMeanwhile.body');
    for (const status of ['queued', 'running', 'paused', 'interrupted', 'failed'] as const) {
      expect(bodyKey(job(1, { status }))).toBeNull();
    }
  });

  it('statusWord(읽어 주기): 새 job.status.* 어휘', () => {
    expect(statusWord(job(1, { status: 'queued' }), null)).toBe(t('job.status.queued'));
    expect(statusWord(job(1, { status: 'interrupted' }), null)).toBe(t('job.status.paused'));
    expect(statusWord(job(1, { status: 'skipped' }), null)).toBe(t('job.status.skipped'));
    expect(statusWord(job(1, { status: 'completed' }), null)).toBe(t('job.status.completed'));
    expect(statusWord(job(1, { status: 'running' }), null)).toBe(t('job.status.resolving'));
    expect(statusWord(job(1, { status: 'running' }), prog({ phase: 'finalizing' }))).toBe(t('job.status.finalizing'));
  });
});

describe('작업 행 진행 영역 표(patterns.md §3.2): 상태마다 막대·퍼센트·조각·본문·버튼', () => {
  const MiB = 1024 * 1024;
  type Row = {
    name: string;
    job: JobDto;
    bar: null | { state: 'accent' | 'muted' | 'danger'; value: number | null; percent: string | null };
    line: string;
    body: string | null;
    primary: string[];
    cancel: ReturnType<typeof cancelLabel>['label'] | null;
  };
  const rows: Row[] = [
    {
      name: '받는 중(일반 VOD·클립)',
      job: job(1, { status: 'running', progress: prog() }),
      bar: { state: 'accent', value: 57, percent: '57%' },
      line: '받는 중 · 2.3 GB / 4.0 GB · 12.4 MB/s · 2분 18초 남음',
      body: null,
      primary: ['pause'],
      cancel: t('action.cancel'),
    },
    {
      name: '받는 중(빠른 다시보기)',
      job: job(1, { status: 'running', playbackKind: 'liveRewindHls', progress: hlsProg() }),
      bar: { state: 'accent', value: 21, percent: '21%' },
      line: '받는 중 · 1.2 GB / 약 5.1 GB · 조각 1,210/5,580 · 8.1 MB/s · 14분 남음',
      body: null,
      primary: ['pause'],
      cancel: t('action.cancel'),
    },
    {
      name: '준비 중: value null, 퍼센트 칸 비움, 취소는 즉시',
      job: job(1, { status: 'running', progress: prog({ phase: 'resolving', bytes: 0 }) }),
      bar: { state: 'accent', value: null, percent: null },
      line: t('job.status.resolving'),
      body: null,
      primary: [],
      cancel: t('action.cancelQueued'),
    },
    {
      name: '주소 재취득: 줄무늬(waiting), 퍼센트 유지',
      job: job(1, { status: 'running', progress: prog({ phase: 'reresolving' }) }),
      bar: { state: 'accent', value: 57, percent: '57%' },
      line: `${t('job.phase.reresolving')} · 2.3 GB / 4.0 GB`,
      body: null,
      primary: ['pause'],
      cancel: t('action.cancel'),
    },
    {
      name: '마무리 중: 마지막 값, 100%를 보이지 않는다, 동작 없음',
      job: job(1, { status: 'running', progress: prog({ phase: 'finalizing', bytes: 4_294_967_296 }) }),
      bar: { state: 'accent', value: 99, percent: '99%' },
      line: t('job.status.finalizing'),
      body: null,
      primary: [],
      cancel: null,
    },
    {
      name: '대기: 막대 없음, 취소는 즉시',
      job: job(1),
      bar: null,
      line: t('job.queuedNext'),
      body: null,
      primary: [],
      cancel: t('action.cancelQueued'),
    },
    {
      name: '일시정지하는 중: 마지막 값 유지, 동작 없음',
      job: job(1, { status: 'pausing', progress: prog() }),
      bar: { state: 'muted', value: 57, percent: '57%' },
      line: t('job.pausing'),
      body: null,
      primary: [],
      cancel: null,
    },
    {
      name: '일시정지(.part 있음)',
      job: job(1, { status: 'paused', partialBytes: 5 * MiB, progress: prog({ bytes: 5 * MiB }) }),
      bar: { state: 'muted', value: 0, percent: '0%' },
      line: t('job.paused', { bytes: '5.0 MB' }),
      body: null,
      primary: ['resume'],
      cancel: t('action.cancel'),
    },
    {
      name: '중단(앱 종료)도 일시정지 어휘',
      job: job(1, { status: 'interrupted', partialBytes: 5 * MiB, progress: prog() }),
      bar: { state: 'muted', value: 57, percent: '57%' },
      line: t('job.paused', { bytes: '5.0 MB' }),
      body: null,
      primary: ['resume'],
      cancel: t('action.cancel'),
    },
    {
      name: '실패(이어받기 가능): 빨간 막대 + 퍼센트 유지',
      job: job(1, {
        status: 'failed',
        partialBytes: 5 * MiB,
        progress: prog(),
        error: err('diskFull', { payload: { type: 'path', path: '/v' } }),
      }),
      bar: { state: 'danger', value: 57, percent: '57%' },
      line: '',
      body: null,
      primary: ['resume', 'openFolder'],
      cancel: null,
    },
    {
      name: '실패(.part 없음): 막대 없음',
      job: job(1, { status: 'failed', error: err('sourceChanged') }),
      bar: null,
      line: '',
      body: null,
      primary: ['restartFresh'],
      cancel: null,
    },
    {
      name: '완료: 막대·퍼센트 없음',
      job: job(1, { status: 'completed', finalBytes: 4_294_967_296, finishedAt: 1_759_668_060 }),
      bar: null,
      line: t('job.completed', { size: '4.0 GB', time: '오후 9:41' }),
      body: null,
      primary: ['openFile', 'openFolder'],
      cancel: null,
    },
    {
      name: '완료 · 파일 없음',
      job: job(1, { status: 'completed', missing: true }),
      bar: null,
      line: t('job.completedMissing'),
      body: t('job.completedMissing.body'),
      primary: ['openFolder'],
      cancel: null,
    },
    {
      name: '건너뜀(시작 전)',
      job: job(1, { status: 'skipped' }),
      bar: null,
      line: t('job.status.skipped'),
      body: t('job.skipped.body'),
      primary: ['openFile', 'overwrite'],
      cancel: null,
    },
    {
      name: '건너뜀(받는 동안 생김)',
      job: job(1, { status: 'skipped', partialBytes: 1024 }),
      bar: null,
      line: t('job.status.skipped'),
      body: t('job.skippedMeanwhile.body'),
      primary: ['openFile', 'overwrite'],
      cancel: null,
    },
  ];

  it.each(rows)('$name', (row) => {
    const j = row.job;
    const p = j.progress;
    const bar = barView(j, p);
    if (row.bar === null) expect(bar).toBeNull();
    else {
      expect(bar).toMatchObject({ value: row.bar.value, percent: row.bar.percent, tone: row.bar.state });
    }
    expect(statusLine(statusParts(j, p, { timeZone: 'Asia/Seoul' }))).toBe(row.line);
    const key = bodyKey(j);
    expect(key ? t(key) : null).toBe(row.body);
    const b = jobButtons(j, p);
    expect(b.primary).toEqual(row.primary);
    expect(b.cancel ? cancelLabel(j, p).label : null).toBe(row.cancel);
  });

  it('퍼센트는 늘 100 미만이다(P-6): 완료 행에서만 100%', () => {
    const done = job(1, { status: 'running', progress: prog({ bytes: 4_294_967_296 }) });
    expect(displayPercent(done, done.progress)).toBe(99);
    expect(barView(done, done.progress)?.percent).toBe('99%');
    expect(barView(done, done.progress)?.valueText).toContain('99퍼센트');
  });

  it('퍼센트는 뒤로 가지 않는다(P-4): 바닥보다 작은 값은 바닥을 보인다', () => {
    const j = job(1, { status: 'running', progress: prog({ bytes: 1_073_741_824 }) });
    expect(barView(j, j.progress)?.percent).toBe('25%');
    expect(barView(j, j.progress, 60)).toMatchObject({ value: 60, percent: '60%' });
    expect(barView(j, j.progress, 10)?.percent).toBe('25%');
    // 준비 중이면 바닥이 있어도 값이 없다(가짜 퍼센트를 만들지 않는다)
    expect(barView(job(1, { status: 'running' }), null, 60)).toMatchObject({ value: null, percent: null });
  });
});

describe('진행 막대', () => {
  it('progressive는 바이트, HLS는 재생 시간 비율', () => {
    const a = job(1, { status: 'running', progress: prog() });
    expect(barView(a, a.progress)).toMatchObject({ percent: '57%', value: 57, tone: 'accent', striped: false });
    expect(barView(a, a.progress)?.valueText).toBe('57퍼센트, 2분 18초 남음');
    const h = job(2, { status: 'running', playbackKind: 'liveRewindHls', progress: hlsProg() });
    expect(barView(h, h.progress)?.percent).toBe('21%');
  });

  it('총량을 모르면 indeterminate(값·퍼센트 없음), 준비 중도', () => {
    const p = prog({ totalBytes: null });
    expect(barView(job(1, { status: 'running' }), p)).toMatchObject({ value: null, percent: null });
    expect(barView(job(1, { status: 'running' }), null)).toMatchObject({ value: null, valueText: t('job.status.resolving') });
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

describe('취소 확인(D2): .part가 있으면 크기와 무관하게', () => {
  it('받은 바이트 0은 즉시, 1바이트부터 D2', () => {
    expect(needsCancelConfirm(job(1, { status: 'paused', partialBytes: 0 }), null)).toBe(false);
    expect(needsCancelConfirm(job(1, { status: 'paused', partialBytes: 1 }), null)).toBe(true);
    expect(needsCancelConfirm(job(1, { status: 'paused' }), null)).toBe(false);
  });

  it('받는 중은 진행률 바이트, 멈춘 작업·실패는 .part 크기, 대기·완료는 묻지 않는다', () => {
    expect(receivedBytes(job(1, { status: 'running' }), prog({ bytes: 1 }))).toBe(1);
    expect(needsCancelConfirm(job(1, { status: 'running' }), prog({ bytes: 1 }))).toBe(true);
    expect(needsCancelConfirm(job(1, { status: 'running' }), prog({ bytes: 0 }))).toBe(false);
    expect(needsCancelConfirm(job(1, { status: 'running' }), null)).toBe(false);
    expect(needsCancelConfirm(job(1, { status: 'failed', partialBytes: 1 }), null)).toBe(true);
    expect(needsCancelConfirm(job(1, { status: 'queued', partialBytes: 99 }), null)).toBe(false);
    expect(needsCancelConfirm(job(1, { status: 'completed', finalBytes: 99 }), null)).toBe(false);
    // 받는 동안 같은 이름의 파일이 생겨 건너뛴 작업: 지우면 다 받은 .part도 지워지므로 묻는다
    expect(needsCancelConfirm(job(1, { status: 'skipped', partialBytes: 1 }), null)).toBe(true);
    expect(needsCancelConfirm(job(1, { status: 'skipped' }), null)).toBe(false);
  });

  it('취소 라벨은 같은 조건으로 갈린다: [취소…] danger / [취소] neutral', () => {
    expect(cancelLabel(job(1, { status: 'paused', partialBytes: 1 }), null)).toEqual({ label: t('action.cancel'), tone: 'danger' });
    expect(cancelLabel(job(1), null)).toEqual({ label: t('action.cancelQueued'), tone: 'neutral' });
    expect(cancelLabel(job(1, { status: 'running' }), prog({ phase: 'resolving', bytes: 0 }))).toEqual({
      label: t('action.cancelQueued'),
      tone: 'neutral',
    });
  });

  it('지우기 길: .part → D2, 끝난 항목 → 지연 삭제, 대기·준비 중 → 즉시', () => {
    expect(removeRoute(job(1, { status: 'paused', partialBytes: 1 }), null)).toBe('confirm');
    expect(removeRoute(job(1, { status: 'failed', partialBytes: 1 }), null)).toBe('confirm');
    expect(removeRoute(job(1, { status: 'skipped', partialBytes: 1 }), null)).toBe('confirm');
    expect(removeRoute(job(1, { status: 'completed' }), null)).toBe('defer');
    expect(removeRoute(job(1, { status: 'skipped' }), null)).toBe('defer');
    expect(removeRoute(job(1, { status: 'failed' }), null)).toBe('defer');
    expect(removeRoute(job(1), null)).toBe('now');
    expect(removeRoute(job(1, { status: 'paused' }), null)).toBe('now');
    expect(removeRoute(job(1, { status: 'running' }), null)).toBe('now');
  });

  it('[완료 항목 지우기] 대상: 완료와 .part 없는 건너뜀', () => {
    expect(isClearable(job(1, { status: 'completed' }))).toBe(true);
    expect(isClearable(job(1, { status: 'skipped' }))).toBe(true);
    expect(isClearable(job(1, { status: 'skipped', partialBytes: 7 }))).toBe(false);
    expect(isClearable(job(1, { status: 'failed' }))).toBe(false);
  });

  it('저장된 파일 이름은 경로의 마지막 조각(POSIX·Windows)', () => {
    expect(outputFileName('/v/영상.mp4')).toBe('영상.mp4');
    expect(outputFileName('C:\\영상\\a b.mp4')).toBe('a b.mp4');
    expect(outputFileName('a.mp4')).toBe('a.mp4');
  });
});

describe('완료 그룹 접힘(README D39)', () => {
  const finished = (n: number) => Array.from({ length: n }, (_, i) => job(i + 1, { status: 'completed', createdAt: i + 1 }));

  it(`${COMPLETED_FOLD_AT - 1}개까지는 접지 않고, ${COMPLETED_FOLD_AT}개부터 접을 수 있다`, () => {
    expect(groupJobs(finished(COMPLETED_FOLD_AT - 1))[0].foldable).toBe(false);
    expect(groupJobs(finished(COMPLETED_FOLD_AT))[0].foldable).toBe(true);
    // 다른 그룹은 개수가 많아도 접지 않는다
    expect(groupJobs(Array.from({ length: 15 }, (_, i) => job(i + 1, { status: 'running' })))[0].foldable).toBe(false);
  });

  it('접힌 동안은 최신 5개만, 펼치면 전부(보이는 순서도 같다)', () => {
    const groups = groupJobs(finished(12));
    const [g] = groups;
    expect(shownJobs(g, false).map((j) => j.id)).toEqual([12, 11, 10, 9, 8]);
    expect(shownJobs(g, false)).toHaveLength(FOLD_PREVIEW_COUNT);
    expect(shownJobs(g, true)).toHaveLength(12);
    expect(visibleOrder(groups, false)).toEqual([12, 11, 10, 9, 8]);
    expect(visibleOrder(groups, true)).toHaveLength(12);
    expect(visibleOrder(groups)).toHaveLength(12);
  });

  it('접을 수 없는 그룹은 펼침 여부와 무관하게 전부', () => {
    const [g] = groupJobs(finished(3));
    expect(shownJobs(g, false)).toHaveLength(3);
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
      // 채널 ID가 없는 옛 작업은 막지 않는다(셸이 영상을 다시 판정한다)
      expect(jobBlock(job(1, { status, channelId: null }), me)).toBeNull();
    }
  });

  it('resumableInterrupted는 막힌 작업을 빼고 id 오름차순', () => {
    const list = [
      job(4, { status: 'interrupted', channelId: A1 }),
      job(2, { status: 'interrupted', channelId: C3 }),
      job(1, { status: 'interrupted', channelId: A1 }),
      job(3, { status: 'paused', channelId: A1 }),
      job(5, { status: 'interrupted', channelId: null }),
    ];
    expect(resumableInterrupted(list, me)).toEqual([1, 4, 5]);
    expect(resumableInterrupted(list, null)).toEqual([1, 2, 4, 5]);
  });

  it('막힌 작업 버튼', () => {
    const interrupted = job(1, { status: 'interrupted', channelId: C3, partialBytes: 5 });
    expect(jobButtons(interrupted, null, false, 'otherChannel')).toEqual({
      primary: [],
      cancel: true,
      menu: ['showTitle', 'copyUrl'],
    });
    const skipped = job(2, { status: 'skipped', channelId: C3 });
    expect(jobButtons(skipped, null, false, 'otherChannel').primary).toEqual(['openFile']);
    const failed = job(3, { status: 'failed', partialBytes: 9, error: err('network') });
    const b = jobButtons(failed, null, false, 'otherChannel');
    expect(b.primary).not.toContain('resume');
    expect(b.primary).not.toContain('retry');
    expect(b.menu).not.toContain('restartFresh');
    // 막지 않으면 전과 같다
    expect(jobButtons(interrupted, null).primary).toEqual(['resume']);
  });

  it('copy deck 키', () => {
    expect(blockCopyKey('otherChannel')).toBe('job.otherChannel');
    expect(t('job.otherChannel')).toBe('다른 채널로 로그인해 이어받을 수 없어요');
  });
});

describe('동작 라벨', () => {
  it('폴더 보기만 OS마다 다르다(D39)', () => {
    expect(jobActionLabel('openFolder', 'macos')).toBe(t('platform.mac.reveal'));
    expect(jobActionLabel('openFolder', 'windows')).toBe(t('platform.other.reveal'));
    expect(jobActionLabel('openFolder', 'linux')).toBe(t('platform.other.reveal'));
    expect(jobActionLabel('showTitle', 'linux')).toBe(t('action.showTitle'));
    expect(jobActionLabel('overwrite', 'linux')).toBe(t('action.overwriteAndDownload'));
  });
});

describe('동작 아이콘 이름(Lucide 28개 안에 있다)', () => {
  it('취소는 아이콘이 없다(글자뿐, foundations §9.1)', () => {
    expect(jobActionIcon('cancel')).toBeUndefined();
  });

  it('옛 이름(restart·file-play·trash)이 새 이름으로 바뀌었다', () => {
    expect(jobActionIcon('restartFresh')).toBe('rotate-cw');
    expect(jobActionIcon('openFile')).toBe('file-video');
    expect(jobActionIcon('remove')).toBe('trash-2');
  });

  it('모든 동작의 아이콘이 아이콘 집합에 있다', () => {
    const all = ['pause', 'resume', 'retry', 'restartFresh', 'openFile', 'openFolder', 'remove', 'copyUrl', 'copyReport'] as const;
    for (const a of all) {
      const name = jobActionIcon(a);
      expect(name && name in ICONS).toBe(true);
    }
  });
});
