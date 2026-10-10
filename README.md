# Fourier Curve Studio

An Angular + TypeScript web app that represents a closed 2-D curve as a complex Fourier series and shows the reconstruction as a chain of rotating vectors (epicycles). Draw a curve, pick an example, or import an SVG path. Then change how many components are kept and watch the approximation, the coefficients and the error metrics update.

Everything runs in the browser. There is no backend and no external API, and the only runtime dependencies are Angular and RxJS.

## Setup and run

You need Node.js 20.19+ or 22.12+ (developed on Node 22) and npm 10+.

```bash
npm install          # .npmrc sets legacy-peer-deps (works around an npm peer-resolution bug with vitest)
npm start            # dev server at http://localhost:4200
npm test             # unit + integration tests (Vitest via the Angular CLI, jsdom), single run: npm test -- --watch=false
npm run build        # production build → dist/fourier-curve-studio/browser
```

The build output is static, so any static file host can serve `dist/fourier-curve-studio/browser`.

Built with Angular 21.2 (standalone components, signals, zoneless change detection), TypeScript 5.9 in strict mode, and Vitest 4.

## Using the app

1. **Supply a curve.**
   - **Draw:** press *Start drawing* and draw on the workspace with a mouse, pen or finger.
   - **Examples:** pick a built-in shape (heart, star, square, ellipse, figure eight, an SVG-path fish, a flower).
   - **SVG import:** upload an `.svg` file and choose which path or subpath to reconstruct.
2. **Choose N**, the number of retained components, with the slider, the number field or the −/+ buttons. **Choose M**, the number of input samples, in the M field; it is applied on Enter or blur.
3. **Choose a selection mode.** *Largest |cₖ|* is the default; *contiguous band* keeps the lowest frequencies.
4. **Animate.** Play or pause, restart, and set the speed. Each visual layer has its own toggle. With the workspace focused, Space toggles play/pause and R restarts.
5. **Inspect and export.** The coefficient table can be sorted and can show retained or all coefficients. It can be copied to the clipboard as TSV, or exported as CSV or JSON. Exports always use full precision.

### Drawing closure policy

- If a stroke ends inside the green snap circle around the starting point, the curve is closed automatically and processed. The snap radius is max(18 px, 6 % of the drawn length).
- Otherwise the draft stays open and the status shows the gap. From there you can:
  - continue drawing (strokes are joined in order),
  - undo the last stroke,
  - press **Close curve**, which adds an explicit straight closing segment.
- A curve becomes processable at ≥ 8 distinct points and ≥ 40 px length.
- **Restore previous curve** undoes the last committed curve (the last 20 are kept).
- Preprocessing warns when the implicit closing segment is longer than 25 % of the perimeter.

## Mathematics

### Conventions

| Symbol | Meaning |
|---|---|
| z(t) = x(t) + i·y(t) | the curve as a complex periodic function, t ∈ [0, 2π), with **y pointing up** |
| M | number of input samples (arc-length resampled), 16 ≤ M ≤ 4096, default 512 |
| N | number of retained components, 1 ≤ N ≤ M (clamped, never exceeds the available coefficients) |
| k | signed integer frequency; positive = counter-clockwise rotation |
| cₖ | complex coefficient of frequency k |

The transform and its inverse are:

```
cₖ   = (1/M) Σⱼ zⱼ · exp(−i 2π k j / M)          j = 0 … M−1,   tⱼ = 2πj/M
zⱼ   = Σₖ cₖ · exp(i k tⱼ)                         (inverse, all M bins)
z_N(t) = Σ_{k ∈ selected} cₖ · exp(i k t)           (truncated series)
```

- **Bin → frequency:** bin b maps to k = b for b < M/2, and to k = b − M otherwise. For even M, the Nyquist bin M/2 is reported as **k = −M/2**, which is the same convention as NumPy's `fftfreq`. On the sample grid, e^{+i(M/2)t} and e^{−i(M/2)t} coincide, so samples are reproduced exactly either way.
- **Algorithm:** an iterative radix-2 FFT when M is a power of two, and a direct O(M²) DFT with an exact twiddle table otherwise. Tests check that the two agree.
- **Angles:** all angles are in radians. Phases are arg(cₖ) ∈ (−π, π]. Degrees are available as a display option only.

