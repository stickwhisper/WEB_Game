import Phaser from 'phaser';
import { PALETTE, TUNING } from '../config';
import { Effects } from '../effects';
import { input } from '../input/InputState';
import { Level, VIEW_RIGHT_MARGIN } from '../level';
import { Enemy } from '../objects/Enemy';
import { Player } from '../objects/Player';
import { HealthDrop } from '../objects/HealthDrop';
import type { Item } from '../items';
import { ItemPickup } from '../objects/ItemPickup';
import { OfferPickup } from '../objects/OfferPickup';
import { applyOffer, rollOffers } from '../offers';
import { SHIELDS } from '../shields';
import { run } from '../run';
import { telemetry } from '../telemetry';
import { type Move, WEAPONS } from '../weapons';

export const GameEvents = {
  HP: 'hp',
  /** (available: boolean) the player is standing on a weapon that can be picked up. */
  PICK_AVAILABLE: 'pick-available',
  /** (exitsPassed: number) squares passed in this run so far. */
  PROGRESS: 'progress',
} as const;

const EXIT_SIZE = 56;
const RANDOM_ITEM_CHANCE = 0.65;

interface Exit {
  gfx: Phaser.GameObjects.Graphics;
  open: boolean;
}

export class GameScene extends Phaser.Scene {
  level!: Level;
  player!: Player;
  effects!: Effects;
  private enemies: Enemy[] = [];
  private pickups: ItemPickup[] = [];
  private drops: HealthDrop[] = [];
  private exits: Exit[] = [];
  private hitstopTimer?: Phaser.Time.TimerEvent;
  private ending = false;
  private offers: OfferPickup[] = [];
  private nearPickup?: ItemPickup | OfferPickup;

  constructor() {
    super('Game');
  }

  create(): void {
    this.enemies = [];
    this.pickups = [];
    this.offers = [];
    this.drops = [];
    this.exits = [];
    this.ending = false;
    this.nearPickup = undefined;
    input.clearBuffered();

    this.effects = new Effects(this);
    this.level = new Level(this, run.room.grid);
    this.physics.world.setBounds(0, 0, this.level.widthPx, this.level.heightPx);

    for (const it of this.level.items) this.pickups.push(new ItemPickup(this, it.x, it.y, it.item));
    // R spots: sometimes a weapon or a shield, never one already carried.
    for (const spot of this.level.randomItemSpots) {
      if (run.rnd.frac() > RANDOM_ITEM_CHANCE) continue;
      const choices: Item[] = [
        ...Object.values(WEAPONS)
          .filter((w) => w.id !== run.loadout.weaponId)
          .map((weapon): Item => ({ kind: 'weapon', weapon })),
        ...Object.values(SHIELDS)
          .filter((s) => s.id !== run.loadout.shieldId)
          .map((shield): Item => ({ kind: 'shield', shield })),
      ];
      this.pickups.push(new ItemPickup(this, spot.x, spot.y, run.rnd.pick(choices)));
    }

    // Health and the weapon in hand carry over from the previous room.
    this.player = new Player(this, this.level.playerSpawn.x, this.level.playerSpawn.y);
    this.player.applyLoadout(run.loadout);
    for (const s of this.level.enemySpawns) this.enemies.push(new Enemy(this, s.x, s.y, s.enemy));

    // The exit is a square: leaving the room is leaving the health system.
    // It stays dim and shut until the room is cleared.
    for (const e of this.level.exits) {
      const exit = { gfx: this.add.graphics({ x: e.x, y: e.y - EXIT_SIZE / 2 }).setDepth(-0.5), open: false };
      this.exits.push(exit);
      this.drawExit(exit);
    }

    const bodies = [this.player, ...this.enemies];
    this.physics.add.collider(bodies, this.level.solids);
    this.physics.add.collider(bodies, this.level.oneWays);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.level.widthPx + VIEW_RIGHT_MARGIN, this.level.heightPx);
    cam.startFollow(this.player, true, 0.12, 0.12, 0, 40);
    cam.setDeadzone(60, 80);
    cam.fadeIn(250);

