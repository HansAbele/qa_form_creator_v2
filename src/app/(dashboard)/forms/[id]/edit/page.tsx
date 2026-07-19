import { redirect } from "next/navigation";
import { FormBuilder } from "@/components/forms/form-builder";
import { auth } from "@/lib/auth";
import { getServerI18n } from "@/lib/i18n-server";
import { getFormEditingCampaigns } from "@/server/actions/campaigns";
import { getFormForEditing } from "@/server/actions/forms";
import { readActiveQACategoriesForFormEditing } from "@/server/actions/qa-categories";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";

export default async function EditFormPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasAnyCampaignPermission("canEditForms"))) redirect("/forms");
  const { id } = await params;
  const [form, campaigns, qaCategories] = await Promise.all([
    getFormForEditing(id),
    getFormEditingCampaigns(),
    readActiveQACategoriesForFormEditing(),
  ]);
  const { t } = await getServerI18n();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">{t("Edit Form")}</h1>
      <FormBuilder
        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
        qaCategories={qaCategories}
        initialData={form}
      />
    </div>
  );
}
