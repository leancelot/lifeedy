import {
  AppDataPayload,
  BankCaptureSettings,
  BankCaptureSourceKind,
  BudgetLimit,
  DraftAudioAttachment,
  DraftChecklistItem,
  DraftImageAttachment,
  DraftNote,
  FinanceCategory,
  FinancialGoal,
  LocalCalendarEvent,
  LocalSpecialDate,
  ManualCaptureAppRule,
  PendingBankNotification,
  ScheduledValueMessage,
  TaskItem,
  Transaction,
} from '../types';
import { formatLocalDateIso } from './dateUtils';

export const CURRENT_DATA_VERSION = 4;
export const DEFAULT_WIDGETS = [
  'overview',
  'schedule',
  'tasks',
  'finance',
  'scratchpad',
  'reminders',
];

export const DEFAULT_BANK_CAPTURE_SETTINGS: BankCaptureSettings = {
  captureBanksEnabled: true,
  captureWalletEnabled: true,
  captureSmsEnabled: true,
  captureScheduledMessagesEnabled: true,
  manualApps: [],
};

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

function deduplicateById<T extends { id?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id) {
      result.push(item);
      continue;
    }
    if (!seen.has(id)) {
      seen.add(id);
      result.push(item);
    }
  }
  return result;
}

function normalizeTaskItem(raw: unknown): TaskItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id.trim() || typeof r.title !== 'string') return null;

  const subtasks = Array.isArray(r.subtasks)
    ? r.subtasks
        .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object'))
        .map((s, idx) => ({
          id: typeof s.id === 'string' && s.id ? s.id : `sub-${idx}`,
          title: typeof s.title === 'string' ? s.title : '',
          completed: Boolean(s.completed),
        }))
        .filter((s) => s.title.trim().length > 0)
    : [];

  return {
    id: r.id.trim(),
    title: r.title,
    description: typeof r.description === 'string' ? r.description : undefined,
    dueDate: typeof r.dueDate === 'string' ? r.dueDate : formatLocalDateIso(),
    dueTime: typeof r.dueTime === 'string' && r.dueTime ? r.dueTime : undefined,
    priority: r.priority === 'high' || r.priority === 'low' ? r.priority : 'medium',
    category:
      r.category === 'trabalho' ||
      r.category === 'pessoal' ||
      r.category === 'saude' ||
      r.category === 'estudos' ||
      r.category === 'financas'
        ? r.category
        : 'outros',
    completed: Boolean(r.completed),
    completedAt: typeof r.completedAt === 'string' ? r.completedAt : undefined,
    subtasks,
    linkedEventId:
      typeof r.linkedEventId === 'string'
        ? r.linkedEventId
        : typeof r.googleCalendarEventId === 'string'
        ? r.googleCalendarEventId
        : undefined,
    reminderMinutesBefore:
      typeof r.reminderMinutesBefore === 'number' && Number.isFinite(r.reminderMinutesBefore)
        ? r.reminderMinutesBefore
        : undefined,
  };
}

function normalizeTransaction(raw: unknown): Transaction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id.trim() || typeof r.title !== 'string') return null;
  const amount = Number(r.amount);
  if (!Number.isFinite(amount)) return null;

  return {
    id: r.id.trim(),
    type: r.type === 'receita' ? 'receita' : 'despesa',
    title: r.title,
    amount,
    category:
      r.category === 'salario' ||
      r.category === 'investimentos' ||
      r.category === 'freelance' ||
      r.category === 'moradia' ||
      r.category === 'alimentacao' ||
      r.category === 'transporte' ||
      r.category === 'saude' ||
      r.category === 'educacao' ||
      r.category === 'lazer'
        ? r.category
        : 'outros',
    date: typeof r.date === 'string' ? r.date : formatLocalDateIso(),
    paymentMethod:
      r.paymentMethod === 'pix' ||
      r.paymentMethod === 'cartao_credito' ||
      r.paymentMethod === 'cartao_debito' ||
      r.paymentMethod === 'dinheiro' ||
      r.paymentMethod === 'transferencia'
        ? r.paymentMethod
        : undefined,
    notes: typeof r.notes === 'string' ? r.notes : undefined,
    recurring: typeof r.recurring === 'boolean' ? r.recurring : undefined,
  };
}

