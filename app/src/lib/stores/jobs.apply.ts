// `subscribe_jobs` Channel 이벤트를 목록 상태에 반영하는 순수 함수(§10 `stores/jobs.apply.ts`).
// 상태 판단은 Rust가 한다. 여기서는 받은 레코드를 그대로 갈아 끼울 뿐이다.
import type { JobDto, JobEvent, JobId, ProgressDto } from '../bindings';
import { displayPercent } from '../jobs';

export interface JobsState {
  jobs: ReadonlyMap<JobId, JobDto>;
  /** 마지막 진행률. `status` 레코드의 `progress`와 `progress` 이벤트 중 나중 것 */
  progress: ReadonlyMap<JobId, ProgressDto>;
  /**
   * 작업마다 지금까지 보인 가장 큰 퍼센트(0~99). 코어 값이 줄어도(재조회·총량 재추정) 표시는 뒤로 가지 않는다(P-4).
   * 대기(새로 줄 선 것 = 처음부터 다시 받기·덮어쓰고 받기 포함)·완료·건너뜀이 되면 비운다. 100%는 완료 행에서만 보인다(P-6).
   */
  percent: ReadonlyMap<JobId, number>;
}

export function emptyJobs(): JobsState {
  return { jobs: new Map(), progress: new Map(), percent: new Map() };
}

/** 이 작업의 퍼센트 바닥을 갱신한 지도를 돌려준다. 바뀌지 않으면 같은 지도 */
function withPercent(
  percent: ReadonlyMap<JobId, number>,
  job: JobDto,
  progress: ProgressDto | null | undefined,
): ReadonlyMap<JobId, number> {
  const prev = percent.get(job.id);
  if (job.status === 'queued' || job.status === 'completed' || job.status === 'skipped') {
    if (prev === undefined) return percent;
    const next = new Map(percent);
    next.delete(job.id);
    return next;
  }
  const n = displayPercent(job, progress);
  if (n == null || (prev !== undefined && n <= prev)) return percent;
  return new Map(percent).set(job.id, n);
}

/** `subscribe_jobs`·`list_jobs` 스냅샷으로 전부 바꾼다(웹뷰 새로고침·재구독). */
export function fromSnapshot(list: readonly JobDto[]): JobsState {
  const jobs = new Map<JobId, JobDto>();
  const progress = new Map<JobId, ProgressDto>();
  let percent: ReadonlyMap<JobId, number> = new Map();
  for (const job of list) {
    jobs.set(job.id, job);
    if (job.progress) progress.set(job.id, job.progress);
    percent = withPercent(percent, job, job.progress);
  }
  return { jobs, progress, percent };
}

/**
 * 이벤트 하나를 반영한 새 상태. 바뀌지 않으면 같은 객체를 돌려준다.
 * - `added`·`status`: 레코드 전체를 바꾼다. 레코드의 `progress`가 없으면 진행률도 지운다. 퍼센트 바닥은 올리기만 한다.
 * - `progress`: 모르는 id(이미 지워졌거나 스냅샷 전)는 버린다.
 * - `removed`: 둘 다에서 지운다.
 */
export function applyEvent(state: JobsState, event: JobEvent): JobsState {
  switch (event.type) {
    case 'added':
    case 'status': {
      const { job } = event;
      const jobs = new Map(state.jobs);
      jobs.set(job.id, job);
      const progress = new Map(state.progress);
      if (job.progress) progress.set(job.id, job.progress);
      else progress.delete(job.id);
      return { jobs, progress, percent: withPercent(state.percent, job, job.progress) };
    }
    case 'progress': {
      const job = state.jobs.get(event.id);
      if (!job) return state;
      const progress = new Map(state.progress);
      progress.set(event.id, event.progress);
      return { jobs: state.jobs, progress, percent: withPercent(state.percent, job, event.progress) };
    }
    case 'removed': {
      if (!state.jobs.has(event.id) && !state.progress.has(event.id)) return state;
      const jobs = new Map(state.jobs);
      jobs.delete(event.id);
      const progress = new Map(state.progress);
      progress.delete(event.id);
      const percent = new Map(state.percent);
      percent.delete(event.id);
      return { jobs, progress, percent };
    }
    default: {
      const never: never = event;
      void never;
      return state;
    }
  }
}
