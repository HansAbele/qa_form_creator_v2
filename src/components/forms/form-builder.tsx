"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { toast } from "sonner";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { createForm, updateForm } from "@/server/actions/forms";
import type { QuestionType } from "@prisma/client";
import { FormPreview } from "./form-preview";
import { QuestionCard, type QuestionData } from "./question-card";

interface Campaign {
  id: string;
  name: string;
}

export interface QACategoryOption {
  id: string;
  name: string;
  description: string | null;
  canBeFatal: boolean;
  requiresCommentOnFail: boolean;
}

interface FormBuilderProps {
  campaigns: Campaign[];
  qaCategories: QACategoryOption[];
  initialData?: {
    id: string;
    title: string;
    description: string | null;
    campaignId: string;
    questions: {
      id: string;
      type: QuestionType;
      label: string;
      options: unknown;
      required: boolean;
      weight: number;
      fatal: boolean;
      requiresCommentOnFail: boolean;
      order: number;
      formCategory?: {
        qaCategoryId: string;
      } | null;
    }[];
  };
}

let tempIdCounter = 0;
function generateTempId() {
  return `temp-${Date.now()}-${++tempIdCounter}`;
}

export function FormBuilder({
  campaigns,
  qaCategories,
  initialData,
}: FormBuilderProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(initialData?.title ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [campaignId, setCampaignId] = useState(initialData?.campaignId ?? "");
  const [questions, setQuestions] = useState<QuestionData[]>(
    initialData?.questions.map((q) => ({
      id: q.id,
      type: q.type,
      label: q.label,
      options: Array.isArray(q.options) ? (q.options as string[]) : [],
      required: q.required,
      qaCategoryId: q.formCategory?.qaCategoryId ?? "",
      weight: q.weight,
      fatal: q.fatal,
      requiresCommentOnFail: q.requiresCommentOnFail,
    })) ?? [],
  );

  const ratingWeightTotal = questions.reduce(
    (sum, question) => sum + (question.type === "RATING" ? question.weight : 0),
    0,
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setQuestions((items) => {
        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  }, []);

  const addQuestion = () => {
    setQuestions((prev) => {
      const hasRatingQuestion = prev.some((question) => question.type === "RATING");
      const defaultCategory = qaCategories[0];

      return [
        ...prev,
        {
          id: generateTempId(),
          type: "RATING" as QuestionType,
          label: "",
          options: [],
          required: true,
          qaCategoryId: defaultCategory?.id ?? "",
          weight: hasRatingQuestion ? 0 : 100,
          fatal: false,
          requiresCommentOnFail: Boolean(defaultCategory?.requiresCommentOnFail),
        },
      ];
    });
  };

  const updateQuestion = (index: number, updated: QuestionData) => {
    setQuestions((prev) => prev.map((q, i) => (i === index ? updated : q)));
  };

  const deleteQuestion = (index: number) => {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("El titulo es obligatorio");
      return;
    }
    if (!campaignId) {
      toast.error("Selecciona una campana");
      return;
    }
    if (qaCategories.length === 0) {
      toast.error("No hay categorias QA activas para asignar");
      return;
    }
    if (questions.length === 0) {
      toast.error("Agrega al menos una pregunta");
      return;
    }
    if (questions.some((q) => !q.label.trim())) {
      toast.error("Todas las preguntas deben tener un texto");
      return;
    }
    if (questions.some((q) => !q.qaCategoryId)) {
      toast.error("Todas las preguntas deben tener una categoria QA");
      return;
    }
    const invalidFatal = questions.some((question) => {
      const category = qaCategories.find((item) => item.id === question.qaCategoryId);
      return question.fatal && !category?.canBeFatal;
    });
    if (invalidFatal) {
      toast.error("Hay fallas fatales en categorias que no lo permiten");
      return;
    }
    const optionQuestionWithoutOptions = questions.some((question) => {
      if (question.type !== "SELECT" && question.type !== "RADIO") return false;
      return question.options.filter((option) => option.trim()).length < 2;
    });
    if (optionQuestionWithoutOptions) {
      toast.error("Seleccion y opcion multiple requieren al menos 2 opciones");
      return;
    }
    if (questions.some((question) => question.type === "RATING") && ratingWeightTotal !== 100) {
      toast.error("Los pesos de preguntas rating deben sumar 100%");
      return;
    }

    setSaving(true);
    try {
      const formData = {
        title: title.trim(),
        description: description.trim() || undefined,
        campaignId,
        questions: questions.map((q) => ({
          type: q.type,
          label: q.label.trim(),
          options:
            q.options.length > 0
              ? q.options.map((option) => option.trim()).filter(Boolean)
              : undefined,
          required: q.required,
          qaCategoryId: q.qaCategoryId,
          weight: q.type === "RATING" ? q.weight : 0,
          fatal: q.fatal,
          requiresCommentOnFail: q.requiresCommentOnFail,
        })),
      };

      if (initialData) {
        await updateForm(initialData.id, formData);
        toast.success("Formulario actualizado");
      } else {
        await createForm(formData);
        toast.success("Formulario creado");
      }
      router.push("/forms");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="editor">
        <TabsList>
          <TabsTrigger value="editor">Editor</TabsTrigger>
          <TabsTrigger value="preview">Vista previa</TabsTrigger>
        </TabsList>

        <TabsContent value="editor" className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="title">Titulo</Label>
              <Input
                id="title"
                placeholder="Nombre del formulario"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="campaign">Campana</Label>
              <Select value={campaignId} onValueChange={(v) => v && setCampaignId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Seleccionar campana">
                    {(value: string | null) => {
                      if (!value) return "Seleccionar campana";
                      return (
                        campaigns.find((c) => c.id === value)?.name ??
                        "Seleccionar campana"
                      );
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descripcion (opcional)</Label>
            <Textarea
              id="description"
              placeholder="Descripcion del formulario..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg font-medium">
                  Preguntas ({questions.length})
                </h3>
                <p className="text-sm text-muted-foreground">
                  Peso rating: {ratingWeightTotal}% de 100%
                </p>
              </div>
              <Button type="button" variant="outline" onClick={addQuestion}>
                <Plus className="mr-1 h-4 w-4" />
                Agregar pregunta
              </Button>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={questions.map((q) => q.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3">
                  {questions.map((question, index) => (
                    <QuestionCard
                      key={question.id}
                      question={question}
                      index={index}
                      qaCategories={qaCategories}
                      onUpdate={(updated) => updateQuestion(index, updated)}
                      onDelete={() => deleteQuestion(index)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {questions.length === 0 && (
              <div className="flex h-32 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
                Haz clic en &quot;Agregar pregunta&quot; para comenzar
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => router.push("/forms")}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Guardando..." : initialData ? "Actualizar" : "Crear formulario"}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="preview">
          <FormPreview title={title} description={description} questions={questions} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
