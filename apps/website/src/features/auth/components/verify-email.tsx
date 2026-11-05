'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { takeTokenFromHash } from '../fragment-token';
import { Alert, AuthCard } from './ui';

type State =
  { status: 'verifying' } | { status: 'verified' } | { status: 'failed'; message: string };

export function VerifyEmail() {
  const [state, setState] = useState<State>({ status: 'verifying' });
  // Tokens are single-use: guard against React Strict Mode running the effect twice.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const token = takeTokenFromHash();
    const run = token
      ? api('/auth/verify-email', { body: { token } }).then(
          () => ({ status: 'verified' }) as const,
          (err: unknown) => ({
            status: 'failed' as const,
            message:
              err instanceof ApiError ? err.message : 'Verification failed. Please try again.',
          }),
        )
      : Promise.resolve({
          status: 'failed' as const,
          message: 'This verification link is incomplete.',
        });
    void run.then(setState);
  }, []);

  return (
    <AuthCard title="Verify your email">
      {state.status === 'verifying' ? <Alert tone="info">Verifying your email…</Alert> : null}
      {state.status === 'verified' ? (
        <div className="space-y-4">
          <Alert tone="success">Your email is verified.</Alert>
          <Link
            href="/"
            className="block text-center text-sm font-medium underline-offset-4 hover:underline"
          >
            Continue to DevTrack
          </Link>
        </div>
      ) : null}
      {state.status === 'failed' ? (
        <div className="space-y-4">
          <Alert>{state.message}</Alert>
          <p className="text-sm text-neutral-600">
            Sign in and use “Resend verification email” to get a new link.
          </p>
          <Link
            href="/"
            className="block text-center text-sm font-medium underline-offset-4 hover:underline"
          >
            Go to DevTrack
          </Link>
        </div>
      ) : null}
    </AuthCard>
  );
}
