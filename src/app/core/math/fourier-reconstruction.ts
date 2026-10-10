import { Complex } from './complex-number';
import { binForFrequency, fftInPlace, nextPowerOfTwo } from './fourier-transform';
import {
  CoefficientSelection,
  FourierCoefficient,
  FourierSpectrum,
  SelectionOptions,
} from '../models/fourier-coefficient.model';

/* ------------------------------------------------------------------------ *
 * Frequency selection
 * ------------------------------------------------------------------------ */

/**
 * Relative tolerance under which two magnitudes are considered tied.
 * Magnitudes are quantised to multiples of (RELATIVE_TIE_TOLERANCE · max|c|),
 * which keeps the comparator transitive and therefore the sort deterministic.
 */
export const RELATIVE_TIE_TOLERANCE = 1e-12;

function magnitudeKey(magnitude: number, quantum: number): number {
  return quantum > 0 ? Math.round(magnitude / quantum) : 0;
}

/**
 * Deterministic total order used for ranking by magnitude:
 *   1. larger |c_k| first (after quantisation, see {@link RELATIVE_TIE_TOLERANCE});
 *   2. ties: smaller |k| first;
 *   3. still tied (k vs −k): positive k first.
 */
export function makeMagnitudeComparator(
  spectrum: FourierSpectrum,
): (a: FourierCoefficient, b: FourierCoefficient) => number {
  let max = 0;
  for (const c of spectrum.coefficients) if (c.magnitude > max) max = c.magnitude;
  const quantum = max * RELATIVE_TIE_TOLERANCE;
  return (a, b) => {
    const d = magnitudeKey(b.magnitude, quantum) - magnitudeKey(a.magnitude, quantum);
    if (d !== 0) return d;
    const dk = Math.abs(a.k) - Math.abs(b.k);
    if (dk !== 0) return dk;
    return b.k - a.k;
  };
}

/** Order for the contiguous mode: 0, +1, −1, +2, −2, … (restricted to available bins). */
function contiguousComparator(a: FourierCoefficient, b: FourierCoefficient): number {
  const dk = Math.abs(a.k) - Math.abs(b.k);
  return dk !== 0 ? dk : b.k - a.k;
}

/**
 * True when every sample is real (|Im z_j| negligible), i.e. the curve lies on
 * the real axis. Only then is conjugate symmetry c_{−k} = conj(c_k) expected.
 */
export function isRealValuedSignal(re: Float64Array, im: Float64Array, relTol = 1e-12): boolean {
  let maxAbs = 0;
  let maxIm = 0;
  for (let j = 0; j < re.length; j++) {
    maxAbs = Math.max(maxAbs, Math.abs(re[j]), Math.abs(im[j]));
    maxIm = Math.max(maxIm, Math.abs(im[j]));
  }
  return maxIm <= relTol * Math.max(maxAbs, Number.MIN_VALUE);
}

/** Clamp a requested component count to the valid range [1, M]. */
export function clampComponentCount(n: number, available: number): number {
  if (!Number.isFinite(n)) return Math.min(1, available);
  return Math.max(Math.min(1, available), Math.min(Math.round(n), available));
}

/**
 * Selects N of the M available coefficients.
 *
 *  - `magnitude`: the N largest |c_k| (ties per {@link makeMagnitudeComparator}).
 *  - `contiguous`: frequencies closest to zero, in the order 0, +1, −1, +2, −2, …
 *    so odd N gives the symmetric band −n…n and even N adds the next positive k.
 *
 * With `conjugateSymmetric` (for real-valued signals only) the pairs {k, −k}
 * are kept together. Groups are taken in rank order; when a pair no longer
 * fits, the best remaining singleton (k = 0 or the Nyquist bin) is used to
 * fill the final slot. If no singleton is left, the selection holds N − 1 terms.
 *
 * The returned `retained` array is in epicycle order (see {@link CoefficientSelection}).
 */
