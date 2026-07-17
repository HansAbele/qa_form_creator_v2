import { redirect } from "next/navigation";
import { EvaluationsListClient } from "@/components/evaluations/evaluations-list-client";
import { auth } from "@/lib/auth";
import {
  getEvaluationHistoryCampaigns,
  getOwnEvaluationHistoryCampaigns,
} from "@/server/actions/campaigns";
import {
  type EvaluationHistoryFilterOptions,
  type EvaluationHistoryScope,
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

  return (
    <EvaluationsListClient
      ownCampaigns={ownCampaigns}
      managedCampaigns={managedCampaigns}
      ownFilterOptions={ownFilterOptions}
      managedFilterOptions={managedFilterOptions}
      ownFilterOptionsLoaded={initialScope === "own" || !canViewOwn}
      managedFilterOptionsLoaded={initialScope === "managed" || !canViewManaged}
      canViewOwn={canViewOwn}
      canViewManaged={canViewManaged}
      initialScope={initialScope}
      initialMinScore={query.minScore}
      initialMaxScore={query.maxScore}
      initialCampaignId={initialCampaignId}
      initialDateFrom={query.dateFrom}
      initialDateTo={query.dateTo}
      initialResultStatus={query.status}
      initialAgentId={initialAgentId}
      initialEvaluatorId={initialEvaluatorId}
      initialFormId={initialFormId}
      initialDispositionId={initialDispositionId}
      initialFatalOnly={query.fatalOnly === "true" || query.fatalOnly === "1"}
      initialPage={initialPage}
    />
  );
}
