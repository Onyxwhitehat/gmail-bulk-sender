'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, api } from '@/lib/api';
import type { AuthState, SessionUser } from '@/lib/types';
import { AlertIcon, Button, CheckIcon, Spinner, XIcon, cn } from './ui';

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  resolved: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const THEME_STORAGE_KEY = 'bes-theme';

function applyTheme(theme: Theme): 'light' | 'dark' {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}

function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const stored = (window.localStorage.getItem(THEME_STORAGE_KEY) as Theme | null) ?? 'system';
    setThemeState(stored);
    setResolved(applyTheme(stored));
  }, []);

  // Follow the OS while the preference is "system".
  useEffect(() => {
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolved(applyTheme('system'));
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    setResolved(applyTheme(next));
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolved,
      setTheme,
      toggle: () => setTheme(resolved === 'dark' ? 'light' : 'dark'),
    }),
    [theme, resolved, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <Providers>');
  return context;
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

type ToastTone = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
}

interface ToastContextValue {
  toast: (tone: ToastTone, title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  /** Runs a promise, showing an error toast if it rejects. Returns null on failure. */
  run: <T>(promise: Promise<T>, messages?: { success?: string; error?: string }) => Promise<T | null>;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextToastId = 1;

function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (tone: ToastTone, title: string, message?: string) => {
      const id = nextToastId++;
      setToasts((current) => [...current.slice(-4), { id, tone, title, message }]);
      // Errors stay longer — they usually contain something to read.
      setTimeout(() => dismiss(id), tone === 'error' ? 9000 : 5000);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, message) => toast('success', title, message),
      error: (title, message) => toast('error', title, message),
      info: (title, message) => toast('info', title, message),
      run: async <T,>(promise: Promise<T>, messages?: { success?: string; error?: string }) => {
        try {
          const result = await promise;
          if (messages?.success) toast('success', messages.success);
          return result;
        } catch (err) {
          const detail = err instanceof ApiError ? err.message : 'Unexpected error';
          toast('error', messages?.error ?? 'Something went wrong', detail);
          return null;
        }
      },
    }),
    [toast],
  );

  const tones: Record<ToastTone, { ring: string; icon: ReactNode }> = {
    success: { ring: 'border-emerald-500', icon: <CheckIcon className="h-5 w-5 text-emerald-500" /> },
    error: { ring: 'border-red-500', icon: <AlertIcon className="h-5 w-5 text-red-500" /> },
    warning: { ring: 'border-amber-500', icon: <AlertIcon className="h-5 w-5 text-amber-500" /> },
    info: { ring: 'border-sky-500', icon: <AlertIcon className="h-5 w-5 text-sky-500" /> },
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed top-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            className={cn(
              'animate-slide-in pointer-events-auto flex gap-3 rounded-lg border-l-4 bg-white p-3.5 shadow-lg ring-1 ring-slate-900/5',
              'dark:bg-slate-900 dark:ring-white/10',
              tones[item.tone].ring,
            )}
          >
            <span className="shrink-0">{tones[item.tone].icon}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{item.title}</p>
              {item.message && (
                <p className="mt-0.5 text-xs break-words text-slate-600 dark:text-slate-400">{item.message}</p>
              )}
            </div>
            <button
              onClick={() => dismiss(item.id)}
              className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label="Dismiss notification"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <Providers>');
  return context;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

interface SessionContextValue {
  user: SessionUser | null;
  needsSetup: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      // /auth/state also issues the CSRF cookie, so it must run before any write.
      const state = await api.get<AuthState & { csrfToken: string }>('/api/auth/state');
      setUser(state.user);
      setNeedsSetup(state.needsSetup);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setUser(null);
      router.push('/login');
    }
  }, [router]);

  const value = useMemo(
    () => ({ user, needsSetup, loading, refresh, logout }),
    [user, needsSetup, loading, refresh, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <Providers>');
  return context;
}

// ---------------------------------------------------------------------------
// Confirmation dialogs
// ---------------------------------------------------------------------------

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  /** When set, the user must type this exact text before confirming. */
  requireTyping?: string;
}

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ options: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null);
  const [typed, setTyped] = useState('');

  const confirm = useCallback((options: ConfirmOptions) => {
    setTyped('');
    return new Promise<boolean>((resolve) => setState({ options, resolve }));
  }, []);

  const close = (result: boolean) => {
    state?.resolve(result);
    setState(null);
  };

  // Escape should always be an escape hatch.
  useEffect(() => {
    if (!state) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const canConfirm = !state?.options.requireTyping || typed.trim() === state.options.requireTyping;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          onClick={(event) => {
            if (event.target === event.currentTarget) close(false);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{state.options.title}</h2>
            <div className="mt-2 text-sm text-slate-600 dark:text-slate-400">{state.options.message}</div>

            {state.options.requireTyping && (
              <div className="mt-4">
                <label className="label-base">
                  Type <span className="font-mono font-semibold">{state.options.requireTyping}</span> to confirm
                </label>
                <input
                  autoFocus
                  className="input-base"
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && canConfirm) close(true);
                  }}
                />
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => close(false)}>
                {state.options.cancelLabel ?? 'Cancel'}
              </Button>
              <Button
                variant={state.options.tone === 'danger' ? 'danger' : 'primary'}
                onClick={() => close(true)}
                disabled={!canConfirm}
                autoFocus={!state.options.requireTyping}
              >
                {state.options.confirmLabel ?? 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error('useConfirm must be used inside <Providers>');
  return context;
}

// ---------------------------------------------------------------------------

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <SessionProvider>{children}</SessionProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

export function FullPageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-slate-500 dark:text-slate-400">
        <Spinner className="h-8 w-8" />
        <p className="text-sm">{label}…</p>
      </div>
    </div>
  );
}
