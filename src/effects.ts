import Phaser from 'phaser';
import { PALETTE } from './config';

const TRAIL_MS = 140;

interface Ghost {
  tri: Phaser.Geom.Triangle;
  born: number;
  alpha: number;
}

/**
 * The only feedback the game gives: shapes, counted out one per point.
 *   bleed(n)  - n circles leave a body (health lost)
 *   block(n)  - n squares leave a guard (damage that never reached health)
 *   trail()   - fading triangle afterimages along an attack's path
 */
export class Effects {
  private readonly circles: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly squares: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly trailGfx: Phaser.GameObjects.Graphics;
  private readonly ghosts: Ghost[] = [];
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const burst = {
      speed: { min: 110, max: 260 },
      // Mostly upward fan, so the shapes arc out and fall where they can be counted.
      angle: { min: 215, max: 325 },
      lifespan: 900,
      gravityY: 900,
      alpha: { start: 1, end: 0, ease: 'Quad.easeIn' },
      emitting: false,
    };
    this.circles = scene.add.particles(0, 0, 'circle', burst).setDepth(20);
    this.squares = scene.add.particles(0, 0, 'square', { ...burst, rotate: { min: -20, max: 20 } }).setDepth(20);
    this.trailGfx = scene.add.graphics().setDepth(14);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.drawTrail, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.UPDATE, this.drawTrail, this));
  }

  bleed(count: number, x: number, y: number): void {
    if (count > 0) this.circles.explode(count, x, y);
  }

  block(count: number, x: number, y: number): void {
    if (count > 0) this.squares.explode(count, x, y);
  }

  trail(tri: Phaser.Geom.Triangle, alpha: number): void {
    this.ghosts.push({ tri: Phaser.Geom.Triangle.Clone(tri), born: this.scene.time.now, alpha });
  }

  private drawTrail(): void {
    const now = this.scene.time.now;
    const g = this.trailGfx.clear();
    while (this.ghosts.length && now - this.ghosts[0].born > TRAIL_MS) this.ghosts.shift();
    for (const gh of this.ghosts) {
      const life = 1 - (now - gh.born) / TRAIL_MS;
      g.fillStyle(PALETTE.shape, 0.35 * life * gh.alpha);
      g.fillTriangleShape(gh.tri);
    }
  }
}
