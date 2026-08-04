'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL, ApiError, api } from './api';
import type { ProgressSnapshot } from './types';

/**
 * Subscribes to the backend's Server-Sent Events feed.
 *
 * EventSource handles reconnection itself, so this hook only tracks connection
 * state and fans events out to the caller.
 */
export function useEventStream(options: {
  enabled?: boolean;
  onProgress?: (progress: ProgressSnapshot) => void;
  onLog?: (log: unknown) => void;
  onAccount?: (account: unknown) => void;
}) {
  const { enabled = true } = options;
  const [connected, setConnected] = useState(false);

  // Keep the latest callbacks in a ref so re-renders never tear down the stream.
  const handlers = useRef(options);
  handlers.current = options;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const source = new EventSource(`${API_URL}/api/stream`, { withCredentials: true });

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    const listen = (event: string, handler: (data: unknown) => void) => {
      source.addEventListener(event, (message) => {
        try {
          handler(JSON.parse((message as MessageEvent).data));
        } catch {
          /* ignore malformed frame */
        }
      });
    };

    listen('progress', (data) => handlers.current.onProgress?.(data as ProgressSnapshot));
    listen('log', (data) => handlers.current.onLog?.(data));
    listen('account', (data) => handlers.current.onAccount?.(data));

    return () => {
      source.close();
      setConnected(false);
    };
  }, [enabled]);

  return { connected };
}

/** Loads data on mount with loading/error state and a manual `reload()`. */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<T>(path));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, reload: load, setData };
}

/** Debounces a rapidly-changing value — used for search boxes and live parsing. */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

/** Tracks a boolean in localStorage, safe against SSR and disabled storage. */
export function usePersistentState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [state, setState] = useState<T>(initial);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) setState(JSON.parse(stored) as T);
    } catch {
      /* storage unavailable */
    }
  }, [key]);

  const update = useCallback(
    (value: T) => {
      setState(value);
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* storage unavailable */
      }
    },
    [key],
  );

  return [state, update];
}
