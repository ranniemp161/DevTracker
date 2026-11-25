import { Injectable } from '@nestjs/common';
import type { Transaction } from '@devtrack/database';
import type { z } from 'zod';
import { EventRecorder } from '../../events/event-recorder.service';
import { ProjectAccessService } from '../../projects/project-access.service';
import { TaskStatusAutomation } from '../../tasks/task-status-automation.service';
import { RepositoryAccess } from '../access/repository-access.service';
import { checkRun, checkSuite } from './events/checks';
import { installation, installationRepositories } from './events/installation';
import { pullRequest } from './events/pull-request';
import { autoLink, upsertPullRequest } from './events/pull-request-effects';
import { push } from './events/push';
import { release } from './events/release';
import { review } from './events/review';
import { ignored, type EventDeps, type ProcessResult } from './events/shared';
import { GithubChatFeed } from './github-chat-feed.service';
import {
  checkRunEventSchema,
  checkSuiteEventSchema,
  installationEventSchema,
  installationRepositoriesEventSchema,
  pullRequestEventSchema,
  pullRequestReviewEventSchema,
  pushEventSchema,
  releaseEventSchema,
  type PullRequestPayload,
} from './payloads';

export type { ProcessResult } from './events/shared';
export { checksState, stateOf } from './events/pull-request-effects';

/**
 * Applies one GitHub event inside the delivery's transaction (architecture §11.7–§11.10,
 * decision record 0006). Everything is idempotent: entities are upserted by GitHub IDs, and
 * the caller marks the delivery processed in the same transaction, so a retried delivery never
 * duplicates activity, links or notifications.
 *
 * GitHub events move linked tasks forward but never to Done (decision record 0021).
 * Each event's handler lives in its own file under `events/`.
 */
@Injectable()
export class GithubEventProcessor {
  private readonly deps: EventDeps;

  constructor(
    events: EventRecorder,
    projectAccess: ProjectAccessService,
    chat: GithubChatFeed,
    automation: TaskStatusAutomation,
    access: RepositoryAccess,
  ) {
    this.deps = { events, projectAccess, chat, automation, access };
  }

  /**
   * Imports existing pull requests of a connected repository (decision record 0006, M7 fix):
   * stores them with the same out-of-order guard as webhooks and auto-links task keys, but
   * records no activity, outbox events or notifications, because this is history, not news.
   * Returns how many were stored or refreshed; 0 if the repository is not connected.
   */
  async importPullRequests(
    tx: Transaction,
    githubInstallationId: number,
    githubRepositoryId: number,
    pullRequests: PullRequestPayload[],
  ): Promise<number> {
    const target = await this.deps.access.targets(tx, githubInstallationId, githubRepositoryId);
    if (!target) return 0;
    for (const payload of pullRequests) {
      const pr = await upsertPullRequest(tx, target.repo, payload);
      await autoLink(this.deps, tx, target, pr, undefined, { recordActivity: false });
    }
    return pullRequests.length;
  }

  async handle(tx: Transaction, eventType: string, payload: unknown): Promise<ProcessResult> {
    const d = this.deps;
    switch (eventType) {
      case 'push':
        return parse(pushEventSchema, payload, (p) => push(d, tx, p));
      case 'pull_request':
        return parse(pullRequestEventSchema, payload, (p) => pullRequest(d, tx, p));
      case 'pull_request_review':
        return parse(pullRequestReviewEventSchema, payload, (p) => review(d, tx, p));
      case 'release':
        return parse(releaseEventSchema, payload, (p) => release(d, tx, p));
      case 'check_suite':
        return parse(checkSuiteEventSchema, payload, (p) => checkSuite(d, tx, p));
      case 'check_run':
        return parse(checkRunEventSchema, payload, (p) => checkRun(d, tx, p));
      case 'installation':
        return parse(installationEventSchema, payload, (p) => installation(d, tx, p));
      case 'installation_repositories':
        return parse(installationRepositoriesEventSchema, payload, (p) =>
          installationRepositories(d, tx, p),
        );
      default:
        return ignored(`event ${eventType} is not handled`);
    }
  }
}

function parse<S extends z.ZodType>(
  schema: S,
  payload: unknown,
  fn: (parsed: z.infer<S>) => Promise<ProcessResult>,
): Promise<ProcessResult> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return Promise.resolve(ignored('payload does not match the expected shape'));
  return fn(parsed.data);
}