function normalizeGoal(raw: unknown): FinancialGoal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id.trim() || typeof r.title !== 'string') return null;
  const targetAmount = Number(r.targetAmount);
  const currentAmount = Number(r.currentAmount);
  if (!Number.isFinite(targetAmount) || !Number.isFinite(currentAmount)) return null;

  return {
    id: r.id.trim(),
    title: r.title,
    targetAmount,
    currentAmount,
    targetDate: typeof r.targetDate === 'string' ? r.targetDate : '',
    category: typeof r.category === 'string' ? r.category : 'outros',
    color: typeof r.color === 'string' ? r.color : undefined,
  };
}

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
          durationSec:
            typeof aud.durationSec === 'number' && Number.isFinite(aud.durationSec) ? aud.durationSec : 0,
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
  return deduplicateById(
    raw
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
            : ('commemorative' as const),
        notes: typeof item.notes === 'string' ? item.notes : undefined,
        recurringYearly: item.recurringYearly !== false,
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      }))
  );
}

function normalizeLocalEvent(raw: unknown): LocalCalendarEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id.trim() || typeof r.summary !== 'string') return null;

  const rawStart =
    r.start && typeof r.start === 'object' ? (r.start as Record<string, unknown>) : null;
  const startDate = rawStart && typeof rawStart.date === 'string' ? rawStart.date : undefined;
  const startDateTime =
    rawStart && typeof rawStart.dateTime === 'string' ? rawStart.dateTime : undefined;
  if (!startDate && !startDateTime) return null;

  const rawEnd = r.end && typeof r.end === 'object' ? (r.end as Record<string, unknown>) : null;
  const endDate = rawEnd && typeof rawEnd.date === 'string' ? rawEnd.date : startDate;
  const endDateTime =
    rawEnd && typeof rawEnd.dateTime === 'string' ? rawEnd.dateTime : startDateTime;

  const source: LocalCalendarEvent['source'] =
    r.source === 'ics_import'
      ? 'ics_import'
      : r.source === 'brazil_holiday'
      ? 'brazil_holiday'
      : r.source === 'local_special'
      ? 'local_special'
      : 'local';

  return {
    id: r.id.trim(),
    summary: r.summary,
    description: typeof r.description === 'string' ? r.description : undefined,
    location: typeof r.location === 'string' ? r.location : undefined,
    start: startDateTime ? { dateTime: startDateTime } : { date: startDate },
    end: endDateTime ? { dateTime: endDateTime } : { date: endDate },
    status: typeof r.status === 'string' ? r.status : 'confirmed',
    calendarId: typeof r.calendarId === 'string' ? r.calendarId : undefined,
    calendarSummary: typeof r.calendarSummary === 'string' ? r.calendarSummary : 'Agenda Local',
    eventCategory:
      r.eventCategory === 'holiday' ||
      r.eventCategory === 'commemorative' ||
      r.eventCategory === 'birthday'
        ? r.eventCategory
        : 'event',
    source,
    editable: typeof r.editable === 'boolean' ? r.editable : source === 'local' || source === 'ics_import',
    recurringYearly: typeof r.recurringYearly === 'boolean' ? r.recurringYearly : undefined,
    specialDateId: typeof r.specialDateId === 'string' ? r.specialDateId : undefined,
    externalUid: typeof r.externalUid === 'string' ? r.externalUid : undefined,
  };
}

const VALID_SOURCE_KINDS = new Set<BankCaptureSourceKind>([
  'bank',
  'wallet',
  'sms',
  'manual_app',
  'scheduled_rule',
  'manual_paste',
]);

const VALID_CAPTURE_CATEGORIES = new Set<FinanceCategory>([
  'alimentacao',
  'transporte',
  'moradia',
  'saude',
  'lazer',
  'educacao',
  'salario',
  'freelance',
  'investimentos',
  'outros',
]);

function normalizeManualCaptureApps(raw: unknown): ManualCaptureAppRule[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: ManualCaptureAppRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const pkg = String(obj.packageName || '').trim().slice(0, 160);
    if (!pkg || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(pkg) || seen.has(pkg)) continue;
    seen.add(pkg);
    const label = String(obj.label || pkg).trim().slice(0, 80) || pkg;
    result.push({
      packageName: pkg,
      label,
      enabled: obj.enabled !== false,
      addedAt: typeof obj.addedAt === 'string' && obj.addedAt.trim() ? obj.addedAt : new Date().toISOString(),
    });
  }
  return result.slice(0, 80);
}

export function normalizeBankCaptureSettings(raw: unknown): BankCaptureSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_BANK_CAPTURE_SETTINGS, manualApps: [] };
  }
  const obj = raw as Record<string, unknown>;
  return {
    captureBanksEnabled: obj.captureBanksEnabled !== false,
    captureWalletEnabled: obj.captureWalletEnabled !== false,
    captureSmsEnabled: obj.captureSmsEnabled !== false,
    captureScheduledMessagesEnabled: obj.captureScheduledMessagesEnabled !== false,
    manualApps: normalizeManualCaptureApps(obj.manualApps),
  };
}

