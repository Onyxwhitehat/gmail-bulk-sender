'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { AppShell, PageHeader } from '@/components/AppShell';
import { RichTextEditor } from '@/components/RichTextEditor';
import { useToast } from '@/components/providers';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { formatDuration } from '@/lib/format';
import type { AppSettings } from '@/lib/types';
import { Alert, Button, Card, Field, Input, ShieldIcon, Skeleton } from '@/components/ui';

export default function SettingsPage() {
  return (
    <AppShell>
      <Settings />
    </AppShell>
  );
}

interface SettingsForm {
  google_client_id: string;
  google_client_secret: string;
  google_redirect_uri: string;
  sender_name: string;
  reply_to: string;
  delay_min_ms: number;
  delay_max_ms: number;
  daily_limit: number;
  max_retries: number;
  batch_pause_every: number;
  batch_pause_ms: number;
}

function Settings() {
  const toast = useToast();
  const query = useApi<{ settings: AppSettings; defaults: { redirectUri: string } }>('/api/settings');
  const [signature, setSignature] = useState('');

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<SettingsForm>();

  useEffect(() => {
    if (!query.data) return;
    const s = query.data.settings;
    reset({
      google_client_id: s.google_client_id,
      google_client_secret: '',
      google_redirect_uri: s.google_redirect_uri,
      sender_name: s.sender_name,
      reply_to: s.reply_to,
      delay_min_ms: s.delay_min_ms,
      delay_max_ms: s.delay_max_ms,
      daily_limit: s.daily_limit,
      max_retries: s.max_retries,
      batch_pause_every: s.batch_pause_every,
      batch_pause_ms: s.batch_pause_ms,
    });
    setSignature(s.signature_html);
  }, [query.data, reset]);

  const save = handleSubmit(async (values) => {
    if (Number(values.delay_min_ms) > Number(values.delay_max_ms)) {
      toast.error('Invalid delay range', 'The minimum delay cannot exceed the maximum.');
      return;
    }

    try {
      await api.put('/api/settings', { ...values, signature_html: signature });
      toast.success('Settings saved');
      await query.reload();
    } catch (err) {
      toast.error('Could not save settings', err instanceof ApiError ? err.message : undefined);
    }
  });

  const delayMin = Number(watch('delay_min_ms') ?? 2000);
  const delayMax = Number(watch('delay_max_ms') ?? 5000);
  const dailyLimit = Number(watch('daily_limit') ?? 450);
  const estimatedFullRun = dailyLimit * ((delayMin + delayMax) / 2 + 1200);

  if (query.loading) {
    return (
      <>
        <PageHeader title="Settings" />
        <div className="space-y-6">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Sending behaviour, identity, and Google credentials."
        actions={
          <Button onClick={save} loading={isSubmitting} disabled={!isDirty && signature === query.data?.settings.signature_html}>
            Save changes
          </Button>
        }
      />

      <form onSubmit={save} className="space-y-6">
        <Card
          title="Google OAuth credentials"
          description="From your Google Cloud project. The secret is encrypted at rest and never sent to the browser."
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Field label="Client ID" error={errors.google_client_id?.message} htmlFor="client-id">
              <Input id="client-id" autoComplete="off" placeholder="…apps.googleusercontent.com" {...register('google_client_id')} />
            </Field>

            <Field
              label="Client Secret"
              hint={
                query.data?.settings.google_client_secret_set
                  ? `Currently set (${query.data.settings.google_client_secret_masked}). Leave blank to keep it.`
                  : 'Not set yet.'
              }
              htmlFor="client-secret"
            >
              <Input
                id="client-secret"
                type="password"
                autoComplete="new-password"
                placeholder={query.data?.settings.google_client_secret_set ? '•••••••• (unchanged)' : 'GOCSPX-…'}
                {...register('google_client_secret')}
              />
            </Field>

            <Field
              label="Redirect URI"
              hint="Must exactly match an authorised redirect URI in your OAuth client."
              className="lg:col-span-2"
              htmlFor="redirect-uri"
            >
              <Input id="redirect-uri" {...register('google_redirect_uri')} />
            </Field>
          </div>
        </Card>

        <Card title="Sender identity" description="How your messages appear in the recipient's inbox.">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Field
              label="Sender name"
              hint="Display name on the From line. Leave blank to use the Gmail account default."
              htmlFor="sender-name"
            >
              <Input id="sender-name" placeholder="Acme Support" {...register('sender_name')} />
            </Field>

            <Field
              label="Reply-To address"
              hint="Optional — where replies should go if different from the sending account."
              error={errors.reply_to?.message}
              htmlFor="reply-to"
            >
              <Input
                id="reply-to"
                type="email"
                placeholder="support@acme.com"
                {...register('reply_to', {
                  validate: (value) =>
                    !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || 'Enter a valid email address',
                })}
              />
            </Field>
          </div>

          <div className="mt-4">
            <label className="label-base">Email signature</label>
            <RichTextEditor
              value={signature}
              onChange={setSignature}
              minHeight={140}
              placeholder="Appended to the bottom of every email…"
            />
            <p className="hint">
              Automatically appended to every message. Supports the same variables as the body.
            </p>
          </div>
        </Card>

        <Card
          title="Sending behaviour"
          description="Pacing controls that keep you inside Gmail's limits and out of spam filters."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Minimum delay (ms)" hint="Between messages." error={errors.delay_min_ms?.message} htmlFor="delay-min">
              <Input
                id="delay-min"
                type="number"
                min={0}
                max={600000}
                step={100}
                {...register('delay_min_ms', { valueAsNumber: true, min: { value: 0, message: 'Must be 0 or more' } })}
              />
            </Field>

            <Field label="Maximum delay (ms)" hint="A random value in this range is used." htmlFor="delay-max">
              <Input id="delay-max" type="number" min={0} max={600000} step={100} {...register('delay_max_ms', { valueAsNumber: true })} />
            </Field>

            <Field
              label="Daily sending limit"
              hint="Free Gmail ≈ 500/day; Workspace ≈ 2,000/day."
              htmlFor="daily-limit"
            >
              <Input id="daily-limit" type="number" min={1} max={10000} {...register('daily_limit', { valueAsNumber: true })} />
            </Field>

            <Field label="Max retries" hint="Per recipient, on transient failures." htmlFor="max-retries">
              <Input id="max-retries" type="number" min={0} max={10} {...register('max_retries', { valueAsNumber: true })} />
            </Field>

            <Field
              label="Long pause every N emails"
              hint="0 disables. Useful for very large lists."
              htmlFor="batch-every"
            >
              <Input id="batch-every" type="number" min={0} max={10000} {...register('batch_pause_every', { valueAsNumber: true })} />
            </Field>

            <Field label="Long pause duration (ms)" hint="How long that pause lasts." htmlFor="batch-pause">
              <Input id="batch-pause" type="number" min={0} max={3600000} step={1000} {...register('batch_pause_ms', { valueAsNumber: true })} />
            </Field>
          </div>

          <div className="mt-4 rounded-lg bg-slate-50 p-4 dark:bg-slate-950">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              With a {(delayMin / 1000).toFixed(1)}–{(delayMax / 1000).toFixed(1)}s delay, sending your full daily limit
              of <strong className="text-slate-900 dark:text-slate-200">{dailyLimit.toLocaleString()}</strong> emails
              takes roughly{' '}
              <strong className="text-slate-900 dark:text-slate-200">{formatDuration(estimatedFullRun)}</strong>.
            </p>
            {delayMin < 1000 && (
              <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
                Delays under one second significantly raise the risk of Gmail rate-limiting or suspending the account.
              </p>
            )}
          </div>
        </Card>

        <ChangePassword />

        <div className="flex items-center gap-3">
          <Button type="submit" loading={isSubmitting} size="lg">
            Save changes
          </Button>
          <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <ShieldIcon className="h-3.5 w-3.5" />
            Secrets are encrypted with AES-256-GCM before being written to the database.
          </p>
        </div>
      </form>
    </>
  );
}

function ChangePassword() {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }

    setSaving(true);
    const result = await toast.run(api.post('/api/auth/change-password', { currentPassword, newPassword }), {
      success: 'Password changed',
      error: 'Could not change the password',
    });
    setSaving(false);

    if (result) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
  };

  return (
    <Card title="Dashboard password" description="The login for this dashboard — not your Google account password.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Current password" htmlFor="current-password">
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </Field>
        <Field label="New password" htmlFor="new-password">
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </Field>
        <Field label="Confirm new password" htmlFor="confirm-password">
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </Field>
      </div>

      <div className="mt-4">
        <Button
          type="button"
          variant="secondary"
          onClick={() => void submit()}
          loading={saving}
          disabled={!currentPassword || !newPassword}
        >
          Change password
        </Button>
      </div>

      {newPassword && newPassword.length < 8 && (
        <div className="mt-3">
          <Alert tone="warning">Use at least 8 characters. A long passphrase is stronger than a short complex one.</Alert>
        </div>
      )}
    </Card>
  );
}
