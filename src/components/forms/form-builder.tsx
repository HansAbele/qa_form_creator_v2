"use client";

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
import { AlertTriangle, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { type CriticalTypeValue, isOptionQuestionType, isScoredQuestionType } from "@/types/form-builder";
import type { QuestionType } from "@prisma/client";
import { FormPreview } from "./form-preview";
import { type QuestionData, QuestionPanel } from "./question-panel";
import { QuestionRow } from "./question-row";
import { WeightBalanceMeter } from "./weight-balance-meter";

interface Campaign {
  id: string;
  name: string;
}

export interface QACategoryOption {
  id: string;
  name: string;
  description: string | null;
  systemColor: string | null;
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
    status: string;
    version: string;
    publishedAt: Date | null;
    parentFormId: string | null;
    questions: {
      id: string;
      type: QuestionType;
      label: string;
      options: unknown;
      fatalOptions: unknown;
      required: boolean;
      weight: number;
      fatal: boolean;
      criticalType?: CriticalTypeValue | null;
      ratingFailThreshold?: number | null;
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

export function FormBuilder({ campaigns, qaCategories, initialData }: FormBuilderProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(initialData?.title ?? "");
  const [description, setDescription] = useState(initialData?.description ?? "");
  const [campaignId, setCampaignId] = useState(initialData?.campaignId ?? "");
  const [questions, setQuestions] = useState<QuestionData[]>(
    initialData?.questions.map((q) => {
      const { options, optionPoints } = parseStoredOptions(q.options);
      return {
        id: q.id,
        type: q.type,
        label: q.label,
        options,
        optionPoints,
        fatalOptions: Array.isArray(q.fatalOptions) ? (q.fatalOptions as string[]) : [],
        required: q.required,
        qaCategoryId: q.formCategory?.qaCategoryId ?? "",
        weight: q.weight,
        fatal: q.fatal,
        criticalType: q.criticalType ?? null,
        ratingFailThreshold: q.ratingFailThreshold ?? null,
        requiresCommentOnFail: q.requiresCommentOnFail,
      };
    }) ?? [],
  );
  const [draft, setDraft] = useState<QuestionData | null>(null);
  const [panelMode, setPanelMode] = useState<"add" | "edit">("add");

  const editingPublished = initialData?.status === "PUBLISHED";
  const statusText =
    initialData?.status === "PUBLISHED"
      ? "Publicado"
      : initialData?.status === "ARCHIVED"
        ? "Archivado"
        : "Borrador";

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Reorder only within the same category; category changes go through the panel.
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setQuestions((items) => {
      const from = items.find((item) => item.id === active.id);
      const to = items.find((item) => item.id === over.id);
      if (!from || !to || from.qaCategoryId !== to.qaCategoryId) return items;
      const oldIndex = items.findIndex((item) => item.id === active.id);
      const newIndex = items.findIndex((item) => item.id === over.id);
      return arrayMove(items, oldIndex, newIndex);
    });
  }, []);

  // Persist an in-progress, complete draft so switching panels never loses it.
  const commitDraft = () => {
    if (draft?.label.trim() && draft.qaCategoryId) {
      setQuestions((prev) => mergeDraft(prev, draft, panelMode));
    }
  };

  const startAdd = (categoryId?: string) => {
    commitDraft();
    const hasScoredQuestion = questions.some((question) => isScoredQuestionType(question.type));
    const category = qaCategories.find((item) => item.id === categoryId) ?? qaCategories[0];
    setPanelMode("add");
    setDraft({
      id: generateTempId(),
      type: "RATING" as QuestionType,
      label: "",
      options: [],
      optionPoints: [],
      required: true,
      qaCategoryId: category?.id ?? "",
      weight: hasScoredQuestion ? 0 : 100,
      fatal: false,
      fatalOptions: [],
      criticalType: null,
      ratingFailThreshold: null,
      requiresCommentOnFail: Boolean(category?.requiresCommentOnFail),
    });
  };

  const startEdit = (question: QuestionData) => {
    if (panelMode === "edit" && draft?.id === question.id) return; // already open
    commitDraft();
    setPanelMode("edit");
    setDraft({ ...question });
  };

  const submitPanel = () => {
    if (!draft) return;
    setQuestions((prev) =>
      panelMode === "edit" ? prev.map((q) => (q.id === draft.id ? draft : q)) : [...prev, draft],
    );
    setDraft(null);
  };

  const deleteQuestion = (id: string) => {
    setQuestions((prev) => prev.filter((question) => question.id !== id));
    setDraft((current) => (current?.id === id ? null : current));
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

    // Fold an open, complete draft into the set so it is never silently lost.
    let effectiveQuestions = questions;
    if (draft) {
      if (!draft.label.trim() || !draft.qaCategoryId) {
        toast.error("Termina la pregunta abierta en el panel antes de guardar");
        return;
      }
      effectiveQuestions = mergeDraft(questions, draft, panelMode);
    }

    if (effectiveQuestions.length === 0) {
      toast.error("Agrega al menos una pregunta");
      return;
    }
    if (effectiveQuestions.some((q) => !q.label.trim())) {
      toast.error("Todas las preguntas deben tener un texto");
      return;
    }
    if (effectiveQuestions.some((q) => !q.qaCategoryId)) {
      toast.error("Todas las preguntas deben tener una categoria QA");
      return;
    }
    const invalidFatal = effectiveQuestions.some((question) => {
      const category = qaCategories.find((item) => item.id === question.qaCategoryId);
      return question.fatal && !category?.canBeFatal;
    });
    if (invalidFatal) {
      toast.error("Hay fallas fatales en categorias que no lo permiten");
      return;
    }
    const optionQuestionWithoutOptions = effectiveQuestions.some((question) => {
      if (!isOptionQuestionType(question.type)) return false;
      return question.options.filter((option) => option.trim()).length < 2;
    });
    if (optionQuestionWithoutOptions) {
      toast.error("Seleccion y opcion multiple requieren al menos 2 opciones");
      return;
    }
    const fatalOptionQuestionWithoutRules = effectiveQuestions.some((question) => {
      if (!question.fatal || !isOptionQuestionType(question.type)) return false;
      const validFatalOptions = getValidFatalOptions(question.fatalOptions, question.options);
      return validFatalOptions.length === 0;
    });
    if (fatalOptionQuestionWithoutRules) {
      toast.error("Selecciona al menos una opcion fatal en preguntas criticas");
      return;
    }
    const scoredTotal = effectiveQuestions.reduce(
      (sum, question) => sum + (isScoredQuestionType(question.type) ? question.weight : 0),
      0,
    );
    if (
      effectiveQuestions.some((question) => isScoredQuestionType(question.type)) &&
      scoredTotal !== 100
    ) {
      toast.error("Los pesos de las preguntas puntuables deben sumar 100%");
      return;
    }

    setSaving(true);
    try {
      const formData = {
        title: title.trim(),
        description: description.trim() || undefined,
        campaignId,
        questions: effectiveQuestions.map((q) => {
          // Keep options and their points aligned after dropping blanks.
          const keptIndexes = q.options
            .map((option, index) => (option.trim() ? index : -1))
            .filter((index) => index >= 0);
          const options = keptIndexes.map((index) => q.options[index].trim());
          const optionPoints = keptIndexes.map((index) => q.optionPoints[index] ?? 0);

          return {
            type: q.type,
            label: q.label.trim(),
            options: options.length > 0 ? options : undefined,
            optionPoints:
              isOptionQuestionType(q.type) && options.length > 0 ? optionPoints : undefined,
            fatalOptions:
              q.fatal && isOptionQuestionType(q.type)
                ? getValidFatalOptions(q.fatalOptions, q.options)
                : undefined,
            required: q.required,
            qaCategoryId: q.qaCategoryId,
            weight: isScoredQuestionType(q.type) ? q.weight : 0,
            fatal: q.fatal,
            criticalType: q.fatal ? (q.criticalType ?? undefined) : undefined,
            ratingFailThreshold:
              q.fatal && q.type === "RATING" ? (q.ratingFailThreshold ?? undefined) : undefined,
            requiresCommentOnFail: q.requiresCommentOnFail,
          };
        }),
      };

      if (initialData) {
        const savedForm = await updateForm(initialData.id, formData);
        if (editingPublished && savedForm.id !== initialData.id) {
          toast.success(`Borrador v${savedForm.version} creado`);
          router.push(`/forms/${savedForm.id}/edit`);
          router.refresh();
          return;
        }
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

  const groups = groupByCategory(questions, qaCategories);

  return (
    <div className="space-y-6">
      {initialData && (
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            {editingPublished && (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            )}
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={editingPublished ? "default" : "secondary"}>{statusText}</Badge>
                <Badge variant="outline">v{initialData.version}</Badge>
              </div>
              {editingPublished && (
                <p className="text-sm text-muted-foreground">
                  Guardar cambios crea un borrador de nueva version sin alterar la version
                  publicada.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
      <Tabs defaultValue="editor">
        <TabsList>
          <TabsTrigger value="editor">Editor</TabsTrigger>
          <TabsTrigger value="preview">Vista previa</TabsTrigger>
        </TabsList>

        <TabsContent value="editor">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            {/* Canvas */}
            <div className="min-w-0 flex-1 space-y-5">
              <div className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
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
                  <Select
                    value={campaignId}
                    onValueChange={(v) => v && setCampaignId(v)}
                    disabled={editingPublished}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Seleccionar campana">
                        {(value: string | null) => {
                          if (!value) return "Seleccionar campana";
                          return campaigns.find((c) => c.id === value)?.name ?? "Seleccionar campana";
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
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="description">Descripcion (opcional)</Label>
                  <Textarea
                    id="description"
                    placeholder="Descripcion del formulario..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <h3 className="font-heading text-lg font-semibold">
                  Preguntas ({questions.length})
                </h3>
                <Button type="button" variant="outline" onClick={() => startAdd()}>
                  <Plus className="mr-1 h-4 w-4" />
                  Agregar pregunta
                </Button>
              </div>

              {questions.length === 0 ? (
                <div className="flex h-32 items-center justify-center rounded-xl border border-dashed text-muted-foreground">
                  Haz clic en &quot;Agregar pregunta&quot; para comenzar
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <div className="space-y-4">
                    {groups.map((group, gi) => (
                      <div key={group.catId} className="rounded-xl border border-border bg-card">
                        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: group.color ?? "hsl(var(--primary))" }}
                          />
                          <span className="font-heading text-sm font-semibold">{group.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {group.items.length} pregunta{group.items.length === 1 ? "" : "s"}
                          </span>
                          {group.weight > 0 && (
                            <Badge variant="outline" className="text-[10px] tabular-nums">
                              Peso {group.weight}%
                            </Badge>
                          )}
                        </div>
                        <div className="space-y-2 p-3">
                          <SortableContext
                            items={group.items.map((q) => q.id)}
                            strategy={verticalListSortingStrategy}
                          >
                            {group.items.map((question, ii) => (
                              <QuestionRow
                                key={question.id}
                                question={question}
                                index={`${gi + 1}.${ii + 1}`}
                                active={draft?.id === question.id}
                                onEdit={() => startEdit(question)}
                                onDelete={() => deleteQuestion(question.id)}
                              />
                            ))}
                          </SortableContext>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            className="w-full border border-dashed border-border text-muted-foreground"
                            onClick={() => startAdd(group.catId)}
                          >
                            <Plus className="mr-1 h-3.5 w-3.5" />
                            Agregar pregunta a {group.name}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </DndContext>
              )}
            </div>

            {/* Sticky panel — balance + add/edit + actions */}
            <div className="space-y-4 lg:sticky lg:top-[82px] lg:w-[360px] lg:shrink-0">
              <WeightBalanceMeter questions={questions} qaCategories={qaCategories} />
              {draft && (
                <QuestionPanel
                  draft={draft}
                  qaCategories={qaCategories}
                  mode={panelMode}
                  onChange={setDraft}
                  onSubmit={submitPanel}
                  onCancel={() => setDraft(null)}
                />
              )}
              <div className="space-y-2 rounded-xl border border-border bg-card p-4">
                <Button onClick={handleSave} disabled={saving} className="w-full">
                  {saving ? "Guardando..." : initialData ? "Actualizar" : "Crear formulario"}
                </Button>
                <Button variant="outline" onClick={() => router.push("/forms")} className="w-full">
                  Cancelar
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="preview">
          <FormPreview title={title} description={description} questions={questions} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function mergeDraft(
  list: QuestionData[],
  draft: QuestionData,
  mode: "add" | "edit",
): QuestionData[] {
  return mode === "edit" ? list.map((q) => (q.id === draft.id ? draft : q)) : [...list, draft];
}

interface QuestionGroup {
  catId: string;
  name: string;
  color: string | null;
  weight: number;
  items: QuestionData[];
}

function groupByCategory(
  questions: QuestionData[],
  qaCategories: QACategoryOption[],
): QuestionGroup[] {
  const order: string[] = [];
  for (const question of questions) {
    if (!order.includes(question.qaCategoryId)) order.push(question.qaCategoryId);
  }
  return order.map((catId) => {
    const items = questions.filter((question) => question.qaCategoryId === catId);
    const category = qaCategories.find((c) => c.id === catId);
    return {
      catId,
      name: category?.name ?? "Sin categoria",
      color: category?.systemColor ?? null,
      weight: items.reduce(
        (sum, question) => sum + (isScoredQuestionType(question.type) ? question.weight : 0),
        0,
      ),
      items,
    };
  });
}

/** Parses stored options (legacy `string[]` or weighted `[{value, points}]`). */
function parseStoredOptions(raw: unknown): { options: string[]; optionPoints: number[] } {
  if (!Array.isArray(raw)) return { options: [], optionPoints: [] };
  const options: string[] = [];
  const optionPoints: number[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      options.push(item);
      optionPoints.push(0);
    } else if (item && typeof item === "object" && "value" in item) {
      options.push(String((item as { value: unknown }).value));
      optionPoints.push("points" in item ? Number((item as { points: unknown }).points) || 0 : 0);
    }
  }
  return { options, optionPoints };
}

function normalizeOptions(options: string[]) {
  return Array.from(new Set(options.map((option) => option.trim()).filter(Boolean)));
}

function getValidFatalOptions(fatalOptions: string[], options: string[]) {
  const optionSet = new Set(normalizeOptions(options));
  return normalizeOptions(fatalOptions).filter((option) => optionSet.has(option));
}
