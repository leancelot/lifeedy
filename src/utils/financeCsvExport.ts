import { shareOrDownloadTextFile } from '../services/encryptedBackupService';
import { FinanceCategory, Transaction } from '../types';

const CSV_CATEGORY_LABELS: Record<FinanceCategory, string> = {
  salario: 'Salário',
  investimentos: 'Investimentos',
  freelance: 'Freelance',
  moradia: 'Moradia & Contas',
  alimentacao: 'Alimentação',
  transporte: 'Transporte',
  saude: 'Saúde',
  educacao: 'Educação',
  lazer: 'Lazer & Cultura',
  outros: 'Outros',
};

const FORMULA_TRIGGER_PATTERN = /^[=+\-@\t\r]/;

export function sanitizeCsvCell(value: string): string {
  const cleaned = String(value ?? '').replace(/\r?\n/g, ' ').trim();
  const neutralized = FORMULA_TRIGGER_PATTERN.test(cleaned) ? `'${cleaned}` : cleaned;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

export function buildMonthlyFinanceCsv(transactions: Transaction[]): string {
  const headers = [
    'Data',
    'Tipo',
    'Título',
    'Categoria',
    'Valor (R$)',
    'Forma de Pagamento',
    'Recorrente',
    'Observações',
  ];

  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  const rows = sorted.map((tx) => [
    sanitizeCsvCell(tx.date),
    sanitizeCsvCell(tx.type === 'receita' ? 'Receita' : 'Despesa'),
    sanitizeCsvCell(tx.title),
    sanitizeCsvCell(CSV_CATEGORY_LABELS[tx.category] || tx.category),
    tx.amount.toFixed(2).replace('.', ','),
    sanitizeCsvCell(tx.paymentMethod ? tx.paymentMethod.replace(/_/g, ' ') : ''),
    tx.recurring ? 'Sim' : 'Não',
    sanitizeCsvCell(tx.notes || ''),
  ]);

  return '\uFEFF' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\r\n');
}

export async function exportMonthlyFinanceCsv(params: {
  transactions: Transaction[];
  year: number;
  monthIndex: number;
}): Promise<'native_share' | 'web_share' | 'download'> {
  const csvContent = buildMonthlyFinanceCsv(params.transactions);
  const fileName = `Extrato_Lifeedy_${params.year}_${String(params.monthIndex + 1).padStart(
    2,
    '0'
  )}.csv`;

  return shareOrDownloadTextFile({
    fileName,
    content: csvContent,
    mimeType: 'text/csv;charset=utf-8',
    chooserTitle: 'Exportar extrato financeiro (.csv)',
    preferShare: false,
  });
}
