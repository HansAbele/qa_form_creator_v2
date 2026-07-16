"use client";

import type { QuestionType } from "@prisma/client";
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
  const questionLabelId = `${question.id}-label`;
  const answerControlId = `${question.id}-answer`;
  const answerErrorId = `${question.id}-error`;
  const fatalNoticeId = `${question.id}-fatal-notice`;
  const commentControlId = `${question.id}-comment`;
  const commentErrorId = `${question.id}-comment-error`;
  const answerDescription =
    [error ? answerErrorId : null, showFatalNotice ? fatalNoticeId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div
      className={cn(
        "space-y-3 rounded-xl border bg-card p-4 transition-colors",
        showFatalNotice ? "border-destructive/60" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p id={questionLabelId} className="font-semibold">
          {index && <span className="mr-1.5 text-muted-foreground tabular-nums">{index}</span>}
          {question.label}
          {question.required && (
            <>
              <span aria-hidden="true" className="ml-1 text-destructive">
                *
              </span>
              <span className="sr-only"> (obligatoria)</span>
            </>
          )}
        </p>
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
          id={answerControlId}
          aria-labelledby={questionLabelId}
          aria-describedby={answerDescription}
          aria-invalid={Boolean(error)}
          aria-required={question.required && !notApplicable}
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
          id={answerControlId}
          value={value}
          max={ratingMax}
          style={ratingStyle}
          disabled={notApplicable}
          ariaLabelledBy={questionLabelId}
          ariaDescribedBy={answerDescription}
          onChange={onChange}
        />
      )}

      {question.type === "BOOLEAN" && (
        <fieldset
          id={answerControlId}
          aria-labelledby={questionLabelId}
          aria-describedby={answerDescription}
          disabled={notApplicable}
          className={cn("flex gap-2", notApplicable && "opacity-50")}
        >
          <legend className="sr-only">{question.label}</legend>
          {(optionPairs.length > 0
            ? optionPairs
            : [
                { label: "Si", value: "Si" },
                { label: "No", value: "No" },
              ]
          ).map((opt, optionIndex) => {
            const isFatalOption = fatalOptions.includes(opt.value);
            const isSelected = value === opt.value;
            return (
              <label
                key={opt.value}
                className={cn(
                  "flex flex-1 cursor-pointer items-center justify-center rounded-lg border-2 px-4 py-2.5 text-sm font-semibold transition-all focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
                  notApplicable && "cursor-not-allowed",
                  isSelected &&
                    isFatalOption &&
                    "border-destructive bg-destructive text-destructive-foreground",
                  isSelected &&
                    !isFatalOption &&
                    "border-success bg-success text-success-foreground",
                  !isSelected && "border-border bg-card text-foreground hover:border-border-strong",
                )}
              >
                <input
                  id={`${answerControlId}-${optionIndex}`}
                  type="radio"
                  name={`answer-${question.id}`}
                  value={opt.value}
                  checked={isSelected}
                  required={question.required && !notApplicable}
                  aria-invalid={Boolean(error)}
                  onChange={(event) => onChange(event.target.value)}
                  className="sr-only"
                />
                {opt.label}
              </label>
            );
          })}
        </fieldset>
      )}

      {(question.type === "SELECT" || question.type === "RADIO") && (
        <Select value={value} onValueChange={(v) => v && onChange(v)} disabled={notApplicable}>
          <SelectTrigger
            id={answerControlId}
            aria-labelledby={questionLabelId}
            aria-describedby={answerDescription}
            aria-invalid={Boolean(error)}
            aria-required={question.required && !notApplicable}
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
        <p
          id={fatalNoticeId}
          role="alert"
          className="flex items-center gap-1.5 text-xs font-medium text-destructive"
        >
          <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
          {question.type === "RATING"
            ? "Esta calificacion cuenta como falla fatal."
            : "Esta opcion cuenta como falla fatal."}
        </p>
      )}

      {error && (
        <p id={answerErrorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {showComment && (
        <div className="space-y-2">
          <Label htmlFor={commentControlId} className="text-xs text-muted-foreground">
            Comentario QA
            {failed && question.requiresCommentOnFail && (
              <span className="ml-1 text-destructive">*</span>
            )}
          </Label>
          <Textarea
            id={commentControlId}
            aria-describedby={commentError ? commentErrorId : undefined}
            aria-invalid={Boolean(commentError)}
            aria-required={failed && question.requiresCommentOnFail}
            placeholder="Agrega contexto para esta regla..."
            value={comment}
            onChange={(event) => onCommentChange?.(event.target.value)}
            rows={2}
            className={cn("resize-none", commentError && "border-destructive")}
          />
          {commentError && (
            <p id={commentErrorId} role="alert" className="text-sm text-destructive">
              {commentError}
            </p>
          )}
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
