'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { AppShell, PageHeader } from '@/components/AppShell';
import { useConfirm, useToast } from '@/components/providers';
import { api, downloadFile } from '@/lib/api';
import { useApi, useDebounced, useEventStream } from '@/lib/hooks';
import { formatDateTime, formatDuration, truncateMiddle } from '@/lib/format';
import type { SendLog } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  DownloadIcon,
  EmptyState,
  Input,
  ListIcon,
  RefreshIcon,
  SearchIcon,
  Select,
  Spinner,
  TrashIcon,
  cn,
} from '@/components/ui';

export default function LogsPage() {
  return (
    <AppShell>
      <Logs />
    </AppShell>
  );
}

const PAGE_SIZE = 50;

function Logs() {
  const toast = useToast();
  const confirm = useConfirm();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const debouncedSearch = useDebounced(search, 350);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (status) params.set('status', status);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return params;
  }, [debouncedSearch, status, from, to]);

  const listPath = useMemo(() => {
    const params = new URLSearchParams(queryString);
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(page * PAGE_SIZE));
    return `/api/logs?${params.toString()}`;
  }, [queryString, page]);

  const logsQuery = useApi<{
    logs: SendLog[];
    total: number;
    counts: Record<string, number>;
  }>(listPath);

  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, status, from, to]);

  // Live-append: when a send is running, new rows should appear without a refresh.
  useEventStream({
    onLog: () => {
      if (page === 0) void logsQuery.reload();
    },
  });

  const logs = logsQuery.data?.logs ?? [];
  const total = logsQuery.data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const counts = logsQuery.data?.counts ?? {};

  const exportFile = async (format: 'csv' | 'xls') => {
    setDownloading(format);
    try {
      const params = new URLSearchParams(queryString);
      params.set('limit', '5000');
      await downloadFile(
        `/api/logs/export.${format}?${params.toString()}`,
        `send-logs-${new Date().toISOString().slice(0, 10)}.${format}`,
      );
      toast.success(`Exported as ${format.toUpperCase()}`);
    } catch {
      toast.error('Export failed', 'Could not generate the file.');
    } finally {
      setDownloading(null);
    }
  };

  const clearLogs = async () => {
    const ok = await confirm({
      title: 'Delete all sending logs?',
      message: `This permanently removes all ${total.toLocaleString()} log entries. Recipients and campaigns are unaffected.`,
      confirmLabel: 'Delete logs',
      tone: 'danger',
      requireTyping: 'DELETE',
    });
    if (!ok) return;

    await toast.run(api.del('/api/logs'), { success: 'Logs cleared', error: 'Could not clear the logs' });
    await logsQuery.reload();
  };

  const hasFilters = Boolean(search || status || from || to);

  return (
    <>
      <PageHeader
        title="Sending Logs"
        description="Every send attempt, with its Gmail message ID and any error returned."
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void exportFile('csv')}
              loading={downloading === 'csv'}
              icon={<DownloadIcon className="h-4 w-4" />}
              disabled={total === 0}
            >
              CSV
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void exportFile('xls')}
              loading={downloading === 'xls'}
              icon={<DownloadIcon className="h-4 w-4" />}
              disabled={total === 0}
            >
              Excel
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void logsQuery.reload()} icon={<RefreshIcon className="h-4 w-4" />}>
              Refresh
            </Button>
            {total > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                onClick={() => void clearLogs()}
                icon={<TrashIcon className="h-4 w-4" />}
              >
                Clear
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryTile label="Total" value={total} />
        <SummaryTile label="Sent" value={counts.sent ?? 0} tone="text-emerald-600 dark:text-emerald-400" />
        <SummaryTile label="Failed" value={counts.failed ?? 0} tone="text-red-600 dark:text-red-400" />
        <SummaryTile label="Skipped" value={counts.skipped ?? 0} tone="text-amber-600 dark:text-amber-400" />
      </div>

      <Card bodyClassName="p-0">
        <div className="grid grid-cols-1 gap-3 border-b border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-5 dark:border-slate-800">
          <div className="relative lg:col-span-2">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search recipient, subject, message ID or error…"
              className="pl-9"
              aria-label="Search logs"
            />
          </div>

          <Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
          </Select>

          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From date" />
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To date" />
        </div>

        {hasFilters && (
          <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-800 dark:bg-slate-950">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Showing {total.toLocaleString()} filtered result{total === 1 ? '' : 's'}
            </span>
            <button
              onClick={() => {
                setSearch('');
                setStatus('');
                setFrom('');
                setTo('');
              }}
              className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              Clear filters
            </button>
          </div>
        )}

        {logsQuery.loading ? (
          <div className="flex items-center justify-center gap-3 py-16 text-slate-500">
            <Spinner className="h-5 w-5" />
            <span className="text-sm">Loading logs…</span>
          </div>
        ) : logs.length === 0 ? (
          <EmptyState
            icon={<ListIcon className="h-8 w-8" />}
            title={hasFilters ? 'No logs match those filters' : 'No sending activity yet'}
            description={
              hasFilters ? 'Try widening the date range or clearing the search.' : 'Logs appear here as soon as you send your first campaign.'
            }
          />
        ) : (
          <>
            <div className="scroll-thin overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left dark:bg-slate-950">
                  <tr>
                    <th className="px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400">Status</th>
                    <th className="px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400">Recipient</th>
                    <th className="hidden px-4 py-2.5 text-xs font-medium text-slate-500 md:table-cell dark:text-slate-400">
                      Subject
                    </th>
                    <th className="hidden px-4 py-2.5 text-xs font-medium text-slate-500 lg:table-cell dark:text-slate-400">
                      Message ID
                    </th>
                    <th className="px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {logs.map((log) => (
                    // Fragment needs an explicit key: each log renders two sibling rows.
                    <Fragment key={log.id}>
                      <tr
                        onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                        className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      >
                        <td className="px-4 py-2.5">
                          <Badge
                            tone={log.status === 'sent' ? 'success' : log.status === 'failed' ? 'danger' : 'warning'}
                          >
                            {log.status}
                          </Badge>
                        </td>
                        <td className="max-w-[14rem] px-4 py-2.5">
                          <p className="truncate font-medium text-slate-900 dark:text-slate-100">{log.recipient}</p>
                          {log.recipientName && (
                            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{log.recipientName}</p>
                          )}
                        </td>
                        <td className="hidden max-w-[16rem] truncate px-4 py-2.5 text-slate-600 md:table-cell dark:text-slate-400">
                          {log.subject ?? '—'}
                        </td>
                        <td className="hidden px-4 py-2.5 font-mono text-xs text-slate-400 lg:table-cell">
                          {log.messageId ? truncateMiddle(log.messageId, 20) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-xs whitespace-nowrap text-slate-500 dark:text-slate-400">
                          {formatDateTime(log.createdAt)}
                        </td>
                      </tr>
                      {expanded === log.id && (
                        <tr className="bg-slate-50 dark:bg-slate-950">
                          <td colSpan={5} className="px-4 py-4">
                            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                              <Detail label="Campaign" value={log.campaignName ?? (log.campaignId ? `#${log.campaignId}` : '—')} />
                              <Detail label="Sent from" value={log.accountEmail ?? '—'} />
                              <Detail label="Attempts" value={String(log.attempts)} />
                              <Detail label="Duration" value={formatDuration(log.durationMs)} />
                              {log.messageId && (
                                <Detail label="Gmail message ID" value={log.messageId} className="sm:col-span-2 lg:col-span-4" mono />
                              )}
                              {log.error && (
                                <div className="sm:col-span-2 lg:col-span-4">
                                  <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Error</dt>
                                  <dd className="mt-1 rounded-lg bg-red-50 p-2.5 text-xs break-words text-red-700 dark:bg-red-500/10 dark:text-red-400">
                                    {log.error}
                                  </dd>
                                </div>
                              )}
                            </dl>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 dark:border-slate-800">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Page {page + 1} of {totalPages.toLocaleString()} · {total.toLocaleString()} entries
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', tone ?? 'text-slate-900 dark:text-slate-100')}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function Detail({
  label,
  value,
  className,
  mono,
}: {
  label: string;
  value: string;
  className?: string;
  mono?: boolean;
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-sm break-words text-slate-700 dark:text-slate-300',
          mono && 'font-mono text-xs',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
