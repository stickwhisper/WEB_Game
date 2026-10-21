import type Phaser from 'phaser';
import { PALETTE } from '../config';
import type { Binding } from './keyMap';

/**
 * The control symbols, drawn centred on (0, 0) of `g`: outlines normally, filled when `filled`.
 * Shared by the touch buttons and the settings screen so both speak the same language.
 *   left / right  a chevron
 *   attack        triangle
 *   guard         square
 *   jump          three vertical lines
 *   roll          three horizontal lines
 *   pick          two concentric circles (target)
 */
export function drawSymbol(g: Phaser.GameObjects.Graphics, binding: Binding, size: number, filled: boolean, alpha: number, lineScale = 1): void {
  const half = size / 2;
  g.lineStyle(3 * lineScale, PALETTE.shape, alpha);
  g.fillStyle(PALETTE.shape, alpha);
  switch (binding) {
    case 'left':
    case 'right': {
      const d = binding === 'left' ? -1 : 1;
      g.lineStyle((filled ? 6 : 4) * lineScale, PALETTE.shape, alpha);
      g.lineBetween(-d * half * 0.4, -half * 0.7, d * half * 0.4, 0);
      g.lineBetween(d * half * 0.4, 0, -d * half * 0.4, half * 0.7);
      break;
    }
    case 'attack':
      if (filled) g.fillTriangle(-half, half * 0.8, half, half * 0.8, 0, -half);
      else g.strokeTriangle(-half, half * 0.8, half, half * 0.8, 0, -half);
      break;
    case 'guard':
      if (filled) g.fillRect(-half * 0.8, -half * 0.8, size * 0.8, size * 0.8);
      else g.strokeRect(-half * 0.8, -half * 0.8, size * 0.8, size * 0.8);
      break;
    case 'jump':
    case 'roll':
      g.lineStyle(4 * lineScale, PALETTE.shape, alpha);
      for (const o of [-half * 0.6, 0, half * 0.6]) {
        if (binding === 'jump') g.lineBetween(o, -half, o, half);
        else g.lineBetween(-half, o, half, o);
      }
      break;
    case 'pick':
      g.strokeCircle(0, 0, half);
      if (filled) g.fillCircle(0, 0, half * 0.45);
      else g.strokeCircle(0, 0, half * 0.45);
      break;
  }
}
