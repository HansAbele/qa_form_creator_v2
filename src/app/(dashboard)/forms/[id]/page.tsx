import { auth } from "@/lib/auth";
import { getPassThresholdForCampaign } from "@/lib/settings";
import { redirect } from "next/navigation";
import { getFormByIdForPermission } from "@/server/actions/forms";
import { getResponseById } from "@/server/actions/responses";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";
import { FormViewer } from "@/components/forms/form-viewer";

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
  const form = await getFormByIdForPermission(id, canEvaluate ? "canEvaluate" : "canViewForms");
  const passThreshold = await getPassThresholdForCampaign(form.campaignId);
  const initialResponse = sp.responseId ? await getResponseById(sp.responseId) : null;

  if (initialResponse && initialResponse.formId !== id) redirect(`/forms/${id}`);
  if (initialResponse?.status === "CANCELLED") {
    redirect(`/analytics/responses/${initialResponse.id}`);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        {initialResponse?.status === "SUBMITTED" ? "Editar evaluacion" : "Nueva evaluacion"}
      </h1>
      <FormViewer
        form={form}
        passThreshold={passThreshold}
        initialResponse={
          initialResponse
            ? {
                id: initialResponse.id,
                status: initialResponse.status,
                agentId: initialResponse.agentId,
                dispositionId: initialResponse.dispositionId,
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
