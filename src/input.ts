// Keyboard + mouse on desktop, twin floating joysticks + buttons on touch screens.

export interface Stick {
  id: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
}

export interface TouchButton {
  id: string;
  x: number;
  y: number;
  r: number;
  label: string;
}

export const STICK_RADIUS = 60;

export class Input {
  keys = new Set<string>();
  mouse = { x: 0, y: 0, down: false };
  touchMode = false;
  move: Stick | null = null;
  aim: Stick | null = null;
  buttons: TouchButton[] = [];
  heldButtons = new Set<string>();
  private pressed = new Set<string>();
  private buttonPointers = new Map<number, string>();

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.reset());

    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.moveP(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener(
      'wheel',
      (e) => {
        this.pressed.add(e.deltaY > 0 ? 'wheeldown' : 'wheelup');
      },
      { passive: true },
    );
  }

  reset() {
    this.keys.clear();
    this.mouse.down = false;
    this.move = null;
    this.aim = null;
    this.heldButtons.clear();
    this.buttonPointers.clear();
  }

  /** True once per press of `key` (keyboard key or touch button id). */
  consume(key: string): boolean {
    if (this.pressed.has(key)) {
      this.pressed.delete(key);
      return true;
    }
    return false;
  }

  clearPressed() {
    this.pressed.clear();
  }

  private down(e: PointerEvent) {
    e.preventDefault();
    if (e.pointerType === 'mouse') {
      this.touchMode = false;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      // Buttons (like pause) are clickable with the mouse too.
      const b = this.hitButton(e.clientX, e.clientY);
      if (b) {
        this.pressed.add(b);
        return;
      }
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2) this.pressed.add('dash');
      return;
    }
    this.touchMode = true;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const b = this.hitButton(e.clientX, e.clientY);
    if (b) {
      this.pressed.add(b);
      this.heldButtons.add(b);
      this.buttonPointers.set(e.pointerId, b);
      return;
    }
    const stick: Stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
    if (e.clientX < window.innerWidth / 2) {
      if (!this.move) this.move = stick;
    } else if (!this.aim) this.aim = stick;
  }

  private moveP(e: PointerEvent) {
    if (e.pointerType === 'mouse') {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      return;
    }
    for (const s of [this.move, this.aim]) {
      if (s && s.id === e.pointerId) {
        s.x = e.clientX;
        s.y = e.clientY;
        // Drag the stick base along so the thumb never runs out of range.
        const dx = s.x - s.ox;
        const dy = s.y - s.oy;
        const d = Math.hypot(dx, dy);
        if (d > STICK_RADIUS * 1.4) {
          s.ox = s.x - (dx / d) * STICK_RADIUS * 1.4;
          s.oy = s.y - (dy / d) * STICK_RADIUS * 1.4;
        }
      }
    }
  }

  private up(e: PointerEvent) {
    if (e.pointerType === 'mouse') {
      if (e.button === 0) this.mouse.down = false;
      return;
    }
    const b = this.buttonPointers.get(e.pointerId);
    if (b) {
      this.heldButtons.delete(b);
      this.buttonPointers.delete(e.pointerId);
    }
    if (this.move && this.move.id === e.pointerId) this.move = null;
    if (this.aim && this.aim.id === e.pointerId) this.aim = null;
  }

  private hitButton(x: number, y: number): string | null {
    for (const b of this.buttons) {
      if (Math.hypot(x - b.x, y - b.y) <= b.r + 8) return b.id;
    }
    return null;
  }

  /** Movement direction, length 0..1. */
  moveVec(): { x: number; y: number } {
    if (this.move) return stickVec(this.move);
    let x = 0;
    let y = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) y -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) y += 1;
    const d = Math.hypot(x, y);
    return d > 0 ? { x: x / d, y: y / d } : { x: 0, y: 0 };
  }
}

export function stickVec(s: Stick): { x: number; y: number } {
  let x = (s.x - s.ox) / STICK_RADIUS;
  let y = (s.y - s.oy) / STICK_RADIUS;
  const d = Math.hypot(x, y);
  if (d > 1) {
    x /= d;
    y /= d;
  }
  return { x, y };
}
