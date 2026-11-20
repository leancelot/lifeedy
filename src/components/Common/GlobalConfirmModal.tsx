import React from 'react';
import { hapticSelection } from '../../services/hapticsService';

export interface ConfirmDialogConfig {
  isOpen: boolean;
  title: string;
  message: string;
  details?: string[];
  confirmText?: string;
  isDestructive?: boolean;
  isProcessing?: boolean;
  onConfirm?: () => Promise<void> | void;
}

interface GlobalConfirmModalProps {
  config: ConfirmDialogConfig;
  onClose: () => void;
}

/**
 * Modal global reutilizado antes de ações importantes ou irreversíveis
 * (como apagar um evento da agenda ou reiniciar dados).
 */
export const GlobalConfirmModal: React.FC<GlobalConfirmModalProps> = ({ config, onClose }) => {
  if (!config.isOpen) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !config.isProcessing) {
          hapticSelection();
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-backdrop-in keyboard-modal-backdrop"
    >
      <div className="w-full sm:max-w-md bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-6 keyboard-modal-sheet overflow-y-auto relative animate-bottom-sheet">
        <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mb-3 shrink-0" />
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {config.title}
        </h3>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {config.message}
        </p>
        {config.details && config.details.length > 0 && (
          <div className="mt-3 p-3 bg-zinc-50 dark:bg-zinc-800/60 rounded-xl text-xs text-zinc-600 dark:text-zinc-400 space-y-1">
            {config.details.map((d, i) => (
              <div key={i}>• {d}</div>
            ))}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => {
              hapticSelection();
              onClose();
            }}
            disabled={config.isProcessing}
            className="pressable min-h-[40px] px-4 py-2 rounded-xl text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={config.onConfirm}
            disabled={config.isProcessing}
            className={`pressable min-h-[40px] px-4 py-2 rounded-xl text-sm font-medium text-white shadow-xs cursor-pointer ${
              config.isDestructive
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-indigo-600 hover:bg-indigo-700'
            } ${config.isProcessing ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            {config.isProcessing ? 'Processando...' : config.confirmText || 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
};
