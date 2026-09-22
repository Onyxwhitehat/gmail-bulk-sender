'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AppShell, PageHeader } from '@/components/AppShell';
import { RichTextEditor } from '@/components/RichTextEditor';
import { useConfirm, useToast } from '@/components/providers';
import { ApiError, api } from '@/lib/api';
import { useApi, useEventStream } from '@/lib/hooks';
import { formatBytes, formatDuration, formatNumber } from '@/lib/format';
import type { Attachment, Campaign, EmailTemplate, ProgressSnapshot, RecipientGroup } from '@/lib/types';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  PauseIcon,
  PlayIcon,
  ProgressBar,
  SendIcon,
  Select,
  Spinner,
  StopIcon,
  TrashIcon,
  UploadIcon,
  UsersIcon,
  XIcon,
  cn,
} from '@/components/ui';

interface PreviewResponse {
  recipientCount: number;
  sampleRecipients: Array<{ email: string; name: string | null }>;
  renderedSubject: string;
  renderedBody: string;
  estimate: { totalMs: number; human: string; delayRange: [number, number] };
  dailyLimit: number;
  dailySent: number;
  /** Addresses deliberately left out of the send. */
  skipped?: SkippedRecipient[];
}

/** An address the send is leaving out, and why. */
interface SkippedRecipient {
  email: string;
  reason: 'already-contacted';
  /** The date of that first contact, when one is on record. */
  detail: string;
}

export default function ComposePage() {
  return (
    <AppShell>
      <Compose />
    </AppShell>
  );
}

const DRAFT_KEY = 'bes-compose-draft';

