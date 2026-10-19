import Phaser from 'phaser';
import { PALETTE, TILE } from './config';
import { ENEMIES, type EnemyDef } from './enemies';
import { WEAPONS, type WeaponDef } from './weapons';

const WEAPON_MARKERS: Record<string, WeaponDef> = { s: WEAPONS.spear, d: WEAPONS.dagger, h: WEAPONS.hammer, w: WEAPONS.sword };
const ENEMY_MARKERS: Record<string, EnemyDef> = { E: ENEMIES.grunt, H: ENEMIES.hopper, W: ENEMIES.warden, B: ENEMIES.brute };

/**
 * Level legend:
 *   #  solid tile
 *   =  one-way platform (jump up through it, land on top)
 *   P  player spawn
 *   E  grunt (wide ellipse)     H  hopper (tall ellipse)
 *   W  warden (rounded square)  B  brute (large flat ellipse)   (see enemies.ts)
 *   D  exit square (bottom tile)
 *   s  spear, d  dagger, h  hammer, w  sword (weapon lying on the ground)
 *   .  empty
 */
export const LEVEL_1 = [
  '################################################################################################',
  '#..............................................................................................#',
  '#..............................................................................................#',
  '#..............................................................................................#',
  '#..............................................................................................#',
  '#..............................................................................................#',
  '#..............................................................................................#',
  '#..............................................................................................#',
  '#..............................................................................................#',
  '#............................................H...........................H.....................#',
  '#..........................................=====.......................=====...................#',
  '#..............................................................................................#',
  '#..............................................................................................#',
  '#.......=====................H......======..........###.......=====.............=====..........#',
  '#.........................#######...................###...................................D....#',
  '#.........................#######...................#######.............................########',
  '#..P..s..d..h...E..........#######..........W.......#######.....E.....B.......W.........########',
  '##################....##########################################################################',
  '##################....##########################################################################',
  '################################################################################################',
];

export interface Spawn {
  x: number;
  y: number;
}

export class Level {
  readonly cols: number;
  readonly rows: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly solids: Phaser.Physics.Arcade.StaticGroup;
  readonly oneWays: Phaser.Physics.Arcade.StaticGroup;
  readonly playerSpawn: Spawn = { x: TILE * 2, y: TILE * 2 };
  readonly enemySpawns: (Spawn & { enemy: EnemyDef })[] = [];
  readonly exits: Spawn[] = [];
  readonly weapons: (Spawn & { weapon: WeaponDef })[] = [];

  private readonly grid: string[];

  constructor(scene: Phaser.Scene, data: string[]) {
    this.cols = Math.max(...data.map((r) => r.length));
    this.rows = data.length;
    this.grid = data.map((r) => r.padEnd(this.cols, '.'));
    this.widthPx = this.cols * TILE;
    this.heightPx = this.rows * TILE;

    this.solids = scene.physics.add.staticGroup();
    this.oneWays = scene.physics.add.staticGroup();

    this.readMarkers();
    this.buildColliders(scene);
    this.draw(scene);
  }

  isSolidAt(px: number, py: number): boolean {
    const c = Math.floor(px / TILE);
    const r = Math.floor(py / TILE);
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return true;
    const ch = this.grid[r][c];
    return ch === '#' || ch === '=';
  }

  private readMarkers(): void {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const ch = this.grid[r][c];
        // Spawns are anchored to the bottom-center of their tile.
        const spawn = { x: c * TILE + TILE / 2, y: (r + 1) * TILE };
        if (ch === 'P') Object.assign(this.playerSpawn, spawn);
        else if (ENEMY_MARKERS[ch]) this.enemySpawns.push({ ...spawn, enemy: ENEMY_MARKERS[ch] });
        else if (ch === 'D') this.exits.push(spawn);
        else if (WEAPON_MARKERS[ch]) this.weapons.push({ ...spawn, weapon: WEAPON_MARKERS[ch] });
      }
    }
  }

  /** Merge horizontal runs of tiles into single static bodies (far fewer bodies than one per tile). */
  private buildColliders(scene: Phaser.Scene): void {
    for (let r = 0; r < this.rows; r++) {
      let c = 0;
      while (c < this.cols) {
        const ch = this.grid[r][c];
        if (ch !== '#' && ch !== '=') {
          c++;
          continue;
        }
        const start = c;
        while (c < this.cols && this.grid[r][c] === ch) c++;
        const w = (c - start) * TILE;
        const zone = scene.add.zone(start * TILE + w / 2, r * TILE + TILE / 2, w, TILE);
        if (ch === '#') {
          this.solids.add(zone);
        } else {
          this.oneWays.add(zone);
          const body = zone.body as Phaser.Physics.Arcade.StaticBody;
          body.checkCollision.down = false;
          body.checkCollision.left = false;
          body.checkCollision.right = false;
        }
      }
    }
  }

  /** Flat masses and thin lines: no texture, no tile grid, nothing that reads as a square. */
  private draw(scene: Phaser.Scene): void {
    const g = scene.add.graphics().setDepth(-1);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const ch = this.grid[r][c];
        if (ch === '#') {
          g.fillStyle(PALETTE.terrain).fillRect(c * TILE, r * TILE, TILE, TILE);
        } else if (ch === '=') {
          g.fillStyle(PALETTE.platform).fillRect(c * TILE, r * TILE, TILE, 3);
        }
      }
    }
  }
}
