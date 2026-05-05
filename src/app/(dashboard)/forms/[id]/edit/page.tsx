import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getFormByIdForPermission } from "@/server/actions/forms";
import { getCampaignsForPermission } from "@/server/actions/campaigns";
import { FormBuilder } from "@/components/forms/form-builder";
import { hasAnyCampaignPermission } from "@/server/queries/ui-access";

export default async function EditFormPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await hasAnyCampaignPermission("canEditForms"))) redirect("/forms");
  const { id } = await params;
  const [form, campaigns] = await Promise.all([
    getFormByIdForPermission(id, "canEditForms"),
    getCampaignsForPermission("canEditForms"),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Editar Formulario</h1>
      <FormBuilder
        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
        initialData={form}
      />
    </div>
  );
}
