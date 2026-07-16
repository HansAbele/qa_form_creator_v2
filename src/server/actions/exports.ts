import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { OUTCOME_LABELS } from "@/lib/disposition-outcome";
import {
  EXPORT_FIELD_LABELS,
  type ExportFieldKey,
  isExportFieldSelected,
  sanitizeExportFields,
} from "@/lib/export-fields";
import { ExportLimitError, ExportNoDataError, getExportLimits } from "@/lib/export-limits";
import { getOperationalDateBounds } from "@/lib/operational-time";
import { prisma } from "@/lib/prisma";
import { submittedResponseWhere } from "@/lib/response-status";
import { getCampaignScoringSettingsMap } from "@/lib/settings";
import { writeAuditLog } from "@/server/audit-log";
import { reserveExportCapacity } from "@/server/export-admission";
import { emitNotificationToUser } from "@/server/notifications";
import {
  CampaignAuthorizationError,
  getCampaignFilterForPermission,
} from "@/server/queries/campaign-filter";
import { questionTypeLabel } from "@/types/form-builder";

export interface ExportFilters {
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

const EXPORT_QUERY_BATCH_SIZE = 300;

type ExportPayloadBudget = {
  answerRows: bigint | number;
  textBytes: bigint | number;
};

async function getExportData(filters: ExportFilters, selectedFields: ExportFieldKey[]) {
  const session = await auth();
  if (!session?.user) throw new CampaignAuthorizationError("No autorizado");

  const campaignFilter = await getCampaignFilterForPermission("canExport", filters.campaignId);
  const limits = getExportLimits();
  const includeAnswers = isExportFieldSelected(selectedFields, "answers");

  const where: Record<string, unknown> = {
    form: campaignFilter,
    ...submittedResponseWhere(),
    ...(filters.formId ? { formId: filters.formId } : {}),
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
  };

  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = getOperationalDateBounds(filters.dateFrom, filters.dateTo);
  }

