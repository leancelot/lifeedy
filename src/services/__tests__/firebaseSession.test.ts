import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearPersistedUserProfile,
  getTokenExpiresAt,
  isAccessTokenExpiredOrNearExpiry,
  loadPersistedUserProfile,
  persistUserProfile,
  setSessionToken,
} from '../firebase';

function createMemoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

describe('firebase session persistence & token lifecycle', () => {
  afterEach(() => {
    clearPersistedUserProfile();
    setSessionToken(null);
    vi.restoreAllMocks();
    delete (globalThis as any).localStorage;
  });

  it('persiste apenas dados não sensíveis do perfil (nunca tokens de acesso)', () => {
    const memStorage = createMemoryStorage();
    (globalThis as any).localStorage = memStorage;

    persistUserProfile(
      {
        uid: 'user-123',
        displayName: 'Leandro',
        email: 'leandro@exemplo.com',
        photoURL: null,
      },
      'native_oauth'
    );

    const loaded = loadPersistedUserProfile();
    expect(loaded).toEqual({
      uid: 'user-123',
      displayName: 'Leandro',
      email: 'leandro@exemplo.com',
      photoURL: null,
      source: 'native_oauth',
    });

    const serialized = memStorage.getItem('lifeedy_google_profile_v1') || '';
    expect(serialized).not.toContain('accessToken');
    expect(serialized).not.toContain('access_token');
  });

  it('controla janela de expiração do token temporário em memória', () => {
    setSessionToken(null);
    expect(isAccessTokenExpiredOrNearExpiry()).toBe(true);
    expect(getTokenExpiresAt()).toBe(0);

    setSessionToken('valid-token-abc', 3600);
    expect(isAccessTokenExpiredOrNearExpiry(120_000)).toBe(false);
    expect(getTokenExpiresAt()).toBeGreaterThan(Date.now());

    // Simulate token within 2-minute renewal buffer
    setSessionToken('expiring-soon-token', 90);
    expect(isAccessTokenExpiredOrNearExpiry(120_000)).toBe(true);
  });
});
