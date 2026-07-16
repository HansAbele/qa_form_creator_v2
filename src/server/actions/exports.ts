"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  EXPORT_FIELD_LABELS,
  isExportFieldSelected,
  sanitizeExportFields,
  type ExportFieldKey,
} from "@/lib/export-fields";
import { submittedResponseWhere } from "@/lib/response-status";
import { getCampaignScoringSettings } from "@/lib/settings";
import { OUTCOME_LABELS } from "@/lib/disposition-outcome";
import { questionTypeLabel } from "@/types/form-builder";
import { writeAuditLog } from "@/server/audit-log";
import { emitNotificationToUser } from "@/server/notifications";
import { getCampaignFilterForPermission } from "@/server/queries/campaign-filter";

interface ExportFilters {
  campaignId?: string;
  formId?: string;
  agentId?: string;
  dateFrom?: string;
  dateTo?: string;
  fields?: string[];
}

type CampaignTargetSnapshot = {
  passThreshold: number;
  targetPassRate: number;
  targetAvgScore: number;
  targetDailyRate: number;
  fatalFailuresAllowed: number;
};

type ExportCellValue = string | number | boolean | Date | null;

const YES = "Si";
const NO = "No";

async function getExportData(filters: ExportFilters) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission("canExport", filters.campaignId);

  const where: Record<string, unknown> = {
    form: campaignFilter,
    ...submittedResponseWhere(),
    ...(filters.formId ? { formId: filters.formId } : {}),
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
  };

  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {
      ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
      ...(filters.dateTo ? { lte: new Date(`${filters.dateTo}T23:59:59`) } : {}),
    };
  }

  const responses = await prisma.response.findMany({
    where,
    include: {
      form: {
        select: {
          id: true,
          title: true,
          version: true,
          campaignId: true,
          campaign: { select: { name: true } },
        },
      },
      agent: {
        select: {
          name: true,
          agentCode: true,
          team: { select: { name: true } },
        },
      },
      evaluator: { select: { name: true } },
      disposition: {
        select: {
          name: true,
          code: true,
          outcomeType: true,
          category: { select: { name: true } },
        },
      },
      answers: {
        include: {
          question: {
            select: {
              label: true,
              type: true,
              order: true,
              weight: true,
              fatal: true,
              requiresCommentOnFail: true,
            },
          },
          category: { select: { name: true, systemColor: true } },
        },
        orderBy: { question: { order: "asc" } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const campaignIds = [...new Set(responses.map((response) => response.form.campaignId))];
  const targetEntries = await Promise.all(
    campaignIds.map(async (campaignId) => {
      const settings = await getCampaignScoringSettings(campaignId);
      return [
        campaignId,
        {
          passThreshold: settings.passThreshold,
          targetPassRate: settings.targetPassRate,
          targetAvgScore: settings.targetAvgScore,
          targetDailyRate: settings.targetDailyRate,
          fatalFailuresAllowed: settings.fatalFailuresAllowed,
        },
      ] as const;
    }),
  );

  return {
    responses,
    targetsByCampaign: new Map<string, CampaignTargetSnapshot>(targetEntries),
    userId: session.user.id,
  };
}

type ExportResponse = Awaited<ReturnType<typeof getExportData>>["responses"][number];

function getTargets(
  targetsByCampaign: Map<string, CampaignTargetSnapshot>,
  campaignId: string,
): CampaignTargetSnapshot {
  return (
    targetsByCampaign.get(campaignId) ?? {
      passThreshold: 70,
      targetPassRate: 85,
      targetAvgScore: 80,
      targetDailyRate: 20,
      fatalFailuresAllowed: 0,
    }
  );
}

function getScore(response: ExportResponse) {
  return Number(response.score);
}

function getResult(response: ExportResponse, targets: CampaignTargetSnapshot) {
  if (response.result === "PASS" || response.result === "FAIL") return response.result;
  if (response.hasFatalFail) return "FAIL";
  return getScore(response) >= targets.passThreshold ? "PASS" : "FAIL";
}

function getAnswerValue(answer: ExportResponse["answers"][number]) {
  return answer.notApplicable ? "N/A" : answer.value;
}

function getFieldValue(
  response: ExportResponse,
  field: ExportFieldKey,
  targets: CampaignTargetSnapshot,
): ExportCellValue {
  const score = getScore(response);

  switch (field) {
    case "date":
      return response.createdAt;
    case "campaign":
      return response.form.campaign.name;
    case "form":
      return response.form.title;
    case "formVersion":
      return response.formVersion ?? response.form.version;
    case "agent":
      return response.agent.name;
    case "agentCode":
      return response.agent.agentCode ?? "";
    case "team":
      return response.agent.team?.name ?? "";
    case "evaluator":
      return response.evaluator.name;
    case "disposition":
      return response.disposition?.name ?? "";
    case "dispositionCategory":
      return response.disposition?.category?.name ?? "";
    case "outcome":
      return response.disposition?.outcomeType
        ? (OUTCOME_LABELS[response.disposition.outcomeType] ?? response.disposition.outcomeType)
        : "";
    case "score":
      return score;
    case "result":
      return getResult(response, targets);
    case "fatalFail":
      return response.hasFatalFail ? YES : NO;
    case "passThreshold":
      return targets.passThreshold;
    case "targetAvgScore":
      return targets.targetAvgScore;
    case "scoreTargetDelta":
      return Math.round((score - targets.targetAvgScore) * 100) / 100;
    case "targetPassRate":
      return targets.targetPassRate;
    case "targetDailyRate":
      return targets.targetDailyRate;
    case "fatalFailuresAllowed":
      return targets.fatalFailuresAllowed;
    case "submittedAt":
      return response.submittedAt ?? response.createdAt;
    case "responseId":
      return response.id;
    case "answers":
      return null;
  }
}

function collectQuestionColumns(responses: ExportResponse[], selectedFields: ExportFieldKey[]) {
  if (!isExportFieldSelected(selectedFields, "answers")) return [];

  const labels = new Set<string>();
  for (const response of responses) {
    for (const answer of response.answers) {
      labels.add(answer.question.label);
    }
  }

  return Array.from(labels);
}

function getAnswerMap(response: ExportResponse) {
  return new Map(response.answers.map((answer) => [answer.question.label, getAnswerValue(answer)]));
}

function getBaseFields(selectedFields: ExportFieldKey[]) {
  return selectedFields.filter((field) => field !== "answers");
}

function cellToText(value: ExportCellValue) {
  if (value instanceof Date) return value.toISOString();
  if (value === null) return "";
  return String(value);
}

function escapeCsvValue(value: ExportCellValue) {
  const rawText = cellToText(value);
  const text =
    typeof value === "string" && /^[ ]*[=+\-@\t\r]/.test(rawText) ? `'${rawText}` : rawText;
  if (text.includes(",") || text.includes('"') || text.includes("\n") || text.includes("\r")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildRows(
  responses: ExportResponse[],
  selectedFields: ExportFieldKey[],
  questionColumns: string[],
  targetsByCampaign: Map<string, CampaignTargetSnapshot>,
) {
  const baseFields = getBaseFields(selectedFields);

  return responses.map((response) => {
    const targets = getTargets(targetsByCampaign, response.form.campaignId);
    const answerMap = getAnswerMap(response);

    return [
      ...baseFields.map((field) => getFieldValue(response, field, targets)),
      ...questionColumns.map((question) => answerMap.get(question) ?? ""),
    ];
  });
}

function getSelectedHeaders(selectedFields: ExportFieldKey[], questionColumns: string[]) {
  return [
    ...getBaseFields(selectedFields).map((field) => EXPORT_FIELD_LABELS[field]),
    ...questionColumns,
  ];
}

function getSummary(
  responses: ExportResponse[],
  targetsByCampaign: Map<string, CampaignTargetSnapshot>,
  filters: ExportFilters,
  selectedFields: ExportFieldKey[],
) {
  const totalEvaluations = responses.length;
  const scoreTotal = responses.reduce((sum, response) => sum + getScore(response), 0);
  const avgScore = totalEvaluations > 0 ? scoreTotal / totalEvaluations : 0;
  const passCount = responses.filter((response) => {
    const targets = getTargets(targetsByCampaign, response.form.campaignId);
    return getResult(response, targets) === "PASS";
  }).length;
  const fatalFailCount = responses.filter((response) => response.hasFatalFail).length;
  const uniqueCampaignTargets = new Map<string, CampaignTargetSnapshot>();
  for (const response of responses) {
    uniqueCampaignTargets.set(
      response.form.campaignId,
      getTargets(targetsByCampaign, response.form.campaignId),
    );
  }
  const campaignTargets = Array.from(uniqueCampaignTargets.values());

  return {
    totalEvaluations,
    avgScore: Math.round(avgScore * 100) / 100,
    passRate: totalEvaluations > 0 ? Math.round((passCount / totalEvaluations) * 100) : 0,
    fatalFailCount,
    campaignCount: uniqueCampaignTargets.size,
    targetAvgScore:
      totalEvaluations > 0
        ? Math.round(
            (responses.reduce((sum, response) => {
              const targets = getTargets(targetsByCampaign, response.form.campaignId);
              return sum + targets.targetAvgScore;
            }, 0) /
              totalEvaluations) *
              100,
          ) / 100
        : 0,
    targetPassRate:
      totalEvaluations > 0
        ? Math.round(
            (responses.reduce((sum, response) => {
              const targets = getTargets(targetsByCampaign, response.form.campaignId);
              return sum + targets.targetPassRate;
            }, 0) /
              totalEvaluations) *
              100,
          ) / 100
        : 0,
    targetDailyRate: campaignTargets.reduce((sum, targets) => sum + targets.targetDailyRate, 0),
    fatalFailuresAllowed: campaignTargets.reduce(
      (sum, targets) => sum + targets.fatalFailuresAllowed,
      0,
    ),
    filters: {
      campaignId: filters.campaignId ?? "Todas",
      formId: filters.formId ?? "Todos",
      agentId: filters.agentId ?? "Todos",
      dateFrom: filters.dateFrom ?? "",
      dateTo: filters.dateTo ?? "",
    },
    selectedFields,
  };
}

async function auditExport(
  format: string,
  filters: ExportFilters,
  selectedFields: ExportFieldKey[],
  userId: string,
  rowCount: number,
  detailRowCount = 0,
) {
  await writeAuditLog({
    userId,
    campaignId: filters.campaignId ?? null,
    module: "exports",
    action: "generated",
    entityType: "export",
    afterValue: {
      format,
      filters: { ...filters, fields: selectedFields },
      selectedFields,
      selectedFieldLabels: selectedFields.map((field) => EXPORT_FIELD_LABELS[field]),
      rowCount,
      detailRowCount,
    },
    impact: "Datos exportados segun scope de campana y permisos del usuario.",
  });

  await emitNotificationToUser({
    userId,
    campaignId: filters.campaignId ?? null,
    type: "export_generated",
    severity: "SUCCESS",
    title: `Export ${format.toUpperCase()} generado`,
    body: `${rowCount} evaluaciones exportadas con ${selectedFields.length} campos seleccionados.`,
    href: "/analytics/export",
    entityType: "export",
    metadata: {
      format,
      filters,
      selectedFields,
      rowCount,
      detailRowCount,
    },
  });
}

export async function exportToCsv(filters: ExportFilters): Promise<string> {
  const selectedFields = sanitizeExportFields(filters.fields);
  const { responses, targetsByCampaign, userId } = await getExportData(filters);
  const questionColumns = collectQuestionColumns(responses, selectedFields);
  await auditExport("csv", filters, selectedFields, userId, responses.length);

  if (responses.length === 0) return "";

  const headers = getSelectedHeaders(selectedFields, questionColumns);
  const rows = buildRows(responses, selectedFields, questionColumns, targetsByCampaign);

  return [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) => row.map(escapeCsvValue).join(",")),
  ].join("\n");
}

function styleHeaderRow(row: {
  eachCell: (callback: (cell: {
    font?: unknown;
    fill?: unknown;
    alignment?: unknown;
    border?: unknown;
  }) => void) => void;
}) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
    };
  });
}

