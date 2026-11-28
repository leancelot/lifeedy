import { describe, expect, it } from 'vitest';
import { formatLocalDateIso } from '../dateUtils';
import {
  CURRENT_DATA_VERSION,
  computeStableContentChecksum,
  sanitizeLegacyPayload,
  serializeAppPayloadSafely,
} from '../storageSanitizer';
import { validateAndParseBackupJson } from '../runtimeValidator';

describe('sanitizeLegacyPayload', () => {
  it('retorna objeto vazio para entradas nulas ou inválidas sem lançar exceção', () => {
    expect(sanitizeLegacyPayload(null)).toEqual({});
    expect(sanitizeLegacyPayload(undefined)).toEqual({});
    expect(sanitizeLegacyPayload('texto-corrompido')).toEqual({});
    expect(sanitizeLegacyPayload([])).toEqual({});
  });

  it('preserva integralmente os dados reais na versão atual', () => {
    const payload = {
      version: CURRENT_DATA_VERSION,
      userName: 'Leandro',
      onboardingCompleted: true,
      tasks: [
        {
          id: 't-real',
          title: 'Pagar boleto de internet',
          completed: false,
          dueDate: '2026-11-15',
          priority: 'high',
          category: 'trabalho',
        },
      ],
      transactions: [
        {
          id: 'tx-real',
          type: 'despesa',
          title: 'Mercado Central',
          amount: 142.3,
          category: 'alimentacao',
          date: '2026-11-15',
          recurring: false,
        },
      ],
      financialGoals: [],
      budgetLimits: [],
      draftNotes: [],
      dashboardWidgets: ['overview', 'finance'],
      pendingBankNotifications: [],
    };

    const sanitized = sanitizeLegacyPayload(payload);
    expect(sanitized.userName).toBe('Leandro');
    expect(sanitized.onboardingCompleted).toBe(true);
    expect(sanitized.tasks).toHaveLength(1);
    expect(sanitized.transactions).toHaveLength(1);
    expect((sanitized as Record<string, unknown>).dashboardWidgets).toBeUndefined();
  });

  it('remove seeds legados exatos sem apagar registros personalizados do usuário', () => {
    const legacyPayload = {
      version: 2,
      userName: 'Leandro',
      onboardingCompleted: true,
      tasks: [
        { id: 't-1', title: 'Revisar orçamento mensal e contas a pagar', completed: false },
        { id: 't-user', title: 'Agendar revisão do carro', completed: false },
      ],
      transactions: [
        { id: 'tx-1', title: 'Salário Mensal', amount: 5800 },
        { id: 'tx-1-edited', title: 'Salário Mensal', amount: 6500 },
        { id: 'tx-user', title: 'Padaria Bairro', amount: 18.5 },
      ],
      budgetLimits: [
        { category: 'moradia', monthlyLimit: 2000 },
        { category: 'alimentacao', monthlyLimit: 1800 },
      ],
      draftNotes: [
        { id: 'draft-1', title: 'Ideias de Projetos & Objetivos', content: '...' },
        { id: 'draft-user', title: 'Lista de compras', content: 'Café' },
      ],
    };

    const sanitized = sanitizeLegacyPayload(legacyPayload);
    expect(sanitized.tasks?.map((t) => t.id)).toEqual(['t-user']);
    expect(sanitized.transactions?.map((t) => t.id)).toEqual(['tx-1-edited', 'tx-user']);
    expect(sanitized.budgetLimits?.map((b) => b.category)).toEqual(['alimentacao']);
    expect(sanitized.draftNotes?.map((d) => d.id)).toEqual(['draft-user']);
  });

  it('preserva rascunhos multimídia (lista, imagem e áudio) e datas especiais', () => {
    const payload = {
      version: CURRENT_DATA_VERSION,
      userName: 'Leandro',
      onboardingCompleted: true,
      tasks: [],
      transactions: [],
      financialGoals: [],
      budgetLimits: [],
      draftNotes: [
        {
          id: 'draft-rich',
          title: 'Compras & Ideias',
          content: 'Lembrar de conferir preços',
          kind: 'mixed',
          checklistItems: [{ id: 'c1', text: 'Café', completed: true }],
          images: [{ id: 'i1', dataUrl: 'data:image/webp;base64,AAA', width: 200, height: 200 }],
          audios: [
            {
              id: 'a1',
              dataUrl: 'data:audio/webm;base64,BBB',
              mimeType: 'audio/webm',
              durationSec: 12,
              createdAt: '2026-11-17T08:00:00.000Z',
            },
          ],
          isPinned: true,
          updatedAt: '2026-11-17T08:00:00.000Z',
        },
      ],
      specialDates: [
        {
          id: 'sp-1',
          title: 'Aniversário da Ana',
          monthDay: '11-25',
          category: 'birthday',
          recurringYearly: true,
          createdAt: '2026-11-17T08:00:00.000Z',
        },
      ],
    };

    const sanitized = sanitizeLegacyPayload(payload);
    expect(sanitized.draftNotes?.[0].checklistItems).toHaveLength(1);
    expect(sanitized.draftNotes?.[0].images).toHaveLength(1);
    expect(sanitized.draftNotes?.[0].audios?.[0].durationSec).toBe(12);
    expect(sanitized.specialDates?.[0].title).toBe('Aniversário da Ana');
  });

  it('deduplica IDs repetidos, aceita backups v3 e gera checksum consistente', () => {
    const payloadV3 = {
      version: 3,
      lastUpdated: '2026-11-17T10:00:00.000Z',
      userName: 'Leandro',
      onboardingCompleted: true,
      tasks: [
        { id: 'dup-1', title: 'Primeira versão', completed: false, dueDate: '2026-11-18', priority: 'high', category: 'trabalho', subtasks: [] },
        { id: 'dup-1', title: 'Cópia duplicada', completed: true, dueDate: '2026-11-18', priority: 'low', category: 'trabalho', subtasks: [] },
      ],
      transactions: [],
      financialGoals: [],
      budgetLimits: [],
      draftNotes: [],
    };

    const sanitized = sanitizeLegacyPayload(payloadV3);
    expect(sanitized.tasks).toHaveLength(1);
    expect(sanitized.tasks?.[0].title).toBe('Primeira versão');

    const serialized = serializeAppPayloadSafely({
      version: CURRENT_DATA_VERSION,
      lastUpdated: '2026-11-18T10:00:00.000Z',
      tasks: sanitized.tasks || [],
      events: [],
      transactions: [],
      financialGoals: [],
      budgetLimits: [],
      draftNotes: [],
    });
    expect(serialized.checksum).toMatch(/^[0-9a-f]{8}$/);
    expect(serialized.contentChecksum).toMatch(/^[0-9a-f]{8}$/);
    expect(serialized.byteSize).toBeGreaterThan(20);
  });

  it('mantém contentChecksum estável quando apenas lastUpdated muda e altera quando dados mudam', () => {
    const basePayload = {
      version: CURRENT_DATA_VERSION,
      lastUpdated: '2026-11-18T10:00:00.000Z',
      tasks: [],
      events: [],
      transactions: [],
      financialGoals: [],
      budgetLimits: [],
      draftNotes: [],
    };
    const sameContentDifferentTimestamp = {
      ...basePayload,
      lastUpdated: '2026-11-19T23:59:59.000Z',
    };
    const modifiedContent = {
      ...basePayload,
      userName: 'Leandro',
    };

    expect(computeStableContentChecksum(basePayload)).toBe(
      computeStableContentChecksum(sameContentDifferentTimestamp)
    );
    expect(computeStableContentChecksum(basePayload)).not.toBe(
      computeStableContentChecksum(modifiedContent)
    );
  });

  it('formata data local em YYYY-MM-DD sem deslocamento UTC', () => {
    const localLateNight = new Date(2026, 10, 22, 23, 45, 0);
    expect(formatLocalDateIso(localLateNight)).toBe('2026-11-22');
  });

  it('migra googleCalendarEventId legado para linkedEventId e normaliza eventos locais', () => {
    const legacy = {
      version: 3,
      tasks: [
        {
          id: 't-mig',
          title: 'Consulta médica',
          dueDate: '2026-12-01',
          priority: 'high',
          category: 'saude',
          completed: false,
          googleCalendarEventId: 'ev-old-99',
        },
      ],
      events: [
        {
          id: 'ev-1',
          summary: 'Dentista',
          start: { dateTime: '2026-12-01T10:00:00.000Z' },
          end: { dateTime: '2026-12-01T11:00:00.000Z' },
          source: 'local',
        },
      ],
    };

    const sanitized = sanitizeLegacyPayload(legacy);
    expect(sanitized.tasks?.[0].linkedEventId).toBe('ev-old-99');
    expect(sanitized.events).toHaveLength(1);
    expect(sanitized.events?.[0].summary).toBe('Dentista');
    expect(sanitized.events?.[0].source).toBe('local');
  });

  it('aceita backup antigo contendo dashboardWidgets e reminderMinutesBefore sem erro de validação', () => {
    const legacyBackupJson = JSON.stringify({
      version: 4,
      userName: 'Maria',
      onboardingCompleted: true,
      dashboardWidgets: ['overview', 'finance'],
      tasks: [
        {
          id: 't-legacy-1',
          title: 'Tomar remédio',
          dueDate: '2026-11-27',
          dueTime: '09:00',
          priority: 'high',
          category: 'saude',
          completed: false,
          reminderMinutesBefore: 30,
          subtasks: [],
        },
      ],
      transactions: [],
      financialGoals: [],
      budgetLimits: [],
      draftNotes: [],
    });

    const validated = validateAndParseBackupJson(legacyBackupJson);
    expect(validated.ok).toBe(true);
    expect(validated.data?.payload.tasks).toHaveLength(1);
    expect(validated.data?.payload.tasks?.[0].title).toBe('Tomar remédio');
    expect((validated.data?.payload.tasks?.[0] as unknown as Record<string, unknown>).reminderMinutesBefore).toBeUndefined();
    expect((validated.data?.payload as Record<string, unknown>).dashboardWidgets).toBeUndefined();
  });
});
