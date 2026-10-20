/**
 * Learning record. Invisible in the game: it only collects.
 *
 * The question the work asks is "can this be learned from shapes alone?", so
 * what matters is *when* each idea is first used, and where people fail:
 *   - firsts: the first attack, guard, parry, roll, jump, pick, heal... with the
 *     time since the session began and the room it happened in
 *   - rooms: time spent, damage taken and blocked, whether it was cleared or died in
 *
 * Kept on the device (localStorage, last 30 sessions). If VITE_TELEMETRY_URL is
 * set at build time, each finished room and the session on page hide are also
 * sent there with navigator.sendBeacon. Nothing personal: an anonymous random
 * device id only.
 *
 * With ?debug, `window.telemetry` exposes the log in the console.
 */

const LOG_KEY = 'agame.log';
const DEVICE_KEY = 'agame.device';
const MAX_SESSIONS = 30;
const ENDPOINT: string | undefined = import.meta.env.VITE_TELEMETRY_URL;

export type First =
  | 'move'
  | 'jump'
  | 'attack'
  | 'hit-enemy'
  | 'guard'
  | 'block'
  | 'parry'
  | 'roll'
  | 'pick'
  | 'heal'
  | 'kill'
  | 'exit'
  /** Left the boss room: a whole run finished. */
  | 'win';

interface RoomRecord {
  room: string;
  /** Position in the run (0 = first room). */
  index: number;
  enteredMs: number;
  ms?: number;
  damageTaken: number;
  damageBlocked: number;
  outcome?: 'exit' | 'death';
  /** What dealt the last blow, when the outcome is death. */
  killedBy?: string;
}

interface Session {
  device: string;
  session: string;
  startedAt: string;
  input: 'touch' | 'keyboard';
  viewport: string;
  firsts: Partial<Record<First, { ms: number; room: string }>>;
  rooms: RoomRecord[];
  runs: number;
}

class Telemetry {
  readonly data: Session;
  private readonly t0 = performance.now();
  private current?: RoomRecord;

  constructor() {
    this.data = {
      device: deviceId(),
      session: randomId(),
      startedAt: new Date().toISOString(),
      input: matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard',
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      firsts: {},
      rooms: [],
      runs: 1,
    };
    addEventListener('pagehide', () => this.flush(true));
  }

  private get now(): number {
    return Math.round(performance.now() - this.t0);
  }

  /** The first time something happens in this session; later times are ignored. */
  first(kind: First): void {
    if (this.data.firsts[kind]) return;
    this.data.firsts[kind] = { ms: this.now, room: this.current?.room ?? '' };
    this.save();
  }

  enterRoom(room: string, index: number): void {
    this.current = { room, index, enteredMs: this.now, damageTaken: 0, damageBlocked: 0 };
    this.data.rooms.push(this.current);
    this.save();
  }

  damage(taken: number, blocked: number): void {
    if (!this.current) return;
    this.current.damageTaken += taken;
    this.current.damageBlocked += blocked;
  }

  leaveRoom(outcome: 'exit' | 'death', killedBy?: string): void {
    const r = this.current;
    if (!r || r.outcome) return;
    r.outcome = outcome;
    r.ms = this.now - r.enteredMs;
    if (killedBy) r.killedBy = killedBy;
    if (outcome === 'death') this.data.runs++;
    this.save();
    this.flush(false);
  }

  /** All stored sessions, oldest first (this one included). */
  history(): Session[] {
    return [...readLog().filter((s) => s.session !== this.data.session), this.data];
  }

  private save(): void {
    const log = readLog().filter((s) => s.session !== this.data.session);
    log.push(this.data);
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-MAX_SESSIONS)));
    } catch {
      // Storage full or blocked: the in-memory record still exists for this session.
    }
  }

  private flush(final: boolean): void {
    if (!ENDPOINT) return;
    const body = JSON.stringify({ final, ...this.data });
    try {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
    } catch {
      // Best effort only.
    }
  }
}

function readLog(): Session[] {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]') as Session[];
  } catch {
    return [];
  }
}

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return randomId();
  }
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const telemetry = new Telemetry();
