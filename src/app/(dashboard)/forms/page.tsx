import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getForms } from "@/server/actions/forms";
import { getFormCreationCampaigns } from "@/server/actions/campaigns";
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
        version: f.version,
        publishedAt: f.publishedAt?.toISOString() ?? null,
        questionCount: f._count.questions,
        createdAt: f.createdAt.toISOString(),
        canEvaluate:
          f.campaign.active &&
          !isSupervisor &&
          (isAdmin || Boolean(f.campaign.users[0]?.canEvaluate)),
        canEdit: !isSupervisor && (isAdmin || Boolean(f.campaign.users[0]?.canEditForms)),
        canPublish: !isSupervisor && (isAdmin || Boolean(f.campaign.users[0]?.canPublishForms)),
      }))}
      evaluationDrafts={evaluationDrafts.map((draft) => ({
        ...draft,
        updatedAt: draft.updatedAt.toISOString(),
      }))}
      canCreate={!isSupervisor && (isAdmin || creatableCampaigns.length > 0)}
    />
  );
}
