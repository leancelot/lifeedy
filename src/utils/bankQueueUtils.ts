import { PendingBankNotification, Transaction } from '../types';

export interface BatchApprovePartition {
  immediateItems: PendingBankNotification[];
  remainingItems: PendingBankNotification[];
  transactions: Transaction[];
}

export function partitionImmediateBankNotifications(
  items: PendingBankNotification[],
  nowBase = Date.now()
): BatchApprovePartition {
  const immediateItems = items.filter((item) => !item.isScheduled);
  const remainingItems = items.filter((item) => Boolean(item.isScheduled));

  const transactions: Transaction[] = immediateItems.map((item, idx) => ({
    id: `tx-${nowBase}-${idx}-${Math.random().toString(36).substring(2, 5)}`,
    type: item.type,
    title: item.title,
    amount: item.amount,
    category: item.category,
    date: item.date,
    paymentMethod: item.paymentMethod,
    notes: `Origem: ${item.bankName}`,
    recurring: false,
  }));

  return { immediateItems, remainingItems, transactions };
}
