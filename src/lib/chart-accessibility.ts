const DEFAULT_VISIBLE_ITEMS = 10;

/**
 * Builds a bounded, screen-reader-friendly data summary for a visual chart.
 * Long series retain both ends so trends keep their temporal context.
 */
export function summarizeChartData(
  items: readonly string[],
  maxVisibleItems = DEFAULT_VISIBLE_ITEMS,
) {
  const normalizedItems = items.map((item) => item.trim()).filter(Boolean);
  if (normalizedItems.length === 0) return "Sin datos.";

  const limit = Math.max(2, Math.floor(maxVisibleItems));
  if (normalizedItems.length <= limit) {
    return `${normalizedItems.length} puntos de datos: ${normalizedItems.join("; ")}.`;
  }

  const firstCount = Math.ceil(limit / 2);
  const lastCount = Math.floor(limit / 2);
  const omittedCount = normalizedItems.length - firstCount - lastCount;
  const firstItems = normalizedItems.slice(0, firstCount);
  const lastItems = normalizedItems.slice(-lastCount);

  return `${normalizedItems.length} puntos de datos: ${firstItems.join("; ")}; se omiten ${omittedCount} puntos intermedios; ${lastItems.join("; ")}.`;
}
