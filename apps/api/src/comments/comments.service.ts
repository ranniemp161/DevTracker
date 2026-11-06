import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  commentMentions,
  comments,
  eq,
  inArray,
  sql,
  taskAssignees,
  users,
  type Database,
  type Executor,
} from '@devtrack/database';
import type { Comment, UserRef } from '@devtrack/types';
import { parseMentions, type ListCommentsQuery } from '@devtrack/validators';
import { AppException } from '../common/errors/app.exception';
import { decodeCursor, isTimeCursor, Paginated, timeCursorOf } from '../common/http/paginated';
import { isUuid } from '../common/pipes/uuid-param.pipe';
import { DATABASE } from '../database/database.module';
import { EventRecorder, type Actor } from '../events/event-recorder.service';
import { ProjectAccessService, type ProjectAccess } from '../projects/project-access.service';
import { TaskAccessService, type TaskRow } from '../tasks/task-access.service';

type CommentRow = typeof comments.$inferSelect;
const userRef = { id: users.id, username: users.username, avatarUrl: users.avatarUrl };

const commentNotFound = () => AppException.notFound('Comment not found.');

/**
 * Task comments (architecture §7.4, M4 rules 1–2). Plain text only; mentions resolve only to
 * people who can access the project, so a mention can never expose a task to an outsider.
 */
