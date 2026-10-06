/**
 * The optics of a pane of "liquid glass": a slab with a flat top and a rounded rim, like Apple's
 * Liquid Glass. Pure math, no DOM, so it can be checked on its own; liquid-glass.ts draws it.
 *
 * Light coming straight down through the flat middle passes through unbent, so text behind stays
 * readable. Near the edge, the surface curves down to meet the background (a squircle profile, a
 * softer shoulder than a circle), and the slope refracts each ray inward, by Snell's law: the
 * rim shows what's a little further in, squeezed, the way the edge of a thick lens does. Where the
 * surface faces the light, the rim catches a thin specular highlight.
 */

export interface GlassShape {
  /** Size of the pane, in CSS pixels. */
  width: number;
  height: number;
  /** Corner radius (clamped to half the shorter side, so 999 makes a pill). */
  radius: number;
}

export interface GlassOptics {
  /** How far in from the edge the rim curves, in CSS pixels. */
  bezel: number;
  /** How high the glass sits above what's behind it: how far a bent ray travels, in CSS pixels. */
  thickness: number;
  /** Refractive index (glass: about 1.5). */
  ior: number;
  /** Direction the light comes from, in screen coordinates (y down). */
  light: [number, number];
}

export const DEFAULT_OPTICS: GlassOptics = { bezel: 22, thickness: 22, ior: 1.5, light: [-0.6, -0.8] };

export interface GlassMaps {
  /** Pixel size of both maps (the shape's size times `density`). */
  width: number;
  height: number;
  /**
   * RGBA displacement map for an SVG feDisplacementMap: red shifts sideways, green up and down,
   * 128 is no shift, and 0 and 255 shift by half of `scale`.
   */
  displacement: Uint8ClampedArray;
  /** The feDisplacementMap scale, in CSS pixels. */
  scale: number;
  /** RGBA highlight: white, with the highlight's strength in alpha. */
  specular: Uint8ClampedArray;
}

/** Height of the rim's surface, 0 at the edge to 1 where it levels out (`x` from 0 to 1). */
export const surface = (x: number) => Math.pow(1 - Math.pow(1 - x, 4), 1 / 4);

/** Its slope. Infinite at the very edge, where the glass meets the background edge-on. */
const slope = (x: number) => Math.pow(1 - x, 3) * Math.pow(1 - Math.pow(1 - x, 4), -3 / 4);

/**
 * How far a ray coming straight down is bent sideways at `x` across the rim, in CSS pixels:
 * the surface tilts by θ, the ray refracts to θt = asin(sin θ / n) from the normal, so it leaves
 * the vertical by θ − θt and drifts tan(θ − θt) for every pixel of height.
 */
export function refraction(x: number, { bezel, thickness, ior }: GlassOptics): number {
  if (x >= 1) return 0;
  const theta = Math.atan((slope(Math.max(x, 1e-4)) * thickness) / bezel);
  const thetaT = Math.asin(Math.sin(theta) / ior);
  return thickness * Math.tan(theta - thetaT);
}

/**
 * Distance in from the edge of the rounded rectangle at (x, y), negative outside, and the
 * direction straight out through the nearest edge.
 */
export function edge(x: number, y: number, { width, height, radius }: GlassShape): { inset: number; nx: number; ny: number } {
  const r = Math.min(radius, width / 2, height / 2);
  const cx = x - width / 2;
  const cy = y - height / 2;
  const qx = Math.abs(cx) - (width / 2 - r);
  const qy = Math.abs(cy) - (height / 2 - r);
  if (qx > 0 && qy > 0) {
    const len = Math.hypot(qx, qy);
    return { inset: r - len, nx: (Math.sign(cx) * qx) / len, ny: (Math.sign(cy) * qy) / len };
  }
  return qx > qy ? { inset: r - qx, nx: Math.sign(cx) || 1, ny: 0 } : { inset: r - qy, nx: 0, ny: Math.sign(cy) || 1 };
}

/** The displacement and highlight maps for a pane, `density` map pixels per CSS pixel. */
export function glassMaps(shape: GlassShape, optics: GlassOptics = DEFAULT_OPTICS, density = 1): GlassMaps {
  const width = Math.max(1, Math.round(shape.width * density));
  const height = Math.max(1, Math.round(shape.height * density));
  const bezel = Math.min(optics.bezel, Math.min(shape.width, shape.height) / 2);
  const o = { ...optics, bezel };
  const max = refraction(0, o);
  const [lx, ly] = optics.light;
  const ll = Math.hypot(lx, ly) || 1;
  const displacement = new Uint8ClampedArray(width * height * 4);
  const specular = new Uint8ClampedArray(width * height * 4);

  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const p = (j * width + i) * 4;
      const { inset, nx, ny } = edge((i + 0.5) / density, (j + 0.5) / density, shape);
      // Bent inward, toward the middle: sample from the opposite way to the edge's normal.
      const shift = inset >= 0 && max > 0 ? refraction(inset / bezel, o) / max : 0;
      displacement[p] = 128 - 127 * nx * shift;
      displacement[p + 1] = 128 - 127 * ny * shift;
      displacement[p + 2] = 128;
      displacement[p + 3] = 255;

      // The highlight: a fine bright line hugging the edge, brightest where the rim faces the light
      // and, more faintly, on the far side where light inside the glass comes back out; and a soft
      // glow across the rim's slope on the lit side.
      const facing = (nx * lx + ny * ly) / ll;
      const coverage = Math.min(1, Math.max(0, inset + 0.5));
      const line = Math.exp(-Math.max(0, inset) / 1.4);
      const lit = Math.max(facing, 0);
      const back = Math.max(-facing, 0);
      const glow = Math.pow(1 - Math.min(1, Math.max(0, inset) / bezel), 3) * lit;
      const strength = line * (0.3 + 0.7 * lit * lit + 0.5 * back * back) + 0.3 * glow;
      specular[p] = 255;
      specular[p + 1] = 255;
      specular[p + 2] = 255;
      specular[p + 3] = Math.round(255 * coverage * Math.min(1, strength));
    }
  }
  return { width, height, displacement, scale: 2 * max, specular };
}
