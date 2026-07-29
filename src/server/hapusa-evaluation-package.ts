import "server-only";

import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { InteractionProvider } from "@prisma/client";
import ExcelJS from "exceljs";
import { HAPUSA_SCORECARD_KEY } from "@/lib/official-form-templates";
import { getOperationalTimeZone } from "@/lib/operational-time";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/audit-log";
import { attachNiceCxoneRecording } from "@/server/call-finder/nice-cxone-service";
import { getRecordingStorageRoot, resolveRecordingStorageKey } from "@/server/call-finder/storage";
import { getCampaignFilterForPermissions } from "@/server/queries/campaign-filter";

export const MAX_HAPUSA_PACKAGE_EVALUATIONS = 50;

const QUALITY_TIPS = [
  "Did the agent use the caller's name throughout the call?",
  "Did the agent ask permission to place the caller on hold before doing so?",
  "If placing the caller on hold, did the agent use the appropriate amount of hold time (no more than 2 minutes without check-ins with the patient)?",
  "Did the agent mute the call when appropriate?",
  "Did the agent answer the question correctly?",
  "Did the agent transfer the call to a peer when necessary (escalated calls)?",
  "Did the agent add rapport to the call?",
  "Did the agent maintain professionalism?",
  "Did the agent maintain adaptability and respond flexibly to the caller's needs?",
  "Did the agent interrupt or talk over the caller?",
  "Did the agent maintain proper tone, pitch, volume, and pace throughout the call?",
  "Did the agent use courteous words and phrases?",
  "Did the agent adapt their approach to the patient's unique needs and issues?",
  "Did the agent avoid long silences during the call?",
  "Did the agent remain confident throughout the call?",
  "Did the agent use jargon on the call? (This would be a negative regarding quality.)",
  "Did the agent apologize for any inconveniences?",
] as const;

const CATEGORY_FILL = "FFC3D69B";
const TITLE_FILL = "FF8EB4E3";
const FULL_SCORE_FILL = "FFC6E0B4";
const PARTIAL_SCORE_FILL = "FFFFD966";
const ZERO_SCORE_FILL = "FFFF0000";
const NOT_APPLICABLE_FILL = "FFD9E1F2";
const THIN_BORDER = {
  top: { style: "thin", color: { argb: "FF000000" } },
  left: { style: "thin", color: { argb: "FF000000" } },
  bottom: { style: "thin", color: { argb: "FF000000" } },
  right: { style: "thin", color: { argb: "FF000000" } },
} satisfies Partial<ExcelJS.Borders>;

export class HapusaPackageError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_SELECTION"
      | "FORBIDDEN"
      | "RECORDING_UNAVAILABLE"
      | "RECORDING_FILE_UNAVAILABLE",
  ) {
    super(message);
    this.name = "HapusaPackageError";
  }
}

type PackageResponse = Awaited<ReturnType<typeof loadPackageResponses>>[number];

function cleanFilePart(value: string, fallback: string) {
  const cleaned = value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*]/g, "_")
    .split("")
    .map((character) => (character.charCodeAt(0) < 32 ? "_" : character))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 100);
  return cleaned || fallback;
}

