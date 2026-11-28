import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  and,
  desc,
  eq,
  isNotNull,
  milestoneAttachments,
  milestones,
  type Database,
} from '@devtrack/database';
import type { MilestoneAttachment } from '@devtrack/types';
import { MAX_REQUEST_MARKDOWN_BYTES, type CreateTaskAttachmentInput } from '@devtrack/validators';
import { AppException } from '../common/errors/app.exception';
import { isUuid } from '../common/pipes/uuid-param.pipe';
import { DATABASE } from '../database/database.module';
import {
  ProjectAccessService,
  type ProjectAccessOptions,
} from '../projects/project-access.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { MediaObjects } from '../storage/media-objects';

const notFound = () => AppException.notFound('Attachment not found.');

/**
 * Files on a milestone's brief (0030 §3): screenshots, mockups, videos and Markdown specs.
 * Everyone on the project reads them; leads and admins add and remove them. Internal only:
 * the client's sign-off page never shows them.
 */
@Injectable()
export class MilestoneAttachmentsService {
  private readonly media = new MediaObjects();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: ProjectAccessService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async list(
    userId: string,
    milestoneId: string,
  ): Promise<{ attachments: MilestoneAttachment[]; uploadsEnabled: boolean }> {
    const { project, canManage } = await this.requireMilestone(userId, milestoneId, {});
    if (!this.media.enabled) return { attachments: [], uploadsEnabled: false };
    const rows = await this.db
      .select()
      .from(milestoneAttachments)
      .where(
        and(
          eq(milestoneAttachments.milestoneId, milestoneId),
          isNotNull(milestoneAttachments.completedAt),
        ),
      )
      .orderBy(desc(milestoneAttachments.completedAt));
    const attachments: MilestoneAttachment[] = [];
    for (const row of rows) {
      attachments.push({
        id: row.id,
        name: row.name,
        contentType: row.contentType,
        size: row.size,
        url: await this.media.readUrl(row.id),
      });
    }
    return { attachments, uploadsEnabled: canManage && project.status !== 'ARCHIVED' };
  }

  async prepare(userId: string, milestoneId: string, input: CreateTaskAttachmentInput) {
    await this.requireMilestone(userId, milestoneId, { manage: true, write: true });
    this.media.require();
    await this.rateLimit.consume(
      { name: 'milestone-media:user', limit: 30, windowSeconds: 3600 },
      userId,
    );
    const id = randomUUID();
    const upload = await this.media.presign(id, input);
    await this.db
      .insert(milestoneAttachments)
      .values({ id, milestoneId, uploaderId: userId, ...input });
    return upload;
  }

  async complete(userId: string, milestoneId: string, id: string) {
    await this.requireMilestone(userId, milestoneId, { manage: true, write: true });
    const [row] = await this.db
      .select()
      .from(milestoneAttachments)
      .where(
        and(
          eq(milestoneAttachments.id, id),
          eq(milestoneAttachments.milestoneId, milestoneId),
          eq(milestoneAttachments.uploaderId, userId),
        ),
      );
    if (!row) throw notFound();
    if (row.completedAt) return { id: row.id };
    await this.media.publish(row.id, row);
    await this.db
      .update(milestoneAttachments)
      .set({ completedAt: new Date() })
      .where(eq(milestoneAttachments.id, row.id));
    return { id: row.id };
  }

  /** The text of a Markdown file, for its rendered preview. */
  async markdown(userId: string, milestoneId: string, id: string): Promise<{ content: string }> {
    await this.requireMilestone(userId, milestoneId, {});
    this.media.require();
    const row = await this.completed(milestoneId, id);
    if (row.contentType !== 'text/markdown' || row.size > MAX_REQUEST_MARKDOWN_BYTES) {
      throw AppException.validation([
        { path: 'id', message: 'Only Markdown files up to 256 KB can be previewed.' },
      ]);
    }
    return { content: await this.media.readText(id) };
  }

  async remove(userId: string, milestoneId: string, id: string): Promise<void> {
    await this.requireMilestone(userId, milestoneId, { manage: true, write: true });
    this.media.require();
    const [row] = await this.db
      .delete(milestoneAttachments)
      .where(
        and(eq(milestoneAttachments.id, id), eq(milestoneAttachments.milestoneId, milestoneId)),
      )
      .returning();
    if (!row) throw notFound();
    if (row.completedAt) await this.media.remove(row.id);
  }

  private async completed(milestoneId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(milestoneAttachments)
      .where(
        and(
          eq(milestoneAttachments.id, id),
          eq(milestoneAttachments.milestoneId, milestoneId),
          isNotNull(milestoneAttachments.completedAt),
        ),
      );
    if (!row) throw notFound();
    return row;
  }

  /** Outsiders get 404 for the milestone, as on its page. */
  private async requireMilestone(userId: string, id: string, options: ProjectAccessOptions) {
    const [milestone] = isUuid(id)
      ? await this.db
          .select({ projectId: milestones.projectId })
          .from(milestones)
          .where(eq(milestones.id, id))
          .limit(1)
      : [];
    if (!milestone) throw AppException.notFound('Milestone not found.');
    try {
      return await this.access.require(userId, milestone.projectId, options);
    } catch (err) {
      if (err instanceof AppException && err.getStatus() === HttpStatus.NOT_FOUND) {
        throw AppException.notFound('Milestone not found.');
      }
      throw err;
    }
  }
}
