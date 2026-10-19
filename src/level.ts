import Phaser from 'phaser';
import { TILE } from './config';

/**
 * Level legend:
 *   #  solid tile
 *   =  one-way platform (jump up through it, land on top)
 *   P  player spawn
 *   E  enemy spawn
 *   D  exit door (bottom tile)
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
  '#............................................E...........................E.....................#',
  '#..........................................=====.......................=====...................#',
  '#..............................................................................................#',
  '#..............................................................................................#',
  '#.......=====................E......======..........###.......=====.............=====..........#',
  '#.........................#######...................###...................................D....#',
  '#.........................#######...................#######.............................########',
  '#..P...........E..........#######...........E.......#######.....E.....E.......E.........########',
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
  readonly enemySpawns: Spawn[] = [];
  readonly doors: Spawn[] = [];

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

  private tileAt(c: number, r: number): string {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return '#';
    return this.grid[r][c];
  }

  private readMarkers(): void {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const ch = this.grid[r][c];
        // Spawns are anchored to the bottom-center of their tile.
        const spawn = { x: c * TILE + TILE / 2, y: (r + 1) * TILE };
        if (ch === 'P') Object.assign(this.playerSpawn, spawn);
        else if (ch === 'E') this.enemySpawns.push(spawn);
        else if (ch === 'D') this.doors.push(spawn);
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

  private draw(scene: Phaser.Scene): void {
    const g = scene.add.graphics().setDepth(-1);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const ch = this.grid[r][c];
        const x = c * TILE;
        const y = r * TILE;
        if (ch === '#') {
          g.fillStyle((r + c) % 2 === 0 ? 0x2b2b40 : 0x29293d);
          g.fillRect(x, y, TILE, TILE);
          const above = this.tileAt(c, r - 1);
          if (above !== '#') {
            g.fillStyle(0x5a8f6a);
            g.fillRect(x, y, TILE, 5);
          }
        } else if (ch === '=') {
          g.fillStyle(0x8a6a4a);
          g.fillRect(x, y, TILE, 8);
          g.fillStyle(0x5a4530);
          g.fillRect(x + 4, y + 8, 4, 6);
          g.fillRect(x + TILE - 8, y + 8, 4, 6);
        }
      }
    }
  }
}
