import { computed, Injectable, signal } from '@angular/core';
import { RawCurve } from '../models/curve-sample.model';
import { CoefficientSelection, ReconstructionMetrics, SelectionMode } from '../models/fourier-coefficient.model';
import { DEFAULT_SAMPLE_COUNT, preprocessCurve } from '../math/curve-preprocessing';
import { computeSpectrum, synthesizeOnSampleGrid } from '../math/fourier-transform';
import {
  clampComponentCount,
  isRealValuedSignal,
  packCoefficients,
  PackedCoefficients,
  selectCoefficients,
  synthesizeDenseCurve,
} from '../math/fourier-reconstruction';
import { computeReconstructionMetrics } from '../math/curve-error';
import { EXAMPLE_CURVES } from '../examples/example-curves';

/** Independently toggleable canvas layers. */
export interface LayerVisibility {
  readonly original: boolean;
  readonly reconstruction: boolean;
  readonly epicycles: boolean;
  readonly vectors: boolean;
  readonly trail: boolean;
  readonly endpoint: boolean;
}

export type PhaseUnit = 'rad' | 'deg';

export const DEFAULT_COMPONENT_COUNT = 24;
export const DEFAULT_LAYERS: LayerVisibility = {
  original: true,
  reconstruction: true,
  epicycles: true,
  vectors: true,
  trail: true,
  endpoint: true,
};
export const DEFAULT_SPEED = 1;
export const DEFAULT_PRECISION = 6;

/**
 * Application state. All heavy work is expressed as memoised `computed`
 * signals, so each stage re-runs only when its own inputs change:
 *
 *   raw curve, M ─▶ preprocessing ─▶ spectrum (DFT/FFT, cached)
 *   spectrum, N, mode ─▶ selection ─▶ reconstruction, epicycle data, metrics
 *
 * Changing N, the selection mode or any display option never re-runs the DFT.
 */
@Injectable({ providedIn: 'root' })
export class StudioStore {
  /* ---------------- inputs ---------------- */
  readonly rawCurve = signal<RawCurve | null>(null);
  readonly sampleCount = signal(DEFAULT_SAMPLE_COUNT);
  /** The N the user asked for; the effective N is clamped to [1, M]. */
  readonly requestedComponentCount = signal(DEFAULT_COMPONENT_COUNT);
  readonly selectionMode = signal<SelectionMode>('magnitude');
  readonly layers = signal<LayerVisibility>(DEFAULT_LAYERS);
  readonly precision = signal(DEFAULT_PRECISION);
  readonly phaseUnit = signal<PhaseUnit>('rad');

  /* ---------------- animation ---------------- */
  readonly playing = signal(true);
  readonly speed = signal(DEFAULT_SPEED);
  /** Incremented to ask the canvas to restart the animation at t = 0. */
  readonly restartToken = signal(0);

  private readonly history: RawCurve[] = [];
  readonly canUndoCurve = signal(false);

  /* ---------------- derived pipeline ---------------- */
  readonly preprocessResult = computed(() => {
    const raw = this.rawCurve();
    return raw ? preprocessCurve(raw.points, { sampleCount: this.sampleCount() }) : null;
  });

  readonly samples = computed(() => {
    const r = this.preprocessResult();
    return r?.ok ? r.samples : null;
  });

  /** The cached full spectrum (exactly M coefficients). */
  readonly spectrum = computed(() => {
    const s = this.samples();
    return s ? computeSpectrum(s.re, s.im) : null;
  });

  /** Real-valued input (curve on the real axis) → conjugate-symmetric selection. */
  readonly realValued = computed(() => {
    const s = this.samples();
    return s ? isRealValuedSignal(s.re, s.im) : false;
  });

  readonly maxComponentCount = computed(() => this.spectrum()?.sampleCount ?? 1);

  readonly componentCount = computed(() =>
    clampComponentCount(this.requestedComponentCount(), this.maxComponentCount()),
  );

  readonly selection = computed<CoefficientSelection | null>(() => {
    const spectrum = this.spectrum();
    if (!spectrum) return null;
    return selectCoefficients(spectrum, this.componentCount(), {
      mode: this.selectionMode(),
      conjugateSymmetric: this.realValued(),
    });
  });

  /** Retained coefficients packed for the allocation-free animation loop. */
  readonly packed = computed<PackedCoefficients | null>(() => {
    const sel = this.selection();
    return sel ? packCoefficients(sel.retained) : null;
  });

  /** Dense z_N(t) for drawing the reconstructed curve and the trail. */
  readonly denseCurve = computed(() => {
    const sel = this.selection();
    return sel ? synthesizeDenseCurve(sel.retained, 1024) : null;
  });

  /** ẑ_j on the same parameter grid t_j = 2πj/M as the input samples. */
  readonly gridReconstruction = computed(() => {
    const sel = this.selection();
    const s = this.samples();
    return sel && s ? synthesizeOnSampleGrid(sel.retained, s.sampleCount) : null;
  });

  readonly metrics = computed<ReconstructionMetrics | null>(() => {
    const s = this.samples();
    const rec = this.gridReconstruction();
    const spectrum = this.spectrum();
    const sel = this.selection();
    if (!s || !rec || !spectrum || !sel) return null;
    let retained = 0;
    for (const c of sel.retained) retained += c.magnitude * c.magnitude;
    return computeReconstructionMetrics(s, rec, { retained, total: spectrum.totalEnergy });
  });

  readonly hasValidCurve = computed(() => this.spectrum() !== null);

  constructor() {
    this.loadExample('heart');
  }

  /* ---------------- commands ---------------- */
  setCurve(curve: RawCurve): void {
    const current = this.rawCurve();
    if (current) {
      this.history.push(current);
      if (this.history.length > 20) this.history.shift();
    }
    this.canUndoCurve.set(this.history.length > 0);
    this.rawCurve.set(curve);
    this.restart();
  }

  undoCurve(): void {
    const previous = this.history.pop();
    if (previous) {
      this.rawCurve.set(previous);
      this.restart();
    }
    this.canUndoCurve.set(this.history.length > 0);
  }

  loadExample(id: string): void {
    const example = EXAMPLE_CURVES.find((e) => e.id === id);
    if (example) this.setCurve({ points: example.build(), source: 'example', label: example.name });
  }

  setComponentCount(n: number): void {
    if (Number.isFinite(n)) this.requestedComponentCount.set(clampComponentCount(n, this.maxComponentCount()));
  }

  setLayer(key: keyof LayerVisibility, visible: boolean): void {
    this.layers.update((l) => ({ ...l, [key]: visible }));
  }

  togglePlaying(): void {
    this.playing.update((p) => !p);
  }

  restart(): void {
    this.restartToken.update((v) => v + 1);
  }

  /** Restores every setting to its default; the current curve is kept. */
  resetToDefaults(): void {
    this.sampleCount.set(DEFAULT_SAMPLE_COUNT);
    this.requestedComponentCount.set(DEFAULT_COMPONENT_COUNT);
    this.selectionMode.set('magnitude');
    this.layers.set(DEFAULT_LAYERS);
    this.precision.set(DEFAULT_PRECISION);
    this.phaseUnit.set('rad');
    this.speed.set(DEFAULT_SPEED);
    this.playing.set(true);
    this.restart();
  }
}
