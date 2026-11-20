import { useCallback, useRef, useState } from 'react';

export interface UndoToastInfo {
  id: string;
  message: string;
  onUndo: () => void;
}

/**
 * Controla o aviso rápido com botão "Desfazer" após excluir tarefas,
 * transações, rascunhos ou datas especiais.
 */
export function useUndoToast() {
  const [undoToast, setUndoToast] = useState<UndoToastInfo | null>(null);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearUndoToast = useCallback(() => {
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    setUndoToast(null);
  }, []);

  const showUndoToast = useCallback((message: string, onUndo: () => void) => {
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    setUndoToast({ id: 'toast-' + Date.now(), message, onUndo });
    undoTimeoutRef.current = setTimeout(() => {
      setUndoToast(null);
    }, 6000);
  }, []);

  return {
    undoToast,
    showUndoToast,
    clearUndoToast,
  };
}
