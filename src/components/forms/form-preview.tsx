import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { QuestionType } from "@prisma/client";

interface PreviewQuestion {
  id?: string;
  type: QuestionType;
  label: string;
  options: string[];
  required: boolean;
  weight: number;
  fatal: boolean;
  fatalOptions: string[];
  requiresCommentOnFail: boolean;
}

interface FormPreviewProps {
  title: string;
  description?: string;
  questions: PreviewQuestion[];
}

const typeLabels: Record<QuestionType, string> = {
  TEXT: "Texto",
  RATING: "Calificacion",
  SELECT: "Seleccion",
  RADIO: "Opcion multiple",
};

export function FormPreview({ title, description, questions }: FormPreviewProps) {
  if (!title && questions.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Completa el formulario para ver la vista previa
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title || "Sin titulo"}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-6">
        {questions.map((q, i) => (
          <div key={q.id ?? `${q.type}-${q.label}`} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label>
                {q.label || `Pregunta ${i + 1}`}
                {q.required && <span className="ml-1 text-destructive">*</span>}
              </Label>
              <Badge variant="secondary" className="text-xs">
                {typeLabels[q.type]}
              </Badge>
              {q.type === "RATING" && (
                <Badge variant="outline" className="text-xs">
                  Peso {q.weight}%
                </Badge>
              )}
              {q.fatal && (
                <Badge variant="destructive" className="text-xs">
                  Fatal
                </Badge>
              )}
              {q.fatal && q.fatalOptions.length > 0 && (
                <Badge variant="outline" className="text-xs">
                  {q.fatalOptions.length} opcion(es) fatal(es)
                </Badge>
              )}
              {q.requiresCommentOnFail && (
                <Badge variant="outline" className="text-xs">
                  Comentario requerido
                </Badge>
              )}
            </div>

            {q.type === "TEXT" && (
              <Textarea disabled placeholder="Respuesta de texto..." className="resize-none" />
            )}

            {q.type === "RATING" && (
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star key={star} className="h-6 w-6 text-muted-foreground/30" />
                ))}
              </div>
            )}

            {q.type === "SELECT" && (
              <div className="rounded-lg border border-input px-3 py-2 text-sm text-muted-foreground">
                Seleccionar opcion...
              </div>
            )}

            {q.type === "RADIO" && (
              <div className="space-y-2">
                {q.options.length > 0 ? (
                  q.options.map((opt, j) => (
                    <div key={getPreviewOptionKey(q, opt, j)} className="flex items-center gap-2">
                      <div className="h-4 w-4 rounded-full border border-input" />
                      <span className="text-sm">{opt || `Opcion ${j + 1}`}</span>
                    </div>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">Sin opciones definidas</span>
                )}
              </div>
            )}
          </div>
        ))}

        {questions.length === 0 && (
          <p className="text-center text-muted-foreground">No hay preguntas agregadas</p>
        )}
      </CardContent>
    </Card>
  );
}

function getPreviewOptionKey(question: PreviewQuestion, option: string, index: number) {
  return `${question.id ?? question.label}-${option || "empty"}-${index}`;
}
