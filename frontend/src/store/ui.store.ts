import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Which chrome affordance owns the window right now. */
export type WindowState = 'open' | 'min' | 'closed';

/** The dropdown currently open in the topbar; only one at a time. */
export type OpenMenu = 'store' | 'range' | 'bell' | 'filters' | null;

interface UiState {
  readonly windowState: WindowState;
  readonly docked: boolean;
  readonly maximized: boolean;

  readonly menu: OpenMenu;
  readonly paletteOpen: boolean;
  readonly chatOpen: boolean;
  readonly insightsOpen: boolean;

  setWindowState: (windowState: WindowState) => void;
  toggleDock: () => void;
  toggleMaximize: () => void;

  setMenu: (menu: OpenMenu) => void;
  toggleMenu: (menu: NonNullable<OpenMenu>) => void;
  closeMenu: () => void;

  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  toggleChat: () => void;
  setChatOpen: (open: boolean) => void;
  toggleInsights: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      windowState: 'open',
      docked: false,
      /* The app fills the viewport by default; the floating-panel look is the
         opt-out, reached by toggling maximise off. */
      maximized: true,

      menu: null,
      paletteOpen: false,
      chatOpen: false,
      insightsOpen: true,

      setWindowState: (windowState) => set({ windowState }),
      toggleDock: () => set((s) => ({ docked: !s.docked, maximized: false })),
      toggleMaximize: () => set((s) => ({ maximized: !s.maximized, docked: false })),

      setMenu: (menu) => set({ menu }),
      toggleMenu: (menu) => set((s) => ({ menu: s.menu === menu ? null : menu })),
      closeMenu: () => set({ menu: null }),

      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
      toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
      setChatOpen: (chatOpen) => set({ chatOpen }),
      toggleInsights: () => set((s) => ({ insightsOpen: !s.insightsOpen })),
    }),
    {
      name: 'savdo.ui',
      /* v2 made full-screen the default; a stored `maximized: false` from v1 is
         the old default rather than a choice, so it is dropped. */
      version: 2,
      migrate: (persisted, from) =>
        from < 2
          ? { ...(persisted as Partial<UiState>), docked: false, maximized: true }
          : persisted,
      /* Transient overlays must not survive a reload — only layout intent does. */
      partialize: (state) => ({
        docked: state.docked,
        maximized: state.maximized,
        insightsOpen: state.insightsOpen,
        chatOpen: state.chatOpen,
      }),
    },
  ),
);
