import type { TaskStatus } from './project.js';

/** A submission from a project's public request form (decision record 0016). */
export type RequestKind = 'bug' | 'request';
export type RequestStatus = 'new' | 'accepted' | 'declined';

export interface TaskRequest {
  id: string;
  projectId: string;
  kind: RequestKind;
  status: RequestStatus;
  /** Null once declined (the task is deleted) or if the task was removed. */
  task: { id: string; key: string; title: string; status: TaskStatus } | null;
  /** Null when not given, or after contact details were deleted (90 days, 0016 §5). */
  reporterName: string | null;
  reporterEmail: string | null;
  contactDeleted: boolean;
  triagedBy: { id: string; username: string } | null;
  triagedAt: string | null;
  createdAt: string;
}

/** What the public form page may show. */
export interface PublicIntakeInfo {
  projectName: string;
}

/** Request form settings; only returned to project managers. */
export interface ProjectIntake {
  enabled: boolean;
  /** Path of the public form, e.g. `/r/abc…`. Null until first turned on. */
  token: string | null;
}
