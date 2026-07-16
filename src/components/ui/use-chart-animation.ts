"use client";

import { useReducedMotion } from "motion/react";
import { isChartAnimationActive } from "@/lib/chart-animation";

export function useChartAnimation(): boolean {
  return isChartAnimationActive(useReducedMotion());
}
