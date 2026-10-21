import Phaser from 'phaser';
import { PALETTE } from '../config';
import { BINDINGS, type Binding, keyMap } from '../input/keyMap';
import { drawSymbol } from '../input/symbols';
import { run } from '../run';

/** One key on the drawn keyboard: its Phaser key name (or null for a gap) and width in key units. */
type KeySpec = [name: string | null, width: number];

/** A plain US layout, drawn without any letters: position alone says which key it is. */
const ROWS: KeySpec[][] = [
  [['BACKTICK', 1], ['ONE', 1], ['TWO', 1], ['THREE', 1], ['FOUR', 1], ['FIVE', 1], ['SIX', 1], ['SEVEN', 1], ['EIGHT', 1], ['NINE', 1], ['ZERO', 1], ['MINUS', 1], ['PLUS', 1], ['BACKSPACE', 2]],
  [['TAB', 1.5], ['Q', 1], ['W', 1], ['E', 1], ['R', 1], ['T', 1], ['Y', 1], ['U', 1], ['I', 1], ['O', 1], ['P', 1], ['OPEN_BRACKET', 1], ['CLOSED_BRACKET', 1], ['BACK_SLASH', 1.5]],
  [['CAPS_LOCK', 1.75], ['A', 1], ['S', 1], ['D', 1], ['F', 1], ['G', 1], ['H', 1], ['J', 1], ['K', 1], ['L', 1], ['SEMICOLON', 1], ['QUOTES', 1], ['ENTER', 2.25]],
  [['SHIFT', 2.25], ['Z', 1], ['X', 1], ['C', 1], ['V', 1], ['B', 1], ['N', 1], ['M', 1], ['COMMA', 1], ['PERIOD', 1], ['FORWARD_SLASH', 1], ['SHIFT', 2.75], [null, 1], ['UP', 1]],
  [['CTRL', 1.5], [null, 1], ['ALT', 1.5], ['SPACE', 7], ['ALT', 1.5], [null, 1], ['CTRL', 1.5], [null, 0.5], ['LEFT', 1], ['DOWN', 1], ['RIGHT', 1]],
];
const KEYBOARD_UNITS = 18.5;

/**
 * Esc both opens (HUD) and closes (this screen). Both scenes receive the same key event,
 * so whichever handles it first marks it and the other ignores it.
 */
const handledEsc = new WeakSet<KeyboardEvent>();
export function takeEsc(e: KeyboardEvent): boolean {
  if (handledEsc.has(e)) return false;
  handledEsc.add(e);
  return true;
}

interface KeyRect {
  code: number;
  rect: Phaser.Geom.Rectangle;
}

/**
 * Key mapping without words. Left: the control symbols, one per action. Right: a
 * keyboard drawn as outlines. Pick a symbol and its keys fill in; press a key (or
 * tap it on the drawing) to give it to that symbol, press it again to take it away.
 * The circular arrow restores the defaults; the cross or Esc closes.
 */
export class SettingsScene extends Phaser.Scene {
  private selected: Binding = 'attack';
  private keys: KeyRect[] = [];
  private gfx!: Phaser.GameObjects.Graphics;
  private symbols: { binding: Binding; gfx: Phaser.GameObjects.Graphics; rect: Phaser.Geom.Rectangle }[] = [];
  private close!: Phaser.Geom.Rectangle;
  private reset!: Phaser.Geom.Rectangle;
  private practice!: Phaser.Geom.Rectangle;

  constructor() {
    super('Settings');
  }

