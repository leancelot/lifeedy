import { describe, expect, it, vi } from 'vitest';
import { isDynamicImportError, lazyWithRetry } from '../lazyWithRetry';

describe('lazyWithRetry', () => {
  it('detects dynamic import and chunk load errors across browsers', () => {
    expect(
      isDynamicImportError(
        new TypeError('Failed to fetch dynamically imported module: https://example.com/Account.tsx')
      )
    ).toBe(true);
    expect(isDynamicImportError('Importing a module script failed.')).toBe(true);
    expect(isDynamicImportError('ChunkLoadError: Loading chunk 12 failed')).toBe(true);
    expect(isDynamicImportError('Regular component render error')).toBe(false);
  });

  it('retries once when a dynamic import fails transiently and succeeds on retry', async () => {
    const Dummy = () => null;
    const importer = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce({ default: Dummy });

    const LazyComp = lazyWithRetry(importer, 'test-retry') as unknown as {
      _payload?: { _result?: () => Promise<{ default: typeof Dummy }> };
      _init?: (payload: any) => any;
    };

    expect(LazyComp).toBeTruthy();
    if (LazyComp._payload?._result) {
      const mod = await LazyComp._payload._result();
      expect(mod.default).toBe(Dummy);
      expect(importer).toHaveBeenCalledTimes(2);
    }
  });
});
