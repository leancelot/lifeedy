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
  googleCalendarEventId?: string;
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

export interface GoogleCalendarEvent {
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
  htmlLink?: string;
  status?: string;
  calendarId?: string;
  calendarSummary?: string;
  eventCategory?: CalendarEventCategory;
  source?: 'google' | 'brazil_holiday' | 'local_special';
  editable?: boolean;
  recurringYearly?: boolean;
  specialDateId?: string;
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

export interface DriveSyncInfo {
  fileId: string | null;
  lastSyncedAt: string | null;
  remoteModifiedAt: string | null;
  status: 'idle' | 'syncing' | 'synced' | 'error' | 'cloud_newer';
  errorMessage?: string;
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
}

export interface AppDataPayload {
  version: number;
  lastUpdated: string;
  userName?: string;
  onboardingCompleted?: boolean;
  tasks: TaskItem[];
  transactions: Transaction[];
  financialGoals: FinancialGoal[];
  budgetLimits: BudgetLimit[];
  draftNotes: DraftNote[];
  specialDates?: LocalSpecialDate[];
  dashboardWidgets?: string[];
  pendingBankNotifications?: PendingBankNotification[];
  habits?: any[]; // Kept for backwards compatibility with existing backups
}
