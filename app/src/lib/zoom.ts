// Zooming between the Games tab's Day, Round and Postseason views. The animation is web only
// (zoom.web.ts); an iOS app would draw it natively, and until then it just switches.

import type { ZoomDirection } from './zoom-marks';

export { type ZoomDirection, zoomFixed, zoomKey, zoomView } from './zoom-marks';

/**
 * Runs `update`, which switches views. On web it zooms `in` (towards more detail) or `out`, with
 * the element marked `zoomKey(focus)` in the old view morphing into the one in the new view.
 */
export function zoom(_direction: ZoomDirection, update: () => void, _focus?: string): void {
  update();
}
