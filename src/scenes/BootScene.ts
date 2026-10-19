import Phaser from 'phaser';
import { PALETTE } from '../config';
import { ENEMIES } from '../enemies';

/**
 * Generates every texture in code. There is no art: only the few shapes the
 * game is made of. Bodies are round (circles, ellipses) so that later
 * characters can be varied by stretching or rounding them.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const g = this.make.graphics({}, false);

    // Player body: circle.
    g.fillStyle(PALETTE.player).fillCircle(18, 18, 18);
    g.generateTexture('player', 36, 36);
    g.clear();

    // Enemy bodies: ellipses, or rounded rectangles when a corner radius is given.
    for (const def of Object.values(ENEMIES)) {
      const { width: w, height: h, radius } = def.body;
      g.fillStyle(PALETTE.enemy);
      if (radius === undefined) g.fillEllipse(w / 2, h / 2, w, h);
      else g.fillRoundedRect(0, 0, w, h, radius);
      g.generateTexture(`enemy-${def.id}`, w, h);
      g.clear();
    }

    // Effect shapes: one circle = one point of health, one square = one point kept out of it.
    g.fillStyle(PALETTE.shape).fillCircle(5, 5, 5);
    g.generateTexture('circle', 10, 10);
    g.clear();
    g.fillStyle(PALETTE.shape).fillRect(0, 0, 9, 9);
    g.generateTexture('square', 9, 9);

    g.destroy();
    this.scene.start('Game');
  }
}
