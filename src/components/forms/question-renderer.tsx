"use client";

import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { QuestionType } from "@prisma/client";

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
  value: string;
  onChange: (value: string) => void;
  comment?: string;
  onCommentChange?: (value: string) => void;
  error?: string;
  commentError?: string;
}

export function QuestionRenderer({
  question,
  value,
  onChange,
  comment = "",
  onCommentChange,
  error,
  commentError,
}: QuestionRendererProps) {
  const options = Array.isArray(question.options) ? (question.options as string[]) : [];
  const fatalOptions = getStringOptions(question.fatalOptions);
  const showComment = question.fatal || question.requiresCommentOnFail;

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Label>
          {question.label}
          {question.required && <span className="ml-1 text-destructive">*</span>}
        </Label>
        {question.formCategory?.qaCategory?.name && (
          <Badge variant="secondary" className="text-xs">
            {question.formCategory.qaCategory.name}
          </Badge>
        )}
        {question.type === "RATING" && question.weight > 0 && (
          <Badge variant="outline" className="text-xs">
            Peso {question.weight}%
          </Badge>
        )}
        {question.fatal && (
          <Badge variant="destructive" className="text-xs">
            Fatal
          </Badge>
        )}
        {question.fatal && fatalOptions.length > 0 && (
          <Badge variant="outline" className="text-xs">
            {fatalOptions.length} opcion(es) fatal(es)
          </Badge>
        )}
        {question.requiresCommentOnFail && (
          <Badge variant="outline" className="text-xs">
            Comentario si falla
          </Badge>
        )}
      </div>

      {question.type === "TEXT" && (
        <Textarea
          placeholder="Escribe tu respuesta..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="resize-none"
        />
      )}

      {question.type === "RATING" && (
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => onChange(String(star))}
              className="rounded p-1 transition-colors hover:bg-accent"
            >
              <Star
                className={cn(
                  "h-7 w-7 transition-colors",
                  Number(value) >= star
                    ? "fill-yellow-400 text-yellow-400"
                    : "text-muted-foreground/30",
                )}
              />
            </button>
          ))}
          {value && (
            <span className="ml-2 flex items-center text-sm text-muted-foreground">{value}/5</span>
          )}
        </div>
      )}

      {question.type === "SELECT" && (
        <Select value={value} onValueChange={(v) => v && onChange(v)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Seleccionar..." />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {question.type === "RADIO" && (
        <RadioGroup value={value} onValueChange={(v) => onChange(v as string)}>
          {options.map((opt) => (
            <div key={opt} className="flex items-center gap-2">
              <RadioGroupItem value={opt} id={`${question.id}-${opt}`} />
              <Label htmlFor={`${question.id}-${opt}`} className="font-normal">
                {opt}
              </Label>
            </div>
          ))}
        </RadioGroup>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {showComment && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Comentario QA</Label>
          <Textarea
            placeholder="Agrega contexto para esta regla..."
            value={comment}
            onChange={(event) => onCommentChange?.(event.target.value)}
            rows={2}
            className="resize-none"
          />
          {commentError && <p className="text-sm text-destructive">{commentError}</p>}
        </div>
      )}
    </div>
  );
}

function getStringOptions(options: unknown) {
  return Array.isArray(options)
    ? options
        .filter((option): option is string => typeof option === "string")
        .map((option) => option.trim())
        .filter(Boolean)
    : [];
}
