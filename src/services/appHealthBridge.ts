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
  bankListener: boolean;
  installPackages: boolean;
  supportsSelfUpdate: boolean;
  distributionChannel: 'githubApk' | 'playStore' | 'web';
  sdkInt: number;
  versionName: string;
  versionCode: number;
}

export interface VaultBackupResult {
  found: boolean;
  source: 'primary' | 'backup' | 'none';
  bytes: number;
  payloadJson?: string;
}

interface AppHealthPluginInterface {
  saveVaultBackup(options: { payloadJson: string }): Promise<{ ok: boolean; bytes: number; updatedAt: number }>;
  loadVaultBackup(): Promise<VaultBackupResult>;
  clearVaultBackup(): Promise<{ cleared: boolean }>;
  getAndroidPermissionsStatus(): Promise<AndroidPermissionsStatus>;
  openPermissionSettings(options: { target: AndroidPermissionTarget }): Promise<{ opened: boolean; target: string }>;
}

const AppHealth = registerPlugin<AppHealthPluginInterface>('AppHealth');

export function isAndroidNativeHealthSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function saveNativeVaultBackup(
  payloadJson: string
): Promise<{ ok: boolean; bytes: number; updatedAt: number } | null> {
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