### Frequency selection (deterministic)

- **Largest |cₖ|:** coefficients are ranked by magnitude. Ties are broken first by smaller |k|, then by +k before −k. Magnitudes are quantised to 10⁻¹² · max|c| before comparison, which keeps the order transitive.
- **Contiguous:** the order is 0, +1, −1, +2, −2, … So odd N gives the symmetric band −n…n, and even N adds the next positive frequency.
- **Real-valued signals:** these only arise when the curve lies on the real axis. In that case ±k pairs are kept together so the reconstruction stays real. If the last free slot can't take a pair, the best remaining singleton (k = 0 or Nyquist) is used.
- **General complex curves:** conjugate symmetry is **not** imposed, because x and y together form one complex signal.
- **Epicycle order:** k = 0 comes first (the stationary anchor), then descending magnitude with the same tie rule.

### Preprocessing (`curve-preprocessing.ts`)

The steps run in this order:

1. Drop non-finite points and consecutive duplicates, including a trailing copy of the first point.
2. Require at least 3 distinct points and a non-zero extent.
3. Treat the curve as closed.
4. Resample by **arc length** to M equally spaced points. Event timing is never assumed to be uniform.
5. Translate the samples' centroid to 0.
6. Flip y so it points up.
7. Scale uniformly so the farthest sample has |z| = 1. This preserves the aspect ratio.

The transform (centroid and scale) is kept and exported, so coefficients can be mapped back to input units: x = centroid.x + Re(z)/scale, y = centroid.y − Im(z)/scale.

### Error metrics (`curve-error.ts`)

The metrics compare each sample zⱼ with the reconstruction at the **same parameter** tⱼ. They are reported in normalised units, with RMSE also shown in input units:

- MSE = (1/M) Σ|zⱼ − ẑⱼ|²
- RMSE = √MSE
- Max = maxⱼ |zⱼ − ẑⱼ|
- energy kept = Σ_retained|cₖ|² / Σ|cₖ|²
- a plot of error versus t

These are parameter-space errors, not the minimum geometric (Hausdorff-type) distance between the shapes.

By Parseval's theorem, MSE equals the energy of the excluded coefficients exactly. So MSE and RMSE never increase as N grows. The maximum pointwise error and the visual quality can still fluctuate, because ringing near corners moves around as terms are added.

## SVG support

The file is parsed with `DOMParser('image/svg+xml')` into an inert document. Nothing is inserted into the page and no scripts run. Only geometry attributes are read, and files over 5 MB are rejected.

**Supported elements:**

- `path`
- `polygon`
- `polyline` (treated as open)
- `rect` (square corners; `rx`/`ry` are ignored, with a warning)
- `circle`
- `ellipse`

`transform` attributes on the element and its ancestors are applied: `matrix`, `translate`, `scale`, `rotate` (including the centre form), `skewX` and `skewY`.

**Supported path commands, absolute and relative:**

| Command | Meaning |
|---|---|
| `M m` | move-to; extra pairs are treated as implicit line-to |
| `L l` | line-to |
| `H h` | horizontal line |
| `V v` | vertical line |
| `C c` | cubic Bézier |
| `S s` | smooth cubic (reflected control point) |
| `Q q` | quadratic Bézier |
| `T t` | smooth quadratic |
| `A a` | elliptical arc, endpoint → centre conversion per the SVG implementation notes, with radius correction and compact flags |
| `Z z` | close path |

Compact number syntax (`1e-3`, `-5.5.5`, signs used as separators) is accepted.

**Subpaths:** every subpath (each `M`, or a drawing command after `Z`) is offered as a **separate candidate**. Subpaths are not merged. A subpath without `Z` whose end does not meet its start is marked *(open)*; if you select it, a straight closing segment is added. Closed candidates are listed first.

**Not supported:**

- `<use>`, `<text>`, `<image>`, `<line>` and `<foreignObject>` are ignored, and a warning is shown.
- Content inside `<defs>`, `<clipPath>`, `<mask>`, `<symbol>`, `<pattern>` and `<marker>` is ignored.
- CSS transforms and stylesheet geometry are not applied.
- The root `viewBox` is not applied. This does not affect the result after normalisation, as long as the mapping preserves the aspect ratio.
- A malformed path is skipped with a message that gives the error position. Other shapes in the file are still offered.

