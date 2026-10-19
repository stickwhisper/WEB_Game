import Phaser from 'phaser';
import { PALETTE, TUNING } from '../config';
import type { GameScene } from '../scenes/GameScene';
import { type Pose, type TriangleShape, triangleAt } from '../weapons';
import type { Player } from './Player';

const E = TUNING.enemy;
const HALF_HEIGHT = 15;
const WEAPON: TriangleShape = { base: 10, length: 26, width: 16 };
const PIP_RADIUS = 3;
const PIP_GAP = 9;

type State = 'patrol' | 'chase' | 'windup' | 'lunge' | 'recover' | 'stun' | 'dead';

/**
 * Melee grunt: patrols, chases when it sees the player, then shows its
 * triangle (growing) before lunging with it. The growing triangle is the
 * player's only cue to guard or roll.
 */
export class Enemy extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  declare scene: GameScene;

  hp: number = E.maxHp;
  private dir: 1 | -1 = -1;
  private mode: State = 'patrol';
  private stateMs = 0;
  private flashUntil = 0;
  private lungeSpent = false;
  private stunMs: number = E.stunMs;
  private readonly gfx: Phaser.GameObjects.Graphics;

  constructor(scene: GameScene, x: number, y: number) {
    super(scene, x, y, 'enemy');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setOrigin(0.5, 1).setDepth(8);
    this.body.setMaxVelocityY(TUNING.maxFallSpeed);
    this.gfx = scene.add.graphics().setDepth(11);
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.draw, this);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.draw, this);
      this.gfx.destroy();
    });
  }

  get isDead(): boolean {
    return this.mode === 'dead';
  }

  get centerY(): number {
    return this.y - HALF_HEIGHT;
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
          this.lungeSpent = false;
          this.body.setVelocityX(this.dir * E.lungeSpeed);
        }
        break;

      case 'lunge':
        if (!this.groundAhead()) this.body.setVelocityX(0);
        if (!this.lungeSpent) this.strike(player);
        if (this.stateMs >= E.lungeMs) this.enter('recover');
        break;

      case 'recover':
        this.body.setVelocityX(this.body.velocity.x * 0.8);
        if (this.stateMs >= E.recoverMs) this.enter('chase');
        break;

      case 'stun':
        this.body.setVelocityX(this.body.velocity.x * Math.pow(0.88, dt / 16.67));
        if (this.stateMs >= this.stunMs) this.enter('chase');
        break;
    }

    if (now < this.flashUntil) this.setTintFill(PALETTE.shape);
    else this.clearTint();
    this.setFlipX(this.dir < 0);
  }

  hit(damage: number, dir: number, knockback: number): void {
    if (this.mode === 'dead') return;
    const dealt = Math.min(damage, this.hp);
    this.hp -= dealt;
    this.scene.effects.bleed(dealt, this.x, this.centerY);
    this.flashUntil = this.scene.time.now + 80;
    this.body.setVelocity(dir * knockback, -160);
    this.dir = dir > 0 ? -1 : 1; // turn to face the attacker
    if (this.hp <= 0) {
      this.die();
      return;
    }
    this.stun(E.stunMs);
  }

  private stun(ms: number): void {
    this.stunMs = ms;
    this.enter('stun');
  }

  /** Lunge triangle against the player's body; one contact per lunge, hit or blocked. */
  private strike(player: Player): void {
    const tri = this.weaponTriangle(this.weaponPose()!);
    const b = player.body;
    const hitsBody = Phaser.Geom.Intersects.RectangleToTriangle(new Phaser.Geom.Rectangle(b.x, b.y, b.width, b.height), tri);
    if (!hitsBody) return;
    const result = player.receiveAttack(E.damage, this.x);
    if (result === 'ignored') return; // rolled through: the lunge carries on
    this.lungeSpent = true;
    this.body.setVelocityX(0);
    if (result === 'parried') this.stun(E.staggerMs);
    else this.enter('recover');
  }

  private die(): void {
    this.enter('dead');
    this.body.enable = false;
    this.scene.onEnemyKilled(this);
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      scale: 0,
      duration: 220,
      ease: 'Quad.easeIn',
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

  private weaponPose(): Pose | undefined {
    switch (this.mode) {
      case 'windup': {
        // Grows in and draws back: the longer it has grown, the closer the lunge.
        const t = Math.min(1, this.stateMs / E.windupMs);
        return { angleDeg: 0, dist: -12 * t, alpha: 0.15 + 0.85 * t };
      }
      case 'lunge':
        return { angleDeg: 0, dist: 8, alpha: 1 };
      case 'recover':
        return { angleDeg: 0, dist: 0, alpha: Math.max(0, 1 - this.stateMs / 250) };
      default:
        return undefined;
    }
  }

  private weaponTriangle(pose: Pose): Phaser.Geom.Triangle {
    const scale = this.mode === 'windup' ? Math.min(1, this.stateMs / E.windupMs) : 1;
    const shape = { ...WEAPON, length: WEAPON.length * scale, width: WEAPON.width * scale };
    return triangleAt(shape, pose, this.x, this.centerY, this.dir);
  }

  private draw(): void {
    const g = this.gfx.clear();
    if (this.mode === 'dead') return;

    const pose = this.weaponPose();
    if (pose && pose.alpha > 0) {
      g.fillStyle(PALETTE.shape, pose.alpha);
      g.fillTriangleShape(this.weaponTriangle(pose));
    }

    // Remaining health as small circles under the body.
    const width = (this.hp - 1) * PIP_GAP;
    g.fillStyle(PALETTE.shape, 0.8);
    for (let i = 0; i < this.hp; i++) {
      g.fillCircle(this.x - width / 2 + i * PIP_GAP, this.y + 8, PIP_RADIUS);
    }
  }
}