function operationalDateTime(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: getOperationalTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.month}-${values.day}-${values.year}`,
    time: `${values.hour}:${values.minute}:${values.second}${values.dayPeriod}`,
  };
}

function scoreLabel(score: number) {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

function answerCategory(answer: PackageResponse["answers"][number]) {
  return answer.category?.name ?? answer.question.formCategory?.qaCategory.name ?? "Uncategorized";
}

function answerPoints(answer: PackageResponse["answers"][number]) {
  if (answer.notApplicable || answer.score === null) return null;
  return (Number(answer.score) / 100) * answer.question.weight;
}

function applyBodyCellStyle(cell: ExcelJS.Cell, options: { centered?: boolean } = {}) {
  cell.font = { name: "Arial", size: 10 };
  cell.border = THIN_BORDER;
  cell.alignment = {
    vertical: "middle",
    horizontal: options.centered ? "center" : "left",
    wrapText: true,
  };
}

export async function buildHapusaScorecardWorkbook(response: PackageResponse) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Qore";
  workbook.created = new Date();
  workbook.modified = new Date();

  const sheet = workbook.addWorksheet("Scorecard", {
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
    views: [{ state: "frozen", ySplit: 3 }],
  });
  sheet.properties.defaultRowHeight = 18;
  sheet.columns = [
    { key: "criterion", width: 105 },
    { key: "possible", width: 13 },
    { key: "scored", width: 15 },
    { key: "comment", width: 55 },
  ];

  sheet.mergeCells("A1:D1");
  const titleCell = sheet.getCell("A1");
  titleCell.value = "Call Monitoring Score Card";
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TITLE_FILL } };
  titleCell.font = { name: "Arial", size: 16, bold: true };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.border = THIN_BORDER;
  sheet.getRow(1).height = 25;

  sheet.mergeCells("A2:D2");
  const evaluatedAt = operationalDateTime(response.submittedAt ?? response.createdAt);
  const infoCell = sheet.getCell("A2");
  infoCell.value = `Name: ${response.agent.name}   Date: ${evaluatedAt.date}   Time: ${evaluatedAt.time}   Account #:                 ANI#:`;
  infoCell.font = { name: "Arial", size: 10, bold: true };
  infoCell.alignment = { vertical: "middle", wrapText: true };
  infoCell.border = THIN_BORDER;
  sheet.getRow(2).height = 22;

  let rowNumber = 3;
  let activeCategory = "";
  const totalAnswerRows: number[] = [];
  for (const answer of response.answers) {
    const category = answerCategory(answer);
    if (category !== activeCategory) {
      const categoryAnswers = response.answers.filter(
        (candidate) => answerCategory(candidate) === category,
      );
      const categoryPoints = categoryAnswers.reduce(
        (total, candidate) => total + candidate.question.weight,
        0,
      );
      const row = sheet.getRow(rowNumber);
      row.values = [
        category,
        `${scoreLabel(categoryPoints)} Points`,
        "Points Scored",
        "Comment Section",
      ];
      row.height = 20;
      for (let column = 1; column <= 4; column += 1) {
        const cell = row.getCell(column);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CATEGORY_FILL } };
        cell.font = { name: "Arial", size: 10, bold: true };
        cell.border = THIN_BORDER;
        cell.alignment = {
          vertical: "middle",
          horizontal: column === 4 ? "center" : "left",
          wrapText: true,
        };
      }
      activeCategory = category;
      rowNumber += 1;
    }

    const row = sheet.getRow(rowNumber);
    const awardedPoints = answerPoints(answer);
    row.values = [
      `* ${answer.question.label}`,
      answer.question.weight,
      awardedPoints ?? "N/A",
      answer.comment ?? "",
    ];
    row.height = Math.max(20, Math.min(60, 18 + Math.ceil(answer.question.label.length / 95) * 12));
    applyBodyCellStyle(row.getCell(1));
    applyBodyCellStyle(row.getCell(2), { centered: true });
    applyBodyCellStyle(row.getCell(3), { centered: true });
    applyBodyCellStyle(row.getCell(4));

    const scoredCell = row.getCell(3);
    const awardedPercent = Number(answer.score ?? 0);
    scoredCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: answer.notApplicable
          ? NOT_APPLICABLE_FILL
          : awardedPercent <= 0
            ? ZERO_SCORE_FILL
            : awardedPercent >= 100
              ? FULL_SCORE_FILL
              : PARTIAL_SCORE_FILL,
      },
    };
    totalAnswerRows.push(rowNumber);
    rowNumber += 1;
  }

  const totalRow = sheet.getRow(rowNumber);
  totalRow.getCell(1).value = "Totals Points Allowed";
  totalRow.getCell(2).value = 100;
  totalRow.getCell(3).value = {
    formula: `SUM(${totalAnswerRows.map((row) => `C${row}`).join(",")})`,
    result: Number(response.score),
  };
  for (let column = 1; column <= 4; column += 1) {
    applyBodyCellStyle(totalRow.getCell(column), { centered: column > 1 });
    totalRow.getCell(column).font = { name: "Arial", size: 10, bold: true };
  }
  totalRow.height = 22;

  const policyStart = rowNumber + 2;
  sheet.mergeCells(`A${policyStart}:D${policyStart + 2}`);
  const policyCell = sheet.getCell(`A${policyStart}`);
  policyCell.value =
    'Total points accumulate on a scale of 100%. Each representative must maintain a monthly average of 95% or higher. Scorecards are reviewed during 1-on-1s, and calls may be reviewed on an "as needed" basis or upon the representative’s request.';
  policyCell.font = { name: "Arial", size: 10, bold: true };
  policyCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  policyCell.border = THIN_BORDER;
  sheet.getRow(policyStart).height = 22;
  sheet.getRow(policyStart + 1).height = 22;
  sheet.getRow(policyStart + 2).height = 22;
  sheet.autoFilter = { from: "A3", to: `D${rowNumber}` };

  const tipsSheet = workbook.addWorksheet("Adding Quality to the call tips");
  tipsSheet.getColumn(1).width = 105;
  const tipsTitle = tipsSheet.getCell("A1");
  tipsTitle.value = "Added Quality to the call";
  tipsTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CATEGORY_FILL } };
  tipsTitle.font = { name: "Arial", size: 10, bold: true };
  for (const [index, tip] of QUALITY_TIPS.entries()) {
    const row = tipsSheet.getRow(index + 2);
    row.getCell(1).value = `* ${tip}`;
    row.getCell(1).font = { name: "Arial", size: 10 };
    row.getCell(1).alignment = { vertical: "middle", wrapText: true };
    row.height = Math.max(20, Math.min(50, 18 + Math.ceil(tip.length / 100) * 12));
  }

  return workbook;
}

