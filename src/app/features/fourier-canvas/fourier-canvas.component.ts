import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  NgZone,
  untracked,
  viewChild,
} from '@angular/core';
import { StudioStore } from '../../core/state/studio-store';
import { DrawingSession } from '../../core/state/drawing-session';
import { computeEpicycleJoints } from '../../core/math/fourier-reconstruction';

/** Seconds for one full period (t: 0 → 2π) at speed 1×. */
const BASE_PERIOD_SECONDS = 12;
const TWO_PI = 2 * Math.PI;

/** Canvas palette (kept in sync with the CSS custom properties). */
const COLORS = {
  grid: 'rgba(148, 163, 184, 0.07)',
  axis: 'rgba(148, 163, 184, 0.16)',
  original: 'rgba(203, 213, 225, 0.55)',
  reconstruction: 'rgba(56, 189, 248, 0.9)',
  trail: '#fbbf24',
  circle: 'rgba(196, 181, 253, 0.22)',
  vector: 'rgba(196, 181, 253, 0.95)',
  endpoint: '#fbbf24',
  draft: '#e2e8f0',
  snap: 'rgba(52, 211, 153, 0.8)',
  gap: 'rgba(248, 113, 113, 0.8)',
};

/**
 * Main workspace: renders the original curve, the reconstruction, epicycles,
 * rotating vectors, endpoint and trail, and captures freehand drawing.
 *
 * Rendering runs in a requestAnimationFrame loop outside Angular's reactive
 * graph; signals are only read (memoised) and the progress indicator is
 * updated directly on the DOM, so animation never triggers change detection.
 */
@Component({
  selector: 'app-fourier-canvas',
  templateUrl: './fourier-canvas.component.html',
  styleUrl: './fourier-canvas.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel workspace' },
})
export class FourierCanvasComponent implements AfterViewInit {
  protected readonly store = inject(StudioStore);
  protected readonly drawing = inject(DrawingSession);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly stageRef = viewChild.required<ElementRef<HTMLDivElement>>('stage');
  private readonly progressFillRef = viewChild.required<ElementRef<HTMLDivElement>>('progressFill');
  private readonly progressTextRef = viewChild.required<ElementRef<HTMLSpanElement>>('progressText');
  private readonly progressBarRef = viewChild.required<ElementRef<HTMLDivElement>>('progressBar');

  private ctx: CanvasRenderingContext2D | null = null;
  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;

  /** Animation parameter t ∈ [0, 2π). */
  private t = 0;
  private lastTimestamp: number | null = null;
  private frameId: number | null = null;
  private dirty = true;
  private joints = new Float64Array(2);
  private pointerId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    // Any state that affects the picture schedules one redraw.
    effect(() => {
      this.store.layers();
      this.store.denseCurve();
      this.store.packed();
      this.store.samples();
      this.drawing.strokes();
      this.drawing.active();
      this.requestRender();
    });
    effect(() => {
      this.store.restartToken();
      untracked(() => {
        this.t = 0;
        this.lastTimestamp = null;
        this.requestRender();
      });
    });
    effect(() => {
      if (this.store.playing()) untracked(() => this.requestRender());
    });

