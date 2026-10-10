/**
 * Plain, serialisable representation of a complex number z = re + i·im.
 *
 * Conventions used throughout Fourier Curve Studio:
 *  - The imaginary unit is written `i` and satisfies i² = −1.
 *  - Angles (arguments, phases, rotation parameters) are always in radians.
 *  - Plane points are mapped to complex numbers as  z = x + i·y  with the
 *    y axis pointing UP (mathematical orientation). Screen/SVG coordinates
 *    (y pointing down) are converted during preprocessing.
 */
export interface ComplexLike {
  readonly re: number;
  readonly im: number;
}
