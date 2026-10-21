import type { ShieldDef } from './shields';
import type { WeaponDef } from './weapons';

/** Anything that lies on the ground and can be swapped with what the player carries. */
export type Item = { kind: 'weapon'; weapon: WeaponDef } | { kind: 'shield'; shield: ShieldDef };
