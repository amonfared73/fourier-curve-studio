import {
  binForFrequency,
  computeSpectrum,
  dftDirect,
  fftInPlace,
  signedFrequency,
  synthesizeOnSampleGrid,
} from './fourier-transform';
import {
  computeEpicycleJoints,
  evaluateSeries,
  isRealValuedSignal,
  packCoefficients,
  selectCoefficients,
  synthesizeDenseCurve,
} from './fourier-reconstruction';
import { preprocessCurve } from './curve-preprocessing';
import { computeReconstructionMetrics } from './curve-error';
import { FourierSpectrum } from '../models/fourier-coefficient.model';
import { Point2D } from '../models/curve-sample.model';

/** Samples z(t) at t_j = 2πj/M. */
function sample(m: number, f: (t: number) => [number, number]): { re: Float64Array; im: Float64Array } {
  const re = new Float64Array(m);
  const im = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    const [x, y] = f((2 * Math.PI * j) / m);
    re[j] = x;
    im[j] = y;
  }
  return { re, im };
}

/** Spreads sampled data into computeSpectrum(re, im) arguments. */
function pair(z: { re: Float64Array; im: Float64Array }): [Float64Array, Float64Array] {
  return [z.re, z.im];
}

function coeff(spectrum: FourierSpectrum, k: number) {
  return spectrum.coefficients[binForFrequency(k, spectrum.sampleCount)];
}

function maxDiff(a: { re: Float64Array; im: Float64Array }, b: { re: Float64Array; im: Float64Array }): number {
  let d = 0;
  for (let j = 0; j < a.re.length; j++) d = Math.max(d, Math.hypot(a.re[j] - b.re[j], a.im[j] - b.im[j]));
  return d;
}

/** Asserts that only the listed frequencies carry energy, with the given values. */
function expectSpectrum(spectrum: FourierSpectrum, expected: Map<number, [number, number]>, tol = 1e-12): void {
  for (const c of spectrum.coefficients) {
    const [er, ei] = expected.get(c.k) ?? [0, 0];
    expect(Math.abs(c.re - er)).toBeLessThan(tol);
    expect(Math.abs(c.im - ei)).toBeLessThan(tol);
  }
}

function deterministicRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A smooth, non-symmetric closed curve. */
const asymmetric = (t: number): [number, number] => [
  Math.cos(t) + 0.35 * Math.cos(2 * t + 0.4) - 0.2 * Math.sin(5 * t),
  0.8 * Math.sin(t) + 0.25 * Math.sin(3 * t - 1) + 0.1 * Math.cos(4 * t),
];

describe('frequency indexing', () => {
  it('maps bins to signed frequencies for even M (Nyquist → −M/2)', () => {
    expect(Array.from({ length: 8 }, (_, b) => signedFrequency(b, 8))).toEqual([0, 1, 2, 3, -4, -3, -2, -1]);
  });
  it('maps bins to signed frequencies for odd M (no Nyquist bin)', () => {
    expect(Array.from({ length: 7 }, (_, b) => signedFrequency(b, 7))).toEqual([0, 1, 2, 3, -3, -2, -1]);
  });
  it('round-trips bin ↔ frequency', () => {
    for (const m of [7, 8, 64, 100]) {
      for (let b = 0; b < m; b++) expect(binForFrequency(signedFrequency(b, m), m)).toBe(b);
    }
  });
  it('places a negative frequency in the correct bin', () => {
    const s = computeSpectrum(...pair(sample(16, (t) => [Math.cos(-3 * t), Math.sin(-3 * t)])));
    expectSpectrum(s, new Map([[-3, [1, 0]]]));
    expect(coeff(s, -3).bin).toBe(13);
  });
  it('treats the Nyquist frequency of an even M consistently', () => {
    // (−1)^j = exp(i·(M/2)·t_j) = exp(−i·(M/2)·t_j) on the sample grid.
    const m = 8;
    const z = sample(m, (t) => [Math.cos((m / 2) * t), 0]);
    const s = computeSpectrum(z.re, z.im);
    expectSpectrum(s, new Map([[-4, [1, 0]]]));
    const back = synthesizeOnSampleGrid(s.coefficients, m);
    expect(maxDiff(back, z)).toBeLessThan(1e-14);
    // Evaluating the series at the sample points agrees with the inverse DFT.
    for (let j = 0; j < m; j++) {
      const v = evaluateSeries(s.coefficients, (2 * Math.PI * j) / m);
      expect(Math.abs(v.re - z.re[j])).toBeLessThan(1e-12);
    }
  });
});

