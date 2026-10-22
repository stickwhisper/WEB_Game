import Phaser from 'phaser';
import { PALETTE, TUNING } from '../config';
import { input } from '../input/InputState';
import { telemetry } from '../telemetry';
import type { GameScene } from '../scenes/GameScene';
import type { Item } from '../items';
import type { Loadout } from '../run';
import { SHIELDS, type ShieldDef, blockOf, parryMsOf } from '../shields';
import { type Move, type Pose, type SpecialMoves, type WeaponDef, WEAPONS, midTriangle, poseAt, specialMoves, triangleAt } from '../weapons';
import type { Enemy } from './Enemy';

const P = TUNING.player;
const RADIUS = 18;
/** Weapon held loosely when not attacking: a faint triangle pointing down and forward. */
const REST_POSE: Pose = { angleDeg: 70, dist: -6, alpha: 0.3 };
const GUARD_GAP = 24;

/** Attack pressed this soon after a roll ends (or late in the roll) becomes a dash attack. */
const DASH_WINDOW_MS = 160;
/** Attack still held this long when a swing ends starts charging; fully charged after CHARGE_FULL_MS. */
const CHARGE_AFTER_MS = 280;
const CHARGE_FULL_MS = 600;
const BASH_MS = 260;
/** Roll held after the roll ends: run this much faster until it is let go. */
const SPRINT = 1.6;
/** Down + jump on a line platform: ignore line platforms for this long. */
const DROP_MS = 260;
/** Practice room: health fills up again this long after the last hit. */
const PRACTICE_REFILL_MS = 2000;

type State = 'normal' | 'attack' | 'charge' | 'guard' | 'bash' | 'roll' | 'hurt' | 'dead';

/** What happened when an attack reached the player. */
export type HitResult = 'ignored' | 'parried' | 'blocked' | 'hit';

export class Player extends Phaser.Physics.Arcade.Sprite {
  declare body: Phaser.Physics.Arcade.Body;
  declare scene: GameScene;

  hp: number = P.maxHp;
  maxHp: number = P.maxHp;
  facing: 1 | -1 = 1;
  weapon: WeaponDef = WEAPONS.sword;
  shield: ShieldDef = SHIELDS.medium;
  /** Triangle upgrades: added to every hit (a hit still deals at least 1). */
  attackBonus = 0;
  /** Square upgrades: added to the shield's block, or widens a parry-only window. */
  guardBonus = 0;
  private shieldReadyAt = 0;
  /** In the practice room health never drops below 1 and fills up again after a pause. */
  practice = false;
  private lastHurtAt = -Infinity;
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

  /** Last place it stood with solid ground under both feet: where a fall brings it back. */
  private readonly safe = new Phaser.Math.Vector2();

  private moveIndex = 0;
  /** A dash, air or charged move in progress (instead of the combo move). */
  private special?: Move;
  private rollEndedAt = -Infinity;
  private sprinting = false;
  /** A hold-bash already fired for the current press of guard (cleared when it is let go). */
  private bashLatched = false;
  /** The shield dropped by itself (held past activeMs): it stays down until guard is let go. */
  private guardSpent = false;
  private dropUntil = 0;
  private chargeFull = false;
  private readonly bashHit = new Set<Enemy>();
  private attackQueued = false;
  private swingSounded = false;
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

    this.safe.set(x, y);
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

  /** Dropping through line platforms right now (down + jump). */
  get dropping(): boolean {
    return this.scene.time.now < this.dropUntil;
  }

