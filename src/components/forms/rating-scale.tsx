"use client";

import { Star } from "lucide-react";
import { RATING_TIER_CLASSES, ratingLabel, ratingTier } from "@/lib/rating-scale";
import { cn } from "@/lib/utils";
import type { RatingStyleValue } from "@/types/form-builder";

interface RatingScaleProps {
  id?: string;
  value: string;
  max?: number;
  style?: RatingStyleValue | null;
  labels?: string[] | null;
  disabled?: boolean;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  onChange: (value: string) => void;
}

/** Accessible 1..max rating control. Numeric colored segments (default) or stars. */
export function RatingScale({
  value,
  id,
  max = 5,
  style,
  labels,
  disabled,
  ariaLabelledBy,
  ariaDescribedBy,
  onChange,
}: RatingScaleProps) {
  const selected = Number(value) || 0;
  const options = Array.from({ length: max }, (_, i) => i + 1);
  const isStars = style === "stars";

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const option = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-rating-value]",
    );
    if (!option || !event.currentTarget.contains(option)) return;

    const current = Number(option.dataset.ratingValue);
    if (!Number.isInteger(current)) return;

    let next = current;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = current === max ? 1 : current + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = current === 1 ? max : current - 1;
    else if (event.key === "Home") next = 1;
    else if (event.key === "End") next = max;
    else return;

    event.preventDefault();
    onChange(String(next));
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-rating-value="${next}"]`)?.focus();
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        id={id}
        role="radiogroup"
        aria-label={ariaLabelledBy ? undefined : "Calificación"}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-orientation="horizontal"
        onKeyDown={handleKeyDown}
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
                data-rating-value={n}
                tabIndex={isSelected || (selected === 0 && n === 1) ? 0 : -1}
                disabled={disabled}
                onClick={() => onChange(String(n))}
                className="rounded p-0.5 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed"
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
              data-rating-value={n}
              tabIndex={isSelected || (selected === 0 && n === 1) ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(String(n))}
              className={cn(
                "grid h-[42px] w-[42px] place-items-center rounded-[10px] border-2 font-heading text-[15px] font-bold tabular-nums transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed",
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
        <span
          className={cn(
            "text-sm font-semibold",
            RATING_TIER_CLASSES[ratingTier(selected, max)].text,
          )}
        >
          {ratingLabel(selected, max, labels)}
        </span>
      )}
    </div>
  );
}