describe('DFT / FFT conventions', () => {
  it('forward then inverse FFT reproduces the input (with 1/M)', () => {
    const rnd = deterministicRandom(1);
    const re = Float64Array.from({ length: 64 }, rnd);
    const im = Float64Array.from({ length: 64 }, rnd);
    const r = Float64Array.from(re);
    const i = Float64Array.from(im);
    fftInPlace(r, i, false);
    fftInPlace(r, i, true);
    for (let j = 0; j < 64; j++) {
      expect(r[j] / 64).toBeCloseTo(re[j], 13);
      expect(i[j] / 64).toBeCloseTo(im[j], 13);
    }
  });

  it('radix-2 FFT agrees with the direct DFT', () => {
    const rnd = deterministicRandom(2);
    const re = Float64Array.from({ length: 256 }, rnd);
    const im = Float64Array.from({ length: 256 }, rnd);
    const direct = dftDirect(re, im, false);
    const r = Float64Array.from(re);
    const i = Float64Array.from(im);
    fftInPlace(r, i, false);
    expect(maxDiff({ re: r, im: i }, direct)).toBeLessThan(1e-11);
  });

  it('matches the defining formula c_k = (1/M) Σ z_j exp(−i2πkj/M)', () => {
    const m = 12; // not a power of two → direct DFT path
    const z = sample(m, asymmetric);
    const s = computeSpectrum(z.re, z.im);
    expect(s.algorithm).toBe('dft-direct');
    for (const c of s.coefficients) {
      let sr = 0;
      let si = 0;
      for (let j = 0; j < m; j++) {
        const a = (-2 * Math.PI * c.k * j) / m;
        sr += z.re[j] * Math.cos(a) - z.im[j] * Math.sin(a);
        si += z.re[j] * Math.sin(a) + z.im[j] * Math.cos(a);
      }
      expect(c.re).toBeCloseTo(sr / m, 13);
      expect(c.im).toBeCloseTo(si / m, 13);
      expect(c.magnitude).toBeCloseTo(Math.hypot(sr / m, si / m), 13);
      expect(c.phase).toBeCloseTo(Math.atan2(c.im, c.re), 15);
    }
  });

  it('satisfies Parseval: Σ|c_k|² = (1/M) Σ|z_j|²', () => {
    const z = sample(128, asymmetric);
    const s = computeSpectrum(z.re, z.im);
    let e = 0;
    for (let j = 0; j < 128; j++) e += z.re[j] ** 2 + z.im[j] ** 2;
    expect(s.totalEnergy).toBeCloseTo(e / 128, 13);
  });
});

