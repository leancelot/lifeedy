import { afterEach, describe, expect, it, vi } from 'vitest';
import { completeNativeGoogleAuth, mapGoogleAuthError } from '../firebase';
import {
  authorizeNativeGoogle,
  checkNativeGoogleAuthAvailability,
  clearNativeGoogleToken,
  isNativeGoogleAuthSupported,
} from '../nativeGoogleAuthBridge';

describe('nativeGoogleAuthBridge & native error mapping', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).localStorage;
  });

  it('retorna fallback seguro fora da plataforma Android nativa', async () => {
    expect(isNativeGoogleAuthSupported()).toBe(false);

    const avail = await checkNativeGoogleAuthAvailability();
    expect(avail).toEqual({ available: false, statusCode: -1 });

    const authRes = await authorizeNativeGoogle({
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    expect(authRes).toEqual({ authorized: false });

    const cleared = await clearNativeGoogleToken('tok-123');
    expect(cleared).toBe(false);
  });

  it('traduz erros nativos do Google Play Services para mensagens acionáveis em PT-BR com SHA-1', () => {
    const err10 = mapGoogleAuthError({
      code: '10',
      message: '10: DEVELOPER_ERROR [SHA-1: AA:BB:CC:DD]',
    });
    expect(err10).toContain('SHA-1');
    expect(err10).toContain('com.vidaorganizada.app');
    expect(err10).toContain('AA:BB:CC:DD');

    const err12500 = mapGoogleAuthError({
      code: '12500',
      message: '12500: SIGN_IN_FAILED [SHA-1: 11:22:33:44]',
    });
    expect(err12500).toContain('Tela de consentimento');
    expect(err12500).toContain('11:22:33:44');

    expect(mapGoogleAuthError({ code: 'PLAY_SERVICES_UNAVAILABLE' })).toContain('Play Services');
    expect(mapGoogleAuthError({ code: '7' })).toContain('conexão');
    expect(
      mapGoogleAuthError(
        new Error('Não foi possível carregar seu perfil Google (HTTP 403).')
      )
    ).toBe('Não foi possível carregar seu perfil Google (HTTP 403).');
  });

  it('tenta v2/userinfo como fallback e propaga erro HTTP descritivo se ambos falharem', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'u-42',
          name: 'Maria',
          email: 'maria@exemplo.com',
          verified_email: true,
        }),
      } as Response);

    const user = await completeNativeGoogleAuth('tok-v2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(user?.displayName).toBe('Maria');
    expect(user?.email).toBe('maria@exemplo.com');

    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 401 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 403 } as Response);

    await expect(completeNativeGoogleAuth('tok-bad')).rejects.toThrow(
      'Não foi possível carregar seu perfil Google (HTTP 403).'
    );
  });
});
