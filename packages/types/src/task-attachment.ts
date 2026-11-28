export interface TaskAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  url: string;
}

/** A file on a milestone's brief (0030 §3); the same shape as a task attachment. */
export type MilestoneAttachment = TaskAttachment;
