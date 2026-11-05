import { z } from 'zod';
import { emailSchema, tokenSchema } from './auth.js';

export const workspaceNameSchema = z
  .string({ error: 'Workspace name is required.' })
  .trim()
  .min(1, { error: 'Workspace name is required.' })
  .max(80, { error: 'Workspace name must be at most 80 characters.' });

export const createWorkspaceSchema = z.object({ name: workspaceNameSchema });
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z.object({ name: workspaceNameSchema });
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;

/** OWNER is never assignable: there is exactly one owner, set at creation (M2 rule 2). */
export const assignableRoleSchema = z.enum(['ADMIN', 'MEMBER'], {
  error: 'Role must be ADMIN or MEMBER.',
});

export const createInvitationSchema = z.object({
  email: emailSchema,
  role: assignableRoleSchema,
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const changeMemberRoleSchema = z.object({ role: assignableRoleSchema });
export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;

export const acceptInvitationSchema = z.object({ token: tokenSchema });
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

/**
 * URL-safe slug from a workspace name: lower-case ASCII letters, digits and single hyphens,
 * 1–48 characters. Falls back to `workspace` when nothing usable remains.
 */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || 'workspace';
}
