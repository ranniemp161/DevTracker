import { randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  alias,
  and,
  desc,
  eq,
  inArray,
  isNull,
  labels,
  lt,
  ne,
  or,
  projects,
  sql,
  taskLabels,
  taskRequests,
  tasks,
  users,
  type Database,
  type SQL,
  type Transaction,
} from '@devtrack/database';
import {
  ErrorCode,
  type ProjectIntake,
  type PublicIntakeInfo,
  type RequestKind,
  type RequestSource,
  type RequestUpload,
  type TaskRequest,
} from '@devtrack/types';
import type { ListRequestsQuery, ProposeTaskInput, SubmitRequestInput } from '@devtrack/validators';
import { AppException } from '../common/errors/app.exception';
import { DATABASE } from '../database/database.module';
import { EventRecorder, type Actor } from '../events/event-recorder.service';
import { ProjectAccessService, type ProjectRow } from '../projects/project-access.service';
import { RATE_LIMITS, RateLimitService } from '../rate-limit/rate-limit.service';
import { TaskAttachmentsService } from '../tasks/task-attachments.service';
import { TaskStatusAutomation } from '../tasks/task-status-automation.service';
import { TurnstileVerifier } from './turnstile.service';

const DAY = 24 * 60 * 60 * 1000;
/** The proposing member, joined beside the triager (both are `users`). */
const reporters = alias(users, 'reporters');
/** Reporter contact details are deleted this long after the task is done or declined (0016 §5). */
export const REQUEST_CONTACT_RETENTION_DAYS = 90;

/** Workspace label each kind gets, created on first use. */
const KIND_LABEL: Record<RequestKind, { name: string; color: string }> = {
  request: { name: 'Request', color: '#ca8a04' },
  bug: { name: 'Bug', color: '#dc2626' },
};

const formNotFound = () =>
  new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'This form is not available.');
const projectArchived = () =>
  new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.PROJECT_ARCHIVED,
    'This project is archived and read-only.',
  );
const requestNotFound = () =>
  new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Request not found.');

