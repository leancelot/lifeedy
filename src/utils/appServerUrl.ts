export const APP_SERVER_URL_STORAGE_KEY = 'lifeedy_server_url_v1';

export interface AppServerUrlValidation {
  ok: boolean;
  url?: string;
  error?: string;
}

function getSafeStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
    return null;
  } catch {
    return null;
  }
}

export function validateAppServerUrl(raw: string): AppServerUrlValidation {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return { ok: false, error: 'Informe a URL do servidor (ex: https://seu-app.run.app).' };
  }

  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) {
    return { ok: false, error: 'Esquema de URL não permitido.' };
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ok: false, error: 'Use um endereço https:// válido.' };
    }
    const isLocalHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol === 'http:' && !isLocalHost) {
      return { ok: false, error: 'Para servidores externos, use sempre https://.' };
    }
    if (!parsed.hostname || !parsed.hostname.includes('.') && !isLocalHost) {
      return { ok: false, error: 'Endereço de servidor inválido.' };
    }
    return { ok: true, url: parsed.origin };
  } catch {
    return { ok: false, error: 'URL inválida. Exemplo: https://seu-app.run.app' };
  }
}

export function getBuiltInAppServerUrl(): string {
  const raw = ((import.meta as any).env?.VITE_APP_URL as string | undefined) || '';
  if (!raw.trim()) return '';
  const check = validateAppServerUrl(raw);
  return check.ok && check.url ? check.url : '';
}

export function getCustomAppServerUrl(): string {
  try {
    const raw = getSafeStorage()?.getItem(APP_SERVER_URL_STORAGE_KEY) || '';
    if (!raw.trim()) return '';
    const check = validateAppServerUrl(raw);
    return check.ok && check.url ? check.url : '';
  } catch {
    return '';
  }
}

export function getConfiguredAppServerUrl(): string {
  return getCustomAppServerUrl() || getBuiltInAppServerUrl();
}

export function saveCustomAppServerUrl(raw: string): AppServerUrlValidation {
  const check = validateAppServerUrl(raw);
  if (!check.ok || !check.url) return check;
  try {
    getSafeStorage()?.setItem(APP_SERVER_URL_STORAGE_KEY, check.url);
  } catch {
    return { ok: false, error: 'Não foi possível salvar a URL neste aparelho.' };
  }
  return check;
}

export function clearCustomAppServerUrl(): void {
  try {
    getSafeStorage()?.removeItem(APP_SERVER_URL_STORAGE_KEY);
  } catch {
    // ignore
  }
}
