import { ReconstructionMetrics } from '../models/fourier-coefficient.model';

/**
 * Parameter-space reconstruction error between the original samples z_j and
 * the reconstruction ẑ_j evaluated at the SAME parameter values t_j = 2πj/M:
 *
 *   e_j  = |z_j − ẑ_j|           (Euclidean distance between corresponding points)
 *   MSE  = (1/M) Σ e_j²
 *   RMSE = √MSE
 *   Max  = max_j e_j
 *
 * These compare points with equal parameter t; they are not the minimum
 * geometric (e.g. Hausdorff) distance between the two shapes.
 */
export function computeReconstructionMetrics(
  original: { re: Float64Array; im: Float64Array },
  reconstructed: { re: Float64Array; im: Float64Array },
  energy: { retained: number; total: number },
): ReconstructionMetrics {
  const m = original.re.length;
  if (reconstructed.re.length !== m) {
    throw new Error('computeReconstructionMetrics: sample counts differ');
  }
  const pointwiseError = new Float64Array(m);
  let sumSq = 0;
  let maxError = 0;
  let maxIndex = 0;
  for (let j = 0; j < m; j++) {
    const dx = original.re[j] - reconstructed.re[j];
    const dy = original.im[j] - reconstructed.im[j];
    const e = Math.hypot(dx, dy);
    pointwiseError[j] = e;
    sumSq += e * e;
    if (e > maxError) {
      maxError = e;
      maxIndex = j;
    }
  }
  const mse = m > 0 ? sumSq / m : 0;
  return {
    mse,
    rmse: Math.sqrt(mse),
    maxError,
    maxErrorT: (2 * Math.PI * maxIndex) / Math.max(m, 1),
    energyFraction: energy.total > 0 ? Math.min(1, energy.retained / energy.total) : 1,
    pointwiseError,
  };
}
