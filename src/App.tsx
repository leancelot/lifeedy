/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Fingerprint, Lock } from 'lucide-react';
import { notifyNativeAppReady, syncNativeSystemBars } from './services/systemAppearanceBridge';
import { initKeyboardViewportAdapter } from './services/keyboardAdapter';
import { authenticateFinanceAccess, isBiometricSupportedOnPlatform } from './services/biometricLockBridge';
import { hapticImpactLight, hapticSuccess } from './services/hapticsService';
import { AppProvider, useApp } from './context/AppContext';
import { BackNavigationProvider, useBackNavigation } from './context/BackNavigationContext';
import { Header } from './components/Header';
import { MobileNav } from './components/MobileNav';
import { DashboardView } from './components/Dashboard/DashboardView';
import { OnboardingView } from './components/Onboarding/OnboardingView';
import {
  AutoRestoredDriveBanner,
  DriveRestorePromptModal,
  StartFromScratchModal,
} from './components/DriveSync/DriveDecisionModals';
import { QuickActionFab } from './components/Common/QuickActionFab';
import { ToastUndo } from './components/Common/ToastUndo';
import { InAppUpdateBanner } from './components/Common/InAppUpdateBanner';
import { NetworkStatusBanner } from './components/Common/NetworkStatusBanner';
import { lazyWithRetry } from './utils/lazyWithRetry';
import {
  QuickTourTarget,
  hasCompletedQuickTour,
  markQuickTourCompleted,
} from './constants/quickTourSteps';
import type { SettingsCategoryTab } from './components/Account/AccountSettingsModal';

const AgendaTasksView = lazyWithRetry(
  () => import('./components/Agenda/AgendaTasksView').then((m) => ({ default: m.AgendaTasksView })),
  'agenda-view'
);
const FinanceView = lazyWithRetry(
  () => import('./components/Finance/FinanceView').then((m) => ({ default: m.FinanceView })),
  'finance-view'
);
const AccountSettingsModal = lazyWithRetry(
  () => import('./components/Account/AccountSettingsModal').then((m) => ({ default: m.AccountSettingsModal })),
  'account-modal'
);
const NotificationCenterModal = lazyWithRetry(
  () => import('./components/Notifications/NotificationCenterModal').then((m) => ({ default: m.NotificationCenterModal })),
  'notifications-modal'
);
const NativeConnectBridge = lazyWithRetry(
  () => import('./components/Auth/NativeConnectBridge').then((m) => ({ default: m.NativeConnectBridge })),
  'native-connect-bridge'
);
const QuickTourModal = lazyWithRetry(
  () => import('./components/Common/QuickTourModal').then((m) => ({ default: m.QuickTourModal })),
  'quick-tour-modal'
);

const TabLoadingFallback: React.FC = () => (
  <div className="max-w-6xl mx-auto space-y-4 pb-16 animate-pulse" aria-busy="true">
    <div className="h-28 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800" />
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="h-24 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800" />
      <div className="h-24 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800" />
      <div className="h-24 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 hidden lg:block" />
      <div className="h-24 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 hidden lg:block" />
    </div>
    <div className="h-52 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800" />
  </div>
);