async function loadPackageResponses(responseIds: string[]) {
  const campaignFilter = await getCampaignFilterForPermissions(["canExport", "canViewReports"]);
  return prisma.response.findMany({
    where: {
      id: { in: responseIds },
      status: "SUBMITTED",
      submittedAt: { not: null },
      form: {
        ...campaignFilter,
        templateKey: HAPUSA_SCORECARD_KEY,
      },
    },
    select: {
      id: true,
      score: true,
      createdAt: true,
      submittedAt: true,
      agent: { select: { id: true, name: true } },
      form: { select: { id: true, title: true, campaignId: true, templateKey: true } },
      answers: {
        orderBy: { question: { order: "asc" } },
        select: {
          score: true,
          comment: true,
          notApplicable: true,
          category: { select: { name: true } },
          question: {
            select: {
              label: true,
              order: true,
              weight: true,
              formCategory: {
                select: { qaCategory: { select: { name: true } } },
              },
            },
          },
        },
      },
      interaction: {
        select: {
          id: true,
          campaignId: true,
          provider: true,
          providerInstance: true,
          providerInteractionId: true,
          hasRecording: true,
          metadata: true,
          startedAt: true,
          durationSeconds: true,
          mediaAssets: {
            where: { kind: "ORIGINAL" },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              storageKey: true,
              originalFileName: true,
              mimeType: true,
              byteSize: true,
            },
          },
        },
      },
    },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
  });
}

function audioExtension(fileName: string | null, mimeType: string) {
  const extension = fileName ? path.extname(fileName).toLowerCase() : "";
  if (/^\.[a-z0-9]{2,5}$/.test(extension)) return extension;
  const byMime: Record<string, string> = {
    "audio/flac": ".flac",
    "audio/m4a": ".m4a",
    "audio/mp4": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/opus": ".opus",
    "audio/wav": ".wav",
    "audio/webm": ".webm",
    "audio/x-m4a": ".m4a",
    "audio/x-wav": ".wav",
  };
  return byMime[mimeType.toLowerCase()] ?? ".audio";
}

function isInsideRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function verifiedRecordingPath(storageKey: string) {
  const configuredRoot = getRecordingStorageRoot();
  const configuredFile = resolveRecordingStorageKey(storageKey, configuredRoot);
  const [actualRoot, actualFile] = await Promise.all([
    realpath(configuredRoot),
    realpath(configuredFile),
  ]);
  if (!isInsideRoot(actualRoot, actualFile)) {
    throw new HapusaPackageError(
      "A recording file is outside the configured storage root.",
      "RECORDING_FILE_UNAVAILABLE",
    );
  }
  const fileStat = await stat(actualFile);
  if (!fileStat.isFile() || fileStat.size <= 0) {
    throw new HapusaPackageError("A recording file is unavailable.", "RECORDING_FILE_UNAVAILABLE");
  }
  return actualFile;
}

