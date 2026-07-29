"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Trash2 } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { parseOfficialQuestionLabel } from "@/lib/official-form-templates";
import { cn } from "@/lib/utils";
import { isScoredQuestionType, QUESTION_TYPE_LABELS } from "@/types/form-builder";
import type { QuestionData } from "./question-panel";

interface QuestionRowProps {
  question: QuestionData;
  index: string;
  active: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

/** Compact read-only question row; click (or the pencil) opens it in the panel. */
export function QuestionRow({ question, index, active, onEdit, onDelete }: QuestionRowProps) {
  const { t } = useI18n();
  const officialMetadata = parseOfficialQuestionLabel(question.label);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: question.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 rounded-lg border bg-card px-2.5 py-2 transition-colors",
        active ? "border-primary ring-1 ring-primary" : "border-border hover:border-border-strong",
      )}
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground hover:text-foreground"
        aria-label={t("Reorder question")}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <span className="w-8 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
        {index}
      </span>

      <button
        type="button"
        onClick={onEdit}
        className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left"
      >
        <span className="line-clamp-1 text-[13.5px] font-semibold text-foreground">
          {officialMetadata.label.trim() || (
            <span className="italic text-muted-foreground">{t("No text")}</span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-1">
          <Badge variant="secondary" className="text-[10px]">
            {t(QUESTION_TYPE_LABELS[question.type])}
          </Badge>
          {officialMetadata.checkpoint && (
            <Badge variant="secondary" className="text-[10px]">
              {t("Procedure check")}
            </Badge>
          )}
          {officialMetadata.partsWarranty && (
            <Badge className="bg-[#2E75B6] text-[10px] text-white hover:bg-[#2E75B6]">
              P&amp;W
            </Badge>
          )}
          {isScoredQuestionType(question.type) && (
            <Badge variant="outline" className="text-[10px] tabular-nums">
              {t("Weight {weight}%", { weight: question.weight })}
            </Badge>
          )}
          {question.fatal && (
            <Badge variant="destructive" className="text-[10px]">
              {t("Critical")}
            </Badge>
          )}
          {question.required && (
            <Badge variant="outline" className="text-[10px]">
              {t("Required")}
            </Badge>
          )}
        </span>
      </button>

      <Button type="button" variant="ghost" size="icon-xs" onClick={onEdit} aria-label={t("Edit")}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onDelete}
        aria-label={t("Delete")}
      >
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  );
}
