export function isChartAnimationActive(prefersReducedMotion: boolean | null): boolean {
  return prefersReducedMotion !== true;
}
