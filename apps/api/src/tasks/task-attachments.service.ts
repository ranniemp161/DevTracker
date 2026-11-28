import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  taskAttachments,
  taskRequests,
  tasks,
  type Database,
  type Transaction,
} from '@devtrack/database';
import type { TaskAttachment } from '@devtrack/types';
import type { CreateTaskAttachmentInput } from '@devtrack/validators';
import { MAX_REQUEST_MARKDOWN_BYTES } from '@devtrack/validators';
import { AppException } from '../common/errors/app.exception';
import { DATABASE } from '../database/database.module';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { MediaObjects, type PreparedUpload } from '../storage/media-objects';
import { TaskAccessService } from './task-access.service';

/** A request form sender has this long to finish uploading the files they declared (0022). */
const REQUEST_UPLOAD_WINDOW_MS = 15 * 60 * 1000;

type AttachmentRow = typeof taskAttachments.$inferSelect;
type FileInput = Pick<CreateTaskAttachmentInput, 'name' | 'contentType' | 'size'>;
export type { PreparedUpload };

const notFound = () => AppException.notFound('Attachment not found.');

@Injectable()
export class TaskAttachmentsService {
  private readonly media = new MediaObjects();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly taskAccess: TaskAccessService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** Whether media storage is configured at all. */
  get uploadsEnabled(): boolean {
    return this.media.enabled;
  }

  async list(userId: string, taskId: string) {
    const { access } = await this.taskAccess.require(userId, taskId);
    if (!this.media.enabled) return { attachments: [], uploadsEnabled: false };
    const attachments = (await this.completedFor([taskId])).get(taskId) ?? [];
    return {
      attachments,
      uploadsEnabled: access.project.status !== 'ARCHIVED',
    };
  }

  /**
   * Completed attachments of several tasks, newest first, with signed read URLs. No access
   * check: callers (Triage) check access to the project first.
   */
  async completedFor(taskIds: string[]): Promise<Map<string, TaskAttachment[]>> {
    const byTask = new Map<string, TaskAttachment[]>();
    if (!this.media.enabled || taskIds.length === 0) return byTask;
    const rows = await this.db
      .select()
      .from(taskAttachments)
      .where(and(inArray(taskAttachments.taskId, taskIds), isNotNull(taskAttachments.completedAt)))
      .orderBy(desc(taskAttachments.completedAt));
    for (const row of rows) {
      const list = byTask.get(row.taskId) ?? [];
      list.push({
        id: row.id,
        name: row.name,
        contentType: row.contentType,
        size: row.size,
        url: await this.media.readUrl(row.id),
      });
      byTask.set(row.taskId, list);
    }
    return byTask;
  }

  async prepare(userId: string, taskId: string, input: CreateTaskAttachmentInput) {
    await this.taskAccess.require(userId, taskId, { write: true });
    this.media.require();
    await this.rateLimit.consume(
      { name: 'task-media:user', limit: 30, windowSeconds: 3600 },
      userId,
    );
    const id = randomUUID();
    const upload = await this.media.presign(id, input);
    await this.db.insert(taskAttachments).values({ id, taskId, uploaderId: userId, ...input });
    return upload;
  }

  /**
   * Declares the files a request form sender will upload (0022), inside the transaction that
   * creates the task. The rows have no uploader; returns one presigned upload per file.
   */
  async prepareForRequest(
    tx: Transaction,
    taskId: string,
    files: readonly FileInput[],
  ): Promise<PreparedUpload[]> {
    if (!this.media.enabled || files.length === 0) return [];
    const uploads: PreparedUpload[] = [];
    for (const file of files) {
      const id = randomUUID();
      uploads.push(await this.media.presign(id, file));
      await tx.insert(taskAttachments).values({
        id,
        taskId,
        uploaderId: null,
        name: file.name,
        contentType: file.contentType,
        size: file.size,
      });
    }
    return uploads;
  }

  async complete(userId: string, taskId: string, id: string) {
    await this.taskAccess.require(userId, taskId, { write: true });
    const [row] = await this.db
      .select()
      .from(taskAttachments)
      .where(
        and(
          eq(taskAttachments.id, id),
          eq(taskAttachments.taskId, taskId),
          eq(taskAttachments.uploaderId, userId),
        ),
      );
    if (!row) throw notFound();
    return this.finalize(row);
  }

  /**
   * Completes a file declared on the public form of `projectId` (0022 §3): it must belong to
   * a request's task in that project, have no uploader, and be at most 15 minutes old.
   */
  async completeForRequest(projectId: string, id: string) {
    const [found] = await this.db
      .select({ attachment: taskAttachments })
      .from(taskAttachments)
      .innerJoin(tasks, eq(tasks.id, taskAttachments.taskId))
      .innerJoin(taskRequests, eq(taskRequests.taskId, tasks.id))
      .where(
        and(
          eq(taskAttachments.id, id),
          isNull(taskAttachments.uploaderId),
          eq(tasks.projectId, projectId),
          gt(taskAttachments.createdAt, new Date(Date.now() - REQUEST_UPLOAD_WINDOW_MS)),
        ),
      );
    if (!found) throw notFound();
    return this.finalize(found.attachment);
  }

  /** The text of a completed Markdown attachment, for the rendered preview (0022 §5). */
  async markdown(userId: string, taskId: string, id: string): Promise<{ content: string }> {
    await this.taskAccess.require(userId, taskId);
    this.media.require();
    const [row] = await this.db
      .select()
      .from(taskAttachments)
      .where(
        and(
          eq(taskAttachments.id, id),
          eq(taskAttachments.taskId, taskId),
          isNotNull(taskAttachments.completedAt),
        ),
      );
    if (!row) throw notFound();
    if (row.contentType !== 'text/markdown' || row.size > MAX_REQUEST_MARKDOWN_BYTES) {
      throw AppException.validation([
        { path: 'id', message: 'Only Markdown files up to 256 KB can be previewed.' },
      ]);
    }
    return { content: await this.media.readText(id) };
  }

  // ---------------------------------------------------------------- helpers

  /** Checks the staged object against the row, copies it to its final key and publishes it. */
  private async finalize(row: AttachmentRow) {
    if (row.completedAt) return { id: row.id };
    await this.media.publish(row.id, row);
    await this.db
      .update(taskAttachments)
      .set({ completedAt: new Date() })
      .where(and(eq(taskAttachments.id, row.id), isNull(taskAttachments.completedAt)));
    return { id: row.id };
  }
}
