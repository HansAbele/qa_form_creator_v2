import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getForms } from "@/server/actions/forms";
import { FormsListClient } from "./forms-client";

export default async function FormsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const forms = await getForms();

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
      }))}
      isAdmin={true /* Both QA and ADMIN can manage forms */}
    />
  );
}
