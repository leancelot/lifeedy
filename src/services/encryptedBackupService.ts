import { Capacitor } from '@capacitor/core';
import { AppDataPayload } from '../types';
import { validateAndParseBackupJson } from '../utils/runtimeValidator';
import { shareNativeTextFile } from './appHealthBridge';

export const ENCRYPTED_BACKUP_FORMAT = 'lifeedy-encrypted-backup' as const;
export const ENCRYPTED_BACKUP_VERSION = 1 as const;
const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface EncryptedBackupEnvelope {
  format: typeof ENCRYPTED_BACKUP_FORMAT;
  version: number;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  cipher: 'AES-256-GCM';
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64
  exportedAt: string;
  appVersion?: string;
}

export type DetectedBackupFormat = 'encrypted' | 'legacy_json' | 'invalid';

export interface EncryptedBackupMetadata {
  exportedAt: string | null;
  appVersion: string | null;
  iterations: number;
}

function getWebCrypto(): Crypto {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    return globalThis.crypto;
  }
  throw new Error('Criptografia Web Crypto indisponível neste ambiente.');
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function isEncryptedEnvelopeObject(raw: unknown): raw is EncryptedBackupEnvelope {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  return (
    r.format === ENCRYPTED_BACKUP_FORMAT &&
    typeof r.salt === 'string' &&
    typeof r.iv === 'string' &&
    typeof r.ciphertext === 'string' &&
    typeof r.iterations === 'number'
  );
}

export function detectBackupFormat(rawText: string): DetectedBackupFormat {
  if (typeof rawText !== 'string' || !rawText.trim()) return 'invalid';
  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'invalid';
    if (isEncryptedEnvelopeObject(parsed)) return 'encrypted';
    const record = parsed as Record<string, unknown>;
    if (
      Array.isArray(record.tasks) ||
      Array.isArray(record.transactions) ||
      Array.isArray(record.draftNotes) ||
      Array.isArray(record.events) ||
      typeof record.version === 'number'
    ) {
      return 'legacy_json';
    }
    return 'invalid';
  } catch {
    return 'invalid';
  }
}

export function inspectEncryptedBackupMetadata(rawText: string): EncryptedBackupMetadata | null {
  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (!isEncryptedEnvelopeObject(parsed)) return null;
    return {
      exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null,
      appVersion: typeof parsed.appVersion === 'string' ? parsed.appVersion : null,
      iterations: Number(parsed.iterations) || PBKDF2_ITERATIONS,
    };
  } catch {
    return null;
  }
}

async function deriveAesGcmKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
  usage: KeyUsage[]
): Promise<CryptoKey> {
  const cryptoApi = getWebCrypto();
  const encoder = new TextEncoder();
  const baseKey = await cryptoApi.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return cryptoApi.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    usage
  );
}

export async function encryptBackupPayload(
  payload: AppDataPayload,
  password: string,
  appVersion?: string
): Promise<string> {
  const cleanPassword = password.trim();
  if (cleanPassword.length < 4) {
    throw new Error('Defina uma senha com pelo menos 4 caracteres para proteger o backup.');
  }

  const cryptoApi = getWebCrypto();
  const salt = cryptoApi.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = cryptoApi.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveAesGcmKey(cleanPassword, salt, PBKDF2_ITERATIONS, ['encrypt']);

  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const encryptedBuffer = await cryptoApi.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer,
    },
    key,
    plaintext
  );

  const envelope: EncryptedBackupEnvelope = {
    format: ENCRYPTED_BACKUP_FORMAT,
    version: ENCRYPTED_BACKUP_VERSION,
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    cipher: 'AES-256-GCM',
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encryptedBuffer)),
    exportedAt: new Date().toISOString(),
    ...(appVersion ? { appVersion } : {}),
  };

  return JSON.stringify(envelope, null, 2);
}

export async function decryptBackupEnvelope(
  rawText: string,
  password: string
): Promise<{ payload: Partial<AppDataPayload>; checksum: string; exportedAt: string | null }> {
  const cleanPassword = password.trim();
  if (!cleanPassword) {
    throw new Error('Digite a senha para descriptografar este backup.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('Arquivo de backup inválido ou corrompido.');
  }

  if (!isEncryptedEnvelopeObject(parsed)) {
    throw new Error('Este arquivo não é um backup cifrado válido do Lifeedy.');
  }

  if (parsed.version !== ENCRYPTED_BACKUP_VERSION) {
    throw new Error(`Versão de backup cifrado não suportada (${String(parsed.version)}).`);
  }

  const iterations = Math.max(10_000, Math.min(2_000_000, Number(parsed.iterations) || PBKDF2_ITERATIONS));
  let salt: Uint8Array;
  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  try {
    salt = base64ToBytes(parsed.salt);
    iv = base64ToBytes(parsed.iv);
    ciphertext = base64ToBytes(parsed.ciphertext);
  } catch {
    throw new Error('Dados criptográficos do backup estão corrompidos.');
  }

  if (salt.length < 8 || iv.length !== IV_BYTES || ciphertext.length === 0) {
    throw new Error('Cabeçalho criptográfico do backup inválido.');
  }

  const cryptoApi = getWebCrypto();
  const key = await deriveAesGcmKey(cleanPassword, salt, iterations, ['decrypt']);

  let decryptedBuffer: ArrayBuffer;
  try {
    decryptedBuffer = await cryptoApi.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer,
      },
      key,
      ciphertext.buffer.slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength) as ArrayBuffer
    );
  } catch {
    throw new Error('Senha incorreta ou arquivo adulterado.');
  }

  const decryptedJson = new TextDecoder().decode(decryptedBuffer);
  const validation = validateAndParseBackupJson(decryptedJson);
  if (!validation.ok || !validation.data) {
    throw new Error(validation.error || 'O conteúdo descriptografado do backup está inválido.');
  }

  return {
    payload: validation.data.payload,
    checksum: validation.data.checksum,
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null,
  };
}

export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareOrDownloadTextFile(options: {
  fileName: string;
  content: string;
  mimeType: string;
  chooserTitle?: string;
  preferShare?: boolean;
}): Promise<'native_share' | 'web_share' | 'download'> {
  const { fileName, content, mimeType, chooserTitle, preferShare = false } = options;

  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    const shared = await shareNativeTextFile({
      fileName,
      content,
      mimeType,
      chooserTitle,
    });
    if (shared) return 'native_share';
  }

  if (
    preferShare &&
    typeof navigator !== 'undefined' &&
    typeof File !== 'undefined' &&
    typeof navigator.share === 'function'
  ) {
    try {
      const file = new File([content], fileName, { type: mimeType });
      const canShareFiles =
        typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] });
      if (canShareFiles) {
        await navigator.share({
          files: [file],
          title: fileName,
        });
        return 'web_share';
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw err;
      }
      // fallback to standard download
    }
  }

  downloadTextFile(fileName, content, mimeType);
  return 'download';
}
