'use client';

import { loginSchema, safeRedirectPath } from '@devtrack/validators';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { oauthErrorMessage } from '../error-messages';
import { useAuthForm } from '../use-auth-form';
import { Alert, AuthCard, Divider, Field, GithubButton, SubmitButton } from './ui';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeRedirectPath(params.get('next'));
  const oauthError = oauthErrorMessage(params.get('error'));
  const reset = params.get('reset') === '1';

  const form = useAuthForm(loginSchema, { email: '', password: '' }, async (values) => {
    await api('/auth/login', { body: values });
    router.replace(next);
    router.refresh();
  });

  return (
    <AuthCard
      title="Sign in to DevTrack"
      footer={
        <>
          New to DevTrack?{' '}
          <Link
            href="/register"
            className="font-medium text-neutral-900 underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <div className="space-y-4">
        {reset ? (
          <Alert tone="success">Your password was reset. Sign in with your new password.</Alert>
        ) : null}
        {oauthError ? <Alert>{oauthError}</Alert> : null}
        <GithubButton redirectTo={next} />
      </div>
      <Divider label="or with email" />
      <form onSubmit={form.onSubmit} noValidate className="space-y-4">
        {form.formError ? <Alert>{form.formError}</Alert> : null}
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          value={form.values.email}
          onChange={form.onChange}
          error={form.fieldErrors.email}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={form.values.password}
          onChange={form.onChange}
          error={form.fieldErrors.password}
        />
        <div className="text-right text-sm">
          <Link
            href="/forgot-password"
            className="text-neutral-600 underline-offset-4 hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <SubmitButton pending={form.pending}>Sign in</SubmitButton>
      </form>
    </AuthCard>
  );
}
