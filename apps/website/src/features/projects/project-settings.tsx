'use client';

import { CHAT_GITHUB_EVENTS, type ChatGithubEvent, type ProjectIntake } from '@devtrack/types';
import { updateProjectSchema } from '@devtrack/validators';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Alert, Button, SettingsSection, Field, Select, SubmitButton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuthForm } from '../auth/use-auth-form';
import { ProjectRepositories } from '../github/project-repositories';
import { ProjectMembers } from './project-members';
import { PROJECT_STATUS_LABEL } from './labels';
import { useProject } from './project-context';

export function ProjectSettings() {
  const { project, readOnly } = useProject();
  if (!project.viewerCanManage)
    return <Alert>Only workspace admins can change project settings.</Alert>;
  if (readOnly) return <Alert tone="info">Archived projects cannot be edited.</Alert>;
  return (
    <div>
      <GeneralCard />
      <ProjectMembers />
      <ProjectRepositories />
      <RequestFormCard />
      <ChatGithubCard />
      <ArchiveCard />
    </div>
  );
}

const CHAT_GITHUB_EVENT_TEXT: Record<ChatGithubEvent, { label: string; hint: string }> = {
  'pull_request.opened': { label: 'Pull request opened', hint: 'Also when one is reopened.' },
  'pull_request.merged': { label: 'Pull request merged', hint: '' },
  'pull_request.closed': { label: 'Pull request closed', hint: 'Closed without merging.' },
  'review.changes_requested': { label: 'Changes requested', hint: 'A review asks for changes.' },
  'review.approved': { label: 'Pull request approved', hint: '' },
  'release.published': { label: 'Release published', hint: '' },
  'checks.failed': { label: 'Checks failed', hint: 'CI fails on a pull request.' },
};

/** Which GitHub events post to this project's chat (decision record 0014). */
function ChatGithubCard() {
  const { project, reload } = useProject();
  const [selected, setSelected] = useState<ChatGithubEvent[]>(project.chatGithubEvents ?? []);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | { error: string }>('idle');
  const dirty = [...selected].sort().join() !== [...(project.chatGithubEvents ?? [])].sort().join();

  async function save() {
    setState('saving');
    try {
      await api(`/projects/${project.id}`, {
        method: 'PATCH',
        body: { chatGithubEvents: selected },
      });
      setState('saved');
      reload();
    } catch (err) {
      setState({ error: err instanceof ApiError ? err.message : 'Could not save.' });
    }
  }

  return (
    <SettingsSection
      id="github-chat"
      title="GitHub updates in chat"
      description="Post these events from connected repositories to the project chat. They count as unread but never send phone notifications."
    >
      <fieldset className="max-w-md space-y-3">
        <legend className="sr-only">Events to post</legend>
        {CHAT_GITHUB_EVENTS.map((event) => (
          <label key={event} className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={selected.includes(event)}
              onChange={(e) =>
                setSelected((list) =>
                  e.target.checked ? [...list, event] : list.filter((x) => x !== event),
                )
              }
            />
            <span>
              <span className="block font-medium text-fg">
                {CHAT_GITHUB_EVENT_TEXT[event].label}
              </span>
              {CHAT_GITHUB_EVENT_TEXT[event].hint ? (
                <span className="block text-label text-fg-muted">
                  {CHAT_GITHUB_EVENT_TEXT[event].hint}
                </span>
              ) : null}
            </span>
          </label>
        ))}
      </fieldset>
      {typeof state === 'object' ? (
        <div className="mt-4">
          <Alert>{state.error}</Alert>
        </div>
      ) : null}
      <div className="mt-4 flex items-center gap-3">
        <Button variant="primary" disabled={!dirty} loading={state === 'saving'} onClick={save}>
          Save
        </Button>
        {state === 'saved' && !dirty ? (
          <span className="text-label text-status-done-fg">Saved.</span>
        ) : null}
      </div>
    </SettingsSection>
  );
}

