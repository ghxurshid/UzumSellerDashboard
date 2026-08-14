import { Cpu, Minus, PanelRight, Maximize2, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { IconButton } from '@/components/ui/IconButton';
import { APP_VERSION_LABEL } from '@/constants/app';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useAiModelLabel } from '@/store/settings.store';
import { useUiStore } from '@/store/ui.store';

import { BrandMark } from './BrandMark';

/**
 * The extension window's title bar: brand, model indicator and the four window
 * controls. `wide` hides the descriptive chrome when the window is docked to a
 * 470px side panel, matching the design's breakpoint behaviour.
 */
export function TitleBar({ wide }: { readonly wide: boolean }): ReactNode {
  const { t } = useTranslation();
  const modelLabel = useAiModelLabel();

  const docked = useUiStore((state) => state.docked);
  const maximized = useUiStore((state) => state.maximized);
  const toggleDock = useUiStore((state) => state.toggleDock);
  const toggleMaximize = useUiStore((state) => state.toggleMaximize);
  const setWindowState = useUiStore((state) => state.setWindowState);

  return (
    <header className="flex h-38 shrink-0 items-center gap-10 border-b border-line bg-chrome pl-12 pr-10 select-none">
      <BrandMark size={19} />
      <span className="text-xs font-medium uppercase tracking-[0.16em]">Savdo</span>

      {wide && (
        <>
          <span className="text-mini text-faint">{t('tagline')}</span>
          <span className="h-16 w-px bg-line" />
          <span className="rounded-5 border border-line-2 px-7 py-2 text-tiny text-dim">
            {APP_VERSION_LABEL}
          </span>
        </>
      )}

      <div className="flex-1" />

      {wide && (
        <span className="mr-4 flex items-center gap-5 text-mini text-faint">
          <Cpu aria-hidden className="size-12" />
          {modelLabel}
        </span>
      )}

      <div className="flex items-center gap-px text-dim">
        <IconButton
          label={t('dock')}
          size="sm"
          active={docked}
          onClick={toggleDock}
        >
          <PanelRight aria-hidden className="size-13" />
        </IconButton>
        <IconButton label={t('min')} size="sm" onClick={() => setWindowState('min')}>
          <Minus aria-hidden className="size-13" />
        </IconButton>
        <IconButton
          label={t('max')}
          size="sm"
          active={maximized}
          onClick={toggleMaximize}
        >
          <Maximize2 aria-hidden className="size-13" />
        </IconButton>
        <IconButton
          label={t('close')}
          size="sm"
          variant="danger"
          onClick={() => setWindowState('closed')}
        >
          <X aria-hidden className="size-13" />
        </IconButton>
      </div>
    </header>
  );
}
