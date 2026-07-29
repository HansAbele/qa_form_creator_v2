"use client";

import type { QuestionType } from "@prisma/client";
import { AlertTriangle, MessageSquarePlus } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { RATING_TIER_CLASSES, ratingTier } from "@/lib/rating-scale";
import { parseOfficialQuestionLabel } from "@/lib/official-form-templates";
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
  const { t } = useI18n();
  const officialMetadata = parseOfficialQuestionLabel(question.label);
  const optionPairs = getOptionPairs(question.options);
  const scoreScaleOptions = getScoreScaleOptions(question.options);
  const fatalOptions = getStringOptions(question.fatalOptions);
  const showFatalNotice = !notApplicable && failed && question.fatal;
  const commentRequired = !notApplicable && failed && question.requiresCommentOnFail;
  const canComment = Boolean(onCommentChange);
  const [commentExpanded, setCommentExpanded] = useState(
    Boolean(comment) || Boolean(commentError) || commentRequired,
  );
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

  useEffect(() => {
    if (comment || commentError || commentRequired) setCommentExpanded(true);
  }, [comment, commentError, commentRequired]);

  return (
    <div
      className={cn(
        "space-y-3 rounded-xl border bg-card p-4 transition-colors",
        showFatalNotice ? "border-destructive/60" : "border-border",
        officialMetadata.checkpoint && "border-l-4 bg-muted/15 py-3",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p id={questionLabelId} className="font-semibold">
          {index && <span className="mr-1.5 text-muted-foreground tabular-nums">{index}</span>}
          {officialMetadata.label}
          {question.required && (
            <>
              <span aria-hidden="true" className="ml-1 text-destructive">
                *
              </span>
              <span className="sr-only"> {t("(required)")}</span>
            </>
          )}
        </p>
        {isScoredQuestionType(question.type) && question.weight > 0 && (
          <Badge variant="outline" className="text-xs">
            {t("Weight {weight}%", { weight: question.weight })}
          </Badge>
        )}
        {officialMetadata.checkpoint && (
          <Badge variant="secondary" className="text-xs">
            {t("Procedure check")}
          </Badge>
        )}
        {officialMetadata.partsWarranty && (
          <Badge className="bg-[#2E75B6] text-xs text-white hover:bg-[#2E75B6]">P&amp;W</Badge>
        )}
        {question.fatal && (
          <Badge variant="destructive" className="text-xs">
            {t("Critical")}
          </Badge>
        )}
        {question.requiresCommentOnFail && (
          <Badge variant="outline" className="text-xs">
            {t("Comment required on failure")}
          </Badge>
        )}
        {!notApplicable && failed && (
          <Badge variant="destructive" className="text-xs uppercase tracking-wide">
            {t("Failed")}
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
            {t("Not applicable")}
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
          placeholder={t("Enter your answer...")}
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
          <legend className="sr-only">{officialMetadata.label}</legend>
          {(optionPairs.length > 0
            ? optionPairs
            : [
                { label: t("Yes"), value: "Yes" },
                { label: t("No"), value: "No" },
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

      {(question.type === "SELECT" || question.type === "RADIO") &&
        scoreScaleOptions.length > 0 && (
          <ScoreScale
            id={answerControlId}
            options={scoreScaleOptions}
            value={value}
            disabled={notApplicable}
            required={question.required && !notApplicable}
            ariaLabelledBy={questionLabelId}
            ariaDescribedBy={answerDescription}
            invalid={Boolean(error)}
            onChange={onChange}
          />
        )}

      {(question.type === "SELECT" || question.type === "RADIO") &&
        scoreScaleOptions.length === 0 && (
          <Select value={value} onValueChange={(v) => v && onChange(v)} disabled={notApplicable}>
            <SelectTrigger
              id={answerControlId}
              aria-labelledby={questionLabelId}
              aria-describedby={answerDescription}
              aria-invalid={Boolean(error)}
              aria-required={question.required && !notApplicable}
              className={cn("w-full", failed && "border-destructive text-destructive")}
            >
              <SelectValue placeholder={t("Select...")} />
            </SelectTrigger>
            <SelectContent>
              {optionPairs.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                  {fatalOptions.includes(opt.value) && (
                    <span className="ml-1.5 text-xs text-destructive">· {t("critical")}</span>
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
            ? t("This rating counts as a critical failure.")
            : t("This option counts as a critical failure.")}
        </p>
      )}

      {error && (
        <p id={answerErrorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {canComment && !commentExpanded && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 h-8 gap-1.5 text-muted-foreground"
          onClick={() => setCommentExpanded(true)}
        >
          <MessageSquarePlus aria-hidden="true" className="size-4" />
          {t("Add QA comment")}
        </Button>
      )}

      {canComment && commentExpanded && (
        <div className="space-y-2">
          <Label htmlFor={commentControlId} className="text-xs text-muted-foreground">
            {t("QA Comment")}
            {commentRequired ? (
              <span className="ml-1 text-destructive">*</span>
            ) : (
              <span className="ml-1 font-normal"> · {t("Optional")}</span>
            )}
          </Label>
          <Textarea
            id={commentControlId}
            aria-describedby={commentError ? commentErrorId : undefined}
            aria-invalid={Boolean(commentError)}
            aria-required={commentRequired}
            placeholder={t("Add context for this rule...")}
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

type ScoreScaleOption = {
  value: string;
  points: number;
};

function ScoreScale({
  id,
  options,
  value,
  disabled,
  required,
  invalid,
  ariaLabelledBy,
  ariaDescribedBy,
  onChange,
}: {
  id: string;
  options: ScoreScaleOption[];
  value: string;
  disabled: boolean;
  required: boolean;
  invalid: boolean;
  ariaLabelledBy: string;
  ariaDescribedBy?: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const orderedOptions = [...options].sort((left, right) => left.points - right.points);
  const maxPoints = Math.max(...orderedOptions.map((option) => option.points), 0);
  const selectedOption = orderedOptions.find((option) => option.value === value);
  const selectedPercent =
    selectedOption && maxPoints > 0 ? Math.round((selectedOption.points / maxPoints) * 100) : null;

  return (
    <div className="space-y-2">
      <div className="flex min-h-5 items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{t("Score")}</span>
        {selectedPercent !== null && selectedOption ? (
          <Badge
            variant="outline"
            className={cn(
              "font-semibold tabular-nums",
              RATING_TIER_CLASSES[ratingTier(selectedOption.points, maxPoints)].text,
            )}
          >
            {selectedPercent}%
          </Badge>
        ) : null}
      </div>
      <div
        id={id}
        role="radiogroup"
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={invalid}
        className={cn("flex flex-wrap gap-2", disabled && "opacity-50")}
      >
        {orderedOptions.map((option) => {
          const isSelected = option.value === value;
          const displayPoints = Number.isInteger(option.points)
            ? String(option.points)
            : option.points.toFixed(1);
          return (
            <label
              key={option.value}
              className={cn(
                "grid h-11 min-w-11 cursor-pointer place-items-center rounded-xl border-2 px-3 font-heading text-sm font-bold tabular-nums transition-all focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
                disabled && "cursor-not-allowed",
                isSelected
                  ? cn(
                      RATING_TIER_CLASSES[ratingTier(option.points, maxPoints)].active,
                      "shadow-sm",
                    )
                  : "border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground",
              )}
            >
              <input
                type="radio"
                name={`score-${id}`}
                value={option.value}
                checked={isSelected}
                required={required}
                disabled={disabled}
                aria-label={t("{score} of {max} points", {
                  score: displayPoints,
                  max: maxPoints,
                })}
                onChange={(event) => onChange(event.target.value)}
                className="sr-only"
              />
              {displayPoints}
            </label>
          );
        })}
      </div>
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

function getScoreScaleOptions(options: unknown): ScoreScaleOption[] {
  if (!Array.isArray(options) || options.length < 2) return [];
  const pointsPattern = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*points?$/i;
  let expectedMaximum: number | null = null;
  const parsed: ScoreScaleOption[] = [];

  for (const option of options) {
    if (!option || typeof option !== "object" || !("value" in option) || !("points" in option)) {
      return [];
    }
    const value = String((option as { value: unknown }).value).trim();
    const match = value.match(pointsPattern);
    const points = Number((option as { points: unknown }).points);
    if (!match || !Number.isFinite(points) || points < 0) return [];
    const valuePoints = Number(match[1]);
    const maximum = Number(match[2]);
    if (!Number.isFinite(maximum) || maximum <= 0 || valuePoints !== points) return [];
    if (expectedMaximum !== null && maximum !== expectedMaximum) return [];
    expectedMaximum = maximum;
    parsed.push({ value, points });
  }

  return expectedMaximum !== null &&
    Math.max(...parsed.map((option) => option.points)) === expectedMaximum
    ? parsed
    : [];
}
