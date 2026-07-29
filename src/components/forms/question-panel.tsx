"use client";

import type { QuestionType } from "@prisma/client";
import { Trash2 } from "lucide-react";
import { useI18n } from "@/components/providers/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { parseOfficialQuestionLabel } from "@/lib/official-form-templates";
import {
  CRITICAL_TYPES,
  type CriticalTypeValue,
  DEFAULT_RATING_MAX,
  isOptionQuestionType,
  isScoredQuestionType,
  QUESTION_TYPE_LABELS,
  RATING_STYLES,
  type RatingStyleValue,
  SELECTABLE_QUESTION_TYPES,
} from "@/types/form-builder";
import type { QACategoryOption } from "./form-builder";

export interface QuestionData {
  id: string;
  type: QuestionType;
  label: string;
  options: string[];
  optionPoints: number[];
  required: boolean;
  qaCategoryId: string;
  weight: number;
  fatal: boolean;
  fatalOptions: string[];
  criticalType: CriticalTypeValue | null;
  ratingFailThreshold: number | null;
  ratingMax: number | null;
  ratingStyle: RatingStyleValue | null;
  requiresCommentOnFail: boolean;
}

const RATING_STYLE_LABELS: Record<RatingStyleValue, string> = {
  numeric: "Numeric (color coded)",
  stars: "Stars",
};

const CRITICAL_TYPE_LABELS: Record<CriticalTypeValue, string> = {
  CUSTOMER: "Customer critical",
  BUSINESS: "Business critical",
  COMPLIANCE: "Compliance critical",
};

const MAX_LABEL = 500;

