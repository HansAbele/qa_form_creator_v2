"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Archive,
  ClipboardPenLine,
  Clock3,
  FileText,
  Pencil,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { archiveForm, deleteForm, publishForm } from "@/server/actions/forms";
import { cn } from "@/lib/utils";

interface FormItem {
  id: string;
  title: string;
  description: string | null;
  campaignName: string;
  status: string;
  version: string;
  publishedAt: string | null;
  questionCount: number;
  createdAt: string;
  canEvaluate: boolean;
  canEdit: boolean;
  canPublish: boolean;
}

interface EvaluationDraftItem {
  id: string;
  formId: string;
  formTitle: string;
  formVersion: string | null;
  campaignName: string;
  agentName: string;
  agentCode: string | null;
  evaluatorName: string;
  updatedAt: string;
  isOwn: boolean;
}

interface FormsListClientProps {
  forms: FormItem[];
  evaluationDrafts: EvaluationDraftItem[];
  canCreate: boolean;
}

function EvaluationDraftGroup({
  title,
  description,
  drafts,
}: {
  title: string;
  description: string;
  drafts: EvaluationDraftItem[];
}) {
  if (drafts.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-heading font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Badge variant="secondary">{drafts.length}</Badge>
      </div>
      <div className="space-y-3">
        {drafts.map((draft) => (
          <Card key={draft.id} className="bg-muted/20">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{draft.agentName}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {draft.formTitle}
                    {draft.formVersion && ` · v${draft.formVersion}`}
                  </p>
                </div>
                <Badge variant={draft.isOwn ? "secondary" : "outline"}>
                  {draft.isOwn ? "Propio" : "Administrable"}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{draft.campaignName}</Badge>
                {draft.agentCode && <span>Agente {draft.agentCode}</span>}
                {!draft.isOwn && <span>Evaluador: {draft.evaluatorName}</span>}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" />
                <span>Actualizado</span>
                <time dateTime={draft.updatedAt} suppressHydrationWarning>
                  {new Date(draft.updatedAt).toLocaleString("es-ES", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
              </div>
              <Link
                href={`/forms/${draft.formId}?responseId=${draft.id}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}
              >
                {draft.isOwn ? "Continuar borrador" : "Gestionar borrador"}
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function FormsListClient({ forms, evaluationDrafts, canCreate }: FormsListClientProps) {
  const router = useRouter();
  const ownDrafts = evaluationDrafts.filter((draft) => draft.isOwn);
  const manageableDrafts = evaluationDrafts.filter((draft) => !draft.isOwn);

  const statusLabel = (status: string) => {
    switch (status) {
      case "PUBLISHED":
        return "Publicado";
      case "ARCHIVED":
        return "Archivado";
      default:
        return "Borrador";
    }
  };

  const statusVariant = (status: string): "default" | "secondary" | "outline" => {
    if (status === "PUBLISHED") return "default";
    if (status === "ARCHIVED") return "outline";
    return "secondary";
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`¿Estás seguro de eliminar "${title}"?`)) return;
    try {
      await deleteForm(id);
      toast.success("Formulario eliminado");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al eliminar");
    }
  };

  const handlePublish = async (id: string, title: string) => {
    if (!confirm(`Publicar "${title}" para evaluaciones?`)) return;
    try {
      await publishForm(id);
      toast.success("Formulario publicado");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al publicar");
    }
  };

  const handleArchive = async (id: string, title: string) => {
    if (!confirm(`Archivar "${title}" y retirarlo de evaluaciones futuras?`)) return;
    try {
      await archiveForm(id);
      toast.success("Formulario archivado");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al archivar");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Formularios</h1>
        {canCreate && (
          <Link href="/forms/new" className={cn(buttonVariants())}>
            <Plus className="mr-1 h-4 w-4" />
            Nuevo formulario
          </Link>
        )}
      </div>

      {evaluationDrafts.length > 0 && (
        <section aria-labelledby="evaluation-drafts-heading" className="space-y-4">
          <div>
            <h2
              id="evaluation-drafts-heading"
              className="flex items-center gap-2 font-heading text-xl font-semibold"
            >
              <ClipboardPenLine className="h-5 w-5 text-primary" />
              Borradores de evaluación
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Retoma tus evaluaciones pendientes o gestiona las que están bajo tu responsabilidad.
              Se muestran hasta 50 borradores recientes.
            </p>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <EvaluationDraftGroup
              title="Mis borradores"
              description="Evaluaciones que comenzaste y puedes continuar."
              drafts={ownDrafts}
            />
            <EvaluationDraftGroup
              title="Borradores administrables"
              description="Evaluaciones de otros QA que puedes corregir o completar."
              drafts={manageableDrafts}
            />
          </div>
        </section>
      )}

      {forms.length === 0 ? (
        <div className="flex h-64 items-center justify-center rounded-lg border border-dashed">
          <div className="text-center">
            <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <p className="mt-2 text-muted-foreground">No hay formularios disponibles</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {forms.map((form) => (
            <Card key={form.id} className="group relative">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base">{form.title}</CardTitle>
                  <Badge variant={statusVariant(form.status)}>{statusLabel(form.status)}</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{form.campaignName}</Badge>
                  <Badge variant="outline">v{form.version}</Badge>
                </div>
                {form.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{form.description}</p>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex items-center text-sm text-muted-foreground">
                  <span>{form.questionCount} preguntas</span>
                </div>
                <div className="mt-4 flex gap-2">
                  {form.canEvaluate && form.status === "PUBLISHED" && (
                    <Link
                      href={`/forms/${form.id}`}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1")}
                    >
                      Evaluar
                    </Link>
                  )}
                  {form.canPublish && form.status === "DRAFT" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => handlePublish(form.id, form.title)}
                    >
                      <Send className="mr-1 h-3.5 w-3.5" />
                      Publicar
                    </Button>
                  )}
                  {form.canEdit && (
                    <Link
                      href={`/forms/${form.id}/edit`}
                      aria-label={`Editar ${form.title}`}
                      className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
                    >
                      <Pencil className="h-4 w-4" />
                    </Link>
                  )}
                  {form.status === "PUBLISHED" && form.canPublish && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleArchive(form.id, form.title)}
                    >
                      <Archive className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                  {form.status !== "PUBLISHED" && form.canEdit && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleDelete(form.id, form.title)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