describe('required curve cases', () => {
  it('1. unit circle z(t) = exp(it) has c₁ = 1 and nothing else', () => {
    const s = computeSpectrum(...(pair(sample(64, (t) => [Math.cos(t), Math.sin(t)]))));
    expectSpectrum(s, new Map([[1, [1, 0]]]));
    expect(coeff(s, 1).magnitude).toBeCloseTo(1, 14);
    expect(coeff(s, 1).phase).toBeCloseTo(0, 14);
  });

  it('1b. preprocessing a drawn circle gives |c₁| ≈ 1 (normalised) and c₀ ≈ 0 (centred)', () => {
    const pts: Point2D[] = Array.from({ length: 720 }, (_, i) => {
      const a = (2 * Math.PI * i) / 720;
      return { x: 300 + 50 * Math.cos(a), y: 200 - 50 * Math.sin(a) };
    });
    const r = preprocessCurve(pts, { sampleCount: 256 });
    if (!r.ok) throw new Error(r.error);
    const s = computeSpectrum(r.samples.re, r.samples.im);
    expect(coeff(s, 1).magnitude).toBeGreaterThan(0.9999);
    expect(coeff(s, 0).magnitude).toBeLessThan(1e-12);
    expect(r.samples.transform.centroid.x).toBeCloseTo(300, 6);
    expect(r.samples.transform.centroid.y).toBeCloseTo(200, 6);
  });

  it('2. translated circle: c₀ = centre, c₁ = radius·exp(iφ)', () => {
    const cx = 3, cy = -2, r = 1.5, phi = 0.7;
    const s = computeSpectrum(
      ...(pair(sample(32, (t) => [cx + r * Math.cos(t + phi), cy + r * Math.sin(t + phi)]))),
    );
    expectSpectrum(s, new Map([[0, [cx, cy]], [1, [r * Math.cos(phi), r * Math.sin(phi)]]]));
  });

  it('3. ellipse a·cos t + i·b·sin t = ((a+b)/2)e^{it} + ((a−b)/2)e^{−it}', () => {
    const a = 3, b = 1;
    const s = computeSpectrum(...(pair(sample(64, (t) => [a * Math.cos(t), b * Math.sin(t)]))));
    expectSpectrum(s, new Map([[1, [(a + b) / 2, 0]], [-1, [(a - b) / 2, 0]]]));
    // The general complex curve is NOT conjugate-symmetric.
    expect(coeff(s, 1).re).not.toBeCloseTo(coeff(s, -1).re, 3);
  });

  it('4. square polygon: only k ≡ 1 (mod 4) are non-zero, full reconstruction exact', () => {
    // Counter-clockwise once y is flipped to point up.
    const square: Point2D[] = [{ x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }, { x: -1, y: 1 }];
    const r = preprocessCurve(square, { sampleCount: 64 });
    if (!r.ok) throw new Error(r.error);
    expect(r.samples.perimeter).toBeCloseTo(8, 12);
    const s = computeSpectrum(r.samples.re, r.samples.im);
    for (const c of s.coefficients) {
      if (((c.k % 4) + 4) % 4 !== 1) expect(c.magnitude).toBeLessThan(1e-12);
    }
    expect(coeff(s, 1).magnitude).toBeGreaterThan(0.5);
    expect(coeff(s, -3).magnitude).toBeGreaterThan(0.01);
    const back = synthesizeOnSampleGrid(s.coefficients, 64);
    expect(maxDiff(back, r.samples)).toBeLessThan(1e-13);
  });

  it('5. non-symmetric curve: recovers its harmonics and has no conjugate symmetry', () => {
    const z = sample(64, asymmetric);
    const s = computeSpectrum(z.re, z.im);
    // Σ c_k e^{ikt}: cos(nt) = (e^{int}+e^{−int})/2, sin(nt) = (e^{int}−e^{−int})/(2i), combined for x + i·y.
    const expectedEnergyBins = [1, -1, 2, -2, 3, -3, 4, -4, 5, -5];
    for (const c of s.coefficients) {
      if (!expectedEnergyBins.includes(c.k)) expect(c.magnitude).toBeLessThan(1e-12);
    }
    expect(isRealValuedSignal(z.re, z.im)).toBe(false);
    // Conjugate symmetry would require c_{−k} = conj(c_k); here c₁ = 0.9 and c₋₁ = 0.1.
    const c1 = coeff(s, 1), cm1 = coeff(s, -1);
    expect(Math.abs(c1.re - cm1.re) + Math.abs(c1.im + cm1.im)).toBeGreaterThan(0.5);
  });

  it('6. consecutive duplicate points are removed and do not change the result', () => {
    const base: Point2D[] = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 1, y: 5 }];
    const dup: Point2D[] = [base[0], base[0], base[1], base[1], base[1], base[2], base[3], base[3], base[0]];
    const a = preprocessCurve(base, { sampleCount: 64 });
    const b = preprocessCurve(dup, { sampleCount: 64 });
    if (!a.ok || !b.ok) throw new Error('preprocessing failed');
    expect(b.samples.removedPointCount).toBe(5);
    expect(b.samples.distinctPointCount).toBe(4);
    expect(maxDiff(a.samples, b.samples)).toBeLessThan(1e-14);
  });

  it('7. too few distinct points are rejected; three are accepted', () => {
    expect(preprocessCurve([], { sampleCount: 64 }).ok).toBe(false);
    expect(preprocessCurve([{ x: 1, y: 1 }, { x: 1, y: 1 }], { sampleCount: 64 }).ok).toBe(false);
    const two = preprocessCurve([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }], { sampleCount: 64 });
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.error).toContain('2 distinct');
    expect(preprocessCurve([{ x: NaN, y: 0 }, { x: Infinity, y: 1 }], { sampleCount: 64 }).ok).toBe(false);
    const tri = preprocessCurve([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], { sampleCount: 64 });
    expect(tri.ok).toBe(true);
    if (tri.ok) expect(tri.warnings.length).toBeGreaterThan(0);
  });

  it('8. large sample counts: M = 4096 (FFT) and M = 3000 (direct DFT) round-trip', () => {
    for (const m of [4096, 3000]) {
      const z = sample(m, asymmetric);
      const s = computeSpectrum(z.re, z.im);
      expect(s.algorithm).toBe(m === 4096 ? 'fft-radix2' : 'dft-direct');
      expect(maxDiff(synthesizeOnSampleGrid(s.coefficients, m), z)).toBeLessThan(1e-11);
      expect(coeff(s, -5).magnitude).toBeCloseTo(0.1, 12); // −0.2·sin 5t → |c₋₅| = 0.1
    }
  });

  it('9. reconstruction with all M bins reproduces the samples (even and odd M)', () => {
    const rnd = deterministicRandom(9);
    for (const m of [64, 63, 100]) {
      const pts: Point2D[] = Array.from({ length: 40 }, (_, i) => {
        const a = (2 * Math.PI * i) / 40;
        const r = 1 + 0.4 * rnd();
        return { x: r * Math.cos(a), y: r * Math.sin(a) };
      });
      const pre = preprocessCurve(pts, { sampleCount: m });
      if (!pre.ok) throw new Error(pre.error);
      const s = computeSpectrum(pre.samples.re, pre.samples.im);
      for (const mode of ['magnitude', 'contiguous'] as const) {
        const sel = selectCoefficients(s, m, { mode });
        expect(sel.retained.length).toBe(m);
        const rec = synthesizeOnSampleGrid(sel.retained, m);
        expect(maxDiff(rec, pre.samples)).toBeLessThan(1e-13);
        const metrics = computeReconstructionMetrics(pre.samples, rec, { retained: s.totalEnergy, total: s.totalEnergy });
        expect(metrics.rmse).toBeLessThan(1e-13);
        // The analytic series evaluated at t_j agrees too.
        const j = 7;
        const v = evaluateSeries(sel.retained, (2 * Math.PI * j) / m);
        expect(Math.hypot(v.re - pre.samples.re[j], v.im - pre.samples.im[j])).toBeLessThan(1e-12);
      }
    }
  });

  it('10. a single retained coefficient reconstructs a circle', () => {
    const z = sample(64, (t) => [2 * Math.cos(t) + 0.3 * Math.cos(3 * t), 2 * Math.sin(t) - 0.3 * Math.sin(3 * t)]);
    const s = computeSpectrum(z.re, z.im);
    const sel = selectCoefficients(s, 1, { mode: 'magnitude' });
    expect(sel.retained.length).toBe(1);
    expect(sel.retained[0].k).toBe(1);
    const rec = synthesizeOnSampleGrid(sel.retained, 64);
    for (let j = 0; j < 64; j++) expect(Math.hypot(rec.re[j], rec.im[j])).toBeCloseTo(2, 13);
    const metrics = computeReconstructionMetrics(z, rec, { retained: 4, total: s.totalEnergy });
    expect(metrics.mse).toBeCloseTo(0.3 ** 2, 13); // exactly the excluded energy
    expect(metrics.maxError).toBeCloseTo(0.3, 13);
  });
});

