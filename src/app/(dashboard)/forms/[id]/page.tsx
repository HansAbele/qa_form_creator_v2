import { redirect } from "next/navigation";
import { FormViewer } from "@/components/forms/form-viewer";
import { auth } from "@/lib/auth";
import { getServerI18n } from "@/lib/i18n-server";
import { resolveResponseScoringPolicy } from "@/lib/response-scoring-policy";
import { getCampaignScoringSettings } from "@/lib/settings";
import { getFormForEvaluation, getFormForEvaluationCorrection } from "@/server/actions/forms";
import { getResponseById } from "@/server/actions/responses";
import {
  getInteractionForEvaluation,
  getInteractionForResponse,
} from "@/server/queries/call-finder";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";

export default async function FormEvaluatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ responseId?: string; interactionId?: string }>;
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

  const form = initialResponse
    ? await getFormForEvaluationCorrection(id)
    : await getFormForEvaluation(id);
  const linkedInteraction = initialResponse?.interactionId
    ? await getInteractionForResponse(initialResponse.interactionId, id, initialResponse.id)
    : sp.interactionId
      ? await getInteractionForEvaluation(sp.interactionId, id)
      : null;

  if ((initialResponse?.interactionId || sp.interactionId) && !linkedInteraction) {
    redirect("/call-finder");
  }
  if (!initialResponse && linkedInteraction?.response) {
    redirect(`/evaluations/${linkedInteraction.response.id}`);
  }

  const scoringSettings = await getCampaignScoringSettings(form.campaignId);
  const viewerScoringPolicy = resolveResponseScoringPolicy(initialResponse, {
    ...scoringSettings,
    passThreshold: form.passThresholdOverride ?? scoringSettings.passThreshold,
  });
  const { t } = await getServerI18n();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        {initialResponse?.status === "SUBMITTED" ? t("Edit Evaluation") : t("New Evaluation")}
      </h1>
      <FormViewer
        key={initialResponse?.id ?? `new:${form.id}:${linkedInteraction?.id ?? "manual"}`}
        form={form}
        passThreshold={viewerScoringPolicy.passThreshold}
        fatalZeroesScore={viewerScoringPolicy.fatalZeroesScore}
        linkedInteraction={
          linkedInteraction
            ? {
                id: linkedInteraction.id,
                provider: linkedInteraction.provider,
                providerInteractionId: linkedInteraction.providerInteractionId,
                direction: linkedInteraction.direction,
                phoneNumber: linkedInteraction.phoneNumber,
                queueName: linkedInteraction.queueName,
                startedAt: linkedInteraction.startedAt,
                durationSeconds: linkedInteraction.durationSeconds,
                status: linkedInteraction.status,
                endedBy: linkedInteraction.endedBy,
                campaignName: form.campaign.name,
                dispositionName: linkedInteraction.disposition?.name ?? null,
                callMetadata: linkedInteraction.callMetadata,
                audioUrl: linkedInteraction.audioUrl,
                recordingExpected: linkedInteraction.hasRecording,
                transcript: linkedInteraction.transcript,
                transcriptionJob: linkedInteraction.transcriptionJob,
                agent: linkedInteraction.agent
                  ? {
                      id: linkedInteraction.agent.id,
                      name: linkedInteraction.agent.name,
                      agentCode: linkedInteraction.agent.agentCode,
                    }
                  : null,
                disposition: linkedInteraction.disposition
                  ? {
                      id: linkedInteraction.disposition.id,
                      name: linkedInteraction.disposition.name,
                      code: linkedInteraction.disposition.code,
                      category: null,
                    }
                  : null,
              }
            : null
        }
        initialResponse={
          initialResponse
            ? {
                id: initialResponse.id,
                updatedAt: initialResponse.updatedAt.toISOString(),
                status: initialResponse.status,
                agentId: initialResponse.agentId,
                agent: {
                  id: initialResponse.agent.id,
                  name: initialResponse.agent.name,
                  agentCode: initialResponse.agent.agentCode,
                },
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
