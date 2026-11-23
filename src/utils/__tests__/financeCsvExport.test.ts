import { describe, expect, it } from 'vitest';
import { buildMonthlyFinanceCsv, sanitizeCsvCell } from '../financeCsvExport';
import { Transaction } from '../../types';

describe('financeCsvExport', () => {
  it('neutraliza fórmulas potencialmente perigosas em células CSV', () => {
    expect(sanitizeCsvCell('=CMD("calc")')).toBe(`"'=CMD(""calc"")"`);
    expect(sanitizeCsvCell('+1+1')).toBe(`"'+1+1"`);
    expect(sanitizeCsvCell('-2*3')).toBe(`"'-2*3"`);
    expect(sanitizeCsvCell('@SUM(A1:A2)')).toBe(`"'@SUM(A1:A2)"`);
    expect(sanitizeCsvCell('\t=HYPERLINK("https://x.com")')).toBe(
      `"'=HYPERLINK(""https://x.com"")"`
    );
    expect(sanitizeCsvCell('Mercado\nCentral')).toBe(`"Mercado Central"`);
  });

  it('gera CSV PT-BR com BOM UTF-8, separador ponto-e-vírgula e ordenação decrescente', () => {
    const transactions: Transaction[] = [
      {
        id: 'tx-1',
        type: 'despesa',
        title: '=MaliciousTitle',
        amount: 45.9,
        category: 'alimentacao',
        date: '2026-11-10',
        paymentMethod: 'cartao_credito',
        notes: 'Almoço',
        recurring: false,
      },
      {
        id: 'tx-2',
        type: 'receita',
        title: 'Salário Novembro',
        amount: 5200,
        category: 'salario',
        date: '2026-11-15',
        paymentMethod: 'transferencia',
        recurring: true,
      },
    ];

    const csv = buildMonthlyFinanceCsv(transactions);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      'Data;Tipo;Título;Categoria;Valor (R$);Forma de Pagamento;Recorrente;Observações'
    );
    expect(lines[1]).toContain('"2026-11-15";"Receita";"Salário Novembro";"Salário";5200,00;"transferencia";Sim;""');
    expect(lines[2]).toContain(`"2026-11-10";"Despesa";"'=MaliciousTitle";"Alimentação";45,90;"cartao credito";Não;"Almoço"`);
  });
});
