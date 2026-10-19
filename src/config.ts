// All gameplay tuning lives here so "game feel" can be adjusted in one place.

export const TILE = 32;
export const VIEW_HEIGHT = 540;

/**
 * Monochrome only. Colour must not carry meaning; shapes do:
 *   triangle = attack, circle = health, square = outside the health system (guard, exit).
 * Player and enemies are told apart by form and value, never by hue.
 */
export const PALETTE = {
  background: 0x0f0f0f,
  terrain: 0x262626,
  platform: 0x4a4a4a,
  player: 0xf2f2f2,
  enemy: 0x9a9a9a,
  shape: 0xf2f2f2, // triangles, circles, squares
  dim: 0x5a5a5a,
};

export const TUNING = {
  gravity: 1800,
  maxFallSpeed: 900,

  input: {
    /** How long a button press is remembered while the player can't act on it yet. */
    bufferMs: 150,
    /** Joystick travel (px) for full speed, and the dead zone as a fraction of it. */
    joystickRadius: 70,
    joystickDeadZone: 0.25,
    /** Invisible touch area radius around each button icon. */
    buttonHitRadius: 62,
  },

  player: {
    /** Health is a small integer: it is shown as that many circles, so it must be countable. */
    maxHp: 10,
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

    /** A guard stops this much damage per hit; the rest pierces through. */
    guardPower: 1,
    /** Raising the guard this soon before a hit blocks all of it and staggers the attacker. */
    parryWindowMs: 180,

    hurtMs: 300,
    invulnMs: 900,
  },

  enemy: {
    maxHp: 6,
    patrolSpeed: 60,
    chaseSpeed: 120,
    aggroRangeX: 280,
    aggroRangeY: 90,
    lungeRange: 90,
    windupMs: 500,
    lungeSpeed: 420,
    lungeMs: 220,
    recoverMs: 550,
    stunMs: 280,
    staggerMs: 900,
    damage: 2,
  },
};

/**
 * Keyboard bindings, as Phaser key names (see Phaser.Input.Keyboard.KeyCodes).
 * Several keys per action so both arrow-key and WASD players are covered.
 */
export const KEY_BINDINGS = {
  left: ['LEFT', 'A'],
  right: ['RIGHT', 'D'],
  jump: ['SPACE', 'UP', 'W', 'Z'],
  attack: ['X', 'J'],
  guard: ['V', 'L', 'SHIFT'],
  roll: ['C', 'K'],
  pick: ['E', 'F'],
};
