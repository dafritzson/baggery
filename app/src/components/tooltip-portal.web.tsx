import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Web: draws a hover card at the end of the page, so it sits above everything after it. */
export function TooltipPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
