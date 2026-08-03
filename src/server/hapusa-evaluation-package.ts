import "server-only";

import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
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

const FULL_SCORE_FILL = "FFC6E0B4";
const PARTIAL_SCORE_FILL = "FFFFD966";
const ZERO_SCORE_FILL = "FFFF0000";
const NOT_APPLICABLE_FILL = "FFD9E1F2";
const HAPUSA_TEMPLATE_PATH = path.join(
  process.cwd(),
  "src",
  "server",
  "templates",
  "hapusa-scorecard-template.xlsx",
);
const HAPUSA_ANSWER_ROWS = [
  4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 22, 23, 24, 25, 26, 27, 28, 29, 31, 32, 33,
  34,
] as const;
let templateBufferPromise: Promise<Buffer> | null = null;

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
    scorecardDate: `${values.month}/${values.day}/${values.year}`,
    time: `${values.hour}:${values.minute}:${values.second}${values.dayPeriod}`,
  };
}

function scoreLabel(score: number) {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

function answerPoints(answer: PackageResponse["answers"][number]) {
  if (answer.notApplicable || answer.score === null) return null;
  return (Number(answer.score) / 100) * answer.question.weight;
}

function applyScoreFill(cell: ExcelJS.Cell, argb: string) {
  cell.style = {
    ...cell.style,
    fill: {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb },
    },
  };
}

function scoreFill(answer: PackageResponse["answers"][number]) {
  if (answer.notApplicable || answer.score === null) return NOT_APPLICABLE_FILL;
  const percentage = Number(answer.score);
  if (percentage <= 0) return ZERO_SCORE_FILL;
  if (percentage >= 100) return FULL_SCORE_FILL;
  return PARTIAL_SCORE_FILL;
}

function totalScoreFill(score: number) {
  if (score >= 95) return FULL_SCORE_FILL;
  if (score >= 80) return PARTIAL_SCORE_FILL;
  return ZERO_SCORE_FILL;
}

function patientAni(phoneNumber: string | null | undefined) {
  const raw = phoneNumber?.trim() ?? "";
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 ? digits : raw;
}

function requiredTemplateBuffer() {
  templateBufferPromise ??= readFile(HAPUSA_TEMPLATE_PATH);
  return templateBufferPromise;
}

export async function buildHapusaScorecardWorkbook(response: PackageResponse) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Buffer.from(await requiredTemplateBuffer()) as unknown as Parameters<
      typeof workbook.xlsx.load
    >[0],
  );
  workbook.creator = "Qore";
  workbook.lastModifiedBy = "Qore";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  const sheet = workbook.getWorksheet("Scorecard");
  if (!sheet) throw new Error("The official HAPUSA workbook template is invalid");
  const evaluatedAt = operationalDateTime(response.submittedAt ?? response.createdAt);
  sheet.getCell("A2").value =
    `Name: ${response.agent.name}  Date: ${evaluatedAt.scorecardDate}  ` +
    `Time: ${evaluatedAt.time}  Account #:                 ` +
    `ANI#: ${patientAni(response.interaction?.phoneNumber)}`;

  for (const [index, answer] of response.answers.entries()) {
    const rowNumber = HAPUSA_ANSWER_ROWS[index];
    if (!rowNumber) break;
    const row = sheet.getRow(rowNumber);
    const awardedPoints = answerPoints(answer);
    const scoredCell = row.getCell(3);
    scoredCell.value = awardedPoints ?? "N/A";
    applyScoreFill(scoredCell, scoreFill(answer));
    const comment = answer.comment?.trim() ?? "";
    row.getCell(4).value = comment || null;

    const commentLines = Math.max(1, Math.ceil(comment.length / 58));
    row.height = Math.max(row.height ?? 12.75, Math.min(76.5, commentLines * 12.75));
  }

  const totalScore = Number(response.score);
  sheet.getCell("C35").value = {
    formula: "SUM(C4:C34)",
    result: Number(response.score),
  };
  applyScoreFill(sheet.getCell("C35"), totalScoreFill(totalScore));

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
          phoneNumber: true,
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
