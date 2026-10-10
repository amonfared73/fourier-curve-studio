/** A point in an input coordinate system (canvas pixels or SVG user units, y pointing down). */
export interface Point2D {
  readonly x: number;
  readonly y: number;
}

/** Where a raw input curve came from. */
export type CurveSource = 'drawing' | 'svg' | 'example';

/** A raw, ordered, implicitly closed polyline supplied by the user, in screen coordinates (y down). */
export interface RawCurve {
  readonly points: readonly Point2D[];
  readonly source: CurveSource;
  readonly label: string;
}

/**
 * Affine map between the input (screen, y-down) coordinates and the normalised
 * mathematical coordinates in which the Fourier coefficients are computed:
 *
 *   z_normalised = scale · ((x − cx) − i·(y − cy))
 *
 * i.e. translate so the centroid is at the origin, flip y so that it points
 * up, and scale uniformly (aspect ratio preserved) so the farthest sample lies
 * on the unit circle.
 */
export interface CurveTransform {
  /** Centroid of the arc-length resampled curve, in input coordinates. */
  readonly centroid: Point2D;
  /** Uniform scale factor: normalised units per input unit. */
  readonly scale: number;
}

/**
 * The output of preprocessing: M samples z_j = x_j + i·y_j taken at equally
 * spaced arc-length positions, which we identify with the parameter values
 * t_j = 2πj/M.
 */
export interface CurveSamples {
  /** M — the number of input samples. */
  readonly sampleCount: number;
  /** Real parts x_j (length M), normalised coordinates. */
  readonly re: Float64Array;
  /** Imaginary parts y_j (length M), normalised coordinates. */
  readonly im: Float64Array;
  readonly transform: CurveTransform;
  /** Perimeter of the closed input polyline, in input units. */
  readonly perimeter: number;
  /** Length of the implicit closing segment (last → first), in input units. */
  readonly closureGap: number;
  /** Number of distinct input vertices after duplicate removal. */
  readonly distinctPointCount: number;
  /** Number of consecutive duplicate / non-finite input points removed. */
  readonly removedPointCount: number;
}

export interface PreprocessOptions {
  /** M — number of arc-length samples to produce. */
  readonly sampleCount: number;
}

export type PreprocessResult =
  | { readonly ok: true; readonly samples: CurveSamples; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly error: string };
