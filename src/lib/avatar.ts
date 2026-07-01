/**
 * Deterministic avatar helpers.
 * The tint encodes AGENT IDENTITY (a stable per-person color), never data —
 * so the same agent always renders the same soft chip across the app.
 */

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h << 5) - h + seed.charCodeAt(i);
    h |= 0; // force 32-bit
  }
  return Math.abs(h);
}

/**
 * A soft, identity-stable tint. Returns a light pastel background with a
 * readable saturated foreground — reads as a colored chip on both light and
 * dark surfaces (it is deliberately theme-independent).
 */
export function agentTint(seed: string): { bg: string; fg: string } {
  const hue = hashSeed(seed || "?") % 360;
  return {
    bg: `hsl(${hue} 70% 88%)`,
    fg: `hsl(${hue} 55% 30%)`,
  };
}
