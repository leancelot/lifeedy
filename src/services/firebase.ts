import { initializeApp, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  Auth,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithCredential,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { firebaseConfig } from '../config/firebaseConfig';
import { getConfiguredAppServerUrl } from '../utils/appServerUrl';
import {
  authorizeNativeGoogle,
  clearNativeGoogleToken,
  isNativeGoogleAuthSupported,
} from './nativeGoogleAuthBridge';

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.authDomain
);

// Initialize Firebase App only when configured
export const app: FirebaseApp | null = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
export const auth: Auth | null = app ? getAuth(app) : null;

export const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

// Non-sensitive display profile persisted for continuity across reloads / WebView restarts.
// Access tokens are NEVER stored in localStorage or sessionStorage.
const PROFILE_STORAGE_KEY = 'lifeedy_google_profile_v1';
const DEFAULT_TOKEN_TTL_SEC = 3500;

export interface PersistedUserProfile {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  source: 'firebase' | 'native_oauth';
}

// In-memory token cache ONLY (never stored in localStorage or sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;
let cachedTokenExpiresAt = 0;
let inFlightSilentRefresh: Promise<string | null> | null = null;

export interface GoogleSignInResult {
  user?: User;
  accessToken?: string;
  idToken?: string | null;
  expiresAt?: number;
  isNativeRedirect?: boolean;
  isWebRedirect?: boolean;
  cancelled?: boolean;
  noData?: boolean;
  sha1?: string;
}

export function persistUserProfile(
  user: Pick<User, 'uid' | 'displayName' | 'email' | 'photoURL'>,
  source: 'firebase' | 'native_oauth' = 'firebase'
): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const record: PersistedUserProfile = {
      uid: user.uid,
      displayName: user.displayName || null,
      email: user.email || null,
      photoURL: user.photoURL || null,
      source,
    };
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // ignore storage errors
  }
}

export function loadPersistedUserProfile(): PersistedUserProfile | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.uid === 'string' && parsed.uid) {
      return parsed as PersistedUserProfile;
    }
  } catch {
    // ignore
  }
  return null;
}

