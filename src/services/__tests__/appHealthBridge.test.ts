import { describe, expect, it } from 'vitest';
import {
  describeMediaPermissionError,
  getWebMediaPermissionsStatus,
} from '../appHealthBridge';

describe('appHealthBridge media permissions helpers', () => {
  it('translates NotFoundError, NotReadableError, SecurityError, and denied permissions cleanly', () => {
    expect(describeMediaPermissionError({ name: 'NotFoundError' }, 'microphone')).toContain(
      'Nenhum(a) microfone encontrado(a)'
    );
    expect(describeMediaPermissionError({ name: 'NotReadableError' }, 'camera')).toContain(
      'ocupado por outro aplicativo'
    );
    expect(describeMediaPermissionError({ name: 'SecurityError' }, 'microphone')).toContain(
      'política de segurança'
    );
    expect(describeMediaPermissionError({ name: 'NotAllowedError' }, 'microphone')).toContain(
      'Permita o acesso ao microfone'
    );
    expect(describeMediaPermissionError({ name: 'NotAllowedError' }, 'camera')).toContain(
      'Permita o acesso à câmera'
    );
  });

  it('returns unsupported gracefully in non-browser environments', async () => {
    const status = await getWebMediaPermissionsStatus();
    expect(status).toEqual({
      microphone: 'unsupported',
      camera: 'unsupported',
    });
  });
});
