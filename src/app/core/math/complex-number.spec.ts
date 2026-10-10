import { Complex, cabs, carg } from './complex-number';

const TOL = 1e-14;

describe('Complex', () => {
  const a = new Complex(3, -2);
  const b = new Complex(-1, 4);

  it('adds', () => expect(a.add(b).equals(new Complex(2, 2), TOL)).toBe(true));
  it('subtracts', () => expect(a.sub(b).equals(new Complex(4, -6), TOL)).toBe(true));
  it('multiplies: (3−2i)(−1+4i) = 5 + 14i', () => expect(a.mul(b).equals(new Complex(5, 14), TOL)).toBe(true));
  it('multiplies i·i = −1', () => expect(Complex.I.mul(Complex.I).equals(new Complex(-1, 0), TOL)).toBe(true));
  it('scales by a real number', () => expect(a.scale(-0.5).equals(new Complex(-1.5, 1), TOL)).toBe(true));

  it('divides and inverts multiplication', () => {
    const q = a.div(b);
    expect(q.mul(b).equals(a, 1e-13)).toBe(true);
    expect(new Complex(1, 0).div(new Complex(0, 1)).equals(new Complex(0, -1), TOL)).toBe(true);
  });
  it('division by zero yields non-finite result', () => expect(a.div(Complex.ZERO).isFinite()).toBe(false));

  it('computes magnitude', () => {
    expect(new Complex(3, 4).abs()).toBe(5);
    expect(cabs({ re: -5, im: 12 })).toBe(13);
    expect(new Complex(1e300, 1e300).abs()).toBeCloseTo(Math.SQRT2 * 1e300, -290);
  });

  it('computes argument in radians within (−π, π]', () => {
    expect(new Complex(0, 1).arg()).toBeCloseTo(Math.PI / 2, 15);
    expect(new Complex(-1, 0).arg()).toBeCloseTo(Math.PI, 15);
    expect(carg({ re: 1, im: -1 })).toBeCloseTo(-Math.PI / 4, 15);
    expect(Complex.ZERO.arg()).toBe(0);
  });

  it('evaluates exp(iθ) for purely imaginary arguments (Euler)', () => {
    expect(Complex.expi(0).equals(Complex.ONE, TOL)).toBe(true);
    expect(Complex.expi(Math.PI / 2).equals(Complex.I, TOL)).toBe(true);
    expect(Complex.expi(Math.PI).equals(new Complex(-1, 0), TOL)).toBe(true);
    for (const th of [0.3, 1.7, -2.4, 10]) {
      const e = Complex.expi(th);
      expect(e.abs()).toBeCloseTo(1, 15);
      expect(Complex.expi(th).mul(Complex.expi(0.5)).equals(Complex.expi(th + 0.5), 1e-14)).toBe(true);
    }
  });

  it('builds from polar form consistently with abs/arg', () => {
    const z = Complex.fromPolar(2.5, -1.1);
    expect(z.abs()).toBeCloseTo(2.5, 14);
    expect(z.arg()).toBeCloseTo(-1.1, 14);
  });

  it('conjugates', () => expect(a.conj().equals(new Complex(3, 2), 0)).toBe(true));
});
