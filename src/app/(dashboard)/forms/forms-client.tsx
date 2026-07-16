"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, FileText, Pencil, Plus, Send, Trash2 } from "lucide-react";
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

interface FormsListClientProps {
  forms: FormItem[];
  canCreate: boolean;
}

export function FormsListClient({ forms, canCreate }: FormsListClientProps) {
  const router = useRouter();

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
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {form.description}
                  </p>
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
