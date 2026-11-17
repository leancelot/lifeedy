import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findDriveBackupFile,
  LEGACY_BACKUP_FILE_NAME,
  PRIMARY_BACKUP_FILE_NAME,
  saveToDrive,
  selectPreferredBackupFile,
} from '../driveService';
import { AppDataPayload } from '../../types';

describe('driveService dual backup compatibility', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('seleciona arquivo legado quando ainda não existe Lifeedy_Data.json', () => {
    const picked = selectPreferredBackupFile([
      {
        id: 'legacy-1',
        name: LEGACY_BACKUP_FILE_NAME,
        modifiedTime: '2026-11-10T10:00:00Z',
      },
    ]);

    expect(picked?.id).toBe('legacy-1');
    expect(picked?.name).toBe(LEGACY_BACKUP_FILE_NAME);
  });

  it('prefere Lifeedy_Data.json quando ambos existem e o novo não é mais antigo', () => {
    const picked = selectPreferredBackupFile([
      {
        id: 'legacy-1',
        name: LEGACY_BACKUP_FILE_NAME,
        modifiedTime: '2026-11-10T10:00:00Z',
      },
      {
        id: 'primary-1',
        name: PRIMARY_BACKUP_FILE_NAME,
        modifiedTime: '2026-11-15T12:00:00Z',
      },
    ]);

    expect(picked?.id).toBe('primary-1');
    expect(picked?.name).toBe(PRIMARY_BACKUP_FILE_NAME);
  });

  it('busca simultaneamente Lifeedy_Data.json e VidaOrganizada_Data.json na API do Drive', async () => {
    let requestedUrl = '';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          files: [
            {
              id: 'legacy-id',
              name: LEGACY_BACKUP_FILE_NAME,
              modifiedTime: '2026-11-12T08:00:00Z',
            },
          ],
        }),
      } as Response;
    }) as typeof fetch;

    const found = await findDriveBackupFile('token-123');
    expect(decodeURIComponent(requestedUrl)).toContain(PRIMARY_BACKUP_FILE_NAME);
    expect(decodeURIComponent(requestedUrl)).toContain(LEGACY_BACKUP_FILE_NAME);
    expect(found?.id).toBe('legacy-id');
  });

  it('migra arquivo existente para Lifeedy_Data.json preservando o fileId ao salvar', async () => {
    let patchBody = '';
    let patchMethod = '';
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      patchMethod = init?.method || 'GET';
      patchBody = String(init?.body || '');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'legacy-id',
          name: PRIMARY_BACKUP_FILE_NAME,
        }),
      } as Response;
    }) as typeof fetch;

    const payload: AppDataPayload = {
      version: 2,
      lastUpdated: '2026-11-16T10:00:00Z',
      userName: 'Leandro',
      onboardingCompleted: true,
      tasks: [],
      transactions: [],
      financialGoals: [],
      budgetLimits: [],
      draftNotes: [],
    };

    const result = await saveToDrive('token-123', payload, 'legacy-id');
    expect(patchMethod).toBe('PATCH');
    expect(patchBody).toContain(`"name":"${PRIMARY_BACKUP_FILE_NAME}"`);
    expect(result.id).toBe('legacy-id');
    expect(result.name).toBe(PRIMARY_BACKUP_FILE_NAME);
  });
});
