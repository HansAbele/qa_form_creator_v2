"use client";

import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { isScoredQuestionType, type RatingStyleValue } from "@/types/form-builder";
import type { QuestionType } from "@prisma/client";
import { RatingScale } from "./rating-scale";

interface QuestionRendererProps {
  question: {
    id: string;
    type: QuestionType;
    label: string;
    options: unknown;
    required: boolean;
    weight: number;
    fatal: boolean;
    fatalOptions: unknown;
    requiresCommentOnFail: boolean;
    formCategory?: {
      qaCategory?: {
        name: string;
      } | null;
    } | null;
  };
  index?: string;
  value: string;
  onChange: (value: string) => void;
  comment?: string;
  onCommentChange?: (value: string) => void;
  notApplicable?: boolean;
  onNotApplicableChange?: (value: boolean) => void;
  error?: string;
  commentError?: string;
  /** Whether the current answer counts as a failure (from the shared engine). */
  failed?: boolean;
  ratingMax?: number;
  ratingStyle?: RatingStyleValue | null;
}

export function QuestionRenderer({
  question,
  index,
  value,
  onChange,
  comment = "",
  onCommentChange,
  notApplicable = false,
  onNotApplicableChange,
  error,
  commentError,
  failed = false,
  ratingMax = 5,
  ratingStyle,
}: QuestionRendererProps) {
  const optionPairs = getOptionPairs(question.options);
  const fatalOptions = getStringOptions(question.fatalOptions);
  const showComment = question.fatal || question.requiresCommentOnFail;
  const showFatalNotice = !notApplicable && failed && question.fatal;

  return (
    <div
      className={cn(
        "space-y-3 rounded-xl border bg-card p-4 transition-colors",
        showFatalNotice ? "border-destructive/60" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Label className="font-semibold">
          {index && <span className="mr-1.5 text-muted-foreground tabular-nums">{index}</span>}
          {question.label}
          {question.required && <span className="ml-1 text-destructive">*</span>}
        </Label>
        {isScoredQuestionType(question.type) && question.weight > 0 && (
          <Badge variant="outline" className="text-xs">
            Peso {question.weight}%
          </Badge>
        )}
        {question.fatal && (
          <Badge variant="destructive" className="text-xs">
            Fatal
          </Badge>
        )}
        {question.requiresCommentOnFail && (
          <Badge variant="outline" className="text-xs">
            Comentario si falla
          </Badge>
        )}
        {!notApplicable && failed && (
          <Badge variant="destructive" className="text-xs uppercase tracking-wide">
            Fallo
          </Badge>
        )}
        {notApplicable && (
          <Badge variant="secondary" className="text-xs">
            N/A
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            id={`${question.id}-not-applicable`}
            checked={notApplicable}
            onCheckedChange={(checked) => onNotApplicableChange?.(checked === true)}
          />
          <Label htmlFor={`${question.id}-not-applicable`} className="text-xs font-normal">
            No aplica
          </Label>
        </div>
      </div>

      {question.type === "TEXT" && (
        <Textarea
          placeholder="Escribe tu respuesta..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={notApplicable}
          rows={3}
          className="resize-none"
        />
      )}

      {question.type === "RATING" && (
        <RatingScale
          value={value}
          max={ratingMax}
          style={ratingStyle}
          disabled={notApplicable}
          onChange={onChange}
        />
      )}

      {question.type === "BOOLEAN" && (
        <div className={cn("flex gap-2", notApplicable && "opacity-50")}>
          {(optionPairs.length > 0
            ? optionPairs
            : [
                { label: "Si", value: "Si" },
                { label: "No", value: "No" },
              ]
          ).map((opt) => {
            const isFatalOption = fatalOptions.includes(opt.value);
            const isSelected = value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={notApplicable}
                onClick={() => onChange(opt.value)}
                className={cn(
                  "flex-1 rounded-lg border-2 px-4 py-2.5 text-sm font-semibold transition-all disabled:cursor-not-allowed",
                  isSelected && isFatalOption && "border-destructive bg-destructive text-destructive-foreground",
                  isSelected && !isFatalOption && "border-success bg-success text-success-foreground",
                  !isSelected && "border-border bg-card text-foreground hover:border-border-strong",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {(question.type === "SELECT" || question.type === "RADIO") && (
        <Select value={value} onValueChange={(v) => v && onChange(v)} disabled={notApplicable}>
          <SelectTrigger
            className={cn("w-full", failed && "border-destructive text-destructive")}
          >
            <SelectValue placeholder="Seleccionar..." />
          </SelectTrigger>
          <SelectContent>
            {optionPairs.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
                {fatalOptions.includes(opt.value) && (
                  <span className="ml-1.5 text-xs text-destructive">· fatal</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {showFatalNotice && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" />
          {question.type === "RATING"
            ? "Esta calificacion cuenta como falla fatal."
            : "Esta opcion cuenta como falla fatal."}
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {showComment && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">
            Comentario QA
            {failed && question.requiresCommentOnFail && (
              <span className="ml-1 text-destructive">*</span>
            )}
          </Label>
          <Textarea
            placeholder="Agrega contexto para esta regla..."
            value={comment}
            onChange={(event) => onCommentChange?.(event.target.value)}
            rows={2}
            className={cn(
              "resize-none",
              commentError && "border-destructive",
            )}
          />
          {commentError && <p className="text-sm text-destructive">{commentError}</p>}
        </div>
      )}
    </div>
  );
}

function getStringOptions(options: unknown): string[] {
  return Array.isArray(options)
    ? options
        .map((option) =>
          typeof option === "string"
            ? option
            : option && typeof option === "object" && "value" in option
              ? String((option as { value: unknown }).value)
              : "",
        )
        .map((option) => option.trim())
        .filter(Boolean)
    : [];
}

function getOptionPairs(options: unknown): { label: string; value: string }[] {
  if (!Array.isArray(options)) return [];
  return options
    .map((option) => {
      if (typeof option === "string") return { label: option.trim(), value: option.trim() };
      if (option && typeof option === "object" && "value" in option) {
        const value = String((option as { value: unknown }).value).trim();
        const label =
          "label" in option ? String((option as { label: unknown }).label).trim() : value;
        return { label: label || value, value };
      }
      return null;
    })
    .filter((pair): pair is { label: string; value: string } => Boolean(pair?.value));
}
