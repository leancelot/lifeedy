import { describe, expect, it } from 'vitest';
import { PendingBankNotification } from '../../types';
import { partitionImmediateBankNotifications } from '../bankQueueUtils';

const makeItem = (overrides: Partial<PendingBankNotification>): PendingBankNotification => ({
  id: 'bn-1',
  bankName: 'Nubank',
  title: 'Pix recebido',
  amount: 120,
  type: 'receita',
  category: 'outros',
  date: '2026-11-27',
  paymentMethod: 'pix',
  rawText: 'Você recebeu um Pix de R$ 120,00',
  receivedAt: '2026-11-27T10:00:00.000Z',
  signature: 'sig-1',
  source: 'android',
  ...overrides,
});

describe('partitionImmediateBankNotifications', () => {
  it('aprova apenas lançamentos imediatos e mantém agendamentos futuros (isScheduled) na fila', () => {
    const immediate = makeItem({
      id: 'bn-now',
      title: 'Mercado Central',
      amount: 85.5,
      type: 'despesa',
      category: 'alimentacao',
      isScheduled: false,
    });
    const scheduled = makeItem({
      id: 'bn-future',
      title: 'Pix agendado aluguel',
      amount: 1800,
      type: 'despesa',
      category: 'moradia',
      isScheduled: true,
      date: '2026-12-05',
    });

    const result = partitionImmediateBankNotifications([immediate, scheduled], 1700000000000);

    expect(result.immediateItems.map((i) => i.id)).toEqual(['bn-now']);
    expect(result.remainingItems.map((i) => i.id)).toEqual(['bn-future']);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      title: 'Mercado Central',
      amount: 85.5,
      type: 'despesa',
      category: 'alimentacao',
      notes: 'Origem: Nubank',
    });
  });

  it('retorna lista vazia de transações quando só existem itens agendados na fila', () => {
    const onlyScheduled = makeItem({
      id: 'bn-only-sched',
      isScheduled: true,
    });

    const result = partitionImmediateBankNotifications([onlyScheduled]);

    expect(result.transactions).toEqual([]);
    expect(result.immediateItems).toEqual([]);
    expect(result.remainingItems).toHaveLength(1);
    expect(result.remainingItems[0].id).toBe('bn-only-sched');
  });
});
