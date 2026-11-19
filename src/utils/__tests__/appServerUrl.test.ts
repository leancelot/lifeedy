import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_SERVER_URL_STORAGE_KEY,
  clearCustomAppServerUrl,
  getConfiguredAppServerUrl,
  getCustomAppServerUrl,
  saveCustomAppServerUrl,
  validateAppServerUrl,
} from '../appServerUrl';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

describe('appServerUrl', () => {
  let memoryStorage: Storage;

  beforeEach(() => {
    memoryStorage = createMemoryStorage();
    vi.stubGlobal('localStorage', memoryStorage);
  });

  afterEach(() => {
    clearCustomAppServerUrl();
    vi.unstubAllGlobals();
  });

  it('validates and normalizes valid HTTPS URLs and bare hostnames', () => {
    expect(validateAppServerUrl('https://ais-pre-abc.us-east1.run.app/foo?bar=1')).toEqual({
      ok: true,
      url: 'https://ais-pre-abc.us-east1.run.app',
    });
    expect(validateAppServerUrl('ais-pre-abc.us-east1.run.app/')).toEqual({
      ok: true,
      url: 'https://ais-pre-abc.us-east1.run.app',
    });
    expect(validateAppServerUrl('http://localhost:3000/')).toEqual({
      ok: true,
      url: 'http://localhost:3000',
    });
  });

  it('rejects insecure remote HTTP, empty strings, and dangerous schemes', () => {
    expect(validateAppServerUrl('').ok).toBe(false);
    expect(validateAppServerUrl('http://example.com').ok).toBe(false);
    expect(validateAppServerUrl('javascript:alert(1)').ok).toBe(false);
    expect(validateAppServerUrl('data:text/html,hi').ok).toBe(false);
  });

  it('saves, reads, and clears custom server URL in localStorage', () => {
    expect(getCustomAppServerUrl()).toBe('');
    const saved = saveCustomAppServerUrl('https://meu-app.run.app/caminho');
    expect(saved).toEqual({ ok: true, url: 'https://meu-app.run.app' });
    expect(memoryStorage.getItem(APP_SERVER_URL_STORAGE_KEY)).toBe('https://meu-app.run.app');
    expect(getConfiguredAppServerUrl()).toBe('https://meu-app.run.app');
    clearCustomAppServerUrl();
    expect(getCustomAppServerUrl()).toBe('');
  });
});
