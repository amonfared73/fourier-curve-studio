import { parseSvgPathData, SvgPathParseError } from './svg-path-parser';
import { importSvg, parseTransform } from './svg-import';
import { preprocessCurve, resampleClosedByArcLength } from '../math/curve-preprocessing';
import { Point2D } from '../models/curve-sample.model';

const near = (p: Point2D, x: number, y: number, tol = 1e-9) => Math.abs(p.x - x) < tol && Math.abs(p.y - y) < tol;
const last = <T>(a: T[]): T => a[a.length - 1];

describe('SVG path-data parser', () => {
  it('parses absolute and relative line commands with implicit repetition', () => {
    const [abs] = parseSvgPathData('M10 10 L 20 10 20 20 H 10 V 15 Z');
    expect(abs.closed).toBe(true);
    expect(abs.points.map((p) => [p.x, p.y])).toEqual([[10, 10], [20, 10], [20, 20], [10, 20], [10, 15]]);

    const [rel] = parseSvgPathData('m10,10 l10,0 0,10 h-10 v-5 z');
    expect(rel.points).toEqual(abs.points);
  });

  it('treats extra move-to pairs as line-to', () => {
    const [sp] = parseSvgPathData('m0 0 10 0 0 10z');
    expect(sp.points.map((p) => [p.x, p.y])).toEqual([[0, 0], [10, 0], [10, 10]]);
  });

  it('handles compact number syntax (signs, exponents, chained decimals)', () => {
    const [sp] = parseSvgPathData('M0,0L1e1-5.5.5.5z');
    expect(sp.points.map((p) => [p.x, p.y])).toEqual([[0, 0], [10, -5.5], [0.5, 0.5]]);
  });

  it('flattens cubic Béziers, absolute and relative, hitting endpoints exactly', () => {
    const [a] = parseSvgPathData('M0 0 C 0 10 10 10 10 0 Z');
    const [r] = parseSvgPathData('M0 0 c 0 10 10 10 10 0 z');
    expect(near(last(a.points), 10, 0)).toBe(true);
    expect(a.points.length).toBe(33);
    // Midpoint of this symmetric cubic is (5, 7.5).
    expect(near(a.points[16], 5, 7.5)).toBe(true);
    a.points.forEach((p, i) => expect(near(p, r.points[i].x, r.points[i].y)).toBe(true));
  });

  it('reflects control points for S/s and T/t', () => {
    const [s] = parseSvgPathData('M0 0 C 0 10 10 10 10 0 S 20 -10 20 0');
    const [explicit] = parseSvgPathData('M0 0 C 0 10 10 10 10 0 C 10 -10 20 -10 20 0');
    s.points.forEach((p, i) => expect(near(p, explicit.points[i].x, explicit.points[i].y)).toBe(true));
    const [t] = parseSvgPathData('M0 0 Q 5 10 10 0 t 10 0');
    const [q] = parseSvgPathData('M0 0 Q 5 10 10 0 Q 15 -10 20 0');
    t.points.forEach((p, i) => expect(near(p, q.points[i].x, q.points[i].y)).toBe(true));
  });

  it('flattens arcs (including compact flags) onto the correct circle', () => {
    const [sp] = parseSvgPathData('M 10 0 A 10 10 0 1 1 -10 0 a10,10 0 1,1 20,0 Z');
    for (const p of sp.points) expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 9);
    const [compact] = parseSvgPathData('M10 0A10 10 0 11-10 0');
    expect(near(last(compact.points), -10, 0)).toBe(true);
  });

  it('splits subpaths and reports open vs closed', () => {
    const subs = parseSvgPathData('M0 0 L10 0 L10 10 Z M20 20 L30 20 L30 30 M 40 40 l 5 0 l 0 5 l -5 -5');
    expect(subs.length).toBe(3);
    expect(subs.map((s) => s.closed)).toEqual([true, false, true]);
  });

  it('rejects invalid data with a meaningful error', () => {
    expect(() => parseSvgPathData('L 10 10')).toThrow(SvgPathParseError);
    expect(() => parseSvgPathData('M 0 0 L 10 x')).toThrow(/Expected a number/);
    expect(() => parseSvgPathData('M 0 0 A 1 1 0 2 0 1 1')).toThrow(/arc flag/);
  });
});

