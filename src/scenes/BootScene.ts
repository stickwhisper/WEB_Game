import Phaser from 'phaser';

/**
 * Generates placeholder textures in code so the prototype needs no art files.
 * Swap these keys for real spritesheets later.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const g = this.make.graphics({}, false);

    // Player: 28x44 body with a visor that shows facing direction (faces right).
    g.fillStyle(0x3d7bd9).fillRoundedRect(0, 0, 28, 44, 6);
    g.fillStyle(0x264f8f).fillRect(0, 30, 28, 14);
    g.fillStyle(0xf2d16b).fillRect(16, 10, 12, 6);
    g.generateTexture('player', 28, 44);
    g.clear();

    // Enemy: 34x34 blob with an eye (faces right).
    g.fillStyle(0xb8434f).fillRoundedRect(0, 0, 34, 34, 10);
    g.fillStyle(0xffffff).fillCircle(24, 13, 6);
    g.fillStyle(0x1a1a1a).fillCircle(26, 13, 3);
    g.generateTexture('enemy', 34, 34);
    g.clear();

    // Sword slash crescent (faces right).
    g.lineStyle(7, 0xffffff, 1);
    g.beginPath();
    g.arc(10, 32, 46, -1.1, 1.1);
    g.strokePath();
    g.lineStyle(3, 0xbfe3ff, 1);
    g.beginPath();
    g.arc(4, 32, 46, -0.9, 0.9);
    g.strokePath();
    g.generateTexture('slash', 64, 64);
    g.clear();

    // Hit spark particle.
    g.fillStyle(0xffffff).fillRect(0, 0, 6, 6);
    g.generateTexture('spark', 6, 6);
    g.clear();

    // Exit door.
    g.fillStyle(0x6b4b2a).fillRect(0, 0, 32, 64);
    g.fillStyle(0xf2d16b).fillRect(4, 4, 24, 60);
    g.fillStyle(0x1a1a28).fillRect(8, 8, 16, 56);
    g.generateTexture('door', 32, 64);

    g.destroy();
    this.scene.start('Game');
  }
}
