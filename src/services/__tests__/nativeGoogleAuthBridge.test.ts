import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapGoogleAuthError } from '../firebase';
import {
  authorizeNativeGoogle,
  checkNativeGoogleAuthAvailability,
  clearNativeGoogleToken,
  isNativeGoogleAuthSupported,
} from '../nativeGoogleAuthBridge';

describe('nativeGoogleAuthBridge & native error mapping', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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

  it('traduz erros nativos do Google Play Services para mensagens acionáveis em PT-BR', () => {
    expect(mapGoogleAuthError({ code: '10', message: '10: DEVELOPER_ERROR' })).toContain('SHA-1');
    expect(mapGoogleAuthError({ code: '10', message: '10: DEVELOPER_ERROR' })).toContain(
      'com.vidaorganizada.app'
    );
    expect(mapGoogleAuthError({ code: 'PLAY_SERVICES_UNAVAILABLE' })).toContain('Play Services');
    expect(mapGoogleAuthError({ code: '12500' })).toContain('Tela de consentimento');
    expect(mapGoogleAuthError({ code: '7' })).toContain('conexão');
  });
});
