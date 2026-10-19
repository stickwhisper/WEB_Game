import Phaser from 'phaser';
import { KEY_BINDINGS, TUNING } from '../config';
import type { InputMode } from '../input/InputState';
import { KeyboardControls } from '../input/KeyboardControls';
import { TouchControls } from '../input/TouchControls';
import { GameEvents } from './GameScene';

const FONT = 'system-ui, sans-serif';

/**
 * HUD + input devices, rendered above the game and unaffected by its camera.
 * Lives for the whole session, so held keys and fingers survive stage restarts.
 *
 * Both input devices are always listening. The mode only decides which UI is
 * shown: pressing a key switches to keyboard mode (touch buttons hidden),
 * touching the screen switches back. The HUD chip toggles it by hand.
 */
export class UIScene extends Phaser.Scene {
  private hpBar!: Phaser.GameObjects.Graphics;
  private killText!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private fpsText!: Phaser.GameObjects.Text;
  private keyHelp!: Phaser.GameObjects.Text;
  private modeChip!: Phaser.GameObjects.Text;
  private touch!: TouchControls;
  private keyboard!: KeyboardControls;
  private mode!: InputMode;

  constructor() {
    super('UI');
  }

  create(): void {
    const w = this.scale.width;

    this.hpBar = this.add.graphics();
    this.killText = this.add.text(24, 50, '', { fontFamily: FONT, fontSize: '16px', color: '#c8c8d8' });
    this.fpsText = this.add.text(24, 74, '', { fontFamily: 'monospace', fontSize: '12px', color: '#6a6a80' });
    this.banner = this.add
      .text(w / 2, 170, '', { fontFamily: FONT, fontSize: '48px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5)
      .setStroke('#000000', 6)
      .setVisible(false);
    this.keyHelp = this.add
      .text(w / 2, this.scale.height - 16, this.keyHelpText(), {
        fontFamily: FONT,
        fontSize: '15px',
        color: '#c8c8d8',
        backgroundColor: '#00000080',
      })
      .setPadding(12, 6)
      .setOrigin(0.5, 1);

    const fullscreenRight = this.addFullscreenButton();
    this.modeChip = this.add
      .text(fullscreenRight - 8, 24, '', { fontFamily: FONT, fontSize: '15px', color: '#e8e8f0', backgroundColor: '#ffffff1a' })
      .setPadding(12, 7)
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    this.modeChip.on(Phaser.Input.Events.POINTER_UP, () => this.setMode(this.mode === 'touch' ? 'keyboard' : 'touch'));

    // Registered before TouchControls so the touch that switches modes also counts as a press.
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (p.wasTouch && !over.includes(this.modeChip)) this.setMode('touch');
    });
    this.touch = new TouchControls(this);
    this.keyboard = new KeyboardControls(this, () => this.setMode('keyboard'));

    this.setMode(this.sys.game.device.input.touch ? 'touch' : 'keyboard');

    const ev = this.game.events;
    ev.on(GameEvents.HP, this.drawHp, this);
    ev.on(GameEvents.KILLS, this.onKills, this);
    ev.on(GameEvents.MESSAGE, this.showBanner, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      ev.off(GameEvents.HP, this.drawHp, this);
      ev.off(GameEvents.KILLS, this.onKills, this);
      ev.off(GameEvents.MESSAGE, this.showBanner, this);
    });
  }

  update(): void {
    this.fpsText.setText(`${Math.round(this.game.loop.actualFps)} fps`);
  }

  private setMode(mode: InputMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.touch.setEnabled(mode === 'touch');
    // Leaving keyboard mode by hand shouldn't leave a direction stuck if a key was down.
    if (mode === 'touch') this.keyboard.releaseAll();
    this.keyHelp.setVisible(mode === 'keyboard');
    this.modeChip.setText(mode === 'touch' ? '입력: 터치' : '입력: 키보드');
  }

  private keyHelpText(): string {
    const names: Record<string, string> = { LEFT: '←', RIGHT: '→', UP: '↑', SPACE: 'Space', SHIFT: 'Shift' };
    const keys = (list: string[]) => list.map((k) => names[k] ?? k).join('/');
    return [
      `${keys([KEY_BINDINGS.left[0], KEY_BINDINGS.right[0]])} ${keys([KEY_BINDINGS.left[1], KEY_BINDINGS.right[1]])} 이동`,
      `${keys(KEY_BINDINGS.jump)} 점프`,
      `${keys(KEY_BINDINGS.attack)} 공격`,
      `${keys(KEY_BINDINGS.roll)} 구르기`,
    ].join('   ·   ');
  }

  private drawHp(hp: number): void {
    const max = TUNING.player.maxHp;
    const w = 220;
    const g = this.hpBar.clear();
    g.fillStyle(0x000000, 0.5).fillRoundedRect(20, 20, w + 8, 22, 6);
    g.fillStyle(hp / max > 0.3 ? 0x5ad17a : 0xe0504a).fillRoundedRect(24, 24, Math.max(0, (w * hp) / max), 14, 4);
    if (hp >= max) this.banner.setVisible(false); // new run started
  }

  private onKills(kills: number, total: number): void {
    this.killText.setText(`처치 ${kills} / ${total}`);
  }

  private showBanner(text: string, color: number): void {
    this.banner.setText(text).setColor(`#${color.toString(16).padStart(6, '0')}`).setVisible(true).setScale(0.6).setAlpha(0);
    this.tweens.add({ targets: this.banner, scale: 1, alpha: 1, duration: 220, ease: 'Back.easeOut' });
  }

  /**
   * Fullscreen API is unavailable on iPhone Safari; there the button is hidden (use "Add to Home Screen").
   * Returns the x where the next top-right HUD item should end.
   */
  private addFullscreenButton(): number {
    const right = this.scale.width - 20;
    if (!this.scale.fullscreen.available) return right;
    const btn = this.add
      .text(right, 20, '⛶', { fontFamily: FONT, fontSize: '28px', color: '#c8c8d8' })
      .setOrigin(1, 0)
      .setPadding(8)
      .setInteractive({ useHandCursor: true });
    // Fullscreen must be requested from a user gesture; pointerup is the most reliable one.
    btn.on(Phaser.Input.Events.POINTER_UP, () => {
      if (this.scale.isFullscreen) {
        this.scale.stopFullscreen();
        return;
      }
      this.scale.startFullscreen();
      const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      orientation.lock?.('landscape').catch(() => {});
    });
    return right - btn.width;
  }
}
