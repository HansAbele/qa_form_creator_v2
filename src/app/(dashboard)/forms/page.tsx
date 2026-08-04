import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getFormCreationCampaigns } from "@/server/actions/campaigns";
import { getForms } from "@/server/actions/forms";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";
import { FormsListClient } from "./forms-client";

export default async function FormsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasAnyCampaignPermission("canViewForms"))) redirect("/settings");

  const [forms, creatableCampaigns] = await Promise.all([getForms(), getFormCreationCampaigns()]);
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
        canEdit: !isSupervisor && (isAdmin || Boolean(f.campaign.users[0]?.canEditForms)),
        canPublish:
          !isSupervisor &&
          (isAdmin ||
            (f.createdById === session.user.id && Boolean(f.campaign.users[0]?.canPublishForms))),
      }))}
      canCreate={!isSupervisor && (isAdmin || creatableCampaigns.length > 0)}
    />
  );
}
