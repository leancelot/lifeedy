export type QuickTourTarget = 'dashboard' | 'agenda' | 'financas' | 'settings';

export interface QuickTourStep {
  id: 'nav-bar' | 'quick-add' | 'notifications' | 'settings';
  stepNumber: 1 | 2 | 3 | 4;
  selector: string;
  spotlightRadius: number;
  title: string;
  description: string;
  target: QuickTourTarget;
}

export const QUICK_TOUR_STORAGE_KEY = 'lifeedy_quick_tour_done_v1';

export const QUICK_TOUR_STEPS: readonly QuickTourStep[] = [
  {
    id: 'nav-bar',
    stepNumber: 1,
    selector: '[data-tour="nav-bar"]',
    spotlightRadius: 24,
    title: 'Barra principal',
    description: 'Alterne em um toque entre Início, Agenda e Finanças.',
    target: 'dashboard',
  },
  {
    id: 'quick-add',
    stepNumber: 2,
    selector: '[data-tour="quick-add"]',
    spotlightRadius: 16,
    title: 'Botão de ação rápida (+)',
    description: 'Crie tarefa, evento ou gasto na hora, sem sair da tela atual.',
    target: 'agenda',
  },
  {
    id: 'notifications',
    stepNumber: 3,
    selector: '[data-tour="notifications"]',
    spotlightRadius: 12,
    title: 'Central de avisos',
    description: 'Reúne lembretes da Agenda, vencimentos e notificações de bancos.',
    target: 'financas',
  },
  {
    id: 'settings',
    stepNumber: 4,
    selector: '[data-tour="settings"]',
    spotlightRadius: 12,
    title: 'Backup e Configurações',
    description: 'Tema, backup cifrado (.lifeedy), cofre local, biometria e atualizações.',
    target: 'settings',
  },
];

export function findVisibleTourTarget(selector: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
  for (const el of nodes) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return el;
    }
  }
  return null;
}

function getSafeStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
    return null;
  } catch {
    return null;
  }
}

export function hasCompletedQuickTour(): boolean {
  try {
    return getSafeStorage()?.getItem(QUICK_TOUR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markQuickTourCompleted(): void {
  try {
    getSafeStorage()?.setItem(QUICK_TOUR_STORAGE_KEY, '1');
  } catch {
    // ignore storage quota / private mode failures
  }
}

export function resetQuickTourProgress(): void {
  try {
    getSafeStorage()?.removeItem(QUICK_TOUR_STORAGE_KEY);
  } catch {
    // ignore
  }
}
