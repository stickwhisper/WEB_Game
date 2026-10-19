import Phaser from 'phaser';
import { PALETTE } from '../config';

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

    // Enemy body: horizontal ellipse.
    g.fillStyle(PALETTE.enemy).fillEllipse(24, 15, 48, 30);
    g.generateTexture('enemy', 48, 30);
    g.clear();

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
