import { eq, githubInstallations, type Transaction } from '@devtrack/database';
import type { z } from 'zod';
import { installationEventSchema, installationRepositoriesEventSchema } from '../payloads';
import { ignored, PROCESSED, type EventDeps, type ProcessResult } from './shared';

export async function installation(
  deps: EventDeps,
  tx: Transaction,
  p: z.infer<typeof installationEventSchema>,
): Promise<ProcessResult> {
  const [installation] = await tx
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.githubInstallationId, p.installation.id));
  // Installations are bound to workspaces only through the verified install flow (0005).
  if (!installation) return ignored('installation not bound to a workspace');

  switch (p.action) {
    case 'deleted': {
      await tx
        .update(githubInstallations)
        .set({ status: 'REMOVED' })
        .where(eq(githubInstallations.id, installation.id));
      await deps.access.revokeOnGitHub(tx, installation, 'all', 'app_uninstalled');
      return PROCESSED;
    }
    case 'suspend':
      await tx
        .update(githubInstallations)
        .set({ status: 'SUSPENDED', suspendedAt: new Date() })
        .where(eq(githubInstallations.id, installation.id));
      return PROCESSED;
    case 'unsuspend':
      await tx
        .update(githubInstallations)
        .set({ status: 'ACTIVE', suspendedAt: null })
        .where(eq(githubInstallations.id, installation.id));
      return PROCESSED;
    default:
      return ignored(`installation.${p.action} is not handled`);
  }
}

export async function installationRepositories(
  deps: EventDeps,
  tx: Transaction,
  p: z.infer<typeof installationRepositoriesEventSchema>,
): Promise<ProcessResult> {
  if (p.action !== 'removed')
    return ignored(`installation_repositories.${p.action} is not handled`);
  if (p.repositories_removed.length === 0) return ignored('no repositories removed');
  const [installation] = await tx
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.githubInstallationId, p.installation.id));
  const revoked = installation
    ? await deps.access.revokeOnGitHub(
        tx,
        installation,
        p.repositories_removed.map((r) => r.id),
        'access_removed',
      )
    : 0;
  if (revoked === 0) return ignored('removed repositories were not connected');
  return PROCESSED;
}
