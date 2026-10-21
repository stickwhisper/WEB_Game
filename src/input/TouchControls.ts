import Phaser from 'phaser';
import { PALETTE, TUNING, uiScale } from '../config';
import { type Action, input } from './InputState';
import { drawSymbol } from './symbols';

interface Button {
  action: Action;
  x: number;
  y: number;
  /** Icon size; the touch area is TUNING.input.buttonHitRadius (both times the UI scale). */
  size: number;
  pointerId: number | null;
  /** Contextual buttons (pick) only exist while there is something to do with them. */
  available: boolean;
  gfx: Phaser.GameObjects.Graphics;
}

const I = TUNING.input;

/**
 * Touch layout with no text and no backgrounds: each button is only its symbol.
 * Symbols are drawn as outlines (filled only while pressed) so they never read
 * as the filled shapes that live in the world.
 *   triangle         attack
 *   square           guard
 *   three | | |      jump   (vertical lines)
 *   three = lines    roll   (horizontal lines)
 *   two circles      pick up / swap a weapon (target; shown only when standing on one)
 * The left half of the screen is a floating stick drawn as a horizontal line.
 *
 * Every finger is tracked by pointer id, so moving, jumping and attacking
 * at the same time works. Mouse clicks drive the same code when the controls are shown.
 */
export class TouchControls {
  private readonly scene: Phaser.Scene;
  private readonly buttons: Button[] = [];
  private readonly joyGfx: Phaser.GameObjects.Graphics;
  private joyPointer: number | null = null;
  private readonly joyBase = new Phaser.Math.Vector2();
  private readonly joyKnob = new Phaser.Math.Vector2();
  private readonly joyHome = new Phaser.Math.Vector2();
  private enabled = true;
  /** UI scale for this screen (see uiScale): positions, sizes and touch areas all grow together. */
  private k = 1;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    scene.input.addPointer(3); // 4 simultaneous touches in total

