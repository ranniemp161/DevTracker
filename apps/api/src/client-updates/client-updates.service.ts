import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  and,
  eq,
  githubReleases,
  inArray,
  isNotNull,
  isNull,
  milestoneGithubReleases,
  milestones,
  ne,
  projects,
  sql,
  taskRequests,
  tasks,
  type Database,
  type SQL,
} from '@devtrack/database';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import { MAILER, type Mailer } from '../mail/mailer';
import { clientUpdateEmail } from '../mail/templates';

type Kind = 'accepted' | 'declined' | 'done' | 'delivered';

const SENT_AT = {
  accepted: taskRequests.acceptedEmailedAt,
  declined: taskRequests.declinedEmailedAt,
  done: taskRequests.doneEmailedAt,
  delivered: taskRequests.deliveredEmailedAt,
} as const;
const SENT_FIELD = {
  accepted: 'acceptedEmailedAt',
  declined: 'declinedEmailedAt',
  done: 'doneEmailedAt',
  delivered: 'deliveredEmailedAt',
} as const;

/** 64 hex characters from two random UUIDs, made by Postgres in the claiming UPDATE. */
const newToken = sql`replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')`;

/**
 * Decision record 0028 §2: status emails to the people who sent requests through the public
 * form. Call these after the change has committed. Each email is claimed (its `*_emailed_at`
 * set) before it's sent, so it goes out at most once; a failed send is logged, never thrown.
 */
@Injectable()
export class ClientUpdatesService {
  private readonly logger = new Logger(ClientUpdatesService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** After Triage accepts or declines a request. */
  async triaged(requestId: string): Promise<void> {
    const [request] = await this.db
      .select({ status: taskRequests.status })
      .from(taskRequests)
      .where(eq(taskRequests.id, requestId));
    if (request?.status === 'accepted') {
      await this.send('accepted', eq(taskRequests.id, requestId));
    } else if (request?.status === 'declined') {
      await this.send('declined', eq(taskRequests.id, requestId));
    }
  }

  /** After tasks move to Done: requests whose task is (still) Done. */
  async tasksDone(taskIds: string[]): Promise<void> {
    if (taskIds.length === 0) return;
    await this.send(
      'done',
      and(
        inArray(taskRequests.taskId, taskIds),
        inArray(
          taskRequests.taskId,
          this.db
            .select({ id: tasks.id })
            .from(tasks)
            .where(and(inArray(tasks.id, taskIds), eq(tasks.status, 'DONE'))),
        ),
      )!,
    );
  }

  /** After a milestone is delivered: requests whose task is in it. */
  async milestoneDelivered(milestoneId: string): Promise<void> {
    await this.send(
      'delivered',
      inArray(
        taskRequests.taskId,
        this.db
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.milestoneId, milestoneId), isNull(tasks.deletedAt))),
      ),
    );
  }

  private async send(kind: Kind, which: SQL): Promise<void> {
    try {
      // Claim first: whoever sets `*_emailed_at` sends the email, exactly once.
      const claimed = await this.db
        .update(taskRequests)
        .set({
          [SENT_FIELD[kind]]: new Date(),
          emailToken: sql`coalesce(${taskRequests.emailToken}, ${newToken})`,
        })
        .where(
          and(
            which,
            // The form and sign-off pages are the client's; team proposals never email.
            inArray(taskRequests.source, ['form', 'signoff']),
            isNotNull(taskRequests.reporterEmail),
            isNull(taskRequests.emailsStoppedAt),
            isNull(SENT_AT[kind]),
            kind === 'done' || kind === 'delivered'
              ? ne(taskRequests.status, 'declined')
              : undefined,
          ),
        )
        .returning({
          id: taskRequests.id,
          taskId: taskRequests.taskId,
          projectId: taskRequests.projectId,
          email: taskRequests.reporterEmail,
          token: taskRequests.emailToken,
          reason: taskRequests.declineReason,
        });
      for (const r of claimed) await this.deliver(kind, r);
    } catch (err) {
      this.logger.error(
        `Failed to prepare ${kind} client emails`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private async deliver(
    kind: Kind,
    r: {
      taskId: string;
      projectId: string;
      email: string | null;
      token: string | null;
      reason: string | null;
    },
  ): Promise<void> {
    try {
      const [row] = await this.db
        .select({
          projectName: projects.name,
          title: tasks.title,
          milestoneId: tasks.milestoneId,
          milestoneName: milestones.name,
        })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .leftJoin(milestones, eq(milestones.id, tasks.milestoneId))
        .where(eq(tasks.id, r.taskId));
      if (!row || !r.email || !r.token) return;
      const releaseTags =
        kind === 'delivered' && row.milestoneId
          ? (
              await this.db
                .select({ tag: githubReleases.tagName })
                .from(milestoneGithubReleases)
                .innerJoin(githubReleases, eq(githubReleases.id, milestoneGithubReleases.releaseId))
                .where(eq(milestoneGithubReleases.milestoneId, row.milestoneId))
            ).map((x) => x.tag)
          : [];
      await this.mailer.send(
        clientUpdateEmail({
          to: r.email,
          projectName: row.projectName,
          requestTitle: row.title,
          kind,
          milestoneName: row.milestoneName,
          reason: kind === 'declined' ? r.reason : null,
          releaseTags,
          // The token travels in the fragment so it never reaches server logs (as for sign-in links).
          stopUrl: `${this.config.webOrigin}/u#token=${encodeURIComponent(r.token)}`,
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to send a ${kind} client email`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /** The "Stop emails about this request" link. Unknown tokens are ignored without saying so. */
  async stop(token: string): Promise<void> {
    if (!/^[0-9a-f]{64}$/.test(token)) return;
    await this.db
      .update(taskRequests)
      .set({ emailsStoppedAt: new Date() })
      .where(and(eq(taskRequests.emailToken, token), isNull(taskRequests.emailsStoppedAt)));
  }
}
