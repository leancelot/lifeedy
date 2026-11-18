import React from 'react';
import { CheckCircle2, CloudUpload, WifiOff, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const NetworkStatusBanner: React.FC = () => {
  const {
    isOnline,
    justReconnected,
    dismissReconnectedBanner,
    user,
    syncToDriveNow,
    driveSyncInfo,
  } = useApp();

  if (isOnline && !justReconnected) {
    return null;
  }

  if (!isOnline) {
    return (
      <div
        role="status"
        className="mb-3 px-3.5 py-2.5 rounded-2xl bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800/70 flex items-center justify-between gap-3 animate-tab-enter"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <WifiOff className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <p className="text-xs text-amber-800 dark:text-amber-200 leading-snug">
            Sem internet · Modo offline ativo. Suas alterações continuam salvas com segurança no aparelho.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="mb-3 px-3.5 py-2.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/70 flex flex-wrap items-center justify-between gap-2 animate-tab-enter"
    >
      <div className="flex items-center gap-2 min-w-0">
        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <p className="text-xs font-medium text-emerald-800 dark:text-emerald-200">
          Conexão restabelecida.
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {user && driveSyncInfo.status !== 'syncing' && (
          <button
            type="button"
            onClick={() => void syncToDriveNow()}
            className="pressable min-h-[32px] px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
          >
            <CloudUpload className="w-3 h-3" />
            <span>Sincronizar Drive</span>
          </button>
        )}
        <button
          type="button"
          onClick={dismissReconnectedBanner}
          aria-label="Fechar aviso de reconexão"
          className="pressable w-7 h-7 rounded-lg text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 flex items-center justify-center cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
