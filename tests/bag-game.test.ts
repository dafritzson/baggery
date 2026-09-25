import { describe, expect, it } from 'vitest';

import { BAG_KINDS, PERFECT_SCORE, TOTAL_BAGS, fenceDistance, fieldView, isNight, makeSchedule } from '../app/src/lib/bag-game.ts';

describe('bag game schedule', () => {
  it('drops 56 bags: 2 home runs, 1 triple, 5 doubles, the rest singles', () => {
    const bags = makeSchedule(1);
    expect(TOTAL_BAGS).toBe(56);
    expect(bags).toHaveLength(56);
    const count = (kind: string) => bags.filter((b) => b.kind === kind).length;
    expect(count('homer')).toBe(2);
    expect(count('triple')).toBe(1);
    expect(count('double')).toBe(5);
    expect(count('single')).toBe(48);
  });

  it('a perfect game is 69 bags', () => {
    // Also the database's cap on scores (bag_game_bests).
    expect(PERFECT_SCORE).toBe(69);
    const total = makeSchedule(2).reduce((n, b) => n + BAG_KINDS[b.kind].bags, 0);
    expect(total).toBe(PERFECT_SCORE);
  });

  it('is the same game for the same seed and a different one for another', () => {
    expect(makeSchedule(7)).toEqual(makeSchedule(7));
    expect(makeSchedule(7).map((b) => b.kind)).not.toEqual(makeSchedule(8).map((b) => b.kind));
  });

  it('drops bags in order, speeding up, over about 20 to 35 seconds', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const bags = makeSchedule(seed);
      for (let i = 1; i < bags.length; i++) expect(bags[i].spawnAt).toBeGreaterThan(bags[i - 1].spawnAt);
      const last = bags[bags.length - 1];
      expect(last.spawnAt).toBeGreaterThan(20_000);
      expect(last.spawnAt).toBeLessThan(35_000);
      expect(bags[0].fallMs).toBeGreaterThan(last.fallMs);
    }
  });

  it('speeds up early, not just at the end', () => {
    const singles = makeSchedule(3).filter((b) => b.kind === 'single');
    const first = singles[0].fallMs;
    const last = singles[singles.length - 1].fallMs;
    const third = singles[Math.round(singles.length / 3)].fallMs;
    expect(first - third).toBeGreaterThan((first - last) / 2);
  });

  it('lands every bag in fair territory, short of the fence', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const b of makeSchedule(seed)) {
        expect(Math.abs(b.x)).toBeLessThan(b.z);
        expect(Math.hypot(b.x, b.z)).toBeLessThan(fenceDistance(Math.atan2(b.x, b.z)) - 20);
      }
    }
  });
});

describe('field view', () => {
  const view = fieldView(390, 700, 600);

  it('puts home plate at the bottom center and the fence below the horizon', () => {
    const home = view.project(0, 0);
    expect(home.x).toBe(195);
    expect(home.y).toBeCloseTo(572);
    const center = view.project(0, 400);
    expect(center.y).toBeGreaterThan(view.horizon);
    expect(center.y).toBeLessThan(home.y);
  });

  it('shrinks things with distance', () => {
    expect(view.scale(0)).toBe(1);
    expect(view.scale(300)).toBeLessThan(view.scale(100));
  });

  it('draws the infield wider than tall, like a view from behind home plate', () => {
    const base = 90 / Math.SQRT2;
    const width = view.project(base, base).x - view.project(-base, base).x;
    const height = view.project(0, 0).y - view.project(0, 2 * base).y;
    expect(width / height).toBeGreaterThan(1.1);
    // The foul poles sit just inside the edges of a phone screen.
    const pole = 330 / Math.SQRT2;
    const left = view.project(-pole, pole).x;
    const right = view.project(pole, pole).x;
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(25);
    expect(right).toBeLessThan(390);
    expect(right).toBeGreaterThan(365);
  });
});

describe('day or night', () => {
  const at = (hour: number, minute = 0) => new Date(2026, 9, 1, hour, minute);

  it('is a night game from 7 PM to 6 AM local time', () => {
    expect(isNight(at(18, 59))).toBe(false);
    expect(isNight(at(19))).toBe(true);
    expect(isNight(at(0))).toBe(true);
    expect(isNight(at(5, 59))).toBe(true);
    expect(isNight(at(6))).toBe(false);
    expect(isNight(at(12))).toBe(false);
  });
});
