import { Point2D } from '../models/curve-sample.model';

/**
 * SVG path-data parser and flattener (pure, DOM-free).
 *
 * Supported commands (absolute and relative forms):
 *   M/m  move-to (extra coordinate pairs are implicit line-to)
 *   L/l  line-to          H/h  horizontal line   V/v  vertical line
 *   C/c  cubic Bézier     S/s  smooth cubic Bézier
 *   Q/q  quadratic Bézier T/t  smooth quadratic Bézier
 *   A/a  elliptical arc   Z/z  close path
 *
 * Each subpath (started by M/m, or implicitly after Z) becomes a separate
 * {@link FlattenedSubpath}. A subpath is "closed" if it ends with Z/z or its
 * last point coincides with its first point.
 */

export interface FlattenedSubpath {
  /** Ordered points along the subpath (input units, y down). */
  readonly points: Point2D[];
  readonly closed: boolean;
  /** Number of drawing segments (excluding the move-to). */
  readonly segmentCount: number;
}

export class SvgPathParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SvgPathParseError';
  }
}

/** Number of line segments used to flatten each Bézier segment. */
const CURVE_SUBDIVISIONS = 32;
/** Maximum angular step (radians) when flattening arcs. */
const ARC_ANGLE_STEP = Math.PI / 32;

class PathScanner {
  private pos = 0;
  constructor(private readonly d: string) {}

  private skipSeparators(): void {
    while (this.pos < this.d.length && /[\s,]/.test(this.d[this.pos])) this.pos++;
  }

  atEnd(): boolean {
    this.skipSeparators();
    return this.pos >= this.d.length;
  }

  peekCommand(): string | null {
    this.skipSeparators();
    const ch = this.d[this.pos];
    return ch !== undefined && /[MmLlHhVvCcSsQqTtAaZz]/.test(ch) ? ch : null;
  }

  readCommand(): string {
    const c = this.peekCommand();
    if (c === null) throw new SvgPathParseError(`Expected a path command at position ${this.pos}.`);
    this.pos++;
    return c;
  }

  /** True if the next token is a number (i.e. an implicitly repeated command follows). */
  hasNumber(): boolean {
    this.skipSeparators();
    return /[-+.\d]/.test(this.d[this.pos] ?? '');
  }

  readNumber(): number {
    this.skipSeparators();
    const re = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
    re.lastIndex = this.pos;
    const m = re.exec(this.d);
    if (!m) {
      const found = this.d[this.pos] ?? 'end of data';
      throw new SvgPathParseError(`Expected a number at position ${this.pos}, found "${found}".`);
    }
    this.pos = re.lastIndex;
    const v = Number(m[0]);
    if (!Number.isFinite(v)) throw new SvgPathParseError(`Invalid number "${m[0]}".`);
    return v;
  }

  /** Arc flags are single '0' / '1' characters that need not be separated. */
  readFlag(): boolean {
    this.skipSeparators();
    const ch = this.d[this.pos];
    if (ch !== '0' && ch !== '1') throw new SvgPathParseError(`Expected an arc flag (0 or 1) at position ${this.pos}.`);
    this.pos++;
    return ch === '1';
  }
}

function cubicPoint(p0: Point2D, p1: Point2D, p2: Point2D, p3: Point2D, t: number): Point2D {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

function quadPoint(p0: Point2D, p1: Point2D, p2: Point2D, t: number): Point2D {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y };
}

/**
 * Flattens an SVG elliptical arc (endpoint parameterisation) into points,
 * following the SVG 1.1 implementation notes (F.6.5 / F.6.6). Excludes p0.
 */
