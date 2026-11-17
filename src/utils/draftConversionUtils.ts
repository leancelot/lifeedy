import { DraftNote, FinanceCategory } from '../types';

export function matchesDraftSearch(draft: DraftNote, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if ((draft.title || '').toLowerCase().includes(q)) return true;
  if ((draft.content || '').toLowerCase().includes(q)) return true;
  return (draft.checklistItems || []).some((item) => item.text.toLowerCase().includes(q));
}

export function extractAmountFromDraftText(text: string): number | null {
  if (!text) return null;

  // Strip dates like 17/11/2026 or 17-11 and times like 14:30 before scanning numbers
  const sanitized = text
    .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}\b/g, ' ');

  // Priority 1: Explicit R$ value (e.g. R$ 1.234,56 or R$ 45,90 or R$ 80)
  const currencyMatch = sanitized.match(/R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})|\d+(?:[.,]\d{1,2})?)/i);
  if (currencyMatch) {
    const parsed = parseBrazilianNumber(currencyMatch[1]);
    if (parsed !== null && parsed > 0) return parsed;
  }

  // Priority 2: Standalone decimal number (e.g. 45,90 or 120.50 or 1.250,00)
  const decimalMatch = sanitized.match(/\b(\d{1,3}(?:\.\d{3})*,\d{1,2}|\d+[.,]\d{2})\b/);
  if (decimalMatch) {
    const parsed = parseBrazilianNumber(decimalMatch[1]);
    if (parsed !== null && parsed > 0) return parsed;
  }

  return null;
}

function parseBrazilianNumber(raw: string): number | null {
  let normalized = raw.trim();
  if (normalized.includes(',')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  }
  const num = Number(normalized);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100) / 100;
}

export function guessFinanceCategoryFromText(text: string): FinanceCategory {
  const t = text.toLowerCase();
  if (/(mercado|supermercado|almo[cç]o|jantar|lanche|caf[eé]|restaurante|ifood|padaria|pizza)/.test(t)) {
    return 'alimentacao';
  }
  if (/(uber|99|gasolina|combust[ií]vel|[oô]nibus|metr[oô]|estacionamento|ped[aá]gio|passagem)/.test(t)) {
    return 'transporte';
  }
  if (/(farm[aá]cia|rem[eé]dio|m[eé]dic|consulta|dentista|exame|plano de sa[uú]de)/.test(t)) {
    return 'saude';
  }
  if (/(aluguel|condom[ií]nio|luz|energia|[aá]gua|internet|g[aá]s|iptu|celular)/.test(t)) {
    return 'moradia';
  }
  if (/(curso|livro|faculdade|escola|aula|apostila)/.test(t)) {
    return 'educacao';
  }
  if (/(cinema|show|viagem|streaming|netflix|spotify|jogo|lazer)/.test(t)) {
    return 'lazer';
  }
  if (/(sal[aá]rio|pagamento|adiantamento)/.test(t)) {
    return 'salario';
  }
  if (/(freela|freelance|projeto|cliente)/.test(t)) {
    return 'freelance';
  }
  return 'outros';
}

export function buildDraftSummaryNote(draft: DraftNote): { title: string; notes: string } {
  const cleanTitle = draft.title.trim() || draft.content.trim().split('\n')[0].slice(0, 60) || 'Nota';
  const parts: string[] = [];
  if (draft.content.trim() && draft.content.trim() !== cleanTitle) {
    parts.push(draft.content.trim());
  }
  const items = draft.checklistItems || [];
  if (items.length > 0) {
    parts.push(items.map((i) => `${i.completed ? '[x]' : '[ ]'} ${i.text}`).join('\n'));
  }
  return {
    title: cleanTitle,
    notes: parts.join('\n\n').trim(),
  };
}
