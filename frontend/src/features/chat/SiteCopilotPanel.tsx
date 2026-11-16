import type { ReactNode } from 'react';

import { CopilotPanel } from '@core/ui/chat/CopilotPanel';
import { ActionConfirmDialog } from '@/features/insights/ActionConfirmDialog';
import { useUiStore } from '@/store/ui.store';

import { useSiteCopilotHost } from './useSiteCopilotHost';

/**
 * The Copilot panel as the site mounts it: docked beside the content, opened
 * and closed by the same `ui` store flag the top bar and the palette toggle,
 * with the site's write-confirmation dialog inside it.
 */
export function SiteCopilotPanel(): ReactNode {
  const { host, runner } = useSiteCopilotHost();
  const chatOpen = useUiStore((state) => state.chatOpen);
  const toggleChat = useUiStore((state) => state.toggleChat);

  return (
    <CopilotPanel
      host={host}
      open={chatOpen}
      onClose={toggleChat}
      layout="docked"
      overlays={<ActionConfirmDialog runner={runner} />}
    />
  );
}