function autoWidth(sheet: {
  columns: Array<{
    eachCell?: (
      options: { includeEmpty: boolean },
      callback: (cell: { value: unknown }) => void,
    ) => void;
    width?: number;
  }>;
}) {
  for (const column of sheet.columns) {
    let maxLen = 10;
    column.eachCell?.({ includeEmpty: false }, (cell: { value: unknown }) => {
      const len = String(cell.value ?? "").length;
      if (len > maxLen) maxLen = len;
    });
    column.width = Math.min(maxLen + 2, 48);
  }
}

function addScoreStyle(
  row: { getCell: (index: number) => { value?: unknown; font?: unknown; fill?: unknown } },
  scoreColumn: number,
  resultColumn: number | null,
) {
  const scoreCell = row.getCell(scoreColumn);
  const result = resultColumn ? String(row.getCell(resultColumn).value ?? "") : "";
  const rawScore = Number(scoreCell.value ?? 0);

  if (result === "FAIL" || rawScore < 70) {
    scoreCell.font = { color: { argb: "FFDC2626" }, bold: true };
    scoreCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
  } else if (rawScore >= 90) {
    scoreCell.font = { color: { argb: "FF166534" }, bold: true };
    scoreCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCFCE7" } };
  } else {
    scoreCell.font = { color: { argb: "FF854D0E" }, bold: true };
    scoreCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
  }
}

