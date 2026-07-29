import { Readable } from "node:stream";
import archiver from "archiver";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import {
  isCanonicalSameOrigin,
  RequestBodyTooLargeError,
  readJsonBodyWithinLimit,
} from "@/lib/http-request";
import { logger } from "@/lib/logger";
import {
  HapusaPackageError,
  MAX_HAPUSA_PACKAGE_EVALUATIONS,
  prepareHapusaEvaluationPackage,
} from "@/server/hapusa-evaluation-package";
import { CampaignAuthorizationError } from "@/server/queries/campaign-filter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 16_384;
const requestSchema = z
  .object({
    responseIds: z
      .array(z.string().trim().min(1).max(100))
      .min(1)
      .max(MAX_HAPUSA_PACKAGE_EVALUATIONS),
  })
  .strict();

function jsonError(status: number, code: string, message: string) {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function contentDisposition(fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\\r\n]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function POST(request: NextRequest) {
  if (!isCanonicalSameOrigin(request)) {
    return jsonError(403, "INVALID_ORIGIN", "The export request is not valid.");
  }

  const session = await auth();
  if (!session?.user) return jsonError(401, "UNAUTHORIZED", "Sign in to export evaluations.");

  try {
    const input = requestSchema.parse(await readJsonBodyWithinLimit(request, MAX_REQUEST_BYTES));
    const prepared = await prepareHapusaEvaluationPackage(input.responseIds, session.user.id);
    const archive = archiver("zip", { zlib: { level: 6 } });
    for (const entry of prepared.entries) {
      archive.append(entry.workbookBuffer, { name: entry.workbookName });
      archive.append(prepared.createRecordingStream(entry.recordingPath), {
        name: entry.recordingName,
      });
    }
    archive.on("warning", (error) => {
      logger.warn({ err: error, userId: session.user.id }, "HAPUSA package archive warning");
    });
    archive.on("error", (error) => {
      logger.error({ err: error, userId: session.user.id }, "HAPUSA package archive failed");
    });
    void archive.finalize();

    return new Response(Readable.toWeb(archive) as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": contentDisposition(prepared.archiveName),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonError(
        400,
        "INVALID_SELECTION",
        `Select between 1 and ${MAX_HAPUSA_PACKAGE_EVALUATIONS} HAPUSA evaluations.`,
      );
    }
    if (error instanceof RequestBodyTooLargeError) {
      return jsonError(413, "REQUEST_TOO_LARGE", "The export request is too large.");
    }
    if (error instanceof CampaignAuthorizationError) {
      return jsonError(403, "EXPORT_FORBIDDEN", "You do not have access to this export.");
    }
    if (error instanceof HapusaPackageError) {
      const status =
        error.code === "INVALID_SELECTION" ? 400 : error.code === "FORBIDDEN" ? 403 : 409;
      return jsonError(status, error.code, error.message);
    }
    if (error instanceof SyntaxError) {
      return jsonError(400, "INVALID_JSON", "The export request is not valid.");
    }
    logger.error(
      { err: error, userId: session.user.id },
      "HAPUSA evaluation package preparation failed",
    );
    return jsonError(500, "EXPORT_FAILED", "The HAPUSA evidence package could not be created.");
  }
}