  create(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.add.rectangle(0, 0, w, h, PALETTE.background, 0.94).setOrigin(0).setInteractive(); // swallow taps
    this.gfx = this.add.graphics();

    // Symbols, top to bottom.
    const rowH = Math.min(58, (h - 80) / BINDINGS.length);
    const top = (h - rowH * BINDINGS.length) / 2;
    this.symbols = BINDINGS.map((binding, i) => {
      const y = top + rowH * (i + 0.5);
      return { binding, gfx: this.add.graphics({ x: 80, y }), rect: new Phaser.Geom.Rectangle(40, y - rowH / 2, 80, rowH) };
    });

    // Keyboard, to the right of the symbols.
    const left = 160;
    const unit = Math.min(44, (w - left - 90) / KEYBOARD_UNITS);
    const kbTop = (h - unit * ROWS.length) / 2;
    this.keys = [];
    ROWS.forEach((row, r) => {
      let x = left;
      for (const [name, width] of row) {
        if (name) {
          const code = Phaser.Input.Keyboard.KeyCodes[name as keyof typeof Phaser.Input.Keyboard.KeyCodes];
          this.keys.push({ code, rect: new Phaser.Geom.Rectangle(x + 2, kbTop + r * unit + 2, width * unit - 4, unit - 4) });
        }
        x += width * unit;
      }
    });

    this.close = new Phaser.Geom.Rectangle(w - 64, 16, 48, 48);
    this.reset = new Phaser.Geom.Rectangle(w - 64, h - 64, 48, 48);
    this.practice = new Phaser.Geom.Rectangle(w - 64, h / 2 - 24, 48, 48);

    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => this.onTap(p.x, p.y));
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.keyCode === Phaser.Input.Keyboard.KeyCodes.ESC) {
        if (takeEsc(e)) this.finish();
      }
      else if (this.keys.some((k) => k.code === e.keyCode)) keyMap.toggle(this.selected, e.keyCode);
    });
    const off = keyMap.onChange(() => this.draw());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
    this.draw();
  }

  private onTap(x: number, y: number): void {
    if (this.close.contains(x, y)) return this.finish();
    if (this.reset.contains(x, y)) return keyMap.reset();
    if (this.practice.contains(x, y)) {
      // Into the practice room (or, from inside it, back to the run).
      this.events.emit('practice');
      return this.finish();
    }
    const sym = this.symbols.find((s) => s.rect.contains(x, y));
    if (sym) {
      this.selected = sym.binding;
      this.draw();
      return;
    }
    const key = this.keys.find((k) => k.rect.contains(x, y));
    if (key) keyMap.toggle(this.selected, key.code);
  }

  private finish(): void {
    this.events.emit('done');
    this.scene.stop();
  }

  private draw(): void {
    for (const s of this.symbols) {
      const on = s.binding === this.selected;
      drawSymbol(s.gfx.clear(), s.binding, 30, on, on ? 0.95 : 0.4);
    }

    const g = this.gfx.clear();
    const mine = keyMap.codes[this.selected];
    for (const k of this.keys) {
      const owner = keyMap.bindingFor(k.code);
      // Keys of the chosen symbol are solid; keys taken by another symbol are faintly filled.
      if (owner === this.selected) g.fillStyle(PALETTE.shape, 0.9).fillRectShape(k.rect);
      else if (owner) g.fillStyle(PALETTE.shape, 0.16).fillRectShape(k.rect);
      g.lineStyle(2, PALETTE.shape, mine.includes(k.code) ? 0.9 : 0.3).strokeRectShape(k.rect);
    }

    // Practice: a sandbag on its post. Filled while in the practice room (tapping it then leaves).
    const pr = this.practice;
    const inside = run.inPractice;
    g.lineStyle(3, PALETTE.shape, 0.6).fillStyle(PALETTE.shape, 0.8);
    if (inside) g.fillEllipse(pr.centerX, pr.centerY - 6, 26, 16);
    else g.strokeEllipse(pr.centerX, pr.centerY - 6, 26, 16);
    g.lineBetween(pr.centerX, pr.centerY + 2, pr.centerX, pr.centerY + 16);
    g.lineBetween(pr.centerX - 9, pr.centerY + 16, pr.centerX + 9, pr.centerY + 16);

    // Close: a cross. Reset: a circular arrow. Lines only, like every control.
    g.lineStyle(3, PALETTE.shape, 0.6);
    const c = this.close;
    g.lineBetween(c.x + 14, c.y + 14, c.right - 14, c.bottom - 14);
    g.lineBetween(c.right - 14, c.y + 14, c.x + 14, c.bottom - 14);
    const r = this.reset;
    const cx = r.centerX;
    const cy = r.centerY;
    g.beginPath();
    g.arc(cx, cy, 13, Phaser.Math.DegToRad(-60), Phaser.Math.DegToRad(240));
    g.strokePath();
    const tip = new Phaser.Math.Vector2(cx + 13 * Math.cos(Phaser.Math.DegToRad(-60)), cy + 13 * Math.sin(Phaser.Math.DegToRad(-60)));
    g.lineBetween(tip.x, tip.y, tip.x - 9, tip.y - 2);
    g.lineBetween(tip.x, tip.y, tip.x + 1, tip.y + 9);
  }
}
