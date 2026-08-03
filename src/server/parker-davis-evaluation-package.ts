import "server-only";

import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { PARKER_DAVIS_SCORECARD_KEY } from "@/lib/official-form-templates";
import { getOperationalTimeZone } from "@/lib/operational-time";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/server/audit-log";
import { attachProviderRecording } from "@/server/call-finder/call-source-service";
import { getRecordingStorageRoot, resolveRecordingStorageKey } from "@/server/call-finder/storage";
import { getCampaignFilterForPermissions } from "@/server/queries/campaign-filter";

export const MAX_PARKER_DAVIS_PACKAGE_EVALUATIONS = 50;

const TEMPLATE_PATH = path.join(
  process.cwd(),
  "src",
  "server",
  "templates",
  "parker-davis-scorecard-template.xlsx",
);
const ANSWER_ROWS = [
  10, 11, 14, 15, 16, 17, 18, 19, 22, 23, 24, 25, 28, 29, 30, 31, 32, 34, 35, 36, 37, 38, 39, 42,
  43, 44, 45, 46, 47, 48, 49, 50, 51, 54, 55, 56, 57,
] as const;
const SCORED_ROWS = [10, 11, 14, 15, 16, 17, 18, 19, 22, 28, 42, 48, 54] as const;
const REMOVED_DUPLICATE_TEXT =
  "customer informed that returns are inspected; restocking fees may apply if used/damaged";
const PASS_FILL = "FFC6E0B4";
const ACCEPTABLE_FILL = "FFFFD966";
const FAIL_FILL = "FFF4CCCC";
let templateBufferPromise: Promise<Buffer> | null = null;

export class ParkerDavisPackageError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_SELECTION"
      | "FORBIDDEN"
      | "RECORDING_UNAVAILABLE"
      | "RECORDING_FILE_UNAVAILABLE",
  ) {
    super(message);
    this.name = "ParkerDavisPackageError";
  }
}

type PackageResponse = Awaited<ReturnType<typeof loadPackageResponses>>[number];
type PackageAnswer = PackageResponse["answers"][number];

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

function operationalDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: getOperationalTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    fileDate: `${values.month}-${values.day}-${values.year}`,
    scorecardDate: `${values.month}/${values.day}/${values.year}`,
  };
}

