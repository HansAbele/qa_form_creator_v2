import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getForms } from "@/server/actions/forms";
import { getCampaignsForPermission } from "@/server/actions/campaigns";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";
import { FormsListClient } from "./forms-client";

export default async function FormsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasAnyCampaignPermission("canViewForms"))) redirect("/settings");

  const [forms, creatableCampaigns] = await Promise.all([
    getForms(),
    getCampaignsForPermission("canCreateForms"),
  ]);
  const isAdmin = session.user.role === "ADMIN";

  return (
    <FormsListClient
      forms={forms.map((f) => ({
        id: f.id,
        title: f.title,
        description: f.description,
        campaignName: f.campaign.name,
        questionCount: f._count.questions,
        responseCount: f._count.responses,
        createdAt: f.createdAt.toISOString(),
        canEvaluate: isAdmin || Boolean(f.campaign.users[0]?.canEvaluate),
        canEdit: isAdmin || Boolean(f.campaign.users[0]?.canEditForms),
      }))}
      canCreate={isAdmin || creatableCampaigns.length > 0}
    />
  );
}
