"use client";

import type { LucideIcon } from "lucide-react";
import { Filter, Megaphone, Sparkles, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { DateRangeFilter } from "@/components/filters/date-range-filter";
import { FilterSelect } from "@/components/filters/filter-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { useChartAnimation } from "@/components/ui/use-chart-animation";
import { formatDateOnlyForDisplay } from "@/lib/date-display";

// ─── Chart configs (theme-aware via CSS vars) ─────────────
export const TREND_CONFIG = {
  count: { label: "Evaluaciones", color: "#ff6600" },
  avgScore: { label: "Score Promedio", color: "#1a2b45" },
} satisfies ChartConfig;

export const DIST_CONFIG = {
  count: { label: "Evaluaciones", color: "#ff6600" },
} satisfies ChartConfig;

export const BAR_COLORS = [
  "#F2621A", // brand orange
  "#0FA3BF", // cyan
  "#12A277", // green
  "#E8931A", // amber
  "#7A5AF8", // purple
  "#0E1A2C", // navy
];

// ─── Section fade + slide wrapper ─────────────────────────
export function Section({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function EmptyState({ label = "Sin datos" }: { label?: string }) {
  return (
    <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

// ─── Context bar (header + campaign select + date filter) ─
export function ContextBar({
  title,
  subtitle,
  icon: Icon = Sparkles,
  campaigns,
  campaignId,
  onCampaignChange,
  dateFrom,
  dateTo,
  onApplyDates,
  showCampaignFilter = true,
}: {
  title: string;
  subtitle: React.ReactNode;
  icon?: LucideIcon;
  campaigns: { id: string; name: string }[];
  campaignId: string;
  onCampaignChange: (id: string) => void;
  dateFrom: string;
  dateTo: string;
  onApplyDates: (from: string, to: string) => void;
  showCampaignFilter?: boolean;
}) {
  const campaignOptions = [
    { value: "all", label: "Todas" },
    ...campaigns.map((campaign) => ({ value: campaign.id, label: campaign.name })),
  ];
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div>
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-orange-500" />
            <h1 className="font-heading text-3xl font-bold tracking-tight">{title}</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {showCampaignFilter && campaigns.length > 1 ? (
            <FilterSelect
              id="dashboard-campaign"
              label="Campaña"
              value={campaignId || "all"}
              options={campaignOptions}
              onValueChange={(value) => onCampaignChange(value === "all" ? "" : value)}
              placeholder="Todas"
              icon={Megaphone}
              className="w-full sm:w-44"
            />
          ) : null}
          <DateRangeFilter
            id="dashboard-period"
            from={dateFrom}
            to={dateTo}
            onApply={onApplyDates}
            className="w-full sm:w-auto"
            triggerClassName="sm:w-auto"
          />
        </div>
      </motion.div>

      {campaignId && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="flex items-center gap-2"
        >
          <button
            type="button"
            onClick={() => onCampaignChange("")}
            className="group inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-500/20 dark:text-violet-300"
          >
            <Filter className="h-3 w-3" />
            <span>
              Filtrando por:{" "}
              <span className="font-semibold">
                {campaigns.find((c) => c.id === campaignId)?.name ?? "Campaña"}
              </span>
            </span>
            <X className="h-3 w-3 transition-transform group-hover:scale-125" />
          </button>
        </motion.div>
      )}
    </>
  );
}

// ─── Score distribution bar card (shared) ─────────────────
export function DistributionCard({
  title = "Distribución de scores",
  data,
}: {
  title?: string;
  data: { range: string; count: number }[];
}) {
  const chartAnimation = useChartAnimation();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.some((d) => d.count > 0) ? (
          <ChartContainer
            config={DIST_CONFIG}
            accessibilityLabel={title}
            accessibilityDescription={data
              .map((item) => `${item.range}: ${item.count} evaluaciones`)
              .join("; ")}
            className="h-[250px] w-full"
          >
            <BarChart data={data}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="range"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                className="text-xs"
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                className="text-xs"
              />
              <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
              <Bar
                dataKey="count"
                fill="#ff6600"
                radius={[6, 6, 0, 0]}
                animationDuration={900}
                isAnimationActive={chartAnimation}
              />
            </BarChart>
          </ChartContainer>
        ) : (
          <EmptyState />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Score trend line card with target reference line ─────
export function ScoreTrendCard({
  trends,
  targetAvgScore,
  icon: Icon,
}: {
  trends: { date: string; avgScore: number }[];
  targetAvgScore: number;
  icon?: LucideIcon;
}) {
  const chartAnimation = useChartAnimation();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {Icon ? <Icon className="h-4 w-4 text-slate-600 dark:text-slate-400" /> : null}
          Tendencia de score promedio
        </CardTitle>
      </CardHeader>
      <CardContent>
        {trends.length > 0 ? (
          <ChartContainer
            config={TREND_CONFIG}
            accessibilityLabel="Tendencia de score promedio"
            accessibilityDescription={`${trends
              .map(
                (item) =>
                  `${formatDateOnlyForDisplay(item.date)}: ${item.avgScore.toFixed(1)}%`,
              )
              .join("; ")}. Target: ${targetAvgScore}%.`}
            className="h-[250px] w-full"
          >
            <LineChart data={trends}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(v) =>
                  formatDateOnlyForDisplay(String(v), { day: "2-digit", month: "short" })
                }
                className="text-xs"
              />
              <YAxis
                domain={[0, 100]}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                className="text-xs"
              />
              <ReferenceLine
                y={targetAvgScore}
                stroke="#12A277"
                strokeDasharray="4 4"
                label={{
                  value: `Target ${targetAvgScore}%`,
                  position: "insideTopRight",
                  fill: "#12A277",
                  fontSize: 11,
                }}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="line"
                    labelFormatter={(label) => formatDateOnlyForDisplay(String(label))}
                    formatter={(value) => [`${Number(value).toFixed(1)}%`, "Score"]}
                  />
                }
              />
              <Line
                type="monotone"
                dataKey="avgScore"
                stroke="#1a2b45"
                strokeWidth={2.5}
                dot={{ r: 3, fill: "#1a2b45" }}
                activeDot={{ r: 5 }}
                animationDuration={1000}
                isAnimationActive={chartAnimation}
              />
            </LineChart>
          </ChartContainer>
        ) : (
          <EmptyState />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Evaluations volume trend (coverage signal) ──────────
export function VolumeTrendCard({
  trends,
  icon: Icon,
}: {
  trends: { date: string; count: number }[];
  icon?: LucideIcon;
}) {
  const chartAnimation = useChartAnimation();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {Icon ? <Icon className="h-4 w-4 text-orange-500" /> : null}
          Tendencia de evaluaciones
        </CardTitle>
      </CardHeader>
      <CardContent>
        {trends.length > 0 ? (
          <ChartContainer
            config={TREND_CONFIG}
            accessibilityLabel="Tendencia de evaluaciones"
            accessibilityDescription={trends
              .map(
                (item) => `${formatDateOnlyForDisplay(item.date)}: ${item.count} evaluaciones`,
              )
              .join("; ")}
            className="h-[250px] w-full"
          >
            <AreaChart data={trends}>
              <defs>
                <linearGradient id="fillVolume" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ff6600" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#ff6600" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(v) =>
                  formatDateOnlyForDisplay(String(v), { day: "2-digit", month: "short" })
                }
                className="text-xs"
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                className="text-xs"
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    labelFormatter={(label) => formatDateOnlyForDisplay(String(label))}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#ff6600"
                strokeWidth={2}
                fill="url(#fillVolume)"
                animationDuration={1000}
                isAnimationActive={chartAnimation}
              />
            </AreaChart>
          </ChartContainer>
        ) : (
          <EmptyState />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Full-screen spinner ─────────────────────────────────
export function DashboardSpinner() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-[50vh] items-center justify-center"
    >
      <motion.div
        aria-hidden="true"
        animate={shouldReduceMotion ? undefined : { rotate: 360 }}
        transition={shouldReduceMotion ? undefined : { duration: 1.2, repeat: Infinity, ease: "linear" }}
        className="h-8 w-8 rounded-full border-2 border-orange-500/30 border-t-orange-500"
      />
      <span className="sr-only">Cargando dashboard</span>
    </div>
  );
}
