export interface QACategoryMetricInput {
  responseId: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string | null;
  categoryIcon: string | null;
  score: number | null;
  passThreshold: number;
  isFatalFail: boolean;
  comment: string | null;
}

export interface QACategoryMetric {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  totalAnswers: number;
  totalEvaluations: number;
  avgScore: number;
  failedAnswers: number;
  failRate: number;
  fatalFailCount: number;
  commentCount: number;
}

interface QACategoryAccumulator {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  totalAnswers: number;
  scoredAnswers: number;
  scoreTotal: number;
  responseIds: Set<string>;
  failedAnswers: number;
  fatalFailCount: number;
  commentCount: number;
}

function roundPercent(value: number) {
  return Math.round(value * 100) / 100;
}

export function buildQACategoryMetrics(rows: QACategoryMetricInput[]): QACategoryMetric[] {
  const groups = new Map<string, QACategoryAccumulator>();

  for (const row of rows) {
    const hasScore = row.score !== null && !Number.isNaN(row.score);
    if (!hasScore && !row.isFatalFail) continue;

    const current = groups.get(row.categoryId) ?? {
      id: row.categoryId,
      name: row.categoryName,
      color: row.categoryColor,
      icon: row.categoryIcon,
      totalAnswers: 0,
      scoredAnswers: 0,
      scoreTotal: 0,
      responseIds: new Set<string>(),
      failedAnswers: 0,
      fatalFailCount: 0,
      commentCount: 0,
    };

    current.totalAnswers++;
    current.responseIds.add(row.responseId);
    let isFailedAnswer = row.isFatalFail;
    if (hasScore) {
      current.scoredAnswers++;
      current.scoreTotal += row.score ?? 0;
      isFailedAnswer ||= (row.score ?? 0) < row.passThreshold;
    }
    if (isFailedAnswer) current.failedAnswers++;
    if (row.isFatalFail) current.fatalFailCount++;
    if (row.comment?.trim()) current.commentCount++;
    groups.set(row.categoryId, current);
  }

  return Array.from(groups.values())
    .map((group) => ({
      id: group.id,
      name: group.name,
      color: group.color,
      icon: group.icon,
      totalAnswers: group.totalAnswers,
      totalEvaluations: group.responseIds.size,
      avgScore: group.scoredAnswers > 0 ? roundPercent(group.scoreTotal / group.scoredAnswers) : 0,
      failedAnswers: group.failedAnswers,
      failRate: Math.round((group.failedAnswers / group.totalAnswers) * 100),
      fatalFailCount: group.fatalFailCount,
      commentCount: group.commentCount,
    }))
    .sort(
      (a, b) =>
        b.fatalFailCount - a.fatalFailCount ||
        a.avgScore - b.avgScore ||
        b.failedAnswers - a.failedAnswers ||
        b.totalAnswers - a.totalAnswers ||
        a.name.localeCompare(b.name),
    );
}
