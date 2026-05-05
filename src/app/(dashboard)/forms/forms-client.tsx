"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, FileText, Pencil, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { deleteForm } from "@/server/actions/forms";

interface FormItem {
  id: string;
  title: string;
  description: string | null;
  campaignName: string;
  questionCount: number;
  responseCount: number;
  createdAt: string;
  canEvaluate: boolean;
  canEdit: boolean;
}

interface FormsListClientProps {
  forms: FormItem[];
  canCreate: boolean;
}

export function FormsListClient({ forms, canCreate }: FormsListClientProps) {
  const router = useRouter();

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Formularios</h1>
        {canCreate && (
          <Button render={<Link href="/forms/new" />}>
            <Plus className="mr-1 h-4 w-4" />
            Nuevo formulario
          </Button>
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
                  <Badge variant="secondary">{form.campaignName}</Badge>
                </div>
                {form.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {form.description}
                  </p>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{form.questionCount} preguntas</span>
                  <span>{form.responseCount} evaluaciones</span>
                </div>
                <div className="mt-4 flex gap-2">
                  {form.canEvaluate && (
                    <Button render={<Link href={`/forms/${form.id}`} />} variant="outline" size="sm" className="flex-1">
                      Evaluar
                    </Button>
                  )}
                  {form.canEdit && (
                    <>
                      <Button render={<Link href={`/forms/${form.id}/edit`} />} variant="ghost" size="icon-sm">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(form.id, form.title)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </>
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
