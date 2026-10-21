import Phaser from 'phaser';
import { KEY_BINDINGS } from '../config';
import type { Action } from './InputState';

/** Everything a key can be bound to: the directions plus every action. */
export type Binding = 'left' | 'right' | 'down' | Action;
export const BINDINGS: Binding[] = ['left', 'right', 'down', 'jump', 'attack', 'guard', 'roll', 'pick'];

const STORE_KEY = 'agame.keys';
const codeOf = (name: string): number => Phaser.Input.Keyboard.KeyCodes[name as keyof typeof Phaser.Input.Keyboard.KeyCodes];

/**
 * Which key codes drive which binding. Starts from KEY_BINDINGS in config.ts,
 * can be changed in the settings screen, and is remembered on this device.
 * A key belongs to at most one binding, and every binding keeps at least one key.
 */
class KeyMap {
  codes: Record<Binding, number[]> = defaults();
  private readonly listeners = new Set<() => void>();

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<Record<Binding, number[]>> | null;
      if (saved) for (const b of BINDINGS) if (Array.isArray(saved[b]) && saved[b]!.length) this.codes[b] = saved[b]!;
    } catch {
      // Storage blocked or bad data: keep the defaults.
    }
  }

  bindingFor(code: number): Binding | undefined {
    return BINDINGS.find((b) => this.codes[b].includes(code));
  }

  allCodes(): number[] {
    return BINDINGS.flatMap((b) => this.codes[b]);
  }

  /**
   * Press a key while a binding is selected: if it is already that binding's, remove it
   * (unless it is the last one); otherwise take it from wherever it was and add it here.
   */
  toggle(binding: Binding, code: number): void {
    const mine = this.codes[binding];
    if (mine.includes(code)) {
      if (mine.length > 1) this.codes[binding] = mine.filter((c) => c !== code);
    } else {
      const owner = this.bindingFor(code);
      if (owner) {
        if (this.codes[owner].length === 1) return; // would leave that binding with no key
        this.codes[owner] = this.codes[owner].filter((c) => c !== code);
      }
      this.codes[binding] = [...mine, code];
    }
    this.changed();
  }

  reset(): void {
    this.codes = defaults();
    this.changed();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.codes));
    } catch {
      // ignore
    }
    for (const fn of this.listeners) fn();
  }
}

function defaults(): Record<Binding, number[]> {
  return Object.fromEntries(BINDINGS.map((b) => [b, KEY_BINDINGS[b].map(codeOf)])) as Record<Binding, number[]>;
}

export const keyMap = new KeyMap();