  update(now: number, dt: number): void {
    const onGround = this.body.blocked.down;
    if (onGround) this.lastGroundedAt = now;
    if (onGround && !this.wasOnGround) this.squash(1.2, 0.8);
    this.wasOnGround = onGround;
    this.stateMs += dt;
    if (onGround && this.mode !== 'dead') this.rememberSafeGround();
    this.watchBashHold(now);
    if (this.practice && this.hp < this.maxHp && now - this.lastHurtAt > PRACTICE_REFILL_MS) {
      this.hp = this.maxHp;
      this.scene.onPlayerHealed(this.hp);
    }

    switch (this.mode) {
      case 'normal':
        this.updateNormal(now, dt, onGround);
        break;
      case 'attack':
        this.updateAttack(now, dt, onGround);
        break;
      case 'charge':
        this.updateCharge(now, dt, onGround);
        break;
      case 'bash':
        this.updateBash();
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

  applyLoadout(l: Loadout): void {
    this.hp = l.hp;
    this.maxHp = l.maxHp;
    this.weapon = WEAPONS[l.weaponId];
    this.shield = SHIELDS[l.shieldId];
    this.attackBonus = l.attackBonus;
    this.guardBonus = l.guardBonus;
  }

  get loadout(): Loadout {
    return { hp: this.hp, maxHp: this.maxHp, weaponId: this.weapon.id, shieldId: this.shield.id, attackBonus: this.attackBonus, guardBonus: this.guardBonus };
  }

  /** Damage one hit of `move` deals with the current attack bonus. */
  damageOf(move: Move): number {
    return Math.max(1, move.damage + this.attackBonus);
  }

  /** Take back `amount` circles of health, up to the maximum. Returns how many were actually taken. */
  heal(amount: number): number {
    if (this.mode === 'dead') return 0;
    const taken = Math.min(amount, this.maxHp - this.hp);
    this.hp += taken;
    if (taken > 0) {
      telemetry.first('heal');
      this.scene.effects.tones.regain();
    }
    if (taken > 0) this.scene.onPlayerHealed(this.hp);
    return taken;
  }

  get isFullHealth(): boolean {
    return this.hp >= this.maxHp;
  }

  /** Swap a weapon or shield for the one of the same kind in hand; returns the one dropped. */
  equip(item: Item): Item {
    if (item.kind === 'weapon') {
      const old = this.weapon;
      this.weapon = item.weapon;
      return { kind: 'weapon', weapon: old };
    }
    const old = this.shield;
    this.shield = item.shield;
    if (this.mode === 'guard') this.enter('normal');
    return { kind: 'shield', shield: old };
  }

  /**
   * An attack of `damage` points arrives from `fromX` (dealt by `source`).
   * A raised shield facing the attacker parries it (all squares) or blocks part of it;
   * a large shield carried on the back blocks attacks from behind. The rest become circles.
   */
  receiveAttack(damage: number, fromX: number, source = ''): HitResult {
    const now = this.scene.time.now;
    if (this.mode === 'roll' || this.mode === 'dead' || now < this.invulnUntil) return 'ignored';

    const fx = this.scene.effects;
    const towardAttacker = fromX >= this.x ? 1 : -1;
    const front = towardAttacker === this.facing;
    let blocked = 0;
    let parried = false;
    // A large shield's raise-bash already holds the square in front.
    const raised = this.mode === 'guard' || (this.mode === 'bash' && this.shield.block > 0);
    if (raised && front) {
      // Measured on the guard's own state timer: same clock as enemy wind-ups, even on slow frames.
      parried = this.stateMs <= parryMsOf(this.shield, this.guardBonus);
      blocked = parried ? damage : Math.min(damage, blockOf(this.shield, this.guardBonus));
    } else if (!raised && !front && this.shield.guardsBack) {
      blocked = Math.min(damage, blockOf(this.shield, this.guardBonus));
    }
    if (blocked > 0) {
      const side = raised ? this.facing : -this.facing;
      fx.block(blocked, this.x + side * GUARD_GAP, this.centerY);
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
    this.hp = Math.max(this.practice ? 1 : 0, this.hp - damage);
    this.lastHurtAt = now;
    this.lastHitBy = source;
    fx.bleed(damage, this.x, this.centerY);
    this.invulnUntil = now + P.invulnMs;
    this.body.setVelocity(-towardAttacker * 320, -320);
    this.scene.onPlayerHurt(this.hp);

    if (this.hp <= 0) {
      this.die();
      return 'hit';
    }
    this.enter('hurt');
    this.blink();
    return 'hit';
  }

  /**
   * Fell out of the room: one circle is lost and it comes back on the last solid
   * ground it stood on. Guard, roll and invulnerability don't help against a fall.
   */
  fallBack(): void {
    if (this.mode === 'dead') return;
    telemetry.damage(Math.min(P.fallDamage, this.hp), 0);
    this.hp = Math.max(this.practice ? 1 : 0, this.hp - P.fallDamage);
    this.lastHurtAt = this.scene.time.now;
    this.lastHitBy = 'fall';
    this.scene.onPlayerHurt(this.hp);
    if (this.hp <= 0) {
      this.die();
      return;
    }
    this.body.reset(this.safe.x, this.safe.y);
    this.visual.setPosition(this.safe.x, this.safe.y).setScale(1);
    this.scene.cameras.main.centerOn(this.safe.x, this.safe.y);
    this.scene.effects.bleed(P.fallDamage, this.x, this.centerY);
    this.invulnUntil = this.scene.time.now + P.invulnMs;
    this.enter('normal');
    this.blink();
  }

  private die(): void {
    this.enter('dead');
    this.scene.tweens.killTweensOf(this.visual);
    this.scene.tweens.add({ targets: this.visual, scale: 0, duration: 500, ease: 'Quad.easeIn' });
  }

  private blink(): void {
    this.scene.tweens.killTweensOf(this.visual);
    this.visual.setAlpha(1);
    this.scene.tweens.add({
      targets: this.visual,
      alpha: 0.25,
      duration: 70,
      yoyo: true,
      repeat: Math.floor(P.invulnMs / 140) - 1,
      onComplete: () => this.visual.setAlpha(1),
    });
  }

  /** Both feet over a solid tile ('#'), not a line platform and not hanging over an edge. */
  private rememberSafeGround(): void {
    const b = this.body;
    const level = this.scene.level;
    const below = b.bottom + 2;
    if (level.isGroundAt(b.left + 1, below) && level.isGroundAt(b.right - 1, below)) this.safe.set(this.x, this.y);
  }

  private enter(state: State): void {
    this.mode = state;
    this.stateMs = 0;
  }

  private updateNormal(now: number, dt: number, onGround: boolean): void {
    this.applyRun(dt, onGround, input.moveX);

    // Priority: roll > guard > attack > jump, so a defensive input is never eaten by something else.
    if (this.tryRoll(now)) return;
    if (this.tryRaiseShield(now)) return;
    if (input.buffered('attack')) {
      input.consume('attack');
      if (!onGround) this.startSpecial('air');
      else if (now - this.rollEndedAt <= DASH_WINDOW_MS) this.startSpecial('dash');
      else this.startAttack(0);
      return;
    }
    this.handleJump(now);
  }

  private handleJump(now: number): void {
    // Down + jump on a line platform: drop through it instead of jumping.
    if (input.buffered('jump') && input.down && this.onLinePlatform()) {
      input.consume('jump');
      telemetry.first('drop');
      this.dropUntil = now + DROP_MS;
      this.body.setVelocityY(120);
      return;
    }
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

  private onLinePlatform(): boolean {
    const b = this.body;
    const level = this.scene.level;
    const below = b.bottom + 2;
    return b.blocked.down && level.isLineAt(this.x, below) && !level.isGroundAt(b.left + 1, below) && !level.isGroundAt(b.right - 1, below);
  }

  private applyRun(dt: number, onGround: boolean, moveX: number): void {
    if (this.sprinting && !input.isHeld('roll')) this.sprinting = false;
    const sprint = this.sprinting && this.mode === 'normal' ? SPRINT : 1;
    const target = moveX * P.runSpeed * this.shield.carrySpeed * sprint;
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

  /**
   * small (tap): every press raises it for a moment, even while walking.
   * medium / large (timed): raised while the button is held, dropping by itself after activeMs.
   * A large shield's raise opens with a bash. Each has a wait (cooldownMs) after lowering.
   */
  private tryRaiseShield(now: number): boolean {
    if (now < this.shieldReadyAt || this.bashLatched || this.guardSpent) return false;
    const pressed = input.buffered('guard');
    if (!(this.shield.use === 'tap' ? pressed : pressed || input.isHeld('guard'))) return false;
    input.consume('guard');
    telemetry.first('guard');
    if (this.shield.bash === 'raise') this.startBash(now);
    else this.enter('guard');
    return true;
  }

  private updateGuard(now: number, dt: number, onGround: boolean): void {
    const s = this.shield;
    // Walk at the shield's raised speed; a planted shield (0) can still be turned around.
    this.applyRun(dt, onGround, input.moveX * s.raisedSpeed);
    if (s.raisedSpeed === 0 && input.moveX !== 0) this.facing = input.moveX > 0 ? 1 : -1;
    if (this.tryRoll(now)) {
      this.shieldReadyAt = now + s.cooldownMs;
      return;
    }
    // Tapping a small shield again while it is up raises it afresh: a new parry window.
    if (s.use === 'tap' && input.buffered('guard')) {
      input.consume('guard');
      this.stateMs = 0;
    }
    const up =
      s.use === 'tap'
        ? this.stateMs < Math.max(s.activeMs, parryMsOf(s, this.guardBonus))
        : input.isHeld('guard') && this.stateMs < s.activeMs;
    if (!up) {
      // Held past its time: down, and it won't come back up until the button is let go.
      if (s.use === 'timed' && input.isHeld('guard')) this.guardSpent = true;
      this.shieldReadyAt = now + s.cooldownMs;
      this.enter('normal');
    }
  }

  /** A hold-bash shield (small) bashes the moment guard has been pressed long enough; once per press. */
  private watchBashHold(now: number): void {
    if (!input.isHeld('guard')) {
      this.bashLatched = false;
      this.guardSpent = false;
      return;
    }
    if (this.shield.bash !== 'hold' || this.bashLatched) return;
    if (input.heldMs('guard') < this.shield.bashHoldMs) return;
    if (this.mode !== 'normal' && this.mode !== 'guard') return;
    this.bashLatched = true;
    this.startBash(now);
  }

  /** A short shove with the square: 1 damage past an enemy's guard, and a stagger (see GameScene.bashEnemies). */
  private startBash(now: number): void {
    telemetry.first('bash');
    if (input.moveX !== 0) this.facing = input.moveX > 0 ? 1 : -1;
    this.shieldReadyAt = now + this.shield.cooldownMs;
    this.bashHit.clear();
    this.enter('bash');
    this.scene.effects.tones.squares(1);
  }

  private updateBash(): void {
    const push = this.shield.bashPush;
    this.body.setVelocityX(this.stateMs < 120 ? this.facing * push : this.body.velocity.x * 0.8);
    if (this.stateMs < 180) {
      const size = this.shield.size + 14;
      const cx = this.x + this.facing * (GUARD_GAP + 6);
      this.scene.bashEnemies(new Phaser.Geom.Rectangle(cx - size / 2, this.centerY - size / 2, size, size), this.facing, this.bashHit);
    }
    if (this.stateMs < BASH_MS) return;
    // A raise-bash (large shield) settles into an ordinary guard if the button is still held.
    if (this.shield.bash === 'raise' && input.isHeld('guard')) this.enter('guard');
    else this.enter('normal');
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
    // Attack late in the roll: come out of it with a dash attack.
    if (this.stateMs >= P.rollMs * 0.4 && input.buffered('attack')) {
      input.consume('attack');
      this.endRoll(now);
      this.startSpecial('dash');
      return;
    }
    if (this.stateMs >= P.rollMs) {
      this.endRoll(now);
      this.enter('normal');
    }
  }

  private endRoll(now: number): void {
    this.visual.setAlpha(1).setScale(1);
    this.rollReadyAt = now + P.rollCooldownMs;
    this.rollEndedAt = now;
    // Still holding roll: keep running fast.
    if (input.isHeld('roll')) {
      this.sprinting = true;
      telemetry.first('sprint');
    }
  }

  // --- Attack -------------------------------------------------------------

  private get move(): Move {
    return this.special ?? this.weapon.moves[this.moveIndex];
  }

  private startSpecial(kind: keyof SpecialMoves): void {
    telemetry.first(kind === 'dash' ? 'dash-attack' : kind === 'air' ? 'air-attack' : 'charge');
    if (input.moveX !== 0) this.facing = input.moveX > 0 ? 1 : -1;
    this.special = specialMoves(this.weapon)[kind];
    this.attackQueued = false;
    this.swingSounded = false;
    this.hitThisMove.clear();
    this.lastTri = undefined;
    this.enter('attack');
    if (kind !== 'air') this.body.setVelocityX(this.facing * this.special.lunge);
  }

  private startAttack(index: number): void {
    telemetry.first('attack');
    this.special = undefined;
    if (input.moveX !== 0) this.facing = input.moveX > 0 ? 1 : -1;
    this.moveIndex = index;
    this.attackQueued = false;
    this.swingSounded = false;
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
      if (!this.swingSounded) {
        this.swingSounded = true;
        this.scene.effects.tones.triangle();
      }
      // Test the triangle where it is now and halfway from where it was last frame,
      // so a fast swing can't skip over an enemy between frames.
      const tri = this.currentTriangle();
      const tris = this.lastTri ? [tri, midTriangle(this.lastTri, tri)] : [tri];
      this.lastTri = tri;
      this.scene.hitEnemies(tris, move, this.damageOf(move), this.facing, this.hitThisMove);
    }

    if (this.attackQueued && !this.special && this.stateMs >= move.chainFromMs && this.moveIndex < this.weapon.moves.length - 1) {
      this.startAttack(this.moveIndex + 1);
      return;
    }

    if (this.stateMs >= move.durationMs) {
      // Attack still held (not tapped again) after a combo swing: start charging.
      if (!this.special && !this.attackQueued && input.heldMs('attack') >= CHARGE_AFTER_MS) {
        this.chargeFull = false;
        this.enter('charge');
        return;
      }
      this.special = undefined;
      this.enter('normal');
      // Last move done and attack still queued: start the sequence again.
      if (this.attackQueued) this.startAttack(0);
    }
  }

  /** Planted, the triangle drawn back and growing; release when full for the heavy strike. */
  private updateCharge(now: number, dt: number, onGround: boolean): void {
    this.applyRun(dt, onGround, 0);
    if (input.moveX !== 0) this.facing = input.moveX > 0 ? 1 : -1;
    if (this.tryRoll(now)) return;
    if (!this.chargeFull && this.stateMs >= CHARGE_FULL_MS) {
      this.chargeFull = true;
      this.scene.effects.tones.triangle();
    }
    if (input.isHeld('attack')) return;
    if (this.chargeFull) this.startSpecial('charge');
    else this.enter('normal');
  }

  private currentPose(): Pose | undefined {
    if (this.mode === 'attack') return poseAt(this.move, this.stateMs);
    if (this.mode === 'charge') {
      const t = Math.min(1, this.stateMs / CHARGE_FULL_MS);
      // Fully charged: the drawn-back triangle flickers.
      const alpha = this.chargeFull ? 0.7 + 0.3 * Math.sin(this.stateMs / 40) : 0.4 + 0.5 * t;
      return { angleDeg: -60 - 100 * t, dist: -6 * t, alpha };
    }
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

    // The shield: raised in front, or (large only) carried on the back, dimmer.
    const gg = this.guardGfx.clear();
    const size = this.shield.size;
    const raised = this.mode === 'guard' || this.mode === 'bash';
    const onBack = !raised && this.shield.guardsBack && this.mode !== 'dead' && this.mode !== 'roll';
    if (raised || onBack) {
      this.guardGfx.setPosition(this.x + (raised ? this.facing : -this.facing) * GUARD_GAP, this.centerY);
      // A bash pushes the square out further and larger.
      const s = this.mode === 'bash' ? size * 1.35 : size;
      if (this.mode === 'bash') this.guardGfx.x += this.facing * 6;
      gg.fillStyle(PALETTE.shape, raised ? 0.9 : 0.4);
      gg.fillRect(-s / 2, -s / 2, s, s);
    }
  }

  private squash(sx: number, sy: number): void {
    if (this.mode === 'roll' || this.mode === 'dead') return;
    this.visual.setScale(sx, sy);
    this.scene.tweens.add({ targets: this.visual, scaleX: 1, scaleY: 1, duration: 140, ease: 'Quad.easeOut' });
  }
}
