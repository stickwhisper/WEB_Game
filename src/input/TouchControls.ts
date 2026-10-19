import Phaser from 'phaser';
import { TUNING } from '../config';
import { type Action, input } from './InputState';

interface Button {
  action: Action;
  label: string;
  x: number;
  y: number;
  r: number;
  color: number;
  pointerId: number | null;
  gfx: Phaser.GameObjects.Graphics;
  text: Phaser.GameObjects.Text;
}

const I = TUNING.input;

/**
 * Button-style touch layout:
 *   left half  - floating joystick (appears wherever the thumb lands)
 *   right side - attack / jump / roll buttons in a thumb arc
 *
 * Every finger is tracked by pointer id, so moving, jumping and attacking
 * at the same time works. Mouse clicks drive the same code for desktop testing.
 */
export class TouchControls {
  private readonly scene: Phaser.Scene;
  private readonly buttons: Button[] = [];
  private readonly joyGfx: Phaser.GameObjects.Graphics;
  private joyPointer: number | null = null;
  private readonly joyBase = new Phaser.Math.Vector2();
  private readonly joyKnob = new Phaser.Math.Vector2();
  private readonly joyHome = new Phaser.Math.Vector2();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    scene.input.addPointer(3); // 4 simultaneous touches in total

    this.joyGfx = scene.add.graphics().setDepth(100);
    this.addButton('attack', '공격', 0xd9534f);
    this.addButton('jump', '점프', 0x3d7bd9);
    this.addButton('roll', '구르기', 0x4caf7a);
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

  private addButton(action: Action, label: string, color: number): void {
    const gfx = this.scene.add.graphics().setDepth(100);
    const text = this.scene.add
      .text(0, 0, label, { fontFamily: 'system-ui, sans-serif', fontSize: '18px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5)
      .setDepth(101)
      .setAlpha(0.85);
    this.buttons.push({ action, label, x: 0, y: 0, r: 0, color, pointerId: null, gfx, text });
  }

  /** Positions are anchored to the bottom-right corner so they stay under the thumb on any aspect ratio. */
  private layout(): void {
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    const place: Record<Action, [number, number, number]> = {
      attack: [w - 110, h - 115, 62],
      jump: [w - 250, h - 75, 50],
      roll: [w - 85, h - 260, 46],
    };
    for (const b of this.buttons) {
      [b.x, b.y, b.r] = place[b.action];
      b.text.setPosition(b.x, b.y);
      this.drawButton(b);
    }
    this.joyHome.set(150, h - 130);
    if (this.joyPointer === null) {
      this.joyBase.copy(this.joyHome);
      this.joyKnob.copy(this.joyHome);
    }
    this.drawJoystick();
  }

  private onDown(p: Phaser.Input.Pointer): void {
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
    if (p.id !== this.joyPointer) return;
    this.joyKnob.set(p.x, p.y);
    this.updateStick();
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (p.id === this.joyPointer) {
      this.joyPointer = null;
      this.joyBase.copy(this.joyHome);
      this.joyKnob.copy(this.joyHome);
      input.touchMoveX = 0;
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

  private releaseAll(): void {
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
    const nx = d.x / R;
    const mag = Math.abs(nx);
    // Past the dead zone, ramp to full speed by 60% travel: platformers want near-digital response.
    const ramp = Phaser.Math.Clamp((mag - I.joystickDeadZone) / (0.6 - I.joystickDeadZone), 0, 1);
    input.touchMoveX = Math.sign(nx) * ramp;
    this.drawJoystick();
  }

  private buttonAt(x: number, y: number): Button | undefined {
    let best: Button | undefined;
    let bestDist = Infinity;
    for (const b of this.buttons) {
      const dist = Phaser.Math.Distance.Between(x, y, b.x, b.y);
      if (dist <= b.r * I.buttonHitScale && dist < bestDist) {
        best = b;
        bestDist = dist;
      }
    }
    return best;
  }

  private drawButton(b: Button): void {
    const pressed = b.pointerId !== null;
    const g = b.gfx.clear();
    g.fillStyle(b.color, pressed ? 0.75 : 0.35);
    g.fillCircle(b.x, b.y, pressed ? b.r * 0.94 : b.r);
    g.lineStyle(3, 0xffffff, pressed ? 0.9 : 0.45);
    g.strokeCircle(b.x, b.y, pressed ? b.r * 0.94 : b.r);
    b.text.setScale(pressed ? 0.94 : 1);
  }

  private drawJoystick(): void {
    const active = this.joyPointer !== null;
    const g = this.joyGfx.clear();
    if (!active) {
      // Idle: just a faint ring as a hint, so it doesn't hide the player near the left edge.
      g.lineStyle(2, 0xffffff, 0.15);
      g.strokeCircle(this.joyBase.x, this.joyBase.y, I.joystickRadius);
      return;
    }
    g.fillStyle(0xffffff, 0.12);
    g.fillCircle(this.joyBase.x, this.joyBase.y, I.joystickRadius);
    g.lineStyle(3, 0xffffff, 0.4);
    g.strokeCircle(this.joyBase.x, this.joyBase.y, I.joystickRadius);
    g.fillStyle(0xffffff, 0.55);
    g.fillCircle(this.joyKnob.x, this.joyKnob.y, 30);
  }
}