export function clearPersistedUserProfile(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(PROFILE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function persistedProfileToUser(profile: PersistedUserProfile): User {
  return {
    uid: profile.uid,
    displayName: profile.displayName,
    email: profile.email,
    photoURL: profile.photoURL,
    emailVerified: Boolean(profile.email),
  } as unknown as User;
}

export const mapGoogleAuthError = (error: unknown): string => {
  const err = error as { code?: string | number; message?: string } | null;
  const code = err?.code !== undefined && err?.code !== null ? String(err.code) : '';
  const msg = err?.message || '';
  const sha1Match = msg.match(/\[SHA-1:\s*([A-F0-9:]+)\]/i);
  const sha1Suffix = sha1Match ? ` (SHA-1 deste APK: ${sha1Match[1]})` : '';

  if (code === '10' || msg.includes('10:') || msg.includes('DEVELOPER_ERROR')) {
    return `Falta cadastrar a impressão SHA-1 deste APK no Google Cloud Console para com.vidaorganizada.app${sha1Suffix}.`;
  }
  if (code === 'PLAY_SERVICES_UNAVAILABLE' || msg.includes('Play Services')) {
    return 'Google Play Services não disponível ou desatualizado neste aparelho.';
  }
  if (code === '12500' || msg.includes('12500')) {
    return `O Google recusou o login neste APK. Verifique Usuários de teste na Tela de consentimento OAuth e o SHA-1 no Google Cloud${sha1Suffix}.`;
  }
  if (code === '7' || code === 'auth/network-request-failed' || msg.includes('NETWORK_ERROR')) {
    return 'Falha de conexão com a internet. Verifique sua rede e tente novamente.';
  }
  if (msg.includes('VITE_APP_URL')) {
    return 'Login nativo indisponível neste aparelho sem Google Play Services.';
  }
  if (code === 'auth/popup-blocked') {
    return 'O navegador bloqueou a janela de login. Permita pop-ups para este site e tente novamente.';
  }
  if (code === 'auth/unauthorized-domain') {
    return 'Este endereço ainda não está autorizado para autenticação com o Google.';
  }
  if (code === 'auth/operation-not-allowed') {
    return 'O login com Conta Google não está ativado neste projeto.';
  }
  if (code === 'auth/internal-error') {
    return 'Erro temporário ao comunicar com o Google. Tente novamente em alguns instantes.';
  }
  if (msg.startsWith('Não foi possível carregar seu perfil Google')) {
    return msg;
  }
  if (!Capacitor.isNativePlatform() && (!isFirebaseConfigured || msg.includes('não configurada'))) {
    return 'Configuração de login Google não carregada no servidor. Atualize a página e tente novamente.';
  }
  return 'Não foi possível autenticar com o Google. Tente novamente.';
};

export const setSessionToken = (token: string | null, expiresInSec?: number) => {
  cachedAccessToken = token;
  if (token) {
    const ttlSec =
      typeof expiresInSec === 'number' && Number.isFinite(expiresInSec) && expiresInSec > 60
        ? expiresInSec
        : DEFAULT_TOKEN_TTL_SEC;
    cachedTokenExpiresAt = Date.now() + ttlSec * 1000;
  } else {
    cachedTokenExpiresAt = 0;
  }
};

export const getTokenExpiresAt = (): number => cachedTokenExpiresAt;

export const isAccessTokenExpiredOrNearExpiry = (bufferMs = 120_000): boolean => {
  if (!cachedAccessToken) return true;
  if (!cachedTokenExpiresAt) return false;
  return Date.now() >= cachedTokenExpiresAt - bufferMs;
};

/**
 * Listens to auth state WITHOUT logging the user out when the temporary access token is absent in memory.
 */
export const initAuth = (
  onUserSession: (user: User, token: string | null, expiresAt: number) => void,
  onSignedOut?: () => void
) => {
  const restoredProfile = loadPersistedUserProfile();

  if (!auth) {
    if (restoredProfile) {
      onUserSession(persistedProfileToUser(restoredProfile), cachedAccessToken, cachedTokenExpiresAt);
    } else {
      cachedAccessToken = null;
      cachedTokenExpiresAt = 0;
      if (onSignedOut) onSignedOut();
    }
    return () => {};
  }

  return onAuthStateChanged(auth, (firebaseUser: User | null) => {
    if (firebaseUser) {
      persistUserProfile(firebaseUser, 'firebase');
      onUserSession(firebaseUser, cachedAccessToken, cachedTokenExpiresAt);
      return;
    }

    // Preserve native OAuth sessions if WebView restarted without a persisted Firebase credential
    const latestProfile = loadPersistedUserProfile();
    if (latestProfile && latestProfile.source === 'native_oauth') {
      onUserSession(persistedProfileToUser(latestProfile), cachedAccessToken, cachedTokenExpiresAt);
      return;
    }

    if (!isSigningIn) {
      cachedAccessToken = null;
      cachedTokenExpiresAt = 0;
      clearPersistedUserProfile();
      if (onSignedOut) onSignedOut();
    }
  });
};

export const consumeRedirectSignInResult = async (): Promise<{
  user: User;
  accessToken: string;
  idToken?: string | null;
  expiresAt: number;
} | null> => {
  if (!auth) return null;
  try {
    isSigningIn = true;
    const result = await getRedirectResult(auth);
    if (!result) return null;
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      return null;
    }
    setSessionToken(credential.accessToken, DEFAULT_TOKEN_TTL_SEC);
    persistUserProfile(result.user, 'firebase');
    return {
      user: result.user,
      accessToken: credential.accessToken,
      idToken: credential.idToken || null,
      expiresAt: cachedTokenExpiresAt,
    };
  } catch (error) {
    console.warn('Falha ao concluir autenticação via redirecionamento:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

/**
 * Must ONLY be called synchronously from a direct user gesture (click/tap),
 * never from background effects/timers, so browser popup blockers never trigger.
 */
export const googleSignIn = async (options?: {
  allowRedirectFallback?: boolean;
  loginHint?: string | null;
}): Promise<GoogleSignInResult | null> => {
  try {
    isSigningIn = true;

    // Fluxo nativo no Android APK via Google Play Services AuthorizationClient (sem servidor externo)
    if (Capacitor.isNativePlatform()) {
      if (isNativeGoogleAuthSupported()) {
        try {
          const nativeRes = await authorizeNativeGoogle({
            scopes: SCOPES,
            silentOnly: false,
            accountEmail: options?.loginHint || undefined,
          });

          if (nativeRes.cancelled) {
            return {
              cancelled: true,
              noData: nativeRes.noData,
              sha1: nativeRes.sha1,
            };
          }

          if (nativeRes.authorized && nativeRes.accessToken) {
            const nativeUser = await completeNativeGoogleAuth(nativeRes.accessToken);
            if (!nativeUser) {
              throw new Error('Não foi possível obter os dados da sua conta Google.');
            }
            return {
              user: nativeUser,
              accessToken: nativeRes.accessToken,
              expiresAt: cachedTokenExpiresAt,
            };
          }

          throw new Error('Não foi possível concluir a autorização nativa do Google.');
        } catch (nativeError: any) {
          const code = String(nativeError?.code || '');
          const baseUrl = getConfiguredAppServerUrl();
          // Somente usa bridge Web opcional se Play Services não existir no aparelho E o usuário tiver configurado APP_URL
          if (code === 'PLAY_SERVICES_UNAVAILABLE' && baseUrl) {
            const hintParam = options?.loginHint
              ? `&login_hint=${encodeURIComponent(options.loginHint)}`
              : '';
            await Browser.open({ url: `${baseUrl}?connect_native=1${hintParam}`, windowName: '_system' });
            return { isNativeRedirect: true };
          }
          throw nativeError;
        }
      }

      const baseUrl = getConfiguredAppServerUrl();
      if (!baseUrl) {
        throw new Error('Autenticação no APK requer VITE_APP_URL configurado.');
      }
      const hintParam = options?.loginHint
        ? `&login_hint=${encodeURIComponent(options.loginHint)}`
        : '';
      const bridgeUrl = `${baseUrl}?connect_native=1${hintParam}`;
      await Browser.open({ url: bridgeUrl, windowName: '_system' });
      return { isNativeRedirect: true };
    }

    if (!auth) {
      throw new Error('Autenticação Google não configurada neste ambiente.');
    }

    const activeProvider = new GoogleAuthProvider();
    SCOPES.forEach((scope) => activeProvider.addScope(scope));
    if (options?.loginHint) {
      activeProvider.setCustomParameters({
        login_hint: options.loginHint,
      });
    } else {
      activeProvider.setCustomParameters({
        prompt: 'select_account',
      });
    }

    // Fluxo padrão via popup seguro do Firebase Auth (executado diretamente no clique do usuário)
    try {
      const result = await signInWithPopup(auth, activeProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        throw new Error('Falha ao obter token de acesso do Google.');
      }

      setSessionToken(credential.accessToken, DEFAULT_TOKEN_TTL_SEC);
      persistUserProfile(result.user, 'firebase');
      return {
        user: result.user,
        accessToken: credential.accessToken,
        idToken: credential.idToken || null,
        expiresAt: cachedTokenExpiresAt,
      };
    } catch (popupError: any) {
      if (
        options?.allowRedirectFallback &&
        (popupError?.code === 'auth/popup-blocked' ||
          popupError?.code === 'auth/operation-not-supported-in-this-environment')
      ) {
        await signInWithRedirect(auth, activeProvider);
        return { isWebRedirect: true };
      }
      throw popupError;
    }
  } catch (error: any) {
    if (
      error?.code === 'auth/popup-closed-by-user' ||
      error?.code === 'auth/cancelled-popup-request'
    ) {
      return { cancelled: true };
    }
    console.warn('Falha na autenticação do Google:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const completeNativeGoogleAuth = async (
  accessToken: string,
  idToken?: string | null,
  expiresInSec?: number
): Promise<User | null> => {
  setSessionToken(accessToken, expiresInSec);

  if (auth && idToken) {
    try {
      const credential = GoogleAuthProvider.credential(idToken, accessToken);
      const result = await signInWithCredential(auth, credential);
      persistUserProfile(result.user, 'firebase');
      return result.user;
    } catch (e) {
      console.warn('signInWithCredential fallback:', e);
    }
  }

  const userInfoEndpoints = [
    'https://www.googleapis.com/oauth2/v3/userinfo',
    'https://www.googleapis.com/oauth2/v2/userinfo',
  ];
  let lastStatus: number | null = null;
  let lastNetworkError: unknown = null;

  for (const endpoint of userInfoEndpoints) {
    try {
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        const syntheticUser = {
          uid: data.sub || data.id || 'google-user-' + Date.now(),
          displayName: data.name || data.given_name || 'Usuário Google',
          email: data.email || '',
          photoURL: data.picture || null,
          emailVerified: Boolean(data.email_verified ?? data.verified_email),
        } as unknown as User;
        persistUserProfile(syntheticUser, 'native_oauth');
        return syntheticUser;
      }
      lastStatus = res.status;
    } catch (err) {
      lastNetworkError = err;
      console.warn('Falha ao buscar perfil Google via access token:', err);
    }
  }

  if (lastStatus !== null) {
    throw new Error(
      `Não foi possível carregar seu perfil Google (HTTP ${lastStatus}). Verifique as permissões e tente novamente.`
    );
  }
  if (lastNetworkError) {
    throw new Error(
      'Não foi possível carregar seu perfil Google por falha de rede. Verifique sua conexão e tente novamente.'
    );
  }

  return null;
};

export const getAccessToken = async (): Promise<string | null> => {
  if (cachedAccessToken && !isAccessTokenExpiredOrNearExpiry(10_000)) {
    return cachedAccessToken;
  }

  // Renovação silenciosa automática no APK Android via Google Play Services
  if (isNativeGoogleAuthSupported()) {
    const profile = loadPersistedUserProfile();
    if (profile?.source === 'native_oauth') {
      if (!inFlightSilentRefresh) {
        inFlightSilentRefresh = (async () => {
          try {
            const res = await authorizeNativeGoogle({
              scopes: SCOPES,
              silentOnly: true,
              accountEmail: profile.email || undefined,
            });
            if (res.authorized && res.accessToken) {
              setSessionToken(res.accessToken, DEFAULT_TOKEN_TTL_SEC);
              return res.accessToken;
            }
          } catch {
            // Silent refresh may fail if user needs to consent interactively
          } finally {
            inFlightSilentRefresh = null;
          }
          return null;
        })();
      }
      return await inFlightSilentRefresh;
    }
  }

  return null;
};

export const logout = async () => {
  const tokenToClear = cachedAccessToken;
  clearPersistedUserProfile();
  setSessionToken(null);
  if (tokenToClear && isNativeGoogleAuthSupported()) {
    await clearNativeGoogleToken(tokenToClear);
  }
  if (auth) {
    await auth.signOut();
  }
};
