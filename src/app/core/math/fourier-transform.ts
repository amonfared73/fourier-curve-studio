import { FourierCoefficient, FourierSpectrum } from '../models/fourier-coefficient.model';

/**
 * Discrete Fourier transform conventions
 * --------------------------------------
 * Samples z_j (j = 0 … M−1) are taken at t_j = 2πj/M. The coefficient stored
 * in DFT bin b is
 *
 *     c_b = (1/M) Σ_j z_j · exp(−i 2π b j / M)
 *
 * and the inverse transform is the (unnormalised) sum
 *
 *     z_j = Σ_b c_b · exp(+i 2π b j / M).
 *
 * Bin b is identified with the SIGNED frequency k (see {@link signedFrequency})
 * so that z_j = Σ_k c_k exp(i k t_j). For even M the Nyquist bin b = M/2 is
 * assigned k = −M/2 (the same convention as NumPy's `fftfreq`). On the sample
 * grid exp(+i(M/2)t_j) = exp(−i(M/2)t_j) = (−1)^j, so either choice reproduces
 * the samples exactly; they differ only between samples.
 */

/** Signed frequency k represented by DFT bin b for M samples. Range: [−⌊M/2⌋, ⌈M/2⌉ − 1]. */
export function signedFrequency(bin: number, sampleCount: number): number {
  return bin < sampleCount / 2 ? bin : bin - sampleCount;
}

/** DFT bin index b ∈ [0, M) storing signed frequency k. */
export function binForFrequency(k: number, sampleCount: number): number {
  return ((k % sampleCount) + sampleCount) % sampleCount;
}

export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * In-place iterative radix-2 Cooley–Tukey FFT.
 *   forward (inverse = false): X_b = Σ_j x_j exp(−2πi bj/n)
 *   inverse (inverse = true):  x_j = Σ_b X_b exp(+2πi bj/n)   (no 1/n factor)
 * `re.length` must be a power of two.
 */
export function fftInPlace(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  if (im.length !== n) throw new Error('fftInPlace: re and im must have equal length');
  if (!isPowerOfTwo(n)) throw new Error(`fftInPlace: length ${n} is not a power of two`);

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i];
      re[i] = re[j];
      re[j] = tmp;
      tmp = im[i];
      im[i] = im[j];
      im[j] = tmp;
    }
  }

  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = (sign * 2 * Math.PI) / len;
    for (let m = 0; m < half; m++) {
      // Twiddles are evaluated directly (not by recurrence) to limit round-off growth.
      const wr = Math.cos(step * m);
      const wi = Math.sin(step * m);
      for (let s = m; s < n; s += len) {
        const u = s + half;
        const xr = re[u] * wr - im[u] * wi;
        const xi = re[u] * wi + im[u] * wr;
        re[u] = re[s] - xr;
        im[u] = im[s] - xi;
        re[s] += xr;
        im[s] += xi;
      }
    }
  }
}

/**
 * Direct O(M²) DFT with an exact twiddle table: exp(∓2πi·(bj mod M)/M).
 * Works for any M ≥ 1. Same sign/normalisation conventions as {@link fftInPlace}.
 */
export function dftDirect(
  re: Float64Array,
  im: Float64Array,
  inverse: boolean,
): { re: Float64Array; im: Float64Array } {
  const n = re.length;
  const cosT = new Float64Array(n);
  const sinT = new Float64Array(n);
  const sign = inverse ? 1 : -1;
  for (let m = 0; m < n; m++) {
    const a = (2 * Math.PI * m) / n;
    cosT[m] = Math.cos(a);
    sinT[m] = sign * Math.sin(a);
  }
  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  for (let b = 0; b < n; b++) {
    let sr = 0;
    let si = 0;
    let idx = 0; // (b·j) mod n, updated incrementally to stay exact
    for (let j = 0; j < n; j++) {
      const c = cosT[idx];
      const s = sinT[idx];
      sr += re[j] * c - im[j] * s;
      si += re[j] * s + im[j] * c;
      idx += b;
      if (idx >= n) idx -= n;
    }
    outRe[b] = sr;
    outIm[b] = si;
  }
  return { re: outRe, im: outIm };
}

/**
 * Unnormalised transform of arbitrary length: radix-2 FFT when the length is
 * a power of two, otherwise the direct DFT. Inputs are not modified.
 */
export function transform(
  re: Float64Array,
  im: Float64Array,
  inverse: boolean,
): { re: Float64Array; im: Float64Array; algorithm: FourierSpectrum['algorithm'] } {
  if (isPowerOfTwo(re.length)) {
    const r = Float64Array.from(re);
    const i = Float64Array.from(im);
    fftInPlace(r, i, inverse);
    return { re: r, im: i, algorithm: 'fft-radix2' };
  }
  return { ...dftDirect(re, im, inverse), algorithm: 'dft-direct' };
}

/**
 * Computes the full spectrum c_k (one coefficient per bin) of M samples:
 *   c_k = (1/M) Σ_j z_j exp(−i 2π k j / M).
 */
export function computeSpectrum(re: Float64Array, im: Float64Array): FourierSpectrum {
  const m = re.length;
  if (m === 0 || im.length !== m) throw new Error('computeSpectrum: invalid sample arrays');
  const out = transform(re, im, false);
  const coefficients: FourierCoefficient[] = new Array(m);
  let totalEnergy = 0;
  for (let b = 0; b < m; b++) {
    const cr = out.re[b] / m;
    const ci = out.im[b] / m;
    const magnitude = Math.hypot(cr, ci);
    totalEnergy += cr * cr + ci * ci;
    coefficients[b] = {
      k: signedFrequency(b, m),
      bin: b,
      re: cr,
      im: ci,
      magnitude,
      phase: Math.atan2(ci, cr),
    };
  }
  return { sampleCount: m, coefficients, algorithm: out.algorithm, totalEnergy };
}

/**
 * Inverse transform of a (possibly masked) spectrum back onto the M-point
 * sample grid: ẑ_j = Σ_{retained k} c_k exp(i k t_j), t_j = 2πj/M.
 * Coefficients not listed are treated as zero.
 */
export function synthesizeOnSampleGrid(
  coefficients: readonly FourierCoefficient[],
  sampleCount: number,
): { re: Float64Array; im: Float64Array } {
  const re = new Float64Array(sampleCount);
  const im = new Float64Array(sampleCount);
  for (const c of coefficients) {
    const b = binForFrequency(c.k, sampleCount);
    re[b] += c.re;
    im[b] += c.im;
  }
  const out = transform(re, im, true);
  return { re: out.re, im: out.im };
}
