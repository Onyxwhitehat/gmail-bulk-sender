'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AppShell, PageHeader } from '@/components/AppShell';
import { useToast } from '@/components/providers';
import { ApiError, api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import type { RecipientGroup, Spreadsheet } from '@/lib/types';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  RefreshIcon,
  Select,
  SheetIcon,
  Spinner,
  UploadIcon,
} from '@/components/ui';

interface PreviewData {
  worksheet: string;
  header: string[];
  rows: string[][];
  totalRows: number;
  suggestedEmailColumn: number;
  suggestedNameColumn: number;
}

interface ImportResult {
  imported: number;
  updated: number;
  alreadyPresent: number;
  invalid: number;
  invalidSamples: string[];
  duplicatesInSheet: number;
  scannedRows: number;
  totalRecipients: number;
}

export default function SheetsPage() {
  return (
    <AppShell>
      <SheetsImport />
    </AppShell>
  );
}

function SheetsImport() {
  const toast = useToast();
  const groupsQuery = useApi<{ groups: RecipientGroup[] }>('/api/recipients/groups/all');

  const [url, setUrl] = useState('');
  const [spreadsheet, setSpreadsheet] = useState<Spreadsheet | null>(null);
  const [worksheet, setWorksheet] = useState('');
  const [hasHeaderRow, setHasHeaderRow] = useState(true);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [emailColumn, setEmailColumn] = useState(0);
  const [nameColumn, setNameColumn] = useState(-1);
  const [companyColumn, setCompanyColumn] = useState(-1);
  const [groupId, setGroupId] = useState<number | null>(null);

  const [loadingSheet, setLoadingSheet] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const loadSpreadsheet = async () => {
    if (!url.trim()) return;
    setLoadingSheet(true);
    setError(null);
    setPreview(null);
    setResult(null);

    try {
      const data = await api.post<{ spreadsheet: Spreadsheet; preselectedWorksheet: string | null }>(
        '/api/sheets/load',
        { url: url.trim() },
      );
      setSpreadsheet(data.spreadsheet);
      const initial = data.preselectedWorksheet ?? data.spreadsheet.worksheets[0]?.title ?? '';
      setWorksheet(initial);
      if (initial) await loadPreview(data.spreadsheet.spreadsheetId, initial, hasHeaderRow);
    } catch (err) {
      setSpreadsheet(null);
      setError(err instanceof ApiError ? err.message : 'Could not load that spreadsheet');
    } finally {
      setLoadingSheet(false);
    }
  };

  const loadPreview = async (spreadsheetId: string, sheetTitle: string, header: boolean) => {
    setLoadingPreview(true);
    setError(null);
    try {
      const data = await api.post<PreviewData>('/api/sheets/preview', {
        spreadsheetId,
        worksheet: sheetTitle,
        hasHeaderRow: header,
      });
      setPreview(data);
      setEmailColumn(data.suggestedEmailColumn);
      setNameColumn(data.suggestedNameColumn);
      setCompanyColumn(data.header.findIndex((h) => /company|organisation|organization/i.test(h)));
    } catch (err) {
      setPreview(null);
      setError(err instanceof ApiError ? err.message : 'Could not read that worksheet');
    } finally {
      setLoadingPreview(false);
    }
  };

  const runImport = async () => {
    if (!spreadsheet || !worksheet) return;
    setImporting(true);
    setError(null);
    try {
      const data = await api.post<ImportResult>('/api/sheets/import', {
        spreadsheetId: spreadsheet.spreadsheetId,
        worksheet,
        emailColumn,
        nameColumn,
        companyColumn,
        hasHeaderRow,
        groupId,
      });
      setResult(data);
      toast.success(
        `Imported ${data.imported} new recipient${data.imported === 1 ? '' : 's'}`,
        `${data.totalRecipients} total in your list`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const validPreviewEmails = preview
    ? preview.rows.filter((row) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((row[emailColumn] ?? '').trim())).length
    : 0;

  return (
    <>
      <PageHeader
        title="Google Sheets"
        description="Import recipients straight from a spreadsheet using the same Google account you connected for Gmail."
      />

      <div className="space-y-6">
        <Card title="1. Load a spreadsheet" description="Paste the URL from your browser's address bar.">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1">
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void loadSpreadsheet();
                }}
                placeholder="https://docs.google.com/spreadsheets/d/1AbC…/edit#gid=0"
                aria-label="Google Sheets URL"
              />
            </div>
            <Button onClick={() => void loadSpreadsheet()} loading={loadingSheet} disabled={!url.trim()}>
              Load spreadsheet
            </Button>
            {spreadsheet && (
              <Button
                variant="secondary"
                onClick={() => void loadPreview(spreadsheet.spreadsheetId, worksheet, hasHeaderRow)}
                loading={loadingPreview}
                icon={<RefreshIcon className="h-4 w-4" />}
              >
                Refresh
              </Button>
            )}
          </div>

          {error && (
            <div className="mt-4">
              <Alert tone="danger" title="Could not read the spreadsheet" onDismiss={() => setError(null)}>
                {error}
              </Alert>
            </div>
          )}

          {!spreadsheet && !error && (
            <p className="hint mt-3">
              The connected Google account needs at least view access to the sheet. Private sheets belonging to someone
              else must be shared with that account first.
            </p>
          )}
        </Card>

        {spreadsheet && (
          <Card
            title="2. Choose the worksheet and columns"
            description={
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-700 dark:text-slate-300">{spreadsheet.title}</span>
                <a
                  href={spreadsheet.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-brand-600 underline dark:text-brand-400"
                >
                  Open in Google Sheets
                </a>
              </span>
            }
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Worksheet" htmlFor="worksheet">
                <Select
                  id="worksheet"
                  value={worksheet}
                  onChange={(event) => {
                    setWorksheet(event.target.value);
                    void loadPreview(spreadsheet.spreadsheetId, event.target.value, hasHeaderRow);
                  }}
                >
                  {spreadsheet.worksheets.map((sheet) => (
                    <option key={sheet.sheetId} value={sheet.title}>
                      {sheet.title} ({sheet.rowCount} rows)
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Email column" htmlFor="email-column" hint="Auto-detected — change if wrong.">
                <Select
                  id="email-column"
                  value={emailColumn}
                  onChange={(event) => setEmailColumn(Number(event.target.value))}
                  disabled={!preview}
                >
                  {preview?.header.map((name, index) => (
                    <option key={index} value={index}>
                      {name || `Column ${index + 1}`}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Name column" htmlFor="name-column" hint="Optional — enables {{name}}.">
                <Select
                  id="name-column"
                  value={nameColumn}
                  onChange={(event) => setNameColumn(Number(event.target.value))}
                  disabled={!preview}
                >
                  <option value={-1}>None</option>
                  {preview?.header.map((name, index) => (
                    <option key={index} value={index}>
                      {name || `Column ${index + 1}`}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Company column" htmlFor="company-column" hint="Optional — enables {{company}}.">
                <Select
                  id="company-column"
                  value={companyColumn}
                  onChange={(event) => setCompanyColumn(Number(event.target.value))}
                  disabled={!preview}
                >
                  <option value={-1}>None</option>
                  {preview?.header.map((name, index) => (
                    <option key={index} value={index}>
                      {name || `Column ${index + 1}`}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-6">
              <Checkbox
                label="First row contains column headers"
                checked={hasHeaderRow}
                onChange={(event) => {
                  setHasHeaderRow(event.target.checked);
                  void loadPreview(spreadsheet.spreadsheetId, worksheet, event.target.checked);
                }}
              />
              <div className="min-w-[12rem]">
                <Select
                  value={groupId ?? ''}
                  onChange={(event) => setGroupId(event.target.value ? Number(event.target.value) : null)}
                  aria-label="Assign to group"
                >
                  <option value="">No group</option>
                  {groupsQuery.data?.groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      Add to: {group.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </Card>
        )}

        {loadingPreview && (
          <Card>
            <div className="flex items-center justify-center gap-3 py-8 text-slate-500">
              <Spinner className="h-5 w-5" />
              <span className="text-sm">Reading worksheet…</span>
            </div>
          </Card>
        )}

        {preview && !loadingPreview && (
          <Card
            title="3. Preview and import"
            description={`${preview.totalRows.toLocaleString()} data rows · showing the first ${Math.min(preview.rows.length, 50)}`}
            actions={
              <>
                <Badge tone="success">{validPreviewEmails} valid in preview</Badge>
                <Button
                  onClick={() => void runImport()}
                  loading={importing}
                  icon={<UploadIcon className="h-4 w-4" />}
                  disabled={preview.totalRows === 0}
                >
                  Import recipients
                </Button>
              </>
            }
            bodyClassName="p-0"
          >
            {preview.rows.length === 0 ? (
              <EmptyState
                icon={<SheetIcon className="h-8 w-8" />}
                title="This worksheet is empty"
                description="Pick a different tab, or add rows to the sheet and press Refresh."
              />
            ) : (
              <div className="scroll-thin overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left dark:bg-slate-950">
                    <tr>
                      <th className="w-12 px-4 py-2.5 text-xs font-medium text-slate-400">#</th>
                      {preview.header.map((name, index) => (
                        <th
                          key={index}
                          className={`px-4 py-2.5 text-xs font-medium whitespace-nowrap ${
                            index === emailColumn
                              ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                              : index === nameColumn || index === companyColumn
                                ? 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300'
                                : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {name || `Column ${index + 1}`}
                          {index === emailColumn && <span className="ml-1.5 font-normal">(email)</span>}
                          {index === nameColumn && <span className="ml-1.5 font-normal">(name)</span>}
                          {index === companyColumn && <span className="ml-1.5 font-normal">(company)</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {preview.rows.slice(0, 50).map((row, rowIndex) => {
                      const email = (row[emailColumn] ?? '').trim();
                      const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
                      return (
                        <tr key={rowIndex} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="px-4 py-2 text-xs text-slate-400">{rowIndex + 1}</td>
                          {preview.header.map((_, colIndex) => (
                            <td
                              key={colIndex}
                              className={`max-w-xs truncate px-4 py-2 ${
                                colIndex === emailColumn
                                  ? valid
                                    ? 'font-medium text-slate-900 dark:text-slate-100'
                                    : 'text-red-600 line-through dark:text-red-400'
                                  : 'text-slate-600 dark:text-slate-400'
                              }`}
                              title={row[colIndex] ?? ''}
                            >
                              {row[colIndex] || <span className="text-slate-300 dark:text-slate-700">—</span>}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {result && (
          <Card title="Import complete">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="New recipients" value={result.imported} tone="text-emerald-600 dark:text-emerald-400" />
              <Stat label="Already present" value={result.alreadyPresent + result.updated} />
              <Stat label="Duplicates in sheet" value={result.duplicatesInSheet} />
              <Stat label="Invalid addresses" value={result.invalid} tone={result.invalid ? 'text-red-600 dark:text-red-400' : undefined} />
            </div>

            {result.invalidSamples.length > 0 && (
              <div className="mt-4">
                <Alert tone="warning" title="Some rows were skipped">
                  <p>These values were not valid email addresses:</p>
                  <ul className="mt-1.5 space-y-0.5 font-mono text-xs">
                    {result.invalidSamples.map((sample, index) => (
                      <li key={index} className="truncate">
                        {sample}
                      </li>
                    ))}
                  </ul>
                </Alert>
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/recipients">
                <Button variant="secondary">View all {result.totalRecipients.toLocaleString()} recipients</Button>
              </Link>
              <Link href="/compose">
                <Button>Compose an email</Button>
              </Link>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${tone ?? 'text-slate-900 dark:text-slate-100'}`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}
