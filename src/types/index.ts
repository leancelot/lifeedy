export interface TaskItem {
  id: string;
  title: string;
  description?: string;
  dueDate: string; // YYYY-MM-DD
  dueTime?: string; // HH:mm
  priority: 'high' | 'medium' | 'low';
  category: 'trabalho' | 'pessoal' | 'saude' | 'estudos' | 'financas' | 'outros';
  completed: boolean;
  completedAt?: string;
  subtasks: { id: string; title: string; completed: boolean }[];
  linkedEventId?: string;
  reminderMinutesBefore?: number; // e.g. 15, 30, 60 or 0
}

export type TransactionType = 'receita' | 'despesa';

export type FinanceCategory =
  | 'salario'
  | 'investimentos'
  | 'freelance'
  | 'moradia'
  | 'alimentacao'
  | 'transporte'
  | 'saude'
  | 'educacao'
  | 'lazer'
  | 'outros';

export interface Transaction {
  id: string;
  type: TransactionType;
  title: string;
  amount: number;
  category: FinanceCategory;
  date: string; // YYYY-MM-DD
  paymentMethod?: 'pix' | 'cartao_credito' | 'cartao_debito' | 'dinheiro' | 'transferencia';
  notes?: string;
  recurring?: boolean;
}

export interface FinancialGoal {
  id: string;
  title: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string;
  category: string;
  color?: string;
}

export interface BudgetLimit {
  category: FinanceCategory;
  monthlyLimit: number;
}

export interface DraftChecklistItem {
  id: string;
  text: string;
  completed: boolean;
}

export interface DraftImageAttachment {
  id: string;
  dataUrl: string;
  caption?: string;
  width?: number;
  height?: number;
}

export interface DraftAudioAttachment {
  id: string;
  dataUrl: string;
  mimeType: string;
  durationSec: number;
  createdAt: string;
}

export type DraftKind = 'text' | 'list' | 'media' | 'mixed';

export interface DraftNote {
  id: string;
  title: string;
  content: string;
  kind?: DraftKind;
  checklistItems?: DraftChecklistItem[];
  images?: DraftImageAttachment[];
  audios?: DraftAudioAttachment[];
  color?: string;
  updatedAt: string;
  isPinned?: boolean;
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  timestamp: string;
  type: 'task_deadline' | 'calendar_event' | 'reminder';
  read: boolean;
}

export type CalendarEventCategory = 'event' | 'holiday' | 'commemorative' | 'birthday';

export interface LocalCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string;
    date?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
  };
  status?: string;
  calendarId?: string;
  calendarSummary?: string;
  eventCategory?: CalendarEventCategory;
  source?: 'local' | 'ics_import' | 'brazil_holiday' | 'local_special';
  editable?: boolean;
  recurringYearly?: boolean;
  specialDateId?: string;
  externalUid?: string;
}

export interface LocalSpecialDate {
  id: string;
  title: string;
  monthDay: string; // MM-DD (recurringYearly=true) or YYYY-MM-DD (recurringYearly=false)
  category: 'birthday' | 'commemorative' | 'holiday';
  notes?: string;
  recurringYearly: boolean;
  createdAt: string;
}

export type BankCaptureSourceKind =
  | 'bank'
  | 'wallet'
  | 'sms'
  | 'manual_app'
  | 'scheduled_rule'
  | 'manual_paste';

export interface ManualCaptureAppRule {
  packageName: string;
  label: string;
  enabled: boolean;
  addedAt: string;
}

export interface ScheduledValueMessage {
  id: string;
  title: string;
  messageText: string;
  amount: number;
  type: TransactionType;
  category: FinanceCategory;
  paymentMethod?: Transaction['paymentMethod'];
  frequency: 'monthly' | 'once';
  dayOfMonth?: number; // 1..31 when frequency === 'monthly'
  specificDate?: string; // YYYY-MM-DD when frequency === 'once'
  timeOfDay: string; // HH:mm
  enabled: boolean;
  lastTriggeredKey?: string; // YYYY-MM or YYYY-MM-DD
  createdAt: string;
}

export interface BankCaptureSettings {
  captureBanksEnabled: boolean;
  captureWalletEnabled: boolean;
  captureSmsEnabled: boolean;
  captureScheduledMessagesEnabled: boolean;
  manualApps: ManualCaptureAppRule[];
}

export interface PendingBankNotification {
  id: string;
  signature: string;
  bankName: string;
  rawText: string;
  title: string;
  amount: number;
  type: TransactionType;
  category: FinanceCategory;
  paymentMethod?: Transaction['paymentMethod'];
  date: string; // YYYY-MM-DD
  receivedAt: string; // ISO string
  source: 'android' | 'manual';
  sourceKind?: BankCaptureSourceKind;
  packageName?: string;
  isScheduled?: boolean;
  scheduledLabel?: string;
}

export interface AppDataPayload {
  version: number;
  lastUpdated: string;
  userName?: string;
  onboardingCompleted?: boolean;
  tasks: TaskItem[];
  events?: LocalCalendarEvent[];
  transactions: Transaction[];
  financialGoals: FinancialGoal[];
  budgetLimits: BudgetLimit[];
  draftNotes: DraftNote[];
  specialDates?: LocalSpecialDate[];
  dashboardWidgets?: string[];
  pendingBankNotifications?: PendingBankNotification[];
  bankCaptureSettings?: BankCaptureSettings;
  scheduledValueMessages?: ScheduledValueMessage[];
  habits?: any[]; // Kept for backwards compatibility with existing backups
}
