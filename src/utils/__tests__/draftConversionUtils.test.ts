import { describe, expect, it } from 'vitest';
import {
  buildDraftSummaryNote,
  extractAmountFromDraftText,
  guessFinanceCategoryFromText,
  matchesDraftSearch,
} from '../draftConversionUtils';
import { DraftNote } from '../../types';

describe('draftConversionUtils', () => {
  it('extracts Brazilian currency amounts and ignores dates and times', () => {
    expect(extractAmountFromDraftText('17/11 às 14:30 - Mercado R$ 145,90')).toBe(145.9);
    expect(extractAmountFromDraftText('Conta de luz 1.250,45 vencimento 20/11')).toBe(1250.45);
    expect(extractAmountFromDraftText('Uber para reunião 32.50')).toBe(32.5);
    expect(extractAmountFromDraftText('Reunião dia 12/11 às 10:30')).toBeNull();
  });

  it('guesses appropriate finance categories from Portuguese keywords', () => {
    expect(guessFinanceCategoryFromText('Almoço no restaurante')).toBe('alimentacao');
    expect(guessFinanceCategoryFromText('Uber aeroporto')).toBe('transporte');
    expect(guessFinanceCategoryFromText('Farmácia remédio')).toBe('saude');
    expect(guessFinanceCategoryFromText('Aluguel apartamento')).toBe('moradia');
    expect(guessFinanceCategoryFromText('Item genérico')).toBe('outros');
  });

  it('matches draft search across title, content, and checklist items', () => {
    const draft: DraftNote = {
      id: 'd1',
      title: 'Compras da semana',
      content: 'Passar na padaria',
      kind: 'list',
      checklistItems: [
        { id: 'c1', text: 'Café em grão', completed: false },
        { id: 'c2', text: 'Leite', completed: true },
      ],
      updatedAt: '2026-11-17T10:00:00Z',
    };

    expect(matchesDraftSearch(draft, 'compras')).toBe(true);
    expect(matchesDraftSearch(draft, 'padaria')).toBe(true);
    expect(matchesDraftSearch(draft, 'café')).toBe(true);
    expect(matchesDraftSearch(draft, 'farmácia')).toBe(false);
  });

  it('builds clean summary title and notes from draft', () => {
    const draft: DraftNote = {
      id: 'd2',
      title: 'Mercado',
      content: 'Levar sacola reutilizável',
      checklistItems: [{ id: 'c1', text: 'Arroz', completed: false }],
      updatedAt: '2026-11-17T10:00:00Z',
    };
    const res = buildDraftSummaryNote(draft);
    expect(res.title).toBe('Mercado');
    expect(res.notes).toContain('Levar sacola reutilizável');
    expect(res.notes).toContain('[ ] Arroz');
  });
});
