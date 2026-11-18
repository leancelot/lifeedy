import { Capacitor, registerPlugin } from '@capacitor/core';

export type AndroidPermissionTarget =
  | 'notifications'
  | 'exactAlarms'
  | 'bankListener'
  | 'installPackages'
  | 'appDetails';

export interface AndroidPermissionsStatus {
  notifications: boolean;
  exactAlarms: boolean;
  microphone: boolean;
  camera: boolean;
  bankListener: boolean;
  installPackages: boolean;
  supportsSelfUpdate: boolean;
  distributionChannel: 'githubApk' | 'playStore' | 'web';
  sdkInt: number;
  versionName: string;
  versionCode: number;
}

export type MediaPermissionTarget = 'microphone' | 'camera';

export interface MediaPermissionRequestResult {
  granted: boolean;
  state: 'granted' | 'denied' | 'unsupported';
}

export interface WebMediaPermissionsStatus {
  microphone: PermissionState | 'unsupported';
  camera: PermissionState | 'unsupported';
}

export interface VaultBackupResult {
  found: boolean;
  source: 'primary' | 'backup' | 'none';
  bytes: number;
  encrypted?: boolean;
  payloadJson?: string;
}

interface AppHealthPluginInterface {
  saveVaultBackup(options: { payloadJson: string }): Promise<{ ok: boolean; bytes: number; encrypted?: boolean; updatedAt: number }>;
  loadVaultBackup(): Promise<VaultBackupResult>;
  clearVaultBackup(): Promise<{ cleared: boolean }>;
  getAndroidPermissionsStatus(): Promise<AndroidPermissionsStatus>;
  requestAndroidPermission(options: { target: MediaPermissionTarget }): Promise<MediaPermissionRequestResult>;
  openPermissionSettings(options: { target: AndroidPermissionTarget }): Promise<{ opened: boolean; target: string }>;
}

const AppHealth = registerPlugin<AppHealthPluginInterface>('AppHealth');

export function isAndroidNativeHealthSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function saveNativeVaultBackup(
  payloadJson: string
): Promise<{ ok: boolean; bytes: number; encrypted?: boolean; updatedAt: number } | null> {
  if (!isAndroidNativeHealthSupported()) return null;
  try {
    return await AppHealth.saveVaultBackup({ payloadJson });
  } catch (err) {
    console.warn('Falha ao espelhar cofre nativo Android:', err);
    return null;
  }
}

export async function loadNativeVaultBackup(): Promise<VaultBackupResult> {
  if (!isAndroidNativeHealthSupported()) {
    return { found: false, source: 'none', bytes: 0 };
  }
  try {
    return await AppHealth.loadVaultBackup();
  } catch {
    return { found: false, source: 'none', bytes: 0 };
  }
}

export async function clearNativeVaultBackup(): Promise<void> {
  if (!isAndroidNativeHealthSupported()) return;
  try {
    await AppHealth.clearVaultBackup();
  } catch {
    // ignore cleanup failure
  }
}

export async function getAndroidPermissionsStatus(): Promise<AndroidPermissionsStatus | null> {
  if (!isAndroidNativeHealthSupported()) return null;
  try {
    return await AppHealth.getAndroidPermissionsStatus();
  } catch {
    return null;
  }
}

export async function openAndroidPermissionSettings(
  target: AndroidPermissionTarget
): Promise<boolean> {
  if (!isAndroidNativeHealthSupported()) return false;
  try {
    const res = await AppHealth.openPermissionSettings({ target });
    return Boolean(res?.opened);
  } catch {
    return false;
  }
}

export async function getWebMediaPermissionsStatus(): Promise<WebMediaPermissionsStatus> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
    return { microphone: 'unsupported', camera: 'unsupported' };
  }

  const queryOne = async (name: PermissionName): Promise<PermissionState | 'unsupported'> => {
    try {
      const status = await navigator.permissions.query({ name });
      return status.state;
    } catch {
      return 'unsupported';
    }
  };

  const [microphone, camera] = await Promise.all([
    queryOne('microphone' as PermissionName),
    queryOne('camera' as PermissionName),
  ]);

  return { microphone, camera };
}

export async function requestMediaPermission(
  target: MediaPermissionTarget
): Promise<MediaPermissionRequestResult> {
  if (isAndroidNativeHealthSupported()) {
    try {
      const res = await AppHealth.requestAndroidPermission({ target });
      return {
        granted: Boolean(res?.granted),
        state: res?.granted ? 'granted' : 'denied',
      };
    } catch {
      return { granted: false, state: 'denied' };
    }
  }

  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { granted: false, state: 'unsupported' };
  }

  try {
    const constraints: MediaStreamConstraints =
      target === 'microphone' ? { audio: true } : { video: true };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    stream.getTracks().forEach((track) => track.stop());
    return { granted: true, state: 'granted' };
  } catch (err: any) {
    const name = String(err?.name || '');
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return { granted: false, state: 'unsupported' };
    }
    return { granted: false, state: 'denied' };
  }
}

export function describeMediaPermissionError(
  err: unknown,
  media: MediaPermissionTarget
): string {
  const errObj = err as { name?: string; message?: string } | null;
  const name = String(errObj?.name || '');
  const label = media === 'microphone' ? 'microfone' : 'câmera';

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return `Nenhum(a) ${label} encontrado(a) neste dispositivo.`;
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return `O recurso de ${label} está ocupado por outro aplicativo no momento.`;
  }
  if (name === 'SecurityError') {
    return `Acesso ao ${label} bloqueado pela política de segurança desta janela ou navegador.`;
  }
  return media === 'microphone'
    ? 'Permita o acesso ao microfone nas permissões do aparelho ou navegador para gravar áudios.'
    : 'Permita o acesso à câmera nas permissões do aparelho para tirar fotos.';
}
