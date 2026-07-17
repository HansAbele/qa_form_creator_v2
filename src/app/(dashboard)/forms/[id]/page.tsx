import { redirect } from "next/navigation";
import { FormViewer } from "@/components/forms/form-viewer";
import { auth } from "@/lib/auth";
import { resolveResponseScoringPolicy } from "@/lib/response-scoring-policy";
import { getCampaignScoringSettings } from "@/lib/settings";
import {
  getFormForDraftCorrection,
  getFormForEvaluation,
  getFormForEvaluationCorrection,
} from "@/server/actions/forms";
import { getResponseById } from "@/server/actions/responses";
import { hasCampaignPermissionForUser } from "@/server/queries/campaign-filter";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";

export default async function FormEvaluatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ responseId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const sp = await searchParams;
  const canEvaluate = await hasAnyCampaignPermission("canEvaluate");
  const canEditEvaluations = await hasAnyCampaignPermission("canEditEvaluations");
  if (!canEvaluate && !(sp.responseId && canEditEvaluations)) redirect("/forms");

  const { id } = await params;
  const initialResponse = sp.responseId ? await getResponseById(sp.responseId) : null;

  if (initialResponse && initialResponse.formId !== id) redirect(`/forms/${id}`);
  if (initialResponse?.status === "CANCELLED") {
    redirect(`/evaluations/${initialResponse.id}`);
  }

  const requiresCorrection = Boolean(
    initialResponse &&
      (initialResponse.status === "SUBMITTED" || initialResponse.evaluatorId !== session.user.id),
  );
  const form =
    initialResponse?.status === "SUBMITTED"
      ? await getFormForEvaluationCorrection(id)
      : requiresCorrection
        ? await getFormForDraftCorrection(id)
        : await getFormForEvaluation(id);
  const [scoringSettings, canManageDispositions] = await Promise.all([
    getCampaignScoringSettings(form.campaignId),
    hasCampaignPermissionForUser(session.user, form.campaignId, "canManageDispositions"),
  ]);
  const viewerScoringPolicy = resolveResponseScoringPolicy(initialResponse, scoringSettings);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        {initialResponse?.status === "SUBMITTED" ? "Editar evaluacion" : "Nueva evaluacion"}
      </h1>
      <FormViewer
        key={initialResponse?.id ?? `new:${form.id}`}
        form={form}
        passThreshold={viewerScoringPolicy.passThreshold}
        fatalZeroesScore={viewerScoringPolicy.fatalZeroesScore}
        canManageDispositions={canManageDispositions}
        initialResponse={
          initialResponse
            ? {
                id: initialResponse.id,
                updatedAt: initialResponse.updatedAt.toISOString(),
                status: initialResponse.status,
                agentId: initialResponse.agentId,
                dispositionId: initialResponse.dispositionId,
                agent: {
                  id: initialResponse.agent.id,
                  name: initialResponse.agent.name,
                  agentCode: initialResponse.agent.agentCode,
                },
                disposition: initialResponse.disposition
                  ? {
                      id: initialResponse.disposition.id,
                      name: initialResponse.disposition.name,
                      code: initialResponse.disposition.code,
                      category: null,
                    }
                  : null,
                answers: initialResponse.answers.map((answer) => ({
                  questionId: answer.questionId,
                  value: answer.value,
                  comment: answer.comment,
                  notApplicable: answer.notApplicable,
                })),
              }
            : null
        }
      />
    </div>
  );
}