export function selectCoefficients(
  spectrum: FourierSpectrum,
  requested: number,
  options: SelectionOptions,
): CoefficientSelection {
  const m = spectrum.sampleCount;
  const n = clampComponentCount(requested, m);
  const magnitudeCmp = makeMagnitudeComparator(spectrum);
  const rankCmp = options.mode === 'magnitude' ? magnitudeCmp : contiguousComparator;
  const ranked = [...spectrum.coefficients].sort(rankCmp);
  const symmetric = options.conjugateSymmetric === true;

  const chosen: FourierCoefficient[] = [];
  if (!symmetric) {
    for (let i = 0; i < n; i++) chosen.push(ranked[i]);
  } else {
    const taken = new Set<number>();
    const isSingleton = (c: FourierCoefficient): boolean =>
      binForFrequency(-c.k, m) === c.bin; // k = 0, or Nyquist for even M
    for (const c of ranked) {
      if (chosen.length >= n) break;
      if (taken.has(c.bin)) continue;
      if (isSingleton(c)) {
        chosen.push(c);
        taken.add(c.bin);
        continue;
      }
      const partner = spectrum.coefficients[binForFrequency(-c.k, m)];
      if (chosen.length + 2 <= n) {
        chosen.push(c, partner);
        taken.add(c.bin).add(partner.bin);
      } else {
        const filler = ranked.find((s) => !taken.has(s.bin) && isSingleton(s));
        if (filler) {
          chosen.push(filler);
          taken.add(filler.bin);
        }
        break;
      }
    }
  }

  const rankByBin = new Int32Array(m).fill(-1);
  chosen.forEach((c, i) => (rankByBin[c.bin] = i));
  const retained = [...chosen].sort((a, b) => {
    if (a.k === 0) return -1;
    if (b.k === 0) return 1;
    return magnitudeCmp(a, b);
  });
  return {
    requestedCount: n,
    retained,
    retainedBins: new Set(chosen.map((c) => c.bin)),
    rankByBin,
    mode: options.mode,
    conjugateSymmetric: symmetric,
  };
}

/* ------------------------------------------------------------------------ *
 * Evaluation of the truncated series z_N(t) = Σ c_k exp(i k t)
 * ------------------------------------------------------------------------ */

/** Evaluates the truncated Fourier series at parameter t (radians). */
export function evaluateSeries(coefficients: readonly FourierCoefficient[], t: number): Complex {
  let re = 0;
  let im = 0;
  for (const c of coefficients) {
    const a = c.k * t;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    re += c.re * cos - c.im * sin;
    im += c.re * sin + c.im * cos;
  }
  return new Complex(re, im);
}

/**
 * Coefficients packed into typed arrays in epicycle order, so the animation
 * loop can evaluate the rotating vectors without allocating.
 */
export interface PackedCoefficients {
  readonly count: number;
  readonly k: Float64Array;
  readonly re: Float64Array;
  readonly im: Float64Array;
  readonly magnitude: Float64Array;
}

export function packCoefficients(ordered: readonly FourierCoefficient[]): PackedCoefficients {
  const count = ordered.length;
  const packed = {
    count,
    k: new Float64Array(count),
    re: new Float64Array(count),
    im: new Float64Array(count),
    magnitude: new Float64Array(count),
  };
  ordered.forEach((c, i) => {
    packed.k[i] = c.k;
    packed.re[i] = c.re;
    packed.im[i] = c.im;
    packed.magnitude[i] = c.magnitude;
  });
  return packed;
}

/**
 * Head-to-tail epicycle chain at parameter t.
 * Writes N + 1 joints (x0, y0, x1, y1, …) into `out` (length ≥ 2(N+1)):
 * joint 0 is the origin, joint i+1 = joint i + c_{k_i} exp(i k_i t).
 * The final joint is the endpoint z_N(t). Returns `out` (no allocation).
 */
export function computeEpicycleJoints(
  packed: PackedCoefficients,
  t: number,
  out: Float64Array,
): Float64Array {
  let x = 0;
  let y = 0;
  out[0] = 0;
  out[1] = 0;
  for (let i = 0; i < packed.count; i++) {
    const a = packed.k[i] * t;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    x += packed.re[i] * cos - packed.im[i] * sin;
    y += packed.re[i] * sin + packed.im[i] * cos;
    out[2 * i + 2] = x;
    out[2 * i + 3] = y;
  }
  return out;
}

/**
 * Dense, uniformly spaced evaluation of z_N(t) over one period for drawing,
 * via a zero-padded inverse FFT. The grid size R is a power of two with
 * R ≥ max(minPoints, 4·max|k| + 4), so no retained frequency aliases.
 * Point r corresponds to t_r = 2πr/R.
 */
export function synthesizeDenseCurve(
  coefficients: readonly FourierCoefficient[],
  minPoints = 1024,
): { re: Float64Array; im: Float64Array; count: number } {
  let maxK = 0;
  for (const c of coefficients) maxK = Math.max(maxK, Math.abs(c.k));
  const r = nextPowerOfTwo(Math.max(minPoints, 4 * maxK + 4));
  const re = new Float64Array(r);
  const im = new Float64Array(r);
  for (const c of coefficients) {
    const b = binForFrequency(c.k, r);
    re[b] += c.re;
    im[b] += c.im;
  }
  fftInPlace(re, im, true);
  return { re, im, count: r };
}
