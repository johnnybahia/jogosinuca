import type { PoolView } from './view';

export type InputMode = 'off' | 'aim' | 'top' | 'place';

export interface InputCallbacks {
  mode(): InputMode;
  /** gira a mira (delta em radianos, + = anti-horário visto de cima) */
  rotate(delta: number): void;
  /** aponta a mira para um ponto da mesa (vista de cima) */
  pointAt(x: number, y: number): void;
  /** arrasta a bola branca (bola na mão); retorna true se pegou a bola */
  place(x: number, y: number, start: boolean): void;
  sens(): number;
}

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/** Gestos no canvas: arrastar gira a mira, pinça/roda dão zoom, dois dedos inclinam a câmera. */
export class AimInput {
  private ptrs = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private mid = 0;
  private dragging = false;
  private placing = false;
  private rbtn = false;
  private off: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement, private view: PoolView, private cb: InputCallbacks) {
    const on = <K extends keyof HTMLElementEventMap>(t: K, fn: (e: HTMLElementEventMap[K]) => void, opt?: AddEventListenerOptions): void => {
      canvas.addEventListener(t, fn as EventListener, opt);
      this.off.push(() => canvas.removeEventListener(t, fn as EventListener));
    };
    on('pointerdown', (e) => this.down(e));
    on('pointermove', (e) => this.move(e));
    on('pointerup', (e) => this.up(e));
    on('pointercancel', (e) => this.up(e));
    on('wheel', (e) => this.wheel(e), { passive: false });
    on('contextmenu', (e) => e.preventDefault());
  }

  destroy(): void {
    for (const f of this.off) f();
  }

  private ndc(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -(((e.clientY - r.top) / r.height) * 2 - 1) };
  }

  private down(e: PointerEvent): void {
    if (this.cb.mode() === 'off') return;
    this.canvas.setPointerCapture(e.pointerId);
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.rbtn = e.button === 2;
    if (this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()];
      this.pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      this.mid = (a!.y + b!.y) / 2;
      this.dragging = false;
      this.placing = false;
      return;
    }
    const mode = this.cb.mode();
    const n = this.ndc(e);
    const p = this.view.cam.pick(n.x, n.y);
    if (mode === 'place') {
      this.placing = true;
      if (p) this.cb.place(p.x, p.y, true);
    } else if (mode === 'top') {
      this.dragging = true;
      if (p) this.cb.pointAt(p.x, p.y);
    } else {
      this.dragging = true;
    }
  }

  private move(e: PointerEvent): void {
    const prev = this.ptrs.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (this.ptrs.size >= 2) {
      this.ptrs.set(e.pointerId, cur);
      const [a, b] = [...this.ptrs.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (this.pinch > 0 && d > 0) this.zoom(this.pinch / d);
      this.pinch = d;
      const m = (a!.y + b!.y) / 2;
      this.tilt((m - this.mid) * 0.004);
      this.mid = m;
      return;
    }
    this.ptrs.set(e.pointerId, cur);
    const mode = this.cb.mode();
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    if (this.rbtn) {
      this.tilt(dy * 0.004);
      this.zoom(Math.exp(dx * 0.004));
      return;
    }
    if (mode === 'place' && this.placing) {
      const n = this.ndc(e);
      const p = this.view.cam.pick(n.x, n.y);
      if (p) this.cb.place(p.x, p.y, false);
    } else if (mode === 'top' && this.dragging) {
      const n = this.ndc(e);
      const p = this.view.cam.pick(n.x, n.y);
      if (p) this.cb.pointAt(p.x, p.y);
    } else if (mode === 'aim' && this.dragging) {
      const k = 0.0042 * this.cb.sens() * clamp(this.view.cam.userDist / 1.05, 0.35, 1.8);
      this.cb.rotate(-dx * k * (e.shiftKey ? 0.25 : 1));
      if (Math.abs(dy) > Math.abs(dx) * 1.6 && e.pointerType === 'mouse' && e.altKey) this.tilt(dy * 0.004);
    }
  }

  private up(e: PointerEvent): void {
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size < 2) this.pinch = 0;
    if (this.ptrs.size === 0) {
      this.dragging = false;
      this.placing = false;
      this.rbtn = false;
    }
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ok */
    }
  }

  private wheel(e: WheelEvent): void {
    if (this.cb.mode() === 'off') return;
    e.preventDefault();
    this.zoom(Math.exp(e.deltaY * 0.0011));
  }

  zoom(f: number): void {
    const c = this.view.cam;
    c.userDist = clamp(c.userDist * f, 0.5, 2.3);
  }

  tilt(d: number): void {
    const c = this.view.cam;
    c.userPitch = clamp(c.userPitch + d, 0.12, 1.25);
  }
}
