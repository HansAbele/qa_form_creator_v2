import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getFormCreationCampaigns } from "@/server/actions/campaigns";
import { getForms } from "@/server/actions/forms";
import { getAccessibleEvaluationDrafts } from "@/server/queries/drafts";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";
import { FormsListClient } from "./forms-client";

export default async function FormsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasAnyCampaignPermission("canViewForms"))) redirect("/settings");

  const [forms, creatableCampaigns, evaluationDrafts] = await Promise.all([
    getForms(),
    getFormCreationCampaigns(),
    getAccessibleEvaluationDrafts(),
  ]);
  const isAdmin = session.user.role === "ADMIN";
  const isSupervisor = session.user.role === "SUPERVISOR";
  return (
    <FormsListClient
      forms={forms.map((f) => ({
        id: f.id,
        title: f.title,
        description: f.description,
        campaignName: f.campaign.name,
        status: f.status,
        templateKey: f.templateKey,
        questionCount: f._count.questions,
        canEvaluate:
          f.status === "PUBLISHED" &&
          f.campaign.active &&
          !isSupervisor &&
          (isAdmin || Boolean(f.campaign.users[0]?.canEvaluate)),
        canEdit:
          !isSupervisor &&
          (isAdmin ||
            (f.createdById === session.user.id && Boolean(f.campaign.users[0]?.canEditForms))),
        canPublish:
          !isSupervisor &&
          (isAdmin ||
            (f.createdById === session.user.id && Boolean(f.campaign.users[0]?.canPublishForms))),
      }))}
      evaluationDrafts={evaluationDrafts.map((draft) => ({
        id: draft.id,
        formId: draft.formId,
        formTitle: draft.formTitle,
        campaignName: draft.campaignName,
        agentName: draft.agentName,
        agentCode: draft.agentCode,
        evaluatorName: draft.evaluatorName,
        updatedAt: draft.updatedAt.toISOString(),
        isOwn: draft.isOwn,
      }))}
      canCreate={!isSupervisor && (isAdmin || creatableCampaigns.length > 0)}
    />
  );
}
