import Phaser from 'phaser';
import { COMBO, TUNING } from '../config';
import { input } from '../input/InputState';
import type { GameScene } from '../scenes/GameScene';
import type { Enemy } from './Enemy';

const P = TUNING.player;

type State = 'normal' | 'attack' | 'roll' | 'hurt' | 'dead';

export class Player extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  declare scene: GameScene;

  hp: number = P.maxHp;
  facing: 1 | -1 = 1;
  /**
   * Squash/stretch, flashes and flips go on this image, never on the sprite itself:
   * scaling an Arcade sprite also resizes its body and would break collisions.
   */
  readonly visual: Phaser.GameObjects.Image;

  private mode: State = 'normal';
  private stateMs = 0;
  private lastGroundedAt = -Infinity;
  private wasOnGround = false;
  private jumpCut = false;
  private rollReadyAt = 0;
  private invulnUntil = 0;

  private comboIndex = 0;
  private attackQueued = false;
  private slashShown = false;
  private readonly hitThisSwing = new Set<Enemy>();

  constructor(scene: GameScene, x: number, y: number) {
    super(scene, x, y, 'player');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setOrigin(0.5, 1);
    this.setVisible(false);
    this.body.setMaxVelocityY(TUNING.maxFallSpeed);
    this.visual = scene.add.image(x, y, 'player').setOrigin(0.5, 1).setDepth(10);
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.syncVisual, this);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.syncVisual, this);
      this.visual.destroy();
    });
  }

  /** Runs after the physics step so the visual never lags a frame behind the body. */
  private syncVisual(): void {
    this.visual.setPosition(this.x, this.y);
    this.visual.setFlipX(this.facing < 0);
  }

  get isDead(): boolean {
    return this.mode === 'dead';
  }

  get isInvulnerable(): boolean {
    return this.mode === 'roll' || this.mode === 'dead' || this.scene.time.now < this.invulnUntil;
  }

  update(now: number, dt: number): void {
    const onGround = this.body.blocked.down;
    if (onGround) this.lastGroundedAt = now;
    if (onGround && !this.wasOnGround) this.squash(1.2, 0.8);
    this.wasOnGround = onGround;
    this.stateMs += dt;

    switch (this.mode) {
      case 'normal':
        this.updateNormal(now, dt, onGround);
        break;
      case 'attack':
        this.updateAttack(now, dt, onGround);
        break;
      case 'roll':
        this.updateRoll(now);
        break;
      case 'hurt':
        if (this.stateMs >= P.hurtMs) this.enter('normal');
        break;
      case 'dead':
        this.body.setVelocityX(this.body.velocity.x * 0.9);
        break;
    }
  }

  takeDamage(amount: number, fromX: number): boolean {
    if (this.isInvulnerable) return false;
    const now = this.scene.time.now;
    this.hp = Math.max(0, this.hp - amount);
    this.invulnUntil = now + P.invulnMs;
    const dir = this.x >= fromX ? 1 : -1;
    this.body.setVelocity(dir * 320, -320);
    this.scene.onPlayerHurt(this.hp);

    if (this.hp <= 0) {
      this.enter('dead');
      this.visual.setTint(0x555555);
      return true;
    }
    this.enter('hurt');
    this.scene.tweens.add({
      targets: this.visual,
      alpha: 0.25,
      duration: 70,
      yoyo: true,
      repeat: Math.floor(P.invulnMs / 140) - 1,
      onComplete: () => this.visual.setAlpha(1),
    });
    return true;
  }

  private enter(state: State): void {
    this.mode = state;
    this.stateMs = 0;
  }

  private updateNormal(now: number, dt: number, onGround: boolean): void {
    this.applyRun(dt, onGround, input.moveX);

    // Priority: roll > attack > jump, so a defensive tap is never eaten by something else.
    if (input.buffered('roll') && now >= this.rollReadyAt) {
      input.consume('roll');
      this.startRoll();
      return;
    }
    if (input.buffered('attack')) {
      input.consume('attack');
      this.startAttack(0);
      return;
    }
    this.handleJump(now);
  }

  private handleJump(now: number): void {
    if (input.buffered('jump') && now - this.lastGroundedAt <= P.coyoteMs) {
      input.consume('jump');
      this.body.setVelocityY(-P.jumpVelocity);
      this.lastGroundedAt = -Infinity;
      this.jumpCut = false;
      this.squash(0.8, 1.2);
    }
    // Variable jump height: letting go early cuts the rise short.
    if (!this.jumpCut && !input.isHeld('jump') && this.body.velocity.y < 0) {
      this.body.setVelocityY(this.body.velocity.y * P.jumpCutMultiplier);
      this.jumpCut = true;
    }
  }

  private applyRun(dt: number, onGround: boolean, moveX: number): void {
    const target = moveX * P.runSpeed;
    const vx = this.body.velocity.x;
    const accel = !onGround ? P.airAccel : Math.abs(target) > Math.abs(vx) ? P.groundAccel : P.groundDecel;
    const step = (accel * dt) / 1000;
    const next = vx < target ? Math.min(target, vx + step) : Math.max(target, vx - step);
    this.body.setVelocityX(next);
    if (moveX !== 0) this.facing = moveX > 0 ? 1 : -1;
  }

  // --- Roll ---------------------------------------------------------------

  private startRoll(): void {
    if (input.moveX !== 0) this.facing = input.moveX > 0 ? 1 : -1;
    this.enter('roll');
    this.body.setVelocityX(this.facing * P.rollSpeed);
    this.scene.tweens.killTweensOf(this.visual);
    this.visual.setAlpha(0.55).setScale(1.15, 0.7);
  }

  private updateRoll(now: number): void {
    this.body.setVelocityX(this.facing * P.rollSpeed);
    if (this.stateMs >= P.rollMs) {
      this.visual.setAlpha(1).setScale(1);
      this.rollReadyAt = now + P.rollCooldownMs;
      this.enter('normal');
    }
  }

  // --- Attack -------------------------------------------------------------

  private startAttack(index: number): void {
    if (input.moveX !== 0) this.facing = input.moveX > 0 ? 1 : -1;
    this.comboIndex = index;
    this.attackQueued = false;
    this.slashShown = false;
    this.hitThisSwing.clear();
    this.enter('attack');
    const def = COMBO[index];
    this.body.setVelocityX(this.facing * def.lunge);
  }

  private updateAttack(now: number, dt: number, onGround: boolean): void {
    const def = COMBO[this.comboIndex];

    // Roll cancels an attack at any time: this is what makes touch combat feel responsive.
    if (input.buffered('roll') && now >= this.rollReadyAt) {
      input.consume('roll');
      this.startRoll();
      return;
    }

    // Lunge decays to a stop on the ground; in the air keep a little drift.
    const friction = onGround ? 0.82 : 0.95;
    this.body.setVelocityX(this.body.velocity.x * Math.pow(friction, dt / 16.67));

    if (input.buffered('attack') && this.stateMs >= def.activeFromMs) {
      input.consume('attack');
      this.attackQueued = true;
    }

    if (this.stateMs >= def.activeFromMs && this.stateMs <= def.activeToMs) {
      if (!this.slashShown) {
        this.slashShown = true;
        this.scene.showSlash(this, def, this.comboIndex);
      }
      this.scene.hitEnemies(this.attackRect(def), def, this.facing, this.hitThisSwing);
    }

    if (this.attackQueued && this.stateMs >= def.chainFromMs && this.comboIndex < COMBO.length - 1) {
      this.startAttack(this.comboIndex + 1);
      return;
    }

    if (this.stateMs >= def.durationMs) {
      this.enter('normal');
      if (this.attackQueued) {
        // Finisher done and attack still queued: restart the combo.
        this.startAttack(0);
      }
    }
  }

  private attackRect(def: (typeof COMBO)[number]): Phaser.Geom.Rectangle {
    const b = this.body;
    const x = this.facing > 0 ? b.right - 6 : b.left + 6 - def.reach;
    const y = b.bottom - def.height - 2;
    return new Phaser.Geom.Rectangle(x, y, def.reach, def.height);
  }

  private squash(sx: number, sy: number): void {
    if (this.mode === 'roll') return;
    this.visual.setScale(sx, sy);
    this.scene.tweens.add({ targets: this.visual, scaleX: 1, scaleY: 1, duration: 140, ease: 'Quad.easeOut' });
  }
}
