export type MetricLoadStatus = "loading" | "success" | "empty" | "error";

export type MetricDisplayState = "loading" | "ready" | "no-data" | "unavailable";

export type MetricDisplay = {
  state: MetricDisplayState;
  text: string | null;
};

type MetricDisplayOptions = {
  kind: "count" | "measure";
  value: number | null | undefined;
  hasData: boolean;
  status: MetricLoadStatus;
  decimals?: number;
  suffix?: string;
};

/**
 * Keeps KPI cards explicit in every state.
 *
 * Counts truthfully resolve to zero for an empty sample. Averages and rates do
 * not: zero would be a fabricated measurement, so they render an em dash.
 */
export function getMetricDisplay({
  kind,
  value,
  hasData,
  status,
  decimals = 0,
  suffix = "",
}: MetricDisplayOptions): MetricDisplay {
  if (status === "loading") return { state: "loading", text: null };
  if (status === "error") return { state: "unavailable", text: "—" };

  if (!hasData) {
    return {
      state: "no-data",
      text: kind === "count" ? "0" : "—",
    };
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { state: "unavailable", text: "—" };
  }

  const normalized = Object.is(value, -0) ? 0 : value;
  return {
    state: "ready",
    text: `${normalized.toFixed(decimals)}${suffix}`,
  };
}
