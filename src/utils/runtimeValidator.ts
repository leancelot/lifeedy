import { recordAppError } from '../services/errorJournalService';
import { AppDataPayload } from '../types';
import { computePayloadChecksum, sanitizeLegacyPayload } from './storageSanitizer';

export const MAX_BACKUP_BYTES = 16 * 1024 * 1024;
export const MAX_RECEIPT_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_IMPORT_COLLECTION_ITEMS = 15_000;

const ALLOWED_RECEIPT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const ALLOWED_RECEIPT_EXTENSIONS = /\.(jpe?g|png|webp|heic|heif)$/i;
const GITHUB_REPO_SLUG_REGEX = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface ValidationResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

export function validateGitHubRepoSlug(repo: string): ValidationResult<string> {
  const trimmed = String(repo || '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');

  if (!GITHUB_REPO_SLUG_REGEX.test(trimmed)) {
    return {
      ok: false,
      error: 'Repositório GitHub inválido. Informe no formato proprietario/repositorio.',
    };
  }
  return { ok: true, data: trimmed };
}

export function validateGitHubUpdateUrl(rawUrl: string): ValidationResult<string> {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    return { ok: false, error: 'URL de atualização ausente.' };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') {
      recordAppError('runtimeValidator.updateUrl', 'Protocolo não-HTTPS bloqueado', parsed.protocol);
      return {
        ok: false,
        error: 'Atualização bloqueada por segurança: apenas links HTTPS são permitidos.',
      };
    }

    const host = parsed.hostname.toLowerCase();
    const isGitHubHost =
      host === 'github.com' ||
      host === 'api.github.com' ||
      host === 'githubusercontent.com' ||
      host.endsWith('.github.com') ||
      host.endsWith('.githubusercontent.com');

    if (!isGitHubHost) {
      recordAppError('runtimeValidator.updateUrl', 'Domínio de atualização não autorizado bloqueado', host);
      return {
        ok: false,
        error: 'Origem de atualização bloqueada por segurança: permitido apenas GitHub oficial.',
      };
    }

    return { ok: true, data: parsed.toString() };
  } catch {
    return { ok: false, error: 'Formato de URL de atualização inválido.' };
  }
}

export function validateReceiptImageFile(file: {
  name?: string;
  type?: string;
  size?: number;
}): ValidationResult {
  const size = Number(file?.size ?? 0);
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: 'Arquivo de imagem vazio ou corrompido.' };
  }

  if (size > MAX_RECEIPT_FILE_BYTES) {
    return {
      ok: false,
      error: 'Imagem muito grande (máximo 15 MB). Recorte ou selecione uma foto menor.',
    };
  }

  const mime = String(file?.type || '').toLowerCase().trim();
  const name = String(file?.name || '').trim();

  if (mime) {
    if (!ALLOWED_RECEIPT_MIME_TYPES.has(mime)) {
      recordAppError('runtimeValidator.receiptUpload', 'MIME não permitido bloqueado', mime);
      return {
        ok: false,
        error: 'Formato não suportado. Envie uma imagem JPG, PNG, WEBP ou HEIC.',
      };
    }
    return { ok: true };
  }

  if (name && !ALLOWED_RECEIPT_EXTENSIONS.test(name)) {
    recordAppError('runtimeValidator.receiptUpload', 'Extensão de arquivo bloqueada', name);
    return {
      ok: false,
      error: 'Extensão de arquivo não permitida. Use fotos JPG, PNG ou WEBP.',
    };
  }

  return { ok: true };
}

function stripDangerousKeys(value: unknown, depth = 0): unknown {
  if (depth > 12 || value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => stripDangerousKeys(item, depth + 1));
  }

  const cleanObj: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    cleanObj[key] = stripDangerousKeys((value as Record<string, unknown>)[key], depth + 1);
  }
  return cleanObj;
}

export function validateAndParseBackupJson(rawText: string): ValidationResult<{
  payload: Partial<AppDataPayload>;
  checksum: string;
}> {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return { ok: false, error: 'O arquivo de backup está vazio.' };
  }

  if (rawText.length > MAX_BACKUP_BYTES) {
    recordAppError('runtimeValidator.backupImport', 'Backup excedeu tamanho máximo');
    return { ok: false, error: 'Arquivo de backup excede o limite seguro de 16 MB.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    recordAppError('runtimeValidator.backupImport', 'JSON de backup malformado rejeitado');
    return { ok: false, error: 'Arquivo inválido: o conteúdo não é um JSON válido.' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Estrutura de backup inválida: objeto principal esperado.' };
  }

  const rawRecord = parsed as Record<string, unknown>;
  const collectionKeys = [
    'tasks',
    'events',
    'transactions',
    'financialGoals',
    'budgetLimits',
    'draftNotes',
    'pendingBankNotifications',
    'scheduledValueMessages',
  ];

  for (const key of collectionKeys) {
    const val = rawRecord[key];
    if (val !== undefined) {
      if (!Array.isArray(val)) {
        return {
          ok: false,
          error: `Estrutura de backup inválida no campo "${key}".`,
        };
      }
      if (val.length > MAX_IMPORT_COLLECTION_ITEMS) {
        return {
          ok: false,
          error: `Backup rejeitado: quantidade excessiva de itens em "${key}".`,
        };
      }
    }
  }

  const cleanObject = stripDangerousKeys(rawRecord) as Record<string, unknown>;
  const payload = sanitizeLegacyPayload(cleanObject);
  const checksum = computePayloadChecksum(JSON.stringify(payload));

  return {
    ok: true,
    data: { payload, checksum },
  };
}
