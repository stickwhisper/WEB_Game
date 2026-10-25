import Phaser from 'phaser';
import { PALETTE, TUNING } from '../config';
import { type EnemyAttack, type EnemyDef, PLATE_HP } from '../enemies';
import type { GameScene } from '../scenes/GameScene';
import { type Pose, midTriangle, triangleAt } from '../weapons';
import type { Player } from './Player';

const E = TUNING.enemy;
const PIP_RADIUS = 3;
const PIP_GAP = 8;
const PIPS_PER_ROW = 12;
/** Once half its circles are gone, a plated enemy (the boss) winds up this much faster. */
const ENRAGED_WINDUP = 0.65;
const GUARD_SIZE = 14;
/** A practice sandbag refills this long after its last hit. */
const SANDBAG_REFILL_MS = 1500;

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
  private lastHitAt = -Infinity;
  /** Stunned by a parry or bash (as opposed to the short flinch of an ordinary hit). */
  private staggered = false;
  /** How long the player has stood behind a guarding enemy (it turns after E.guardTurnMs). */
  private behindMs = 0;
  /** The player rolled through it: it doesn't know they are behind until struck. */
  private lostPlayer = false;
  /** Which side of it the player was on last frame. */
  private playerSide: 1 | -1 = 1;
  private attackSpent = false;
  private stunMs: number = E.stunMs;
  private lastTri?: Phaser.Geom.Triangle;
  private guardPulse = 1;
  /** The attack being wound up or performed, chosen by distance from def.attack + def.extraAttacks. */
  private atk: EnemyAttack;
  private plates: number;
  private plateHp = PLATE_HP;
  private readonly gfx: Phaser.GameObjects.Graphics;

  constructor(scene: GameScene, x: number, y: number, def: EnemyDef) {
    super(scene, x, y, `enemy-${def.id}`);
    this.def = def;
    this.hp = def.maxHp;
    this.atk = def.attack;
    this.plates = def.plates ?? 0;
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
    const hasGuard = this.def.guardPower > 0 || this.plates > 0;
    return hasGuard && (this.mode === 'patrol' || this.mode === 'chase' || this.mode === 'windup' || this.mode === 'recover');
  }

  private get windupMs(): number {
    const enraged = this.def.plates !== undefined && this.hp <= this.def.maxHp / 2;
    return this.atk.windupMs * (enraged ? ENRAGED_WINDUP : 1);
  }

  /** Pick one of the attacks that can reach the player from here (at random), if any. */
  private chooseAttack(dx: number): EnemyAttack | undefined {
    const all = [this.def.attack, ...(this.def.extraAttacks ?? [])];
    const inRange = all.filter((a) => Math.abs(dx) < a.range);
    return inRange.length ? Phaser.Utils.Array.GetRandom(inRange) : undefined;
  }

  update(now: number, dt: number, player: Player): void {
    if (this.mode === 'dead') return;
    this.stateMs += dt;
    const atk = this.atk;
    // Sandbags take their circles back once left alone for a moment.
    if (this.def.immortal && this.hp < this.def.maxHp && now - this.lastHitAt > SANDBAG_REFILL_MS) this.hp = this.def.maxHp;
    if (this.def.drillEveryMs !== undefined && this.mode === 'patrol') this.enter('chase');

    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const seesPlayer = !player.isDead && Math.abs(dx) < E.aggroRangeX && Math.abs(dy) < E.aggroRangeY;
    this.trackRollThrough(dx, player);

    switch (this.mode) {
      case 'patrol':
        if (this.body.blocked.left || this.body.blocked.right || !this.groundAhead()) this.dir = this.dir > 0 ? -1 : 1;
        this.body.setVelocityX(this.dir * this.def.patrolSpeed);
        if (seesPlayer) this.enter('chase');
        break;

      case 'chase':
        if (this.lostPlayer) {
          // Lost the player behind it: walks on as if on patrol until they show up in front.
          if (this.body.blocked.left || this.body.blocked.right || !this.groundAhead()) this.dir = this.dir > 0 ? -1 : 1;
          this.body.setVelocityX(this.dir * this.def.patrolSpeed);
          break;
        }
        this.faceTowards(dx >= 0 ? 1 : -1, dt);
        this.body.setVelocityX(this.groundAhead() ? this.dir * this.def.chaseSpeed : 0);
        // A drill sandbag ignores distance: it strikes the air on its own rhythm.
        if (this.def.drillEveryMs !== undefined) {
          if (this.stateMs >= this.def.drillEveryMs) {
            this.atk = this.def.attack;
            this.enter('windup');
          }
          break;
        }
        if (!seesPlayer) this.enter('patrol');
        else if (Math.abs(dy) < this.def.body.height + 20 && this.body.blocked.down) {
          // Only at a player it faces: one behind it gets the turn delay first.
          const next = (dx >= 0 ? 1 : -1) === this.dir ? this.chooseAttack(dx) : undefined;
          if (next) {
            this.atk = next;
            this.enter('windup');
          }
        }
        break;

      case 'windup':
        this.body.setVelocityX(0);
        if (this.stateMs >= this.windupMs) this.startAttack(player);
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
    const dazed = this.staggered && this.mode === 'stun';
    if (!dazed) this.staggered = false;
    this.setAngle(dazed ? Math.sin(this.stateMs / 70) * 14 : 0);
    this.setAlpha(dazed ? 0.55 : 1);
  }

  /**
   * Struck by the player's triangle travelling in direction `dir`.
   * From the front, a guard turns up to guardPower points into squares; the rest bleeds as circles.
   * `ignoreGuard` (a shield bash) goes straight past the guard and the plates.
   */
  hit(damage: number, dir: number, knockback: number, ignoreGuard = false): void {
    if (this.mode === 'dead') return;

    this.lostPlayer = false;
    this.behindMs = 0;
    const fromFront = dir === -this.dir && !ignoreGuard;
    if (this.guarding && fromFront && this.plates > 0) {
      damage = this.breakPlates(damage);
      if (damage <= 0) {
        this.body.setVelocityX(dir * 40);
        return;
      }
    } else if (this.guarding && fromFront) {
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
    this.lastHitAt = this.scene.time.now;
    if (this.hp <= 0) {
      // A sandbag never dies: emptied, it simply fills up again.
      if (!this.def.immortal) {
        this.die();
        return;
      }
      this.hp = this.def.maxHp;
    }
    if (this.def.heavy) return; // unflinching: keeps its footing and its attack
    this.body.setVelocity(dir * knockback, -160);
    if (this.staggered) return; // already dazed: a hit doesn't cut the stagger short
    this.dir = dir > 0 ? -1 : 1; // turn to face the attacker
    this.stun(E.stunMs);
  }

  /** Damage from the front goes into the plates first; returns what gets through to the circles. */
  private breakPlates(damage: number): number {
    while (damage > 0 && this.plates > 0) {
      const blocked = Math.min(damage, this.plateHp);
      this.scene.effects.block(blocked, this.guardX, this.plateY(this.plates - 1));
      this.plateHp -= blocked;
      damage -= blocked;
      this.guardPulse = 1.5;
      if (this.plateHp <= 0) {
        // The plate itself falls away.
        this.dropPlate(this.plates - 1);
        this.plates--;
        this.plateHp = PLATE_HP;
      }
    }
    return damage;
  }

  private dropPlate(index: number): void {
    const plate = this.scene.add.rectangle(this.guardX, this.plateY(index), GUARD_SIZE, GUARD_SIZE, PALETTE.shape).setDepth(11);
    this.scene.tweens.add({
      targets: plate,
      x: plate.x + this.dir * 40,
      y: plate.y + 90,
      angle: this.dir * 120,
      alpha: 0,
      duration: 700,
      ease: 'Quad.easeIn',
      onComplete: () => plate.destroy(),
    });
  }

  /** Plates stack up the front of the body, the bottom one first. */
  private plateY(index: number): number {
    return this.y - GUARD_SIZE / 2 - 4 - index * (GUARD_SIZE + 4);
  }

  private stun(ms: number): void {
    this.stunMs = ms;
    this.staggered = false;
    this.enter('stun');
  }

  /**
   * The reward for a parry or a bash: stunned for `ms`, even the heavy ones and the boss.
   * While stunned it can't attack and its guard and plates are down, so every hit lands.
   * It tilts back and forth and dims, so the state reads without words.
   */
  stagger(ms: number): void {
    if (this.mode === 'dead') return;
    this.stun(ms);
    this.staggered = true;
    this.body.setVelocityX(0);
  }

  private startAttack(player: Player): void {
    const atk = this.atk;
    this.scene.effects.tones.triangle(true);
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
    const atk = this.atk;
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

    const result = player.receiveAttack(this.atk.damage, this.x, this.def.id);
    if (result === 'ignored') return; // rolled through: the attack carries on
    this.attackSpent = true;
    if (this.atk.kind === 'lunge') this.body.setVelocityX(0);
    if (result === 'parried') this.stagger(E.staggerMs);
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

  /** Carries a front square (warden, blocker); the boss's plates don't count. */
  private get shieldBearer(): boolean {
    return this.def.guardPower > 0;
  }

  /**
   * Turn to the player's side. An enemy with a shield turns only once the player has stayed
   * behind it for E.guardTurnMs, so getting behind it opens a short window.
   */
  private faceTowards(side: 1 | -1, dt: number): void {
    if (side === this.dir || !this.shieldBearer) {
      this.behindMs = 0;
      this.dir = side;
      return;
    }
    this.behindMs += dt;
    if (this.behindMs >= E.guardTurnMs) {
      this.behindMs = 0;
      this.dir = side;
    }
  }

  /**
   * A shield-bearing enemy that the player rolls straight through loses track of them: it keeps its
   * back to them until struck. It finds them again once they are back in front of it.
   */
  private trackRollThrough(dx: number, player: Player): void {
    const side: 1 | -1 = dx >= 0 ? 1 : -1;
    const crossed = side !== this.playerSide && Math.abs(dx) < this.def.body.width;
    if (this.shieldBearer && crossed && player.isRolling && side !== this.dir && this.mode !== 'stun') this.lostPlayer = true;
    if (side === this.dir || player.isDead) this.lostPlayer = false;
    this.playerSide = side;
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
    const atk = this.atk;
    const leap = atk.kind === 'lunge' && atk.hop > 0;
    switch (this.mode) {
      case 'windup': {
        // Grows in and draws back: the longer it has grown, the closer the attack.
        const t = Math.min(1, this.stateMs / this.windupMs);
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
    const w = this.atk.weapon;
    const scale = this.mode === 'windup' ? Math.min(1, this.stateMs / this.windupMs) : 1;
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

    this.guardPulse = Math.max(1, this.guardPulse - 0.05);
    if (this.plates > 0) {
      // Plates are worn all the time; they are dim while it attacks (not guarding).
      g.fillStyle(PALETTE.shape, this.guarding ? 0.85 : 0.35);
      for (let i = 0; i < this.plates; i++) {
        const s = GUARD_SIZE * (i === this.plates - 1 ? this.guardPulse : 1);
        g.fillRect(this.guardX - s / 2, this.plateY(i) - s / 2, s, s);
      }
    } else if (this.guarding) {
      const s = GUARD_SIZE * this.guardPulse;
      g.fillStyle(PALETTE.shape, 0.85);
      g.fillRect(this.guardX - s / 2, this.centerY - s / 2, s, s);
    }

    // Remaining health as small circles under the body, in rows of PIPS_PER_ROW.
    g.fillStyle(PALETTE.shape, 0.8);
    for (let i = 0; i < this.hp; i++) {
      const row = Math.floor(i / PIPS_PER_ROW);
      const inRow = Math.min(PIPS_PER_ROW, this.hp - row * PIPS_PER_ROW);
      const col = i % PIPS_PER_ROW;
      g.fillCircle(this.x - ((inRow - 1) * PIP_GAP) / 2 + col * PIP_GAP, this.y + 8 + row * PIP_GAP, PIP_RADIUS);
    }
  }
}