## Architecture

```
src/app/
  core/
    models/            complex-number, curve-sample, fourier-coefficient (incl. settings, metrics, animation state)
    math/              complex-number.ts            Complex class: add, sub, mul, scale, div, conj, abs, arg, expi, fromPolar
                       fourier-transform.ts         FFT / DFT, bin↔frequency, spectrum, inverse on the sample grid
                       fourier-reconstruction.ts    selection modes, series evaluation, epicycle joints, dense curve
                       curve-preprocessing.ts       duplicate removal, validation, arc-length resampling, normalisation
                       curve-error.ts               MSE / RMSE / max error / energy
    svg/               svg-path-parser.ts (pure), svg-import.ts (DOMParser + transforms)
    examples/          example input curves (inputs only — nothing downstream is hard-coded)
    export/            JSON / CSV coefficient export
    state/             studio-store.ts (signal pipeline), drawing-session.ts (freehand draft + closure policy)
  features/
    curve-input/  fourier-canvas/  fourier-controls/  coefficient-inspector/  reconstruction-metrics/
  shared/              format helpers, components/help-panel
  app.component.*
```

### The math engine

The engine is plain TypeScript functions with no Angular imports, so it can be reused or tested on its own. I used pure modules rather than injectable services because there is no state to inject.

### State and caching

`StudioStore` chains memoised `computed` signals:

```
raw curve + M → preprocessing → spectrum (DFT/FFT)
spectrum + N + mode → selection → packed vectors / dense curve / grid reconstruction / metrics
```

Changing N, the mode or any display option never re-runs the DFT.

### Rendering

The canvas renders in a `requestAnimationFrame` loop outside Angular's reactive graph, and the app is zoneless.

- Each frame evaluates the epicycle chain into a reused `Float64Array`, so there are no allocations per frame.
- The progress indicator is written straight to the DOM.
- Canvas size follows a `ResizeObserver`, and the backing store is scaled by `devicePixelRatio`.
- The animation frame is cancelled on destroy.
- The full reconstructed curve and its trail come from a zero-padded inverse FFT with no aliasing: R ≥ 4·max|k| + 4.

### Forms

N, M and the selection mode use typed reactive `FormControl`s with validation. The N slider and the number field share one control and are kept in sync.

## Tests

There are 59 tests across 4 spec files: 15 in `svg-import.spec.ts`, 2 in `app.component.spec.ts`, and the rest in `complex-number.spec.ts` and `fourier-engine.spec.ts`.

- **`complex-number.spec.ts`** covers every complex operation, including Euler's formula and division.
- **`fourier-engine.spec.ts`:**
  - **Required cases:**
    1. unit circle
    2. translated circle
    3. ellipse (c₁ = (a+b)/2, c₋₁ = (a−b)/2)
    4. square: only k ≡ 1 (mod 4)
    5. non-symmetric curve
    6. duplicate points
    7. too few points
    8. large M (4096 by FFT, 3000 by DFT)
    9. all bins reproduce the samples for even and odd M
    10. a single coefficient gives a circle
  - **Conventions:** FFT agrees with DFT, the defining formula, Parseval, and the forward/inverse round trip.
  - **Indexing:** negative frequencies and the Nyquist bin.
  - **Selection:** tie-breaking, contiguous ordering, clamping, and the real-signal symmetric selection.
  - **Epicycles:** the endpoint equals the series value; vectors have constant length and rotate by k·Δt.
  - **Dense curve:** agrees with the grid synthesis.
  - **Metrics:** MSE equals the excluded energy and is non-increasing in N.
- **`svg-import.spec.ts`** covers every path command (absolute and relative), smooth reflections, arcs, compact syntax, subpaths, errors, transforms, safe import with an embedded `<script>`, arc-length spacing and aspect ratio.
- **`app.component.spec.ts`** checks that the inspector shows the coefficient computed by an independent transform, and that N clamping and reset-to-defaults keep the curve.
