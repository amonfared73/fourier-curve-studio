/**
 * One complex Fourier coefficient c_k of the discrete spectrum.
 *
 * c_k = (1/M) Σ_{j=0}^{M−1} z_j · exp(−i 2π k j / M)
 */
export interface FourierCoefficient {
  /** Signed integer frequency k (cycles per period; positive = counter-clockwise). */
  readonly k: number;
  /** DFT bin index b ∈ [0, M) that stores this coefficient (k ≡ b mod M). */
  readonly bin: number;
  readonly re: number;
  readonly im: number;
  /** |c_k| — radius of the corresponding epicycle. */
  readonly magnitude: number;
  /** arg(c_k) ∈ (−π, π] in radians — initial angle of the rotating vector. */
  readonly phase: number;
}

/** The full discrete spectrum of a sampled curve (exactly M coefficients). */
export interface FourierSpectrum {
  /** M — the number of samples the spectrum was computed from. */
  readonly sampleCount: number;
  /** Coefficients indexed by bin b = 0 … M−1. */
  readonly coefficients: readonly FourierCoefficient[];
  /** Which algorithm produced it. */
  readonly algorithm: 'fft-radix2' | 'dft-direct';
  /** Σ |c_k|² = (1/M) Σ |z_j|² (Parseval). */
  readonly totalEnergy: number;
}

/** How the N retained components are chosen. */
export type SelectionMode = 'magnitude' | 'contiguous';

export interface SelectionOptions {
  readonly mode: SelectionMode;
  /**
   * If true, the selection keeps pairs {k, −k} together so that a real-valued
   * input signal yields a real-valued reconstruction. Only meaningful for
   * real-valued signals; general complex curves must NOT use it.
   */
  readonly conjugateSymmetric?: boolean;
}

/** The outcome of retaining N of the M available components. */
export interface CoefficientSelection {
  /** N requested (after clamping to [1, M]). */
  readonly requestedCount: number;
  /**
   * Retained coefficients in epicycle order: k = 0 first (the stationary
   * anchor), then by descending magnitude, ties broken by smaller |k|, then
   * positive k before negative k.
   */
  readonly retained: readonly FourierCoefficient[];
  /** Bins that are retained (for O(1) membership tests). */
  readonly retainedBins: ReadonlySet<number>;
  /** Selection rank (0-based) by bin; −1 for excluded bins. */
  readonly rankByBin: Int32Array;
  readonly mode: SelectionMode;
  readonly conjugateSymmetric: boolean;
}

/** User-facing reconstruction settings. */
export interface ReconstructionSettings {
  /** M — number of arc-length samples taken from the input curve. */
  readonly sampleCount: number;
  /** N — number of retained Fourier components. */
  readonly componentCount: number;
  readonly selectionMode: SelectionMode;
}

/** Parameter-space reconstruction error metrics, evaluated at t_j = 2πj/M. */
export interface ReconstructionMetrics {
  readonly mse: number;
  readonly rmse: number;
  readonly maxError: number;
  /** Parameter value t at which the maximum error occurs (radians). */
  readonly maxErrorT: number;
  /** Fraction of spectral energy Σ|c_k|² captured by the retained terms. */
  readonly energyFraction: number;
  /** Euclidean error |z_j − ẑ_j| for every sample j (length M). */
  readonly pointwiseError: Float64Array;
}

/** State of the epicycle animation. */
export interface AnimationState {
  readonly playing: boolean;
  /** Current parameter t ∈ [0, 2π). */
  readonly t: number;
  /** Speed multiplier relative to the base period. */
  readonly speed: number;
}
