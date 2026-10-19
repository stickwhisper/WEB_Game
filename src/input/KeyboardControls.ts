import Phaser from 'phaser';
import { KEY_BINDINGS } from '../config';
import { type Action, input } from './InputState';

const ACTIONS: Action[] = ['jump', 'attack', 'roll'];

/**
 * Keyboard input. Writes into the same InputState as the touch controls, so
 * the player code doesn't know or care which device is in use.
 *
 * Movement is event-driven (no polling) and "last pressed wins": holding
 * right then tapping left turns around immediately instead of stopping.
 */
export class KeyboardControls {
  /** Held direction keys in press order; the newest one decides the direction. */
  private readonly heldDirs = new Map<number, -1 | 1>();
  private readonly heldActions = new Map<number, Action>();

  /** @param onUse called on every key press, used to switch the UI to keyboard mode. */
  constructor(scene: Phaser.Scene, onUse: () => void) {
    const kb = scene.input.keyboard;
    if (!kb) return;

    const bindDir = (names: string[], dir: -1 | 1) => {
      for (const name of names) {
        const key = kb.addKey(name);
        key.on(Phaser.Input.Keyboard.Events.DOWN, () => {
          onUse();
          this.heldDirs.delete(key.keyCode); // re-insert at the end = most recent
          this.heldDirs.set(key.keyCode, dir);
          this.updateMove();
        });
        key.on(Phaser.Input.Keyboard.Events.UP, () => {
          this.heldDirs.delete(key.keyCode);
          this.updateMove();
        });
      }
    };
    bindDir(KEY_BINDINGS.left, -1);
    bindDir(KEY_BINDINGS.right, 1);

    for (const action of ACTIONS) {
      for (const name of KEY_BINDINGS[action]) {
        const key = kb.addKey(name);
        key.on(Phaser.Input.Keyboard.Events.DOWN, () => {
          onUse();
          this.heldActions.set(key.keyCode, action);
          input.press(action);
        });
        key.on(Phaser.Input.Keyboard.Events.UP, () => {
          this.heldActions.delete(key.keyCode);
          // Another key bound to the same action may still be down (e.g. Space and Z).
          if (![...this.heldActions.values()].includes(action)) input.release(action);
        });
      }
    }

    // Phaser resets keys on blur without firing "up", so clear our own state too.
    scene.game.events.on(Phaser.Core.Events.BLUR, this.releaseAll, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.game.events.off(Phaser.Core.Events.BLUR, this.releaseAll, this);
    });
  }

  releaseAll(): void {
    this.heldDirs.clear();
    this.updateMove();
    for (const action of new Set(this.heldActions.values())) input.release(action);
    this.heldActions.clear();
  }

  private updateMove(): void {
    let dir = 0;
    for (const d of this.heldDirs.values()) dir = d;
    input.keyMoveX = dir;
  }
}
