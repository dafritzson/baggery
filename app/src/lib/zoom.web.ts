import { flushSync } from 'react-dom';

import type { ZoomDirection } from './zoom-marks';

export { type ZoomDirection, zoomFixed, zoomKey, zoomView } from './zoom-marks';

type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } };

/** The scrolling page the zooming view sits in: the zoom is cut off at its edges. */
function scroller(): HTMLElement | null {
  let el = document.querySelector<HTMLElement>('[data-zoom-view]')?.parentElement ?? null;
  while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
  return el;
}

/** Whether `el` shows in the page, clear of the phone tab bar floating over its bottom. */
function inSight(el: HTMLElement, page: HTMLElement): boolean {
  const a = el.getBoundingClientRect();
  const b = page.getBoundingClientRect();
  const bar = document.querySelector('[data-tab-bar]')?.getBoundingClientRect().height ?? 0;
  return a.top >= b.top && Math.min(a.bottom, a.top + 80) <= b.bottom - bar;
}

/** Where `el` sits in `box`, as a transform-origin, so the view zooms into or out of it. */
function originIn(el: HTMLElement | null, box: HTMLElement): string {
  if (!el) return '50% 0';
  const a = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const x = ((a.left + a.width / 2 - b.left) / b.width) * 100;
  const y = ((a.top + a.height / 2 - b.top) / b.height) * 100;
  return `${x.toFixed(1)}% ${y.toFixed(1)}%`;
}

/**
 * View Transitions: the page scales up and fades (in) or down (out) around the focused game,
 * which morphs from its place in the old view to its place in the new one (global.css has the
 * animations). Browsers without them, or with reduced motion on, just switch.
 */
export function zoom(direction: ZoomDirection, update: () => void, focus?: string): void {
  const doc = document as ViewTransitionDocument;
  const page = scroller();
  if (!doc.startViewTransition || !page || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update();
    return;
  }
  const root = document.documentElement;
  const find = () => (focus ? document.querySelector<HTMLElement>(`[data-zoom-key="${CSS.escape(focus)}"]`) : null);
  const before = find();
  root.style.setProperty('--zoom-from', originIn(before, page));
  if (before) before.style.viewTransitionName = 'zoom-focus';
  page.style.viewTransitionName = 'zoom-page';
  root.dataset.zoom = direction;
  let after: HTMLElement | null = null;
  const transition = doc.startViewTransition(() => {
    if (before) before.style.viewTransitionName = '';
    flushSync(update);
    after = find();
    if (after) {
      if (!inSight(after, page)) after.scrollIntoView({ block: 'center' });
      after.style.viewTransitionName = 'zoom-focus';
    }
    root.style.setProperty('--zoom-to', originIn(after, page));
  });
  transition.finished.finally(() => {
    delete root.dataset.zoom;
    page.style.viewTransitionName = '';
    if (after) after.style.viewTransitionName = '';
  });
}
