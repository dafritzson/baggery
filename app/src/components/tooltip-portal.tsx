import type { ReactNode } from 'react';

/** Phones have no hover cards (tooltip-portal.web.tsx has the web one). */
export function TooltipPortal(_: { children: ReactNode }) {
  return null;
}
