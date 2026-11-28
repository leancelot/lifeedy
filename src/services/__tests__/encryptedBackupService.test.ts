import { describe, expect, it } from 'vitest';
import {
  decryptBackupEnvelope,
  detectBackupFormat,
  ENCRYPTED_BACKUP_FORMAT,
  encryptBackupPayload,
  inspectEncryptedBackupMetadata,
} from '../encryptedBackupService';
import { AppDataPayload } from '../../types';

const SAMPLE_PAYLOAD: AppDataPayload = {
  version: 4,
  lastUpdated: '2026-11-22T12:00:00.000Z',
  userName: 'Leandro',
  onboardingCompleted: true,
  tasks: [
    {
      id: 't-1',
      title: 'Pagar energia',
      dueDate: '2026-11-25',
      priority: 'high',
      category: 'financas',
      completed: false,
      subtasks: [],
      linkedEventId: 'ev-1',
    },
  ],
  events: [
    {
      id: 'ev-1',
      summary: 'Consulta médica',
      start: { dateTime: '2026-11-25T14:00:00.000Z' },
      end: { dateTime: '2026-11-25T15:00:00.000Z' },
      source: 'local',
      editable: true,
    },
  ],
  transactions: [
    {
      id: 'tx-1',
      type: 'despesa',
      title: 'Farmácia',
      amount: 89.9,
      category: 'saude',
      date: '2026-11-22',
    },
  ],
  financialGoals: [],
  budgetLimits: [],
  draftNotes: [],
  pendingBankNotifications: [],
  specialDates: [],
};

describe('encryptedBackupService', () => {
  it('detecta formato cifrado, JSON legado e entradas inválidas corretamente', async () => {
    const encryptedText = await encryptBackupPayload(SAMPLE_PAYLOAD, 'segredo-forte', 'v1.2.0');

    expect(detectBackupFormat(encryptedText)).toBe('encrypted');
    expect(detectBackupFormat(JSON.stringify(SAMPLE_PAYLOAD))).toBe('legacy_json');
    expect(detectBackupFormat('')).toBe('invalid');
    expect(detectBackupFormat('{"aleatorio": 123}')).toBe('invalid');
    expect(detectBackupFormat('{invalido')).toBe('invalid');

    const meta = inspectEncryptedBackupMetadata(encryptedText);
    expect(meta).not.toBeNull();
    expect(meta?.appVersion).toBe('v1.2.0');
    expect(meta?.iterations).toBe(210_000);
    expect(typeof meta?.exportedAt).toBe('string');
  });

  it('cifra e descriptografa round-trip preservando tarefas, eventos e finanças', async () => {
    const envelopeJson = await encryptBackupPayload(SAMPLE_PAYLOAD, 'minha-senha-2026', 'v1.2.0');
    const parsedEnvelope = JSON.parse(envelopeJson);
    expect(parsedEnvelope.format).toBe(ENCRYPTED_BACKUP_FORMAT);
    expect(parsedEnvelope.cipher).toBe('AES-256-GCM');
    expect(parsedEnvelope.kdf).toBe('PBKDF2-SHA256');
    expect(envelopeJson).not.toContain('Farmácia');
    expect(envelopeJson).not.toContain('Pagar energia');

    const decrypted = await decryptBackupEnvelope(envelopeJson, 'minha-senha-2026');
    expect(decrypted.payload.userName).toBe('Leandro');
    expect(decrypted.payload.tasks).toHaveLength(1);
    expect(decrypted.payload.tasks?.[0].linkedEventId).toBe('ev-1');
    expect(decrypted.payload.events).toHaveLength(1);
    expect(decrypted.payload.events?.[0].summary).toBe('Consulta médica');
    expect(decrypted.payload.transactions?.[0].amount).toBe(89.9);
    expect(decrypted.checksum).toMatch(/^[0-9a-f]{8}$/);
  });

  it('rejeita senha curta na exportação e falha na descriptografia com senha incorreta ou adulteração', async () => {
    await expect(encryptBackupPayload(SAMPLE_PAYLOAD, '123')).rejects.toThrow(/pelo menos 4 caracteres/i);

    const envelopeJson = await encryptBackupPayload(SAMPLE_PAYLOAD, 'senha-certa');
    await expect(decryptBackupEnvelope(envelopeJson, 'senha-errada')).rejects.toThrow(
      /Senha incorreta/i
    );

    const tampered = JSON.parse(envelopeJson);
    tampered.ciphertext = 'A' + tampered.ciphertext.slice(1);
    await expect(decryptBackupEnvelope(JSON.stringify(tampered), 'senha-certa')).rejects.toThrow(
      /Senha incorreta|adulterado/i
    );
  });
});
