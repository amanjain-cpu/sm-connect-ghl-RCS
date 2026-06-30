// ===========================================
// Theme Store
// ===========================================

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { getSafeStorage } from '@/lib/storage';

type Theme = 'light' | 'dark' | 'system';

interface ThemeState {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  forceLightMode: () => void;
}

const applyTheme = () => {
  if (typeof window === 'undefined') return;

  const root = window.document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add('light');
  root.style.colorScheme = 'light';
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'light',
      resolvedTheme: 'light',

      setTheme: (_theme: Theme) => {
        applyTheme();
        set({ theme: 'light', resolvedTheme: 'light' });
      },

      toggleTheme: () => {
        applyTheme();
        set({ theme: 'light', resolvedTheme: 'light' });
      },

      forceLightMode: () => {
        applyTheme();
        set({ theme: 'light', resolvedTheme: 'light' });
      },
    }),
    {
      name: 'theme-storage',
      storage: createJSONStorage(() => getSafeStorage()),
      onRehydrateStorage: () => (state) => {
        applyTheme();
        if (state) {
          state.theme = 'light';
          state.resolvedTheme = 'light';
        }
      },
    }
  )
);
