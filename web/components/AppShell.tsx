'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useEventStream } from '@/lib/hooks';
import type { ProgressSnapshot } from '@/lib/types';
import { FullPageSpinner, useSession, useTheme } from './providers';
import {
  Badge,
  DashboardIcon,
  ListIcon,
  LogoutIcon,
  MailIcon,
  MenuIcon,
  MoonIcon,
  PencilIcon,
  SettingsIcon,
  SunIcon,
  UsersIcon,
  XIcon,
  cn,
} from './ui';

const NAV = [
  { href: '/', label: 'Dashboard', icon: DashboardIcon },
  { href: '/gmail', label: 'Gmail Connection', icon: MailIcon },
  { href: '/recipients', label: 'Recipients', icon: UsersIcon },
  { href: '/compose', label: 'Compose', icon: PencilIcon },
  { href: '/logs', label: 'Sending Logs', icon: ListIcon },
  { href: '/settings', label: 'Settings', icon: SettingsIcon },
] as const;

/**
 * Authenticated application frame: sidebar, header, and the live-progress badge.
 * Unauthenticated visitors are redirected to /login before any page renders.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useSession();
  const { resolved, toggle } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [progress, setProgress] = useState<ProgressSnapshot | null>(null);

  const { connected } = useEventStream({
    enabled: Boolean(user),
    onProgress: setProgress,
  });

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  // Close the mobile drawer whenever navigation happens.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  if (loading) return <FullPageSpinner label="Starting up" />;
  if (!user) return <FullPageSpinner label="Redirecting to sign in" />;

  const sending = progress?.state === 'running' || progress?.state === 'paused';

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
          <MailIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">Bulk Email Sender</p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">Gmail API · OAuth 2.0</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 pb-4" aria-label="Main">
        {NAV.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
              )}
            >
              <Icon className={cn('h-5 w-5 shrink-0', active && 'text-brand-600 dark:text-brand-400')} />
              <span className="truncate">{item.label}</span>
              {item.href === '/compose' && sending && (
                <span className="ml-auto flex h-2 w-2 shrink-0 rounded-full bg-emerald-500 ring-2 ring-emerald-500/30" />
              )}
            </Link>
          );
        })}
      </nav>

      {sending && progress && (
        <Link
          href="/compose"
          className="mx-3 mb-3 rounded-lg border border-brand-200 bg-brand-50 p-3 dark:border-brand-800 dark:bg-brand-500/10"
        >
          <div className="flex items-center justify-between text-xs font-medium text-brand-800 dark:text-brand-300">
            <span>{progress.state === 'paused' ? 'Paused' : 'Sending'}</span>
            <span className="tabular-nums">
              {progress.sent}/{progress.total}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-200 dark:bg-brand-900">
            <div
              className="h-full bg-brand-600 transition-all duration-300 dark:bg-brand-400"
              style={{ width: `${progress.total ? (progress.sent / progress.total) * 100 : 0}%` }}
            />
          </div>
        </Link>
      )}

      <div className="border-t border-slate-200 p-3 dark:border-slate-800">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {user.email.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-300">{user.name ?? 'Signed in'}</p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-500">{user.email}</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white lg:block dark:border-slate-800 dark:bg-slate-900">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl dark:bg-slate-900">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-3 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Close navigation"
            >
              <XIcon className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/85 px-4 backdrop-blur sm:px-6 dark:border-slate-800 dark:bg-slate-900/85">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden dark:hover:bg-slate-800"
            aria-label="Open navigation"
          >
            <MenuIcon className="h-5 w-5" />
          </button>

          <h1 className="flex-1 truncate text-sm font-semibold text-slate-900 sm:text-base dark:text-slate-100">
            {NAV.find((item) => (item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)))?.label ??
              'Dashboard'}
          </h1>

          <Badge tone={connected ? 'success' : 'neutral'} className="hidden sm:inline-flex">
            <span
              className={cn('h-1.5 w-1.5 rounded-full', connected ? 'animate-pulse bg-emerald-500' : 'bg-slate-400')}
            />
            {connected ? 'Live' : 'Offline'}
          </Badge>

          <button
            onClick={toggle}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} mode`}
          >
            {resolved === 'dark' ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
          </button>

          <LogoutButton />
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function LogoutButton() {
  const { logout } = useSession();
  return (
    <button
      onClick={() => void logout()}
      className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      aria-label="Sign out"
      title="Sign out"
    >
      <LogoutIcon className="h-5 w-5" />
    </button>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">{title}</h2>
        {description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
