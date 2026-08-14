import { useCallback, useMemo, useState } from 'react';

export type HeaderCheckboxState = 'none' | 'some' | 'all';

interface UseRowSelectionResult {
  readonly selected: ReadonlySet<string>;
  /** Stable array form, for actions that send the selection to the API. */
  readonly selectedIds: readonly string[];
  readonly count: number;
  readonly headerState: HeaderCheckboxState;
  readonly isSelected: (id: string) => boolean;
  readonly toggle: (id: string) => void;
  readonly toggleAll: () => void;
  readonly clear: () => void;
}

/**
 * Table row selection.
 *
 * `visibleIds` is the current page, so "select all" means the rows the user can
 * see — silently selecting 600 filtered-out rows behind a checkbox is how bulk
 * actions become destructive by accident.
 */
export function useRowSelection(visibleIds: readonly string[]): UseRowSelectionResult {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const headerState = useMemo<HeaderCheckboxState>(() => {
    if (visibleIds.length === 0) return 'none';
    const picked = visibleIds.filter((id) => selected.has(id)).length;
    if (picked === 0) return 'none';
    return picked === visibleIds.length ? 'all' : 'some';
  }, [selected, visibleIds]);

  const toggleAll = useCallback(() => {
    setSelected((current) => {
      const allPicked = visibleIds.length > 0 && visibleIds.every((id) => current.has(id));
      const next = new Set(current);
      for (const id of visibleIds) {
        if (allPicked) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, [visibleIds]);

  const clear = useCallback(() => setSelected(new Set()), []);

  return {
    selected,
    selectedIds: useMemo(() => [...selected], [selected]),
    count: selected.size,
    headerState,
    isSelected: useCallback((id: string) => selected.has(id), [selected]),
    toggle,
    toggleAll,
    clear,
  };
}
