import Phaser from 'phaser';
import { PALETTE, TUNING } from '../config';
import { input } from '../input/InputState';
import { telemetry } from '../telemetry';
import type { GameScene } from '../scenes/GameScene';
import { type Move, type Pose, type WeaponDef, WEAPONS, midTriangle, poseAt, triangleAt } from '../weapons';
import type { Enemy } from './Enemy';

const P = TUNING.player;
const RADIUS = 18;
/** Weapon held loosely when not attacking: a faint triangle pointing down and forward. */
const REST_POSE: Pose = { angleDeg: 70, dist: -6, alpha: 0.3 };
const GUARD_SIZE = 22;
const GUARD_GAP = 24;

type State = 'normal' | 'attack' | 'guard' | 'roll' | 'hurt' | 'dead';

/** What happened when an attack reached the player. */
export type HitResult = 'ignored' | 'parried' | 'blocked' | 'hit';

export class Player extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  declare scene: GameScene;

  hp: number = P.maxHp;
  facing: 1 | -1 = 1;
  weapon: WeaponDef = WEAPONS.sword;
  /**
   * Squash/stretch and flashes go on this image, never on the sprite itself:
   * scaling an Arcade sprite also resizes its body and would break collisions.
   */
  readonly visual: Phaser.GameObjects.Image;
  private readonly weaponGfx: Phaser.GameObjects.Graphics;
  private readonly guardGfx: Phaser.GameObjects.Graphics;

  private mode: State = 'normal';
  private stateMs = 0;
  private lastGroundedAt = -Infinity;
  private wasOnGround = false;
  private jumpCut = false;
  private rollReadyAt = 0;
  private invulnUntil = 0;

  /** What dealt the last damage (enemy id, or 'fall'), for the learning record. */
  lastHitBy = '';

  private moveIndex = 0;
  private attackQueued = false;
  private readonly hitThisMove = new Set<Enemy>();
  private lastTri?: Phaser.Geom.Triangle;

  constructor(scene: GameScene, x: number, y: number) {
    super(scene, x, y, 'player');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setOrigin(0.5, 1);
    this.setVisible(false);
    this.body.setSize(28, RADIUS * 2);
    this.body.setMaxVelocityY(TUNING.maxFallSpeed);

    this.visual = scene.add.image(x, y, 'player').setOrigin(0.5, 1).setDepth(10);
    this.weaponGfx = scene.add.graphics().setDepth(12);
    this.guardGfx = scene.add.graphics().setDepth(12);
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.syncVisual, this);
    this.once(Phaser.GameObjects.Events.DESTROY, () => {
      scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.syncVisual, this);
      this.visual.destroy();
      this.weaponGfx.destroy();
      this.guardGfx.destroy();
    });
  }

  get isDead(): boolean {
    return this.mode === 'dead';
  }

  get isBusy(): boolean {
    return this.mode !== 'normal';
  }

  get centerY(): number {
    return this.y - RADIUS;
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
      case 'guard':
        this.updateGuard(now, dt, onGround);
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

  /** Take back `amount` circles of health, up to the maximum. Returns how many were actually taken. */
  heal(amount: number): number {
    if (this.mode === 'dead') return 0;
    const taken = Math.min(amount, P.maxHp - this.hp);
    this.hp += taken;
    if (taken > 0) telemetry.first('heal');
    if (taken > 0) this.scene.onPlayerHealed(this.hp);
    return taken;
  }

  get isFullHealth(): boolean {
    return this.hp >= P.maxHp;
  }

  /** Swap weapons; returns the one that was dropped. */
  equip(weapon: WeaponDef): WeaponDef {
    const old = this.weapon;
    this.weapon = weapon;
    return old;
  }

  /**
   * An attack of `damage` points arrives from `fromX` (dealt by `source`).
   * A guard facing the attacker turns up to `guardPower` points into squares; the rest become circles.
   */
  receiveAttack(damage: number, fromX: number, source = ''): HitResult {
    const now = this.scene.time.now;
    if (this.mode === 'roll' || this.mode === 'dead' || now < this.invulnUntil) return 'ignored';

    const fx = this.scene.effects;
    const towardAttacker = fromX >= this.x ? 1 : -1;
    if (this.mode === 'guard' && towardAttacker === this.facing) {
      // Measured on the guard's own state timer: same clock as enemy wind-ups, even on slow frames.
      const parried = this.stateMs <= P.parryWindowMs;
      const blocked = parried ? damage : Math.min(damage, P.guardPower);
      fx.block(blocked, this.x + this.facing * GUARD_GAP, this.centerY);
      this.pulseGuard();
      telemetry.first(parried ? 'parry' : 'block');
      telemetry.damage(0, blocked);
      damage -= blocked;
      if (damage <= 0) {
        this.body.setVelocityX(-towardAttacker * (parried ? 80 : 200));
        this.invulnUntil = now + 200;
        this.scene.hitStop(parried ? 100 : 50);
        return parried ? 'parried' : 'blocked';
      }
    }

    telemetry.damage(Math.min(damage, this.hp), 0); // circles actually lost
    this.hp = Math.max(0, this.hp - damage);
    this.lastHitBy = source;
    fx.bleed(damage, this.x, this.centerY);
    this.invulnUntil = now + P.invulnMs;
    this.body.setVelocity(-towardAttacker * 320, -320);
    this.scene.onPlayerHurt(this.hp);

    if (this.hp <= 0) {
      this.enter('dead');
      this.scene.tweens.killTweensOf(this.visual);
      this.scene.tweens.add({ targets: this.visual, scale: 0, duration: 500, ease: 'Quad.easeIn' });
      return 'hit';
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
    return 'hit';
  }

  private enter(state: State): void {
    this.mode = state;
    this.stateMs = 0;
  }

  private updateNormal(now: number, dt: number, onGround: boolean): void {
    this.applyRun(dt, onGround, input.moveX);

    // Priority: roll > guard > attack > jump, so a defensive input is never eaten by something else.
    if (this.tryRoll(now)) return;
    if (input.isHeld('guard')) {
      this.enter('guard');
      telemetry.first('guard');
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
      telemetry.first('jump');
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
    if (moveX !== 0) {
      this.facing = moveX > 0 ? 1 : -1;
      telemetry.first('move');
    }
  }

  // --- Guard --------------------------------------------------------------

  private updateGuard(now: number, dt: number, onGround: boolean): void {
    // Planted: the stick only turns the guard around.
    this.applyRun(dt, onGround, 0);
    if (input.moveX !== 0) this.facing = input.moveX > 0 ? 1 : -1;
    if (this.tryRoll(now)) return;
    if (!input.isHeld('guard')) this.enter('normal');
  }

  private pulseGuard(): void {
    this.guardGfx.setScale(1.4);
    this.scene.tweens.add({ targets: this.guardGfx, scale: 1, duration: 120 });
  }

  // --- Roll ---------------------------------------------------------------

  private tryRoll(now: number): boolean {
    if (!input.buffered('roll') || now < this.rollReadyAt) return false;
    input.consume('roll');
    telemetry.first('roll');
    if (input.moveX !== 0) this.facing = input.moveX > 0 ? 1 : -1;
    this.enter('roll');
    this.body.setVelocityX(this.facing * P.rollSpeed);
    this.scene.tweens.killTweensOf(this.visual);
    this.visual.setAlpha(0.45).setScale(1.25, 0.65);
    return true;
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

  private get move(): Move {
    return this.weapon.moves[this.moveIndex];
  }

  private startAttack(index: number): void {
    telemetry.first('attack');
    if (input.moveX !== 0) this.facing = input.moveX > 0 ? 1 : -1;
    this.moveIndex = index;
    this.attackQueued = false;
    this.hitThisMove.clear();
    this.lastTri = undefined;
    this.enter('attack');
    this.body.setVelocityX(this.facing * this.move.lunge);
  }

  private updateAttack(now: number, dt: number, onGround: boolean): void {
    const move = this.move;

    // Roll cancels an attack at any time: this is what makes touch combat feel responsive.
    if (this.tryRoll(now)) return;

    // Lunge decays to a stop on the ground; in the air keep a little drift.
    const friction = onGround ? 0.82 : 0.95;
    this.body.setVelocityX(this.body.velocity.x * Math.pow(friction, dt / 16.67));

    if (input.buffered('attack') && this.stateMs >= move.activeFromMs) {
      input.consume('attack');
      this.attackQueued = true;
    }

    if (this.stateMs >= move.activeFromMs && this.stateMs <= move.activeToMs + dt) {
      // Test the triangle where it is now and halfway from where it was last frame,
      // so a fast swing can't skip over an enemy between frames.
      const tri = this.currentTriangle();
      const tris = this.lastTri ? [tri, midTriangle(this.lastTri, tri)] : [tri];
      this.lastTri = tri;
      this.scene.hitEnemies(tris, move, this.facing, this.hitThisMove);
    }

    if (this.attackQueued && this.stateMs >= move.chainFromMs && this.moveIndex < this.weapon.moves.length - 1) {
      this.startAttack(this.moveIndex + 1);
      return;
    }

    if (this.stateMs >= move.durationMs) {
      this.enter('normal');
      // Last move done and attack still queued: start the sequence again.
      if (this.attackQueued) this.startAttack(0);
    }
  }

  private currentPose(): Pose | undefined {
    if (this.mode === 'attack') return poseAt(this.move, this.stateMs);
    if (this.mode === 'dead' || this.mode === 'roll') return undefined;
    return REST_POSE;
  }

  private currentTriangle(pose = this.currentPose() ?? REST_POSE): Phaser.Geom.Triangle {
    return triangleAt(this.weapon.shape, pose, this.x, this.centerY, this.facing);
  }

  // --- Drawing ------------------------------------------------------------

  /** Runs after the physics step so visuals never lag a frame behind the body. */
  private syncVisual(): void {
    this.visual.setPosition(this.x, this.y);

    const wg = this.weaponGfx.clear();
    const pose = this.currentPose();
    if (pose) {
      const tri = this.currentTriangle(pose);
      wg.fillStyle(PALETTE.shape, pose.alpha);
      wg.fillTriangleShape(tri);
      const m = this.move;
      if (this.mode === 'attack' && this.stateMs >= m.activeFromMs && this.stateMs <= m.activeToMs + 40) {
        this.scene.effects.trail(tri, pose.alpha);
      }
    }

    const gg = this.guardGfx.clear();
    if (this.mode === 'guard') {
      this.guardGfx.setPosition(this.x + this.facing * GUARD_GAP, this.centerY);
      gg.fillStyle(PALETTE.shape, 0.9);
      gg.fillRect(-GUARD_SIZE / 2, -GUARD_SIZE / 2, GUARD_SIZE, GUARD_SIZE);
    }
  }

  private squash(sx: number, sy: number): void {
    if (this.mode === 'roll' || this.mode === 'dead') return;
    this.visual.setScale(sx, sy);
    this.scene.tweens.add({ targets: this.visual, scaleX: 1, scaleY: 1, duration: 140, ease: 'Quad.easeOut' });
  }
}
