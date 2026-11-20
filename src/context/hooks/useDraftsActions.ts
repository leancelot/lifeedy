import React, { useCallback } from 'react';
import { hapticImpactLight, hapticSuccess } from '../../services/hapticsService';
import { DraftNote, TaskItem } from '../../types';

interface UseDraftsActionsOptions {
  draftNotes: DraftNote[];
  setDraftNotes: React.Dispatch<React.SetStateAction<DraftNote[]>>;
  setTasks: React.Dispatch<React.SetStateAction<TaskItem[]>>;
  onDataChanged: () => void;
  showUndoToast: (message: string, onUndo: () => void) => void;
}

/**
 * Gerencia anotações rápidas, listas de verificação (checklists)
 * e conversão de rascunhos diretamente em tarefas.
 */
export function useDraftsActions({
  draftNotes,
  setDraftNotes,
  setTasks,
  onDataChanged,
  showUndoToast,
}: UseDraftsActionsOptions) {
  const addDraftNote = useCallback(
    (noteData: Omit<DraftNote, 'id' | 'updatedAt'>) => {
      const newNote: DraftNote = {
        ...noteData,
        id: 'draft-' + Date.now(),
        updatedAt: new Date().toISOString(),
      };
      setDraftNotes((prev) => [newNote, ...prev]);
      onDataChanged();
    },
    [onDataChanged, setDraftNotes]
  );

  const updateDraftNote = useCallback(
    (id: string, updates: Partial<DraftNote>) => {
      setDraftNotes((prev) =>
        prev.map((d) =>
          d.id === id ? { ...d, ...updates, updatedAt: new Date().toISOString() } : d
        )
      );
      onDataChanged();
    },
    [onDataChanged, setDraftNotes]
  );

  const deleteDraftNote = useCallback(
    (id: string) => {
      const draftToDelete = draftNotes.find((d) => d.id === id);
      if (!draftToDelete) return;

      setDraftNotes((prev) => prev.filter((d) => d.id !== id));
      onDataChanged();

      showUndoToast(`Rascunho "${draftToDelete.title}" excluído.`, () => {
        setDraftNotes((prev) => [draftToDelete, ...prev]);
        onDataChanged();
      });
    },
    [draftNotes, onDataChanged, setDraftNotes, showUndoToast]
  );

  const togglePinDraft = useCallback(
    (id: string) => {
      setDraftNotes((prev) =>
        prev.map((d) => (d.id === id ? { ...d, isPinned: !d.isPinned } : d))
      );
      onDataChanged();
    },
    [onDataChanged, setDraftNotes]
  );

  const toggleDraftChecklistItem = useCallback(
    (draftId: string, itemId: string) => {
      setDraftNotes((prev) =>
        prev.map((d) => {
          if (d.id !== draftId || !d.checklistItems) return d;
          const nextItems = d.checklistItems.map((item) => {
            if (item.id !== itemId) return item;
            const nextDone = !item.completed;
            if (nextDone) hapticSuccess();
            else hapticImpactLight();
            return { ...item, completed: nextDone };
          });
          return {
            ...d,
            checklistItems: nextItems,
            updatedAt: new Date().toISOString(),
          };
        })
      );
      onDataChanged();
    },
    [onDataChanged, setDraftNotes]
  );

  const addDraftChecklistItem = useCallback(
    (draftId: string, text: string) => {
      const cleaned = text.trim();
      if (!cleaned) return;
      hapticImpactLight();
      setDraftNotes((prev) =>
        prev.map((d) => {
          if (d.id !== draftId) return d;
          const nextItems = [
            ...(d.checklistItems || []),
            {
              id: `chk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              text: cleaned,
              completed: false,
            },
          ];
          return {
            ...d,
            kind: d.kind || 'list',
            checklistItems: nextItems,
            updatedAt: new Date().toISOString(),
          };
        })
      );
      onDataChanged();
    },
    [onDataChanged, setDraftNotes]
  );

  const convertDraftToTask = useCallback(
    (draft: DraftNote) => {
      const d = new Date();
      const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
      ).padStart(2, '0')}`;

      const subtasks = (draft.checklistItems || []).map((item, idx) => ({
        id: `st-draft-${Date.now()}-${idx}`,
        title: item.text,
        completed: item.completed,
      }));

      const newTask: TaskItem = {
        id: 'task-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        title: draft.title.trim() || draft.content.trim().slice(0, 60) || 'Tarefa do rascunho',
        description:
          draft.content.trim() && draft.content.trim() !== draft.title.trim()
            ? draft.content.trim()
            : undefined,
        dueDate: todayStr,
        priority: 'medium',
        category: 'pessoal',
        completed: false,
        subtasks,
      };

      hapticSuccess();
      setTasks((prev) => [newTask, ...prev]);
      onDataChanged();
      showUndoToast(`"${newTask.title}" adicionada às tarefas de hoje.`, () => {
        setTasks((prev) => prev.filter((t) => t.id !== newTask.id));
        onDataChanged();
      });
    },
    [onDataChanged, setTasks, showUndoToast]
  );

  return {
    addDraftNote,
    updateDraftNote,
    deleteDraftNote,
    togglePinDraft,
    toggleDraftChecklistItem,
    addDraftChecklistItem,
    convertDraftToTask,
  };
}
