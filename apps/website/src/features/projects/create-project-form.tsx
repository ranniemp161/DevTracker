'use client';

import type { Project } from '@devtrack/types';
import { createProjectSchema, projectKeySchema } from '@devtrack/validators';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button, Field, SubmitButton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuthForm, withoutBlanks } from '../auth/use-auth-form';
import { useWorkspace } from '../workspaces/workspace-context';
import { projectKeyFromName } from './project-key';

export function CreateProjectForm() {
  const router = useRouter();
  const { workspace } = useWorkspace();
  const projectsPath = `/workspaces/${workspace.id}/projects`;
  // After a submit conflict, keep the displayed key and search from the original base.
  const [override, setOverride] = useState<{ value: string; base: string } | null>(null);
  const [checked, setChecked] = useState<{ request: string; key: string } | null>(null);
  const form = useAuthForm(
    withoutBlanks(createProjectSchema),
    { name: '', key: '', description: '', startDate: '', targetDate: '' },
    async (values) => {
      try {
        const { project } = await api<{ project: Project }>(projectsPath, { body: values });
        router.push(`/projects/${project.id}`);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'PROJECT_KEY_TAKEN') {
          setChecked(null);
          setOverride({
            value: values.key,
            base: override?.base ?? projectKeyFromName(values.name),
          });
        }
        throw err;
      }
    },
  );

  const set = form.values;
  const base = override?.base ?? projectKeyFromName(set.name);
  const request = JSON.stringify([projectsPath, set.name, override, base]);
  const suggestion = checked?.request === request ? checked.key : null;
  const key = override?.value ?? suggestion ?? base;
  const valid = projectKeySchema.safeParse(key);
  const alternative =
    override && suggestion && valid.success && suggestion !== valid.data ? suggestion : null;
  useEffect(() => {
    if (!projectKeySchema.safeParse(base).success) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const result = await api<{ key: string }>(
          `${projectsPath}/key-suggestion?base=${encodeURIComponent(base)}`,
        );
        if (active) setChecked({ request, key: result.key });
      } catch {
        // Availability is advisory. Creation still enforces workspace uniqueness.
      }
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [base, projectsPath, request, override]);

  function chooseKey(value: string, numberingBase = value) {
    setOverride({ value, base: numberingBase });
    form.setFormError(null);
  }

  return (
    <div className="max-w-lg">
      <form onSubmit={(e) => form.onSubmit(e, { ...set, key })} noValidate>
        <fieldset disabled={form.pending} className="space-y-4">
          {form.formError ? <Alert>{form.formError}</Alert> : null}
          <Field
            label="Name"
            name="name"
            value={set.name}
            onChange={form.onChange}
            error={form.fieldErrors.name}
          />
          <Field
            label="Project key"
            name="key"
            value={key}
            placeholder="e.g. GOS"
            onChange={(e) => chooseKey(e.target.value.toUpperCase())}
            error={
              !valid.success
                ? key
                  ? valid.error.issues[0]?.message
                  : form.fieldErrors.key
                : undefined
            }
            hint={
              valid.success
                ? `Your first task will be ${valid.data}-1.`
                : 'We’ll suggest a key from the project name. You can edit it.'
            }
          />
          <p className="text-sm text-fg-muted">The project key is fixed after creation.</p>
          {alternative && (
            <p role="status">
              {key} is taken.{' '}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => chooseKey(alternative, base)}
              >
                Use {alternative}
              </Button>
            </p>
          )}
          {override && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setOverride(null);
                form.setFormError(null);
              }}
            >
              Use suggested key
            </Button>
          )}
          <Field
            label="Description"
            name="description"
            value={set.description}
            onChange={form.onChange}
            error={form.fieldErrors.description}
          />
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Start date"
              name="startDate"
              type="date"
              value={set.startDate}
              onChange={form.onChange}
              error={form.fieldErrors.startDate}
            />
            <Field
              label="Target date"
              name="targetDate"
              type="date"
              value={set.targetDate}
              onChange={form.onChange}
              error={form.fieldErrors.targetDate}
            />
          </div>
          <SubmitButton pending={form.pending}>Create project</SubmitButton>
        </fieldset>
      </form>
    </div>
  );
}
