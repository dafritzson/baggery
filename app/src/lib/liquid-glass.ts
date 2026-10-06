import { useMemo } from 'react';
import { Platform } from 'react-native';

import { DEFAULT_OPTICS, type GlassOptics, type GlassShape, glassMaps } from '@/lib/glass-optics';

/**
 * Liquid glass on the web, drawn from the optics in glass-optics.ts for a pane's exact size: a
 * highlight image to lay over it (every browser), and in Chromium a backdrop-filter lens, an SVG
 * displacement filter that refracts what's behind the rim.
 *
 * Only Chromium (Chrome, Edge, Android) supports url() filters in backdrop-filter. Safari drops
 * the whole declaration when it sees one, blur and all, so everywhere else there's no lens and
 * callers keep a plain blur. Native has neither: on iOS, use expo-glass-effect's real Liquid Glass.
 */
export interface LiquidGlass {
  /** The lens, for the start of a backdrop-filter (`url(#…)`), or null where there's none. */
  lens: string | null;
  /** The highlight, an image to stretch over the pane, or null off the web. */
  specular: string | null;
}

const NONE: LiquidGlass = { lens: null, specular: null };

function chromium(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  // userAgentData only exists in Chromium; iOS Chrome ("CriOS") is WebKit and doesn't have it.
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands;
  return !!brands?.some((b) => b.brand === 'Chromium');
}

function png(data: Uint8ClampedArray, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return canvas.toDataURL('image/png');
}

let defs: SVGSVGElement | null = null;

/** Adds a lens filter for one pane size to the page, and returns its id. */
function addFilter(id: string, map: string, width: number, height: number, scale: number) {
  if (!defs) {
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    defs.setAttribute('width', '0');
    defs.setAttribute('height', '0');
    defs.setAttribute('aria-hidden', 'true');
    defs.style.position = 'absolute';
    document.body.appendChild(defs);
  }
  // In the pane's own pixels: the map is drawn for exactly this size, so it isn't stretched.
  defs.insertAdjacentHTML(
    'beforeend',
    `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feImage href="${map}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" result="map"/>
  <feDisplacementMap in="SourceGraphic" in2="map" scale="${scale.toFixed(2)}" xChannelSelector="R" yChannelSelector="G"/>
</filter>`,
  );
}

// One per pane size and optics: the bar, and the bubble at each tab's width.
const made = new Map<string, LiquidGlass>();

function make(shape: GlassShape, optics: GlassOptics): LiquidGlass {
  const key = JSON.stringify([shape.width, shape.height, shape.radius, optics]);
  const known = made.get(key);
  if (known) return known;
  // Sharp on high-density screens, where the rim is only a few CSS pixels wide.
  const density = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)));
  const maps = glassMaps(shape, optics, density);
  let lens: string | null = null;
  if (chromium()) {
    const id = `baggery-glass-${made.size}`;
    addFilter(id, png(maps.displacement, maps.width, maps.height), shape.width, shape.height, maps.scale);
    lens = `url(#${id})`;
  }
  const glass = { lens, specular: png(maps.specular, maps.width, maps.height) };
  made.set(key, glass);
  return glass;
}

/** Liquid glass for a pane of this size (once it's been laid out; null before then). */
export function useLiquidGlass(size: { width: number; height: number } | null | undefined, radius: number, optics: GlassOptics = DEFAULT_OPTICS): LiquidGlass {
  const width = Math.round(size?.width ?? 0);
  const height = Math.round(size?.height ?? 0);
  return useMemo(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !width || !height) return NONE;
    return make({ width, height, radius }, optics);
  }, [width, height, radius, optics]);
}
