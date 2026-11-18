import { Capacitor } from '@capacitor/core';

export interface ErrorJournalEntry {
  id: string;
  timestamp: string;
  source: string;
  message: string;
  stack?: string;
  context?: string;
  platform: string;
}

const STORAGE_KEY_JOURNAL = 'vidaorganizada_error_journal_v1';
const STORAGE_KEY_AUTO_REPORT = 'vidaorganizada_auto_error_report_v1';
const MAX_JOURNAL_ENTRIES = 100;

type JournalListener = (entries: ErrorJournalEntry[]) => void;
const listeners = new Set<JournalListener>();
let globalHandlersInstalled = false;
let autoReportTimer: ReturnType<typeof setTimeout> | null = null;
let memoryJournal: ErrorJournalEntry[] = [];

/**
 * Sanitizes accidental sensitive patterns (tokens, emails, money amounts) before persisting or reporting logs
 */
export function sanitizeDiagnosticText(raw: string, maxLength = 700): string {
  if (!raw) return '';
  let text = String(raw);
  // Mask OAuth / Bearer / GitHub tokens
  text = text.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
  text = text.replace(/\b(ya29\.[A-Za-z0-9_-]+|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|AIza[A-Za-z0-9_-]+)\b/g, '[TOKEN]');
  // Mask email addresses
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]');
  // Mask BRL monetary strings
  text = text.replace(/R\$\s*[\d.,]+/gi, 'R$ [VALOR]');
  return text.slice(0, maxLength);
}

export function getErrorJournal(): ErrorJournalEntry[] {
  if (typeof localStorage === 'undefined') return [...memoryJournal];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_JOURNAL);
    if (!raw) return [...memoryJournal];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [...memoryJournal];
  } catch {
    return [...memoryJournal];
  }
}

function persistJournal(entries: ErrorJournalEntry[]): void {
  memoryJournal = entries.slice(0, MAX_JOURNAL_ENTRIES);
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_JOURNAL, JSON.stringify(memoryJournal));
  } catch {
    // Best effort: trim aggressively if storage quota is tight
    try {
      localStorage.setItem(STORAGE_KEY_JOURNAL, JSON.stringify(memoryJournal.slice(0, 20)));
    } catch {
      // ignore
    }
  }
}

function notifyListeners(entries: ErrorJournalEntry[]): void {
  listeners.forEach((cb) => {
    try {
      cb(entries);
    } catch {
      // ignore listener error
    }
  });
}

export function subscribeErrorJournal(listener: JournalListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function recordAppError(source: string, error: unknown, context?: string): ErrorJournalEntry {
  const errObj = error as { message?: unknown; stack?: unknown } | null;
  const rawMessage =
    typeof errObj?.message === 'string'
      ? errObj.message
      : typeof error === 'string'
      ? error
      : String(error || 'Erro desconhecido');

  const rawStack = typeof errObj?.stack === 'string' ? errObj.stack : '';

  const entry: ErrorJournalEntry = {
    id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    source: sanitizeDiagnosticText(source, 80) || 'app',
    message: sanitizeDiagnosticText(rawMessage, 500) || 'Erro inesperado',
    stack: rawStack ? sanitizeDiagnosticText(rawStack, 900) : undefined,
    context: context ? sanitizeDiagnosticText(context, 240) : undefined,
    platform: Capacitor.isNativePlatform() ? `android-native` : 'web',
  };

  const current = getErrorJournal();
  const next = [entry, ...current].slice(0, MAX_JOURNAL_ENTRIES);
  persistJournal(next);
  notifyListeners(next);

  if (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    navigator.onLine !== false &&
    getAutoErrorReportEnabled()
  ) {
    if (autoReportTimer) clearTimeout(autoReportTimer);
    autoReportTimer = setTimeout(() => {
      void sendDiagnosticReport({ entries: next.slice(0, 10) });
    }, 1500);
  }

  return entry;
}

export function clearErrorJournal(): void {
  memoryJournal = [];
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEY_JOURNAL);
    } catch {
      // ignore
    }
  }
  notifyListeners([]);
}

export function getAutoErrorReportEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEY_AUTO_REPORT) === 'true';
  } catch {
    return false;
  }
}

export function setAutoErrorReportEnabled(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_AUTO_REPORT, String(enabled));
  } catch {
    // ignore
  }
}