    this.destroyRef.onDestroy(() => {
      if (this.frameId !== null) cancelAnimationFrame(this.frameId);
      this.frameId = null;
      this.resizeObserver?.disconnect();
    });
  }

  ngAfterViewInit(): void {
    this.ctx = this.canvasRef().nativeElement.getContext('2d');
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.stageRef().nativeElement);
    this.resize();
  }

  /* ---------------- sizing ---------------- */
  private resize(): void {
    const stage = this.stageRef().nativeElement;
    const canvas = this.canvasRef().nativeElement;
    const rect = stage.getBoundingClientRect();
    this.dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    this.cssWidth = Math.max(1, Math.floor(rect.width));
    this.cssHeight = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.round(this.cssWidth * this.dpr);
    canvas.height = Math.round(this.cssHeight * this.dpr);
    canvas.style.width = `${this.cssWidth}px`;
    canvas.style.height = `${this.cssHeight}px`;
    this.requestRender();
  }

  /* ---------------- frame scheduling ---------------- */
  private requestRender(): void {
    this.dirty = true;
    if (this.frameId === null && this.ctx) {
      this.zone.runOutsideAngular(() => {
        this.frameId = requestAnimationFrame((ts) => this.frame(ts));
      });
    }
  }

  private frame(timestamp: number): void {
    this.frameId = null;
    const playing = this.store.playing() && !this.drawing.active() && this.store.packed() !== null;
    if (playing) {
      if (this.lastTimestamp !== null) {
        const dt = Math.min(0.1, (timestamp - this.lastTimestamp) / 1000); // clamp after tab switches
        this.t += (dt * TWO_PI * this.store.speed()) / BASE_PERIOD_SECONDS;
        if (this.t >= TWO_PI) this.t -= TWO_PI * Math.floor(this.t / TWO_PI);
      }
      this.lastTimestamp = timestamp;
    } else {
      this.lastTimestamp = null;
    }
    this.render();
    this.updateProgress();
    this.dirty = false;
    if (playing) {
      this.frameId = requestAnimationFrame((ts) => this.frame(ts));
    }
  }

  private updateProgress(): void {
    const fraction = this.t / TWO_PI;
    this.progressFillRef().nativeElement.style.transform = `scaleX(${fraction})`;
    this.progressTextRef().nativeElement.textContent = `t = ${this.t.toFixed(2)} rad · ${(fraction * 100).toFixed(0)}%`;
    this.progressBarRef().nativeElement.setAttribute('aria-valuenow', (fraction * 100).toFixed(0));
  }

  /* ---------------- coordinate mapping ---------------- */
  /** Pixels per normalised unit; the curve's farthest sample lies on |z| = 1. */
  private get unit(): number {
    return 0.4 * Math.min(this.cssWidth, this.cssHeight);
  }
  private sx(re: number): number {
    return this.cssWidth / 2 + re * this.unit;
  }
  private sy(im: number): number {
    return this.cssHeight / 2 - im * this.unit;
  }

  /* ---------------- rendering ---------------- */
  private render(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    this.drawGrid(ctx);

    if (this.drawing.active()) {
      this.drawDraft(ctx);
      return;
    }

    const layers = this.store.layers();
    const samples = this.store.samples();
    const dense = this.store.denseCurve();
    const packed = this.store.packed();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (layers.original && samples) {
      ctx.beginPath();
      for (let j = 0; j < samples.sampleCount; j++) {
        const x = this.sx(samples.re[j]);
        const y = this.sy(samples.im[j]);
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = COLORS.original;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (layers.reconstruction && dense) {
      ctx.beginPath();
      for (let r = 0; r < dense.count; r++) {
        const x = this.sx(dense.re[r]);
        const y = this.sy(dense.im[r]);
        if (r === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = COLORS.reconstruction;
      ctx.lineWidth = layers.trail ? 1.25 : 2;
      ctx.globalAlpha = layers.trail ? 0.55 : 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (!packed || !dense) return;

    // Epicycle chain at the current t (allocation-free).
    const needed = 2 * (packed.count + 1);
    if (this.joints.length < needed) this.joints = new Float64Array(needed);
    const joints = computeEpicycleJoints(packed, this.t, this.joints);
    const endX = joints[2 * packed.count];
    const endY = joints[2 * packed.count + 1];

    if (layers.trail) {
      const upto = Math.min(dense.count - 1, Math.floor((this.t / TWO_PI) * dense.count));
      ctx.beginPath();
      ctx.moveTo(this.sx(dense.re[0]), this.sy(dense.im[0]));
      for (let r = 1; r <= upto; r++) ctx.lineTo(this.sx(dense.re[r]), this.sy(dense.im[r]));
      ctx.lineTo(this.sx(endX), this.sy(endY));
      ctx.strokeStyle = COLORS.trail;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    const unit = this.unit;
    if (layers.epicycles) {
      ctx.strokeStyle = COLORS.circle;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < packed.count; i++) {
        const radius = packed.magnitude[i] * unit;
        if (radius < 0.75 || packed.k[i] === 0) continue; // sub-pixel circles and the stationary DC term
        const cx = this.sx(joints[2 * i]);
        const cy = this.sy(joints[2 * i + 1]);
        ctx.moveTo(cx + radius, cy);
        ctx.arc(cx, cy, radius, 0, TWO_PI);
      }
      ctx.stroke();
    }

    if (layers.vectors) {
      ctx.strokeStyle = COLORS.vector;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      for (let i = 0; i < packed.count; i++) {
        const x0 = this.sx(joints[2 * i]);
        const y0 = this.sy(joints[2 * i + 1]);
        const x1 = this.sx(joints[2 * i + 2]);
        const y1 = this.sy(joints[2 * i + 3]);
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        const len = Math.hypot(x1 - x0, y1 - y0);
        if (len > 6) {
          // Arrow head
          const ang = Math.atan2(y1 - y0, x1 - x0);
          const head = Math.min(7, len * 0.3);
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 - head * Math.cos(ang - 0.45), y1 - head * Math.sin(ang - 0.45));
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 - head * Math.cos(ang + 0.45), y1 - head * Math.sin(ang + 0.45));
        }
      }
      ctx.stroke();
      ctx.fillStyle = COLORS.vector;
      ctx.beginPath();
      ctx.arc(this.sx(0), this.sy(0), 2.5, 0, TWO_PI);
      ctx.fill();
    }

    if (layers.endpoint) {
      ctx.fillStyle = COLORS.endpoint;
      ctx.beginPath();
      ctx.arc(this.sx(endX), this.sy(endY), 4.5, 0, TWO_PI);
      ctx.fill();
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.35)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(this.sx(endX), this.sy(endY), 8, 0, TWO_PI);
      ctx.stroke();
    }
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const unit = this.unit;
    const step = unit / 4;
    const cx = this.cssWidth / 2;
    const cy = this.cssHeight / 2;
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLORS.grid;
    ctx.beginPath();
    for (let x = cx % step; x < this.cssWidth; x += step) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, this.cssHeight);
    }
    for (let y = cy % step; y < this.cssHeight; y += step) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(this.cssWidth, Math.round(y) + 0.5);
    }
    ctx.stroke();
    if (!this.drawing.active()) {
      ctx.strokeStyle = COLORS.axis;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(cy) + 0.5);
      ctx.lineTo(this.cssWidth, Math.round(cy) + 0.5);
      ctx.moveTo(Math.round(cx) + 0.5, 0);
      ctx.lineTo(Math.round(cx) + 0.5, this.cssHeight);
      ctx.stroke();
      ctx.setLineDash([2, 6]);
      ctx.beginPath();
      ctx.arc(cx, cy, unit, 0, TWO_PI);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawDraft(ctx: CanvasRenderingContext2D): void {
    const strokes = this.drawing.strokes();
    const pts = this.drawing.points();
    if (pts.length === 0) return;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = COLORS.draft;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    let first = true;
    for (const stroke of strokes) {
      for (const p of stroke) {
        if (first) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y); // consecutive strokes are joined
        first = false;
      }
    }
    ctx.stroke();

    const start = pts[0];
    const end = pts[pts.length - 1];
    const snap = this.drawing.snapDistance();
    const withinSnap = this.drawing.closureGap() <= snap;
    ctx.strokeStyle = COLORS.snap;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(start.x, start.y, snap, 0, TWO_PI);
    ctx.stroke();
    if (pts.length > 1) {
      ctx.strokeStyle = withinSnap ? COLORS.snap : COLORS.gap;
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(start.x, start.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.snap;
    ctx.beginPath();
    ctx.arc(start.x, start.y, 5, 0, TWO_PI);
    ctx.fill();
  }

  /* ---------------- pointer input (drawing mode) ---------------- */
  private toLocal(ev: PointerEvent): { x: number; y: number } {
    const rect = this.canvasRef().nativeElement.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  protected onPointerDown(ev: PointerEvent): void {
    if (!this.drawing.active() || this.pointerId !== null) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    ev.preventDefault();
    this.pointerId = ev.pointerId;
    this.canvasRef().nativeElement.setPointerCapture(ev.pointerId);
    this.drawing.beginStroke(this.toLocal(ev));
  }

  protected onPointerMove(ev: PointerEvent): void {
    if (ev.pointerId !== this.pointerId) return;
    ev.preventDefault();
    // Use coalesced events for smoother, more faithful strokes.
    const events = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
    for (const e of events.length ? events : [ev]) this.drawing.extendStroke(this.toLocal(e));
  }

  protected onPointerUp(ev: PointerEvent): void {
    if (ev.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.drawing.endStroke();
  }

  protected onKeydown(ev: KeyboardEvent): void {
    if (this.drawing.active()) return;
    if (ev.key === ' ' || ev.key === 'Enter') {
      ev.preventDefault();
      this.store.togglePlaying();
    } else if (ev.key === 'r' || ev.key === 'R') {
      this.store.restart();
    }
  }
}
