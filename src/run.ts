import Phaser from 'phaser';
import { TUNING } from './config';
import { BOSS, POOL, type RoomDef, TUTORIAL, mirrored } from './rooms';

/** Pool rooms walked in one run, after the tutorial (when it is still needed). */
const ROOMS_PER_RUN = 5;
const TAUGHT_KEY = 'agame.taught';

/**
 * One run: a sequence of rooms walked through in order. Health and the weapon
 * in hand carry from room to room; dying throws the whole run away.
 * Lives outside the scenes because the game scene restarts for every room.
 *
 * The tutorial is played until it has been finished once on this device
 * (add ?fresh to the URL to see it again). After it, every run draws its
 * rooms at random from the pool, each possibly mirrored, and ends in the boss room.
 */
class Run {
  rooms: RoomDef[] = [];
  index = 0;
  hp: number = TUNING.player.maxHp;
  weaponId = 'sword';
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
    const drawn = this.rnd.shuffle([...POOL]).slice(0, ROOMS_PER_RUN).map((r) => (this.rnd.frac() < 0.5 ? mirrored(r) : r));
    this.rooms = [...(load(TAUGHT_KEY) ? [] : TUTORIAL), ...drawn, BOSS];
    this.index = 0;
    this.hp = TUNING.player.maxHp;
    this.weaponId = 'sword';
  }

  get inBossRoom(): boolean {
    return this.room === BOSS;
  }

  /** Leave the current room carrying `hp` and the weapon. A finished run starts over. */
  advance(hp: number, weaponId: string): void {
    if (this.room === TUTORIAL[TUTORIAL.length - 1]) store(TAUGHT_KEY, '1');
    this.hp = hp;
    this.weaponId = weaponId;
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
