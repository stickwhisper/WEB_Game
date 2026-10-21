import Phaser from 'phaser';
import { PALETTE, TUNING, VIEW_HEIGHT } from './config';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { run } from './run';
import { telemetry } from './telemetry';

/**
 * Fixed 540px logical height; width follows the landscape aspect ratio of the
 * area left after notches and the home indicator (#game sits inside the safe
 * area), so phones from 4:3 to 24:9 fill the screen without bars.
 */
function viewWidth(): number {
  const area = document.getElementById('game')?.getBoundingClientRect();
  const w = area?.width || window.innerWidth;
  const h = area?.height || window.innerHeight;
  const long = Math.max(w, h);
  const short = Math.min(w, h) || 1;
  return Math.round(Phaser.Math.Clamp((VIEW_HEIGHT * long) / short, 720, 1440));
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

// Offline play for the home-screen app (production builds only; see public/sw.js).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Expose for console poking and automated tests when running with ?debug.
if (debug) Object.assign(window, { game, telemetry, run });
