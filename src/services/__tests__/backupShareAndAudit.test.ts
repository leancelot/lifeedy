import { beforeEach, describe, expect, it } from 'vitest';
import {
  classifyIncomingFile,
  clearBackupAuditStorage,
  evaluatePortableBackupHealth,
  getBackupReminderSnoozedUntil,
  getLastPortableBackupAt,
  isAutoFolderBackupEnabled,
  recordPortableBackupTimestamp,
  setAutoFolderBackupEnabled,
  snoozeBackupReminder,
} from '../backupShareAndAudit';
import { ENCRYPTED_BACKUP_FORMAT } from '../encryptedBackupService';

describe('backupShareAndAudit', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, String(v));
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
        clear: () => {
          store.clear();
        },
      },
    });
  });

  it('classifica arquivos recebidos entre .ics, backup cifrado/JSON e inválidos', () => {
    expect(
      classifyIncomingFile({
        name: 'reuniao.ics',
        content: 'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:Teste\nEND:VEVENT\nEND:VCALENDAR',
      })
    ).toBe('ics');

    expect(
      classifyIncomingFile({
        name: 'compartilhado_sem_extensao',
        content: JSON.stringify({
          format: ENCRYPTED_BACKUP_FORMAT,
          version: 1,
          salt: 'abc',
          iv: 'def',
          ciphertext: 'ghi',
          iterations: 210000,
        }),
      })
    ).toBe('backup');

    expect(
      classifyIncomingFile({
        name: 'Lifeedy_Backup_2026-11-22.json',
        content: JSON.stringify({ version: 4, tasks: [], transactions: [] }),
      })
    ).toBe('backup');

    expect(
      classifyIncomingFile({
        name: 'foto.png',
        content: 'not-a-valid-backup',
      })
    ).toBe('invalid');

    expect(
      classifyIncomingFile({
        kind: 'image',
        name: 'nota.jpg',
        mimeType: 'image/jpeg',
        content: 'data:image/jpeg;base64,/9j/4AAQ',
      })
    ).toBe('image');

    expect(
      classifyIncomingFile({
        kind: 'text',
        name: 'Texto compartilhado',
        mimeType: 'text/plain',
        content: 'Pix enviado de R$ 42,00 para Padaria Central',
      })
    ).toBe('text');
  });

  it('avalia saúde de backup portátil, lembrete após 14 dias e soneca de 7 dias', () => {
    const now = Date.parse('2026-11-22T12:00:00.000Z');

    const missing = evaluatePortableBackupHealth({
      lastPortableBackupAt: null,
      autoFolderConfigured: false,
      autoFolderAccessible: false,
      hasAutoPassphrase: false,
      autoBackupEnabled: true,
      itemCount: 5,
      snoozedUntil: null,
      nowMs: now,
    });
    expect(missing.level).toBe('missing');
    expect(missing.shouldRemind).toBe(true);

    const recent = evaluatePortableBackupHealth({
      lastPortableBackupAt: '2026-11-20T12:00:00.000Z',
      autoFolderConfigured: true,
      autoFolderAccessible: true,
      hasAutoPassphrase: true,
      autoBackupEnabled: true,
      itemCount: 10,
      snoozedUntil: null,
      nowMs: now,
    });
    expect(recent.level).toBe('healthy');
    expect(recent.daysSinceLastBackup).toBe(2);
    expect(recent.shouldRemind).toBe(false);
    expect(recent.autoFolderReady).toBe(true);

    const stale = evaluatePortableBackupHealth({
      lastPortableBackupAt: '2026-11-01T12:00:00.000Z',
      autoFolderConfigured: false,
      autoFolderAccessible: false,
      hasAutoPassphrase: false,
      autoBackupEnabled: false,
      itemCount: 4,
      snoozedUntil: null,
      nowMs: now,
    });
    expect(stale.level).toBe('warning');
    expect(stale.daysSinceLastBackup).toBe(21);
    expect(stale.shouldRemind).toBe(true);

    const snoozed = snoozeBackupReminder(7, now);
    const suppressed = evaluatePortableBackupHealth({
      lastPortableBackupAt: '2026-11-01T12:00:00.000Z',
      autoFolderConfigured: false,
      autoFolderAccessible: false,
      hasAutoPassphrase: false,
      autoBackupEnabled: false,
      itemCount: 4,
      snoozedUntil: snoozed,
      nowMs: now,
    });
    expect(suppressed.shouldRemind).toBe(false);
  });

  it('persiste timestamps, toggle de auto-backup e limpeza de auditoria', () => {
    const saved = recordPortableBackupTimestamp('2026-11-22T10:00:00.000Z');
    expect(getLastPortableBackupAt()).toBe(saved);

    snoozeBackupReminder(7);
    expect(getBackupReminderSnoozedUntil()).not.toBeNull();

    setAutoFolderBackupEnabled(false);
    expect(isAutoFolderBackupEnabled()).toBe(false);
    setAutoFolderBackupEnabled(true);
    expect(isAutoFolderBackupEnabled()).toBe(true);

    clearBackupAuditStorage();
    expect(getLastPortableBackupAt()).toBeNull();
    expect(getBackupReminderSnoozedUntil()).toBeNull();
  });
});
