'use client';

import { forgotPasswordSchema } from '@devtrack/validators';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuthForm } from '../use-auth-form';
import { Alert, AuthCard, Field, SubmitButton } from './ui';

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const form = useAuthForm(forgotPasswordSchema, { email: '' }, async (values) => {
    await api('/auth/forgot-password', { body: values });
    setSent(true);
  });

  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter your account email and we will send you a reset link."
      footer={
        <Link
          href="/login"
          className="font-medium text-neutral-900 underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <Alert tone="success">
          If an account exists for {form.values.email}, a reset link is on its way. It expires in 1
          hour.
        </Alert>
      ) : (
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
          <SubmitButton pending={form.pending}>Send reset link</SubmitButton>
        </form>
      )}
    </AuthCard>
  );
}