    this.joyGfx = scene.add.graphics().setDepth(100);
    for (const action of ['attack', 'guard', 'jump', 'roll', 'pick'] as Action[]) {
      const available = action !== 'pick';
      const gfx = scene.add.graphics().setDepth(100).setVisible(available);
      this.buttons.push({ action, x: 0, y: 0, size: 0, pointerId: null, available, gfx });
    }
    this.layout();

    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    // Losing focus (notification, app switch) must not leave a direction or button stuck.
    scene.game.events.on(Phaser.Core.Events.BLUR, this.releaseAll, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
      scene.game.events.off(Phaser.Core.Events.BLUR, this.releaseAll, this);
    });
  }

  /** Hidden controls ignore all pointers, so a mouse click in keyboard mode does nothing. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    if (!enabled) this.releaseAll();
    this.enabled = enabled;
    this.joyGfx.setVisible(enabled);
    for (const b of this.buttons) b.gfx.setVisible(enabled && b.available);
  }

  /** Show or hide a contextual button. A hidden button ignores touches and lets go if held. */
  setAvailable(action: Action, available: boolean): void {
    const b = this.buttons.find((x) => x.action === action);
    if (!b || b.available === available) return;
    b.available = available;
    if (!available && b.pointerId !== null) {
      b.pointerId = null;
      input.release(action);
    }
    b.gfx.setVisible(this.enabled && available);
    this.drawButton(b);
    if (available) {
      // Pop in, so the new symbol is noticed.
      b.gfx.setScale(0.4);
      this.scene.tweens.add({ targets: b.gfx, scale: 1, duration: 180, ease: 'Back.easeOut' });
    }
  }

  /** Thumb arc anchored to the bottom-right corner, so it fits any aspect ratio. */
  private layout(): void {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const k = (this.k = uiScale(this.scene));
    // Offsets from the bottom-right corner, and icon size.
    const place: Record<Action, [number, number, number]> = {
      attack: [110, 110, 46],
      guard: [235, 175, 34],
      jump: [250, 62, 34],
      roll: [95, 250, 34],
      pick: [225, 295, 34],
    };
    for (const b of this.buttons) {
      const [dx, dy, size] = place[b.action];
      [b.x, b.y, b.size] = [w - dx * k, h - dy * k, size * k];
      b.gfx.setPosition(b.x, b.y);
      this.drawButton(b);
    }
    this.joyHome.set(150 * k, h - 110 * k);
    if (this.joyPointer === null) {
      this.joyBase.copy(this.joyHome);
      this.joyKnob.copy(this.joyHome);
    }
    this.drawJoystick();
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (!this.enabled) return;
    const btn = this.buttonAt(p.x, p.y);
    if (btn) {
      if (btn.pointerId !== null) return;
      btn.pointerId = p.id;
      input.press(btn.action);
      this.drawButton(btn);
      return;
    }
    if (this.joyPointer === null && p.x < this.scene.scale.width * 0.5) {
      this.joyPointer = p.id;
      this.joyBase.set(p.x, p.y);
      this.joyKnob.set(p.x, p.y);
      this.updateStick();
    }
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (!this.enabled || p.id !== this.joyPointer) return;
    this.joyKnob.set(p.x, p.y);
    this.updateStick();
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (p.id === this.joyPointer) {
      this.joyPointer = null;
      this.joyBase.copy(this.joyHome);
      this.joyKnob.copy(this.joyHome);
      input.touchMoveX = 0;
      input.touchDown = false;
      this.drawJoystick();
      return;
    }
    // Buttons release on lift even if the finger slid off them: more forgiving than "release on exit".
    for (const b of this.buttons) {
      if (b.pointerId === p.id) {
        b.pointerId = null;
        input.release(b.action);
        this.drawButton(b);
      }
    }
  }

  releaseAll(): void {
    for (const b of this.buttons) {
      if (b.pointerId !== null) {
        b.pointerId = null;
        input.release(b.action);
        this.drawButton(b);
      }
    }
    this.joyPointer = null;
    this.joyBase.copy(this.joyHome);
    this.joyKnob.copy(this.joyHome);
    input.touchMoveX = 0;
    input.touchDown = false;
    this.drawJoystick();
  }

  private updateStick(): void {
    const R = I.joystickRadius;
    const d = this.joyKnob.clone().subtract(this.joyBase);
    // Floating stick: if the thumb drifts past the rim, drag the base along behind it.
    if (d.length() > R) {
      const excess = d.clone().setLength(d.length() - R);
      this.joyBase.add(excess);
      d.setLength(R);
    }
    this.joyKnob.copy(this.joyBase).add(d);
    const nx = d.x / R;
    const mag = Math.abs(nx);
    // Past the dead zone, ramp to full speed by 60% travel: platformers want near-digital response.
    const ramp = Phaser.Math.Clamp((mag - I.joystickDeadZone) / (0.6 - I.joystickDeadZone), 0, 1);
    input.touchMoveX = Math.sign(nx) * ramp;
    // Pulled well down (and more down than sideways): "down", for dropping through line platforms.
    input.touchDown = d.y / R > 0.55 && Math.abs(d.y) > Math.abs(d.x);
    this.drawJoystick();
  }

  private buttonAt(x: number, y: number): Button | undefined {
    let best: Button | undefined;
    let bestDist = Infinity;
    for (const b of this.buttons) {
      if (!b.available) continue;
      const dist = Phaser.Math.Distance.Between(x, y, b.x, b.y);
      if (dist <= I.buttonHitRadius * this.k && dist < bestDist) {
        best = b;
        bestDist = dist;
      }
    }
    return best;
  }

  private drawButton(b: Button): void {
    const pressed = b.pointerId !== null;
    const g = b.gfx.clear();
    drawSymbol(g, b.action, b.size * (pressed ? 0.88 : 1), pressed, pressed ? 0.95 : 0.4, this.k);
  }


  /**
   * While a thumb is down: a horizontal line (the travel) and a short vertical tick (the thumb).
   * Nothing is drawn at rest, since an idle line would read as a platform in the world.
   */
  private drawJoystick(): void {
    const R = I.joystickRadius;
    const g = this.joyGfx.clear();
    if (this.joyPointer === null) return;
    g.lineStyle(2, PALETTE.shape, 0.4);
    g.lineBetween(this.joyBase.x - R, this.joyBase.y, this.joyBase.x + R, this.joyBase.y);
    g.lineStyle(4, PALETTE.shape, 0.8);
    g.lineBetween(this.joyKnob.x, this.joyBase.y - 18, this.joyKnob.x, this.joyBase.y + 18);
  }
}
