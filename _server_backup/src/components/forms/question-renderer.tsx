"use client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QuestionType } from "@prisma/client";

interface QuestionRendererProps {
  question: {
    id: string;
    type: QuestionType;
    label: string;
    options: unknown;
    required: boolean;
  };
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export function QuestionRenderer({ question, value, onChange, error }: QuestionRendererProps) {
  const options = Array.isArray(question.options) ? (question.options as string[]) : [];

  return (
    <div className="space-y-2">
      <Label>
        {question.label}
        {question.required && <span className="ml-1 text-destructive">*</span>}
      </Label>

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
            <span className="ml-2 flex items-center text-sm text-muted-foreground">
              {value}/5
            </span>
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
    </div>
  );
}
