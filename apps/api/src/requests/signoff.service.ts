import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  asc,
  desc,
  eq,
  githubReleases,
  milestoneCriteria,
  milestoneGithubReleases,
  milestones,
  projects,
  type Database,
} from '@devtrack/database';
import { ErrorCode, type PublicSignoff } from '@devtrack/types';
import type { ApproveSignoffInput, RequestSignoffChangesInput } from '@devtrack/validators';
import { AppException } from '../common/errors/app.exception';
import { DATABASE } from '../database/database.module';
import { EventRecorder } from '../events/event-recorder.service';
import { ProjectAccessService } from '../projects/project-access.service';
import { RATE_LIMITS, RateLimitService } from '../rate-limit/rate-limit.service';
import { RequestsService } from './requests.service';
import { TurnstileVerifier } from './turnstile.service';

const linkNotFound = () =>
  new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'This review link is no longer active. Ask the team for a new one.',
  );

/**
 * Decision record 0028 §3–§4: the client's sign-off page. The token is the only key; the page
 * works only while the milestone is in Client review, and shows nothing beyond §3's list.
 */
@Injectable()
export class SignoffService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: ProjectAccessService,
    private readonly events: EventRecorder,
    private readonly rateLimit: RateLimitService,
    private readonly turnstile: TurnstileVerifier,
    private readonly requests: RequestsService,
  ) {}

  async page(token: string): Promise<PublicSignoff> {
    const { milestone, project } = await this.open(token);
    const [criteria, releases] = await Promise.all([
      this.db
        .select({ text: milestoneCriteria.text, doneAt: milestoneCriteria.doneAt })
        .from(milestoneCriteria)
        .where(eq(milestoneCriteria.milestoneId, milestone.id))
        .orderBy(asc(milestoneCriteria.position), asc(milestoneCriteria.createdAt)),
      this.db
        .select({ tag: githubReleases.tagName, url: githubReleases.url })
        .from(milestoneGithubReleases)
        .innerJoin(githubReleases, eq(githubReleases.id, milestoneGithubReleases.releaseId))
        .where(eq(milestoneGithubReleases.milestoneId, milestone.id))
        .orderBy(desc(githubReleases.publishedAt)),
    ]);
    return {
      projectName: project.name,
      milestone: {
        name: milestone.name,
        description: milestone.description,
        dueDate: milestone.dueDate,
        criteria: criteria.map((c) => ({ text: c.text, done: c.doneAt !== null })),
        releases,
        approvedAt: milestone.clientApprovedAt?.toISOString() ?? null,
      },
    };
  }

  /** 0028 §4: records the approval and tells the lead. Never moves the stage. */
  async approve(token: string, input: ApproveSignoffInput, ip: string): Promise<void> {
    const { milestone, project } = await this.open(token);
    await this.rateLimit.consume(RATE_LIMITS.signoffPerIp, ip);
    await this.rateLimit.consume(RATE_LIMITS.signoffPerLink, milestone.id);
    // Honeypot: look accepted, store nothing.
    if (input.website) return;
    if (!(await this.turnstile.verify(input.turnstileToken, ip))) {
      throw AppException.validation([
        { path: 'turnstileToken', message: 'Please complete the check and try again.' },
      ]);
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(milestones)
        .set({
          clientApprovedAt: new Date(),
          clientApprovedName: input.name ?? null,
          clientApprovedNote: input.note ?? null,
        })
        .where(eq(milestones.id, milestone.id));
      await this.events.activity(tx, {
        workspaceId: project.workspaceId,
        projectId: project.id,
        entity: { type: 'milestone', id: milestone.id },
        actor: null,
        action: 'milestone.client_approved',
        // The client's name, never their note (free text stays out of activity, 0004 §3).
        metadata: { name: milestone.name, by: input.name ?? null },
      });
      const people = await this.access.responsible(project, tx);
      await this.events.notify(
        tx,
        null,
        people.map((p) => ({
          userId: p.id,
          workspaceId: project.workspaceId,
          projectId: project.id,
          type: 'MILESTONE_CLIENT_APPROVED' as const,
          title: `${input.name ?? 'The client'} approved "${milestone.name}" in ${project.key}`,
          body: input.note ?? null,
          resourceType: 'milestone',
          resourceId: milestone.id,
        })),
      );
    });
  }

  /**
   * 0028 §4: the client's note becomes a request in Triage ("Request" label, Backlog), linked to
   * the milestone, so the lead triages it like any other. Their email gets the §2 updates.
   */
  async requestChanges(
    token: string,
    input: RequestSignoffChangesInput,
    ip: string,
  ): Promise<void> {
    const { milestone, project } = await this.open(token);
    await this.rateLimit.consume(RATE_LIMITS.signoffPerIp, ip);
    await this.rateLimit.consume(RATE_LIMITS.signoffPerLink, milestone.id);
    if (input.website) return;
    if (!(await this.turnstile.verify(input.turnstileToken, ip))) {
      throw AppException.validation([
        { path: 'turnstileToken', message: 'Please complete the check and try again.' },
      ]);
    }
    const title = `Changes requested on ${milestone.name}`.slice(0, 200);
    await this.db.transaction(async (tx) => {
      const taskId = await this.requests.createRequest(
        tx,
        project,
        { kind: 'request', title, description: input.note },
        {
          actor: null,
          reporterName: input.name ?? null,
          reporterEmail: input.email ?? null,
          signoffMilestoneId: milestone.id,
        },
      );
      if (!taskId) throw linkNotFound();
    });
  }

  private async open(token: string) {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw linkNotFound();
    const [row] = await this.db
      .select({ milestone: milestones, project: projects })
      .from(milestones)
      .innerJoin(projects, eq(projects.id, milestones.projectId))
      .where(eq(milestones.signoffToken, token))
      .limit(1);
    if (!row || row.milestone.status !== 'CLIENT_REVIEW' || row.project.status === 'ARCHIVED') {
      throw linkNotFound();
    }
    return row;
  }
}
