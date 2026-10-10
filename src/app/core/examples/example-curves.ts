import { Point2D } from '../models/curve-sample.model';
import { parseSvgPathData } from '../svg/svg-path-parser';

/**
 * Example INPUT curves (screen coordinates, y down). These are only inputs;
 * every coefficient and reconstruction shown in the app is computed from them.
 */
export interface ExampleCurve {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly build: () => Point2D[];
}

function parametric(n: number, f: (t: number) => Point2D): Point2D[] {
  const pts: Point2D[] = [];
  for (let i = 0; i < n; i++) pts.push(f((2 * Math.PI * i) / n));
  return pts;
}

function star(points: number, outer: number, inner: number): Point2D[] {
  const pts: Point2D[] = [];
  for (let i = 0; i < 2 * points; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (Math.PI * i) / points;
    pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  return pts;
}

export const EXAMPLE_CURVES: readonly ExampleCurve[] = [
  {
    id: 'heart',
    name: 'Heart',
    description: 'Classic parametric heart curve — smooth with one cusp.',
    build: () =>
      parametric(400, (t) => ({
        x: 16 * Math.sin(t) ** 3,
        y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
      })),
  },
  {
    id: 'star',
    name: 'Star',
    description: 'Five-pointed star polygon — sharp corners need many terms.',
    build: () => star(5, 100, 40),
  },
  {
    id: 'square',
    name: 'Square',
    description: 'Square — only frequencies k ≡ 1 (mod 4) appear.',
    build: () => [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ],
  },
  {
    id: 'ellipse',
    name: 'Ellipse',
    description: 'Ellipse — dominated by k = +1 and k = −1.',
    build: () => parametric(360, (t) => ({ x: 2 * Math.cos(t), y: -Math.sin(t) })),
  },
  {
    id: 'figure-eight',
    name: 'Figure eight',
    description: 'Self-intersecting lemniscate of Gerono.',
    build: () => parametric(400, (t) => ({ x: Math.cos(t), y: -Math.sin(2 * t) / 2 })),
  },
  {
    id: 'fish',
    name: 'Fish (SVG path)',
    description: 'Built from SVG path data with cubic Bézier segments.',
    build: () =>
      parseSvgPathData(
        'M 10 50 C 30 10, 70 10, 90 40 L 110 25 L 104 50 L 110 75 L 90 60 C 70 90, 30 90, 10 50 Z',
      )[0].points,
  },
  {
    id: 'flower',
    name: 'Flower',
    description: 'Rose-like petal curve r = 1 + 0.3·cos 7θ.',
    build: () =>
      parametric(700, (t) => {
        const r = 1 + 0.3 * Math.cos(7 * t);
        return { x: r * Math.cos(t), y: -r * Math.sin(t) };
      }),
  },
];