export async function exportToExcel(filters: ExportFilters): Promise<string> {
  const ExcelJS = (await import("exceljs")).default;
  const selectedFields = sanitizeExportFields(filters.fields);
  const { responses, targetsByCampaign, userId } = await getExportData(filters);
  const includeAnswers = isExportFieldSelected(selectedFields, "answers");
  const detailRowCount = includeAnswers
    ? responses.reduce((sum, response) => sum + response.answers.length, 0)
    : 0;
  await auditExport("xlsx", filters, selectedFields, userId, responses.length, detailRowCount);

  if (responses.length === 0) return "";

  const questionColumns = collectQuestionColumns(responses, selectedFields);
  const headers = getSelectedHeaders(selectedFields, questionColumns);
  const rows = buildRows(responses, selectedFields, questionColumns, targetsByCampaign);
  const summary = getSummary(responses, targetsByCampaign, filters, selectedFields);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Qore";
  workbook.created = new Date();
  workbook.modified = new Date();

  const summarySheet = workbook.addWorksheet("Resumen");
  summarySheet.columns = [
    { header: "Metrica", key: "metric", width: 28 },
    { header: "Valor", key: "value", width: 28 },
  ];
  styleHeaderRow(summarySheet.getRow(1));
  const summaryRows: [string, string | number][] = [
    ["Total evaluaciones", summary.totalEvaluations],
    ["Score promedio", summary.avgScore],
    ["Target score", summary.targetAvgScore],
    ["Pass rate", `${summary.passRate}%`],
    ["Target pass rate", `${summary.targetPassRate}%`],
    ["Fallas fatales", summary.fatalFailCount],
    ["Fatales permitidas", summary.fatalFailuresAllowed],
    ["Target diario", summary.targetDailyRate],
    ["Campanas incluidas", summary.campaignCount],
    ["Filtro campana", summary.filters.campaignId],
    ["Filtro formulario", summary.filters.formId],
    ["Filtro agente", summary.filters.agentId],
    ["Desde", summary.filters.dateFrom],
    ["Hasta", summary.filters.dateTo],
    ["Campos", summary.selectedFields.map((field) => EXPORT_FIELD_LABELS[field]).join(", ")],
  ];
  summarySheet.addRows(summaryRows.map(([metric, value]) => ({ metric, value })));
  summarySheet.views = [{ state: "frozen", ySplit: 1 }];

  const evaluationSheet = workbook.addWorksheet("Evaluaciones");
  const headerRow = evaluationSheet.addRow(headers);
  styleHeaderRow(headerRow);
  rows.forEach((row) => {
    evaluationSheet.addRow(row);
  });
  evaluationSheet.views = [{ state: "frozen", ySplit: 1 }];
  evaluationSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: Math.max(headers.length, 1) },
  };

  const scoreIndex = headers.indexOf(EXPORT_FIELD_LABELS.score) + 1;
  const resultIndex = headers.indexOf(EXPORT_FIELD_LABELS.result) + 1;
  if (scoreIndex > 0) {
    for (let rowNumber = 2; rowNumber <= evaluationSheet.rowCount; rowNumber++) {
      addScoreStyle(evaluationSheet.getRow(rowNumber), scoreIndex, resultIndex || null);
    }
    evaluationSheet.getColumn(scoreIndex).numFmt = "0.00";
  }
  const dateIndex = headers.indexOf(EXPORT_FIELD_LABELS.date) + 1;
  if (dateIndex > 0) evaluationSheet.getColumn(dateIndex).numFmt = "yyyy-mm-dd hh:mm";
  const submittedIndex = headers.indexOf(EXPORT_FIELD_LABELS.submittedAt) + 1;
  if (submittedIndex > 0) evaluationSheet.getColumn(submittedIndex).numFmt = "yyyy-mm-dd hh:mm";
  autoWidth(evaluationSheet);

  if (includeAnswers) {
    const detailSheet = workbook.addWorksheet("Detalle respuestas");
    const detailHeaders = [
      "ID evaluacion",
      "Fecha",
      "Campana",
      "Formulario",
      "Agente",
      "Evaluador",
      "Categoria QA",
      "Pregunta",
      "Tipo",
      "Respuesta",
      "Score respuesta",
      "Peso pregunta",
      "Pregunta fatal",
      "Respuesta fatal",
      "N/A",
      "Comentario requerido",
      "Comentario",
    ];
    styleHeaderRow(detailSheet.addRow(detailHeaders));

    for (const response of responses) {
      for (const answer of response.answers) {
        detailSheet.addRow([
          response.id,
          response.createdAt,
          response.form.campaign.name,
          response.form.title,
          response.agent.name,
          response.evaluator.name,
          answer.category?.name ?? "",
          answer.question.label,
          questionTypeLabel(answer.question.type),
          getAnswerValue(answer),
          answer.score === null ? null : Number(answer.score),
          answer.question.weight,
          answer.question.fatal ? YES : NO,
          answer.isFatalFail ? YES : NO,
          answer.notApplicable ? YES : NO,
          answer.question.requiresCommentOnFail ? YES : NO,
          answer.comment ?? "",
        ]);
      }
    }
    detailSheet.views = [{ state: "frozen", ySplit: 1 }];
    detailSheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: detailHeaders.length },
    };
    detailSheet.getColumn(2).numFmt = "yyyy-mm-dd hh:mm";
    detailSheet.getColumn(11).numFmt = "0.00";
    autoWidth(detailSheet);
  }

  autoWidth(summarySheet);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer).toString("base64");
}

