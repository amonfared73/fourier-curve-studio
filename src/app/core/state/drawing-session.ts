import { computed, inject, Injectable, signal } from '@angular/core';
import { Point2D } from '../models/curve-sample.model';
import { removeConsecutiveDuplicates } from '../math/curve-preprocessing';
import { StudioStore } from './studio-store';

/** Minimum stroke length (CSS px) before a drawing can be processed. */
export const MIN_DRAWING_LENGTH = 40;
export const MIN_DRAWING_POINTS = 8;

/**
 * Freehand drawing session (the draft before it becomes the input curve).
 *
 * Closure policy:
 *  - When a stroke ends within the snap distance of the starting point
 *    (max(18 px, 6 % of the drawn length)) the curve is closed automatically
 *    and committed.
 *  - Otherwise the draft stays open: the user may continue drawing (the new
 *    stroke is joined to the previous one), undo the last stroke, or press
 *    "Close curve" to add an explicit straight closing segment.
 */
@Injectable({ providedIn: 'root' })
export class DrawingSession {
  private readonly store = inject(StudioStore);

  /** True while the canvas is in drawing mode. */
  readonly active = signal(false);
  readonly strokes = signal<readonly (readonly Point2D[])[]>([]);
  readonly message = signal<string | null>(null);

  readonly points = computed(() => this.strokes().flat());

  readonly length = computed(() => {
    const pts = this.points();
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return len;
  });

  readonly distinctCount = computed(() => removeConsecutiveDuplicates(this.points(), 0.5).points.length);

  readonly closureGap = computed(() => {
    const pts = this.points();
    if (pts.length < 2) return 0;
    const a = pts[0];
    const b = pts[pts.length - 1];
    return Math.hypot(b.x - a.x, b.y - a.y);
  });

  readonly snapDistance = computed(() => Math.max(18, 0.06 * this.length()));

  readonly enoughPoints = computed(
    () => this.distinctCount() >= MIN_DRAWING_POINTS && this.length() >= MIN_DRAWING_LENGTH,
  );

  start(): void {
    this.active.set(true);
    this.message.set(null);
  }

  cancel(): void {
    this.active.set(false);
    this.strokes.set([]);
    this.message.set(null);
  }

  beginStroke(p: Point2D): void {
    this.strokes.update((s) => [...s, [p]]);
  }

  extendStroke(p: Point2D): void {
    const s = this.strokes();
    if (s.length === 0) return;
    const last = s[s.length - 1] as Point2D[];
    const prev = last[last.length - 1];
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 1) return; // ignore sub-pixel jitter
    // Append in place (O(1)) and publish a new outer array so dependants update.
    last.push(p);
    this.strokes.set([...s]);
  }

  /** Called on pointer-up; applies the automatic closure policy. */
  endStroke(): void {
    if (!this.enoughPoints()) {
      this.message.set('Keep drawing — the curve is still too short to process.');
      return;
    }
    if (this.closureGap() <= this.snapDistance()) {
      this.commit('Closed automatically (end point snapped to start).');
    } else {
      this.message.set(
        `The curve is open (gap ${this.closureGap().toFixed(0)} px). Continue the stroke back to the start, or press “Close curve” to add a straight closing segment.`,
      );
    }
  }

  /** Explicit closure: a straight segment from the last point to the first. */
  closeExplicitly(): void {
    if (!this.enoughPoints()) {
      this.message.set('Not enough points yet: draw a longer curve first.');
      return;
    }
    this.commit('Closed with an explicit straight segment.');
  }

  undo(): void {
    if (this.strokes().length > 0) {
      this.strokes.update((s) => s.slice(0, -1));
      this.message.set(null);
    } else {
      this.store.undoCurve();
    }
  }

  clear(): void {
    this.strokes.set([]);
    this.message.set(null);
  }

  private commit(note: string): void {
    this.store.setCurve({ points: this.points(), source: 'drawing', label: 'Freehand drawing' });
    this.strokes.set([]);
    this.active.set(false);
    this.message.set(note);
  }
}