const MainApp: React.FC = () => {
  const {
    onboardingCompleted,
    theme,
    financeLockEnabled,
    pendingNotificationTarget,
    consumeNotificationTarget,
  } = useApp();
  const backNavigation = useBackNavigation();
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [agendaQuickOpen, setAgendaQuickOpen] = useState<'task' | 'event' | null>(null);
  const [financeQuickOpen, setFinanceQuickOpen] = useState<'new-transaction' | 'scan-receipt' | null>(null);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [accountInitialTab, setAccountInitialTab] = useState<SettingsCategoryTab>('general');
  const [isNotificationCenterOpen, setIsNotificationCenterOpen] = useState(false);
  const [isQuickMenuOpen, setIsQuickMenuOpen] = useState(false);
  const [quickTourDone, setQuickTourDone] = useState<boolean>(() => hasCompletedQuickTour());
  const [isQuickTourOpen, setIsQuickTourOpen] = useState(false);
  const prevOnboardingRef = useRef<boolean>(onboardingCompleted);

  // Finance biometric gate state (locked when enabled until verified in active foreground session)
  const biometricNative = isBiometricSupportedOnPlatform();
  const [isFinanceUnlocked, setIsFinanceUnlocked] = useState<boolean>(() => !financeLockEnabled || !biometricNative);
  const [isUnlockingFinance, setIsUnlockingFinance] = useState<boolean>(false);
  const [financeUnlockError, setFinanceUnlockError] = useState<string | null>(null);
  const autoPromptedTabRef = useRef<boolean>(false);

  // Inicia automaticamente o tour de 4 etapas logo após concluir o onboarding inicial
  useEffect(() => {
    const wasIncomplete = !prevOnboardingRef.current;
    prevOnboardingRef.current = onboardingCompleted;
    if (wasIncomplete && onboardingCompleted && !hasCompletedQuickTour()) {
      setIsQuickTourOpen(true);
    }
  }, [onboardingCompleted]);

  const finishQuickTour = useCallback((navigateTo?: QuickTourTarget) => {
    markQuickTourCompleted();
    setQuickTourDone(true);
    setIsQuickTourOpen(false);
    if (navigateTo === 'settings') {
      setAccountInitialTab('general');
      setIsAccountModalOpen(true);
    } else if (navigateTo) {
      setCurrentTab(navigateTo);
    }
  }, []);

  // Sync unlock state if user toggles setting
  useEffect(() => {
    if (!financeLockEnabled || !biometricNative) {
      setIsFinanceUnlocked(true);
      setFinanceUnlockError(null);
    } else {
      // Keep current unlock if toggled inside Settings; lock again on next background or if currently closed
      setIsFinanceUnlocked(false);
    }
  }, [financeLockEnabled, biometricNative]);

  const requestFinanceUnlock = useCallback(async () => {
    if (!financeLockEnabled || !biometricNative) {
      setIsFinanceUnlocked(true);
      return;
    }
    setIsUnlockingFinance(true);
    setFinanceUnlockError(null);
    try {
      const result = await authenticateFinanceAccess();
      if (result.authenticated) {
        hapticSuccess();
        setIsFinanceUnlocked(true);
        setFinanceUnlockError(null);
      } else {
        setFinanceUnlockError(result.message || 'Autenticação necessária para abrir Finanças.');
      }
    } finally {
      setIsUnlockingFinance(false);
    }
  }, [financeLockEnabled, biometricNative]);

  // Auto-prompt once whenever user enters locked Finance tab
  useEffect(() => {
    const isLockedFinance = currentTab === 'financas' && financeLockEnabled && biometricNative && !isFinanceUnlocked;
    if (isLockedFinance && !autoPromptedTabRef.current) {
      autoPromptedTabRef.current = true;
      void requestFinanceUnlock();
    } else if (!isLockedFinance) {
      autoPromptedTabRef.current = false;
    }
  }, [currentTab, financeLockEnabled, biometricNative, isFinanceUnlocked, requestFinanceUnlock]);

  // Re-arm Finance lock when Android app moves to background
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let sub: any = null;
    CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive && financeLockEnabled && biometricNative) {
        setIsFinanceUnlocked(false);
        autoPromptedTabRef.current = false;
      }
    })
      .then((s) => {
        sub = s;
      })
      .catch(() => {});
    return () => {
      if (sub && sub.remove) sub.remove();
    };
  }, [financeLockEnabled, biometricNative]);

  // Handle Android App Shortcuts (com.vidaorganizada.app://shortcut?action=...)
  const applyShortcutUrl = useCallback((url?: string | null) => {
    if (!url || !url.includes('shortcut')) return;
    try {
      const parsed = new URL(url);
      const action = parsed.searchParams.get('action');
      if (!action) return;

      setIsQuickMenuOpen(false);
      setIsAccountModalOpen(false);
      setIsNotificationCenterOpen(false);

      if (action === 'new-task') {
        setCurrentTab('agenda');
        setAgendaQuickOpen('task');
      } else if (action === 'agenda') {
        setCurrentTab('agenda');
      } else if (action === 'new-transaction') {
        setCurrentTab('financas');
        setFinanceQuickOpen('new-transaction');
      } else if (action === 'scan-receipt') {
        setCurrentTab('financas');
        setFinanceQuickOpen('scan-receipt');
      }
    } catch {
      // ignore malformed URL
    }
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    CapApp.getLaunchUrl()
      .then((launch) => {
        if (launch?.url) applyShortcutUrl(launch.url);
      })
      .catch(() => {});

    let sub: any = null;
    CapApp.addListener('appUrlOpen', (event) => {
      applyShortcutUrl(event?.url);
    })
      .then((s) => {
        sub = s;
      })
      .catch(() => {});

    return () => {
      if (sub && sub.remove) sub.remove();
    };
  }, [applyShortcutUrl]);

  // Sincronizar Status Bar, Navigation Bar e DecorView no Android nativo com o tema atual
  useEffect(() => {
    void syncNativeSystemBars(theme, !onboardingCompleted);
  }, [theme, onboardingCompleted]);

  // Sinaliza para o Splash Screen nativo que o primeiro quadro da interface já foi pintado
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    const rafId = window.requestAnimationFrame(() => {
      if (!cancelled) {
        void notifyNativeAppReady();
      }
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
    };
  }, []);

  // Hardware Back Button no Android nativo (LIFO: fecha modal/sheet mais recente -> volta para Início -> sai)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let sub: any = null;
    CapApp.addListener('backButton', () => {
      if (backNavigation?.handleTopBackPress()) {
        return;
      }
      if (currentTab !== 'dashboard') {
        setCurrentTab('dashboard');
      } else {
        CapApp.exitApp();
      }
    })
      .then((s) => {
        sub = s;
      })
      .catch(() => {});

    return () => {
      if (sub && sub.remove) sub.remove();
    };
  }, [backNavigation, currentTab]);

  // Route user directly when tapping an Android LocalNotification
  useEffect(() => {
    if (!pendingNotificationTarget) return;
    setIsQuickMenuOpen(false);
    setIsNotificationCenterOpen(false);

    if (pendingNotificationTarget.target === 'agenda') {
      setIsAccountModalOpen(false);
      setCurrentTab('agenda');
    } else if (pendingNotificationTarget.target === 'financas') {
      setIsAccountModalOpen(false);
      setCurrentTab('financas');
    } else if (pendingNotificationTarget.target === 'updates') {
      setAccountInitialTab('system');
      setIsAccountModalOpen(true);
    }

    consumeNotificationTarget();
  }, [pendingNotificationTarget, consumeNotificationTarget]);

  if (!onboardingCompleted) {
    return <OnboardingView />;
  }

  const isFinanceLocked = currentTab === 'financas' && financeLockEnabled && biometricNative && !isFinanceUnlocked;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex flex-col font-sans transition-colors selection:bg-indigo-500 selection:text-white">
      <Header
        currentTab={currentTab}
        setCurrentTab={(tab) => {
          setIsQuickMenuOpen(false);
          setCurrentTab(tab);
        }}
        openAccountModal={() => {
          setAccountInitialTab('general');
          setIsAccountModalOpen(true);
        }}
        openNotificationCenter={() => setIsNotificationCenterOpen(true)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-3.5 sm:px-6 lg:px-8 pt-3 sm:pt-6 keyboard-safe-main">
        <NetworkStatusBanner />
        <InAppUpdateBanner />
        <div key={currentTab} className="animate-tab-enter">
          {currentTab === 'dashboard' && (
            <DashboardView
              setCurrentTab={setCurrentTab}
              showTourPrompt={!quickTourDone}
              onOpenQuickTour={() => {
                setIsQuickMenuOpen(false);
                setIsNotificationCenterOpen(false);
                setIsAccountModalOpen(false);
                setIsQuickTourOpen(true);
              }}
              onDismissTourPrompt={() => finishQuickTour()}
            />
          )}
          {currentTab === 'agenda' && (
            <Suspense fallback={<TabLoadingFallback />}>
              <AgendaTasksView
                quickOpenModal={agendaQuickOpen}
                onConsumeQuickOpen={() => setAgendaQuickOpen(null)}
              />
            </Suspense>
          )}
          {currentTab === 'financas' &&
            (isFinanceLocked ? (
              <div className="max-w-md mx-auto mt-8 sm:mt-14 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-xs text-center space-y-5">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200/70 dark:border-indigo-800/70 flex items-center justify-center">
                  <Lock className="w-6 h-6" />
                </div>
                <div className="space-y-1.5">
                  <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                    Finanças Protegidas
                  </h2>
                  <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Confirme sua identidade com biometria ou PIN do aparelho para visualizar saldos e lançamentos.
                  </p>
                </div>

                {financeUnlockError && (
                  <p className="text-xs font-medium text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-xl px-3 py-2">
                    {financeUnlockError}
                  </p>
                )}

                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      hapticImpactLight();
                      void requestFinanceUnlock();
                    }}
                    disabled={isUnlockingFinance}
                    className="pressable w-full h-12 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-md shadow-indigo-600/20 cursor-pointer disabled:opacity-60"
                  >
                    <Fingerprint className="w-4 h-4" />
                    <span>{isUnlockingFinance ? 'Verificando...' : 'Desbloquear com Biometria'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      hapticImpactLight();
                      setCurrentTab('dashboard');
                    }}
                    className="pressable w-full h-10 rounded-xl text-xs font-semibold text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer"
                  >
                    Voltar para Início
                  </button>
                </div>
              </div>
            ) : (
              <Suspense fallback={<TabLoadingFallback />}>
                <FinanceView
                  quickOpenAction={financeQuickOpen}
                  onConsumeQuickOpen={() => setFinanceQuickOpen(null)}
                />
              </Suspense>
            ))}
        </div>
      </main>

      <QuickActionFab
        isOpen={isQuickMenuOpen}
        onOpenChange={setIsQuickMenuOpen}
        onTriggerAgendaModal={(mode) => {
          setCurrentTab('agenda');
          setAgendaQuickOpen(mode);
        }}
        onTriggerFinanceModal={(mode) => {
          setCurrentTab('financas');
          setFinanceQuickOpen(mode);
        }}
      />

      <ToastUndo />

      <MobileNav
        currentTab={currentTab}
        setCurrentTab={(tab) => {
          setIsQuickMenuOpen(false);
          setCurrentTab(tab);
        }}
        isQuickMenuOpen={isQuickMenuOpen}
        onToggleQuickMenu={() => setIsQuickMenuOpen((prev) => !prev)}
      />

      {isAccountModalOpen && (
        <Suspense fallback={null}>
          <AccountSettingsModal
            isOpen={isAccountModalOpen}
            onClose={() => setIsAccountModalOpen(false)}
            initialTab={accountInitialTab}
            onOpenQuickTour={() => setIsQuickTourOpen(true)}
          />
        </Suspense>
      )}

      {isQuickTourOpen && (
        <Suspense fallback={null}>
          <QuickTourModal
            isOpen={isQuickTourOpen}
            onClose={() => finishQuickTour()}
            onComplete={(target) => finishQuickTour(target)}
          />
        </Suspense>
      )}

      {isNotificationCenterOpen && (
        <Suspense fallback={null}>
          <NotificationCenterModal
            isOpen={isNotificationCenterOpen}
            onClose={() => setIsNotificationCenterOpen(false)}
            onOpenAgenda={() => setCurrentTab('agenda')}
          />
        </Suspense>
      )}
    </div>
  );
};

export default function App() {
  const isConnectNative =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('connect_native') === '1';

  useEffect(() => {
    return initKeyboardViewportAdapter();
  }, []);

  return (
    <BackNavigationProvider>
      <AppProvider>
        {isConnectNative ? (
          <Suspense fallback={<TabLoadingFallback />}>
            <NativeConnectBridge />
          </Suspense>
        ) : (
          <>
            <MainApp />
            <AutoRestoredDriveBanner />
            <DriveRestorePromptModal />
            <StartFromScratchModal />
          </>
        )}
      </AppProvider>
    </BackNavigationProvider>
  );
}