export function exportErrorJournalText(meta?: {
  appVersion?: string;
  buildNumber?: number;
  distributionChannel?: string;
}): string {
  const entries = getErrorJournal();
  const header = [
    '=== LIFEEDY - DIÁRIO DE DIAGNÓSTICO ===',
    `Data: ${new Date().toISOString()}`,
    `Versão: ${meta?.appVersion || 'desconhecida'} (Build #${meta?.buildNumber || 0})`,
    `Canal: ${meta?.distributionChannel || (Capacitor.isNativePlatform() ? 'android' : 'web')}`,
    `Total de registros: ${entries.length}`,
    '',
  ].join('\n');

  if (entries.length === 0) {
    return `${header}Nenhum erro registrado até o momento.\n`;
  }

  const lines = entries.map((item) => {
    const parts = [
      `[${item.timestamp}] (${item.platform} · ${item.source})`,
      `Mensagem: ${item.message}`,
    ];
    if (item.context) parts.push(`Contexto: ${item.context}`);
    if (item.stack) parts.push(`Stack: ${item.stack}`);
    return parts.join('\n');
  });

  return `${header}${lines.join('\n\n---\n\n')}\n`;
}

function resolveApiBaseUrl(): string {
  const configured = ((import.meta as any).env?.VITE_APP_URL as string | undefined)?.trim() || '';
  if (configured) return configured.replace(/\/+$/, '');
  if (typeof window !== 'undefined' && window.location?.origin?.startsWith('http')) {
    return window.location.origin;
  }
  return '';
}

export async function sendDiagnosticReport(options?: {
  appVersion?: string;
  buildNumber?: number;
  distributionChannel?: string;
  userNote?: string;
  entries?: ErrorJournalEntry[];
}): Promise<{ ok: boolean; reportId?: string; error?: string }> {
  const entries = (options?.entries ?? getErrorJournal()).slice(0, 25);
  const baseUrl = resolveApiBaseUrl();
  if (!baseUrl) {
    return {
      ok: false,
      error: 'Servidor de diagnóstico não configurado neste ambiente. Use o envio por e-mail ou exporte o log.',
    };
  }

  try {
    const res = await fetch(`${baseUrl}/api/diagnostics/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appVersion: options?.appVersion || 'v1.1.0',
        buildNumber: options?.buildNumber || 0,
        distributionChannel: options?.distributionChannel || 'web',
        platform: Capacitor.isNativePlatform() ? 'android' : 'web',
        userNote: options?.userNote ? sanitizeDiagnosticText(options.userNote, 400) : '',
        recentErrors: entries,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data?.error || `Falha HTTP ${res.status} ao enviar relatório.` };
    }
    return { ok: true, reportId: data?.reportId };
  } catch {
    return {
      ok: false,
      error: 'Sem conexão com o servidor no momento. Você pode exportar o log ou enviar por e-mail.',
    };
  }
}

export function buildErrorReportMailtoUrl(meta?: {
  appVersion?: string;
  buildNumber?: number;
  distributionChannel?: string;
  recipientEmail?: string;
}): string {
  const subject = encodeURIComponent(
    `[Lifeedy] Relatório de Diagnóstico (${meta?.appVersion || 'v1.1.0'} #${meta?.buildNumber || 0})`
  );
  const bodyText = exportErrorJournalText(meta).slice(0, 1800);
  const body = encodeURIComponent(bodyText);
  const to = meta?.recipientEmail || '';
  return `mailto:${to}?subject=${subject}&body=${body}`;
}

export function installGlobalErrorHandlers(): void {
  if (typeof window === 'undefined' || globalHandlersInstalled) return;
  globalHandlersInstalled = true;

  window.addEventListener('error', (event) => {
    const msg = event.message || '';
    if (msg.includes('ResizeObserver loop')) return;
    recordAppError('window.onerror', event.error || msg, event.filename ? `${event.filename}:${event.lineno}` : undefined);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = typeof reason?.message === 'string' ? reason.message : String(reason || '');
    const stack = typeof reason?.stack === 'string' ? reason.stack : '';

    if (message.includes('WebSocket closed without opened') || stack.includes('@vite/client')) {
      event.preventDefault();
      return;
    }

    recordAppError('unhandledrejection', reason);
  });
}