function Compose() {
  const toast = useToast();
  const confirm = useConfirm();

  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [groupId, setGroupId] = useState<string>('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [skipContacted, setSkipContacted] = useState(true);

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [progress, setProgress] = useState<ProgressSnapshot | null>(null);
  const [activeCampaign, setActiveCampaign] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);

  const groupsQuery = useApi<{ groups: RecipientGroup[] }>('/api/recipients/groups/all');
  const templatesQuery = useApi<{ templates: EmailTemplate[] }>('/api/templates');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEventStream({ onProgress: setProgress });

  // Restore an in-progress draft after a reload or accidental navigation.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(DRAFT_KEY);
      if (!stored) return;
      const draft = JSON.parse(stored) as { subject: string; bodyHtml: string; campaignName?: string };
      setSubject(draft.subject ?? '');
      setBodyHtml(draft.bodyHtml ?? '');
      setCampaignName(draft.campaignName ?? '');
    } catch {
      /* corrupt draft — ignore */
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ subject, bodyHtml, campaignName }));
      } catch {
        /* storage unavailable */
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [subject, bodyHtml, campaignName]);

  // Adopt an already-running campaign (e.g. after a page refresh mid-send).
  useEffect(() => {
    if (progress?.campaignId && progress.state !== 'idle') setActiveCampaign(progress.campaignId);
  }, [progress]);

  /**
   * Who this campaign is for — the one definition preview and send both use.
   * `skipContacted` is what keeps an address already emailed out of a
   * first-contact campaign.
   */
  const audience = useMemo(
    () => ({ groupId: groupId ? Number(groupId) : null, includeAll: !groupId, skipContacted }),
    [skipContacted, groupId],
  );

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      setPreview(await api.post<PreviewResponse>('/api/campaigns/preview', { subject, bodyHtml, ...audience }));
    } catch (err) {
      toast.error('Could not build the preview', err instanceof ApiError ? err.message : undefined);
    } finally {
      setPreviewLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, bodyHtml, audience]);

  useEffect(() => {
    void loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience]);

  const isBusy = progress?.state === 'running' || progress?.state === 'paused' || progress?.state === 'cancelling';

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------

  const send = async () => {
    if (!subject.trim()) {
      toast.error('Subject is required');
      return;
    }
    if (!bodyHtml.replace(/<[^>]*>/g, '').trim() && !bodyHtml.includes('<img')) {
      toast.error('The email body is empty');
      return;
    }

    const fresh = await api
      .post<PreviewResponse>('/api/campaigns/preview', { subject, bodyHtml, ...audience })
      .catch(() => null);

    const count = fresh?.recipientCount ?? preview?.recipientCount ?? 0;
    if (count === 0) {
      const omitted = fresh?.skipped ?? preview?.skipped ?? [];
      toast.error(
        'No recipients selected',
        omitted.length
          ? 'Every address in your selection has already been emailed. Untick "Skip contacts already emailed" to send anyway.'
          : 'Import recipients before sending.',
      );
      return;
    }

    const overLimit = fresh ? fresh.dailySent + count > fresh.dailyLimit : false;

    const ok = await confirm({
      title: `Send to ${count.toLocaleString()} recipient${count === 1 ? '' : 's'}?`,
      message: (
        <div className="space-y-2">
          <p>
            Are you sure you want to send emails to <strong>{count.toLocaleString()}</strong> recipients? Each message
            goes out individually through the Gmail API.
          </p>
          <p className="text-xs">
            Subject: <span className="font-medium">{subject}</span>
            <br />
            Estimated time: <span className="font-medium">{fresh?.estimate.human ?? preview?.estimate.human ?? '—'}</span>
          </p>
          {overLimit && (
            <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
              This exceeds your remaining daily limit ({fresh!.dailyLimit - fresh!.dailySent} left). Sending will pause
              automatically when the limit is reached.
            </p>
          )}
        </div>
      ),
      confirmLabel: `Send ${count.toLocaleString()} email${count === 1 ? '' : 's'}`,
      requireTyping: count >= 100 ? 'SEND' : undefined,
    });
    if (!ok) return;

    setStarting(true);
    try {
      const created = await api.post<{ campaign: Campaign; queued: number }>('/api/campaigns', {
        name: campaignName.trim() || undefined,
        subject,
        bodyHtml,
        attachments,
        ...audience,
      });

      setActiveCampaign(created.campaign.id);
      await api.post(`/api/campaigns/${created.campaign.id}/send`);
      toast.success('Sending started', `${created.queued.toLocaleString()} emails queued`);
    } catch (err) {
      toast.error('Could not start sending', err instanceof ApiError ? err.message : undefined);
    } finally {
      setStarting(false);
    }
  };

  const control = async (action: 'pause' | 'resume' | 'cancel' | 'clear-queue') => {
    const campaignId = activeCampaign ?? progress?.campaignId;
    if (!campaignId) return;

    if (action === 'cancel') {
      const ok = await confirm({
        title: 'Cancel this send?',
        message: 'Emails already sent cannot be recalled. The remaining queue is stopped and can be resumed later.',
        confirmLabel: 'Stop sending',
        tone: 'danger',
      });
      if (!ok) return;
    }

    setControlBusy(true);
    await toast.run(api.post(`/api/campaigns/${campaignId}/${action}`), {
      error: `Could not ${action.replace('-', ' ')}`,
    });
    setControlBusy(false);
  };

  const addAttachment = async (file: File) => {
    if (file.size > 15 * 1024 * 1024) {
      toast.error('Attachment too large', 'Gmail rejects messages over 25 MB. Keep each file under 15 MB.');
      return;
    }

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    // Chunked to avoid blowing the argument limit on large files.
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }

    setAttachments((current) => [
      ...current,
      {
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        content: btoa(binary),
        size: file.size,
      },
    ]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const saveTemplate = async () => {
    const name = window.prompt('Template name', campaignName || subject.slice(0, 40));
    if (!name?.trim()) return;

    await toast.run(api.post('/api/templates', { name: name.trim(), subject, bodyHtml }), {
      success: 'Template saved',
      error: 'Could not save the template',
    });
    await templatesQuery.reload();
  };

  const totalAttachmentBytes = attachments.reduce((sum, a) => sum + a.size, 0);

  return (
    <>
      <PageHeader
        title="Compose"
        description="One subject and one body, sent individually to every recipient."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => void saveTemplate()} disabled={!subject && !bodyHtml}>
              Save as template
            </Button>
            <Button
              size="sm"
              onClick={() => void send()}
              loading={starting}
              disabled={isBusy}
              icon={<SendIcon className="h-4 w-4" />}
            >
              Send emails
            </Button>
          </>
        }
      />

      {isBusy && progress && (
        <div className="mb-6">
          <LiveProgress progress={progress} onControl={control} busy={controlBusy} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Message">
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Campaign name" hint="Internal label — recipients never see it." htmlFor="campaign-name">
                  <Input
                    id="campaign-name"
                    value={campaignName}
                    onChange={(event) => setCampaignName(event.target.value)}
                    placeholder="March newsletter"
                    disabled={isBusy}
                  />
                </Field>

                <Field label="Send to" htmlFor="group" hint="Everyone, or a single group.">
                  <Select id="group" value={groupId} onChange={(event) => setGroupId(event.target.value)} disabled={isBusy}>
                    <option value="">All recipients</option>
                    {groupsQuery.data?.groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name} ({group.member_count ?? 0})
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <AudienceNote
                preview={preview}
                skipContacted={skipContacted}
                onSkipContacted={setSkipContacted}
                busy={isBusy}
              />

              <Field label="Subject" required htmlFor="subject">
                <Input
                  id="subject"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  onBlur={() => void loadPreview()}
                  placeholder="Your subject line"
                  disabled={isBusy}
                  maxLength={1000}
                />
              </Field>

              <div>
                <label className="label-base">Email body</label>
                <RichTextEditor value={bodyHtml} onChange={setBodyHtml} disabled={isBusy} />
                <p className="hint">
                  Variables: <code className="font-mono">{'{{name}}'}</code>,{' '}
                  <code className="font-mono">{'{{email}}'}</code>,{' '}
                  <code className="font-mono">{'{{first_name}}'}</code>,{' '}
                  <code className="font-mono">{'{{company}}'}</code> — replaced per recipient. Unknown variables are left
                  as-is.
                </p>
              </div>

              <div>
                <label className="label-base">Attachments</label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isBusy}
                    icon={<UploadIcon className="h-4 w-4" />}
                  >
                    Add file
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void addAttachment(file);
                    }}
                  />
                  {attachments.length > 0 && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {attachments.length} file{attachments.length === 1 ? '' : 's'} · {formatBytes(totalAttachmentBytes)}
                    </span>
                  )}
                </div>

                {attachments.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {attachments.map((attachment, index) => (
                      <li
                        key={index}
                        className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-950"
                      >
                        <span className="min-w-0 truncate text-sm text-slate-700 dark:text-slate-300">
                          {attachment.filename}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="text-xs text-slate-400">{formatBytes(attachment.size)}</span>
                          <button
                            onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}
                            className="text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                            aria-label={`Remove ${attachment.filename}`}
                            disabled={isBusy}
                          >
                            <XIcon className="h-4 w-4" />
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {totalAttachmentBytes > 15 * 1024 * 1024 && (
                  <div className="mt-2">
                    <Alert tone="warning">
                      Attachments total {formatBytes(totalAttachmentBytes)}. Gmail rejects messages over 25 MB once
                      base64 encoding is applied.
                    </Alert>
                  </div>
                )}
              </div>
            </div>
          </Card>

          {(templatesQuery.data?.templates.length ?? 0) > 0 && (
            <Card title="Templates" description="Load a saved subject and body.">
              <ul className="space-y-1.5">
                {templatesQuery.data?.templates.map((template) => (
                  <li
                    key={template.id}
                    className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-950"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">{template.name}</p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">{template.subject || '—'}</p>
                    </div>
                    <span className="flex shrink-0 gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isBusy}
                        onClick={() => {
                          setSubject(template.subject);
                          setBodyHtml(template.bodyHtml);
                          toast.success(`Loaded "${template.name}"`);
                        }}
                      >
                        Load
                      </Button>
                      <button
                        onClick={async () => {
                          await api.del(`/api/templates/${template.id}`);
                          await templatesQuery.reload();
                        }}
                        className="p-1.5 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                        aria-label={`Delete template ${template.name}`}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card
            title="Preview"
            description="Rendered for your first recipient."
            actions={
              <Button size="sm" variant="secondary" onClick={() => void loadPreview()} loading={previewLoading}>
                Refresh
              </Button>
            }
          >
            {!preview ? (
              <div className="flex justify-center py-8">
                <Spinner className="h-5 w-5 text-slate-400" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Recipients</p>
                    <p className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {formatNumber(preview.recipientCount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Estimated time</p>
                    <p className="mt-0.5 text-xl font-semibold text-slate-900 dark:text-slate-100">
                      {preview.estimate.human}
                    </p>
                  </div>
                </div>

                {preview.recipientCount === 0 ? (
                  <EmptyState
                    icon={<UsersIcon className="h-8 w-8" />}
                    title="No recipients"
                    description="Import recipients before sending."
                    action={
                      <Link href="/recipients">
                        <Button size="sm">Add recipients</Button>
                      </Link>
                    }
                  />
                ) : (
                  <>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800">
                      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
                        <p className="text-xs text-slate-500 dark:text-slate-400">Subject</p>
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                          {preview.renderedSubject || <span className="text-slate-400">(no subject)</span>}
                        </p>
                      </div>
                      <div
                        className="rte-content scroll-thin max-h-72 overflow-y-auto p-3 text-slate-800 dark:text-slate-200"
                        // Safe: the server sanitises this HTML with a strict allow-list
                        // before it is returned from /api/campaigns/preview.
                        dangerouslySetInnerHTML={{
                          __html:
                            preview.renderedBody ||
                            '<p style="color:#94a3b8">Your email body will appear here.</p>',
                        }}
                      />
                    </div>

                    <div>
                      <p className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                        Sending to (first {Math.min(preview.sampleRecipients.length, 25)})
                      </p>
                      <div className="scroll-thin max-h-40 space-y-1 overflow-y-auto rounded-lg bg-slate-50 p-2 dark:bg-slate-950">
                        {preview.sampleRecipients.map((recipient) => (
                          <p key={recipient.email} className="truncate text-xs text-slate-600 dark:text-slate-400">
                            {recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email}
                          </p>
                        ))}
                        {preview.recipientCount > preview.sampleRecipients.length && (
                          <p className="pt-1 text-xs font-medium text-slate-500">
                            + {(preview.recipientCount - preview.sampleRecipients.length).toLocaleString()} more
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-950">
                      <span className="text-slate-500 dark:text-slate-400">Daily limit</span>
                      <span className="font-medium tabular-nums text-slate-700 dark:text-slate-300">
                        {preview.dailySent} / {preview.dailyLimit} used
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </Card>

          {!isBusy && (
            <Card title="Sending controls">
              <div className="space-y-2">
                <Button
                  className="w-full"
                  size="lg"
                  onClick={() => void send()}
                  loading={starting}
                  disabled={!preview?.recipientCount}
                  icon={<SendIcon className="h-4 w-4" />}
                >
                  Send emails
                </Button>
                {activeCampaign && (
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => void control('clear-queue')}
                    loading={controlBusy}
                  >
                    Clear queue
                  </Button>
                )}
              </div>
              <p className="hint">
                Messages are sent one at a time with a randomised delay. You will be asked to confirm before anything
                goes out.
              </p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function LiveProgress({
  progress,
  onControl,
  busy,
}: {
  progress: ProgressSnapshot;
  onControl: (action: 'pause' | 'resume' | 'cancel' | 'clear-queue') => Promise<void>;
  busy: boolean;
}) {
  const processed = progress.sent + progress.failed + progress.skipped;
  const paused = progress.state === 'paused';

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {paused ? 'Sending paused' : 'Sending in progress'}
          <Badge tone={paused ? 'warning' : 'success'}>
            <span className={cn('h-1.5 w-1.5 rounded-full', paused ? 'bg-amber-500' : 'animate-pulse bg-emerald-500')} />
            {progress.state}
          </Badge>
        </span>
      }
      description={progress.campaignName ?? progress.subject ?? undefined}
      actions={
        <>
          {paused ? (
            <Button size="sm" onClick={() => void onControl('resume')} loading={busy} icon={<PlayIcon className="h-3.5 w-3.5" />}>
              Resume
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void onControl('pause')}
              loading={busy}
              icon={<PauseIcon className="h-3.5 w-3.5" />}
            >
              Pause
            </Button>
          )}
          <Button
            size="sm"
            variant="danger"
            onClick={() => void onControl('cancel')}
            loading={busy}
            icon={<StopIcon className="h-3.5 w-3.5" />}
          >
            Cancel
          </Button>
        </>
      }
    >
      <ProgressBar value={processed} max={progress.total} tone={paused ? 'danger' : 'brand'} showLabel />

      <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Sent" value={formatNumber(progress.sent)} tone="text-emerald-600 dark:text-emerald-400" />
        <Metric label="Remaining" value={formatNumber(progress.remaining)} />
        <Metric label="Failed" value={formatNumber(progress.failed)} tone={progress.failed ? 'text-red-600 dark:text-red-400' : undefined} />
        <Metric label="Elapsed" value={formatDuration(progress.elapsedMs)} />
        <Metric label="Time left" value={formatDuration(progress.etaMs)} />
        <Metric label="Rate" value={`${progress.perMinute}/min`} />
      </dl>

      {progress.currentEmail && !paused && (
        <div className="mt-5 flex items-center gap-3 rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-950">
          <Spinner className="h-4 w-4 shrink-0 text-brand-600" />
          <div className="min-w-0">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Sending message {progress.currentIndex} of {progress.total}
            </p>
            <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
              {progress.currentName ? `${progress.currentName} <${progress.currentEmail}>` : progress.currentEmail}
            </p>
          </div>
        </div>
      )}

      {progress.pauseReason && (
        <div className="mt-4">
          <Alert tone="warning" title="Paused">
            {progress.pauseReason}
          </Alert>
        </div>
      )}

      {progress.lastError && !progress.pauseReason && (
        <div className="mt-4">
          <Alert tone="danger" title="Most recent error">
            {progress.lastError}
          </Alert>
        </div>
      )}
    </Card>
  );
}

/**
 * Who the send is for, and who is being left out.
 *
 * The exclusions are named rather than summed: an address held back as already
 * emailed is a deliberate guard, and the operator can lift it here rather than
 * wondering why the count is short.
 */
function AudienceNote({
  preview,
  skipContacted,
  onSkipContacted,
  busy,
}: {
  preview: PreviewResponse | null;
  skipContacted: boolean;
  onSkipContacted: (next: boolean) => void;
  busy: boolean;
}) {
  const skipped = preview?.skipped ?? [];

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/50">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-slate-700 dark:text-slate-300">
          <strong className="font-mono">{(preview?.recipientCount ?? 0).toLocaleString('en-US')}</strong> will be
          emailed, then marked as contacted.
        </span>
        <Checkbox
          checked={skipContacted}
          onChange={(event) => onSkipContacted(event.target.checked)}
          disabled={busy}
          label="Skip contacts already emailed"
        />
      </div>

      {skipped.length > 0 && (
        <p className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
          <span className="font-medium">{skipped.length} already emailed</span>
          <span className="ml-1.5 font-mono text-[11px] text-slate-400 dark:text-slate-500">
            {skipped
              .slice(0, 6)
              .map((entry) => entry.email)
              .join(', ')}
            {skipped.length > 6 && ` +${skipped.length - 6} more`}
          </span>
        </p>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={cn('mt-0.5 text-lg font-semibold tabular-nums', tone ?? 'text-slate-900 dark:text-slate-100')}>
        {value}
      </dd>
    </div>
  );
}
