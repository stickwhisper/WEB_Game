import Phaser from 'phaser';
import { type AttackDef, TUNING, VIEW_HEIGHT } from '../config';
import { input } from '../input/InputState';
import { LEVEL_1, Level } from '../level';
import { Enemy } from '../objects/Enemy';
import { Player } from '../objects/Player';

export const GameEvents = {
  HP: 'hp',
  KILLS: 'kills',
  MESSAGE: 'message',
} as const;

export class GameScene extends Phaser.Scene {
  level!: Level;
  player!: Player;
  private enemies: Enemy[] = [];
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private hitstopTimer?: Phaser.Time.TimerEvent;
  private kills = 0;
  private ending = false;

  constructor() {
    super('Game');
  }

  create(): void {
    this.enemies = [];
    this.kills = 0;
    this.ending = false;
    input.clearBuffered();

    this.drawBackdrop();
    this.level = new Level(this, LEVEL_1);
    this.physics.world.setBounds(0, 0, this.level.widthPx, this.level.heightPx);

    for (const d of this.level.doors) {
      this.add.image(d.x, d.y, 'door').setOrigin(0.5, 1).setDepth(-0.5);
    }

    this.player = new Player(this, this.level.playerSpawn.x, this.level.playerSpawn.y);
    for (const s of this.level.enemySpawns) this.enemies.push(new Enemy(this, s.x, s.y));

    const bodies = [this.player, ...this.enemies];
    this.physics.add.collider(bodies, this.level.solids);
    this.physics.add.collider(bodies, this.level.oneWays);
    this.physics.add.overlap(this.player, this.enemies, (_p, e) => {
      const enemy = e as unknown as Enemy;
      if (enemy.isDangerous) this.player.takeDamage(TUNING.enemy.damage, enemy.x);
    });

    this.sparks = this.add.particles(0, 0, 'spark', {
      speed: { min: 120, max: 380 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 150, max: 320 },
      scale: { start: 1.2, end: 0 },
      gravityY: 600,
      emitting: false,
    });
    this.sparks.setDepth(20);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.level.widthPx, this.level.heightPx);
    cam.startFollow(this.player, true, 0.12, 0.12, 0, 40);
    cam.setDeadzone(60, 80);
    cam.fadeIn(250);

    if (!this.scene.isActive('UI')) this.scene.launch('UI');
    this.game.events.emit(GameEvents.HP, this.player.hp);
    this.game.events.emit(GameEvents.KILLS, this.kills, this.enemies.length);
  }

  update(time: number, delta: number): void {
    // Clamp delta so a tab switch or a long GC pause doesn't fling objects through walls.
    const dt = Math.min(delta, 50);
    this.player.update(time, dt);
    for (const e of this.enemies) if (e.active) e.update(time, dt, this.player);

    if (this.ending) return;
    if (this.player.y > this.level.heightPx + 100) this.player.takeDamage(9999, this.player.x);
    if (this.player.isDead) {
      this.endRun('YOU DIED', 0xff5060);
    } else if (this.touchingDoor()) {
      this.endRun('STAGE CLEAR', 0x7dffa0);
    }
  }

  // --- Combat hooks called by Player / Enemy -------------------------------

  hitEnemies(rect: Phaser.Geom.Rectangle, def: AttackDef, dir: number, alreadyHit: Set<Enemy>): void {
    let hits = 0;
    for (const e of this.enemies) {
      if (!e.active || e.isDead || alreadyHit.has(e)) continue;
      const b = e.body;
      if (!Phaser.Geom.Intersects.RectangleToRectangle(rect, new Phaser.Geom.Rectangle(b.x, b.y, b.width, b.height))) continue;
      alreadyHit.add(e);
      e.hit(def.damage, dir, def.knockback);
      this.sparks.explode(10, e.x, e.y - b.height / 2);
      hits++;
    }
    if (hits > 0) {
      this.hitStop(def.hitstopMs);
      this.cameras.main.shake(90, def.shake);
    }
  }

  showSlash(player: Player, def: AttackDef, comboIndex: number): void {
    const slash = this.add
      .image(player.x + player.facing * (def.reach * 0.45), player.y - 24, 'slash')
      .setDepth(15)
      .setFlipX(player.facing < 0)
      .setFlipY(comboIndex === 1)
      .setScale(def.reach / 56)
      .setAlpha(0.95);
    this.tweens.add({
      targets: slash,
      alpha: 0,
      x: slash.x + player.facing * 10,
      duration: def.activeToMs - def.activeFromMs + 60,
      onComplete: () => slash.destroy(),
    });
  }

  onPlayerHurt(hp: number): void {
    this.game.events.emit(GameEvents.HP, hp);
    this.cameras.main.shake(160, 0.01);
    this.cameras.main.flash(80, 120, 0, 0);
    this.hitStop(80);
  }

  onEnemyKilled(enemy: Enemy): void {
    this.kills++;
    this.sparks.explode(24, enemy.x, enemy.y - 17);
    this.game.events.emit(GameEvents.KILLS, this.kills, this.enemies.length);
  }

  /** Freeze the physics world for a few ms on impact: the core of "hit feel". */
  private hitStop(ms: number): void {
    this.physics.world.pause();
    this.hitstopTimer?.remove(false);
    this.hitstopTimer = this.time.delayedCall(ms, () => this.physics.world.resume());
  }

  // --- Flow ----------------------------------------------------------------

  private touchingDoor(): boolean {
    return this.level.doors.some((d) => Math.abs(this.player.x - d.x) < 20 && Math.abs(this.player.y - d.y) < 8);
  }

  private endRun(text: string, color: number): void {
    this.ending = true;
    this.game.events.emit(GameEvents.MESSAGE, text, color);
    this.time.delayedCall(1400, () => {
      this.cameras.main.fadeOut(250);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.restart());
    });
  }

  private drawBackdrop(): void {
    const w = this.scale.width;
    const g = this.add.graphics().setScrollFactor(0).setDepth(-10);
    g.fillGradientStyle(0x1b1b2e, 0x1b1b2e, 0x0e0e16, 0x0e0e16, 1);
    g.fillRect(0, 0, w, VIEW_HEIGHT);
    // A couple of slow parallax layers so movement reads even on flat ground.
    const far = this.add.graphics().setScrollFactor(0.15, 0.05).setDepth(-9);
    const near = this.add.graphics().setScrollFactor(0.35, 0.1).setDepth(-8);
    const rnd = new Phaser.Math.RandomDataGenerator(['backdrop']);
    for (let i = 0; i < 30; i++) {
      far.fillStyle(0x23233a).fillRect(i * 140 + rnd.between(-30, 30), rnd.between(140, 300), rnd.between(40, 90), 600);
    }
    for (let i = 0; i < 30; i++) {
      near.fillStyle(0x1e1e30).fillRect(i * 220 + rnd.between(-40, 40), rnd.between(260, 380), rnd.between(30, 60), 600);
    }
  }
}
