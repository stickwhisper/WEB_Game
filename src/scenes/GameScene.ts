import Phaser from 'phaser';
import { PALETTE, TUNING } from '../config';
import { Effects } from '../effects';
import { input } from '../input/InputState';
import { LEVEL_1, Level } from '../level';
import { Enemy } from '../objects/Enemy';
import { Player } from '../objects/Player';
import { WeaponPickup } from '../objects/WeaponPickup';
import type { Move } from '../weapons';

export const GameEvents = {
  HP: 'hp',
  /** (available: boolean) the player is standing on a weapon that can be picked up. */
  PICK_AVAILABLE: 'pick-available',
} as const;

const EXIT_SIZE = 56;

export class GameScene extends Phaser.Scene {
  level!: Level;
  player!: Player;
  effects!: Effects;
  private enemies: Enemy[] = [];
  private pickups: WeaponPickup[] = [];
  private exits: Phaser.GameObjects.Graphics[] = [];
  private hitstopTimer?: Phaser.Time.TimerEvent;
  private ending = false;
  private nearPickup?: WeaponPickup;

  constructor() {
    super('Game');
  }

  create(): void {
    this.enemies = [];
    this.pickups = [];
    this.exits = [];
    this.ending = false;
    this.nearPickup = undefined;
    input.clearBuffered();

    this.effects = new Effects(this);
    this.level = new Level(this, LEVEL_1);
    this.physics.world.setBounds(0, 0, this.level.widthPx, this.level.heightPx);

    // The exit is a square: leaving the stage is leaving the health system.
    for (const e of this.level.exits) {
      const g = this.add.graphics({ x: e.x, y: e.y - EXIT_SIZE / 2 }).setDepth(-0.5);
      g.lineStyle(3, PALETTE.shape, 0.9).strokeRect(-EXIT_SIZE / 2, -EXIT_SIZE / 2, EXIT_SIZE, EXIT_SIZE);
      this.exits.push(g);
    }
    for (const w of this.level.weapons) this.pickups.push(new WeaponPickup(this, w.x, w.y, w.weapon));

    this.player = new Player(this, this.level.playerSpawn.x, this.level.playerSpawn.y);
    for (const s of this.level.enemySpawns) this.enemies.push(new Enemy(this, s.x, s.y));

    const bodies = [this.player, ...this.enemies];
    this.physics.add.collider(bodies, this.level.solids);
    this.physics.add.collider(bodies, this.level.oneWays);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.level.widthPx, this.level.heightPx);
    cam.startFollow(this.player, true, 0.12, 0.12, 0, 40);
    cam.setDeadzone(60, 80);
    cam.fadeIn(250);

    if (!this.scene.isActive('UI')) this.scene.launch('UI');
    this.game.events.emit(GameEvents.HP, this.player.hp);
    this.game.events.emit(GameEvents.PICK_AVAILABLE, false);
  }

  update(time: number, delta: number): void {
    // Clamp only real stalls (tab switch, GC pause). A low clamp would make state timers
    // run slower than physics on slow devices, stretching rolls and wind-ups.
    const dt = Math.min(delta, 100);
    this.player.update(time, dt);
    for (const e of this.enemies) if (e.active) e.update(time, dt, this.player);
    this.updatePickups();

    if (this.ending) return;
    if (this.player.y > this.level.heightPx + 100) this.player.receiveAttack(TUNING.player.maxHp, this.player.x);
    if (this.player.isDead) {
      this.endByDeath();
      return;
    }
    const exit = this.exits.find((g) => Math.abs(this.player.x - g.x) < EXIT_SIZE / 2 - 8 && Math.abs(this.player.centerY - g.y) < EXIT_SIZE / 2);
    if (exit) this.endByExit(exit);
  }

  // --- Combat hooks called by Player / Enemy -------------------------------

  hitEnemies(tris: Phaser.Geom.Triangle[], move: Move, dir: number, alreadyHit: Set<Enemy>): void {
    let hits = 0;
    for (const e of this.enemies) {
      if (!e.active || e.isDead || alreadyHit.has(e)) continue;
      const b = e.body;
      const rect = new Phaser.Geom.Rectangle(b.x, b.y, b.width, b.height);
      if (!tris.some((t) => Phaser.Geom.Intersects.RectangleToTriangle(rect, t))) continue;
      alreadyHit.add(e);
      e.hit(move.damage, dir, move.knockback);
      hits++;
    }
    if (hits > 0) {
      this.hitStop(move.hitstopMs);
      this.cameras.main.shake(90, move.shake);
    }
  }

  onPlayerHurt(hp: number): void {
    this.game.events.emit(GameEvents.HP, hp);
    this.cameras.main.shake(160, 0.01);
    this.hitStop(80);
  }

  onEnemyKilled(_enemy: Enemy): void {
    this.cameras.main.shake(120, 0.006);
  }

  /** Freeze the physics world for a few ms on impact: the core of "hit feel". */
  hitStop(ms: number): void {
    this.physics.world.pause();
    this.hitstopTimer?.remove(false);
    this.hitstopTimer = this.time.delayedCall(ms, () => this.physics.world.resume());
  }

  // --- Flow ----------------------------------------------------------------

  /** Standing on a weapon offers it; the pick input (target button / E) swaps it with the one in hand. */
  private updatePickups(): void {
    let near: WeaponPickup | undefined;
    for (const p of this.pickups) {
      p.update();
      if (!near && !this.player.isDead && p.touches(this.player.x, this.player.y)) near = p;
    }
    if (near !== this.nearPickup) {
      this.nearPickup?.setNear(false);
      near?.setNear(true);
      this.nearPickup = near;
      this.game.events.emit(GameEvents.PICK_AVAILABLE, !!near);
    }
    if (near && !this.player.isBusy && input.buffered('pick')) {
      input.consume('pick');
      near.swap(this.player.equip(near.weapon));
    }
  }


  /** No words: the last circle is gone, the circle body shrinks away, the screen goes dark. */
  private endByDeath(): void {
    this.ending = true;
    this.time.delayedCall(1200, () => this.restartWithFade());
  }

  /** The exit square grows until it is the whole screen. */
  private endByExit(exit: Phaser.GameObjects.Graphics): void {
    this.ending = true;
    exit.clear().fillStyle(PALETTE.shape, 1).fillRect(-EXIT_SIZE / 2, -EXIT_SIZE / 2, EXIT_SIZE, EXIT_SIZE);
    exit.setDepth(50);
    const cover = (Math.max(this.scale.width, this.scale.height) * 2.2) / EXIT_SIZE;
    this.tweens.add({ targets: exit, scale: cover, duration: 900, ease: 'Cubic.easeIn', onComplete: () => this.restartWithFade() });
  }

  private restartWithFade(): void {
    this.cameras.main.fadeOut(300);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.restart());
  }
}
