import { detectBackupFormat } from './encryptedBackupService';

export const STORAGE_KEY_LAST_PORTABLE_BACKUP = 'vo_last_portable_backup_at';
export const STORAGE_KEY_AUTO_BACKUP_ENABLED = 'vo_auto_folder_backup_enabled';
export const STORAGE_KEY_BACKUP_REMINDER_SNOOZED_UNTIL = 'vo_backup_reminder_snoozed_until';
export const STORAGE_KEY_AUTO_BACKUP_LAST_CHECKSUM = 'vo_auto_folder_last_checksum';

export const AUTO_BACKUP_FILENAME = 'Lifeedy_AutoBackup.lifeedy';
export const PORTABLE_BACKUP_REMINDER_DAYS = 14;

export type PortableBackupHealthLevel = 'healthy' | 'warning' | 'missing';

export interface PortableBackupHealth {
  level: PortableBackupHealthLevel;
  daysSinceLastBackup: number | null;
  lastBackupAt: string | null;
  shouldRemind: boolean;
  autoFolderReady: boolean;
}

export type IncomingFileClassification = 'ics' | 'backup' | 'invalid';

export function getLastPortableBackupAt(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LAST_PORTABLE_BACKUP);
    if (!raw) return null;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  } catch {
    return null;
  }
}

export function recordPortableBackupTimestamp(isoOrMs?: string | number): string {
  const iso =
    typeof isoOrMs === 'number'
      ? new Date(isoOrMs).toISOString()
      : typeof isoOrMs === 'string' && Number.isFinite(Date.parse(isoOrMs))
      ? new Date(isoOrMs).toISOString()
      : new Date().toISOString();

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY_LAST_PORTABLE_BACKUP, iso);
      localStorage.removeItem(STORAGE_KEY_BACKUP_REMINDER_SNOOZED_UNTIL);
    } catch {
      // ignore storage quota errors
    }
  }
  return iso;
}

export function isAutoFolderBackupEnabled(): boolean {
  if (typeof localStorage === 'undefined') return true;
  try {
    return localStorage.getItem(STORAGE_KEY_AUTO_BACKUP_ENABLED) !== 'false';
  } catch {
    return true;
  }
}

export function setAutoFolderBackupEnabled(enabled: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_AUTO_BACKUP_ENABLED, enabled ? 'true' : 'false');
  } catch {
    // ignore
  }
}

export function getBackupReminderSnoozedUntil(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BACKUP_REMINDER_SNOOZED_UNTIL);
    if (!raw) return null;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  } catch {
    return null;
  }
}

export function snoozeBackupReminder(days = 7, nowMs = Date.now()): string {
  const untilIso = new Date(nowMs + Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString();
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY_BACKUP_REMINDER_SNOOZED_UNTIL, untilIso);
    } catch {
      // ignore
    }
  }
  return untilIso;
}

export function getLastAutoFolderChecksum(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(STORAGE_KEY_AUTO_BACKUP_LAST_CHECKSUM) || null;
  } catch {
    return null;
  }
}

export function setLastAutoFolderChecksum(checksum: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_AUTO_BACKUP_LAST_CHECKSUM, checksum);
  } catch {
    // ignore
  }
}

export function clearAutoFolderChecksumStorage(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY_AUTO_BACKUP_LAST_CHECKSUM);
  } catch {
    // ignore
  }
}

export function clearBackupAuditStorage(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY_LAST_PORTABLE_BACKUP);
    localStorage.removeItem(STORAGE_KEY_BACKUP_REMINDER_SNOOZED_UNTIL);
    localStorage.removeItem(STORAGE_KEY_AUTO_BACKUP_LAST_CHECKSUM);
  } catch {
    // ignore
  }
}

export function evaluatePortableBackupHealth(params: {
  lastPortableBackupAt: string | null;
  autoFolderConfigured: boolean;
  autoFolderAccessible: boolean;
  hasAutoPassphrase: boolean;
  autoBackupEnabled: boolean;
  itemCount: number;
  snoozedUntil: string | null;
  nowMs?: number;
}): PortableBackupHealth {
  const nowMs = params.nowMs ?? Date.now();
  const autoFolderReady =
    params.autoFolderConfigured &&
    params.autoFolderAccessible &&
    params.hasAutoPassphrase &&
    params.autoBackupEnabled;

  const lastMs = params.lastPortableBackupAt ? Date.parse(params.lastPortableBackupAt) : NaN;
  const hasValidLast = Number.isFinite(lastMs);
  const daysSinceLastBackup = hasValidLast
    ? Math.max(0, Math.floor((nowMs - lastMs) / (24 * 60 * 60 * 1000)))
    : null;

  let level: PortableBackupHealthLevel = 'missing';
  if (hasValidLast && daysSinceLastBackup !== null) {
    level = daysSinceLastBackup >= PORTABLE_BACKUP_REMINDER_DAYS ? 'warning' : 'healthy';
  }

  const snoozedMs = params.snoozedUntil ? Date.parse(params.snoozedUntil) : NaN;
  const isSnoozed = Number.isFinite(snoozedMs) && snoozedMs > nowMs;

  const shouldRemind =
    params.itemCount >= 3 &&
    !isSnoozed &&
    (level === 'missing' || level === 'warning');

  return {
    level,
    daysSinceLastBackup,
    lastBackupAt: hasValidLast ? new Date(lastMs).toISOString() : null,
    shouldRemind,
    autoFolderReady,
  };
}

export function classifyIncomingFile(file: { name: string; content: string }): IncomingFileClassification {
  const cleanName = (file.name || '').trim().toLowerCase();
  const content = typeof file.content === 'string' ? file.content : '';
  const trimmed = content.trim();
  if (!trimmed) return 'invalid';

  if (
    cleanName.endsWith('.ics') ||
    trimmed.includes('BEGIN:VCALENDAR') ||
    trimmed.includes('BEGIN:VEVENT')
  ) {
    return 'ics';
  }

  const backupFormat = detectBackupFormat(trimmed);
  if (backupFormat === 'encrypted' || backupFormat === 'legacy_json') {
    return 'backup';
  }

  if (cleanName.endsWith('.lifeedy') || cleanName.endsWith('.json')) {
    return 'backup';
  }

  return 'invalid';
}
