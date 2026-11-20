import React, { useCallback } from 'react';
import confetti from 'canvas-confetti';
import { hapticImpactLight, hapticSuccess, hapticWarning } from '../../services/hapticsService';
import { TaskItem } from '../../types';

interface UseTasksActionsOptions {
  tasks: TaskItem[];
  setTasks: React.Dispatch<React.SetStateAction<TaskItem[]>>;
  onDataChanged: () => void;
  showUndoToast: (message: string, onUndo: () => void) => void;
}

/**
 * Agrupa as ações de tarefas (criar, editar, concluir, adiar para amanhã,
 * excluir com desfazer e marcar subtarefas).
 */
export function useTasksActions({
  tasks,
  setTasks,
  onDataChanged,
  showUndoToast,
}: UseTasksActionsOptions) {
  const addTask = useCallback(
    (taskData: Omit<TaskItem, 'id'>) => {
      const newTask: TaskItem = {
        ...taskData,
        id: 'task-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      };
      hapticImpactLight();
      setTasks((prev) => [newTask, ...prev]);
      onDataChanged();
    },
    [onDataChanged, setTasks]
  );

  const updateTask = useCallback(
    (id: string, updates: Partial<TaskItem>) => {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
      onDataChanged();
    },
    [onDataChanged, setTasks]
  );

  const toggleTaskCompletion = useCallback(
    (id: string) => {
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          const nextCompleted = !t.completed;
          if (nextCompleted) {
            hapticSuccess();
            confetti({ particleCount: 25, spread: 50, origin: { y: 0.85 } });
          } else {
            hapticImpactLight();
          }
          return {
            ...t,
            completed: nextCompleted,
            completedAt: nextCompleted ? new Date().toISOString() : undefined,
          };
        })
      );
      onDataChanged();
    },
    [onDataChanged, setTasks]
  );

  const snoozeTaskToTomorrow = useCallback(
    (id: string) => {
      const taskToSnooze = tasks.find((t) => t.id === id);
      if (!taskToSnooze) return;

      const previousDueDate = taskToSnooze.dueDate;
      const todayNoon = new Date();
      todayNoon.setHours(12, 0, 0, 0);
      const baseDate = previousDueDate
        ? new Date(`${previousDueDate}T12:00:00`)
        : new Date(todayNoon);
      const anchor =
        Number.isNaN(baseDate.getTime()) || baseDate < todayNoon ? new Date(todayNoon) : baseDate;
      anchor.setDate(anchor.getDate() + 1);

      const tomorrowStr = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(
        2,
        '0'
      )}-${String(anchor.getDate()).padStart(2, '0')}`;

      hapticImpactLight();
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, dueDate: tomorrowStr } : t)));
      onDataChanged();

      const formattedTarget = new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: 'short',
      }).format(anchor);

      showUndoToast(`"${taskToSnooze.title}" adiada para ${formattedTarget}.`, () => {
        hapticImpactLight();
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, dueDate: previousDueDate } : t)));
        onDataChanged();
      });
    },
    [onDataChanged, setTasks, showUndoToast, tasks]
  );

  const deleteTask = useCallback(
    (id: string) => {
      const taskToDelete = tasks.find((t) => t.id === id);
      if (!taskToDelete) return;

      hapticWarning();
      setTasks((prev) => prev.filter((t) => t.id !== id));
      onDataChanged();

      showUndoToast(`Tarefa "${taskToDelete.title}" excluída.`, () => {
        setTasks((prev) => [taskToDelete, ...prev]);
        onDataChanged();
      });
    },
    [onDataChanged, setTasks, showUndoToast, tasks]
  );

  const toggleSubtask = useCallback(
    (taskId: string, subtaskId: string) => {
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== taskId) return t;
          return {
            ...t,
            subtasks: t.subtasks.map((st) =>
              st.id === subtaskId ? { ...st, completed: !st.completed } : st
            ),
          };
        })
      );
      onDataChanged();
    },
    [onDataChanged, setTasks]
  );

  return {
    addTask,
    updateTask,
    toggleTaskCompletion,
    snoozeTaskToTomorrow,
    deleteTask,
    toggleSubtask,
  };
}
