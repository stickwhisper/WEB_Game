import Phaser from 'phaser';

/**
 * A weapon is nothing but a triangle and the path it travels.
 * Shape tells you reach and weight; the path tells you how it hits.
 */
export interface TriangleShape {
  /** Distance from the pivot to the base of the triangle (negative = held back). */
  base: number;
  /** Base to tip. */
  length: number;
  /** Width of the base. */
  width: number;
}

interface MoveBase {
  durationMs: number;
  /** The triangle can hit only between these times (ms since the move started). */
  activeFromMs: number;
  activeToMs: number;
  /** The next move in the list can start once this much has played (if attack was pressed again). */
  chainFromMs: number;
  damage: number;
  /** Forward velocity given to the wielder at the start of the move. */
  lunge: number;
  knockback: number;
  hitstopMs: number;
  shake: number;
}

/** Arc between two angles (degrees, 0 = straight ahead, negative = up). */
export interface SwingMove extends MoveBase {
  kind: 'swing';
  fromDeg: number;
  toDeg: number;
}

/** Straight stab: the triangle slides along its axis from `fromDist` to `toDist`. */
export interface ThrustMove extends MoveBase {
  kind: 'thrust';
  angleDeg: number;
  fromDist: number;
  toDist: number;
}

export type Move = SwingMove | ThrustMove;

export interface WeaponDef {
  id: string;
  shape: TriangleShape;
  moves: Move[];
}

const swing = (m: Omit<SwingMove, 'kind'>): SwingMove => ({ kind: 'swing', ...m });
const thrust = (m: Omit<ThrustMove, 'kind'>): ThrustMove => ({ kind: 'thrust', ...m });

export const WEAPONS: Record<string, WeaponDef> = {
  /** Long thin triangle. Three arcs: down, up, then a heavy overhead. */
  sword: {
    id: 'sword',
    shape: { base: 8, length: 46, width: 10 },
    moves: [
      swing({ fromDeg: -75, toDeg: 55, durationMs: 300, activeFromMs: 70, activeToMs: 150, chainFromMs: 160, damage: 1, lunge: 120, knockback: 160, hitstopMs: 45, shake: 0.003 }),
      swing({ fromDeg: 60, toDeg: -55, durationMs: 300, activeFromMs: 70, activeToMs: 150, chainFromMs: 160, damage: 1, lunge: 120, knockback: 160, hitstopMs: 45, shake: 0.003 }),
      swing({ fromDeg: -130, toDeg: 70, durationMs: 460, activeFromMs: 140, activeToMs: 240, chainFromMs: 9999, damage: 2, lunge: 240, knockback: 380, hitstopMs: 85, shake: 0.008 }),
    ],
  },
  /** Very long, very narrow. Two straight stabs with long reach. */
  spear: {
    id: 'spear',
    shape: { base: -14, length: 78, width: 9 },
    moves: [
      thrust({ angleDeg: 0, fromDist: -26, toDist: 30, durationMs: 400, activeFromMs: 120, activeToMs: 210, chainFromMs: 230, damage: 2, lunge: 90, knockback: 260, hitstopMs: 60, shake: 0.004 }),
      thrust({ angleDeg: -6, fromDist: -30, toDist: 38, durationMs: 460, activeFromMs: 150, activeToMs: 250, chainFromMs: 9999, damage: 2, lunge: 150, knockback: 320, hitstopMs: 70, shake: 0.006 }),
    ],
  },
  /** Small triangle. Fast pokes that never stop. */
  dagger: {
    id: 'dagger',
    shape: { base: 10, length: 22, width: 10 },
    moves: [
      thrust({ angleDeg: -8, fromDist: -6, toDist: 18, durationMs: 170, activeFromMs: 35, activeToMs: 90, chainFromMs: 90, damage: 1, lunge: 70, knockback: 70, hitstopMs: 28, shake: 0.002 }),
      thrust({ angleDeg: 8, fromDist: -6, toDist: 18, durationMs: 170, activeFromMs: 35, activeToMs: 90, chainFromMs: 90, damage: 1, lunge: 70, knockback: 70, hitstopMs: 28, shake: 0.002 }),
      thrust({ angleDeg: 0, fromDist: -8, toDist: 24, durationMs: 220, activeFromMs: 45, activeToMs: 110, chainFromMs: 9999, damage: 1, lunge: 110, knockback: 140, hitstopMs: 40, shake: 0.003 }),
    ],
  },
  /** Short, very wide triangle. One slow overhead slam. */
  hammer: {
    id: 'hammer',
    shape: { base: 6, length: 40, width: 34 },
    moves: [
      swing({ fromDeg: -150, toDeg: 65, durationMs: 640, activeFromMs: 270, activeToMs: 370, chainFromMs: 9999, damage: 3, lunge: 60, knockback: 460, hitstopMs: 110, shake: 0.012 }),
    ],
  },
};