export function flattenArc(
  p0: Point2D,
  rxIn: number,
  ryIn: number,
  xAxisRotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  p1: Point2D,
): Point2D[] {
  if (p0.x === p1.x && p0.y === p1.y) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [p1];

  const phi = (xAxisRotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (p0.x - p1.x) / 2;
  const dy2 = (p0.y - p1.y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = den > 0 ? Math.sqrt(Math.max(0, num / den)) : 0;
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number): number =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  const steps = Math.max(4, Math.ceil(Math.abs(dTheta) / ARC_ANGLE_STEP));
  const pts: Point2D[] = [];
  for (let i = 1; i <= steps; i++) {
    if (i === steps) {
      pts.push(p1); // land exactly on the endpoint
      break;
    }
    const th = theta1 + (dTheta * i) / steps;
    const ex = rx * Math.cos(th);
    const ey = ry * Math.sin(th);
    pts.push({ x: cosPhi * ex - sinPhi * ey + cx, y: sinPhi * ex + cosPhi * ey + cy });
  }
  return pts;
}

/** Parses SVG path data and flattens every subpath into a polyline. */
export function parseSvgPathData(d: string): FlattenedSubpath[] {
  const scanner = new PathScanner(d);
  const subpaths: FlattenedSubpath[] = [];
  let current: Point2D[] = [];
  let segments = 0;
  let closed = false;
  let cur: Point2D = { x: 0, y: 0 };
  let start: Point2D = { x: 0, y: 0 };
  let lastCubicCtrl: Point2D | null = null;
  let lastQuadCtrl: Point2D | null = null;

  const finish = (): void => {
    if (current.length > 0 && (segments > 0 || closed)) {
      const first = current[0];
      const last = current[current.length - 1];
      const coincide = Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9;
      subpaths.push({ points: current, closed: closed || (coincide && current.length > 2), segmentCount: segments });
    }
    current = [];
    segments = 0;
    closed = false;
  };
  const ensureStarted = (): void => {
    if (current.length === 0) current.push(cur);
  };

  if (scanner.atEnd()) return [];
  const firstCmd = scanner.peekCommand();
  if (firstCmd !== 'M' && firstCmd !== 'm') throw new SvgPathParseError('Path data must begin with a move-to (M or m) command.');

  while (!scanner.atEnd()) {
    const cmd = scanner.readCommand();
    const rel = cmd === cmd.toLowerCase();
    const upper = cmd.toUpperCase();
    let first = true;

    do {
      const ox = rel ? cur.x : 0;
      const oy = rel ? cur.y : 0;
      let resetCubic = true;
      let resetQuad = true;

      switch (upper) {
        case 'M': {
          const p = { x: ox + scanner.readNumber(), y: oy + scanner.readNumber() };
          if (first) {
            finish();
            cur = p;
            start = p;
            current.push(p);
          } else {
            ensureStarted();
            current.push(p);
            segments++;
            cur = p;
          }
          break;
        }
        case 'L': {
          const p = { x: ox + scanner.readNumber(), y: oy + scanner.readNumber() };
          ensureStarted();
          current.push(p);
          segments++;
          cur = p;
          break;
        }
        case 'H': {
          const p = { x: ox + scanner.readNumber(), y: cur.y };
          ensureStarted();
          current.push(p);
          segments++;
          cur = p;
          break;
        }
        case 'V': {
          const p = { x: cur.x, y: oy + scanner.readNumber() };
          ensureStarted();
          current.push(p);
          segments++;
          cur = p;
          break;
        }
        case 'C':
        case 'S': {
          let c1: Point2D;
          if (upper === 'C') {
            c1 = { x: ox + scanner.readNumber(), y: oy + scanner.readNumber() };
          } else {
            c1 = lastCubicCtrl ? { x: 2 * cur.x - lastCubicCtrl.x, y: 2 * cur.y - lastCubicCtrl.y } : cur;
          }
          const c2 = { x: ox + scanner.readNumber(), y: oy + scanner.readNumber() };
          const p = { x: ox + scanner.readNumber(), y: oy + scanner.readNumber() };
          ensureStarted();
          for (let i = 1; i <= CURVE_SUBDIVISIONS; i++) {
            current.push(i === CURVE_SUBDIVISIONS ? p : cubicPoint(cur, c1, c2, p, i / CURVE_SUBDIVISIONS));
          }
          segments++;
          lastCubicCtrl = c2;
          resetCubic = false;
          cur = p;
          break;
        }
        case 'Q':
        case 'T': {
          let c: Point2D;
          if (upper === 'Q') {
            c = { x: ox + scanner.readNumber(), y: oy + scanner.readNumber() };
          } else {
            c = lastQuadCtrl ? { x: 2 * cur.x - lastQuadCtrl.x, y: 2 * cur.y - lastQuadCtrl.y } : cur;
          }
          const p = { x: ox + scanner.readNumber(), y: oy + scanner.readNumber() };
          ensureStarted();
          for (let i = 1; i <= CURVE_SUBDIVISIONS; i++) {
            current.push(i === CURVE_SUBDIVISIONS ? p : quadPoint(cur, c, p, i / CURVE_SUBDIVISIONS));
          }
          segments++;
          lastQuadCtrl = c;
          resetQuad = false;
          cur = p;
          break;
        }
        case 'A': {
          const rx = scanner.readNumber();
          const ry = scanner.readNumber();
          const rot = scanner.readNumber();
          const large = scanner.readFlag();
          const sweep = scanner.readFlag();
          const p = { x: ox + scanner.readNumber(), y: oy + scanner.readNumber() };
          ensureStarted();
          current.push(...flattenArc(cur, rx, ry, rot, large, sweep, p));
          segments++;
          cur = p;
          break;
        }
        case 'Z': {
          ensureStarted();
          closed = true;
          cur = start;
          finish();
          // A drawing command after Z without M starts a new subpath at `start`.
          break;
        }
        default:
          throw new SvgPathParseError(`Unsupported path command "${cmd}".`);
      }
      if (resetCubic) lastCubicCtrl = null;
      if (resetQuad) lastQuadCtrl = null;
      first = false;
    } while (upper !== 'Z' && scanner.hasNumber());
  }
  finish();
  return subpaths;
}
