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
  distributionChannel: 'githubApk' | 'web';
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

export interface NativeAutoBackupFolderStatus {
  configured: boolean;
  accessible: boolean;
  folderName: string;
  hasPassphrase: boolean;
  lastSyncedAt: number;
  lastFileName: string;
}

export interface IncomingFilePayload {
  kind?: 'file' | 'image' | 'text';
  name: string;
  mimeType: string;
  size: number;
  content: string;
  receivedAt: number;
}

interface AppHealthPluginInterface {
  saveVaultBackup(options: { payloadJson: string }): Promise<{ ok: boolean; bytes: number; encrypted?: boolean; updatedAt: number }>;
  loadVaultBackup(): Promise<VaultBackupResult>;
  clearVaultBackup(): Promise<{ cleared: boolean }>;
  consumePendingIncomingFile(): Promise<{ found: boolean } & Partial<IncomingFilePayload>>;
  shareTextFile(options: {
    fileName: string;
    content: string;
    mimeType: string;
    chooserTitle?: string;
  }): Promise<{ shared: boolean; fileName: string }>;
  pickAutoBackupFolder(): Promise<{
    selected: boolean;
    canceled?: boolean;
    folderName?: string;
    accessible?: boolean;
  }>;
  getAutoBackupFolderStatus(): Promise<NativeAutoBackupFolderStatus>;
  clearAutoBackupFolder(options?: { clearPassphrase?: boolean }): Promise<{ cleared: boolean }>;
  saveAutoBackupPassphrase(options: { passphrase: string }): Promise<{ saved: boolean }>;
  getAutoBackupPassphrase(): Promise<{ found: boolean; passphrase?: string }>;
  writeAutoBackupFile(options: {
    fileName: string;
    content: string;
    mimeType: string;
  }): Promise<{ ok: boolean; fileName: string; bytes: number; updatedAt: number }>;
  getAndroidPermissionsStatus(): Promise<AndroidPermissionsStatus>;
  requestAndroidPermission(options: { target: MediaPermissionTarget }): Promise<MediaPermissionRequestResult>;
  openPermissionSettings(options: { target: AndroidPermissionTarget }): Promise<{ opened: boolean; target: string }>;
  updateWidgetSummary(options: {
    pendingTasksCount: number;
    todayEventsCount: number;
    balanceFormatted: string;
    hideValues: boolean;
  }): Promise<{ updated: boolean }>;
  addListener(
    eventName: 'incomingFileOpened',
    listenerFunc: (file: IncomingFilePayload) => void
  ): Promise<{ remove: () => Promise<void> }>;
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

export async function shareNativeTextFile(options: {
  fileName: string;
  content: string;
  mimeType: string;
  chooserTitle?: string;
}): Promise<boolean> {
  if (!isAndroidNativeHealthSupported()) return false;
  await AppHealth.shareTextFile(options);
  return true;
}

export async function consumePendingIncomingFile(): Promise<IncomingFilePayload | null> {
  if (!isAndroidNativeHealthSupported()) return null;
  try {
    const res = await AppHealth.consumePendingIncomingFile();
    if (!res?.found || !res.content) return null;
    return {
      kind: res.kind,
      name: res.name || 'arquivo_recebido',
      mimeType: res.mimeType || '',
      size: Number(res.size) || res.content.length,
      content: res.content,
      receivedAt: Number(res.receivedAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

export async function updateNativeWidgetSummary(options: {
  pendingTasksCount: number;
  todayEventsCount: number;
  balanceFormatted: string;
  hideValues: boolean;
}): Promise<void> {
  if (!isAndroidNativeHealthSupported()) return;
  try {
    await AppHealth.updateWidgetSummary(options);
  } catch {
    // ignore widget bridge errors on older builds
  }
}

export async function addIncomingFileListener(
  callback: (file: IncomingFilePayload) => void
): Promise<{ remove: () => Promise<void> } | null> {
  if (!isAndroidNativeHealthSupported()) return null;
  try {
    return await AppHealth.addListener('incomingFileOpened', callback);
  } catch {
    return null;
  }
}

export async function pickNativeAutoBackupFolder(): Promise<{
  selected: boolean;
  canceled?: boolean;
  folderName?: string;
  accessible?: boolean;
}> {
  if (!isAndroidNativeHealthSupported()) {
    return { selected: false };
  }
  return await AppHealth.pickAutoBackupFolder();
}

export async function getNativeAutoBackupFolderStatus(): Promise<NativeAutoBackupFolderStatus | null> {
  if (!isAndroidNativeHealthSupported()) return null;
  try {
    return await AppHealth.getAutoBackupFolderStatus();
  } catch {
    return null;
  }
}

export async function clearNativeAutoBackupFolder(clearPassphrase = false): Promise<void> {
  if (!isAndroidNativeHealthSupported()) return;
  try {
    await AppHealth.clearAutoBackupFolder({ clearPassphrase });
  } catch {
    // ignore
  }
}

export async function saveNativeAutoBackupPassphrase(passphrase: string): Promise<void> {
  if (!isAndroidNativeHealthSupported()) return;
  await AppHealth.saveAutoBackupPassphrase({ passphrase });
}

export async function getNativeAutoBackupPassphrase(): Promise<string | null> {
  if (!isAndroidNativeHealthSupported()) return null;
  try {
    const res = await AppHealth.getAutoBackupPassphrase();
    return res?.found && res.passphrase ? res.passphrase : null;
  } catch {
    return null;
  }
}

export async function writeNativeAutoBackupFile(options: {
  fileName: string;
  content: string;
  mimeType: string;
}): Promise<{ ok: boolean; fileName: string; bytes: number; updatedAt: number }> {
  if (!isAndroidNativeHealthSupported()) {
    throw new Error('Pasta automática disponível apenas no aplicativo Android.');
  }
  return await AppHealth.writeAutoBackupFile(options);
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
