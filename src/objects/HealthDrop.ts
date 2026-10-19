import Phaser from 'phaser';
import { PALETTE, TILE } from '../config';
import type { Level } from '../level';

const RADIUS = 6;

/**
 * A circle of health left by a dead enemy. It arcs out of the body, settles on
 * the ground and waits; walking through it while hurt takes it back.
 * Health taken from you can be taken back from them: the circle is the same circle.
 */
export class HealthDrop {
  x: number;
  y: number;
  /** Not collectable while still in the air. */
  landed = false;
  taken = false;
  private readonly gfx: Phaser.GameObjects.Arc;
  private readonly scene: Phaser.Scene;
  private readonly phase = Math.random() * Math.PI * 2;

  constructor(scene: Phaser.Scene, level: Level, fromX: number, fromY: number, spread: number) {
    this.scene = scene;
    const toX = fromX + spread;
    const toY = groundBelow(level, toX, fromY) - RADIUS - 2;
    this.x = fromX;
    this.y = fromY;
    this.gfx = scene.add.circle(fromX, fromY, RADIUS, PALETTE.shape).setDepth(6);

    // Arc out of the body: a short rise, then down onto the ground.
    const peak = Math.min(fromY, toY) - 40;
    const arc = { t: 0 };
    scene.tweens.add({
      targets: arc,
      t: 1,
      duration: 520,
      onUpdate: () => {
        const t = arc.t;
        this.x = Phaser.Math.Linear(fromX, toX, t);
        // Quadratic Bezier through the peak.
        this.y = (1 - t) * (1 - t) * fromY + 2 * (1 - t) * t * peak + t * t * toY;
        this.gfx.setPosition(this.x, this.y);
      },
      onComplete: () => {
        this.landed = true;
      },
    });
  }

  update(): void {
    if (this.landed && !this.taken) this.gfx.y = this.y + Math.sin(this.scene.time.now / 350 + this.phase) * 2;
  }

  /** Fly into the player and vanish. */
  absorb(target: { x: number; y: number }): void {
    this.taken = true;
    this.scene.tweens.add({
      targets: this.gfx,
      x: target.x,
      y: target.y,
      scale: 0.3,
      alpha: 0,
      duration: 180,
      ease: 'Quad.easeIn',
      onComplete: () => this.gfx.destroy(),
    });
  }
}

/** First solid surface at or below (x, y); falls back to y if there is none within a few tiles. */
function groundBelow(level: Level, x: number, y: number): number {
  for (let py = y; py < y + TILE * 8; py += 4) {
    if (level.isSolidAt(x, py)) return Math.floor(py / TILE) * TILE;
  }
  return y;
}
