"use client";

import { Star } from "lucide-react";
import { RATING_TIER_CLASSES, ratingLabel, ratingTier } from "@/lib/rating-scale";
import { cn } from "@/lib/utils";
import type { RatingStyleValue } from "@/types/form-builder";

interface RatingScaleProps {
  value: string;
  max?: number;
  style?: RatingStyleValue | null;
  labels?: string[] | null;
  disabled?: boolean;
  onChange: (value: string) => void;
}

/** Accessible 1..max rating control. Numeric colored segments (default) or stars. */
export function RatingScale({ value, max = 5, style, labels, disabled, onChange }: RatingScaleProps) {
  const selected = Number(value) || 0;
  const options = Array.from({ length: max }, (_, i) => i + 1);
  const isStars = style === "stars";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        role="radiogroup"
        aria-label="Calificacion"
        className={cn("flex flex-wrap gap-1.5", disabled && "opacity-50")}
      >
        {options.map((n) => {
          const tier = ratingTier(n, max);
          const isSelected = selected === n;

          if (isStars) {
            const filled = selected >= n;
            const fillTier = ratingTier(selected || 1, max);
            return (
              // biome-ignore lint/a11y/useSemanticElements: custom radiogroup uses buttons with role=radio (ARIA authoring pattern)
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={ratingLabel(n, max, labels)}
                disabled={disabled}
                onClick={() => onChange(String(n))}
                className="rounded p-0.5 transition-transform hover:scale-110 disabled:cursor-not-allowed"
              >
                <Star
                  className={cn(
                    "h-7 w-7 transition-colors",
                    filled
                      ? cn(RATING_TIER_CLASSES[fillTier].text, "fill-current")
                      : "text-muted-foreground/30",
                  )}
                />
              </button>
            );
          }

          return (
            // biome-ignore lint/a11y/useSemanticElements: custom radiogroup uses buttons with role=radio (ARIA authoring pattern)
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={ratingLabel(n, max, labels)}
              disabled={disabled}
              onClick={() => onChange(String(n))}
              className={cn(
                "grid h-[42px] w-[42px] place-items-center rounded-[10px] border-2 font-heading text-[15px] font-bold tabular-nums transition-all disabled:cursor-not-allowed",
                isSelected
                  ? cn(RATING_TIER_CLASSES[tier].active, "shadow-sm")
                  : "border-border bg-card text-muted-foreground hover:border-border-strong",
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
      {selected > 0 && (
        <span className={cn("text-sm font-semibold", RATING_TIER_CLASSES[ratingTier(selected, max)].text)}>
          {ratingLabel(selected, max, labels)}
        </span>
      )}
    </div>
  );
}
