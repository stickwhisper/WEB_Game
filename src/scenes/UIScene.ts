import Phaser from 'phaser';
import { TUNING } from '../config';
import { TouchControls } from '../input/TouchControls';
import { GameEvents } from './GameScene';

/** HUD + touch controls, rendered above the game and unaffected by its camera. */
export class UIScene extends Phaser.Scene {
  private hpBar!: Phaser.GameObjects.Graphics;
  private killText!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private fpsText!: Phaser.GameObjects.Text;

  constructor() {
    super('UI');
  }

  create(): void {
    new TouchControls(this);

    this.hpBar = this.add.graphics();
    this.killText = this.add.text(24, 50, '', { fontFamily: 'system-ui, sans-serif', fontSize: '16px', color: '#c8c8d8' });
    this.fpsText = this.add.text(24, 74, '', { fontFamily: 'monospace', fontSize: '12px', color: '#6a6a80' });
    this.banner = this.add
      .text(this.scale.width / 2, 170, '', { fontFamily: 'system-ui, sans-serif', fontSize: '48px', fontStyle: 'bold', color: '#ffffff' })
      .setOrigin(0.5)
      .setStroke('#000000', 6)
      .setVisible(false);

    if (!this.sys.game.device.input.touch) {
      this.add
        .text(this.scale.width / 2, 16, '키보드: ←→ 이동 · Space 점프 · X 공격 · C 구르기  (마우스로 화면 버튼도 동작)', {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '14px',
          color: '#8a8aa0',
        })
        .setOrigin(0.5, 0);
    }

    this.addFullscreenButton();

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

  /** Fullscreen API is unavailable on iPhone Safari; there the button is hidden (use "Add to Home Screen"). */
  private addFullscreenButton(): void {
    if (!this.scale.fullscreen.available) return;
    const btn = this.add
      .text(this.scale.width - 20, 20, '⛶', { fontFamily: 'system-ui, sans-serif', fontSize: '28px', color: '#c8c8d8' })
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
  }
}