export function normalizeScheduledValueMessages(raw: unknown): ScheduledValueMessage[] {
  if (!Array.isArray(raw)) return [];
  const result: ScheduledValueMessage[] = [];
  const seenIds = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : '';
    const title = String(obj.title || '').trim().slice(0, 120);
    const amount = Number(obj.amount);
    if (!id || seenIds.has(id) || !title || !Number.isFinite(amount) || amount <= 0) continue;
    seenIds.add(id);

    const frequency = obj.frequency === 'once' ? 'once' : 'monthly';
    const rawDay = Number(obj.dayOfMonth);
    const dayOfMonth =
      frequency === 'monthly'
        ? Math.max(1, Math.min(31, Number.isFinite(rawDay) ? Math.round(rawDay) : 5))
        : undefined;
    const specificDate =
      frequency === 'once' && typeof obj.specificDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.specificDate)
        ? obj.specificDate
        : frequency === 'once'
        ? formatLocalDateIso()
        : undefined;
    const timeRaw = typeof obj.timeOfDay === 'string' ? obj.timeOfDay.trim() : '09:00';
    const timeOfDay = /^([01]\d|2[0-3]):[0-5]\d$/.test(timeRaw) ? timeRaw : '09:00';
    const category =
      typeof obj.category === 'string' && VALID_CAPTURE_CATEGORIES.has(obj.category as FinanceCategory)
        ? (obj.category as FinanceCategory)
        : 'outros';

    result.push({
      id,
      title,
      messageText: String(obj.messageText || `${title} R$ ${amount.toFixed(2).replace('.', ',')}`)
        .trim()
        .slice(0, 280),
      amount: Math.round(amount * 100) / 100,
      type: obj.type === 'receita' ? 'receita' : 'despesa',
      category,
      paymentMethod:
        obj.paymentMethod === 'pix' ||
        obj.paymentMethod === 'cartao_credito' ||
        obj.paymentMethod === 'cartao_debito' ||
        obj.paymentMethod === 'dinheiro' ||
        obj.paymentMethod === 'transferencia'
          ? obj.paymentMethod
          : 'pix',
      frequency,
      dayOfMonth,
      specificDate,
      timeOfDay,
      enabled: obj.enabled !== false,
      lastTriggeredKey:
        typeof obj.lastTriggeredKey === 'string' && obj.lastTriggeredKey.trim()
          ? obj.lastTriggeredKey.trim().slice(0, 20)
          : undefined,
      createdAt:
        typeof obj.createdAt === 'string' && obj.createdAt.trim()
          ? obj.createdAt
          : new Date().toISOString(),
    });
  }
  return result.slice(0, 120);
}

function normalizePendingBankNotification(raw: unknown): PendingBankNotification | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const n = raw as Record<string, unknown>;
  if (typeof n.id !== 'string' || !n.id.trim()) return null;
  const amount = Number(n.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const category =
    typeof n.category === 'string' && VALID_CAPTURE_CATEGORIES.has(n.category as FinanceCategory)
      ? (n.category as FinanceCategory)
      : 'outros';

  return {
    id: n.id.trim(),
    signature: typeof n.signature === 'string' && n.signature.trim() ? n.signature : n.id.trim(),
    bankName: typeof n.bankName === 'string' && n.bankName.trim() ? n.bankName.trim() : 'Banco',
    rawText: typeof n.rawText === 'string' ? n.rawText : '',
    title: typeof n.title === 'string' && n.title.trim() ? n.title.trim() : 'Transação Bancária',
    amount: Math.round(amount * 100) / 100,
    type: n.type === 'receita' ? 'receita' : 'despesa',
    category,
    paymentMethod:
      n.paymentMethod === 'pix' ||
      n.paymentMethod === 'cartao_credito' ||
      n.paymentMethod === 'cartao_debito' ||
      n.paymentMethod === 'dinheiro' ||
      n.paymentMethod === 'transferencia'
        ? n.paymentMethod
        : 'transferencia',
    date:
      typeof n.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(n.date)
        ? n.date.slice(0, 10)
        : formatLocalDateIso(),
    receivedAt: typeof n.receivedAt === 'string' ? n.receivedAt : new Date().toISOString(),
    source: n.source === 'manual' ? 'manual' : 'android',
    sourceKind:
      typeof n.sourceKind === 'string' && VALID_SOURCE_KINDS.has(n.sourceKind as BankCaptureSourceKind)
        ? (n.sourceKind as BankCaptureSourceKind)
        : undefined,
    packageName:
      typeof n.packageName === 'string' && n.packageName.trim()
        ? n.packageName.trim().slice(0, 160)
        : undefined,
    isScheduled: typeof n.isScheduled === 'boolean' ? n.isScheduled : undefined,
    scheduledLabel:
      typeof n.scheduledLabel === 'string' && n.scheduledLabel.trim()
        ? n.scheduledLabel.trim().slice(0, 60)
        : undefined,
  };
}