    if (!this.scene.isActive('UI')) this.scene.launch('UI');
    this.game.events.emit(GameEvents.HP, this.player.hp, this.player.maxHp);
    this.game.events.emit(GameEvents.PICK_AVAILABLE, false);
    this.game.events.emit(GameEvents.PROGRESS, run.exitsPassed);
    telemetry.enterRoom(run.room.id, run.index);
  }

  update(time: number, delta: number): void {
    // Clamp only real stalls (tab switch, GC pause). A low clamp would make state timers
    // run slower than physics on slow devices, stretching rolls and wind-ups.
    const dt = Math.min(delta, 100);
    this.player.update(time, dt);
    for (const e of this.enemies) {
      if (!e.active) continue;
      // Fell out of the room: gone, so it can't keep the exit shut forever.
      if (e.y > this.level.heightPx + 100) e.destroy();
      else e.update(time, dt, this.player);
    }
    this.updatePickups();
    this.updateDrops();

    if (this.ending) return;
    if (this.player.y > this.level.heightPx + 40) this.player.fallBack();
    if (this.player.isDead) {
      this.endByDeath();
      return;
    }
    if (this.exits.some((e) => !e.open) && this.enemies.every((e) => !e.active || e.isDead)) {
      for (const e of this.exits) this.openExit(e);
    }
    const exit = this.exits.find(
      (e) => e.open && Math.abs(this.player.x - e.gfx.x) < EXIT_SIZE / 2 - 8 && Math.abs(this.player.centerY - e.gfx.y) < EXIT_SIZE / 2,
    );
    if (exit) this.endByExit(exit);
  }

  // --- Combat hooks called by Player / Enemy -------------------------------

  /** `damage` is the move's damage with the player's attack bonus already applied. */
  hitEnemies(tris: Phaser.Geom.Triangle[], move: Move, damage: number, dir: number, alreadyHit: Set<Enemy>): void {
    let hits = 0;
    for (const e of this.enemies) {
      if (!e.active || e.isDead || alreadyHit.has(e)) continue;
      const b = e.body;
      const rect = new Phaser.Geom.Rectangle(b.x, b.y, b.width, b.height);
      if (!tris.some((t) => Phaser.Geom.Intersects.RectangleToTriangle(rect, t))) continue;
      alreadyHit.add(e);
      e.hit(damage, dir, move.knockback);
      hits++;
    }
    if (hits > 0) {
      telemetry.first('hit-enemy');
      this.hitStop(move.hitstopMs);
      this.cameras.main.shake(90, move.shake);
    }
  }

  onPlayerHurt(hp: number): void {
    this.game.events.emit(GameEvents.HP, hp, this.player.maxHp);
    this.cameras.main.shake(160, 0.01);
    this.hitStop(80);
  }

  /** A dead enemy leaves its circles on the ground, fanned out around where it fell. */
  onEnemyKilled(enemy: Enemy): void {
    telemetry.first('kill');
    this.cameras.main.shake(120, 0.006);
    const n = enemy.def.drops;
    for (let i = 0; i < n; i++) {
      const spread = (i - (n - 1) / 2) * 22 + Phaser.Math.Between(-6, 6);
      this.drops.push(new HealthDrop(this, this.level, enemy.x, enemy.centerY, spread));
    }
  }

  onPlayerHealed(hp: number): void {
    this.game.events.emit(GameEvents.HP, hp, this.player.maxHp);
  }

  /** Freeze the physics world for a few ms on impact: the core of "hit feel". */
  hitStop(ms: number): void {
    this.physics.world.pause();
    this.hitstopTimer?.remove(false);
    this.hitstopTimer = this.time.delayedCall(ms, () => this.physics.world.resume());
  }

  // --- Flow ----------------------------------------------------------------

  /** Circles on the ground are taken back one by one, but only while health isn't full. */
  private updateDrops(): void {
    const reach = TUNING.healthDrop.reach;
    for (const d of this.drops) {
      d.update();
      if (!d.landed || d.taken || this.player.isFullHealth) continue;
      if (Phaser.Math.Distance.Between(d.x, d.y, this.player.x, this.player.centerY) > reach) continue;
      if (this.player.heal(1) > 0) d.absorb({ x: this.player.x, y: this.player.centerY });
    }
    this.drops = this.drops.filter((d) => !d.taken);
  }

  /**
   * Standing on a weapon, shield or growth offer brightens it and shows the pick button;
   * the pick input (target button / E) takes it. The nearest one wins when several overlap.
   */
  private updatePickups(): void {
    for (const p of this.pickups) p.update();
    for (const o of this.offers) o.update();
    const px = this.player.x;
    const py = this.player.y;
    const candidates = this.player.isDead ? [] : [...this.pickups, ...this.offers].filter((p) => p.touches(px, py));
    const near = candidates.sort((a, b) => Math.abs(a.x - px) - Math.abs(b.x - px))[0];
    if (near !== this.nearPickup) {
      this.nearPickup?.setNear(false);
      if (near instanceof ItemPickup) near.setNear(true, this.player.attackBonus, this.player.guardBonus);
      else near?.setNear(true);
      this.nearPickup = near;
      this.game.events.emit(GameEvents.PICK_AVAILABLE, !!near);
    }
    if (!near || this.player.isBusy || !input.buffered('pick')) return;
    input.consume('pick');
    if (near instanceof ItemPickup) {
      telemetry.first('pick');
      near.swap(this.player.equip(near.item));
      near.setNear(true, this.player.attackBonus, this.player.guardBonus);
      return;
    }
    this.takeOffer(near);
  }

  /** Three offers float in a row on the ground in front of the exit, inside the room. */
  private spawnOffers(exit: Exit): void {
    const ground = exit.gfx.y + EXIT_SIZE / 2;
    const inward = exit.gfx.x > this.level.widthPx / 2 ? -1 : 1;
    const spots: number[] = [];
    for (let d = 110; spots.length < 3 && d < 800; d += 20) {
      const x = exit.gfx.x + inward * d;
      // Solid ground under the whole footprint, and well apart from the previous offer.
      if (!this.level.isGroundAt(x - 14, ground + 4) || !this.level.isGroundAt(x + 14, ground + 4)) continue;
      if (spots.length && Math.abs(x - spots[spots.length - 1]) < 120) continue;
      spots.push(x);
    }
    const offers = rollOffers(run.rnd, this.player.loadout);
    spots.forEach((x, i) => this.offers.push(new OfferPickup(this, x, ground, offers[i])));
  }

  /** Apply the chosen offer at once; the others vanish. */
  private takeOffer(o: OfferPickup): void {
    telemetry.first('grow');
    this.player.applyLoadout(applyOffer(this.player.loadout, o.offer));
    this.game.events.emit(GameEvents.HP, this.player.hp, this.player.maxHp);
    o.take(this.player.x, this.player.centerY);
    for (const other of this.offers) if (other !== o) other.dismiss();
    this.effects.tones.regain();
    this.nearPickup = undefined;
    this.game.events.emit(GameEvents.PICK_AVAILABLE, false);
  }


  /** Filled like every world shape (outlines are reserved for controls): dim while shut, bright once open. */
  private drawExit(exit: Exit): void {
    exit.gfx.clear().fillStyle(PALETTE.shape, exit.open ? 0.85 : 0.1).fillRect(-EXIT_SIZE / 2, -EXIT_SIZE / 2, EXIT_SIZE, EXIT_SIZE);
  }

  /** The room is empty: the square brightens with a small pulse. */
  private openExit(exit: Exit): void {
    if (exit.open) return;
    exit.open = true;
    this.effects.tones.exitOpens();
    if (run.offersGrowth && !this.offers.length) this.spawnOffers(exit);
    this.drawExit(exit);
    exit.gfx.setScale(1.3);
    this.tweens.add({ targets: exit.gfx, scale: 1, duration: 400, ease: 'Back.easeOut' });
  }

  /** No words: the last circle is gone, the circle body shrinks away, the screen goes dark. The run is over. */
  private endByDeath(): void {
    this.ending = true;
    telemetry.leaveRoom('death', this.player.lastHitBy);
    run.reset();
    this.time.delayedCall(1200, () => this.restartWithFade());
  }

  /** The exit square grows until it is the whole screen; the next room begins inside it. */
  private endByExit(exit: Exit): void {
    this.ending = true;
    telemetry.first('exit');
    if (run.inBossRoom) telemetry.first('win');
    telemetry.leaveRoom('exit');
    this.effects.tones.exitEntered();
    run.advance(this.player.loadout);
    const g = exit.gfx;
    g.clear().fillStyle(PALETTE.shape, 1).fillRect(-EXIT_SIZE / 2, -EXIT_SIZE / 2, EXIT_SIZE, EXIT_SIZE);
    g.setDepth(50);
    const cover = (Math.max(this.scale.width, this.scale.height) * 2.2) / EXIT_SIZE;
    this.tweens.add({ targets: g, scale: cover, duration: 900, ease: 'Cubic.easeIn', onComplete: () => this.restartWithFade() });
  }

  private restartWithFade(): void {
    this.cameras.main.fadeOut(300);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.restart());
  }
}
