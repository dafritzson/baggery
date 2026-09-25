import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { type FieldView, type Point, fenceDistance, seededRandom } from '@/lib/bag-game';

/** Fixed colors: a ballpark looks the same in any theme, but dark mode is a night game. */
const DAY = {
  skyTop: '#3F9FE0',
  skyBottom: '#BFE3FA',
  stands: '#39465A',
  crowd: ['#E8505B', '#F6C85F', '#FFFFFF', '#6FB1FC', '#9ADBA0', '#F29E4C'],
  wall: '#1D5A37',
  wallCap: '#F2C94C',
  grass: '#3F9A4E',
  stripe: '#4BAA5A',
  dirt: '#C98B5B',
  track: '#B7784C',
  chalk: '#FFFFFF',
  pole: '#F2C94C',
};
const NIGHT = {
  ...DAY,
  skyTop: '#040A1C',
  skyBottom: '#1A2E5A',
  stands: '#1A2130',
  wall: '#123D25',
  grass: '#2F7E3D',
  stripe: '#388F47',
  dirt: '#A9714A',
  track: '#955F3D',
};

const WALL_HEIGHT = 8;
/** The walls in foul territory run this far outside each foul line. */
const FOUL_WALL_OFFSET = 60;
const POLE = 330 / Math.SQRT2;
const WARNING_TRACK = 15;