/**
 * Deterministic 32-bit FNV-1a checksum hex string for quick payload integrity detection
 */
export function computePayloadChecksum(serialized: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < serialized.length; i++) {
    hash ^= serialized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function computeStableContentChecksum(payload: AppDataPayload): string {
  const { lastUpdated: _ignoredTimestamp, ...stableFields } = payload;
  return computePayloadChecksum(JSON.stringify(stableFields));
}

export function serializeAppPayloadSafely(payload: AppDataPayload): {
  json: string;
  checksum: string;
  contentChecksum: string;
  byteSize: number;
} {
  const json = JSON.stringify(payload);
  const checksum = computePayloadChecksum(json);
  const contentChecksum = computeStableContentChecksum(payload);
  const byteSize =
    typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json).length : json.length;
  return { json, checksum, contentChecksum, byteSize };
}

export function sanitizeLegacyPayload(parsed: unknown): Partial<AppDataPayload> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const record = parsed as Record<string, unknown>;
  // Backward compatibility: support v1/v2/v3 payloads (removing legacy seed items if version < 3)
  const isPreSanitizedSeedVersion =
    typeof record.version !== 'number' || record.version < 3;

  const rawTasks = deduplicateById(
    Array.isArray(record.tasks)
      ? record.tasks.map(normalizeTaskItem).filter((t): t is TaskItem => t !== null)
      : []
  );
  const rawTxs = deduplicateById(
    Array.isArray(record.transactions)
      ? record.transactions.map(normalizeTransaction).filter((tx): tx is Transaction => tx !== null)
      : []
  );
  const rawGoals = deduplicateById(
    Array.isArray(record.financialGoals)
      ? record.financialGoals.map(normalizeGoal).filter((g): g is FinancialGoal => g !== null)
      : []
  );
  const rawBudgets: BudgetLimit[] = Array.isArray(record.budgetLimits)
    ? (record.budgetLimits as BudgetLimit[]).filter(
        (b) => b && typeof b === 'object' && typeof b.category === 'string' && Number.isFinite(b.monthlyLimit)
      )
    : [];
  const rawDrafts = deduplicateById(
    Array.isArray(record.draftNotes)
      ? record.draftNotes.map(normalizeDraftNote).filter((d): d is DraftNote => d !== null)
      : []
  );
  const specialDates = normalizeSpecialDates(record.specialDates);
  const events = deduplicateById(
    Array.isArray(record.events)
      ? record.events.map(normalizeLocalEvent).filter((e): e is LocalCalendarEvent => e !== null)
      : []
  );
  const dashboardWidgets = Array.isArray(record.dashboardWidgets)
    ? (record.dashboardWidgets.filter((w): w is string => typeof w === 'string') as string[])
    : DEFAULT_WIDGETS;
  const pendingBankNotifications: PendingBankNotification[] = Array.isArray(
    record.pendingBankNotifications
  )
    ? deduplicateById(
        record.pendingBankNotifications
          .map(normalizePendingBankNotification)
          .filter((item): item is PendingBankNotification => item !== null)
      )
    : [];
  const bankCaptureSettings =
    record.bankCaptureSettings !== undefined
      ? normalizeBankCaptureSettings(record.bankCaptureSettings)
      : undefined;
  const scheduledValueMessages = Array.isArray(record.scheduledValueMessages)
    ? deduplicateById(normalizeScheduledValueMessages(record.scheduledValueMessages))
    : undefined;

  if (!isPreSanitizedSeedVersion) {
    return {
      version: typeof record.version === 'number' ? record.version : CURRENT_DATA_VERSION,
      lastUpdated: typeof record.lastUpdated === 'string' ? record.lastUpdated : undefined,
      userName: typeof record.userName === 'string' ? record.userName : '',
      onboardingCompleted: Boolean(record.onboardingCompleted),
      tasks: rawTasks,
      events,
      transactions: rawTxs,
      financialGoals: rawGoals,
      budgetLimits: rawBudgets,
      draftNotes: rawDrafts,
      specialDates,
      dashboardWidgets,
      pendingBankNotifications,
      bankCaptureSettings,
      scheduledValueMessages,
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
    version: CURRENT_DATA_VERSION,
    lastUpdated: typeof record.lastUpdated === 'string' ? record.lastUpdated : undefined,
    userName: typeof record.userName === 'string' ? record.userName : '',
    onboardingCompleted: Boolean(record.onboardingCompleted),
    tasks,
    events,
    transactions,
    financialGoals,
    budgetLimits,
    draftNotes,
    specialDates,
    dashboardWidgets,
    pendingBankNotifications,
    bankCaptureSettings,
    scheduledValueMessages,
  };
}
