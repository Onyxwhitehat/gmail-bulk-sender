'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { AppShell, PageHeader } from '@/components/AppShell';
import { FullPageSpinner, useConfirm, useToast } from '@/components/providers';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { formatDateTime, formatDuration, formatRelative } from '@/lib/format';
import type { AppSettings, GmailAccount } from '@/lib/types';
import {
  Alert,
  Badge,
  Button,
  Card,
  CheckIcon,
  EmptyState,
  Field,
  Input,
  LinkIcon,
  MailIcon,
  RefreshIcon,
  SendIcon,
  Skeleton,
  TrashIcon,
  XIcon,
} from '@/components/ui';

export default function GmailPage() {
  return (
    <AppShell>
      <Suspense fallback={<FullPageSpinner />}>
        <GmailConnection />
      </Suspense>
    </AppShell>
  );
}

interface CredentialsForm {
  google_client_id: string;
  google_client_secret: string;
  google_redirect_uri: string;
}

function GmailConnection() {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const searchParams = useSearchParams();

  const settingsQuery = useApi<{ settings: AppSettings; defaults: { redirectUri: string } }>('/api/settings');
  const accountsQuery = useApi<{ accounts: GmailAccount[] }>('/api/google/accounts');

  const [connecting, setConnecting] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<CredentialsForm>({
    defaultValues: { google_client_id: '', google_client_secret: '', google_redirect_uri: '' },
  });

  // Populate the form once settings arrive.
  useEffect(() => {
    if (!settingsQuery.data) return;
    reset({
      google_client_id: settingsQuery.data.settings.google_client_id,
      google_client_secret: '',
      google_redirect_uri: settingsQuery.data.settings.google_redirect_uri || settingsQuery.data.defaults.redirectUri,
    });
  }, [settingsQuery.data, reset]);

  // Surface the result of the OAuth round trip, then clean the URL.
  useEffect(() => {
    const status = searchParams.get('status');
    if (!status) return;

    if (status === 'connected') {
      toast.success('Gmail connected', searchParams.get('email') ?? undefined);
      void accountsQuery.reload();
    } else if (status === 'error') {
      toast.error('Could not connect Gmail', searchParams.get('message') ?? undefined);
    }
    router.replace('/gmail');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const saveCredentials = handleSubmit(async (values) => {
    const result = await toast.run(
      api.put<{ settings: AppSettings }>('/api/settings', {
        google_client_id: values.google_client_id.trim(),
        // Blank means "keep the stored secret" — the backend treats it that way.
        google_client_secret: values.google_client_secret.trim(),
        google_redirect_uri: values.google_redirect_uri.trim(),
      }),
      { success: 'OAuth credentials saved', error: 'Could not save credentials' },
    );
    if (result) {
      await settingsQuery.reload();
      reset({
        google_client_id: result.settings.google_client_id,
        google_client_secret: '',
        google_redirect_uri: result.settings.google_redirect_uri,
      });
    }
  });

  const connect = async () => {
    setConnecting(true);
    try {
      const { url } = await api.post<{ url: string }>('/api/google/connect');
      // Full navigation, not a popup — Google blocks OAuth in many embedded contexts.
      window.location.href = url;
    } catch (err) {
      toast.error('Could not start Google authorisation', err instanceof ApiError ? err.message : undefined);
      setConnecting(false);
    }
  };

  const disconnect = async (account: GmailAccount) => {
    const ok = await confirm({
      title: 'Disconnect this Gmail account?',
      message: (
        <>
          <p>
            <span className="font-medium">{account.email}</span> will be removed and its stored tokens revoked with
            Google. Sending logs are kept.
          </p>
        </>
      ),
      confirmLabel: 'Disconnect',
      tone: 'danger',
    });
    if (!ok) return;

    setBusyId(account.id);
    await toast.run(api.del(`/api/google/accounts/${account.id}`), {
      success: 'Gmail account disconnected',
      error: 'Could not disconnect the account',
    });
    setBusyId(null);
    await accountsQuery.reload();
  };

  const refreshToken = async (account: GmailAccount) => {
    setBusyId(account.id);
    await toast.run(api.post(`/api/google/accounts/${account.id}/refresh`), {
      success: 'Access token refreshed',
      error: 'Token refresh failed',
    });
    setBusyId(null);
    await accountsQuery.reload();
  };

  const sendTest = async (account: GmailAccount) => {
    setBusyId(account.id);
    const result = await toast.run(
      api.post<{ ok: boolean; to: string }>(`/api/google/accounts/${account.id}/test`, {
        subject: 'Test email from Bulk Email Sender',
        html: '<p>Your Gmail connection is working correctly.</p><p>This message was sent through the Gmail API using OAuth 2.0.</p>',
      }),
      { error: 'Test email failed' },
    );
    if (result) toast.success('Test email sent', `Check the inbox of ${result.to}`);
    setBusyId(null);
  };

  const settings = settingsQuery.data?.settings;
  const accounts = accountsQuery.data?.accounts ?? [];

  return (
    <>
      <PageHeader
        title="Gmail Connection"
        description="Authorise a Gmail account with OAuth 2.0. Emails are sent through the Gmail API, never SMTP."
        actions={
          <Button onClick={connect} loading={connecting} icon={<LinkIcon className="h-4 w-4" />}>
            Connect Gmail
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="space-y-6 xl:col-span-3">
          <Card
            title="Connected accounts"
            description="Tokens are encrypted at rest and refreshed automatically before they expire."
            bodyClassName={accounts.length ? 'p-0' : undefined}
          >
            {accountsQuery.loading ? (
              <div className="space-y-3">
                <Skeleton className="h-24 w-full" />
              </div>
            ) : accounts.length === 0 ? (
              <EmptyState
                icon={<MailIcon className="h-8 w-8" />}
                title="No Gmail account connected"
                description="Save your OAuth credentials, then click Connect Gmail to authorise an account."
                action={
                  <Button onClick={connect} loading={connecting} icon={<LinkIcon className="h-4 w-4" />}>
                    Connect Gmail
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                {accounts.map((account) => (
                  <li key={account.id} className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-medium text-slate-900 dark:text-slate-100">{account.email}</p>
                          {account.isDefault && <Badge tone="brand">Default</Badge>}
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          Connected {formatRelative(account.connectedAt)}
                          {account.lastRefreshedAt && ` · token refreshed ${formatRelative(account.lastRefreshedAt)}`}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void sendTest(account)}
                          loading={busyId === account.id}
                          icon={<SendIcon className="h-3.5 w-3.5" />}
                        >
                          Send test
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void refreshToken(account)}
                          loading={busyId === account.id}
                          icon={<RefreshIcon className="h-3.5 w-3.5" />}
                        >
                          Refresh
                        </Button>
                        {!account.isDefault && accounts.length > 1 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              await api.post(`/api/google/accounts/${account.id}/default`);
                              await accountsQuery.reload();
                              toast.success('Default sending account updated');
                            }}
                          >
                            Make default
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                          onClick={() => void disconnect(account)}
                          icon={<TrashIcon className="h-3.5 w-3.5" />}
                        >
                          Disconnect
                        </Button>
                      </div>
                    </div>

                    <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <TokenStatus
                        label="Access token"
                        ok={account.accessToken.present && !account.accessToken.expired}
                        detail={
                          !account.accessToken.present
                            ? 'Missing'
                            : account.accessToken.expired
                              ? 'Expired — refreshes on next use'
                              : `Valid for ${formatDuration(account.accessToken.expiresInSeconds * 1000)}`
                        }
                      />
                      <TokenStatus
                        label="Refresh token"
                        ok={account.refreshToken.present}
                        detail={account.refreshToken.present ? 'Stored (encrypted)' : 'Missing — reconnect required'}
                      />
                      <div>
                        <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Last connected</dt>
                        <dd className="mt-1 text-sm text-slate-700 dark:text-slate-300">
                          {formatDateTime(account.connectedAt)}
                        </dd>
                      </div>
                    </dl>

                    {account.lastError && (
                      <div className="mt-4">
                        <Alert tone="danger" title="Last error">
                          {account.lastError}
                        </Alert>
                      </div>
                    )}

                    {account.scopes.length > 0 && (
                      <details className="mt-4">
                        <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                          Granted scopes ({account.scopes.length})
                        </summary>
                        <ul className="mt-2 space-y-1">
                          {account.scopes.map((scope) => (
                            <li key={scope} className="font-mono text-xs break-all text-slate-500 dark:text-slate-400">
                              {scope}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Google OAuth credentials"
            description="Created in the Google Cloud Console. The client secret is encrypted and never sent back to the browser."
          >
            {settingsQuery.loading ? (
              <div className="space-y-4">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : (
              <form onSubmit={saveCredentials} className="space-y-4">
                <Field
                  label="Google Client ID"
                  required
                  error={errors.google_client_id?.message}
                  hint="Ends in .apps.googleusercontent.com"
                  htmlFor="client-id"
                >
                  <Input
                    id="client-id"
                    placeholder="123456789-abcdef.apps.googleusercontent.com"
                    autoComplete="off"
                    {...register('google_client_id', { required: 'Client ID is required' })}
                  />
                </Field>

                <Field
                  label="Google Client Secret"
                  hint={
                    settings?.google_client_secret_set
                      ? `Currently set (${settings.google_client_secret_masked}). Leave blank to keep it.`
                      : 'Copy it from the Google Cloud Console — it is only shown once there.'
                  }
                  htmlFor="client-secret"
                >
                  <Input
                    id="client-secret"
                    type="password"
                    placeholder={settings?.google_client_secret_set ? '•••••••••••••• (unchanged)' : 'GOCSPX-…'}
                    autoComplete="new-password"
                    {...register('google_client_secret')}
                  />
                </Field>

                <Field
                  label="Redirect URI"
                  required
                  error={errors.google_redirect_uri?.message}
                  hint="Must match an Authorised redirect URI in your Google OAuth client, character for character."
                  htmlFor="redirect-uri"
                >
                  <Input
                    id="redirect-uri"
                    placeholder="http://localhost:4000/api/google/callback"
                    {...register('google_redirect_uri', { required: 'Redirect URI is required' })}
                  />
                </Field>

                <div className="flex items-center gap-3">
                  <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
                    Save credentials
                  </Button>
                  {!isDirty && <span className="text-xs text-slate-400">No unsaved changes</span>}
                </div>
              </form>
            )}
          </Card>
        </div>

        <div className="xl:col-span-2">
          <SetupGuide redirectUri={settings?.google_redirect_uri ?? settingsQuery.data?.defaults.redirectUri ?? ''} />
        </div>
      </div>
    </>
  );
}

function TokenStatus({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-1 flex items-center gap-1.5 text-sm">
        {ok ? (
          <CheckIcon className="h-4 w-4 shrink-0 text-emerald-500" />
        ) : (
          <XIcon className="h-4 w-4 shrink-0 text-amber-500" />
        )}
        <span className="text-slate-700 dark:text-slate-300">{detail}</span>
      </dd>
    </div>
  );
}

function SetupGuide({ redirectUri }: { redirectUri: string }) {
  const toast = useToast();

  const steps = [
    {
      title: 'Create a Google Cloud project',
      body: (
        <>
          Open{' '}
          <a
            href="https://console.cloud.google.com/projectcreate"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-600 underline dark:text-brand-400"
          >
            console.cloud.google.com
          </a>{' '}
          and create a project (or reuse one).
        </>
      ),
    },
    {
      title: 'Enable the APIs',
      body: <>Under APIs &amp; Services → Library, enable both the <strong>Gmail API</strong> and the <strong>Google Sheets API</strong>.</>,
    },
    {
      title: 'Configure the OAuth consent screen',
      body: (
        <>
          Choose <strong>External</strong>, fill in the app name and support email, then add the scopes{' '}
          <code className="text-xs">gmail.send</code> and <code className="text-xs">spreadsheets.readonly</code>. While
          the app is in Testing, add your own address under <strong>Test users</strong>.
        </>
      ),
    },
    {
      title: 'Create OAuth client credentials',
      body: (
        <>
          Credentials → Create credentials → <strong>OAuth client ID</strong> → <strong>Web application</strong>. Add the
          redirect URI below, then copy the Client ID and Client Secret into the form.
        </>
      ),
    },
  ];

  return (
    <Card title="Setup guide" description="One-time Google Cloud configuration.">
      <ol className="space-y-4">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{step.title}</p>
              <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
        <p className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">Authorised redirect URI</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-slate-800 dark:text-slate-200">
            {redirectUri || '—'}
          </code>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(redirectUri);
              toast.success('Redirect URI copied');
            }}
            disabled={!redirectUri}
          >
            Copy
          </Button>
        </div>
      </div>

      <div className="mt-4">
        <Alert tone="warning" title="Sending limits">
          Free Gmail accounts allow roughly 500 messages per day; Google Workspace allows about 2,000. Exceeding the
          limit gets sending blocked for 24 hours — set a matching daily limit in Settings.
        </Alert>
      </div>
    </Card>
  );
}
