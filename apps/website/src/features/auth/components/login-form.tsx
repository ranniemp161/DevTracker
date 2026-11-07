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
      subtitle="Welcome back. Enter your credentials to access your engineering workspace."
      footer={
        <>
          New to DevTrack?{' '}
          <Link
            href={`/register?next=${encodeURIComponent(next)}`}
            className="font-semibold text-accent hover:underline underline-offset-2"
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
        {oauthError ? <Alert tone="error">{oauthError}</Alert> : null}
        <GithubButton redirectTo={next} />
      </div>
      <Divider label="or continue with email" />
      <form onSubmit={form.onSubmit} noValidate className="space-y-4">
        {form.formError ? <Alert tone="error">{form.formError}</Alert> : null}
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
        <div className="text-right text-xs">
          <Link
            href="/forgot-password"
            className="text-mineral hover:text-accent font-medium hover:underline underline-offset-2"
          >
            Forgot password?
          </Link>
        </div>
        <div className="pt-1">
          <SubmitButton pending={form.pending}>Sign in</SubmitButton>
        </div>
      </form>
    </AuthCard>
  );
}