@Injectable()
export class CommentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly taskAccess: TaskAccessService,
    private readonly projectAccess: ProjectAccessService,
    private readonly events: EventRecorder,
  ) {}

  async create(actor: Actor, taskId: string, body: string): Promise<Comment> {
    const { task, access } = await this.taskAccess.require(actor.id, taskId, { write: true });
    const mentioned = await this.resolveMentions(access, body);

    const commentId = await this.db.transaction(async (tx) => {
      const [comment] = await tx
        .insert(comments)
        .values({ taskId: task.id, authorId: actor.id, body })
        .returning();
      if (mentioned.length > 0) {
        await tx
          .insert(commentMentions)
          .values(mentioned.map((u) => ({ commentId: comment!.id, mentionedUserId: u.id })));
      }
      const key = `${access.project.key}-${task.taskNumber}`;
      await this.events.activity(tx, {
        ...this.scope(access, task, comment!),
        actor,
        action: 'comment.created',
        metadata: { key },
        event: { type: 'comment.created', payload: { commentId: comment!.id, taskId: task.id } },
      });

      const notified = await this.notifyMentions(tx, actor, access, task, mentioned);
      // COMMENT_RECEIVED: reporter and assignees who can still see the task, minus anyone
      // already notified about this comment through a mention (M4 rule 5).
      const followers = await this.followers(tx, access, task);
      await this.events.notify(
        tx,
        actor,
        followers
          .filter((u) => !notified.includes(u.id))
          .map((u) => ({
            userId: u.id,
            workspaceId: access.project.workspaceId,
            projectId: access.project.id,
            type: 'COMMENT_RECEIVED' as const,
            title: `@${actor.username} commented on ${key}`,
            body: task.title,
            resourceType: 'task',
            resourceId: task.id,
          })),
      );
      return comment!.id;
    });
    return (await this.load([commentId]))[0]!;
  }

  /** Oldest first; deleted comments stay as placeholders so the thread keeps its shape. */
  async list(
    userId: string,
    taskId: string,
    query: ListCommentsQuery,
  ): Promise<Paginated<Comment>> {
    const { task } = await this.taskAccess.require(userId, taskId);
    const after = query.cursor ? decodeCursor(query.cursor, isTimeCursor) : null;
    const rows = await this.db
      .select({ id: comments.id, createdAt: comments.createdAt })
      .from(comments)
      .where(
        and(
          eq(comments.taskId, task.id),
          after
            ? sql`(${comments.createdAt}, ${comments.id}) > (${after.t}::timestamptz, ${after.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(asc(comments.createdAt), asc(comments.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const nextCursor = rows.length > query.limit ? timeCursorOf(page.at(-1)!) : null;
    return new Paginated(await this.load(page.map((r) => r.id)), nextCursor);
  }

  /**
   * Authors edit their own comments. Newly mentioned people are notified once; removed
   * mentions are dropped; existing ones are not notified again (M4 rule 2).
   */
  async update(actor: Actor, commentId: string, body: string): Promise<Comment> {
    const { comment, task, access } = await this.requireComment(actor.id, commentId);
    if (comment.authorId !== actor.id) {
      throw AppException.forbidden('You can only edit your own comments.');
    }
    const mentioned = await this.resolveMentions(access, body);

    await this.db.transaction(async (tx) => {
      await tx
        .update(comments)
        .set({ body, editedAt: new Date(), updatedAt: new Date() })
        .where(eq(comments.id, comment.id));

      const existing = await tx
        .select({ id: commentMentions.mentionedUserId })
        .from(commentMentions)
        .where(eq(commentMentions.commentId, comment.id));
      const existingIds = new Set(existing.map((m) => m.id));
      const nextIds = new Set(mentioned.map((m) => m.id));
      const added = mentioned.filter((m) => !existingIds.has(m.id));
      const removed = [...existingIds].filter((id) => !nextIds.has(id));

      if (removed.length > 0) {
        await tx
          .delete(commentMentions)
          .where(
            and(
              eq(commentMentions.commentId, comment.id),
              inArray(commentMentions.mentionedUserId, removed),
            ),
          );
      }
      if (added.length > 0) {
        await tx
          .insert(commentMentions)
          .values(added.map((u) => ({ commentId: comment.id, mentionedUserId: u.id })));
      }
      await this.events.event(
        tx,
        'comment.updated',
        { ...this.scope(access, task, comment), actor },
        {
          commentId: comment.id,
          taskId: task.id,
        },
      );
      await this.notifyMentions(tx, actor, access, task, added);
    });
    return (await this.load([comment.id]))[0]!;
  }

  /** Authors delete their own comments; workspace Admins/Owner may delete any (moderation). */
  async remove(actor: Actor, commentId: string): Promise<void> {
    const { comment, task, access } = await this.requireComment(actor.id, commentId);
    if (comment.authorId !== actor.id && !access.canManage) {
      throw AppException.forbidden('You can only delete your own comments.');
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(comments)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(comments.id, comment.id));
      await this.events.activity(tx, {
        ...this.scope(access, task, comment),
        actor,
        action: 'comment.deleted',
        metadata: {
          key: `${access.project.key}-${task.taskNumber}`,
          moderated: comment.authorId !== actor.id,
        },
        event: { type: 'comment.deleted', payload: { commentId: comment.id, taskId: task.id } },
      });
    });
  }

  private async requireComment(userId: string, commentId: string) {
    const [comment] = isUuid(commentId)
      ? await this.db.select().from(comments).where(eq(comments.id, commentId)).limit(1)
      : [];
    if (!comment || comment.deletedAt) throw commentNotFound();
    try {
      const { task, access } = await this.taskAccess.require(userId, comment.taskId, {
        write: true,
      });
      return { comment, task, access };
    } catch (err) {
      if (err instanceof AppException && err.getStatus() === HttpStatus.NOT_FOUND)
        throw commentNotFound();
      throw err;
    }
  }

  private resolveMentions(access: ProjectAccess, body: string) {
    return this.projectAccess.audience(access.project, { usernames: parseMentions(body) });
  }

  private notifyMentions(
    tx: Executor,
    actor: Actor,
    access: ProjectAccess,
    task: TaskRow,
    mentioned: { id: string }[],
  ) {
    return this.events.notify(
      tx,
      actor,
      mentioned.map((u) => ({
        userId: u.id,
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        type: 'MENTIONED' as const,
        title: `@${actor.username} mentioned you on ${access.project.key}-${task.taskNumber}`,
        body: task.title,
        resourceType: 'task',
        resourceId: task.id,
      })),
    );
  }

  /** Reporter and assignees who can still access the project. */
  private async followers(tx: Executor, access: ProjectAccess, task: TaskRow) {
    const assignees = await tx
      .select({ id: taskAssignees.userId })
      .from(taskAssignees)
      .where(eq(taskAssignees.taskId, task.id));
    const ids = new Set([
      ...(task.reporterId ? [task.reporterId] : []),
      ...assignees.map((a) => a.id),
    ]);
    if (ids.size === 0) return [];
    const audience = await this.projectAccess.audience(access.project, {}, tx);
    return audience.filter((u) => ids.has(u.id));
  }

  private scope(access: ProjectAccess, task: TaskRow, comment: CommentRow) {
    return {
      workspaceId: access.project.workspaceId,
      projectId: access.project.id,
      taskId: task.id,
      entity: { type: 'comment' as const, id: comment.id },
    };
  }

  private async load(ids: string[]): Promise<Comment[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ comment: comments, author: userRef })
      .from(comments)
      .leftJoin(users, eq(users.id, comments.authorId))
      .where(inArray(comments.id, ids));
    const mentions = await this.db
      .select({ commentId: commentMentions.commentId, user: userRef })
      .from(commentMentions)
      .innerJoin(users, eq(users.id, commentMentions.mentionedUserId))
      .where(inArray(commentMentions.commentId, ids));
    const mentionsBy = new Map<string, UserRef[]>();
    for (const m of mentions)
      mentionsBy.set(m.commentId, [...(mentionsBy.get(m.commentId) ?? []), m.user]);
    const byId = new Map(rows.map((r) => [r.comment.id, r]));

    return ids.map((id) => {
      const { comment: c, author } = byId.get(id)!;
      const deleted = c.deletedAt !== null;
      return {
        id: c.id,
        taskId: c.taskId,
        author,
        body: deleted ? null : c.body,
        deleted,
        edited: c.editedAt !== null,
        mentions: deleted ? [] : (mentionsBy.get(c.id) ?? []),
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      };
    });
  }
}