interface QuestionPanelProps {
  draft: QuestionData;
  qaCategories: QACategoryOption[];
  mode: "add" | "edit";
  onChange: (updated: QuestionData) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

/** Sticky right-side composer to add or edit a single question. */
export function QuestionPanel({
  draft,
  qaCategories,
  mode,
  onChange,
  onSubmit,
  onCancel,
}: QuestionPanelProps) {
  const { t } = useI18n();
  const showOptions = isOptionQuestionType(draft.type);
  const officialMetadata = parseOfficialQuestionLabel(draft.label);
  const metadataPrefix = `${officialMetadata.checkpoint ? "[[CHECK]]" : ""}${
    officialMetadata.partsWarranty ? "[[P&W]]" : ""
  }`;
  const selectedCategory = qaCategories.find((category) => category.id === draft.qaCategoryId);
  const canConfigureFatalOptions = showOptions && draft.fatal;
  const canSubmit = officialMetadata.label.trim().length > 0 && Boolean(draft.qaCategoryId);

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <p className="font-heading text-sm font-semibold">
        {mode === "edit" ? t("Edit question") : t("Add question")}
      </p>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{t("Question text")}</Label>
        <Textarea
          rows={2}
          maxLength={MAX_LABEL}
          placeholder={t("Enter the question...")}
          value={officialMetadata.label}
          onChange={(event) =>
            onChange({ ...draft, label: `${metadataPrefix}${event.target.value}` })
          }
          className="resize-none"
        />
        <p className="text-right text-[11px] tabular-nums text-muted-foreground">
          {officialMetadata.label.length}/{MAX_LABEL}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t("Type")}</Label>
          <Select
            value={draft.type}
            onValueChange={(val) => {
              if (!val) return;
              const seedBoolean = val === "BOOLEAN" && draft.options.length < 2;
              const nextOptions = seedBoolean ? [t("Yes"), t("No")] : draft.options;
              const nextOptionPoints = seedBoolean ? [1, 0] : draft.optionPoints;
              onChange({
                ...draft,
                type: val as QuestionType,
                weight: isScoredQuestionType(val) ? draft.weight : 0,
                options: nextOptions,
                optionPoints: nextOptionPoints,
                fatalOptions: isOptionQuestionType(val)
                  ? getValidFatalOptions(draft.fatalOptions, nextOptions)
                  : [],
                ratingFailThreshold: val === "RATING" ? draft.ratingFailThreshold : null,
              });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {(value: string | null) =>
                  value ? t(QUESTION_TYPE_LABELS[value as QuestionType] ?? value) : t("Type")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SELECTABLE_QUESTION_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(QUESTION_TYPE_LABELS[type])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t("QA Category")}</Label>
          <Select
            value={draft.qaCategoryId}
            onValueChange={(value) => {
              if (!value) return;
              const category = qaCategories.find((item) => item.id === value);
              onChange({
                ...draft,
                qaCategoryId: value,
                fatal: category?.canBeFatal ? draft.fatal : false,
                fatalOptions: category?.canBeFatal
                  ? getValidFatalOptions(draft.fatalOptions, draft.options)
                  : [],
                requiresCommentOnFail:
                  draft.requiresCommentOnFail || Boolean(category?.requiresCommentOnFail),
              });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("Select a category")}>
                {(value: string | null) =>
                  value
                    ? (qaCategories.find((c) => c.id === value)?.name ?? t("Select a category"))
                    : t("Select a category")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {qaCategories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isScoredQuestionType(draft.type) && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">{t("Question weight")}</Label>
            <span className="font-heading text-sm font-bold tabular-nums text-primary">
              {draft.weight}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={draft.weight}
            aria-label={t("Question weight")}
            onChange={(event) => onChange({ ...draft, weight: Number(event.target.value) || 0 })}
            className="w-full cursor-pointer accent-primary"
          />
        </div>
      )}

      {draft.type === "RATING" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("Maximum rating")}</Label>
            <Input
              type="number"
              min={2}
              max={10}
              value={draft.ratingMax ?? DEFAULT_RATING_MAX}
              onChange={(event) =>
                onChange({
                  ...draft,
                  ratingMax: Math.max(
                    2,
                    Math.min(10, Number(event.target.value) || DEFAULT_RATING_MAX),
                  ),
                })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("Style")}</Label>
            <Select
              value={draft.ratingStyle ?? "numeric"}
              onValueChange={(val) =>
                val && onChange({ ...draft, ratingStyle: val as RatingStyleValue })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string | null) =>
                    t(RATING_STYLE_LABELS[(value as RatingStyleValue) ?? "numeric"] ?? "Numeric")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {RATING_STYLES.map((style) => (
                  <SelectItem key={style} value={style}>
                    {t(RATING_STYLE_LABELS[style])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      <div className="grid gap-2">
        <SwitchField
          label={t("Required")}
          checked={draft.required}
          onChange={(checked) => onChange({ ...draft, required: checked })}
        />
        <SwitchField
          label={t("Critical failure / forces FAIL")}
          checked={draft.fatal}
          disabled={!selectedCategory?.canBeFatal}
          onChange={(checked) =>
            onChange({
              ...draft,
              fatal: checked,
              fatalOptions: checked ? getValidFatalOptions(draft.fatalOptions, draft.options) : [],
            })
          }
        />
        <SwitchField
          label={t("Require comment on failure")}
          checked={draft.requiresCommentOnFail}
          onChange={(checked) => onChange({ ...draft, requiresCommentOnFail: checked })}
        />
      </div>

      {draft.fatal && (
        <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive-tint/40 p-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              {t("Critical error type (COPC)")}
            </Label>
            <Select
              value={draft.criticalType ?? "none"}
              onValueChange={(val) =>
                onChange({
                  ...draft,
                  criticalType: val && val !== "none" ? (val as CriticalTypeValue) : null,
                })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string | null) =>
                    !value || value === "none"
                      ? t("Unclassified")
                      : t(CRITICAL_TYPE_LABELS[value as CriticalTypeValue] ?? value)
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("Unclassified")}</SelectItem>
                {CRITICAL_TYPES.map((ct) => (
                  <SelectItem key={ct} value={ct}>
                    {t(CRITICAL_TYPE_LABELS[ct])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {draft.type === "RATING" && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                {t("Critical failure when rating is below")}
              </Label>
              <Input
                type="number"
                min={1}
                max={draft.ratingMax ?? DEFAULT_RATING_MAX}
                value={draft.ratingFailThreshold ?? 3}
                onChange={(event) =>
                  onChange({ ...draft, ratingFailThreshold: Number(event.target.value) || null })
                }
              />
            </div>
          )}
        </div>
      )}

      {showOptions && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">{t("Answer options")}</Label>
          {draft.options.map((opt, i) => {
            const optionValue = opt.trim();
            return (
              <div key={getOptionKey(draft.id, opt, i)} className="flex items-center gap-2">
                <Input
                  value={opt}
                  placeholder={t("Option {number}", { number: i + 1 })}
                  onChange={(event) => {
                    const newOptions = [...draft.options];
                    const previousOption = newOptions[i];
                    newOptions[i] = event.target.value;
                    onChange({
                      ...draft,
                      options: newOptions,
                      fatalOptions: replaceFatalOption(
                        draft.fatalOptions,
                        previousOption,
                        event.target.value,
                        newOptions,
                      ),
                    });
                  }}
                  className="flex-1"
                />
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={draft.optionPoints[i] ?? 0}
                  aria-label={t("Points for option {number}", { number: i + 1 })}
                  onChange={(event) => {
                    const newPoints = [...draft.optionPoints];
                    newPoints[i] = Number(event.target.value) || 0;
                    onChange({ ...draft, optionPoints: newPoints });
                  }}
                  className="w-16"
                />
                <span className="text-xs text-muted-foreground">{t("pts")}</span>
                {canConfigureFatalOptions && (
                  <Switch
                    aria-label={t("Critical option {number}", { number: i + 1 })}
                    checked={Boolean(optionValue) && draft.fatalOptions.includes(optionValue)}
                    disabled={!optionValue}
                    onCheckedChange={(checked) => {
                      if (!optionValue) return;
                      const fatalOptions = checked
                        ? normalizeOptions([...draft.fatalOptions, optionValue])
                        : draft.fatalOptions.filter((option) => option !== optionValue);
                      onChange({
                        ...draft,
                        fatalOptions: getValidFatalOptions(fatalOptions, draft.options),
                      });
                    }}
                  />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => {
                    const newOptions = draft.options.filter((_, idx) => idx !== i);
                    onChange({
                      ...draft,
                      options: newOptions,
                      optionPoints: draft.optionPoints.filter((_, idx) => idx !== i),
                      fatalOptions: getValidFatalOptions(
                        draft.fatalOptions.filter((option) => option !== optionValue),
                        newOptions,
                      ),
                    });
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() =>
              onChange({
                ...draft,
                options: [...draft.options, ""],
                optionPoints: [...draft.optionPoints, 0],
              })
            }
          >
            {t("+ Add option")}
          </Button>
          {canConfigureFatalOptions && (
            <p className="text-[11px] text-muted-foreground">
              {t("Enable the options that count as critical failures.")}
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button type="button" size="sm" disabled={!canSubmit} onClick={onSubmit}>
          {mode === "edit" ? t("Save changes") : t("+ Add question")}
        </Button>
      </div>
    </div>
  );
}

function SwitchField({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-xs">{label}</Label>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(Boolean(value))}
      />
    </div>
  );
}

function getOptionKey(questionId: string, option: string, index: number) {
  return `${questionId}-${option || "empty"}-${index}`;
}

export function normalizeOptions(options: string[]) {
  return Array.from(new Set(options.map((option) => option.trim()).filter(Boolean)));
}

export function getValidFatalOptions(fatalOptions: string[], options: string[]) {
  const optionSet = new Set(normalizeOptions(options));
  return normalizeOptions(fatalOptions).filter((option) => optionSet.has(option));
}

function replaceFatalOption(
  fatalOptions: string[],
  previousOption: string,
  nextOption: string,
  nextOptions: string[],
) {
  const previousValue = previousOption.trim();
  const nextValue = nextOption.trim();
  const replaced = fatalOptions.flatMap((option) => {
    if (option !== previousValue) return option;
    return nextValue ? nextValue : [];
  });

  return getValidFatalOptions(replaced, nextOptions);
}
