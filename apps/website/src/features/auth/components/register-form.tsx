'use client';

import { PASSWORD_MIN_LENGTH, registerSchema, safeRedirectPath } from '@devtrack/validators';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthForm } from '../use-auth-form';
import { Alert, AuthCard, Divider, Field, GithubButton, SubmitButton } from './ui';

export function RegisterForm() {
  const router = useRouter();
  const next = safeRedirectPath(useSearchParams().get('next'));
  const form = useAuthForm(
    registerSchema,
    { email: '', username: '', password: '' },
    async (values) => {
      await api('/auth/register', { body: values });
      router.replace(next);
      router.refresh();
    },
  );

  return (
    <AuthCard
      title="Create your account"
      subtitle="We will email you a verification link to activate your workspaces."
      footer={
        <>
          Already have an account?{' '}
          <Link
            href={`/login?next=${encodeURIComponent(next)}`}
            className="font-semibold text-accent hover:underline underline-offset-2"
          >
            Sign in
          </Link>
        </>
      }
    >
      <GithubButton redirectTo={next} />
      <Divider label="or register with email" />
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
          label="Username"
          name="username"
          autoComplete="username"
          value={form.values.username}
          onChange={form.onChange}
          error={form.fieldErrors.username}
          hint="Used for @mentions. Letters, numbers, - and _."
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={form.values.password}
          onChange={form.onChange}
          error={form.fieldErrors.password}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. Passphrases recommended.`}
        />
        <div className="pt-1">
          <SubmitButton pending={form.pending}>Create account</SubmitButton>
        </div>
      </form>
    </AuthCard>
  );
}
