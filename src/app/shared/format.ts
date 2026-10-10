/** Fixed-point formatting for display only; values stay full precision internally. */
export function formatFixed(value: number, digits: number): string {
  if (!Number.isFinite(value)) return '—';
  // Avoid showing "-0.000" for values that round to zero.
  const s = value.toFixed(digits);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s.replace('-', '−');
}

/** Compact scientific/fixed formatting for metrics spanning many magnitudes. */
export function formatMetric(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs < 1e-3 || abs >= 1e5) return value.toExponential(digits - 1).replace('-', '−');
  return value.toPrecision(digits);
}
