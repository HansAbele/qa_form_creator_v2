import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getFormById } from "@/server/actions/forms";
import { FormViewer } from "@/components/forms/form-viewer";

export default async function FormEvaluatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  const form = await getFormById(id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Nueva Evaluación</h1>
      <FormViewer form={form} />
    </div>
  );
}
