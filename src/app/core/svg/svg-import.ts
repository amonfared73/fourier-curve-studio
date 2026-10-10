import { Point2D } from '../models/curve-sample.model';
import { parseSvgPathData, SvgPathParseError } from './svg-path-parser';

/**
 * Safe extraction of closed shapes from an uploaded SVG document.
 *
 * The file is parsed with DOMParser('image/svg+xml'), which yields an inert
 * document: scripts are never executed and nothing is attached to the page.
 * Only geometry attributes are read.
 *
 * Supported elements: <path>, <polygon>, <polyline>, <rect> (without rounded
 * corners), <circle>, <ellipse>. `transform` attributes (matrix, translate,
 * scale, rotate, skewX, skewY) on the element and its ancestors are applied.
 * Elements inside <defs>, <clipPath>, <mask>, <symbol>, <pattern> and <marker>
 * are ignored, as are <use>, <text>, <image> and <line>. CSS transforms and
 * the root viewBox are not applied — neither affects the shape after
 * normalisation, as long as they are similarity transforms.
 */

export interface SvgShapeCandidate {
  readonly id: string;
  /** Human-readable label, e.g. `path#outline · subpath 2`. */
  readonly label: string;
  readonly points: Point2D[];
  readonly closed: boolean;
  readonly elementName: string;
}

export type SvgImportResult =
  | { readonly ok: true; readonly candidates: SvgShapeCandidate[]; readonly warnings: string[] }
  | { readonly ok: false; readonly error: string };

export const MAX_SVG_BYTES = 5 * 1024 * 1024;

type Matrix = [number, number, number, number, number, number]; // a b c d e f
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Matrix, p: Point2D): Point2D {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** Parses an SVG `transform` attribute into a 2×3 affine matrix. */
export function parseTransform(value: string | null): Matrix {
  if (!value) return IDENTITY;
  let result: Matrix = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    const args = (match[2].match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
    let t: Matrix = IDENTITY;
    switch (match[1]) {
      case 'matrix':
        if (args.length === 6) t = args as Matrix;
        break;
      case 'translate':
        t = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
        break;
      case 'scale':
        t = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const a = ((args[0] ?? 0) * Math.PI) / 180;
        const r: Matrix = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
        if (args.length >= 3) {
          t = multiply(multiply([1, 0, 0, 1, args[1], args[2]], r), [1, 0, 0, 1, -args[1], -args[2]]);
        } else t = r;
        break;
      }
      case 'skewX':
        t = [1, 0, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        t = [1, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    result = multiply(result, t);
  }
  return result.every(Number.isFinite) ? result : IDENTITY;
}

function num(el: Element, name: string): number {
  const v = parseFloat(el.getAttribute(name) ?? '0');
  return Number.isFinite(v) ? v : 0;
}

function parsePointList(value: string | null): Point2D[] {
  const nums = (value?.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
  const pts: Point2D[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return pts;
}

function ellipsePoints(cx: number, cy: number, rx: number, ry: number): Point2D[] {
  const n = 128;
  const pts: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return pts;
}

const IGNORED_CONTAINERS = new Set(['defs', 'clippath', 'mask', 'symbol', 'pattern', 'marker', 'metadata']);
const SUPPORTED = new Set(['path', 'polygon', 'polyline', 'rect', 'circle', 'ellipse']);

/** Parses SVG source text and returns every supported shape (one candidate per subpath). */
export function importSvg(source: string): SvgImportResult {
  if (source.length > MAX_SVG_BYTES) return { ok: false, error: 'The SVG file is larger than 5 MB.' };
  if (typeof DOMParser === 'undefined') return { ok: false, error: 'SVG parsing is not available in this environment.' };

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  } catch {
    return { ok: false, error: 'The file could not be parsed as XML.' };
  }
  if (doc.getElementsByTagName('parsererror').length > 0) {
    return { ok: false, error: 'The file is not well-formed SVG/XML.' };
  }
  const root = doc.documentElement;
  if (!root || root.localName.toLowerCase() !== 'svg') {
    return { ok: false, error: 'The file does not contain an <svg> root element.' };
  }

  const candidates: SvgShapeCandidate[] = [];
  const warnings: string[] = [];
  let unsupportedCount = 0;
  let elementIndex = 0;

  const visit = (el: Element, parentMatrix: Matrix): void => {
    const name = el.localName.toLowerCase();
    if (IGNORED_CONTAINERS.has(name)) return;
    const matrix = multiply(parentMatrix, parseTransform(el.getAttribute('transform')));

    if (SUPPORTED.has(name)) {
      elementIndex++;
      const idAttr = el.getAttribute('id');
      const baseLabel = `${name}${idAttr ? '#' + idAttr : ' ' + elementIndex}`;
      let subpaths: { points: Point2D[]; closed: boolean }[] = [];
      try {
        switch (name) {
          case 'path':
            subpaths = parseSvgPathData(el.getAttribute('d') ?? '');
            break;
          case 'polygon':
            subpaths = [{ points: parsePointList(el.getAttribute('points')), closed: true }];
            break;
          case 'polyline':
            subpaths = [{ points: parsePointList(el.getAttribute('points')), closed: false }];
            break;
          case 'rect': {
            const x = num(el, 'x'), y = num(el, 'y'), w = num(el, 'width'), h = num(el, 'height');
            if (el.hasAttribute('rx') || el.hasAttribute('ry')) warnings.push(`${baseLabel}: rounded corners are ignored.`);
            subpaths = [{ points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], closed: true }];
            break;
          }
          case 'circle':
            subpaths = [{ points: ellipsePoints(num(el, 'cx'), num(el, 'cy'), num(el, 'r'), num(el, 'r')), closed: true }];
            break;
          case 'ellipse':
            subpaths = [{ points: ellipsePoints(num(el, 'cx'), num(el, 'cy'), num(el, 'rx'), num(el, 'ry')), closed: true }];
            break;
        }
      } catch (e) {
        const msg = e instanceof SvgPathParseError ? e.message : 'unknown parse error';
        warnings.push(`${baseLabel} was skipped: ${msg}`);
        subpaths = [];
      }
      subpaths.forEach((sp, i) => {
        if (sp.points.length < 2) return;
        const label = subpaths.length > 1 ? `${baseLabel} · subpath ${i + 1}` : baseLabel;
        candidates.push({
          id: `${candidates.length}`,
          label: `${label}${sp.closed ? '' : ' (open)'} — ${sp.points.length} pts`,
          points: sp.points.map((p) => apply(matrix, p)),
          closed: sp.closed,
          elementName: name,
        });
      });
    } else if (['use', 'text', 'image', 'line', 'foreignobject'].includes(name)) {
      unsupportedCount++;
    }
    for (const child of Array.from(el.children)) visit(child, matrix);
  };
  visit(root, IDENTITY);

  if (unsupportedCount > 0) warnings.push(`${unsupportedCount} unsupported element(s) (use/text/image/line/foreignObject) were ignored.`);
  if (candidates.length === 0) {
    return { ok: false, error: 'No supported shapes were found. Use <path>, <polygon>, <rect>, <circle> or <ellipse>.' };
  }
  // Closed shapes first, then by number of points (detail) — deterministic.
  candidates.sort((a, b) => Number(b.closed) - Number(a.closed) || b.points.length - a.points.length || Number(a.id) - Number(b.id));
  return { ok: true, candidates, warnings };
}
