import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getCampaigns } from "@/server/actions/campaigns";
import { FormBuilder } from "@/components/forms/form-builder";

export default async function NewFormPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Both QA and ADMIN can create forms

  const campaigns = await getCampaigns();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Nuevo Formulario</h1>
      <FormBuilder
        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