describe('frequency selection', () => {
  const z = sample(32, asymmetric);
  const s = computeSpectrum(z.re, z.im);

  it('magnitude mode keeps the N largest |c_k| in non-increasing order', () => {
    const sel = selectCoefficients(s, 5, { mode: 'magnitude' });
    const kept = [...sel.retained].sort((a, b) => sel.rankByBin[a.bin] - sel.rankByBin[b.bin]);
    for (let i = 1; i < kept.length; i++) expect(kept[i - 1].magnitude).toBeGreaterThanOrEqual(kept[i].magnitude - 1e-12);
    const minKept = Math.min(...kept.map((c) => c.magnitude));
    const maxExcluded = Math.max(...s.coefficients.filter((c) => !sel.retainedBins.has(c.bin)).map((c) => c.magnitude));
    expect(minKept).toBeGreaterThanOrEqual(maxExcluded - 1e-12);
  });

  it('breaks ties deterministically: smaller |k|, then positive k', () => {
    // Equal-magnitude terms at k = +2, −2, +1 (and −1 slightly larger).
    const t = sample(16, (t) => [
      Math.cos(2 * t) + Math.cos(-2 * t) + Math.cos(t) + 1.5 * Math.cos(-t),
      Math.sin(2 * t) + Math.sin(-2 * t) + Math.sin(t) + 1.5 * Math.sin(-t),
    ]);
    const ts = computeSpectrum(t.re, t.im);
    const sel = selectCoefficients(ts, 4, { mode: 'magnitude' });
    const order = [...sel.retained].sort((a, b) => sel.rankByBin[a.bin] - sel.rankByBin[b.bin]).map((c) => c.k);
    expect(order).toEqual([-1, 1, 2, -2]);
    // Same input → same result.
    expect(selectCoefficients(ts, 4, { mode: 'magnitude' }).retained.map((c) => c.k)).toEqual(sel.retained.map((c) => c.k));
  });

  it('contiguous mode keeps 0, +1, −1, +2, −2, …', () => {
    const ks = (n: number) => selectCoefficients(s, n, { mode: 'contiguous' }).retained.map((c) => c.k).sort((a, b) => a - b);
    expect(ks(1)).toEqual([0]);
    expect(ks(4)).toEqual([-1, 0, 1, 2]);
    expect(ks(5)).toEqual([-2, -1, 0, 1, 2]);
    expect(ks(32)).toContain(-16); // Nyquist bin of M = 32 is the last one added
    expect(ks(31)).not.toContain(-16);
  });

  it('never selects more than M components and at least one', () => {
    expect(selectCoefficients(s, 1000, { mode: 'magnitude' }).retained.length).toBe(32);
    expect(selectCoefficients(s, 0, { mode: 'magnitude' }).retained.length).toBe(1);
    expect(selectCoefficients(s, NaN, { mode: 'contiguous' }).retained.length).toBe(1);
  });

  it('orders retained terms for epicycles: k = 0 first, then by magnitude', () => {
    const sel = selectCoefficients(s, 10, { mode: 'contiguous' });
    expect(sel.retained[0].k).toBe(0);
    for (let i = 2; i < sel.retained.length; i++) {
      expect(sel.retained[i - 1].magnitude).toBeGreaterThanOrEqual(sel.retained[i].magnitude - 1e-15);
    }
  });

  it('real-valued signals: symmetric selection keeps ±k pairs → real reconstruction', () => {
    const real = sample(32, (t) => [Math.cos(t) + 0.5 * Math.sin(3 * t) + 0.2 * Math.cos(5 * t) + 0.1, 0]);
    expect(isRealValuedSignal(real.re, real.im)).toBe(true);
    const rs = computeSpectrum(real.re, real.im);
    for (const c of rs.coefficients) {
      const partner = coeff(rs, -c.k);
      expect(c.re).toBeCloseTo(partner.re, 13);
      expect(c.im).toBeCloseTo(-partner.im, 13);
    }
    for (const n of [2, 3, 4, 5, 7]) {
      const sel = selectCoefficients(rs, n, { mode: 'magnitude', conjugateSymmetric: true });
      expect(sel.retained.length).toBe(n);
      const nonZero = sel.retained.filter((c) => c.k !== 0);
      // every pair present (or the filler is the singleton k = 0 / Nyquist)
      for (const c of nonZero) {
        if (c.k !== -16) expect(sel.retainedBins.has(binForFrequency(-c.k, 32))).toBe(true);
      }
      for (const t of [0.1, 1.3, 4.0]) expect(Math.abs(evaluateSeries(sel.retained, t).im)).toBeLessThan(1e-12);
    }
    // Without symmetry, an odd count would split a pair and create an imaginary part.
    const asym = selectCoefficients(rs, 3, { mode: 'magnitude' }); // ±1 then only +3
    expect(Math.abs(evaluateSeries(asym.retained, 0.4).im)).toBeGreaterThan(1e-3);
  });
});

