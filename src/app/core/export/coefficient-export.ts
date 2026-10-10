import { CurveTransform } from '../models/curve-sample.model';
import { CoefficientSelection, FourierSpectrum } from '../models/fourier-coefficient.model';

export interface ExportContext {
  readonly spectrum: FourierSpectrum;
  readonly selection: CoefficientSelection;
  readonly transform: CurveTransform;
  readonly curveLabel: string;
}

/** Full-precision JSON export of the whole spectrum with the retained flags. */
export function coefficientsToJson(ctx: ExportContext): string {
  const { spectrum, selection, transform } = ctx;
  const payload = {
    format: 'fourier-curve-studio/coefficients@1',
    curve: ctx.curveLabel,
    conventions: {
      series: 'z(t) = sum_k c_k * exp(i k t), t in [0, 2*pi)',
      dft: 'c_k = (1/M) * sum_{j=0}^{M-1} z_j * exp(-i 2 pi k j / M)',
      coordinates:
        'normalised: z = scale * ((x - centroid.x) - i (y - centroid.y)), input y axis points down, z imaginary axis points up',
      phaseUnit: 'radians',
      nyquist: 'for even M, bin M/2 is reported as k = -M/2',
    },
    sampleCount: spectrum.sampleCount,
    componentCount: selection.retained.length,
    selectionMode: selection.mode,
    transform,
    coefficients: spectrum.coefficients
      .map((c) => ({
        k: c.k,
        re: c.re,
        im: c.im,
        magnitude: c.magnitude,
        phase: c.phase,
        retained: selection.retainedBins.has(c.bin),
        selectionRank: selection.rankByBin[c.bin] >= 0 ? selection.rankByBin[c.bin] + 1 : null,
      }))
      .sort((a, b) => a.k - b.k),
  };
  return JSON.stringify(payload, null, 2);
}

function escapeCsv(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** CSV export (full precision, round-trippable numbers). */
export function coefficientsToCsv(ctx: ExportContext): string {
  const header = ['k', 're', 'im', 'magnitude', 'phase_rad', 'retained', 'selection_rank'];
  const rows = [...ctx.spectrum.coefficients]
    .sort((a, b) => a.k - b.k)
    .map((c) => {
      const rank = ctx.selection.rankByBin[c.bin];
      return [
        String(c.k),
        String(c.re),
        String(c.im),
        String(c.magnitude),
        String(c.phase),
        ctx.selection.retainedBins.has(c.bin) ? 'true' : 'false',
        rank >= 0 ? String(rank + 1) : '',
      ].map(escapeCsv).join(',');
    });
  return [header.join(','), ...rows].join('\n') + '\n';
}
