import { TUNING } from '../config';

export type Action = 'jump' | 'attack' | 'roll';

const ACTIONS: Action[] = ['jump', 'attack', 'roll'];

/**
 * Device-independent input. Touch controls and the keyboard both write here;
 * the player only ever reads from here.
 *
 * Presses are timestamped so the player can act on them a little late
 * (input buffering): a roll tapped near the end of an attack still fires.
 */
class InputState {
  touchMoveX = 0;
  keyMoveX = 0;

  private held: Record<Action, boolean> = { jump: false, attack: false, roll: false };
  private pressedAt: Record<Action, number> = { jump: -Infinity, attack: -Infinity, roll: -Infinity };

  get moveX(): number {
    return Math.max(-1, Math.min(1, this.touchMoveX + this.keyMoveX));
  }

  press(action: Action): void {
    // Ignore key auto-repeat and a second source pressing an already-held action.
    if (this.held[action]) return;
    this.held[action] = true;
    this.pressedAt[action] = performance.now();
  }

  release(action: Action): void {
    this.held[action] = false;
  }

  isHeld(action: Action): boolean {
    return this.held[action];
  }

  /** True if the action was pressed within the buffer window and not yet consumed. */
  buffered(action: Action, windowMs = TUNING.input.bufferMs): boolean {
    return performance.now() - this.pressedAt[action] <= windowMs;
  }

  consume(action: Action): void {
    this.pressedAt[action] = -Infinity;
  }

  reset(): void {
    this.touchMoveX = 0;
    this.keyMoveX = 0;
    for (const a of ACTIONS) {
      this.held[a] = false;
      this.pressedAt[a] = -Infinity;
    }
  }
}

export const input = new InputState();
