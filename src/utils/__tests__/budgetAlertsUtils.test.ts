import { describe, expect, it } from 'vitest';
import { evaluateMonthlyBudgetAlerts } from '../budgetAlertsUtils';
import { BudgetLimit, Transaction } from '../../types';

describe('budgetAlertsUtils.evaluateMonthlyBudgetAlerts', () => {
  const refDate = new Date(2026, 10, 23, 12, 0, 0); // 2026-11

  const limits: BudgetLimit[] = [
    { category: 'alimentacao', monthlyLimit: 1000 },
    { category: 'transporte', monthlyLimit: 500 },
    { category: 'lazer', monthlyLimit: 400 },
    { category: 'outros', monthlyLimit: 0 },
  ];

  const transactions: Transaction[] = [
    {
      id: '1',
      type: 'despesa',
      title: 'Mercado',
      amount: 820,
      category: 'alimentacao',
      date: '2026-11-05',
    },
    {
      id: '2',
      type: 'despesa',
      title: 'Combustível e Uber',
      amount: 550,
      category: 'transporte',
      date: '2026-11-12',
    },
    {
      id: '3',
      type: 'despesa',
      title: 'Cinema',
      amount: 200,
      category: 'lazer',
      date: '2026-11-14',
    },
    // Receita na mesma categoria não entra na soma de despesas
    {
      id: '4',
      type: 'receita',
      title: 'Reembolso jantar',
      amount: 500,
      category: 'lazer',
      date: '2026-11-15',
    },
    // Mês anterior não afeta o mês atual
    {
      id: '5',
      type: 'despesa',
      title: 'Viagem outubro',
      amount: 900,
      category: 'lazer',
      date: '2026-10-20',
    },
  ];

  it('retorna alertas >= 80% (warning) e >= 100% (exceeded) ordenados por percentual', () => {
    const alerts = evaluateMonthlyBudgetAlerts(transactions, limits, refDate);
    expect(alerts).toHaveLength(2);

    expect(alerts[0]).toMatchObject({
      category: 'transporte',
      level: 'exceeded',
      percent: 110,
      spent: 550,
      monthlyLimit: 500,
      monthKey: '2026-11',
    });

    expect(alerts[1]).toMatchObject({
      category: 'alimentacao',
      level: 'warning',
      percent: 82,
      spent: 820,
      monthlyLimit: 1000,
      monthKey: '2026-11',
    });
  });

  it('retorna lista vazia quando não há limites positivos configurados', () => {
    expect(evaluateMonthlyBudgetAlerts(transactions, [{ category: 'outros', monthlyLimit: 0 }], refDate)).toEqual([]);
  });
});
