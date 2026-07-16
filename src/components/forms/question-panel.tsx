"use client";

import { Trash2 } from "lucide-react";
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
import type { QuestionType } from "@prisma/client";
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
  numeric: "Numerica (con color)",
  stars: "Estrellas",
};

const CRITICAL_TYPE_LABELS: Record<CriticalTypeValue, string> = {
  CUSTOMER: "Customer critical",
  BUSINESS: "Business critical",
  COMPLIANCE: "Compliance critical",
};

const MAX_LABEL = 200;

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
  const showOptions = isOptionQuestionType(draft.type);
  const selectedCategory = qaCategories.find((category) => category.id === draft.qaCategoryId);
  const canConfigureFatalOptions = showOptions && draft.fatal;
  const canSubmit = draft.label.trim().length > 0 && Boolean(draft.qaCategoryId);

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <p className="font-heading text-sm font-semibold">
        {mode === "edit" ? "Editar pregunta" : "Agregar pregunta"}
      </p>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Texto de la pregunta</Label>
        <Textarea
          rows={2}
          maxLength={MAX_LABEL}
          placeholder="Escribe la pregunta..."
          value={draft.label}
          onChange={(event) => onChange({ ...draft, label: event.target.value })}
          className="resize-none"
        />
        <p className="text-right text-[11px] tabular-nums text-muted-foreground">
          {draft.label.length}/{MAX_LABEL}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Tipo</Label>
          <Select
            value={draft.type}
            onValueChange={(val) => {
              if (!val) return;
              const seedBoolean = val === "BOOLEAN" && draft.options.length < 2;
              const nextOptions = seedBoolean ? ["Si", "No"] : draft.options;
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
                  value ? (QUESTION_TYPE_LABELS[value as QuestionType] ?? value) : "Tipo"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SELECTABLE_QUESTION_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {QUESTION_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Categoria QA</Label>
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
              <SelectValue placeholder="Seleccionar categoria">
                {(value: string | null) =>
                  value
                    ? (qaCategories.find((c) => c.id === value)?.name ?? "Seleccionar categoria")
                    : "Seleccionar categoria"
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
            <Label className="text-xs text-muted-foreground">Peso de la pregunta</Label>
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
            aria-label="Peso de la pregunta"
            onChange={(event) => onChange({ ...draft, weight: Number(event.target.value) || 0 })}
            className="w-full cursor-pointer accent-primary"
          />
        </div>
      )}

      {draft.type === "RATING" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Escala maxima</Label>
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
            <Label className="text-xs text-muted-foreground">Estilo</Label>
            <Select
              value={draft.ratingStyle ?? "numeric"}
              onValueChange={(val) =>
                val && onChange({ ...draft, ratingStyle: val as RatingStyleValue })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string | null) =>
                    RATING_STYLE_LABELS[(value as RatingStyleValue) ?? "numeric"] ?? "Numerica"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {RATING_STYLES.map((style) => (
                  <SelectItem key={style} value={style}>
                    {RATING_STYLE_LABELS[style]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      <div className="grid gap-2">
        <SwitchField
          label="Obligatoria"
          checked={draft.required}
          onChange={(checked) => onChange({ ...draft, required: checked })}
        />
        <SwitchField
          label="Falla fatal / impacta FAIL"
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
          label="Requiere comentario al fallar"
          checked={draft.requiresCommentOnFail}
          onChange={(checked) => onChange({ ...draft, requiresCommentOnFail: checked })}
        />
      </div>

      {draft.fatal && (
        <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive-tint/40 p-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Tipo de error critico (COPC)</Label>
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
                      ? "Sin clasificar"
                      : (CRITICAL_TYPE_LABELS[value as CriticalTypeValue] ?? value)
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin clasificar</SelectItem>
                {CRITICAL_TYPES.map((ct) => (
                  <SelectItem key={ct} value={ct}>
                    {CRITICAL_TYPE_LABELS[ct]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {draft.type === "RATING" && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Falla fatal si la nota es &lt;</Label>
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
          <Label className="text-xs text-muted-foreground">Opciones de respuesta</Label>
          {draft.options.map((opt, i) => {
            const optionValue = opt.trim();
            return (
              <div key={getOptionKey(draft.id, opt, i)} className="flex items-center gap-2">
                <Input
                  value={opt}
                  placeholder={`Opcion ${i + 1}`}
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
                  value={draft.optionPoints[i] ?? 0}
                  aria-label={`Puntos opcion ${i + 1}`}
                  onChange={(event) => {
                    const newPoints = [...draft.optionPoints];
                    newPoints[i] = Number(event.target.value) || 0;
                    onChange({ ...draft, optionPoints: newPoints });
                  }}
                  className="w-16"
                />
                <span className="text-xs text-muted-foreground">pts</span>
                {canConfigureFatalOptions && (
                  <Switch
                    aria-label={`Opcion fatal ${i + 1}`}
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
            + Agregar opcion
          </Button>
          {canConfigureFatalOptions && (
            <p className="text-[11px] text-muted-foreground">
              Activa el switch en las opciones que cuentan como falla fatal.
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="button" size="sm" disabled={!canSubmit} onClick={onSubmit}>
          {mode === "edit" ? "Guardar cambios" : "+ Agregar pregunta"}
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
