'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell, PageHeader } from '@/components/AppShell';
import { useConfirm, useToast } from '@/components/providers';
import { ApiError, api } from '@/lib/api';
import { useApi, useDebounced } from '@/lib/hooks';
import { formatRelative } from '@/lib/format';
import type { Recipient, RecipientGroup } from '@/lib/types';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  PlusIcon,
  SearchIcon,
  Select,
  Spinner,
  Textarea,
  TrashIcon,
  UploadIcon,
  UsersIcon,
  cn,
} from '@/components/ui';

export default function RecipientsPage() {
  return (
    <AppShell>
      <Recipients />
    </AppShell>
  );
}

interface ParseSummary {
  valid: number;
  invalid: number;
  duplicates: number;
  totalTokens: number;
  preview: Array<{ email: string; name?: string }>;
  invalidSamples: string[];
}

function Recipients() {
  const toast = useToast();
  const confirm = useConfirm();

  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<string>('');
  /** The Add Recipient list proper: everyone with no outreach on record. */
  const [awaitingOnly, setAwaitingOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const pageSize = 50;

  const debouncedSearch = useDebounced(search, 350);

  const listPath = useMemo(() => {
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String(page * pageSize),
      includeUnsubscribed: 'true',
    });
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (groupFilter) params.set('groupId', groupFilter);
    if (awaitingOnly) params.set('awaitingFirstContact', 'true');
    return `/api/recipients?${params.toString()}`;
  }, [debouncedSearch, groupFilter, page, awaitingOnly]);

  const listQuery = useApi<{ recipients: Recipient[]; total: number; awaitingTotal: number }>(listPath);
  const groupsQuery = useApi<{ groups: RecipientGroup[] }>('/api/recipients/groups/all');

  // Any change to the filters invalidates the current page index.
  useEffect(() => {
    setPage(0);
    setSelected(new Set());
  }, [debouncedSearch, groupFilter, awaitingOnly]);

  const refreshAll = useCallback(async () => {
    await Promise.all([listQuery.reload(), groupsQuery.reload()]);
    setSelected(new Set());
  }, [listQuery, groupsQuery]);

  const recipients = listQuery.data?.recipients ?? [];
  const total = listQuery.data?.total ?? 0;
  /** What a first-contact campaign would actually reach. */
  const awaiting = listQuery.data?.awaitingTotal ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const toggleSelect = (id: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteSelected = async () => {
    const ids = [...selected];
    const ok = await confirm({
      title: `Delete ${ids.length} recipient${ids.length === 1 ? '' : 's'}?`,
      message: 'They will be removed from your address book. Past sending logs are kept.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;

    await toast.run(api.post('/api/recipients/delete', { ids }), {
      success: `Deleted ${ids.length} recipient${ids.length === 1 ? '' : 's'}`,
      error: 'Could not delete recipients',
    });
    await refreshAll();
  };

  const deleteAll = async () => {
    const ok = await confirm({
      title: 'Delete every recipient?',
      message: `This permanently removes all ${total.toLocaleString()} recipients from your address book. This cannot be undone.`,
      confirmLabel: 'Delete everything',
      tone: 'danger',
      requireTyping: 'DELETE',
    });
    if (!ok) return;

    await toast.run(api.del('/api/recipients'), { success: 'All recipients deleted', error: 'Could not delete' });
    await refreshAll();
  };

  /**
   * Housekeeping. Nothing here is needed to send — contacted addresses are left
   * out of a campaign either way — so this is only about the list reading as
   * what it is: the people still to email.
   */
  const pruneContacted = async () => {
    const done = total - awaiting;
    const ok = await confirm({
      title: `Remove ${done.toLocaleString()} contacted recipient${done === 1 ? '' : 's'}?`,
      message:
        'These have already been emailed, so no campaign would send to them anyway. Anyone who opted out or bounced is kept here so they can never be added back.',
      confirmLabel: 'Remove them',
    });
    if (!ok) return;

    const result = await toast.run(api.post<{ removed: number }>('/api/recipients/prune-contacted'), {
      error: 'Could not remove them',
    });
    if (result) {
      toast.success(`Removed ${result.removed.toLocaleString()} already-contacted recipient${result.removed === 1 ? '' : 's'}`);
      await refreshAll();
    }
  };

  const dedupe = async () => {
    const result = await toast.run(api.post<{ removed: number }>('/api/recipients/dedupe'), {
      error: 'Could not remove duplicates',
    });
    if (result) {
      toast.success(
        result.removed === 0 ? 'No duplicates found' : `Removed ${result.removed} duplicate${result.removed === 1 ? '' : 's'}`,
      );
      await refreshAll();
    }
  };

  return (
    <>
      <PageHeader
        title="Recipients"
        description="Paste addresses or upload a CSV. Duplicates and invalid addresses are removed automatically."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => void dedupe()}>
              Remove duplicates
            </Button>
            {total > awaiting && (
              <Button variant="secondary" size="sm" onClick={() => void pruneContacted()}>
                Remove contacted ({(total - awaiting).toLocaleString()})
              </Button>
            )}
            {total > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                onClick={() => void deleteAll()}
              >
                Delete all
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="space-y-6 xl:col-span-2">
          <ManualEntry groups={groupsQuery.data?.groups ?? []} onImported={refreshAll} />
          <CsvUpload groups={groupsQuery.data?.groups ?? []} onImported={refreshAll} />
          <GroupManager groups={groupsQuery.data?.groups ?? []} onChanged={() => void groupsQuery.reload()} />
        </div>

        <div className="xl:col-span-3">
          <Card
            title={`Address book (${total.toLocaleString()}) · ${awaiting.toLocaleString()} still to email`}
            actions={
              selected.size > 0 && (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void deleteSelected()}
                  icon={<TrashIcon className="h-3.5 w-3.5" />}
                >
                  Delete {selected.size}
                </Button>
              )
            }
            bodyClassName="p-0"
          >
            <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row dark:border-slate-800">
              <div className="relative flex-1">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by email, name, or company…"
                  className="pl-9"
                  aria-label="Search recipients"
                />
              </div>
              <Select
                value={groupFilter}
                onChange={(event) => setGroupFilter(event.target.value)}
                className="sm:w-48"
                aria-label="Filter by group"
              >
                <option value="">All groups</option>
                {groupsQuery.data?.groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name} ({group.member_count ?? 0})
                  </option>
                ))}
              </Select>
              <Checkbox
                checked={awaitingOnly}
                onChange={(event) => setAwaitingOnly(event.target.checked)}
                label="Not emailed yet"
              />
            </div>

            {listQuery.loading ? (
              <div className="flex items-center justify-center gap-3 py-16 text-slate-500">
                <Spinner className="h-5 w-5" />
                <span className="text-sm">Loading recipients…</span>
              </div>
            ) : recipients.length === 0 ? (
              <EmptyState
                icon={<UsersIcon className="h-8 w-8" />}
                title={search || groupFilter ? 'No matching recipients' : 'No recipients yet'}
                description={
                  search || groupFilter
                    ? 'Try a different search term or clear the filters.'
                    : 'Paste addresses in the box on the left, or upload a CSV.'
                }
              />
            ) : (
              <>
                <div className="scroll-thin overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left dark:bg-slate-950">
                      <tr>
                        <th className="w-10 px-4 py-2.5">
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer rounded border-slate-300 text-brand-600 dark:border-slate-600 dark:bg-slate-800"
                            checked={recipients.length > 0 && recipients.every((r) => selected.has(r.id))}
                            onChange={(event) =>
                              setSelected(event.target.checked ? new Set(recipients.map((r) => r.id)) : new Set())
                            }
                            aria-label="Select all on this page"
                          />
                        </th>
                        <th className="px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400">Email</th>
                        <th className="px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400">Name</th>
                        <th className="px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400">Source</th>
                        <th className="px-4 py-2.5 text-xs font-medium text-slate-500 dark:text-slate-400">Added</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {recipients.map((recipient) => (
                        <tr
                          key={recipient.id}
                          className={cn(
                            'hover:bg-slate-50 dark:hover:bg-slate-800/50',
                            selected.has(recipient.id) && 'bg-brand-50/60 dark:bg-brand-500/5',
                          )}
                        >
                          <td className="px-4 py-2.5">
                            <input
                              type="checkbox"
                              className="h-4 w-4 cursor-pointer rounded border-slate-300 text-brand-600 dark:border-slate-600 dark:bg-slate-800"
                              checked={selected.has(recipient.id)}
                              onChange={() => toggleSelect(recipient.id)}
                              aria-label={`Select ${recipient.email}`}
                            />
                          </td>
                          <td className="max-w-xs truncate px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                            {recipient.email}
                            {recipient.unsubscribed && (
                              <Badge tone="warning" className="ml-2">
                                Unsubscribed
                              </Badge>
                            )}
                            {/* Held back from the next campaign, and this is why. */}
                            {recipient.contactedAt && (
                              <span title={`Emailed ${recipient.contactedAt}`}>
                                <Badge tone="neutral" className="ml-2">
                                  Contacted
                                </Badge>
                              </span>
                            )}
                          </td>
                          <td className="max-w-[10rem] truncate px-4 py-2.5 text-slate-600 dark:text-slate-400">
                            {recipient.name ?? '—'}
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge tone={recipient.source === 'csv' ? 'brand' : 'neutral'}>
                              {recipient.source}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5 text-xs whitespace-nowrap text-slate-400">
                            {formatRelative(recipient.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 dark:border-slate-800">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Page {page + 1} of {totalPages} · {total.toLocaleString()} recipients
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
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function ManualEntry({ groups, onImported }: { groups: RecipientGroup[]; onImported: () => Promise<void> }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [groupId, setGroupId] = useState<string>('');
  const [summary, setSummary] = useState<ParseSummary | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);

  const debouncedText = useDebounced(text, 400);

  // Live validation while typing, so the counts update as you paste.
  useEffect(() => {
    if (!debouncedText.trim()) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    setParsing(true);
    api
      .post<ParseSummary>('/api/recipients/parse', { text: debouncedText })
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      })
      .finally(() => {
        if (!cancelled) setParsing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedText]);

  const runImport = async () => {
    setImporting(true);
    const result = await toast.run(
      api.post<{ imported: number; alreadyPresent: number; updated: number; totalRecipients: number }>(
        '/api/recipients/import/manual',
        { text, groupId: groupId ? Number(groupId) : null },
      ),
      { error: 'Import failed' },
    );
    setImporting(false);

    if (result) {
      toast.success(
        `Added ${result.imported} recipient${result.imported === 1 ? '' : 's'}`,
        result.alreadyPresent + result.updated > 0
          ? `${result.alreadyPresent + result.updated} were already in your list`
          : undefined,
      );
      setText('');
      setSummary(null);
      await onImported();
    }
  };

  return (
    <Card
      title="Add recipients manually"
      description="Separate with commas, semicolons, or new lines — the format is detected automatically."
    >
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={8}
        className="font-mono text-xs"
        placeholder={'john@example.com, ali@example.com\nSara Khan <sara@example.com>\nmike@example.com; anna@example.com'}
        aria-label="Recipient addresses"
      />

      {(summary || parsing) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {parsing ? (
            <Badge tone="neutral">
              <Spinner className="h-3 w-3" /> Checking…
            </Badge>
          ) : (
            summary && (
              <>
                <Badge tone="success">{summary.valid} valid</Badge>
                {summary.duplicates > 0 && <Badge tone="warning">{summary.duplicates} duplicate</Badge>}
                {summary.invalid > 0 && <Badge tone="danger">{summary.invalid} invalid</Badge>}
              </>
            )
          )}
        </div>
      )}

      {summary && summary.invalidSamples.length > 0 && (
        <div className="mt-3">
          <Alert tone="warning" title={`${summary.invalid} address${summary.invalid === 1 ? '' : 'es'} will be skipped`}>
            <ul className="space-y-0.5 font-mono text-xs">
              {summary.invalidSamples.slice(0, 5).map((sample, index) => (
                <li key={index} className="truncate">
                  {sample}
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          onClick={() => void runImport()}
          loading={importing}
          disabled={!summary || summary.valid === 0}
          icon={<PlusIcon className="h-4 w-4" />}
        >
          Add {summary?.valid ? `${summary.valid} ` : ''}recipient{summary?.valid === 1 ? '' : 's'}
        </Button>
        {groups.length > 0 && (
          <Select value={groupId} onChange={(event) => setGroupId(event.target.value)} className="w-auto" aria-label="Group">
            <option value="">No group</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </Select>
        )}
        {text && (
          <Button variant="ghost" onClick={() => setText('')}>
            Clear
          </Button>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function CsvUpload({ groups, onImported }: { groups: RecipientGroup[]; onImported: () => Promise<void> }) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [groupId, setGroupId] = useState<string>('');

  const handleFile = async (file: File) => {
    if (file.size > 15 * 1024 * 1024) {
      toast.error('File too large', 'CSV uploads are limited to 15 MB.');
      return;
    }

    setUploading(true);
    try {
      const content = await file.text();
      const result = await api.post<{
        imported: number;
        alreadyPresent: number;
        updated: number;
        invalid: number;
        duplicatesInFile: number;
        scannedRows: number;
      }>('/api/recipients/import/csv', {
        content,
        filename: file.name,
        hasHeaderRow: true,
        groupId: groupId ? Number(groupId) : null,
      });

      toast.success(
        `Imported ${result.imported} recipient${result.imported === 1 ? '' : 's'} from ${file.name}`,
        [
          result.alreadyPresent + result.updated > 0 && `${result.alreadyPresent + result.updated} already present`,
          result.duplicatesInFile > 0 && `${result.duplicatesInFile} duplicates in file`,
          result.invalid > 0 && `${result.invalid} invalid`,
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
      );
      await onImported();
    } catch (err) {
      toast.error('CSV import failed', err instanceof ApiError ? err.message : undefined);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Card title="Upload a CSV" description="The email column is detected automatically.">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void handleFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors',
          dragging
            ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10'
            : 'border-slate-300 hover:border-brand-400 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/50',
        )}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
        }}
      >
        {uploading ? (
          <Spinner className="h-6 w-6 text-brand-600" />
        ) : (
          <UploadIcon className="h-6 w-6 text-slate-400" />
        )}
        <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-300">
          {uploading ? 'Importing…' : 'Drop a CSV here, or click to browse'}
        </p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">.csv, .tsv or .txt — up to 15 MB</p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      </div>

      {groups.length > 0 && (
        <div className="mt-3">
          <Select value={groupId} onChange={(event) => setGroupId(event.target.value)} aria-label="Assign to group">
            <option value="">No group</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                Add to: {group.name}
              </option>
            ))}
          </Select>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function GroupManager({ groups, onChanged }: { groups: RecipientGroup[]; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    const result = await toast.run(api.post('/api/recipients/groups', { name: name.trim() }), {
      success: `Group "${name.trim()}" created`,
      error: 'Could not create the group',
    });
    setCreating(false);
    if (result) {
      setName('');
      onChanged();
    }
  };

  const remove = async (group: RecipientGroup) => {
    const ok = await confirm({
      title: `Delete the group "${group.name}"?`,
      message: 'The recipients themselves are kept — they simply become ungrouped.',
      confirmLabel: 'Delete group',
      tone: 'danger',
    });
    if (!ok) return;

    await toast.run(api.del(`/api/recipients/groups/${group.id}`), {
      success: 'Group deleted',
      error: 'Could not delete the group',
    });
    onChanged();
  };

  return (
    <Card title="Groups" description="Optional — segment your address book and send to one segment at a time.">
      <Field htmlFor="group-name">
        <div className="flex gap-2">
          <Input
            id="group-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void create();
            }}
            placeholder="e.g. Newsletter subscribers"
          />
          <Button onClick={() => void create()} loading={creating} disabled={!name.trim()}>
            Create
          </Button>
        </div>
      </Field>

      {groups.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {groups.map((group) => (
            <li
              key={group.id}
              className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-950"
            >
              <span className="min-w-0 truncate text-sm text-slate-700 dark:text-slate-300">{group.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge tone="neutral">{group.member_count ?? 0}</Badge>
                <button
                  onClick={() => void remove(group)}
                  className="text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                  aria-label={`Delete group ${group.name}`}
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
