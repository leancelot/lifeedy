import { useCallback, useState } from 'react';
import { useBackHandler } from '../BackNavigationContext';
import { ConfirmDialogConfig } from '../../components/Common/GlobalConfirmModal';

export interface ConfirmActionInput {
  title: string;
  message: string;
  details?: string[];
  confirmText?: string;
  isDestructive?: boolean;
  onConfirm: () => Promise<void> | void;
}

const CLOSED_CONFIRM: ConfirmDialogConfig = {
  isOpen: false,
  title: '',
  message: '',
};

/**
 * Controla a abertura, botão Voltar do Android e estado de carregamento
 * da caixa de confirmação global.
 */
export function useConfirmDialog() {
  const [confirmConfig, setConfirmConfig] = useState<ConfirmDialogConfig>(CLOSED_CONFIRM);

  const closeConfirmDialog = useCallback(() => {
    setConfirmConfig((prev) => (prev.isProcessing ? prev : { ...prev, isOpen: false }));
  }, []);

  useBackHandler(confirmConfig.isOpen, () => {
    if (confirmConfig.isProcessing) return false;
    setConfirmConfig((prev) => ({ ...prev, isOpen: false }));
    return true;
  });

  const confirmDestructiveAction = useCallback((config: ConfirmActionInput) => {
    setConfirmConfig({
      isOpen: true,
      title: config.title,
      message: config.message,
      details: config.details,
      confirmText: config.confirmText,
      isDestructive: config.isDestructive ?? true,
      isProcessing: false,
      onConfirm: async () => {
        try {
          setConfirmConfig((prev) => ({ ...prev, isProcessing: true }));
          await config.onConfirm();
          setConfirmConfig((prev) => ({ ...prev, isOpen: false, isProcessing: false }));
        } catch (err) {
          console.error('Erro na ação confirmada:', err);
          setConfirmConfig((prev) => ({ ...prev, isProcessing: false }));
        }
      },
    });
  }, []);

  return {
    confirmConfig,
    closeConfirmDialog,
    confirmDestructiveAction,
  };
}
