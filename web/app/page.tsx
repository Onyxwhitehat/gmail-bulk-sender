'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AppShell, PageHeader } from '@/components/AppShell';
import { useApi, useEventStream } from '@/lib/hooks';
import { formatDuration, formatNumber, formatRelative } from '@/lib/format';
import type { DashboardStats, ProgressSnapshot } from '@/lib/types';
import {
  AlertIcon,
  Badge,
  Button,
  Card,
  CheckIcon,
  ClockIcon,
  EmptyState,
  MailIcon,
  ProgressBar,
  SendIcon,
  Skeleton,
  StatCard,
  UsersIcon,
  XIcon,
} from '@/components/ui';

export default function DashboardPage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}

function Dashboard() {
  const { data, loading, error, reload } = useApi<DashboardStats>('/api/stats');
  const [live, setLive] = useState<ProgressSnapshot | null>(null);

  useEventStream({
    onProgress: setLive,
    // A finished send changes every card on this page, so refresh the whole payload.
    onLog: () => void reload(),
  });

  const progress = live ?? data?.progress ?? null;
  const stats = data;
  const isSending = progress?.state === 'running' || progress?.state === 'paused';

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Overview of your Gmail connection, recipients, and sending activity."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void reload()} loading={loading}>
            Refresh
          </Button>
        }
      />

      {error && (
        <div className="mb-6">
          <Card>
            <div className="flex items-center gap-3 text-sm text-red-600 dark:text-red-400">
              <AlertIcon className="h-5 w-5 shrink-0" />
              <span>{error}</span>
            </div>
          </Card>
        </div>
      )}

      {!loading && stats && !stats.gmail.connected && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-500/10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex gap-3">
              <AlertIcon className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">No Gmail account connected</p>
                <p className="mt-0.5 text-sm text-amber-800 dark:text-amber-300">
                  Connect a Gmail account with OAuth 2.0 before you can send or import from Google Sheets.
                </p>
              </div>
            </div>
            <Link href="/gmail">
              <Button size="sm">Connect Gmail</Button>
            </Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Gmail Status"
          loading={loading}
          value={
            stats?.gmail.connected ? (
              <span className="text-emerald-600 dark:text-emerald-400">Connected</span>
            ) : (
              <span className="text-slate-400">Not connected</span>
            )
          }
          tone={stats?.gmail.connected ? 'success' : 'neutral'}
          icon={<MailIcon className="h-5 w-5" />}
          sublabel={
            stats?.gmail.account
              ? `Token ${stats.gmail.account.accessToken.expired ? 'expired — auto-refreshes on next use' : `valid for ${formatDuration(stats.gmail.account.accessToken.expiresInSeconds * 1000)}`}`
              : 'Go to Gmail Connection to link an account'
          }
        />

        <StatCard
          label="Connected Account"
          loading={loading}
          value={
            <span className="block truncate text-lg" title={stats?.gmail.account?.email ?? undefined}>
              {stats?.gmail.account?.email ?? '—'}
            </span>
          }
          tone="brand"
          icon={<CheckIcon className="h-5 w-5" />}
          sublabel={
            stats?.gmail.account
              ? `Connected ${formatRelative(stats.gmail.account.connectedAt)}${stats.gmail.accountCount > 1 ? ` · ${stats.gmail.accountCount} accounts` : ''}`
              : undefined
          }
        />

        <StatCard
          label="Total Recipients"
          loading={loading}
          value={formatNumber(stats?.recipients.total)}
          tone="info"
          icon={<UsersIcon className="h-5 w-5" />}
          sublabel={
            stats
              ? `${formatNumber(stats.recipients.groups)} group${stats.recipients.groups === 1 ? '' : 's'}${stats.recipients.unsubscribed ? ` · ${stats.recipients.unsubscribed} unsubscribed` : ''}`
              : undefined
          }
        />

        <StatCard
          label="Emails Sent Today"
          loading={loading}
          value={formatNumber(stats?.sending.sentToday)}
          tone="success"
          icon={<SendIcon className="h-5 w-5" />}
          sublabel={
            stats && (
              <span>
                {formatNumber(stats.sending.dailyRemaining)} of {formatNumber(stats.sending.dailyLimit)} daily limit
                remaining
              </span>
            )
          }
        />

        <StatCard
          label="Failed Emails"
          loading={loading}
          value={formatNumber(stats?.sending.failedToday)}
          tone={stats && stats.sending.failedToday > 0 ? 'danger' : 'neutral'}
          icon={<XIcon className="h-5 w-5" />}
          sublabel={stats ? `${formatNumber(stats.sending.failedAllTime)} failed all time` : undefined}
        />

        <StatCard
          label="Success Rate"
          loading={loading}
          value={stats?.sending.successRate === null ? '—' : `${stats?.sending.successRate}%`}
          tone={
            stats?.sending.successRate === null
              ? 'neutral'
              : (stats?.sending.successRate ?? 0) >= 95
                ? 'success'
                : (stats?.sending.successRate ?? 0) >= 80
                  ? 'warning'
                  : 'danger'
          }
          icon={<CheckIcon className="h-5 w-5" />}
          sublabel={
            stats ? `${formatNumber(stats.sending.sentAllTime)} delivered across all campaigns` : undefined
          }
        />
      </div>

      {isSending && progress && (
        <div className="mt-6">
          <Card
            title="Send in progress"
            description={progress.campaignName ?? progress.subject ?? undefined}
            actions={
              <>
                <Badge tone={progress.state === 'paused' ? 'warning' : 'success'}>
                  {progress.state === 'paused' ? 'Paused' : 'Sending'}
                </Badge>
                <Link href="/compose">
                  <Button size="sm" variant="secondary">
                    Open controls
                  </Button>
                </Link>
              </>
            }
          >
            <ProgressBar value={progress.sent + progress.failed + progress.skipped} max={progress.total} showLabel />
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric label="Sent" value={formatNumber(progress.sent)} tone="text-emerald-600 dark:text-emerald-400" />
              <Metric label="Remaining" value={formatNumber(progress.remaining)} />
              <Metric label="Failed" value={formatNumber(progress.failed)} tone="text-red-600 dark:text-red-400" />
              <Metric label="Time left" value={formatDuration(progress.etaMs)} />
            </dl>
            {progress.currentEmail && (
              <p className="mt-4 truncate text-sm text-slate-500 dark:text-slate-400">
                Currently sending to <span className="font-medium text-slate-700 dark:text-slate-200">{progress.currentEmail}</span>
              </p>
            )}
          </Card>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card
          title="Last 14 days"
          description="Sent and failed messages per day."
          className="lg:col-span-2"
        >
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <ActivityChart series={stats?.dailySeries ?? []} />
          )}
        </Card>

        <Card
          title="Recent activity"
          actions={
            <Link href="/logs" className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
              View all
            </Link>
          }
          bodyClassName="p-0"
        >
          {loading ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (stats?.recentActivity.length ?? 0) === 0 ? (
            <EmptyState
              icon={<ClockIcon className="h-8 w-8" />}
              title="No activity yet"
              description="Sent emails will appear here as they go out."
            />
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {stats?.recentActivity.map((item) => (
                <li key={item.id} className="flex items-start gap-3 px-5 py-3">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      item.status === 'sent' ? 'bg-emerald-500' : item.status === 'failed' ? 'bg-red-500' : 'bg-slate-400'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{item.recipient}</p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {item.error ?? item.subject ?? '—'}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{formatRelative(item.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${tone ?? 'text-slate-900 dark:text-slate-100'}`}>
        {value}
      </dd>
    </div>
  );
}

/**
 * Small inline bar chart. Built with divs rather than a charting library — it is
 * two series over fourteen points, and a dependency would cost more than it gives.
 */
function ActivityChart({ series }: { series: Array<{ day: string; sent: number; failed: number }> }) {
  if (series.length === 0) {
    return (
      <EmptyState
        icon={<SendIcon className="h-8 w-8" />}
        title="Nothing sent yet"
        description="Once you run a campaign, daily volume shows up here."
      />
    );
  }

  const max = Math.max(1, ...series.map((point) => point.sent + point.failed));

  return (
    <div>
      <div className="flex h-40 items-end gap-1.5">
        {series.map((point) => {
          const total = point.sent + point.failed;
          return (
            <div key={point.day} className="group relative flex flex-1 flex-col justify-end gap-0.5">
              {point.failed > 0 && (
                <div
                  className="w-full rounded-t bg-red-400 dark:bg-red-500/70"
                  style={{ height: `${(point.failed / max) * 100}%` }}
                />
              )}
              <div
                className="w-full rounded-t bg-brand-500 transition-colors group-hover:bg-brand-600 dark:bg-brand-500/80"
                style={{ height: `${(point.sent / max) * 100}%`, minHeight: point.sent > 0 ? '2px' : '0' }}
              />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded bg-slate-900 px-2 py-1 text-xs whitespace-nowrap text-white group-hover:block dark:bg-slate-700">
                {point.day}: {point.sent} sent{point.failed > 0 ? `, ${point.failed} failed` : ''} ({total} total)
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand-500" /> Sent
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-red-400" /> Failed
        </span>
      </div>
    </div>
  );
}
