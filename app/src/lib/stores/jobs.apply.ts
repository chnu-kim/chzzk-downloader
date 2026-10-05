// `subscribe_jobs` Channel 이벤트를 목록 상태에 반영하는 순수 함수(§10 `stores/jobs.apply.ts`).
// 상태 판단은 Rust가 한다. 여기서는 받은 레코드를 그대로 갈아 끼울 뿐이다.
import type { JobDto, JobEvent, JobId, ProgressDto } from '../bindings';

export interface JobsState {
  jobs: ReadonlyMap<JobId, JobDto>;
  /** 마지막 진행률. `status` 레코드의 `progress`와 `progress` 이벤트 중 나중 것 */
  progress: ReadonlyMap<JobId, ProgressDto>;
}

export function emptyJobs(): JobsState {
  return { jobs: new Map(), progress: new Map() };
}

/** `subscribe_jobs`·`list_jobs` 스냅샷으로 전부 바꾼다(웹뷰 새로고침·재구독). */
export function fromSnapshot(list: readonly JobDto[]): JobsState {
  const jobs = new Map<JobId, JobDto>();
  const progress = new Map<JobId, ProgressDto>();
  for (const job of list) {
    jobs.set(job.id, job);
    if (job.progress) progress.set(job.id, job.progress);
  }
  return { jobs, progress };
}

/**
 * 이벤트 하나를 반영한 새 상태. 바뀌지 않으면 같은 객체를 돌려준다.
 * - `added`·`status`: 레코드 전체를 바꾼다. 레코드의 `progress`가 없으면 진행률도 지운다.
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
      return { jobs, progress };
    }
    case 'progress': {
      if (!state.jobs.has(event.id)) return state;
      const progress = new Map(state.progress);
      progress.set(event.id, event.progress);
      return { jobs: state.jobs, progress };
    }
    case 'removed': {
      if (!state.jobs.has(event.id) && !state.progress.has(event.id)) return state;
      const jobs = new Map(state.jobs);
      jobs.delete(event.id);
      const progress = new Map(state.progress);
      progress.delete(event.id);
      return { jobs, progress };
    }
    default: {
      const never: never = event;
      void never;
      return state;
    }
  }
}
