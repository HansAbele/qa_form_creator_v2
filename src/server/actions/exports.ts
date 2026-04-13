"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getCampaignFilter } from "@/server/queries/campaign-filter";

interface ExportFilters {
  campaignId?: string;
  formId?: string;
  agentId?: string;
  dateFrom?: string;
  dateTo?: string;
}

async function getExportData(filters: ExportFilters) {
  const session = await auth();
  if (!session?.user) throw new Error("No autorizado");

  const campaignFilter = await getCampaignFilter();

  const where: Record<string, unknown> = {
    form: {
      ...campaignFilter,
      ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
    },
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
      form: { select: { title: true } },
      agent: { select: { name: true, agentCode: true } },
      evaluator: { select: { name: true } },
      answers: {
        include: {
          question: { select: { label: true, type: true, order: true } },
        },
        orderBy: { question: { order: "asc" } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return responses;
}

export async function exportToCsv(filters: ExportFilters): Promise<string> {
  const responses = await getExportData(filters);

  if (responses.length === 0) return "";

  // Collect all unique question labels for column headers
  const questionLabels = new Set<string>();
  for (const r of responses) {
    for (const a of r.answers) {
      questionLabels.add(a.question.label);
    }
  }
  const questionCols = Array.from(questionLabels);

  const headers = [
    "Fecha",
    "Formulario",
    "Agente",
    "Código Agente",
    "Evaluador",
    "Score",
    ...questionCols,
  ];

  const rows = responses.map((r) => {
    const answerMap = new Map(r.answers.map((a) => [a.question.label, a.value]));
    return [
      new Date(r.createdAt).toLocaleDateString("es-ES"),
      r.form.title,
      r.agent.name,
      r.agent.agentCode ?? "",
      r.evaluator.name,
      Number(r.score).toFixed(2),
      ...questionCols.map((q) => answerMap.get(q) ?? ""),
    ];
  });

  const escape = (v: string) => {
    if (v.includes(",") || v.includes('"') || v.includes("\n")) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };

  const csv = [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join(
    "\n",
  );

  return csv;
}

export async function exportToExcel(filters: ExportFilters): Promise<string> {
  const ExcelJS = (await import("exceljs")).default;
  const responses = await getExportData(filters);

  if (responses.length === 0) return "";

  const questionLabels = new Set<string>();
  for (const r of responses) {
    for (const a of r.answers) {
      questionLabels.add(a.question.label);
    }
  }
  const questionCols = Array.from(questionLabels);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Qore";
  const sheet = workbook.addWorksheet("Evaluaciones");

  // Header row
  const headers = ["Fecha", "Formulario", "Agente", "Código Agente", "Evaluador", "Score", ...questionCols];
  const headerRow = sheet.addRow(headers);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
    cell.alignment = { horizontal: "center" };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
    };
  });

  // Data rows
  for (const r of responses) {
    const answerMap = new Map(r.answers.map((a) => [a.question.label, a.value]));
    const score = Number(r.score);
    const row = sheet.addRow([
      new Date(r.createdAt),
      r.form.title,
      r.agent.name,
      r.agent.agentCode ?? "",
      r.evaluator.name,
      score,
      ...questionCols.map((q) => answerMap.get(q) ?? ""),
    ]);

    // Color-code score
    const scoreCell = row.getCell(6);
    if (score >= 80) {
      scoreCell.font = { color: { argb: "FF16A34A" }, bold: true };
    } else if (score >= 60) {
      scoreCell.font = { color: { argb: "FFCA8A04" }, bold: true };
    } else {
      scoreCell.font = { color: { argb: "FFDC2626" }, bold: true };
    }
  }

  // Format date column
  sheet.getColumn(1).numFmt = "DD/MM/YYYY";

  // Auto-width columns
  for (const col of sheet.columns) {
    let maxLen = 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? "").length;
      if (len > maxLen) maxLen = len;
    });
    col.width = Math.min(maxLen + 2, 40);
  }

  // Auto-filter
  sheet.autoFilter = { from: "A1", to: `${String.fromCharCode(64 + headers.length)}1` };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer).toString("base64");
}

export async function exportToJson(filters: ExportFilters): Promise<string> {
  const responses = await getExportData(filters);

  const data = responses.map((r) => ({
    fecha: new Date(r.createdAt).toISOString(),
    formulario: r.form.title,
    agente: r.agent.name,
    codigoAgente: r.agent.agentCode,
    evaluador: r.evaluator.name,
    score: Number(r.score),
    respuestas: Object.fromEntries(r.answers.map((a) => [a.question.label, a.value])),
  }));

  return JSON.stringify(data, null, 2);
}
