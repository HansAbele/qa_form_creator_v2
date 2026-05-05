import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getCampaignsForPermission } from "@/server/actions/campaigns";
import { FormBuilder } from "@/components/forms/form-builder";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";

export default async function NewFormPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasAnyCampaignPermission("canCreateForms"))) redirect("/forms");
  const campaigns = await getCampaignsForPermission("canCreateForms");

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Nuevo Formulario</h1>
      <FormBuilder
        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
