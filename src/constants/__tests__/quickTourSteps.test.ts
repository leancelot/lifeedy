import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QUICK_TOUR_STEPS,
  QUICK_TOUR_STORAGE_KEY,
  hasCompletedQuickTour,
  markQuickTourCompleted,
  resetQuickTourProgress,
} from '../quickTourSteps';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

describe('quickTourSteps', () => {
  let memoryStorage: Storage;

  beforeEach(() => {
    memoryStorage = createMemoryStorage();
    vi.stubGlobal('localStorage', memoryStorage);
  });

  afterEach(() => {
    resetQuickTourProgress();
    vi.unstubAllGlobals();
  });

  it('defines 4 concise interactive spotlight steps targeting live UI controls', () => {
    expect(QUICK_TOUR_STEPS).toHaveLength(4);
    expect(QUICK_TOUR_STEPS.map((s) => s.stepNumber)).toEqual([1, 2, 3, 4]);
    expect(QUICK_TOUR_STEPS.map((s) => s.selector)).toEqual([
      '[data-tour="nav-bar"]',
      '[data-tour="quick-add"]',
      '[data-tour="notifications"]',
      '[data-tour="settings"]',
    ]);

    const uniqueIds = new Set(QUICK_TOUR_STEPS.map((s) => s.id));
    expect(uniqueIds.size).toBe(4);

    for (const step of QUICK_TOUR_STEPS) {
      expect(step.title.trim().length).toBeGreaterThan(0);
      expect(step.description.trim().length).toBeGreaterThan(0);
      expect(step.spotlightRadius).toBeGreaterThan(0);
    }
  });

  it('persists completion state in localStorage when available', () => {
    expect(hasCompletedQuickTour()).toBe(false);
    markQuickTourCompleted();
    expect(hasCompletedQuickTour()).toBe(true);
    expect(memoryStorage.getItem(QUICK_TOUR_STORAGE_KEY)).toBe('1');
    resetQuickTourProgress();
    expect(hasCompletedQuickTour()).toBe(false);
  });
});
