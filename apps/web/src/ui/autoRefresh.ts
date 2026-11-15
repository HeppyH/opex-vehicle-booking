/*───────────────────── Auto Refresh Hooks ─────────────────────*/
/* Visibility-aware polling mechanism for OPEX Asset Booking.
   Provides useAutoRefresh with pause/resume on tab visibility change,
   overlap prevention, and manual refresh support. */

import { useEffect, useRef, useState, useCallback } from "react";

/*───────────────────── useAutoRefresh ─────────────────────*/

export interface UseAutoRefreshOptions {
  intervalMs: number;
  enabled: boolean;
  onRefresh: () => void | Promise<void>;
  onError?: (error: Error) => void;
}

export function useAutoRefresh({
  intervalMs,
  enabled,
  onRefresh,
  onError,
}: UseAutoRefreshOptions) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef(false);
  const cbRef = useRef(onRefresh);
  const errorRef = useRef(onError);

  // Keep callbacks fresh
  cbRef.current = onRefresh;
  errorRef.current = onError;

  const scheduleNext = useCallback(() => {
    if (!enabled || !timerRef.current) return;
    timerRef.current = setTimeout(() => {
      triggerRefresh();
    }, intervalMs);
  }, [enabled, intervalMs]);

  const triggerRefresh = useCallback(async () => {
    if (refreshRef.current) return; // Prevent overlapping
    refreshRef.current = true;
    setIsRefreshing(true);
    try {
      await cbRef.current();
      setLastUpdated(new Date());
    } catch (e) {
      errorRef.current?.(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsRefreshing(false);
      refreshRef.current = false;
      if (enabled) {
        scheduleNext();
      }
    }
  }, [enabled, scheduleNext]);

  const manualRefresh = useCallback(async () => {
    await triggerRefresh();
  }, [triggerRefresh]);

  // Start/stop timer on enabled changes
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (enabled) {
      timerRef.current = setTimeout(() => {
        triggerRefresh();
      }, intervalMs);
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, intervalMs, triggerRefresh]);

  // Pause on tab hide, resume on tab show
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      } else if (enabled) {
        timerRef.current = setTimeout(() => {
          triggerRefresh();
        }, intervalMs);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [enabled, intervalMs, triggerRefresh]);

  return {
    isRefreshing,
    lastUpdated,
    manualRefresh,
    triggerRefresh,
  };
}

/*───────────────────── Module-level refresh service (for cross-component coordination) ─────────────────────*/

let globalRefreshCount = 0;
const globalRefreshListeners = new Set<() => void | Promise<void>>();

export function registerRefreshListener(fn: () => void | Promise<void>): () => void {
  globalRefreshListeners.add(fn);
  globalRefreshCount++;
  return () => {
    globalRefreshListeners.delete(fn);
    globalRefreshCount--;
  };
}

export function triggerGlobalRefresh(): void {
  for (const fn of globalRefreshListeners) {
    try {
      fn();
    } catch {
      // Individual listener failures don't break others
    }
  }
}

export function getRefreshCount(): number {
  return globalRefreshCount;
}