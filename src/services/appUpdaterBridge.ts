import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';

export interface InstalledAppInfo {
  packageName: string;
  versionName: string;
  versionCode: number;
}

export interface PendingApkInfo {
  hasPending: boolean;
  fileName?: string;
  fileSize?: number;
  versionName?: string;
  versionCode?: number;
}

export interface UpdateDownloadProgressEvent {
  phase: 'downloading' | 'extracting' | 'verifying' | 'installing';
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
}

export interface DownloadAndInstallResult {
  status: 'installer_launched' | 'permission_required' | 'missing';
  versionName?: string;
  versionCode?: number;
  fileSize?: number;
}

interface AppUpdaterPluginInterface {
  getInstalledAppInfo(): Promise<InstalledAppInfo>;
  canRequestPackageInstalls(): Promise<{ canInstall: boolean; sdkInt: number }>;
  openInstallUnknownAppsSettings(): Promise<{ opened: boolean }>;
  hasPendingApk(): Promise<PendingApkInfo>;
  installPendingApk(): Promise<DownloadAndInstallResult>;
  clearPendingApk(): Promise<void>;
  downloadAndInstallApk(options: {
    url: string;
    token?: string;
    fileName?: string;
  }): Promise<DownloadAndInstallResult>;
  addListener(
    eventName: 'updateDownloadProgress',
    listenerFunc: (event: UpdateDownloadProgressEvent) => void
  ): Promise<PluginListenerHandle>;
}

const AppUpdater = registerPlugin<AppUpdaterPluginInterface>('AppUpdater');

export function isNativeSelfUpdateSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function getInstalledAppInfo(): Promise<InstalledAppInfo | null> {
  if (!isNativeSelfUpdateSupported()) return null;
  try {
    return await AppUpdater.getInstalledAppInfo();
  } catch {
    return null;
  }
}

export async function canRequestPackageInstalls(): Promise<boolean> {
  if (!isNativeSelfUpdateSupported()) return false;
  try {
    const res = await AppUpdater.canRequestPackageInstalls();
    return Boolean(res?.canInstall);
  } catch {
    return false;
  }
}

export async function openInstallUnknownAppsSettings(): Promise<boolean> {
  if (!isNativeSelfUpdateSupported()) return false;
  try {
    const res = await AppUpdater.openInstallUnknownAppsSettings();
    return Boolean(res?.opened);
  } catch {
    return false;
  }
}

export async function hasPendingApk(): Promise<PendingApkInfo> {
  if (!isNativeSelfUpdateSupported()) return { hasPending: false };
  try {
    return await AppUpdater.hasPendingApk();
  } catch {
    return { hasPending: false };
  }
}

export async function installPendingApk(): Promise<DownloadAndInstallResult> {
  if (!isNativeSelfUpdateSupported()) {
    return { status: 'missing' };
  }
  return await AppUpdater.installPendingApk();
}

export async function clearPendingApk(): Promise<void> {
  if (!isNativeSelfUpdateSupported()) return;
  try {
    await AppUpdater.clearPendingApk();
  } catch {
    // ignore cleanup error
  }
}

export async function downloadAndInstallApk(options: {
  url: string;
  token?: string;
  fileName?: string;
}): Promise<DownloadAndInstallResult> {
  if (!isNativeSelfUpdateSupported()) {
    throw new Error('Atualização automática de APK disponível apenas no aplicativo Android.');
  }
  return await AppUpdater.downloadAndInstallApk(options);
}

export async function addUpdateProgressListener(
  callback: (event: UpdateDownloadProgressEvent) => void
): Promise<PluginListenerHandle | null> {
  if (!isNativeSelfUpdateSupported()) return null;
  try {
    return await AppUpdater.addListener('updateDownloadProgress', callback);
  } catch {
    return null;
  }
}
