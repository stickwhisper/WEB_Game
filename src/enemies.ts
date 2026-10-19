import type { TriangleShape } from './weapons';

/**
 * Enemies differ only by form, and form is behaviour:
 *   wide ellipse        grunt   - lunges
 *   tall ellipse        hopper  - fast, fragile, leaps at you
 *   rounded square      warden  - guards its front (squares), must be hit from behind or mid-attack
 *   large flat ellipse  brute   - slow, unflinching, a huge triangle that a guard can't fully stop
 * Every value is a small integer so it can be read as a count of shapes.
 */

export interface EnemyBody {
  width: number;
  height: number;
  /** Corner radius for a rounded rectangle; omit for an ellipse. */
  radius?: number;
}

interface AttackBase {
  damage: number;
  /** Starts the wind-up once the player is this close horizontally. */
  range: number;
  windupMs: number;
  activeMs: number;
  recoverMs: number;
  weapon: TriangleShape;
}

/** Dash forward with the triangle pointed ahead (optionally leaving the ground). */
export interface LungeAttack extends AttackBase {
  kind: 'lunge';
  speed: number;
  /** Upward velocity at launch; 0 stays on the ground. */
  hop: number;
}

/** Stand still and sweep the triangle through an arc. */
export interface SwingAttack extends AttackBase {
  kind: 'swing';
  fromDeg: number;
  toDeg: number;
}

export type EnemyAttack = LungeAttack | SwingAttack;

export interface EnemyDef {
  id: string;
  body: EnemyBody;
  maxHp: number;
  patrolSpeed: number;
  chaseSpeed: number;
  /** Points of each hit to the front turned into squares (0 = no guard). */
  guardPower: number;
  /** Not knocked back or interrupted by ordinary hits (a parry still staggers it). */
  heavy: boolean;
  /** Circles left on the ground when it dies, to be taken back as health. */
  drops: number;
  attack: EnemyAttack;
}

export const ENEMIES: Record<string, EnemyDef> = {
  grunt: {
    id: 'grunt',
    body: { width: 48, height: 30 },
    maxHp: 6,
    patrolSpeed: 60,
    chaseSpeed: 120,
    guardPower: 0,
    heavy: false,
    drops: 1,
    attack: { kind: 'lunge', damage: 2, range: 90, windupMs: 500, activeMs: 220, recoverMs: 550, speed: 420, hop: 0, weapon: { base: 10, length: 26, width: 16 } },
  },
  hopper: {
    id: 'hopper',
    body: { width: 24, height: 42 },
    maxHp: 3,
    patrolSpeed: 90,
    chaseSpeed: 175,
    guardPower: 0,
    heavy: false,
    drops: 1,
    attack: { kind: 'lunge', damage: 1, range: 150, windupMs: 340, activeMs: 420, recoverMs: 450, speed: 330, hop: 520, weapon: { base: 8, length: 18, width: 12 } },
  },
  warden: {
    id: 'warden',
    body: { width: 40, height: 40, radius: 13 },
    maxHp: 8,
    patrolSpeed: 45,
    chaseSpeed: 85,
    guardPower: 2,
    heavy: false,
    drops: 2,
    attack: { kind: 'lunge', damage: 2, range: 80, windupMs: 620, activeMs: 180, recoverMs: 650, speed: 280, hop: 0, weapon: { base: 14, length: 30, width: 10 } },
  },
  brute: {
    id: 'brute',
    body: { width: 76, height: 44 },
    maxHp: 12,
    patrolSpeed: 35,
    chaseSpeed: 65,
    guardPower: 0,
    heavy: true,
    drops: 3,
    attack: { kind: 'swing', damage: 3, range: 105, windupMs: 850, activeMs: 230, recoverMs: 750, fromDeg: -150, toDeg: 45, weapon: { base: 10, length: 62, width: 30 } },
  },
};
