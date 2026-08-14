import * as RadixDialog from '@radix-ui/react-dialog';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { TranslationKey } from '@/lib/i18n/dictionary';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { cn } from '@/lib/utils';
import { useProductsQuery } from '@/services/queries/useProductsQuery';
import { useUiStore } from '@/store/ui.store';

import { useCommandItems, type CommandGroup, type CommandItem } from './useCommandItems';

const GROUP_LABEL: Record<CommandGroup, TranslationKey> = {
  go: 'gGo',
  products: 'gProd',
  actions: 'gAct',
  ask: 'gAsk',
};

/**
 * ⌘K palette.
 *
 * The list is a `listbox` the input owns through `aria-activedescendant`:
 * focus stays in the text field while the arrow keys move a virtual cursor, so
 * typing and navigating never fight over the caret.
 */
export function CommandPalette(): ReactNode {
  const { t } = useTranslation();
  const open = useUiStore((state) => state.paletteOpen);
  const setPaletteOpen = useUiStore((state) => state.setPaletteOpen);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const items = useCommandItems(query);
  /* What the palette can actually search — the catalogue already in cache. */
  const indexed = useProductsQuery().products.length;

  /* Reopening should start from a clean slate, not the previous search. */
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const grouped = useMemo(() => {
    const map = new Map<CommandGroup, CommandItem[]>();
    for (const item of items) {
      const bucket = map.get(item.group) ?? [];
      bucket.push(item);
      map.set(item.group, bucket);
    }
    return [...map.entries()];
  }, [items]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % Math.max(items.length, 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + items.length) % Math.max(items.length, 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      items[activeIndex]?.run();
    }
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={setPaletteOpen}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-[rise_0.14s_ease]" />
        <RadixDialog.Content
          aria-label={t('palPh')}
          className={cn(
            /* Near the top of the screen on a phone so the soft keyboard has
               somewhere to open into, and nearly edge-to-edge because a
               command label is a sentence, not a word. */
            'fixed left-1/2 top-[6vh] z-50 w-[calc(100vw-16px)] -translate-x-1/2',
            'sm:top-[14vh] sm:w-[min(620px,calc(100vw-48px))]',
            'overflow-hidden rounded-14 border border-line-2 bg-panel shadow-[var(--shadow-menu)]',
            'data-[state=open]:animate-[pop_0.16s_ease]',
          )}
        >
          <RadixDialog.Title className="sr-only">{t('palPh')}</RadixDialog.Title>

          <div className="flex items-center gap-10 border-b border-line px-14 py-12">
            <Search aria-hidden className="size-15 shrink-0 text-faint" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('palPh')}
              type="search"
              enterKeyHint="go"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              role="combobox"
              aria-expanded
              aria-controls="command-list"
              aria-activedescendant={items[activeIndex]?.id}
              className="min-w-0 flex-1 border-0 bg-transparent text-md text-text outline-none placeholder:text-faint"
            />
            {/* There is no Escape key on a phone; the backdrop and the back
                gesture dismiss it there. */}
            <kbd className="hidden shrink-0 rounded-5 border border-line-2 px-6 py-px text-tiny text-faint sm:block">
              ESC
            </kbd>
          </div>

          <div
            ref={listRef}
            id="command-list"
            role="listbox"
            aria-label={t('palPh')}
            /* `dvh` and a taller cap: with the keyboard up, `46vh` of a phone
               is about three rows. */
            className="max-h-[50dvh] overflow-auto overscroll-contain p-6 sm:max-h-[46vh]"
          >
            {items.length === 0 ? (
              <p className="m-0 px-9 py-14 text-center text-sm text-faint">{t('palNo')}</p>
            ) : (
              grouped.map(([group, groupItems]) => (
                <div key={group} className="mb-4 last:mb-0">
                  <div className="px-9 pb-3 pt-6 text-meta uppercase tracking-[0.09em] text-faint">
                    {t(GROUP_LABEL[group])}
                  </div>

                  {groupItems.map((item) => {
                    const index = items.indexOf(item);
                    const active = index === activeIndex;
                    const Icon = item.icon;

                    return (
                      <div
                        key={item.id}
                        id={item.id}
                        role="option"
                        aria-selected={active}
                        data-active={active}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={item.run}
                        className={cn(
                          'flex min-h-44 cursor-pointer items-center gap-10 rounded-8 px-9 py-7 text-sm-plus',
                          'sm:min-h-0',
                          active ? 'bg-acc-soft text-acc-dim' : 'text-text',
                        )}
                      >
                        <Icon aria-hidden className="size-14 shrink-0" />
                        <span className="truncate">{item.label}</span>
                        {item.hint !== undefined && (
                          <span className="ml-auto shrink-0 font-mono text-tiny text-faint">
                            {item.hint}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="flex items-center gap-12 border-t border-line px-14 py-8 text-tiny text-faint">
            <span className="hidden sm:inline">↑↓ {t('palNav')}</span>
            <span className="hidden sm:inline">↵ {t('palOpen')}</span>
            <div className="flex-1" />
            <span className="truncate font-mono">{t('palIdxL', { n: indexed })}</span>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
