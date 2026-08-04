"use client";

import { Archive, FileText, Pencil, Plus, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formDisplayName } from "@/lib/form-display-name";
import { cn } from "@/lib/utils";
import { archiveForm, deleteForm, publishForm } from "@/server/actions/forms";

interface FormItem {
  id: string;
  title: string;
  description: string | null;
  campaignName: string;
  status: string;
  templateKey: string | null;
  questionCount: number;
  canEvaluate: boolean;
  canEdit: boolean;
  canPublish: boolean;
}

interface FormsListClientProps {
  forms: FormItem[];
  canCreate: boolean;
}

export function FormsListClient({ forms, canCreate }: FormsListClientProps) {
  const { t } = useI18n();
  const router = useRouter();

  const statusLabel = (status: string) => {
    switch (status) {
      case "PUBLISHED":
        return t("Published");
      case "ARCHIVED":
        return t("Archived");
      default:
        return t("Draft");
    }
  };

  const statusVariant = (status: string): "default" | "secondary" | "outline" => {
    if (status === "PUBLISHED") return "default";
    if (status === "ARCHIVED") return "outline";
    return "secondary";
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(t('Delete "{title}"?', { title }))) return;
    try {
      await deleteForm(id);
      toast.success(t("Form deleted"));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? t(error.message) : t("Unable to delete form"));
    }
  };

  const handlePublish = async (id: string, title: string) => {
    if (!confirm(t('Publish "{title}" for evaluations?', { title }))) return;
    try {
      await publishForm(id);
      toast.success(t("Form published"));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? t(error.message) : t("Unable to publish form"));
    }
  };

  const handleArchive = async (id: string, title: string) => {
    if (!confirm(t('Archive "{title}" and remove it from future evaluations?', { title }))) return;
    try {
      await archiveForm(id);
      toast.success(t("Form archived"));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? t(error.message) : t("Unable to archive form"));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t("Forms")}</h1>
        {canCreate && (
          <Link href="/forms/new" className={cn(buttonVariants())}>
            <Plus className="mr-1 h-4 w-4" />
            {t("New Form")}
          </Link>
        )}
      </div>

      {forms.length === 0 ? (
        <div className="flex h-64 items-center justify-center rounded-lg border border-dashed">
          <div className="text-center">
            <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <p className="mt-2 text-muted-foreground">{t("No forms available")}</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {forms.map((form) => (
            <Card key={form.id} className="group relative">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base">{formDisplayName(form.title)}</CardTitle>
                  <Badge variant={statusVariant(form.status)}>{statusLabel(form.status)}</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{form.campaignName}</Badge>
                  {form.templateKey && (
                    <Badge className="bg-[#003366] text-white hover:bg-[#003366]">
                      {t("Official template")}
                    </Badge>
                  )}
                </div>
                {form.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{form.description}</p>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex items-center text-sm text-muted-foreground">
                  <span>
                    {form.questionCount === 1
                      ? t("1 question")
                      : t("{count} questions", { count: form.questionCount })}
                  </span>
                </div>
                <div className="mt-4 flex gap-2">
                  {form.canEvaluate && form.status === "PUBLISHED" && (
                    <Link
                      href={`/forms/${form.id}`}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "flex-1")}
                    >
                      {t("Evaluate")}
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
                      {t("Publish")}
                    </Button>
                  )}
                  {form.canEdit && (
                    <Link
                      href={`/forms/${form.id}/edit`}
                      aria-label={t("Edit {title}", { title: form.title })}
                      className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
                    >
                      <Pencil className="h-4 w-4" />
                    </Link>
                  )}
                  {form.status === "PUBLISHED" && form.canPublish && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("Archive {title}", { title: form.title })}
                      onClick={() => {
                        handleArchive(form.id, form.title);
                      }}
                    >
                      <Archive className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                  {form.status !== "PUBLISHED" && form.canEdit && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("Delete {title}", { title: form.title })}
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
