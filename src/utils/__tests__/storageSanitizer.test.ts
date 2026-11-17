import { describe, expect, it } from 'vitest';
import { CURRENT_DATA_VERSION, DEFAULT_WIDGETS, sanitizeLegacyPayload } from '../storageSanitizer';

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
    expect(sanitized.dashboardWidgets).toEqual(['overview', 'finance']);
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
    expect(sanitized.dashboardWidgets).toEqual(DEFAULT_WIDGETS);
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
});
