import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  projectChatReads,
  projectMessageMentions,
  projectMessages,
  projectMembers,
  projects,
  sql,
  tasks,
  users,
  workspaceMembers,
  workspaces,
  type Database,
} from '@devtrack/database';
import {
  ErrorCode,
  type ProjectChatReadState,
  type ProjectChatUnreadSummary,
  type ProjectMessage,
  type ProjectMessagePage,
  type UserRef,
} from '@devtrack/types';
import {
  parseMentions,
  type CreateChatMessageInput,
  type ListChatMessagesQuery,
  type UpdateChatMessageInput,
} from '@devtrack/validators';
import { AppException } from '../common/errors/app.exception';
import { isUuid } from '../common/pipes/uuid-param.pipe';
import { DATABASE } from '../database/database.module';
import { EventRecorder, type Actor } from '../events/event-recorder.service';
import { ProjectAccessService, type ProjectAccess } from '../projects/project-access.service';

type MessageRow = typeof projectMessages.$inferSelect;
const userRef = { id: users.id, username: users.username, avatarUrl: users.avatarUrl };
const messageNotFound = () => AppException.notFound('Message not found.');

@Injectable()
export class ChatService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly projectAccess: ProjectAccessService,
    private readonly events: EventRecorder,
  ) {}

  async create(
    actor: Actor,
    projectId: string,
    input: CreateChatMessageInput,
  ): Promise<ProjectMessage> {
    const access = await this.projectAccess.require(actor.id, projectId, { write: true });

    if (input.taskId) {
      const [task] = await this.db
        .select()
        .from(tasks)
        .where(
          and(eq(tasks.id, input.taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt)),
        )
        .limit(1);
      if (!task) {
        throw AppException.validation([
          { path: 'taskId', message: 'Task not found in this project.' },
        ]);
      }
    }

    const mentioned = await this.projectAccess.audience(access.project, {
      usernames: parseMentions(input.body),
    });

    const messageId = await this.db.transaction(async (tx) => {
      // Check for idempotent retry with unique (projectId, authorId, clientRequestId)
      const [existing] = await tx
        .select()
        .from(projectMessages)
        .where(
          and(
            eq(projectMessages.projectId, projectId),
            eq(projectMessages.authorId, actor.id),
            eq(projectMessages.clientRequestId, input.clientRequestId),
          ),
        )
        .limit(1);

      if (existing) {
        if (
          existing.body === input.body &&
          (existing.taskId ?? undefined) === (input.taskId ?? undefined)
        ) {
          return existing.id;
        }
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.CONFLICT,
          'Client request ID already used with different content.',
        );
      }

      // Allocate next message sequence under exclusive project row lock
      const [proj] = await tx
        .update(projects)
        .set({ nextMessageSequence: sql`${projects.nextMessageSequence} + 1` })
        .where(eq(projects.id, projectId))
        .returning({ nextSeq: projects.nextMessageSequence });

      if (!proj) throw messageNotFound();
      const sequence = proj.nextSeq - 1;

      const [message] = await tx
        .insert(projectMessages)
        .values({
          projectId,
          authorId: actor.id,
          body: input.body,
          sequence,
          clientRequestId: input.clientRequestId,
          taskId: input.taskId ?? null,
        })
        .returning();

      const others = mentioned.filter((u) => u.id !== actor.id);
      if (others.length > 0) {
        await tx.insert(projectMessageMentions).values(
          others.map((u) => ({
            messageId: message!.id,
            mentionedUserId: u.id,
          })),
        );
      }

      // Outbox domain event: identifiers only, NEVER message body
      await this.events.event(
        tx,
        'chat.message.created',
        {
          workspaceId: access.project.workspaceId,
          projectId: access.project.id,
          actor,
          entity: { type: 'chat_message', id: message!.id },
        },
        {
          messageId: message!.id,
          sequence: message!.sequence,
          projectId: access.project.id,
          actorId: actor.id,
        },
      );

      if (others.length > 0) {
        await this.events.notify(
          tx,
          actor,
          others.map((u) => ({
            userId: u.id,
            workspaceId: access.project.workspaceId,
            projectId: access.project.id,
            type: 'MENTIONED' as const,
            title: `@${actor.username} mentioned you in #${access.project.key} chat`,
            body: `@${actor.username} mentioned you in chat`,
            resourceType: 'chat_message',
            resourceId: message!.id,
          })),
        );
      }

      return message!.id;
    });

    const [loaded] = await this.load([messageId]);
    return loaded!;
  }

  async list(
    userId: string,
    projectId: string,
    query: ListChatMessagesQuery,
  ): Promise<ProjectMessagePage> {
    await this.projectAccess.require(userId, projectId);

    if (query.around) {
      const [target] = isUuid(query.around)
        ? await this.db
            .select()
            .from(projectMessages)
            .where(
              and(eq(projectMessages.id, query.around), eq(projectMessages.projectId, projectId)),
            )
            .limit(1)
        : [];
      if (!target) throw messageNotFound();

      const half = Math.floor(query.limit / 2);
      const earlierRows = await this.db
        .select({ id: projectMessages.id, sequence: projectMessages.sequence })
        .from(projectMessages)
        .where(
          and(
            eq(projectMessages.projectId, projectId),
            lt(projectMessages.sequence, target.sequence),
          ),
        )
        .orderBy(desc(projectMessages.sequence))
        .limit(half + 1);

      const hasMoreBefore = earlierRows.length > half;
      const beforeIds = earlierRows
        .slice(0, half)
        .reverse()
        .map((r) => r.id);

      const afterLimit = query.limit - beforeIds.length - 1;
      const laterRows = await this.db
        .select({ id: projectMessages.id, sequence: projectMessages.sequence })
        .from(projectMessages)
        .where(
          and(
            eq(projectMessages.projectId, projectId),
            gt(projectMessages.sequence, target.sequence),
          ),
        )
        .orderBy(asc(projectMessages.sequence))
        .limit(afterLimit + 1);

      const hasMoreAfter = laterRows.length > afterLimit;
      const afterIds = laterRows.slice(0, afterLimit).map((r) => r.id);

      const allIds = [...beforeIds, target.id, ...afterIds];
      const messages = await this.load(allIds);

      return {
        messages,
        hasMoreBefore,
        hasMoreAfter,
      };
    }

    if (query.before !== undefined) {
      const rows = await this.db
        .select({ id: projectMessages.id, sequence: projectMessages.sequence })
        .from(projectMessages)
        .where(
          and(eq(projectMessages.projectId, projectId), lt(projectMessages.sequence, query.before)),
        )
        .orderBy(desc(projectMessages.sequence))
        .limit(query.limit + 1);

      const hasMoreBefore = rows.length > query.limit;
      const pageRows = rows.slice(0, query.limit).reverse();
      const messages = await this.load(pageRows.map((r) => r.id));

      return {
        messages,
        hasMoreBefore,
        hasMoreAfter: true,
      };
    }

    if (query.after !== undefined) {
      const rows = await this.db
        .select({ id: projectMessages.id, sequence: projectMessages.sequence })
        .from(projectMessages)
        .where(
          and(eq(projectMessages.projectId, projectId), gt(projectMessages.sequence, query.after)),
        )
        .orderBy(asc(projectMessages.sequence))
        .limit(query.limit + 1);

      const hasMoreAfter = rows.length > query.limit;
      const pageRows = rows.slice(0, query.limit);
      const messages = await this.load(pageRows.map((r) => r.id));

      return {
        messages,
        hasMoreBefore: true,
        hasMoreAfter,
      };
    }

    // Default: latest messages
    const rows = await this.db
      .select({ id: projectMessages.id, sequence: projectMessages.sequence })
      .from(projectMessages)
      .where(eq(projectMessages.projectId, projectId))
      .orderBy(desc(projectMessages.sequence))
      .limit(query.limit + 1);

    const hasMoreBefore = rows.length > query.limit;
    const pageRows = rows.slice(0, query.limit).reverse();
    const messages = await this.load(pageRows.map((r) => r.id));

    return {
      messages,
      hasMoreBefore,
      hasMoreAfter: false,
    };
  }

  async update(
    actor: Actor,
    messageId: string,
    input: UpdateChatMessageInput,
  ): Promise<ProjectMessage> {
    const { message, access } = await this.requireMessage(actor.id, messageId, { write: true });

    if (message.authorId !== actor.id) {
      throw AppException.forbidden('You can only edit your own messages.');
    }

    if (input.taskId) {
      const [task] = await this.db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.id, input.taskId),
            eq(tasks.projectId, message.projectId),
            isNull(tasks.deletedAt),
          ),
        )
        .limit(1);
      if (!task) {
        throw AppException.validation([
          { path: 'taskId', message: 'Task not found in this project.' },
        ]);
      }
    }

    const mentioned =
      input.body !== undefined
        ? await this.projectAccess.audience(access.project, {
            usernames: parseMentions(input.body),
          })
        : null;

    await this.db.transaction(async (tx) => {
      await tx
        .update(projectMessages)
        .set({
          body: input.body ?? message.body,
          taskId: input.taskId !== undefined ? input.taskId : message.taskId,
          editedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(projectMessages.id, message.id));

      if (mentioned !== null) {
        const existing = await tx
          .select({ id: projectMessageMentions.mentionedUserId })
          .from(projectMessageMentions)
          .where(eq(projectMessageMentions.messageId, message.id));
        const existingIds = new Set(existing.map((m) => m.id));
        const nextIds = new Set(mentioned.map((m) => m.id));
        const added = mentioned.filter((m) => !existingIds.has(m.id) && m.id !== actor.id);
        const removed = [...existingIds].filter((id) => !nextIds.has(id));

        if (removed.length > 0) {
          await tx
            .delete(projectMessageMentions)
            .where(
              and(
                eq(projectMessageMentions.messageId, message.id),
                inArray(projectMessageMentions.mentionedUserId, removed),
              ),
            );
        }
        if (added.length > 0) {
          await tx.insert(projectMessageMentions).values(
            added.map((u) => ({
              messageId: message.id,
              mentionedUserId: u.id,
            })),
          );
          await this.events.notify(
            tx,
            actor,
            added.map((u) => ({
              userId: u.id,
              workspaceId: access.project.workspaceId,
              projectId: access.project.id,
              type: 'MENTIONED' as const,
              title: `@${actor.username} mentioned you in #${access.project.key} chat`,
              body: `@${actor.username} mentioned you in chat`,
              resourceType: 'chat_message',
              resourceId: message.id,
            })),
          );
        }
      }

      await this.events.event(
        tx,
        'chat.message.updated',
        {
          workspaceId: access.project.workspaceId,
          projectId: access.project.id,
          actor,
          entity: { type: 'chat_message', id: message.id },
        },
        {
          messageId: message.id,
          sequence: message.sequence,
          projectId: access.project.id,
        },
      );
    });

    const [loaded] = await this.load([message.id]);
    return loaded!;
  }

  async remove(actor: Actor, messageId: string): Promise<void> {
    const { message, access } = await this.requireMessage(actor.id, messageId, { write: true });

    if (message.authorId !== actor.id && !access.canManage) {
      throw AppException.forbidden('You can only delete your own messages.');
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(projectMessages)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(projectMessages.id, message.id));

      await this.events.event(
        tx,
        'chat.message.deleted',
        {
          workspaceId: access.project.workspaceId,
          projectId: access.project.id,
          actor,
          entity: { type: 'chat_message', id: message.id },
        },
        {
          messageId: message.id,
          sequence: message.sequence,
          projectId: access.project.id,
        },
      );
    });
  }

  async markRead(actor: Actor, projectId: string, sequence: number): Promise<ProjectChatReadState> {
    const access = await this.projectAccess.require(actor.id, projectId);

    const row = await this.db.transaction(async (tx) => {
      const [res] = await tx
        .insert(projectChatReads)
        .values({
          projectId,
          userId: actor.id,
          lastReadSequence: sequence,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [projectChatReads.projectId, projectChatReads.userId],
          set: {
            lastReadSequence: sql`GREATEST(${projectChatReads.lastReadSequence}, ${sequence})`,
            updatedAt: new Date(),
          },
        })
        .returning();

      await this.events.event(
        tx,
        'chat.read',
        {
          workspaceId: access.project.workspaceId,
          projectId,
          actor,
          entity: { type: 'user', id: actor.id },
        },
        {
          projectId,
          sequence: res!.lastReadSequence,
          userId: actor.id,
        },
      );

      return res!;
    });

    return {
      projectId: row.projectId,
      userId: row.userId,
      lastReadSequence: row.lastReadSequence,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async getWorkspaceUnread(
    userId: string,
    workspaceId: string,
  ): Promise<ProjectChatUnreadSummary[]> {
    if (!isUuid(workspaceId)) return [];

    const [membership] = await this.db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
          isNull(workspaces.archivedAt),
        ),
      )
      .limit(1);

    if (!membership) return [];

    const canManageAll = membership.role === 'OWNER' || membership.role === 'ADMIN';

    const accessibleProjects = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          canManageAll
            ? undefined
            : inArray(
                projects.id,
                this.db
                  .select({ id: projectMembers.projectId })
                  .from(projectMembers)
                  .where(eq(projectMembers.userId, userId)),
              ),
        ),
      );

    if (accessibleProjects.length === 0) return [];
    const projectIds = accessibleProjects.map((p) => p.id);

    const counts = await this.db
      .select({
        projectId: projects.id,
        unreadCount: sql<number>`coalesce(count(${projectMessages.id}) filter (
          where ${projectMessages.deletedAt} is null
            and (${projectMessages.authorId} is null or ${projectMessages.authorId} != ${userId})
            and ${projectMessages.sequence} > coalesce(${projectChatReads.lastReadSequence}, 0)
        ), 0)::int`,
      })
      .from(projects)
      .leftJoin(
        projectChatReads,
        and(eq(projectChatReads.projectId, projects.id), eq(projectChatReads.userId, userId)),
      )
      .leftJoin(projectMessages, eq(projectMessages.projectId, projects.id))
      .where(inArray(projects.id, projectIds))
      .groupBy(projects.id, projectChatReads.lastReadSequence);

    return counts.map((c) => ({
      projectId: c.projectId,
      unreadCount: Number(c.unreadCount),
    }));
  }

  private async requireMessage(
    userId: string,
    messageId: string,
    options: { write?: boolean } = {},
  ): Promise<{ message: MessageRow; access: ProjectAccess }> {
    const [message] = isUuid(messageId)
      ? await this.db
          .select()
          .from(projectMessages)
          .where(eq(projectMessages.id, messageId))
          .limit(1)
      : [];

    if (!message || message.deletedAt) throw messageNotFound();

    try {
      const access = await this.projectAccess.require(userId, message.projectId, options);
      return { message, access };
    } catch (err) {
      if (err instanceof AppException && err.getStatus() === HttpStatus.NOT_FOUND) {
        throw messageNotFound();
      }
      throw err;
    }
  }

  private async load(ids: string[]): Promise<ProjectMessage[]> {
    if (ids.length === 0) return [];

    const rows = await this.db
      .select({
        message: projectMessages,
        author: userRef,
        task: {
          id: tasks.id,
          taskNumber: tasks.taskNumber,
          title: tasks.title,
          status: tasks.status,
          deletedAt: tasks.deletedAt,
        },
        projectKey: projects.key,
      })
      .from(projectMessages)
      .leftJoin(users, eq(users.id, projectMessages.authorId))
      .leftJoin(tasks, eq(tasks.id, projectMessages.taskId))
      .innerJoin(projects, eq(projects.id, projectMessages.projectId))
      .where(inArray(projectMessages.id, ids));

    const mentionRows = await this.db
      .select({
        messageId: projectMessageMentions.messageId,
        user: userRef,
      })
      .from(projectMessageMentions)
      .innerJoin(users, eq(users.id, projectMessageMentions.mentionedUserId))
      .where(inArray(projectMessageMentions.messageId, ids));

    const mentionsByMessage = new Map<string, UserRef[]>();
    for (const m of mentionRows) {
      if (!m.user.id || !m.user.username) continue;
      const list = mentionsByMessage.get(m.messageId) ?? [];
      list.push({
        id: m.user.id,
        username: m.user.username,
        avatarUrl: m.user.avatarUrl,
      });
      mentionsByMessage.set(m.messageId, list);
    }

    const byId = new Map(
      rows.map((r) => {
        const m = r.message;
        const isDeleted = Boolean(m.deletedAt);
        const liveTask =
          r.task && !r.task.deletedAt && r.task.id && r.task.taskNumber
            ? {
                id: r.task.id,
                key: `${r.projectKey}-${r.task.taskNumber}`,
                title: r.task.title,
                status: r.task.status,
              }
            : null;

        const authorRef: UserRef | null =
          !isDeleted && r.author && r.author.id && r.author.username
            ? {
                id: r.author.id,
                username: r.author.username,
                avatarUrl: r.author.avatarUrl,
              }
            : null;

        const messageObj: ProjectMessage = {
          id: m.id,
          projectId: m.projectId,
          sequence: m.sequence,
          clientRequestId: m.clientRequestId,
          author: authorRef,
          body: isDeleted ? null : m.body,
          deleted: isDeleted,
          edited: Boolean(m.editedAt),
          task: isDeleted ? null : liveTask,
          mentions: isDeleted ? [] : (mentionsByMessage.get(m.id) ?? []),
          createdAt: m.createdAt.toISOString(),
          updatedAt: m.updatedAt.toISOString(),
          editedAt: m.editedAt?.toISOString() ?? null,
        };
        return [m.id, messageObj];
      }),
    );

    return ids.map((id) => byId.get(id)!).filter(Boolean);
  }
}
