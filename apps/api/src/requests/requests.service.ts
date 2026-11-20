import { randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
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
  workspaceMembers,
  type Database,
  type Transaction,
} from '@devtrack/database';
import {
  ErrorCode,
  type ProjectIntake,
  type PublicIntakeInfo,
  type RequestKind,
  type TaskRequest,
} from '@devtrack/types';
import type { ListRequestsQuery, SubmitRequestInput } from '@devtrack/validators';
import { AppException } from '../common/errors/app.exception';
import { DATABASE } from '../database/database.module';
import { EventRecorder, type Actor } from '../events/event-recorder.service';
import { ProjectAccessService } from '../projects/project-access.service';
import { RATE_LIMITS, RateLimitService } from '../rate-limit/rate-limit.service';
import { TurnstileVerifier } from './turnstile.service';

const DAY = 24 * 60 * 60 * 1000;
/** Reporter contact details are deleted this long after the task is done or declined (0016 §5). */
export const REQUEST_CONTACT_RETENTION_DAYS = 90;

/** Workspace label each kind gets, created on first use. */
const KIND_LABEL: Record<RequestKind, { name: string; color: string }> = {
  request: { name: 'Request', color: '#ca8a04' },
  bug: { name: 'Bug', color: '#dc2626' },
};

const formNotFound = () =>
  new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'This form is not available.');
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
  ) {}

  // ------------------------------------------------------------ public form

  async form(token: string): Promise<PublicIntakeInfo> {
    const project = await this.openForm(token);
    return { projectName: project.name };
  }

  async submit(token: string, input: SubmitRequestInput, ip: string): Promise<void> {
    const project = await this.openForm(token);
    await this.rateLimit.consume(RATE_LIMITS.requestSubmitPerIp, ip);
    await this.rateLimit.consume(RATE_LIMITS.requestSubmitPerForm, project.id);
    // Honeypot: look accepted, store nothing.
    if (input.website) return;
    if (!(await this.turnstile.verify(input.turnstileToken, ip))) {
      throw AppException.validation([
        { path: 'turnstileToken', message: 'Please complete the check and try again.' },
      ]);
    }

    await this.db.transaction(async (tx) => {
      const [allocated] = await tx
        .update(projects)
        .set({ nextTaskNumber: sql`${projects.nextTaskNumber} + 1` })
        .where(and(eq(projects.id, project.id), ne(projects.status, 'ARCHIVED')))
        .returning({ number: sql<number>`${projects.nextTaskNumber} - 1` });
      if (!allocated) throw formNotFound();

      const [task] = await tx
        .insert(tasks)
        .values({
          projectId: project.id,
          taskNumber: allocated.number,
          title: input.title,
          description: input.description ?? null,
          status: 'BACKLOG',
          priority: 'MEDIUM',
          reporterId: null,
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
          reporterName: input.name ?? null,
          reporterEmail: input.email ?? null,
        })
        .returning({ id: taskRequests.id });

      const key = `${project.key}-${task!.taskNumber}`;
      await this.events.activity(tx, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        taskId: task!.id,
        entity: { type: 'task', id: task!.id },
        actor: null,
        action: 'task.created',
        // Never the reporter's contact details.
        metadata: { key, title: task!.title, status: 'BACKLOG', source: 'request_form' },
        event: { type: 'task.created', payload: { taskId: task!.id, status: 'BACKLOG' } },
      });

      const managers = await tx
        .select({ id: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, project.workspaceId),
            inArray(workspaceMembers.role, ['OWNER', 'ADMIN']),
          ),
        );
      const what = input.kind === 'bug' ? 'bug report' : 'request';
      await this.events.notify(
        tx,
        null,
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
    });
  }

  // ----------------------------------------------------------------- triage

  async list(userId: string, projectId: string, query: ListRequestsQuery): Promise<TaskRequest[]> {
    const { project } = await this.access.require(userId, projectId, { write: true });
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
      })
      .from(taskRequests)
      .innerJoin(tasks, eq(tasks.id, taskRequests.taskId))
      .leftJoin(users, eq(users.id, taskRequests.triagedBy))
      .where(and(eq(taskRequests.projectId, projectId), eq(taskRequests.status, query.status)))
      .orderBy(desc(taskRequests.createdAt))
      .limit(200);

    return rows.map(({ request: r, task, triager }) => ({
      id: r.id,
      projectId: r.projectId,
      kind: r.kind as RequestKind,
      status: r.status as TaskRequest['status'],
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
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async accept(actor: Actor, requestId: string): Promise<void> {
    const { request } = await this.requireNew(actor.id, requestId);
    await this.db
      .update(taskRequests)
      .set({ status: 'accepted', triagedBy: actor.id, triagedAt: new Date() })
      .where(eq(taskRequests.id, request.id));
  }

  /** Declining soft-deletes the task (0003); the request row stays for the form's history. */
  async decline(actor: Actor, requestId: string): Promise<void> {
    const { request, project } = await this.requireNew(actor.id, requestId);
    await this.db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .update(taskRequests)
        .set({ status: 'declined', triagedBy: actor.id, triagedAt: now })
        .where(eq(taskRequests.id, request.id));
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

  private async requireNew(userId: string, requestId: string) {
    const [request] = await this.db
      .select()
      .from(taskRequests)
      .where(eq(taskRequests.id, requestId));
    if (!request) throw requestNotFound();
    const { project } = await this.access.require(userId, request.projectId, { write: true });
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
