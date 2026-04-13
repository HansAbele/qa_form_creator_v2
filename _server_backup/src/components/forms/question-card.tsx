"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import type { QuestionType } from "@prisma/client";

export interface QuestionData {
  id: string;
  type: QuestionType;
  label: string;
  options: string[];
  required: boolean;
}

interface QuestionCardProps {
  question: QuestionData;
  index: number;
  onUpdate: (updated: QuestionData) => void;
  onDelete: () => void;
}

const questionTypeLabels: Record<QuestionType, string> = {
  TEXT: "Texto",
  RATING: "Calificación (1-5)",
  SELECT: "Selección",
  RADIO: "Opción múltiple",
};

export function QuestionCard({ question, index, onUpdate, onDelete }: QuestionCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: question.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const showOptions = question.type === "SELECT" || question.type === "RADIO";

  return (
    <Card ref={setNodeRef} style={style} className="relative">
      <CardContent className="flex gap-3 p-4">
        <button
          type="button"
          className="mt-1 cursor-grab text-muted-foreground hover:text-foreground"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-5 w-5" />
        </button>

        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">#{index + 1}</span>
            <Select
              value={question.type}
              onValueChange={(val) => val && onUpdate({ ...question, type: val as QuestionType })}
            >
              <SelectTrigger className="w-48">
                <SelectValue>
                  {(value: string | null) => {
                    if (!value) return "Tipo";
                    return questionTypeLabels[value as QuestionType] ?? value;
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(questionTypeLabels) as QuestionType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {questionTypeLabels[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Input
              placeholder="Texto de la pregunta..."
              value={question.label}
              onChange={(e) => onUpdate({ ...question, label: e.target.value })}
            />
          </div>

          {showOptions && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Opciones</Label>
              {question.options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={opt}
                    placeholder={`Opción ${i + 1}`}
                    onChange={(e) => {
                      const newOptions = [...question.options];
                      newOptions[i] = e.target.value;
                      onUpdate({ ...question, options: newOptions });
                    }}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => {
                      const newOptions = question.options.filter((_, idx) => idx !== i);
                      onUpdate({ ...question, options: newOptions });
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => onUpdate({ ...question, options: [...question.options, ""] })}
              >
                + Agregar opción
              </Button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Switch
              checked={question.required}
              onCheckedChange={(checked) =>
                onUpdate({ ...question, required: Boolean(checked) })
              }
            />
            <Label className="text-xs">Obligatoria</Label>
          </div>
        </div>

        <Button type="button" variant="ghost" size="icon-sm" onClick={onDelete}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </CardContent>
    </Card>
  );
}
