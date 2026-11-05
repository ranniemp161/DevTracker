'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import type { z } from 'zod';
import { ApiError } from '@/lib/api';

/**
 * Minimal form state for the auth screens: validates with the same shared schema the API
 * uses, then shows server-side field errors and messages from the API error envelope.
 */
export function useAuthForm<S extends z.ZodObject>(
  schema: S,
  initial: Record<keyof z.input<S> & string, string>,
  submit: (values: z.output<S>) => Promise<void>,
) {
  const [values, setValues] = useState(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setValues((v) => ({ ...v, [name]: value }));
    setFieldErrors((errs) => {
      if (!(name in errs)) return errs;
      const next = { ...errs };
      delete next[name];
      return next;
    });
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[issue.path.join('.')] ??= issue.message;
      setFieldErrors(errs);
      return;
    }
    setPending(true);
    try {
      await submit(parsed.data);
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors());
        setFormError(err.details.length > 0 ? null : err.message);
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    } finally {
      setPending(false);
    }
  }

  return { values, fieldErrors, formError, pending, onChange, onSubmit, setFormError };
}
