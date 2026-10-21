import Phaser from 'phaser';
import { TUNING } from './config';
import { BOSS, POOL, PRACTICE, type RoomDef, TUTORIAL, mirrored } from './rooms';
import type { ShieldDef } from './shields';

/** Pool rooms walked in one run, after the tutorial (when it is still needed). */
const ROOMS_PER_RUN = 5;
const TAUGHT_KEY = 'agame.taught';

/** What the player carries from room to room. */
export interface Loadout {
  hp: number;
  maxHp: number;
  weaponId: string;
  shieldId: ShieldDef['id'];
  /** Added to every hit (triangle upgrades; may be negative, a hit still deals at least 1). */
  attackBonus: number;
  /** Added to the shield's block, or widens a parry-only shield's window (square upgrades). */
  guardBonus: number;
}

export function freshLoadout(): Loadout {
  return { hp: TUNING.player.maxHp, maxHp: TUNING.player.maxHp, weaponId: 'sword', shieldId: 'medium', attackBonus: 0, guardBonus: 0 };
}

/**
 * One run: a sequence of rooms walked through in order. The loadout (health,
 * weapon, shield, upgrades) carries from room to room; dying throws the whole run away.
 * Lives outside the scenes because the game scene restarts for every room.
 *
 * The tutorial is played until it has been finished once on this device
 * (add ?fresh to the URL to see it again). After it, every run draws its
 * rooms at random from the pool, each possibly mirrored, and ends in the boss room.
 */
class Run {
  rooms: RoomDef[] = [];
  index = 0;
  loadout: Loadout = freshLoadout();
  /** The run set aside while in the practice room (restored on leaving it). */
  private beforePractice?: { rooms: RoomDef[]; index: number; loadout: Loadout };
  readonly rnd = new Phaser.Math.RandomDataGenerator([String(Date.now())]);

  constructor() {
    if (new URLSearchParams(location.search).has('fresh')) store(TAUGHT_KEY, null);
    this.reset();
  }

  get room(): RoomDef {
    return this.rooms[this.index];
  }

  /** Exits passed in this run, shown as small squares under the health circles. */
  get exitsPassed(): number {
    return this.index;
  }

  reset(): void {
    this.beforePractice = undefined;
    const drawn = this.rnd.shuffle([...POOL]).slice(0, ROOMS_PER_RUN).map((r) => (this.rnd.frac() < 0.5 ? mirrored(r) : r));
    this.rooms = [...(load(TAUGHT_KEY) ? [] : TUTORIAL), ...drawn, BOSS];
    this.index = 0;
    this.loadout = freshLoadout();
  }

  get inBossRoom(): boolean {
    return this.room === BOSS;
  }

  /** Growth offers appear when a drawn room is cleared (not in the tutorial, the boss room or practice). */
  get offersGrowth(): boolean {
    return !TUTORIAL.includes(this.room) && this.room !== BOSS && !this.inPractice;
  }

  get inPractice(): boolean {
    return this.room === PRACTICE;
  }

  /**
   * Step aside into the practice room with what is carried now (health full). Nothing done
   * there carries back: leaving restores the run as it was, at the start of the same room.
   */
  enterPractice(current: Loadout): void {
    if (this.inPractice) return;
    this.beforePractice = { rooms: this.rooms, index: this.index, loadout: { ...current } };
    this.rooms = [PRACTICE];
    this.index = 0;
    this.loadout = { ...current, hp: current.maxHp };
  }

  leavePractice(): void {
    if (!this.beforePractice) return;
    ({ rooms: this.rooms, index: this.index, loadout: this.loadout } = this.beforePractice);
    this.beforePractice = undefined;
  }

  /** Leave the current room carrying `loadout`. A finished run starts over. */
  advance(loadout: Loadout): void {
    if (this.inPractice) return this.leavePractice();
    if (this.room === TUTORIAL[TUTORIAL.length - 1]) store(TAUGHT_KEY, '1');
    this.loadout = { ...loadout };
    this.index++;
    if (this.index >= this.rooms.length) this.reset();
  }
}

// Remembering the tutorial is a convenience; storage can be blocked, so never let it throw.
function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export const run = new Run();