/** Public request form (decision record 0016): turn it on, copy the link, or replace it. */
function RequestFormCard() {
  const { project, reload } = useProject();
  const [intake, setIntake] = useState(project.intake ?? { enabled: false, token: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const url =
    intake.enabled && intake.token && typeof window !== 'undefined'
      ? `${window.location.origin}/r/${intake.token}`
      : null;

  async function change(run: () => Promise<{ intake: ProjectIntake }>) {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      setIntake((await run()).intake);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the form.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSection
      id="request-form"
      title="Request form"
      description="A public link where clients and other teams can report bugs or ask for changes, without an account. Each submission lands in Triage as a Backlog task."
    >
      <div className="max-w-md space-y-4">
        {error ? <Alert>{error}</Alert> : null}
        <label className="flex items-center gap-2.5 text-sm font-medium text-fg">
          <input
            type="checkbox"
            checked={intake.enabled}
            disabled={busy}
            onChange={(e) =>
              change(() =>
                api(`/projects/${project.id}/intake`, {
                  method: 'PUT',
                  body: { enabled: e.target.checked },
                }),
              )
            }
          />
          Accept requests through a public link
        </label>
        {url ? (
          <div className="space-y-2">
            <p className="text-label text-fg-muted">Anyone with this link can send a request.</p>
            <div className="flex flex-wrap gap-2">
              <input
                readOnly
                aria-label="Request form link"
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="h-9 min-w-0 flex-1 rounded-control border border-line bg-bg px-3 font-mono text-xs text-fg-muted"
              />
              <Button
                onClick={async () => {
                  await navigator.clipboard.writeText(url).catch(() => undefined);
                  setCopied(true);
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirmReplace(true)}
            >
              Replace link
            </Button>
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmReplace}
        title="Replace the request form link?"
        confirmLabel="Replace link"
        onConfirm={() => {
          setConfirmReplace(false);
          void change(() => api(`/projects/${project.id}/intake/rotate`, { method: 'POST' }));
        }}
        onCancel={() => setConfirmReplace(false)}
      >
        The current link stops working at once. Share the new one with whoever should have it.
      </ConfirmDialog>
    </SettingsSection>
  );
}

/** Blank date inputs mean "clear the date" (null), which the shared schema accepts. */
const settingsSchema = z.preprocess((v) => {
  if (!v || typeof v !== 'object') return v;
  const values = v as Record<string, string>;
  return { ...values, startDate: values.startDate || null, targetDate: values.targetDate || null };
}, updateProjectSchema);

function GeneralCard() {
  const { project, reload } = useProject();
  const [saved, setSaved] = useState(false);
  const form = useAuthForm(
    settingsSchema,
    {
      name: project.name,
      description: project.description ?? '',
      status: project.status,
      startDate: project.startDate ?? '',
      targetDate: project.targetDate ?? '',
    },
    async (values) => {
      setSaved(false);
      await api(`/projects/${project.id}`, { method: 'PATCH', body: values });
      setSaved(true);
      reload();
    },
  );

  const v = form.values;

  return (
    <SettingsSection
      id="general"
      title="General"
      description="Name, description, status and dates for this project."
    >
      <form onSubmit={form.onSubmit} noValidate className="max-w-lg space-y-4">
        {form.formError ? <Alert>{form.formError}</Alert> : null}
        {saved ? <Alert tone="success">Saved.</Alert> : null}
        <Field
          label="Project key"
          name="key"
          value={project.key}
          readOnly
          hint="Keys can't be changed."
        />
        <Field
          label="Name"
          name="name"
          value={v.name}
          onChange={form.onChange}
          error={form.fieldErrors.name}
        />
        <Field
          label="Description"
          name="description"
          value={v.description}
          onChange={form.onChange}
          error={form.fieldErrors.description}
        />
        <Select label="Status" name="status" value={v.status} onChange={form.onChange}>
          {(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED'] as const).map((s) => (
            <option key={s} value={s}>
              {PROJECT_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Start date"
            name="startDate"
            type="date"
            value={v.startDate}
            onChange={form.onChange}
            error={form.fieldErrors.startDate}
          />
          <Field
            label="Target date"
            name="targetDate"
            type="date"
            value={v.targetDate}
            onChange={form.onChange}
            error={form.fieldErrors.targetDate}
          />
        </div>
        <div className="w-40">
          <SubmitButton pending={form.pending}>Save</SubmitButton>
        </div>
      </form>
    </SettingsSection>
  );
}

function ArchiveCard() {
  const router = useRouter();
  const { project } = useProject();
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function archive() {
    setBusy(true);
    setError(null);
    try {
      await api(`/projects/${project.id}`, { method: 'DELETE' });
      router.push(`/workspaces/${project.workspaceId}/projects`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not archive the project.');
      setBusy(false);
    }
  }

  return (
    <SettingsSection
      danger
      title="Danger zone"
      description="Archiving makes the project read-only and hides it from the project list."
    >
      <div className="max-w-md space-y-3">
        {error ? <Alert>{error}</Alert> : null}
        <Field
          label={`Type ${project.key} to confirm`}
          name="confirm"
          value={confirm}
          autoComplete="off"
          onChange={(e) => setConfirm(e.target.value)}
        />
        <Button variant="danger" disabled={busy || confirm !== project.key} onClick={archive}>
          Archive project
        </Button>
      </div>
    </SettingsSection>
  );
}
