"use client";

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
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/components/providers/i18n-provider";
import { useOperationalTimeZone } from "@/components/providers/operational-time-provider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatOperationalTimestamp } from "@/lib/date-display";
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

interface EvaluationDraftItem {
  id: string;
  formId: string;
  formTitle: string;
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
  const { locale, t } = useI18n();
  const operationalTimeZone = useOperationalTimeZone();
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
                  <p className="truncate text-sm text-muted-foreground">{draft.formTitle}</p>
                </div>
                <Badge variant={draft.isOwn ? "secondary" : "outline"}>
                  {draft.isOwn ? t("Mine") : t("Managed")}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{draft.campaignName}</Badge>
                {draft.agentCode && <span>{t("Agent {code}", { code: draft.agentCode })}</span>}
                {!draft.isOwn && (
                  <span>{t("Evaluator: {name}", { name: draft.evaluatorName })}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" />
                <span>{t("Updated")}</span>
                <time dateTime={draft.updatedAt} suppressHydrationWarning>
                  {formatOperationalTimestamp(
                    draft.updatedAt,
                    operationalTimeZone,
                    { dateStyle: "medium", timeStyle: "short" },
                    locale === "es" ? "es-ES" : "en-US",
                  )}
                </time>
              </div>
              <Link
                href={`/forms/${draft.formId}?responseId=${draft.id}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}
              >
                {draft.isOwn ? t("Continue draft") : t("Manage draft")}
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function FormsListClient({ forms, evaluationDrafts, canCreate }: FormsListClientProps) {
  const { t } = useI18n();
  const router = useRouter();
  const ownDrafts = evaluationDrafts.filter((draft) => draft.isOwn);
  const manageableDrafts = evaluationDrafts.filter((draft) => !draft.isOwn);

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

      {evaluationDrafts.length > 0 && (
        <section aria-labelledby="evaluation-drafts-heading" className="space-y-4">
          <div>
            <h2
              id="evaluation-drafts-heading"
              className="flex items-center gap-2 font-heading text-xl font-semibold"
            >
              <ClipboardPenLine className="h-5 w-5 text-primary" />
              {t("Evaluation Drafts")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                "Resume pending evaluations or manage drafts under your responsibility. Up to 50 recent drafts are shown.",
              )}
            </p>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <EvaluationDraftGroup
              title={t("My drafts")}
              description={t("Evaluations you started and can continue.")}
              drafts={ownDrafts}
            />
            <EvaluationDraftGroup
              title={t("Managed drafts")}
              description={t(
                "Evaluations from other QA specialists that you can correct or complete.",
              )}
              drafts={manageableDrafts}
            />
          </div>
        </section>
      )}

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
                  <CardTitle className="text-base">{form.title}</CardTitle>
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
