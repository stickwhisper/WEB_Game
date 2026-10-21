/**
 * Shields are squares, told apart by size. Each trades protection against mobility:
 *
 *   small   parry only (no reduction); a quick tap that can be repeated, walking normally
 *   medium  reduces damage for a short while after raising it, with a parry at the start;
 *           walk slowly while it is up; a short wait before it can be raised again
 *   large   reduces more for as long as it is held, no parry, can't move while it is up;
 *           slows walking always, but covers the back whenever it is not raised;
 *           a longer wait before it can be raised again
 *
 * The square upgrade (guard bonus) adds to `block` for shields that block, and widens the
 * small shield's parry window instead.
 */
export interface ShieldDef {
  id: 'small' | 'medium' | 'large';
  /** Side of the square drawn in front of the body. */
  size: number;
  /** Points kept out of health per hit while raised (0 = parry only). */
  block: number;
  parry: boolean;
  /** Parry window from the moment it is raised. */
  parryMs: number;
  /** tap: up for activeMs then down; timed: up while held, at most activeMs; hold: up while held. */
  use: 'tap' | 'timed' | 'hold';
  activeMs: number;
  /** Wait after lowering before it can be raised again. */
  cooldownMs: number;
  /** Walking speed while raised, as a fraction of normal (0 = planted). */
  raisedSpeed: number;
  /** Walking speed while carried, raised or not. */
  carrySpeed: number;
  /** Blocks attacks from behind while it is not raised (carried on the back). */
  guardsBack: boolean;
}

/** Parry window gained per point of guard bonus, for shields that only parry. */
export const PARRY_MS_PER_GUARD = 60;

export const SHIELDS: Record<ShieldDef['id'], ShieldDef> = {
  small: { id: 'small', size: 14, block: 0, parry: true, parryMs: 220, use: 'tap', activeMs: 220, cooldownMs: 120, raisedSpeed: 1, carrySpeed: 1, guardsBack: false },
  medium: { id: 'medium', size: 22, block: 1, parry: true, parryMs: 180, use: 'timed', activeMs: 900, cooldownMs: 450, raisedSpeed: 0.4, carrySpeed: 1, guardsBack: false },
  large: { id: 'large', size: 32, block: 2, parry: false, parryMs: 0, use: 'hold', activeMs: Infinity, cooldownMs: 800, raisedSpeed: 0, carrySpeed: 0.78, guardsBack: true },
};

/** Points this shield keeps out per hit, with the guard bonus (never below 0). */
export function blockOf(shield: ShieldDef, guardBonus: number): number {
  return shield.block > 0 ? Math.max(0, shield.block + guardBonus) : 0;
}

/** Parry window with the guard bonus (only the parry-only shield grows its window). */
export function parryMsOf(shield: ShieldDef, guardBonus: number): number {
  if (!shield.parry) return 0;
  return shield.block === 0 ? Math.max(100, shield.parryMs + guardBonus * PARRY_MS_PER_GUARD) : shield.parryMs;
}
