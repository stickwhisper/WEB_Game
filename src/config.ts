import Phaser from 'phaser';

// All gameplay tuning lives here so "game feel" can be adjusted in one place.

export const TILE = 32;
export const VIEW_HEIGHT = 540;

/**
 * Controls and HUD grow on small screens so they keep a usable size in real pixels.
 * 1 when one game unit shows as at least ~0.95 CSS px (tablets); up to 1.4 on small phones.
 */
export function uiScale(scene: Phaser.Scene): number {
  const cssPerUnit = scene.scale.displaySize.width / scene.scale.width;
  return Phaser.Math.Clamp(0.95 / cssPerUnit, 1, 1.4);
}

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
    /** Circles lost by falling out of a room (then back on the last solid ground). */
    fallDamage: 1,
  },

  /** Shared by every enemy; per-type values (form, health, attack) live in enemies.ts. */
  enemy: {
    aggroRangeX: 280,
    aggroRangeY: 90,
    stunMs: 280,
    staggerMs: 900,
  },

  /** Circles an enemy leaves behind when it dies. */
  healthDrop: {
    /** Absorbed when the player's centre comes this close (only while health isn't full). */
    reach: 30,
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
