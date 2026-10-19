import Phaser from 'phaser';
import { PALETTE } from '../config';
import { type WeaponDef, triangleAt } from '../weapons';

/**
 * A weapon lying in the world: just its triangle, standing point-up and
 * bobbing slightly. Standing on it brightens it and offers the pick
 * button (target); pressing that swaps it with the one in hand.
 */
export class WeaponPickup {
  weapon: WeaponDef;
  readonly x: number;
  readonly y: number;
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene, x: number, y: number, weapon: WeaponDef) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.weapon = weapon;
    this.gfx = scene.add.graphics().setDepth(5);
    this.setNear(false);
    this.draw();
  }

  /** Feet within reach of the triangle's footprint. */
  touches(px: number, py: number): boolean {
    return Math.abs(px - this.x) < 22 && Math.abs(py - this.y) < 24;
  }

  swap(weapon: WeaponDef): void {
    this.weapon = weapon;
    this.draw();
  }

  /** Brighter while the player stands on it: the world-side half of the pick prompt. */
  setNear(near: boolean): void {
    this.gfx.setAlpha(near ? 1 : 0.55);
  }

  update(): void {
    this.gfx.y = Math.sin(this.scene.time.now / 400) * 3;
  }

  private draw(): void {
    const s = this.weapon.shape;
    // Stand it on its base, point up, sitting just above the ground.
    const tri = triangleAt({ ...s, base: 0 }, { angleDeg: -90, dist: 0, alpha: 1 }, this.x, this.y - 6, 1);
    this.gfx.clear().fillStyle(PALETTE.shape, 1).fillTriangleShape(tri);
  }
}