describe('epicycles and reconstruction agree', () => {
  const z = sample(128, asymmetric);
  const s = computeSpectrum(z.re, z.im);

  it('epicycle endpoint equals the series value for every t and N', () => {
    for (const n of [1, 3, 8, 128]) {
      const sel = selectCoefficients(s, n, { mode: 'magnitude' });
      const packed = packCoefficients(sel.retained);
      const out = new Float64Array(2 * (packed.count + 1));
      for (const t of [0, 0.37, 1, Math.PI, 5.9]) {
        computeEpicycleJoints(packed, t, out);
        const v = evaluateSeries(sel.retained, t);
        expect(out[2 * packed.count]).toBeCloseTo(v.re, 13);
        expect(out[2 * packed.count + 1]).toBeCloseTo(v.im, 13);
      }
    }
  });

  it('each epicycle vector has constant length |c_k| and rotates by k·Δt', () => {
    const sel = selectCoefficients(s, 6, { mode: 'magnitude' });
    const packed = packCoefficients(sel.retained);
    const a = new Float64Array(2 * (packed.count + 1));
    const b = new Float64Array(2 * (packed.count + 1));
    const dt = 0.25;
    computeEpicycleJoints(packed, 1, a);
    computeEpicycleJoints(packed, 1 + dt, b);
    for (let i = 0; i < packed.count; i++) {
      const va = [a[2 * i + 2] - a[2 * i], a[2 * i + 3] - a[2 * i + 1]];
      const vb = [b[2 * i + 2] - b[2 * i], b[2 * i + 3] - b[2 * i + 1]];
      expect(Math.hypot(va[0], va[1])).toBeCloseTo(packed.magnitude[i], 13);
      const rot = Math.atan2(va[0] * vb[1] - va[1] * vb[0], va[0] * vb[0] + va[1] * vb[1]);
      const expected = Math.atan2(Math.sin(packed.k[i] * dt), Math.cos(packed.k[i] * dt));
      expect(rot).toBeCloseTo(expected, 12);
    }
  });

  it('the dense curve agrees with the series and with the sample-grid synthesis', () => {
    const sel = selectCoefficients(s, 9, { mode: 'magnitude' });
    const dense = synthesizeDenseCurve(sel.retained, 512);
    expect(dense.count).toBeGreaterThanOrEqual(512);
    for (const r of [0, 17, 300]) {
      const v = evaluateSeries(sel.retained, (2 * Math.PI * r) / dense.count);
      expect(dense.re[r]).toBeCloseTo(v.re, 12);
      expect(dense.im[r]).toBeCloseTo(v.im, 12);
    }
    const grid = synthesizeOnSampleGrid(sel.retained, 128);
    const step = dense.count / 128;
    for (let j = 0; j < 128; j += 13) {
      expect(dense.re[j * step]).toBeCloseTo(grid.re[j], 12);
      expect(dense.im[j * step]).toBeCloseTo(grid.im[j], 12);
    }
  });
});

describe('reconstruction metrics', () => {
  it('MSE equals the energy of the excluded coefficients (Parseval) and never increases with N', () => {
    const z = sample(64, asymmetric);
    const s = computeSpectrum(z.re, z.im);
    let previous = Infinity;
    for (let n = 1; n <= 64; n++) {
      const sel = selectCoefficients(s, n, { mode: 'magnitude' });
      const excluded = s.coefficients.filter((c) => !sel.retainedBins.has(c.bin)).reduce((a, c) => a + c.magnitude ** 2, 0);
      const retained = s.totalEnergy - excluded;
      const m = computeReconstructionMetrics(z, synthesizeOnSampleGrid(sel.retained, 64), { retained, total: s.totalEnergy });
      expect(m.mse).toBeCloseTo(excluded, 13);
      expect(m.rmse).toBeCloseTo(Math.sqrt(m.mse), 15);
      expect(m.maxError).toBeGreaterThanOrEqual(m.rmse - 1e-15);
      expect(m.mse).toBeLessThanOrEqual(previous + 1e-15);
      expect(m.pointwiseError.every(Number.isFinite)).toBe(true);
      previous = m.mse;
    }
  });
});
