import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RegisterForm } from '@/features/auth/components/register-form';

export const metadata: Metadata = { title: 'Create account' };

export default function RegisterPage() {
  // RegisterForm reads ?next= via useSearchParams, which needs a Suspense boundary.
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
