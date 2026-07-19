import { redirect } from "next/navigation";
import { EvaluationsListClient } from "@/components/evaluations/evaluations-list-client";
import { auth } from "@/lib/auth";
import { reportOperationalError } from "@/lib/observability";
import {
  getEvaluationHistoryCampaigns,
  getOwnEvaluationHistoryCampaigns,
} from "@/server/actions/campaigns";
import {
  type EvaluationHistoryFilterOptions,
  type EvaluationHistoryScope,
  getEvaluationHistory,
  getEvaluationHistoryFilterOptions,
} from "@/server/queries/analytics";
import { getCurrentUserUiAccess } from "@/server/queries/ui-access";

export default async function EvaluationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    scope?: string;
    minScore?: string;
    maxScore?: string;
    campaignId?: string;
    dateFrom?: string;
    dateTo?: string;
    status?: string;
    agentId?: string;
    evaluatorId?: string;
    formId?: string;
    dispositionId?: string;
    fatalOnly?: string;
    page?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [access, query] = await Promise.all([getCurrentUserUiAccess(), searchParams]);
  const canViewOwn = access.isAdmin || access.canViewDashboard;
  const canViewManaged = access.isAdmin || access.canViewEvaluations;
  if (!canViewOwn && !canViewManaged) redirect("/settings");

  const requestedScope: EvaluationHistoryScope =
    query.scope === "own" ? "own" : query.scope === "managed" ? "managed" : "managed";
  const initialScope: EvaluationHistoryScope =
    requestedScope === "own" && canViewOwn
      ? "own"
      : requestedScope === "managed" && canViewManaged
        ? "managed"
        : canViewManaged
          ? "managed"
          : "own";

  const emptyFilterOptions: EvaluationHistoryFilterOptions = {
    agents: [],
    evaluators: [],
    forms: [],
    dispositions: [],
  };
  const [ownCampaigns, managedCampaigns, loadedFilterOptions] = await Promise.all([
    canViewOwn ? getOwnEvaluationHistoryCampaigns() : Promise.resolve([]),
    canViewManaged ? getEvaluationHistoryCampaigns() : Promise.resolve([]),
    getEvaluationHistoryFilterOptions(initialScope),
  ]);
  const ownFilterOptions = initialScope === "own" ? loadedFilterOptions : emptyFilterOptions;
  const managedFilterOptions =
    initialScope === "managed" ? loadedFilterOptions : emptyFilterOptions;
  const initialCampaigns = initialScope === "managed" ? managedCampaigns : ownCampaigns;
  const initialFilterOptions = initialScope === "managed" ? managedFilterOptions : ownFilterOptions;
  const initialCampaignId = initialCampaigns.some((campaign) => campaign.id === query.campaignId)
    ? query.campaignId
    : undefined;
  const belongsToInitialCampaign = (campaignId: string) =>
    !initialCampaignId || campaignId === initialCampaignId;
  const initialAgentId = initialFilterOptions.agents.some(
    (option) => option.id === query.agentId && belongsToInitialCampaign(option.campaignId),
  )
    ? query.agentId
    : undefined;
  const initialEvaluatorId =
    initialScope === "managed" &&
    initialFilterOptions.evaluators.some(
      (option) =>
        option.id === query.evaluatorId &&
        (!initialCampaignId || option.campaignIds.includes(initialCampaignId)),
    )
      ? query.evaluatorId
      : undefined;
  const initialFormId = initialFilterOptions.forms.some(
    (option) => option.id === query.formId && belongsToInitialCampaign(option.campaignId),
  )
    ? query.formId
    : undefined;
  const initialDispositionId = initialFilterOptions.dispositions.some(
    (option) => option.id === query.dispositionId && belongsToInitialCampaign(option.campaignId),
  )
    ? query.dispositionId
    : undefined;
  const parsedPage = Number(query.page);
  const initialPage =
    Number.isInteger(parsedPage) && parsedPage > 0 && parsedPage <= 10_000 ? parsedPage : 1;
  const parseScore = (value: string | undefined) => {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : undefined;
  };
  const initialMinScore = parseScore(query.minScore);
  const initialMaxScore = parseScore(query.maxScore);
  const initialResultStatus =
    query.status?.trim().toUpperCase() === "PASS"
      ? "PASS"
      : query.status?.trim().toUpperCase() === "FAIL"
        ? "FAIL"
        : undefined;
  const initialFatalOnly = query.fatalOnly === "true" || query.fatalOnly === "1";
  let initialData: Awaited<ReturnType<typeof getEvaluationHistory>> | null = null;
  let initialLoadStatus: "success" | "empty" | "error" = "error";
  let resolvedInitialPage = initialPage;

  try {
    const initialFilters = {
      scope: initialScope,
      minScore: initialMinScore,
      maxScore: initialMaxScore,
      campaignId: initialCampaignId,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      resultStatus: initialResultStatus,
      agentId: initialAgentId,
      evaluatorId: initialEvaluatorId,
      formId: initialFormId,
      dispositionId: initialDispositionId,
      fatalOnly: initialFatalOnly,
      pageSize: 25,
    } satisfies Omit<Parameters<typeof getEvaluationHistory>[0], "page">;
    initialData = await getEvaluationHistory({ ...initialFilters, page: resolvedInitialPage });
    if (initialData.page > initialData.totalPages) {
      resolvedInitialPage = initialData.totalPages;
      initialData = await getEvaluationHistory({ ...initialFilters, page: resolvedInitialPage });
    }
    initialLoadStatus = initialData.summary.totalEvaluations === 0 ? "empty" : "success";
  } catch (error) {
    const reason = error instanceof Error ? error : new Error("Unknown evaluation history error");
    await reportOperationalError({
      source: "next-server",
      name: reason.name,
      message: `evaluation-history-initial: ${reason.message}`,
      stack: reason.stack,
      routePath: "/evaluations",
      userId: session.user.id,
      metadata: { scope: initialScope },
    });
  }

  return (
    <EvaluationsListClient
      initialData={initialData}
      initialLoadStatus={initialLoadStatus}
      ownCampaigns={ownCampaigns}
      managedCampaigns={managedCampaigns}
      ownFilterOptions={ownFilterOptions}
      managedFilterOptions={managedFilterOptions}
      ownFilterOptionsLoaded={initialScope === "own" || !canViewOwn}
      managedFilterOptionsLoaded={initialScope === "managed" || !canViewManaged}
      canViewOwn={canViewOwn}
      canViewManaged={canViewManaged}
      initialScope={initialScope}
      initialMinScore={initialMinScore}
      initialMaxScore={initialMaxScore}
      initialCampaignId={initialCampaignId}
      initialDateFrom={query.dateFrom}
      initialDateTo={query.dateTo}
      initialResultStatus={initialResultStatus}
      initialAgentId={initialAgentId}
      initialEvaluatorId={initialEvaluatorId}
      initialFormId={initialFormId}
      initialDispositionId={initialDispositionId}
      initialFatalOnly={initialFatalOnly}
      initialPage={resolvedInitialPage}
    />
  );
}
