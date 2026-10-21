import Phaser from 'phaser';
import { PALETTE } from '../config';
import type { Item } from '../items';
import { blockOf } from '../shields';
import { triangleAt } from '../weapons';

const STAT_SIZE = 9;
const STAT_GAP = 3;
const GROUP_GAP = 9;

/**
 * A weapon (its triangle, point up) or a shield (its square, by size) lying in the
 * world, bobbing slightly. Standing on it brightens it, offers the pick button and
 * shows what it is worth, counted in shapes above it:
 *   weapon  one group of triangles per move of its combo, one triangle per point of damage
 *   shield  one square per point it keeps out of health (none for a parry-only shield)
 * Reach and speed show themselves the moment it is swung; damage doesn't, so it is shown.
 */
export class ItemPickup {
  item: Item;
  readonly x: number;
  readonly y: number;
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly stats: Phaser.GameObjects.Graphics;
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene, x: number, y: number, item: Item) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.item = item;
    this.gfx = scene.add.graphics().setDepth(5);
    this.stats = scene.add.graphics().setDepth(16);
    this.setNear(false);
    this.draw();
  }

  /** Feet within reach of the item's footprint. */
  touches(px: number, py: number): boolean {
    return Math.abs(px - this.x) < 22 && Math.abs(py - this.y) < 24;
  }

  swap(item: Item): void {
    this.item = item;
    this.draw();
  }

  /**
   * Brighter while the player stands on it (the world-side half of the pick prompt),
   * with its worth shown above, computed with the player's current upgrades.
   */
  setNear(near: boolean, attackBonus = 0, guardBonus = 0): void {
    this.gfx.setAlpha(near ? 1 : 0.55);
    this.stats.clear();
    if (near) this.drawStats(attackBonus, guardBonus);
  }

  update(): void {
    const bob = Math.sin(this.scene.time.now / 400) * 3;
    this.gfx.y = bob;
    this.stats.y = bob;
  }

  private get height(): number {
    return this.item.kind === 'weapon' ? this.item.weapon.shape.length : this.item.shield.size;
  }

  private draw(): void {
    const g = this.gfx.clear().fillStyle(PALETTE.shape, 1);
    if (this.item.kind === 'weapon') {
      // Stand it on its base, point up, sitting just above the ground.
      const tri = triangleAt({ ...this.item.weapon.shape, base: 0 }, { angleDeg: -90, dist: 0, alpha: 1 }, this.x, this.y - 6, 1);
      g.fillTriangleShape(tri);
    } else {
      const s = this.item.shield.size;
      g.fillRect(this.x - s / 2, this.y - 4 - s, s, s);
    }
  }

  private drawStats(attackBonus: number, guardBonus: number): void {
    // Groups of shapes: one group per combo move for a weapon, a single group for a shield.
    const groups =
      this.item.kind === 'weapon'
        ? this.item.weapon.moves.map((m) => Math.max(1, m.damage + attackBonus))
        : [blockOf(this.item.shield, guardBonus)].filter((n) => n > 0);
    if (!groups.length) return;
    const widths = groups.map((n) => n * STAT_SIZE + (n - 1) * STAT_GAP);
    const total = widths.reduce((a, b) => a + b, 0) + (groups.length - 1) * GROUP_GAP;
    const cy = this.y - 6 - this.height - 18;
    let x = this.x - total / 2;
    const g = this.stats.fillStyle(PALETTE.shape, 0.95);
    groups.forEach((n, gi) => {
      for (let i = 0; i < n; i++) {
        const l = x + i * (STAT_SIZE + STAT_GAP);
        if (this.item.kind === 'weapon') g.fillTriangle(l, cy + STAT_SIZE / 2, l + STAT_SIZE, cy + STAT_SIZE / 2, l + STAT_SIZE / 2, cy - STAT_SIZE / 2);
        else g.fillRect(l, cy - STAT_SIZE / 2, STAT_SIZE, STAT_SIZE);
      }
      x += widths[gi] + GROUP_GAP;
    });
  }
}
