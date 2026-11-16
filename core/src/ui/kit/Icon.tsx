import type { ReactNode } from 'react';

import { resolveIcon } from './iconRegistry';

interface IconProps {
  readonly name: string;
  readonly className?: string;
}

/** Renders a registry icon by name; see `iconRegistry` for the mapping. */
export function Icon({ name, className }: IconProps): ReactNode {
  const Component = resolveIcon(name);
  return <Component aria-hidden className={className} />;
}
