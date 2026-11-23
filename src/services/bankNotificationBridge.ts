import { Capacitor, registerPlugin } from '@capacitor/core';
import { BankCaptureSourceKind, ManualCaptureAppRule } from '../types';

export interface NativePendingBankEvent {
  id: string;
  packageName: string;
  bankName: string;
  sourceKind?: BankCaptureSourceKind;
  title: string;
  text: string;
  timestamp: number;
}

export interface InstalledAppInfo {
  packageName: string;
  label: string;
  isBuiltInBank: boolean;
  isWallet: boolean;
  isSms: boolean;
}

export interface NativeCaptureConfig {
  captureBanksEnabled: boolean;
  captureWalletEnabled: boolean;
  captureSmsEnabled: boolean;
  captureScheduledMessagesEnabled: boolean;
  manualApps: Array<{
    packageName: string;
    label: string;
    enabled: boolean;
  }>;
}

interface BankNotificationListenerPlugin {
  isPermissionGranted(): Promise<{ granted: boolean }>;
  openNotificationAccessSettings(): Promise<void>;
  getPendingNotifications(): Promise<{ notifications: NativePendingBankEvent[] }>;
  clearPendingNotifications(options?: { ids?: string[] }): Promise<void>;
  getCaptureConfig(): Promise<NativeCaptureConfig>;
  setCaptureConfig(config: NativeCaptureConfig): Promise<{ saved: boolean }>;
  getInstalledApps(): Promise<{ apps: InstalledAppInfo[] }>;
  addListener(
    eventName: 'bankNotificationReceived',
    listenerFunc: (event: NativePendingBankEvent) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

const BankNotificationListener = registerPlugin<BankNotificationListenerPlugin>(
  'BankNotificationListener'
);

export function isAndroidNotificationCaptureSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function checkBankNotificationPermission(): Promise<boolean> {
  if (!isAndroidNotificationCaptureSupported()) return false;
  try {
    const res = await BankNotificationListener.isPermissionGranted();
    return Boolean(res?.granted);
  } catch {
    return false;
  }
}

export async function openBankNotificationSettings(): Promise<void> {
  if (!isAndroidNotificationCaptureSupported()) return;
  try {
    await BankNotificationListener.openNotificationAccessSettings();
  } catch {
    // ignore
  }
}

export async function fetchNativePendingBankNotifications(): Promise<NativePendingBankEvent[]> {
  if (!isAndroidNotificationCaptureSupported()) return [];
  try {
    const res = await BankNotificationListener.getPendingNotifications();
    return Array.isArray(res?.notifications) ? res.notifications : [];
  } catch {
    return [];
  }
}

export async function acknowledgeNativeBankNotifications(ids?: string[]): Promise<void> {
  if (!isAndroidNotificationCaptureSupported()) return;
  try {
    await BankNotificationListener.clearPendingNotifications(ids ? { ids } : undefined);
  } catch {
    // ignore
  }
}

export async function subscribeNativeBankNotifications(
  onEvent: (event: NativePendingBankEvent) => void
): Promise<(() => void) | null> {
  if (!isAndroidNotificationCaptureSupported()) return null;
  try {
    const handle = await BankNotificationListener.addListener('bankNotificationReceived', onEvent);
    return () => {
      void handle.remove();
    };
  } catch {
    return null;
  }
}

export async function syncNativeBankCaptureConfig(config: {
  captureBanksEnabled: boolean;
  captureWalletEnabled: boolean;
  captureSmsEnabled: boolean;
  captureScheduledMessagesEnabled: boolean;
  manualApps: ManualCaptureAppRule[];
}): Promise<boolean> {
  if (!isAndroidNotificationCaptureSupported()) return false;
  try {
    const res = await BankNotificationListener.setCaptureConfig({
      captureBanksEnabled: config.captureBanksEnabled,
      captureWalletEnabled: config.captureWalletEnabled,
      captureSmsEnabled: config.captureSmsEnabled,
      captureScheduledMessagesEnabled: config.captureScheduledMessagesEnabled,
      manualApps: config.manualApps.map((app) => ({
        packageName: app.packageName,
        label: app.label,
        enabled: app.enabled,
      })),
    });
    return Boolean(res?.saved);
  } catch {
    return false;
  }
}

export async function fetchInstalledAndroidApps(): Promise<InstalledAppInfo[]> {
  if (!isAndroidNotificationCaptureSupported()) return [];
  try {
    const res = await BankNotificationListener.getInstalledApps();
    return Array.isArray(res?.apps) ? res.apps : [];
  } catch {
    return [];
  }
}
