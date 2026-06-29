export type ExportFieldKey =
  | "date"
  | "campaign"
  | "form"
  | "formVersion"
  | "agent"
  | "agentCode"
  | "team"
  | "evaluator"
  | "disposition"
  | "dispositionCategory"
  | "score"
  | "result"
  | "fatalFail"
  | "passThreshold"
  | "targetAvgScore"
  | "scoreTargetDelta"
  | "targetPassRate"
  | "targetDailyRate"
  | "fatalFailuresAllowed"
  | "submittedAt"
  | "responseId"
  | "answers";

type ExportFieldDefinition = { key: ExportFieldKey; label: string };
type ExportFieldGroup = { id: string; label: string; fields: ExportFieldDefinition[] };

export const EXPORT_FIELD_GROUPS: ExportFieldGroup[] = [
  {
    id: "identity",
    label: "Identidad",
    fields: [
      { key: "date", label: "Fecha" },
      { key: "campaign", label: "Campana" },
      { key: "form", label: "Formulario" },
      { key: "formVersion", label: "Version" },
      { key: "agent", label: "Agente" },
      { key: "agentCode", label: "Codigo agente" },
      { key: "team", label: "Equipo" },
      { key: "evaluator", label: "Evaluador" },
      { key: "disposition", label: "Disposicion" },
      { key: "dispositionCategory", label: "Categoria disposicion" },
    ],
  },
  {
    id: "scoring",
    label: "Scoring",
    fields: [
      { key: "score", label: "Score" },
      { key: "result", label: "Resultado" },
      { key: "fatalFail", label: "Falla fatal" },
      { key: "passThreshold", label: "Umbral pass" },
      { key: "targetAvgScore", label: "Target score" },
      { key: "scoreTargetDelta", label: "Delta target score" },
      { key: "targetPassRate", label: "Target pass rate" },
      { key: "targetDailyRate", label: "Target diario" },
      { key: "fatalFailuresAllowed", label: "Fatales permitidas" },
    ],
  },
  {
    id: "detail",
    label: "Detalle",
    fields: [
      { key: "submittedAt", label: "Fecha envio" },
      { key: "responseId", label: "ID evaluacion" },
      { key: "answers", label: "Respuestas" },
    ],
  },
];

export const EXPORT_FIELD_DEFINITIONS = EXPORT_FIELD_GROUPS.flatMap((group) => group.fields);

export const EXPORT_FIELD_LABELS = Object.fromEntries(
  EXPORT_FIELD_DEFINITIONS.map((field) => [field.key, field.label]),
) as Record<ExportFieldKey, string>;

export const ALL_EXPORT_FIELDS = EXPORT_FIELD_DEFINITIONS.map((field) => field.key);

export const DEFAULT_EXPORT_FIELDS: ExportFieldKey[] = [
  "date",
  "campaign",
  "form",
  "formVersion",
  "agent",
  "agentCode",
  "team",
  "evaluator",
  "disposition",
  "score",
  "result",
  "fatalFail",
  "passThreshold",
  "targetAvgScore",
  "scoreTargetDelta",
  "submittedAt",
  "answers",
];

export function sanitizeExportFields(fields?: string[]): ExportFieldKey[] {
  if (!fields || fields.length === 0) return DEFAULT_EXPORT_FIELDS;

  const allowed = new Set<ExportFieldKey>(ALL_EXPORT_FIELDS);
  const unique = fields.filter((field): field is ExportFieldKey =>
    allowed.has(field as ExportFieldKey),
  );

  return unique.length > 0 ? [...new Set(unique)] : DEFAULT_EXPORT_FIELDS;
}

export function isExportFieldSelected(fields: ExportFieldKey[], field: ExportFieldKey) {
  return fields.includes(field);
}
