import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY_THEME = 'vidaorganizada_theme_v1';

export type AppThemeMode = 'light' | 'dark';

/**
 * Gerencia o tema visual (Claro/Escuro), salva a preferência no aparelho
 * e sincroniza a cor da barra de status no HTML.
 */
export function useThemePreference() {
  const [theme, setTheme] = useState<AppThemeMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_THEME);
      if (saved === 'dark' || saved === 'light') return saved;
      if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
        return 'dark';
      }
    } catch {
      // ignora erro de armazenamento
    }
    return 'dark';
  });

  useEffect(() => {
    const isDark = theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.style.colorScheme = theme;

    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', isDark ? '#1C1715' : '#FAF6F1');
    }

    try {
      localStorage.setItem(STORAGE_KEY_THEME, theme);
    } catch {
      // ignora erro de armazenamento
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const setThemeMode = useCallback((mode: AppThemeMode) => {
    setTheme(mode);
  }, []);

  return {
    theme,
    toggleTheme,
    setThemeMode,
  };
}
