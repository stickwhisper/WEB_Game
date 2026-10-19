// All gameplay tuning lives here so "game feel" can be adjusted in one place.

export const TILE = 32;
export const VIEW_HEIGHT = 540;

export const TUNING = {
  gravity: 1800,
  maxFallSpeed: 900,

  input: {
    /** How long a button press is remembered while the player can't act on it yet. */
    bufferMs: 150,
    /** Joystick travel (px) for full speed, and the dead zone as a fraction of it. */
    joystickRadius: 70,
    joystickDeadZone: 0.25,
    /** Touch area is this much larger than the drawn button. */
    buttonHitScale: 1.35,
  },

  player: {
    maxHp: 100,
    runSpeed: 260,
    groundAccel: 2600,
    groundDecel: 3200,
    airAccel: 1700,
    jumpVelocity: 720,
    /** Releasing jump early multiplies upward velocity by this (variable jump height). */
    jumpCutMultiplier: 0.45,
    /** Jump is still allowed this long after walking off a ledge. */
    coyoteMs: 100,

    rollSpeed: 520,
    rollMs: 320,
    rollCooldownMs: 120,

    hurtMs: 300,
    invulnMs: 900,
  },

  enemy: {
    maxHp: 30,
    patrolSpeed: 60,
    chaseSpeed: 120,
    aggroRangeX: 280,
    aggroRangeY: 90,
    lungeRange: 90,
    windupMs: 450,
    lungeSpeed: 420,
    lungeMs: 220,
    recoverMs: 550,
    stunMs: 280,
    damage: 15,
  },
};

export interface AttackDef {
  durationMs: number;
  /** Hitbox is live between these times (ms since attack start). */
  activeFromMs: number;
  activeToMs: number;
  /** Next combo hit can start once this much of the swing has played. */
  chainFromMs: number;
  damage: number;
  reach: number;
  height: number;
  lunge: number;
  knockback: number;
  hitstopMs: number;
  shake: number;
}

/** Three-hit ground combo. The finisher is slower but hits harder. */
export const COMBO: AttackDef[] = [
  { durationMs: 270, activeFromMs: 50, activeToMs: 130, chainFromMs: 140, damage: 10, reach: 58, height: 44, lunge: 140, knockback: 160, hitstopMs: 45, shake: 0.003 },
  { durationMs: 270, activeFromMs: 50, activeToMs: 130, chainFromMs: 140, damage: 10, reach: 58, height: 44, lunge: 140, knockback: 160, hitstopMs: 45, shake: 0.003 },
  { durationMs: 420, activeFromMs: 110, activeToMs: 200, chainFromMs: 9999, damage: 22, reach: 74, height: 54, lunge: 260, knockback: 420, hitstopMs: 90, shake: 0.008 },
];
