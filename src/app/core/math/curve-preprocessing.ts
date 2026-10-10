import { CurveSamples, Point2D, PreprocessOptions, PreprocessResult } from '../models/curve-sample.model';

export const MIN_SAMPLE_COUNT = 16;
export const MAX_SAMPLE_COUNT = 4096;
export const DEFAULT_SAMPLE_COUNT = 512;
/** Minimum number of distinct vertices for a closed curve with non-zero extent. */
export const MIN_DISTINCT_POINTS = 3;

/**
 * Removes non-finite points and consecutive duplicates (distance ≤ `epsilon`),
 * including a final point that duplicates the first one (an explicit closure).
 */
export function removeConsecutiveDuplicates(
  points: readonly Point2D[],
  epsilon: number,
): { points: Point2D[]; removed: number } {
  const out: Point2D[] = [];
  let removed = 0;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      removed++;
      continue;
    }
    const prev = out[out.length - 1];
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) <= epsilon) {
      removed++;
      continue;
    }
    out.push(p);
  }
  while (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(last.x - first.x, last.y - first.y) <= epsilon) {
      out.pop();
      removed++;
    } else break;
  }
  return { points: out, removed };
}

/** Perimeter of a closed polyline (including the closing segment). */
export function closedPolylineLength(points: readonly Point2D[]): number {
  let length = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

/**
 * Arc-length resampling of a CLOSED polyline: returns M points spaced
 * L/M apart along the curve (L = perimeter), starting at points[0].
 * Sample j corresponds to the parameter t_j = 2πj/M.
 */
export function resampleClosedByArcLength(
  points: readonly Point2D[],
  sampleCount: number,
): { x: Float64Array; y: Float64Array; perimeter: number } {
  const n = points.length;
  const cumulative = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    cumulative[i + 1] = cumulative[i] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const perimeter = cumulative[n];
  const x = new Float64Array(sampleCount);
  const y = new Float64Array(sampleCount);
  let seg = 0;
  for (let j = 0; j < sampleCount; j++) {
    const s = (j * perimeter) / sampleCount;
    while (seg < n - 1 && cumulative[seg + 1] <= s) seg++;
    const segLen = cumulative[seg + 1] - cumulative[seg];
    const u = segLen > 0 ? (s - cumulative[seg]) / segLen : 0;
    const a = points[seg];
    const b = points[(seg + 1) % n];
    x[j] = a.x + u * (b.x - a.x);
    y[j] = a.y + u * (b.y - a.y);
  }
  return { x, y, perimeter };
}

/**
 * Full preprocessing pipeline (pure; independent of the Fourier mathematics):
 *
 *  1. drop non-finite points and consecutive duplicates;
 *  2. validate that at least {@link MIN_DISTINCT_POINTS} distinct points with
 *     non-zero extent remain;
 *  3. treat the polyline as closed (implicit segment last → first);
 *  4. resample to M points equally spaced in arc length;
 *  5. translate so the centroid of the samples is the origin;
 *  6. flip y (screen y-down → mathematical y-up);
 *  7. scale uniformly so the farthest sample has |z| = 1 (aspect ratio preserved).
 *
 * The transform is returned so coefficients can be mapped back to input units.
 */
export function preprocessCurve(rawPoints: readonly Point2D[], options: PreprocessOptions): PreprocessResult {
  const m = Math.round(options.sampleCount);
  if (!Number.isFinite(m) || m < MIN_SAMPLE_COUNT || m > MAX_SAMPLE_COUNT) {
    return { ok: false, error: `Sample count M must be an integer between ${MIN_SAMPLE_COUNT} and ${MAX_SAMPLE_COUNT}.` };
  }
  if (rawPoints.length === 0) return { ok: false, error: 'The curve is empty.' };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of rawPoints) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return { ok: false, error: 'The curve contains no finite coordinates.' };
  const diag = Math.hypot(maxX - minX, maxY - minY);
  if (!(diag > 0)) return { ok: false, error: 'All points coincide — the curve has zero size.' };

  const epsilon = diag * 1e-9;
  const { points, removed } = removeConsecutiveDuplicates(rawPoints, epsilon);
  if (points.length < MIN_DISTINCT_POINTS) {
    return {
      ok: false,
      error: `The curve has only ${points.length} distinct point(s); at least ${MIN_DISTINCT_POINTS} are required.`,
    };
  }

  const first = points[0];
  const last = points[points.length - 1];
  const closureGap = Math.hypot(last.x - first.x, last.y - first.y);
  const { x, y, perimeter } = resampleClosedByArcLength(points, m);
  if (!(perimeter > 0) || !Number.isFinite(perimeter)) {
    return { ok: false, error: 'The curve has zero length.' };
  }

  let cx = 0;
  let cy = 0;
  for (let j = 0; j < m; j++) {
    cx += x[j];
    cy += y[j];
  }
  cx /= m;
  cy /= m;

  let maxR = 0;
  for (let j = 0; j < m; j++) maxR = Math.max(maxR, Math.hypot(x[j] - cx, y[j] - cy));
  if (!(maxR > 0)) return { ok: false, error: 'The curve is degenerate (zero radius about its centroid).' };
  const scale = 1 / maxR;

  const re = new Float64Array(m);
  const im = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    re[j] = (x[j] - cx) * scale;
    im[j] = -(y[j] - cy) * scale; // y-down → y-up
  }

  const warnings: string[] = [];
  if (closureGap > 0.25 * perimeter) {
    warnings.push(
      `The closing segment is long (${((100 * closureGap) / perimeter).toFixed(0)}% of the perimeter); the shape may differ from what you intended.`,
    );
  }
  if (points.length < 8) {
    warnings.push(`Only ${points.length} distinct vertices — the curve is a coarse polygon.`);
  }

  const samples: CurveSamples = {
    sampleCount: m,
    re,
    im,
    transform: { centroid: { x: cx, y: cy }, scale },
    perimeter,
    closureGap,
    distinctPointCount: points.length,
    removedPointCount: removed,
  };
  return { ok: true, samples, warnings };
}
