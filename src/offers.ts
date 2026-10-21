import type Phaser from 'phaser';
import type { Loadout } from './run';

/**
 * Growth between rooms, in shapes: each stat is the shape that already means it.
 *   circle   maximum health
 *   triangle attack (added to every hit)
 *   square   shield (added to its block, or a wider parry window for a parry-only shield)
 * An offer shows its gain as filled shapes and, when it carries a risk, its loss as
 * hollow shapes of another kind: "+3 triangles, -2 circles" is three filled triangles
 * and two hollow circles.
 */
export type Stat = 'hp' | 'attack' | 'guard';
export const STATS: Stat[] = ['hp', 'attack', 'guard'];

export interface Change {
  stat: Stat;
  n: number;
}

export interface Offer {
  gain: Change;
  loss?: Change;
}

/** A loss never takes a stat below these. */
const FLOOR: Record<Stat, number> = { hp: 4, attack: -1, guard: -1 };

/** Gain and loss sizes and how often each appears. */
const TIERS = [
  { weight: 5, gain: 1, loss: 0 },
  { weight: 3, gain: 2, loss: 1 },
  { weight: 2, gain: 3, loss: 2 },
];

function valueOf(l: Loadout, stat: Stat): number {
  return stat === 'hp' ? l.maxHp : stat === 'attack' ? l.attackBonus : l.guardBonus;
}

/** Three offers, each raising a different stat. A risky one falls back to a plain +1 if its loss would go below the floor. */
export function rollOffers(rnd: Phaser.Math.RandomDataGenerator, l: Loadout): Offer[] {
  return rnd.shuffle([...STATS]).map((stat): Offer => {
    const roll = rnd.between(1, TIERS.reduce((a, t) => a + t.weight, 0));
    let acc = 0;
    const tier = TIERS.find((t) => (acc += t.weight) >= roll)!;
    if (!tier.loss) return { gain: { stat, n: tier.gain } };
    const lossStat = rnd.pick(STATS.filter((s) => s !== stat && valueOf(l, s) - tier.loss >= FLOOR[s]));
    return lossStat ? { gain: { stat, n: tier.gain }, loss: { stat: lossStat, n: tier.loss } } : { gain: { stat, n: 1 } };
  });
}

/** The loadout after taking `o`. Raising max health also fills the new circles; lowering it trims health to fit. */
export function applyOffer(l: Loadout, o: Offer): Loadout {
  const next = { ...l };
  for (const [c, sign] of [[o.gain, 1], [o.loss, -1]] as [Change | undefined, number][]) {
    if (!c) continue;
    const d = c.n * sign;
    if (c.stat === 'hp') {
      next.maxHp += d;
      next.hp = d > 0 ? next.hp + d : Math.min(next.hp, next.maxHp);
    } else if (c.stat === 'attack') next.attackBonus += d;
    else next.guardBonus += d;
  }
  return next;
}
