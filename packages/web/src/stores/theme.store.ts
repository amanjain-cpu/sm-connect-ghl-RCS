// ===========================================
// Theme Store
// ===========================================

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { getSafeStorage } from '@/lib/storage';

type Theme = 'light' | 'dark' | 'system';
const EMBEDDED_LIGHT_PATHS = new Set(['/auth/embed', '/billing']);

interface ThemeState {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  forceLightMode: () => void;
}

const isEmbeddedContext = () => {
  if (typeof window === 'undefined') return false;

  return (
    window.self !== window.top ||
    EMBEDDED_LIGHT_PATHS.has(window.location.pathname)
  );
};

const getSystemTheme = (): 'light' | 'dark' => {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const getDefaultTheme = (): Theme => (isEmbeddedContext() ? 'light' : 'system');

const resolveTheme = (theme: Theme): 'light' | 'dark' => {
  if (isEmbeddedContext()) {
    return 'light';
  }

  if (theme === 'system') {
    return getSystemTheme();
  }
  return theme;
};

const applyTheme = (resolvedTheme: 'light' | 'dark') => {
  const root = window.document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolvedTheme);
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: getDefaultTheme(),
      resolvedTheme: resolveTheme(getDefaultTheme()),

      setTheme: (theme: Theme) => {
        const nextTheme = isEmbeddedContext() ? 'light' : theme;
        const resolvedTheme = resolveTheme(nextTheme);
        applyTheme(resolvedTheme);
        set({ theme: nextTheme, resolvedTheme });
      },

      toggleTheme: () => {
        if (isEmbeddedContext()) {
          applyTheme('light');
          set({ theme: 'light', resolvedTheme: 'light' });
          return;
        }

        const current = get().resolvedTheme;
        const newTheme = current === 'dark' ? 'light' : 'dark';
        applyTheme(newTheme);
        set({ theme: newTheme, resolvedTheme: newTheme });
      },

      forceLightMode: () => {
        applyTheme('light');
        set({ theme: 'light', resolvedTheme: 'light' });
      },
    }),
    {
      name: 'theme-storage',
      storage: createJSONStorage(() => getSafeStorage()),
      onRehydrateStorage: () => (state) => {
        if (state) {
          const theme = isEmbeddedContext() ? 'light' : state.theme;
          const resolvedTheme = resolveTheme(theme);
          applyTheme(resolvedTheme);
          state.theme = theme;
          state.resolvedTheme = resolvedTheme;
        }
      },
    }
  )
);

// Listen for system theme changes
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    const state = useThemeStore.getState();
    if (state.theme === 'system' && !isEmbeddedContext()) {
      const resolvedTheme = e.matches ? 'dark' : 'light';
      applyTheme(resolvedTheme);
      useThemeStore.setState({ resolvedTheme });
    }
  });
}
