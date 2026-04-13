"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QuestionCard, type QuestionData } from "./question-card";
import { FormPreview } from "./form-preview";
import { createForm, updateForm } from "@/server/actions/forms";
import type { QuestionType } from "@prisma/client";

interface Campaign {
  id: string;
  name: string;
}

interface FormBuilderProps {
  campaigns: Campaign[];
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
      order: number;
    }[];
  };
}

let tempIdCounter = 0;
function generateTempId() {
  return `temp-${Date.now()}-${++tempIdCounter}`;
}

export function FormBuilder({ campaigns, initialData }: FormBuilderProps) {
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
    })) ?? [],
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        setQuestions((items) => {
          const oldIndex = items.findIndex((i) => i.id === active.id);
          const newIndex = items.findIndex((i) => i.id === over.id);
          return arrayMove(items, oldIndex, newIndex);
        });
      }
    },
    [],
  );

  const addQuestion = () => {
    setQuestions((prev) => [
      ...prev,
      {
        id: generateTempId(),
        type: "RATING" as QuestionType,
        label: "",
        options: [],
        required: true,
      },
    ]);
  };

  const updateQuestion = (index: number, updated: QuestionData) => {
    setQuestions((prev) => prev.map((q, i) => (i === index ? updated : q)));
  };

  const deleteQuestion = (index: number) => {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("El título es obligatorio");
      return;
    }
    if (!campaignId) {
      toast.error("Selecciona una campaña");
      return;
    }
    if (questions.length === 0) {
      toast.error("Agrega al menos una pregunta");
      return;
    }
    const emptyLabels = questions.some((q) => !q.label.trim());
    if (emptyLabels) {
      toast.error("Todas las preguntas deben tener un texto");
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
          options: q.options.length > 0 ? q.options.filter((o) => o.trim()) : undefined,
          required: q.required,
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
              <Label htmlFor="title">Título</Label>
              <Input
                id="title"
                placeholder="Nombre del formulario"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="campaign">Campaña</Label>
              <Select value={campaignId} onValueChange={(v) => v && setCampaignId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Seleccionar campaña">
                    {(value: string | null) => {
                      if (!value) return "Seleccionar campaña";
                      return (
                        campaigns.find((c) => c.id === value)?.name ??
                        "Seleccionar campaña"
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
            <Label htmlFor="description">Descripción (opcional)</Label>
            <Textarea
              id="description"
              placeholder="Descripción del formulario..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">
                Preguntas ({questions.length})
              </h3>
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
          <FormPreview
            title={title}
            description={description}
            questions={questions}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
