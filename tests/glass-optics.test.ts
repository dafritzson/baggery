import { describe, expect, it } from 'vitest';

import { DEFAULT_OPTICS, edge, glassMaps, refraction, surface } from '../app/src/lib/glass-optics.ts';

describe('glass optics', () => {
  it('rises from the edge to a flat top', () => {
    expect(surface(0)).toBe(0);
    expect(surface(1)).toBe(1);
    expect(surface(0.5)).toBeGreaterThan(0.9);
  });

  it('bends most at the edge and not at all where the glass is flat', () => {
    const at = [0, 0.1, 0.3, 0.6, 1].map((x) => refraction(x, DEFAULT_OPTICS));
    for (let i = 1; i < at.length; i++) expect(at[i]).toBeLessThan(at[i - 1]);
    expect(at[4]).toBe(0);
    // A ray at the very edge meets the glass edge-on: it leaves at asin(1 / n) from the normal.
    const { thickness, ior } = DEFAULT_OPTICS;
    expect(at[0]).toBeCloseTo(thickness * Math.tan(Math.PI / 2 - Math.asin(1 / ior)), 0);
  });

  it('measures in from the nearest edge of a pill', () => {
    const pill = { width: 300, height: 60, radius: 999 };
    expect(edge(150, 30, pill)).toEqual({ inset: 30, nx: 0, ny: 1 });
    expect(edge(150, 2, pill)).toMatchObject({ inset: 2, nx: 0, ny: -1 });
    const end = edge(2, 30, pill);
    expect(end.inset).toBeCloseTo(2);
    expect(end.nx).toBeCloseTo(-1);
    expect(edge(-5, 30, pill).inset).toBeLessThan(0);
  });

  it('maps the rim inward and leaves the middle alone', () => {
    const maps = glassMaps({ width: 200, height: 60, radius: 999 });
    const px = (x: number, y: number) => Array.from(maps.displacement.slice((y * maps.width + x) * 4, (y * maps.width + x) * 4 + 2));
    expect(px(100, 30)).toEqual([128, 128]);
    // Left end: sampled from further right. Top edge: from further down.
    expect(px(0, 30)[0]).toBeGreaterThan(200);
    expect(px(100, 0)[1]).toBeGreaterThan(200);
    expect(maps.scale).toBeCloseTo(2 * refraction(0, DEFAULT_OPTICS));
  });

  it('lights the rim facing the light more than the one facing away, and not the middle', () => {
    const maps = glassMaps({ width: 200, height: 60, radius: 999 });
    const alpha = (x: number, y: number) => maps.specular[(y * maps.width + x) * 4 + 3];
    expect(alpha(100, 0)).toBeGreaterThan(alpha(100, 59));
    expect(alpha(100, 59)).toBeGreaterThan(0);
    expect(alpha(100, 30)).toBe(0);
  });

  it('draws more map pixels on dense screens', () => {
    const maps = glassMaps({ width: 100, height: 40, radius: 999 }, DEFAULT_OPTICS, 3);
    expect([maps.width, maps.height]).toEqual([300, 120]);
  });
});
