// Marks for the Games tab's zoom (zoom.ts, zoom.web.ts): which View zooms, which game is
// which, and what stays put. Data attributes on web; ignored natively.

export type ZoomDirection = 'in' | 'out';

/** Props for the View that zooms (not the controls above it). */
export function zoomView(): object {
  return { dataSet: { zoomView: '' } };
}

/** Props that mark a View as one game in any view, so `zoom` can morph it into the next. */
export function zoomKey(key: string): object {
  return { dataSet: { zoomKey: key } };
}

/** Props for a row that stays put while the view below it zooms. */
export function zoomFixed(): object {
  return { dataSet: { zoomFixed: '' } };
}
