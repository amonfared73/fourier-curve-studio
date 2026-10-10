import { ComplexLike } from '../models/complex-number.model';

/**
 * Immutable complex number z = re + i·im (double precision).
 * All angles are in radians.
 */
export class Complex implements ComplexLike {
  static readonly ZERO = new Complex(0, 0);
  static readonly ONE = new Complex(1, 0);
  static readonly I = new Complex(0, 1);

  constructor(
    readonly re: number,
    readonly im: number,
  ) {}

  static from(z: ComplexLike): Complex {
    return z instanceof Complex ? z : new Complex(z.re, z.im);
  }

  /** r·exp(iθ) */
  static fromPolar(r: number, theta: number): Complex {
    return new Complex(r * Math.cos(theta), r * Math.sin(theta));
  }

  /** exp(iθ) = cos θ + i sin θ — the complex exponential of a purely imaginary argument iθ. */
  static expi(theta: number): Complex {
    return new Complex(Math.cos(theta), Math.sin(theta));
  }

  add(w: ComplexLike): Complex {
    return new Complex(this.re + w.re, this.im + w.im);
  }

  sub(w: ComplexLike): Complex {
    return new Complex(this.re - w.re, this.im - w.im);
  }

  /** (a + ib)(c + id) = (ac − bd) + i(ad + bc) */
  mul(w: ComplexLike): Complex {
    return new Complex(this.re * w.re - this.im * w.im, this.re * w.im + this.im * w.re);
  }

  /** Multiplication by a real scalar. */
  scale(s: number): Complex {
    return new Complex(this.re * s, this.im * s);
  }

  /**
   * Division z / w. Uses Smith's algorithm to avoid premature overflow.
   * Division by zero yields NaN components (callers must check {@link isFinite}).
   */
  div(w: ComplexLike): Complex {
    const { re: c, im: d } = w;
    if (c === 0 && d === 0) return new Complex(NaN, NaN);
    if (Math.abs(c) >= Math.abs(d)) {
      const r = d / c;
      const den = c + d * r;
      return new Complex((this.re + this.im * r) / den, (this.im - this.re * r) / den);
    }
    const r = c / d;
    const den = c * r + d;
    return new Complex((this.re * r + this.im) / den, (this.im * r - this.re) / den);
  }

  conj(): Complex {
    return new Complex(this.re, -this.im);
  }

  /** |z|, computed without intermediate overflow. */
  abs(): number {
    return Math.hypot(this.re, this.im);
  }

  /** |z|² */
  abs2(): number {
    return this.re * this.re + this.im * this.im;
  }

  /** arg(z) ∈ (−π, π]; arg(0) is defined as 0. */
  arg(): number {
    return Math.atan2(this.im, this.re);
  }

  isFinite(): boolean {
    return Number.isFinite(this.re) && Number.isFinite(this.im);
  }

  equals(w: ComplexLike, tolerance = 0): boolean {
    return Math.abs(this.re - w.re) <= tolerance && Math.abs(this.im - w.im) <= tolerance;
  }

  toString(digits = 6): string {
    const sign = this.im < 0 || Object.is(this.im, -0) ? '−' : '+';
    return `${this.re.toFixed(digits)} ${sign} ${Math.abs(this.im).toFixed(digits)}i`;
  }
}

/** Magnitude of a complex-like value. */
export function cabs(z: ComplexLike): number {
  return Math.hypot(z.re, z.im);
}

/** Argument (phase) of a complex-like value in radians, in (−π, π]. */
export function carg(z: ComplexLike): number {
  return Math.atan2(z.im, z.re);
}
