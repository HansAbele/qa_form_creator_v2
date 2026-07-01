"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { SELECTABLE_QUESTION_TYPES } from "@/types/form-builder";
import type { QACategoryOption } from "./form-builder";
import type { QuestionType } from "@prisma/client";

export interface QuestionData {
  id: string;
  type: QuestionType;
  label: string;
  options: string[];
  required: boolean;
  qaCategoryId: string;
  weight: number;
  fatal: boolean;
  fatalOptions: string[];
  requiresCommentOnFail: boolean;
}

interface QuestionCardProps {
  question: QuestionData;
  index: number;
  qaCategories: QACategoryOption[];
  onUpdate: (updated: QuestionData) => void;
  onDelete: () => void;
}

const questionTypeLabels: Record<QuestionType, string> = {
  TEXT: "Texto",
  RATING: "Calificacion (1-5)",
  SELECT: "Seleccion",
  RADIO: "Opcion multiple",
  BOOLEAN: "Si / No",
};

export function QuestionCard({
  question,
  index,
  qaCategories,
  onUpdate,
  onDelete,
}: QuestionCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: question.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const showOptions = question.type === "SELECT" || question.type === "RADIO";
  const selectedCategory = qaCategories.find((category) => category.id === question.qaCategoryId);
  const canConfigureFatalOptions = showOptions && question.fatal;

  return (
    <Card ref={setNodeRef} style={style} className="relative">
      <CardContent className="flex gap-3 p-4">
        <button
          type="button"
          className="mt-1 cursor-grab text-muted-foreground hover:text-foreground"
          aria-label={`Mover pregunta ${index + 1}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-5 w-5" />
        </button>

        <div className="flex-1 space-y-4">
          <div className="grid gap-3 lg:grid-cols-[auto_minmax(180px,220px)_minmax(220px,1fr)_120px] lg:items-end">
            <div className="flex items-center gap-2 pb-2">
              <span className="text-xs font-medium text-muted-foreground">#{index + 1}</span>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Tipo</Label>
              <Select
                value={question.type}
                onValueChange={(val) => {
                  if (!val) return;
                  onUpdate({
                    ...question,
                    type: val as QuestionType,
                    weight: val === "RATING" ? question.weight : 0,
                    fatalOptions:
                      val === "SELECT" || val === "RADIO"
                        ? getValidFatalOptions(question.fatalOptions, question.options)
                        : [],
                  });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value: string | null) => {
                      if (!value) return "Tipo";
                      return questionTypeLabels[value as QuestionType] ?? value;
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SELECTABLE_QUESTION_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {questionTypeLabels[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Categoria QA</Label>
              <Select
                value={question.qaCategoryId}
                onValueChange={(value) => {
                  if (!value) return;
                  const category = qaCategories.find((item) => item.id === value);
                  onUpdate({
                    ...question,
                    qaCategoryId: value,
                    fatal: category?.canBeFatal ? question.fatal : false,
                    fatalOptions: category?.canBeFatal
                      ? getValidFatalOptions(question.fatalOptions, question.options)
                      : [],
                    requiresCommentOnFail:
                      question.requiresCommentOnFail || Boolean(category?.requiresCommentOnFail),
                  });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Seleccionar categoria" />
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

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Peso</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={question.weight}
                disabled={question.type !== "RATING"}
                onChange={(event) =>
                  onUpdate({
                    ...question,
                    weight: Number(event.target.value) || 0,
                  })
                }
              />
              {question.type === "RATING" && (
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={question.weight}
                  aria-label="Peso de la pregunta"
                  onChange={(event) =>
                    onUpdate({
                      ...question,
                      weight: Number(event.target.value) || 0,
                    })
                  }
                  className="w-full cursor-pointer accent-primary"
                />
              )}
            </div>
          </div>

          <Input
            placeholder="Texto de la pregunta..."
            value={question.label}
            onChange={(e) => onUpdate({ ...question, label: e.target.value })}
          />

          {showOptions && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Opciones</Label>
              {question.options.map((opt, i) => {
                const optionValue = opt.trim();

                return (
                  <div
                    key={getOptionKey(question.id, opt, i)}
                    className="flex flex-col gap-2 sm:flex-row sm:items-center"
                  >
                    <Input
                      value={opt}
                      placeholder={`Opcion ${i + 1}`}
                      onChange={(e) => {
                        const newOptions = [...question.options];
                        const previousOption = newOptions[i];
                        newOptions[i] = e.target.value;
                        onUpdate({
                          ...question,
                          options: newOptions,
                          fatalOptions: replaceFatalOption(
                            question.fatalOptions,
                            previousOption,
                            e.target.value,
                            newOptions,
                          ),
                        });
                      }}
                      className="flex-1"
                    />
                    {canConfigureFatalOptions && (
                      <SwitchField
                        label="Fatal"
                        checked={
                          Boolean(optionValue) && question.fatalOptions.includes(optionValue)
                        }
                        disabled={!optionValue}
                        onChange={(checked) => {
                          if (!optionValue) return;
                          const fatalOptions = checked
                            ? normalizeOptions([...question.fatalOptions, optionValue])
                            : question.fatalOptions.filter((option) => option !== optionValue);
                          onUpdate({
                            ...question,
                            fatalOptions: getValidFatalOptions(fatalOptions, question.options),
                          });
                        }}
                      />
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => {
                        const newOptions = question.options.filter((_, idx) => idx !== i);
                        onUpdate({
                          ...question,
                          options: newOptions,
                          fatalOptions: getValidFatalOptions(
                            question.fatalOptions.filter((option) => option !== optionValue),
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
                onClick={() => onUpdate({ ...question, options: [...question.options, ""] })}
              >
                + Agregar opcion
              </Button>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <SwitchField
              label="Obligatoria"
              checked={question.required}
              onChange={(checked) => onUpdate({ ...question, required: Boolean(checked) })}
            />
            <SwitchField
              label="Falla fatal"
              checked={question.fatal}
              disabled={!selectedCategory?.canBeFatal}
              onChange={(checked) =>
                onUpdate({
                  ...question,
                  fatal: Boolean(checked),
                  fatalOptions: checked
                    ? getValidFatalOptions(question.fatalOptions, question.options)
                    : [],
                })
              }
            />
            <SwitchField
              label="Comentario si falla"
              checked={question.requiresCommentOnFail}
              onChange={(checked) =>
                onUpdate({
                  ...question,
                  requiresCommentOnFail: Boolean(checked),
                })
              }
            />
          </div>
        </div>

        <Button type="button" variant="ghost" size="icon-sm" onClick={onDelete}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </CardContent>
    </Card>
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
    <div className="flex items-center gap-2">
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(Boolean(value))}
      />
      <Label className="text-xs">{label}</Label>
    </div>
  );
}

function getOptionKey(questionId: string, option: string, index: number) {
  return `${questionId}-${option || "empty"}-${index}`;
}

function normalizeOptions(options: string[]) {
  return Array.from(new Set(options.map((option) => option.trim()).filter(Boolean)));
}

function getValidFatalOptions(fatalOptions: string[], options: string[]) {
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
