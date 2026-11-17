import {
  AppDataPayload,
  BudgetLimit,
  DraftAudioAttachment,
  DraftChecklistItem,
  DraftImageAttachment,
  DraftNote,
  FinancialGoal,
  LocalSpecialDate,
  TaskItem,
  Transaction,
} from '../types';

export const CURRENT_DATA_VERSION = 3;
export const DEFAULT_WIDGETS = [
  'overview',
  'schedule',
  'tasks',
  'finance',
  'scratchpad',
  'reminders',
];

// Assinaturas exatas dos antigos registros de exemplo para remoção segura apenas se não editados
const LEGACY_SEED_TASK_TITLES: Record<string, string> = {
  't-1': 'Revisar orçamento mensal e contas a pagar',
  't-2': 'Planejar metas da semana e prioridades',
  't-3': 'Prática de exercícios físicos (45 min)',
  't-4': 'Leitura de 20 páginas de livro',
};

const LEGACY_SEED_TRANSACTIONS: Record<string, { title: string; amount: number }> = {
  'tx-1': { title: 'Salário Mensal', amount: 5800 },
  'tx-2': { title: 'Projeto Freelance', amount: 1450 },
  'tx-3': { title: 'Aluguel & Condomínio', amount: 1850 },
  'tx-4': { title: 'Supermercado do Mês', amount: 780.45 },
  'tx-5': { title: 'Combustível / Transporte', amount: 220 },
  'tx-6': { title: 'Academia & Saúde', amount: 190 },
};

const LEGACY_SEED_GOALS: Record<
  string,
  { title: string; targetAmount: number; currentAmount: number }
> = {
  'g-1': { title: 'Reserva de Emergência (6 meses)', targetAmount: 25000, currentAmount: 18500 },
  'g-2': { title: 'Viagem de Férias', targetAmount: 6000, currentAmount: 3400 },
  'g-3': { title: 'Troca de Computador / Setup', targetAmount: 7500, currentAmount: 4200 },
};

const LEGACY_SEED_DRAFTS: Record<string, string> = {
  'draft-1': 'Ideias de Projetos & Objetivos',
  'draft-2': 'Rascunho Rápido / Notas Diárias',
};

const LEGACY_SEED_BUDGETS: Record<string, number> = {
  moradia: 2000,
  alimentacao: 1200,
  transporte: 450,
  lazer: 600,
  saude: 400,
};

function normalizeDraftNote(raw: unknown): DraftNote | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id) return null;

  const checklistItems: DraftChecklistItem[] | undefined = Array.isArray(r.checklistItems)
    ? r.checklistItems
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map((item, idx) => ({
          id: typeof item.id === 'string' && item.id ? item.id : `chk-${idx}-${Date.now()}`,
          text: typeof item.text === 'string' ? item.text : '',
          completed: Boolean(item.completed),
        }))
        .filter((item) => item.text.trim().length > 0)
    : undefined;

  const images: DraftImageAttachment[] | undefined = Array.isArray(r.images)
    ? r.images
        .filter(
          (img): img is Record<string, unknown> =>
            Boolean(img && typeof img === 'object' && typeof (img as Record<string, unknown>).dataUrl === 'string')
        )
        .map((img, idx) => ({
          id: typeof img.id === 'string' && img.id ? img.id : `img-${idx}-${Date.now()}`,
          dataUrl: String(img.dataUrl),
          caption: typeof img.caption === 'string' ? img.caption : undefined,
          width: typeof img.width === 'number' ? img.width : undefined,
          height: typeof img.height === 'number' ? img.height : undefined,
        }))
    : undefined;

  const audios: DraftAudioAttachment[] | undefined = Array.isArray(r.audios)
    ? r.audios
        .filter(
          (aud): aud is Record<string, unknown> =>
            Boolean(aud && typeof aud === 'object' && typeof (aud as Record<string, unknown>).dataUrl === 'string')
        )
        .map((aud, idx) => ({
          id: typeof aud.id === 'string' && aud.id ? aud.id : `aud-${idx}-${Date.now()}`,
          dataUrl: String(aud.dataUrl),
          mimeType: typeof aud.mimeType === 'string' ? aud.mimeType : 'audio/webm',
          durationSec: typeof aud.durationSec === 'number' && Number.isFinite(aud.durationSec) ? aud.durationSec : 0,
          createdAt: typeof aud.createdAt === 'string' ? aud.createdAt : new Date().toISOString(),
        }))
    : undefined;

  const title = typeof r.title === 'string' ? r.title : 'Rascunho';
  const content = typeof r.content === 'string' ? r.content : '';

  return {
    id: r.id,
    title,
    content,
    kind:
      r.kind === 'text' || r.kind === 'list' || r.kind === 'media' || r.kind === 'mixed'
        ? r.kind
        : undefined,
    checklistItems: checklistItems && checklistItems.length > 0 ? checklistItems : undefined,
    images: images && images.length > 0 ? images : undefined,
    audios: audios && audios.length > 0 ? audios : undefined,
    color: typeof r.color === 'string' ? r.color : undefined,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(),
    isPinned: typeof r.isPinned === 'boolean' ? r.isPinned : undefined,
  };
}