export async function exportToJson(filters: ExportFilters): Promise<string> {
  const selectedFields = sanitizeExportFields(filters.fields);
  const { responses, targetsByCampaign, userId } = await getExportData(filters);
  await auditExport("json", filters, selectedFields, userId, responses.length);

  const baseFields = getBaseFields(selectedFields);
  const includeAnswers = isExportFieldSelected(selectedFields, "answers");
  const data = responses.map((response) => {
    const targets = getTargets(targetsByCampaign, response.form.campaignId);
    const row: Record<string, unknown> = Object.fromEntries(
      baseFields.map((field) => [field, getFieldValue(response, field, targets)]),
    );

    if (includeAnswers) {
      row.answers = response.answers.map((answer) => ({
        question: answer.question.label,
        type: questionTypeLabel(answer.question.type),
        category: answer.category?.name ?? null,
        value: getAnswerValue(answer),
        score: answer.score === null ? null : Number(answer.score),
        weight: answer.question.weight,
        fatalQuestion: answer.question.fatal,
        fatalAnswer: answer.isFatalFail,
        notApplicable: answer.notApplicable,
        requiresCommentOnFail: answer.question.requiresCommentOnFail,
        comment: answer.comment,
      }));
    }

    return row;
  });

  return JSON.stringify(data, null, 2);
}
