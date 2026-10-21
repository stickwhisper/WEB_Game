import Phaser from 'phaser';
import { type Action, input } from './InputState';
import { keyMap } from './keyMap';

/**
 * Keyboard input. Writes into the same InputState as the touch controls, so
 * the player code doesn't know or care which device is in use.
 *
 * Keys are looked up in keyMap on every press, so rebinding in the settings
 * screen takes effect immediately. Movement is "last pressed wins": holding
 * right then tapping left turns around immediately instead of stopping.
 */
export class KeyboardControls {
  /** While false (settings open), keys are ignored here. */
  enabled = true;
  /** Held direction keys in press order; the newest one decides the direction. */
  private readonly heldDirs = new Map<number, -1 | 1>();
  private readonly heldActions = new Map<number, Action>();
  private readonly kb?: Phaser.Input.Keyboard.KeyboardPlugin;

  /** @param onUse called on every bound key press, used to switch the UI to keyboard mode. */
  constructor(scene: Phaser.Scene, onUse: () => void) {
    const kb = scene.input.keyboard;
    if (!kb) return;
    this.kb = kb;

    kb.on('keydown', (e: KeyboardEvent) => {
      if (!this.enabled || e.repeat) return;
      const binding = keyMap.bindingFor(e.keyCode);
      if (!binding) return;
      onUse();
      if (binding === 'left' || binding === 'right') {
        this.heldDirs.delete(e.keyCode); // re-insert at the end = most recent
        this.heldDirs.set(e.keyCode, binding === 'left' ? -1 : 1);
        this.updateMove();
      } else {
        this.heldActions.set(e.keyCode, binding);
        input.press(binding);
      }
    });
    kb.on('keyup', (e: KeyboardEvent) => {
      // Release by what was pressed, not by the current map: a key may have been rebound meanwhile.
      if (this.heldDirs.delete(e.keyCode)) this.updateMove();
      const action = this.heldActions.get(e.keyCode);
      if (action) {
        this.heldActions.delete(e.keyCode);
        // Another key bound to the same action may still be down (e.g. Space and Z).
        if (![...this.heldActions.values()].includes(action)) input.release(action);
      }
    });

    // Bound keys must not scroll the page (Space, arrows).
    this.capture();
    const off = keyMap.onChange(() => this.capture());

    // Phaser resets keys on blur without firing "up", so clear our own state too.
    scene.game.events.on(Phaser.Core.Events.BLUR, this.releaseAll, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      off();
      scene.game.events.off(Phaser.Core.Events.BLUR, this.releaseAll, this);
    });
  }

  releaseAll(): void {
    this.heldDirs.clear();
    this.updateMove();
    for (const action of new Set(this.heldActions.values())) input.release(action);
    this.heldActions.clear();
  }

  private capture(): void {
    if (!this.kb) return;
    this.kb.clearCaptures();
    this.kb.addCapture(keyMap.allCodes());
  }

  private updateMove(): void {
    let dir = 0;
    for (const d of this.heldDirs.values()) dir = d;
    input.keyMoveX = dir;
  }
}
