import { describe, expect, it } from 'vitest';
import {
  computeMonthlyRecurringSummary,
  computeProjectedBalance,
} from '../financeForecastUtils';
import { Transaction } from '../../types';

describe('financeForecastUtils', () => {
  const baseTransactions: Transaction[] = [
    {
      id: 'tx-1',
      type: 'despesa',
      title: 'Internet Fibra',
      amount: 119.9,
      category: 'moradia',
      date: '2026-01-31',
      paymentMethod: 'pix',
      recurring: true,
    },
    {
      id: 'tx-2',
      type: 'despesa',
      title: 'Aluguel',
      amount: 2200,
      category: 'moradia',
      date: '2026-01-05',
      paymentMethod: 'transferencia',
      recurring: true,
    },
    {
      id: 'tx-3',
      type: 'despesa',
      title: 'Aluguel',
      amount: 2200,
      category: 'moradia',
      date: '2026-02-05',
      paymentMethod: 'transferencia',
      recurring: true,
    },
    {
      id: 'tx-4',
      type: 'despesa',
      title: 'Mercado Extra',
      amount: 350,
      category: 'alimentacao',
      date: '2026-01-12',
      recurring: false,
    },
  ];

  it('detects recurring expenses missing in target month and clamps day 31 to February 28', () => {
    const summary = computeMonthlyRecurringSummary(baseTransactions, 2026, 1); // Feb 2026
    expect(summary.pendingRecurring).toHaveLength(1);
    expect(summary.pendingRecurring[0]).toMatchObject({
      title: 'Internet Fibra',
      amount: 119.9,
      suggestedDate: '2026-02-28',
    });
    expect(summary.pendingTotal).toBe(119.9);
  });

  it('excludes dismissed recurring keys and calculates projected balance accurately', () => {
    const summary = computeMonthlyRecurringSummary(baseTransactions, 2026, 1, [
      'internet fibra::moradia',
    ]);
    expect(summary.pendingRecurring).toHaveLength(0);
    expect(summary.pendingTotal).toBe(0);

    const balance = computeProjectedBalance(5000, 2200, 119.9);
    expect(balance).toEqual({
      currentBalance: 2800,
      projectedBalance: 2680.1,
    });
  });
});
