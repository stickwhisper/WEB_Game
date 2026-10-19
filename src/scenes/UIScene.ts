import Phaser from 'phaser';
import { PALETTE, TUNING } from '../config';
import type { InputMode } from '../input/InputState';
import { KeyboardControls } from '../input/KeyboardControls';
import { TouchControls } from '../input/TouchControls';
import { GameEvents } from './GameScene';

const HP_RADIUS = 8;
const HP_GAP = 24;

/**
 * HUD + input devices, rendered above the game and unaffected by its camera.
 * Lives for the whole session, so held keys and fingers survive stage restarts.
 *
 * There is no text anywhere. Health is a row of circles, one per point.
 *
 * Both input devices are always listening. The mode only decides whether the
 * touch symbols are shown: pressing a key hides them, touching the screen
 * brings them back.
 */
export class UIScene extends Phaser.Scene {
  private hpCircles: Phaser.GameObjects.Arc[] = [];
  private shownHp = 0;
  private fpsText?: Phaser.GameObjects.Text;
  private touch!: TouchControls;
  private mode?: InputMode;

  constructor() {
    super('UI');
  }

  create(): void {
    this.hpCircles = [];
    for (let i = 0; i < TUNING.player.maxHp; i++) {
      this.hpCircles.push(this.add.circle(32 + i * HP_GAP, 32, HP_RADIUS, PALETTE.shape));
    }
    this.shownHp = TUNING.player.maxHp;

    if (new URLSearchParams(location.search).has('debug')) {
      this.fpsText = this.add.text(24, 52, '', { fontFamily: 'monospace', fontSize: '12px', color: '#5a5a5a' });
    }
    this.addFullscreenButton();

    // Registered before TouchControls so the touch that switches modes also counts as a press.
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      if (p.wasTouch) this.setMode('touch');
    });
    this.touch = new TouchControls(this);
    new KeyboardControls(this, () => this.setMode('keyboard'));
    this.setMode(this.sys.game.device.input.touch ? 'touch' : 'keyboard');

    const ev = this.game.events;
    const onPick = (available: boolean) => this.touch.setAvailable('pick', available);
    ev.on(GameEvents.HP, this.setHp, this);
    ev.on(GameEvents.PICK_AVAILABLE, onPick);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      ev.off(GameEvents.HP, this.setHp, this);
      ev.off(GameEvents.PICK_AVAILABLE, onPick);
    });
  }

  update(): void {
    this.fpsText?.setText(`${Math.round(this.game.loop.actualFps)}`);
  }

  private setMode(mode: InputMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.touch.setEnabled(mode === 'touch');
  }

  /**
   * Lost circles break off the row: each pops up a little, then drops and fades,
   * the last one first. Regained circles (and a new run) grow back into place.
   */
  private setHp(hp: number): void {
    let order = 0;
    for (let i = this.hpCircles.length - 1; i >= 0; i--) {
      const c = this.hpCircles[i];
      if (i < hp) {
        if (!c.visible || i >= this.shownHp) this.popIn(c);
      } else if (i < this.shownHp) {
        c.setVisible(false);
        this.dropCircle(c.x, c.y, order++ * 70);
      }
    }
    this.shownHp = hp;
  }

  /** A regained circle grows back into its place in the row. */
  private popIn(c: Phaser.GameObjects.Arc): void {
    this.tweens.killTweensOf(c);
    c.setVisible(true).setScale(0);
    this.tweens.add({ targets: c, scale: 1, duration: 220, ease: 'Back.easeOut' });
  }

  private dropCircle(x: number, y: number, delay: number): void {
    const drop = this.add.circle(x, y, HP_RADIUS, PALETTE.shape);
    const drift = Phaser.Math.Between(-18, 18);
    // Two plain tweens rather than a TweenChain: a chain's start delay left later drops stuck in place.
    this.tweens.add({
      targets: drop,
      delay,
      y: y - 10,
      x: x + drift * 0.3,
      duration: 120,
      ease: 'Quad.easeOut',
      onComplete: () =>
        this.tweens.add({
          targets: drop,
          y: y + 140,
          x: x + drift,
          alpha: 0,
          duration: 650,
          ease: 'Quad.easeIn',
          onComplete: () => drop.destroy(),
        }),
    });
  }

  /** Four corner marks. Fullscreen API is unavailable on iPhone Safari; there the icon is hidden. */
  private addFullscreenButton(): void {
    if (!this.scale.fullscreen.available) return;
    const x = this.scale.width - 36;
    const y = 32;
    const s = 12;
    const k = 6;
    const g = this.add.graphics({ x, y }).lineStyle(3, PALETTE.shape, 0.5);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      g.lineBetween(sx * s, sy * s, sx * s - sx * k, sy * s);
      g.lineBetween(sx * s, sy * s, sx * s, sy * s - sy * k);
    }
    const hit = this.add.zone(x, y, 56, 56).setInteractive({ useHandCursor: true });
    // Fullscreen must be requested from a user gesture; pointerup is the most reliable one.
    hit.on(Phaser.Input.Events.POINTER_UP, () => {
      if (this.scale.isFullscreen) {
        this.scale.stopFullscreen();
        return;
      }
      this.scale.startFullscreen();
      const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      orientation.lock?.('landscape').catch(() => {});
    });
  }
}