export async function prepareHapusaEvaluationPackage(responseIds: string[], userId: string) {
  const uniqueIds = [...new Set(responseIds)];
  if (
    uniqueIds.length === 0 ||
    uniqueIds.length > MAX_HAPUSA_PACKAGE_EVALUATIONS ||
    uniqueIds.some((id) => !id.trim() || id.length > 100)
  ) {
    throw new HapusaPackageError(
      `Select between 1 and ${MAX_HAPUSA_PACKAGE_EVALUATIONS} HAPUSA evaluations.`,
      "INVALID_SELECTION",
    );
  }

  let responses = await loadPackageResponses(uniqueIds);
  if (responses.length !== uniqueIds.length) {
    throw new HapusaPackageError(
      "One or more HAPUSA evaluations are unavailable for export.",
      "FORBIDDEN",
    );
  }

  for (const response of responses) {
    const interaction = response.interaction;
    if (!interaction?.hasRecording) {
      throw new HapusaPackageError(
        `The recording for ${response.agent.name} is unavailable.`,
        "RECORDING_UNAVAILABLE",
      );
    }
    if (
      interaction.mediaAssets.length === 0 &&
      interaction.provider === InteractionProvider.NICE_CXONE
    ) {
      try {
        await attachNiceCxoneRecording({ interaction, userId });
      } catch {
        throw new HapusaPackageError(
          `The recording for ${response.agent.name} could not be retrieved from NICE CXone.`,
          "RECORDING_UNAVAILABLE",
        );
      }
    }
  }

  responses = await loadPackageResponses(uniqueIds);
  const distinctAgents = new Set(responses.map((response) => response.agent.id));
  const useAgentFolders = distinctAgents.size > 1;
  const entries = [];
  for (const response of responses) {
    const asset = response.interaction?.mediaAssets[0];
    if (!asset) {
      throw new HapusaPackageError(
        `The recording for ${response.agent.name} is unavailable in Qore storage.`,
        "RECORDING_FILE_UNAVAILABLE",
      );
    }
    const agentName = cleanFilePart(response.agent.name, "Agent");
    const evaluatedAt = operationalDateTime(response.submittedAt ?? response.createdAt);
    const callId = cleanFilePart(
      response.interaction?.providerInteractionId ?? response.id,
      response.id,
    );
    const baseName = `${agentName}, ${evaluatedAt.date} - ${scoreLabel(Number(response.score))} - Call ${callId}`;
    const folder = useAgentFolders ? `${agentName}/` : "";
    const workbook = await buildHapusaScorecardWorkbook(response);
    const workbookBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const recordingPath = await verifiedRecordingPath(asset.storageKey);
    const recordingName = `${folder}${baseName}${audioExtension(asset.originalFileName, asset.mimeType)}`;
    entries.push({
      responseId: response.id,
      workbookName: `${folder}${baseName} QA Score.xlsx`,
      workbookBuffer,
      recordingName,
      recordingPath,
    });
  }

  const archiveName =
    distinctAgents.size === 1
      ? `${cleanFilePart(responses[0]?.agent.name ?? "Agent", "Agent")} - HAPUSA QA Reports.zip`
      : `HAPUSA QA Reports - ${new Date().toISOString().slice(0, 10)}.zip`;

  await Promise.all(
    responses.map((response) =>
      writeAuditLog({
        userId,
        campaignId: response.form.campaignId,
        module: "evaluations",
        action: "hapusa_evidence_package_exported",
        entityType: "response",
        entityId: response.id,
        afterValue: {
          score: Number(response.score),
          recordingIncluded: true,
          workbookIncluded: true,
        },
        impact:
          "A HAPUSA QA evidence package containing the scorecard and call recording was exported.",
      }),
    ),
  );

  return {
    archiveName,
    entries,
    createRecordingStream: (recordingPath: string) => createReadStream(recordingPath),
  };
}
