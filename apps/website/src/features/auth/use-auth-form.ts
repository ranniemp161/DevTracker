'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { z } from 'zod';
import { ApiError } from '@/lib/api';

/** Wraps a schema so empty form inputs count as "not provided" (for optional fields). */
export function withoutBlanks<S extends z.ZodType>(schema: S) {
  return z.preprocess(
    (v) =>
      v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== ''))
        : v,
    schema,
  );
}

/**
 * Minimal form state: validates with the same shared schema the API uses, then shows
 * server-side field errors and messages from the API error envelope.
 */
export function useAuthForm<S extends z.ZodType, V extends Record<string, string>>(
  schema: S,
  initial: V,
  submit: (values: z.output<S>) => Promise<void>,
) {
  const [values, setValues] = useState(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function onChange(e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
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
