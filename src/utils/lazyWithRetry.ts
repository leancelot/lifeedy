import React, { ComponentType, lazy } from 'react';

const RELOAD_STORAGE_PREFIX = 'vidaorganizada_chunk_reload_';
const RELOAD_COOLDOWN_MS = 15000;

export function isDynamicImportError(errorOrMessage: unknown): boolean {
  const msg =
    typeof errorOrMessage === 'string'
      ? errorOrMessage
      : errorOrMessage instanceof Error
        ? `${errorOrMessage.name} ${errorOrMessage.message}`
        : String(errorOrMessage || '');

  const normalized = msg.toLowerCase();
  return (
    normalized.includes('failed to fetch dynamically imported module') ||
    normalized.includes('importing a module script failed') ||
    normalized.includes('error loading dynamically imported module') ||
    normalized.includes('loading chunk') ||
    normalized.includes('chunkloaderror')
  );
}

/**
 * React.lazy wrapper with automatic transient retry + single safe page reload
 * when a module URL becomes stale after a server restart or new build deploy.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
  chunkKey: string
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await importer();
    } catch (firstError) {
      if (!isDynamicImportError(firstError)) {
        throw firstError;
      }

      // Brief retry for transient network hiccups or dev server warm-up
      await new Promise((resolve) => setTimeout(resolve, 350));

      try {
        return await importer();
      } catch (secondError) {
        if (typeof window !== 'undefined' && isDynamicImportError(secondError)) {
          try {
            const storageKey = `${RELOAD_STORAGE_PREFIX}${chunkKey}`;
            const lastReloadRaw = window.sessionStorage.getItem(storageKey);
            const lastReloadAt = lastReloadRaw ? Number(lastReloadRaw) : 0;
            const now = Date.now();

            if (!lastReloadAt || Number.isNaN(lastReloadAt) || now - lastReloadAt > RELOAD_COOLDOWN_MS) {
              window.sessionStorage.setItem(storageKey, String(now));
              window.location.reload();
              return await new Promise<{ default: T }>(() => {});
            }
          } catch {
            // sessionStorage unavailable (e.g., restricted iframe); fall through to ErrorBoundary
          }
        }

        throw secondError;
      }
    }
  });
}
