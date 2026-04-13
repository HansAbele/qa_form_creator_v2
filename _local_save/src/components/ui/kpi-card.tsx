"use client";

import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "./animated-number";

type Tone = "orange" | "navy" | "emerald" | "amber" | "rose" | "violet";

const TONES: Record<
  Tone,
  {
    ring: string;
    glow: string;
    icon: string;
    iconBg: string;
    accent: string;
    chart: string;
  }
> = {
  orange: {
    ring: "ring-orange-500/20",
    glow: "from-orange-500/15",
    icon: "text-orange-600 dark:text-orange-400",
    iconBg: "bg-orange-500/10",
    accent: "bg-orange-500",
    chart: "#ff6600",
  },
  navy: {
    ring: "ring-slate-600/20",
    glow: "from-slate-700/15",
    icon: "text-slate-700 dark:text-slate-300",
    iconBg: "bg-slate-500/10",
    accent: "bg-slate-700",
    chart: "#1a2b45",
  },
  emerald: {
    ring: "ring-emerald-500/20",
    glow: "from-emerald-500/15",
    icon: "text-emerald-600 dark:text-emerald-400",
    iconBg: "bg-emerald-500/10",
    accent: "bg-emerald-500",
    chart: "#10b981",
  },
  amber: {
    ring: "ring-amber-500/20",
    glow: "from-amber-500/15",
    icon: "text-amber-600 dark:text-amber-400",
    iconBg: "bg-amber-500/10",
    accent: "bg-amber-500",
    chart: "#f59e0b",
  },
  rose: {
    ring: "ring-rose-500/20",
    glow: "from-rose-500/15",
    icon: "text-rose-600 dark:text-rose-400",
    iconBg: "bg-rose-500/10",
    accent: "bg-rose-500",
    chart: "#f43f5e",
  },
  violet: {
    ring: "ring-violet-500/20",
    glow: "from-violet-500/15",
    icon: "text-violet-600 dark:text-violet-400",
    iconBg: "bg-violet-500/10",
    accent: "bg-violet-500",
    chart: "#8b5cf6",
  },
};

interface KpiCardProps {
  label: string;
  value: number;
  suffix?: string;
  prefix?: string;
  decimals?: number;
  icon: LucideIcon;
  tone?: Tone;
  trend?: { value: number }[];
  delta?: number; // percent change vs previous period
  index?: number; // for staggered entry animation
}

export function KpiCard({
  label,
  value,
  suffix = "",
  prefix = "",
  decimals = 0,
  icon: Icon,
  tone = "orange",
  trend,
  delta,
  index = 0,
}: KpiCardProps) {
  const T = TONES[tone];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        delay: index * 0.08,
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      className={cn(
        "group relative overflow-hidden rounded-xl bg-card ring-1 transition-shadow",
        "hover:shadow-lg hover:shadow-foreground/5",
        T.ring,
      )}
    >
      {/* Gradient glow accent */}
      <div
        className={cn(
          "pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-gradient-to-br to-transparent blur-2xl transition-opacity group-hover:opacity-100",
          T.glow,
          "opacity-70",
        )}
      />

      {/* Left accent bar */}
      <div className={cn("absolute left-0 top-0 h-full w-[3px]", T.accent)} />

      <div className="relative flex items-start justify-between gap-3 p-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <div className="flex items-baseline gap-2">
            <AnimatedNumber
              value={value}
              decimals={decimals}
              prefix={prefix}
              suffix={suffix}
              className="font-heading text-2xl font-semibold tabular-nums tracking-tight text-foreground"
            />
            {typeof delta === "number" && (
              <span
                className={cn(
                  "text-xs font-medium tabular-nums",
                  delta >= 0 ? "text-emerald-600" : "text-rose-600",
                )}
              >
                {delta >= 0 ? "+" : ""}
                {delta.toFixed(1)}%
              </span>
            )}
          </div>

          {/* Mini sparkline */}
          {trend && trend.length > 1 && (
            <div className="mt-2 h-8 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend}>
                  <defs>
                    <linearGradient
                      id={`spark-${tone}-${index}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor={T.chart} stopOpacity={0.4} />
                      <stop
                        offset="100%"
                        stopColor={T.chart}
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={T.chart}
                    strokeWidth={1.5}
                    fill={`url(#spark-${tone}-${index})`}
                    isAnimationActive={true}
                    animationDuration={900}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-foreground/5",
            T.iconBg,
          )}
        >
          <Icon className={cn("h-5 w-5", T.icon)} />
        </div>
      </div>
    </motion.div>
  );
}
