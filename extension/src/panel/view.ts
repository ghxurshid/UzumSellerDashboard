/**
 * Which of the panel's two views is showing, and which settings tab is open.
 *
 * A reducer rather than two `useState`s because the transitions have rules the
 * components should not each re-derive: opening settings keeps the tab the
 * seller last used unless the caller names one (the "not configured" banner
 * names the AI tab), and Escape and the back button both mean "one step back".
 */

export type SettingsTab = 'general' | 'ai' | 'keyboard';

/** The order the strip shows them in, and the order arrow keys walk. */
export const SETTINGS_TABS: readonly SettingsTab[] = ['general', 'ai', 'keyboard'];

export interface PanelView {
  readonly view: 'chat' | 'settings';
  readonly tab: SettingsTab;
}

export const INITIAL_VIEW: PanelView = { view: 'chat', tab: 'general' };

export type PanelViewAction =
  | { readonly type: 'openSettings'; readonly tab?: SettingsTab }
  | { readonly type: 'selectTab'; readonly tab: SettingsTab }
  | { readonly type: 'back' };

export function reduceView(state: PanelView, action: PanelViewAction): PanelView {
  switch (action.type) {
    case 'openSettings':
      return { view: 'settings', tab: action.tab ?? state.tab };
    case 'selectTab':
      return state.tab === action.tab ? state : { ...state, tab: action.tab };
    case 'back':
      return state.view === 'chat' ? state : { ...state, view: 'chat' };
  }
}

/**
 * The tab an arrow/Home/End key moves to, or null when the key is not one the
 * tab strip handles. Wraps at the ends, as a tab strip is expected to.
 */
export function tabAfterKey(current: SettingsTab, key: string): SettingsTab | null {
  const index = SETTINGS_TABS.indexOf(current);
  const last = SETTINGS_TABS.length - 1;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return SETTINGS_TABS[index === last ? 0 : index + 1] ?? null;
    case 'ArrowLeft':
    case 'ArrowUp':
      return SETTINGS_TABS[index <= 0 ? last : index - 1] ?? null;
    case 'Home':
      return SETTINGS_TABS[0] ?? null;
    case 'End':
      return SETTINGS_TABS[last] ?? null;
    default:
      return null;
  }
}
