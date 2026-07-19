export type ExportFieldKey =
  | "date"
  | "campaign"
  | "form"
  | "agent"
  | "agentCode"
  | "team"
  | "evaluator"
  | "disposition"
  | "dispositionCategory"
  | "outcome"
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
    label: "Identity",
    fields: [
      { key: "date", label: "Date" },
      { key: "campaign", label: "Campaign" },
      { key: "form", label: "Form" },
      { key: "agent", label: "Agent" },
      { key: "agentCode", label: "Agent code" },
      { key: "team", label: "Team" },
      { key: "evaluator", label: "Evaluator" },
      { key: "disposition", label: "Disposition" },
      { key: "dispositionCategory", label: "Disposition category" },
      { key: "outcome", label: "Call outcome" },
    ],
  },
  {
    id: "scoring",
    label: "Scoring",
    fields: [
      { key: "score", label: "Score" },
      { key: "result", label: "Result" },
      { key: "fatalFail", label: "Critical failure" },
      { key: "passThreshold", label: "Pass threshold" },
      { key: "targetAvgScore", label: "Target average score" },
      { key: "scoreTargetDelta", label: "Score target delta" },
      { key: "targetPassRate", label: "Target pass rate" },
      { key: "targetDailyRate", label: "Daily target" },
      { key: "fatalFailuresAllowed", label: "Allowed critical failures" },
    ],
  },
  {
    id: "detail",
    label: "Details",
    fields: [
      { key: "submittedAt", label: "Submission date" },
      { key: "responseId", label: "Evaluation ID" },
      { key: "answers", label: "Answers" },
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
  "agent",
  "agentCode",
  "team",
  "evaluator",
  "disposition",
  "outcome",
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
