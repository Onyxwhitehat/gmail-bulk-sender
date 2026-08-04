'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { ApiError, api } from '@/lib/api';
import { FullPageSpinner, useSession, useToast } from '@/components/providers';
import { Alert, Button, Field, Input, MailIcon, ShieldIcon } from '@/components/ui';

interface FormValues {
  email: string;
  password: string;
  confirmPassword?: string;
  name?: string;
}

export default function LoginPage() {
  const router = useRouter();
  const toast = useToast();
  const { user, needsSetup, loading, refresh } = useSession();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: { email: '', password: '' } });

  useEffect(() => {
    if (!loading && user) router.replace('/');
  }, [loading, user, router]);

  if (loading) return <FullPageSpinner label="Checking your session" />;

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setError(null);
    try {
      if (needsSetup) {
        await api.post('/api/auth/setup', {
          email: values.email,
          password: values.password,
          name: values.name || undefined,
        });
        toast.success('Admin account created', 'Next: connect your Gmail account.');
      } else {
        await api.post('/api/auth/login', { email: values.email, password: values.password });
      }
      await refresh();
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white shadow-lg shadow-brand-600/20">
            <MailIcon className="h-6 w-6" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Bulk Email Sender
          </h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
            {needsSetup
              ? 'Create the administrator account to get started.'
              : 'Sign in to your sending dashboard.'}
          </p>
        </div>

        <div className="card p-6">
          {needsSetup && (
            <Alert tone="info" title="First-time setup">
              This account controls the dashboard. It is separate from the Gmail account you will connect for sending.
            </Alert>
          )}

          <form onSubmit={onSubmit} className="mt-4 space-y-4" noValidate>
            {needsSetup && (
              <Field label="Your name" hint="Optional — shown in the sidebar." htmlFor="name">
                <Input id="name" autoComplete="name" placeholder="Jane Doe" {...register('name')} />
              </Field>
            )}

            <Field label="Email address" required error={errors.email?.message} htmlFor="email">
              <Input
                id="email"
                type="email"
                autoComplete={needsSetup ? 'username' : 'email'}
                placeholder="you@example.com"
                autoFocus
                {...register('email', {
                  required: 'Email is required',
                  pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Enter a valid email address' },
                })}
              />
            </Field>

            <Field
              label="Password"
              required
              error={errors.password?.message}
              hint={needsSetup ? 'At least 8 characters. Use something long and unique.' : undefined}
              htmlFor="password"
            >
              <Input
                id="password"
                type="password"
                autoComplete={needsSetup ? 'new-password' : 'current-password'}
                placeholder="••••••••"
                {...register('password', {
                  required: 'Password is required',
                  minLength: { value: 8, message: 'Password must be at least 8 characters' },
                })}
              />
            </Field>

            {needsSetup && (
              <Field label="Confirm password" required error={errors.confirmPassword?.message} htmlFor="confirm">
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  {...register('confirmPassword', {
                    validate: (value) => value === watch('password') || 'Passwords do not match',
                  })}
                />
              </Field>
            )}

            {error && <Alert tone="danger">{error}</Alert>}

            <Button type="submit" loading={submitting} className="w-full" size="lg">
              {needsSetup ? 'Create account' : 'Sign in'}
            </Button>
          </form>
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
          <ShieldIcon className="h-3.5 w-3.5" />
          Credentials are hashed with bcrypt; OAuth tokens are encrypted at rest.
        </p>
      </div>
    </div>
  );
}
