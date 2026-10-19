import Phaser from 'phaser';
import { PALETTE, TUNING } from '../config';
import type { EnemyDef } from '../enemies';
import type { GameScene } from '../scenes/GameScene';
import { type Pose, midTriangle, triangleAt } from '../weapons';
import type { Player } from './Player';

const E = TUNING.enemy;
const PIP_RADIUS = 3;
const PIP_GAP = 8;
const GUARD_SIZE = 14;

type State = 'patrol' | 'chase' | 'windup' | 'attack' | 'recover' | 'stun' | 'dead';

/**
 * One class for every enemy; its EnemyDef (enemies.ts) supplies form and behaviour.
 * Patrols, chases when it sees the player, grows its triangle as a wind-up,
 * then lunges or swings. The growing triangle is the player's only cue.
 */
export class Enemy extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  declare scene: GameScene;

  readonly def: EnemyDef;
  hp: number;
  private dir: 1 | -1 = -1;
  private mode: State = 'patrol';
  private stateMs = 0;
  private flashUntil = 0;
  private attackSpent = false;
  private stunMs: number = E.stunMs;
  private lastTri?: Phaser.Geom.Triangle;
  private guardPulse = 1;
  private readonly gfx: Phaser.GameObjects.Graphics;

  constructor(scene: GameScene, x: number, y: number, def: EnemyDef) {
    super(scene, x, y, `enemy-${def.id}`);
    this.def = def;
    this.hp = def.maxHp;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setOrigin(0.5, 1).setDepth(8);
    this.body.setSize(def.body.width - 4, def.body.height);
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
    return this.y - this.def.body.height / 2;
  }

  /** The front guard is up except while it attacks or reels. */
  private get guarding(): boolean {
    return this.def.guardPower > 0 && (this.mode === 'patrol' || this.mode === 'chase' || this.mode === 'windup' || this.mode === 'recover');
  }

  update(now: number, dt: number, player: Player): void {
    if (this.mode === 'dead') return;
    this.stateMs += dt;
    const atk = this.def.attack;

    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const seesPlayer = !player.isDead && Math.abs(dx) < E.aggroRangeX && Math.abs(dy) < E.aggroRangeY;

    switch (this.mode) {
      case 'patrol':
        if (this.body.blocked.left || this.body.blocked.right || !this.groundAhead()) this.dir = this.dir > 0 ? -1 : 1;
        this.body.setVelocityX(this.dir * this.def.patrolSpeed);
        if (seesPlayer) this.enter('chase');
        break;

      case 'chase':
        this.dir = dx >= 0 ? 1 : -1;
        this.body.setVelocityX(this.groundAhead() ? this.dir * this.def.chaseSpeed : 0);
        if (!seesPlayer) this.enter('patrol');
        else if (Math.abs(dx) < atk.range && Math.abs(dy) < this.def.body.height + 20 && this.body.blocked.down) this.enter('windup');
        break;

      case 'windup':
        this.body.setVelocityX(0);
        if (this.stateMs >= atk.windupMs) this.startAttack(player);
        break;

      case 'attack':
        this.updateAttack(player);
        break;

      case 'recover':
        this.body.setVelocityX(this.body.velocity.x * 0.8);
        if (this.stateMs >= atk.recoverMs) this.enter('chase');
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

  /**
   * Struck by the player's triangle travelling in direction `dir`.
   * From the front, a guard turns up to guardPower points into squares; the rest bleeds as circles.
   */
  hit(damage: number, dir: number, knockback: number): void {
    if (this.mode === 'dead') return;

    const fromFront = dir === -this.dir;
    if (this.guarding && fromFront) {
      const blocked = Math.min(damage, this.def.guardPower);
      this.scene.effects.block(blocked, this.guardX, this.centerY);
      this.guardPulse = 1.5;
      damage -= blocked;
      if (damage <= 0) {
        this.body.setVelocityX(dir * 60);
        return;
      }
    }

    const dealt = Math.min(damage, this.hp);
    this.hp -= dealt;
    this.scene.effects.bleed(dealt, this.x, this.centerY);
    this.flashUntil = this.scene.time.now + 80;
    if (this.hp <= 0) {
      this.die();
      return;
    }
    if (this.def.heavy) return; // unflinching: keeps its footing and its attack
    this.body.setVelocity(dir * knockback, -160);
    this.dir = dir > 0 ? -1 : 1; // turn to face the attacker
    this.stun(E.stunMs);
  }

  private stun(ms: number): void {
    this.stunMs = ms;
    this.enter('stun');
  }

  private startAttack(player: Player): void {
    const atk = this.def.attack;
    this.enter('attack');
    this.attackSpent = false;
    this.lastTri = undefined;
    if (atk.kind !== 'lunge') return;
    if (atk.hop > 0) {
      // Aim the leap to come down where the player is: horizontal speed = distance / time in the air.
      const airSec = (2 * atk.hop) / TUNING.gravity;
      const vx = Phaser.Math.Clamp((player.x - this.x) / airSec, -atk.speed, atk.speed);
      this.body.setVelocity(vx, -atk.hop);
    } else {
      this.body.setVelocityX(this.dir * atk.speed);
    }
  }

  private updateAttack(player: Player): void {
    const atk = this.def.attack;
    const airborne = atk.kind === 'lunge' && atk.hop > 0;
    if (atk.kind === 'swing') this.body.setVelocityX(0);
    else if (!airborne && !this.groundAhead()) this.body.setVelocityX(0);

    if (!this.attackSpent) this.strike(player);

    // A leap lasts until it lands (with a ceiling, in case it never does).
    const done = airborne ? (this.stateMs >= 120 && this.body.blocked.down) || this.stateMs >= atk.activeMs * 3 : this.stateMs >= atk.activeMs;
    if (done) this.enter('recover');
  }

  /** Triangle against the player's body; one contact per attack, hit or blocked. */
  private strike(player: Player): void {
    const tri = this.weaponTriangle();
    if (!tri) return;
    const tris = this.lastTri ? [tri, midTriangle(this.lastTri, tri)] : [tri];
    this.lastTri = tri;
    const b = player.body;
    const rect = new Phaser.Geom.Rectangle(b.x, b.y, b.width, b.height);
    if (!tris.some((t) => Phaser.Geom.Intersects.RectangleToTriangle(rect, t))) return;

    const result = player.receiveAttack(this.def.attack.damage, this.x);
    if (result === 'ignored') return; // rolled through: the attack carries on
    this.attackSpent = true;
    if (this.def.attack.kind === 'lunge') this.body.setVelocityX(0);
    if (result === 'parried') this.stun(E.staggerMs);
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

  private get guardX(): number {
    return this.x + this.dir * (this.def.body.width / 2 + GUARD_SIZE / 2 + 2);
  }

  // --- Triangle -----------------------------------------------------------

  private weaponPose(): Pose | undefined {
    const atk = this.def.attack;
    const leap = atk.kind === 'lunge' && atk.hop > 0;
    switch (this.mode) {
      case 'windup': {
        // Grows in and draws back: the longer it has grown, the closer the attack.
        const t = Math.min(1, this.stateMs / atk.windupMs);
        const alpha = 0.15 + 0.85 * t;
        if (atk.kind === 'swing') return { angleDeg: atk.fromDeg - 20 * t, dist: 0, alpha };
        return { angleDeg: leap ? -25 : 0, dist: -12 * t, alpha };
      }
      case 'attack': {
        if (atk.kind === 'swing') {
          const t = Math.min(1, this.stateMs / atk.activeMs);
          return { angleDeg: Phaser.Math.Linear(atk.fromDeg, atk.toDeg, 1 - (1 - t) * (1 - t)), dist: 0, alpha: 1 };
        }
        // A leap points its triangle down at where it will land.
        return { angleDeg: leap ? 40 : 0, dist: 8, alpha: 1 };
      }
      case 'recover': {
        const alpha = Math.max(0, 1 - this.stateMs / 300);
        if (atk.kind === 'swing') return { angleDeg: atk.toDeg, dist: 0, alpha };
        return { angleDeg: leap ? 40 : 0, dist: 0, alpha };
      }
      default:
        return undefined;
    }
  }

  private weaponTriangle(pose = this.weaponPose()): Phaser.Geom.Triangle | undefined {
    if (!pose) return undefined;
    const w = this.def.attack.weapon;
    const scale = this.mode === 'windup' ? Math.min(1, this.stateMs / this.def.attack.windupMs) : 1;
    const shape = { ...w, length: w.length * scale, width: w.width * scale };
    return triangleAt(shape, pose, this.x, this.centerY, this.dir);
  }

  private draw(): void {
    const g = this.gfx.clear();
    if (this.mode === 'dead') return;

    const pose = this.weaponPose();
    if (pose && pose.alpha > 0) {
      g.fillStyle(PALETTE.shape, pose.alpha);
      g.fillTriangleShape(this.weaponTriangle(pose)!);
    }

    if (this.guarding) {
      this.guardPulse = Math.max(1, this.guardPulse - 0.05);
      const s = GUARD_SIZE * this.guardPulse;
      g.fillStyle(PALETTE.shape, 0.85);
      g.fillRect(this.guardX - s / 2, this.centerY - s / 2, s, s);
    }

    // Remaining health as small circles under the body.
    const width = (this.hp - 1) * PIP_GAP;
    g.fillStyle(PALETTE.shape, 0.8);
    for (let i = 0; i < this.hp; i++) {
      g.fillCircle(this.x - width / 2 + i * PIP_GAP, this.y + 8, PIP_RADIUS);
    }
  }
}
