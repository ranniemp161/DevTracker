'use client';

import { PASSWORD_MIN_LENGTH, passwordSchema } from '@devtrack/validators';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { api } from '@/lib/api';
import { useFragmentToken } from '../fragment-token';
import { useAuthForm } from '../use-auth-form';
import { Alert, AuthCard, Field, SubmitButton } from './ui';

const formSchema = z.object({ password: passwordSchema });

export function ResetPasswordForm() {
  const router = useRouter();
  // undefined while hydrating (the fragment only exists in the browser), then token or null.
  const token = useFragmentToken();

  const form = useAuthForm(formSchema, { password: '' }, async ({ password }) => {
    await api('/auth/reset-password', { body: { token, password } });
    router.replace('/login?reset=1');
  });

  return (
    <AuthCard
      title="Choose a new password"
      subtitle="You will be signed out everywhere and asked to sign in again with your new password."
      footer={
        <Link
          href="/login"
          className="font-semibold text-accent hover:underline underline-offset-2"
        >
          ← Back to sign in
        </Link>
      }
    >
      {token === undefined ? null : !token ? (
        <Alert tone="warning">
          This reset link is incomplete.{' '}
          <Link href="/forgot-password" className="font-semibold underline text-amber-950">
            Request a new one
          </Link>
          .
        </Alert>
      ) : (
        <form onSubmit={form.onSubmit} noValidate className="space-y-4">
          {form.formError ? <Alert tone="error">{form.formError}</Alert> : null}
          <Field
            label="New password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={form.values.password}
            onChange={form.onChange}
            error={form.fieldErrors.password ?? form.fieldErrors.token}
            hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          />
          <div className="pt-1">
            <SubmitButton pending={form.pending}>Reset password</SubmitButton>
          </div>
        </form>
      )}
    </AuthCard>
  );
}
