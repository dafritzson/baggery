import { Platform } from 'react-native';

/**
 * A "liquid glass" lens for backdrop-filter: an SVG displacement filter that bends what's behind
 * the element near its edges, like looking through thick curved glass. The middle is left
 * alone, so text behind stays readable.
 *
 * Only Chromium (Chrome, Edge, Android) supports url() filters in backdrop-filter. Safari drops
 * the whole declaration when it sees one, blur and all, so everywhere else this returns null and
 * callers keep their plain blur.
 */
const ID = 'baggery-liquid-lens';

function chromium(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  // userAgentData only exists in Chromium; iOS Chrome ("CriOS") is WebKit and doesn't have it.
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands;
  return !!brands?.some((b) => b.brand === 'Chromium');
}

// The displacement map: red shifts pixels sideways, green up and down; 50% gray is no shift.
// Neutral across the middle, ramping at the edges, so only the rim bends.
const MAP = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100" viewBox="0 0 400 100" preserveAspectRatio="none">
<defs>
<linearGradient id="x" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#ff0000"/><stop offset="0.1" stop-color="#800000"/><stop offset="0.9" stop-color="#800000"/><stop offset="1" stop-color="#000000"/></linearGradient>
<linearGradient id="y" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#00ff00"/><stop offset="0.22" stop-color="#008000"/><stop offset="0.78" stop-color="#008000"/><stop offset="1" stop-color="#000000"/></linearGradient>
</defs>
<rect width="400" height="100" fill="url(#x)"/>
<rect width="400" height="100" fill="url(#y)" style="mix-blend-mode:screen"/>
</svg>`)}`;

let installed = false;

function install() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.innerHTML = `<filter id="${ID}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feImage href="${MAP}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map"/>
  <feDisplacementMap in="SourceGraphic" in2="map" scale="18" xChannelSelector="R" yChannelSelector="G"/>
</filter>`;
  document.body.appendChild(svg);
}

/**
 * The backdrop-filter value for liquid glass. In Chromium: the lens plus `withLens` (keep its blur
 * light, or it smears away the bending); elsewhere just `withoutLens`.
 */
export function liquidBackdrop(withLens: string, withoutLens: string): string {
  if (!chromium()) return withoutLens;
  install();
  return `url(#${ID}) ${withLens}`;
}