export interface Pose {
  /** Rotation in degrees (before mirroring for facing). */
  angleDeg: number;
  /** Extra slide along the triangle's own axis. */
  dist: number;
  alpha: number;
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

/** Where the triangle is at `ms` into a move: wind-up, strike, then hold while it fades. */
export function poseAt(move: Move, ms: number): Pose {
  const { activeFromMs: a, activeToMs: b, durationMs: d } = move;
  const strike = Phaser.Math.Clamp((ms - a) / (b - a), 0, 1);
  const recover = Phaser.Math.Clamp((ms - b) / Math.max(1, d - b), 0, 1);
  const alpha = 1 - recover * 0.7;

  if (move.kind === 'swing') {
    // During wind-up, pull 15 degrees further back than the start angle.
    const windup = Phaser.Math.Clamp(ms / Math.max(1, a), 0, 1);
    const back = move.fromDeg + Math.sign(move.fromDeg - move.toDeg) * 15 * (1 - Math.abs(windup * 2 - 1));
    const angleDeg = ms < a ? back : Phaser.Math.Linear(move.fromDeg, move.toDeg, easeOut(strike));
    return { angleDeg, dist: 0, alpha };
  }

  const out = Phaser.Math.Linear(move.fromDist, move.toDist, easeOut(strike));
  // After the stab, draw back halfway to the start.
  const dist = ms < b ? out : Phaser.Math.Linear(move.toDist, (move.fromDist + move.toDist) / 2, recover);
  return { angleDeg: move.angleDeg, dist, alpha };
}

/** World-space triangle for a shape at a pose, mirrored for facing. */
export function triangleAt(shape: TriangleShape, pose: Pose, pivotX: number, pivotY: number, facing: number): Phaser.Geom.Triangle {
  const rad = Phaser.Math.DegToRad(pose.angleDeg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const b = shape.base + pose.dist;
  const tip = b + shape.length;
  const hw = shape.width / 2;
  const pt = (lx: number, ly: number): [number, number] => [pivotX + (lx * cos - ly * sin) * facing, pivotY + (lx * sin + ly * cos)];
  const [x1, y1] = pt(b, -hw);
  const [x2, y2] = pt(tip, 0);
  const [x3, y3] = pt(b, hw);
  return new Phaser.Geom.Triangle(x1, y1, x2, y2, x3, y3);
}

/** Halfway between two triangles: tested between frames so a fast attack can't skip over a target. */
export function midTriangle(a: Phaser.Geom.Triangle, b: Phaser.Geom.Triangle): Phaser.Geom.Triangle {
  return new Phaser.Geom.Triangle(
    (a.x1 + b.x1) / 2,
    (a.y1 + b.y1) / 2,
    (a.x2 + b.x2) / 2,
    (a.y2 + b.y2) / 2,
    (a.x3 + b.x3) / 2,
    (a.y3 + b.y3) / 2,
  );
}
