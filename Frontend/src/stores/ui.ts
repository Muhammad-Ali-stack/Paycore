'use client';

/**
 * Light client state (Zustand). Nothing sensitive lives here: no tokens, no PII.
 * - theme: mirrored to a plain cookie so the server renders the right data-theme (no flash).
 * - hideBalances: per-device preference (localStorage).
 * - locked: auto-lock overlay state (memory only).
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ThemePref = 'dark' | 'light';

type UiState = {
  theme: ThemePref;
  hideBalances: boolean;
  locked: boolean;
  setTheme: (t: ThemePref) => void;
  toggleHideBalances: () => void;
  lock: () => void;
  unlock: () => void;
};

function applyTheme(t: ThemePref) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = t;
  document.cookie = `pc_theme=${t}; path=/; max-age=31536000; samesite=lax`;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: 'dark',
      hideBalances: false,
      locked: false,
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      toggleHideBalances: () => set((s) => ({ hideBalances: !s.hideBalances })),
      lock: () => set({ locked: true }),
      unlock: () => set({ locked: false }),
    }),
    {
      name: 'pc.ui',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ theme: s.theme, hideBalances: s.hideBalances }),
      skipHydration: true,
    },
  ),
);
