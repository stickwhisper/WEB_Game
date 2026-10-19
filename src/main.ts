import Phaser from 'phaser';
import { PALETTE, TUNING, VIEW_HEIGHT } from './config';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';

/**
 * Fixed 540px logical height; width follows the device's landscape aspect
 * ratio so wide phones (19.5:9) use the whole screen instead of letterboxing.
 */
function viewWidth(): number {
  const long = Math.max(window.innerWidth, window.innerHeight);
  const short = Math.min(window.innerWidth, window.innerHeight) || 1;
  return Math.round(Phaser.Math.Clamp((VIEW_HEIGHT * long) / short, 800, 1280));
}

const debug = new URLSearchParams(location.search).has('debug');

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: PALETTE.background,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: viewWidth(),
    height: VIEW_HEIGHT,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: TUNING.gravity },
      // Resolve horizontal overlap first. Walls are stacks of separate bodies; with the
      // default (vertical first) a body pressed into a wall catches on the seams
      // between them and loses its jump. X-first lets it slide up the wall instead.
      forceX: true,
      debug,
    },
  },
  input: { activePointers: 4 },
  render: { antialias: true, roundPixels: true },
  scene: [BootScene, GameScene, UIScene],
});

// Expose for console poking and automated tests when running with ?debug.
if (debug) (window as unknown as { game: Phaser.Game }).game = game;
