import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NativeGoogleAuthAvailability {
  available: boolean;
  statusCode: number;
  sha1?: string;
}

export interface NativeGoogleAuthorizeOptions {
  scopes: string[];
  silentOnly?: boolean;
  accountEmail?: string | null;
}

export interface NativeGoogleAuthorizeResult {
  authorized: boolean;
  accessToken?: string;
  grantedScopes?: string[];
  cancelled?: boolean;
  noData?: boolean;
  sha1?: string;
  needsResolution?: boolean;
}

interface NativeGoogleAuthPluginInterface {
  isAvailable(): Promise<NativeGoogleAuthAvailability>;
  authorize(options: {
    scopes: string[];
    silentOnly?: boolean;
    accountEmail?: string;
  }): Promise<NativeGoogleAuthorizeResult>;
  clearToken(options: { token: string }): Promise<{ cleared: boolean }>;
}

const NativeGoogleAuth = registerPlugin<NativeGoogleAuthPluginInterface>('NativeGoogleAuth');

export function isNativeGoogleAuthSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function checkNativeGoogleAuthAvailability(): Promise<NativeGoogleAuthAvailability> {
  if (!isNativeGoogleAuthSupported()) {
    return { available: false, statusCode: -1 };
  }
  try {
    return await NativeGoogleAuth.isAvailable();
  } catch {
    return { available: false, statusCode: -2 };
  }
}

export async function authorizeNativeGoogle(
  options: NativeGoogleAuthorizeOptions
): Promise<NativeGoogleAuthorizeResult> {
  if (!isNativeGoogleAuthSupported()) {
    return { authorized: false };
  }

  const payload: {
    scopes: string[];
    silentOnly?: boolean;
    accountEmail?: string;
  } = {
    scopes: Array.isArray(options.scopes) ? options.scopes : [],
    silentOnly: Boolean(options.silentOnly),
  };

  if (options.accountEmail && options.accountEmail.trim()) {
    payload.accountEmail = options.accountEmail.trim();
  }

  return await NativeGoogleAuth.authorize(payload);
}

export async function clearNativeGoogleToken(token: string | null | undefined): Promise<boolean> {
  if (!isNativeGoogleAuthSupported() || !token || !token.trim()) {
    return false;
  }
  try {
    const res = await NativeGoogleAuth.clearToken({ token: token.trim() });
    return Boolean(res?.cleared);
  } catch {
    return false;
  }
}