/** A ballpark seen from behind home plate, filling the view. Static: redraws only on resize. */
export function Ballpark({ view, night }: { view: FieldView; night: boolean }) {
  const c = night ? NIGHT : DAY;
  const { width, height, horizon, project } = view;
  const path = (points: Point[]) => `M${points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}Z`;
  const ground = (x: number, z: number) => project(x, z);

  // The outfield wall's foot, left foul corner around to right: in along each foul-side wall,
  // then the arc from pole to pole.
  const wallFoot = (h = 0): Point[] => {
    const side = (sign: number, t: number) =>
      project(sign * (t + FOUL_WALL_OFFSET) / Math.SQRT2, (t - FOUL_WALL_OFFSET) / Math.SQRT2, h);
    const arc = range(-Math.PI / 4, Math.PI / 4, 48).map((a) => {
      const r = fenceDistance(a);
      return project(r * Math.sin(a), r * Math.cos(a), h);
    });
    const along = range(0, POLE * Math.SQRT2 - FOUL_WALL_OFFSET, 12);
    return [...along.map((t) => side(-1, t)), ...arc, ...along.slice().reverse().map((t) => side(1, t))];
  };
  const foot = wallFoot();
  const top = wallFoot(WALL_HEIGHT);
  const below = height + 200;
  const groundShape = [{ x: foot[0].x, y: below }, ...foot, { x: foot[foot.length - 1].x, y: below }];

  // Fair territory between two distances from home, stopping at the warning track.
  const band = (from: number, to: number) => {
    const angles = range(-Math.PI / 4, Math.PI / 4, 32);
    const at = (a: number, r: number) => {
      const d = Math.min(r, fenceDistance(a) - WARNING_TRACK);
      return ground(d * Math.sin(a), d * Math.cos(a));
    };
    return path([...angles.map((a) => at(a, from)), ...angles.slice().reverse().map((a) => at(a, to))]);
  };
  const stripes = range(150, 390, 9).flatMap((r, i) => (i % 2 ? [] : [band(r, r + 30)]));
  const trackAngles = range(-Math.PI / 4, Math.PI / 4, 48);
  const onArc = (a: number, r: number) => ground(r * Math.sin(a), r * Math.cos(a));
  const track = path([
    ...trackAngles.map((a) => onArc(a, fenceDistance(a) - WARNING_TRACK)),
    ...trackAngles.slice().reverse().map((a) => onArc(a, fenceDistance(a))),
  ]);

  // Infield dirt: a 95 ft arc around the mound, meeting the foul lines.
  const moundZ = 60.5;
  const dirtEdge = range((161.8 * Math.PI) / 180, (18.2 * Math.PI) / 180, 32).map((a) =>
    ground(95 * Math.cos(a), moundZ + 95 * Math.sin(a)),
  );
  const dirt = path([ground(0, -4), ...dirtEdge]);
  // Infield grass: the square inside the base paths.
  const base = 90 / Math.SQRT2;
  const infieldGrass = path([ground(0, 12), ground(base - 10, base), ground(0, 2 * base - 10), ground(-(base - 10), base)]);
  const circle = (x: number, z: number, r: number) =>
    path(range(0, Math.PI * 2, 24).map((a) => ground(x + r * Math.cos(a), z + r * Math.sin(a))));
  const square = (x: number, z: number, s: number) =>
    path([ground(x, z - s), ground(x + s, z), ground(x, z + s), ground(x - s, z)]);
  const homePlate = path([ground(-1.6, 0.8), ground(1.6, 0.8), ground(1.6, -0.6), ground(0, -2), ground(-1.6, -0.6)]);

  const home = ground(0, 0);
  const leftPole = ground(-POLE, POLE);
  const rightPole = ground(POLE, POLE);

  // Crowd in the stands and, at night, stars: fixed seeds so they don't jump around.
  const random = seededRandom(2026);
  // Packed above the outfield wall; sparser down the sides, where the field covers most of them.
  const crowdTop = horizon + 3;
  const wallTop = project(POLE, POLE, WALL_HEIGHT).y;
  const fan = (bottom: number) => ({
    x: random() * width,
    y: crowdTop + random() * (bottom - crowdTop),
    color: c.crowd[Math.floor(random() * c.crowd.length)],
  });
  const crowd = [
    ...Array.from({ length: Math.round(width * 1.4) }, () => fan(wallTop)),
    ...Array.from({ length: Math.round(width * 0.6) }, () => fan(height)),
  ];
  const stars = night
    ? Array.from({ length: 40 }, () => ({ x: random() * width, y: random() * horizon * 0.9, r: 0.5 + random() }))
    : [];

  return (
    <Svg width={width} height={height} style={{ position: 'absolute', top: 0, left: 0 }}>
      <Defs>
        <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={c.skyTop} />
          <Stop offset="1" stopColor={c.skyBottom} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={horizon + 1} fill="url(#sky)" />
      {stars.map((s, i) => (
        <Circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#FFFFFF" opacity={0.8} />
      ))}
      <Rect x={0} y={horizon} width={width} height={height - horizon} fill={c.stands} />
      {crowd.map((p, i) => (
        <Circle key={i} cx={p.x} cy={p.y} r={1.5} fill={p.color} opacity={0.8} />
      ))}

      <Path d={path(groundShape)} fill={c.grass} />
      {stripes.map((d, i) => (
        <Path key={i} d={d} fill={c.stripe} />
      ))}
      <Path d={track} fill={c.track} />
      <Path d={path([...foot, ...top.slice().reverse()])} fill={c.wall} />
      <Path d={`M${top.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}`} stroke={c.wallCap} strokeWidth={2} fill="none" />

      <Path d={dirt} fill={c.dirt} />
      <Path d={infieldGrass} fill={c.grass} />
      <Path d={circle(0, 0, 10)} fill={c.dirt} />
      <Path d={circle(0, moundZ, 9)} fill={c.dirt} />
      <Path d={square(0, moundZ, 1.2)} fill={c.chalk} />

      <Line x1={home.x} y1={home.y} x2={leftPole.x} y2={leftPole.y} stroke={c.chalk} strokeWidth={1.5} />
      <Line x1={home.x} y1={home.y} x2={rightPole.x} y2={rightPole.y} stroke={c.chalk} strokeWidth={1.5} />
      {[
        [base, base],
        [0, 2 * base],
        [-base, base],
      ].map(([x, z]) => (
        <Path key={`${x},${z}`} d={square(x, z, 2)} fill={c.chalk} />
      ))}
      <Path d={homePlate} fill={c.chalk} />

      {[-1, 1].map((sign) => {
        const foot = project(sign * POLE, POLE);
        const tip = project(sign * POLE, POLE, 70);
        return <Line key={sign} x1={foot.x} y1={foot.y} x2={tip.x} y2={tip.y} stroke={c.pole} strokeWidth={2} />;
      })}
    </Svg>
  );
}

/** `n + 1` evenly spaced values from `from` to `to`. */
function range(from: number, to: number, n: number): number[] {
  return Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
}
