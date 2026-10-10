import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { LayerVisibility, StudioStore } from '../../core/state/studio-store';
import { MAX_SAMPLE_COUNT, MIN_SAMPLE_COUNT } from '../../core/math/curve-preprocessing';
import { isPowerOfTwo } from '../../core/math/fourier-transform';
import { SelectionMode } from '../../core/models/fourier-coefficient.model';

interface LayerOption {
  readonly key: keyof LayerVisibility;
  readonly label: string;
  readonly hint: string;
}

/** Fourier controls: N, selection mode, M, animation and layer toggles. */
@Component({
  selector: 'app-fourier-controls',
  imports: [ReactiveFormsModule],
  templateUrl: './fourier-controls.component.html',
  styleUrl: './fourier-controls.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel' },
})
export class FourierControlsComponent {
  protected readonly store = inject(StudioStore);
  protected readonly MIN_M = MIN_SAMPLE_COUNT;
  protected readonly MAX_M = MAX_SAMPLE_COUNT;
  protected readonly isPowerOfTwo = isPowerOfTwo;

  /** N: typed control shared by the slider and the numeric input. */
  protected readonly nControl = new FormControl<number>(this.store.componentCount(), {
    nonNullable: true,
    validators: [Validators.required, Validators.min(1), Validators.pattern(/^\d+$/)],
  });

  /** M: applied on blur / Enter because it triggers a new DFT. */
  protected readonly mControl = new FormControl<number>(this.store.sampleCount(), {
    nonNullable: true,
    updateOn: 'blur',
    validators: [
      Validators.required,
      Validators.min(MIN_SAMPLE_COUNT),
      Validators.max(MAX_SAMPLE_COUNT),
      Validators.pattern(/^\d+$/),
    ],
  });

  protected readonly modeControl = new FormControl<SelectionMode>(this.store.selectionMode(), { nonNullable: true });

  protected readonly layerOptions: readonly LayerOption[] = [
    { key: 'original', label: 'Original curve', hint: 'The resampled input curve (dashed).' },
    { key: 'reconstruction', label: 'Reconstructed curve', hint: 'The full truncated series z_N(t) for t ∈ [0, 2π).' },
    { key: 'epicycles', label: 'Epicycles', hint: 'Circles of radius |c_k| centred at the tail of each vector.' },
    { key: 'vectors', label: 'Coefficient vectors', hint: 'Rotating vectors c_k·exp(ikt), drawn head-to-tail.' },
    { key: 'trail', label: 'Traced trajectory', hint: 'The part of the reconstruction traced so far this period.' },
    { key: 'endpoint', label: 'Endpoint', hint: 'The current value z_N(t) — the sum of all vectors.' },
  ];

  protected readonly speedOptions = [0.25, 0.5, 1, 2, 4];

  constructor() {
    this.nControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      if (v === null || !Number.isFinite(Number(v))) return; // empty / partial input: wait
      // Out-of-range values are clamped to [1, M] rather than rejected.
      this.store.setComponentCount(Number(v));
      // Write back to *both* bound elements (slider + number field): a value that
      // originates from one view element is not propagated to the other one.
      this.nControl.setValue(this.store.componentCount(), { emitEvent: false });
    });
    this.mControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      if (this.mControl.valid) this.store.sampleCount.set(Number(v));
    });
    this.modeControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => this.store.selectionMode.set(v));

    // Store → controls (e.g. N clamped after M changed, reset to defaults).
    effect(() => {
      const n = this.store.componentCount();
      const max = this.store.maxComponentCount();
      this.nControl.setValidators([
        Validators.required,
        Validators.min(1),
        Validators.max(max),
        Validators.pattern(/^\d+$/),
      ]);
      if (this.nControl.value !== n) this.nControl.setValue(n, { emitEvent: false });
      this.nControl.updateValueAndValidity({ emitEvent: false });
    });
    effect(() => {
      const m = this.store.sampleCount();
      if (this.mControl.value !== m) this.mControl.setValue(m, { emitEvent: false });
    });
    effect(() => {
      const mode = this.store.selectionMode();
      if (this.modeControl.value !== mode) this.modeControl.setValue(mode, { emitEvent: false });
    });
    effect(() => {
      const enabled = this.store.hasValidCurve();
      for (const c of [this.nControl, this.modeControl]) {
        if (enabled && c.disabled) c.enable({ emitEvent: false });
        if (!enabled && c.enabled) c.disable({ emitEvent: false });
      }
    });
  }

  protected step(delta: number): void {
    this.store.setComponentCount(this.store.componentCount() + delta);
  }

  protected onLayerChange(key: keyof LayerVisibility, ev: Event): void {
    this.store.setLayer(key, (ev.target as HTMLInputElement).checked);
  }

  protected onSpeedInput(ev: Event): void {
    const v = Number((ev.target as HTMLInputElement).value);
    if (Number.isFinite(v) && v > 0) this.store.speed.set(v);
  }

  protected commitM(ev: Event): void {
    (ev.target as HTMLInputElement).blur();
  }
}
