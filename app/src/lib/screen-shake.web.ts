let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Shakes the whole page for a moment (bag celebrations): a CSS animation on the body (global.css),
 * which leaves nothing behind when it ends, so fixed-position tooltips aren't thrown off after.
 * Skipped with reduced motion on.
 */
export function shakeScreen({ px, ms }: { px: number; ms: number }): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const body = document.body;
  clearTimeout(timer);
  body.style.setProperty('--shake-px', `${px}px`);
  body.style.setProperty('--shake-ms', `${ms}ms`);
  // Restart it if one is already going.
  delete body.dataset.shake;
  void body.offsetWidth;
  body.dataset.shake = '';
  timer = setTimeout(() => delete body.dataset.shake, ms + 50);
}