function normalizeSpecialDates(raw: unknown): LocalSpecialDate[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .filter(
      (item) =>
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        typeof item.monthDay === 'string' &&
        item.title.trim().length > 0
    )
    .map((item) => ({
      id: String(item.id),
      title: String(item.title).trim(),
      monthDay: String(item.monthDay).trim(),
      category:
        item.category === 'birthday' || item.category === 'holiday' || item.category === 'commemorative'
          ? item.category
          : 'commemorative',
      notes: typeof item.notes === 'string' ? item.notes : undefined,
      recurringYearly: item.recurringYearly !== false,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
    }));
}

export function sanitizeLegacyPayload(parsed: unknown): Partial<AppDataPayload> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const record = parsed as Record<string, unknown>;
  const isLegacyVersion =
    typeof record.version !== 'number' || record.version < CURRENT_DATA_VERSION;

  const rawTasks: TaskItem[] = Array.isArray(record.tasks) ? (record.tasks as TaskItem[]) : [];
  const rawTxs: Transaction[] = Array.isArray(record.transactions)
    ? (record.transactions as Transaction[])
    : [];
  const rawGoals: FinancialGoal[] = Array.isArray(record.financialGoals)
    ? (record.financialGoals as FinancialGoal[])
    : [];
  const rawBudgets: BudgetLimit[] = Array.isArray(record.budgetLimits)
    ? (record.budgetLimits as BudgetLimit[])
    : [];
  const rawDrafts: DraftNote[] = Array.isArray(record.draftNotes)
    ? record.draftNotes.map(normalizeDraftNote).filter((d): d is DraftNote => d !== null)
    : [];
  const specialDates = normalizeSpecialDates(record.specialDates);
  const dashboardWidgets = Array.isArray(record.dashboardWidgets)
    ? (record.dashboardWidgets as string[])
    : DEFAULT_WIDGETS;
  const pendingBankNotifications = Array.isArray(record.pendingBankNotifications)
    ? (record.pendingBankNotifications as AppDataPayload['pendingBankNotifications'])
    : [];

  if (!isLegacyVersion) {
    return {
      userName: typeof record.userName === 'string' ? record.userName : '',
      onboardingCompleted: Boolean(record.onboardingCompleted),
      tasks: rawTasks,
      transactions: rawTxs,
      financialGoals: rawGoals,
      budgetLimits: rawBudgets,
      draftNotes: rawDrafts,
      specialDates,
      dashboardWidgets,
      pendingBankNotifications,
    };
  }

  const tasks = rawTasks.filter((t) => LEGACY_SEED_TASK_TITLES[t.id] !== t.title);
  const transactions = rawTxs.filter((tx) => {
    const seed = LEGACY_SEED_TRANSACTIONS[tx.id];
    return !(seed && seed.title === tx.title && seed.amount === tx.amount);
  });
  const financialGoals = rawGoals.filter((g) => {
    const seed = LEGACY_SEED_GOALS[g.id];
    return !(
      seed &&
      seed.title === g.title &&
      seed.targetAmount === g.targetAmount &&
      seed.currentAmount === g.currentAmount
    );
  });
  const budgetLimits = rawBudgets.filter(
    (b) => LEGACY_SEED_BUDGETS[b.category] !== b.monthlyLimit
  );
  const draftNotes = rawDrafts.filter((d) => LEGACY_SEED_DRAFTS[d.id] !== d.title);

  return {
    userName: typeof record.userName === 'string' ? record.userName : '',
    onboardingCompleted: Boolean(record.onboardingCompleted),
    tasks,
    transactions,
    financialGoals,
    budgetLimits,
    draftNotes,
    specialDates,
    dashboardWidgets,
    pendingBankNotifications,
  };
}
