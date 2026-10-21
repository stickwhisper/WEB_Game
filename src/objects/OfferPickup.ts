import Phaser from 'phaser';
import { PALETTE } from '../config';
import type { Change, Offer, Stat } from '../offers';

const SIZE = 13;
const GAP = 5;
/** Height above the ground where the row of shapes floats. */
const LIFT = 64;

/**
 * One growth offer, floating above the ground near the exit: its gain as a row of
 * filled shapes, and its loss (if any) as a row of hollow shapes just below. Two short
 * rows keep each offer narrow, so neighbouring offers never run together. Standing
 * under it brightens it and offers the pick button; picking it applies it and the
 * other offers vanish.
 */
export class OfferPickup {
  readonly offer: Offer;
  readonly x: number;
  readonly y: number;
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly scene: Phaser.Scene;
  private readonly phase = Math.random() * Math.PI * 2;
  gone = false;

  constructor(scene: Phaser.Scene, x: number, y: number, offer: Offer) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.offer = offer;
    this.gfx = scene.add.graphics({ x, y: y - LIFT }).setDepth(16);
    this.draw();
    this.setNear(false);
    this.gfx.setScale(0);
    scene.tweens.add({ targets: this.gfx, scale: 1, duration: 300, ease: 'Back.easeOut' });
  }

  /** Feet roughly under the floating row. */
  touches(px: number, py: number): boolean {
    return !this.gone && Math.abs(px - this.x) < 26 && Math.abs(py - this.y) < 24;
  }

  setNear(near: boolean): void {
    this.gfx.setAlpha(near ? 1 : 0.5);
  }

  update(): void {
    if (!this.gone) this.gfx.y = this.y - LIFT + Math.sin(this.scene.time.now / 380 + this.phase) * 3;
  }

  /** Taken: it rises into the player and fades. */
  take(toX: number, toY: number): void {
    this.gone = true;
    this.scene.tweens.add({ targets: this.gfx, x: toX, y: toY, scale: 0.4, alpha: 0, duration: 260, ease: 'Quad.easeIn', onComplete: () => this.gfx.destroy() });
  }

  /** Not chosen: it shrinks away. */
  dismiss(): void {
    this.gone = true;
    this.scene.tweens.add({ targets: this.gfx, scale: 0, alpha: 0, duration: 220, onComplete: () => this.gfx.destroy() });
  }

  private draw(): void {
    const g = this.gfx.clear();
    const row = (c: Change, y: number, filled: boolean) => {
      const width = c.n * SIZE + (c.n - 1) * GAP;
      for (let i = 0; i < c.n; i++) drawStat(g, c.stat, -width / 2 + SIZE / 2 + i * (SIZE + GAP), y, filled);
    };
    const { gain, loss } = this.offer;
    if (!loss) return row(gain, 0, true);
    row(gain, -(SIZE + GAP) / 2, true);
    row(loss, (SIZE + GAP) / 2, false);
  }
}

/** The stat's shape centred at (x, y): filled for a gain, hollow for a loss. */
function drawStat(g: Phaser.GameObjects.Graphics, stat: Stat, x: number, y: number, filled: boolean): void {
  const h = SIZE / 2;
  g.fillStyle(PALETTE.shape, 1).lineStyle(2, PALETTE.shape, 1);
  if (stat === 'hp') {
    if (filled) g.fillCircle(x, y, h);
    else g.strokeCircle(x, y, h - 1);
  } else if (stat === 'attack') {
    if (filled) g.fillTriangle(x - h, y + h, x + h, y + h, x, y - h);
    else g.strokeTriangle(x - h + 1, y + h - 1, x + h - 1, y + h - 1, x, y - h + 1);
  } else if (filled) g.fillRect(x - h, y - h, SIZE, SIZE);
  else g.strokeRect(x - h + 1, y - h + 1, SIZE - 2, SIZE - 2);
}
