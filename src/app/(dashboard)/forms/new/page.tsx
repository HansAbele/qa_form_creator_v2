import { redirect } from "next/navigation";
import { FormBuilder } from "@/components/forms/form-builder";
import { auth } from "@/lib/auth";
import { getServerI18n } from "@/lib/i18n-server";
import { getFormCreationCampaigns } from "@/server/actions/campaigns";
import { readActiveQACategoriesForFormCreation } from "@/server/actions/qa-categories";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";

export default async function NewFormPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasAnyCampaignPermission("canCreateForms"))) redirect("/forms");
  const [campaigns, qaCategories] = await Promise.all([
    getFormCreationCampaigns(),
    readActiveQACategoriesForFormCreation(),
  ]);
  const { t } = await getServerI18n();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">{t("New Form")}</h1>
      <FormBuilder
        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
        qaCategories={qaCategories}
      />
    </div>
  );
}
