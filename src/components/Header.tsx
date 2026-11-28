import React from 'react';
import { Capacitor } from '@capacitor/core';
import { Bell, Eye, EyeOff, Moon, Search, Settings, Sparkles, Sun } from 'lucide-react';
import { useFinance, usePlanner, useWorkspace } from '../context/AppContext';
import { hapticImpactLight, hapticSelection } from '../services/hapticsService';

interface HeaderProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  openAccountModal: () => void;
  openNotificationCenter: () => void;
  openGlobalSearch: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  setCurrentTab,
  openAccountModal,
  openNotificationCenter,
  openGlobalSearch,
}) => {
  const {
    theme,
    toggleTheme,
    userName,
    appUpdateResult,
    backupHealth,
  } = useWorkspace();
  const { notificationsList } = usePlanner();
  const { hideValues, toggleHideValues, pendingBankNotifications } = useFinance();

  const todayStr = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date());

  const capitalizedToday = todayStr.charAt(0).toUpperCase() + todayStr.slice(1);
  const unreadCount =
    notificationsList.filter((n) => !n.read).length +
    pendingBankNotifications.length +
    (backupHealth.shouldRemind ? 1 : 0);
  const hasAppUpdate = Capacitor.isNativePlatform() && Boolean(appUpdateResult?.hasUpdate);

  return (
    <header className="sticky top-0 z-30 pt-[max(env(safe-area-inset-top,0px),var(--safe-area-inset-top,0px))] bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border-b border-zinc-200/80 dark:border-zinc-800 transition-colors">
      <div className="max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-13 sm:h-14 gap-3 sm:gap-6">
          {/* Zone 1: Brand + compact date */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#DC7B62] to-[#BE6272] dark:from-[#F2A68E] dark:to-[#E69BA7] flex items-center justify-center text-white dark:text-[#24120E] shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="font-bold text-base text-zinc-900 dark:text-zinc-100 tracking-tight whitespace-nowrap shrink-0">
                Lifeedy
              </span>
              <span className="text-xs text-zinc-400 dark:text-zinc-500 hidden sm:inline whitespace-nowrap">
                · {capitalizedToday}
              </span>
            </div>
          </div>

          {/* Zone 2: Desktop Tabs (3 primary areas) */}
          <nav
            data-tour="nav-bar"
            className="hidden md:flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800/70 p-1 rounded-xl border border-zinc-200/60 dark:border-zinc-800"
          >
            {[
              { id: 'dashboard', label: 'Início' },
              { id: 'agenda', label: 'Agenda' },
              { id: 'financas', label: 'Finanças' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  hapticSelection();
                  setCurrentTab(tab.id);
                }}
                className={`pressable px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                  currentTab === tab.id
                    ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-2xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: Minimal Right Controls */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                hapticSelection();
                openGlobalSearch();
              }}
              title="Busca global (Ctrl+K)"
              aria-label="Busca global"
              className="pressable w-9 h-9 flex items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-zinc-200/80 dark:border-zinc-700/80 hover:bg-zinc-200/70 dark:hover:bg-zinc-700 cursor-pointer shrink-0"
            >
              <Search className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={toggleHideValues}
              title={hideValues ? 'Mostrar valores financeiros' : 'Ocultar valores financeiros'}
              aria-label={hideValues ? 'Mostrar valores financeiros' : 'Ocultar valores financeiros'}
              aria-pressed={hideValues}
              className={`pressable w-9 h-9 flex items-center justify-center rounded-xl border cursor-pointer shrink-0 ${
                hideValues
                  ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border-zinc-200/80 dark:border-zinc-700/80 hover:bg-zinc-200/70 dark:hover:bg-zinc-700'
              }`}
            >
              {hideValues ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => {
                hapticImpactLight();
                toggleTheme();
              }}
              title={theme === 'dark' ? 'Mudar para tema Claro' : 'Mudar para tema Escuro'}
              aria-label={theme === 'dark' ? 'Mudar para tema Claro' : 'Mudar para tema Escuro'}
              className="pressable w-9 h-9 flex items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-zinc-200/80 dark:border-zinc-700/80 hover:bg-zinc-200/70 dark:hover:bg-zinc-700 cursor-pointer shrink-0"
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-zinc-600" />
              )}
            </button>

            <button
              type="button"
              data-tour="notifications"
              onClick={() => {
                hapticSelection();
                openNotificationCenter();
              }}
              title="Notificações e Lembretes"
              aria-label="Notificações e Lembretes"
              className="pressable relative w-9 h-9 flex items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border border-zinc-200/80 dark:border-zinc-700/80 hover:bg-zinc-200/70 dark:hover:bg-zinc-700 cursor-pointer shrink-0"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-indigo-600 text-white text-[10px] font-bold font-mono tabular-nums min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>

            <button
              type="button"
              data-tour="settings"
              onClick={() => {
                hapticSelection();
                openAccountModal();
              }}
              title={
                userName
                  ? `${userName} · Backup e Configurações`
                  : 'Backup e Configurações'
              }
              aria-label="Backup e Configurações"
              className={`pressable relative w-9 h-9 rounded-xl border flex items-center justify-center cursor-pointer shrink-0 overflow-visible ${
                hasAppUpdate
                  ? 'border-amber-400 dark:border-amber-500 bg-amber-50 dark:bg-amber-950/40'
                  : 'border-zinc-200/80 dark:border-zinc-700/80 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200/70 dark:hover:bg-zinc-700'
              }`}
            >
              <Settings className="w-4 h-4 text-zinc-700 dark:text-zinc-200" />
              {hasAppUpdate && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500 border-2 border-white dark:border-zinc-900" />
              )}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
