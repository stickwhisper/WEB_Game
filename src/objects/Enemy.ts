import Phaser from 'phaser';
import { TUNING } from '../config';
import type { GameScene } from '../scenes/GameScene';
import type { Player } from './Player';

const E = TUNING.enemy;

type State = 'patrol' | 'chase' | 'windup' | 'lunge' | 'recover' | 'stun' | 'dead';

/**
 * Melee grunt: patrols, chases when it sees the player, then telegraphs
 * (flashes red) before a lunge. Only the lunge deals damage, so the
 * wind-up is the player's cue to roll through it.
 */
export class Enemy extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  declare scene: GameScene;

  hp: number = E.maxHp;
  private dir: 1 | -1 = -1;
  private mode: State = 'patrol';
  private stateMs = 0;
  private flashUntil = 0;

  constructor(scene: GameScene, x: number, y: number) {
    super(scene, x, y, 'enemy');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setOrigin(0.5, 1);
    this.body.setMaxVelocityY(TUNING.maxFallSpeed);
  }

  /** Damages the player on contact only while lunging. */
  get isDangerous(): boolean {
    return this.mode === 'lunge';
  }

  get isDead(): boolean {
    return this.mode === 'dead';
  }

  update(now: number, dt: number, player: Player): void {
    if (this.mode === 'dead') return;
    this.stateMs += dt;

    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const seesPlayer = !player.isDead && Math.abs(dx) < E.aggroRangeX && Math.abs(dy) < E.aggroRangeY;

    switch (this.mode) {
      case 'patrol':
        if (this.body.blocked.left || this.body.blocked.right || !this.groundAhead()) this.dir = this.dir > 0 ? -1 : 1;
        this.body.setVelocityX(this.dir * E.patrolSpeed);
        if (seesPlayer) this.enter('chase');
        break;

      case 'chase':
        this.dir = dx >= 0 ? 1 : -1;
        this.body.setVelocityX(this.groundAhead() ? this.dir * E.chaseSpeed : 0);
        if (!seesPlayer) this.enter('patrol');
        else if (Math.abs(dx) < E.lungeRange && Math.abs(dy) < 40) this.enter('windup');
        break;

      case 'windup':
        this.body.setVelocityX(0);
        if (this.stateMs >= E.windupMs) {
          this.enter('lunge');
          this.body.setVelocityX(this.dir * E.lungeSpeed);
        }
        break;

      case 'lunge':
        if (!this.groundAhead()) this.body.setVelocityX(0);
        if (this.stateMs >= E.lungeMs) this.enter('recover');
        break;

      case 'recover':
        this.body.setVelocityX(this.body.velocity.x * 0.8);
        if (this.stateMs >= E.recoverMs) this.enter('chase');
        break;

      case 'stun':
        this.body.setVelocityX(this.body.velocity.x * Math.pow(0.88, dt / 16.67));
        if (this.stateMs >= E.stunMs) this.enter('chase');
        break;
    }

    this.updateLook(now);
  }

  hit(damage: number, dir: number, knockback: number): void {
    if (this.mode === 'dead') return;
    this.hp -= damage;
    this.flashUntil = this.scene.time.now + 80;
    this.body.setVelocity(dir * knockback, -160);
    this.dir = dir > 0 ? -1 : 1; // turn to face the attacker
    if (this.hp <= 0) {
      this.die();
      return;
    }
    this.enter('stun');
  }

  private die(): void {
    this.enter('dead');
    this.body.enable = false;
    this.scene.onEnemyKilled(this);
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      scaleX: 1.4,
      scaleY: 0.3,
      duration: 180,
      onComplete: () => this.destroy(),
    });
  }

  private enter(state: State): void {
    this.mode = state;
    this.stateMs = 0;
  }

  private groundAhead(): boolean {
    const b = this.body;
    const probeX = this.dir > 0 ? b.right + 4 : b.left - 4;
    return this.scene.level.isSolidAt(probeX, b.bottom + 4);
  }

  private updateLook(now: number): void {
    this.setFlipX(this.dir < 0);
    if (now < this.flashUntil) {
      this.setTintFill(0xffffff);
    } else if (this.mode === 'windup') {
      // Telegraph: pulse red faster as the lunge approaches.
      const t = this.stateMs / E.windupMs;
      const on = Math.sin(t * t * 40) > 0;
      if (on) this.setTintFill(0xff3030);
      else this.clearTint();
    } else {
      this.clearTint();
    }
  }
}
