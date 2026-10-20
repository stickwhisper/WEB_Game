import Phaser from 'phaser';

/**
 * Sound without meaning: plain sine tones, one pitch per shape, no melody or samples.
 *   triangle  a short high tone that falls (an attack)
 *   circle    one tone per circle lost; rising when a circle is taken back
 *   square    one tone per square (blocked point); held for an exit opening
 * A loss of three circles is three tones, so amounts can be counted by ear too.
 *
 * Uses the AudioContext Phaser already unlocks on the first touch or key press.
 * Silent where Web Audio is unavailable.
 */
const CIRCLE_HZ = 392;
const SQUARE_HZ = 587;
const TRIANGLE_HZ = 784;
const SERIES_GAP_MS = 75;
const MAX_SERIES = 8;

export class Tones {
  private readonly ctx?: AudioContext;
  private readonly out?: GainNode;

  constructor(scene: Phaser.Scene) {
    const sm = scene.sound;
    if (sm instanceof Phaser.Sound.WebAudioSoundManager) {
      this.ctx = sm.context;
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.5;
      this.out.connect(this.ctx.destination);
    }
  }

  triangle(quiet = false): void {
    this.tone(TRIANGLE_HZ, 90, { to: TRIANGLE_HZ * 0.7, gain: quiet ? 0.05 : 0.09 });
  }

  /** `count` circles lost, one tone each. */
  circles(count: number): void {
    this.series(count, CIRCLE_HZ, 140);
  }

  /** A circle taken back: the circle pitch, rising. */
  regain(): void {
    this.tone(CIRCLE_HZ, 160, { to: CIRCLE_HZ * 1.5 });
  }

  /** `count` squares (points kept out of health), one tone each. */
  squares(count: number): void {
    this.series(count, SQUARE_HZ, 80);
  }

  exitOpens(): void {
    this.tone(SQUARE_HZ, 600, { gain: 0.06 });
  }

  exitEntered(): void {
    this.tone(SQUARE_HZ, 900, { to: SQUARE_HZ * 2, gain: 0.08 });
  }

  private series(count: number, hz: number, ms: number): void {
    for (let i = 0; i < Math.min(count, MAX_SERIES); i++) this.tone(hz, ms, { delayMs: i * SERIES_GAP_MS });
  }

  private tone(hz: number, ms: number, opts: { to?: number; gain?: number; delayMs?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.out || ctx.state !== 'running') return;
    const t = ctx.currentTime + (opts.delayMs ?? 0) / 1000;
    const end = t + ms / 1000;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(hz, t);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, end);
    // Short attack, exponential release: no clicks.
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(opts.gain ?? 0.08, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(env).connect(this.out);
    osc.start(t);
    osc.stop(end + 0.02);
  }
}