function scoreLabel(score: number) {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

function requiredTemplateBuffer() {
  templateBufferPromise ??= readFile(TEMPLATE_PATH);
  return templateBufferPromise;
}

function normalizedQuestionLabel(value: string) {
  return value
    .replaceAll("[[CHECK]]", "")
    .replaceAll("[[P&W]]", "")
    .replace(/^\d+\.\s*/, "")
    .trim()
    .toLocaleLowerCase();
}

function isRemovedDuplicate(answer: PackageAnswer) {
  const categoryName = answer.category?.name ?? answer.question.formCategory?.qaCategory.name ?? "";
  return (
    categoryName.toLocaleLowerCase().includes("policy & compliance") &&
    normalizedQuestionLabel(answer.question.label).includes(REMOVED_DUPLICATE_TEXT)
  );
}

function earnedValue(answer: PackageAnswer) {
  if (answer.notApplicable || answer.score === null) return "N/A";
  const score = Number(answer.score);
  const weight = Number(answer.question.weight);
  if (weight > 0) return (score / 100) * weight;
  if (score <= 0) return "Fail";
  if (score >= 100) return "Pass";
  return `${scoreLabel(score)}%`;
}

function resultLabel(response: PackageResponse) {
  const score = Number(response.score);
  if (response.hasFatalFail) return "FAIL — Critical Failure";
  if (score >= 95) return "PASS — Excellent";
  if (score >= 90) return "ACCEPTABLE";
  if (score >= 80) return "FAIL — Needs Improvement";
  if (score >= 70) return "FAIL — Below Standard";
  return "FAIL — Unsatisfactory";
}

function resultFill(response: PackageResponse) {
  if (response.hasFatalFail || Number(response.score) < 90) return FAIL_FILL;
  return Number(response.score) >= 95 ? PASS_FILL : ACCEPTABLE_FILL;
}

export async function buildParkerDavisScorecardWorkbook(response: PackageResponse) {
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

  const sheet = workbook.getWorksheet("Sheet1");
  if (!sheet) throw new Error("The official Parker Davis workbook template is invalid");
  const evaluatedAt = operationalDate(response.submittedAt ?? response.createdAt);
  sheet.getCell("B5").value = response.agent.name;
  sheet.getCell("D5").value = evaluatedAt.scorecardDate;
  sheet.getCell("F5").value = response.evaluator.name;
  sheet.getRow(33).hidden = true;

  const currentAnswers = response.answers.filter((answer) => !isRemovedDuplicate(answer));
  for (const [index, answer] of currentAnswers.entries()) {
    const rowNumber = ANSWER_ROWS[index];
    if (!rowNumber) break;
    const row = sheet.getRow(rowNumber);
    const scoreCell = row.getCell(4);
    scoreCell.value = earnedValue(answer);
    if (answer.isFatalFail) {
      scoreCell.font = { ...scoreCell.font, bold: true, color: { argb: "FFFF0000" } };
    }

    const comment = answer.comment?.trim() ?? "";
    row.getCell(7).value = comment || null;
    const commentLines = Math.max(1, Math.ceil(comment.length / 12));
    row.height = Math.max(row.height ?? 15.6, Math.min(93.6, commentLines * 15.6));
  }

  const score = Number(response.score);
  sheet.getCell("C59").value = 100;
  sheet.getCell("C60").value = {
    formula: `SUM(${SCORED_ROWS.map((row) => `D${row}`).join(",")})`,
    result: score,
  };
  sheet.getCell("C61").value = {
    formula: "IFERROR(C60/C59,0)",
    result: score / 100,
  };
  sheet.getCell("C61").numFmt = "0.00%";

  const resultCell = sheet.getCell("D65");
  resultCell.value = resultLabel(response);
  resultCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: resultFill(response) },
  };

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
        templateKey: PARKER_DAVIS_SCORECARD_KEY,
      },
    },
    select: {
      id: true,
      score: true,
      result: true,
      hasFatalFail: true,
      createdAt: true,
      submittedAt: true,
      agent: { select: { id: true, name: true } },
      evaluator: { select: { id: true, name: true } },
      form: { select: { id: true, title: true, campaignId: true, templateKey: true } },
      answers: {
        orderBy: { question: { order: "asc" } },
        select: {
          value: true,
          score: true,
          comment: true,
          isFatalFail: true,
          notApplicable: true,
          category: { select: { name: true } },
          question: {
            select: {
              label: true,
              order: true,
              weight: true,
              fatal: true,
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
    throw new ParkerDavisPackageError(
      "A recording file is outside the configured storage root.",
      "RECORDING_FILE_UNAVAILABLE",
    );
  }
  const fileStat = await stat(actualFile);
  if (!fileStat.isFile() || fileStat.size <= 0) {
    throw new ParkerDavisPackageError(
      "A recording file is unavailable.",
      "RECORDING_FILE_UNAVAILABLE",
    );
  }
  return actualFile;
}

export async function prepareParkerDavisEvaluationPackage(responseIds: string[], userId: string) {
  const uniqueIds = [...new Set(responseIds)];
  if (
    uniqueIds.length === 0 ||
    uniqueIds.length > MAX_PARKER_DAVIS_PACKAGE_EVALUATIONS ||
    uniqueIds.some((id) => !id.trim() || id.length > 100)
  ) {
    throw new ParkerDavisPackageError(
      `Select between 1 and ${MAX_PARKER_DAVIS_PACKAGE_EVALUATIONS} Parker Davis evaluations.`,
      "INVALID_SELECTION",
    );
  }

  let responses = await loadPackageResponses(uniqueIds);
  if (responses.length !== uniqueIds.length) {
    throw new ParkerDavisPackageError(
      "One or more Parker Davis evaluations are unavailable for export.",
      "FORBIDDEN",
    );
  }

  for (const response of responses) {
    const interaction = response.interaction;
    if (!interaction?.hasRecording) {
      throw new ParkerDavisPackageError(
        `The recording for ${response.agent.name} is unavailable.`,
        "RECORDING_UNAVAILABLE",
      );
    }
    if (interaction.mediaAssets.length === 0) {
      try {
        await attachProviderRecording({ interaction, userId });
      } catch {
        throw new ParkerDavisPackageError(
          `The recording for ${response.agent.name} could not be retrieved from FreePBX.`,
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
      throw new ParkerDavisPackageError(
        `The recording for ${response.agent.name} is unavailable in Qore storage.`,
        "RECORDING_FILE_UNAVAILABLE",
      );
    }
    const agentName = cleanFilePart(response.agent.name, "Agent");
    const evaluatedAt = operationalDate(response.submittedAt ?? response.createdAt);
    const callId = cleanFilePart(
      response.interaction?.providerInteractionId ?? response.id,
      response.id,
    );
    const baseName = `${agentName}, ${evaluatedAt.fileDate} - ${scoreLabel(Number(response.score))} - Call ${callId}`;
    const folder = useAgentFolders ? `${agentName}/` : "";
    const workbook = await buildParkerDavisScorecardWorkbook(response);
    const workbookBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const recordingPath = await verifiedRecordingPath(asset.storageKey);
    entries.push({
      responseId: response.id,
      workbookName: `${folder}${baseName} QA Score.xlsx`,
      workbookBuffer,
      recordingName: `${folder}${baseName}${audioExtension(asset.originalFileName, asset.mimeType)}`,
      recordingPath,
    });
  }

  const archiveName =
    distinctAgents.size === 1
      ? `${cleanFilePart(responses[0]?.agent.name ?? "Agent", "Agent")} - Parker Davis QA Reports.zip`
      : `Parker Davis QA Reports - ${new Date().toISOString().slice(0, 10)}.zip`;

  await Promise.all(
    responses.map((response) =>
      writeAuditLog({
        userId,
        campaignId: response.form.campaignId,
        module: "evaluations",
        action: "parker_davis_evidence_package_exported",
        entityType: "response",
        entityId: response.id,
        afterValue: {
          score: Number(response.score),
          recordingIncluded: true,
          workbookIncluded: true,
        },
        impact:
          "A Parker Davis QA evidence package containing the official scorecard and call recording was exported.",
      }),
    ),
  );

  return {
    archiveName,
    entries,
    createRecordingStream: (recordingPath: string) => createReadStream(recordingPath),
  };
}