describe('SVG document import', () => {
  it('extracts supported shapes and lets the caller pick among them', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <script>alert('x')</script>
      <defs><path id="hidden" d="M0 0 L 1 0 L 1 1 Z"/></defs>
      <path id="outline" d="M0 0 L100 0 L100 50 Z M 200 0 l 10 0 l 0 10 z"/>
      <circle cx="5" cy="5" r="3"/>
      <text>ignored</text>
    </svg>`;
    const r = importSvg(svg);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidates.length).toBe(3);
    expect(r.candidates.every((c) => c.closed)).toBe(true);
    expect(r.candidates.some((c) => c.label.includes('path#outline · subpath 2'))).toBe(true);
    expect(r.candidates.some((c) => c.label.includes('hidden'))).toBe(false);
    expect(r.warnings.join(' ')).toContain('unsupported');
  });

  it('applies transform attributes of the element and its ancestors', () => {
    const r = importSvg(`<svg xmlns="http://www.w3.org/2000/svg"><g transform="translate(10,20)">
      <polygon transform="scale(2)" points="0,0 1,0 1,1"/></g></svg>`);
    if (!r.ok) throw new Error(r.error);
    expect(r.candidates[0].points.map((p) => [p.x, p.y])).toEqual([[10, 20], [12, 20], [12, 22]]);
    const rot = parseTransform('rotate(90 1 1)');
    // rotating (2,1) by 90° about (1,1) → (1,2)
    expect(rot[0] * 2 + rot[2] * 1 + rot[4]).toBeCloseTo(1, 12);
    expect(rot[1] * 2 + rot[3] * 1 + rot[5]).toBeCloseTo(2, 12);
  });

  it('rejects invalid files gracefully', () => {
    expect(importSvg('not xml at all <').ok).toBe(false);
    expect(importSvg('<html xmlns="http://www.w3.org/1999/xhtml"></html>').ok).toBe(false);
    const empty = importSvg('<svg xmlns="http://www.w3.org/2000/svg"><text>hi</text></svg>');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error).toContain('No supported shapes');
  });

  it('skips a malformed path but keeps valid ones', () => {
    const r = importSvg(`<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L 1"/><path d="M0 0 L1 0 L0 1Z"/></svg>`);
    if (!r.ok) throw new Error(r.error);
    expect(r.candidates.length).toBe(1);
    expect(r.warnings[0]).toContain('skipped');
  });
});

describe('arc-length resampling', () => {
  it('produces equally spaced samples regardless of input spacing', () => {
    // Very unevenly spaced points on a square's perimeter.
    const pts: Point2D[] = [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.15, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
    const { x, y, perimeter } = resampleClosedByArcLength(pts, 32);
    expect(perimeter).toBeCloseTo(16, 12);
    for (let j = 0; j < 32; j++) {
      const k = (j + 1) % 32;
      // along a straight side, chord = arc = 0.5; at corners chord is shorter
      expect(Math.hypot(x[k] - x[j], y[k] - y[j])).toBeLessThanOrEqual(0.5 + 1e-12);
    }
    expect(x[2]).toBeCloseTo(1, 12);
  });

  it('preserves aspect ratio and centres at the centroid', () => {
    const rect: Point2D[] = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }, { x: 0, y: 10 }];
    const r = preprocessCurve(rect, { sampleCount: 100 });
    if (!r.ok) throw new Error(r.error);
    const { re, im } = r.samples;
    const w = Math.max(...re) - Math.min(...re);
    const h = Math.max(...im) - Math.min(...im);
    expect(w / h).toBeCloseTo(4, 10);
    expect(re.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 12);
    expect(im.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 12);
    let maxR = 0;
    for (let j = 0; j < 100; j++) maxR = Math.max(maxR, Math.hypot(re[j], im[j]));
    expect(maxR).toBeCloseTo(1, 14);
  });

  it('flags a long implicit closing segment', () => {
    const open: Point2D[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 10, y: 30 }];
    const r = preprocessCurve(open, { sampleCount: 64 });
    if (!r.ok) throw new Error(r.error);
    expect(r.warnings.join(' ')).toContain('closing segment');
  });
});
