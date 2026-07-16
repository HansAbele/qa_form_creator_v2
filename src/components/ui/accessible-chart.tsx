"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function AccessibleChart({
  label,
  description,
  children,
  className,
}: {
  label: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  const descriptionId = useId();

  return (
    <div
      role="img"
      aria-label={label}
      aria-describedby={descriptionId}
      className={cn("w-full", className)}
    >
      <span id={descriptionId} className="sr-only">
        {description}
      </span>
      {children}
    </div>
  );
}
