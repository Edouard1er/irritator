// Independent analytic oracle, used only by validation and reports.
export function schaeferOracle(N0, C0, effort, t, q = .001) {
  const alpha = .35 - q * effort, beta = .35 / 300;
  const D = 1 + beta * N0 * (Math.abs(alpha) < 1e-14 ? t : Math.expm1(alpha * t) / alpha);
  return { N: N0 * Math.exp(alpha * t) / D, C: C0 + q * effort * Math.log(D) / beta };
}
export function feedbackOracle(t) {
  const first = schaeferOracle(150, 0, 260, Math.min(t, 1));
  return t <= 1 ? first : schaeferOracle(first.N, first.C, 150, t - 1);
}
