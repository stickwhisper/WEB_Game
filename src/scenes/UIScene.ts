import Phaser from 'phaser';
import { PALETTE, TUNING, uiScale } from '../config';
import type { InputMode } from '../input/InputState';
import { KeyboardControls } from '../input/KeyboardControls';
import { TouchControls } from '../input/TouchControls';
import { GameEvents, type GameScene } from './GameScene';
import { takeEsc } from './SettingsScene';

const HP_RADIUS = 8;
const HP_GAP = 24;
const PROGRESS_SIZE = 9;
const PROGRESS_GAP = 16;

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
  /** One small square per exit passed in this run, under the health circles. */
  private progress: Phaser.GameObjects.Rectangle[] = [];
  private fpsText?: Phaser.GameObjects.Text;
  private touch!: TouchControls;
  private keyboard!: KeyboardControls;
  private mode?: InputMode;
  private settingsOpen = false;
  /** HUD scale for this screen (see uiScale). */
  private k = 1;
  /** This run's attack and guard upgrades, under the icons at the top right. */
  private upgrades!: Phaser.GameObjects.Graphics;

  constructor() {
    super('UI');
  }

  create(): void {
    const k = (this.k = uiScale(this));
    this.hpCircles = [];
    for (let i = 0; i < TUNING.player.maxHp; i++) {
      this.hpCircles.push(this.add.circle((32 + i * HP_GAP) * k, 32 * k, HP_RADIUS * k, PALETTE.shape));
    }
    this.shownHp = TUNING.player.maxHp;

    if (new URLSearchParams(location.search).has('debug')) {
      this.fpsText = this.add.text(24 * k, 72 * k, '', { fontFamily: 'monospace', fontSize: '12px', color: '#5a5a5a' });
    }
    this.addSettingsButton(this.addFullscreenButton());
    this.upgrades = this.add.graphics();

    // Registered before TouchControls so the touch that switches modes also counts as a press.
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      if (p.wasTouch) this.setMode('touch');
    });
    this.touch = new TouchControls(this);
    this.keyboard = new KeyboardControls(this, () => this.setMode('keyboard'));
    this.input.keyboard?.on('keydown-ESC', (e: KeyboardEvent) => {
      // While the screen is up, Esc is the settings screen's to close it.
      if (!this.settingsOpen && takeEsc(e)) this.openSettings();
    });
    this.setMode(this.sys.game.device.input.touch ? 'touch' : 'keyboard');

    const ev = this.game.events;
    const onPick = (available: boolean) => this.touch.setAvailable('pick', available);
    ev.on(GameEvents.HP, this.setHp, this);
    ev.on(GameEvents.PICK_AVAILABLE, onPick);
    ev.on(GameEvents.PROGRESS, this.setProgress, this);
    ev.on(GameEvents.UPGRADES, this.setUpgrades, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      ev.off(GameEvents.UPGRADES, this.setUpgrades, this);
      ev.off(GameEvents.HP, this.setHp, this);
      ev.off(GameEvents.PICK_AVAILABLE, onPick);
      ev.off(GameEvents.PROGRESS, this.setProgress, this);
    });
  }

  update(): void {
    this.fpsText?.setText(`${Math.round(this.game.loop.actualFps)}`);
  }

  private setMode(mode: InputMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (!this.settingsOpen) this.touch.setEnabled(mode === 'touch');
  }

  /** The game pauses and every control lets go while the settings screen is up. */
  private openSettings(): void {
    if (this.settingsOpen) return;
    this.settingsOpen = true;
    this.touch.setEnabled(false);
    this.keyboard.enabled = false;
    this.keyboard.releaseAll();
    if (this.scene.isActive('Game')) this.scene.pause('Game');
    this.scene.launch('Settings');
    const settings = this.scene.get('Settings');
    let toPractice = false;
    const onPractice = () => (toPractice = true);
    settings.events.once('practice', onPractice);
    settings.events.once('done', () => {
      settings.events.off('practice', onPractice);
      this.settingsOpen = false;
      this.keyboard.enabled = true;
      this.touch.setEnabled(this.mode === 'touch');
      if (this.scene.isPaused('Game')) this.scene.resume('Game');
      if (toPractice) (this.scene.get('Game') as GameScene).togglePractice();
    });
  }

  /**
   * Upgrades of this run, right-aligned under the top-right icons: one triangle per point of
   * attack, one square per point of guard. A negative upgrade shows as hollow shapes, like a
   * loss in a growth offer. (Max health needs no mark: it is the length of the circle row.)
   */
  private setUpgrades(attack: number, guard: number): void {
    const k = this.k;
    const size = 10 * k;
    const gap = 5 * k;
    const right = this.scale.width - 22 * k;
    const g = this.upgrades.clear();
    [
      [attack, 66],
      [guard, 86],
    ].forEach(([n, y], row) => {
      for (let i = 0; i < Math.abs(n); i++) {
        const cx = right - size / 2 - i * (size + gap);
        const cy = y * k;
        const h = size / 2;
        g.fillStyle(PALETTE.shape, 0.85).lineStyle(2, PALETTE.shape, 0.85);
        if (row === 0) {
          if (n > 0) g.fillTriangle(cx - h, cy + h, cx + h, cy + h, cx, cy - h);
          else g.strokeTriangle(cx - h, cy + h, cx + h, cy + h, cx, cy - h);
        } else if (n > 0) g.fillRect(cx - h, cy - h, size, size);
        else g.strokeRect(cx - h, cy - h, size, size);
      }
    });
  }

  /** Settings: two slider lines with their knobs, left of the fullscreen marks. */
  private addSettingsButton(rightEdge: number): void {
    const x = rightEdge - 28;
    const y = 32;
    const g = this.add.graphics({ x, y }).lineStyle(3, PALETTE.shape, 0.5);
    g.lineBetween(-12, -6, 12, -6);
    g.lineBetween(-12, 6, 12, 6);
    g.lineStyle(4, PALETTE.shape, 0.5);
    g.lineBetween(-5, -11, -5, -1);
    g.lineBetween(5, 1, 5, 11);
    this.add.zone(x, y, 56, 56).setInteractive({ useHandCursor: true }).on(Phaser.Input.Events.POINTER_UP, () => this.openSettings());
  }

  /**
   * Lost circles break off the row: each pops up a little, then drops and fades,
   * the last one first. Regained circles (and a new run) grow back into place.
   * The row itself is as long as the maximum: it grows or shrinks with circle upgrades.
   */
  private setHp(hp: number, maxHp: number = this.hpCircles.length): void {
    const k = this.k;
    while (this.hpCircles.length < maxHp) {
      const i = this.hpCircles.length;
      this.hpCircles.push(this.add.circle((32 + i * HP_GAP) * k, 32 * k, HP_RADIUS * k, PALETTE.shape).setVisible(false));
    }
    while (this.hpCircles.length > maxHp) {
      const c = this.hpCircles.pop()!;
      if (c.visible) this.dropCircle(c.x, c.y, 0);
      c.destroy();
    }
    this.shownHp = Math.min(this.shownHp, maxHp);
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

  /**
   * Squares passed: a new one grows in at the end of the row. When a run ends,
   * the whole row falls away like lost circles.
   */
  private setProgress(count: number): void {
    if (count < this.progress.length) {
      this.progress.forEach((sq, i) => {
        this.tweens.add({
          targets: sq,
          delay: i * 40,
          y: sq.y + 120,
          alpha: 0,
          angle: Phaser.Math.Between(-40, 40),
          duration: 600,
          ease: 'Quad.easeIn',
          onComplete: () => sq.destroy(),
        });
      });
      this.progress = [];
    }
    while (this.progress.length < count) {
      const i = this.progress.length;
      const k = this.k;
      const sq = this.add.rectangle((28 + i * PROGRESS_GAP) * k, 58 * k, PROGRESS_SIZE * k, PROGRESS_SIZE * k, PALETTE.shape).setScale(0);
      this.tweens.add({ targets: sq, scale: 1, delay: 250, duration: 260, ease: 'Back.easeOut' });
      this.progress.push(sq);
    }
  }

  /** A regained circle grows back into its place in the row. */
  private popIn(c: Phaser.GameObjects.Arc): void {
    this.tweens.killTweensOf(c);
    c.setVisible(true).setScale(0);
    this.tweens.add({ targets: c, scale: 1, duration: 220, ease: 'Back.easeOut' });
  }

  private dropCircle(x: number, y: number, delay: number): void {
    const drop = this.add.circle(x, y, HP_RADIUS * this.k, PALETTE.shape);
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

  /**
   * Four corner marks. Fullscreen API is unavailable on iPhone Safari; there the icon is hidden.
   * Returns the left edge of the space it took, for the next icon to its left.
   */
  private addFullscreenButton(): number {
    if (!this.scale.fullscreen.available) return this.scale.width - 8;
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
    return x - 28;
  }
}