/** Public request forms and Triage (decision record 0016). */
@Injectable()
export class RequestsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: ProjectAccessService,
    private readonly events: EventRecorder,
    private readonly rateLimit: RateLimitService,
    private readonly turnstile: TurnstileVerifier,
    private readonly automation: TaskStatusAutomation,
    private readonly attachments: TaskAttachmentsService,
  ) {}

  // ------------------------------------------------------------ public form

  async form(token: string): Promise<PublicIntakeInfo> {
    const project = await this.openForm(token);
    return { projectName: project.name, uploadsEnabled: this.attachments.uploadsEnabled };
  }

  /**
   * Creates the request's task. Returns one presigned upload per declared file (0022), or
   * none for the honeypot or when media storage isn't configured.
   */
  async submit(token: string, input: SubmitRequestInput, ip: string): Promise<RequestUpload[]> {
    const project = await this.openForm(token);
    await this.rateLimit.consume(RATE_LIMITS.requestSubmitPerIp, ip);
    await this.rateLimit.consume(RATE_LIMITS.requestSubmitPerForm, project.id);
    // Honeypot: look accepted, store nothing.
    if (input.website) return [];
    if (!(await this.turnstile.verify(input.turnstileToken, ip))) {
      throw AppException.validation([
        { path: 'turnstileToken', message: 'Please complete the check and try again.' },
      ]);
    }
    const files = this.attachments.uploadsEnabled ? input.attachments : [];
    for (let i = 0; i < files.length; i++) {
      await this.rateLimit.consume(RATE_LIMITS.requestFilesPerIp, ip);
    }

    return this.db.transaction(async (tx) => {
      const taskId = await this.createRequest(tx, project, input, {
        actor: null,
        reporterName: input.name ?? null,
        reporterEmail: input.email ?? null,
      });
      if (!taskId) throw formNotFound();
      return this.attachments.prepareForRequest(tx, taskId, files);
    });
  }

  /**
   * A member's proposal (0023 §3): only while internal triage is in effect, which means the
   * setting is on and the project has a lead. The task's reporter is the member.
   */
  async propose(actor: Actor, projectId: string, input: ProposeTaskInput): Promise<{ id: string }> {
    const { project, internalTriageInEffect } = await this.access.require(actor.id, projectId, {
      write: true,
    });
    if (!internalTriageInEffect) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INTERNAL_TRIAGE_OFF,
        'This project takes new tasks directly; there is nothing to propose to.',
      );
    }
    return this.db.transaction(async (tx) => {
      const taskId = await this.createRequest(tx, project, input, { actor });
      if (!taskId) throw projectArchived();
      return { id: taskId };
    });
  }

  /**
   * Creates a request's Backlog task, its kind label, the request row, the activity entry and
   * the notification to the people who triage. Returns null if the project was archived meanwhile.
   */
  private async createRequest(
    tx: Transaction,
    project: Pick<ProjectRow, 'id' | 'key' | 'workspaceId'>,
    input: { kind: RequestKind; title: string; description?: string },
    from:
      { actor: null; reporterName: string | null; reporterEmail: string | null } | { actor: Actor },
  ): Promise<string | null> {
    const [allocated] = await tx
      .update(projects)
      .set({ nextTaskNumber: sql`${projects.nextTaskNumber} + 1` })
      .where(and(eq(projects.id, project.id), ne(projects.status, 'ARCHIVED')))
      .returning({ number: sql<number>`${projects.nextTaskNumber} - 1` });
    if (!allocated) return null;

    const [task] = await tx
      .insert(tasks)
      .values({
        projectId: project.id,
        taskNumber: allocated.number,
        title: input.title,
        description: input.description ?? null,
        status: 'BACKLOG',
        priority: 'MEDIUM',
        reporterId: from.actor?.id ?? null,
      })
      .returning();
    const labelId = await this.kindLabel(tx, project.workspaceId, input.kind);
    await tx.insert(taskLabels).values({ taskId: task!.id, labelId });

    const [request] = await tx
      .insert(taskRequests)
      .values({
        taskId: task!.id,
        projectId: project.id,
        kind: input.kind,
        ...(from.actor
          ? { source: 'internal', reporterUserId: from.actor.id }
          : { source: 'form', reporterName: from.reporterName, reporterEmail: from.reporterEmail }),
      })
      .returning({ id: taskRequests.id });

    const key = `${project.key}-${task!.taskNumber}`;
    await this.events.activity(tx, {
      workspaceId: project.workspaceId,
      projectId: project.id,
      taskId: task!.id,
      entity: { type: 'task', id: task!.id },
      actor: from.actor,
      action: 'task.created',
      // Never the reporter's contact details.
      metadata: {
        key,
        title: task!.title,
        status: 'BACKLOG',
        source: from.actor ? 'proposal' : 'request_form',
      },
      event: { type: 'task.created', payload: { taskId: task!.id, status: 'BACKLOG' } },
    });

    // 0023 §4: the project's leads hear about it; without leads, the workspace's admins do.
    const managers = await this.access.responsible(project, tx);
    const what = input.kind === 'bug' ? 'bug report' : 'request';
    // A proposal never notifies its own reporter (the actor is skipped).
    await this.events.notify(
      tx,
      from.actor,
      managers.map((m) => ({
        userId: m.id,
        workspaceId: project.workspaceId,
        projectId: project.id,
        type: 'REQUEST_SUBMITTED' as const,
        title: `New ${what} in ${project.key}: ${truncate(input.title, 120)}`,
        body: null,
        resourceType: 'task_request',
        resourceId: request!.id,
      })),
    );
    return task!.id;
  }

  /** Completes one file a sender declared on this form (0022 §3). */
  async completeUpload(token: string, attachmentId: string): Promise<{ id: string }> {
    const project = await this.openForm(token);
    return this.attachments.completeForRequest(project.id, attachmentId);
  }

  // ----------------------------------------------------------------- triage

  async list(userId: string, projectId: string, query: ListRequestsQuery): Promise<TaskRequest[]> {
    const { project } = await this.access.require(userId, projectId, { triage: true });
    return this.load(project, [
      eq(taskRequests.status, query.status),
      query.source ? eq(taskRequests.source, query.source) : undefined,
    ]);
  }

  /**
   * 0023 §5: a member's own proposals in every status, declined ones included. Anyone on the
   * project may ask, and sees only their own.
   */
  async mine(userId: string, projectId: string): Promise<TaskRequest[]> {
    const { project } = await this.access.require(userId, projectId);
    return this.load(project, [
      eq(taskRequests.source, 'internal'),
      eq(taskRequests.reporterUserId, userId),
    ]);
  }

  private async load(
    project: Pick<ProjectRow, 'id' | 'key'>,
    conditions: (SQL | undefined)[],
  ): Promise<TaskRequest[]> {
    const projectId = project.id;
    const rows = await this.db
      .select({
        request: taskRequests,
        task: {
          id: tasks.id,
          number: tasks.taskNumber,
          title: tasks.title,
          status: tasks.status,
          deletedAt: tasks.deletedAt,
        },
        triager: { id: users.id, username: users.username },
        reporter: {
          id: reporters.id,
          username: reporters.username,
          avatarUrl: reporters.avatarUrl,
        },
      })
      .from(taskRequests)
      .innerJoin(tasks, eq(tasks.id, taskRequests.taskId))
      .leftJoin(users, eq(users.id, taskRequests.triagedBy))
      .leftJoin(reporters, eq(reporters.id, taskRequests.reporterUserId))
      .where(and(eq(taskRequests.projectId, projectId), ...conditions))
      .orderBy(desc(taskRequests.createdAt))
      .limit(200);
    const files = await this.attachments.completedFor(
      rows.filter((r) => !r.task.deletedAt).map((r) => r.task.id),
    );

    return rows.map(({ request: r, task, triager, reporter }) => ({
      id: r.id,
      projectId: r.projectId,
      kind: r.kind as RequestKind,
      status: r.status as TaskRequest['status'],
      source: r.source as RequestSource,
      reporter:
        reporter?.id && reporter.username
          ? { id: reporter.id, username: reporter.username, avatarUrl: reporter.avatarUrl }
          : null,
      task: task.deletedAt
        ? null
        : {
            id: task.id,
            key: `${project.key}-${task.number}`,
            title: task.title,
            status: task.status,
          },
      reporterName: r.reporterName,
      reporterEmail: r.reporterEmail,
      contactDeleted: Boolean(r.contactDeletedAt),
      triagedBy:
        triager?.id && triager.username ? { id: triager.id, username: triager.username } : null,
      triagedAt: r.triagedAt?.toISOString() ?? null,
      declineReason: r.declineReason,
      createdAt: r.createdAt.toISOString(),
      attachments: task.deletedAt ? [] : (files.get(task.id) ?? []),
    }));
  }

  /** Accepting moves a still-Backlog task to To do (decision record 0021). */
  async accept(actor: Actor, requestId: string): Promise<void> {
    const { request, project } = await this.requireNew(actor.id, requestId);
    await this.db.transaction(async (tx) => {
      await tx
        .update(taskRequests)
        .set({ status: 'accepted', triagedBy: actor.id, triagedAt: new Date() })
        .where(eq(taskRequests.id, request.id));
      await this.automation.advanceByIds(tx, project, [request.taskId], 'TODO', {
        trigger: 'request',
      });
      await this.tellReporter(tx, actor, project, request, 'accepted', null);
    });
  }

  /** Declining soft-deletes the task (0003); the request row stays for the form's history. */
  async decline(actor: Actor, requestId: string, reason: string | null): Promise<void> {
    const { request, project } = await this.requireNew(actor.id, requestId);
    await this.db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .update(taskRequests)
        .set({ status: 'declined', triagedBy: actor.id, triagedAt: now, declineReason: reason })
        .where(eq(taskRequests.id, request.id));
      await this.tellReporter(tx, actor, project, request, 'declined', reason);
      const [task] = await tx
        .update(tasks)
        .set({ deletedAt: now })
        .where(and(eq(tasks.id, request.taskId), isNull(tasks.deletedAt)))
        .returning();
      if (!task) return;
      await this.events.activity(tx, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        taskId: task.id,
        entity: { type: 'task', id: task.id },
        actor,
        action: 'task.deleted',
        metadata: { key: `${project.key}-${task.taskNumber}`, title: task.title },
        event: { type: 'task.deleted', payload: { taskId: task.id } },
      });
    });
  }

  // --------------------------------------------------------- form settings

  async setIntake(actor: Actor, projectId: string, enabled: boolean): Promise<ProjectIntake> {
    const { project } = await this.access.require(actor.id, projectId, { manage: true });
    const token = enabled ? (project.intakeToken ?? newToken()) : project.intakeToken;
    await this.db
      .update(projects)
      .set({ intakeEnabled: enabled, intakeToken: token })
      .where(eq(projects.id, projectId));
    return { enabled, token: enabled ? token : null };
  }

  /** A new link; the old one stops working at once. */
  async rotateIntake(actor: Actor, projectId: string): Promise<ProjectIntake> {
    const { project } = await this.access.require(actor.id, projectId, { manage: true });
    const token = newToken();
    await this.db.update(projects).set({ intakeToken: token }).where(eq(projects.id, projectId));
    return { enabled: project.intakeEnabled, token: project.intakeEnabled ? token : null };
  }

  // ------------------------------------------------------------- retention

  /** Deletes reporter contact details 90 days after the task is done or declined. */
  async deleteOldContacts(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - REQUEST_CONTACT_RETENTION_DAYS * DAY);
    const doneTasks = this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.status, 'DONE'), lt(tasks.completedAt, cutoff)));
    const rows = await this.db
      .update(taskRequests)
      .set({ reporterName: null, reporterEmail: null, contactDeletedAt: now })
      .where(
        and(
          isNull(taskRequests.contactDeletedAt),
          or(
            and(eq(taskRequests.status, 'declined'), lt(taskRequests.triagedAt, cutoff)),
            inArray(taskRequests.taskId, doneTasks),
          ),
        ),
      )
      .returning({ id: taskRequests.id });
    return rows.length;
  }

  // ---------------------------------------------------------------- helpers

  private async openForm(token: string) {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw formNotFound();
    const [project] = await this.db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.intakeToken, token),
          eq(projects.intakeEnabled, true),
          ne(projects.status, 'ARCHIVED'),
        ),
      );
    if (!project) throw formNotFound();
    return project;
  }

  /**
   * 0023 §5: a proposal's member hears the outcome (the actor is skipped). Form reporters have
   * no account, so they hear nothing.
   */
  private async tellReporter(
    tx: Transaction,
    actor: Actor,
    project: Pick<ProjectRow, 'id' | 'workspaceId'>,
    request: Pick<typeof taskRequests.$inferSelect, 'id' | 'taskId' | 'reporterUserId'>,
    outcome: 'accepted' | 'declined',
    reason: string | null,
  ): Promise<void> {
    if (!request.reporterUserId) return;
    const [task] = await tx
      .select({ title: tasks.title })
      .from(tasks)
      .where(eq(tasks.id, request.taskId));
    const title = truncate(task?.title ?? 'your proposal', 120);
    await this.events.notify(tx, actor, [
      {
        userId: request.reporterUserId,
        workspaceId: project.workspaceId,
        projectId: project.id,
        type: 'REQUEST_TRIAGED',
        title: outcome === 'accepted' ? `Accepted: ${title}` : `Declined: ${title}`,
        body: reason,
        // Accepted: the task. Declined: the task is gone, so the proposal list.
        resourceType: outcome === 'accepted' ? 'task' : 'task_request',
        resourceId: outcome === 'accepted' ? request.taskId : request.id,
      },
    ]);
  }

  private async requireNew(userId: string, requestId: string) {
    const [request] = await this.db
      .select()
      .from(taskRequests)
      .where(eq(taskRequests.id, requestId));
    if (!request) throw requestNotFound();
    const { project } = await this.access.require(userId, request.projectId, { triage: true });
    if (request.status !== 'new') {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        'This request was already triaged.',
      );
    }
    return { request, project };
  }

  private async kindLabel(
    tx: Transaction,
    workspaceId: string,
    kind: RequestKind,
  ): Promise<string> {
    const { name, color } = KIND_LABEL[kind];
    const find = () =>
      tx
        .select({ id: labels.id })
        .from(labels)
        .where(
          and(eq(labels.workspaceId, workspaceId), sql`lower(${labels.name}) = lower(${name})`),
        );
    const [existing] = await find();
    if (existing) return existing.id;
    await tx.insert(labels).values({ workspaceId, name, color }).onConflictDoNothing();
    const [created] = await find();
    return created!.id;
  }
}

const newToken = () => randomBytes(32).toString('base64url');
const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
