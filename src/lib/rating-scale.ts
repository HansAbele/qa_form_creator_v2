/** Visual tier for a rating value, driving the color scale in the UI. */
export type RatingTier = "rose" | "amber" | "green";

export function ratingTier(value: number, max = 5): RatingTier {
  const fraction = value / max;
  if (fraction < 0.5) return "rose";
  if (fraction < 0.75) return "amber";
  return "green";
}

const LABELS_5 = ["Deficiente", "Malo", "Regular", "Bueno", "Excelente"];

export function ratingLabel(value: number, max = 5, labels?: string[] | null): string {
  if (labels?.[value - 1]) return labels[value - 1];
  if (max === 5) return LABELS_5[value - 1] ?? String(value);
  return `${value} / ${max}`;
}

export const RATING_TIER_CLASSES: Record<RatingTier, { active: string; text: string }> = {
  rose: {
    active: "border-destructive bg-destructive text-destructive-foreground",
    text: "text-destructive",
  },
  amber: {
    active: "border-warning bg-warning text-warning-foreground",
    text: "text-warning",
  },
  green: {
    active: "border-success bg-success text-success-foreground",
    text: "text-success",
  },
};
