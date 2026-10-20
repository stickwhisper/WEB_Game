import { TUNING } from './config';
import { ARENA, type RoomDef, TUTORIAL } from './rooms';

/**
 * One run: a sequence of rooms walked through in order. Health and the weapon
 * in hand carry from room to room; dying throws the whole run away.
 * Lives outside the scenes because the game scene restarts for every room.
 */
class Run {
  rooms: RoomDef[] = [];
  index = 0;
  hp: number = TUNING.player.maxHp;
  weaponId = 'sword';

  constructor() {
    this.reset();
  }

  get room(): RoomDef {
    return this.rooms[this.index];
  }

  reset(): void {
    this.rooms = [...TUTORIAL, ARENA];
    this.index = 0;
    this.hp = TUNING.player.maxHp;
    this.weaponId = 'sword';
  }

  /** Leave the current room carrying `hp` and the weapon. A finished run starts over. */
  advance(hp: number, weaponId: string): void {
    this.hp = hp;
    this.weaponId = weaponId;
    this.index++;
    if (this.index >= this.rooms.length) this.reset();
  }
}

export const run = new Run();
