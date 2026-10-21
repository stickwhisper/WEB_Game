import { TUNING } from '../config';

export type Action = 'jump' | 'attack' | 'guard' | 'roll' | 'pick';

export const ACTIONS: Action[] = ['jump', 'attack', 'guard', 'roll', 'pick'];

export type InputMode = 'touch' | 'keyboard';

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
  /** Down is held (stick pulled down, or a down key): combined with jump, drops through a line platform. */
  touchDown = false;
  keyDown = false;

  private held: Record<Action, boolean> = { jump: false, attack: false, guard: false, roll: false, pick: false };
  private pressedAt: Record<Action, number> = { jump: -Infinity, attack: -Infinity, guard: -Infinity, roll: -Infinity, pick: -Infinity };
  /** When each held action went down (unlike pressedAt, never cleared by consume). */
  private downAt: Record<Action, number> = { jump: 0, attack: 0, guard: 0, roll: 0, pick: 0 };

  get down(): boolean {
    return this.touchDown || this.keyDown;
  }

  /** How long the action has been held down (0 when it isn't): drives the long-press actions. */
  heldMs(action: Action): number {
    return this.held[action] ? performance.now() - this.downAt[action] : 0;
  }

  get moveX(): number {
    return Math.max(-1, Math.min(1, this.touchMoveX + this.keyMoveX));
  }

  press(action: Action): void {
    // Ignore key auto-repeat and a second source pressing an already-held action.
    if (this.held[action]) return;
    this.held[action] = true;
    this.pressedAt[action] = performance.now();
    this.downAt[action] = this.pressedAt[action];
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

  /**
   * Drop presses that haven't been acted on yet (e.g. on stage restart).
   * Held state is left alone: it belongs to the physical key or finger that is still down.
   */
  clearBuffered(): void {
    for (const a of ACTIONS) this.pressedAt[a] = -Infinity;
  }
}

export const input = new InputState();