  const responses = await prisma.$transaction(
    async (tx) => {
      const responseIds = await tx.response.findMany({
        where,
        select: { id: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limits.maxEvaluations + 1,
      });

      if (responseIds.length > limits.maxEvaluations) {
        throw new ExportLimitError(
          `La exportacion supera ${limits.maxEvaluations} evaluaciones. Acota campana, formulario o fechas.`,
        );
      }

      if (responseIds.length > 0) {
        const answerTotals = includeAnswers
          ? Prisma.sql`
          (SELECT COUNT(*)::bigint FROM answer_payload) AS "answerRows",
          (SELECT COALESCE(SUM("textBytes"), 0)::bigint FROM answer_payload)
        `
          : Prisma.sql`0::bigint AS "answerRows", 0::bigint`;
        const payloadBudget = await tx.$queryRaw<ExportPayloadBudget[]>(Prisma.sql`
      WITH selected_response AS (
        SELECT
          response."id",
          (
            octet_length(COALESCE(response."id", ''))
            + octet_length(COALESCE(response."formVersion", form."version", ''))
            + octet_length(COALESCE(form."title", ''))
            + octet_length(COALESCE(campaign."name", ''))
            + octet_length(COALESCE(agent."name", ''))
            + octet_length(COALESCE(agent."agentCode", ''))
            + octet_length(COALESCE(team."name", ''))
            + octet_length(COALESCE(evaluator."name", ''))
            + octet_length(COALESCE(disposition."name", ''))
            + octet_length(COALESCE(disposition."code", ''))
            + octet_length(COALESCE(disposition."outcomeType"::text, ''))
            + octet_length(COALESCE(disposition_category."name", ''))
          )::bigint AS "baseTextBytes",
          (
            octet_length(COALESCE(response."id", ''))
            + octet_length(COALESCE(campaign."name", ''))
            + octet_length(COALESCE(form."title", ''))
            + octet_length(COALESCE(agent."name", ''))
            + octet_length(COALESCE(evaluator."name", ''))
          )::bigint AS "detailPrefixBytes"
        FROM "Response" response
        JOIN "Form" form ON form."id" = response."formId"
        JOIN "Campaign" campaign ON campaign."id" = form."campaignId"
        JOIN "Agent" agent ON agent."id" = response."agentId"
        JOIN "User" evaluator ON evaluator."id" = response."evaluatorId"
        LEFT JOIN "Team" team ON team."id" = agent."teamId"
        LEFT JOIN "Disposition" disposition ON disposition."id" = response."dispositionId"
        LEFT JOIN "DispositionCategory" disposition_category
          ON disposition_category."id" = disposition."categoryId"
        WHERE response."id" IN (
          ${Prisma.join(responseIds.map((response) => Prisma.sql`${response.id}`))}
        )
      ),
      answer_payload AS (
        SELECT
          (
            selected_response."detailPrefixBytes"
            + octet_length(COALESCE(answer."id", ''))
            + octet_length(COALESCE(answer."value", ''))
            + octet_length(COALESCE(answer."comment", ''))
            + octet_length(COALESCE(question."id", ''))
            + octet_length(COALESCE(question."label", ''))
            + octet_length(COALESCE(question."type"::text, ''))
            + octet_length(COALESCE(question_category."name", ''))
            + octet_length(COALESCE(answer_category."name", ''))
            + octet_length(COALESCE(answer_category."systemColor", ''))
          )::bigint AS "textBytes"
        FROM selected_response
        JOIN "Answer" answer ON answer."responseId" = selected_response."id"
        JOIN "Question" question ON question."id" = answer."questionId"
        LEFT JOIN "FormCategory" form_category
          ON form_category."id" = question."formCategoryId"
        LEFT JOIN "QACategory" question_category
          ON question_category."id" = form_category."qaCategoryId"
        LEFT JOIN "QACategory" answer_category ON answer_category."id" = answer."categoryId"
      )
      SELECT
        ${answerTotals} +
        COALESCE((SELECT SUM("baseTextBytes") FROM selected_response), 0)::bigint
        AS "textBytes"
    `);
        const answerRows = Number(payloadBudget[0]?.answerRows ?? 0);
        const textBytes = Number(payloadBudget[0]?.textBytes ?? 0);
        if (answerRows > limits.maxAnswerRows) {
          throw new ExportLimitError(
            `La exportacion supera ${limits.maxAnswerRows} respuestas. Acota los filtros o excluye Respuestas.`,
          );
        }
        if (textBytes > limits.maxTextBytes) {
          throw new ExportLimitError(
            `La exportacion supera ${limits.maxTextBytes} bytes de texto. Acota los filtros o excluye Respuestas.`,
          );
        }
      }

      const snapshotResponses: Awaited<ReturnType<typeof getResponseBatch>> = [];
      for (let offset = 0; offset < responseIds.length; offset += EXPORT_QUERY_BATCH_SIZE) {
        const batchIds = responseIds
          .slice(offset, offset + EXPORT_QUERY_BATCH_SIZE)
          .map((response) => response.id);
        const batch = await getResponseBatch(tx, batchIds, where, includeAnswers);
        snapshotResponses.push(...batch);
      }
      return snapshotResponses;
    },
    {
      isolationLevel: "RepeatableRead",
      maxWait: 5_000,
      timeout: 60_000,
    },
  );

  const exportableResponses = responses.filter(
    (response) =>
      response.agent.campaignId === response.form.campaignId &&
      (!response.agent.team || response.agent.team.campaignId === response.form.campaignId) &&
      (!response.disposition ||
        (response.disposition.campaignId === response.form.campaignId &&
          (!response.disposition.category ||
            response.disposition.category.campaignId === response.form.campaignId))) &&
      response.answers.every((answer) => answer.question.formId === response.form.id),
  );

  const hydratedTextBytes = getHydratedExportTextBytes(exportableResponses, includeAnswers);
  if (hydratedTextBytes > limits.maxTextBytes) {
    throw new ExportLimitError(
      `La exportacion supera ${limits.maxTextBytes} bytes de texto. Acota los filtros o excluye Respuestas.`,
    );
  }

  const answerRows = includeAnswers
    ? exportableResponses.reduce((sum, response) => sum + response.answers.length, 0)
    : 0;
  if (answerRows > limits.maxAnswerRows) {
    throw new ExportLimitError(
      `La exportacion supera ${limits.maxAnswerRows} respuestas. Acota los filtros o excluye Respuestas.`,
    );
  }

  const campaignIds = [...new Set(exportableResponses.map((response) => response.form.campaignId))];
  const settingsByCampaign = await getCampaignScoringSettingsMap(campaignIds);
  const targetsByCampaign = new Map<string, CampaignTargetSnapshot>();
  for (const campaignId of campaignIds) {
    const settings = settingsByCampaign.get(campaignId);
    if (!settings) continue;
    targetsByCampaign.set(campaignId, {
      passThreshold: settings.passThreshold,
      targetPassRate: settings.targetPassRate,
      targetAvgScore: settings.targetAvgScore,
      targetDailyRate: settings.targetDailyRate,
      fatalFailuresAllowed: settings.fatalFailuresAllowed,
    });
  }

  return {
    responses: exportableResponses,
    targetsByCampaign,
    campaignIds,
    userId: session.user.id,
    limits,
  };
}

async function getResponseBatch(
  client: Pick<Prisma.TransactionClient, "response">,
  responseIds: string[],
  scopedWhere: Record<string, unknown>,
  includeAnswers: boolean,
) {
  if (responseIds.length === 0) return [];

  return client.response.findMany({
    where: { ...scopedWhere, id: { in: responseIds } },
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
          campaignId: true,
          team: { select: { name: true, campaignId: true } },
        },
      },
      evaluator: { select: { name: true } },
      disposition: {
        select: {
          name: true,
          code: true,
          campaignId: true,
          outcomeType: true,
          category: { select: { name: true, campaignId: true } },
        },
      },
      answers: {
        include: {
          question: {
            select: {
              id: true,
              label: true,
              formId: true,
              formCategoryId: true,
              type: true,
              order: true,
              weight: true,
              fatal: true,
              requiresCommentOnFail: true,
              formCategory: {
                select: {
                  sortOrder: true,
                  qaCategory: { select: { name: true } },
                },
              },
            },
          },
          category: { select: { name: true, systemColor: true } },
        },
        orderBy: { question: { order: "asc" } },
        ...(includeAnswers ? {} : { take: 0 }),
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

const textEncoder = new TextEncoder();

function exportTextBytes(...values: Array<string | null | undefined>) {
  return values.reduce((total, value) => total + textEncoder.encode(value ?? "").byteLength, 0);
}

function getHydratedExportTextBytes(
  responses: Awaited<ReturnType<typeof getResponseBatch>>,
  includeAnswers: boolean,
) {
  let total = 0;
  for (const response of responses) {
    total += exportTextBytes(
      response.id,
      response.formVersion ?? response.form.version,
      response.form.title,
      response.form.campaign.name,
      response.agent.name,
      response.agent.agentCode,
      response.agent.team?.name,
      response.evaluator.name,
      response.disposition?.name,
      response.disposition?.code,
      response.disposition?.outcomeType,
      response.disposition?.category?.name,
    );
    if (!includeAnswers) continue;

    for (const answer of response.answers) {
      total += exportTextBytes(
        response.id,
        response.form.campaign.name,
        response.form.title,
        response.agent.name,
        response.evaluator.name,
        answer.id,
        answer.value,
        answer.comment,
        answer.question.id,
        answer.question.label,
        answer.question.type,
        answer.question.formCategory?.qaCategory.name,
        answer.category?.name,
        answer.category?.systemColor,
      );
    }
  }
  return total;
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
  if (response.hasFatalFail || response.result === "FAIL") return "FAIL";
  if (response.result === "PASS") return "PASS";
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

type QuestionColumn = {
  key: string;
  header: string;
  campaignName: string;
  formTitle: string;
  formVersion: string;
  sectionOrder: number;
  questionOrder: number;
  questionId: string;
};

const XLSX_DETAIL_COLUMN_COUNT = 21;
const XLSX_SUMMARY_CELL_COUNT = 32;
const JSON_ANSWER_FIELD_COUNT = 16;

function getQuestionColumnKey(answer: ExportResponse["answers"][number]) {
  const sectionOrder = answer.question.formCategory?.sortOrder ?? -1;
  return `q:${answer.question.id}|s:${answer.question.formCategoryId ?? "none"}:${sectionOrder}|o:${answer.question.order}`;
}

function getQuestionColumn(response: ExportResponse, answer: ExportResponse["answers"][number]) {
  const sectionOrder = answer.question.formCategory?.sortOrder ?? -1;
  const sectionLabel = answer.question.formCategory?.qaCategory.name ?? "Sin seccion";
  const sectionNumber = String(Math.max(0, sectionOrder + 1)).padStart(2, "0");
  const questionNumber = String(Math.max(0, answer.question.order + 1)).padStart(2, "0");

  return {
    key: getQuestionColumnKey(answer),
    header: `S${sectionNumber}-P${questionNumber} · ${sectionLabel} · ${answer.question.label} [${answer.question.id}]`,
    campaignName: response.form.campaign.name,
    formTitle: response.form.title,
    formVersion: response.formVersion ?? response.form.version,
    sectionOrder,
    questionOrder: answer.question.order,
    questionId: answer.question.id,
  } satisfies QuestionColumn;
}

function collectQuestionColumns(responses: ExportResponse[], selectedFields: ExportFieldKey[]) {
  if (!isExportFieldSelected(selectedFields, "answers")) return [];

  const columns = new Map<string, QuestionColumn>();
  for (const response of responses) {
    const responseKeys = new Set<string>();
    for (const answer of response.answers) {
      const column = getQuestionColumn(response, answer);
      if (responseKeys.has(column.key)) {
        throw new Error(`La evaluacion ${response.id} contiene una pregunta duplicada.`);
      }
      responseKeys.add(column.key);
      columns.set(column.key, columns.get(column.key) ?? column);
    }
  }

  return Array.from(columns.values()).sort(
    (left, right) =>
      left.campaignName.localeCompare(right.campaignName) ||
      left.formTitle.localeCompare(right.formTitle) ||
      left.formVersion.localeCompare(right.formVersion) ||
      left.sectionOrder - right.sectionOrder ||
      left.questionOrder - right.questionOrder ||
      left.questionId.localeCompare(right.questionId),
  );
}

function getAnswerMap(response: ExportResponse) {
  const result = new Map<string, ReturnType<typeof getAnswerValue>>();
  for (const answer of response.answers) {
    const key = getQuestionColumnKey(answer);
    if (result.has(key)) {
      throw new Error(`La evaluacion ${response.id} contiene una pregunta duplicada.`);
    }
    result.set(key, getAnswerValue(answer));
  }
  return result;
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
  questionColumns: QuestionColumn[],
  targetsByCampaign: Map<string, CampaignTargetSnapshot>,
) {
  const baseFields = getBaseFields(selectedFields);

  return responses.map((response) => {
    const targets = getTargets(targetsByCampaign, response.form.campaignId);
    const answerMap = getAnswerMap(response);

    return [
      ...baseFields.map((field) => getFieldValue(response, field, targets)),
      ...questionColumns.map((question) => answerMap.get(question.key) ?? ""),
    ];
  });
}

function getSelectedHeaders(selectedFields: ExportFieldKey[], questionColumns: QuestionColumn[]) {
  return [
    ...getBaseFields(selectedFields).map((field) => EXPORT_FIELD_LABELS[field]),
    ...questionColumns.map((column) => column.header),
  ];
}

function assertExportShapeWithinLimits(
  responses: ExportResponse[],
  selectedFields: ExportFieldKey[],
  questionColumns: QuestionColumn[],
  limits: ReturnType<typeof getExportLimits>,
  format: ExportDownloadFormat,
) {
  const includeAnswers = isExportFieldSelected(selectedFields, "answers");
  const answerRows = includeAnswers
    ? responses.reduce((sum, response) => sum + response.answers.length, 0)
    : 0;
  if (answerRows > limits.maxAnswerRows) {
    throw new ExportLimitError(
      `La exportacion supera ${limits.maxAnswerRows} respuestas. Acota los filtros o excluye Respuestas.`,
    );
  }
  if (questionColumns.length > limits.maxQuestionColumns) {
    throw new ExportLimitError(
      `La exportacion supera ${limits.maxQuestionColumns} columnas de preguntas. Acota formulario o fechas.`,
    );
  }

  const evaluationWidth = getBaseFields(selectedFields).length + questionColumns.length;
  let estimatedCells = evaluationWidth * (responses.length + 1);
  if (includeAnswers && format === "xlsx") {
    estimatedCells += answerRows * XLSX_DETAIL_COLUMN_COUNT;
    estimatedCells += XLSX_DETAIL_COLUMN_COUNT + XLSX_SUMMARY_CELL_COUNT;
  } else if (includeAnswers && format === "json") {
    estimatedCells += answerRows * JSON_ANSWER_FIELD_COUNT;
  }
  if (estimatedCells > limits.maxCells) {
    throw new ExportLimitError(
      `La exportacion supera ${limits.maxCells} celdas estimadas. Reduce campos o acota los filtros.`,
    );
  }
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

type ExportCampaignStat = {
  campaignId: string | null;
  rowCount: number;
  detailRowCount: number;
};

type ExportLifecycleAction = "started" | "generated" | "cancelled" | "failed" | "rejected";

function getExportCampaignStats(
  responses: ExportResponse[],
  selectedFields: ExportFieldKey[],
): ExportCampaignStat[] {
  const includeAnswers = isExportFieldSelected(selectedFields, "answers");
  const stats = new Map<string, ExportCampaignStat>();
  for (const response of responses) {
    const campaignId = response.form.campaignId;
    const current = stats.get(campaignId) ?? { campaignId, rowCount: 0, detailRowCount: 0 };
    current.rowCount += 1;
    if (includeAnswers) current.detailRowCount += response.answers.length;
    stats.set(campaignId, current);
  }
  return Array.from(stats.values());
}

function getAuditStatsOrFallback(
  stats: ExportCampaignStat[],
  filters: ExportFilters,
): ExportCampaignStat[] {
  if (stats.length > 0) return stats;
  return [{ campaignId: filters.campaignId ?? null, rowCount: 0, detailRowCount: 0 }];
}

async function recordExportLifecycle({
  action,
  exportId,
  format,
  filters,
  selectedFields,
  userId,
  stats,
  notify = false,
}: {
  action: ExportLifecycleAction;
  exportId: string;
  format: string;
  filters: ExportFilters;
  selectedFields: ExportFieldKey[];
  userId: string;
  stats: ExportCampaignStat[];
  notify?: boolean;
}) {
  const auditStats = getAuditStatsOrFallback(stats, filters);
  await prisma.$transaction(async (tx) => {
    for (const stat of auditStats) {
      await writeAuditLog(
        {
          userId,
          campaignId: stat.campaignId,
          module: "exports",
          action,
          entityType: "export",
          entityId: exportId,
          afterValue: {
            exportId,
            format,
            filters: {
              ...filters,
              campaignId: stat.campaignId ?? filters.campaignId,
              fields: selectedFields,
            },
            selectedFields,
            selectedFieldLabels: selectedFields.map((field) => EXPORT_FIELD_LABELS[field]),
            rowCount: stat.rowCount,
            detailRowCount: stat.detailRowCount,
          },
          impact:
            action === "generated"
              ? "Datos exportados segun scope de campana y permisos del usuario."
              : `Ciclo de exportacion registrado con estado ${action}.`,
        },
        tx,
      );
    }
  });

  if (!notify || action !== "generated") return;
  const rowCount = stats.reduce((sum, stat) => sum + stat.rowCount, 0);
  const detailRowCount = stats.reduce((sum, stat) => sum + stat.detailRowCount, 0);
  await emitNotificationToUser({
    userId,
    campaignId: stats.length === 1 ? stats[0]?.campaignId : null,
    type: "export_generated",
    severity: "SUCCESS",
    title: `Export ${format.toUpperCase()} generado`,
    body: `${rowCount} evaluaciones exportadas con ${selectedFields.length} campos seleccionados.`,
    href: "/analytics/export",
    entityType: "export",
    metadata: {
      exportId,
      format,
      filters,
      selectedFields,
      rowCount,
      detailRowCount,
    },
  });
}

async function auditCompletedBufferedExport(
  format: string,
  filters: ExportFilters,
  selectedFields: ExportFieldKey[],
  userId: string,
  responses: ExportResponse[],
) {
  await recordExportLifecycle({
    action: "generated",
    exportId: crypto.randomUUID(),
    format,
    filters,
    selectedFields,
    userId,
    stats: getExportCampaignStats(responses, selectedFields),
    notify: true,
  });
}

export async function exportToCsv(filters: ExportFilters): Promise<string> {
  const selectedFields = sanitizeExportFields(filters.fields);
  const { responses, targetsByCampaign, userId, limits } = await getExportData(
    filters,
    selectedFields,
  );
  const questionColumns = collectQuestionColumns(responses, selectedFields);
  assertExportShapeWithinLimits(responses, selectedFields, questionColumns, limits, "csv");
  let content = "";

  if (responses.length > 0) {
    const headers = getSelectedHeaders(selectedFields, questionColumns);
    const rows = buildRows(responses, selectedFields, questionColumns, targetsByCampaign);
    content = [
      headers.map(escapeCsvValue).join(","),
      ...rows.map((row) => row.map(escapeCsvValue).join(",")),
    ].join("\n");
  }

  await auditCompletedBufferedExport("csv", filters, selectedFields, userId, responses);
  return content;
}

function styleHeaderRow(row: {
  eachCell: (
    callback: (cell: {
      font?: unknown;
      fill?: unknown;
      alignment?: unknown;
      border?: unknown;
    }) => void,
  ) => void;
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
  result: "PASS" | "FAIL",
) {
  const scoreCell = row.getCell(scoreColumn);
  const rawScore = Number(scoreCell.value ?? 0);

  if (result === "FAIL") {
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
  const { responses, targetsByCampaign, userId, limits } = await getExportData(
    filters,
    selectedFields,
  );
  const includeAnswers = isExportFieldSelected(selectedFields, "answers");

  if (responses.length === 0) {
    await auditCompletedBufferedExport("xlsx", filters, selectedFields, userId, responses);
    return "";
  }

  const questionColumns = collectQuestionColumns(responses, selectedFields);
  assertExportShapeWithinLimits(responses, selectedFields, questionColumns, limits, "xlsx");
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
  if (scoreIndex > 0) {
    responses.forEach((response, index) => {
      const targets = getTargets(targetsByCampaign, response.form.campaignId);
      addScoreStyle(evaluationSheet.getRow(index + 2), scoreIndex, getResult(response, targets));
    });
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
      "ID pregunta",
      "Clave pregunta",
      "Orden seccion",
      "Orden pregunta",
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
          answer.question.id,
          getQuestionColumnKey(answer),
          answer.question.formCategory?.sortOrder ?? "",
          answer.question.order,
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
    detailSheet.getColumn(15).numFmt = "0.00";
    autoWidth(detailSheet);
  }

  autoWidth(summarySheet);

  const buffer = await workbook.xlsx.writeBuffer();
  const content = Buffer.from(buffer).toString("base64");
  await auditCompletedBufferedExport("xlsx", filters, selectedFields, userId, responses);
  return content;
}

export async function exportToJson(filters: ExportFilters): Promise<string> {
  const selectedFields = sanitizeExportFields(filters.fields);
  const { responses, targetsByCampaign, userId, limits } = await getExportData(
    filters,
    selectedFields,
  );
  const questionColumns = collectQuestionColumns(responses, selectedFields);
  assertExportShapeWithinLimits(responses, selectedFields, questionColumns, limits, "json");

  const baseFields = getBaseFields(selectedFields);
  const includeAnswers = isExportFieldSelected(selectedFields, "answers");
  const data = responses.map((response) => {
    const targets = getTargets(targetsByCampaign, response.form.campaignId);
    const row: Record<string, unknown> = Object.fromEntries(
      baseFields.map((field) => [field, getFieldValue(response, field, targets)]),
    );

    if (includeAnswers) {
      row.answers = response.answers.map((answer) => ({
        questionId: answer.question.id,
        questionKey: getQuestionColumnKey(answer),
        section: answer.question.formCategory?.qaCategory.name ?? null,
        sectionOrder: answer.question.formCategory?.sortOrder ?? null,
        questionOrder: answer.question.order,
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

  const content = JSON.stringify(data, null, 2);
  await auditCompletedBufferedExport("json", filters, selectedFields, userId, responses);
  return content;
}

export type ExportDownloadFormat = "csv" | "json" | "xlsx";

export type ExportDownload = {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  extension: ExportDownloadFormat;
};

function createTextStream(generator: AsyncGenerator<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await generator.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await generator.return(undefined);
    },
  });
}

function createExportFinisher(context: {
  exportId: string;
  format: ExportDownloadFormat;
  filters: ExportFilters;
  selectedFields: ExportFieldKey[];
  userId: string;
  stats: ExportCampaignStat[];
}) {
  let terminalPromise: Promise<void> | null = null;

  return (action: Exclude<ExportLifecycleAction, "started">) => {
    if (terminalPromise) return terminalPromise;
    terminalPromise = (async () => {
      try {
        await recordExportLifecycle({
          ...context,
          action,
          notify: action === "generated",
        });
      } catch (error) {
        if (action !== "failed") {
          await recordExportLifecycle({ ...context, action: "failed" }).catch(() => undefined);
        }
        throw error;
      }
    })();
    return terminalPromise;
  };
}

function withExportLifecycle(
  content: AsyncGenerator<string>,
  finish: ReturnType<typeof createExportFinisher>,
) {
  return (async function* () {
    let completed = false;
    try {
      for await (const chunk of content) yield chunk;
      await finish("generated");
      completed = true;
    } catch (error) {
      await finish("failed").catch(() => undefined);
      throw error;
    } finally {
      if (!completed) await finish("cancelled").catch(() => undefined);
    }
  })();
}

function withBinaryExportLifecycle(
  source: ReadableStream<Uint8Array>,
  finish: ReturnType<typeof createExportFinisher>,
  onCancel: () => void,
) {
  const reader = source.getReader();
  let completed = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (!next.done) {
          controller.enqueue(next.value);
          return;
        }

        await finish("generated");
        completed = true;
        controller.close();
      } catch (error) {
        await finish("failed").catch(() => undefined);
        controller.error(error);
      }
    },
    async cancel(reason) {
      const cancellation = completed ? Promise.resolve() : finish("cancelled");
      onCancel();
      await reader.cancel(reason).catch(() => undefined);
      await cancellation.catch(() => undefined);
    },
  });
}

function getJsonRow(
  response: ExportResponse,
  selectedFields: ExportFieldKey[],
  targetsByCampaign: Map<string, CampaignTargetSnapshot>,
) {
  const targets = getTargets(targetsByCampaign, response.form.campaignId);
  const row: Record<string, unknown> = Object.fromEntries(
    getBaseFields(selectedFields).map((field) => [field, getFieldValue(response, field, targets)]),
  );

  if (isExportFieldSelected(selectedFields, "answers")) {
    row.answers = response.answers.map((answer) => ({
      questionId: answer.question.id,
      questionKey: getQuestionColumnKey(answer),
      section: answer.question.formCategory?.qaCategory.name ?? null,
      sectionOrder: answer.question.formCategory?.sortOrder ?? null,
      questionOrder: answer.question.order,
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
}

function getSafeColumnWidth(header: string) {
  return Math.min(Math.max(header.length + 2, 12), 40);
}

async function createXlsxDownload(
  responses: ExportResponse[],
  targetsByCampaign: Map<string, CampaignTargetSnapshot>,
  filters: ExportFilters,
  selectedFields: ExportFieldKey[],
  questionColumns: QuestionColumn[],
  userId: string,
  exportId: string,
  stats: ExportCampaignStat[],
): Promise<ExportDownload> {
  const [{ default: ExcelJS }, { PassThrough, Readable }] = await Promise.all([
    import("exceljs"),
    import("node:stream"),
  ]);
  const workbookOutput = new PassThrough();
  const output = new PassThrough();
  workbookOutput.pipe(output, { end: false });
  workbookOutput.on("error", (error) => output.destroy(error));
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: workbookOutput,
    useStyles: true,
    useSharedStrings: false,
  });
  workbook.creator = "Qore";
  workbook.created = new Date();
  workbook.modified = new Date();

  const finish = createExportFinisher({
    exportId,
    format: "xlsx",
    filters,
    selectedFields,
    userId,
    stats,
  });

  void (async () => {
    try {
      const headers = getSelectedHeaders(selectedFields, questionColumns);
      const summary = getSummary(responses, targetsByCampaign, filters, selectedFields);
      const summarySheet = workbook.addWorksheet("Resumen", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      summarySheet.columns = [
        { key: "metric", width: 28 },
        { key: "value", width: 32 },
      ];
      const summaryHeader = summarySheet.addRow(["Metrica", "Valor"]);
      styleHeaderRow(summaryHeader);
      summaryHeader.commit();
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
      for (const values of summaryRows) summarySheet.addRow(values).commit();
      summarySheet.commit();

      const evaluationSheet = workbook.addWorksheet("Evaluaciones", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      headers.forEach((header, index) => {
        evaluationSheet.getColumn(index + 1).width = getSafeColumnWidth(header);
      });
      const evaluationHeader = evaluationSheet.addRow(headers);
      styleHeaderRow(evaluationHeader);
      evaluationHeader.commit();
      evaluationSheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: Math.max(headers.length, 1) },
      };

      const scoreIndex = headers.indexOf(EXPORT_FIELD_LABELS.score) + 1;
      const dateIndex = headers.indexOf(EXPORT_FIELD_LABELS.date) + 1;
      const submittedIndex = headers.indexOf(EXPORT_FIELD_LABELS.submittedAt) + 1;
      for (const response of responses) {
        const targets = getTargets(targetsByCampaign, response.form.campaignId);
        const answerMap = getAnswerMap(response);
        const row = evaluationSheet.addRow([
          ...getBaseFields(selectedFields).map((field) => getFieldValue(response, field, targets)),
          ...questionColumns.map((question) => answerMap.get(question.key) ?? ""),
        ]);
        if (scoreIndex > 0) {
          addScoreStyle(row, scoreIndex, getResult(response, targets));
          row.getCell(scoreIndex).numFmt = "0.00";
        }
        if (dateIndex > 0) row.getCell(dateIndex).numFmt = "yyyy-mm-dd hh:mm";
        if (submittedIndex > 0) row.getCell(submittedIndex).numFmt = "yyyy-mm-dd hh:mm";
        row.commit();
      }
      evaluationSheet.commit();

      if (isExportFieldSelected(selectedFields, "answers")) {
        const detailHeaders = [
          "ID evaluacion",
          "Fecha",
          "Campana",
          "Formulario",
          "Agente",
          "Evaluador",
          "Categoria QA",
          "ID pregunta",
          "Clave pregunta",
          "Orden seccion",
          "Orden pregunta",
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
        const detailSheet = workbook.addWorksheet("Detalle respuestas", {
          views: [{ state: "frozen", ySplit: 1 }],
        });
        detailHeaders.forEach((header, index) => {
          detailSheet.getColumn(index + 1).width = getSafeColumnWidth(header);
        });
        const detailHeader = detailSheet.addRow(detailHeaders);
        styleHeaderRow(detailHeader);
        detailHeader.commit();
        detailSheet.autoFilter = {
          from: { row: 1, column: 1 },
          to: { row: 1, column: detailHeaders.length },
        };
        for (const response of responses) {
          for (const answer of response.answers) {
            const row = detailSheet.addRow([
              response.id,
              response.createdAt,
              response.form.campaign.name,
              response.form.title,
              response.agent.name,
              response.evaluator.name,
              answer.category?.name ?? "",
              answer.question.id,
              getQuestionColumnKey(answer),
              answer.question.formCategory?.sortOrder ?? "",
              answer.question.order,
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
            row.getCell(2).numFmt = "yyyy-mm-dd hh:mm";
            row.getCell(15).numFmt = "0.00";
            row.commit();
          }
        }
        detailSheet.commit();
      }

      await workbook.commit();
      output.end();
    } catch (error) {
      await finish("failed").catch(() => undefined);
      output.destroy(error instanceof Error ? error : new Error("No se pudo generar el XLSX."));
    }
  })();

  const source = Readable.toWeb(output) as ReadableStream<Uint8Array>;
  return {
    body: withBinaryExportLifecycle(source, finish, () => {
      workbookOutput.destroy();
      output.destroy();
    }),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: "xlsx",
  };
}

export async function createExportDownload(
  format: ExportDownloadFormat,
  filters: ExportFilters,
): Promise<ExportDownload> {
  const selectedFields = sanitizeExportFields(filters.fields);
  const session = await auth();
  if (!session?.user) throw new CampaignAuthorizationError("No autorizado");
  const admissionLimits = getExportLimits();
  const userId = session.user.id;
  const exportId = crypto.randomUUID();
  await reserveExportCapacity({ userId, exportId, limits: admissionLimits });

  let stats: ExportCampaignStat[] = [];
  let started = false;
  try {
    const data = await getExportData(filters, selectedFields);
    const { responses, targetsByCampaign, limits } = data;
    if (responses.length === 0) throw new ExportNoDataError();

    const questionColumns = collectQuestionColumns(responses, selectedFields);
    assertExportShapeWithinLimits(responses, selectedFields, questionColumns, limits, format);
    stats = getExportCampaignStats(responses, selectedFields);
    await recordExportLifecycle({
      action: "started",
      exportId,
      format,
      filters,
      selectedFields,
      userId,
      stats,
    });
    started = true;

    if (format === "xlsx") {
      return await createXlsxDownload(
        responses,
        targetsByCampaign,
        filters,
        selectedFields,
        questionColumns,
        userId,
        exportId,
        stats,
      );
    }

    const finish = createExportFinisher({
      exportId,
      format,
      filters,
      selectedFields,
      userId,
      stats,
    });

    if (format === "csv") {
      const headers = getSelectedHeaders(selectedFields, questionColumns);
      const content = (async function* () {
        yield `\uFEFF${headers.map(escapeCsvValue).join(",")}\n`;
        for (let index = 0; index < responses.length; index += 1) {
          const response = responses[index];
          const targets = getTargets(targetsByCampaign, response.form.campaignId);
          const answerMap = getAnswerMap(response);
          const row = [
            ...getBaseFields(selectedFields).map((field) =>
              getFieldValue(response, field, targets),
            ),
            ...questionColumns.map((question) => answerMap.get(question.key) ?? ""),
          ];
          yield `${row.map(escapeCsvValue).join(",")}${index + 1 < responses.length ? "\n" : ""}`;
        }
      })();
      return {
        body: createTextStream(withExportLifecycle(content, finish)),
        contentType: "text/csv; charset=utf-8",
        extension: "csv",
      };
    }

    const content = (async function* () {
      yield "[";
      for (let index = 0; index < responses.length; index += 1) {
        if (index > 0) yield ",";
        yield JSON.stringify(getJsonRow(responses[index], selectedFields, targetsByCampaign));
      }
      yield "]";
    })();
    return {
      body: createTextStream(withExportLifecycle(content, finish)),
      contentType: "application/json; charset=utf-8",
      extension: "json",
    };
  } catch (error) {
    const action =
      error instanceof ExportLimitError || error instanceof ExportNoDataError
        ? "rejected"
        : "failed";
    await recordExportLifecycle({
      action,
      exportId,
      format,
      filters: started
        ? filters
        : { dateFrom: filters.dateFrom, dateTo: filters.dateTo, fields: selectedFields },
      selectedFields,
      userId,
      stats: started ? stats : [{ campaignId: null, rowCount: 0, detailRowCount: 0 }],
    });
    throw error;
  }
}
