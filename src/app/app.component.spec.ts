import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { StudioStore } from './core/state/studio-store';
import { computeSpectrum } from './core/math/fourier-transform';
import { formatFixed } from './shared/format';

/** jsdom has no layout/canvas; provide minimal stubs so components can mount. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('AppComponent (integration)', () => {
  beforeEach(async () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
    HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
    await TestBed.configureTestingModule({ imports: [AppComponent] }).compileComponents();
  });

  it('wires the example curve through preprocessing, DFT and the inspector table', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    const store = TestBed.inject(StudioStore);
    const el = fixture.nativeElement as HTMLElement;

    expect(store.hasValidCurve()).toBe(true);
    const rows = el.querySelectorAll('app-coefficient-inspector tbody tr');
    expect(rows.length).toBe(store.componentCount());

    // The first displayed row (largest magnitude) matches an independent transform of the samples.
    const samples = store.samples()!;
    const independent = computeSpectrum(samples.re, samples.im);
    const largest = [...independent.coefficients].sort((a, b) => b.magnitude - a.magnitude)[0];
    const cells = rows[0].querySelectorAll('td');
    expect(cells[1].textContent?.trim()).toBe(largest.k > 0 ? `+${largest.k}` : `${largest.k}`);
    expect(cells[4].textContent?.trim()).toBe(formatFixed(largest.magnitude, store.precision()));
  });

  it('clamps N to the number of available coefficients and keeps the curve when settings change', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    const store = TestBed.inject(StudioStore);
    const curve = store.rawCurve();

    store.setComponentCount(1e6);
    expect(store.componentCount()).toBe(store.sampleCount());
    store.sampleCount.set(64);
    expect(store.componentCount()).toBe(64);
    expect(store.metrics()!.rmse).toBeLessThan(1e-12); // all bins retained
    store.selectionMode.set('contiguous');
    store.resetToDefaults();
    expect(store.rawCurve()).toBe(curve);
    expect(store.sampleCount()).toBe(512);
  });
});
